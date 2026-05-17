// src/core/fileTree.ts

import * as vscode from 'vscode';
import * as path from 'path';
import { CosmosData, CosmosFile, CosmosFolder, FileType } from '../types';
import { buildExclusionList, shouldExclude } from './exclusionManager';
import { logger } from '../utils/logger';
import { parseDependencies } from './dependencyParser';

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
  parentFolderId: string | null
): Promise<void> {
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
      // Cleaned up: Just handle the recursion here. Don't parse dependencies mid-flight.
      await traverseDirectory(entryUri, workspaceRoot, exclusions, data, folderId);
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

export async function buildFileTree(): Promise<CosmosData> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    throw new Error('No workspace folder open');
  }

  const workspaceRoot = workspaceFolders[0].uri.fsPath;
  logger.log(`Building file tree for: ${workspaceRoot}`);

  const exclusions = await buildExclusionList(workspaceRoot);
  logger.log(`Exclusions loaded: ${exclusions.join(', ')}`);

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
  };

  // 1. First, build the complete file map structure
  await traverseDirectory(workspaceFolders[0].uri, workspaceRoot, exclusions, data, null);

  // 2. NOW, parse dependencies exactly once since all files exist in memory! ✅
  logger.log('File tree structural mapping complete. Starting dependency resolution pass...');
  const dependencies = await parseDependencies(data);
  data.dependencies = dependencies;

  logger.log(
    `File tree built: ${Object.keys(data.files).length} files, ${Object.keys(data.folders).length} folders, ${data.dependencies.length} connections mapped.`
  );

  return data;
}
