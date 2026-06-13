// src/extension.ts

import * as vscode from 'vscode';
import { initLogger, logger } from './utils/logger';
import { buildFileTree } from './core/fileTree';
import { CosmosPanel } from './panel/CosmosPanel';
import { CosmosData, StarNode } from './types';
import {
  readCosmosCache,
  writeCosmosCache,
  computeFingerprint,
  fingerprintsMatch,
  makeProjectId,
  FingerprintResult,
} from './core/cosmosCache';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GALAXY_SPACING = 2000;
const VERY_LARGE_REPO_THRESHOLD = 1000;
const LARGE_REPO_THRESHOLD = 500;
const REBUILD_DEBOUNCE_MS = 5000;
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

// ---------------------------------------------------------------------------
// Cached file tree builder
//
// Computes a cheap "fingerprint" (file manifest + git HEAD, no AST/git log)
// and compares it to the cached fingerprint from .cosmos.cache. If they match,
// the cached CosmosData is returned directly — AST parsing and git log (the
// two genuinely expensive operations) are skipped entirely.
//
// If forceRebuild is true (manual refresh), the cache is bypassed entirely —
// the user explicitly asked for fresh data, e.g. after editing .cosmosignore,
// which doesn't change any file's mtime.
// ---------------------------------------------------------------------------

async function buildFileTreeCached(
  folder: vscode.WorkspaceFolder,
  offset: { x: number; y: number; z: number },
  forceRebuild: boolean
): Promise<{ data: CosmosData; fromCache: boolean }> {
  logger.log(`Building file tree for ${folder.name}...`);
  const projectId = makeProjectId(folder.uri.fsPath);

  if (!forceRebuild) {
    const [cache, current] = await Promise.all([
      readCosmosCache(folder, projectId),
      computeFingerprint(folder),
    ]);

    if (cache) {
      const cached: FingerprintResult = {
        manifest: cache.fileManifest,
        gitHead: cache.lastKnownGitHead,
      };
      if (fingerprintsMatch(cached, current)) {
        logger.log(`.cosmos.cache hit for ${folder.name} — skipping AST parse + git log`);
        // Reapply offset — it's a layout positioning value, not derived data,
        // and is recomputed per-build based on workspace ordering.
        const data: CosmosData = {
          ...cache.data,
          folders: {
            ...cache.data.folders,
            '.': { ...cache.data.folders['.'], offset },
          },
        };
        return { data, fromCache: true };
      }
      logger.log(`.cosmos.cache stale for ${folder.name} — rebuilding`);
    } else {
      logger.log(`.cosmos.cache miss for ${folder.name} — building`);
    }

    const data = await buildFileTree(folder, offset);
    await writeCosmosCache(folder, projectId, data, current);
    return { data, fromCache: false };
  }

  // Force path — used by manual refresh. Still write a fresh cache afterwards
  // so the next normal load benefits from it.
  const data = await buildFileTree(folder, offset);
  const fingerprint = await computeFingerprint(folder);
  await writeCosmosCache(folder, projectId, data, fingerprint);
  return { data, fromCache: false };
}

export async function buildAllWorkspaces(
  workspaceFolders: readonly vscode.WorkspaceFolder[],
  forceRebuild = false
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
  logger.log('Building all workspaces...');

  for (let i = 0; i < workspaceFolders.length; i++) {
    const folder = workspaceFolders[i];
    const offset = {
      x: (i - (workspaceFolders.length - 1) / 2) * GALAXY_SPACING,
      y: 0,
      z: 0,
    };

    const { data } = await buildFileTreeCached(folder, offset, forceRebuild);
    const prefix = `${folder.name}:`;

    for (const [name, root] of Object.entries(data.workspaceRoots)) {
      allData.workspaceRoots[name] = root;
    }
    for (const [id, file] of Object.entries(data.files)) {
      allData.files[prefix + id] = { ...file, id: prefix + id, folderId: prefix + file.folderId };
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
    }

    if (data.gitData?.available) {
      if (!allData.gitData) {
        allData.gitData = { branch: data.gitData.branch, fileInfo: {}, available: true };
      }
      for (const [fileId, info] of Object.entries(data.gitData.fileInfo)) {
        allData.gitData.fileInfo[prefix + fileId] = info;
      }
    }
  }

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
  logger.log('Code Cosmos activating');

  const workspaceFolders = vscode.workspace.workspaceFolders || [];

  // ---------------------------------------------------------------------------
  // Register the sidebar view provider.
  // VS Code calls resolveWebviewView() when the user first opens the panel.
  // retainContextWhenHidden: true keeps the WebGL canvas alive when sidebar
  // is collapsed so the 3D scene doesn't need to rebuild on every toggle.
  // ---------------------------------------------------------------------------
  const cosmosPanel = new CosmosPanel(context.extensionUri, context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CosmosPanel.viewType, cosmosPanel, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // ---------------------------------------------------------------------------
  // Helper: load data and push to panel
  // One scan only — buildAllWorkspaces returns file count, no pre-scan needed.
  // ---------------------------------------------------------------------------
  async function loadAndSend(): Promise<void> {
    if (workspaceFolders.length === 0) {
      vscode.window.showWarningMessage('Code Cosmos: No workspace folder is open.');
      return;
    }

    vscode.window.showInformationMessage('Code Cosmos: Scanning...');
    const allData = await buildAllWorkspaces(workspaceFolders);
    const fileCount = Object.keys(allData.files).length;
    const folderCount = Object.keys(allData.folders).length;

    if (fileCount === 0) {
      vscode.window.showWarningMessage(
        'Code Cosmos: No files found. Check your .cosmosignore or open a different folder.'
      );
      return;
    }

    // Large repo warning shown after scan — avoids a redundant pre-scan
    if (fileCount > VERY_LARGE_REPO_THRESHOLD) {
      const choice = await vscode.window.showWarningMessage(
        `Code Cosmos: Large repo (${fileCount} files). Rendering may be slow. Continue?`,
        'Continue',
        'Cancel'
      );
      if (choice !== 'Continue') {
        return;
      }
    }

    cosmosPanel.sendMessage({ type: 'LOAD_UNIVERSE', payload: allData });

    // Load settings and navigation (camera bookmarks etc.) from per-project .cosmos file
    const settings = await cosmosPanel.loadSettingsFromCosmosFile(workspaceFolders[0]);
    cosmosPanel.sendSettings(settings);

    const navigation = await cosmosPanel.loadNavigationFromCosmosFile(workspaceFolders[0]);
    cosmosPanel.sendNavigation(navigation);
    vscode.window.showInformationMessage(
      `Code Cosmos: ${fileCount} files across ${folderCount} folders`
    );
  }

  // ---------------------------------------------------------------------------
  // openCosmos command: reveals the sidebar panel and loads data
  // ---------------------------------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('code-cosmos.openCosmos', async () => {
      try {
        logger.log('openCosmos fired');
        // Focus the sidebar view — opens it if closed
        await vscode.commands.executeCommand('codeCosmos.sidebarView.focus');
        await loadAndSend();
        setupWatcherAndListeners();
      } catch (err) {
        logger.error(`openCosmos failed: ${err}`);
        vscode.window.showErrorMessage(`Code Cosmos error: ${err}`);
      }
    })
  );

  // ---------------------------------------------------------------------------
  // refreshCosmos command: refreshes without reopening
  // ---------------------------------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('code-cosmos.refreshCosmos', async () => {
      try {
        // forceRebuild=true — manual refresh bypasses .cosmos.cache entirely.
        // The user explicitly asked for fresh data (e.g. after editing
        // .cosmosignore, which wouldn't change any tracked file's mtime).
        const freshData = await buildAllWorkspaces(workspaceFolders, true);
        cosmosPanel.sendMessage({ type: 'LOAD_UNIVERSE', payload: freshData });
      } catch (err) {
        logger.error(`refreshCosmos failed: ${err}`);
      }
    })
  );

  // ---------------------------------------------------------------------------
  // Watcher + editor sync — set up once after first load
  // ---------------------------------------------------------------------------
  let watcherSetup = false;

  function setupWatcherAndListeners(): void {
    if (watcherSetup) return;
    watcherSetup = true;

    cosmosPanel.setRefreshCallback(async () => {
      logger.log('Manual refresh');
      vscode.window.showInformationMessage('Code Cosmos: Refreshing...');
      const freshData = await buildAllWorkspaces(workspaceFolders, true);
      cosmosPanel.sendMessage({ type: 'LOAD_UNIVERSE', payload: freshData });
    });

    // Active editor → beacon chip
    const editorListener = vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && CosmosPanel.currentPanel) {
        const uri = editor.document.uri;
        const folder = vscode.workspace.getWorkspaceFolder(uri);
        if (folder) {
          const relativePath = vscode.workspace.asRelativePath(uri, false);
          const fileId = `${folder.name}:${relativePath}`;
          CosmosPanel.currentPanel.sendMessage({ type: 'FOCUS_FILE', payload: { fileId } });
        }
      }
    });
    context.subscriptions.push(editorListener);

    // File watcher
    const watcher = vscode.workspace.createFileSystemWatcher('**/*');
    let debounceTimer: NodeJS.Timeout | null = null;
    let panelIsVisible = true;

    cosmosPanel.onVisibilityChange((visible) => {
      panelIsVisible = visible;
    });

    cosmosPanel.onBecomeVisible(async () => {
      panelIsVisible = true;
      logger.log('Panel became visible — rebuilding');
      try {
        const freshData = await buildAllWorkspaces(workspaceFolders);
        cosmosPanel.sendMessage({ type: 'LOAD_UNIVERSE', payload: freshData });
      } catch (err) {
        logger.error(`Visibility rebuild failed: ${err}`);
      }
    });

    const handleChange = (uri: vscode.Uri) => {
      const relativePath = vscode.workspace.asRelativePath(uri);
      if (EXCLUDED_WATCH_PREFIXES.some((e) => relativePath.startsWith(e))) return;

      logger.log(`File changed: ${relativePath}`);
      CosmosPanel.currentPanel?.sendMessage({ type: 'COSMOS_STALE', payload: {} });

      if (!panelIsVisible) return;

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        logger.log('Auto-rebuilding...');
        try {
          const freshData = await buildAllWorkspaces(workspaceFolders);
          cosmosPanel.sendMessage({ type: 'LOAD_UNIVERSE', payload: freshData });
        } catch (err) {
          logger.error(`Auto-rebuild failed: ${err}`);
        }
      }, REBUILD_DEBOUNCE_MS);
    };

    watcher.onDidCreate(handleChange);
    watcher.onDidDelete(handleChange);
    watcher.onDidChange(handleChange);

    cosmosPanel.onDispose(() => {
      watcher.dispose();
      if (debounceTimer) clearTimeout(debounceTimer);
    });

    context.subscriptions.push(watcher);
  }

  logger.log('Code Cosmos activated');
}

export function deactivate() {
  logger.log('Code Cosmos deactivated');
}
