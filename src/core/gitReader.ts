import * as vscode from 'vscode';
import * as path from 'path';
import { GitData, GitFileInfo } from '../types';
import { logger } from '../utils/logger';
import { ProgressCallback, noopProgress } from './progress';

/**
 * Normalizes a path by replacing backslashes with forward slashes.
 *
 * @param p - The path string to normalize.
 * @returns The normalized path with forward slashes.
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Reads git metadata for a set of files in a workspace.
 *
 * Fetches branch name, commit counts, last modification dates, and uncommitted changes
 * using the VS Code built-in Git extension. Calculates a "heat" score for each file.
 *
 * @param workspaceRoot - The absolute path to the workspace root.
 * @param fileIds - Array of file IDs (relative paths) to fetch git data for.
 * @param onProgress - Optional callback to report progress.
 * @returns A promise resolving to GitData for the workspace.
 */
export async function readGitData(
  workspaceRoot: string,
  fileIds: string[],
  onProgress: ProgressCallback = noopProgress
): Promise<GitData> {
  try {
    const gitExtension = vscode.extensions.getExtension('vscode.git');
    if (!gitExtension) {
      logger.log('Git extension not found');
      onProgress('git', 1, 1);
      return { branch: 'unknown', fileInfo: {}, available: false };
    }

    const git = gitExtension.exports.getAPI(1);
    if (!git) {
      onProgress('git', 1, 1);
      return { branch: 'unknown', fileInfo: {}, available: false };
    }

    const repo =
      git.repositories.find(
        (r: any) => path.resolve(r.rootUri.fsPath) === path.resolve(workspaceRoot)
      ) || git.repositories[0];

    if (!repo) {
      onProgress('git', 1, 1);
      return { branch: 'unknown', fileInfo: {}, available: false };
    }

    const branch = repo.state.HEAD?.name || 'unknown';

    const uncommittedPaths = new Set<string>([
      ...repo.state.workingTreeChanges.map((c: any) =>
        normalizePath(path.relative(workspaceRoot, c.uri.fsPath))
      ),
      ...repo.state.indexChanges.map((c: any) =>
        normalizePath(path.relative(workspaceRoot, c.uri.fsPath))
      ),
    ]);

    const logs = await repo.log({ maxEntries: 500 });
    const now = Date.now();

    const commitCounts: Record<string, number> = {};
    const lastChangeDates: Record<string, number> = {};

    const totalCommits = logs.length;
    let processedCommits = 0;

    if (totalCommits === 0) {
      onProgress('git', 1, 1);
    }

    for (const commit of logs) {
      const commitDate = new Date(commit.commitDate || commit.authorDate || now).getTime();
      try {
        const changes = await repo.diffBetween(commit.hash + '^', commit.hash);
        for (const change of changes) {
          const relPath = normalizePath(path.relative(workspaceRoot, change.uri.fsPath));
          commitCounts[relPath] = (commitCounts[relPath] || 0) + 1;
          if (!lastChangeDates[relPath] || commitDate > lastChangeDates[relPath]) {
            lastChangeDates[relPath] = commitDate;
          }
        }
      } catch {}
      processedCommits++;
      onProgress('git', processedCommits, totalCommits);
    }

    const maxCommits = Math.max(1, ...(Object.values(commitCounts) as number[]));
    const fileInfo: Record<string, GitFileInfo> = {};
    const msPerDay = 1000 * 60 * 60 * 24;

    for (const fileId of fileIds) {
      const normalizedId = normalizePath(fileId);
      const commitCount = commitCounts[normalizedId] || 0;
      const lastChange = lastChangeDates[normalizedId];
      const daysSinceLastChange = lastChange ? Math.floor((now - lastChange) / msPerDay) : 999;

      // Calculate heat: frequency (0.7) + recency (0.3)
      const freqScore = commitCount / maxCommits;
      const recencyScore = Math.max(0, 1 - daysSinceLastChange / 30);
      const heat = freqScore * 0.7 + recencyScore * 0.3;

      fileInfo[fileId] = {
        commitCount,
        daysSinceLastChange,
        hasUncommittedChanges: uncommittedPaths.has(normalizedId),
        heat: Math.min(1, heat),
      };
    }

    return { branch, fileInfo, available: true };
  } catch (err) {
    logger.warn(`Git read failed: ${err}`);
    onProgress('git', 1, 1);
    return { branch: 'unknown', fileInfo: {}, available: false };
  }
}
