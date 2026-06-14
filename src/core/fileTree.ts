// src/core/fileTree.ts

import * as vscode from 'vscode';
import * as path from 'path';
import pLimit from 'p-limit';
import { CosmosData, CosmosFile, CosmosFolder, FileType, StarNode } from '../types';
import { buildExclusionList, shouldExclude } from './exclusionManager';
import { logger } from '../utils/logger';
import {
  parseDependencies,
  computeIndirectDependencies,
  detectCircularDependencies,
  computeLayer3Dependencies,
  dedupeDependencies,
} from './dependencyParser';
import { readGitData } from './gitReader';
import { ProgressCallback, noopProgress } from './progress';

function getFileType(extension: string): FileType {
  switch (extension.toLowerCase()) {
    case 'ts':
    case 'tsx':
      return FileType.TS;
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return FileType.JS;
    case 'html':
      return FileType.HTML;
    case 'css':
    case 'scss':
    case 'sass':
      return FileType.CSS;
    case 'py':
      return FileType.PY;
    case 'java':
      return FileType.JAVA;
    // New languages — map to closest existing FileType
    case 'rs':
      return FileType.RUST;
    case 'go':
      return FileType.GO;
    case 'c':
    case 'cpp':
    case 'cc':
    case 'cxx':
    case 'h':
    case 'hpp':
      return FileType.CPP;
    case 'rb':
      return FileType.RUBY;
    case 'php':
      return FileType.PHP;
    case 'swift':
      return FileType.SWIFT;
    case 'kt':
    case 'kts':
      return FileType.KOTLIN;
    case 'vue':
      return FileType.VUE;
    case 'svelte':
      return FileType.SVELTE;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'ico':
    case 'webp':
    case 'woff':
    case 'woff2':
    case 'ttf':
      return FileType.ASSET;
    default:
      return FileType.OTHER;
  }
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

async function traverseDirectory(
  dirUri: vscode.Uri,
  workspaceRoot: string,
  exclusions: string[],
  data: CosmosData,
  parentFolderId: string | null,
  visitedPaths: Set<string> = new Set()
): Promise<void> {
  const realPath = path.resolve(dirUri.fsPath);
  if (visitedPaths.has(realPath)) {
    logger.warn(`Skipping symlink loop: ${realPath}`);
    return;
  }
  visitedPaths.add(realPath);

  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(dirUri);
  } catch (err) {
    logger.warn(`Cannot read directory ${dirUri.fsPath}: ${err}`);
    return;
  }

  const relativePath = normalizePath(path.relative(workspaceRoot, dirUri.fsPath)) || '.';
  const folderId = relativePath;

  if (!data.folders[folderId]) {
    const folder: CosmosFolder = {
      id: folderId,
      name: path.basename(dirUri.fsPath) || path.basename(workspaceRoot),
      path: dirUri.fsPath,
      relativePath,
      parentId: parentFolderId,
      fileIds: [],
      childFolderIds: [],
    };
    data.folders[folderId] = folder;

    if (parentFolderId && data.folders[parentFolderId]) {
      const parent = data.folders[parentFolderId];
      if (!parent.childFolderIds.includes(folderId)) {
        parent.childFolderIds.push(folderId);
      }
    }
  }

  const limit = pLimit(10);
  const tasks = entries.map(([name, fileType]) => {
    return limit(async () => {
      const entryUri = vscode.Uri.joinPath(dirUri, name);
      const entryRelative = normalizePath(path.relative(workspaceRoot, entryUri.fsPath));

      if (shouldExclude(entryRelative, exclusions)) {
        logger.log(`Excluding: ${entryRelative}`);
        return;
      }

      if (fileType === vscode.FileType.Directory) {
        await traverseDirectory(entryUri, workspaceRoot, exclusions, data, folderId, visitedPaths);
        return;
      }

      if (fileType !== vscode.FileType.File) {
        return;
      }

      const extension = path.extname(name).replace(/^\./, '');
      let stat: vscode.FileStat;
      try {
        stat = await vscode.workspace.fs.stat(entryUri);
      } catch {
        return;
      }

      const file: CosmosFile = {
        id: entryRelative,
        name,
        path: entryUri.fsPath,
        relativePath: entryRelative,
        extension,
        type: getFileType(extension),
        size: stat.size,
        folderId,
      };

      data.files[entryRelative] = file;
      // Note: pushing to shared array in parallel is safe in JS/TS as it's single-threaded,
      // but we should be careful with order if it mattered (it doesn't here).
      data.folders[folderId].fileIds.push(entryRelative);
      logger.log(`Found file: ${entryRelative}`);
    });
  });

  await Promise.all(tasks);
}

// Calculates orbital radius based on depth
function getRadiusForDepth(depth: number): number {
  // Base radius at depth 1 — distance from central sun to top level folders
  const BASE_RADIUS = 350;
  // Each level is 55% of the previous
  const FALLOFF = 0.55;
  // Minimum so deep folders still have breathing room
  const MIN_RADIUS = 25;

  return Math.max(MIN_RADIUS, BASE_RADIUS * Math.pow(FALLOFF, depth - 1));
}

function goldenAngleOffset(
  index: number,
  total: number,
  radius: number,
  parentPosition: { x: number; y: number; z: number }
): { x: number; y: number; z: number } {
  // For single child — place directly above parent, not random
  if (total === 1) {
    return {
      x: parentPosition.x,
      y: parentPosition.y + radius,
      z: parentPosition.z,
    };
  }

  const phi = Math.acos(1 - (2 * (index + 0.5)) / Math.max(total, 1));
  const theta = Math.PI * (1 + Math.sqrt(5)) * index;
  return {
    x: parentPosition.x + radius * Math.sin(phi) * Math.cos(theta),
    y: parentPosition.y + radius * Math.sin(phi) * Math.sin(theta),
    z: parentPosition.z + radius * Math.cos(phi),
  };
}

function countSubtreeFiles(folderId: string, folders: Record<string, CosmosFolder>): number {
  const folder = folders[folderId];
  if (!folder) {
    return 0;
  }

  const directFiles = folder.fileIds.length;
  const childFiles = folder.childFolderIds.reduce(
    (sum, childId) => sum + countSubtreeFiles(childId, folders),
    0
  );

  return directFiles + childFiles;
}
export function buildStarTree(
  folderId: string,
  folders: Record<string, CosmosFolder>,
  parentPosition: { x: number; y: number; z: number },
  depth: number,
  childIndex: number,
  totalChildren: number
): StarNode {
  const radius = getRadiusForDepth(depth);

  const position =
    depth === 0
      ? { x: 0, y: 0, z: 0 }
      : goldenAngleOffset(childIndex, totalChildren, radius, parentPosition);

  const subtreeFileCount = countSubtreeFiles(folderId, folders);

  const folder = folders[folderId];
  if (!folder) {
    return { folderId, position, depth, childNodes: [], subtreeFileCount };
  }

  const childNodes = folder.childFolderIds.map((childId, i) =>
    buildStarTree(childId, folders, position, depth + 1, i, folder.childFolderIds.length)
  );

  return { folderId, position, depth, childNodes, subtreeFileCount };
}

export async function buildFileTree(
  workspaceFolder: vscode.WorkspaceFolder,
  offset: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
  onProgress: ProgressCallback = noopProgress
): Promise<CosmosData> {
  const workspaceRoot = workspaceFolder.uri.fsPath;
  const workspaceName = workspaceFolder.name || path.basename(workspaceRoot);
  logger.log(`Building file tree for: ${workspaceRoot}`);

  const exclusions = await buildExclusionList(workspaceRoot);

  const data: CosmosData = {
    files: {},
    folders: {},
    dependencies: [],
    rootFolderId: '.',
    workspaceRoots: { [workspaceName]: workspaceRoot },
    starTree: null,
    gitData: null,
  };

  data.folders['.'] = {
    id: '.',
    name: path.basename(workspaceRoot) || workspaceName,
    path: workspaceRoot,
    relativePath: '.',
    parentId: null,
    fileIds: [],
    childFolderIds: [],
    offset,
  };

  onProgress('scan', 0, 1);
  await traverseDirectory(workspaceFolder.uri, workspaceRoot, exclusions, data, null, new Set());
  onProgress('scan', 1, 1);

  logger.log('File tree complete. Parsing dependencies...');
  const directDeps = await parseDependencies(data, workspaceRoot, onProgress);
  const indirectDeps = computeIndirectDependencies(directDeps);
  const circularDeps = detectCircularDependencies(directDeps);
  const layer3Deps = computeLayer3Dependencies(directDeps);

  data.dependencies = dedupeDependencies([
    ...directDeps,
    ...indirectDeps,
    ...circularDeps,
    ...layer3Deps,
  ]);

  logger.log(
    `Direct: ${directDeps.length}, Indirect: ${indirectDeps.length}, Circular: ${circularDeps.length}, Layer3: ${layer3Deps.length}, Total: ${data.dependencies.length}`
  );

  data.starTree = buildStarTree('.', data.folders, { x: 0, y: 0, z: 0 }, 0, 0, 1);
  logger.log('Star tree built');

  // Read git data after file tree is built
  logger.log('Reading git data...');
  data.gitData = await readGitData(workspaceRoot, Object.keys(data.files), onProgress);

  return data;
}
