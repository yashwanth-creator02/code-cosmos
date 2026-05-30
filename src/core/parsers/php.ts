import {
  CosmosDependency,
  DependencyType,
  DependencyReferenceKind,
  DependencyResolutionKind,
  DependencyLayer,
} from '../../types';
import { LanguageParser, ParserContext, createDirectDependency } from './types';
import { normalizePath } from './utils';

export class PhpParser implements LanguageParser {
  extensions = ['php'];

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
