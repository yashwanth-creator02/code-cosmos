import {
  CosmosDependency,
  DependencyResolutionKind,
  DependencyType,
  DependencyReferenceKind,
  DependencyLayer,
} from '../../types';

export interface ParserSettings {
  aliases: Record<string, string>;
  baseUrl?: string;
}

export interface ParserContext {
  fileId: string;
  content: string;
  settings: ParserSettings;
  normalizedFileIds: Record<string, string>;
  javaPackageIndex: Map<string, string>;
}

export interface LanguageParser {
  extensions: string[];
  parse(context: ParserContext): Promise<CosmosDependency[]> | CosmosDependency[];
}

export function createDirectDependency(
  sourceId: string,
  targetId: string,
  type: DependencyType,
  specifier: string,
  referenceKind: DependencyReferenceKind,
  resolvedBy: DependencyResolutionKind,
  line?: number,
  character?: number
): CosmosDependency {
  return {
    sourceId,
    targetId,
    layer: DependencyLayer.DIRECT,
    type,
    specifier: specifier.trim(),
    resolvedBy,
    referenceKind,
    line,
    character,
  };
}
