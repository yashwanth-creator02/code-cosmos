// src/utils/logger.ts

import * as vscode from 'vscode';

let IS_DEV = false;

export function initLogger(extContext: vscode.ExtensionContext) {
  IS_DEV =
    extContext.extensionMode === vscode.ExtensionMode.Development;
}

export const logger = {
  log: (message: string, ...args: any[]) => {
    if (IS_DEV) {
      console.log('[Code Cosmos]', message, ...args);
    }
  },

  warn: (message: string, ...args: any[]) => {
    console.warn('[Code Cosmos]', message, ...args);

  },

  error: (message: string, ...args: any[]) => {
    console.error('[Code Cosmos]', message, ...args);
  }
};
