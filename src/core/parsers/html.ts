import {
  CosmosDependency,
  DependencyType,
  DependencyReferenceKind,
  DependencyResolutionKind,
} from '../../types';
import { LanguageParser, ParserContext, createDirectDependency } from './types';
import {
  resolveImport,
  isExternalSpecifier,
  stripSpecifierDecoration,
  normalizePath,
  DEPENDENCY_EXTENSIONS,
  getPosition,
} from './utils';
import * as path from 'path';

const HTML_REFERENCE_ATTRIBUTES = ['src', 'href', 'poster', 'data-src', 'data-href', 'xlink:href'];

export class HtmlParser implements LanguageParser {
  extensions = ['html'];

  parse(context: ParserContext): CosmosDependency[] {
    const { content, fileId, settings, normalizedFileIds } = context;
    const deps: CosmosDependency[] = [];
    const attributePattern = HTML_REFERENCE_ATTRIBUTES.join('|').replace(/:/g, '\\:');
    const refRegex = new RegExp(`\\b(?:${attributePattern})\\s*=\\s*["']([^"']+)["']`, 'gi');

    let match: RegExpExecArray | null;
    while ((match = refRegex.exec(content)) !== null) {
      const refPath = match[1];
      if (isExternalSpecifier(refPath)) {
        continue;
      }

      const resolved = this.resolveReferencePath(refPath, fileId, settings, normalizedFileIds);
      if (!resolved) {
        continue;
      }

      const pos = getPosition(content, match.index);
      deps.push(
        createDirectDependency(
          fileId,
          resolved.targetId,
          DependencyType.REFERENCE,
          refPath,
          DependencyReferenceKind.HTML_ATTRIBUTE,
          resolved.resolvedBy,
          pos.line,
          pos.character
        )
      );
    }

    const srcsetRegex = /\bsrcset\s*=\s*["']([^"']+)["']/gi;
    let srcsetMatch: RegExpExecArray | null;
    while ((srcsetMatch = srcsetRegex.exec(content)) !== null) {
      for (const refPath of this.parseSrcset(srcsetMatch[1])) {
        if (isExternalSpecifier(refPath)) {
          continue;
        }

        const resolved = this.resolveReferencePath(refPath, fileId, settings, normalizedFileIds);
        if (!resolved) {
          continue;
        }

        const pos = getPosition(content, srcsetMatch.index);
        deps.push(
          createDirectDependency(
            fileId,
            resolved.targetId,
            DependencyType.REFERENCE,
            refPath,
            DependencyReferenceKind.HTML_SRCSET,
            resolved.resolvedBy,
            pos.line,
            pos.character
          )
        );
      }
    }

    return deps;
  }

  private parseSrcset(value: string): string[] {
    return value
      .split(',')
      .map((candidate) => candidate.trim().split(/\s+/)[0])
      .filter(Boolean);
  }

  private resolveReferencePath(
    refPath: string,
    sourceFile: string,
    settings: any,
    normalizedFileIds: Record<string, string>
  ): { targetId: string; resolvedBy: DependencyResolutionKind } | null {
    const resolved = resolveImport(refPath, sourceFile, settings, normalizedFileIds, true);
    if (resolved) {
      return resolved;
    }

    const fallback = this.resolveHtmlPath(refPath, sourceFile, normalizedFileIds);
    if (!fallback) {
      return null;
    }

    return {
      targetId: fallback,
      resolvedBy: DependencyResolutionKind.WORKSPACE,
    };
  }

  private resolveHtmlPath(
    refPath: string,
    sourceFile: string,
    normalizedFileIds: Record<string, string>
  ): string | null {
    const candidateBases = new Set<string>();
    const normalizedSource = normalizePath(sourceFile);
    const cleanRef = stripSpecifierDecoration(refPath);
    const normalizedRef = normalizePath(cleanRef);
    const isRootRelative = cleanRef.replace(/\\/g, '/').startsWith('/');

    if (isRootRelative) {
      candidateBases.add(normalizedRef);
    } else {
      candidateBases.add(path.posix.join(path.posix.dirname(normalizedSource), normalizedRef));
    }

    for (const root of ['public', 'static', 'assets', 'www', 'dist', 'src']) {
      candidateBases.add(path.posix.join(root, normalizedRef));
    }

    for (const base of candidateBases) {
      const normalizedBase = normalizePath(base);
      const exact = normalizedFileIds[normalizedBase];
      if (exact) {
        return exact;
      }

      for (const ext of DEPENDENCY_EXTENSIONS) {
        const direct = normalizedFileIds[`${normalizedBase}${ext}`];
        if (direct) {
          return direct;
        }
      }

      for (const ext of DEPENDENCY_EXTENSIONS) {
        const barrel = normalizedFileIds[`${normalizedBase}/index${ext}`];
        if (barrel) {
          return barrel;
        }
      }
    }

    return null;
  }
}
