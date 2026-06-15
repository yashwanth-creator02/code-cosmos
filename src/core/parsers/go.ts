import {
  CosmosDependency,
  DependencyType,
  DependencyReferenceKind,
  DependencyResolutionKind,
  DependencyLayer,
} from '../../types';
import { LanguageParser, ParserContext, createDirectDependency } from './types';
import { normalizePath } from './utils';

/**
 * Parser for Go source files.
 * Extracts relative import dependencies.
 */
export class GoParser implements LanguageParser {
  /**
   * The list of file extensions supported by this parser.
   */
  extensions = ['go'];

  /**
   * Parses the content of a Go file to find its relative import dependencies.
   * @param context The parser context containing file content and metadata.
   * @returns An array of detected dependencies.
   */
  parse(context: ParserContext): CosmosDependency[] {
    const { content, fileId, normalizedFileIds } = context;
    const deps: CosmosDependency[] = [];
    const sourceDir = normalizePath(fileId).replace(/\/[^\/]+$/, '');

    const importRegex = /import\s+(?:[\w]+\s+)?["`]([^"`]+)["`]/g;
    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(content)) !== null) {
      const importPath = match[1];
      if (!importPath.startsWith('.')) {
        continue;
      }
      const candidate = normalizePath(`${sourceDir}/${importPath}`);
      for (const [norm, orig] of Object.entries(normalizedFileIds)) {
        if (norm.startsWith(candidate + '/') && norm.endsWith('.go')) {
          deps.push({
            sourceId: fileId,
            targetId: orig,
            layer: DependencyLayer.DIRECT,
            type: DependencyType.IMPORT,
            specifier: importPath,
            referenceKind: DependencyReferenceKind.STATIC_IMPORT,
            resolvedBy: DependencyResolutionKind.RELATIVE,
          });
          break;
        }
      }
    }

    return deps;
  }
}
