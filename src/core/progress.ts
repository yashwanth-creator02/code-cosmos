// src/core/progress.ts
//
// Shared progress-reporting type used by fileTree.ts, dependencyParser.ts,
// and gitReader.ts. Each phase reports its own current/total — the caller
// (extension.ts) maps phase + current/total into an overall percentage and
// forwards it to the webview as a SCAN_PROGRESS message.
//
// Kept as a plain callback (not an EventEmitter) so these core modules stay
// framework-agnostic and easy to unit test without a VS Code context.

/**
 * Phases of the codebase scanning and parsing process.
 */
export type ScanPhase = 'scan' | 'parse' | 'git';

/**
 * Callback function used to report progress during long-running operations.
 *
 * @param phase - The current phase of the process.
 * @param current - The number of items processed so far.
 * @param total - The total number of items to process.
 */
export type ProgressCallback = (phase: ScanPhase, current: number, total: number) => void;

/**
 * No-op default progress callback that does nothing.
 * Used as a default parameter so call sites can omit the callback safely.
 */
export const noopProgress: ProgressCallback = () => {};
