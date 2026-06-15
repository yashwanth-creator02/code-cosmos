// src/utils/logger.ts

import * as vscode from 'vscode';

let IS_DEV = false;

/**
 * Initializes the logger with the extension context to determine development mode.
 * @param extContext The extension context.
 */
export function initLogger(extContext: vscode.ExtensionContext): void {
  IS_DEV = extContext.extensionMode === vscode.ExtensionMode.Development;
}

/**
 * Global logger for the Code Cosmos extension.
 */
export const logger = {
  /**
   * Logs a message to the console if in development mode.
   * @param message The message to log.
   * @param args Additional arguments.
   */
  log: (message: string, ...args: any[]) => {
    if (IS_DEV) {
      console.log('[Code Cosmos]', message, ...args);
    }
  },

  /**
   * Logs a warning message to the console.
   * @param message The warning message.
   * @param args Additional arguments.
   */
  warn: (message: string, ...args: any[]) => {
    console.warn('[Code Cosmos]', message, ...args);
  },

  /**
   * Logs an error message to the console.
   * @param message The error message.
   * @param args Additional arguments.
   */
  error: (message: string, ...args: any[]) => {
    console.error('[Code Cosmos]', message, ...args);
  },
};
