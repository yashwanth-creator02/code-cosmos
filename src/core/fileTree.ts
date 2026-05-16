// src/core/fileTree.ts

import * as vscode from 'vscode';
import * as path from 'path';
import { CosmosData, CosmosFile, CosmosFolder, FileType } from '../types';
import { buildExclusionList, shouldExclude } from './exclusionManager';

function getFileType(extension: string): FileType {
  switch (extension.toLowerCase()) {
    case 'ts': case 'tsx': return FileType.TS;
    case 'js': case 'jsx': return FileType.JS;
    case 'html': return FileType.HTML;
    case 'css': case 'scss': case 'sass': return FileType.CSS;
    case 'py': return FileType.PY;
    case 'java': return FileType.JAVA;
    case 'png': case 'jpg': case 'jpeg':
    case 'gif': case 'svg': case 'ico':
    case 'woff': case 'woff2': case 'ttf': return FileType.ASSET;
    default: return FileType.OTHER;
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

  // Register this folder if not already root
  if (!data.folders[folderId]) {
    const folder: CosmosFolder = {
      id: folderId,
      name: path.basename(dirUri.fsPath) || workspaceRoot,
      path: dirUri.fsPath,
      relativePath,
      parentId: parentFolderId,
      fileIds: [],
      childFolderIds: []
    };
    data.folders[folderId] = folder;

    if (parentFolderId && data.folders[parentFolderId]) {
      data.folders[parentFolderId].childFolderIds.push(folderId);
    }
  }

  for (const [name, fileType] of entries) {
    const entryUri = vscode.Uri.joinPath(dirUri, name);
    const entryRelative = path.relative(workspaceRoot, entryUri.fsPath);

    if (shouldExclude(entryRelative, exclusions)) continue;

    if (fileType === vscode.FileType.Directory) {
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
        folderId
      };

      data.files[entryRelative] = file;
      data.folders[folderId].fileIds.push(entryRelative);
    }
  }
}

export async function buildFileTree(): Promise<CosmosData> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    throw new Error('No workspace folder open');
  }

  const workspaceRoot = workspaceFolders[0].uri.fsPath;
  const exclusions = await buildExclusionList(workspaceRoot);

  const data: CosmosData = {
    files: {},
    folders: {},
    dependencies: [],
    rootFolderId: '.'
  };

  // Register root folder first
  data.folders['.'] = {
    id: '.',
    name: path.basename(workspaceRoot),
    path: workspaceRoot,
    relativePath: '.',
    parentId: null,
    fileIds: [],
    childFolderIds: []
  };

  await traverseDirectory(
    workspaceFolders[0].uri,
    workspaceRoot,
    exclusions,
    data,
    null
  );

  return data;
}