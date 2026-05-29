import * as vscode from 'vscode';
import * as path from 'path';
import { GitData, GitFileInfo } from '../types';
import { logger } from '../utils/logger';

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

export async function readGitData(
  workspaceRoot: string,
  fileIds: string[]
): Promise<GitData> {
  try {
    const gitExtension = vscode.extensions.getExtension('vscode.git');
    if (!gitExtension) {
      logger.log('Git extension not found');
      return { branch: 'unknown', fileInfo: {}, available: false };
    }

    const git = gitExtension.exports.getAPI(1);
    if (!git) {
      return { branch: 'unknown', fileInfo: {}, available: false };
    }

    // Find repo matching workspace root
    const repo = git.repositories.find(
      (r: any) => path.resolve(r.rootUri.fsPath) === path.resolve(workspaceRoot)
    ) || git.repositories[0];

    if (!repo) {
      return { branch: 'unknown', fileInfo: {}, available: false };
    }

    const branch = repo.state.HEAD?.name || 'unknown';
    logger.log(`Git branch: ${branch}`);

    // Get uncommitted changes
    const uncommittedPaths = new Set<string>([
      ...repo.state.workingTreeChanges.map((c: any) =>
        normalizePath(path.relative(workspaceRoot, c.uri.fsPath))
      ),
      ...repo.state.indexChanges.map((c: any) =>
        normalizePath(path.relative(workspaceRoot, c.uri.fsPath))
      ),
    ]);

    logger.log(`Uncommitted changes: ${uncommittedPaths.size} files`);

    // Get commit log — last 500 commits is enough for heat data
    const logs = await repo.log({ maxEntries: 500 });
    const now = Date.now();

    // Count commits per file and track last change date
    const commitCounts: Record<string, number> = {};
    const lastChangeDates: Record<string, number> = {};

    for (const commit of logs) {
      const commitDate = new Date(commit.commitDate || commit.authorDate || now).getTime();

      // Get files changed in this commit
      try {
        const changes = await repo.diffBetween(commit.hash + '^', commit.hash);
        for (const change of changes) {
          const relPath = normalizePath(path.relative(workspaceRoot, change.uri.fsPath));

          commitCounts[relPath] = (commitCounts[relPath] || 0) + 1;
          if (!lastChangeDates[relPath] || commitDate > lastChangeDates[relPath]) {
            lastChangeDates[relPath] = commitDate;
          }
        }
      } catch {
        // Some commits (initial, merges) may fail diff — skip
      }
    }

    // Build fileInfo for each file we know about
    const fileInfo: Record<string, GitFileInfo> = {};
    const msPerDay = 1000 * 60 * 60 * 24;

    for (const fileId of fileIds) {
      const normalizedId = normalizePath(fileId);
      const commitCount = commitCounts[normalizedId] || 0;
      const lastChange = lastChangeDates[normalizedId];
      const daysSinceLastChange = lastChange
        ? Math.floor((now - lastChange) / msPerDay)
        : 999;

      fileInfo[fileId] = {
        commitCount,
        daysSinceLastChange,
        hasUncommittedChanges: uncommittedPaths.has(normalizedId),
      };
    }

    const filesWithCommits = Object.values(fileInfo).filter(f => f.commitCount > 0).length;
    logger.log(`Git data: ${filesWithCommits} files with commit history`);

    return { branch, fileInfo, available: true };

  } catch (err) {
    logger.warn(`Git read failed: ${err}`);
    return { branch: 'unknown', fileInfo: {}, available: false };
  }
}
