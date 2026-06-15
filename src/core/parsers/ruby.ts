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
 * Parser for Ruby files to extract require and require_relative dependencies.
 */
export class RubyParser implements LanguageParser {
  /** Supported file extensions for this parser. */
  extensions = ['rb'];

  /**
   * Parses Ruby content to find 'require' and 'require_relative' statements.
   * @param context The parser context containing file content and settings.
   * @returns An array of extracted dependencies.
   */
  parse(context: ParserContext): CosmosDependency[] {
    const { content, fileId, normalizedFileIds } = context;
    const deps: CosmosDependency[] = [];
    const sourceDir = normalizePath(fileId).replace(/\/[^\/]+$/, '');

    const relativeRegex = /require_relative\s+['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;
    while ((match = relativeRegex.exec(content)) !== null) {
      const p = match[1];
      const base = normalizePath(`${sourceDir}/${p}`);
      const resolved = normalizedFileIds[base] || normalizedFileIds[base + '.rb'];
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

    const requireRegex = /\brequire\s+['"](\.{1,2}\/[^'"]+)['"]/g;
    while ((match = requireRegex.exec(content)) !== null) {
      const p = match[1];
      const base = normalizePath(`${sourceDir}/${p}`);
      const resolved = normalizedFileIds[base] || normalizedFileIds[base + '.rb'];
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
