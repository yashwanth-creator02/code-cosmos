// src/panel/CosmosPanel.ts

import * as vscode from 'vscode';
import { CosmosData, SettingsState, DEFAULT_SETTINGS } from '../types';
import { logger } from '../utils/logger';

type LoadUniverseMessage = { type: 'LOAD_UNIVERSE'; payload: CosmosData };

type MessageFromWebview =
  | { type: 'READY' }
  | { type: 'OPEN_FILE'; payload: { fileId: string } }
  | { type: 'SAVE_SETTINGS'; payload: SettingsState }
  | { type: 'REFRESH' }
  | { type: 'EXPORT_IMAGE'; payload: { dataUrl: string } };

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

        case 'EXPORT_IMAGE':
          await this.exportImage(message.payload.dataUrl);
          break;
      }
    });
  }

  private async exportImage(dataUrl: string): Promise<void> {
    try {
      // Strip the data:image/png;base64, prefix
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
      const buffer = Buffer.from(base64, 'base64');

      // Default filename with timestamp
      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, '-')
        .slice(0, 19);
      const defaultName = `code-cosmos-${timestamp}.png`;

      // Ask user where to save
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(
          require('path').join(
            vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
            defaultName
          )
        ),
        filters: { 'PNG Image': ['png'] },
        title: 'Save Code Cosmos Screenshot',
      });

      if (!uri) { return; } // user cancelled

      await vscode.workspace.fs.writeFile(uri, buffer);

      const open = await vscode.window.showInformationMessage(
        `Code Cosmos: Screenshot saved to ${uri.fsPath}`,
        'Open File',
        'Show in Explorer'
      );

      if (open === 'Open File') {
        await vscode.commands.executeCommand('vscode.open', uri);
      } else if (open === 'Show in Explorer') {
        await vscode.commands.executeCommand('revealFileInOS', uri);
      }

      logger.log(`Screenshot saved: ${uri.fsPath}`);
    } catch (err) {
      logger.error(`Export failed: ${err}`);
      vscode.window.showErrorMessage(`Code Cosmos: Export failed — ${err}`);
    }
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
            :root {
              --glass-bg: rgba(10, 10, 10, 0.75);
              --glass-border: rgba(255, 255, 255, 0.1);
              --glass-blur: blur(12px);
              --accent-gold: #ffaa00;
              --accent-blue: #00D2FF;
            }

            html, body {
              width: 100%;
              height: 100%;
              margin: 0;
              padding: 0;
              background: black;
              overflow: hidden;
              color: white;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            }

            .glass-panel {
              background: var(--glass-bg);
              border: 1px solid var(--glass-border);
              backdrop-filter: var(--glass-blur);
              -webkit-backdrop-filter: var(--glass-blur);
              border-radius: 12px;
              box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
            }

            .control-btn {
              background: var(--glass-bg);
              border: 1px solid var(--glass-border);
              backdrop-filter: var(--glass-blur);
              -webkit-backdrop-filter: var(--glass-blur);
              color: white;
              width: 38px;
              height: 38px;
              border-radius: 50%;
              cursor: pointer;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 16px;
              transition: all 0.2s ease;
              box-shadow: 0 4px 15px rgba(0,0,0,0.4);
            }

            .control-btn:hover {
              background: rgba(255, 255, 255, 0.1);
              transform: scale(1.1);
            }

            .control-btn.active {
              background: rgba(255, 255, 255, 0.2);
              border-color: var(--accent-blue);
              box-shadow: 0 0 15px rgba(0, 210, 255, 0.3);
            }

            kbd {
              background: rgba(255,255,255,0.1);
              border: 1px solid rgba(255,255,255,0.2);
              border-radius: 4px;
              padding: 2px 6px;
              font-size: 10px;
              font-family: monospace;
              margin-right: 8px;
            }

            /* Scrollbar styling */
            ::-webkit-scrollbar { width: 6px; }
            ::-webkit-scrollbar-track { background: transparent; }
            ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
            ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
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
          ">
            <div id="loading-sun" style="
              width: 80px;
              height: 80px;
              border-radius: 50%;
              background: radial-gradient(circle, #fff5c0, #ffaa00, #ff4400);
              box-shadow: 0 0 40px #ffaa00, 0 0 80px #ff6600;
              animation: pulse 1.5s ease-in-out infinite;
              margin-bottom: 32px;
            "></div>
            <div style="font-size:24px;font-weight:bold;margin-bottom:12px;letter-spacing:2px;">CODE COSMOS</div>
            <div id="loading-text" style="font-size:14px;opacity:0.6;font-weight:300;">Orchestrating the universe...</div>
          </div>

          <style>
            @keyframes pulse {
              0%, 100% { transform: scale(1); box-shadow: 0 0 40px #ffaa00, 0 0 80px #ff6600; opacity: 0.9; }
              50% { transform: scale(1.1); box-shadow: 0 0 60px #ffaa00, 0 0 120px #ff6600; opacity: 1; }
            }
          </style>

          <!-- Tooltip -->
          <div id="tooltip" class="glass-panel" style="
            position: fixed;
            display: none;
            padding: 12px 16px;
            font-size: 12px;
            pointer-events: none;
            z-index: 1000;
            line-height: 1.6;
            max-width: 250px;
          "></div>

          <!-- Git HUD -->
          <div id="git-hud" class="glass-panel" style="
            position: fixed;
            top: 20px;
            left: 20px;
            padding: 10px 16px;
            font-size: 12px;
            z-index: 100;
            display: none;
            display: flex;
            align-items: center;
            gap: 10px;
          ">
            <span style="font-size: 14px;"></span>
            <span id="git-branch" style="font-weight:600;letter-spacing:0.5px;color:var(--accent-blue);">—</span>
          </div>

          <!-- Minimap -->
          <div id="minimap-container" class="glass-panel" style="
            position: fixed;
            bottom: 80px;
            right: 20px;
            width: 160px;
            height: 160px;
            overflow: hidden;
            z-index: 100;
            cursor: crosshair;
            display: none;
          ">
            <canvas id="minimap-canvas" width="160" height="160"></canvas>
            <div style="
              position: absolute;
              top: 6px;
              left: 10px;
              font-size: 9px;
              font-weight: bold;
              opacity: 0.3;
              letter-spacing: 1px;
              pointer-events: none;
            ">MINIMAP</div>
          </div>

          <!-- Search -->
          <div id="search-container" class="glass-panel" style="
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 100;
            display: none;
            padding: 4px;
            width: 320px;
          ">
            <input id="search-input" type="text" placeholder="Search files ( / )..." style="
              background: transparent;
              border: none;
              color: white;
              padding: 10px 14px;
              font-size: 14px;
              width: 100%;
              outline: none;
              box-sizing: border-box;
            "/>
            <div id="search-results" style="
              border-top: 1px solid var(--glass-border);
              max-height: 250px;
              overflow-y: auto;
              display: none;
            "></div>
          </div>

          <!-- Control Bar (Bottom Center-Right) -->
          <div id="control-bar" style="
            position: fixed;
            bottom: 20px;
            right: 20px;
            display: flex;
            gap: 10px;
            z-index: 500;
            align-items: center;
          ">
            <button id="help-button" class="control-btn" title="Keyboard Shortcuts (?)">❔</button>
            <button id="settings-btn" class="control-btn" title="Settings (S)">⚙️</button>
            <button id="filter-btn" class="control-btn" title="File Filter (T)">🏷️</button>
            <button id="minimap-btn" class="control-btn" title="Minimap (M)">🗺️</button>
            <button id="export-btn" class="control-btn" title="Screenshot (P)">📸</button>
            <button id="refresh-universe" class="control-btn" title="Refresh (Ctrl+U / F5)">🔄</button>
            <div style="width:1px; height:24px; background:var(--glass-border); margin: 0 4px;"></div>
            <button id="reset-camera" class="glass-panel" style="
              height: 38px;
              padding: 0 16px;
              color: white;
              cursor: pointer;
              font-size: 13px;
              border: 1px solid var(--glass-border);
              display: flex;
              align-items: center;
              gap: 8px;
              transition: all 0.2s ease;
            "><span>⟳</span> Reset View</button>
          </div>

          <!-- Mode Indicator -->
          <div id="mode-indicator" class="glass-panel" style="
            position: fixed;
            bottom: 75px;
            right: 20px;
            padding: 10px 18px;
            font-size: 13px;
            opacity: 0;
            transition: all 0.4s ease;
            z-index: 100;
            border-color: var(--accent-blue);
          "></div>

          <!-- Legend -->
          <div id="legend" class="glass-panel" style="
            position: fixed;
            bottom: 20px;
            left: 20px;
            padding: 18px;
            font-size: 11px;
            z-index: 100;
            line-height: 2;
            min-width: 180px;
          ">
            <div style="font-weight:bold;margin-bottom:10px;opacity:0.5;font-size:10px;letter-spacing:1.5px;">CONNECTIONS</div>
            <div><span style="color:#ffffff;margin-right:8px;">●</span> Direct import</div>
            <div><span style="color:#4488ff;margin-right:8px;">●</span> Indirect chain</div>
            <div><span style="color:#FFB300;margin-right:8px;">●</span> Shared dependent</div>
            <div><span style="color:#00BCD4;margin-right:8px;">●</span> Shared dependency</div>
            <div><span style="color:#FF1744;margin-right:8px;">●</span> Circular (Danger)</div>
            <div style="margin-top:14px;font-weight:bold;opacity:0.5;font-size:10px;letter-spacing:1.5px;">ENTITIES</div>
            <div style="display:flex;align-items:center;gap:8px;">⭐ <span style="opacity:0.9">Root Repository</span></div>
            <div style="display:flex;align-items:center;gap:8px;">🔆 <span style="opacity:0.9">Directory (Star)</span></div>
            <div style="display:flex;align-items:center;gap:8px;">● <span style="opacity:0.9">File (Planet)</span></div>
          </div>

          <!-- Settings Panel -->
          <div id="settings-panel" class="glass-panel" style="
            position: fixed;
            top: 50%;
            right: 20px;
            transform: translateY(-50%);
            padding: 24px;
            z-index: 600;
            display: none;
            width: 260px;
            max-height: 80vh;
            overflow-y: auto;
          ">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
              <span style="font-weight:bold;font-size:16px;">Settings</span>
              <span style="opacity:0.4;font-size:11px;">(S)</span>
            </div>

            <div style="margin-bottom:20px;">
              <div style="opacity:0.5;font-size:10px;letter-spacing:1px;margin-bottom:10px;">PRESETS</div>
              <div style="display:flex;gap:8px;">
                <button class="preset-btn" data-preset="clean" style="
                  flex:1;padding:6px;background:rgba(255,255,255,0.08);
                  border:1px solid var(--glass-border);color:white;
                  border-radius:6px;cursor:pointer;font-size:11px;">Clean</button>
                <button class="preset-btn" data-preset="full" style="
                  flex:1;padding:6px;background:rgba(255,255,255,0.08);
                  border:1px solid var(--glass-border);color:white;
                  border-radius:6px;cursor:pointer;font-size:11px;">Full</button>
                <button class="preset-btn" data-preset="performance" style="
                  flex:1;padding:6px;background:rgba(255,255,255,0.08);
                  border:1px solid var(--glass-border);color:white;
                  border-radius:6px;cursor:pointer;font-size:11px;">Perf</button>
              </div>
            </div>

            <div style="opacity:0.5;font-size:10px;letter-spacing:1px;margin-bottom:8px;">GRAPH VISIBILITY</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer;"><input type="checkbox" id="s-direct" checked> Direct</label>
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer;"><input type="checkbox" id="s-indirect"> Indirect</label>
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer;"><input type="checkbox" id="s-layer3"> Shared</label>
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer;"><input type="checkbox" id="s-circular" checked> Circular</label>
            </div>

            <div style="margin-top:20px;opacity:0.5;font-size:10px;letter-spacing:1px;margin-bottom:8px;">MOTION</div>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;"><input type="checkbox" id="s-animation"> Orbital Orbits</label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:6px;"><input type="checkbox" id="s-star-rotation" checked> Star Self-Rotation</label>
            <div style="margin-top:12px; background:rgba(255,255,255,0.05); padding:10px; border-radius:8px;">
              <div style="display:flex;justify-content:space-between;opacity:0.7;font-size:11px;margin-bottom:4px;">
                <span>Orbit Speed</span>
                <span id="speed-val">1.0x</span>
              </div>
              <input type="range" id="s-speed" min="0.1" max="4" step="0.1" value="1" style="width:100%;cursor:pointer;">
            </div>

            <div style="margin-top:20px;opacity:0.5;font-size:10px;letter-spacing:1px;margin-bottom:8px;">LABELS & HUD</div>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;"><input type="checkbox" id="s-folder-labels" checked> Folder Labels</label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:4px;"><input type="checkbox" id="s-proximity-labels" checked> Planet Proximity Labels</label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:4px;"><input type="checkbox" id="s-legend" checked> Show Legend</label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:4px;"><input type="checkbox" id="s-minimap"> Show Minimap</label>

            <div style="margin-top:20px;opacity:0.5;font-size:10px;letter-spacing:1px;margin-bottom:8px;">VISUAL EFFECTS</div>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;"><input type="checkbox" id="s-bg-stars" checked> Stellar Background</label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:4px;"><input type="checkbox" id="s-fog" checked> Depth Fog</label>

            <div style="margin-top:20px;border-top:1px solid var(--glass-border);padding-top:16px;">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:var(--accent-gold);font-weight:bold;">
                <input type="checkbox" id="s-performance"> ⚡ Performance Mode
              </label>
              <div style="font-size:9px;opacity:0.5;margin-top:4px;margin-left:24px;">Reduces geometry quality for smoother FPS.</div>
            </div>
          </div>

          <!-- Shortcuts Panel -->
          <div id="shortcuts-panel" class="glass-panel" style="
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            padding: 32px;
            z-index: 700;
            display: none;
            min-width: 400px;
          ">
            <div style="font-weight:bold;font-size:20px;margin-bottom:24px;display:flex;align-items:center;gap:12px;">
              <span>⌨️</span> Command Center
            </div>
            <div style="display:grid;grid-template-columns:auto 1fr;gap:10px 24px;font-size:13px;line-height:1.8;">
              <kbd>/</kbd><span>Focus search bar</span>
              <kbd>F</kbd><span>Toggle spacecraft pilot mode</span>
              <kbd>R</kbd><span>Recenter camera on root</span>
              <kbd>S</kbd><span>Toggle settings panel</span>
              <kbd>M</kbd><span>Toggle minimap overlay</span>
              <kbd>T</kbd><span>Toggle file type filters</span>
              <kbd>P</kbd><span>Capture high-res screenshot</span>
              <kbd>?</kbd><span>Open this command list</span>
              <kbd>W A S D</kbd><span>Fly through the universe</span>
              <kbd>Q / E</kbd><span>Ascend / Descend</span>
              <kbd>Shift</kbd><span>Afterburners (Speed boost)</span>
              <kbd>Click</kbd><span>Inspect Planet / Folder</span>
              <kbd>Esc</kbd><span>Exit Focus / Search / Panels</span>
            </div>
            <div style="margin-top:32px;opacity:0.3;font-size:11px;text-align:center;letter-spacing:1px;">PRESS ANY KEY OR ESC TO DISMISS</div>
          </div>

          <!-- Filter Panel -->
          <div id="filter-bar" class="glass-panel" style="
            position: fixed;
            top: 75px;
            left: 20px;
            display: none;
            flex-direction: column;
            gap: 12px;
            z-index: 100;
            max-height: 70vh;
            width: 200px;
            padding: 20px;
          ">
            <div style="opacity:0.5;font-size:10px;letter-spacing:1.5px;font-weight:bold;">RESOURCES TYPES</div>
            <div id="filter-buttons" style="display:flex;flex-direction:column;gap:6px;overflow-y:auto;padding-right:4px;">
              <!-- Dynamic -->
            </div>
            <div style="display:flex;gap:8px;margin-top:4px;border-top:1px solid var(--glass-border);padding-top:12px;">
              <button id="filter-all" style="
                flex:1;padding:6px;background:rgba(255,255,255,0.08);
                border:1px solid var(--glass-border);color:white;
                border-radius:6px;cursor:pointer;font-size:11px;">All</button>
              <button id="filter-none" style="
                flex:1;padding:6px;background:rgba(255,255,255,0.08);
                border:1px solid var(--glass-border);color:white;
                border-radius:6px;cursor:pointer;font-size:11px;">None</button>
            </div>
          </div>

          <script src="${scriptUri}"></script>
        </body>
      </html>
    `;
  }
}
