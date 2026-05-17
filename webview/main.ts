// webview/main.ts

import { sendToExtension, onMessageFromExtension } from './bridge/messageBridge';
import { Universe } from './universe/Universe';
import { CosmosData } from '../src/types';

let universe: Universe | null = null;

// Wait for DOM to be ready before touching the canvas
window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('cosmos-canvas') as HTMLCanvasElement;
  universe = new Universe(canvas);
});

onMessageFromExtension((message: any) => {
  if (message.type === 'LOAD_UNIVERSE' && universe) {
    universe.build(message.payload as CosmosData);
  }
});

sendToExtension({ type: 'READY' });
