import * as path from 'path';
import { DependencyResolutionKind, DependencyReferenceKind, DependencyType } from '../../types';
import { ParserSettings, createDirectDependency } from './types';
import { logger } from '../../utils/logger';

/**
 * List of file extensions that are considered for dependency analysis.
 */
export const DEPENDENCY_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.d.ts',
  '.html',
  '.css',
  '.scss',
  '.sass',
  '.py',
  '.java',
  '.png',
  '.jpg',
  '.jpeg',
  '.svg',
  '.gif',
  '.ico',
  '.webp',
  '.avif',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
];

/**
 * Normalizes a file path by standardizing separators and removing relative prefixes.
 * @param value The path to normalize.
 * @returns The normalized path.
 */
export function normalizePath(value: string): string {
  return value
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/$/, '');
}

/**
 * Removes query parameters and hash fragments from a specifier.
 * @param value The specifier to strip.
 * @returns The stripped specifier.
 */
export function stripSpecifierDecoration(value: string): string {
  const trimmed = value.trim();
  const queryIndex = trimmed.indexOf('?');
  const hashIndex = trimmed.indexOf('#', trimmed.startsWith('#') ? 1 : 0);
  const cutPoints = [queryIndex, hashIndex].filter((index) => index >= 0);

  if (cutPoints.length === 0) {
    return trimmed;
  }

  return trimmed.slice(0, Math.min(...cutPoints));
}

/**
 * Checks if a specifier refers to an external resource (e.g., URL or absolute path).
 * @param value The specifier to check.
 * @returns True if the specifier is external.
 */
export function isExternalSpecifier(value: string): boolean {
  const specifier = value.trim().toLowerCase();
  if (!specifier || specifier.startsWith('//')) {
    return true;
  }

  return /^[a-z][a-z0-9+.-]*:/.test(specifier) && !/^[a-z]:[\\/]/i.test(specifier);
}

/**
 * Strips the extension from a file path if it matches a known dependency extension.
 * @param candidate The file path to strip.
 * @returns The file path without its extension.
 */
export function stripExtension(candidate: string): string {
  const normalized = normalizePath(candidate);
  const knownExtension = [...DEPENDENCY_EXTENSIONS]
    .sort((a, b) => b.length - a.length)
    .find((ext) => normalized.endsWith(ext));

  if (knownExtension) {
    return normalized.slice(0, -knownExtension.length);
  }

  return normalized.replace(/\.[^/.]+$/, '');
}

/**
 * Attempts to resolve a candidate path by checking for exact matches or common extensions.
 * @param candidate The candidate path to resolve.
 * @param normalizedFileIds Map of normalized paths to file IDs.
 * @returns The resolved file ID, or null if not found.
 */
export function tryResolveCandidate(
  candidate: string,
  normalizedFileIds: Record<string, string>
): string | null {
  const normalized = normalizePath(candidate);
  const exact = normalizedFileIds[normalized];
  if (exact) {
    return exact;
  }

  for (const ext of DEPENDENCY_EXTENSIONS) {
    const direct = normalizedFileIds[`${normalized}${ext}`];
    if (direct) {
      return direct;
    }
  }

  for (const ext of DEPENDENCY_EXTENSIONS) {
    const barrel = normalizedFileIds[`${normalized}/index${ext}`];
    if (barrel) {
      return barrel;
    }
  }

  return null;
}

/**
 * Attempts to resolve a decorated candidate path (with query/hash or potential extension mismatch).
 * @param candidate The candidate path to resolve.
 * @param normalizedFileIds Map of normalized paths to file IDs.
 * @returns The resolved file ID, or null if not found.
 */
export function tryResolveDecoratedCandidate(
  candidate: string,
  normalizedFileIds: Record<string, string>
): string | null {
  const cleanCandidate = stripSpecifierDecoration(candidate);
  const resolved = tryResolveCandidate(cleanCandidate, normalizedFileIds);
  if (resolved) {
    return resolved;
  }

  const stripped = stripExtension(cleanCandidate);
  if (stripped !== normalizePath(cleanCandidate)) {
    return tryResolveCandidate(stripped, normalizedFileIds);
  }

  return null;
}

/**
 * Calculates the line and character position for a given index in a string.
 * @param content The string content.
 * @param index The character index.
 * @returns An object with 1-based line and character numbers.
 */
export function getPosition(content: string, index: number): { line: number; character: number } {
  const lines = content.slice(0, index).split('\n');
  return {
    line: lines.length,
    character: lines[lines.length - 1].length + 1,
  };
}

/**
 * Resolves the "rest" part of an import when matched against an alias.
 * @param normalizedImport The normalized import specifier.
 * @param normalizedAlias The normalized alias pattern.
 * @returns The remaining part of the path, or null if no match.
 */
export function resolveAliasRest(normalizedImport: string, normalizedAlias: string): string | null {
  const starIndex = normalizedAlias.indexOf('*');
  if (starIndex >= 0) {
    const prefix = normalizedAlias.slice(0, starIndex);
    const suffix = normalizedAlias.slice(starIndex + 1);

    if (!normalizedImport.startsWith(prefix) || (suffix && !normalizedImport.endsWith(suffix))) {
      return null;
    }

    return normalizedImport
      .slice(prefix.length, suffix ? -suffix.length : undefined)
      .replace(/^\/+/, '');
  }

  if (normalizedImport === normalizedAlias) {
    return '';
  }

  if (normalizedImport.startsWith(`${normalizedAlias}/`)) {
    return normalizedImport.slice(normalizedAlias.length).replace(/^\/+/, '');
  }

  return null;
}

/**
 * Applies the target path of an alias to the "rest" part of the import.
 * @param normalizedTarget The normalized alias target path.
 * @param rest The "rest" part of the import path.
 * @returns The resolved path.
 */
export function applyAliasTarget(normalizedTarget: string, rest: string): string {
  if (normalizedTarget.includes('*')) {
    return normalizePath(normalizedTarget.replace('*', rest));
  }

  return rest ? normalizePath(`${normalizedTarget}/${rest}`) : normalizedTarget;
}

/**
 * Represents a successfully resolved import.
 */
export interface ResolvedImport {
  /** The unique ID of the resolved target file. */
  targetId: string;
  /** The method used to resolve the import. */
  resolvedBy: DependencyResolutionKind;
}

/**
 * Resolves an import path to a file ID using project settings and file index.
 * @param importPath The import specifier.
 * @param sourceFile The file containing the import.
 * @param settings The parser settings (aliases, baseUrl).
 * @param normalizedFileIds Map of normalized paths to file IDs.
 * @param allowWorkspaceRoot Whether to allow resolution relative to the workspace root.
 * @returns The resolved import info, or null if resolution failed.
 */
export function resolveImport(
  importPath: string,
  sourceFile: string,
  settings: ParserSettings,
  normalizedFileIds: Record<string, string>,
  allowWorkspaceRoot = false
): ResolvedImport | null {
  const cleanImport = stripSpecifierDecoration(importPath);
  if (!cleanImport || isExternalSpecifier(cleanImport)) {
    return null;
  }

  const normalizedImport = normalizePath(cleanImport);
  const normalizedSource = normalizePath(sourceFile);
  const importSlashes = cleanImport.replace(/\\/g, '/');

  for (const [alias, target] of Object.entries(settings.aliases)) {
    const aliasBase = normalizePath(alias);
    const targetBase = normalizePath(target);
    const aliasRest = resolveAliasRest(normalizedImport, aliasBase);

    if (aliasRest !== null) {
      const aliasResolved = applyAliasTarget(targetBase, aliasRest);
      const resolved = tryResolveDecoratedCandidate(aliasResolved, normalizedFileIds);
      if (resolved) {
        return {
          targetId: resolved,
          resolvedBy: DependencyResolutionKind.ALIAS,
        };
      }
    }
  }

  const isRelative = importSlashes.startsWith('./') || importSlashes.startsWith('../');
  const isRootRelative = importSlashes.startsWith('/');

  let baseCandidate: string | null = null;
  let resolvedBy: DependencyResolutionKind | null = null;
  if (isRelative) {
    baseCandidate = path.posix.join(path.posix.dirname(normalizedSource), normalizedImport);
    resolvedBy = DependencyResolutionKind.RELATIVE;
  } else if (isRootRelative) {
    baseCandidate = normalizedImport;
    resolvedBy = DependencyResolutionKind.ROOT_RELATIVE;
  } else if (settings.baseUrl) {
    baseCandidate = path.posix.join(settings.baseUrl, normalizedImport);
    resolvedBy = DependencyResolutionKind.BASE_URL;
  } else if (allowWorkspaceRoot) {
    baseCandidate = normalizedImport;
    resolvedBy = DependencyResolutionKind.WORKSPACE;
  }

  if (!baseCandidate || !resolvedBy) {
    return null;
  }

  const normalizedCandidate = normalizePath(baseCandidate);
  const resolved = tryResolveDecoratedCandidate(normalizedCandidate, normalizedFileIds);
  if (resolved) {
    return {
      targetId: resolved,
      resolvedBy,
    };
  }

  const stripped = stripExtension(normalizedCandidate);
  if (stripped !== normalizedCandidate) {
    const strippedResolved = tryResolveCandidate(stripped, normalizedFileIds);
    if (strippedResolved) {
      return {
        targetId: strippedResolved,
        resolvedBy,
      };
    }
  }

  return null;
}
