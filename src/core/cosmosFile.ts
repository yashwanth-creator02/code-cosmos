// src/core/cosmosFile.ts
//
// Manages the per-project .cosmos file.
//
// Design decisions:
//   - Lives at <workspaceRoot>/.cosmos
//   - Always gitignored (we add it automatically if .gitignore exists)
//   - Two-file system: .cosmos (preferences) and .cosmos.cache (derived data)
//   - .cosmos stores ONLY user preferences and spatial overrides — never source data
//   - Source of truth (dependency graph, git metadata) is always re-derived from codebase
//   - If .cosmos is missing or corrupt, silently falls back to defaults — never blocks launch
//
// Schema is versioned — bumping SCHEMA_VERSION causes a clean migration on next open.

import * as vscode from 'vscode';
import * as path from 'path';
import { SettingsState, DEFAULT_SETTINGS, CameraState, NavigationData } from '../types';
import { logger } from '../utils/logger';

const SCHEMA_VERSION = 1;
const COSMOS_FILENAME = '.cosmos';
const GITIGNORE_FILENAME = '.gitignore';

// ---------------------------------------------------------------------------
// .cosmos file schema
// ---------------------------------------------------------------------------

/**
 * Structure of the .cosmos preference file.
 */
export interface CosmosFileData {
  /** Schema version for migration tracking */
  version: number;
  /** Unique hash of the workspace path to detect mismatched files */
  projectId: string;
  /** ISO timestamp of the last save operation */
  lastSaved: string;

  /** User preferences for visualization and performance */
  preferences: SettingsState;

  /** Camera bookmarks and navigation history */
  navigation: NavigationData;

  /**
   * Manual spatial overrides for planets/stars.
   * Keys are relative paths (IDs), values are 3D offset deltas.
   */
  spatialOverrides: Record<string, { offsetX: number; offsetY: number; offsetZ: number }>;
}

/**
 * Default values used when creating a new .cosmos file.
 */
const DEFAULT_COSMOS_DATA: Omit<CosmosFileData, 'version' | 'projectId' | 'lastSaved'> = {
  preferences: { ...DEFAULT_SETTINGS },
  navigation: {
    homePosition: null,
    namedSlots: [],
    cameraHistory: [],
  },
  spatialOverrides: {},
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read the .cosmos file for the given workspace root.
 * Returns defaults if the file doesn't exist, is corrupt, or has a version mismatch.
 * Never throws — always returns usable data.
 *
 * @param workspaceRoot - The VS Code workspace folder to read from.
 * @returns A promise resolving to the parsed CosmosFileData.
 */
export async function readCosmosFile(
  workspaceRoot: vscode.WorkspaceFolder
): Promise<CosmosFileData> {
  const filePath = cosmosFilePath(workspaceRoot);
  const projectId = makeProjectId(workspaceRoot.uri.fsPath);

  try {
    const raw = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
    const parsed = JSON.parse(Buffer.from(raw).toString('utf8')) as Partial<CosmosFileData>;

    // Version check — if schema changed, return defaults (migration possible in future)
    if (parsed.version !== SCHEMA_VERSION) {
      logger.log(
        `.cosmos version mismatch (got ${parsed.version}, expected ${SCHEMA_VERSION}) — using defaults`
      );
      return makeDefault(projectId);
    }

    // Project ID check — file belongs to a different project (e.g. copied accidentally)
    if (parsed.projectId !== projectId) {
      logger.log('.cosmos projectId mismatch — using defaults');
      return makeDefault(projectId);
    }

    // Merge with defaults so new fields added in future versions are present
    return {
      version: SCHEMA_VERSION,
      projectId,
      lastSaved: parsed.lastSaved ?? new Date().toISOString(),
      preferences: { ...DEFAULT_SETTINGS, ...(parsed.preferences ?? {}) },
      navigation: {
        homePosition: parsed.navigation?.homePosition ?? null,
        namedSlots: parsed.navigation?.namedSlots ?? [],
        cameraHistory: parsed.navigation?.cameraHistory ?? [],
      },
      spatialOverrides: parsed.spatialOverrides ?? {},
    };
  } catch (err) {
    // File doesn't exist or is corrupt — silently return defaults
    logger.log(`.cosmos not found or unreadable at ${filePath} — using defaults`);
    return makeDefault(projectId);
  }
}

/**
 * Write the .cosmos file for the given workspace root.
 * Also ensures .gitignore contains .cosmos entry.
 * Silent on failure — never blocks the extension.
 *
 * @param workspaceRoot - The VS Code workspace folder to write to.
 * @param data - Partial data to save; missing fields will be filled with defaults.
 * @returns A promise that resolves when the file is written.
 */
export async function writeCosmosFile(
  workspaceRoot: vscode.WorkspaceFolder,
  data: Partial<CosmosFileData>
): Promise<void> {
  const filePath = cosmosFilePath(workspaceRoot);
  const projectId = makeProjectId(workspaceRoot.uri.fsPath);

  const toWrite: CosmosFileData = {
    version: SCHEMA_VERSION,
    projectId,
    lastSaved: new Date().toISOString(),
    preferences: data.preferences ?? { ...DEFAULT_SETTINGS },
    navigation: data.navigation ?? DEFAULT_COSMOS_DATA.navigation,
    spatialOverrides: data.spatialOverrides ?? {},
  };

  try {
    const content = JSON.stringify(toWrite, null, 2);
    await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), Buffer.from(content, 'utf8'));
    logger.log(`.cosmos written to ${filePath}`);
    await ensureGitignored(workspaceRoot);
  } catch (err) {
    logger.error(`.cosmos write failed: ${err}`);
  }
}

/**
 * Write only the preferences section — preserves navigation and spatial overrides.
 *
 * @param workspaceRoot - The VS Code workspace folder.
 * @param preferences - The new settings state to save.
 * @returns A promise that resolves when the preferences are saved.
 */
export async function savePreferences(
  workspaceRoot: vscode.WorkspaceFolder,
  preferences: SettingsState
): Promise<void> {
  const existing = await readCosmosFile(workspaceRoot);
  await writeCosmosFile(workspaceRoot, { ...existing, preferences });
}

/**
 * Write a partial navigation update — preserves preferences, spatial overrides,
 * and any navigation fields not included in the partial. Used by camera
 * bookmarks (namedSlots), home position, and camera history.
 *
 * @param workspaceRoot - The VS Code workspace folder.
 * @param navigation - Partial navigation data to merge and save.
 * @returns A promise that resolves when navigation is saved.
 */
export async function saveNavigation(
  workspaceRoot: vscode.WorkspaceFolder,
  navigation: Partial<NavigationData>
): Promise<void> {
  const existing = await readCosmosFile(workspaceRoot);
  await writeCosmosFile(workspaceRoot, {
    ...existing,
    navigation: { ...existing.navigation, ...navigation },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Gets the absolute path to the .cosmos file for a workspace.
 *
 * @param workspaceRoot - The VS Code workspace folder.
 * @returns The absolute path string.
 */
function cosmosFilePath(workspaceRoot: vscode.WorkspaceFolder): string {
  return path.join(workspaceRoot.uri.fsPath, COSMOS_FILENAME);
}

/**
 * Generates a deterministic project ID from a filesystem path.
 *
 * @param fsPath - The filesystem path to hash.
 * @returns A unique string identifier.
 */
function makeProjectId(fsPath: string): string {
  // Simple deterministic hash of the workspace path
  // Not cryptographic — just unique enough to detect mismatched .cosmos files
  let hash = 0;
  for (let i = 0; i < fsPath.length; i++) {
    const char = fsPath.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit int
  }
  return `cosmos_${Math.abs(hash).toString(16)}`;
}

/**
 * Creates a default CosmosFileData object.
 *
 * @param projectId - The project ID to assign.
 * @returns A complete CosmosFileData object with defaults.
 */
function makeDefault(projectId: string): CosmosFileData {
  return {
    version: SCHEMA_VERSION,
    projectId,
    lastSaved: new Date().toISOString(),
    ...DEFAULT_COSMOS_DATA,
    preferences: { ...DEFAULT_SETTINGS },
  };
}

/**
 * Add .cosmos to .gitignore if it exists and doesn't already contain it.
 * Silent on any failure.
 *
 * @param workspaceRoot - The VS Code workspace folder.
 * @returns A promise that resolves when the operation is complete.
 */
async function ensureGitignored(workspaceRoot: vscode.WorkspaceFolder): Promise<void> {
  const gitignorePath = path.join(workspaceRoot.uri.fsPath, GITIGNORE_FILENAME);

  try {
    let content = '';
    try {
      const raw = await vscode.workspace.fs.readFile(vscode.Uri.file(gitignorePath));
      content = Buffer.from(raw).toString('utf8');
    } catch {
      // .gitignore doesn't exist — we'll create it
    }

    const lines = content.split('\n');
    const alreadyIgnored = lines.some(
      (l) => l.trim() === COSMOS_FILENAME || l.trim() === `/${COSMOS_FILENAME}`
    );

    if (!alreadyIgnored) {
      const separator = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
      const newContent = `${content}${separator}\n# Code Cosmos per-developer settings\n${COSMOS_FILENAME}\n.cosmos.cache\n`;
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(gitignorePath),
        Buffer.from(newContent, 'utf8')
      );
      logger.log('.cosmos added to .gitignore');
    }
  } catch (err) {
    logger.error(`Failed to update .gitignore: ${err}`);
  }
}
