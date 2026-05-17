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

    let color: number;
    let opacity: number;

    switch (dependency.layer) {
      case DependencyLayer.CIRCULAR:
        color = 0xFF1744;   // red — danger
        opacity = 0.8;      // very visible
        break;
      case DependencyLayer.DIRECT:
        color = 0xffffff;
        opacity = 0.4;
        break;
      case DependencyLayer.INDIRECT:
        color = 0x4488ff;
        opacity = 0.01;
        break;
      case DependencyLayer.LAYER3_SHARED_DEPENDENT:
        color = 0xFFB300;  // amber — shared parent
        opacity = 0.04;
        break;
      case DependencyLayer.LAYER3_SHARED_DEPENDENCY:
        color = 0x00BCD4;  // teal — shared foundation
        opacity = 0.04;
        break;
      default:
        color = 0xffffff;
        opacity = 0.1;
    }

    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
    });

    this.line = new THREE.Line(geometry, material);
  }
}
