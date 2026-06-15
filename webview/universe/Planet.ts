// webview/universe/Planet.ts

import { FileType } from '../../src/types/index';

/**
 * A mapping of file types to their corresponding hex colors for visual representation in the universe.
 * Colors are chosen for high contrast and visibility against dark backgrounds.
 */
export const FILE_TYPE_COLORS: Record<FileType, number> = {
  // Deep sky cyan - highly visible, premium feel
  [FileType.TS]: 0x00d2ff,

  // Neon electric yellow/gold - sharp contrast without being muddy
  [FileType.JS]: 0xffd700,

  // Bright emerald/mint green - clean and luminous
  [FileType.HTML]: 0x00e676,

  // Cosmic orchid/magenta - pops beautifully against black
  [FileType.CSS]: 0xe040fb,

  // Warm amber/coral - distinctive from JS yellow
  [FileType.PY]: 0xff6d00,

  // High-contrast orange-red - gives Java a bold identity
  [FileType.JAVA]: 0xff3d00,

  // Clean slate silver - cool tone for non-code visual assets
  [FileType.ASSET]: 0x90a4ae,

  // Subtle muted charcoal - keeps unimportant files in the background
  [FileType.OTHER]: 0x455a64,

  // New languages — each distinct, visually balanced on black
  [FileType.RUST]: 0xf74c00, // Rust orange (matches the language logo)
  [FileType.GO]: 0x00acd7, // Go's official cyan-blue
  [FileType.CPP]: 0x004488, // Deep navy blue (classic C++ association)
  [FileType.RUBY]: 0xcc342d, // Ruby red
  [FileType.PHP]: 0x8892bf, // PHP indigo-blue
  [FileType.SWIFT]: 0xf05138, // Swift orange-red (matches Apple branding)
  [FileType.KOTLIN]: 0x7f52ff, // Kotlin purple (JetBrains official)
  [FileType.VUE]: 0x42b883, // Vue green (official)
  [FileType.SVELTE]: 0xff3e00, // Svelte flame orange (official)
};
