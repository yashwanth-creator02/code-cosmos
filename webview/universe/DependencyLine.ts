// webview/universe/DependencyLine.ts

import * as THREE from 'three';
import { CosmosDependency, DependencyLayer, DependencyType } from '../../src/types';

export class DependencyLine {
  public line: THREE.Line;
  public dependency: CosmosDependency;
  public readonly baseOpacity: number;
  public readonly drawPriority: number;

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
    let priority: number;

    switch (dependency.layer) {
      case DependencyLayer.CIRCULAR:
        color = 0xff1744;
        opacity = 0.8;
        priority = 0;
        break;
      case DependencyLayer.DIRECT:
        color = dependency.type === DependencyType.REFERENCE ? 0x7ee787 : 0xffffff;
        opacity = dependency.type === DependencyType.REFERENCE ? 0.32 : 0.4;
        priority = 1;
        break;
      case DependencyLayer.INDIRECT:
        color = 0x4488ff;
        opacity = 0.08;
        priority = 2;
        break;
      case DependencyLayer.LAYER3_SHARED_DEPENDENT:
        color = 0xffb300;
        opacity = 0.04;
        priority = 3;
        break;
      case DependencyLayer.LAYER3_SHARED_DEPENDENCY:
        color = 0x00bcd4;
        opacity = 0.04;
        priority = 4;
        break;
      default:
        color = 0xffffff;
        opacity = 0.1;
        priority = 5;
    }

    this.baseOpacity = opacity;
    this.drawPriority = priority;

    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
    });

    this.line = new THREE.Line(geometry, material);
  }
}
