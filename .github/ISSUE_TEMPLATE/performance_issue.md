---
name: Performance issue
about: The extension is slow, laggy, or consuming too much memory/CPU
title: '[Perf] '
labels: performance
assignees: ''
---

## Describe the performance issue

What is slow, unresponsive, or consuming too many resources?

## When does it occur

- [ ] On first open (initial scan)
- [ ] On subsequent opens (cache should be active)
- [ ] During navigation (camera movement)
- [ ] During rendering (frame drops)
- [ ] After leaving the panel open for a while
- [ ] Other:

## Measurements

If you can, include:

- Time to first render (approximately)
- FPS in the cosmos (shown in Settings → About / Diagnostics)
- RAM / CPU usage from Task Manager or Activity Monitor

## Project details

- Approximate file count:
- Languages in the project:
- Is Performance Mode enabled? (Settings → Performance Mode)
- Does it improve with Performance Mode on?

## Environment

- **OS:**
- **VS Code version:**
- **Code Cosmos version:**
- **GPU / graphics card:**
- **RAM:**

## Additional context

Whether `.cosmos.cache` is being used (check Output panel for "cache hit" vs "cache miss" messages), any error messages, etc.
