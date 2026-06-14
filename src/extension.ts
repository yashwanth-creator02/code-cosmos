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
import { ProgressCallback, noopProgress } from './core/progress';

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
  forceRebuild: boolean,
  onProgress: ProgressCallback = noopProgress
): Promise<{ data: CosmosData; fromCache: boolean }> {
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
        // Cache hit — report all phases as instantly complete so the
        // overall percentage jumps straight to "render" for this folder.
        onProgress('scan', 1, 1);
        onProgress('parse', 1, 1);
        onProgress('git', 1, 1);
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

    const data = await buildFileTree(folder, offset, onProgress);
    await writeCosmosCache(folder, projectId, data, current);
    return { data, fromCache: false };
  }

  // Force path — used by manual refresh. Still write a fresh cache afterwards
  // so the next normal load benefits from it.
  const data = await buildFileTree(folder, offset, onProgress);
  const fingerprint = await computeFingerprint(folder);
  await writeCosmosCache(folder, projectId, data, fingerprint);
  return { data, fromCache: false };
}

export async function buildAllWorkspaces(
  workspaceFolders: readonly vscode.WorkspaceFolder[],
  forceRebuild = false,
  onProgress: ProgressCallback = noopProgress
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

  const totalFolders = workspaceFolders.length || 1;

  for (let i = 0; i < workspaceFolders.length; i++) {
    const folder = workspaceFolders[i];
    const offset = {
      x: (i - (workspaceFolders.length - 1) / 2) * GALAXY_SPACING,
      y: 0,
      z: 0,
    };

    // Wrap onProgress so each folder's 0-100% maps to its 1/totalFolders slice
    // of the overall progress. With one workspace folder (the common case)
    // this is a 1:1 pass-through.
    const folderIndex = i;
    const folderProgress: ProgressCallback = (phase, current, total) => {
      onProgress(phase, folderIndex * total + current, totalFolders * total);
    };

    const { data } = await buildFileTreeCached(folder, offset, forceRebuild, folderProgress);
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
  // Scan lock — prevents concurrent scans from running simultaneously.
  // If the user clicks the sidebar icon repeatedly, only the first scan runs.
  // ---------------------------------------------------------------------------
  let scanRunning = false;

  // ---------------------------------------------------------------------------
  // Phase weights for overall percentage calculation.
  // scan = fast (5%), parse = slow (55%), git = slow (40%).
  // These are approximate but directionally correct for most repos.
  // ---------------------------------------------------------------------------
  const PHASE_WEIGHTS = { scan: 0.05, parse: 0.55, git: 0.4, cache: 1, render: 1 };

  function makeProgressCallback(fromCache: boolean): ProgressCallback {
    let lastPercent = -1;
    return (phase, current, total) => {
      // Cache hit — report instant 100% so loading screen dismisses quickly
      if (fromCache) {
        if (lastPercent !== 100) {
          lastPercent = 100;
          cosmosPanel.sendMessage({
            type: 'SCAN_PROGRESS',
            payload: { percent: 100, phase: 'cache', message: 'Loaded from cache' },
          });
        }
        return;
      }

      const phaseProgress = total > 0 ? current / total : 1;
      const phaseWeight = PHASE_WEIGHTS[phase] ?? 0;

      // Accumulate: scan contributes 0–5%, parse 5–60%, git 60–100%
      let percent: number;
      if (phase === 'scan') {
        percent = Math.round(phaseProgress * 5);
      } else if (phase === 'parse') {
        percent = Math.round(5 + phaseProgress * 55);
      } else {
        percent = Math.round(60 + phaseProgress * 40);
      }

      percent = Math.min(99, percent); // never hit 100 until LOAD_UNIVERSE lands

      if (percent === lastPercent) return; // no-op duplicate
      lastPercent = percent;

      const phaseLabels: Record<string, string> = {
        scan: 'Scanning files',
        parse: `Parsing dependencies (${current}/${total})`,
        git: `Reading git history (${current}/${total} commits)`,
      };

      cosmosPanel.sendMessage({
        type: 'SCAN_PROGRESS',
        payload: {
          percent,
          phase,
          message: phaseLabels[phase] ?? phase,
        },
      });
    };
  }

  // ---------------------------------------------------------------------------
  // Helper: load data and push to panel
  // ---------------------------------------------------------------------------
  async function loadAndSend(forceRebuild = false): Promise<void> {
    if (workspaceFolders.length === 0) {
      vscode.window.showWarningMessage('Code Cosmos: No workspace folder is open.');
      return;
    }

    // Scan lock — if a scan is already in progress, skip the duplicate
    if (scanRunning) {
      logger.log('Scan already running — ignoring duplicate request');
      vscode.window.showInformationMessage('Code Cosmos: Scan already in progress...');
      return;
    }

    scanRunning = true;

    try {
      // Signal scan start to webview immediately so loading screen appears
      cosmosPanel.sendMessage({
        type: 'SCAN_PROGRESS',
        payload: { percent: 0, phase: 'scan', message: 'Starting scan...' },
      });

      // Determine cache status for the first workspace folder (most common case)
      // so we can show "Loading from cache" vs "Scanning..." in the UI early.
      // We detect this by checking if a fresh fingerprint matches the existing cache.
      // This is cheap — just a stat walk + one git HEAD read.
      const projectId = makeProjectId(workspaceFolders[0].uri.fsPath);
      const [existingCache, currentFingerprint] = await Promise.all([
        readCosmosCache(workspaceFolders[0], projectId),
        computeFingerprint(workspaceFolders[0]),
      ]);
      const willUseCache =
        !forceRebuild &&
        !!existingCache &&
        fingerprintsMatch(
          { manifest: existingCache.fileManifest, gitHead: existingCache.lastKnownGitHead },
          currentFingerprint
        );

      if (willUseCache) {
        cosmosPanel.sendMessage({
          type: 'SCAN_PROGRESS',
          payload: { percent: 10, phase: 'cache', message: 'Cache hit — loading instantly...' },
        });
      }

      const progressCb = makeProgressCallback(willUseCache);
      const allData = await buildAllWorkspaces(workspaceFolders, forceRebuild, progressCb);
      const fileCount = Object.keys(allData.files).length;
      const folderCount = Object.keys(allData.folders).length;

      if (fileCount === 0) {
        scanRunning = false;
        vscode.window.showWarningMessage(
          'Code Cosmos: No files found. Check your .cosmosignore or open a different folder.'
        );
        return;
      }

      // Performance mode prompt for large repos (>500 files) — shown only on
      // first load, not on cache-hit rebuilds. The settings value is written
      // to the .cosmos file so subsequent loads skip the prompt.
      if (!willUseCache && fileCount > LARGE_REPO_THRESHOLD) {
        const existingSettings = await cosmosPanel.loadSettingsFromCosmosFile(workspaceFolders[0]);
        // Only prompt if performance mode isn't already explicitly set
        if (!existingSettings.performanceMode) {
          const choice = await vscode.window.showWarningMessage(
            `Code Cosmos: ${fileCount} files found — large project. Enable Performance Mode for smoother rendering?`,
            'Yes, enable',
            'No thanks',
            'Always ask'
          );
          if (choice === 'Yes, enable') {
            const updated = { ...existingSettings, performanceMode: true };
            cosmosPanel.sendSettings(updated);
            cosmosPanel.sendMessage({ type: 'SAVE_SETTINGS' as any, payload: updated });
          }
          // 'No thanks' continues with current settings
          // 'Always ask' / dismissed = do nothing, prompt again next time
        }
      }

      // Signal render phase starting (100% overall is set when LOAD_UNIVERSE arrives)
      cosmosPanel.sendMessage({
        type: 'SCAN_PROGRESS',
        payload: { percent: 99, phase: 'render', message: 'Building cosmos...' },
      });

      cosmosPanel.sendMessage({ type: 'LOAD_UNIVERSE', payload: allData });

      const settings = await cosmosPanel.loadSettingsFromCosmosFile(workspaceFolders[0]);
      cosmosPanel.sendSettings(settings);

      const navigation = await cosmosPanel.loadNavigationFromCosmosFile(workspaceFolders[0]);
      cosmosPanel.sendNavigation(navigation);

      logger.log(`Load complete: ${fileCount} files, ${folderCount} folders`);
    } finally {
      scanRunning = false;
    }
  }

  // ---------------------------------------------------------------------------
  // openCosmos command: focuses the sidebar and triggers a load
  // ---------------------------------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('code-cosmos.openCosmos', async () => {
      try {
        logger.log('openCosmos fired');
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
  // refreshCosmos command — force rebuild, bypasses cache
  // ---------------------------------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('code-cosmos.refreshCosmos', async () => {
      try {
        await loadAndSend(true); // forceRebuild=true
      } catch (err) {
        logger.error(`refreshCosmos failed: ${err}`);
      }
    })
  );

  // ---------------------------------------------------------------------------
  // Auto-build when sidebar panel first becomes visible.
  // VS Code calls resolveWebviewView() when the user clicks the Activity Bar
  // icon — we hook into that moment to start the scan automatically, so the
  // developer doesn't have to run a separate command.
  // ---------------------------------------------------------------------------
  cosmosPanel.onFirstResolve(async () => {
    logger.log('Sidebar first resolved — auto-building');
    await loadAndSend();
    setupWatcherAndListeners();
  });

  // ---------------------------------------------------------------------------
  // Watcher + editor sync — set up once after first load
  // ---------------------------------------------------------------------------
  let watcherSetup = false;

  function setupWatcherAndListeners(): void {
    if (watcherSetup) return;
    watcherSetup = true;

    cosmosPanel.setRefreshCallback(async () => {
      logger.log('Manual refresh');
      await loadAndSend(true); // forceRebuild=true
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

    // Only rebuild on visibility if the cosmos is stale (file watcher marked it dirty).
    // Previously this rebuilt on every sidebar focus — even switching tabs in VS Code
    // triggered a full rescan, causing the "rebuilding itself" behaviour.
    let isStale = false;
    cosmosPanel.onBecomeVisible(async () => {
      panelIsVisible = true;
      if (isStale) {
        logger.log('Panel became visible and cosmos is stale — rebuilding');
        isStale = false;
        await loadAndSend();
      } else {
        logger.log('Panel became visible — cosmos is fresh, no rebuild needed');
      }
    });

    const handleChange = (uri: vscode.Uri) => {
      const relativePath = vscode.workspace.asRelativePath(uri);
      if (EXCLUDED_WATCH_PREFIXES.some((e) => relativePath.startsWith(e))) return;

      logger.log(`File changed: ${relativePath}`);
      CosmosPanel.currentPanel?.sendMessage({ type: 'COSMOS_STALE', payload: {} });
      isStale = true;

      if (!panelIsVisible) return;

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        logger.log('Auto-rebuilding...');
        isStale = false;
        await loadAndSend();
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
