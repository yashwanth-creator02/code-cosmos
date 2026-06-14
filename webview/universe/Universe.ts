// webview/universe/Universe.ts

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Star } from './Star';
import { FILE_TYPE_COLORS } from './Planet';
import { DependencyLine } from './DependencyLine';
import { sendToExtension } from '../bridge/messageBridge';
import {
  CosmosFolder,
  CosmosDependency,
  DependencyLayer,
  DependencyType,
  CosmosData,
  StarNode,
  SettingsState,
  DEFAULT_SETTINGS,
  GitData,
  CosmosFile,
  FileType,
  NavigationData,
  CameraState,
  NamedCameraSlot,
} from '../../src/types';

const PRESETS = {
  clean: {
    showDirectLines: true,
    showIndirectLines: false,
    showLayer3Lines: false,
    showCircularLines: true,
    enableAnimation: false,
    enableStarRotation: true,
    orbitalSpeed: 1.0,
    showFolderLabels: true,
    showProximityLabels: true,
    showBackgroundStars: true,
    enableFog: true,
    showLegend: true,
    performanceMode: false,
    showMinimap: false,
    showGitHeatmap: false,
  },
  full: {
    showDirectLines: true,
    showIndirectLines: true,
    showLayer3Lines: true,
    showCircularLines: true,
    enableAnimation: true,
    enableStarRotation: true,
    orbitalSpeed: 1.0,
    showFolderLabels: true,
    showProximityLabels: true,
    showBackgroundStars: true,
    enableFog: true,
    showLegend: true,
    performanceMode: false,
    showMinimap: true,
    showGitHeatmap: true,
  },
  performance: {
    showDirectLines: true,
    showIndirectLines: false,
    showLayer3Lines: false,
    showCircularLines: true,
    enableAnimation: false,
    enableStarRotation: false,
    orbitalSpeed: 1.0,
    showFolderLabels: false,
    showProximityLabels: false,
    showBackgroundStars: false,
    enableFog: false,
    showLegend: true,
    performanceMode: true,
    showMinimap: false,
    showGitHeatmap: false,
  },
};

interface PlanetData {
  file: CosmosFile;
  position: THREE.Vector3;
  instanceIndex: number;
  scale: number; // current render scale (may be boosted by git churn)
  baseScale: number; // intrinsic LOC-derived scale — never mutated after build
  color: number;
  visible: boolean;
}

// ---------------------------------------------------------------------------
// Planet size encoding
//
// Maps file.size (bytes) → a normalised scale in [MIN_SCALE, MAX_SCALE].
// Using a logarithmic curve so a 100-byte file and a 1 KB file look
// meaningfully different, but a 100 KB file and a 500 KB file don't
// both look enormous. Log base is tunable.
// ---------------------------------------------------------------------------

const PLANET_MIN_SCALE = 0.5; // smallest planet (tiny config files, assets)
const PLANET_MAX_SCALE = 3.0; // largest planet before compression ring kicks in
const PLANET_COMPRESS_BYTES = 100_000; // files larger than this get a compression ring

function computePlanetScale(fileSize: number, minSize: number, maxSize: number): number {
  if (maxSize <= minSize) {
    return 1.0;
  }
  // Logarithmic normalisation — clamp to 1 to avoid log(0)
  const logSize = Math.log(Math.max(fileSize, 1));
  const logMin = Math.log(Math.max(minSize, 1));
  const logMax = Math.log(Math.max(maxSize, 1));
  const t = (logSize - logMin) / (logMax - logMin); // 0..1
  return PLANET_MIN_SCALE + t * (PLANET_MAX_SCALE - PLANET_MIN_SCALE);
}

export class Universe {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private stars: Map<string, Star> = new Map();
  private planets: Map<string, PlanetData> = new Map();
  private planetInstanceMesh: THREE.InstancedMesh | null = null;
  private instanceToPlanet: Map<number, string> = new Map();
  private lines: DependencyLine[] = [];
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private data: CosmosData | null = null;
  private dependencies: CosmosDependency[] = [];
  private focusedFileId: string | null = null;
  private defaultCameraPosition = new THREE.Vector3(0, 0, 1200);
  private centralCore: THREE.Mesh | null = null;
  private centralObjects: THREE.Object3D[] = [];
  private spacecraftMode = false;
  private keys: Record<string, boolean> = {};
  private pitch = 0;
  private yaw = 0;
  private orbitalData: Map<
    string,
    {
      starPosition: THREE.Vector3;
      angle: number;
      inclination: number;
      speed: number;
      radius: number;
    }
  > = new Map();
  private starLabels: THREE.Sprite[] = [];
  private planetLabels: Map<string, THREE.Sprite> = new Map();
  private readonly LABEL_SHOW_DISTANCE = 150;
  private lastMouseMoveTime = 0;
  private settings: SettingsState = { ...DEFAULT_SETTINGS };
  private backgroundStars: THREE.Points | null = null;
  private focusedStarId: string | null = null;
  private visibleTypes: Set<string> = new Set();
  private lastPerformanceMode = false;
  private gitData: GitData | null = null;
  private minimapCanvas: HTMLCanvasElement | null = null;
  private minimapCtx: CanvasRenderingContext2D | null = null;
  private minimapVisible = false;
  private readonly MINIMAP_WORLD_SIZE = 1200;
  private uncommittedRings: Map<string, THREE.Mesh> = new Map();
  private compressionRings: Map<string, THREE.Mesh> = new Map();

  // Beacon chip — tracks the active editor file when camera drifts away from it
  private beaconFileId: string | null = null;
  private beaconVisible = false;

  // Onboarding — shown on first launch, recallable via ? key
  private static readonly ONBOARDING_KEY = 'cosmos_onboarding_v1_seen';
  private onboardingSeen = false;

  // Multi-select — shift-click accumulates selected planet IDs
  private selectedPlanetIds: Set<string> = new Set();
  private selectionHighlights: Map<string, THREE.Mesh> = new Map();

  // Path trace — active when exactly 2 planets are selected
  private pathTraceLines: THREE.Line[] = [];

  // Camera bookmarks — up to MAX_BOOKMARKS named slots, persisted to the
  // per-project .cosmos file via SAVE_NAVIGATION (see saveBookmark/deleteBookmark).
  // Previously these lived only in localStorage and never reached .cosmos —
  // that was the bug: bookmarks didn't survive across machines/clones and
  // weren't visible in the .cosmos file the user inspects.
  private static readonly MAX_BOOKMARKS = 5;
  private cameraBookmarks: NamedCameraSlot[] = [];
  private navigationLoaded = false; // true once APPLY_NAVIGATION has been processed

  constructor(canvas: HTMLCanvasElement) {
    this.scene = new THREE.Scene();
    // Deep space color — slightly blue-tinted black feels more like space
    this.scene.background = new THREE.Color(0x020408);
    this.scene.fog = new THREE.FogExp2(0x020408, 0.00005);

    this.camera = new THREE.PerspectiveCamera(
      75,
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      15000
    );
    this.camera.position.z = 1200;
    this.defaultCameraPosition = this.camera.position.clone();

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setSize(canvas.clientWidth || 800, canvas.clientHeight || 600, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Warm deep-space ambient — not pure white, slightly warm
    const ambientLight = new THREE.AmbientLight(0xfff4e8, 0.15);
    this.scene.add(ambientLight);

    // Strong central sun light — warm golden
    const pointLight = new THREE.PointLight(0xffcc66, 2.5, 10000);
    pointLight.position.set(0, 0, 0);
    this.scene.add(pointLight);

    // Subtle fill light from opposite direction — prevents pure black shadows
    const fillLight = new THREE.PointLight(0x4466ff, 0.3, 6000);
    fillLight.position.set(-500, 300, -500);
    this.scene.add(fillLight);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 12000;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = true;
    this.controls.rotateSpeed = 0.8;
    this.controls.zoomSpeed = 1.2;
    this.controls.panSpeed = 0.8;

    this.raycaster.params.Line = { threshold: 2 };

    canvas.addEventListener('click', (event) => this.onClick(event, canvas));
    canvas.addEventListener('mousemove', (event) => this.onMouseMove(event, canvas));
    canvas.addEventListener('contextmenu', (event) => this.onContextMenu(event, canvas));
    canvas.addEventListener('mouseleave', () => {
      const tooltip = document.getElementById('tooltip')!;
      tooltip.style.display = 'none';
    });

    window.addEventListener('resize', () => this.onResize(canvas));

    // ResizeObserver fires after DOM layout is complete with accurate dimensions.
    // window 'resize' fires before layout and reads stale clientWidth/clientHeight,
    // causing the renderer to set itself to 0×0 and produce a blank canvas on resize.
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          this.camera.aspect = width / height;
          this.camera.updateProjectionMatrix();
          this.renderer.setSize(width, height, false);
        }
      }
    });
    resizeObserver.observe(canvas);
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        this.exitFocusMode();
        this.exitStarFocusMode();
      }
    });

    this.initSpacecraftMode();
    this.initSearch();
    this.initResetButton();
    this.initHelpButton();
    this.initExportButton();
    this.initMinimap();
    this.initExitFocusButton();
    this.initRefreshButton();
    this.initFilterBar();
    this.initSettingsPanel();
    this.initOnboarding();
    this.initBeaconChip();
    this.initCameraBookmarks();
    this.initMultiSelect();
    this.initOnscreenEsc();
    this.addBackgroundStars();
    this.animate();
  }

  private disposeSceneObject(object: THREE.Object3D): void {
    this.scene.remove(object);
    const disposable = object as THREE.Object3D & {
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
    };
    if (disposable.geometry) {
      disposable.geometry.dispose();
    }
    const disposeMaterial = (material: THREE.Material): void => {
      const m = material as THREE.Material & { map?: THREE.Texture | null };
      if (m.map) {
        m.map.dispose();
      }
      material.dispose();
    };
    if (Array.isArray(disposable.material)) {
      disposable.material.forEach(disposeMaterial);
    } else if (disposable.material) {
      disposeMaterial(disposable.material);
    }
  }

  private isTextInputTarget(target: EventTarget | null): boolean {
    return (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    );
  }

  private escapeHtml(value: string): string {
    const replacements: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return value.replace(/[&<>"']/g, (char) => replacements[char]);
  }

  private getDirectoryLabel(relativePath: string, fileName: string): string {
    return relativePath.endsWith(fileName) ? relativePath.slice(0, -fileName.length) : relativePath;
  }

  public build(data: CosmosData): void {
    this.gitData = data.gitData;
    this.data = data;
    this.dependencies = data.dependencies;
    this.focusedFileId = null;

    // Clear everything
    this.stars.forEach((star) => {
      this.disposeSceneObject(star.mesh);
      this.disposeSceneObject(star.light);
      if (star.glowMesh) {
        this.disposeSceneObject(star.glowMesh);
      }
    });
    if (this.planetInstanceMesh) {
      this.disposeSceneObject(this.planetInstanceMesh);
      this.planetInstanceMesh = null;
    }
    this.starLabels.forEach((label) => this.disposeSceneObject(label));
    this.lines.forEach((line) => this.disposeSceneObject(line.line));
    this.planetLabels.forEach((label) => this.disposeSceneObject(label));
    this.centralObjects.forEach((object) => this.disposeSceneObject(object));
    this.uncommittedRings.forEach((r) => this.scene.remove(r));
    this.compressionRings.forEach((r) => this.scene.remove(r));
    this.selectionHighlights.forEach((r) => this.scene.remove(r));
    this.clearPathTrace(false);

    this.stars.clear();
    this.planets.clear();
    this.instanceToPlanet.clear();
    this.orbitalData.clear();
    this.starLabels = [];
    this.lines = [];
    this.planetLabels.clear();
    this.centralObjects = [];
    this.centralCore = null;
    this.uncommittedRings.clear();
    this.compressionRings.clear();
    this.selectedPlanetIds.clear();
    this.selectionHighlights.clear();
    this.pathTraceLines = [];

    // Compute file size range for LOC-based planet scaling
    const fileSizes = Object.values(data.files).map((f) => f.size);
    const minFileSize = Math.min(...fileSizes, 0);
    const maxFileSize = Math.max(...fileSizes, 1);

    // spacingFactor scales every star/planet distance from origin uniformly.
    // See buildFromNode for why a single multiplier achieves the "repel force"
    // effect without recomputing the hierarchy.
    const spacing = this.settings.spacingFactor || 1;

    const fileCount = Object.keys(data.files).length;
    const segments = this.settings.performanceMode ? 6 : 16;
    const geometry = new THREE.SphereGeometry(2, segments, segments);
    const material = new THREE.MeshStandardMaterial({
      emissiveIntensity: 0.55, // stronger glow so planets are vivid against space
      roughness: 0.35, // slight texture — not perfectly smooth
      metalness: 0.1, // faint metallic sheen
      transparent: true,
    });
    this.planetInstanceMesh = new THREE.InstancedMesh(geometry, material, fileCount);
    this.planetInstanceMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.planetInstanceMesh);

    const rootFolder = data.folders[data.rootFolderId];
    this.addCentralBody(rootFolder);

    let currentInstanceIndex = 0;
    if (data.starTree) {
      data.starTree.childNodes.forEach((node) => {
        currentInstanceIndex = this.buildFromNode(
          node,
          data,
          currentInstanceIndex,
          minFileSize,
          maxFileSize
        );
      });
    }

    if (rootFolder) {
      const rootRadius = 80 * spacing;
      rootFolder.fileIds.forEach((fileId, planetIndex) => {
        const file = data.files[fileId];
        if (!file) {
          return;
        }
        const { position, angle, inclination } = this.orbitalPosition(
          new THREE.Vector3(0, 0, 0),
          planetIndex,
          rootFolder.fileIds.length,
          rootRadius
        );
        const color = FILE_TYPE_COLORS[file.type] || 0x455a64;
        const baseScale = computePlanetScale(file.size, minFileSize, maxFileSize);
        const planetData: PlanetData = {
          file,
          position,
          instanceIndex: currentInstanceIndex,
          scale: baseScale,
          baseScale,
          color,
          visible: true,
        };
        this.planets.set(fileId, planetData);
        this.instanceToPlanet.set(currentInstanceIndex, fileId);
        this.updateInstance(currentInstanceIndex, position, baseScale, color);
        this.orbitalData.set(fileId, {
          starPosition: new THREE.Vector3(0, 0, 0),
          angle,
          inclination,
          speed: 0.0003 + Math.random() * 0.0001,
          radius: rootRadius,
        });
        if (file.size > PLANET_COMPRESS_BYTES) {
          this.addCompressionRing(fileId, position, baseScale);
        }
        currentInstanceIndex++;
      });
    }

    this.planetInstanceMesh.instanceMatrix.needsUpdate = true;
    if (this.planetInstanceMesh.instanceColor) {
      this.planetInstanceMesh.instanceColor.needsUpdate = true;
    }

    this.drawDependencies(data.dependencies);
    this.populateFilterBar(data);
    this.applySettingsToScene();
    this.applyGitVisuals();
    this.updateGitHud();

    // Show onboarding guide on first launch, after cosmos is fully built
    this.showOnboardingIfFirstLaunch();
  }

  private updateInstance(
    index: number,
    position: THREE.Vector3,
    scale: number,
    color: number
  ): void {
    if (!this.planetInstanceMesh) {
      return;
    }
    const matrix = new THREE.Matrix4();
    matrix.makeScale(scale, scale, scale);
    matrix.setPosition(position);
    this.planetInstanceMesh.setMatrixAt(index, matrix);
    this.planetInstanceMesh.setColorAt(index, new THREE.Color(color));
  }

  private buildFromNode(
    node: StarNode,
    data: CosmosData,
    instanceIndex: number,
    minFileSize: number,
    maxFileSize: number
  ): number {
    const folder = data.folders[node.folderId];
    if (!folder || (folder.fileIds.length === 0 && folder.childFolderIds.length === 0)) {
      return instanceIndex;
    }
    // spacingFactor scales the distance from origin uniformly. Since each
    // node's position is recursively built from accumulated parent offsets,
    // scaling the final position vector by a constant S is mathematically
    // equivalent to scaling every radius in the hierarchy by S — giving a
    // uniform "spread out" effect without recomputing the tree.
    const spacing = this.settings.spacingFactor || 1;
    const starPosition = new THREE.Vector3(
      node.position.x * spacing,
      node.position.y * spacing,
      node.position.z * spacing
    );
    const star = new Star(
      folder,
      starPosition,
      node.subtreeFileCount,
      this.settings.performanceMode
    );
    star.mesh.userData = {
      type: 'star',
      id: node.folderId,
      name: folder.name,
      subtreeFileCount: node.subtreeFileCount,
    };
    this.stars.set(node.folderId, star);
    this.scene.add(star.light, star.glowMesh, star.mesh);
    const labelScale = Math.max(40, 120 - node.depth * 15);
    const labelPosition = starPosition.clone();
    labelPosition.y += Math.max(12, 25 - node.depth * 3);
    const label = this.createStarLabel(folder.name, labelPosition, labelScale);
    this.starLabels.push(label);
    this.scene.add(label);
    const orbitalRadius = Math.max(20, 70 - node.depth * 10) * spacing;
    let nextIndex = instanceIndex;
    folder.fileIds.forEach((fileId, planetIndex) => {
      const file = data.files[fileId];
      if (!file) {
        return;
      }
      const { position, angle, inclination } = this.orbitalPosition(
        starPosition,
        planetIndex,
        folder.fileIds.length,
        orbitalRadius
      );
      const color = FILE_TYPE_COLORS[file.type] || 0x455a64;
      const baseScale = computePlanetScale(file.size, minFileSize, maxFileSize);
      const planetData: PlanetData = {
        file,
        position,
        instanceIndex: nextIndex,
        scale: baseScale,
        baseScale,
        color,
        visible: true,
      };
      this.planets.set(fileId, planetData);
      this.instanceToPlanet.set(nextIndex, fileId);
      this.updateInstance(nextIndex, position, baseScale, color);
      this.orbitalData.set(fileId, {
        starPosition: starPosition.clone(),
        angle,
        inclination,
        speed: 0.0002 + Math.random() * 0.0001,
        radius: orbitalRadius,
      });
      if (file.size > PLANET_COMPRESS_BYTES) {
        this.addCompressionRing(fileId, position, baseScale);
      }
      nextIndex++;
    });
    node.childNodes.forEach((childNode) => {
      nextIndex = this.buildFromNode(childNode, data, nextIndex, minFileSize, maxFileSize);
    });
    return nextIndex;
  }

  private orbitalPosition(
    starPosition: THREE.Vector3,
    index: number,
    total: number,
    radius: number
  ): { position: THREE.Vector3; angle: number; inclination: number } {
    const goldenAngle = Math.PI * (1 + Math.sqrt(5));
    const angle = index * goldenAngle;
    const inclination = Math.acos(1 - (2 * (index + 0.5)) / Math.max(total, 1));
    const position = new THREE.Vector3(
      starPosition.x + radius * Math.sin(inclination) * Math.cos(angle),
      starPosition.y + radius * Math.cos(inclination),
      starPosition.z + radius * Math.sin(inclination) * Math.sin(angle)
    );
    return { position, angle, inclination };
  }

  private onResize(canvas: HTMLCanvasElement): void {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    // Guard against zero dimensions during layout transitions
    if (width === 0 || height === 0) {
      return;
    }
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private drawDependencies(dependencies: CosmosDependency[]): void {
    const MAX_LINES = 2000;
    let lineCount = 0;
    const ordered = [...dependencies].sort((a, b) => {
      const priority = (l: DependencyLayer) => {
        switch (l) {
          case DependencyLayer.CIRCULAR:
            return 0;
          case DependencyLayer.DIRECT:
            return 1;
          case DependencyLayer.INDIRECT:
            return 2;
          default:
            return 3;
        }
      };
      return priority(a.layer) - priority(b.layer);
    });

    ordered.forEach((dep) => {
      if (lineCount >= MAX_LINES) {
        return;
      }
      const sourcePlanet = this.planets.get(dep.sourceId);
      const targetPlanet = this.planets.get(dep.targetId);
      if (!sourcePlanet || !targetPlanet) {
        return;
      }
      if (
        this.planets.size > 300 &&
        (dep.layer === DependencyLayer.LAYER3_SHARED_DEPENDENT ||
          dep.layer === DependencyLayer.LAYER3_SHARED_DEPENDENCY)
      ) {
        return;
      }

      // Find the nearest shared star to use as the Bézier control hint.
      // This pulls lines toward their common parent folder, which is the
      // key insight behind Hierarchical Edge Bundling — lines that share
      // a parent naturally route through the same region.
      const sourceFolderId = sourcePlanet.file.folderId;
      const targetFolderId = targetPlanet.file.folderId;
      let controlHint: THREE.Vector3 | undefined;

      if (sourceFolderId === targetFolderId) {
        // Same folder — pull toward the star of that folder
        const star = this.stars.get(sourceFolderId);
        if (star) {
          controlHint = star.mesh.position.clone();
        }
      } else {
        // Different folders — pull toward midpoint of both stars,
        // or toward the central core if either star isn't found
        const sourceStar = this.stars.get(sourceFolderId);
        const targetStar = this.stars.get(targetFolderId);
        if (sourceStar && targetStar) {
          controlHint = new THREE.Vector3()
            .addVectors(sourceStar.mesh.position, targetStar.mesh.position)
            .multiplyScalar(0.5);
        }
        // else: falls back to scene origin (central sun) inside DependencyLine constructor
      }

      const line = new DependencyLine(
        dep,
        sourcePlanet.position,
        targetPlanet.position,
        controlHint
      );
      this.lines.push(line);
      this.scene.add(line.line);
      lineCount++;
    });
  }

  private onClick(event: MouseEvent, canvas: HTMLCanvasElement): void {
    if (this.spacecraftMode) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);

    if (this.planetInstanceMesh) {
      const planetIntersects = this.raycaster.intersectObject(this.planetInstanceMesh);
      if (planetIntersects.length > 0 && planetIntersects[0].instanceId !== undefined) {
        const fileId = this.instanceToPlanet.get(planetIntersects[0].instanceId);
        if (fileId) {
          // Shift-click → multi-select mode
          if (event.shiftKey) {
            this.togglePlanetSelection(fileId);
            return;
          }

          // Ctrl/Cmd-click → show dependencies + open-file popup
          if (event.ctrlKey || event.metaKey) {
            if (this.selectedPlanetIds.size > 0) {
              this.clearSelection();
            }
            if (this.focusedStarId) {
              this.exitStarFocusMode();
            }
            if (this.focusedFileId === fileId) {
              this.exitFocusMode();
              document.getElementById('planet-action-popup')?.remove();
            } else {
              this.enterFocusMode(fileId);
              this.showPlanetActionPopup(fileId, event.clientX, event.clientY);
            }
            return;
          }

          // Alt-click → cinematic zoom to planet (intentional navigation).
          // Plain click no longer zooms — too many accidental camera jumps while
          // just trying to rotate/pan the cosmos. Use Alt to signal intent.
          if (event.altKey) {
            document.getElementById('planet-action-popup')?.remove();
            this.flyToPlanet(fileId);
            return;
          }

          // Plain click → show tooltip/highlight only. No camera movement.
          // The tooltip already appears via onMouseMove hover — clicking is
          // treated as a "select this for context" action, not "go here".
          // Right-click for more options; Alt-click to fly there.
          document.getElementById('planet-action-popup')?.remove();
          return;
        }
      }
    }

    // NOTE: clicking empty space no longer clears selection.
    // Selection is now persistent — only Escape or the Clear button dismisses it.
    // This prevents accidental dismissal when clicking to pan/rotate the cosmos.

    const starMeshes = Array.from(this.stars.values()).map((s) => s.mesh);
    const starIntersects = this.raycaster.intersectObjects(starMeshes);
    if (starIntersects.length > 0) {
      const folderId = starIntersects[0].object.userData.id as string;
      if (this.focusedFileId) {
        this.exitFocusMode();
      }
      // Alt+click star → fly to it AND enter star focus mode
      // Plain click star → enter/exit star focus mode only (no camera jump)
      if (event.altKey) {
        if (this.focusedStarId === folderId) {
          this.exitStarFocusMode();
        } else {
          this.enterStarFocusMode(folderId);
        }
      } else {
        // Plain click — toggle focus mode without flying
        if (this.focusedStarId === folderId) {
          this.exitStarFocusMode();
        } else {
          this.focusedStarId = folderId;
          const exitBtn = document.getElementById('exit-focus-btn');
          if (exitBtn) exitBtn.style.display = 'flex';
          // Apply dimming but don't fly
          const folder = this.data?.folders[folderId];
          if (folder) {
            const folderFileIds = new Set(folder.fileIds);
            this.planets.forEach((planet, fileId) => {
              const isConnected = folderFileIds.has(fileId);
              const color = new THREE.Color(planet.color);
              if (!isConnected) color.multiplyScalar(0.08);
              this.planetInstanceMesh!.setColorAt(planet.instanceIndex, color);
            });
            this.planetInstanceMesh!.instanceColor!.needsUpdate = true;
          }
        }
      }
      return;
    }

    const visibleLines = this.lines.filter((l) => l.line.visible).map((l) => l.line);
    const lineIntersects = this.raycaster.intersectObjects(visibleLines);
    if (lineIntersects.length > 0) {
      const hitLine = lineIntersects[0].object;
      const depLine = this.lines.find((l) => l.line === hitLine);
      if (depLine && depLine.dependency.line !== undefined) {
        sendToExtension({
          type: 'OPEN_FILE',
          payload: {
            fileId: depLine.dependency.sourceId,
            line: depLine.dependency.line,
            character: depLine.dependency.character,
          },
        });
        return;
      }
    }
  }

  private onContextMenu(event: MouseEvent, canvas: HTMLCanvasElement): void {
    event.preventDefault();
    if (this.spacecraftMode) {
      return;
    }

    // Raycast to find what was right-clicked
    const rect = canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);

    let fileId: string | null = null;

    if (this.planetInstanceMesh) {
      const hits = this.raycaster.intersectObject(this.planetInstanceMesh);
      if (hits.length > 0 && hits[0].instanceId !== undefined) {
        fileId = this.instanceToPlanet.get(hits[0].instanceId) ?? null;
      }
    }

    // Remove any existing context menu
    document.getElementById('cosmos-context-menu')?.remove();

    if (!fileId || !this.data) {
      return;
    }

    const file = this.data.files[fileId];
    if (!file) {
      return;
    }

    // Dependency counts for the passive stat line
    const depsOut = this.dependencies.filter(
      (d) => d.sourceId === fileId && d.layer === DependencyLayer.DIRECT
    ).length;
    const depsIn = this.dependencies.filter(
      (d) => d.targetId === fileId && d.layer === DependencyLayer.DIRECT
    ).length;
    const isCircular = this.dependencies.some(
      (d) =>
        d.layer === DependencyLayer.CIRCULAR && (d.sourceId === fileId || d.targetId === fileId)
    );

    // Build menu
    const menu = document.createElement('div');
    menu.id = 'cosmos-context-menu';
    menu.style.cssText = `
      position: fixed;
      left: ${event.clientX}px;
      top: ${event.clientY}px;
      background: rgba(12, 14, 22, 0.96);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 10px;
      padding: 6px 0;
      min-width: 220px;
      z-index: 9999;
      box-shadow: 0 8px 32px rgba(0,0,0,0.6);
      backdrop-filter: blur(16px);
      font-size: 12px;
      color: rgba(255,255,255,0.9);
      user-select: none;
    `;

    // Header — file name + passive stat
    const header = document.createElement('div');
    header.style.cssText = `
      padding: 8px 14px 10px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      margin-bottom: 4px;
    `;
    header.innerHTML = `
      <div style="font-weight:700; font-size:13px; margin-bottom:3px; color:var(--accent-blue, #64b5f6);">
        ${this.escapeHtml(file.name)}
      </div>
      <div style="opacity:0.45; font-size:10px; letter-spacing:0.3px; margin-bottom:6px;">
        ${this.escapeHtml(file.relativePath)}
      </div>
      <div style="font-size:10px; opacity:0.6;">
        ↑ ${depsOut} imports &nbsp;·&nbsp; ↓ ${depsIn} imported by
        ${isCircular ? ' &nbsp;<span style="color:#ff1744;">⚠ circular</span>' : ''}
      </div>
    `;
    menu.appendChild(header);

    // Menu items
    const items: { label: string; icon: string; action: () => void; danger?: boolean }[] = [
      {
        icon: '📄',
        label: 'Open File',
        action: () => sendToExtension({ type: 'OPEN_FILE', payload: { fileId: fileId! } }),
      },
      {
        icon: '📋',
        label: 'Copy Path',
        action: () => {
          navigator.clipboard?.writeText(file.relativePath).catch(() => { });
        },
      },
      {
        icon: '🔍',
        label: 'Show Dependencies',
        action: () => {
          this.exitStarFocusMode();
          this.enterFocusMode(fileId!);
        },
      },
      {
        icon: '🎯',
        label: 'Fly To',
        action: () => this.flyToPlanet(fileId!),
      },
      {
        icon: this.selectedPlanetIds.has(fileId!) ? '✖' : '＋',
        label: this.selectedPlanetIds.has(fileId!) ? 'Remove from Selection' : 'Add to Selection',
        action: () => this.togglePlanetSelection(fileId!),
      },
    ];

    items.forEach(({ icon, label, action, danger }) => {
      const item = document.createElement('div');
      item.style.cssText = `
        padding: 8px 14px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 10px;
        transition: background 0.1s ease;
        color: ${danger ? '#ff5252' : 'rgba(255,255,255,0.88)'};
        border-radius: 4px;
        margin: 0 4px;
      `;
      item.innerHTML = `<span style="font-size:13px; width:16px; text-align:center;">${icon}</span><span>${label}</span>`;
      item.addEventListener('mouseenter', () => {
        item.style.background = 'rgba(255,255,255,0.07)';
      });
      item.addEventListener('mouseleave', () => {
        item.style.background = 'transparent';
      });
      item.addEventListener('click', () => {
        action();
        menu.remove();
      });
      menu.appendChild(item);
    });

    document.body.appendChild(menu);

    // Auto-adjust if menu clips screen edge
    const menuRect = menu.getBoundingClientRect();
    if (menuRect.right > window.innerWidth) {
      menu.style.left = `${event.clientX - menuRect.width}px`;
    }
    if (menuRect.bottom > window.innerHeight) {
      menu.style.top = `${event.clientY - menuRect.height}px`;
    }

    // Dismiss on any outside click
    const dismiss = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) {
        menu.remove();
        document.removeEventListener('click', dismiss);
      }
    };
    setTimeout(() => document.addEventListener('click', dismiss), 0);
  }

  private onMouseMove(event: MouseEvent, canvas: HTMLCanvasElement): void {
    const now = Date.now();
    const rect = canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const tooltip = document.getElementById('tooltip')!;

    const intersectable: THREE.Object3D[] = [...Array.from(this.stars.values()).map((s) => s.mesh)];
    if (this.planetInstanceMesh) {
      intersectable.push(this.planetInstanceMesh);
    }
    if (this.centralCore) {
      intersectable.push(this.centralCore);
    }

    const intersects = this.raycaster.intersectObjects(intersectable);
    if (intersects.length > 0) {
      const hovered = intersects[0];
      const object = hovered.object;

      if (object.userData.type === 'central') {
        const rootName = this.escapeHtml(String(object.userData.name));
        tooltip.style.display = 'block';
        tooltip.style.left = `${event.clientX + 15}px`;
        tooltip.style.top = `${event.clientY + 15}px`;
        tooltip.innerHTML = `<div style="font-weight:700; font-size:14px; margin-bottom:4px; color:var(--accent-gold);">⭐ ${rootName}</div><div style="opacity:0.6; font-size:10px; text-transform:uppercase; letter-spacing:1px; margin-bottom:8px;">Root Repository</div><div style="display:grid; grid-template-columns: 1fr auto; gap: 8px; font-size:11px;"><span style="opacity:0.7;">Files</span><span style="font-weight:600;">${Object.keys(this.data!.files).length}</span><span style="opacity:0.7;">Folders</span><span style="font-weight:600;">${Object.keys(this.data!.folders).length}</span></div>`;
        return;
      }

      if (object.userData.type === 'star') {
        const folderId = object.userData.id as string;
        const folder = this.data!.folders[folderId];
        if (!folder) {
          return;
        }
        const folderFileIds = new Set(folder.fileIds);
        const outgoing = this.dependencies.filter(
          (d) => folderFileIds.has(d.sourceId) && d.layer === DependencyLayer.DIRECT
        ).length;
        const incoming = this.dependencies.filter(
          (d) => folderFileIds.has(d.targetId) && d.layer === DependencyLayer.DIRECT
        ).length;
        const hasCircular = this.dependencies.some(
          (d) =>
            d.layer === DependencyLayer.CIRCULAR &&
            (folderFileIds.has(d.sourceId) || folderFileIds.has(d.targetId))
        );
        tooltip.style.display = 'block';
        tooltip.style.left = `${event.clientX + 15}px`;
        tooltip.style.top = `${event.clientY + 15}px`;
        tooltip.innerHTML = `<div style="font-weight:700; font-size:14px; margin-bottom:4px; color:var(--accent-blue);">📁 ${this.escapeHtml(folder.name)}</div><div style="opacity:0.6; font-size:10px; text-transform:uppercase; letter-spacing:1px; margin-bottom:8px;">Directory</div><div style="display:grid; grid-template-columns: 1fr auto; gap: 4px 12px; font-size:11px;"><span style="opacity:0.7;">Files</span><span style="font-weight:600;">${folder.fileIds.length}</span><span style="opacity:0.7;">Subfolders</span><span style="font-weight:600;">${folder.childFolderIds.length}</span><span style="opacity:0.7;">Out / In</span><span style="font-weight:600;">${outgoing} / ${incoming}</span></div>${hasCircular ? '<div style="margin-top:8px; color:#FF1744; font-size:10px; font-weight:600; display:flex; align-items:center; gap:4px;">⚠️ Circular dependencies inside</div>' : ''}`;
        return;
      }

      if (object === this.planetInstanceMesh && hovered.instanceId !== undefined) {
        const hoveredFileId = this.instanceToPlanet.get(hovered.instanceId);
        const file = hoveredFileId ? this.data?.files[hoveredFileId] : null;
        if (!file) {
          return;
        }
        const dependsOn = this.dependencies.filter(
          (d) => d.sourceId === hoveredFileId && d.layer === DependencyLayer.DIRECT
        ).length;
        const dependedBy = this.dependencies.filter(
          (d) => d.targetId === hoveredFileId && d.layer === DependencyLayer.DIRECT
        ).length;
        const indirectCount = this.dependencies.filter(
          (d) =>
            (d.sourceId === hoveredFileId || d.targetId === hoveredFileId) &&
            d.layer === DependencyLayer.INDIRECT
        ).length;
        const isCircular = this.dependencies.some(
          (d) =>
            d.layer === DependencyLayer.CIRCULAR &&
            (d.sourceId === hoveredFileId || d.targetId === hoveredFileId)
        );
        let gitHtml = '';
        if (this.gitData?.available) {
          const cleanId = hoveredFileId!.includes(':')
            ? hoveredFileId!.split(':').slice(1).join(':')
            : hoveredFileId!;
          const info = this.gitData.fileInfo[cleanId];
          if (info) {
            const recency =
              info.daysSinceLastChange === 999
                ? 'Never'
                : info.daysSinceLastChange === 0
                  ? 'Today'
                  : `${info.daysSinceLastChange}d ago`;
            gitHtml = `<div style="margin-top:10px; padding-top:10px; border-top:1px solid rgba(255,255,255,0.1); display:grid; grid-template-columns: 1fr auto; gap: 4px 12px; font-size:11px;"><span style="opacity:0.6;">Commits</span><span style="font-weight:600; color:var(--accent-gold);">${info.commitCount}</span><span style="opacity:0.6;">Last Change</span><span style="font-weight:600;">${recency}</span>${info.hasUncommittedChanges ? '<span colspan="2" style="color:#FF8C00; font-size:10px; font-weight:600; margin-top:4px;">● Uncommitted changes</span>' : ''}</div>`;
          }
        }
        tooltip.style.display = 'block';
        tooltip.style.left = `${event.clientX + 15}px`;
        tooltip.style.top = `${event.clientY + 15}px`;
        tooltip.innerHTML = `<div style="font-weight:700; font-size:14px; margin-bottom:4px;">${this.escapeHtml(file.name)}</div><div style="opacity:0.6; font-size:10px; text-transform:uppercase; letter-spacing:1px; margin-bottom:8px;">${this.escapeHtml(file.extension.toUpperCase())} File</div><div style="display:grid; grid-template-columns: 1fr auto; gap: 4px 12px; font-size:11px;"><span style="opacity:0.7;">Direct Deps</span><span style="font-weight:600;">${dependsOn} out / ${dependedBy} in</span><span style="opacity:0.7;">Indirect Chains</span><span style="font-weight:600;">${indirectCount}</span>${isCircular ? '<span colspan="2" style="color:#FF1744; font-size:10px; font-weight:600; margin-top:4px;">⚠️ Part of circular chain</span>' : ''}</div>${gitHtml}`;
        return;
      }
    }

    if (now - this.lastMouseMoveTime < 50) {
      tooltip.style.display = 'none';
      return;
    }
    this.lastMouseMoveTime = now;
    const lineMeshes = this.lines.filter((l) => l.line.visible).map((l) => l.line);
    const lineIntersects = this.raycaster.intersectObjects(lineMeshes);
    if (lineIntersects.length > 0) {
      const hitLine = lineIntersects[0].object;
      const depLine = this.lines.find((l) => l.line === hitLine);
      if (!depLine) {
        tooltip.style.display = 'none';
        return;
      }
      const sourceFile = this.data?.files[depLine.dependency.sourceId];
      const targetFile = this.data?.files[depLine.dependency.targetId];
      if (!sourceFile || !targetFile) {
        tooltip.style.display = 'none';
        return;
      }
      const layerInfo = this.getLayerInfo(depLine.dependency.layer);
      tooltip.style.display = 'block';
      tooltip.style.left = `${event.clientX + 15}px`;
      tooltip.style.top = `${event.clientY + 15}px`;
      tooltip.innerHTML = `<span style="color:${layerInfo.color}">⬤ ${this.escapeHtml(layerInfo.label)}</span><br><strong>From:</strong> ${this.escapeHtml(sourceFile.name)}<br><span style="opacity:0.5;font-size:10px">${this.escapeHtml(sourceFile.relativePath)}</span><br><strong>To:</strong> ${this.escapeHtml(targetFile.name)}<br><span style="opacity:0.5;font-size:10px">${this.escapeHtml(targetFile.relativePath)}</span>`;
    } else {
      tooltip.style.display = 'none';
    }
  }

  private getLayerInfo(layer: DependencyLayer): { label: string; color: string } {
    switch (layer) {
      case DependencyLayer.DIRECT:
        return { label: 'Direct import', color: '#ffffff' };
      case DependencyLayer.INDIRECT:
        return { label: 'Indirect chain', color: '#4488ff' };
      case DependencyLayer.CIRCULAR:
        return { label: 'Circular dependency', color: '#FF1744' };
      case DependencyLayer.LAYER3_SHARED_DEPENDENT:
        return { label: 'Shared dependent', color: '#FFB300' };
      case DependencyLayer.LAYER3_SHARED_DEPENDENCY:
        return { label: 'Shared dependency', color: '#00BCD4' };
      default:
        return { label: 'Unknown', color: '#ffffff' };
    }
  }

  private enterFocusMode(fileId: string): void {
    this.focusedFileId = fileId;
    // Show exit focus button
    const exitBtn = document.getElementById('exit-focus-btn');
    if (exitBtn) {
      exitBtn.style.display = 'flex';
    }
    const connectedIds = new Set<string>([fileId]);
    this.dependencies.forEach((dep) => {
      if (dep.sourceId === fileId) {
        connectedIds.add(dep.targetId);
      }
      if (dep.targetId === fileId) {
        connectedIds.add(dep.sourceId);
      }
    });

    this.planets.forEach((planet, id) => {
      const isConnected = connectedIds.has(id);
      const color = new THREE.Color(planet.color);
      if (!isConnected) {
        color.multiplyScalar(0.1);
      }
      this.planetInstanceMesh!.setColorAt(planet.instanceIndex, color);
    });
    this.planetInstanceMesh!.instanceColor!.needsUpdate = true;

    this.stars.forEach((star) => {
      (star.mesh.material as THREE.MeshStandardMaterial).opacity = 0.05;
      (star.mesh.material as THREE.MeshStandardMaterial).transparent = true;
    });
    this.starLabels.forEach((label) => {
      (label.material as THREE.SpriteMaterial).opacity = 0.05;
    });
    this.lines.forEach((depLine) => {
      const isConnected =
        depLine.dependency.sourceId === fileId || depLine.dependency.targetId === fileId;
      depLine.line.visible = isConnected;
      if (isConnected) {
        (depLine.line.material as THREE.LineBasicMaterial).opacity = 0.9;
      }
    });
  }

  private exitFocusMode(): void {
    this.focusedFileId = null;
    const exitBtn = document.getElementById('exit-focus-btn');
    if (exitBtn) {
      exitBtn.style.display = 'none';
    }
    this.planets.forEach((planet) => {
      this.planetInstanceMesh!.setColorAt(planet.instanceIndex, new THREE.Color(planet.color));
    });
    this.planetInstanceMesh!.instanceColor!.needsUpdate = true;
    this.stars.forEach((star) => {
      (star.mesh.material as THREE.MeshStandardMaterial).opacity = 1;
      (star.mesh.material as THREE.MeshStandardMaterial).transparent = false;
    });
    this.starLabels.forEach((label) => {
      (label.material as THREE.SpriteMaterial).opacity = 1;
    });
    this.lines.forEach((depLine) => {
      (depLine.line.material as THREE.LineBasicMaterial).opacity = depLine.baseOpacity;
    });
    this.applySettingsToScene();
    this.applyGitVisuals();

    document.getElementById('planet-action-popup')?.remove();
  }

  // ---------------------------------------------------------------------------
  // Feature: Planet action popup
  //
  // Shown on Ctrl/Cmd-click instead of immediately opening the file.
  // Gives the developer a deliberate choice: open the file, or just keep
  // exploring the dependency web that focus mode just revealed.
  //
  // Positioned near the click point, dismissed by: Open File click, Dismiss
  // click, Escape (handled in the unified Escape handler), or exiting focus
  // mode (Ctrl-clicking the same planet again).
  // ---------------------------------------------------------------------------

  private showPlanetActionPopup(fileId: string, clientX: number, clientY: number): void {
    document.getElementById('planet-action-popup')?.remove();

    const file = this.data?.files[fileId];
    if (!file) {
      return;
    }

    const depsOut = this.dependencies.filter(
      (d) => d.sourceId === fileId && d.layer === DependencyLayer.DIRECT
    ).length;
    const depsIn = this.dependencies.filter(
      (d) => d.targetId === fileId && d.layer === DependencyLayer.DIRECT
    ).length;

    const popup = document.createElement('div');
    popup.id = 'planet-action-popup';
    popup.style.cssText = `
      position: fixed;
      left: ${clientX}px;
      top: ${clientY}px;
      transform: translate(-50%, 12px);
      background: rgba(12, 14, 22, 0.97);
      border: 1px solid rgba(255,255,255,0.14);
      border-radius: 12px;
      padding: 12px 14px;
      min-width: 200px;
      z-index: 9999;
      box-shadow: 0 8px 32px rgba(0,0,0,0.6);
      backdrop-filter: blur(16px);
      font-size: 12px;
      color: rgba(255,255,255,0.9);
    `;

    popup.innerHTML = `
      <div style="font-weight:700; font-size:13px; margin-bottom:2px; color:var(--accent-blue);">
        ${this.escapeHtml(file.name)}
      </div>
      <div style="opacity:0.45; font-size:10px; margin-bottom:8px; word-break:break-all;">
        ${this.escapeHtml(file.relativePath)}
      </div>
      <div style="font-size:10px; opacity:0.6; margin-bottom:10px;">
        ↑ ${depsOut} imports &nbsp;·&nbsp; ↓ ${depsIn} imported by — highlighted above
      </div>
      <div style="display:flex; gap:6px;">
        <button id="popup-open-file" style="
          flex:1; background: var(--accent-blue); border:none;
          border-radius:8px; padding:7px; cursor:pointer;
          font-size:11px; font-weight:700; color:#000;
        ">Open File</button>
        <button id="popup-dismiss" style="
          flex:1; background: rgba(255,255,255,0.08);
          border:1px solid rgba(255,255,255,0.15);
          border-radius:8px; padding:7px; cursor:pointer;
          font-size:11px; color:rgba(255,255,255,0.7);
        ">Keep Exploring</button>
      </div>
    `;

    document.body.appendChild(popup);

    // Keep popup on-screen if it would clip the right or bottom edge
    const rect = popup.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      popup.style.left = `${window.innerWidth - rect.width - 8}px`;
      popup.style.transform = 'translate(0, 12px)';
    }
    if (rect.bottom > window.innerHeight) {
      popup.style.top = `${clientY - rect.height - 12}px`;
    }

    document.getElementById('popup-open-file')?.addEventListener('click', () => {
      sendToExtension({ type: 'OPEN_FILE', payload: { fileId } });
      popup.remove();
    });

    document.getElementById('popup-dismiss')?.addEventListener('click', () => {
      popup.remove();
    });

    // Dismiss on any click outside the popup (but not the click that opened it)
    const dismiss = (e: MouseEvent) => {
      if (!popup.contains(e.target as Node)) {
        popup.remove();
        document.removeEventListener('click', dismiss);
      }
    };
    setTimeout(() => document.addEventListener('click', dismiss), 0);
  }

  private initSearch(): void {
    const container = document.getElementById('search-container')!;
    const input = document.getElementById('search-input') as HTMLInputElement;
    const results = document.getElementById('search-results')!;
    window.addEventListener('keydown', (e) => {
      const isTyping = this.isTextInputTarget(e.target);
      if (isTyping && e.key !== 'Escape') {
        return;
      }
      if ((e.ctrlKey && e.key === 'f') || e.key === '/') {
        e.preventDefault();
        container.style.display = container.style.display === 'block' ? 'none' : 'block';
        if (container.style.display === 'block') {
          input.focus();
        }
      }
      if ((e.key === 'p' || e.key === 'P') && !e.ctrlKey && !isTyping) {
        this.exportImage();
      }
      if (e.key === 'Escape') {
        // Unified Escape handler — closes panels in priority order.
        // Each check returns after closing so only one thing closes per press.
        // Priority: inline dialogs > overlays > search > panels > focus mode > selection

        // 1. Bookmark name dialog (inline input)
        const bookmarkDialog = document.getElementById('bookmark-name-dialog');
        if (bookmarkDialog) {
          bookmarkDialog.remove();
          return;
        }

        // 2. Onboarding overlay
        const onboarding = document.getElementById('onboarding-overlay');
        if (onboarding && onboarding.style.display === 'flex') {
          onboarding.style.opacity = '0';
          onboarding.style.transition = 'opacity 0.4s ease';
          setTimeout(() => {
            onboarding.style.display = 'none';
            onboarding.style.opacity = '';
            onboarding.style.transition = '';
          }, 400);
          try {
            localStorage.setItem(Universe.ONBOARDING_KEY, '1');
            this.onboardingSeen = true;
          } catch {
            /* ignore */
          }
          return;
        }

        // 3. Context menu
        const contextMenu = document.getElementById('cosmos-context-menu');
        if (contextMenu) {
          contextMenu.remove();
          return;
        }

        // 3b. Planet action popup (Ctrl-click popup)
        const actionPopup = document.getElementById('planet-action-popup');
        if (actionPopup) {
          actionPopup.remove();
          return;
        }

        // 4. Search bar
        const searchContainer = document.getElementById('search-container');
        if (searchContainer && searchContainer.style.display === 'block') {
          searchContainer.style.display = 'none';
          return;
        }

        // 5. Settings panel
        const settingsPanel = document.getElementById('settings-panel');
        if (settingsPanel && settingsPanel.style.display === 'block') {
          settingsPanel.style.display = 'none';
          const settingsBtn = document.getElementById('settings-btn');
          settingsBtn?.classList.remove('active');
          return;
        }

        // 6. Shortcuts panel
        const shortcutsPanel = document.getElementById('shortcuts-panel');
        if (shortcutsPanel && shortcutsPanel.style.display === 'block') {
          shortcutsPanel.style.display = 'none';
          return;
        }

        // 7. Focus mode
        if (this.focusedFileId || this.focusedStarId) {
          this.exitFocusMode();
          this.exitStarFocusMode();
          return;
        }

        // 8. Selection
        if (this.selectedPlanetIds.size > 0) {
          this.clearSelection();
          return;
        }
      }
      if ((e.key === 'r' || e.key === 'R') && !isTyping) {
        this.resetCamera();
      }
      // H key → shortcuts panel (? is reserved for onboarding overlay)
      if ((e.key === 'h' || e.key === 'H') && !isTyping && !e.ctrlKey) {
        const panel = document.getElementById('shortcuts-panel')!;
        const btn = document.getElementById('help-button');
        const isOpen = panel.style.display === 'block';
        panel.style.display = isOpen ? 'none' : 'block';
        btn?.classList.toggle('active', !isOpen);
      }
      if ((e.key === 'g' || e.key === 'G') && !isTyping && !e.ctrlKey) {
        // G = Gear = Settings. S was conflicting with spacecraft backward movement.
        const sp = document.getElementById('settings-panel')!;
        const btn = document.getElementById('settings-btn');
        const isOpen = sp.style.display === 'block';
        sp.style.display = isOpen ? 'none' : 'block';
        btn?.classList.toggle('active', !isOpen);
      }
      if ((e.ctrlKey && (e.key === 'u' || e.key === 'U')) || e.key === 'F5') {
        e.preventDefault();
        sendToExtension({ type: 'REFRESH' });
      }
    });
    let selectedResultIndex = -1;

    function highlightResult(idx: number): void {
      const items = results.querySelectorAll('.search-result') as NodeListOf<HTMLElement>;
      items.forEach((el, i) => {
        el.style.background = i === idx ? 'rgba(255,255,255,0.12)' : 'transparent';
      });
    }

    input.addEventListener('input', () => {
      selectedResultIndex = -1;
      const query = input.value.trim().toLowerCase();
      if (!query || !this.data) {
        results.style.display = 'none';
        return;
      }
      const matches = Object.values(this.data.files)
        .filter((f) => f.name.toLowerCase().includes(query))
        .slice(0, 8);
      if (matches.length === 0) {
        results.style.display = 'none';
        return;
      }
      results.style.display = 'block';
      results.innerHTML = matches
        .map(
          (f) =>
            `<div class="search-result" data-id="${this.escapeHtml(f.id)}" style="padding: 10px 16px; color: white; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.05);"><div style="font-weight:600; color:var(--accent-blue);">${this.escapeHtml(f.name)}</div><div style="font-size:10px; opacity:0.4;">${this.escapeHtml(this.getDirectoryLabel(f.relativePath, f.name))}</div></div>`
        )
        .join('');
      results.querySelectorAll('.search-result').forEach((el) => {
        el.addEventListener('click', () => {
          this.flyToPlanet((el as HTMLElement).dataset.id!);
          container.style.display = 'none';
          results.style.display = 'none';
          selectedResultIndex = -1;
        });
        el.addEventListener('mouseenter', () => {
          (el as HTMLElement).style.background = 'rgba(255,255,255,0.08)';
        });
        el.addEventListener('mouseleave', () => {
          (el as HTMLElement).style.background = 'transparent';
        });
      });
    });

    // Arrow key navigation through search results
    input.addEventListener('keydown', (e) => {
      const items = results.querySelectorAll('.search-result') as NodeListOf<HTMLElement>;
      if (!items.length) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedResultIndex = Math.min(selectedResultIndex + 1, items.length - 1);
        highlightResult(selectedResultIndex);
        items[selectedResultIndex]?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedResultIndex = Math.max(selectedResultIndex - 1, 0);
        highlightResult(selectedResultIndex);
        items[selectedResultIndex]?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const target = selectedResultIndex >= 0 ? items[selectedResultIndex] : items[0];
        if (target) {
          this.flyToPlanet(target.dataset.id!);
          container.style.display = 'none';
          results.style.display = 'none';
          selectedResultIndex = -1;
        }
      }
    });
  }
  public focusOnFile(fileId: string): void {
    // Track which file is active in the editor — the beacon chip will
    // appear if this planet is off-screen, letting the developer choose
    // to fly there. We deliberately do NOT auto-fly the camera here:
    // constantly opening files (clicking through imports, tabbing between
    // files) used to yank the camera around the cosmos on every switch,
    // which was disorienting when the developer just wanted to navigate
    // their own way. The beacon chip is the non-intrusive alternative.
    this.beaconFileId = fileId;
    this.setBeaconVisible(false); // reset — updateBeaconChip re-evaluates next frame
  }

  public flyToPlanet(fileId: string): void {
    const planet = this.planets.get(fileId);
    if (!planet) {
      return;
    }
    const target = planet.position.clone();
    const startPosition = this.camera.position.clone();
    const startTarget = this.controls.target.clone();
    const endPosition = target.clone().add(new THREE.Vector3(0, 0, 100));
    let progress = 0;
    const duration = 60;
    const fly = () => {
      if (progress >= duration) {
        this.controls.target.copy(target);
        this.controls.update();
        this.enterFocusMode(fileId);
        return;
      }
      progress++;
      const t = progress / duration;
      const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      this.camera.position.lerpVectors(startPosition, endPosition, eased);
      this.controls.target.lerpVectors(startTarget, target, eased);
      this.controls.update();
      requestAnimationFrame(fly);
    };
    fly();
  }

  private flyToStar(folderId: string): void {
    const star = this.stars.get(folderId);
    if (!star) {
      return;
    }
    const target = star.mesh.position.clone();
    const startPosition = this.camera.position.clone();
    const startTarget = this.controls.target.clone();
    const endPosition = target.clone().add(new THREE.Vector3(0, 0, 250));
    let progress = 0;
    const duration = 60;
    const fly = () => {
      if (progress >= duration) {
        this.controls.target.copy(target);
        this.controls.update();
        return;
      }
      progress++;
      const t = progress / duration;
      const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      this.camera.position.lerpVectors(startPosition, endPosition, eased);
      this.controls.target.lerpVectors(startTarget, target, eased);
      this.controls.update();
      requestAnimationFrame(fly);
    };
    fly();
  }

  private initResetButton(): void {
    document.getElementById('reset-camera')!.addEventListener('click', () => this.resetCamera());
  }

  public resetCamera(): void {
    const startPosition = this.camera.position.clone();
    const startTarget = this.controls.target.clone();
    const endPosition = this.defaultCameraPosition.clone();
    const endTarget = new THREE.Vector3(0, 0, 0);
    let progress = 0;
    const duration = 60;
    const reset = () => {
      if (progress >= duration) {
        this.controls.target.copy(endTarget);
        this.controls.update();
        this.exitFocusMode();
        return;
      }
      progress++;
      const t = progress / duration;
      const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      this.camera.position.lerpVectors(startPosition, endPosition, eased);
      this.controls.target.lerpVectors(startTarget, endTarget, eased);
      this.controls.update();
      requestAnimationFrame(reset);
    };
    reset();
  }

  private addBackgroundStars(): void {
    if (this.backgroundStars) {
      this.scene.remove(this.backgroundStars);
      this.backgroundStars = null;
    }
    const count = this.settings.performanceMode ? 400 : 3000;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);

    // Star color palette — mostly white with hints of blue, yellow, red
    const starColors = [
      [1.0, 1.0, 1.0], // white — most common
      [1.0, 1.0, 1.0],
      [1.0, 1.0, 1.0],
      [0.8, 0.9, 1.0], // blue-white
      [1.0, 0.95, 0.8], // yellow-white
      [1.0, 0.85, 0.7], // orange-white
      [0.9, 0.95, 1.0], // pale blue
    ];

    for (let i = 0; i < count; i++) {
      // Distribute across a large sphere shell — not a cube
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 3000 + Math.random() * 7000;
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);

      // Random star color
      const col = starColors[Math.floor(Math.random() * starColors.length)];
      colors[i * 3] = col[0];
      colors[i * 3 + 1] = col[1];
      colors[i * 3 + 2] = col[2];

      // Varied sizes — most tiny, a few larger
      sizes[i] = Math.random() < 0.95 ? 0.5 + Math.random() * 1.0 : 1.5 + Math.random() * 2.0;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.PointsMaterial({
      vertexColors: true,
      size: 1.2,
      transparent: true,
      opacity: 0.85,
      sizeAttenuation: true,
    });

    this.backgroundStars = new THREE.Points(geometry, material);
    this.scene.add(this.backgroundStars);
  }

  private addCentralBody(rootFolder: CosmosFolder | undefined): void {
    if (!rootFolder) {
      return;
    }

    // Core — bright hot center
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(40, 64, 64),
      new THREE.MeshStandardMaterial({
        color: 0xfffde7,
        emissive: 0xffdd00,
        emissiveIntensity: 1.2,
        transparent: false,
      })
    );
    core.userData = { type: 'central', name: rootFolder.name };
    this.centralCore = core;
    this.centralObjects.push(core);
    this.scene.add(core);

    // Inner corona — warm orange
    const corona1 = new THREE.Mesh(
      new THREE.SphereGeometry(52, 32, 32),
      new THREE.MeshStandardMaterial({
        color: 0xff9900,
        emissive: 0xff7700,
        emissiveIntensity: 0.6,
        transparent: true,
        opacity: 0.18,
        side: THREE.BackSide,
      })
    );
    this.centralObjects.push(corona1);
    this.scene.add(corona1);

    // Mid corona — red-orange
    const corona2 = new THREE.Mesh(
      new THREE.SphereGeometry(68, 32, 32),
      new THREE.MeshStandardMaterial({
        color: 0xff4400,
        emissive: 0xff2200,
        emissiveIntensity: 0.3,
        transparent: true,
        opacity: 0.09,
        side: THREE.BackSide,
      })
    );
    this.centralObjects.push(corona2);
    this.scene.add(corona2);

    // Outer halo — very faint deep red
    const corona3 = new THREE.Mesh(
      new THREE.SphereGeometry(95, 32, 32),
      new THREE.MeshStandardMaterial({
        color: 0xff1100,
        emissive: 0xff0000,
        emissiveIntensity: 0.15,
        transparent: true,
        opacity: 0.04,
        side: THREE.BackSide,
      })
    );
    this.centralObjects.push(corona3);
    this.scene.add(corona3);

    // Strong central light
    const centralLight = new THREE.PointLight(0xffcc55, 3.0, 6000);
    centralLight.position.set(0, 0, 0);
    this.centralObjects.push(centralLight);
    this.scene.add(centralLight);

    // Secondary warm rim light
    const rimLight = new THREE.PointLight(0xff8800, 1.5, 3000);
    rimLight.position.set(0, 0, 0);
    this.centralObjects.push(rimLight);
    this.scene.add(rimLight);

    const label = this.createStarLabel(`⭐ ${rootFolder.name}`, new THREE.Vector3(0, 70, 0), 150);
    this.starLabels.push(label);
    this.scene.add(label);
  }

  private createStarLabel(
    name: string,
    position: THREE.Vector3,
    scaleWidth: number = 120
  ): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 80;
    const ctx = canvas.getContext('2d')!;

    // Measure text first for pill sizing
    ctx.font = 'bold 28px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const textWidth = ctx.measureText(name).width;
    const padX = 24;
    const padY = 10;
    const pillW = Math.min(textWidth + padX * 2, canvas.width - 10);
    const pillH = 44;
    const pillX = (canvas.width - pillW) / 2;
    const pillY = (canvas.height - pillH) / 2;
    const radius = pillH / 2;

    // Draw pill background
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    ctx.moveTo(pillX + radius, pillY);
    ctx.lineTo(pillX + pillW - radius, pillY);
    ctx.arcTo(pillX + pillW, pillY, pillX + pillW, pillY + pillH, radius);
    ctx.lineTo(pillX + pillW, pillY + pillH - radius);
    ctx.arcTo(pillX + pillW, pillY + pillH, pillX + pillW - radius, pillY + pillH, radius);
    ctx.lineTo(pillX + radius, pillY + pillH);
    ctx.arcTo(pillX, pillY + pillH, pillX, pillY + pillH - radius, radius);
    ctx.lineTo(pillX, pillY + radius);
    ctx.arcTo(pillX, pillY, pillX + radius, pillY, radius);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Text
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 4;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, canvas.width / 2, canvas.height / 2, canvas.width - 20);

    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(canvas),
        transparent: true,
        depthWrite: false,
        depthTest: false,
      })
    );
    sprite.position.copy(position);
    // Scale proportionally to canvas aspect
    sprite.scale.set(scaleWidth, scaleWidth * (canvas.height / canvas.width), 1);
    sprite.userData = { type: 'label' };
    return sprite;
  }

  private initSpacecraftMode(): void {
    const MOVEMENT_KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e', 'shift']);

    window.addEventListener('keydown', (e) => {
      if (this.isTextInputTarget(e.target)) {
        return;
      }

      // Toggle spacecraft mode with F
      if (e.key === 'f' && !e.ctrlKey) {
        this.spacecraftMode = !this.spacecraftMode;
        this.controls.enabled = !this.spacecraftMode;
        this.showModeIndicator(this.spacecraftMode);

        // Clear all movement keys when toggling — prevents phantom movement
        // caused by keys pressed before entering spacecraft mode (e.g. S from settings)
        if (this.spacecraftMode) {
          Object.keys(this.keys).forEach((k) => {
            this.keys[k] = false;
          });
        }
      }

      // Only register movement keys when spacecraft mode is active.
      // This is the core fix: pressing S to open settings no longer primes
      // the spacecraft backward key, because keys are only written in spacecraft mode.
      if (this.spacecraftMode && MOVEMENT_KEYS.has(e.key.toLowerCase())) {
        this.keys[e.key.toLowerCase()] = true;
      }
    });

    window.addEventListener('keyup', (e) => {
      // Always clear on keyup regardless of mode — prevents stuck keys
      // if the user releases a key after exiting spacecraft mode
      this.keys[e.key.toLowerCase()] = false;
    });

    this.renderer.domElement.addEventListener('click', () => {
      if (this.spacecraftMode) {
        this.renderer.domElement.requestPointerLock();
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.spacecraftMode || document.pointerLockElement !== this.renderer.domElement) {
        return;
      }
      this.yaw -= e.movementX * 0.001;
      this.pitch -= e.movementY * 0.001;
      this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));
      const q = new THREE.Quaternion().multiplyQuaternions(
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.pitch)
      );
      this.camera.quaternion.copy(q);
    });

    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== this.renderer.domElement) {
        const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
        this.yaw = euler.y;
        this.pitch = euler.x;
      }
    });
  }

  private updateSpacecraft(): void {
    if (!this.spacecraftMode) {
      return;
    }
    const speed = this.keys['shift'] ? 50 : 3;
    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    right.crossVectors(forward, this.camera.up).normalize();
    up.copy(this.camera.up).normalize();
    if (this.keys['w']) {
      this.camera.position.addScaledVector(forward, speed);
    }
    if (this.keys['s']) {
      this.camera.position.addScaledVector(forward, -speed);
    }
    if (this.keys['a']) {
      this.camera.position.addScaledVector(right, -speed);
    }
    if (this.keys['d']) {
      this.camera.position.addScaledVector(right, speed);
    }
    if (this.keys['q']) {
      this.camera.position.addScaledVector(up, speed);
    }
    if (this.keys['e']) {
      this.camera.position.addScaledVector(up, -speed);
    }
    this.controls.target.copy(this.camera.position.clone().add(forward.multiplyScalar(100)));
  }

  private showModeIndicator(spacecraft: boolean): void {
    const indicator = document.getElementById('mode-indicator');
    if (!indicator) {
      return;
    }
    indicator.textContent = spacecraft
      ? '🚀 Pilot Mode — WASD to fly · F to exit'
      : '🔭 Orbit Mode — F for Pilot Mode · G for Settings';
    indicator.style.opacity = '1';
    indicator.style.transform = 'translateY(0)';
    setTimeout(() => {
      indicator.style.opacity = '0';
      indicator.style.transform = 'translateY(10px)';
    }, 3000);
  }

  private animate(): void {
    requestAnimationFrame(() => this.animate());
    const pulse = (Math.sin(Date.now() * 0.003) + 1) / 2;
    this.lines.forEach((depLine) => {
      if (depLine.dependency.layer === DependencyLayer.CIRCULAR) {
        const m = depLine.line.material as THREE.LineBasicMaterial;
        if (!this.focusedFileId && !this.focusedStarId) {
          m.opacity = 0.4 + pulse * 0.5;
        }
      }
    });
    this.updateSpacecraft();
    if (!this.spacecraftMode) {
      this.controls.update();
    }

    if (this.settings.enableAnimation) {
      if (this.centralCore) {
        this.centralCore.rotation.y += 0.0004;
        this.centralCore.rotation.x += 0.00015;
        const pulse = 0.9 + Math.sin(Date.now() * 0.0008) * 0.3;
        (this.centralCore.material as THREE.MeshStandardMaterial).emissiveIntensity = pulse;
      }

      this.orbitalData.forEach((orbital, fileId) => {
        const planet = this.planets.get(fileId);
        if (!planet) {
          return;
        }
        orbital.angle += orbital.speed * this.settings.orbitalSpeed;
        planet.position.x =
          orbital.starPosition.x +
          orbital.radius * Math.sin(orbital.inclination) * Math.cos(orbital.angle);
        planet.position.y = orbital.starPosition.y + orbital.radius * Math.cos(orbital.inclination);
        planet.position.z =
          orbital.starPosition.z +
          orbital.radius * Math.sin(orbital.inclination) * Math.sin(orbital.angle);
        this.updateInstance(planet.instanceIndex, planet.position, planet.scale, planet.color);
      });

      if (this.planetInstanceMesh) {
        this.planetInstanceMesh.instanceMatrix.needsUpdate = true;
      }

      // Dependency lines follow planet positions
      this.updateDependencyLines();

      // Fix: all rings must follow their planet as it orbits.
      // Previously rings used cached positions and drifted away from moving planets.
      this.uncommittedRings.forEach((ring, fileId) => {
        const p = this.planets.get(fileId);
        if (p) ring.position.copy(p.position);
      });
      this.compressionRings.forEach((ring, fileId) => {
        const p = this.planets.get(fileId);
        if (p) ring.position.copy(p.position);
      });
      this.selectionHighlights.forEach((ring, fileId) => {
        const p = this.planets.get(fileId);
        if (p) ring.position.copy(p.position);
      });

      // Fix: camera tracks the focused planet during orbital motion.
      // Without this the camera stays fixed while the focused planet orbits away.
      if (this.focusedFileId && !this.spacecraftMode) {
        const focused = this.planets.get(this.focusedFileId);
        if (focused) {
          // Smoothly keep controls.target on the moving planet
          this.controls.target.lerp(focused.position, 0.08);
        }
      }

      // Fix: path-trace lines follow their endpoint planets during orbital motion
      if (this.pathTraceLines.length > 0) {
        this.updatePathTracePositions();
      }
    }

    if (this.settings.enableStarRotation) {
      this.stars.forEach((star) => {
        star.mesh.rotation.y += 0.0004;
        star.mesh.rotation.z += 0.0001;
      });
    }

    // Circular dependency lines — pulsing red alert
    const circularPulse = 0.45 + (Math.sin(Date.now() * 0.003) + 1) * 0.27;
    this.lines.forEach((depLine) => {
      if (depLine.dependency.layer === DependencyLayer.CIRCULAR) {
        const mat = depLine.line.material as THREE.LineBasicMaterial;
        if (depLine.line.visible && !this.focusedFileId && !this.focusedStarId) {
          mat.opacity = circularPulse;
        }
      }
    });
    if (this.settings.showProximityLabels) {
      this.updateProximityLabels();
    }

    // Beacon chip — check every frame whether active file is off-screen
    this.updateBeaconChip();

    // Ring orientation — always face camera. Position is updated in the animation
    // block above when animation is on; here we update orientation for all rings
    // so they face correctly even when animation is off.
    const ringPulse = 0.6 + Math.sin(Date.now() * 0.005) * 0.3;
    this.uncommittedRings.forEach((ring, fileId) => {
      const p = this.planets.get(fileId);
      if (p) {
        ring.position.copy(p.position);
      }
      ring.quaternion.copy(this.camera.quaternion);
      (ring.material as THREE.MeshBasicMaterial).opacity = ringPulse;
    });
    const compressPulse = 0.3 + Math.sin(Date.now() * 0.002) * 0.15;
    this.compressionRings.forEach((ring, fileId) => {
      const p = this.planets.get(fileId);
      if (p) {
        ring.position.copy(p.position);
      }
      ring.quaternion.copy(this.camera.quaternion);
      (ring.material as THREE.MeshBasicMaterial).opacity = compressPulse;
    });
    const selectionPulse = 0.7 + Math.sin(Date.now() * 0.004) * 0.2;
    this.selectionHighlights.forEach((ring, fileId) => {
      const p = this.planets.get(fileId);
      if (p) {
        ring.position.copy(p.position);
      }
      ring.quaternion.copy(this.camera.quaternion);
      (ring.material as THREE.MeshBasicMaterial).opacity = selectionPulse;
    });

    this.renderer.render(this.scene, this.camera);
    this.drawMinimap();
  }

  private updateDependencyLines(): void {
    this.lines.forEach((depLine) => {
      const s = this.planets.get(depLine.dependency.sourceId);
      const t = this.planets.get(depLine.dependency.targetId);
      if (!s || !t) {
        return;
      }
      const sourceFolderId = s.file.folderId;
      const targetFolderId = t.file.folderId;
      let controlHint: THREE.Vector3 | undefined;
      if (sourceFolderId === targetFolderId) {
        const star = this.stars.get(sourceFolderId);
        if (star) {
          controlHint = star.mesh.position.clone();
        }
      } else {
        const sourceStar = this.stars.get(sourceFolderId);
        const targetStar = this.stars.get(targetFolderId);
        if (sourceStar && targetStar) {
          controlHint = new THREE.Vector3()
            .addVectors(sourceStar.mesh.position, targetStar.mesh.position)
            .multiplyScalar(0.5);
        }
      }
      depLine.updateEndpoints(s.position, t.position, controlHint);
    });
  }

  /**
   * Redraws path-trace overlay lines as their endpoint planets orbit.
   * Path trace lines are plain THREE.Line with a position buffer attribute —
   * we update the same buffer in-place rather than recreating geometries.
   */
  private updatePathTracePositions(): void {
    // Path trace lines store endpoint planet IDs in userData set during drawPathTrace
    this.pathTraceLines.forEach((line) => {
      const { fromId, toId } = line.userData as { fromId?: string; toId?: string };
      if (!fromId || !toId) return;
      const from = this.planets.get(fromId);
      const to = this.planets.get(toId);
      if (!from || !to) return;

      const SEGMENTS = 16;
      const fromPos = from.position;
      const toPos = to.position;

      // Recompute control point (same logic as drawPathTrace)
      const mid = new THREE.Vector3().addVectors(fromPos, toPos).multiplyScalar(0.5);
      const sourceStar = this.stars.get(from.file.folderId);
      const targetStar = this.stars.get(to.file.folderId);
      const control =
        sourceStar && targetStar
          ? new THREE.Vector3()
            .addVectors(sourceStar.mesh.position, targetStar.mesh.position)
            .multiplyScalar(0.5)
          : mid;

      const pos = line.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i <= SEGMENTS; i++) {
        const t = i / SEGMENTS;
        const u = 1 - t;
        pos.setXYZ(
          i,
          u * u * fromPos.x + 2 * u * t * control.x + t * t * toPos.x,
          u * u * fromPos.y + 2 * u * t * control.y + t * t * toPos.y,
          u * u * fromPos.z + 2 * u * t * control.z + t * t * toPos.z
        );
      }
      pos.needsUpdate = true;
    });
  }

  private initHelpButton(): void {
    const btn = document.getElementById('help-button')!;
    const panel = document.getElementById('shortcuts-panel')!;
    btn.addEventListener('click', () => {
      const isOpen = panel.style.display === 'block';
      panel.style.display = isOpen ? 'none' : 'block';
      btn.classList.toggle('active', !isOpen);
    });
    // Tooltip updated to reflect H shortcut
    btn.title = 'Keyboard shortcuts (H)';
  }

  // ---------------------------------------------------------------------------
  // Feature: Onboarding overlay
  //
  // Shown automatically on first launch (detected via localStorage flag).
  // Recallable at any time by pressing ? (which previously opened the shortcuts
  // panel — we keep shortcuts panel too, accessible via the help button).
  //
  // localStorage is used here because this is a purely client-side preference —
  // it doesn't need to round-trip to the extension or the .cosmos file.
  // The key is versioned (v1) so future redesigns can show it again.
  // ---------------------------------------------------------------------------

  private initOnboarding(): void {
    const overlay = document.getElementById('onboarding-overlay')!;
    const dismissBtn = document.getElementById('onboarding-dismiss')!;

    // Check if first launch
    try {
      this.onboardingSeen = !!localStorage.getItem(Universe.ONBOARDING_KEY);
    } catch {
      // localStorage unavailable in some VS Code WebView configurations
      this.onboardingSeen = false;
    }

    const show = () => {
      overlay.style.display = 'flex';
    };

    const hide = () => {
      overlay.style.opacity = '0';
      overlay.style.transition = 'opacity 0.4s ease';
      setTimeout(() => {
        overlay.style.display = 'none';
        overlay.style.opacity = '';
        overlay.style.transition = '';
      }, 400);
      try {
        localStorage.setItem(Universe.ONBOARDING_KEY, '1');
        this.onboardingSeen = true;
      } catch {
        /* ignore */
      }
    };

    dismissBtn.addEventListener('click', hide);

    // Also dismiss on backdrop click (clicking outside the card)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        hide();
      }
    });

    // ? key: toggle onboarding overlay
    // Replaces the old behavior where ? opened shortcuts panel only.
    // Now: first ? opens onboarding. If onboarding is visible, ? closes it.
    // Shortcuts panel remains accessible via the help button (❔) in the control bar.
    window.addEventListener('keydown', (e) => {
      if (e.key === '?' && !this.isTextInputTarget(e.target)) {
        if (overlay.style.display === 'flex') {
          hide();
        } else {
          show();
        }
      }
    });

    // Show on first launch — but only after the cosmos has built (not during loading).
    // We hook into the build() method via a flag checked in showOnboardingIfFirstLaunch().
  }

  public showOnboardingIfFirstLaunch(): void {
    if (!this.onboardingSeen) {
      const overlay = document.getElementById('onboarding-overlay');
      if (overlay) {
        // Small delay so the developer sees the cosmos first, then the guide appears
        setTimeout(() => {
          overlay.style.display = 'flex';
        }, 800);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Feature: Beacon chip
  //
  // A small floating pill at bottom-center that appears when:
  //   1. An active file is being tracked (set via focusOnFile from FOCUS_FILE message)
  //   2. The camera is not currently looking at that file's planet
  //
  // Shows the filename and invites the developer to click to locate it.
  // Disappears when the camera flies to the planet or the tracked file changes.
  //
  // The proximity check runs in the animate loop via updateBeaconChip().
  // ---------------------------------------------------------------------------

  private initBeaconChip(): void {
    const chip = document.getElementById('beacon-chip')!;
    chip.addEventListener('click', () => {
      if (this.beaconFileId) {
        this.flyToPlanet(this.beaconFileId);
      }
    });
  }

  private updateBeaconChip(): void {
    if (!this.beaconFileId || !this.data) {
      this.setBeaconVisible(false);
      return;
    }

    const planet = this.planets.get(this.beaconFileId);
    if (!planet) {
      this.setBeaconVisible(false);
      return;
    }

    // Beacon is visible when the tracked planet is far from the camera center.
    // We use the angle between the camera's forward vector and the direction
    // to the planet — if it's > 45°, the planet is meaningfully off-screen.
    const toPlanet = new THREE.Vector3()
      .subVectors(planet.position, this.camera.position)
      .normalize();
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    const dot = forward.dot(toPlanet);
    // dot close to 1 = camera looking directly at planet
    // dot < 0.7 = planet more than ~45° off-center = show beacon
    const isOffScreen = dot < 0.7;

    this.setBeaconVisible(isOffScreen);
  }

  private setBeaconVisible(visible: boolean): void {
    if (visible === this.beaconVisible) {
      return;
    }
    this.beaconVisible = visible;
    const chip = document.getElementById('beacon-chip');
    if (!chip) {
      return;
    }
    if (visible) {
      const file = this.data?.files[this.beaconFileId!];
      const nameEl = document.getElementById('beacon-filename');
      if (nameEl && file) {
        nameEl.textContent = file.name;
      }
      chip.style.display = 'flex';
      // Slide up into view
      chip.style.transform = 'translateX(-50%) translateY(12px)';
      chip.style.opacity = '0';
      requestAnimationFrame(() => {
        chip.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        chip.style.transform = 'translateX(-50%) translateY(0)';
        chip.style.opacity = '1';
      });
    } else {
      chip.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
      chip.style.opacity = '0';
      chip.style.transform = 'translateX(-50%) translateY(8px)';
      setTimeout(() => {
        chip.style.display = 'none';
        chip.style.transition = '';
      }, 260);
    }
  }

  // ---------------------------------------------------------------------------
  // Feature: Multi-select + Path Trace
  //
  // Shift-click accumulates a set of selected planet IDs.
  // Selection is visualised with a glowing selection ring around each planet.
  //
  // When exactly 2 planets are selected, path trace activates automatically:
  //   1. Find the shortest dependency path between the two planets using BFS
  //      across all dependency layers (direct first, then indirect).
  //   2. Illuminate that path with bright gold Bézier lines on top of the
  //      existing dependency lines.
  //   3. Dim everything that isn't on the path.
  //   4. Show a breadcrumb in the selection panel: A → B → C
  //
  // Escape or clicking empty space clears the selection.
  // ---------------------------------------------------------------------------

  private initMultiSelect(): void {
    // Selection cleared by the unified Escape handler in initSearch.
    // Multi-select behaviour is handled in onClick (shift-click) and
    // clearSelection (called from selection panel clear button and Escape).

    const btn = document.getElementById('onscreen-esc-btn');
    if (!btn) {
      return;
    }

    btn.addEventListener('click', () => {
      // Fire a synthetic Escape keydown so the unified handler in initSearch() runs.
      // This keeps a single code path for all Escape-like actions rather than
      // duplicating the priority chain here.
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    btn.addEventListener('mouseenter', () => {
      btn.style.borderColor = 'rgba(255,255,255,0.3)';
      btn.style.color = 'rgba(255,255,255,0.75)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.borderColor = 'rgba(255,255,255,0.12)';
      btn.style.color = 'rgba(255,255,255,0.45)';
    });
  }

  private initOnscreenEsc(): void {
    const btn = document.getElementById('onscreen-esc-btn');
    if (!btn) {
      return;
    }

    // Keep the ESC affordance clickable even if the panel was rebuilt.
    btn.setAttribute('aria-label', 'Dismiss overlays');
    btn.setAttribute('title', 'Dismiss overlays');
  }

  private togglePlanetSelection(fileId: string): void {
    if (this.selectedPlanetIds.has(fileId)) {
      this.selectedPlanetIds.delete(fileId);
      this.removeSelectionHighlight(fileId);
    } else {
      this.selectedPlanetIds.add(fileId);
      this.addSelectionHighlight(fileId);
    }
    this.updateSelectionPanel();

    // Path trace fires automatically when exactly 2 planets are selected
    if (this.selectedPlanetIds.size === 2) {
      const [a, b] = Array.from(this.selectedPlanetIds);
      this.runPathTrace(a, b);
    } else {
      this.clearPathTrace();
    }
  }

  private addSelectionHighlight(fileId: string): void {
    if (this.selectionHighlights.has(fileId)) {
      return;
    }
    const planet = this.planets.get(fileId);
    if (!planet) {
      return;
    }
    // Gold ring — distinct from orange (uncommitted) and cyan (compression)
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(planet.baseScale * 2.8, planet.baseScale * 3.3, 32),
      new THREE.MeshBasicMaterial({
        color: 0xffd700,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
      })
    );
    ring.position.copy(planet.position);
    ring.quaternion.copy(this.camera.quaternion);
    this.selectionHighlights.set(fileId, ring);
    this.scene.add(ring);
  }

  private removeSelectionHighlight(fileId: string): void {
    const ring = this.selectionHighlights.get(fileId);
    if (ring) {
      this.scene.remove(ring);
      (ring.material as THREE.MeshBasicMaterial).dispose();
      ring.geometry.dispose();
      this.selectionHighlights.delete(fileId);
    }
  }

  private clearSelection(): void {
    this.selectedPlanetIds.forEach((id) => this.removeSelectionHighlight(id));
    this.selectedPlanetIds.clear();
    this.clearPathTrace();
    this.updateSelectionPanel();
  }

  // ---------------------------------------------------------------------------
  // Path trace: BFS through dependency graph to find shortest path A → B
  //
  // We search across all dependency layers but weight direct imports first.
  // The algorithm builds an adjacency list from loaded dependencies, then
  // runs standard BFS from source, stopping when it reaches the target.
  // If no path exists, we look for a Closest Common Ancestor (CCA) —
  // the file that both A and B directly or indirectly depend on.
  // ---------------------------------------------------------------------------

  private runPathTrace(sourceId: string, targetId: string): void {
    this.clearPathTrace(false); // clear lines but keep selection rings

    // Build adjacency list — directed (imports flow source → target)
    const adj = new Map<string, string[]>();
    this.dependencies.forEach((dep) => {
      if (dep.layer === DependencyLayer.CIRCULAR) {
        return; // skip circular — they'd cause infinite loops
      }
      if (!adj.has(dep.sourceId)) {
        adj.set(dep.sourceId, []);
      }
      adj.get(dep.sourceId)!.push(dep.targetId);
    });

    // BFS forward from sourceId
    const path = this.bfsPath(adj, sourceId, targetId);

    if (path) {
      this.drawPathTrace(path, 0xffd700); // gold path
      this.showPathBreadcrumb(path);
    } else {
      // No direct path — find closest common ancestor
      const cca = this.findClosestCommonAncestor(adj, sourceId, targetId);
      if (cca) {
        const pathA = this.bfsPath(adj, sourceId, cca) ?? [sourceId, cca];
        const pathB = this.bfsPath(adj, targetId, cca) ?? [targetId, cca];
        this.drawPathTrace(pathA, 0xffd700);
        this.drawPathTrace(pathB, 0xff9800); // orange for second path
        this.showPathBreadcrumb([...pathA, '...shared...', ...pathB.reverse()]);
      } else {
        this.showPathBreadcrumb(null); // no connection found
      }
    }
  }

  private bfsPath(adj: Map<string, string[]>, from: string, to: string): string[] | null {
    const visited = new Set<string>([from]);
    const queue: string[][] = [[from]];
    let safety = 0;
    while (queue.length > 0 && safety++ < 10000) {
      const path = queue.shift()!;
      const node = path[path.length - 1];
      for (const neighbor of adj.get(node) ?? []) {
        if (neighbor === to) {
          return [...path, neighbor];
        }
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push([...path, neighbor]);
        }
      }
    }
    return null;
  }

  private findClosestCommonAncestor(
    adj: Map<string, string[]>,
    a: string,
    b: string
  ): string | null {
    // Collect all ancestors of A (files that A transitively imports)
    const ancestorsA = new Set<string>();
    const dfsA = (node: string, depth: number) => {
      if (depth > 20) {
        return;
      }
      for (const neighbor of adj.get(node) ?? []) {
        if (!ancestorsA.has(neighbor)) {
          ancestorsA.add(neighbor);
          dfsA(neighbor, depth + 1);
        }
      }
    };
    dfsA(a, 0);

    // Find first ancestor of B that's also in A's ancestors
    const queue = [b];
    const visited = new Set<string>([b]);
    let safety = 0;
    while (queue.length > 0 && safety++ < 5000) {
      const node = queue.shift()!;
      for (const neighbor of adj.get(node) ?? []) {
        if (ancestorsA.has(neighbor)) {
          return neighbor; // first common ancestor found
        }
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    return null;
  }

  private drawPathTrace(path: string[], color: number): void {
    for (let i = 0; i < path.length - 1; i++) {
      const fromPlanet = this.planets.get(path[i]);
      const toPlanet = this.planets.get(path[i + 1]);
      if (!fromPlanet || !toPlanet) {
        continue;
      }

      // Reuse Bézier logic — pull control toward shared star
      const sourceFolderId = fromPlanet.file.folderId;
      const targetFolderId = toPlanet.file.folderId;
      let control: THREE.Vector3;
      const sourceStar = this.stars.get(sourceFolderId);
      const targetStar = this.stars.get(targetFolderId);
      if (sourceStar && targetStar) {
        control = new THREE.Vector3()
          .addVectors(sourceStar.mesh.position, targetStar.mesh.position)
          .multiplyScalar(0.5);
      } else {
        control = new THREE.Vector3()
          .addVectors(fromPlanet.position, toPlanet.position)
          .multiplyScalar(0.5);
      }

      const SEGMENTS = 16;
      const positions = new Float32Array((SEGMENTS + 1) * 3);
      for (let s = 0; s <= SEGMENTS; s++) {
        const t = s / SEGMENTS;
        const u = 1 - t;
        positions[s * 3] =
          u * u * fromPlanet.position.x + 2 * u * t * control.x + t * t * toPlanet.position.x;
        positions[s * 3 + 1] =
          u * u * fromPlanet.position.y + 2 * u * t * control.y + t * t * toPlanet.position.y;
        positions[s * 3 + 2] =
          u * u * fromPlanet.position.z + 2 * u * t * control.z + t * t * toPlanet.position.z;
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.95,
        linewidth: 2,
        depthTest: false,
      });
      const line = new THREE.Line(geo, mat);
      // Tag with endpoint planet IDs so updatePathTracePositions can update them
      line.userData = { fromId: path[i], toId: path[i + 1] };
      this.pathTraceLines.push(line);
      this.scene.add(line);
    }
  }

  private clearPathTrace(clearPanel = true): void {
    this.pathTraceLines.forEach((l) => {
      this.scene.remove(l);
      l.geometry.dispose();
      (l.material as THREE.LineBasicMaterial).dispose();
    });
    this.pathTraceLines = [];
    if (clearPanel) {
      this.showPathBreadcrumb(null);
    }
  }

  private showPathBreadcrumb(path: string[] | null): void {
    const panel = document.getElementById('selection-panel');
    if (!panel) {
      return;
    }

    if (!path) {
      if (this.selectedPlanetIds.size === 0) {
        panel.style.display = 'none';
      }
      return;
    }

    const breadcrumb = path
      .map((id) => {
        if (id === '...shared...') {
          return '⟵ shared ⟶';
        }
        const file = this.data?.files[id];
        return file
          ? `<span style="color:var(--accent-blue)">${this.escapeHtml(file.name)}</span>`
          : id;
      })
      .join(' <span style="opacity:0.4">→</span> ');

    const pathDiv = panel.querySelector('#path-breadcrumb');
    if (pathDiv) {
      pathDiv.innerHTML =
        path.length > 0
          ? breadcrumb
          : '<span style="opacity:0.4; font-style:italic;">No dependency path found between these files</span>';
    }
  }

  private updateSelectionPanel(): void {
    let panel = document.getElementById('selection-panel');

    if (this.selectedPlanetIds.size === 0) {
      if (panel) {
        panel.style.display = 'none';
      }
      return;
    }

    // Build panel lazily
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'selection-panel';
      panel.className = 'glass-panel';
      panel.style.cssText = `
        position: fixed;
        bottom: 100px;
        right: 16px;
        width: 280px;
        padding: 14px 16px;
        z-index: 200;
        font-size: 11px;
      `;
      document.body.appendChild(panel);
    }

    const ids = Array.from(this.selectedPlanetIds);
    const fileNames = ids
      .map((id) => this.data?.files[id]?.name ?? id)
      .map(
        (n) =>
          `<div style="padding:3px 0; opacity:0.8; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">📍 ${this.escapeHtml(n)}</div>`
      )
      .join('');

    const actions =
      ids.length >= 2
        ? `<div style="margin-top:10px; border-top:1px solid rgba(255,255,255,0.08); padding-top:10px;">
           <div id="path-breadcrumb" style="line-height:1.6; word-break:break-word; margin-bottom:8px; opacity:0.7; font-size:10px;">
             Tracing path...
           </div>
         </div>`
        : `<div style="margin-top:8px; opacity:0.4; font-size:10px; font-style:italic;">
           Shift-click a second planet to trace the dependency path
         </div>`;

    panel.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span style="font-weight:700; font-size:12px; color:var(--accent-gold);">
          ⬡ ${ids.length} selected
        </span>
        <button id="clear-selection-btn" style="
          background:none; border:1px solid rgba(255,255,255,0.15);
          color:rgba(255,255,255,0.6); border-radius:6px;
          padding:3px 10px; cursor:pointer; font-size:10px;
        ">Clear</button>
      </div>
      <div style="max-height:120px; overflow-y:auto;">${fileNames}</div>
      ${actions}
    `;

    panel.style.display = 'block';

    panel.querySelector('#clear-selection-btn')?.addEventListener('click', () => {
      this.clearSelection();
    });
  }

  // ---------------------------------------------------------------------------
  // Feature: Camera Bookmarks
  //
  // Up to 5 named camera positions, persisted to the per-project .cosmos file
  // (navigation.namedSlots). Rendered as pill buttons in the top-right corner.
  // Saving: records current camera.position + controls.target, sends
  // SAVE_NAVIGATION to the extension. Loading: bookmarks arrive via
  // APPLY_NAVIGATION (see applyNavigation below) — NOT read here, since the
  // extension hasn't sent them yet at construction time.
  // ---------------------------------------------------------------------------

  private initCameraBookmarks(): void {
    // Render an empty bar immediately — applyNavigation() will populate it
    // once .cosmos data arrives from the extension (typically within one
    // message round-trip of READY).
    this.renderBookmarkBar();

    // Keyboard shortcut: Ctrl+1..5 flies to bookmark 1..5
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey && !this.isTextInputTarget(e.target)) {
        const idx = parseInt(e.key, 10) - 1;
        if (idx >= 0 && idx < this.cameraBookmarks.length) {
          e.preventDefault();
          this.flyToBookmark(idx);
        }
      }
    });
  }

  /**
   * Called from main.ts when APPLY_NAVIGATION arrives — populates camera
   * bookmarks (and, in future, home position / camera history) from the
   * per-project .cosmos file.
   */
  public applyNavigation(navigation: NavigationData): void {
    this.cameraBookmarks = navigation.namedSlots ?? [];
    this.navigationLoaded = true;
    this.renderBookmarkBar();
  }

  /**
   * Persist the current bookmark list to .cosmos via SAVE_NAVIGATION.
   * Guarded by navigationLoaded — without this guard, an early save (e.g.
   * before APPLY_NAVIGATION has arrived) could overwrite existing bookmarks
   * in .cosmos with an empty array.
   */
  private persistBookmarks(): void {
    if (!this.navigationLoaded) {
      return;
    }
    sendToExtension({
      type: 'SAVE_NAVIGATION',
      payload: { namedSlots: this.cameraBookmarks },
    });
  }

  private renderBookmarkBar(): void {
    let bar = document.getElementById('bookmark-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'bookmark-bar';
      bar.style.cssText = `
        position: fixed;
        top: 16px;
        right: 16px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        z-index: 200;
        align-items: flex-end;
      `;
      document.body.appendChild(bar);
    }

    bar.innerHTML = '';

    // "Save view" button — always shown
    const saveBtn = document.createElement('button');
    saveBtn.title = 'Save current camera position as a bookmark';
    saveBtn.style.cssText = `
      background: rgba(10,14,26,0.85);
      border: 1px solid rgba(255,255,255,0.15);
      color: rgba(255,255,255,0.7);
      border-radius: 8px;
      padding: 5px 12px;
      font-size: 10px;
      cursor: pointer;
      letter-spacing: 0.5px;
      backdrop-filter: blur(10px);
      transition: border-color 0.2s ease, color 0.2s ease;
      white-space: nowrap;
    `;
    saveBtn.textContent = '+ Save View';
    saveBtn.addEventListener('mouseenter', () => {
      saveBtn.style.borderColor = 'rgba(255,215,0,0.5)';
      saveBtn.style.color = 'rgba(255,215,0,0.9)';
    });
    saveBtn.addEventListener('mouseleave', () => {
      saveBtn.style.borderColor = 'rgba(255,255,255,0.15)';
      saveBtn.style.color = 'rgba(255,255,255,0.7)';
    });
    saveBtn.addEventListener('click', () => this.saveBookmark());
    bar.appendChild(saveBtn);

    // Existing bookmark pills
    this.cameraBookmarks.forEach((bm, idx) => {
      const pill = document.createElement('div');
      pill.style.cssText = `
        display: flex;
        align-items: center;
        gap: 0;
        background: rgba(10,14,26,0.85);
        border: 1px solid rgba(255,215,0,0.25);
        border-radius: 8px;
        overflow: hidden;
        backdrop-filter: blur(10px);
        font-size: 10px;
      `;

      const flyBtn = document.createElement('button');
      flyBtn.style.cssText = `
        background: none; border: none;
        color: rgba(255,215,0,0.85);
        padding: 5px 12px;
        cursor: pointer;
        font-size: 10px;
        letter-spacing: 0.4px;
        white-space: nowrap;
        max-width: 140px;
        overflow: hidden;
        text-overflow: ellipsis;
      `;
      flyBtn.title = `Fly to "${bm.name}" (Ctrl+${idx + 1})`;
      flyBtn.textContent = `⭐ ${bm.name}`;
      flyBtn.addEventListener('click', () => this.flyToBookmark(idx));

      const delBtn = document.createElement('button');
      delBtn.style.cssText = `
        background: none;
        border: none;
        border-left: 1px solid rgba(255,255,255,0.08);
        color: rgba(255,255,255,0.3);
        padding: 5px 8px;
        cursor: pointer;
        font-size: 11px;
        line-height: 1;
      `;
      delBtn.title = 'Remove bookmark';
      delBtn.textContent = '×';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteBookmark(idx);
      });
      delBtn.addEventListener('mouseenter', () => {
        delBtn.style.color = '#ff5252';
      });
      delBtn.addEventListener('mouseleave', () => {
        delBtn.style.color = 'rgba(255,255,255,0.3)';
      });

      pill.appendChild(flyBtn);
      pill.appendChild(delBtn);
      bar.appendChild(pill);
    });
  }

  private saveBookmark(): void {
    if (this.cameraBookmarks.length >= Universe.MAX_BOOKMARKS) {
      this.cameraBookmarks.shift();
    }

    const defaultName = this.getDefaultBookmarkName();

    // VS Code WebView blocks window.prompt() — build an inline dialog instead.
    const existing = document.getElementById('bookmark-name-dialog');
    if (existing) {
      existing.remove();
    }

    const dialog = document.createElement('div');
    dialog.id = 'bookmark-name-dialog';
    dialog.style.cssText = `
      position: fixed;
      top: 60px;
      right: 16px;
      background: rgba(10, 14, 26, 0.97);
      border: 1px solid rgba(255, 215, 0, 0.35);
      border-radius: 12px;
      padding: 16px;
      z-index: 9999;
      width: 220px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.6);
      backdrop-filter: blur(16px);
      font-size: 12px;
    `;

    dialog.innerHTML = `
      <div style="font-weight:700; margin-bottom:10px; color:var(--accent-gold); font-size:11px; letter-spacing:0.5px;">
        NAME THIS VIEW
      </div>
      <input id="bookmark-name-input" type="text"
        value="${this.escapeHtml(defaultName)}"
        maxlength="30"
        style="
          width: 100%; box-sizing: border-box;
          background: rgba(255,255,255,0.08);
          border: 1px solid rgba(255,255,255,0.2);
          border-radius: 8px; padding: 8px 10px;
          color: white; font-size: 12px; outline: none;
          margin-bottom: 10px;
        "
      />
      <div style="display:flex; gap:8px;">
        <button id="bookmark-save-confirm" style="
          flex:1; background: var(--accent-gold); border:none;
          border-radius:8px; padding:7px; cursor:pointer;
          font-size:11px; font-weight:700; color:#000;
        ">Save</button>
        <button id="bookmark-save-cancel" style="
          flex:1; background:rgba(255,255,255,0.08);
          border:1px solid rgba(255,255,255,0.15);
          border-radius:8px; padding:7px; cursor:pointer;
          font-size:11px; color:rgba(255,255,255,0.7);
        ">Cancel</button>
      </div>
    `;

    document.body.appendChild(dialog);

    const input = document.getElementById('bookmark-name-input') as HTMLInputElement;
    // Select all text so user can immediately type a new name
    setTimeout(() => {
      input.focus();
      input.select();
    }, 0);

    const confirm = () => {
      const name = input.value.trim().slice(0, 30);
      dialog.remove();
      if (!name) {
        return;
      }

      const slot: NamedCameraSlot = {
        name,
        camera: {
          position: {
            x: this.camera.position.x,
            y: this.camera.position.y,
            z: this.camera.position.z,
          },
          target: {
            x: this.controls.target.x,
            y: this.controls.target.y,
            z: this.controls.target.z,
          },
        },
      };

      this.cameraBookmarks.push(slot);
      this.persistBookmarks();
      this.renderBookmarkBar();
    };

    const cancel = () => dialog.remove();

    document.getElementById('bookmark-save-confirm')?.addEventListener('click', confirm);
    document.getElementById('bookmark-save-cancel')?.addEventListener('click', cancel);

    // Enter confirms, Escape cancels
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        confirm();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    });
  }

  private flyToBookmark(idx: number): void {
    const bm = this.cameraBookmarks[idx];
    if (!bm) {
      return;
    }

    const startPosition = this.camera.position.clone();
    const startTarget = this.controls.target.clone();
    const endPosition = new THREE.Vector3(
      bm.camera.position.x,
      bm.camera.position.y,
      bm.camera.position.z
    );
    const endTarget = new THREE.Vector3(bm.camera.target.x, bm.camera.target.y, bm.camera.target.z);

    // Scale duration to distance — short hop = quick, cross-galaxy = dramatic
    const dist = startPosition.distanceTo(endPosition);
    const duration = Math.min(120, Math.max(40, Math.floor(dist / 20)));

    let progress = 0;
    const fly = () => {
      if (progress >= duration) {
        this.controls.target.copy(endTarget);
        this.controls.update();
        return;
      }
      progress++;
      const t = progress / duration;
      // Cubic ease: slow start, fast middle, slow end — cinematic feel
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      this.camera.position.lerpVectors(startPosition, endPosition, eased);
      this.controls.target.lerpVectors(startTarget, endTarget, eased);
      this.controls.update();
      requestAnimationFrame(fly);
    };
    fly();
  }

  private deleteBookmark(idx: number): void {
    this.cameraBookmarks.splice(idx, 1);
    this.persistBookmarks();
    this.renderBookmarkBar();
  }

  private getDefaultBookmarkName(): string {
    // Try to name after the nearest star to the camera's look target
    let closest: string | null = null;
    let closestDist = Infinity;
    this.stars.forEach((star, folderId) => {
      const d = this.controls.target.distanceTo(star.mesh.position);
      if (d < closestDist) {
        closestDist = d;
        closest = folderId;
      }
    });
    if (closest && this.data?.folders[closest]) {
      return this.data.folders[closest].name;
    }
    return `View ${this.cameraBookmarks.length + 1}`;
  }

  private updateProximityLabels(): void {
    this.planets.forEach((planet, fileId) => {
      const distance = this.camera.position.distanceTo(planet.position);
      let label = this.planetLabels.get(fileId);
      if (distance < this.LABEL_SHOW_DISTANCE) {
        if (!label) {
          label = this.createPlanetLabel(this.data!.files[fileId].name);
          this.planetLabels.set(fileId, label);
          this.scene.add(label);
        }
        label.position.copy(planet.position);
        label.position.y += 8;
        (label.material as THREE.SpriteMaterial).opacity = 1 - distance / this.LABEL_SHOW_DISTANCE;
        label.visible = true;
      } else if (label) {
        label.visible = false;
      }
    });
  }

  private createPlanetLabel(name: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 56;
    const ctx = canvas.getContext('2d')!;

    ctx.font = '20px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const textWidth = ctx.measureText(name).width;
    const padX = 16;
    const pillW = Math.min(textWidth + padX * 2, canvas.width - 8);
    const pillH = 34;
    const pillX = (canvas.width - pillW) / 2;
    const pillY = (canvas.height - pillH) / 2;
    const radius = pillH / 2;

    // Pill background
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    ctx.moveTo(pillX + radius, pillY);
    ctx.lineTo(pillX + pillW - radius, pillY);
    ctx.arcTo(pillX + pillW, pillY, pillX + pillW, pillY + radius, radius);
    ctx.lineTo(pillX + pillW, pillY + pillH - radius);
    ctx.arcTo(pillX + pillW, pillY + pillH, pillX + pillW - radius, pillY + pillH, radius);
    ctx.lineTo(pillX + radius, pillY + pillH);
    ctx.arcTo(pillX, pillY + pillH, pillX, pillY + pillH - radius, radius);
    ctx.lineTo(pillX, pillY + radius);
    ctx.arcTo(pillX, pillY, pillX + radius, pillY, radius);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Text
    ctx.shadowColor = 'rgba(0,0,0,0.95)';
    ctx.shadowBlur = 3;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, canvas.width / 2, canvas.height / 2, canvas.width - 16);

    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(canvas),
        transparent: true,
        depthWrite: false,
        depthTest: false,
      })
    );
    sprite.scale.set(44, 44 * (canvas.height / canvas.width), 1);
    return sprite;
  }

  public applySettings(settings: SettingsState): void {
    this.settings = settings;
    this.syncPanelToSettings();
    this.applySettingsToScene();
  }

  private applySettingsToScene(): void {
    if (this.settings.performanceMode !== this.lastPerformanceMode) {
      this.lastPerformanceMode = this.settings.performanceMode;
      this.addBackgroundStars();
      const indicator = document.getElementById('mode-indicator');
      if (indicator) {
        indicator.textContent = this.settings.performanceMode
          ? '⚡ Performance Mode — refresh for full effect'
          : '✨ Quality Mode — refresh for full effect';
        indicator.style.opacity = '1';
        setTimeout(() => {
          indicator.style.opacity = '0';
        }, 3000);
      }
    }
    this.renderer.setPixelRatio(
      this.settings.performanceMode ? 1 : Math.min(window.devicePixelRatio, 2)
    );
    this.scene.fog = this.settings.enableFog ? new THREE.FogExp2(0x000000, 0.00006) : null;
    if (this.backgroundStars) {
      this.backgroundStars.visible = this.settings.showBackgroundStars;
    }
    this.starLabels.forEach((label) => {
      label.visible = this.settings.showFolderLabels;
    });
    const legend = document.getElementById('legend');
    if (legend) {
      legend.style.display = this.settings.showLegend ? 'block' : 'none';
    }
    this.lines.forEach((depLine) => {
      const layer = depLine.dependency.layer;
      let visible = true;
      if (layer === DependencyLayer.DIRECT && !this.settings.showDirectLines) {
        visible = false;
      }
      if (layer === DependencyLayer.INDIRECT && !this.settings.showIndirectLines) {
        visible = false;
      }
      if (
        (layer === DependencyLayer.LAYER3_SHARED_DEPENDENT ||
          layer === DependencyLayer.LAYER3_SHARED_DEPENDENCY) &&
        !this.settings.showLayer3Lines
      ) {
        visible = false;
      }
      if (layer === DependencyLayer.CIRCULAR && !this.settings.showCircularLines) {
        visible = false;
      }
      depLine.line.visible = visible;
    });
    const minimapBtn = document.getElementById('minimap-btn');
    if (this.settings.showMinimap && !this.minimapVisible) {
      minimapBtn?.click();
    } else if (!this.settings.showMinimap && this.minimapVisible) {
      minimapBtn?.click();
    }

    // Re-apply planet colors whenever visual settings change — heatmap toggle,
    // performance mode, etc. all affect how planets are colored.
    // applyGitVisuals now runs unconditionally (handles no-git case too).
    if (this.planets.size > 0) {
      this.applyGitVisuals();
    }
  }

  private initSettingsPanel(): void {
    const panel = document.getElementById('settings-panel')!;
    const btn = document.getElementById('settings-btn')!;
    btn.addEventListener('click', () => {
      const v = panel.style.display === 'block';
      panel.style.display = v ? 'none' : 'block';
      btn.classList.toggle('active', !v);
    });
    const bindCheckbox = (id: string, key: keyof SettingsState) => {
      const el = document.getElementById(id) as HTMLInputElement;
      if (!el) {
        return;
      }
      el.checked = !!this.settings[key];
      el.addEventListener('change', () => {
        (this.settings as any)[key] = el.checked;
        this.applySettingsToScene();
        this.saveSettings();
      });
    };
    const bindSlider = (id: string, key: keyof SettingsState, valElId: string, rebuild = false) => {
      const el = document.getElementById(id) as HTMLInputElement;
      const valEl = document.getElementById(valElId);
      if (!el) {
        return;
      }
      el.value = String(this.settings[key]);
      if (valEl) {
        valEl.textContent = `${parseFloat(el.value).toFixed(1)}x`;
      }
      el.addEventListener('input', () => {
        const val = parseFloat(el.value);
        (this.settings as any)[key] = val;
        if (valEl) {
          valEl.textContent = `${val.toFixed(1)}x`;
        }
      });
      // 'change' fires once when the user releases the slider — rebuilding on
      // every 'input' tick would be expensive for a full scene rebuild.
      el.addEventListener('change', () => {
        this.saveSettings();
        if (rebuild && this.data) {
          this.build(this.data);
        }
      });
    };
    bindCheckbox('s-direct', 'showDirectLines');
    bindCheckbox('s-indirect', 'showIndirectLines');
    bindCheckbox('s-layer3', 'showLayer3Lines');
    bindCheckbox('s-circular', 'showCircularLines');
    bindCheckbox('s-animation', 'enableAnimation');
    bindCheckbox('s-star-rotation', 'enableStarRotation');
    bindCheckbox('s-folder-labels', 'showFolderLabels');
    bindCheckbox('s-proximity-labels', 'showProximityLabels');
    bindCheckbox('s-bg-stars', 'showBackgroundStars');
    bindCheckbox('s-fog', 'enableFog');
    bindCheckbox('s-legend', 'showLegend');
    bindCheckbox('s-performance', 'performanceMode');
    bindCheckbox('s-minimap', 'showMinimap');
    bindCheckbox('s-heatmap', 'showGitHeatmap');
    bindSlider('s-speed', 'orbitalSpeed', 'speed-val');
    bindSlider('s-spacing', 'spacingFactor', 'spacing-val', true); // rebuild=true — repositions everything
    document.querySelectorAll('.preset-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.applyPreset((btn as HTMLElement).dataset.preset as keyof typeof PRESETS);
        this.syncPanelToSettings();
      });
    });
  }

  private applyPreset(preset: keyof typeof PRESETS): void {
    // Preserve spacingFactor — it's a personal layout preference independent
    // of the visual/performance preset being applied.
    const spacingFactor = this.settings.spacingFactor;
    this.settings = { ...PRESETS[preset], spacingFactor };
    this.applySettingsToScene();
    this.saveSettings();
  }

  private syncPanelToSettings(): void {
    const set = (id: string, val: boolean) => {
      const el = document.getElementById(id) as HTMLInputElement;
      if (el) {
        el.checked = val;
      }
    };
    set('s-direct', this.settings.showDirectLines);
    set('s-indirect', this.settings.showIndirectLines);
    set('s-layer3', this.settings.showLayer3Lines);
    set('s-circular', this.settings.showCircularLines);
    set('s-animation', this.settings.enableAnimation);
    set('s-star-rotation', this.settings.enableStarRotation);
    set('s-folder-labels', this.settings.showFolderLabels);
    set('s-proximity-labels', this.settings.showProximityLabels);
    set('s-bg-stars', this.settings.showBackgroundStars);
    set('s-fog', this.settings.enableFog);
    set('s-legend', this.settings.showLegend);
    set('s-performance', this.settings.performanceMode);
    set('s-minimap', this.settings.showMinimap);
    const speedEl = document.getElementById('s-speed') as HTMLInputElement;
    if (speedEl) {
      speedEl.value = String(this.settings.orbitalSpeed);
      const speedVal = document.getElementById('speed-val');
      if (speedVal) {
        speedVal.textContent = `${this.settings.orbitalSpeed.toFixed(1)}x`;
      }
    }
    const spacingEl = document.getElementById('s-spacing') as HTMLInputElement;
    if (spacingEl) {
      spacingEl.value = String(this.settings.spacingFactor);
      const spacingVal = document.getElementById('spacing-val');
      if (spacingVal) {
        spacingVal.textContent = `${this.settings.spacingFactor.toFixed(1)}x`;
      }
    }
  }

  private saveSettings(): void {
    sendToExtension({ type: 'SAVE_SETTINGS', payload: this.settings });
  }

  private enterStarFocusMode(folderId: string): void {
    this.focusedStarId = folderId;
    const exitBtn = document.getElementById('exit-focus-btn');
    if (exitBtn) {
      exitBtn.style.display = 'flex';
    }
    this.flyToStar(folderId);
    const folder = this.data?.folders[folderId];
    if (!folder) {
      return;
    }
    const folderFileIds = new Set(folder.fileIds);
    this.planets.forEach((planet, fileId) => {
      const isConnected = folderFileIds.has(fileId);
      const color = new THREE.Color(planet.color);
      if (!isConnected) {
        color.multiplyScalar(0.1);
      }
      this.planetInstanceMesh!.setColorAt(planet.instanceIndex, color);
    });
    this.planetInstanceMesh!.instanceColor!.needsUpdate = true;
    this.stars.forEach((star, id) => {
      (star.mesh.material as THREE.MeshStandardMaterial).opacity = id === folderId ? 1 : 0.05;
      (star.mesh.material as THREE.MeshStandardMaterial).transparent = true;
    });
    this.starLabels.forEach((label) => {
      (label.material as THREE.SpriteMaterial).opacity = 0.05;
    });
    this.lines.forEach((depLine) => {
      const isConnected =
        folderFileIds.has(depLine.dependency.sourceId) ||
        folderFileIds.has(depLine.dependency.targetId);
      depLine.line.visible = isConnected;
      if (isConnected) {
        (depLine.line.material as THREE.LineBasicMaterial).opacity = 0.9;
      }
    });
  }

  private exitStarFocusMode(): void {
    this.focusedStarId = null;
    const exitBtn = document.getElementById('exit-focus-btn');
    if (exitBtn) {
      exitBtn.style.display = 'none';
    }
    this.planets.forEach((planet) => {
      this.planetInstanceMesh!.setColorAt(planet.instanceIndex, new THREE.Color(planet.color));
    });
    this.planetInstanceMesh!.instanceColor!.needsUpdate = true;
    this.stars.forEach((star) => {
      (star.mesh.material as THREE.MeshStandardMaterial).opacity = 1;
      (star.mesh.material as THREE.MeshStandardMaterial).transparent = false;
    });
    this.starLabels.forEach((label) => {
      (label.material as THREE.SpriteMaterial).opacity = 1;
    });
    this.lines.forEach((depLine) => {
      (depLine.line.material as THREE.LineBasicMaterial).opacity = depLine.baseOpacity;
    });
    this.applySettingsToScene();
  }

  private initExportButton(): void {
    document.getElementById('export-btn')?.addEventListener('click', () => this.exportImage());
  }

  private exportImage(): void {
    const uiElements = [
      'tooltip',
      'search-container',
      'settings-panel',
      'shortcuts-panel',
      'filter-bar',
      'legend',
      'reset-camera',
      'help-button',
      'settings-btn',
      'filter-btn',
      'export-btn',
      'refresh-universe',
      'mode-indicator',
    ];
    const hidden: { el: HTMLElement; display: string }[] = [];
    uiElements.forEach((id) => {
      const el = document.getElementById(id);
      if (el && el.style.display !== 'none') {
        hidden.push({ el, display: el.style.display });
        el.style.display = 'none';
      }
    });
    this.renderer.render(this.scene, this.camera);
    const dataUrl = this.renderer.domElement.toDataURL('image/png');
    hidden.forEach(({ el, display }) => {
      el.style.display = display;
    });
    sendToExtension({ type: 'EXPORT_IMAGE', payload: { dataUrl } });
    const indicator = document.getElementById('mode-indicator');
    if (indicator) {
      indicator.textContent = '📷 Capturing...';
      indicator.style.opacity = '1';
      setTimeout(() => {
        indicator.style.opacity = '0';
      }, 1500);
    }
  }

  private initRefreshButton(): void {
    document.getElementById('refresh-universe')?.addEventListener('click', () => {
      sendToExtension({ type: 'REFRESH' });
      const overlay = document.getElementById('loading-overlay');
      const loadingText = document.getElementById('loading-text');
      if (overlay && loadingText) {
        loadingText.textContent = 'Refreshing universe...';
        overlay.style.display = 'flex';
        overlay.style.opacity = '1';
      }
    });
  }

  private initFilterBar(): void {
    const bar = document.getElementById('filter-bar')!;
    const toggleBtn = document.getElementById('filter-btn')!;
    toggleBtn.addEventListener('click', () => {
      const v = bar.style.display === 'flex';
      bar.style.display = v ? 'none' : 'flex';
      toggleBtn.classList.toggle('active', !v);
    });
    window.addEventListener('keydown', (e) => {
      if ((e.key === 't' || e.key === 'T') && !e.ctrlKey && !this.isTextInputTarget(e.target)) {
        toggleBtn.click();
      }
    });
  }

  private applyFilter(): void {
    this.planets.forEach((planet, fileId) => {
      const file = this.data?.files[fileId];
      if (!file) {
        return;
      }
      planet.visible = this.visibleTypes.has(file.extension.toLowerCase());
      const s = planet.visible ? planet.scale : 0.0001;
      this.updateInstance(planet.instanceIndex, planet.position, s, planet.color);
    });
    if (this.planetInstanceMesh) {
      this.planetInstanceMesh.instanceMatrix.needsUpdate = true;
    }
    this.lines.forEach((depLine) => {
      const sourceVisible = this.planets.get(depLine.dependency.sourceId)?.visible ?? false;
      const targetVisible = this.planets.get(depLine.dependency.targetId)?.visible ?? false;
      depLine.line.visible = sourceVisible && targetVisible;
    });
  }

  private applyGitVisuals(): void {
    // Always apply subtle visual encoding even without git data.
    // With git: uses real heat scores. Without git: uses file size as a proxy.
    // This means planets are never all the same color regardless of git availability.

    const fileInfo = this.gitData?.available ? this.gitData.fileInfo : null;
    const maxCommits = fileInfo
      ? Math.max(1, ...Object.values(fileInfo).map((f) => f.commitCount))
      : 1;

    // For size-based fallback when git is unavailable
    const allSizes = Array.from(this.planets.values()).map((p) => p.file.size);
    const maxSize = Math.max(1, ...allSizes);

    this.planets.forEach((planet, fileId) => {
      const cleanId = fileId.includes(':') ? fileId.split(':').slice(1).join(':') : fileId;
      const info = fileInfo ? fileInfo[fileId] || fileInfo[cleanId] : null;

      // Scale: git churn boost on top of baseScale
      if (info && info.commitCount > 0) {
        const churnBoost = (info.commitCount / maxCommits) * 0.5;
        planet.scale = planet.baseScale * (1 + churnBoost);
      } else {
        planet.scale = planet.baseScale;
      }

      let color = new THREE.Color(planet.color);

      if (info && this.settings.showGitHeatmap) {
        // Full heatmap mode — replaces file type color entirely with thermal spectrum
        if (info.heat < 0.5) {
          color.setHSL(0.6 - info.heat * 0.8, 1, 0.5);
        } else {
          color.setHSL(0.2 - (info.heat - 0.5) * 0.4, 1, 0.5);
        }
      } else if (info) {
        // Subtle always-on tint — preserves file type color, adds warmth/coolness
        // Recently touched → slightly brighter/warmer (toward white)
        // Ancient / untouched → slightly dimmer (cooler)
        // This gives the cosmos texture without requiring heatmap toggle
        if (info.daysSinceLastChange <= 7) {
          const factor = 1 - info.daysSinceLastChange / 7;
          color.lerp(new THREE.Color(0xffffff), factor * 0.4);
        } else if (info.daysSinceLastChange > 90) {
          color.multiplyScalar(0.65);
        }
      } else {
        // No git data — use file size as a subtle proxy for importance.
        // Larger files get a gentle brightness boost so they naturally stand out.
        const sizeFactor = planet.file.size / maxSize; // 0..1
        if (sizeFactor > 0.5) {
          color.lerp(new THREE.Color(0xffffff), (sizeFactor - 0.5) * 0.25);
        } else if (sizeFactor < 0.1) {
          color.multiplyScalar(0.75); // tiny files are slightly dimmer
        }
      }

      this.updateInstance(
        planet.instanceIndex,
        planet.position,
        planet.visible ? planet.scale : 0.0001,
        color.getHex()
      );

      if (info?.hasUncommittedChanges) {
        this.addUncommittedRing(fileId, planet.position, planet.scale);
      }
    });

    if (this.planetInstanceMesh) {
      this.planetInstanceMesh.instanceMatrix.needsUpdate = true;
      if (this.planetInstanceMesh.instanceColor) {
        this.planetInstanceMesh.instanceColor.needsUpdate = true;
      }
    }
  }

  private addCompressionRing(fileId: string, position: THREE.Vector3, planetScale: number): void {
    if (this.compressionRings.has(fileId)) {
      return;
    }
    // A thin pulsing band — distinct from uncommitted ring (orange).
    // Cyan color signals "this planet is rendered smaller than its true size."
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(planetScale * 2.4, planetScale * 2.7, 32),
      new THREE.MeshBasicMaterial({
        color: 0x00e5ff,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
      })
    );
    ring.position.copy(position);
    this.compressionRings.set(fileId, ring);
    this.scene.add(ring);
  }

  private addUncommittedRing(fileId: string, position: THREE.Vector3, planetScale: number): void {
    if (this.uncommittedRings.has(fileId)) {
      return;
    }
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.2 * planetScale, 2.8 * planetScale, 16),
      new THREE.MeshBasicMaterial({
        color: 0xff8c00,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
      })
    );
    ring.position.copy(position);
    this.uncommittedRings.set(fileId, ring);
    this.scene.add(ring);
  }

  private initExitFocusButton(): void {
    const btn = document.getElementById('exit-focus-btn');
    if (!btn) {
      return;
    }
    btn.addEventListener('click', () => {
      this.exitFocusMode();
      this.exitStarFocusMode();
    });
  }

  private initMinimap(): void {
    const container = document.getElementById('minimap-container');
    const canvas = document.getElementById('minimap-canvas') as HTMLCanvasElement;
    const btn = document.getElementById('minimap-btn');
    if (!canvas || !btn) {
      return;
    }
    this.minimapCanvas = canvas;
    this.minimapCtx = canvas.getContext('2d');
    btn.addEventListener('click', () => {
      this.minimapVisible = !this.minimapVisible;
      if (container) {
        container.style.display = this.minimapVisible ? 'block' : 'none';
      }
      btn.classList.toggle('active', this.minimapVisible);
    });
    canvas.addEventListener('click', (e) => {
      if (!this.minimapCtx) {
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const worldX = ((e.clientX - rect.left) / canvas.width - 0.5) * this.MINIMAP_WORLD_SIZE * 2;
      const worldZ = ((e.clientY - rect.top) / canvas.width - 0.5) * this.MINIMAP_WORLD_SIZE * 2;
      const target = new THREE.Vector3(worldX, 0, worldZ);
      const startPos = this.camera.position.clone();
      const startTarget = this.controls.target.clone();
      const endPos = new THREE.Vector3(worldX, this.camera.position.y, worldZ);
      let progress = 0;
      const fly = () => {
        if (progress >= 30) {
          this.controls.target.copy(target);
          this.controls.update();
          return;
        }
        progress++;
        const t = progress / 30;
        const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
        this.camera.position.lerpVectors(startPos, endPos, eased);
        this.controls.target.lerpVectors(startTarget, target, eased);
        this.controls.update();
        requestAnimationFrame(fly);
      };
      fly();
    });
    window.addEventListener('keydown', (e) => {
      if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !this.isTextInputTarget(e.target)) {
        btn.click();
      }
    });
  }

  private updateGitHud(): void {
    const branchEl = document.getElementById('git-branch');
    const repoEl = document.getElementById('repo-name');
    const hudEl = document.getElementById('git-hud');
    if (!hudEl) {
      return;
    }

    // Derive repo name from the workspace root keys in CosmosData.
    // workspaceRoots is a Record<name, path> — we take the first key as the
    // display name. Falls back to "Repository" if unavailable.
    const repoName = this.data
      ? (Object.keys(this.data.workspaceRoots)[0] ?? 'Repository')
      : 'Repository';

    if (repoEl) {
      repoEl.textContent = repoName;
    }

    if (this.gitData?.available && branchEl) {
      branchEl.textContent = this.gitData.branch;
      hudEl.style.display = 'flex';
    } else if (branchEl) {
      // Show repo name even when git isn't available
      branchEl.textContent = 'no git';
      hudEl.style.display = 'flex';
    }
  }

  private populateFilterBar(data: CosmosData): void {
    const container = document.getElementById('filter-buttons');
    if (!container) {
      return;
    }
    container.innerHTML = '';

    const extensions = new Set<string>();
    Object.values(data.files).forEach((f) => extensions.add(f.extension.toLowerCase()));
    const sorted = Array.from(extensions).sort();

    sorted.forEach((ext) => {
      this.visibleTypes.add(ext);
      const btn = document.createElement('button');
      btn.className = 'glass-panel active';
      btn.style.padding = '8px 12px';
      btn.style.fontSize = '11px';
      btn.style.color = 'white';
      btn.style.cursor = 'pointer';
      btn.style.textAlign = 'left';
      btn.style.transition = 'all 0.2s ease';
      btn.style.display = 'flex';
      btn.style.justifyContent = 'space-between';
      btn.style.alignItems = 'center';
      btn.style.border = '1px solid var(--glass-border)';

      const color = (FILE_TYPE_COLORS as Record<string, number>)[ext] || 0x455a64;
      const hexColor = `#${color.toString(16).padStart(6, '0')}`;

      btn.innerHTML = `<span>.${ext}</span><span style="width:8px;height:8px;border-radius:50%;background:${hexColor};"></span>`;

      btn.addEventListener('click', () => {
        if (this.visibleTypes.has(ext)) {
          this.visibleTypes.delete(ext);
          btn.classList.remove('active');
          btn.style.opacity = '0.4';
        } else {
          this.visibleTypes.add(ext);
          btn.classList.add('active');
          btn.style.opacity = '1';
        }
        this.applyFilter();
      });
      container.appendChild(btn);
    });

    document.getElementById('filter-all')?.addEventListener('click', () => {
      sorted.forEach((ext) => this.visibleTypes.add(ext));
      container.querySelectorAll('button').forEach((b: any) => {
        b.classList.add('active');
        b.style.opacity = '1';
      });
      this.applyFilter();
    });

    document.getElementById('filter-none')?.addEventListener('click', () => {
      this.visibleTypes.clear();
      container.querySelectorAll('button').forEach((b: any) => {
        b.classList.remove('active');
        b.style.opacity = '0.4';
      });
      this.applyFilter();
    });
  }

  private drawMinimap(): void {
    if (!this.minimapVisible || !this.minimapCtx || !this.minimapCanvas) {
      return;
    }
    const ctx = this.minimapCtx;
    const size = this.minimapCanvas.width;
    const half = size / 2;
    const worldHalf = this.MINIMAP_WORLD_SIZE;
    const toMinimap = (x: number, z: number): [number, number] => [
      (x / worldHalf) * half + half,
      (z / worldHalf) * half + half,
    ];
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(0, 0, size, size);
    this.stars.forEach((star) => {
      const [px, py] = toMinimap(star.mesh.position.x, star.mesh.position.z);
      if (px >= 0 && px <= size && py >= 0 && py <= size) {
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 244, 180, 0.8)';
        ctx.fill();
      }
    });
    this.planets.forEach((planet) => {
      if (!planet.visible) {
        return;
      }
      const [px, py] = toMinimap(planet.position.x, planet.position.z);
      if (px >= 0 && px <= size && py >= 0 && py <= size) {
        const c = new THREE.Color(planet.color);
        ctx.beginPath();
        ctx.arc(px, py, 1.2, 0, Math.PI * 2);
        ctx.fillStyle = `rgb(${Math.floor(c.r * 255)},${Math.floor(c.g * 255)},${Math.floor(c.b * 255)})`;
        ctx.fill();
      }
    });
    const [cx, cy] = toMinimap(0, 0);
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffaa00';
    ctx.fill();
    const [campx, campy] = toMinimap(this.camera.position.x, this.camera.position.z);
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    const angle = Math.atan2(direction.z, direction.x);
    const fov = (this.camera.fov * Math.PI) / 180 / 2;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.beginPath();
    ctx.moveTo(campx, campy);
    ctx.arc(campx, campy, 20, angle - fov, angle + fov);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(campx - 5, campy);
    ctx.lineTo(campx + 5, campy);
    ctx.moveTo(campx, campy - 5);
    ctx.lineTo(campx, campy + 5);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(campx, campy, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = 'white';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, size, size);
  }
}
