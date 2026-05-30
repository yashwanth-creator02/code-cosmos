import {
  CosmosDependency,
  DependencyType,
  DependencyReferenceKind,
  DependencyResolutionKind,
} from '../../types';
import { LanguageParser, ParserContext, createDirectDependency } from './types';
import { resolveImport, getPosition } from './utils';

export class PythonParser implements LanguageParser {
  extensions = ['py'];

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
