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
 * Parser for PHP files that identifies dependencies in include and require statements.
 */
export class PhpParser implements LanguageParser {
  /**
   * File extensions supported by this parser.
   */
  extensions = ['php'];

  /**
   * Parses PHP content to find file dependencies.
   *
   * @param context The parser context containing file content and metadata.
   * @returns An array of discovered dependencies.
   */
  parse(context: ParserContext): CosmosDependency[] {
    const { content, fileId, normalizedFileIds } = context;
    const deps: CosmosDependency[] = [];
    const sourceDir = normalizePath(fileId).replace(/\/[^\/]+$/, '');

    const phpRegex = /(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;
    while ((match = phpRegex.exec(content)) !== null) {
      const p = match[1];
      if (!p.startsWith('.') && !p.startsWith('/')) {
        continue;
      }
      const base = p.startsWith('.') ? normalizePath(`${sourceDir}/${p}`) : normalizePath(p);
      const resolved = normalizedFileIds[base];
      if (resolved && resolved !== fileId) {
        deps.push({
          sourceId: fileId,
          targetId: resolved,
          layer: DependencyLayer.DIRECT,
          type: DependencyType.IMPORT,
          specifier: p,
          referenceKind: DependencyReferenceKind.COMMONJS_REQUIRE,
          resolvedBy: DependencyResolutionKind.RELATIVE,
        });
      }
    }

    return deps;
  }
}
