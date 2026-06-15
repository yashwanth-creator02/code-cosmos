// webview/bridge/messageBridge.ts

// Webview environment only — no imports from src/
// Cannot use Node.js or VS Code APIs here

declare const acquireVsCodeApi: () => {
  postMessage: (message: unknown) => void;
};

// Must only be called once per webview lifetime
/**
 * The VS Code API instance for communication between the webview and the extension.
 */
const vscodeApi = acquireVsCodeApi();

/**
 * Sends a message from the webview to the extension host.
 *
 * @param message The message data to be sent.
 */
export function sendToExtension(message: unknown): void {
  vscodeApi.postMessage(message);
  console.log('[Code Cosmos Webview] sendToExtension', message);
}

/**
 * Registers a handler to listen for messages sent from the extension host to the webview.
 *
 * @param handler A callback function that will be executed when a message is received.
 */
export function onMessageFromExtension(handler: (message: unknown) => void): void {
  window.addEventListener('message', (event) => {
    console.log('[Code Cosmos Webview] received', event.data);
    handler(event.data);
  });
}
