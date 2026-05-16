// src/extension.ts

import * as vscode from 'vscode';
import { buildFileTree } from './core/fileTree';
import { initLogger, logger } from './utils/logger';
export function activate(context: vscode.ExtensionContext) {
  initLogger(context);
  logger.log('Code Cosmos is active');

  const disposable = vscode.commands.registerCommand(
    'code-cosmos.openCosmos',
    async () => {
      try {
        vscode.window.showInformationMessage('Code Cosmos: Scanning repository...');
        const data = await buildFileTree();

        const fileCount = Object.keys(data.files).length;
        const folderCount = Object.keys(data.folders).length;

        // Log to output panel
        const output = vscode.window.createOutputChannel('Code Cosmos');
        output.clear();
        output.appendLine(`Files found: ${fileCount}`);
        output.appendLine(`Folders found: ${folderCount}`);
        output.appendLine('---');
        output.appendLine(JSON.stringify(data, null, 2));
        output.show();

        vscode.window.showInformationMessage(
          `Code Cosmos: Found ${fileCount} files across ${folderCount} folders`
        );
      } catch (err: any) {
        vscode.window.showErrorMessage(`Code Cosmos error: ${err}`);
      }
    }
  );

  context.subscriptions.push(disposable);
}

export function deactivate() { }
