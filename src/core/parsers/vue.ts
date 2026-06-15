import {
  CosmosDependency,
  DependencyType,
  DependencyReferenceKind,
  DependencyResolutionKind,
  DependencyLayer,
} from '../../types';
import { LanguageParser, ParserContext, createDirectDependency } from './types';
import { normalizePath } from './utils';
import { JavaScriptParser } from './javascript';

/**
 * Parser for Vue Single File Components (.vue).
 * It extracts dependencies from both <script> blocks and <template> tags.
 */
export class VueParser implements LanguageParser {
  /** File extensions supported by this parser. */
  extensions = ['vue'];
  private jsParser = new JavaScriptParser();

  /**
   * Parses a Vue file to extract dependencies.
   * @param context The parser context.
   * @returns A list of cosmos dependencies.
   */
  parse(context: ParserContext): CosmosDependency[] {
    const { content, fileId, normalizedFileIds } = context;
    const deps: CosmosDependency[] = [];

    const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    if (scriptMatch) {
      deps.push(...this.jsParser.parse({ ...context, content: scriptMatch[1] }));
    }

    const sourceDir = normalizePath(fileId).replace(/\/[^\/]+$/, '');
    const templateMatch = content.match(/<template[^>]*>([\s\S]*?)<\/template>/);
    if (templateMatch) {
      const tagRegex = /<([A-Z][a-zA-Z0-9]+)/g;
      let match: RegExpExecArray | null;
      while ((match = tagRegex.exec(templateMatch[1])) !== null) {
        const componentName = match[1];
        const candidates = [
          `${sourceDir}/${componentName}.vue`,
          `${sourceDir}/components/${componentName}.vue`,
          `${sourceDir}/${componentName}/index.vue`,
        ];
        for (const c of candidates) {
          const resolved = normalizedFileIds[normalizePath(c)];
          if (resolved && resolved !== fileId) {
            deps.push({
              sourceId: fileId,
              targetId: resolved,
              layer: DependencyLayer.DIRECT,
              type: DependencyType.REFERENCE,
              specifier: componentName,
              referenceKind: DependencyReferenceKind.HTML_ATTRIBUTE,
              resolvedBy: DependencyResolutionKind.RELATIVE,
            });
            break;
          }
        }
      }
    }

    return deps;
  }
}
