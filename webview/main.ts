// webview/main.ts

import { sendToExtension, onMessageFromExtension } from './bridge/messageBridge';

// Listen for messages from the extension host
onMessageFromExtension((message) => {
  console.log('[Code Cosmos Webview] message from extension:', message);

});

// Signal to the extension host that the webview is ready to receive data
// We do this AFTER setting up the listener so we don't miss any messages
sendToExtension({ type: 'READY' });
