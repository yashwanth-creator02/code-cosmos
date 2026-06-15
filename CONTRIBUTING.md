# Contributing to Code Cosmos

Thank you for taking the time to contribute. This document explains how the codebase is structured, how to run it locally, and how to submit changes.

---

## Table of Contents

- [Architecture overview](#architecture-overview)
- [Project structure](#project-structure)
- [Running locally](#running-locally)
- [Adding a language parser](#adding-a-language-parser)
- [Working with the 3D renderer](#working-with-the-3d-renderer)
- [Submitting a pull request](#submitting-a-pull-request)
- [Code style](#code-style)

---

## Architecture Overview

Code Cosmos has two completely separate runtimes that communicate via message passing:

```
┌─────────────────────────────────────────────────────────┐
│  VS Code Extension Host (Node.js)                       │
│                                                         │
│  src/extension.ts       — activation, scan orchestration│
│  src/panel/CosmosPanel  — WebviewViewProvider, messages │
│  src/core/fileTree.ts   — directory traversal           │
│  src/core/dependencyParser.ts — AST parsing per file    │
│  src/core/gitReader.ts  — git churn via VS Code git API │
│  src/core/cosmosCache.ts — .cosmos.cache fingerprinting │
│  src/core/cosmosFile.ts — .cosmos preferences           │
│  src/core/exclusionManager.ts — .cosmosignore           │
│  src/core/parsers/      — one file per language         │
│                                                         │
└──────────────┬──────────────────────────────────────────┘
               │  postMessage / onDidReceiveMessage
               │  (typed in src/types/index.ts)
┌──────────────▼──────────────────────────────────────────┐
│  WebView (browser context, no Node.js APIs)             │
│                                                         │
│  webview/main.ts        — message handler, boot         │
│  webview/universe/Universe.ts — Three.js scene (3,500L) │
│  webview/universe/Star.ts    — folder star mesh         │
│  webview/universe/Planet.ts  — file type colour map     │
│  webview/universe/DependencyLine.ts — Bézier curves     │
│  webview/bridge/messageBridge.ts — acquireVsCodeApi     │
│  webview/index.html     — WebView shell                 │
│  webview/style.css      — CSS variables and glass panels│
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**The boundary is strict.** The extension host has full Node.js + VS Code API access. The WebView runs in a sandboxed browser context — no `require`, no `vscode`, no file system. All data flows through the typed message protocol in `src/types/index.ts`.

---

## Project Structure

```
code-cosmos/
├── src/                        Extension host (Node.js)
│   ├── extension.ts            Entry point, command registration
│   ├── panel/
│   │   └── CosmosPanel.ts      WebviewViewProvider
│   ├── core/
│   │   ├── fileTree.ts         Directory traversal + star tree layout
│   │   ├── dependencyParser.ts AST parsing orchestration
│   │   ├── gitReader.ts        Git churn data
│   │   ├── cosmosCache.ts      .cosmos.cache fingerprint system
│   │   ├── cosmosFile.ts       .cosmos preferences file
│   │   ├── exclusionManager.ts .cosmosignore processing
│   │   ├── progress.ts         ProgressCallback type
│   │   └── parsers/            One file per language
│   │       ├── index.ts        Parser registry + shared utilities
│   │       ├── typescriptParser.ts
│   │       ├── pythonParser.ts
│   │       └── ...
│   ├── types/
│   │   └── index.ts            All shared types + message protocol
│   └── utils/
│       └── logger.ts           Output channel logger
│
├── webview/                    Browser-context renderer
│   ├── main.ts                 Message handler + boot
│   ├── index.html              WebView shell (no framework)
│   ├── style.css               CSS variables, glass panels, animations
│   ├── bridge/
│   │   └── messageBridge.ts    acquireVsCodeApi wrapper
│   └── universe/
│       ├── Universe.ts         Three.js scene — all rendering logic
│       ├── Star.ts             Folder star mesh construction
│       ├── Planet.ts           File type → colour map
│       └── DependencyLine.ts   Quadratic Bézier dependency lines
│
├── assets/
│   ├── logo.png                Marketplace icon (colour)
│   ├── cosmos-icon.svg         Activity Bar icon (monochrome)
│   └── demo/                   GIF demos for README
│
├── .cosmos.cache               Per-project cache (gitignored, not in repo)
├── .cosmos                     Per-project settings (gitignored, not in repo)
├── .cosmosignore               Exclusion rules (like .gitignore)
├── package.json
├── tsconfig.json
└── vite.config.mjs             WebView bundle (webview/ → out/webview/)
```

---

## Running Locally

### Prerequisites

- Node.js 18 or higher
- VS Code 1.120.0 or higher
- Git

### Setup

```bash
git clone https://github.com/yashwanth-creator02/code-cosmos
cd code-cosmos
npm install
```

### Build

```bash
npm run compile
```

This runs `tsc` (extension host) and Vite (WebView bundle) in parallel. Output goes to `out/`.

### Launch in VS Code

Open the project in VS Code and press `F5`. This opens a new VS Code window (Extension Development Host) with the extension loaded. The cosmos icon appears in the Activity Bar of that window.

Any change to `src/` or `webview/` requires re-running `npm run compile` (or use `npm run watch` for automatic recompilation).

### Useful commands

```bash
npm run compile          # Full build
npm run watch            # Watch mode (recompiles on change)
npm run lint             # ESLint
npm run typecheck        # tsc --noEmit only
```

---

## Adding a Language Parser

Each language lives in one file under `src/core/parsers/`. The interface is simple:

```typescript
// src/core/parsers/index.ts
export interface LanguageParser {
  extensions: string[];
  parse(context: ParserContext): Promise<CosmosDependency[]>;
}
```

To add support for a new language:

1. Create `src/core/parsers/myLanguageParser.ts`

```typescript
import { LanguageParser, ParserContext } from './index';
import { CosmosDependency, DependencyLayer, DependencyType } from '../../types';

export const myLanguageParser: LanguageParser = {
  extensions: ['.ext'],
  async parse(context: ParserContext): Promise<CosmosDependency[]> {
    const deps: CosmosDependency[] = [];
    // Parse context.content for import statements
    // Resolve paths using context.normalizedFileIds
    // Return CosmosDependency[] for each import found
    return deps;
  },
};
```

2. Register it in `src/core/parsers/index.ts`:

```typescript
import { myLanguageParser } from './myLanguageParser';

export const ALL_PARSERS: LanguageParser[] = [
  typescriptParser,
  pythonParser,
  // ...
  myLanguageParser, // add here
];
```

3. Add the extension to the language table in `README.md`.

**Tips:**

- Use `context.normalizedFileIds` (a `Map<string, string>`) for path resolution — it maps normalised relative paths to file IDs already in the graph
- Return an empty array for files that can't be parsed rather than throwing — the parser runs in a `try/catch` but clean returns are better
- Keep regex simple — perfect AST fidelity isn't the goal, reasonable coverage is

---

## Working with the 3D Renderer

`webview/universe/Universe.ts` is a large file (~3,500 lines) handling all Three.js rendering. Before the next major feature addition it will be split into modules. Until then, the internal organisation is:

| Line range (approx) | Responsibility                                |
| ------------------- | --------------------------------------------- |
| 1–185               | Constants, types, helper functions            |
| 186–330             | Class fields and constructor                  |
| 331–560             | `build()` — scene construction                |
| 561–870             | Click, hover, context menu interaction        |
| 870–1285            | Focus mode, fly-to, star focus                |
| 1286–1450           | Search, keyboard shortcuts                    |
| 1450–1860           | Animate loop, orbital motion, rings           |
| 1860–2150           | UI init — settings, minimap, help, onboarding |
| 2150–2490           | Multi-select, path trace, BFS                 |
| 2490–2850           | Camera bookmarks, navigation                  |
| 2850–3200           | Settings panel bindings, applyGitVisuals      |
| 3200–3500           | Labels, filter bar, export, minimap draw      |

**The message flow into the renderer:**

```
extension.ts
  → CosmosPanel.sendMessage({ type: 'LOAD_UNIVERSE', payload })
  → webview/main.ts onMessageFromExtension
  → universe.build(payload)        ← rebuilds the entire scene
  → universe.applySettings(s)      ← visual toggles, no scene rebuild
  → universe.applyNavigation(nav)  ← camera bookmarks loaded from .cosmos
  → universe.focusOnFile(fileId)   ← beacon chip tracking
```

**Adding a new visual feature to the renderer:**

1. Add any new state as a class field with a clear comment
2. Add an `initMyFeature()` method and call it from the constructor's init block
3. If it needs per-frame updates, add them to `animate()` — keep the per-frame code lightweight (no allocation, no DOM queries)
4. If it needs settings, add the toggle to `SettingsState` in `src/types/index.ts` with a tier comment, and add a corresponding HTML element + binding in `initSettingsPanel()`

---

## Submitting a Pull Request

1. Fork the repository and create a branch: `git checkout -b feat/my-feature`
2. Make your changes
3. Run `npm run typecheck` and `npm run lint` — both must pass clean
4. Test in the Extension Development Host (`F5`) on at least one real project
5. Update `CHANGELOG.md` with a brief entry under `[Unreleased]`
6. Open a PR against `main` with a clear description of what changed and why

For significant changes, open an issue first to discuss the approach before writing code.

---

## Code Style

- TypeScript strict mode is on — no `any` without a comment explaining why
- No default exports — named exports only
- Extension host code: no DOM APIs. WebView code: no `vscode` or Node.js APIs
- Comments explain _why_, not _what_ — the code should be self-descriptive for the _what_
- New settings go in `src/types/index.ts` with a tier comment (`Tier 1/2/3`)
- New message types go in the `MessageToWebview` / `MessageFromWebview` unions in `src/types/index.ts`

ESLint and Prettier configs are already set up — running `npm run lint` will catch most style issues automatically.
