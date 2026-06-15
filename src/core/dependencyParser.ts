// src/core/dependencyParser.ts

import * as path from 'path';
import * as vscode from 'vscode';
import pLimit from 'p-limit';
import { CosmosData, CosmosDependency, DependencyLayer, DependencyType } from '../types';
import { logger } from '../utils/logger';
import { ALL_PARSERS, normalizePath, ParserSettings, ParserContext } from './parsers';
import { ProgressCallback, noopProgress } from './progress';

/**
 * A map of path aliases to their replacement strings.
 */
interface AliasMap {
  [alias: string]: string;
}

/**
 * Strips single-line and multi-line comments from JSON content.
 *
 * @param content - The JSON string content.
 * @returns The JSON content without comments.
 */
function stripJsonComments(content: string): string {
  return content.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Parses JSON content while safely handling comments.
 *
 * @param content - The raw string content.
 * @returns The parsed object, or null if parsing fails.
 */
function parseJsonConfig(content: string): any | null {
  try {
    return JSON.parse(stripJsonComments(content));
  } catch {
    return null;
  }
}

/**
 * Extracts path aliases from a compilerOptions.paths-style object.
 *
 * @param paths - The paths configuration object.
 * @returns A normalized AliasMap.
 */
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

/**
 * Converts a path to be relative to the workspace root.
 *
 * @param basePath - The path to convert.
 * @param workspaceRoot - The absolute path of the workspace root.
 * @returns The workspace-relative normalized path.
 */
function toWorkspaceRelative(basePath: string, workspaceRoot: string): string {
  const absolute = path.isAbsolute(basePath) ? basePath : path.join(workspaceRoot, basePath);
  return normalizePath(path.relative(workspaceRoot, absolute) || '.');
}

/**
 * Reads settings (aliases, baseUrl) from a TypeScript or JavaScript config file.
 *
 * @param workspaceRoot - The absolute path to the workspace root.
 * @param fileName - The config file name to read.
 * @returns A promise resolving to ParserSettings.
 */
async function readConfigSettings(
  workspaceRoot: string,
  fileName: 'tsconfig.json' | 'jsconfig.json'
): Promise<ParserSettings> {
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
    const baseUrl = compilerOptions.baseUrl
      ? toWorkspaceRelative(String(compilerOptions.baseUrl), workspaceRoot)
      : undefined;

    return { aliases, baseUrl };
  } catch {
    return { aliases: {} };
  }
}

/**
 * Reads module aliases from package.json (e.g., _moduleAliases or imports).
 *
 * @param workspaceRoot - The absolute path to the workspace root.
 * @returns A promise resolving to an AliasMap.
 */
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

/**
 * Attempts to extract aliases from common Vite configuration file names.
 *
 * @param workspaceRoot - The absolute path to the workspace root.
 * @returns A promise resolving to an AliasMap.
 */
async function readViteAliases(workspaceRoot: string): Promise<AliasMap> {
  const aliases: AliasMap = {};
  const configNames = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs'];

  for (const configName of configNames) {
    try {
      const configUri = vscode.Uri.file(path.join(workspaceRoot, configName));
      const raw = await vscode.workspace.fs.readFile(configUri);
      const content = Buffer.from(raw).toString('utf8');
      const aliasRegex =
        /['"]([^'"]+)['"]\s*:\s*path\.resolve\(\s*__dirname\s*,\s*['"]([^'"]+)['"]\s*\)/g;

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

/**
 * Loads and merges all resolution settings from workspace configuration files.
 *
 * @param workspaceRoot - The absolute path to the workspace root.
 * @returns A promise resolving to the combined ParserSettings.
 */
async function loadResolutionSettings(workspaceRoot: string): Promise<ParserSettings> {
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

/**
 * Reads the content of a file as a string.
 *
 * @param filePath - The absolute path to the file.
 * @returns A promise resolving to the file content string.
 */
async function readFileContent(filePath: string): Promise<string> {
  const raw = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
  return Buffer.from(raw).toString('utf8');
}

/**
 * Builds a map of normalized file paths to their original file IDs.
 *
 * @param data - The CosmosData containing the files.
 * @returns A record mapping normalized paths to file IDs.
 */
function buildNormalizedFileMap(data: CosmosData): Record<string, string> {
  const normalizedFileIds: Record<string, string> = {};
  for (const fileId of Object.keys(data.files)) {
    normalizedFileIds[normalizePath(fileId)] = fileId;
  }
  return normalizedFileIds;
}

/**
 * Builds an index of Java package names to file IDs.
 *
 * @param data - The CosmosData containing the files.
 * @returns A map of Java package names to file IDs.
 */
function buildJavaPackageIndex(data: CosmosData): Map<string, string> {
  const index = new Map<string, string>();
  const rootMarkers = ['src/main/java/', 'src/test/java/', 'src/integrationTest/java/', 'src/'];

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

/**
 * Removes duplicate dependencies from an array.
 *
 * @param deps - Array of dependencies to deduplicate.
 * @returns A new array containing only unique dependencies.
 */
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

/**
 * Parses all files in the cosmos to identify direct dependencies.
 *
 * Uses a pool of language-specific parsers to scan file content and resolve imports.
 *
 * @param data - The CosmosData to populate with dependencies.
 * @param workspaceRootOverride - Optional override for the workspace root path.
 * @param onProgress - Optional callback to report parsing progress.
 * @returns A promise resolving to an array of identified direct dependencies.
 */
export async function parseDependencies(
  data: CosmosData,
  workspaceRootOverride?: string,
  onProgress: ProgressCallback = noopProgress
): Promise<CosmosDependency[]> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceRootOverride && (!workspaceFolders || workspaceFolders.length === 0)) {
    return [];
  }

  const workspaceRoot = workspaceRootOverride ?? workspaceFolders![0].uri.fsPath;
  const settings = await loadResolutionSettings(workspaceRoot);
  const normalizedFileIds = buildNormalizedFileMap(data);
  const javaPackageIndex = buildJavaPackageIndex(data);
  const allDeps: CosmosDependency[] = [];

  // Map extensions to parsers
  const extensionMap = new Map<string, (typeof ALL_PARSERS)[0]>();
  for (const parser of ALL_PARSERS) {
    for (const ext of parser.extensions) {
      extensionMap.set(ext, parser);
    }
  }

  const limit = pLimit(10); // Process 10 files at a time
  const totalFiles = Object.keys(data.files).length;
  let completedFiles = 0;

  if (totalFiles === 0) {
    onProgress('parse', 1, 1);
  }

  const tasks = Object.keys(data.files).map((fileId) => {
    return limit(async () => {
      const file = data.files[fileId];
      const extension = file.extension.toLowerCase();
      const parser = extensionMap.get(extension);

      if (!parser) {
        completedFiles++;
        onProgress('parse', completedFiles, totalFiles);
        return [];
      }

      try {
        const content = await readFileContent(file.path);
        const context: ParserContext = {
          fileId,
          content,
          settings,
          normalizedFileIds,
          javaPackageIndex,
        };

        const fileDeps = await parser.parse(context);

        if (fileDeps.length > 0) {
          logger.log(`${fileId}: ${fileDeps.length} dependencies found`);
        }
        completedFiles++;
        onProgress('parse', completedFiles, totalFiles);
        return fileDeps;
      } catch (err) {
        logger.warn(`Could not parse ${fileId}: ${err}`);
        completedFiles++;
        onProgress('parse', completedFiles, totalFiles);
        return [];
      }
    });
  });

  const results = await Promise.all(tasks);
  results.forEach((deps: CosmosDependency[]) => allDeps.push(...deps));

  const deduped = dedupeDependencies(allDeps);
  logger.log(`Total dependencies found: ${deduped.length}`);
  return deduped;
}

/**
 * Loads path aliases from all supported configuration files in a workspace.
 *
 * @param workspaceRoot - The absolute path to the workspace root.
 * @returns A promise resolving to an AliasMap.
 */
export async function loadAliases(workspaceRoot: string): Promise<AliasMap> {
  const settings = await loadResolutionSettings(workspaceRoot);
  return settings.aliases;
}

/**
 * Computes indirect (transitive) dependencies based on direct connections.
 *
 * If A -> B and B -> C, then an indirect dependency A -> C is created.
 *
 * @param directDeps - Array of direct dependencies.
 * @returns Array of identified indirect dependencies.
 */
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

/**
 * Detects circular dependency chains in the direct dependency graph.
 *
 * @param directDeps - Array of direct dependencies.
 * @returns Array of dependencies that form part of a circular chain.
 */
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
      const cyclePath =
        cycleStart >= 0
          ? [...pathTrace.slice(cycleStart), fileId, neighbor]
          : [...pathTrace, fileId, neighbor];
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

/**
 * Generates a unique key for a pair of file IDs, regardless of order.
 *
 * @param a - The first file ID.
 * @param b - The second file ID.
 * @returns A deterministic string key for the pair.
 */
function pairKey(a: string, b: string): string {
  return [a, b].sort().join('↔');
}

/**
 * Computes Layer 3 connections: files that share a common dependent or common dependency.
 *
 * @param directDeps - Array of direct dependencies.
 * @returns Array of Layer 3 dependencies.
 */
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
