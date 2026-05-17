// src/panel/CosmosPanel.ts

import * as vscode from 'vscode';
import { logger } from '../utils/logger';

export class CosmosPanel {
  private static instance: CosmosPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private lastData: unknown = null;


  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;

    this.panel.webview.html = this.getHtmlContent();

    this.panel.onDidDispose(() => this.dispose());

    this.panel.onDidChangeViewState((e) => {
      if (e.webviewPanel.visible && this.lastData) {
        this.panel.webview.postMessage(this.lastData);
        logger.log('Panel became visible — resending universe data');
      }
    });

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
        retainContextWhenHidden: true,
      }
    );

    logger.log('CosmosPanel created');
    CosmosPanel.instance = new CosmosPanel(panel, extensionUri);
    return CosmosPanel.instance;
  }

  public sendMessage(message: any): void {
    this.panel.webview.postMessage(message);
    if (message.type === 'LOAD_UNIVERSE') {
      this.lastData = message;
    }
    logger.log('CosmosPanel.sendMessage', message.type);
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
          <button id="help-button" style="
            position: fixed;
            top: 20px;
            right: 70px;
            background: rgba(0,0,0,0.85);
            border: 1px solid rgba(255,255,255,0.2);
            color: white;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            font-family: sans-serif;
            font-size: 14px;
            cursor: pointer;
            z-index: 100;
          ">?</button>

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
            <div style="font-size:18px;font-weight:bold;margin-bottom:8px;">
              Code Cosmos
            </div>
            <div id="loading-text" style="
              font-size:13px;
              opacity:0.6;
            ">Scanning repository...</div>
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
          ">⟳ Reset View</button>\
          <div id="mode-indicator" style="
            position: fixed;
            bottom: 60px;
            right: 20px;
            background: rgba(0,0,0,0.85);
            border: 1px solid rgba(255,255,255,0.2);
            color: white;
            padding: 8px 14px;
            border-radius: 6px;
            font-family: sans-serif;
            font-size: 12px;
            opacity: 0;
            transition: opacity 0.3s;
            z-index: 100;
          "></div>

          <!-- Legend -->
          <div id="legend" style="
            position: fixed;
            bottom: 20px;
            left: 20px;
            background: rgba(0,0,0,0.85);
            border: 1px solid rgba(255,255,255,0.15);
            color: white;
            padding: 12px 16px;
            border-radius: 8px;
            font-family: sans-serif;
            font-size: 11px;
            z-index: 100;
            line-height: 1.8;
          ">
            <div style="font-weight:bold;margin-bottom:6px;opacity:0.6;font-size:10px;letter-spacing:1px;">DEPENDENCIES</div>
            <div><span style="color:#ffffff">⬤</span> Direct import</div>
            <div><span style="color:#4488ff">⬤</span> Indirect chain</div>
            <div><span style="color:#FFB300">⬤</span> Shared dependent</div>
            <div><span style="color:#00BCD4">⬤</span> Shared dependency</div>
            <div><span style="color:#FF1744">⬤</span> Circular — danger</div>
            <div style="margin-top:8px;font-weight:bold;opacity:0.6;font-size:10px;letter-spacing:1px;">OBJECTS</div>
            <div>⭐ Central sun — repository root</div>
            <div>🔆 Star — folder</div>
            <div>⬤ Planet — file</div>
          </div>

          <!-- Keyboard shortcuts panel -->
          <div id="shortcuts-panel" style="
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0,0,0,0.92);
            border: 1px solid rgba(255,255,255,0.2);
            color: white;
            padding: 24px 32px;
            border-radius: 12px;
            font-family: sans-serif;
            font-size: 13px;
            z-index: 200;
            display: none;
            min-width: 320px;
            line-height: 2;
          ">
            <div style="font-weight:bold;font-size:16px;margin-bottom:16px;">⌨ Keyboard Shortcuts</div>
            <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 16px;">
              <kbd style="opacity:0.6">/ or Ctrl+F</kbd><span>Search files</span>
              <kbd style="opacity:0.6">R</kbd><span>Reset camera view</span>
              <kbd style="opacity:0.6">F</kbd><span>Toggle spacecraft mode</span>
              <kbd style="opacity:0.6">W A S D</kbd><span>Fly in spacecraft mode</span>
              <kbd style="opacity:0.6">Q / E</kbd><span>Fly up / down</span>
              <kbd style="opacity:0.6">Shift</kbd><span>Speed boost in spacecraft</span>
              <kbd style="opacity:0.6">Click planet</kbd><span>Open file + focus mode</span>
              <kbd style="opacity:0.6">Click again</kbd><span>Exit focus mode</span>
              <kbd style="opacity:0.6">Escape</kbd><span>Exit focus / search</span>
              <kbd style="opacity:0.6">?</kbd><span>Toggle this panel</span>
            </div>
            <div style="margin-top:16px;opacity:0.4;font-size:11px;text-align:center;">Press ? or Escape to close</div>
          </div>
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
