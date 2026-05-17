// src/core/fileTree.ts

import * as vscode from 'vscode';
import * as path from 'path';
import { CosmosData, CosmosFile, CosmosFolder, FileType } from '../types';
import { buildExclusionList, shouldExclude } from './exclusionManager';
import { logger } from '../utils/logger';
import { parseDependencies, computeIndirectDependencies, detectCircularDependencies, computeLayer3Dependencies } from './dependencyParser';

function getFileType(extension: string): FileType {
  switch (extension.toLowerCase()) {
    case 'ts':
    case 'tsx':
      return FileType.TS;
    case 'js':
    case 'jsx':
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
    case 'woff':
    case 'woff2':
    case 'ttf':
      return FileType.ASSET;
    default:
      return FileType.OTHER;
  }
}

async function traverseDirectory(
  dirUri: vscode.Uri,
  workspaceRoot: string,
  exclusions: string[],
  data: CosmosData,
  parentFolderId: string | null,
  visitedPaths: Set<string> = new Set() // add this
): Promise<void> {

  // Prevent infinite loops from symlinks
  const realPath = dirUri.fsPath;
  if (visitedPaths.has(realPath)) {
    logger.warn(`Skipping already visited path (possible symlink loop): ${realPath}`);
    return;
  }
  visitedPaths.add(realPath);

  const entries = await vscode.workspace.fs.readDirectory(dirUri);

  const relativePath = path.relative(workspaceRoot, dirUri.fsPath) || '.';
  const folderId = relativePath;

  if (!data.folders[folderId]) {
    const folder: CosmosFolder = {
      id: folderId,
      name: path.basename(dirUri.fsPath) || workspaceRoot,
      path: dirUri.fsPath,
      relativePath,
      parentId: parentFolderId,
      fileIds: [],
      childFolderIds: [],
    };
    data.folders[folderId] = folder;

    if (parentFolderId && data.folders[parentFolderId]) {
      data.folders[parentFolderId].childFolderIds.push(folderId);
    }
  }

  for (const [name, fileType] of entries) {
    const entryUri = vscode.Uri.joinPath(dirUri, name);
    const entryRelative = path.relative(workspaceRoot, entryUri.fsPath);

    if (shouldExclude(entryRelative, exclusions)) {
      logger.log(`Excluding: ${entryRelative}`);
      continue;
    }

    if (fileType === vscode.FileType.Directory) {
      await traverseDirectory(
        entryUri,
        workspaceRoot,
        exclusions,
        data,
        folderId,
        visitedPaths
      );
    } else if (fileType === vscode.FileType.File) {
      const extension = name.includes('.') ? name.split('.').pop() || '' : '';
      const stat = await vscode.workspace.fs.stat(entryUri);

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
      data.folders[folderId].fileIds.push(entryRelative);
      logger.log(`Found file: ${entryRelative}`);
    }
  }
}

export async function buildFileTree(
  workspaceFolder: vscode.WorkspaceFolder,
  offset: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }
): Promise<CosmosData> {
  const workspaceRoot = workspaceFolder.uri.fsPath;
  logger.log(`Building file tree for: ${workspaceRoot}`);

  const exclusions = await buildExclusionList(workspaceRoot);

  const data: CosmosData = {
    files: {},
    folders: {},
    dependencies: [],
    rootFolderId: '.',
  };

  data.folders['.'] = {
    id: '.',
    name: path.basename(workspaceRoot),
    path: workspaceRoot,
    relativePath: '.',
    parentId: null,
    fileIds: [],
    childFolderIds: [],
    offset,
  };

  await traverseDirectory(
    workspaceFolder.uri,
    workspaceRoot,
    exclusions,
    data,
    null,
    new Set()
  );

  // 2. NOW, parse dependencies exactly once since all files exist in memory!
  logger.log('File tree structural mapping complete. Starting dependency resolution pass...');
  const directDeps = await parseDependencies(data);
  const indirectDeps = computeIndirectDependencies(directDeps);
  const circularDeps = detectCircularDependencies(directDeps);
  const layer3Deps = computeLayer3Dependencies(directDeps);

  data.dependencies = [
    ...directDeps,
    ...indirectDeps,
    ...circularDeps,
    ...layer3Deps,
  ];

  logger.log(
    `Direct: ${directDeps.length}, Indirect: ${indirectDeps.length}, Circular: ${circularDeps.length}, Layer3: ${layer3Deps.length}, Total: ${data.dependencies.length}`
  );
  logger.log(
    `File tree built: ${Object.keys(data.files).length} files, ${Object.keys(data.folders).length} folders, ${data.dependencies.length} connections mapped.`
  );

  return data;
}
