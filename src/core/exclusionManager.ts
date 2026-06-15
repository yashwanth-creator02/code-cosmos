// src/core/exclusionManager.ts

import * as vscode from 'vscode';
import * as path from 'path';
import { minimatch } from 'minimatch';

/**
 * Default exclusion patterns for common non-source directories and files.
 * These are always excluded from the cosmos visualization.
 */
const SMART_DEFAULTS = [
  '**/node_modules',
  '**/.git',
  '**/dist',
  '**/build',
  '**/out',
  '**/.next',
  '**/__pycache__',
  '**/.env',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  // Code Cosmos's own per-project files — MUST be excluded.
  // Without this, writing .cosmos.cache changes its own size/mtime, which the
  // next fingerprint check would detect as "files changed", invalidating the
  // cache on every single load (a self-invalidating loop). They'd also show
  // up as JSON "planets" in the cosmos itself, which makes no sense.
  '**/.cosmos',
  '**/.cosmos.cache',
];

/**
 * Loads and parses the .cosmosignore file from the workspace root.
 *
 * @param workspaceRoot - The absolute path to the workspace root.
 * @returns A promise resolving to an array of glob patterns to exclude.
 */
async function loadCosmosIgnore(workspaceRoot: string): Promise<string[]> {
  try {
    const ignorePath = vscode.Uri.file(path.join(workspaceRoot, '.cosmosignore'));
    const raw = await vscode.workspace.fs.readFile(ignorePath);
    return Buffer.from(raw)
      .toString('utf8')
      .split('\n')
      .map((line: string) => line.trim())
      .filter((line: string) => line && !line.startsWith('#'))
      .map((line) => {
        // Ensure glob pattern works as expected
        if (line.startsWith('/') || line.startsWith('./')) {
          return line.replace(/^(\.\/|\/)/, '**/');
        }
        if (!line.includes('*') && !line.includes('/')) {
          return `**/${line}`;
        }
        return line;
      });
  } catch {
    return [];
  }
}

/**
 * Builds the complete list of exclusion patterns by combining smart defaults and user overrides.
 *
 * @param workspaceRoot - The absolute path to the workspace root.
 * @returns A promise resolving to the full array of glob patterns.
 */
export async function buildExclusionList(workspaceRoot: string): Promise<string[]> {
  const userExclusions = await loadCosmosIgnore(workspaceRoot);
  return [...SMART_DEFAULTS, ...userExclusions];
}

/**
 * Checks if a given file path should be excluded based on the provided patterns.
 *
 * @param filePath - The path of the file to check.
 * @param exclusions - Array of glob patterns to check against.
 * @returns True if the path matches any exclusion pattern.
 */
export function shouldExclude(filePath: string, exclusions: string[]): boolean {
  // Normalize filePath to use forward slashes for minimatch
  const normalizedPath = filePath.replace(/\\/g, '/');

  return exclusions.some((pattern) =>
    minimatch(normalizedPath, pattern, { dot: true, matchBase: true })
  );
}
