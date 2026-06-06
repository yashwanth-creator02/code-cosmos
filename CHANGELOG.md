# Change Log

All notable changes to **Code Cosmos** are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [0.1.0] — 2026-06-07

### Added

**Core visualization**

- Interactive 3D universe rendering powered by Three.js inside a VS Code Webview
- Folders rendered as stars with stellar-classification colours (O/B blue-white → K/M warm orange-red) based on child count
- Files rendered as planets orbiting their parent star using golden-angle spherical distribution and 3D orbital inclinations
- Central sun with multi-layer breathing emissive pulse and slow axial rotation
- Star glow halos — transparent overlay sphere around each folder star
- Background starfield of 3 000 colour-varied points distributed across a hemisphere

**Dependency visualization**

- 5 dependency layers: direct imports, transitive (depth-2), circular dependencies, shared dependents, shared dependencies
- 16-language dependency parser: TypeScript, JavaScript, JSX/TSX, HTML, CSS/SCSS, Python, Java, Rust, Go, C++, Ruby, PHP, Swift, Kotlin, Vue, Svelte
- Circular dependency lines pulse red as a visual warning
- Per-layer toggle controls in the filter panel

**Git integration**

- Active branch name displayed in the HUD
- File churn heatmap — planet colour shifts toward orange-red for frequently changed files
- Recency scoring — recently modified files glow brighter
- Uncommitted change rings — animated rings around modified/staged planets

**Navigation & controls**

- Spacecraft navigation mode — WASD + QE flight through the universe
- Minimap — 2D canvas overhead view with camera crosshair, click-to-navigate, `M` key toggle
- Search with fly-to animation — camera smoothly travels to the matching planet
- Proximity labels — file/folder names fade in as the camera approaches
- Focus mode — dim everything except a selected file or folder and its connections
- Named camera bookmarks — save and recall up to 5 named viewpoints

**Settings**

- Three built-in presets: Clean, Full Detail, Performance
- 15 individual toggles for every visual layer
- Settings persist across sessions via VS Code global state

**Performance & utility**

- Performance mode — instanced mesh rendering for large repos (500+ files)
- Export as PNG — saves a screenshot of the current view
- Live file watcher — cosmos refreshes when files are added, deleted, or changed
- `.cosmosignore` — exclude files and folders using glob patterns
- Onboarding overlay on first launch

---

## [Unreleased]

See [ROADMAP](https://github.com/yashwanth-creator02/code-cosmos#roadmap) for planned features.
