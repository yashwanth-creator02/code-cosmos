import {
  CosmosDependency,
  DependencyType,
  DependencyReferenceKind,
  DependencyResolutionKind,
  DependencyLayer,
} from '../../types';
import { LanguageParser, ParserContext, createDirectDependency } from './types';
import { normalizePath } from './utils';

export class RustParser implements LanguageParser {
  extensions = ['rs'];

  parse(context: ParserContext): CosmosDependency[] {
    const { content, fileId, normalizedFileIds } = context;
    const deps: CosmosDependency[] = [];
    const sourceDir = normalizePath(fileId).replace(/\/[^\/]+$/, '');

    const modRegex = /^\s*(?:pub\s+)?mod\s+(\w+)\s*;/gm;
    let match: RegExpExecArray | null;
    while ((match = modRegex.exec(content)) !== null) {
      const modName = match[1];
      const candidates = [`${sourceDir}/${modName}.rs`, `${sourceDir}/${modName}/mod.rs`];
      for (const candidate of candidates) {
        const resolved = normalizedFileIds[candidate];
        if (resolved && resolved !== fileId) {
          deps.push({
            sourceId: fileId,
            targetId: resolved,
            layer: DependencyLayer.DIRECT,
            type: DependencyType.IMPORT,
            specifier: modName,
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
