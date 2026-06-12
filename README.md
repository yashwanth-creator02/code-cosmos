<div align="center">

<img src="images/logo.png" width="128" height="128" alt="Code Cosmos Logo"/>

# Code Cosmos

### Explore your codebase as an interactive 3D universe.

Files become planets. Folders become stars. Dependencies become constellation lines.

[![Version](https://img.shields.io/visual-studio-marketplace/v/Yashwanth.code-cosmos?color=blueviolet&label=marketplace)](https://marketplace.visualstudio.com/items?itemName=Yashwanth.code-cosmos)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/Yashwanth.code-cosmos?color=blue)](https://marketplace.visualstudio.com/items?itemName=Yashwanth.code-cosmos)
[![License: MIT](https://img.shields.io/badge/license-MIT-brightgreen)](LICENSE)

> 📸 **Screenshot coming soon** — install the extension and open any project to see it in action.

</div>

---

## What is Code Cosmos?

Large codebases are hard to navigate. After a certain size, no amount of file-tree browsing gives you a real sense of how the pieces connect. Code Cosmos maps your repository into a navigable 3D space — folders orbit as stars, files orbit those stars as planets, and every import statement becomes a visible line between them.

It is not a replacement for your editor. It is a way to **understand** before you code — to see the shape of a project you just cloned, spot tightly coupled clusters before you refactor, or trace a bug across file boundaries visually.

---

## Features

### 3D Universe Rendering

Every folder in your project becomes a star. Every file becomes a planet orbiting that star. The size of a star scales with how many files it contains. Planet colours reflect their file type. The whole scene is live — orbit it, fly through it, zoom in and out freely.

---

### Dependency Visualization

Code Cosmos parses import statements across 16 languages and draws them as lines between planets. Toggle individual layers on and off:

| Layer        | What it shows                             |
| ------------ | ----------------------------------------- |
| **Direct**   | Every explicit import between files       |
| **Indirect** | Transitive connections two hops away      |
| **Shared**   | Files that multiple other files depend on |
| **Circular** | Mutual import loops — these pulse red     |

---

### Focus Mode

Click any planet to focus on it. Everything else dims. Only that file's direct connections stay visible — the files it imports and the files that import it, highlighted as a constellation.

Press `Esc` or click empty space to exit focus mode.

---

### Git Heatmap

Enable the git heatmap to colour-code your universe by activity. Files that change frequently shift toward orange and red. Files untouched for months sit cool and blue. Uncommitted changes appear as glowing animated rings around their planet.

---

### Spacecraft Navigation

Press `F` to toggle **Pilot Mode**. The mouse unlocks from orbit control and you fly freely through the universe using your keyboard.

| Key       | Action                 |
| --------- | ---------------------- |
| `W` / `S` | Fly forward / backward |
| `A` / `D` | Strafe left / right    |
| `Q` / `E` | Ascend / descend       |
| `Shift`   | Sprint (5× speed)      |
| `F`       | Exit pilot mode        |

---

### Minimap

Press `M` to open the overhead minimap. It shows the full galaxy from above with a crosshair tracking your camera position. Click anywhere on the minimap to instantly jump to that location.

---

### Search

Press `Ctrl+F` or `/` to open the search bar. Type a filename and the camera flies smoothly to that planet. Matching planets are highlighted as you type.

---

## Installation

Search for **Code Cosmos** in the VS Code Extensions panel (`Ctrl+Shift+X`) and click Install.

Or install from the command line:

```bash
code --install-extension Yashwanth.code-cosmos
```

**Requirements:** VS Code 1.120.0 or higher. No other dependencies.

---

## Getting Started

1. Open any project folder in VS Code (`File → Open Folder`)
2. Open the Command Palette (`Ctrl+Shift+P`)
3. Run **`Code Cosmos: Open Universe`**
4. The universe generates automatically — larger projects take a few seconds

> **First time?** The onboarding overlay walks you through the controls. Press `?` at any time to bring it back.

---

## Keyboard Shortcuts

| Shortcut         | Action                         |
| ---------------- | ------------------------------ |
| `Ctrl+F` or `/`  | Open search                    |
| `Esc`            | Close search / exit focus mode |
| `F`              | Toggle pilot (spacecraft) mode |
| `M`              | Toggle minimap                 |
| `T`              | Toggle filter panel            |
| `S`              | Toggle settings panel          |
| `R`              | Reset camera to home position  |
| `P`              | Export current view as PNG     |
| `Ctrl+U` or `F5` | Reload universe                |
| `?`              | Show all shortcuts             |

---

## Settings

Open the settings panel with `S`. All settings persist between sessions.

| Setting                   | Default | Description                                      |
| ------------------------- | ------- | ------------------------------------------------ |
| Direct dependency lines   | On      | Show explicit imports between files              |
| Indirect dependency lines | Off     | Show transitive (2-hop) connections              |
| Shared dependency lines   | Off     | Show files used by many modules                  |
| Circular dependency lines | On      | Show import loops (pulses red)                   |
| Orbital animation         | Off     | Planets orbit their stars in real time           |
| Star rotation             | On      | Folder stars rotate on their axis                |
| Orbital speed             | 1.0×    | Speed multiplier for orbital animation           |
| Folder labels             | On      | Show folder names above stars                    |
| Proximity labels          | On      | File names fade in as camera approaches          |
| Background stars          | On      | Decorative starfield                             |
| Depth fog                 | On      | Distant objects fade for depth cues              |
| Git heatmap               | Off     | Colour files by commit frequency                 |
| Performance mode          | Off     | Instanced rendering for large repos (500+ files) |
| Minimap                   | Off     | Show 2D overhead minimap                         |
| Legend                    | On      | Show dependency-type colour legend               |

**Presets:** Three one-click presets are available — **Clean** (minimal, no lines), **Full Detail** (everything on), **Performance** (optimised for large repos).

---

## Excluding Files and Folders

Create a `.cosmosignore` file in your project root to exclude paths from the universe. Uses the same glob syntax as `.gitignore`.

```
# .cosmosignore

node_modules
dist
build
coverage
**/*.test.ts
**/*.spec.js
*.min.js
```

Common directories (`node_modules`, `dist`, `.git`, etc.) are excluded by default.

---

## Supported Languages

Code Cosmos parses import and dependency statements for the following languages:

| Language   | Extensions                    |
| ---------- | ----------------------------- |
| TypeScript | `.ts`, `.tsx`                 |
| JavaScript | `.js`, `.jsx`, `.mjs`, `.cjs` |
| Python     | `.py`                         |
| Java       | `.java`                       |
| Rust       | `.rs`                         |
| Go         | `.go`                         |
| C / C++    | `.c`, `.cpp`, `.h`, `.hpp`    |
| Ruby       | `.rb`                         |
| PHP        | `.php`                        |
| Swift      | `.swift`                      |
| Kotlin     | `.kt`                         |
| HTML       | `.html`                       |
| CSS / SCSS | `.css`, `.scss`               |
| Vue        | `.vue`                        |
| Svelte     | `.svelte`                     |

Files in unsupported formats still appear as planets — they just have no dependency lines.

---

## Performance

Code Cosmos is designed to handle real projects, not just small demos.

| Project size    | Expected behaviour                                        |
| --------------- | --------------------------------------------------------- |
| < 200 files     | Instant load, all features enabled                        |
| 200–500 files   | Loads in 2–5 seconds, smooth at 60 fps                    |
| 500–1 500 files | Enable **Performance Mode** for best results              |
| > 1 500 files   | Performance Mode required; parsing may take 10–20 seconds |

**Performance Mode** uses instanced mesh rendering — all planets are drawn in a single GPU draw call. It is automatically suggested for large repos.

---

## Known Limitations

- **Monorepos** — each workspace folder renders as a separate galaxy. Cross-package dependencies between workspace roots are not yet visualised.
- **Dynamic imports** — `import()` expressions and `require()` calls with variable paths cannot be statically resolved and will not appear as dependency lines.
- **Very large repos (5 000+ files)** — parsing is slower and frame rate may drop on lower-end hardware even with Performance Mode. Excluding `node_modules`, build output, and test files via `.cosmosignore` significantly improves this.

---

## Roadmap

The current release is v0.1.0 — the foundation. Planned for upcoming releases:

- Genesis animation on first load
- Path tracing between any two files
- Named camera bookmarks
- Per-planet birth and deletion animations
- Photon particle streams on dependency lines
- Test coverage visualisation
- Drag-to-migrate files between folders

See the [open issues](https://github.com/yashwanth-creator02/code-cosmos/issues) for the full list.

---

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, architecture overview, and how to submit a pull request.

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

<div align="center">

Built with Three.js · Made for VS Code

</div>
