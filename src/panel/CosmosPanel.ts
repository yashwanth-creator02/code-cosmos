// src/panel/CosmosPanel.ts

import * as vscode from 'vscode';
import { CosmosData, SettingsState, DEFAULT_SETTINGS } from '../types';
import { logger } from '../utils/logger';

type LoadUniverseMessage = { type: 'LOAD_UNIVERSE'; payload: CosmosData };

type MessageFromWebview =
  | { type: 'READY' }
  | { type: 'OPEN_FILE'; payload: { fileId: string } }
  | { type: 'SAVE_SETTINGS'; payload: SettingsState }
  | { type: 'REFRESH' };

export class CosmosPanel {
  private static instance: CosmosPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly context: vscode.ExtensionContext;
  private lastLoadMessage: LoadUniverseMessage | null = null;
  private lastUniverseData: CosmosData | null = null;
  private isReady = false;
  private pendingMessage: LoadUniverseMessage | null = null;
  private pendingSettings: SettingsState | null = null;
  private disposeCallbacks: (() => void)[] = [];
  private onRefreshCallback: (() => Promise<void>) | null = null;

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    context: vscode.ExtensionContext
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.context = context;

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

      switch (message.type) {
        case 'READY':
          this.isReady = true;
          logger.log('Webview is ready');

          // Send pending settings first, then pending universe data
          if (this.pendingSettings) {
            this.panel.webview.postMessage({
              type: 'APPLY_SETTINGS',
              payload: this.pendingSettings,
            });
            this.pendingSettings = null;
            logger.log('Sent pending settings');
          }

          if (this.pendingMessage) {
            this.panel.webview.postMessage(this.pendingMessage);
            this.lastLoadMessage = this.pendingMessage;
            this.lastUniverseData = this.pendingMessage.payload;
            this.pendingMessage = null;
            logger.log('Sent pending LOAD_UNIVERSE');
          }
          break;

        case 'OPEN_FILE':
          await this.openFile(message.payload.fileId);
          break;

        case 'SAVE_SETTINGS':
          await this.context.globalState.update('cosmosSettings', message.payload);
          logger.log('Settings saved');
          break;

        case 'REFRESH':
          if (this.onRefreshCallback) {
            await this.onRefreshCallback();
          }
          break;
      }
    });
  }

  private async openFile(fileId: string): Promise<void> {
    const file = this.lastUniverseData?.files[fileId];
    if (!file) {
      logger.warn(`Ignoring open request for unknown file: ${fileId}`);
      return;
    }

    const fullPath = vscode.Uri.file(file.path);
    await vscode.window.showTextDocument(fullPath, {
      viewColumn: vscode.ViewColumn.Beside,
      preserveFocus: true,
    });

    logger.log(`Opened file: ${file.relativePath}`);
  }

  public static createOrShow(
    extensionUri: vscode.Uri,
    context: vscode.ExtensionContext
  ): CosmosPanel {
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
    CosmosPanel.instance = new CosmosPanel(panel, extensionUri, context);
    return CosmosPanel.instance;
  }

  public sendMessage(message: LoadUniverseMessage): void {
    if (message.type === 'LOAD_UNIVERSE') {
      this.lastLoadMessage = message;
      this.lastUniverseData = message.payload;

      if (this.isReady) {
        this.panel.webview.postMessage(message);
        logger.log('CosmosPanel.sendMessage LOAD_UNIVERSE (immediate)');
      } else {
        this.pendingMessage = message;
        logger.log('CosmosPanel.sendMessage LOAD_UNIVERSE (queued)');
      }
      return;
    }

    this.panel.webview.postMessage(message);
  }

  public getSavedSettings(): SettingsState {
    return this.context.globalState.get<SettingsState>(
      'cosmosSettings',
      DEFAULT_SETTINGS
    );
  }

  public sendSettings(settings: SettingsState): void {
    if (this.isReady) {
      this.panel.webview.postMessage({ type: 'APPLY_SETTINGS', payload: settings });
      logger.log('Settings sent to webview immediately');
    } else {
      this.pendingSettings = settings;
      logger.log('Settings queued — waiting for READY');
    }
  }

  public onDispose(callback: () => void): void {
    this.disposeCallbacks.push(callback);
  }

  private dispose(): void {
    this.disposeCallbacks.forEach(cb => cb());
    CosmosPanel.instance = undefined;
    logger.log('CosmosPanel disposed');
  }

  public setRefreshCallback(callback: () => Promise<void>): void {
    this.onRefreshCallback = callback;
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

          <!-- Loading overlay -->
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

          <!-- Tooltip -->
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

          <!-- Search -->
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

          <!-- Reset button -->
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

          <!-- Settings button -->
          <button id="settings-btn" style="
            position: fixed;
            bottom: 20px;
            right: 130px;
            background: rgba(0,0,0,0.85);
            border: 1px solid rgba(255,255,255,0.2);
            color: white;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            font-size: 14px;
            cursor: pointer;
            z-index: 100;
          ">⚙</button>

          <!-- Help button -->
          <button id="help-button" style="
            position: fixed;
            bottom: 20px;
            right: 170px;
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

          <!-- Mode indicator -->
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

          <!-- Settings Panel -->
          <div id="settings-panel" style="
            position: fixed;
            top: 50%;
            right: 20px;
            transform: translateY(-50%);
            background: rgba(0,0,0,0.92);
            border: 1px solid rgba(255,255,255,0.15);
            color: white;
            padding: 16px;
            border-radius: 10px;
            font-family: sans-serif;
            font-size: 12px;
            z-index: 200;
            display: none;
            width: 220px;
            line-height: 2;
          ">
            <div style="font-weight:bold;font-size:14px;margin-bottom:12px;">⚙ Settings</div>

            <div style="margin-bottom:12px;">
              <div style="opacity:0.6;font-size:10px;letter-spacing:1px;margin-bottom:6px;">PRESETS</div>
              <div style="display:flex;gap:6px;">
                <button class="preset-btn" data-preset="clean" style="
                  flex:1;padding:4px;background:rgba(255,255,255,0.1);
                  border:1px solid rgba(255,255,255,0.2);color:white;
                  border-radius:4px;cursor:pointer;font-size:11px;">Clean</button>
                <button class="preset-btn" data-preset="full" style="
                  flex:1;padding:4px;background:rgba(255,255,255,0.1);
                  border:1px solid rgba(255,255,255,0.2);color:white;
                  border-radius:4px;cursor:pointer;font-size:11px;">Full</button>
                <button class="preset-btn" data-preset="performance" style="
                  flex:1;padding:4px;background:rgba(255,255,255,0.1);
                  border:1px solid rgba(255,255,255,0.2);color:white;
                  border-radius:4px;cursor:pointer;font-size:11px;">Perf</button>
              </div>
            </div>

            <div style="opacity:0.6;font-size:10px;letter-spacing:1px;margin-bottom:4px;">DEPENDENCIES</div>
            <label><input type="checkbox" id="s-direct" checked> <span style="color:#ffffff">⬤</span> Direct</label><br>
            <label><input type="checkbox" id="s-indirect"> <span style="color:#4488ff">⬤</span> Indirect</label><br>
            <label><input type="checkbox" id="s-layer3"> <span style="color:#FFB300">⬤</span> Shared</label><br>
            <label><input type="checkbox" id="s-circular" checked> <span style="color:#FF1744">⬤</span> Circular</label><br>

            <div style="opacity:0.6;font-size:10px;letter-spacing:1px;margin-top:10px;margin-bottom:4px;">ANIMATION</div>
            <label><input type="checkbox" id="s-animation"> Orbital animation</label><br>
            <div style="margin-top:6px;">
              <span style="opacity:0.7">Speed:</span>
              <input type="range" id="s-speed" min="0.1" max="3" step="0.1" value="1"
                style="width:100%;margin-top:4px;">
            </div>

            <div style="opacity:0.6;font-size:10px;letter-spacing:1px;margin-top:10px;margin-bottom:4px;">LABELS</div>
            <label><input type="checkbox" id="s-folder-labels" checked> Folder names</label><br>
            <label><input type="checkbox" id="s-proximity-labels" checked> File names (proximity)</label><br>

            <div style="opacity:0.6;font-size:10px;letter-spacing:1px;margin-top:10px;margin-bottom:4px;">VISUALS</div>
            <label><input type="checkbox" id="s-bg-stars" checked> Background stars</label><br>
            <label><input type="checkbox" id="s-fog" checked> Depth fog</label><br>
            <label><input type="checkbox" id="s-legend" checked> Legend</label><br>
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
              <kbd style="opacity:0.6">S</kbd><span>Toggle settings</span>
              <kbd style="opacity:0.6">W A S D</kbd><span>Fly in spacecraft mode</span>
              <kbd style="opacity:0.6">Q / E</kbd><span>Fly up / down</span>
              <kbd style="opacity:0.6">Shift</kbd><span>Speed boost in spacecraft</span>
              <kbd style="opacity:0.6">Click planet</kbd><span>Open file + focus mode</span>
              <kbd style="opacity:0.6">Click again</kbd><span>Exit focus mode</span>
              <kbd style="opacity:0.6">Escape</kbd><span>Exit focus / search / panels</span>
              <kbd style="opacity:0.6">?</kbd><span>Toggle this panel</span>
              <kbd style="opacity:0.6">Ctrl+U / F5</kbd><span>Refresh universe</span>
              <kbd style="opacity:0.6">T</kbd><span>Toggle file type filter</span>
            </div>
            <div style="margin-top:16px;opacity:0.4;font-size:11px;text-align:center;">Press ? or Escape to close</div>
          </div>

          <button id="refresh-universe" style="
            position: fixed;
            bottom: 20px;
            right: 215px;
            background: rgba(0,0,0,0.85);
            border: 1px solid rgba(255,255,255,0.2);
            color: white;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            font-size: 14px;
            cursor: pointer;
            z-index: 100;
          ">↺</button>

          <!-- Filter bar — populated dynamically after build() -->
          <div id="filter-bar" style="
            position: fixed;
            top: 16px;
            left: 16px;
            display: none;
            flex-direction: column;
            gap: 6px;
            z-index: 100;
            max-height: 80vh;
            overflow-y: auto;
          ">
            <div style="
              background: rgba(0,0,0,0.85);
              border: 1px solid rgba(255,255,255,0.15);
              border-radius: 8px;
              padding: 10px 12px;
              font-family: sans-serif;
              font-size: 11px;
              color: white;
              min-width: 160px;
            ">
              <div style="opacity:0.6;letter-spacing:1px;margin-bottom:8px;">FILE TYPES</div>
              <div id="filter-buttons" style="display:flex;flex-direction:column;gap:4px;">
                <!-- Populated dynamically by Universe.populateFilterBar() -->
              </div>
              <div style="display:flex;gap:6px;margin-top:8px;">
                <button id="filter-all" style="
                  flex:1;padding:4px;background:rgba(255,255,255,0.1);
                  border:1px solid rgba(255,255,255,0.2);color:white;
                  border-radius:4px;cursor:pointer;font-size:10px;">All</button>
                <button id="filter-none" style="
                  flex:1;padding:4px;background:rgba(255,255,255,0.1);
                  border:1px solid rgba(255,255,255,0.2);color:white;
                  border-radius:4px;cursor:pointer;font-size:10px;">None</button>
              </div>
            </div>
          </div>

          <!-- Filter toggle button -->
          <button id="filter-btn" style="
            position: fixed;
            bottom: 20px;
            right: 255px;
            background: rgba(0,0,0,0.85);
            border: 1px solid rgba(255,255,255,0.2);
            color: white;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            font-size: 14px;
            cursor: pointer;
            z-index: 100;
          ">⚡</button>

          <script src="${scriptUri}"></script>
        </body>
      </html>
    `;
  }
}
