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
}

export interface CosmosDependency {
  sourceId: string;
  targetId: string;
  layer: DependencyLayer;
  type: DependencyType;
}

export interface CosmosData {
  files: Record<string, CosmosFile>;
  folders: Record<string, CosmosFolder>;
  dependencies: CosmosDependency[];
  rootFolderId: string;
}
