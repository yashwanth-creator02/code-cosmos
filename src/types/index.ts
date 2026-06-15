// src/types/index.ts

/**
 * Supported file types in Code Cosmos.
 */
export enum FileType {
  /** TypeScript file */
  TS = 'ts',
  /** JavaScript file */
  JS = 'js',
  /** HTML file */
  HTML = 'html',
  /** CSS file */
  CSS = 'css',
  /** Python file */
  PY = 'py',
  /** Java file */
  JAVA = 'java',
  /** Image or other asset file */
  ASSET = 'asset',
  /** Fallback for unknown file types */
  OTHER = 'other',
  /** Rust file */
  RUST = 'rs',
  /** Go file */
  GO = 'go',
  /** C++ file */
  CPP = 'cpp',
  /** Ruby file */
  RUBY = 'rb',
  /** PHP file */
  PHP = 'php',
  /** Swift file */
  SWIFT = 'swift',
  /** Kotlin file */
  KOTLIN = 'kt',
  /** Vue file */
  VUE = 'vue',
  /** Svelte file */
  SVELTE = 'svelte',
}

/**
 * Layers of the dependency graph for visual distinction.
 */
export enum DependencyLayer {
  /** Direct import from source to target */
  DIRECT = 'direct',
  /** Indirect dependency (A -> B -> C) */
  INDIRECT = 'indirect',
  /** Circular dependency chain */
  CIRCULAR = 'circular',
  /** Shared dependent (Layer 3) */
  LAYER3_SHARED_DEPENDENT = 'layer3_shared_dependent',
  /** Shared dependency (Layer 3) */
  LAYER3_SHARED_DEPENDENCY = 'layer3_shared_dependency',
}

/**
 * Basic types of dependencies.
 */
export enum DependencyType {
  /** Standard import/require */
  IMPORT = 'import',
  /** Type reference or similar */
  REFERENCE = 'reference',
  /** Generic link */
  LINK = 'link',
}

/**
 * Methods used to resolve a dependency path.
 */
export enum DependencyResolutionKind {
  /** Relative path resolution */
  RELATIVE = 'relative',
  /** Path alias resolution (e.g., from tsconfig) */
  ALIAS = 'alias',
  /** Base URL-based resolution */
  BASE_URL = 'base_url',
  /** Root-relative resolution */
  ROOT_RELATIVE = 'root_relative',
  /** Workspace-relative resolution */
  WORKSPACE = 'workspace',
  /** Java package name resolution */
  JAVA_PACKAGE = 'java_package',
}

/**
 * Specific syntax or mechanism used to reference a dependency.
 */
export enum DependencyReferenceKind {
  /** Static ES module import */
  STATIC_IMPORT = 'static_import',
  /** Re-export (export ... from) */
  RE_EXPORT = 're_export',
  /** CommonJS require() */
  COMMONJS_REQUIRE = 'commonjs_require',
  /** Dynamic import() */
  DYNAMIC_IMPORT = 'dynamic_import',
  /** import.meta.url reference */
  IMPORT_META_URL = 'import_meta_url',
  /** Test mock reference */
  TEST_MOCK = 'test_mock',
  /** TypeScript triple-slash reference */
  TRIPLE_SLASH = 'triple_slash',
  /** HTML attribute reference (e.g., <script src="...">) */
  HTML_ATTRIBUTE = 'html_attribute',
  /** HTML srcset attribute */
  HTML_SRCSET = 'html_srcset',
  /** CSS @import rule */
  CSS_IMPORT = 'css_import',
  /** CSS url() function */
  CSS_URL = 'css_url',
  /** Python import statement */
  PYTHON_IMPORT = 'python_import',
  /** Java import statement */
  JAVA_IMPORT = 'java_import',
}

/**
 * Represents a file in the cosmos.
 */
export interface CosmosFile {
  /** Unique identifier (usually relative path) */
  id: string;
  /** Display name of the file */
  name: string;
  /** Absolute filesystem path */
  path: string;
  /** Path relative to the workspace root */
  relativePath: string;
  /** File extension without dot */
  extension: string;
  /** Categorized file type */
  type: FileType;
  /** Size in bytes */
  size: number;
  /** ID of the folder containing this file */
  folderId: string;
}

/**
 * Represents a folder in the cosmos.
 */
export interface CosmosFolder {
  /** Unique identifier (usually relative path) */
  id: string;
  /** Display name of the folder */
  name: string;
  /** Absolute filesystem path */
  path: string;
  /** Path relative to the workspace root */
  relativePath: string;
  /** ID of the parent folder, or null for root */
  parentId: string | null;
  /** List of file IDs in this folder */
  fileIds: string[];
  /** List of subfolder IDs */
  childFolderIds: string[];
  /** Optional 3D offset for spatial layout */
  offset?: { x: number; y: number; z: number };
}

/**
 * Represents a dependency between two files.
 */
export interface CosmosDependency {
  /** ID of the source file */
  sourceId: string;
  /** ID of the target file */
  targetId: string;
  /** Visual layer this dependency belongs to */
  layer: DependencyLayer;
  /** Type of dependency */
  type: DependencyType;
  /** Original import specifier string */
  specifier?: string;
  /** Resolution mechanism used */
  resolvedBy?: DependencyResolutionKind;
  /** Syntax used for the reference */
  referenceKind?: DependencyReferenceKind;
  /** Line number in source file (1-based) */
  line?: number;
  /** Character position in source file (1-based) */
  character?: number;
}

/**
 * Node in the star tree hierarchy used for spatial layout.
 */
export interface StarNode {
  /** ID of the folder this star represents */
  folderId: string;
  /** 3D position in the cosmos */
  position: { x: number; y: number; z: number };
  /** Depth in the folder hierarchy */
  depth: number;
  /** Child nodes in the tree */
  childNodes: StarNode[];
  /** Total number of files in this subtree */
  subtreeFileCount: number;
}

/**
 * Git metadata for a single file.
 */
export interface GitFileInfo {
  /** Number of commits involving this file */
  commitCount: number;
  /** Days elapsed since the last commit to this file */
  daysSinceLastChange: number;
  /** Whether the file has uncommitted changes */
  hasUncommittedChanges: boolean;
  /** Normalized heat score (0-1) based on churn and recency */
  heat: number;
}

/**
 * Overall git data for a workspace.
 */
export interface GitData {
  /** Current active branch name */
  branch: string;
  /** Map of file ID to git metadata */
  fileInfo: Record<string, GitFileInfo>;
  /** Whether git data is available for this workspace */
  available: boolean;
}

/**
 * Performance and health metrics for a file.
 */
export interface CosmosFileMetrics {
  /** ID of the file */
  fileId: string;
  /** Heat score (churn) */
  heat?: number;
  /** Total commit count */
  commitCount?: number;
  /** Days since last modification */
  daysSinceLastChange?: number;
  /** Whether uncommitted changes exist */
  hasUncommittedChanges?: boolean;
}

/**
 * Complete data payload sent to the webview.
 */
export interface CosmosData {
  /** Map of file ID to file data */
  files: Record<string, CosmosFile>;
  /** Map of folder ID to folder data */
  folders: Record<string, CosmosFolder>;
  /** List of all dependencies */
  dependencies: CosmosDependency[];
  /** ID of the root folder */
  rootFolderId: string;
  /** Map of workspace names to absolute paths */
  workspaceRoots: Record<string, string>;
  /** Root of the star tree for 3D layout */
  starTree: StarNode | null;
  /** Git metadata for the workspace */
  gitData: GitData | null;
}

/**
 * State of the webview settings and preferences.
 */
export interface SettingsState {
  /** Show direct dependency lines */
  showDirectLines: boolean;
  /** Show indirect dependency lines */
  showIndirectLines: boolean;
  /** Show Layer 3 (shared dependency) lines */
  showLayer3Lines: boolean;
  /** Show circular dependency lines */
  showCircularLines: boolean;

  /** Enable planet orbital animation */
  enableAnimation: boolean;
  /** Enable star axial rotation animation */
  enableStarRotation: boolean;

  /** Show labels for folders (stars) */
  showFolderLabels: boolean;
  /** Show labels for planets on proximity */
  showProximityLabels: boolean;
  /** Use git heat score for planet coloring */
  showGitHeatmap: boolean;
  /** Show the 2D minimap overlay */
  showMinimap: boolean;
  /** Show the visual legend */
  showLegend: boolean;

  /** Show background starfield */
  showBackgroundStars: boolean;
  /** Enable distance fog effects */
  enableFog: boolean;

  /** Enable performance mode (reduced visual quality) */
  performanceMode: boolean;

  /** Speed multiplier for orbital animations */
  orbitalSpeed: number;
  /** Multiplier for star/planet spacing from origin */
  spacingFactor: number;
}

/**
 * Default settings for the cosmos.
 */
export const DEFAULT_SETTINGS: SettingsState = {
  showDirectLines: true,
  showIndirectLines: false,
  showLayer3Lines: false,
  showCircularLines: true,

  enableAnimation: false,
  enableStarRotation: true,
  orbitalSpeed: 1.0,
  spacingFactor: 1.0,

  showFolderLabels: true,
  showProximityLabels: true,
  showGitHeatmap: false,
  showMinimap: false,
  showLegend: true,

  showBackgroundStars: true,
  enableFog: true,

  performanceMode: false,
};

/**
 * Local filter state for the webview.
 */
export interface FilterState {
  /** Set of file types currently visible */
  visibleTypes: Set<FileType>;
}

/**
 * State of the 3D camera.
 */
export interface CameraState {
  /** Camera position in 3D space */
  position: { x: number; y: number; z: number };
  /** Look-at target position */
  target: { x: number; y: number; z: number };
}

/**
 * A named camera position bookmark.
 */
export interface NamedCameraSlot {
  /** Name given to the bookmark */
  name: string;
  /** Camera state to restore */
  camera: CameraState;
}

/**
 * Persistent navigation data.
 */
export interface NavigationData {
  /** Default home position for the camera */
  homePosition: CameraState | null;
  /** List of named camera bookmarks */
  namedSlots: NamedCameraSlot[];
  /** History of recent camera states */
  cameraHistory: CameraState[];
}

/**
 * Progress report for codebase scanning and parsing.
 */
export interface ScanProgressPayload {
  /** Completion percentage (0-100) */
  percent: number;
  /** Current phase of the operation */
  phase: 'scan' | 'parse' | 'git' | 'cache' | 'render';
  /** Human-readable status message */
  message: string;
}

/**
 * Union type for messages sent from the extension to the webview.
 */
export type MessageToWebview =
  | { type: 'LOAD_UNIVERSE'; payload: CosmosData }
  | { type: 'APPLY_SETTINGS'; payload: SettingsState }
  | { type: 'APPLY_NAVIGATION'; payload: NavigationData }
  | { type: 'FOCUS_FILE'; payload: { fileId: string } }
  | { type: 'SCAN_PROGRESS'; payload: ScanProgressPayload }
  | { type: 'COSMOS_STALE'; payload: {} };

/**
 * Union type for messages sent from the webview to the extension.
 */
export type MessageFromWebview =
  | { type: 'READY' }
  | { type: 'OPEN_FILE'; payload: { fileId: string; line?: number; character?: number } }
  | { type: 'SAVE_SETTINGS'; payload: SettingsState }
  | { type: 'SAVE_NAVIGATION'; payload: Partial<NavigationData> }
  | { type: 'REFRESH' }
  | { type: 'EXPORT_IMAGE'; payload: { dataUrl: string } };
