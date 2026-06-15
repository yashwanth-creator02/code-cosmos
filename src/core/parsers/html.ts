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

/**
 * List of HTML attributes that typically contain file references.
 */
const HTML_REFERENCE_ATTRIBUTES = ['src', 'href', 'poster', 'data-src', 'data-href', 'xlink:href'];

/**
 * Parser for HTML files that identifies dependencies in attributes like src, href, and srcset.
 */
export class HtmlParser implements LanguageParser {
  /**
   * File extensions supported by this parser.
   */
  extensions = ['html'];

  /**
   * Parses HTML content to find file dependencies.
   *
   * @param context The parser context containing file content and metadata.
   * @returns An array of discovered dependencies.
   */
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

  /**
   * Parses a srcset attribute value into individual file paths.
   *
   * @param value The value of the srcset attribute.
   * @returns An array of image URLs/paths found in the srcset.
   * @private
   */
  private parseSrcset(value: string): string[] {
    return value
      .split(',')
      .map((candidate) => candidate.trim().split(/\s+/)[0])
      .filter(Boolean);
  }

  /**
   * Resolves a reference path found in HTML to a file in the workspace.
   *
   * @param refPath The path string found in the HTML attribute.
   * @param sourceFile The file containing the reference.
   * @param settings Workspace settings for resolution.
   * @param normalizedFileIds Map of normalized paths to file IDs.
   * @returns The resolved target ID and resolution method, or null if not resolved.
   * @private
   */
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

  /**
   * Fallback resolution logic for HTML-specific path patterns (e.g., root-relative, common asset folders).
   *
   * @param refPath The path string found in the HTML attribute.
   * @param sourceFile The file containing the reference.
   * @param normalizedFileIds Map of normalized paths to file IDs.
   * @returns The resolved file ID, or null if not found.
   * @private
   */
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
