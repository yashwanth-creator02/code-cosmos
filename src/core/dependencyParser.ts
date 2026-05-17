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

// Merge all alias sources
export async function loadAliases(workspaceRoot: string): Promise<AliasMap> {
  const tsAliases = await readTsConfigAliases(workspaceRoot);
  const jsAliases = await readJsConfigAliases(workspaceRoot);
  return { ...jsAliases, ...tsAliases };
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
