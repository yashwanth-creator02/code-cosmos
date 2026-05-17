// webview/main.ts

import { sendToExtension, onMessageFromExtension } from './bridge/messageBridge';
import { Universe } from './universe/Universe';
import { CosmosData } from '../src/types';

let universe: Universe | null = null;

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('cosmos-canvas') as HTMLCanvasElement;
  universe = new Universe(canvas);
});

onMessageFromExtension((message: any) => {
  if (message.type === 'LOAD_UNIVERSE' && universe) {
    // Update loading text
    const loadingText = document.getElementById('loading-text');
    if (loadingText) {
      loadingText.textContent = 'Building universe...';
    }

    // Small delay so the text update renders before heavy work
    setTimeout(() => {
      universe!.build(message.payload as CosmosData);

      // Fade out loading overlay
      const overlay = document.getElementById('loading-overlay');
      if (overlay) {
        overlay.style.transition = 'opacity 0.8s ease';
        overlay.style.opacity = '0';
        setTimeout(() => {
          overlay.style.display = 'none';
        }, 800);
      }
    }, 100);
  }
});

sendToExtension({ type: 'READY' });
