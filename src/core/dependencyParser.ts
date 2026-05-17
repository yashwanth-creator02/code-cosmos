// src/core/dependencyParser.ts

import * as path from 'path';
import * as vscode from 'vscode';
import { CosmosData, CosmosDependency, DependencyLayer, DependencyType } from '../types';
import { logger } from '../utils/logger';

// Represents a single alias mapping
interface AliasMap {
  [alias: string]: string;
}

// Read aliases from tsconfig.json paths
async function readTsConfigAliases(workspaceRoot: string): Promise<AliasMap> {
  try {
    const tsconfigUri = vscode.Uri.file(path.join(workspaceRoot, 'tsconfig.json'));
    const raw = await vscode.workspace.fs.readFile(tsconfigUri);
    const content = Buffer.from(raw).toString('utf8');

    const stripped = content.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const tsconfig = JSON.parse(stripped);

    const paths = tsconfig?.compilerOptions?.paths || {};
    const aliases: AliasMap = {};

    for (const [alias, targets] of Object.entries(paths)) {
      if (Array.isArray(targets) && targets.length > 0) {
        aliases[alias] = targets[0] as string;
      }
    }

    logger.log(`Aliases loaded from tsconfig: ${JSON.stringify(aliases)}`);
    return aliases;

  } catch {
    return {};
  }
}

// Read aliases from jsconfig.json (JS projects)
async function readJsConfigAliases(workspaceRoot: string): Promise<AliasMap> {
  try {
    const jsconfigUri = vscode.Uri.file(path.join(workspaceRoot, 'jsconfig.json'));
    const raw = await vscode.workspace.fs.readFile(jsconfigUri);
    const content = Buffer.from(raw).toString('utf8');
    const jsconfig = JSON.parse(content);
    const paths = jsconfig?.compilerOptions?.paths || {};
    const aliases: AliasMap = {};
    for (const [alias, targets] of Object.entries(paths)) {
      if (Array.isArray(targets) && targets.length > 0) {
        aliases[alias] = targets[0] as string;
      }
    }
    return aliases;
  } catch {
    return {};
  }
}



function resolveImport(
  importPath: string,
  sourceFile: string,
  data: CosmosData,
  aliases: AliasMap,
  normalizedFileIds: Record<string, string>
): string | null {
  // Normalize sourceFile immediately
  sourceFile = sourceFile.replace(/\\/g, '/');

  let resolvedPath = importPath;

  // Check if the import matches any alias
  for (const [alias, target] of Object.entries(aliases)) {
    if (alias.endsWith('/*')) {
      const prefix = alias.slice(0, -2);
      if (importPath.startsWith(prefix + '/')) {
        const rest = importPath.slice(prefix.length + 1);
        const resolvedTarget = target.endsWith('/*')
          ? target.slice(0, -2) + '/' + rest
          : target + '/' + rest;
        resolvedPath = resolvedTarget;
        logger.log(`Alias resolved: ${importPath} → ${resolvedPath}`);
        break;
      }
    } else {
      if (importPath === alias) {
        resolvedPath = target;
        break;
      }
    }
  }

  if (!resolvedPath.startsWith('.') && !resolvedPath.startsWith('src')) {
    return null;
  }

  const base = resolvedPath.startsWith('src')
    ? resolvedPath
    : path.join(path.dirname(sourceFile), resolvedPath).replace(/\\/g, '/');

  // Lookup using the pre-built normalized keys passed into the function, return original ID
  if (normalizedFileIds[base]) { return normalizedFileIds[base]; }

  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.css', '.py', '.java', '.html'];
  for (const ext of extensions) {
    if (normalizedFileIds[base + ext]) { return normalizedFileIds[base + ext]; }
  }

  for (const ext of extensions) {
    if (normalizedFileIds[base + '/index' + ext]) { return normalizedFileIds[base + '/index' + ext]; }
  }

  return null;
}

// Parse TS/JS imports
function parseTsJsDependencies(
  content: string,
  fileId: string,
  data: CosmosData,
  aliases: AliasMap,
  normalizedFileIds: Record<string, string>
): CosmosDependency[] {
  const deps: CosmosDependency[] = [];
  const importRegex = /(?:import\s+.*?\s+from\s+|require\s*\(\s*)['"]([^'"]+)['"]/g;
  let match;

  while ((match = importRegex.exec(content)) !== null) {
    const importPath = match[1];
    const resolvedId = resolveImport(importPath, fileId, data, aliases, normalizedFileIds);
    if (resolvedId) {
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

// Parse HTML dependencies
function parseHtmlDependencies(
  content: string,
  fileId: string,
  data: CosmosData,
  aliases: AliasMap,
  normalizedFileIds: Record<string, string>
): CosmosDependency[] {
  const deps: CosmosDependency[] = [];
  const refRegex = /(?:src|href)=["']([^"']+)["']/g;
  let match;

  while ((match = refRegex.exec(content)) !== null) {
    const refPath = match[1];
    if (refPath.startsWith('http') || refPath.startsWith('//')) { continue; }
    const resolvedId = resolveImport(refPath, fileId, data, aliases, normalizedFileIds);
    if (resolvedId) {
      deps.push({
        sourceId: fileId,
        targetId: resolvedId,
        layer: DependencyLayer.DIRECT,
        type: DependencyType.REFERENCE,
      });
    }
  }

  return deps;
}

// Parse CSS @import
function parseCssDependencies(
  content: string,
  fileId: string,
  data: CosmosData,
  aliases: AliasMap,
  normalizedFileIds: Record<string, string>
): CosmosDependency[] {
  const deps: CosmosDependency[] = [];
  const cssRegex = /@import\s+['"]([^'"]+)['"]/g;
  let match;

  while ((match = cssRegex.exec(content)) !== null) {
    const importPath = match[1];
    const resolvedId = resolveImport(importPath, fileId, data, aliases, normalizedFileIds);
    if (resolvedId) {
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

// Parse Python imports
function parsePythonDependencies(
  content: string,
  fileId: string,
  data: CosmosData,
  aliases: AliasMap,
  normalizedFileIds: Record<string, string>
): CosmosDependency[] {
  const deps: CosmosDependency[] = [];
  const pyRegex = /(?:from\s+([\w.]+)\s+import|^import\s+([\w.]+))/gm;
  let match;

  while ((match = pyRegex.exec(content)) !== null) {
    const importPath = match[1] || match[2];
    if (!importPath) continue;

    let normalizedPyPath = importPath;
    if (importPath.startsWith('.')) {
      const dotCount = (importPath.match(/\./g) || []).length;
      normalizedPyPath = '../'.repeat(dotCount - 1) + importPath.replace(/^\.+/, '');
    }

    const resolvedId = resolveImport(normalizedPyPath, fileId, data, aliases, normalizedFileIds);
    if (resolvedId) {
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

// Main entry point — parses all files in CosmosData
export async function parseDependencies(data: CosmosData): Promise<CosmosDependency[]> {
  const allDeps: CosmosDependency[] = [];

  // Get workspace root
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) { return []; }
  const workspaceRoot = workspaceFolders[0].uri.fsPath;

  // Load aliases once — pass to every parser
  const aliases = await loadAliases(workspaceRoot);

  // Build normalized file ID map once up-front
  const normalizedFileIds: Record<string, string> = {};
  for (const fileId of Object.keys(data.files)) {
    normalizedFileIds[fileId.replace(/\\/g, '/')] = fileId;
  }

  for (const fileId of Object.keys(data.files)) {
    const file = data.files[fileId];
    try {
      const uri = vscode.Uri.file(file.path);
      const raw = await vscode.workspace.fs.readFile(uri);
      const content = Buffer.from(raw).toString('utf8');

      let fileDeps: CosmosDependency[] = [];

      switch (file.extension.toLowerCase()) {
        case 'ts':
        case 'tsx':
        case 'js':
        case 'jsx':
          fileDeps = parseTsJsDependencies(content, fileId, data, aliases, normalizedFileIds);
          break;
        case 'html':
          fileDeps = parseHtmlDependencies(content, fileId, data, aliases, normalizedFileIds);
          break;
        case 'css':
        case 'scss':
          fileDeps = parseCssDependencies(content, fileId, data, aliases, normalizedFileIds);
          break;
        case 'py':
          fileDeps = parsePythonDependencies(content, fileId, data, aliases, normalizedFileIds);
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

  logger.log(`Total dependencies found: ${allDeps.length}`);
  return allDeps;
}

// Merge all alias sources
export async function loadAliases(workspaceRoot: string): Promise<AliasMap> {
  const tsAliases = await readTsConfigAliases(workspaceRoot);
  const jsAliases = await readJsConfigAliases(workspaceRoot);
  return { ...jsAliases, ...tsAliases };
}

//checks for the indirect dependencies
export function computeIndirectDependencies(
  directDeps: CosmosDependency[]
): CosmosDependency[] {
  const indirectDeps: CosmosDependency[] = [];

  // Build a quick lookup: for each file, what does it directly import?
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
      if (!middleTargets) { continue; }

      for (const targetId of middleTargets) {
        // Skip if already a direct dependency
        if (directTargets.has(targetId)) { continue; }
        // Skip self reference
        if (targetId === sourceId) { continue; }

        indirectDeps.push({
          sourceId,
          targetId,
          layer: DependencyLayer.INDIRECT,
          type: DependencyType.IMPORT,
        });
      }
    }
  }

  // Deduplicate — same pair might appear multiple times
  const seen = new Set<string>();
  return indirectDeps.filter(dep => {
    const key = `${dep.sourceId}→${dep.targetId}`;
    if (seen.has(key)) { return false; }
    seen.add(key);
    return true;
  });
}

//circular dependencies detector
export function detectCircularDependencies(
  directDeps: CosmosDependency[]
): CosmosDependency[] {
  // Build adjacency map — who does each file import?
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

  function dfs(fileId: string, path: string[]): void {
    visited.add(fileId);
    recursionStack.add(fileId);

    const neighbors = graph.get(fileId) || new Set();
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        dfs(neighbor, [...path, neighbor]);
      } else if (recursionStack.has(neighbor)) {
        // Found a cycle — neighbor is an ancestor in current path
        // The circular edge is fileId → neighbor
        circularDeps.push({
          sourceId: fileId,
          targetId: neighbor,
          layer: DependencyLayer.CIRCULAR,
          type: DependencyType.IMPORT,
        });

        // Log the full cycle path for debugging
        const cycleStart = path.indexOf(neighbor);
        const cyclePath = [...path.slice(cycleStart), fileId, neighbor];
        logger.warn(`Circular dependency: ${cyclePath.join(' → ')}`);
      }
    }

    recursionStack.delete(fileId);
  }

  // Run DFS from every node
  for (const fileId of graph.keys()) {
    if (!visited.has(fileId)) {
      dfs(fileId, [fileId]);
    }
  }

  logger.log(`Circular dependencies found: ${circularDeps.length}`);
  return circularDeps;
}

//shared dependencies
export function computeLayer3Dependencies(
  directDeps: CosmosDependency[]
): CosmosDependency[] {
  const layer3: CosmosDependency[] = [];
  const MAX_LAYER3 = 500;

  if (layer3.length > MAX_LAYER3) {
    logger.warn(`Layer 3 capped at ${MAX_LAYER3} (found ${layer3.length})`);
    return layer3.slice(0, MAX_LAYER3);
  }
  // Build reverse map — who imports each file?
  const importedBy = new Map<string, Set<string>>();
  for (const dep of directDeps) {
    if (!importedBy.has(dep.targetId)) {
      importedBy.set(dep.targetId, new Set());
    }
    importedBy.get(dep.targetId)!.add(dep.sourceId);
  }

  // Build forward map — what does each file import?
  const imports = new Map<string, Set<string>>();
  for (const dep of directDeps) {
    if (!imports.has(dep.sourceId)) {
      imports.set(dep.sourceId, new Set());
    }
    imports.get(dep.sourceId)!.add(dep.targetId);
  }

  const seen = new Set<string>();

  // Shared dependents — A and B are both imported by C
  for (const [, importers] of importedBy.entries()) {
    const importerList = Array.from(importers);
    for (let i = 0; i < importerList.length; i++) {
      for (let j = i + 1; j < importerList.length; j++) {
        const a = importerList[i];
        const b = importerList[j];
        const key = [a, b].sort().join('↔');
        if (!seen.has(key)) {
          seen.add(key);
          layer3.push({
            sourceId: a,
            targetId: b,
            layer: DependencyLayer.LAYER3_SHARED_DEPENDENT,
            type: DependencyType.REFERENCE,
          });
        }
      }
    }
  }

  // Shared dependencies — A and B both import C
  for (const [, deps] of imports.entries()) {
    const depList = Array.from(deps);
    for (let i = 0; i < depList.length; i++) {
      for (let j = i + 1; j < depList.length; j++) {
        const a = depList[i];
        const b = depList[j];
        const key = [a, b].sort().join('↔');
        if (!seen.has(key)) {
          seen.add(key);
          layer3.push({
            sourceId: a,
            targetId: b,
            layer: DependencyLayer.LAYER3_SHARED_DEPENDENCY,
            type: DependencyType.REFERENCE,
          });
        }
      }
    }
  }

  logger.log(`Layer 3 connections: ${layer3.length}`);
  return layer3;
}
