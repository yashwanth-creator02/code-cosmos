// src/panel/CosmosPanel.ts
//
// Implements a VS Code WebviewViewProvider — Code Cosmos lives in the
// Activity Bar sidebar as a dedicated panel, not as a floating editor tab.
//
// Why sidebar instead of bottom panel:
//   - The bottom panel (Terminal area) is too height-constrained for a 3D canvas.
//   - The sidebar gives the developer a resizable, persistent panel that coexists
//     naturally with the code editor.
//   - This matches the paradigm of tools like GitLens, GitHub Copilot Chat, etc.
//
// The VS Code API flow:
//   1. package.json registers a viewsContainers entry (Activity Bar icon)
//      and a views entry (the webview view inside that container).
//   2. extension.ts registers this class as the provider for that view ID.
//   3. VS Code calls resolveWebviewView() when the user first opens the panel.
//   4. From that point on the webview persists (retainContextWhenHidden: true).

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
  CosmosData,
  SettingsState,
  DEFAULT_SETTINGS,
  NavigationData,
  MessageToWebview,
  MessageFromWebview,
} from '../types';
import { logger } from '../utils/logger';
import { readCosmosFile, savePreferences, saveNavigation } from '../core/cosmosFile';

// ---------------------------------------------------------------------------
// Message types — LoadUniverseMessage narrows the LOAD_UNIVERSE variant of
// MessageToWebview for the pending-message queue (avoids re-discriminating
// the union on every read).
// ---------------------------------------------------------------------------

type LoadUniverseMessage = { type: 'LOAD_UNIVERSE'; payload: CosmosData };

// ---------------------------------------------------------------------------
// CosmosPanel — WebviewViewProvider
// ---------------------------------------------------------------------------

export class CosmosPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = 'codeCosmos.sidebarView';
  public static currentPanel: CosmosPanel | undefined;

  private view: vscode.WebviewView | undefined;
  private readonly extensionUri: vscode.Uri;
  private readonly context: vscode.ExtensionContext;

  private lastLoadMessage: LoadUniverseMessage | null = null;
  private lastUniverseData: CosmosData | null = null;
  private isReady = false;
  private pendingMessage: LoadUniverseMessage | null = null;
  private pendingSettings: SettingsState | null = null;
  private pendingNavigation: NavigationData | null = null;

  private disposeCallbacks: (() => void)[] = [];
  private visibilityChangeCallbacks: ((visible: boolean) => void)[] = [];
  private becomeVisibleCallbacks: (() => Promise<void>)[] = [];
  private onRefreshCallback: (() => Promise<void>) | null = null;

  constructor(extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
    this.extensionUri = extensionUri;
    this.context = context;
    CosmosPanel.currentPanel = this;
  }

  // ---------------------------------------------------------------------------
  // VS Code calls this when the sidebar panel first becomes visible.
  // This is the entry point for WebviewViewProvider — equivalent to
  // createWebviewPanel() in the old tab-based approach.
  // ---------------------------------------------------------------------------

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'out'),
        vscode.Uri.joinPath(this.extensionUri, 'webview'),
      ],
    };

    webviewView.webview.html = this.getHtmlContent(webviewView.webview);

    // Track visibility — used to skip rebuilds on hidden panel
    webviewView.onDidChangeVisibility(() => {
      const visible = webviewView.visible;
      this.visibilityChangeCallbacks.forEach((cb) => cb(visible));
      if (visible) {
        this.becomeVisibleCallbacks.forEach((cb) => cb());
        // Re-send last known data as immediate fallback while async rebuild runs
        if (this.lastLoadMessage) {
          webviewView.webview.postMessage(this.lastLoadMessage);
          logger.log('Sidebar became visible — resending last universe data');
        }
      }
    });

    webviewView.onDidDispose(() => {
      this.disposeCallbacks.forEach((cb) => cb());
      this.view = undefined;
      this.isReady = false;
      logger.log('Sidebar view disposed');
    });

    webviewView.webview.onDidReceiveMessage(async (message: MessageFromWebview) => {
      logger.log('Message from webview:', message.type);
      switch (message.type) {
        case 'READY':
          this.isReady = true;
          logger.log('Webview ready');
          if (this.pendingSettings) {
            webviewView.webview.postMessage({
              type: 'APPLY_SETTINGS',
              payload: this.pendingSettings,
            });
            this.pendingSettings = null;
          }
          if (this.pendingNavigation) {
            webviewView.webview.postMessage({
              type: 'APPLY_NAVIGATION',
              payload: this.pendingNavigation,
            });
            this.pendingNavigation = null;
          }
          if (this.pendingMessage) {
            webviewView.webview.postMessage(this.pendingMessage);
            this.lastLoadMessage = this.pendingMessage;
            this.lastUniverseData = this.pendingMessage.payload;
            this.pendingMessage = null;
          }
          break;

        case 'OPEN_FILE':
          await this.openFile(
            message.payload.fileId,
            message.payload.line,
            message.payload.character
          );
          break;

        case 'SAVE_SETTINGS':
          try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
              // Write to per-project .cosmos file (primary)
              await savePreferences(workspaceFolders[0], message.payload);
            }
            // Also keep globalState as fallback for single-root workspaces
            // and for users who don't have a workspace open
            await this.context.globalState.update('cosmosSettings', message.payload);
            logger.log('Settings saved to .cosmos and globalState');
          } catch (err) {
            logger.error(`Settings save failed: ${err}`);
          }
          break;

        case 'SAVE_NAVIGATION':
          try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
              await saveNavigation(workspaceFolders[0], message.payload);
              logger.log('Navigation (camera bookmarks) saved to .cosmos');
            } else {
              logger.log('SAVE_NAVIGATION received but no workspace open — not persisted');
            }
          } catch (err) {
            logger.error(`Navigation save failed: ${err}`);
          }
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

  // ---------------------------------------------------------------------------
  // Public API — same interface as before so extension.ts needs minimal changes
  // ---------------------------------------------------------------------------

  public sendMessage(message: MessageToWebview): void {
    if (message.type === 'LOAD_UNIVERSE') {
      this.lastLoadMessage = message;
      this.lastUniverseData = message.payload;
      if (this.isReady && this.view) {
        this.view.webview.postMessage(message);
      } else {
        this.pendingMessage = message;
      }
      return;
    }
    if (this.view) {
      this.view.webview.postMessage(message);
    }
  }

  public getSavedSettings(): SettingsState {
    // Synchronous fallback — the async read happens in loadSettingsFromCosmosFile()
    // which is called before sendSettings() in loadAndSend().
    // This method is kept for compatibility but returns defaults if not yet loaded.
    return this.context.globalState.get<SettingsState>('cosmosSettings', DEFAULT_SETTINGS);
  }

  /**
   * Async version — reads from the per-project .cosmos file.
   * Falls back to globalState (legacy), then defaults.
   * Called from loadAndSend() before sending LOAD_UNIVERSE.
   */
  public async loadSettingsFromCosmosFile(
    workspaceFolder: vscode.WorkspaceFolder
  ): Promise<SettingsState> {
    try {
      const cosmosData = await readCosmosFile(workspaceFolder);
      return cosmosData.preferences;
    } catch {
      // Fall back to globalState for users migrating from 0.1.x
      return this.context.globalState.get<SettingsState>('cosmosSettings', DEFAULT_SETTINGS);
    }
  }

  /**
   * Async — reads navigation data (camera bookmarks, home position, history)
   * from the per-project .cosmos file. Returns empty defaults if unavailable.
   */
  public async loadNavigationFromCosmosFile(
    workspaceFolder: vscode.WorkspaceFolder
  ): Promise<NavigationData> {
    try {
      const cosmosData = await readCosmosFile(workspaceFolder);
      return cosmosData.navigation;
    } catch {
      return { homePosition: null, namedSlots: [], cameraHistory: [] };
    }
  }

  public sendNavigation(navigation: NavigationData): void {
    if (this.isReady && this.view) {
      this.view.webview.postMessage({ type: 'APPLY_NAVIGATION', payload: navigation });
    } else {
      this.pendingNavigation = navigation;
    }
  }

  public sendSettings(settings: SettingsState): void {
    if (this.isReady && this.view) {
      this.view.webview.postMessage({ type: 'APPLY_SETTINGS', payload: settings });
    } else {
      this.pendingSettings = settings;
    }
  }

  public onDispose(callback: () => void): void {
    this.disposeCallbacks.push(callback);
  }

  public onVisibilityChange(callback: (visible: boolean) => void): void {
    this.visibilityChangeCallbacks.push(callback);
  }

  public onBecomeVisible(callback: () => Promise<void>): void {
    this.becomeVisibleCallbacks.push(callback);
  }

  public setRefreshCallback(callback: () => Promise<void>): void {
    this.onRefreshCallback = callback;
  }

  public reveal(): void {
    // Focus the sidebar panel — equivalent to old panel.reveal()
    vscode.commands.executeCommand('codeCosmos.sidebarView.focus');
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async openFile(fileId: string, line?: number, character?: number): Promise<void> {
    const file = this.lastUniverseData?.files[fileId];
    if (!file) {
      return;
    }
    const options: vscode.TextDocumentShowOptions = {
      // Open in first editor column — leaves sidebar panel untouched
      viewColumn: vscode.ViewColumn.One,
      preserveFocus: false,
    };
    if (line !== undefined && character !== undefined) {
      const pos = new vscode.Position(line - 1, character - 1);
      options.selection = new vscode.Range(pos, pos);
    }
    await vscode.window.showTextDocument(vscode.Uri.file(file.path), options);
  }

  private async exportImage(dataUrl: string): Promise<void> {
    try {
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
      const buffer = Buffer.from(base64, 'base64');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const defaultName = `code-cosmos-${timestamp}.png`;

      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(
          path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', defaultName)
        ),
        filters: { 'PNG Image': ['png'] },
        title: 'Save Code Cosmos Screenshot',
      });

      if (!uri) return;

      await vscode.workspace.fs.writeFile(uri, buffer);
      const open = await vscode.window.showInformationMessage(
        'Code Cosmos: Screenshot saved',
        'Open File',
        'Show in Explorer'
      );
      if (open === 'Open File') {
        await vscode.commands.executeCommand('vscode.open', uri);
      } else if (open === 'Show in Explorer') {
        await vscode.commands.executeCommand('revealFileInOS', uri);
      }
    } catch (err) {
      logger.error(`Export failed: ${err}`);
    }
  }

  private getHtmlContent(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'out', 'webview', 'main.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'webview', 'style.css')
    );
    const indexPath = path.join(this.extensionUri.fsPath, 'webview', 'index.html');

    let html = fs.readFileSync(indexPath, 'utf8');
    html = html.replace(
      '{{cspSource}}',
      `
      default-src 'none';
      style-src ${webview.cspSource} 'unsafe-inline';
      script-src ${webview.cspSource};
      connect-src ${webview.cspSource};
      img-src ${webview.cspSource} data:;
    `
    );
    html = html.replace('{{styleUri}}', styleUri.toString());
    html = html.replace('{{scriptUri}}', scriptUri.toString());
    return html;
  }
}
