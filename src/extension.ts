// src/extension.ts

import * as vscode from 'vscode';
import { initLogger, logger } from './utils/logger';
import { buildFileTree } from './core/fileTree';
import { CosmosPanel } from './panel/CosmosPanel';
import { CosmosData } from './types';

export function activate(context: vscode.ExtensionContext) {
  initLogger(context);
  console.log('ACTIVATE FIRED');
  logger.log('Code Cosmos is active');

  const disposable = vscode.commands.registerCommand(
    'code-cosmos.openCosmos',
    async () => {
      try {
        logger.log('openCosmos command fired');
        vscode.window.showInformationMessage('Code Cosmos: Scanning repository...');

        const workspaceFolders = vscode.workspace.workspaceFolders || [];

        if (workspaceFolders.length === 0) {
          vscode.window.showWarningMessage(
            'Code Cosmos: No workspace folder is open. Open a folder first.'
          );
          return;
        }

        // Space galaxies apart — 2000 units between each
        const GALAXY_SPACING = 2000;
        const allData: CosmosData = {
          files: {},
          folders: {},
          dependencies: [],
          rootFolderId: '.',
        };

        for (let i = 0; i < workspaceFolders.length; i++) {
          const offset = {
            x: (i - (workspaceFolders.length - 1) / 2) * GALAXY_SPACING,
            y: 0,
            z: 0,
          };

          const data = await buildFileTree(workspaceFolders[i], offset);

          // Merge into allData with namespace prefix to avoid ID conflicts
          const prefix = workspaceFolders[i].name + ':';

          for (const [id, file] of Object.entries(data.files)) {
            allData.files[prefix + id] = {
              ...file,
              id: prefix + id,
              folderId: prefix + file.folderId,
            };
          }

          for (const [id, folder] of Object.entries(data.folders)) {
            allData.folders[prefix + id] = {
              ...folder,
              id: prefix + id,
              parentId: folder.parentId ? prefix + folder.parentId : null,
              fileIds: folder.fileIds.map(fid => prefix + fid),
              childFolderIds: folder.childFolderIds.map(cid => prefix + cid),
            };
          }

          allData.dependencies.push(
            ...data.dependencies.map(dep => ({
              ...dep,
              sourceId: prefix + dep.sourceId,
              targetId: prefix + dep.targetId,
            }))
          );

          if (i === 0) {
            allData.rootFolderId = prefix + '.';
          }
        }

        const fileCount = Object.keys(allData.files).length;
        const folderCount = Object.keys(allData.folders).length;
        const LARGE_REPO_THRESHOLD = 500;
        const VERY_LARGE_REPO_THRESHOLD = 1000;

        logger.log(`Scan complete: ${fileCount} files, ${folderCount} folders`);

        // Handle empty workspace
        if (fileCount === 0) {
          vscode.window.showWarningMessage(
            'Code Cosmos: No files found in this workspace. ' +
            'Check your .cosmosignore or try opening a different folder.'
          );
          return;
        }

        // Handle the vast repos
        if (fileCount > VERY_LARGE_REPO_THRESHOLD) {
          const choice = await vscode.window.showWarningMessage(
            `Code Cosmos: This repo has ${fileCount} files. ` +
            'Rendering may be slow. Continue?',
            'Continue',
            'Cancel'
          );
          if (choice !== 'Continue') { return; }
        } else if (fileCount > LARGE_REPO_THRESHOLD) {
          vscode.window.showInformationMessage(
            `Code Cosmos: Large repo detected (${fileCount} files). ` +
            'Performance mode recommended — consider adding folders to .cosmosignore.'
          );
        }

        // Handle workspace with only one folder and no files
        if (fileCount < 3) {
          vscode.window.showInformationMessage(
            `Code Cosmos: Only ${fileCount} file(s) found. ` +
            'The universe may look sparse — this works best with larger projects.'
          );
        }

        // Open or reveal the panel
        const panel = CosmosPanel.createOrShow(context.extensionUri);

        // Send data to the webview
        panel.sendMessage({ type: 'LOAD_UNIVERSE', payload: allData });

        vscode.window.showInformationMessage(
          `Code Cosmos: Found ${fileCount} files across ${folderCount} folders`
        );
      } catch (err) {
        logger.error(`openCosmos failed: ${err}`);
        vscode.window.showErrorMessage(`Code Cosmos error: ${err}`);
      }
    }
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {
  logger.log('Code Cosmos deactivated');
}
