// webview/universe/DependencyLine.ts

import * as THREE from 'three';
import { CosmosDependency, DependencyLayer, DependencyType } from '../../src/types';

export class DependencyLine {
  public line: THREE.Line;
  public dependency: CosmosDependency;
  public readonly baseOpacity: number;
  public readonly baseColor: THREE.Color;

  constructor(
    dependency: CosmosDependency,
    startPosition: THREE.Vector3,
    endPosition: THREE.Vector3
  ) {
    this.dependency = dependency;

    let color: THREE.Color;
    let opacity: number;

    switch (dependency.layer) {
      case DependencyLayer.CIRCULAR:
        color = new THREE.Color(0xFF1744);
        opacity = 0.8;
        break;
      case DependencyLayer.DIRECT:
        color = dependency.type === DependencyType.REFERENCE
          ? new THREE.Color(0x7ee787)
          : new THREE.Color(0xffffff);
        opacity = 0.6;
        break;
      case DependencyLayer.INDIRECT:
        color = new THREE.Color(0x4488ff);
        opacity = 0.08;
        break;
      case DependencyLayer.LAYER3_SHARED_DEPENDENT:
        color = new THREE.Color(0xFFB300);
        opacity = 0.06;
        break;
      case DependencyLayer.LAYER3_SHARED_DEPENDENCY:
        color = new THREE.Color(0x00BCD4);
        opacity = 0.06;
        break;
      default:
        color = new THREE.Color(0xffffff);
        opacity = 0.1;
    }

    this.baseOpacity = opacity;
    this.baseColor = color;

    const geometry = new THREE.BufferGeometry();

    const positions = new Float32Array([
      startPosition.x, startPosition.y, startPosition.z,
      endPosition.x, endPosition.y, endPosition.z,
    ]);

    // Gradient: source bright, target dim — shows import direction
    const colors = new Float32Array([
      color.r, color.g, color.b,
      color.r * 0.15, color.g * 0.15, color.b * 0.15,
    ]);

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity,
    });

    this.line = new THREE.Line(geometry, material);
  }
}
