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

export class SvelteParser implements LanguageParser {
  extensions = ['svelte'];
  private jsParser = new JavaScriptParser();

  parse(context: ParserContext): CosmosDependency[] {
    const { content, fileId, normalizedFileIds } = context;
    const deps: CosmosDependency[] = [];
    const sourceDir = normalizePath(fileId).replace(/\/[^\/]+$/, '');

    const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    if (scriptMatch) {
      deps.push(...this.jsParser.parse({ ...context, content: scriptMatch[1] }));
    }

    const tagRegex = /<([A-Z][a-zA-Z0-9]+)/g;
    let match: RegExpExecArray | null;
    while ((match = tagRegex.exec(content)) !== null) {
      const name = match[1];
      const candidates = [`${sourceDir}/${name}.svelte`, `${sourceDir}/components/${name}.svelte`];
      for (const c of candidates) {
        const resolved = normalizedFileIds[normalizePath(c)];
        if (resolved && resolved !== fileId) {
          deps.push({
            sourceId: fileId,
            targetId: resolved,
            layer: DependencyLayer.DIRECT,
            type: DependencyType.REFERENCE,
            specifier: name,
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
