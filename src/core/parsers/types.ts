import {
  CosmosDependency,
  DependencyResolutionKind,
  DependencyType,
  DependencyReferenceKind,
  DependencyLayer,
} from '../../types';

/**
 * Settings for the parser.
 */
export interface ParserSettings {
  /** Map of path aliases (e.g., { "@": "./src" }). */
  aliases: Record<string, string>;
  /** The base URL for non-relative imports. */
  baseUrl?: string;
}

/**
 * Context for a single parsing operation.
 */
export interface ParserContext {
  /** The unique identifier of the file being parsed. */
  fileId: string;
  /** The content of the file. */
  content: string;
  /** Parser settings. */
  settings: ParserSettings;
  /** A map of normalized paths to their actual file IDs. */
  normalizedFileIds: Record<string, string>;
  /** A map of Java class names to their package paths. */
  javaPackageIndex: Map<string, string>;
}

/**
 * Interface for language-specific parsers.
 */
export interface LanguageParser {
  /** File extensions supported by this parser. */
  extensions: string[];
  /**
   * Parses the given context to extract dependencies.
   * @param context The parser context.
   * @returns A list of cosmos dependencies.
   */
  parse(context: ParserContext): Promise<CosmosDependency[]> | CosmosDependency[];
}

/**
 * Helper to create a direct dependency object.
 * @param sourceId The ID of the source file.
 * @param targetId The ID of the target file.
 * @param type The type of dependency.
 * @param specifier The import specifier.
 * @param referenceKind The kind of reference.
 * @param resolvedBy The resolution method used.
 * @param line The line number (1-based).
 * @param character The character position (1-based).
 * @returns A cosmos dependency object.
 */
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
