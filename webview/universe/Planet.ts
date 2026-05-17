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
};

export class Planet {
  public mesh: THREE.Mesh;
  public file: CosmosFile;

  constructor(file: CosmosFile, position: THREE.Vector3) {
    this.file = file;

    const geometry = new THREE.SphereGeometry(2, 40, 40);

    const material = new THREE.MeshStandardMaterial({
      color: FILE_TYPE_COLORS[file.type],
      emissive: FILE_TYPE_COLORS[file.type],
      emissiveIntensity: 0.1,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.copy(position);

    this.mesh.userData = { type: 'planet', id: file.id };
  }
}
