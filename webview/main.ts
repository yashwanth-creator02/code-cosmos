// webview/main.ts

import { sendToExtension, onMessageFromExtension } from './bridge/messageBridge';
import { Universe } from './universe/Universe';
import { CosmosData, SettingsState } from '../src/types';

let universe: Universe | null = null;
let pendingSettings: SettingsState | null = null;

// ---------------------------------------------------------------------------
// Stale indicator
// Shown when the extension signals the file system has changed since last build.
// Cleared when a fresh LOAD_UNIVERSE arrives.
// ---------------------------------------------------------------------------

function showStaleIndicator(): void {
  let indicator = document.getElementById('stale-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'stale-indicator';
    indicator.style.cssText = `
      position: fixed;
      bottom: 16px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(255, 160, 0, 0.15);
      border: 1px solid rgba(255, 160, 0, 0.4);
      color: rgba(255, 200, 80, 0.9);
      padding: 6px 16px;
      border-radius: 20px;
      font-size: 11px;
      letter-spacing: 0.03em;
      backdrop-filter: blur(8px);
      cursor: pointer;
      z-index: 9999;
      transition: opacity 0.3s ease;
      user-select: none;
    `;
    indicator.textContent = '⟳  Files changed — click to refresh';
    indicator.addEventListener('click', () => {
      sendToExtension({ type: 'REFRESH' });
      hideStaleIndicator();
    });
    document.body.appendChild(indicator);
  }
  indicator.style.opacity = '1';
  indicator.style.display = 'block';
}

function hideStaleIndicator(): void {
  const indicator = document.getElementById('stale-indicator');
  if (indicator) {
    indicator.style.opacity = '0';
    setTimeout(() => {
      if (indicator) indicator.style.display = 'none';
    }, 300);
  }
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

onMessageFromExtension((message: any) => {
  switch (message.type) {
    case 'APPLY_SETTINGS':
      if (universe) {
        universe.applySettings(message.payload);
      } else {
        pendingSettings = message.payload;
      }
      break;

    case 'LOAD_UNIVERSE': {
      // Fresh data arrived — clear any stale indicator
      hideStaleIndicator();

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
                if (overlay) overlay.style.display = 'none';
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
      break;
    }

    case 'FOCUS_FILE':
      if (universe) {
        universe.focusOnFile(message.payload.fileId);
      }
      break;

    case 'COSMOS_STALE':
      // File system changed since last build — show non-intrusive refresh prompt
      showStaleIndicator();
      break;
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('cosmos-canvas') as HTMLCanvasElement;
  universe = new Universe(canvas);

  if (pendingSettings) {
    universe.applySettings(pendingSettings);
    pendingSettings = null;
  }

  sendToExtension({ type: 'READY' });
});
