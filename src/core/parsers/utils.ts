import * as path from 'path';
import { DependencyResolutionKind, DependencyReferenceKind, DependencyType } from '../../types';
import { ParserSettings, createDirectDependency } from './types';
import { logger } from '../../utils/logger';

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

export function normalizePath(value: string): string {
  return value
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/$/, '');
}

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

export function isExternalSpecifier(value: string): boolean {
  const specifier = value.trim().toLowerCase();
  if (!specifier || specifier.startsWith('//')) {
    return true;
  }

  return /^[a-z][a-z0-9+.-]*:/.test(specifier) && !/^[a-z]:[\\/]/i.test(specifier);
}

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

export function getPosition(content: string, index: number): { line: number; character: number } {
  const lines = content.slice(0, index).split('\n');
  return {
    line: lines.length,
    character: lines[lines.length - 1].length + 1,
  };
}

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

export function applyAliasTarget(normalizedTarget: string, rest: string): string {
  if (normalizedTarget.includes('*')) {
    return normalizePath(normalizedTarget.replace('*', rest));
  }

  return rest ? normalizePath(`${normalizedTarget}/${rest}`) : normalizedTarget;
}

export interface ResolvedImport {
  targetId: string;
  resolvedBy: DependencyResolutionKind;
}

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
