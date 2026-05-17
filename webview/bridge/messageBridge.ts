// webview/bridge/messageBridge.ts

// Webview environment only — no imports from src/
// Cannot use Node.js or VS Code APIs here

declare const acquireVsCodeApi: () => {
  postMessage: (message: unknown) => void;
};

// Must only be called once per webview lifetime
const vscodeApi = acquireVsCodeApi();

// Send a message FROM the webview TO the extension host
export function sendToExtension(message: unknown): void {
  vscodeApi.postMessage(message);
  console.log('[Code Cosmos Webview] sendToExtension', message);
}

// Listen for messages FROM the extension host TO the webview
export function onMessageFromExtension(handler: (message: unknown) => void): void {
  window.addEventListener('message', (event) => {
    console.log('[Code Cosmos Webview] received', event.data);
    handler(event.data);
  });
}
