import {
  CosmosDependency,
  DependencyType,
  DependencyReferenceKind,
  DependencyResolutionKind,
} from '../../types';
import { LanguageParser, ParserContext, createDirectDependency } from './types';
import { resolveImport, getPosition } from './utils';

/**
 * Parser for Python files to extract import dependencies.
 */
export class PythonParser implements LanguageParser {
  /** Supported file extensions for this parser. */
  extensions = ['py'];

  /**
   * Parses Python content to find 'import' and 'from ... import' statements.
   * @param context The parser context containing file content and settings.
   * @returns An array of extracted dependencies.
   */
  parse(context: ParserContext): CosmosDependency[] {
    const { content, fileId, settings, normalizedFileIds } = context;
    const deps: CosmosDependency[] = [];
    const pyRegex = /(?:^\s*from\s+([\w.]+)\s+import|^\s*import\s+([\w.]+))/gm;

    let match: RegExpExecArray | null;
    while ((match = pyRegex.exec(content)) !== null) {
      const importPath = match[1] || match[2];
      if (!importPath) {
        continue;
      }

      const normalizedPyPath = this.pythonImportToPath(importPath);

      const resolved = resolveImport(normalizedPyPath, fileId, settings, normalizedFileIds, true);
      if (!resolved) {
        continue;
      }

      const pos = getPosition(content, match.index);
      deps.push(
        createDirectDependency(
          fileId,
          resolved.targetId,
          DependencyType.IMPORT,
          importPath,
          DependencyReferenceKind.PYTHON_IMPORT,
          resolved.resolvedBy,
          pos.line,
          pos.character
        )
      );
    }

    return deps;
  }

  /**
   * Converts a Python import path (with potential leading dots for relative imports) to a file path.
   * @param importPath The Python import path.
   * @returns The normalized file path representation.
   */
  private pythonImportToPath(importPath: string): string {
    const leadingDots = importPath.match(/^\.+/)?.[0].length ?? 0;
    const importBody = importPath.replace(/^\.+/, '').replace(/\./g, '/');

    if (leadingDots === 0) {
      return importBody;
    }

    const relativePrefix = leadingDots === 1 ? './' : '../'.repeat(leadingDots - 1);
    return `${relativePrefix}${importBody}`;
  }
}
