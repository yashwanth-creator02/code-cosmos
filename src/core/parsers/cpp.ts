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
 * Parser for C and C++ source and header files.
 * Extracts include dependencies using regular expressions.
 */
export class CCppParser implements LanguageParser {
  /**
   * The list of file extensions supported by this parser.
   */
  extensions = ['c', 'cpp', 'cc', 'cxx', 'h', 'hpp'];

  /**
   * Parses the content of a C/C++ file to find its include dependencies.
   * @param context The parser context containing file content and metadata.
   * @returns An array of detected dependencies.
   */
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
