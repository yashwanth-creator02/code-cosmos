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

    const minSize = 4;
    const baseSize = 6;
    const multiplier = 0.4;

    const size = Math.max(3, 4 + Math.sqrt(subtreeFileCount) * 0.8);

    const geometry = new THREE.SphereGeometry(size, 16, 16);
    const color = 0xfff4cc;
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.3,
    });
    const starLight = new THREE.PointLight(0xfff5c0, 0.8, 150);
    starLight.position.copy(position);
    this.light = starLight;
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.copy(position);

    this.mesh.userData = { type: 'star', id: folder.id };
  }
}
