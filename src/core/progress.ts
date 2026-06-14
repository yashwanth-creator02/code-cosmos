// src/core/progress.ts
//
// Shared progress-reporting type used by fileTree.ts, dependencyParser.ts,
// and gitReader.ts. Each phase reports its own current/total — the caller
// (extension.ts) maps phase + current/total into an overall percentage and
// forwards it to the webview as a SCAN_PROGRESS message.
//
// Kept as a plain callback (not an EventEmitter) so these core modules stay
// framework-agnostic and easy to unit test without a VS Code context.

export type ScanPhase = 'scan' | 'parse' | 'git';

export type ProgressCallback = (phase: ScanPhase, current: number, total: number) => void;

/** No-op default so every call site can omit the callback safely. */
export const noopProgress: ProgressCallback = () => {};
