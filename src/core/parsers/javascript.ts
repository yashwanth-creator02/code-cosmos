import { CosmosDependency, DependencyType, DependencyReferenceKind } from '../../types';
import { LanguageParser, ParserContext, createDirectDependency } from './types';
import { resolveImport, getPosition } from './utils';

/**
 * Represents a regular expression pattern used to identify dependencies in JavaScript/TypeScript code.
 */
interface DependencyPattern {
  /**
   * The regex to match the dependency statement.
   */
  regex: RegExp;
  /**
   * The type of dependency (e.g., IMPORT, REFERENCE).
   */
  type: DependencyType;
  /**
   * Specific sub-kind of the dependency (e.g., STATIC_IMPORT, DYNAMIC_IMPORT).
   */
  referenceKind: DependencyReferenceKind;
}

/**
 * Parser for JavaScript and TypeScript files (including JSX/TSX).
 * Supports ES modules, CommonJS, and various environment-specific patterns like Jest mocks.
 */
export class JavaScriptParser implements LanguageParser {
  /**
   * File extensions supported by this parser.
   */
  extensions = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'];

  /**
   * Parses JavaScript/TypeScript content to find file dependencies.
   *
   * @param context The parser context containing file content and resolution settings.
   * @returns An array of discovered dependencies.
   */
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
