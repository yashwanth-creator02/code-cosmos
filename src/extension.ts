// src/extension.ts

import * as vscode from 'vscode';
import { initLogger, logger } from './utils/logger';
import { buildFileTree } from './core/fileTree';
import { CosmosPanel } from './panel/CosmosPanel';

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

        // Build the file tree
        const data = await buildFileTree();
        const fileCount = Object.keys(data.files).length;
        const folderCount = Object.keys(data.folders).length;
        logger.log(`Scan complete: ${fileCount} files, ${folderCount} folders`);

        // Open or reveal the panel
        const panel = CosmosPanel.createOrShow(context.extensionUri);

        // Send data to the webview
        panel.sendMessage({ type: 'LOAD_UNIVERSE', payload: data });

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
