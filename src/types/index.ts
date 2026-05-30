// src/types/index.ts

export enum FileType {
  TS = 'ts',
  JS = 'js',
  HTML = 'html',
  CSS = 'css',
  PY = 'py',
  JAVA = 'java',
  ASSET = 'asset',
  OTHER = 'other',
  // New languages
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

export interface CosmosFile {
  id: string;
  name: string;
  path: string;
  relativePath: string;
  extension: string;
  type: FileType;
  size: number;
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

export interface CosmosData {
  files: Record<string, CosmosFile>;
  folders: Record<string, CosmosFolder>;
  dependencies: CosmosDependency[];
  rootFolderId: string;
  workspaceRoots: Record<string, string>;
  starTree: StarNode | null;
  gitData: GitData | null;
}

export interface SettingsState {
  showDirectLines: boolean;
  showIndirectLines: boolean;
  showLayer3Lines: boolean;
  showCircularLines: boolean;
  enableAnimation: boolean;
  enableStarRotation: boolean;
  orbitalSpeed: number;
  showFolderLabels: boolean;
  showProximityLabels: boolean;
  showBackgroundStars: boolean;
  enableFog: boolean;
  showLegend: boolean;
  performanceMode: boolean;
  showMinimap: boolean;
  showGitHeatmap: boolean;
}

export const DEFAULT_SETTINGS: SettingsState = {
  showDirectLines: true,
  showIndirectLines: false,
  showLayer3Lines: false,
  showCircularLines: true,
  enableAnimation: false,
  enableStarRotation: true,
  orbitalSpeed: 1.0,
  showFolderLabels: true,
  showProximityLabels: true,
  showBackgroundStars: true,
  enableFog: true,
  showLegend: true,
  performanceMode: false,
  showMinimap: false,
  showGitHeatmap: false,
};

export interface FilterState {
  visibleTypes: Set<FileType>;
}

export interface GitFileInfo {
  commitCount: number;
  daysSinceLastChange: number;
  hasUncommittedChanges: boolean;
  heat: number;
}

export interface GitData {
  branch: string;
  fileInfo: Record<string, GitFileInfo>;
  available: boolean;
}
