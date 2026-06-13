# Change Log

All notable changes to **Code Cosmos** are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [0.3.0] — 2026-06-12

### Added

**`.cosmos.cache` — expensive-data cache**

- New per-workspace `.cosmos.cache` file caches the full dependency graph, git churn scores, and spatial layout
- On load, a lightweight fingerprint (file manifest of size+mtime, plus current git HEAD via the VS Code git API) is computed and compared against the cache
- If the fingerprint matches, AST parsing and git log (the two genuinely expensive operations — git log alone can issue up to 500 diffBetween calls) are skipped entirely and cached data is returned directly
- If the fingerprint differs, a full rebuild runs and writes a fresh cache
- Manual refresh (`code-cosmos.refreshCosmos`) always bypasses the cache — explicit user intent means fresh data regardless of fingerprint
- `.cosmos.cache` is automatically added to `.gitignore` alongside `.cosmos`

### Fixed

**Camera bookmarks now persist correctly**

- Previously stored only in `localStorage` and never reached `.cosmos` — bookmarks didn't survive across machines or appear in the `.cosmos` file
- New `SAVE_NAVIGATION` / `APPLY_NAVIGATION` message pair round-trips bookmarks through the per-project `.cosmos` file (`navigation.namedSlots`)
- Bookmarks load from `.cosmos` on cosmos open and save immediately when added or removed

**`.cosmos` and `.cosmos.cache` excluded from the cosmos itself**

- These files were not in the exclusion list — they would appear as "planets" in the visualization, and writing `.cosmos.cache` would change its own size/mtime, causing the fingerprint check to always report "changed" (a self-invalidating cache loop)
- Added to `SMART_DEFAULTS` in the exclusion manager

---

## [0.2.0] — 2026-06-11

### Added

**Visual encoding**

- Planet size now encodes file weight — larger files render as larger planets using logarithmic scale (0.5× to 3.0×)
- Cyan compression ring on files above 100 KB indicating the planet is rendered smaller than its true size
- Subtle thermal tint always active — recently touched files glow brighter, ancient files dim slightly, even without git data
- Size-based brightness fallback when git is unavailable

**Dependency lines**

- Quadratic Bézier curves replace straight lines — lines now route through shared parent stars reducing visual hairball
- Bézier control points update live during orbital animation

**Navigation**

- Camera bookmarks — save up to 5 named views, recall with Ctrl+1–5 or click, cinematic cubic-ease flight
- Inline bookmark name dialog (VS Code WebView blocks window.prompt — replaced with native DOM input)
- Beacon chip — passive floating indicator when the active editor file is off-screen, click to fly to it
- Path trace — shift-click two planets to find the shortest BFS dependency path between them
- Closest Common Ancestor shown in gold when no direct path exists

**Multi-select**

- Shift-click to accumulate planet selection with gold highlight rings
- Selection panel shows selected files and path trace breadcrumb
- Selection persistent until Escape or Clear button

**UI & UX**

- Onboarding overlay on first launch — 4 concept cards, key shortcuts, recallable with ?
- Repo name and branch always visible in top-left header
- Right-click context menu on planets — Open File, Copy Path, Show Dependencies, Fly To, Add to Selection
- Stale indicator pill appears when files change without requiring a full rebuild
- Unified Escape key handler — closes panels in priority order

**Extension architecture**

- Moved from editor tab (ViewColumn.Beside) to Activity Bar sidebar (WebviewViewProvider)
- SVG icon for Activity Bar — renders cleanly at small sizes with VS Code theme colours
- ResizeObserver replaces window resize listener — fixes blank canvas on panel resize
- Smart rebuild: 5s debounce, skips rebuild when panel hidden, rebuilds on panel reveal

### Fixed

- Git data now merged from all workspace roots (was silently missing for non-primary roots)
- Settings key S remapped to G — no longer conflicts with spacecraft backward movement
- window.prompt replaced with inline DOM dialog throughout (blocked by VS Code WebView sandbox)
- Spacecraft mode only registers movement keys when active — prevents phantom movement

### Changed

- Keyboard shortcut for settings: **S → G** (Gear)
- Spacecraft mode toggle: **F** (unchanged, but now correctly isolated from other key bindings)

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
