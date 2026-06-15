// webview/universe/Star.ts

import * as THREE from 'three';
import { CosmosFolder } from '../../src/types/index';

/**
 * Represents a star in the 3D universe, which serves as a visual hub for a folder.
 * Stars vary in size and color based on the number of files they contain.
 */
export class Star {
  /** The main mesh representing the star's surface. */
  public mesh: THREE.Mesh;

  /** The 3D position of the star in the scene. */
  public position: THREE.Vector3;

  /** The folder data associated with this star. */
  public folder: CosmosFolder;

  /** The point light emitted by the star. */
  public light: THREE.PointLight;

  /** An additional mesh used to create a glow halo effect around the star. */
  public glowMesh: THREE.Mesh; // inner glow halo

  /**
   * Creates a new Star instance.
   *
   * @param folder The folder data this star represents.
   * @param position The 3D position of the star.
   * @param subtreeFileCount The total number of files in this folder's subtree, used for sizing and coloring.
   * @param performanceMode If true, reduces the geometric complexity of the star.
   */
  constructor(
    folder: CosmosFolder,
    position: THREE.Vector3,
    subtreeFileCount: number = 0,
    performanceMode: boolean = false
  ) {
    this.folder = folder;
    this.position = position;

    // Progressive sizing — leaf folders fixed, grows with subtree
    const BASE_SIZE = 5;
    const SCALE_FACTOR = 1.1;
    const size = BASE_SIZE + Math.sqrt(subtreeFileCount) * SCALE_FACTOR;

    const segments = performanceMode ? 8 : 20;

    // Star color — cooler (blue-white) for small/leaf, warmer (yellow) for large
    // This mirrors real stellar classification (O/B = hot blue, K/M = cool yellow/red)
    const warmth = Math.min(1, subtreeFileCount / 60);

    let color: THREE.Color;
    if (warmth < 0.15) {
      // Small leaf folder — blue-white (hot star)
      color = new THREE.Color(0xc8d8ff);
    } else if (warmth < 0.4) {
      // Medium — white-yellow
      color = new THREE.Color(0xfff4d0);
    } else if (warmth < 0.7) {
      // Large — warm yellow
      color = new THREE.Color(0xffe87a);
    } else {
      // Very large — orange-yellow (giant star)
      color = new THREE.Color(0xffcc44);
    }

    const geometry = new THREE.SphereGeometry(size, segments, segments);
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.5,
      roughness: 0.4,
      metalness: 0.0,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.copy(position);
    this.mesh.userData = { type: 'star', id: folder.id };

    // Glow halo — slightly larger transparent sphere around the star
    const glowGeo = new THREE.SphereGeometry(size * 1.6, 16, 16);
    const glowMat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.15,
      transparent: true,
      opacity: 0.12,
      side: THREE.BackSide,
    });
    this.glowMesh = new THREE.Mesh(glowGeo, glowMat);
    this.glowMesh.position.copy(position);

    // Point light — color matches star, radius scales with size
    const lightColor = color.clone().multiplyScalar(1.1);
    const lightRadius = Math.max(150, size * 22);
    const lightIntensity = 0.6 + warmth * 0.4;
    this.light = new THREE.PointLight(lightColor, lightIntensity, lightRadius);
    this.light.position.copy(position);
  }
}
