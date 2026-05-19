// src/panel/CosmosPanel.ts

import * as vscode from 'vscode';
import * as path from 'path';
import { CosmosData } from '../types';
import { logger } from '../utils/logger';

type LoadUniverseMessage = { type: 'LOAD_UNIVERSE'; payload: CosmosData };

type MessageFromWebview =
  | { type: 'READY' }
  | { type: 'OPEN_FILE'; payload: { fileId: string } };

export class CosmosPanel {
  private static instance: CosmosPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private lastLoadMessage: LoadUniverseMessage | null = null;
  private lastUniverseData: CosmosData | null = null;
  private isReady = false;
  private pendingMessage: LoadUniverseMessage | null = null;

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;

    this.panel.webview.html = this.getHtmlContent();
    this.panel.onDidDispose(() => this.dispose());

    this.panel.onDidChangeViewState((e) => {
      if (e.webviewPanel.visible && this.lastLoadMessage) {
        this.panel.webview.postMessage(this.lastLoadMessage);
        logger.log('Panel became visible — resending universe data');
      }
    });

    this.panel.webview.onDidReceiveMessage(async (message: MessageFromWebview) => {
      logger.log('Message received from webview', message.type);

      if (message.type === 'READY') {
        this.isReady = true;
        if (this.pendingMessage) {
          this.panel.webview.postMessage(this.pendingMessage);
          this.lastLoadMessage = this.pendingMessage;
          this.lastUniverseData = this.pendingMessage.payload;
          this.pendingMessage = null;
        }
        return;
      }

      if (message.type === 'OPEN_FILE') {
        await this.openFile(message.payload.fileId);
      }
    });
  }

  private async openFile(fileId: string): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders || [];
    if (workspaceFolders.length === 0) {
      return;
    }

    let workspaceRoot: string | undefined;
    let actualFileId = fileId;

    const colonIndex = fileId.indexOf(':');
    if (colonIndex >= 0) {
      const namespace = fileId.slice(0, colonIndex);
      actualFileId = fileId.slice(colonIndex + 1);
      workspaceRoot = this.lastUniverseData?.workspaceRoots?.[namespace];
    }

    if (!workspaceRoot) {
      workspaceRoot = workspaceFolders[0]?.uri.fsPath;
    }

    if (!workspaceRoot) {
      return;
    }

    const fullPath = vscode.Uri.file(path.join(workspaceRoot, actualFileId));
    await vscode.window.showTextDocument(fullPath, {
      viewColumn: vscode.ViewColumn.Beside,
      preserveFocus: true,
    });

    logger.log(`Opened file: ${actualFileId}`);
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
        retainContextWhenHidden: true,
      }
    );

    logger.log('CosmosPanel created');
    CosmosPanel.instance = new CosmosPanel(panel, extensionUri);
    return CosmosPanel.instance;
  }

  public sendMessage(message: LoadUniverseMessage): void {
    if (message.type === 'LOAD_UNIVERSE') {
      this.lastLoadMessage = message;
      this.lastUniverseData = message.payload;

      if (this.isReady) {
        this.panel.webview.postMessage(message);
      } else {
        this.pendingMessage = message;
      }
      return;
    }

    this.panel.webview.postMessage(message);
  }

  private dispose(): void {
    CosmosPanel.instance = undefined;
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
              connect-src ${this.panel.webview.cspSource};
            ">
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

          <div id="loading-overlay" style="
            position: fixed;
            top: 0; left: 0;
            width: 100%; height: 100%;
            background: black;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            font-family: sans-serif;
            color: white;
          ">
            <div id="loading-sun" style="
              width: 60px;
              height: 60px;
              border-radius: 50%;
              background: radial-gradient(circle, #fff5c0, #ffaa00, #ff4400);
              box-shadow: 0 0 40px #ffaa00, 0 0 80px #ff6600;
              animation: pulse 1.5s ease-in-out infinite;
              margin-bottom: 24px;
            "></div>
            <div style="font-size:18px;font-weight:bold;margin-bottom:8px;">Code Cosmos</div>
            <div id="loading-text" style="font-size:13px;opacity:0.6;">Scanning repository...</div>
          </div>

          <style>
            @keyframes pulse {
              0%, 100% { transform: scale(1); box-shadow: 0 0 40px #ffaa00, 0 0 80px #ff6600; }
              50% { transform: scale(1.15); box-shadow: 0 0 60px #ffaa00, 0 0 120px #ff6600; }
            }
          </style>

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

          <div id="search-container" style="
            position: fixed;
            top: 16px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 100;
            display: none;
          ">
            <input id="search-input" type="text" placeholder="Search files..." style="
              background: rgba(0,0,0,0.85);
              border: 1px solid rgba(255,255,255,0.3);
              color: white;
              padding: 8px 14px;
              border-radius: 6px;
              font-size: 13px;
              font-family: sans-serif;
              width: 280px;
              outline: none;
            "/>
            <div id="search-results" style="
              background: rgba(0,0,0,0.85);
              border: 1px solid rgba(255,255,255,0.15);
              border-top: none;
              border-radius: 0 0 6px 6px;
              max-height: 200px;
              overflow-y: auto;
              display: none;
            "></div>
          </div>

          <button id="reset-camera" style="
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: rgba(0,0,0,0.85);
            border: 1px solid rgba(255,255,255,0.2);
            color: white;
            padding: 8px 16px;
            border-radius: 6px;
            font-family: sans-serif;
            font-size: 12px;
            cursor: pointer;
            z-index: 100;
          ">⟳ Reset View</button>

          <button id="help-button" style="
            position: fixed;
            bottom: 20px;
            left: 20px;
            background: rgba(0,0,0,0.85);
            border: 1px solid rgba(255,255,255,0.2);
            color: white;
            padding: 8px 16px;
            border-radius: 6px;
            font-family: sans-serif;
            font-size: 12px;
            cursor: pointer;
            z-index: 100;
          ">? Help</button>

          <div id="shortcuts-panel" style="
            position: fixed;
            bottom: 60px;
            left: 20px;
            background: rgba(0,0,0,0.9);
            color: white;
            border: 1px solid rgba(255,255,255,0.15);
            padding: 12px 14px;
            border-radius: 8px;
            font-family: sans-serif;
            font-size: 12px;
            line-height: 1.7;
            display: none;
            z-index: 100;
          ">
            <strong>Shortcuts</strong><br>
            / or Ctrl+F: Search<br>
            R: Reset view<br>
            Esc: Exit focus / close panels
          </div>

          <script type="module" src="${scriptUri}"></script>
        </body>
      </html>
    `;
  }
}
