// src/core/exclusionManager.ts

import * as vscode from 'vscode';
import * as path from 'path';
import { Buffer } from 'buffer';
const SMART_DEFAULTS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '__pycache__',
  '.env',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
];

async function loadCosmosIgnore(workspaceRoot: string): Promise<string[]> {
  try {
    const ignorePath = vscode.Uri.file(path.join(workspaceRoot, '.cosmosignore'));
    const raw = await vscode.workspace.fs.readFile(ignorePath);
    return Buffer.from(raw)
      .toString('utf8')
      .split('\n')
      .map((line: string) => line.trim())
      .filter((line: string) => line && !line.startsWith('#'));
  } catch {
    return [];
  }
}

export async function buildExclusionList(workspaceRoot: string): Promise<string[]> {
  const userExclusions = await loadCosmosIgnore(workspaceRoot);
  return [...SMART_DEFAULTS, ...userExclusions];
}

export function shouldExclude(filePath: string, exclusions: string[]): boolean {
  const parts = filePath.split(/[\\/]/);
  return exclusions.some(
    (exclusion) => parts.some((part) => part === exclusion) || filePath.endsWith(exclusion)
  );
}
