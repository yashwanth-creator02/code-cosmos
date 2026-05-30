'use strict';
// webview/bridge/messageBridge.ts
Object.defineProperty(exports, '__esModule', { value: true });
exports.sendToExtension = sendToExtension;
exports.onMessageFromExtension = onMessageFromExtension;
// Must only be called once per webview lifetime
const vscodeApi = acquireVsCodeApi();
// Send a message FROM the webview TO the extension host
function sendToExtension(message) {
  vscodeApi.postMessage(message);
  console.log('[Code Cosmos Webview] sendToExtension', message);
}
// Listen for messages FROM the extension host TO the webview
function onMessageFromExtension(handler) {
  window.addEventListener('message', (event) => {
    console.log('[Code Cosmos Webview] received', event.data);
    handler(event.data);
  });
}
//# sourceMappingURL=messageBridge.js.map
