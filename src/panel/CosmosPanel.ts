// src/panel/CosmosPanel.ts

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CosmosData, SettingsState, DEFAULT_SETTINGS } from '../types';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

type LoadUniverseMessage = { type: 'LOAD_UNIVERSE'; payload: CosmosData };

type MessageToWebview =
  | LoadUniverseMessage
  | { type: 'APPLY_SETTINGS'; payload: SettingsState }
  | { type: 'FOCUS_FILE'; payload: { fileId: string } }
  | { type: 'COSMOS_STALE'; payload: {} };
// COSMOS_STALE — tells the webview to show a "stale" indicator so the user
// knows the cosmos no longer reflects the current file system state.
// The webview shows a subtle banner; an auto-rebuild or manual refresh clears it.

type MessageFromWebview =
  | { type: 'READY' }
  | { type: 'OPEN_FILE'; payload: { fileId: string; line?: number; character?: number } }
  | { type: 'SAVE_SETTINGS'; payload: SettingsState }
  | { type: 'REFRESH' }
  | { type: 'EXPORT_IMAGE'; payload: { dataUrl: string } };

// ---------------------------------------------------------------------------
// CosmosPanel
// ---------------------------------------------------------------------------

export class CosmosPanel {
  private static instance: CosmosPanel | undefined;
  public static currentPanel: CosmosPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly context: vscode.ExtensionContext;

  private lastLoadMessage: LoadUniverseMessage | null = null;
  private lastUniverseData: CosmosData | null = null;
  private isReady = false;
  private pendingMessage: LoadUniverseMessage | null = null;
  private pendingSettings: SettingsState | null = null;

  private disposeCallbacks: (() => void)[] = [];
  private visibilityChangeCallbacks: ((visible: boolean) => void)[] = [];
  private becomeVisibleCallbacks: (() => Promise<void>)[] = [];
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

    // Track visibility changes — used by extension to skip rebuilds on hidden panels
    this.panel.onDidChangeViewState((e) => {
      const visible = e.webviewPanel.visible;
      this.visibilityChangeCallbacks.forEach((cb) => cb(visible));

      if (visible) {
        // Panel just became visible — trigger rebuild callbacks so data is fresh
        this.becomeVisibleCallbacks.forEach((cb) => cb());

        // Also re-send last known universe data as an immediate fallback in case
        // the rebuild hasn't completed yet (the rebuild is async)
        if (this.lastLoadMessage) {
          this.panel.webview.postMessage(this.lastLoadMessage);
          logger.log('Panel became visible — resending last known universe data');
        }
      }
    });

    this.panel.webview.onDidReceiveMessage(async (message: MessageFromWebview) => {
      logger.log('Message received from webview', message.type);

      switch (message.type) {
        case 'READY':
          this.isReady = true;
          logger.log('Webview is ready');

          if (this.pendingSettings) {
            this.panel.webview.postMessage({
              type: 'APPLY_SETTINGS',
              payload: this.pendingSettings,
            });
            this.pendingSettings = null;
          }

          if (this.pendingMessage) {
            this.panel.webview.postMessage(this.pendingMessage);
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

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  public static createOrShow(
    extensionUri: vscode.Uri,
    context: vscode.ExtensionContext
  ): CosmosPanel {
    if (CosmosPanel.instance) {
      CosmosPanel.instance.panel.reveal(vscode.ViewColumn.Beside);
      return CosmosPanel.instance;
    }

    // ViewColumn.Beside — opens next to the active editor rather than replacing it.
    // This makes the cosmos a companion: code on the left, cosmos on the right.
    // preserveFocus: true — keeps the developer's cursor in their code file.
    const panel = vscode.window.createWebviewPanel(
      'codeCosmos',
      'Code Cosmos',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'out'),
          vscode.Uri.joinPath(extensionUri, 'webview'),
        ],
        retainContextWhenHidden: true,
      }
    );

    CosmosPanel.instance = new CosmosPanel(panel, extensionUri, context);
    CosmosPanel.currentPanel = CosmosPanel.instance;
    return CosmosPanel.instance;
  }

  public sendMessage(message: MessageToWebview): void {
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

  public getSavedSettings(): SettingsState {
    return this.context.globalState.get<SettingsState>('cosmosSettings', DEFAULT_SETTINGS);
  }

  public sendSettings(settings: SettingsState): void {
    if (this.isReady) {
      this.panel.webview.postMessage({ type: 'APPLY_SETTINGS', payload: settings });
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

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private dispose(): void {
    this.disposeCallbacks.forEach((cb) => cb());
    CosmosPanel.instance = undefined;
    CosmosPanel.currentPanel = undefined;
  }

  private async openFile(fileId: string, line?: number, character?: number): Promise<void> {
    const file = this.lastUniverseData?.files[fileId];
    if (!file) {
      return;
    }

    const options: vscode.TextDocumentShowOptions = {
      // Open file in the first editor column — leaves cosmos panel untouched
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

      if (!uri) {
        return;
      }

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

  private getHtmlContent(): string {
    const scriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'out', 'webview', 'main.js')
    );
    const styleUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'webview', 'style.css')
    );
    const indexPath = path.join(this.extensionUri.fsPath, 'webview', 'index.html');

    let html = fs.readFileSync(indexPath, 'utf8');
    html = html.replace(
      '{{cspSource}}',
      `
      default-src 'none';
      style-src ${this.panel.webview.cspSource} 'unsafe-inline';
      script-src ${this.panel.webview.cspSource};
      connect-src ${this.panel.webview.cspSource};
      img-src ${this.panel.webview.cspSource} data:;
    `
    );
    html = html.replace('{{styleUri}}', styleUri.toString());
    html = html.replace('{{scriptUri}}', scriptUri.toString());
    return html;
  }
}
