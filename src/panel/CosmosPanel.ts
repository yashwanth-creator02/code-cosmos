// src/panel/CosmosPanel.ts

import * as vscode from 'vscode';
import { logger } from '../utils/logger';

export class CosmosPanel {
  private static instance: CosmosPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;

    this.panel.webview.html = this.getHtmlContent();

    this.panel.onDidDispose(() => this.dispose());

    this.panel.webview.onDidReceiveMessage(async (message: any) => {
      logger.log('Message received from webview', message);

      if (message.type === 'OPEN_FILE') {
        const fileId = message.payload.fileId;
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        if (!workspaceRoot) { return; }

        const fullPath = vscode.Uri.file(
          require('path').join(workspaceRoot, fileId)
        );
        await vscode.window.showTextDocument(fullPath, {
          viewColumn: vscode.ViewColumn.Beside,
          preserveFocus: true
        });
        logger.log(`Opened file: ${fileId}`);
      }
    });
  }

  public static createOrShow(extensionUri: vscode.Uri): CosmosPanel {
    if (CosmosPanel.instance) {
      CosmosPanel.instance.panel.reveal();
      logger.log('CosmosPanel already exists, revealing');
      return CosmosPanel.instance;
    }

    const panel = vscode.window.createWebviewPanel(
      'codeCosmos',
      'Code Cosmos',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'out')],
      }
    );

    logger.log('CosmosPanel created');
    CosmosPanel.instance = new CosmosPanel(panel, extensionUri);
    return CosmosPanel.instance;
  }

  public sendMessage(message: unknown): void {
    this.panel.webview.postMessage(message);
    logger.log('CosmosPanel.sendMessage', message);
  }

  private getHtmlContent(): string {
    const scriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'out', 'webview', 'main.js')
    );

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta http-equiv="Content-Security-Policy"
            content="
              default-src 'none';
              style-src ${this.panel.webview.cspSource} 'unsafe-inline';
              script-src ${this.panel.webview.cspSource};
              "
            >
          <style>
            html, body {
              width: 100%;
              height: 100%;
              margin: 0;
              padding: 0;
              background: black;
              overflow: hidden;
            }
          </style>
        </head>
        <body>
          <canvas id="cosmos-canvas" style="width:100%;height:100%;display:block;"></canvas>
          <div id="tooltip" style="
            position: fixed;
            display: none;
            background: rgba(0,0,0,0.85);
            border: 1px solid rgba(255,255,255,0.2);
            color: white;
            padding: 10px 14px;
            border-radius: 6px;
            font-family: sans-serif;
            font-size: 12px;
            pointer-events: none;
            z-index: 100;
            line-height: 1.6;
          "></div>
          <script src="${scriptUri}"></script>
        </body>
      </html>
    `;
  }

  private dispose(): void {
    CosmosPanel.instance = undefined;
    this.panel.dispose();
    logger.log('CosmosPanel disposed');
  }
}
