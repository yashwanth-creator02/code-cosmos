// src/core/dependencyParser.ts

import * as path from 'path';
import * as vscode from 'vscode';
import {
  CosmosData,
  CosmosDependency,
  DependencyLayer,
  DependencyReferenceKind,
  DependencyResolutionKind,
  DependencyType,
} from '../types';
import { logger } from '../utils/logger';

interface AliasMap {
  [alias: string]: string;
}

interface ResolutionSettings {
  aliases: AliasMap;
  baseUrl?: string;
}

interface ResolvedImport {
  targetId: string;
  resolvedBy: DependencyResolutionKind;
}

interface DependencyPattern {
  regex: RegExp;
  type: DependencyType;
  referenceKind: DependencyReferenceKind;
}

const CODE_DEPENDENCY_EXTENSIONS = [
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
  '.json',
];

const ASSET_DEPENDENCY_EXTENSIONS = [
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

const DEPENDENCY_EXTENSIONS = [
  ...CODE_DEPENDENCY_EXTENSIONS,
  ...ASSET_DEPENDENCY_EXTENSIONS,
];

const HTML_REFERENCE_ATTRIBUTES = [
  'src',
  'href',
  'poster',
  'data-src',
  'data-href',
  'xlink:href',
];

const PARSEABLE_DEPENDENCY_EXTENSIONS = new Set([
  // JS/TS family
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  // Web
  'html', 'css', 'scss', 'sass',
  // Vue & Svelte
  'vue', 'svelte',
  // Python
  'py',
  // JVM
  'java', 'kt', 'kts',
  // Systems
  'rs', 'go', 'c', 'cpp', 'cc', 'cxx', 'h', 'hpp',
  // Scripting
  'rb', 'php',
  // Apple
  'swift',
]);

function normalizePath(value: string): string {
  return value
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/$/, '');
}

function stripSpecifierDecoration(value: string): string {
  const trimmed = value.trim();
  const queryIndex = trimmed.indexOf('?');
  const hashIndex = trimmed.indexOf('#', trimmed.startsWith('#') ? 1 : 0);
  const cutPoints = [queryIndex, hashIndex].filter((index) => index >= 0);

  if (cutPoints.length === 0) {
    return trimmed;
  }

  return trimmed.slice(0, Math.min(...cutPoints));
}

function isExternalSpecifier(value: string): boolean {
  const specifier = value.trim().toLowerCase();
  if (!specifier || specifier.startsWith('//')) {
    return true;
  }

  return /^[a-z][a-z0-9+.-]*:/.test(specifier) && !/^[a-z]:[\\/]/i.test(specifier);
}

function stripJsonComments(content: string): string {
  return content
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

function parseJsonConfig(content: string): any | null {
  try {
    return JSON.parse(stripJsonComments(content));
  } catch {
    return null;
  }
}

function extractAliasesFromPaths(paths: Record<string, unknown>): AliasMap {
  const aliases: AliasMap = {};

  for (const [alias, targets] of Object.entries(paths)) {
    if (!Array.isArray(targets) || targets.length === 0) {
      continue;
    }
    aliases[normalizePath(alias)] = normalizePath(String(targets[0]));
  }

  return aliases;
}

function toWorkspaceRelative(basePath: string, workspaceRoot: string): string {
  const absolute = path.isAbsolute(basePath) ? basePath : path.join(workspaceRoot, basePath);
  return normalizePath(path.relative(workspaceRoot, absolute) || '.');
}

async function readConfigSettings(workspaceRoot: string, fileName: 'tsconfig.json' | 'jsconfig.json'): Promise<ResolutionSettings> {
  try {
    const configUri = vscode.Uri.file(path.join(workspaceRoot, fileName));
    const raw = await vscode.workspace.fs.readFile(configUri);
    const content = Buffer.from(raw).toString('utf8');
    const parsed = parseJsonConfig(content);

    if (!parsed) {
      return { aliases: {} };
    }

    const compilerOptions = parsed.compilerOptions || {};
    const aliases = extractAliasesFromPaths(compilerOptions.paths || {});
    const baseUrl = compilerOptions.baseUrl ? toWorkspaceRelative(String(compilerOptions.baseUrl), workspaceRoot) : undefined;

    return { aliases, baseUrl };
  } catch {
    return { aliases: {} };
  }
}

async function readPackageAliases(workspaceRoot: string): Promise<AliasMap> {
  try {
    const packageUri = vscode.Uri.file(path.join(workspaceRoot, 'package.json'));
    const raw = await vscode.workspace.fs.readFile(packageUri);
    const parsed = parseJsonConfig(Buffer.from(raw).toString('utf8'));
    const aliases: AliasMap = {};

    if (!parsed) {
      return aliases;
    }

    const moduleAliases = parsed._moduleAliases;
    if (moduleAliases && typeof moduleAliases === 'object' && !Array.isArray(moduleAliases)) {
      for (const [alias, target] of Object.entries(moduleAliases)) {
        if (typeof target === 'string') {
          aliases[normalizePath(alias)] = normalizePath(target);
        }
      }
    }

    const imports = parsed.imports;
    if (imports && typeof imports === 'object' && !Array.isArray(imports)) {
      for (const [alias, target] of Object.entries(imports)) {
        if (typeof target === 'string' && (target.startsWith('./') || target.startsWith('/'))) {
          aliases[normalizePath(alias)] = normalizePath(target);
        }
      }
    }

    return aliases;
  } catch {
    return {};
  }
}

async function readViteAliases(workspaceRoot: string): Promise<AliasMap> {
  const aliases: AliasMap = {};
  const configNames = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs'];

  for (const configName of configNames) {
    try {
      const configUri = vscode.Uri.file(path.join(workspaceRoot, configName));
      const raw = await vscode.workspace.fs.readFile(configUri);
      const content = Buffer.from(raw).toString('utf8');
      const aliasRegex = /['"]([^'"]+)['"]\s*:\s*path\.resolve\(\s*__dirname\s*,\s*['"]([^'"]+)['"]\s*\)/g;

      let match: RegExpExecArray | null;
      while ((match = aliasRegex.exec(content)) !== null) {
        aliases[normalizePath(match[1])] = normalizePath(match[2]);
      }
    } catch {
      // Config files are optional; keep scanning the other common names.
    }
  }

  return aliases;
}

async function loadResolutionSettings(workspaceRoot: string): Promise<ResolutionSettings> {
  const tsConfig = await readConfigSettings(workspaceRoot, 'tsconfig.json');
  const jsConfig = await readConfigSettings(workspaceRoot, 'jsconfig.json');
  const packageAliases = await readPackageAliases(workspaceRoot);
  const viteAliases = await readViteAliases(workspaceRoot);

  return {
    aliases: {
      ...packageAliases,
      ...viteAliases,
      ...jsConfig.aliases,
      ...tsConfig.aliases,
    },
    baseUrl: tsConfig.baseUrl ?? jsConfig.baseUrl,
  };
}

async function readFileContent(filePath: string): Promise<string> {
  const raw = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
  return Buffer.from(raw).toString('utf8');
}

function buildNormalizedFileMap(data: CosmosData): Record<string, string> {
  const normalizedFileIds: Record<string, string> = {};
  for (const fileId of Object.keys(data.files)) {
    normalizedFileIds[normalizePath(fileId)] = fileId;
  }
  return normalizedFileIds;
}

function stripExtension(candidate: string): string {
  const normalized = normalizePath(candidate);
  const knownExtension = [...DEPENDENCY_EXTENSIONS].sort((a, b) => b.length - a.length)
    .find((ext) => normalized.endsWith(ext));

  if (knownExtension) {
    return normalized.slice(0, -knownExtension.length);
  }

  return normalized.replace(/\.[^/.]+$/, '');
}

function tryResolveCandidate(candidate: string, normalizedFileIds: Record<string, string>): string | null {
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

function tryResolveDecoratedCandidate(candidate: string, normalizedFileIds: Record<string, string>): string | null {
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

function resolveAliasRest(normalizedImport: string, normalizedAlias: string): string | null {
  const starIndex = normalizedAlias.indexOf('*');
  if (starIndex >= 0) {
    const prefix = normalizedAlias.slice(0, starIndex);
    const suffix = normalizedAlias.slice(starIndex + 1);

    if (!normalizedImport.startsWith(prefix) || (suffix && !normalizedImport.endsWith(suffix))) {
      return null;
    }

    return normalizedImport.slice(prefix.length, suffix ? -suffix.length : undefined).replace(/^\/+/, '');
  }

  if (normalizedImport === normalizedAlias) {
    return '';
  }

  if (normalizedImport.startsWith(`${normalizedAlias}/`)) {
    return normalizedImport.slice(normalizedAlias.length).replace(/^\/+/, '');
  }

  return null;
}

function applyAliasTarget(normalizedTarget: string, rest: string): string {
  if (normalizedTarget.includes('*')) {
    return normalizePath(normalizedTarget.replace('*', rest));
  }

  return rest ? normalizePath(`${normalizedTarget}/${rest}`) : normalizedTarget;
}

function resolveImport(
  importPath: string,
  sourceFile: string,
  settings: ResolutionSettings,
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
        logger.log(`Alias resolved: ${importPath} -> ${resolved}`);
        return {
          targetId: resolved,
          resolvedBy: DependencyResolutionKind.ALIAS,
        };
      }
    }

    if (aliasBase.endsWith('/*')) {
      const aliasPrefix = aliasBase.slice(0, -2);
      if (normalizedImport === aliasPrefix || normalizedImport.startsWith(`${aliasPrefix}/`)) {
        const rest = normalizedImport.slice(aliasPrefix.length).replace(/^\//, '');
        const aliasResolved = rest ? `${targetBase.replace(/\/\*$/, '')}/${rest}` : targetBase.replace(/\/\*$/, '');
        const resolved = tryResolveCandidate(aliasResolved, normalizedFileIds);
        if (resolved) {
          logger.log(`Alias resolved: ${importPath} → ${resolved}`);
          return {
            targetId: resolved,
            resolvedBy: DependencyResolutionKind.ALIAS,
          };
        }
      }
      continue;
    }

    if (normalizedImport === aliasBase || normalizedImport.startsWith(`${aliasBase}/`)) {
      const rest = normalizedImport.slice(aliasBase.length).replace(/^\//, '');
      const aliasResolved = rest ? `${targetBase}/${rest}` : targetBase;
      const resolved = tryResolveCandidate(aliasResolved, normalizedFileIds);
      if (resolved) {
        logger.log(`Alias resolved: ${importPath} → ${resolved}`);
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

function createDirectDependency(
  sourceId: string,
  resolved: ResolvedImport,
  type: DependencyType,
  specifier: string,
  referenceKind: DependencyReferenceKind
): CosmosDependency {
  return {
    sourceId,
    targetId: resolved.targetId,
    layer: DependencyLayer.DIRECT,
    type,
    specifier: specifier.trim(),
    resolvedBy: resolved.resolvedBy,
    referenceKind,
  };
}

function parseWithRegexes(
  content: string,
  fileId: string,
  settings: ResolutionSettings,
  normalizedFileIds: Record<string, string>
): CosmosDependency[] {
  const deps: CosmosDependency[] = [];
  const withoutComments = content
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  const tripleSlashRegex = /\/\/\/\s*<reference\s+path=["']([^"']+)["']/g;
  let tripleSlashMatch: RegExpExecArray | null;
  while ((tripleSlashMatch = tripleSlashRegex.exec(content)) !== null) {
    const resolved = resolveImport(tripleSlashMatch[1], fileId, settings, normalizedFileIds);
    if (resolved) {
      deps.push(createDirectDependency(
        fileId,
        resolved,
        DependencyType.REFERENCE,
        tripleSlashMatch[1],
        DependencyReferenceKind.TRIPLE_SLASH
      ));
    }
  }

  const patterns: DependencyPattern[] = [
    {
      regex: /\bimport\s+(?:type\s+)?(?:[\w*$\s{},]+\s+from\s+)?['"]([^'"]+)['"]/g,
      type: DependencyType.IMPORT,
      referenceKind: DependencyReferenceKind.STATIC_IMPORT,
    },
    {
      regex: /\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g,
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
      regex: /\b(?:jest|vi)\.(?:mock|doMock|unmock|requireActual|requireMock)\s*\(\s*['"]([^'"]+)['"]/g,
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

      deps.push(createDirectDependency(
        fileId,
        resolved,
        pattern.type,
        match[1],
        pattern.referenceKind
      ));
    }
  }

  return deps;
}

function parseHtmlDependencies(
  content: string,
  fileId: string,
  settings: ResolutionSettings,
  normalizedFileIds: Record<string, string>
): CosmosDependency[] {
  const deps: CosmosDependency[] = [];
  const attributePattern = HTML_REFERENCE_ATTRIBUTES.join('|').replace(/:/g, '\\:');
  const refRegex = new RegExp(`\\b(?:${attributePattern})\\s*=\\s*["']([^"']+)["']`, 'gi');

  let match: RegExpExecArray | null;
  while ((match = refRegex.exec(content)) !== null) {
    const refPath = match[1];
    if (isExternalSpecifier(refPath)) {
      continue;
    }

    const resolved = resolveReferencePath(refPath, fileId, settings, normalizedFileIds);
    if (!resolved) {
      continue;
    }

    deps.push(createDirectDependency(
      fileId,
      resolved,
      DependencyType.REFERENCE,
      refPath,
      DependencyReferenceKind.HTML_ATTRIBUTE
    ));
  }

  const srcsetRegex = /\bsrcset\s*=\s*["']([^"']+)["']/gi;
  let srcsetMatch: RegExpExecArray | null;
  while ((srcsetMatch = srcsetRegex.exec(content)) !== null) {
    for (const refPath of parseSrcset(srcsetMatch[1])) {
      if (isExternalSpecifier(refPath)) {
        continue;
      }

      const resolved = resolveReferencePath(refPath, fileId, settings, normalizedFileIds);
      if (!resolved) {
        continue;
      }

      deps.push(createDirectDependency(
        fileId,
        resolved,
        DependencyType.REFERENCE,
        refPath,
        DependencyReferenceKind.HTML_SRCSET
      ));
    }
  }

  return deps;
}

function parseSrcset(value: string): string[] {
  return value
    .split(',')
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function resolveReferencePath(
  refPath: string,
  sourceFile: string,
  settings: ResolutionSettings,
  normalizedFileIds: Record<string, string>
): ResolvedImport | null {
  const resolved = resolveImport(refPath, sourceFile, settings, normalizedFileIds, true);
  if (resolved) {
    return resolved;
  }

  const fallback = resolveHtmlPath(refPath, sourceFile, normalizedFileIds);
  if (!fallback) {
    return null;
  }

  return {
    targetId: fallback,
    resolvedBy: DependencyResolutionKind.WORKSPACE,
  };
}

function resolveHtmlPath(
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

function parseCssDependencies(
  content: string,
  fileId: string,
  settings: ResolutionSettings,
  normalizedFileIds: Record<string, string>
): CosmosDependency[] {
  const deps: CosmosDependency[] = [];
  const importRegex = /@(import|use|forward)\s+(?:url\(\s*)?['"]?([^'"\);\s]+)['"]?\s*\)?/g;

  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(content)) !== null) {
    const resolved = resolveImport(match[2], fileId, settings, normalizedFileIds, true);
    if (!resolved) {
      continue;
    }

    deps.push(createDirectDependency(
      fileId,
      resolved,
      DependencyType.IMPORT,
      match[2],
      DependencyReferenceKind.CSS_IMPORT
    ));
  }

  const urlRegex = /\burl\(\s*['"]?([^'"\)]+)['"]?\s*\)/g;
  while ((match = urlRegex.exec(content)) !== null) {
    const prefix = content.slice(Math.max(0, match.index - 12), match.index).toLowerCase();
    if (/@import\s*$/.test(prefix)) {
      continue;
    }

    const refPath = match[1].trim();
    if (isExternalSpecifier(refPath)) {
      continue;
    }

    const resolved = resolveReferencePath(refPath, fileId, settings, normalizedFileIds);
    if (!resolved) {
      continue;
    }

    deps.push(createDirectDependency(
      fileId,
      resolved,
      DependencyType.REFERENCE,
      refPath,
      DependencyReferenceKind.CSS_URL
    ));
  }

  return deps;
}

function parsePythonDependencies(
  content: string,
  fileId: string,
  settings: ResolutionSettings,
  normalizedFileIds: Record<string, string>
): CosmosDependency[] {
  const deps: CosmosDependency[] = [];
  const pyRegex = /(?:^\s*from\s+([\w.]+)\s+import|^\s*import\s+([\w.]+))/gm;

  let match: RegExpExecArray | null;
  while ((match = pyRegex.exec(content)) !== null) {
    const importPath = match[1] || match[2];
    if (!importPath) {
      continue;
    }

    const normalizedPyPath = pythonImportToPath(importPath);

    const resolved = resolveImport(normalizedPyPath, fileId, settings, normalizedFileIds, true);
    if (!resolved) {
      continue;
    }

    deps.push(createDirectDependency(
      fileId,
      resolved,
      DependencyType.IMPORT,
      importPath,
      DependencyReferenceKind.PYTHON_IMPORT
    ));
  }

  return deps;
}

function pythonImportToPath(importPath: string): string {
  const leadingDots = importPath.match(/^\.+/)?.[0].length ?? 0;
  const importBody = importPath.replace(/^\.+/, '').replace(/\./g, '/');

  if (leadingDots === 0) {
    return importBody;
  }

  const relativePrefix = leadingDots === 1 ? './' : '../'.repeat(leadingDots - 1);
  return `${relativePrefix}${importBody}`;
}

function buildJavaPackageIndex(data: CosmosData): Map<string, string> {
  const index = new Map<string, string>();
  const rootMarkers = [
    'src/main/java/',
    'src/test/java/',
    'src/integrationTest/java/',
    'src/',
  ];

  for (const file of Object.values(data.files)) {
    if (file.extension.toLowerCase() !== 'java') {
      continue;
    }

    const normalizedId = normalizePath(file.id).replace(/\.java$/, '');
    const candidates = new Set<string>([normalizedId.replace(/\//g, '.')]);

    for (const marker of rootMarkers) {
      const markerIndex = normalizedId.indexOf(marker);
      if (markerIndex >= 0) {
        candidates.add(normalizedId.slice(markerIndex + marker.length).replace(/\//g, '.'));
      }
    }

    for (const candidate of candidates) {
      if (candidate && !index.has(candidate)) {
        index.set(candidate, file.id);
      }
    }
  }

  return index;
}

function resolveJavaImport(importPath: string, javaPackageIndex: Map<string, string>): string | null {
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

function resolveJavaWildcardImport(importPath: string, javaPackageIndex: Map<string, string>): string[] {
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

function parseJavaDependencies(
  content: string,
  fileId: string,
  javaPackageIndex: Map<string, string>
): CosmosDependency[] {
  const deps: CosmosDependency[] = [];
  const importRegex = /^\s*import\s+(?:static\s+)?([\w.]+)(\.\*)?\s*;/gm;

  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(content)) !== null) {
    const importPath = match[1];
    const wildcardTargets = match[2] ? resolveJavaWildcardImport(importPath, javaPackageIndex) : [];
    const targets = match[2] ? wildcardTargets : [resolveJavaImport(importPath, javaPackageIndex)].filter(Boolean);

    for (const targetId of targets) {
      if (!targetId || targetId === fileId) {
        continue;
      }

      deps.push(createDirectDependency(
        fileId,
        {
          targetId,
          resolvedBy: DependencyResolutionKind.JAVA_PACKAGE,
        },
        DependencyType.IMPORT,
        match[0].replace(/^\s*import\s+/, '').replace(/;\s*$/, '').trim(),
        DependencyReferenceKind.JAVA_IMPORT
      ));
    }
  }

  return deps;
}


// ─── Rust ────────────────────────────────────────────────────────────────────
// Handles: mod declarations, use statements, extern crate
// mod foo;              → looks for foo.rs or foo/mod.rs
// use crate::foo::bar;  → resolves within workspace
function parseRustDependencies(
  content: string,
  fileId: string,
  normalizedFileIds: Record<string, string>
): CosmosDependency[] {
  const deps: CosmosDependency[] = [];
  const sourceDir = normalizePath(fileId).replace(/\/[^\/]+$/, '');

  // mod declarations: mod foo; or pub mod foo;
  const modRegex = /^\s*(?:pub\s+)?mod\s+(\w+)\s*;/gm;
  let match: RegExpExecArray | null;
  while ((match = modRegex.exec(content)) !== null) {
    const modName = match[1];
    // Try foo.rs then foo/mod.rs
    const candidates = [
      `${sourceDir}/${modName}.rs`,
      `${sourceDir}/${modName}/mod.rs`,
    ];
    for (const candidate of candidates) {
      const resolved = normalizedFileIds[candidate];
      if (resolved && resolved !== fileId) {
        deps.push({
          sourceId: fileId,
          targetId: resolved,
          layer: DependencyLayer.DIRECT,
          type: DependencyType.IMPORT,
          specifier: modName,
          referenceKind: DependencyReferenceKind.STATIC_IMPORT,
          resolvedBy: DependencyResolutionKind.RELATIVE,
        });
        break;
      }
    }
  }

  return dedupeDependencies(deps);
}

// ─── Go ──────────────────────────────────────────────────────────────────────
// Handles: import "path" and import ( "path1" "path2" )
// Only resolves local imports (starting with ./)
function parseGoDependencies(
  content: string,
  fileId: string,
  normalizedFileIds: Record<string, string>
): CosmosDependency[] {
  const deps: CosmosDependency[] = [];
  const sourceDir = normalizePath(fileId).replace(/\/[^\/]+$/, '');

  // Match both single and grouped imports
  const importRegex = /import\s+(?:[\w]+\s+)?["`]([^"`]+)["`]/g;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(content)) !== null) {
    const importPath = match[1];
    // Only resolve relative imports
    if (!importPath.startsWith('.')) { continue; }
    const candidate = normalizePath(`${sourceDir}/${importPath}`);
    // Go packages are directories — look for any .go file inside
    for (const [norm, orig] of Object.entries(normalizedFileIds)) {
      if (norm.startsWith(candidate + '/') && norm.endsWith('.go')) {
        deps.push({
          sourceId: fileId,
          targetId: orig,
          layer: DependencyLayer.DIRECT,
          type: DependencyType.IMPORT,
          specifier: importPath,
          referenceKind: DependencyReferenceKind.STATIC_IMPORT,
          resolvedBy: DependencyResolutionKind.RELATIVE,
        });
        break; // one connection per package
      }
    }
  }

  return dedupeDependencies(deps);
}

// ─── C / C++ ─────────────────────────────────────────────────────────────────
// Handles: #include "local.h" (quotes = local, angle = system — skip system)
function parseCCppDependencies(
  content: string,
  fileId: string,
  normalizedFileIds: Record<string, string>
): CosmosDependency[] {
  const deps: CosmosDependency[] = [];
  const sourceDir = normalizePath(fileId).replace(/\/[^\/]+$/, '');

  // Only double-quote includes — angle brackets are system headers
  const includeRegex = /^\s*#\s*include\s+"([^"]+)"/gm;
  let match: RegExpExecArray | null;
  while ((match = includeRegex.exec(content)) !== null) {
    const includePath = match[1];
    // Try relative to source file first, then workspace root
    const candidates = [
      normalizePath(`${sourceDir}/${includePath}`),
      normalizePath(includePath),
    ];
    for (const candidate of candidates) {
      const resolved = normalizedFileIds[candidate];
      if (resolved && resolved !== fileId) {
        deps.push({
          sourceId: fileId,
          targetId: resolved,
          layer: DependencyLayer.DIRECT,
          type: DependencyType.REFERENCE,
          specifier: includePath,
          referenceKind: DependencyReferenceKind.HTML_ATTRIBUTE, // closest analog
          resolvedBy: DependencyResolutionKind.RELATIVE,
        });
        break;
      }
    }
  }

  return deps;
}

// ─── Ruby ────────────────────────────────────────────────────────────────────
// Handles: require_relative 'file', require './file'
// Skips gem requires (no leading ./)
function parseRubyDependencies(
  content: string,
  fileId: string,
  normalizedFileIds: Record<string, string>
): CosmosDependency[] {
  const deps: CosmosDependency[] = [];
  const sourceDir = normalizePath(fileId).replace(/\/[^\/]+$/, '');

  // require_relative 'path' — always local
  const relativeRegex = /require_relative\s+['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = relativeRegex.exec(content)) !== null) {
    const p = match[1];
    const base = normalizePath(`${sourceDir}/${p}`);
    const resolved = normalizedFileIds[base] ||
      normalizedFileIds[base + '.rb'];
    if (resolved && resolved !== fileId) {
      deps.push({
        sourceId: fileId,
        targetId: resolved,
        layer: DependencyLayer.DIRECT,
        type: DependencyType.IMPORT,
        specifier: p,
        referenceKind: DependencyReferenceKind.COMMONJS_REQUIRE,
        resolvedBy: DependencyResolutionKind.RELATIVE,
      });
    }
  }

  // require './path' or require '../path' — local requires
  const requireRegex = /\brequire\s+['"](\.{1,2}\/[^'"]+)['"]/g;
  while ((match = requireRegex.exec(content)) !== null) {
    const p = match[1];
    const base = normalizePath(`${sourceDir}/${p}`);
    const resolved = normalizedFileIds[base] ||
      normalizedFileIds[base + '.rb'];
    if (resolved && resolved !== fileId) {
      deps.push({
        sourceId: fileId,
        targetId: resolved,
        layer: DependencyLayer.DIRECT,
        type: DependencyType.IMPORT,
        specifier: p,
        referenceKind: DependencyReferenceKind.COMMONJS_REQUIRE,
        resolvedBy: DependencyResolutionKind.RELATIVE,
      });
    }
  }

  return dedupeDependencies(deps);
}

// ─── PHP ─────────────────────────────────────────────────────────────────────
// Handles: require, require_once, include, include_once
function parsePhpDependencies(
  content: string,
  fileId: string,
  normalizedFileIds: Record<string, string>
): CosmosDependency[] {
  const deps: CosmosDependency[] = [];
  const sourceDir = normalizePath(fileId).replace(/\/[^\/]+$/, '');

  const phpRegex = /(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = phpRegex.exec(content)) !== null) {
    const p = match[1];
    if (!p.startsWith('.') && !p.startsWith('/')) { continue; }
    const base = p.startsWith('.')
      ? normalizePath(`${sourceDir}/${p}`)
      : normalizePath(p);
    const resolved = normalizedFileIds[base];
    if (resolved && resolved !== fileId) {
      deps.push({
        sourceId: fileId,
        targetId: resolved,
        layer: DependencyLayer.DIRECT,
        type: DependencyType.IMPORT,
        specifier: p,
        referenceKind: DependencyReferenceKind.COMMONJS_REQUIRE,
        resolvedBy: DependencyResolutionKind.RELATIVE,
      });
    }
  }

  return deps;
}

// ─── Swift ───────────────────────────────────────────────────────────────────
// Swift imports are module-level — resolve to other .swift files in same dir
// import ClassName — look for ClassName.swift in same directory
function parseSwiftDependencies(
  content: string,
  fileId: string,
  normalizedFileIds: Record<string, string>
): CosmosDependency[] {
  const deps: CosmosDependency[] = [];
  const sourceDir = normalizePath(fileId).replace(/\/[^\/]+$/, '');

  // Skip framework imports (UIKit, Foundation etc) — local files only
  const importRegex = /^import\s+(\w+)$/gm;
  const SYSTEM_FRAMEWORKS = new Set([
    'UIKit', 'Foundation', 'SwiftUI', 'AppKit', 'Combine',
    'CoreData', 'CoreLocation', 'MapKit', 'StoreKit', 'XCTest',
  ]);

  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(content)) !== null) {
    const name = match[1];
    if (SYSTEM_FRAMEWORKS.has(name)) { continue; }
    // Look for Name.swift in same directory
    const candidate = normalizePath(`${sourceDir}/${name}.swift`);
    const resolved = normalizedFileIds[candidate];
    if (resolved && resolved !== fileId) {
      deps.push({
        sourceId: fileId,
        targetId: resolved,
        layer: DependencyLayer.DIRECT,
        type: DependencyType.IMPORT,
        specifier: name,
        referenceKind: DependencyReferenceKind.STATIC_IMPORT,
        resolvedBy: DependencyResolutionKind.RELATIVE,
      });
    }
  }

  return deps;
}

// ─── Kotlin ──────────────────────────────────────────────────────────────────
// Handles: import com.example.ClassName — same approach as Java
function parseKotlinDependencies(
  content: string,
  fileId: string,
  javaPackageIndex: Map<string, string>
): CosmosDependency[] {
  const deps: CosmosDependency[] = [];
  // Kotlin uses same import syntax as Java
  const importRegex = /^\s*import\s+([\w.]+)(\.*)?\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(content)) !== null) {
    const importPath = match[1];
    const resolved = resolveJavaImport(importPath, javaPackageIndex);
    if (resolved && resolved !== fileId) {
      deps.push({
        sourceId: fileId,
        targetId: resolved,
        layer: DependencyLayer.DIRECT,
        type: DependencyType.IMPORT,
        specifier: importPath,
        referenceKind: DependencyReferenceKind.STATIC_IMPORT,
        resolvedBy: DependencyResolutionKind.JAVA_PACKAGE,
      });
    }
  }
  return deps;
}

// ─── Vue ─────────────────────────────────────────────────────────────────────
// Vue SFC: parse <script> block imports + component registration in template
function parseVueDependencies(
  content: string,
  fileId: string,
  settings: ResolutionSettings,
  normalizedFileIds: Record<string, string>
): CosmosDependency[] {
  const deps: CosmosDependency[] = [];

  // Extract <script> and <script setup> blocks
  const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/);
  if (scriptMatch) {
    const scriptContent = scriptMatch[1];
    deps.push(...parseWithRegexes(scriptContent, fileId, settings, normalizedFileIds));
  }

  // Also catch components referenced in <template> as PascalCase tags
  // <MyComponent> → look for MyComponent.vue
  const sourceDir = normalizePath(fileId).replace(/\/[^\/]+$/, '');
  const templateMatch = content.match(/<template[^>]*>([\s\S]*?)<\/template>/);
  if (templateMatch) {
    const tagRegex = /<([A-Z][a-zA-Z0-9]+)/g;
    let match: RegExpExecArray | null;
    while ((match = tagRegex.exec(templateMatch[1])) !== null) {
      const componentName = match[1];
      const candidates = [
        `${sourceDir}/${componentName}.vue`,
        `${sourceDir}/components/${componentName}.vue`,
        `${sourceDir}/${componentName}/index.vue`,
      ];
      for (const c of candidates) {
        const resolved = normalizedFileIds[normalizePath(c)];
        if (resolved && resolved !== fileId) {
          deps.push({
            sourceId: fileId,
            targetId: resolved,
            layer: DependencyLayer.DIRECT,
            type: DependencyType.REFERENCE,
            specifier: componentName,
            referenceKind: DependencyReferenceKind.HTML_ATTRIBUTE,
            resolvedBy: DependencyResolutionKind.RELATIVE,
          });
          break;
        }
      }
    }
  }

  return dedupeDependencies(deps);
}

// ─── Svelte ──────────────────────────────────────────────────────────────────
// Svelte SFC: parse <script> imports + component tags in markup
function parseSvelteDependencies(
  content: string,
  fileId: string,
  settings: ResolutionSettings,
  normalizedFileIds: Record<string, string>
): CosmosDependency[] {
  const deps: CosmosDependency[] = [];
  const sourceDir = normalizePath(fileId).replace(/\/[^\/]+$/, '');

  // Extract <script> block
  const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/);
  if (scriptMatch) {
    deps.push(...parseWithRegexes(scriptMatch[1], fileId, settings, normalizedFileIds));
  }

  // Svelte components: <ComponentName> tags (PascalCase)
  const tagRegex = /<([A-Z][a-zA-Z0-9]+)/g;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(content)) !== null) {
    const name = match[1];
    const candidates = [
      `${sourceDir}/${name}.svelte`,
      `${sourceDir}/components/${name}.svelte`,
    ];
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

  return dedupeDependencies(deps);
}

export function dedupeDependencies(deps: CosmosDependency[]): CosmosDependency[] {
  const seen = new Set<string>();
  const unique: CosmosDependency[] = [];

  for (const dep of deps) {
    const key = `${dep.sourceId}|${dep.targetId}|${dep.layer}|${dep.type}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(dep);
  }

  return unique;
}

export async function parseDependencies(data: CosmosData, workspaceRootOverride?: string): Promise<CosmosDependency[]> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceRootOverride && (!workspaceFolders || workspaceFolders.length === 0)) {
    return [];
  }

  const workspaceRoot = workspaceRootOverride ?? workspaceFolders![0].uri.fsPath;
  const settings = await loadResolutionSettings(workspaceRoot);
  const normalizedFileIds = buildNormalizedFileMap(data);
  const javaPackageIndex = buildJavaPackageIndex(data);
  const allDeps: CosmosDependency[] = [];

  for (const fileId of Object.keys(data.files)) {
    const file = data.files[fileId];
    const extension = file.extension.toLowerCase();

    if (!PARSEABLE_DEPENDENCY_EXTENSIONS.has(extension)) {
      continue;
    }

    try {
      const content = await readFileContent(file.path);
      let fileDeps: CosmosDependency[] = [];

      switch (extension) {
        case 'ts':
        case 'tsx':
        case 'js':
        case 'jsx':
        case 'mjs':
        case 'cjs':
          fileDeps = parseWithRegexes(content, fileId, settings, normalizedFileIds);
          break;
        case 'html':
          fileDeps = parseHtmlDependencies(content, fileId, settings, normalizedFileIds);
          break;
        case 'css':
        case 'scss':
        case 'sass':
          fileDeps = parseCssDependencies(content, fileId, settings, normalizedFileIds);
          break;
        case 'py':
          fileDeps = parsePythonDependencies(content, fileId, settings, normalizedFileIds);
          break;
        case 'java':
          fileDeps = parseJavaDependencies(content, fileId, javaPackageIndex);
          break;

        // Kotlin — same package index as Java
        case 'kt':
        case 'kts':
          fileDeps = parseKotlinDependencies(content, fileId, javaPackageIndex);
          break;

        // Rust
        case 'rs':
          fileDeps = parseRustDependencies(content, fileId, normalizedFileIds);
          break;

        // Go
        case 'go':
          fileDeps = parseGoDependencies(content, fileId, normalizedFileIds);
          break;

        // C / C++
        case 'c':
        case 'cpp':
        case 'cc':
        case 'cxx':
        case 'h':
        case 'hpp':
          fileDeps = parseCCppDependencies(content, fileId, normalizedFileIds);
          break;

        // Ruby
        case 'rb':
          fileDeps = parseRubyDependencies(content, fileId, normalizedFileIds);
          break;

        // PHP
        case 'php':
          fileDeps = parsePhpDependencies(content, fileId, normalizedFileIds);
          break;

        // Swift
        case 'swift':
          fileDeps = parseSwiftDependencies(content, fileId, normalizedFileIds);
          break;

        // Vue SFC
        case 'vue':
          fileDeps = parseVueDependencies(content, fileId, settings, normalizedFileIds);
          break;

        // Svelte SFC
        case 'svelte':
          fileDeps = parseSvelteDependencies(content, fileId, settings, normalizedFileIds);
          break;
      }

      if (fileDeps.length > 0) {
        logger.log(`${fileId}: ${fileDeps.length} dependencies found`);
        allDeps.push(...fileDeps);
      }
    } catch (err) {
      logger.warn(`Could not parse ${fileId}: ${err}`);
    }
  }

  const deduped = dedupeDependencies(allDeps);
  logger.log(`Total dependencies found: ${deduped.length}`);
  return deduped;
}

export async function loadAliases(workspaceRoot: string): Promise<AliasMap> {
  const settings = await loadResolutionSettings(workspaceRoot);
  return settings.aliases;
}

export function computeIndirectDependencies(directDeps: CosmosDependency[]): CosmosDependency[] {
  const indirectDeps: CosmosDependency[] = [];
  const directMap = new Map<string, Set<string>>();

  for (const dep of directDeps) {
    if (!directMap.has(dep.sourceId)) {
      directMap.set(dep.sourceId, new Set());
    }
    directMap.get(dep.sourceId)!.add(dep.targetId);
  }

  for (const [sourceId, directTargets] of directMap.entries()) {
    for (const middleId of directTargets) {
      const middleTargets = directMap.get(middleId);
      if (!middleTargets) {
        continue;
      }

      for (const targetId of middleTargets) {
        if (targetId === sourceId || directTargets.has(targetId)) {
          continue;
        }

        indirectDeps.push({
          sourceId,
          targetId,
          layer: DependencyLayer.INDIRECT,
          type: DependencyType.IMPORT,
        });
      }
    }
  }

  return dedupeDependencies(indirectDeps);
}

export function detectCircularDependencies(directDeps: CosmosDependency[]): CosmosDependency[] {
  const graph = new Map<string, Set<string>>();
  for (const dep of directDeps) {
    if (!graph.has(dep.sourceId)) {
      graph.set(dep.sourceId, new Set());
    }
    graph.get(dep.sourceId)!.add(dep.targetId);
  }

  const circularDeps: CosmosDependency[] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const seenEdges = new Set<string>();

  function dfs(fileId: string, pathTrace: string[]): void {
    visited.add(fileId);
    recursionStack.add(fileId);

    const neighbors = graph.get(fileId) || new Set();
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        dfs(neighbor, [...pathTrace, neighbor]);
        continue;
      }

      if (!recursionStack.has(neighbor)) {
        continue;
      }

      const edgeKey = `${fileId}|${neighbor}`;
      if (seenEdges.has(edgeKey)) {
        continue;
      }
      seenEdges.add(edgeKey);

      circularDeps.push({
        sourceId: fileId,
        targetId: neighbor,
        layer: DependencyLayer.CIRCULAR,
        type: DependencyType.IMPORT,
      });

      const cycleStart = pathTrace.indexOf(neighbor);
      const cyclePath = cycleStart >= 0 ? [...pathTrace.slice(cycleStart), fileId, neighbor] : [...pathTrace, fileId, neighbor];
      logger.warn(`Circular dependency: ${cyclePath.join(' → ')}`);
    }

    recursionStack.delete(fileId);
  }

  for (const fileId of graph.keys()) {
    if (!visited.has(fileId)) {
      dfs(fileId, [fileId]);
    }
  }

  logger.log(`Circular dependencies found: ${circularDeps.length}`);
  return dedupeDependencies(circularDeps);
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('↔');
}

export function computeLayer3Dependencies(directDeps: CosmosDependency[]): CosmosDependency[] {
  const layer3: CosmosDependency[] = [];
  const MAX_LAYER3 = 500;

  const importedBy = new Map<string, Set<string>>();
  const imports = new Map<string, Set<string>>();
  const directPairs = new Set<string>();

  for (const dep of directDeps) {
    if (!importedBy.has(dep.targetId)) {
      importedBy.set(dep.targetId, new Set());
    }
    importedBy.get(dep.targetId)!.add(dep.sourceId);

    if (!imports.has(dep.sourceId)) {
      imports.set(dep.sourceId, new Set());
    }
    imports.get(dep.sourceId)!.add(dep.targetId);

    directPairs.add(pairKey(dep.sourceId, dep.targetId));
  }

  const seenDependentPairs = new Set<string>();
  const seenDependencyPairs = new Set<string>();

  for (const importers of importedBy.values()) {
    const importerList = Array.from(importers);
    for (let i = 0; i < importerList.length; i++) {
      for (let j = i + 1; j < importerList.length; j++) {
        const a = importerList[i];
        const b = importerList[j];
        const key = pairKey(a, b);

        if (directPairs.has(key) || seenDependentPairs.has(key)) {
          continue;
        }

        seenDependentPairs.add(key);
        layer3.push({
          sourceId: a,
          targetId: b,
          layer: DependencyLayer.LAYER3_SHARED_DEPENDENT,
          type: DependencyType.REFERENCE,
        });
      }
    }
  }

  for (const deps of imports.values()) {
    const depList = Array.from(deps);
    for (let i = 0; i < depList.length; i++) {
      for (let j = i + 1; j < depList.length; j++) {
        const a = depList[i];
        const b = depList[j];
        const key = pairKey(a, b);

        if (directPairs.has(key) || seenDependencyPairs.has(key)) {
          continue;
        }

        seenDependencyPairs.add(key);
        layer3.push({
          sourceId: a,
          targetId: b,
          layer: DependencyLayer.LAYER3_SHARED_DEPENDENCY,
          type: DependencyType.REFERENCE,
        });
      }
    }
  }

  if (layer3.length > MAX_LAYER3) {
    logger.warn(`Layer 3 capped at ${MAX_LAYER3} (found ${layer3.length})`);
    return layer3.slice(0, MAX_LAYER3);
  }

  logger.log(`Layer 3 connections: ${layer3.length}`);
  return dedupeDependencies(layer3);
}
