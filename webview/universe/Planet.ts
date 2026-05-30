// webview/universe/Planet.ts

import * as THREE from 'three';
import { CosmosFile, FileType } from '../../src/types/index';

// Color map — balanced, vibrant cosmic palette for dark backgrounds
const FILE_TYPE_COLORS: Record<FileType, number> = {
  // Deep sky cyan - highly visible, premium feel
  [FileType.TS]: 0x00D2FF,

  // Neon electric yellow/gold - sharp contrast without being muddy
  [FileType.JS]: 0xFFD700,

  // Bright emerald/mint green - clean and luminous
  [FileType.HTML]: 0x00E676,

  // Cosmic orchid/magenta - pops beautifully against black
  [FileType.CSS]: 0xE040FB,

  // Warm amber/coral - distinctive from JS yellow
  [FileType.PY]: 0xFF6D00,

  // High-contrast orange-red - gives Java a bold identity
  [FileType.JAVA]: 0xFF3D00,

  // Clean slate silver - cool tone for non-code visual assets
  [FileType.ASSET]: 0x90A4AE,

  // Subtle muted charcoal - keeps unimportant files in the background
  [FileType.OTHER]: 0x455A64,

  // New languages — each distinct, visually balanced on black
  [FileType.RUST]:   0xF74C00,  // Rust orange (matches the language logo)
  [FileType.GO]:     0x00ACD7,  // Go's official cyan-blue
  [FileType.CPP]:    0x004488,  // Deep navy blue (classic C++ association)
  [FileType.RUBY]:   0xCC342D,  // Ruby red
  [FileType.PHP]:    0x8892BF,  // PHP indigo-blue
  [FileType.SWIFT]:  0xF05138,  // Swift orange-red (matches Apple branding)
  [FileType.KOTLIN]: 0x7F52FF,  // Kotlin purple (JetBrains official)
  [FileType.VUE]:    0x42B883,  // Vue green (official)
  [FileType.SVELTE]: 0xFF3E00,  // Svelte flame orange (official)
};

export class Planet {
  public mesh: THREE.Mesh;
  public file: CosmosFile;

  constructor(
    file: CosmosFile,
    position: THREE.Vector3,
    performanceMode: boolean = false
  ) {
    this.file = file;

    // Performance mode: 6 segments vs 40 — massive geometry reduction
    const segments = performanceMode ? 6 : 40;
    const geometry = new THREE.SphereGeometry(2, segments, segments);

    const material = new THREE.MeshStandardMaterial({
      color: FILE_TYPE_COLORS[file.type],
      emissive: FILE_TYPE_COLORS[file.type],
      emissiveIntensity: 0.3,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.copy(position);
    this.mesh.userData = { type: 'planet', id: file.id };
  }
}
