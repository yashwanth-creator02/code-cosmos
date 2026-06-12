// webview/universe/DependencyLine.ts

import * as THREE from 'three';
import { CosmosDependency, DependencyLayer, DependencyType } from '../../src/types';

// ---------------------------------------------------------------------------
// Quadratic Bézier dependency lines
//
// Previous implementation: straight THREE.Line from A to B.
// Problem: on any real codebase with 100+ files and many deps, this creates
// a visual "hairball" — an unreadable knot of crossing lines.
//
// This implementation: quadratic Bézier curve with a control point pulled
// toward the shared parent star (the folder both files belong to, or the
// scene origin as fallback). Lines traveling the same general direction
// naturally bundle together rather than crossing everywhere.
//
// The control point heuristic: midpoint between the two planets, pulled
// inward by CURVE_PULL toward the nearest star or scene center.
// This is ~80% of the visual benefit of full Hierarchical Edge Bundling
// at ~5% of the implementation complexity.
//
// CURVE_RESOLUTION: number of segments on the Bézier curve.
// Higher = smoother, but more geometry. 12 is a good tradeoff.
// ---------------------------------------------------------------------------

const CURVE_RESOLUTION = 12;
const CURVE_PULL = 0.45; // 0 = straight line, 1 = fully collapsed to control point

export class DependencyLine {
  public line: THREE.Line;
  public dependency: CosmosDependency;
  public readonly baseOpacity: number;
  public readonly baseColor: THREE.Color;

  // Mutable position refs for animation updates (orbital mode)
  private startPos: THREE.Vector3;
  private endPos: THREE.Vector3;
  private controlPos: THREE.Vector3;

  constructor(
    dependency: CosmosDependency,
    startPosition: THREE.Vector3,
    endPosition: THREE.Vector3,
    controlHint?: THREE.Vector3 // nearest shared star position, or undefined for midpoint heuristic
  ) {
    this.dependency = dependency;
    this.startPos = startPosition.clone();
    this.endPos = endPosition.clone();

    // Determine color and opacity by dependency layer
    let color: THREE.Color;
    let opacity: number;

    switch (dependency.layer) {
      case DependencyLayer.CIRCULAR:
        // Red — danger signal, high opacity so it stands out
        color = new THREE.Color(0xff1744);
        opacity = 0.8;
        break;

      case DependencyLayer.DIRECT:
        // White for default imports, green for re-exports
        color =
          dependency.type === DependencyType.REFERENCE
            ? new THREE.Color(0x7ee787)
            : new THREE.Color(0xffffff);
        opacity = 0.55;
        break;

      case DependencyLayer.INDIRECT:
        // Blue — secondary, kept subtle
        color = new THREE.Color(0x4488ff);
        opacity = 0.08;
        break;

      case DependencyLayer.LAYER3_SHARED_DEPENDENT:
        color = new THREE.Color(0xffb300);
        opacity = 0.06;
        break;

      case DependencyLayer.LAYER3_SHARED_DEPENDENCY:
        color = new THREE.Color(0x00bcd4);
        opacity = 0.06;
        break;

      default:
        color = new THREE.Color(0xffffff);
        opacity = 0.1;
    }

    this.baseOpacity = opacity;
    this.baseColor = color;

    // Compute the Bézier control point.
    // If a shared star position is provided, pull the midpoint toward it.
    // Otherwise, pull toward the scene origin (central sun) as a fallback.
    const mid = new THREE.Vector3().addVectors(startPosition, endPosition).multiplyScalar(0.5);
    const anchor = controlHint ?? new THREE.Vector3(0, 0, 0);
    this.controlPos = new THREE.Vector3().lerpVectors(mid, anchor, CURVE_PULL);

    const geometry = this.buildGeometry();
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      vertexColors: false,
    });

    this.line = new THREE.Line(geometry, material);
  }

  // ---------------------------------------------------------------------------
  // Build BufferGeometry for the quadratic Bézier curve
  // B(t) = (1-t)² P0 + 2(1-t)t P1 + t² P2
  // ---------------------------------------------------------------------------

  private buildGeometry(): THREE.BufferGeometry {
    const positions = new Float32Array((CURVE_RESOLUTION + 1) * 3);

    for (let i = 0; i <= CURVE_RESOLUTION; i++) {
      const t = i / CURVE_RESOLUTION;
      const u = 1 - t;

      // Quadratic Bézier
      const x = u * u * this.startPos.x + 2 * u * t * this.controlPos.x + t * t * this.endPos.x;
      const y = u * u * this.startPos.y + 2 * u * t * this.controlPos.y + t * t * this.endPos.y;
      const z = u * u * this.startPos.z + 2 * u * t * this.controlPos.z + t * t * this.endPos.z;

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geometry;
  }

  // ---------------------------------------------------------------------------
  // Called from animate() when orbital animation is on — updates the curve
  // endpoints while keeping the control point anchored to the star position.
  // ---------------------------------------------------------------------------

  public updateEndpoints(
    newStart: THREE.Vector3,
    newEnd: THREE.Vector3,
    controlHint?: THREE.Vector3
  ): void {
    this.startPos.copy(newStart);
    this.endPos.copy(newEnd);

    const mid = new THREE.Vector3().addVectors(newStart, newEnd).multiplyScalar(0.5);
    const anchor = controlHint ?? new THREE.Vector3(0, 0, 0);
    this.controlPos.lerpVectors(mid, anchor, CURVE_PULL);

    const pos = this.line.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i <= CURVE_RESOLUTION; i++) {
      const t = i / CURVE_RESOLUTION;
      const u = 1 - t;
      pos.setXYZ(
        i,
        u * u * this.startPos.x + 2 * u * t * this.controlPos.x + t * t * this.endPos.x,
        u * u * this.startPos.y + 2 * u * t * this.controlPos.y + t * t * this.endPos.y,
        u * u * this.startPos.z + 2 * u * t * this.controlPos.z + t * t * this.endPos.z
      );
    }
    pos.needsUpdate = true;
  }
}
