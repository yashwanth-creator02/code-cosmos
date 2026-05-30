import { CosmosDependency, DependencyType, DependencyReferenceKind } from '../../types';
import { LanguageParser, ParserContext, createDirectDependency } from './types';
import { resolveImport, getPosition } from './utils';

interface DependencyPattern {
  regex: RegExp;
  type: DependencyType;
  referenceKind: DependencyReferenceKind;
}

export class JavaScriptParser implements LanguageParser {
  extensions = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'];

  parse(context: ParserContext): CosmosDependency[] {
    const { content, fileId, settings, normalizedFileIds } = context;
    const deps: CosmosDependency[] = [];

    // Replace comments with spaces to preserve indices
    const withoutComments = content
      .replace(/\/\/.*$/gm, (m) => ' '.repeat(m.length))
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

    const tripleSlashRegex = /\/\/\/\s*<reference\s+path=["']([^"']+)["']/g;
    let tripleSlashMatch: RegExpExecArray | null;
    while ((tripleSlashMatch = tripleSlashRegex.exec(content)) !== null) {
      const resolved = resolveImport(tripleSlashMatch[1], fileId, settings, normalizedFileIds);
      if (resolved) {
        const pos = getPosition(content, tripleSlashMatch.index);
        deps.push(
          createDirectDependency(
            fileId,
            resolved.targetId,
            DependencyType.REFERENCE,
            tripleSlashMatch[1],
            DependencyReferenceKind.TRIPLE_SLASH,
            resolved.resolvedBy,
            pos.line,
            pos.character
          )
        );
      }
    }

    const patterns: DependencyPattern[] = [
      {
        regex: /\bimport\s+(?:type\s+)?(?:[\w*$\s{},]+\s+from\s+)?['"]([^'"]+)['"]/g,
        type: DependencyType.IMPORT,
        referenceKind: DependencyReferenceKind.STATIC_IMPORT,
      },
      {
        regex:
          /\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g,
        type: DependencyType.IMPORT,
        referenceKind: DependencyReferenceKind.RE_EXPORT,
      },
      {
        regex: /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
        type: DependencyType.IMPORT,
        referenceKind: DependencyReferenceKind.COMMONJS_REQUIRE,
      },
      {
        regex: /\brequire\.resolve\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
        type: DependencyType.REFERENCE,
        referenceKind: DependencyReferenceKind.COMMONJS_REQUIRE,
      },
      {
        regex: /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
        type: DependencyType.IMPORT,
        referenceKind: DependencyReferenceKind.DYNAMIC_IMPORT,
      },
      {
        regex: /\bnew\s+URL\s*\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g,
        type: DependencyType.REFERENCE,
        referenceKind: DependencyReferenceKind.IMPORT_META_URL,
      },
      {
        regex:
          /\b(?:jest|vi)\.(?:mock|doMock|unmock|requireActual|requireMock)\s*\(\s*['"]([^'"]+)['"]/g,
        type: DependencyType.REFERENCE,
        referenceKind: DependencyReferenceKind.TEST_MOCK,
      },
    ];

    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.regex.exec(withoutComments)) !== null) {
        const resolved = resolveImport(match[1], fileId, settings, normalizedFileIds);
        if (!resolved) {
          continue;
        }

        const pos = getPosition(content, match.index);
        deps.push(
          createDirectDependency(
            fileId,
            resolved.targetId,
            pattern.type,
            match[1],
            pattern.referenceKind,
            resolved.resolvedBy,
            pos.line,
            pos.character
          )
        );
      }
    }

    return deps;
  }
}
