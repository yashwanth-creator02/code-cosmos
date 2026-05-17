"use strict";
// webview/main.ts
Object.defineProperty(exports, "__esModule", { value: true });
const messageBridge_1 = require("./bridge/messageBridge");
// Listen for messages from the extension host
(0, messageBridge_1.onMessageFromExtension)((message) => {
    console.log('[Code Cosmos Webview] message from extension:', message);
});
// Signal to the extension host that the webview is ready to receive data
// We do this AFTER setting up the listener so we don't miss any messages
(0, messageBridge_1.sendToExtension)({ type: 'READY' });
//# sourceMappingURL=main.js.map