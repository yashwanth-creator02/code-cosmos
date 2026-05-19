// src/core/dependencyParser.ts

import * as path from 'path';
import * as vscode from 'vscode';
import { CosmosData, CosmosDependency, DependencyLayer, DependencyType } from '../types';
import { logger } from '../utils/logger';

interface AliasMap {
  [alias: string]: string;
}

interface ResolutionSettings {
  aliases: AliasMap;
  baseUrl?: string;
}

const DEPENDENCY_EXTENSIONS = [
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

function normalizePath(value: string): string {
  return value
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/$/, '');
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

async function loadResolutionSettings(workspaceRoot: string): Promise<ResolutionSettings> {
  const tsConfig = await readConfigSettings(workspaceRoot, 'tsconfig.json');
  const jsConfig = await readConfigSettings(workspaceRoot, 'jsconfig.json');

  return {
    aliases: {
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
  return candidate.replace(/\.[^/.]+$/, '');
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

function resolveImport(
  importPath: string,
  sourceFile: string,
  settings: ResolutionSettings,
  normalizedFileIds: Record<string, string>
): string | null {
  const normalizedImport = normalizePath(importPath);
  const normalizedSource = normalizePath(sourceFile);

  for (const [alias, target] of Object.entries(settings.aliases)) {
    const aliasBase = normalizePath(alias);
    const targetBase = normalizePath(target);

    if (aliasBase.endsWith('/*')) {
      const aliasPrefix = aliasBase.slice(0, -2);
      if (normalizedImport === aliasPrefix || normalizedImport.startsWith(`${aliasPrefix}/`)) {
        const rest = normalizedImport.slice(aliasPrefix.length).replace(/^\//, '');
        const aliasResolved = rest ? `${targetBase.replace(/\/\*$/, '')}/${rest}` : targetBase.replace(/\/\*$/, '');
        const resolved = tryResolveCandidate(aliasResolved, normalizedFileIds);
        if (resolved) {
          logger.log(`Alias resolved: ${importPath} → ${resolved}`);
          return resolved;
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
        return resolved;
      }
    }
  }

  const isRelative = normalizedImport.startsWith('.') || normalizedImport.startsWith('..');
  const isRootRelative = normalizedImport.startsWith('/');

  let baseCandidate: string | null = null;
  if (isRelative) {
    baseCandidate = path.join(path.dirname(normalizedSource), normalizedImport);
  } else if (isRootRelative) {
    baseCandidate = normalizedImport.slice(1);
  } else if (settings.baseUrl) {
    baseCandidate = path.join(settings.baseUrl, normalizedImport);
  }

  if (!baseCandidate) {
    return null;
  }

  const normalizedCandidate = normalizePath(baseCandidate);
  const resolved = tryResolveCandidate(normalizedCandidate, normalizedFileIds);
  if (resolved) {
    return resolved;
  }

  const stripped = stripExtension(normalizedCandidate);
  if (stripped !== normalizedCandidate) {
    return tryResolveCandidate(stripped, normalizedFileIds);
  }

  return null;
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

  const regexes = [
    /\bimport\s+(?:type\s+)?(?:[\w*\s{},]+\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  for (const regex of regexes) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(withoutComments)) !== null) {
      const resolvedId = resolveImport(match[1], fileId, settings, normalizedFileIds);
      if (!resolvedId) {
        continue;
      }

      deps.push({
        sourceId: fileId,
        targetId: resolvedId,
        layer: DependencyLayer.DIRECT,
        type: DependencyType.IMPORT,
      });
    }
  }

  return deps;
}

function parseHtmlDependencies(
  content: string,
  fileId: string,
  normalizedFileIds: Record<string, string>
): CosmosDependency[] {
  const deps: CosmosDependency[] = [];
  const refRegex = /(?:src|href)=["']([^"'#]+)["']/g;

  let match: RegExpExecArray | null;
  while ((match = refRegex.exec(content)) !== null) {
    const refPath = match[1];
    if (
      refPath.startsWith('http') ||
      refPath.startsWith('//') ||
      refPath.startsWith('data:') ||
      refPath.startsWith('mailto:')
    ) {
      continue;
    }

    const resolved = resolveHtmlPath(refPath, fileId, normalizedFileIds);
    if (!resolved) {
      continue;
    }

    deps.push({
      sourceId: fileId,
      targetId: resolved,
      layer: DependencyLayer.DIRECT,
      type: DependencyType.REFERENCE,
    });
  }

  return deps;
}

function resolveHtmlPath(
  refPath: string,
  sourceFile: string,
  normalizedFileIds: Record<string, string>
): string | null {
  const extensions = ['.js', '.ts', '.tsx', '.css', '.html', '.png', '.jpg', '.jpeg', '.svg', '.gif', '.ico', '.webp'];
  const candidateBases = new Set<string>();
  const normalizedSource = normalizePath(sourceFile);
  const normalizedRef = normalizePath(refPath);

  candidateBases.add(path.join(path.dirname(normalizedSource), normalizedRef));
  if (normalizedRef.startsWith('/')) {
    candidateBases.add(normalizedRef.slice(1));
  }

  for (const root of ['public', 'static', 'assets', 'www', 'dist', 'src']) {
    candidateBases.add(path.join(root, normalizedRef.startsWith('/') ? normalizedRef.slice(1) : normalizedRef));
  }

  for (const base of candidateBases) {
    const normalizedBase = normalizePath(base);
    const exact = normalizedFileIds[normalizedBase];
    if (exact) {
      return exact;
    }

    for (const ext of extensions) {
      const direct = normalizedFileIds[`${normalizedBase}${ext}`];
      if (direct) {
        return direct;
      }
    }

    for (const ext of extensions) {
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
  const cssRegex = /@import\s+(?:url\()?['"]([^'"\)]+)['"]\)?/g;

  let match: RegExpExecArray | null;
  while ((match = cssRegex.exec(content)) !== null) {
    const resolvedId = resolveImport(match[1], fileId, settings, normalizedFileIds);
    if (!resolvedId) {
      continue;
    }

    deps.push({
      sourceId: fileId,
      targetId: resolvedId,
      layer: DependencyLayer.DIRECT,
      type: DependencyType.IMPORT,
    });
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
  const pyRegex = /(?:from\s+([\w.]+)\s+import|^\s*import\s+([\w.]+))/gm;

  let match: RegExpExecArray | null;
  while ((match = pyRegex.exec(content)) !== null) {
    const importPath = match[1] || match[2];
    if (!importPath) {
      continue;
    }

    const normalizedPyPath = importPath.startsWith('.')
      ? path.posix.normalize(`${'../'.repeat(Math.max((importPath.match(/\./g) || []).length - 1, 0))}${importPath.replace(/^\.+/, '')}`)
      : importPath.replace(/\./g, '/');

    const resolvedId = resolveImport(normalizedPyPath, fileId, settings, normalizedFileIds);
    if (!resolvedId) {
      continue;
    }

    deps.push({
      sourceId: fileId,
      targetId: resolvedId,
      layer: DependencyLayer.DIRECT,
      type: DependencyType.IMPORT,
    });
  }

  return deps;
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

export async function parseDependencies(data: CosmosData): Promise<CosmosDependency[]> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return [];
  }

  const workspaceRoot = workspaceFolders[0].uri.fsPath;
  const settings = await loadResolutionSettings(workspaceRoot);
  const normalizedFileIds = buildNormalizedFileMap(data);
  const allDeps: CosmosDependency[] = [];

  for (const fileId of Object.keys(data.files)) {
    const file = data.files[fileId];

    try {
      const content = await readFileContent(file.path);
      let fileDeps: CosmosDependency[] = [];

      switch (file.extension.toLowerCase()) {
        case 'ts':
        case 'tsx':
        case 'js':
        case 'jsx':
        case 'mjs':
        case 'cjs':
          fileDeps = parseWithRegexes(content, fileId, settings, normalizedFileIds);
          break;
        case 'html':
          fileDeps = parseHtmlDependencies(content, fileId, normalizedFileIds);
          break;
        case 'css':
        case 'scss':
        case 'sass':
          fileDeps = parseCssDependencies(content, fileId, settings, normalizedFileIds);
          break;
        case 'py':
          fileDeps = parsePythonDependencies(content, fileId, settings, normalizedFileIds);
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

