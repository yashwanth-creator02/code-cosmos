// webview/universe/DependencyLine.ts

import * as THREE from 'three';
import { CosmosDependency, DependencyLayer } from '../../src/types';

export class DependencyLine {
  public line: THREE.Line;
  public dependency: CosmosDependency;

  constructor(
    dependency: CosmosDependency,
    startPosition: THREE.Vector3,
    endPosition: THREE.Vector3
  ) {
    this.dependency = dependency;

    const points = [startPosition, endPosition];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);

    const material = new THREE.LineBasicMaterial({
      color: dependency.layer === DependencyLayer.DIRECT
        ? 0xffffff
        : 0x444444,
      transparent: true,
      opacity: dependency.layer === DependencyLayer.DIRECT
        ? 0.4
        : 0.10,
    });

    this.line = new THREE.Line(geometry, material);
  }
}
