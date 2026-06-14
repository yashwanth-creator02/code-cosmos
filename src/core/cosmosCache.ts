// src/core/cosmosCache.ts
//
// Manages the per-workspace .cosmos.cache file — the expensive-to-compute
// data layer (dependency graph, git churn scores, spatial layout).
//
// THE PROBLEM THIS SOLVES:
//   Every open/refresh/visibility-change previously ran buildFileTree() from
//   scratch: full directory traversal, AST parsing of every source file, AND
//   up to 500 git log entries each with a diffBetween() call. For a project
//   with real git history, the git log step alone can take seconds — and it
//   ran again every time the sidebar regained focus, even with zero changes.
//
// THE FIX:
//   Cache the full CosmosData (files, folders, dependencies, starTree, gitData)
//   alongside a lightweight "fingerprint" of the workspace: a file manifest
//   (relativePath -> {size, mtimeMs}) and the current git HEAD commit hash.
//
//   On every load, we recompute ONLY the fingerprint — a fast directory walk
//   with stat() calls, no AST parsing, no git log. If the fingerprint matches
//   the cached one, we return the cached CosmosData directly: AST parsing and
//   git log are skipped entirely. If it doesn't match (files changed, git HEAD
//   moved), we fall through to a full buildFileTree() and write a fresh cache.
//
// WHAT IS NOT IMPLEMENTED (deliberately, see design discussion):
//   - Incremental re-parse of only the changed files. A fingerprint mismatch
//     still triggers a full rebuild of that workspace. This is the next
//     logical step but is a substantially larger change (surgical dependency
//     graph updates) — left for a future pass once this caching layer is
//     proven in practice.

import * as vscode from 'vscode';
import * as path from 'path';
import pLimit from 'p-limit';
import { CosmosData } from '../types';
import { buildExclusionList, shouldExclude } from './exclusionManager';
import { logger } from '../utils/logger';

const CACHE_SCHEMA_VERSION = 1;
const CACHE_FILENAME = '.cosmos.cache';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileManifestEntry {
  size: number;
  mtimeMs: number;
}

export type FileManifest = Record<string, FileManifestEntry>;

export interface CosmosCacheData {
  version: number;
  projectId: string;
  lastFullParse: string; // ISO timestamp
  lastKnownGitHead: string | null; // null = git unavailable/not a repo
  fileManifest: FileManifest;
  data: CosmosData; // unprefixed — this workspace folder's own CosmosData
}

export interface FingerprintResult {
  manifest: FileManifest;
  gitHead: string | null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read the .cosmos.cache file. Returns null if missing, corrupt, or version
 * mismatched — any of these mean "treat as cache miss, do a full rebuild".
 * Never throws.
 */
export async function readCosmosCache(
  workspaceFolder: vscode.WorkspaceFolder,
  projectId: string
): Promise<CosmosCacheData | null> {
  const filePath = cacheFilePath(workspaceFolder);
  try {
    const raw = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
    const parsed = JSON.parse(Buffer.from(raw).toString('utf8')) as Partial<CosmosCacheData>;

    if (parsed.version !== CACHE_SCHEMA_VERSION) {
      logger.log(`.cosmos.cache version mismatch — treating as cache miss`);
      return null;
    }
    if (parsed.projectId !== projectId) {
      logger.log(`.cosmos.cache projectId mismatch — treating as cache miss`);
      return null;
    }
    if (!parsed.data || !parsed.fileManifest) {
      logger.log(`.cosmos.cache missing data/manifest — treating as cache miss`);
      return null;
    }

    return parsed as CosmosCacheData;
  } catch {
    // Missing or corrupt — silent cache miss
    return null;
  }
}

/**
 * Write the .cosmos.cache file. Silent on failure — caching is an optimisation,
 * never a requirement for correctness.
 */
export async function writeCosmosCache(
  workspaceFolder: vscode.WorkspaceFolder,
  projectId: string,
  data: CosmosData,
  fingerprint: FingerprintResult
): Promise<void> {
  const filePath = cacheFilePath(workspaceFolder);
  const cache: CosmosCacheData = {
    version: CACHE_SCHEMA_VERSION,
    projectId,
    lastFullParse: new Date().toISOString(),
    lastKnownGitHead: fingerprint.gitHead,
    fileManifest: fingerprint.manifest,
    data,
  };

  try {
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(filePath),
      Buffer.from(JSON.stringify(cache), 'utf8') // no pretty-print — this file can get large
    );
    logger.log(`.cosmos.cache written (${Object.keys(fingerprint.manifest).length} files)`);
  } catch (err) {
    logger.error(`.cosmos.cache write failed: ${err}`);
  }
}

/**
 * Compute the current "fingerprint" of the workspace: a file manifest
 * (size + mtime per file, via a fast directory walk — no AST parsing) and
 * the current git HEAD commit hash (via the VS Code git extension API,
 * no git log).
 *
 * This is the operation we run on every load to decide whether the cache
 * is still valid. It must stay cheap — that's the entire point.
 */
export async function computeFingerprint(
  workspaceFolder: vscode.WorkspaceFolder
): Promise<FingerprintResult> {
  const [manifest, gitHead] = await Promise.all([
    buildLightManifest(workspaceFolder),
    getCurrentGitHead(workspaceFolder.uri.fsPath),
  ]);
  return { manifest, gitHead };
}

/**
 * Compare two fingerprints. True if they describe the same workspace state —
 * same files, same sizes, same modification times, same git HEAD.
 */
export function fingerprintsMatch(a: FingerprintResult, b: FingerprintResult): boolean {
  if (a.gitHead !== b.gitHead) {
    return false;
  }
  const aKeys = Object.keys(a.manifest);
  const bKeys = Object.keys(b.manifest);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (const key of aKeys) {
    const ea = a.manifest[key];
    const eb = b.manifest[key];
    if (!eb || ea.size !== eb.size || ea.mtimeMs !== eb.mtimeMs) {
      return false;
    }
  }
  return true;
}

/**
 * Deterministic project ID — same algorithm as cosmosFile.ts, kept in sync
 * so cache and preferences files agree on identity. Re-derived here rather
 * than imported to avoid a circular dependency between the two cache modules.
 */
export function makeProjectId(fsPath: string): string {
  let hash = 0;
  for (let i = 0; i < fsPath.length; i++) {
    const char = fsPath.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return `cosmos_${Math.abs(hash).toString(16)}`;
}

// ---------------------------------------------------------------------------
// Internal: lightweight directory walk (stat only, no file content reads)
// ---------------------------------------------------------------------------

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

async function buildLightManifest(workspaceFolder: vscode.WorkspaceFolder): Promise<FileManifest> {
  const workspaceRoot = workspaceFolder.uri.fsPath;
  const exclusions = await buildExclusionList(workspaceRoot);
  const manifest: FileManifest = {};

  async function walk(dirUri: vscode.Uri, visited: Set<string>): Promise<void> {
    const limit = pLimit(10); // same concurrency as fileTree.ts's traverseDirectory
    const realPath = path.resolve(dirUri.fsPath);
    if (visited.has(realPath)) {
      return; // symlink loop guard, same as fileTree.ts
    }
    visited.add(realPath);

    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(dirUri);
    } catch {
      return;
    }

    const tasks = entries.map(([name, fileType]) =>
      limit(async () => {
        const entryUri = vscode.Uri.joinPath(dirUri, name);
        const entryRelative = normalizePath(path.relative(workspaceRoot, entryUri.fsPath));

        if (shouldExclude(entryRelative, exclusions)) {
          return;
        }

        if (fileType === vscode.FileType.Directory) {
          await walk(entryUri, visited);
          return;
        }
        if (fileType !== vscode.FileType.File) {
          return;
        }

        try {
          const stat = await vscode.workspace.fs.stat(entryUri);
          manifest[entryRelative] = { size: stat.size, mtimeMs: stat.mtime };
        } catch {
          // File disappeared between readDirectory and stat — skip
        }
      })
    );

    await Promise.all(tasks);
  }

  await walk(workspaceFolder.uri, new Set());
  return manifest;
}

// ---------------------------------------------------------------------------
// Internal: current git HEAD via VS Code's built-in git extension
//
// Deliberately does NOT call repo.log() — that's the expensive operation
// (up to 500 diffBetween calls in gitReader.ts). repo.state.HEAD.commit is
// already known to the extension from its own state tracking — reading it
// is synchronous and free.
// ---------------------------------------------------------------------------

async function getCurrentGitHead(workspaceRootFsPath: string): Promise<string | null> {
  try {
    const gitExtension = vscode.extensions.getExtension('vscode.git');
    if (!gitExtension) {
      return null;
    }
    const git = gitExtension.exports.getAPI(1);
    if (!git) {
      return null;
    }
    const repo =
      git.repositories.find(
        (r: any) => path.resolve(r.rootUri.fsPath) === path.resolve(workspaceRootFsPath)
      ) || git.repositories[0];

    return repo?.state?.HEAD?.commit ?? null;
  } catch {
    return null;
  }
}

function cacheFilePath(workspaceFolder: vscode.WorkspaceFolder): string {
  return path.join(workspaceFolder.uri.fsPath, CACHE_FILENAME);
}
