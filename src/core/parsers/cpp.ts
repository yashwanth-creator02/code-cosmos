import {
  CosmosDependency,
  DependencyType,
  DependencyReferenceKind,
  DependencyResolutionKind,
  DependencyLayer,
} from '../../types';
import { LanguageParser, ParserContext, createDirectDependency } from './types';
import { normalizePath } from './utils';

export class CCppParser implements LanguageParser {
  extensions = ['c', 'cpp', 'cc', 'cxx', 'h', 'hpp'];

  parse(context: ParserContext): CosmosDependency[] {
    const { content, fileId, normalizedFileIds } = context;
    const deps: CosmosDependency[] = [];
    const sourceDir = normalizePath(fileId).replace(/\/[^\/]+$/, '');

    const includeRegex = /^\s*#\s*include\s+"([^"]+)"/gm;
    let match: RegExpExecArray | null;
    while ((match = includeRegex.exec(content)) !== null) {
      const includePath = match[1];
      const candidates = [normalizePath(`${sourceDir}/${includePath}`), normalizePath(includePath)];
      for (const candidate of candidates) {
        const resolved = normalizedFileIds[candidate];
        if (resolved && resolved !== fileId) {
          deps.push({
            sourceId: fileId,
            targetId: resolved,
            layer: DependencyLayer.DIRECT,
            type: DependencyType.REFERENCE,
            specifier: includePath,
            referenceKind: DependencyReferenceKind.HTML_ATTRIBUTE,
            resolvedBy: DependencyResolutionKind.RELATIVE,
          });
          break;
        }
      }
    }

    return deps;
  }
}
