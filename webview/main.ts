// webview/main.ts

import { sendToExtension, onMessageFromExtension } from './bridge/messageBridge';
import { Universe } from './universe/Universe';
import { CosmosData } from '../src/types';

let universe: Universe | null = null;

// Set up message listener FIRST — before signaling ready
// so we never miss a LOAD_UNIVERSE message
onMessageFromExtension((message: any) => {
  if (message.type === 'APPLY_SETTINGS' && universe) {
    universe.applySettings(message.payload);
    return;
  }
  if (message.type === 'LOAD_UNIVERSE') {
    const loadingText = document.getElementById('loading-text');
    if (loadingText) {
      loadingText.textContent = 'Building universe...';
    }

    // If universe isn't created yet, wait for it
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
          // Show error on loading screen instead of hanging
          const loadingText = document.getElementById('loading-text');
          if (loadingText) {
            loadingText.textContent = `Error: ${err}`;
            loadingText.style.color = '#FF1744';
          }
        }
      }, 100);
    };

    doBuild();
  }
});

// Create universe once DOM is ready, then signal READY
window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('cosmos-canvas') as HTMLCanvasElement;
  universe = new Universe(canvas);

  // Signal AFTER universe is created so extension knows we're ready
  sendToExtension({ type: 'READY' });
});
