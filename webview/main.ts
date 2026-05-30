// webview/main.ts

import { sendToExtension, onMessageFromExtension } from './bridge/messageBridge';
import { Universe } from './universe/Universe';
import { CosmosData, SettingsState } from '../src/types';

let universe: Universe | null = null;
let pendingSettings: SettingsState | null = null;

onMessageFromExtension((message: any) => {
  if (message.type === 'APPLY_SETTINGS') {
    if (universe) {
      universe.applySettings(message.payload);
    } else {
      pendingSettings = message.payload;
    }
    return;
  }

  if (message.type === 'LOAD_UNIVERSE') {
    const loadingText = document.getElementById('loading-text');
    if (loadingText) {
      loadingText.textContent = 'Building universe...';
    }

    const doBuild = () => {
      if (!universe) {
        setTimeout(doBuild, 50);
        return;
      }

      setTimeout(() => {
        try {
          universe!.build(message.payload as CosmosData);

          const overlay = document.getElementById('loading-overlay');
          if (overlay) {
            overlay.style.transition = 'opacity 0.8s ease';
            overlay.style.opacity = '0';
            setTimeout(() => {
              overlay.style.display = 'none';
            }, 800);
          }
        } catch (err) {
          console.error('[Code Cosmos Webview] Build failed:', err);
          const textEl = document.getElementById('loading-text');
          if (textEl) {
            textEl.textContent = `Error: ${err}`;
            textEl.style.color = '#FF1744';
          }
        }
      }, 100);
    };

    doBuild();
  }

  if (message.type === 'FOCUS_FILE') {
    if (universe) {
      universe.focusOnFile(message.payload.fileId);
    }
  }
});

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('cosmos-canvas') as HTMLCanvasElement;
  universe = new Universe(canvas);

  if (pendingSettings) {
    universe.applySettings(pendingSettings);
    pendingSettings = null;
  }

  sendToExtension({ type: 'READY' });
});
