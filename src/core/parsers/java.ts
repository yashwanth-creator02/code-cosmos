import {
  CosmosDependency,
  DependencyType,
  DependencyReferenceKind,
  DependencyResolutionKind,
} from '../../types';
import { LanguageParser, ParserContext, createDirectDependency } from './types';
import { getPosition } from './utils';

export class JavaParser implements LanguageParser {
  extensions = ['java', 'kt', 'kts'];

  parse(context: ParserContext): CosmosDependency[] {
    const { content, fileId, javaPackageIndex } = context;
    const deps: CosmosDependency[] = [];
    const importRegex = /^\s*import\s+(?:static\s+)?([\w.]+)(\.\*)?\s*;/gm;

    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(content)) !== null) {
      const importPath = match[1];
      const wildcardTargets = match[2]
        ? this.resolveJavaWildcardImport(importPath, javaPackageIndex)
        : [];
      const targets = match[2]
        ? wildcardTargets
        : [this.resolveJavaImport(importPath, javaPackageIndex)].filter(Boolean);

      const pos = getPosition(content, match.index);
      for (const targetId of targets) {
        if (!targetId || targetId === fileId) {
          continue;
        }

        deps.push(
          createDirectDependency(
            fileId,
            targetId as string,
            DependencyType.IMPORT,
            match[0]
              .replace(/^\s*import\s+/, '')
              .replace(/;\s*$/, '')
              .trim(),
            DependencyReferenceKind.JAVA_IMPORT,
            DependencyResolutionKind.JAVA_PACKAGE,
            pos.line,
            pos.character
          )
        );
      }
    }

    // Kotlin specific imports
    if (fileId.endsWith('.kt') || fileId.endsWith('.kts')) {
      const kotlinRegex = /^\s*import\s+([\w.]+)(\.*)?\s*$/gm;
      while ((match = kotlinRegex.exec(content)) !== null) {
        const importPath = match[1];
        const resolved = this.resolveJavaImport(importPath, javaPackageIndex);
        if (resolved && resolved !== fileId) {
          const pos = getPosition(content, match.index);
          deps.push(
            createDirectDependency(
              fileId,
              resolved,
              DependencyType.IMPORT,
              importPath,
              DependencyReferenceKind.STATIC_IMPORT,
              DependencyResolutionKind.JAVA_PACKAGE,
              pos.line,
              pos.character
            )
          );
        }
      }
    }

    return deps;
  }

  private resolveJavaImport(
    importPath: string,
    javaPackageIndex: Map<string, string>
  ): string | null {
    let candidate = importPath;
    while (candidate.includes('.')) {
      const resolved = javaPackageIndex.get(candidate);
      if (resolved) {
        return resolved;
      }
      candidate = candidate.replace(/\.[^.]+$/, '');
    }

    return javaPackageIndex.get(candidate) ?? null;
  }

  private resolveJavaWildcardImport(
    importPath: string,
    javaPackageIndex: Map<string, string>
  ): string[] {
    const prefix = `${importPath.replace(/\.\*$/, '')}.`;
    const resolved: string[] = [];

    for (const [javaPackage, fileId] of javaPackageIndex.entries()) {
      if (!javaPackage.startsWith(prefix)) {
        continue;
      }

      const rest = javaPackage.slice(prefix.length);
      if (!rest.includes('.')) {
        resolved.push(fileId);
      }
    }

    return resolved;
  }
}
