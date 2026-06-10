// src/extension.ts

import * as vscode from 'vscode';
import { initLogger, logger } from './utils/logger';
import { buildFileTree } from './core/fileTree';
import { CosmosPanel } from './panel/CosmosPanel';
import { CosmosData, StarNode } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GALAXY_SPACING = 2000;
const VERY_LARGE_REPO_THRESHOLD = 1000;
const LARGE_REPO_THRESHOLD = 500;
const REBUILD_DEBOUNCE_MS = 5000; // increased from 1.5s — prevents thrashing on active editing
const EXCLUDED_WATCH_PREFIXES = ['node_modules', '.git', 'dist', 'build', 'out'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function prefixStarTree(node: StarNode, prefix: string): StarNode {
  return {
    ...node,
    folderId: prefix + node.folderId,
    childNodes: node.childNodes.map((child) => prefixStarTree(child, prefix)),
  };
}

/**
 * Single source of truth for building CosmosData across all workspace folders.
 * Used for both initial load and manual/auto refresh — no duplication.
 */
export async function buildAllWorkspaces(
  workspaceFolders: readonly vscode.WorkspaceFolder[]
): Promise<CosmosData> {
  const allData: CosmosData = {
    files: {},
    folders: {},
    dependencies: [],
    rootFolderId: '.',
    workspaceRoots: {},
    starTree: null,
    gitData: null,
  };

  for (let i = 0; i < workspaceFolders.length; i++) {
    const folder = workspaceFolders[i];
    const offset = {
      x: (i - (workspaceFolders.length - 1) / 2) * GALAXY_SPACING,
      y: 0,
      z: 0,
    };

    const data = await buildFileTree(folder, offset);
    const prefix = `${folder.name}:`;

    // Merge workspace roots
    for (const [name, root] of Object.entries(data.workspaceRoots)) {
      allData.workspaceRoots[name] = root;
    }

    // Merge files with workspace prefix
    for (const [id, file] of Object.entries(data.files)) {
      allData.files[prefix + id] = {
        ...file,
        id: prefix + id,
        folderId: prefix + file.folderId,
      };
    }

    // Merge folders with workspace prefix
    for (const [id, folderData] of Object.entries(data.folders)) {
      allData.folders[prefix + id] = {
        ...folderData,
        id: prefix + id,
        parentId: folderData.parentId ? prefix + folderData.parentId : null,
        fileIds: folderData.fileIds.map((fid) => prefix + fid),
        childFolderIds: folderData.childFolderIds.map((cid) => prefix + cid),
      };
    }

    // Merge dependencies with workspace prefix
    allData.dependencies.push(
      ...data.dependencies.map((dep) => ({
        ...dep,
        sourceId: prefix + dep.sourceId,
        targetId: prefix + dep.targetId,
      }))
    );

    // Star tree: use first workspace as primary for camera anchor.
    // Git data: collected from ALL workspaces and merged.
    // FIX: previously only i === 0 received git data — all roots now contribute.
    if (i === 0 && data.starTree) {
      allData.starTree = prefixStarTree(data.starTree, prefix);
      allData.rootFolderId = prefix + '.';
    }

    if (data.gitData?.available) {
      if (!allData.gitData) {
        // First workspace with git data — use as base
        allData.gitData = {
          branch: data.gitData.branch,
          fileInfo: {},
          available: true,
        };
      }
      // Merge file info from this workspace into the combined git data,
      // prefixing all file IDs so they match the merged file map.
      for (const [fileId, info] of Object.entries(data.gitData.fileInfo)) {
        allData.gitData.fileInfo[prefix + fileId] = info;
      }
    }
  }

  // If no workspace had git data, ensure gitData is a valid unavailable state
  if (!allData.gitData) {
    allData.gitData = { branch: 'unknown', fileInfo: {}, available: false };
  }

  return allData;
}

// ---------------------------------------------------------------------------
// Extension lifecycle
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext) {
  initLogger(context);
  logger.log('Code Cosmos is active');

  const disposable = vscode.commands.registerCommand('code-cosmos.openCosmos', async () => {
    try {
      logger.log('openCosmos command fired');

      const workspaceFolders = vscode.workspace.workspaceFolders || [];

      if (workspaceFolders.length === 0) {
        vscode.window.showWarningMessage(
          'Code Cosmos: No workspace folder is open. Open a folder first.'
        );
        return;
      }

      vscode.window.showInformationMessage('Code Cosmos: Scanning repository...');

      const allData = await buildAllWorkspaces(workspaceFolders);

      const fileCount = Object.keys(allData.files).length;
      const folderCount = Object.keys(allData.folders).length;

      logger.log(`Scan complete: ${fileCount} files, ${folderCount} folders`);

      if (fileCount === 0) {
        vscode.window.showWarningMessage(
          'Code Cosmos: No files found. Check your .cosmosignore or open a different folder.'
        );
        return;
      }

      if (fileCount > VERY_LARGE_REPO_THRESHOLD) {
        const choice = await vscode.window.showWarningMessage(
          `Code Cosmos: This repo has ${fileCount} files. Rendering may be slow. Continue?`,
          'Continue',
          'Cancel'
        );
        if (choice !== 'Continue') {
          return;
        }
      } else if (fileCount > LARGE_REPO_THRESHOLD) {
        vscode.window.showInformationMessage(
          `Code Cosmos: Large repo (${fileCount} files). Consider adding folders to .cosmosignore.`
        );
      }

      if (fileCount < 3) {
        vscode.window.showInformationMessage(
          `Code Cosmos: Only ${fileCount} file(s) found. Works best with larger projects.`
        );
      }

      // Open beside the active editor (ViewColumn.Beside) rather than replacing it.
      // This keeps the cosmos as a companion tool — the developer keeps their code
      // open on the left and navigates the cosmos on the right simultaneously.
      const panel = CosmosPanel.createOrShow(context.extensionUri, context);
      const savedSettings = panel.getSavedSettings();

      panel.setRefreshCallback(async () => {
        logger.log('Manual refresh requested');
        vscode.window.showInformationMessage('Code Cosmos: Refreshing...');
        const freshData = await buildAllWorkspaces(workspaceFolders);
        panel.sendMessage({ type: 'LOAD_UNIVERSE', payload: freshData });
        logger.log('Refresh complete');
      });

      panel.sendSettings(savedSettings);
      panel.sendMessage({ type: 'LOAD_UNIVERSE', payload: allData });

      // Sync active editor → cosmos focus (beacon chip behaviour)
      const editorListener = vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && CosmosPanel.currentPanel) {
          const uri = editor.document.uri;
          const folder = vscode.workspace.getWorkspaceFolder(uri);
          if (folder) {
            const relativePath = vscode.workspace.asRelativePath(uri, false);
            const fileId = `${folder.name}:${relativePath}`;
            CosmosPanel.currentPanel.sendMessage({
              type: 'FOCUS_FILE',
              payload: { fileId },
            });
          }
        }
      });
      context.subscriptions.push(editorListener);

      // File watcher — triggers a stale indicator rather than an immediate rebuild.
      // Auto-rebuild is debounced to REBUILD_DEBOUNCE_MS (5s) to avoid thrashing
      // during active editing sessions. The panel also exposes a manual refresh button
      // for developers who want to control when the cosmos updates.
      const watcher = vscode.workspace.createFileSystemWatcher('**/*');
      let debounceTimer: NodeJS.Timeout | null = null;
      let panelIsVisible = true;

      // Track panel visibility so we skip rebuilds while it's hidden
      panel.onVisibilityChange((visible) => {
        panelIsVisible = visible;
      });

      const handleChange = (uri: vscode.Uri) => {
        const relativePath = vscode.workspace.asRelativePath(uri);

        // Skip changes in always-excluded directories
        if (EXCLUDED_WATCH_PREFIXES.some((e) => relativePath.startsWith(e))) {
          return;
        }

        logger.log(`File changed: ${relativePath}`);

        // Mark the cosmos as stale immediately so the user knows
        if (CosmosPanel.currentPanel) {
          CosmosPanel.currentPanel.sendMessage({ type: 'COSMOS_STALE', payload: {} });
        }

        // Only schedule a rebuild if the panel is visible — no point rebuilding
        // a hidden panel that will receive fresh data when it becomes visible.
        if (!panelIsVisible) {
          logger.log('Panel hidden — skipping auto-rebuild, will rebuild on next show');
          return;
        }

        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }

        debounceTimer = setTimeout(async () => {
          logger.log('Auto-rebuilding universe after file change...');
          try {
            const freshData = await buildAllWorkspaces(workspaceFolders);
            panel.sendMessage({ type: 'LOAD_UNIVERSE', payload: freshData });
            logger.log('Auto-rebuild complete');
          } catch (err) {
            logger.error(`Auto-rebuild failed: ${err}`);
          }
        }, REBUILD_DEBOUNCE_MS);
      };

      // On panel becoming visible again after being hidden — rebuild if stale
      panel.onBecomeVisible(async () => {
        panelIsVisible = true;
        logger.log('Panel became visible — rebuilding if stale');
        try {
          const freshData = await buildAllWorkspaces(workspaceFolders);
          panel.sendMessage({ type: 'LOAD_UNIVERSE', payload: freshData });
        } catch (err) {
          logger.error(`Visibility rebuild failed: ${err}`);
        }
      });

      watcher.onDidCreate(handleChange);
      watcher.onDidDelete(handleChange);
      watcher.onDidChange(handleChange);

      panel.onDispose(() => {
        watcher.dispose();
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        logger.log('File watcher and panel disposed');
      });

      context.subscriptions.push(watcher);

      vscode.window.showInformationMessage(
        `Code Cosmos: Found ${fileCount} files across ${folderCount} folders`
      );
    } catch (err) {
      logger.error(`openCosmos failed: ${err}`);
      vscode.window.showErrorMessage(`Code Cosmos error: ${err}`);
    }
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {
  logger.log('Code Cosmos deactivated');
}
