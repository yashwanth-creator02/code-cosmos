// src/types/index.ts

// ---------------------------------------------------------------------------
// File type enum
// ---------------------------------------------------------------------------

export enum FileType {
  TS = 'ts',
  JS = 'js',
  HTML = 'html',
  CSS = 'css',
  PY = 'py',
  JAVA = 'java',
  ASSET = 'asset',
  OTHER = 'other',
  RUST = 'rs',
  GO = 'go',
  CPP = 'cpp',
  RUBY = 'rb',
  PHP = 'php',
  SWIFT = 'swift',
  KOTLIN = 'kt',
  VUE = 'vue',
  SVELTE = 'svelte',
}

// ---------------------------------------------------------------------------
// Dependency enums
// ---------------------------------------------------------------------------

export enum DependencyLayer {
  DIRECT = 'direct',
  INDIRECT = 'indirect',
  CIRCULAR = 'circular',
  LAYER3_SHARED_DEPENDENT = 'layer3_shared_dependent',
  LAYER3_SHARED_DEPENDENCY = 'layer3_shared_dependency',
}

export enum DependencyType {
  IMPORT = 'import',
  REFERENCE = 'reference',
  LINK = 'link',
}

export enum DependencyResolutionKind {
  RELATIVE = 'relative',
  ALIAS = 'alias',
  BASE_URL = 'base_url',
  ROOT_RELATIVE = 'root_relative',
  WORKSPACE = 'workspace',
  JAVA_PACKAGE = 'java_package',
}

export enum DependencyReferenceKind {
  STATIC_IMPORT = 'static_import',
  RE_EXPORT = 're_export',
  COMMONJS_REQUIRE = 'commonjs_require',
  DYNAMIC_IMPORT = 'dynamic_import',
  IMPORT_META_URL = 'import_meta_url',
  TEST_MOCK = 'test_mock',
  TRIPLE_SLASH = 'triple_slash',
  HTML_ATTRIBUTE = 'html_attribute',
  HTML_SRCSET = 'html_srcset',
  CSS_IMPORT = 'css_import',
  CSS_URL = 'css_url',
  PYTHON_IMPORT = 'python_import',
  JAVA_IMPORT = 'java_import',
}

// ---------------------------------------------------------------------------
// Core data types
// ---------------------------------------------------------------------------

export interface CosmosFile {
  id: string;
  name: string;
  path: string;
  relativePath: string;
  extension: string;
  type: FileType;
  size: number; // bytes from vscode.FileStat — used for planet size encoding
  folderId: string;
}

export interface CosmosFolder {
  id: string;
  name: string;
  path: string;
  relativePath: string;
  parentId: string | null;
  fileIds: string[];
  childFolderIds: string[];
  offset?: { x: number; y: number; z: number };
}

export interface CosmosDependency {
  sourceId: string;
  targetId: string;
  layer: DependencyLayer;
  type: DependencyType;
  specifier?: string;
  resolvedBy?: DependencyResolutionKind;
  referenceKind?: DependencyReferenceKind;
  line?: number;
  character?: number;
}

export interface StarNode {
  folderId: string;
  position: { x: number; y: number; z: number };
  depth: number;
  childNodes: StarNode[];
  subtreeFileCount: number;
}

// ---------------------------------------------------------------------------
// Git data
// ---------------------------------------------------------------------------

export interface GitFileInfo {
  commitCount: number;
  daysSinceLastChange: number;
  hasUncommittedChanges: boolean;
  heat: number; // 0–1 normalised score: 0.7 * frequency + 0.3 * recency
}

export interface GitData {
  branch: string;
  fileInfo: Record<string, GitFileInfo>;
  available: boolean;
}

// ---------------------------------------------------------------------------
// Metrics — separate from CosmosFile so the core file map stays lightweight.
// Future diagnostic data (test coverage, TODO count, complexity) lands here,
// not in CosmosFile. The webview merges metrics into planet visuals at render time.
// ---------------------------------------------------------------------------

export interface CosmosFileMetrics {
  fileId: string;
  // Git metrics — populated from GitData when available
  heat?: number; // 0–1 churn score
  commitCount?: number;
  daysSinceLastChange?: number;
  hasUncommittedChanges?: boolean;
  // Future metric slots — add here when implementing, never in CosmosFile
  // testCoverage?: number;   // 0–1 percentage
  // todoCount?: number;
  // bugCount?: number;
  // cyclomaticComplexity?: number;
  // linesOfCode?: number;  // Note: CosmosFile.size is bytes, not LOC — LOC goes here
}

// ---------------------------------------------------------------------------
// Root data payload
// ---------------------------------------------------------------------------

export interface CosmosData {
  files: Record<string, CosmosFile>;
  folders: Record<string, CosmosFolder>;
  dependencies: CosmosDependency[];
  rootFolderId: string;
  workspaceRoots: Record<string, string>;
  starTree: StarNode | null;
  gitData: GitData | null;
  // Future: metrics will be sent as a separate optional payload or merged here
  // metrics?: Record<string, CosmosFileMetrics>;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * Structured settings — organised into logical tiers matching the toggle system.
 *
 * Tier 1 (structural): always on, cannot be meaningfully disabled
 * Tier 2 (data overlays): diagnostic information, on by default
 * Tier 3 (animations): expensive live effects, off by default
 *
 * Adding new settings: place in the correct tier section with a comment.
 * Never add a flat boolean directly — always add to the appropriate group.
 */
export interface SettingsState {
  // --- Tier 2: Dependency overlay toggles ---
  showDirectLines: boolean;
  showIndirectLines: boolean;
  showLayer3Lines: boolean;
  showCircularLines: boolean;

  // --- Tier 3: Animation toggles ---
  enableAnimation: boolean; // planet orbital animation
  enableStarRotation: boolean; // star axial rotation

  // --- Tier 2: Data overlay toggles ---
  showFolderLabels: boolean;
  showProximityLabels: boolean;
  showGitHeatmap: boolean;
  showMinimap: boolean;
  showLegend: boolean;

  // --- Tier 1: Rendering options (structural, but user-adjustable) ---
  showBackgroundStars: boolean;
  enableFog: boolean;

  // --- Performance ---
  performanceMode: boolean;

  // --- Misc ---
  orbitalSpeed: number; // multiplier, applies when enableAnimation is true
}

export const DEFAULT_SETTINGS: SettingsState = {
  // Dependency layers — direct + circular on, others off (reduces hairball on first open)
  showDirectLines: true,
  showIndirectLines: false,
  showLayer3Lines: false,
  showCircularLines: true,

  // Animations — off by default (performance safety)
  enableAnimation: false,
  enableStarRotation: true,
  orbitalSpeed: 1.0,

  // Data overlays
  showFolderLabels: true,
  showProximityLabels: true,
  showGitHeatmap: false,
  showMinimap: false,
  showLegend: true,

  // Rendering
  showBackgroundStars: true,
  enableFog: true,

  // Performance
  performanceMode: false,
};

// ---------------------------------------------------------------------------
// Filter state (webview-local, not persisted to settings)
// ---------------------------------------------------------------------------

export interface FilterState {
  visibleTypes: Set<FileType>;
}

// ---------------------------------------------------------------------------
// Webview message protocol
//
// All messages between extension and webview are typed here.
// Adding a new message: add it to the union type AND document it.
// ---------------------------------------------------------------------------

export type MessageToWebview =
  | { type: 'LOAD_UNIVERSE'; payload: CosmosData }
  | { type: 'APPLY_SETTINGS'; payload: SettingsState }
  | { type: 'FOCUS_FILE'; payload: { fileId: string } }
  | {
      type: 'COSMOS_STALE';
      payload: {};
      // Signals that the file system has changed since the last build.
      // The webview should show a non-intrusive "refresh available" indicator.
      // Cleared when LOAD_UNIVERSE is received.
    };

export type MessageFromWebview =
  | { type: 'READY' }
  | { type: 'OPEN_FILE'; payload: { fileId: string; line?: number; character?: number } }
  | { type: 'SAVE_SETTINGS'; payload: SettingsState }
  | { type: 'REFRESH' }
  | { type: 'EXPORT_IMAGE'; payload: { dataUrl: string } };
