// src/extension.ts

import * as vscode from 'vscode';
import { initLogger, logger } from './utils/logger';
import { buildFileTree } from './core/fileTree';
import { CosmosPanel } from './panel/CosmosPanel';
import { CosmosData, StarNode } from './types';

function prefixStarTree(node: StarNode, prefix: string): StarNode {
  return {
    ...node,
    folderId: prefix + node.folderId,
    childNodes: node.childNodes.map((child) => prefixStarTree(child, prefix)),
  };
}

export function activate(context: vscode.ExtensionContext) {
  initLogger(context);
  logger.log('Code Cosmos is active');

  const disposable = vscode.commands.registerCommand('code-cosmos.openCosmos', async () => {
    try {
      logger.log('openCosmos command fired');
      vscode.window.showInformationMessage('Code Cosmos: Scanning repository...');

      const workspaceFolders = vscode.workspace.workspaceFolders || [];

      if (workspaceFolders.length === 0) {
        vscode.window.showWarningMessage(
          'Code Cosmos: No workspace folder is open. Open a folder first.'
        );
        return;
      }

      const GALAXY_SPACING = 2000;
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

        // Use workspace name as prefix — NO double prefix
        // workspace name = "myapp", prefix = "myapp:"
        // workspaceRoots key = "myapp" (not "myapp:myapp")
        const prefix = `${folder.name}:`;

        // Merge workspace roots — key is just the workspace name
        for (const [name, root] of Object.entries(data.workspaceRoots)) {
          allData.workspaceRoots[name] = root;
        }

        for (const [id, file] of Object.entries(data.files)) {
          allData.files[prefix + id] = {
            ...file,
            id: prefix + id,
            folderId: prefix + file.folderId,
          };
        }

        for (const [id, folderData] of Object.entries(data.folders)) {
          allData.folders[prefix + id] = {
            ...folderData,
            id: prefix + id,
            parentId: folderData.parentId ? prefix + folderData.parentId : null,
            fileIds: folderData.fileIds.map((fid) => prefix + fid),
            childFolderIds: folderData.childFolderIds.map((cid) => prefix + cid),
          };
        }

        allData.dependencies.push(
          ...data.dependencies.map((dep) => ({
            ...dep,
            sourceId: prefix + dep.sourceId,
            targetId: prefix + dep.targetId,
          }))
        );

        if (i === 0 && data.starTree) {
          allData.starTree = prefixStarTree(data.starTree, prefix);
          allData.rootFolderId = prefix + '.';
          allData.gitData = data.gitData;
        }
      }

      const fileCount = Object.keys(allData.files).length;
      const folderCount = Object.keys(allData.folders).length;

      logger.log(`Scan complete: ${fileCount} files, ${folderCount} folders`);

      if (fileCount === 0) {
        vscode.window.showWarningMessage(
          'Code Cosmos: No files found. Check your .cosmosignore or open a different folder.'
        );
        return;
      }

      const VERY_LARGE_REPO_THRESHOLD = 1000;
      const LARGE_REPO_THRESHOLD = 500;

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

      const panel = CosmosPanel.createOrShow(context.extensionUri, context);
      const savedSettings = panel.getSavedSettings();
      panel.setRefreshCallback(async () => {
        logger.log('Manual refresh requested');
        vscode.window.showInformationMessage('Code Cosmos: Refreshing...');
        const freshData = await buildAllWorkspaces(workspaceFolders);
        panel.sendMessage({ type: 'LOAD_UNIVERSE', payload: freshData });
      });

      panel.sendSettings(savedSettings);

      panel.sendMessage({ type: 'LOAD_UNIVERSE', payload: allData });

      // Watch for active editor changes to sync with 3D view
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

      // Watch for file changes in the workspace
      const watcher = vscode.workspace.createFileSystemWatcher('**/*');

      let debounceTimer: NodeJS.Timeout | null = null;

      const handleChange = (uri: vscode.Uri) => {
        // Ignore changes in excluded folders
        const relativePath = vscode.workspace.asRelativePath(uri);
        const excluded = ['node_modules', '.git', 'dist', 'build', 'out'];
        if (excluded.some((e) => relativePath.startsWith(e))) {
          return;
        }

        logger.log(`File changed: ${relativePath}`);

        // Debounce — wait 1.5s after last change before rebuilding
        // This prevents rebuilding 50 times during a git checkout
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(async () => {
          logger.log('Rebuilding universe after file change...');
          try {
            // Rebuild using same logic as initial build
            const freshData = await buildAllWorkspaces(workspaceFolders);
            panel.sendMessage({ type: 'LOAD_UNIVERSE', payload: freshData });
            logger.log('Universe rebuilt');
          } catch (err) {
            logger.error(`Rebuild failed: ${err}`);
          }
        }, 1500);
      };

      watcher.onDidCreate(handleChange);
      watcher.onDidDelete(handleChange);
      watcher.onDidChange(handleChange);

      // Clean up watcher when panel closes
      panel.onDispose(() => {
        watcher.dispose();
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        logger.log('File watcher disposed');
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

async function buildAllWorkspaces(
  workspaceFolders: readonly vscode.WorkspaceFolder[]
): Promise<CosmosData> {
  const GALAXY_SPACING = 2000;
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

    for (const [name, root] of Object.entries(data.workspaceRoots)) {
      allData.workspaceRoots[name] = root;
    }

    for (const [id, file] of Object.entries(data.files)) {
      allData.files[prefix + id] = {
        ...file,
        id: prefix + id,
        folderId: prefix + file.folderId,
      };
    }

    for (const [id, folderData] of Object.entries(data.folders)) {
      allData.folders[prefix + id] = {
        ...folderData,
        id: prefix + id,
        parentId: folderData.parentId ? prefix + folderData.parentId : null,
        fileIds: folderData.fileIds.map((fid) => prefix + fid),
        childFolderIds: folderData.childFolderIds.map((cid) => prefix + cid),
      };
    }

    allData.dependencies.push(
      ...data.dependencies.map((dep) => ({
        ...dep,
        sourceId: prefix + dep.sourceId,
        targetId: prefix + dep.targetId,
      }))
    );

    if (i === 0 && data.starTree) {
      allData.starTree = prefixStarTree(data.starTree, prefix);
      allData.rootFolderId = prefix + '.';
      allData.gitData = data.gitData;
    }
  }

  return allData;
}
