import {
  CosmosDependency,
  DependencyType,
  DependencyReferenceKind,
  DependencyResolutionKind,
} from '../../types';
import { LanguageParser, ParserContext, createDirectDependency } from './types';
import { resolveImport, isExternalSpecifier, getPosition } from './utils';

/**
 * Parser for CSS, SCSS, and SASS files.
 * Extracts @import and url() dependencies.
 */
export class CssParser implements LanguageParser {
  /**
   * The list of file extensions supported by this parser.
   */
  extensions = ['css', 'scss', 'sass'];

  /**
   * Parses the content of a CSS file to find its import and asset dependencies.
   * @param context The parser context containing file content and metadata.
   * @returns An array of detected dependencies.
   */
  parse(context: ParserContext): CosmosDependency[] {
    const { content, fileId, settings, normalizedFileIds } = context;
    const deps: CosmosDependency[] = [];
    const importRegex = /@(import|use|forward)\s+(?:url\(\s*)?['"]?([^'"\);\s]+)['"]?\s*\)?/g;

    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(content)) !== null) {
      const resolved = resolveImport(match[2], fileId, settings, normalizedFileIds, true);
      if (!resolved) {
        continue;
      }

      const pos = getPosition(content, match.index);
      deps.push(
        createDirectDependency(
          fileId,
          resolved.targetId,
          DependencyType.IMPORT,
          match[2],
          DependencyReferenceKind.CSS_IMPORT,
          resolved.resolvedBy,
          pos.line,
          pos.character
        )
      );
    }

    const urlRegex = /\burl\(\s*['"]?([^'"\)]+)['"]?\s*\)/g;
    while ((match = urlRegex.exec(content)) !== null) {
      const prefix = content.slice(Math.max(0, match.index - 12), match.index).toLowerCase();
      if (/@import\s*$/.test(prefix)) {
        continue;
      }

      const refPath = match[1].trim();
      if (isExternalSpecifier(refPath)) {
        continue;
      }

      const resolved = resolveImport(refPath, fileId, settings, normalizedFileIds, true);
      if (!resolved) {
        // Fallback for CSS URL often points to assets
        continue;
      }

      const pos = getPosition(content, match.index);
      deps.push(
        createDirectDependency(
          fileId,
          resolved.targetId,
          DependencyType.REFERENCE,
          refPath,
          DependencyReferenceKind.CSS_URL,
          resolved.resolvedBy,
          pos.line,
          pos.character
        )
      );
    }

    return deps;
  }
}
