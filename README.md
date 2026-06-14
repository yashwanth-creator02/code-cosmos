<div align="center">

<img src="assets/logo.png" width="128" height="128" alt="Code Cosmos Logo"/>

# Code Cosmos

### Explore your codebase as an interactive 3D universe.

Files become planets. Folders become stars. Dependencies become constellation lines.

[![Version](https://img.shields.io/visual-studio-marketplace/v/Yashwanth.code-cosmos?color=blueviolet&label=marketplace)](https://marketplace.visualstudio.com/items?itemName=Yashwanth.code-cosmos)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/Yashwanth.code-cosmos?color=blue)](https://marketplace.visualstudio.com/items?itemName=Yashwanth.code-cosmos)
[![License: MIT](https://img.shields.io/badge/license-MIT-brightgreen)](LICENSE)

</div>

---

## What is Code Cosmos?

Large codebases are hard to understand at a glance. After a certain size, no amount of file-tree browsing gives you a real sense of how pieces connect. Code Cosmos maps your entire repository into a navigable 3D space — folders orbit as stars, files orbit those stars as planets, and every import statement becomes a visible line between them.

It lives in your VS Code sidebar as a persistent panel. It is not a replacement for your editor — it is a way to **understand before you code**. See the shape of a project you just cloned. Spot tightly coupled clusters before you refactor. Trace a bug across file boundaries visually.

---

## Demo

> 📹 Videos below show individual features. Each is recorded on a real codebase.

### Overview — Your Codebase as a Universe

![Code Cosmos overview](assets/demo/01-overview.gif)

---

### Navigation — Orbit, Zoom, Fly

Plain click on any planet highlights it. **Alt+click** flies the camera to it. **`F`** enters Pilot Mode — fly freely with WASD.

![Navigation](assets/demo/02-navigation.gif)

---

### Search — Jump to Any File Instantly

Press **`/`** or **`Ctrl+F`** to open the search bar. Type any filename. Use **↑↓ arrow keys** to step through results and **Enter** to fly there.

![Search](assets/demo/03-search.gif)

---

### Dependency Visualization — See What Connects to What

Import statements parsed across 13 languages. Toggle layers on and off individually. Circular dependencies pulse red automatically.

![Dependency lines](assets/demo/04-dependencies.gif)

---

### Focus Mode — Isolate a File's Connections

**Ctrl+click** any planet to enter Focus Mode. Everything else dims. Only that file's direct imports and importers stay visible. A popup lets you open the file or keep exploring.

![Focus mode](assets/demo/05-focus-mode.gif)

---

### Path Trace — Find the Route Between Any Two Files

**Shift+click** two planets to select them. Code Cosmos finds the shortest dependency path between them using BFS and draws it in gold. If there's no direct path it finds the closest common ancestor.

![Path trace](assets/demo/06-path-trace.gif)

---

### Git Heatmap — See What's Hot

Enable the git heatmap to colour-code your universe by commit activity. Frequently changed files shift toward orange and white-hot. Untouched files sit cool and blue. Uncommitted changes appear as glowing animated rings.

![Git heatmap](assets/demo/07-git-heatmap.gif)

---

### Camera Bookmarks — Save Your Favourite Views

Click **+ Save View** in the top-right to name and save your current camera position. Return with one click or **Ctrl+1–5**. Bookmarks persist in your `.cosmos` file per project.

![Camera bookmarks](assets/demo/08-bookmarks.gif)

---

### Spacecraft Mode — Fly Through Your Code

Press **`F`** to unlock the mouse and fly freely through the universe.

![Spacecraft mode](assets/demo/09-spacecraft.gif)

---

### Settings & Spacing — Customise the Cosmos

Press **`G`** or click the ⚙️ button. Adjust the **Spacing** slider to spread planets and folders further apart if things feel cluttered. Choose from three presets: Clean, Full Detail, Performance.

![Settings panel](assets/demo/10-settings.gif)

---

## Installation

Search for **Code Cosmos** in the VS Code Extensions panel (`Ctrl+Shift+X`) and click Install.

Or install from the command line:

```bash
code --install-extension Yashwanth.code-cosmos
```

**Requirements:** VS Code 1.120.0 or higher. No additional dependencies required.

---

## Getting Started

1. Open any project folder in VS Code (`File → Open Folder`)
2. Click the **Code Cosmos** icon in the Activity Bar (left sidebar)
3. The universe builds automatically — a progress bar shows scan status
4. First launch shows an interactive guide. Press **`?`** anytime to bring it back.

> **Tip:** For large projects (500+ files) Code Cosmos will offer to enable Performance Mode before rendering. This keeps the frame rate smooth on any hardware.

---

## How the Universe Maps to Your Code

| Cosmic Object       | Code Equivalent                           | Visual Signal                                     |
| ------------------- | ----------------------------------------- | ------------------------------------------------- |
| **Star**            | Folder / module                           | Size = file count inside                          |
| **Planet**          | Source file                               | Size = file weight, brightness = recent activity  |
| **Moon**            | Leaf node / pure function file            | Small, no outbound dependencies                   |
| **Dependency line** | Import statement                          | White = direct, Blue = indirect, Red = circular   |
| **Amber ring**      | Uncommitted changes                       | Animated pulse around the planet                  |
| **Cyan ring**       | Oversized file (compressed for rendering) | Thin pulsing band                                 |
| **Gold ring**       | Selected planet (path trace mode)         | Bright, steady pulse                              |
| **Thermal colour**  | Git churn (heatmap mode)                  | Blue = stable → Orange/White = frequently changed |

---

## Keyboard Shortcuts

| Shortcut         | Action                                                       |
| ---------------- | ------------------------------------------------------------ |
| `/` or `Ctrl+F`  | Open search                                                  |
| `↑` / `↓`        | Navigate search results                                      |
| `Enter`          | Fly to selected search result                                |
| `Esc`            | Close panels / exit focus / clear selection (priority order) |
| `Click`          | Highlight planet or folder                                   |
| `Alt+Click`      | Fly camera to planet or folder                               |
| `Ctrl+Click`     | Show dependencies (focus mode) + open option                 |
| `Shift+Click`    | Add to selection (path trace with 2 selected)                |
| `Right-click`    | Context menu — Open, Copy Path, Show Dependencies, Fly To    |
| `F`              | Toggle Pilot (spacecraft) mode                               |
| `W / S`          | Fly forward / backward (Pilot mode only)                     |
| `A / D`          | Strafe left / right (Pilot mode only)                        |
| `Q / E`          | Ascend / descend (Pilot mode only)                           |
| `Shift`          | Speed boost in Pilot mode                                    |
| `R`              | Reset camera to overview                                     |
| `M`              | Toggle minimap                                               |
| `G`              | Toggle settings panel                                        |
| `T`              | Toggle file type filter                                      |
| `H`              | Toggle keyboard shortcuts panel                              |
| `?`              | Open onboarding guide                                        |
| `Ctrl+1–5`       | Fly to camera bookmark 1–5                                   |
| `P`              | Export current view as PNG                                   |
| `Ctrl+U` or `F5` | Force refresh (bypasses cache)                               |

---

## Settings Reference

Open with **`G`** or the ⚙️ button. All settings are saved to your `.cosmos` file per project.

### Layout

| Setting     | Default | Description                                                                |
| ----------- | ------- | -------------------------------------------------------------------------- |
| **Spacing** | 1.0×    | Spreads planets and folders apart. Increase if the cosmos feels cluttered. |

### Dependency Lines

| Setting                 | Default | Description                            |
| ----------------------- | ------- | -------------------------------------- |
| Direct lines            | On      | Explicit imports between files         |
| Indirect lines          | Off     | Transitive connections (2 hops)        |
| Shared dependency lines | Off     | Files many modules depend on           |
| Circular lines          | On      | Import loops — pulse red automatically |

### Animations

| Setting           | Default | Description                            |
| ----------------- | ------- | -------------------------------------- |
| Orbital animation | Off     | Planets orbit their stars in real time |
| Star rotation     | On      | Folder stars rotate on their axis      |
| Orbital speed     | 1.0×    | Speed multiplier for orbital animation |

### Overlays

| Setting          | Default | Description                             |
| ---------------- | ------- | --------------------------------------- |
| Folder labels    | On      | Folder names float above stars          |
| Proximity labels | On      | File names fade in as camera approaches |
| Git heatmap      | Off     | Colour files by commit frequency        |
| Minimap          | Off     | 2D overhead map (also press M)          |
| Legend           | On      | Dependency type colour key              |

### Rendering

| Setting          | Default | Description                                                       |
| ---------------- | ------- | ----------------------------------------------------------------- |
| Background stars | On      | Decorative starfield                                              |
| Depth fog        | On      | Distant objects fade for depth                                    |
| Performance Mode | Off     | Instanced rendering — suggested automatically for 500+ file repos |

**Presets:** **Clean** (minimal), **Full Detail** (everything on), **Performance** (optimised for large repos).

---

## Excluding Files and Folders

Create a `.cosmosignore` file in your project root. Uses the same glob syntax as `.gitignore`.

```
# .cosmosignore

# Already excluded by default:
# node_modules, .git, dist, build, out, .next, __pycache__

# Add your own:
coverage
**/*.test.ts
**/*.spec.js
**/__mocks__
*.min.js
*.d.ts
```

The following are always excluded automatically: `node_modules`, `.git`, `dist`, `build`, `out`, `.next`, `__pycache__`, lock files, and Code Cosmos's own `.cosmos` / `.cosmos.cache` files.

---

## The `.cosmos` File

Code Cosmos creates two files in each project root:

**`.cosmos`** — your personal settings for this project. Stores camera bookmarks, toggle states, and the spacing preference. Always gitignored automatically. Never shared.

**`.cosmos.cache`** — a cache of the parsed dependency graph and git data. Makes subsequent opens near-instant by skipping AST parsing and git log when no files have changed. Regenerated automatically when files are added, removed, or modified. Safe to delete — it will be rebuilt on next open.

Both files are added to `.gitignore` automatically on first use.

---

## Supported Languages

| Language                | Extensions                                   |
| ----------------------- | -------------------------------------------- |
| TypeScript / JavaScript | `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs` |
| Python                  | `.py`                                        |
| Java                    | `.java`                                      |
| Rust                    | `.rs`                                        |
| Go                      | `.go`                                        |
| C / C++                 | `.c`, `.cpp`, `.h`, `.hpp`                   |
| Ruby                    | `.rb`                                        |
| PHP                     | `.php`                                       |
| Swift                   | `.swift`                                     |
| Kotlin                  | `.kt`                                        |
| HTML                    | `.html`                                      |
| CSS / SCSS              | `.css`, `.scss`                              |
| Vue                     | `.vue`                                       |
| Svelte                  | `.svelte`                                    |

Files in unsupported formats still appear as planets — they just have no dependency lines.

---

## Performance

Code Cosmos is designed to handle real projects, not just small demos.

| Project size    | Behaviour                                                                |
| --------------- | ------------------------------------------------------------------------ |
| < 200 files     | Instant load on second open (cache hit)                                  |
| 200–500 files   | Loads in 2–5 seconds on first open, near-instant on subsequent opens     |
| 500–1,500 files | Performance Mode is offered automatically before rendering               |
| > 1,500 files   | Performance Mode required — consider `.cosmosignore` for generated files |

**Performance Mode** uses GPU instanced mesh rendering — all planets drawn in a single draw call, dramatically reducing GPU overhead on large repos.

**The cache system** computes a lightweight fingerprint (file sizes, modification times, git HEAD) on every open. If nothing has changed, the expensive work (AST parsing and git log) is skipped entirely. Only a force-refresh (`Ctrl+U`) bypasses the cache.

---

## Known Limitations

- **Monorepos** — each workspace folder renders as a separate galaxy. Cross-package dependencies between workspace roots are not yet visualised.
- **Dynamic imports** — `import()` expressions and `require()` calls with variable paths cannot be statically resolved and will not appear as dependency lines.
- **Very large repos (3,000+ files)** — even with Performance Mode, rendering and parsing will be slower on lower-end hardware. Excluding generated files and test fixtures via `.cosmosignore` helps significantly.

---

## Roadmap

| Feature                                     | Status                |
| ------------------------------------------- | --------------------- |
| 3D universe rendering                       | ✅ Shipped            |
| 13-language dependency parsing              | ✅ Shipped            |
| Git heatmap                                 | ✅ Shipped            |
| Focus mode                                  | ✅ Shipped            |
| Path trace between any two files            | ✅ Shipped            |
| Camera bookmarks                            | ✅ Shipped            |
| Multi-select                                | ✅ Shipped            |
| Spacecraft pilot mode                       | ✅ Shipped            |
| `.cosmos.cache` for instant reloads         | ✅ Shipped            |
| Progress loading screen                     | ✅ Shipped            |
| Spacing / repulsion slider                  | ✅ Shipped            |
| Genesis animation on first load             | 🔜 Planned            |
| Photon particle streams on dependency lines | 🔜 Planned            |
| Tactical HUD panel                          | 🔜 Planned            |
| Test coverage visualisation                 | 🔜 Planned            |
| Drag-to-migrate files between folders       | 🔜 Planned (flagship) |

See the [open issues](https://github.com/yashwanth-creator02/code-cosmos/issues) for the full list.

---

## Contributing

Contributions are welcome. The codebase is TypeScript throughout — VS Code extension host on the Node.js side, Three.js WebView on the render side. See [CONTRIBUTING.md](CONTRIBUTING.md) for architecture overview and PR guidelines.

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

<div align="center">

Built with Three.js · Made for VS Code

[Marketplace](https://marketplace.visualstudio.com/items?itemName=Yashwanth.code-cosmos) · [GitHub](https://github.com/yashwanth-creator02/code-cosmos) · [Issues](https://github.com/yashwanth-creator02/code-cosmos/issues)

</div>
