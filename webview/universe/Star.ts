// webview/universe/Star.ts

import * as THREE from 'three';
import { CosmosFolder } from '../../src/types/index';

export class Star {
  public mesh: THREE.Mesh;
  public position: THREE.Vector3;
  public folder: CosmosFolder;
  public light: THREE.PointLight;

  constructor(folder: CosmosFolder, position: THREE.Vector3, subtreeFileCount: number = 0) {
    this.folder = folder;
    this.position = position;

    // Size philosophy:
    // - Leaf folders (no subtree) get BASE_SIZE — fixed minimum
    // - Size grows progressively with subtree using sqrt scaling
    // - No cap — the root star can be huge, camera adjusts
    const BASE_SIZE = 5;        // fixed size for leaf folders
    const SCALE_FACTOR = 1.2;   // how much each file in subtree adds

    const size = BASE_SIZE + Math.sqrt(subtreeFileCount) * SCALE_FACTOR;

    const geometry = new THREE.SphereGeometry(size, 16, 16);

    // Slightly vary star color by depth/size to add visual interest
    // Larger stars (more files) trend warmer/yellower
    // Smaller stars (leaf folders) trend cooler/whiter
    const warmth = Math.min(1, subtreeFileCount / 50);
    const r = 0.95 + warmth * 0.05;
    const g = 0.93 + warmth * 0.02;
    const b = 0.78 - warmth * 0.2;
    const color = new THREE.Color(r, g, b);

    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.35,
    });

    // Light radius scales with star size so larger stars illuminate more
    const lightRadius = Math.max(120, size * 18);
    const starLight = new THREE.PointLight(0xfff5c0, 0.8, lightRadius);
    starLight.position.copy(position);
    this.light = starLight;

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.copy(position);
    this.mesh.userData = { type: 'star', id: folder.id };
  }
}
