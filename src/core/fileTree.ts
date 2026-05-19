// src/core/fileTree.ts

import * as vscode from 'vscode';
import * as path from 'path';
import { CosmosData, CosmosFile, CosmosFolder, FileType } from '../types';
import { buildExclusionList, shouldExclude } from './exclusionManager';
import { logger } from '../utils/logger';
import {
  parseDependencies,
  computeIndirectDependencies,
  detectCircularDependencies,
  computeLayer3Dependencies,
  dedupeDependencies,
} from './dependencyParser';

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

function normalizeRelativeId(workspaceRoot: string, targetPath: string): string {
  return path.relative(workspaceRoot, targetPath).replace(/\\/g, '/') || '.';
}

function ensureFolder(
  data: CosmosData,
  folderId: string,
  name: string,
  folderPath: string,
  relativePath: string,
  parentFolderId: string | null,
  offset?: { x: number; y: number; z: number }
): CosmosFolder {
  if (!data.folders[folderId]) {
    data.folders[folderId] = {
      id: folderId,
      name,
      path: folderPath,
      relativePath,
      parentId: parentFolderId,
      fileIds: [],
      childFolderIds: [],
      ...(offset ? { offset } : {}),
    };
  }

  if (parentFolderId && data.folders[parentFolderId]) {
    const parent = data.folders[parentFolderId];
    if (!parent.childFolderIds.includes(folderId)) {
      parent.childFolderIds.push(folderId);
    }
  }

  return data.folders[folderId];
}

async function traverseDirectory(
  dirUri: vscode.Uri,
  workspaceRoot: string,
  exclusions: string[],
  data: CosmosData,
  parentFolderId: string | null,
  visitedPaths: Set<string> = new Set()
): Promise<void> {
  const currentPath = path.resolve(dirUri.fsPath);

  if (visitedPaths.has(currentPath)) {
    logger.warn(`Skipping already visited path (possible symlink loop): ${currentPath}`);
    return;
  }
  visitedPaths.add(currentPath);

  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(dirUri);
  } catch (err) {
    logger.warn(`Unable to read directory ${dirUri.fsPath}: ${err}`);
    return;
  }

  const relativePath = normalizeRelativeId(workspaceRoot, dirUri.fsPath);
  const folderId = relativePath;

  const currentFolder = ensureFolder(
    data,
    folderId,
    path.basename(dirUri.fsPath) || path.basename(workspaceRoot) || workspaceRoot,
    dirUri.fsPath,
    relativePath,
    parentFolderId
  );

  for (const [name, fileType] of entries) {
    const entryUri = vscode.Uri.joinPath(dirUri, name);
    const entryRelative = normalizeRelativeId(workspaceRoot, entryUri.fsPath);

    if (shouldExclude(entryRelative, exclusions)) {
      logger.log(`Excluding: ${entryRelative}`);
      continue;
    }

    if (fileType === vscode.FileType.Directory) {
      await traverseDirectory(entryUri, workspaceRoot, exclusions, data, folderId, visitedPaths);
      continue;
    }

    if (fileType !== vscode.FileType.File) {
      continue;
    }

    const extension = path.extname(name).replace(/^\./, '');
    let stat: vscode.FileStat;

    try {
      stat = await vscode.workspace.fs.stat(entryUri);
    } catch (err) {
      logger.warn(`Unable to stat file ${entryRelative}: ${err}`);
      continue;
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
    currentFolder.fileIds.push(entryRelative);
    logger.log(`Found file: ${entryRelative}`);
  }
}

export async function buildFileTree(
  workspaceFolder: vscode.WorkspaceFolder,
  offset: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }
): Promise<CosmosData> {
  const workspaceRoot = workspaceFolder.uri.fsPath;
  const workspaceName = workspaceFolder.name || path.basename(workspaceRoot) || 'workspace';
  logger.log(`Building file tree for: ${workspaceRoot}`);

  const exclusions = await buildExclusionList(workspaceRoot);

  const data: CosmosData = {
    files: {},
    folders: {},
    dependencies: [],
    rootFolderId: '.',
    workspaceRoots: {
      [workspaceName]: workspaceRoot,
    },
  };

  ensureFolder(
    data,
    '.',
    path.basename(workspaceRoot) || workspaceName,
    workspaceRoot,
    '.',
    null,
    offset
  );

  await traverseDirectory(workspaceFolder.uri, workspaceRoot, exclusions, data, null, new Set());

  logger.log('File tree structural mapping complete. Starting dependency resolution pass...');
  const directDeps = await parseDependencies(data);
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
  logger.log(
    `File tree built: ${Object.keys(data.files).length} files, ${Object.keys(data.folders).length} folders, ${data.dependencies.length} connections mapped.`
  );

  return data;
}

