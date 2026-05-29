// webview/universe/Universe.ts

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Star } from './Star';
import { Planet } from './Planet';
import { DependencyLine } from './DependencyLine';
import { sendToExtension } from '../bridge/messageBridge';
import {
  CosmosFolder,
  CosmosDependency,
  DependencyLayer,
  DependencyType,
  CosmosData,
  StarNode, SettingsState, DEFAULT_SETTINGS
} from '../../src/types';

const PRESETS = {
  clean: {
    showDirectLines: true, showIndirectLines: false,
    showLayer3Lines: false, showCircularLines: true,
    enableAnimation: false, orbitalSpeed: 1.0,
    showFolderLabels: true, showProximityLabels: true,
    showBackgroundStars: true, enableFog: true, showLegend: true,
  },
  full: {
    showDirectLines: true, showIndirectLines: true,
    showLayer3Lines: true, showCircularLines: true,
    enableAnimation: true, orbitalSpeed: 1.0,
    showFolderLabels: true, showProximityLabels: true,
    showBackgroundStars: true, enableFog: true, showLegend: true,
  },
  performance: {
    showDirectLines: true, showIndirectLines: false,
    showLayer3Lines: false, showCircularLines: true,
    enableAnimation: false, orbitalSpeed: 1.0,
    showFolderLabels: false, showProximityLabels: false,
    showBackgroundStars: false, enableFog: false, showLegend: true,
  },
};

export class Universe {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private stars: Map<string, Star> = new Map();
  private planets: Map<string, Planet> = new Map();
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
  private orbitalData: Map<string, {
    starPosition: THREE.Vector3;
    angle: number;
    inclination: number;
    speed: number;
    radius: number;
  }> = new Map();
  private starLabels: THREE.Sprite[] = [];
  private planetLabels: Map<string, THREE.Sprite> = new Map();
  private readonly LABEL_SHOW_DISTANCE = 150;
  private lastMouseMoveTime = 0;
  private settings: SettingsState = { ...DEFAULT_SETTINGS };
  private backgroundStars: THREE.Points | null = null;
  private focusedStarId: string | null = null;
  private visibleTypes: Set<string> = new Set(); // populated dynamically from repo data


  constructor(canvas: HTMLCanvasElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.scene.fog = new THREE.FogExp2(0x000000, 0.00006);

    this.camera = new THREE.PerspectiveCamera(
      75,
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      15000
    );
    this.camera.position.z = 1200;
    this.defaultCameraPosition = this.camera.position.clone();

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    this.scene.add(ambientLight);

    const pointLight = new THREE.PointLight(0xffffff, 1, 8000);
    pointLight.position.set(0, 0, 0);
    this.scene.add(pointLight);

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
    canvas.addEventListener('mouseleave', () => {
      const tooltip = document.getElementById('tooltip')!;
      tooltip.style.display = 'none';
    });

    window.addEventListener('resize', () => this.onResize(canvas));
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { this.exitFocusMode(); }
    });
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
    this.initRefreshButton();
    this.initFilterBar();
    this.initSettingsPanel();
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
      const materialWithMap = material as THREE.Material & { map?: THREE.Texture | null };
      if (materialWithMap.map) {
        materialWithMap.map.dispose();
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
    return target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable);
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
    return relativePath.endsWith(fileName)
      ? relativePath.slice(0, -fileName.length)
      : relativePath;
  }

  public build(data: CosmosData): void {
    this.data = data;
    this.dependencies = data.dependencies;
    this.focusedFileId = null;

    // Clear everything
    this.stars.forEach(star => {
      this.disposeSceneObject(star.mesh);
      this.disposeSceneObject(star.light);
    });
    this.planets.forEach(planet => this.disposeSceneObject(planet.mesh));
    this.starLabels.forEach(label => this.disposeSceneObject(label));
    this.lines.forEach(line => this.disposeSceneObject(line.line));
    this.planetLabels.forEach(label => this.disposeSceneObject(label));
    this.centralObjects.forEach(object => this.disposeSceneObject(object));

    this.stars.clear();
    this.planets.clear();
    this.orbitalData.clear();
    this.starLabels = [];
    this.lines = [];
    this.planetLabels.clear();
    this.centralObjects = [];
    this.centralCore = null;

    const rootFolder = data.folders[data.rootFolderId];
    this.addCentralBody(rootFolder);

    // Walk the star tree recursively
    if (data.starTree) {
      data.starTree.childNodes.forEach(node => {
        this.buildFromNode(node, data);
      });
    }

    // Root files orbit the central sun directly
    if (rootFolder) {
      rootFolder.fileIds.forEach((fileId, planetIndex) => {
        const file = data.files[fileId];
        if (!file) { return; }

        const { position, angle, inclination } = this.orbitalPosition(
          new THREE.Vector3(0, 0, 0),
          planetIndex,
          rootFolder.fileIds.length,
          80
        );

        const planet = new Planet(file, position);
        this.planets.set(fileId, planet);
        this.scene.add(planet.mesh);

        this.orbitalData.set(fileId, {
          starPosition: new THREE.Vector3(0, 0, 0),
          angle,
          inclination,
          speed: 0.0003 + Math.random() * 0.0001,
          radius: 80,
        });
      });
    }

    this.drawDependencies(data.dependencies);
    this.populateFilterBar(data);
  }

  // Build filter buttons dynamically from file types actually present in repo
  private populateFilterBar(data: CosmosData): void {
    const container = document.getElementById('filter-buttons');
    if (!container) { return; }

    // Collect all unique extensions present in this repo
    const typeInfo: Map<string, { color: string; label: string; count: number }> = new Map([
      ['ts', { color: '#00D2FF', label: 'TypeScript', count: 0 }],
      ['tsx', { color: '#00D2FF', label: 'TSX', count: 0 }],
      ['js', { color: '#FFD700', label: 'JavaScript', count: 0 }],
      ['jsx', { color: '#FFD700', label: 'JSX', count: 0 }],
      ['mjs', { color: '#FFD700', label: 'MJS', count: 0 }],
      ['html', { color: '#00E676', label: 'HTML', count: 0 }],
      ['css', { color: '#E040FB', label: 'CSS', count: 0 }],
      ['scss', { color: '#E040FB', label: 'SCSS', count: 0 }],
      ['sass', { color: '#E040FB', label: 'Sass', count: 0 }],
      ['py', { color: '#FF6D00', label: 'Python', count: 0 }],
      ['java', { color: '#FF3D00', label: 'Java', count: 0 }],
      ['json', { color: '#B0BEC5', label: 'JSON', count: 0 }],
      ['md', { color: '#78909C', label: 'Markdown', count: 0 }],
      ['svg', { color: '#90A4AE', label: 'SVG', count: 0 }],
      ['png', { color: '#90A4AE', label: 'Images', count: 0 }],
      ['jpg', { color: '#90A4AE', label: 'Images', count: 0 }],
      ['jpeg', { color: '#90A4AE', label: 'Images', count: 0 }],
      ['gif', { color: '#90A4AE', label: 'Images', count: 0 }],
      ['webp', { color: '#90A4AE', label: 'Images', count: 0 }],
      ['ico', { color: '#90A4AE', label: 'Icon', count: 0 }],
      ['woff', { color: '#607D8B', label: 'Font', count: 0 }],
      ['woff2', { color: '#607D8B', label: 'Font', count: 0 }],
      ['ttf', { color: '#607D8B', label: 'Font', count: 0 }],
    ]);

    // Count each extension
    const presentTypes = new Map<string, { color: string; label: string; count: number }>();
    Object.values(data.files).forEach(file => {
      const ext = file.extension.toLowerCase();
      if (typeInfo.has(ext)) {
        const info = typeInfo.get(ext)!;
        if (!presentTypes.has(ext)) {
          presentTypes.set(ext, { ...info });
        }
        presentTypes.get(ext)!.count++;
      } else if (ext) {
        // Unknown extension — show it anyway
        if (!presentTypes.has(ext)) {
          presentTypes.set(ext, { color: '#455A64', label: ext.toUpperCase(), count: 0 });
        }
        presentTypes.get(ext)!.count++;
      }
    });

    // Sort by count descending
    const sorted = [...presentTypes.entries()].sort((a, b) => b[1].count - a[1].count);

    // Initialize visibleTypes with all present types
    this.visibleTypes = new Set(sorted.map(([ext]) => ext));

    // Rebuild filter buttons
    container.innerHTML = '';
    sorted.forEach(([ext, info]) => {
      const btn = document.createElement('button');
      btn.className = 'filter-btn';
      btn.dataset.type = ext;
      btn.style.cssText = `
        display:flex;align-items:center;gap:8px;
        background:rgba(255,255,255,0.15);
        border:1px solid rgba(255,255,255,0.2);
        color:white;padding:4px 10px;border-radius:4px;
        cursor:pointer;font-size:11px;text-align:left;width:100%;
        opacity:1;
      `;
      btn.innerHTML = `<span style="color:${info.color}">⬤</span> ${info.label} <span style="opacity:0.5;margin-left:auto">${info.count}</span>`;

      btn.addEventListener('click', () => {
        const isActive = this.visibleTypes.has(ext);
        if (isActive) {
          this.visibleTypes.delete(ext);
          btn.style.background = 'rgba(255,255,255,0.03)';
          btn.style.opacity = '0.4';
        } else {
          this.visibleTypes.add(ext);
          btn.style.background = 'rgba(255,255,255,0.15)';
          btn.style.opacity = '1';
        }
        this.applyFilter();
      });

      container.appendChild(btn);
    });

    // Wire All / None buttons
    const allBtn = document.getElementById('filter-all');
    const noneBtn = document.getElementById('filter-none');

    if (allBtn) {
      allBtn.onclick = () => {
        sorted.forEach(([ext]) => this.visibleTypes.add(ext));
        container.querySelectorAll('.filter-btn').forEach(b => {
          (b as HTMLElement).style.background = 'rgba(255,255,255,0.15)';
          (b as HTMLElement).style.opacity = '1';
        });
        this.applyFilter();
      };
    }
    if (noneBtn) {
      noneBtn.onclick = () => {
        this.visibleTypes.clear();
        container.querySelectorAll('.filter-btn').forEach(b => {
          (b as HTMLElement).style.background = 'rgba(255,255,255,0.03)';
          (b as HTMLElement).style.opacity = '0.4';
        });
        this.applyFilter();
      };
    }
  }

  private buildFromNode(node: StarNode, data: CosmosData): void {
    const folder = data.folders[node.folderId];
    if (!folder) { return; }
    if (folder.fileIds.length === 0 && folder.childFolderIds.length === 0) { return; }

    const starPosition = new THREE.Vector3(
      node.position.x,
      node.position.y,
      node.position.z
    );

    const star = new Star(folder, starPosition, node.subtreeFileCount);
    star.mesh.userData = {
      type: 'star',
      id: node.folderId,
      name: folder.name,
      subtreeFileCount: node.subtreeFileCount
    };
    this.stars.set(node.folderId, star);
    this.scene.add(star.light);
    this.scene.add(star.mesh);

    // Label scale shrinks with depth
    const labelScale = Math.max(40, 120 - node.depth * 15);
    const labelYOffset = Math.max(12, 25 - node.depth * 3);
    const labelPosition = starPosition.clone();
    labelPosition.y += labelYOffset;
    const label = this.createStarLabel(folder.name, labelPosition, labelScale);
    this.starLabels.push(label);
    this.scene.add(label);

    // Files orbit their star in 3D (spherical distribution — close to star)
    // Orbital radius: leaf folders get small radius, deeper = tighter
    const orbitalRadius = Math.max(20, 70 - node.depth * 10);

    folder.fileIds.forEach((fileId, planetIndex) => {
      const file = data.files[fileId];
      if (!file) { return; }

      const { position, angle, inclination } = this.orbitalPosition(
        starPosition,
        planetIndex,
        folder.fileIds.length,
        orbitalRadius
      );

      const planet = new Planet(file, position);
      this.planets.set(fileId, planet);
      this.scene.add(planet.mesh);

      this.orbitalData.set(fileId, {
        starPosition: starPosition.clone(),
        angle,
        inclination,
        speed: 0.0002 + Math.random() * 0.0001,
        radius: orbitalRadius,
      });
    });

    // Recurse into child folders (they orbit this star in 2D — handled by starTree positions)
    node.childNodes.forEach(childNode => {
      this.buildFromNode(childNode, data);
    });
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
    this.camera.aspect = canvas.clientWidth / canvas.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  }

  private drawDependencies(dependencies: CosmosDependency[]): void {
    const MAX_LINES = 2000;
    let lineCount = 0;

    // Draw in priority order: circular first, then direct, indirect, layer3
    const ordered = [...dependencies].sort((a, b) => {
      const priority = (l: DependencyLayer) => {
        switch (l) {
          case DependencyLayer.CIRCULAR: return 0;
          case DependencyLayer.DIRECT: return 1;
          case DependencyLayer.INDIRECT: return 2;
          default: return 3;
        }
      };
      return priority(a.layer) - priority(b.layer);
    });

    ordered.forEach(dep => {
      if (lineCount >= MAX_LINES) { return; }

      const sourcePlanet = this.planets.get(dep.sourceId);
      const targetPlanet = this.planets.get(dep.targetId);
      if (!sourcePlanet || !targetPlanet) { return; }

      // Skip layer3 on large repos for performance
      if (
        this.planets.size > 300 &&
        (dep.layer === DependencyLayer.LAYER3_SHARED_DEPENDENT ||
          dep.layer === DependencyLayer.LAYER3_SHARED_DEPENDENCY)
      ) { return; }

      const line = new DependencyLine(dep, sourcePlanet.mesh.position, targetPlanet.mesh.position);
      this.lines.push(line);
      this.scene.add(line.line);
      lineCount++;
    });
  }

  private onClick(event: MouseEvent, canvas: HTMLCanvasElement): void {
    if (this.spacecraftMode) { return; }

    const rect = canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Check planets first
    const planetMeshes = Array.from(this.planets.values()).map(p => p.mesh);
    const planetIntersects = this.raycaster.intersectObjects(planetMeshes);

    if (planetIntersects.length > 0) {
      const clicked = planetIntersects[0].object;
      const fileId = clicked.userData.id as string;

      // Exit star focus first if active
      if (this.focusedStarId) { this.exitStarFocusMode(); }

      if (this.focusedFileId === fileId) {
        this.exitFocusMode();
      } else {
        this.enterFocusMode(fileId);
        sendToExtension({ type: 'OPEN_FILE', payload: { fileId } });
      }
      return;
    }

    // Check stars
    const starMeshes = Array.from(this.stars.values()).map(s => s.mesh);
    const starIntersects = this.raycaster.intersectObjects(starMeshes);

    if (starIntersects.length > 0) {
      const clicked = starIntersects[0].object;
      const folderId = clicked.userData.id as string;

      // Exit planet focus first if active
      if (this.focusedFileId) { this.exitFocusMode(); }

      if (this.focusedStarId === folderId) {
        this.exitStarFocusMode();
      } else {
        this.enterStarFocusMode(folderId);
      }
      return;
    }

    // Clicked empty space — do nothing, focus persists until Escape or exit button
  }

  private onMouseMove(event: MouseEvent, canvas: HTMLCanvasElement): void {
    const now = Date.now();
    const rect = canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const tooltip = document.getElementById('tooltip')!;

    // Check planets and stars first — fast
    const allMeshes = [
      ...Array.from(this.planets.values()).map(p => p.mesh),
      ...Array.from(this.stars.values()).map(s => s.mesh),
    ];
    if (this.centralCore) { allMeshes.push(this.centralCore); }

    const meshIntersects = this.raycaster.intersectObjects(allMeshes);

    if (meshIntersects.length > 0) {
      const hovered = meshIntersects[0].object;

      if (hovered.userData.type === 'central') {
        const rootName = this.escapeHtml(String(hovered.userData.name));
        tooltip.style.display = 'block';
        tooltip.style.left = `${event.clientX + 15}px`;
        tooltip.style.top = `${event.clientY + 15}px`;
        tooltip.innerHTML = `
          <strong>⭐ ${rootName}</strong><br>
          Root Repository<br>
          ${Object.keys(this.data!.files).length} total files<br>
          ${Object.keys(this.data!.folders).length} total folders
        `;
        return;
      }

      if (hovered.userData.type === 'star') {
        const folderId = hovered.userData.id as string;
        const folder = this.data!.folders[folderId];
        if (!folder) { return; }

        const folderFileIds = new Set(folder.fileIds);
        const outgoing = this.dependencies.filter(
          d => folderFileIds.has(d.sourceId) && d.layer === DependencyLayer.DIRECT
        ).length;
        const incoming = this.dependencies.filter(
          d => folderFileIds.has(d.targetId) && d.layer === DependencyLayer.DIRECT
        ).length;
        const hasCircular = this.dependencies.some(
          d => d.layer === DependencyLayer.CIRCULAR &&
            (folderFileIds.has(d.sourceId) || folderFileIds.has(d.targetId))
        );

        tooltip.style.display = 'block';
        tooltip.style.left = `${event.clientX + 15}px`;
        tooltip.style.top = `${event.clientY + 15}px`;
        tooltip.innerHTML = `
          <strong>📁 ${this.escapeHtml(folder.name)}</strong><br>
          Files: ${folder.fileIds.length}<br>
          Subfolders: ${folder.childFolderIds.length}<br>
          <span style="color:#ffffff">⬤</span> Out: ${outgoing} / In: ${incoming}<br>
          ${hasCircular ? '<span style="color:#FF1744">⬤ Circular dependency inside</span>' : ''}
        `;
        return;
      }

      // Planet hover
      const hoveredFileId = hovered.userData.id as string;
      const file = this.data?.files[hoveredFileId];
      if (!file) { return; }

      const dependsOn = this.dependencies.filter(
        d => d.sourceId === hoveredFileId && d.layer === DependencyLayer.DIRECT
      ).length;
      const dependedBy = this.dependencies.filter(
        d => d.targetId === hoveredFileId && d.layer === DependencyLayer.DIRECT
      ).length;
      const indirectCount = this.dependencies.filter(
        d => (d.sourceId === hoveredFileId || d.targetId === hoveredFileId)
          && d.layer === DependencyLayer.INDIRECT
      ).length;
      const isCircular = this.dependencies.some(
        d => d.layer === DependencyLayer.CIRCULAR &&
          (d.sourceId === hoveredFileId || d.targetId === hoveredFileId)
      );
      const sharedDependentCount = this.dependencies.filter(
        d => (d.sourceId === hoveredFileId || d.targetId === hoveredFileId)
          && d.layer === DependencyLayer.LAYER3_SHARED_DEPENDENT
      ).length;
      const sharedDependencyCount = this.dependencies.filter(
        d => (d.sourceId === hoveredFileId || d.targetId === hoveredFileId)
          && d.layer === DependencyLayer.LAYER3_SHARED_DEPENDENCY
      ).length;

      tooltip.style.display = 'block';
      tooltip.style.left = `${event.clientX + 15}px`;
      tooltip.style.top = `${event.clientY + 15}px`;
      tooltip.innerHTML = `
        <strong>${this.escapeHtml(file.name)}</strong><br>
        Type: ${this.escapeHtml(file.extension.toUpperCase())}<br>
        <span style="color:#ffffff">⬤</span> Direct: ${dependsOn} out / ${dependedBy} in<br>
        <span style="color:#4488ff">⬤</span> Indirect: ${indirectCount}<br>
        <span style="color:#FFB300">⬤</span> Shared dependent: ${sharedDependentCount}<br>
        <span style="color:#00BCD4">⬤</span> Shared dependency: ${sharedDependencyCount}<br>
        ${isCircular ? '<span style="color:#FF1744">⬤ Circular dependency</span><br>' : ''}
      `;
      return;
    }

    // Throttle line raycasting to 50ms
    if (now - this.lastMouseMoveTime < 50) {
      tooltip.style.display = 'none';
      return;
    }
    this.lastMouseMoveTime = now;

    const lineMeshes = this.lines.map(l => l.line);
    const lineIntersects = this.raycaster.intersectObjects(lineMeshes);

    if (lineIntersects.length > 0) {
      const hitLine = lineIntersects[0].object;
      const depLine = this.lines.find(l => l.line === hitLine);
      if (!depLine) { tooltip.style.display = 'none'; return; }

      const sourceFile = this.data?.files[depLine.dependency.sourceId];
      const targetFile = this.data?.files[depLine.dependency.targetId];
      if (!sourceFile || !targetFile) { tooltip.style.display = 'none'; return; }

      const layerInfo = this.getLayerInfo(depLine.dependency.layer);

      tooltip.style.display = 'block';
      tooltip.style.left = `${event.clientX + 15}px`;
      tooltip.style.top = `${event.clientY + 15}px`;
      tooltip.innerHTML = `
        <span style="color:${layerInfo.color}">⬤ ${this.escapeHtml(layerInfo.label)}</span><br>
        <strong>From:</strong> ${this.escapeHtml(sourceFile.name)}<br>
        <span style="opacity:0.5;font-size:10px">${this.escapeHtml(sourceFile.relativePath)}</span><br>
        <strong>To:</strong> ${this.escapeHtml(targetFile.name)}<br>
        <span style="opacity:0.5;font-size:10px">${this.escapeHtml(targetFile.relativePath)}</span>
      `;
    } else {
      tooltip.style.display = 'none';
    }
  }

  private getLayerInfo(layer: DependencyLayer): { label: string; color: string } {
    switch (layer) {
      case DependencyLayer.DIRECT: return { label: 'Direct import', color: '#ffffff' };
      case DependencyLayer.INDIRECT: return { label: 'Indirect chain', color: '#4488ff' };
      case DependencyLayer.CIRCULAR: return { label: 'Circular dependency', color: '#FF1744' };
      case DependencyLayer.LAYER3_SHARED_DEPENDENT: return { label: 'Shared dependent', color: '#FFB300' };
      case DependencyLayer.LAYER3_SHARED_DEPENDENCY: return { label: 'Shared dependency', color: '#00BCD4' };
      default: return { label: 'Unknown', color: '#ffffff' };
    }
  }

  private enterFocusMode(fileId: string): void {
    this.focusedFileId = fileId;

    const connectedIds = new Set<string>();
    connectedIds.add(fileId);

    this.dependencies.forEach(dep => {
      if (dep.sourceId === fileId) { connectedIds.add(dep.targetId); }
      if (dep.targetId === fileId) { connectedIds.add(dep.sourceId); }
    });

    this.planets.forEach((planet, id) => {
      const material = planet.mesh.material as THREE.MeshStandardMaterial;
      if (connectedIds.has(id)) {
        material.opacity = 1;
        material.transparent = false;
      } else {
        material.opacity = 0.05;
        material.transparent = true;
      }
    });

    this.stars.forEach(star => {
      const material = star.mesh.material as THREE.MeshStandardMaterial;
      material.opacity = 0.05;
      material.transparent = true;
    });

    this.starLabels.forEach(label => {
      (label.material as THREE.SpriteMaterial).opacity = 0.05;
    });

    this.lines.forEach(depLine => {
      const isConnected =
        depLine.dependency.sourceId === fileId ||
        depLine.dependency.targetId === fileId;
      // Use visible=false so lines truly disappear — not opacity (which turns black with vertexColors)
      depLine.line.visible = isConnected;
      const material = depLine.line.material as THREE.LineBasicMaterial;
      if (isConnected) { material.opacity = 0.9; }
    });
  }

  private exitFocusMode(): void {
    this.focusedFileId = null;

    this.planets.forEach(planet => {
      const material = planet.mesh.material as THREE.MeshStandardMaterial;
      material.opacity = 1;
      material.transparent = false;
    });

    this.stars.forEach(star => {
      const material = star.mesh.material as THREE.MeshStandardMaterial;
      material.opacity = 1;
      material.transparent = false;
    });

    this.starLabels.forEach(label => {
      (label.material as THREE.SpriteMaterial).opacity = 1;
    });

    this.lines.forEach(depLine => {
      const material = depLine.line.material as THREE.LineBasicMaterial;
      material.opacity = depLine.baseOpacity;
      material.transparent = true;
    });
    // Re-apply settings — this correctly restores line visibility per user settings
    // This handles both "show/hide by layer" toggles AND the exit from focus mode
    this.applySettingsToScene();
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
        const isVisible = container.style.display === 'block';
        container.style.display = isVisible ? 'none' : 'block';
        if (!isVisible) {
          input.value = '';
          results.style.display = 'none';
          input.focus();
        }
      }

      if (e.key === 'Escape') {
        container.style.display = 'none';
        const sp = document.getElementById('shortcuts-panel');
        if (sp) { sp.style.display = 'none'; }
        this.exitFocusMode();
      }

      if (e.key === 'r' || e.key === 'R') { this.resetCamera(); }

      if (e.key === '?') {
        const panel = document.getElementById('shortcuts-panel')!;
        panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
      }

      if (e.key === 's' || e.key === 'S') {
        if (!e.ctrlKey) {
          const sp = document.getElementById('settings-panel')!;
          sp.style.display = sp.style.display === 'block' ? 'none' : 'block';
        }
      }

      if ((e.ctrlKey && (e.key === 'u' || e.key === 'U')) || e.key === 'F5') {
        e.preventDefault();
        sendToExtension({ type: 'REFRESH' });
      }
    });

    input.addEventListener('input', () => {
      const query = input.value.trim().toLowerCase();
      if (!query || !this.data) { results.style.display = 'none'; return; }

      const matches = Object.values(this.data.files)
        .filter(f => f.name.toLowerCase().includes(query))
        .slice(0, 8);

      if (matches.length === 0) { results.style.display = 'none'; return; }

      results.style.display = 'block';
      results.innerHTML = matches.map(f => {
        const directoryLabel = this.getDirectoryLabel(f.relativePath, f.name);
        return `
          <div class="search-result" data-id="${this.escapeHtml(f.id)}" style="
            padding: 8px 14px; color: white; font-family: sans-serif;
            font-size: 12px; cursor: pointer;
            border-bottom: 1px solid rgba(255,255,255,0.05);
          ">
            <span style="opacity:0.5">${this.escapeHtml(directoryLabel)}</span>${this.escapeHtml(f.name)}
          </div>
        `;
      }).join('');

      results.querySelectorAll('.search-result').forEach(el => {
        el.addEventListener('click', () => {
          const fileId = (el as HTMLElement).dataset.id!;
          this.flyToPlanet(fileId);
          container.style.display = 'none';
        });
        el.addEventListener('mouseenter', () => { (el as HTMLElement).style.background = 'rgba(255,255,255,0.1)'; });
        el.addEventListener('mouseleave', () => { (el as HTMLElement).style.background = 'transparent'; });
      });
    });
  }

  private flyToPlanet(fileId: string): void {
    const planet = this.planets.get(fileId);
    if (!planet) { return; }

    const target = planet.mesh.position.clone();
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
    if (!star) { return; }

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
    const button = document.getElementById('reset-camera')!;
    button.addEventListener('click', () => this.resetCamera());
    button.addEventListener('mouseenter', () => { button.style.background = 'rgba(255,255,255,0.1)'; });
    button.addEventListener('mouseleave', () => { button.style.background = 'rgba(0,0,0,0.85)'; });
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
    const geometry = new THREE.BufferGeometry();
    const count = 2000;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) {
      positions[i] = (Math.random() - 0.5) * 10000;
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xffffff, size: 1.5, transparent: true, opacity: 0.6,
    });
    const stars = new THREE.Points(geometry, material);
    this.backgroundStars = stars;
    this.scene.add(stars);
  }

  private addCentralBody(rootFolder: CosmosFolder | undefined): void {
    if (!rootFolder) {
      console.error('[Code Cosmos] Root folder not found');
      return;
    }

    const coreGeometry = new THREE.SphereGeometry(40, 32, 32);
    const coreMaterial = new THREE.MeshStandardMaterial({
      color: 0xfff5c0, emissive: 0xffaa00, emissiveIntensity: 0.8,
      transparent: true, opacity: 0.95,
    });
    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    core.userData = { type: 'central', name: rootFolder.name };
    this.centralCore = core;
    this.centralObjects.push(core);
    this.scene.add(core);

    const glowGeo = new THREE.SphereGeometry(55, 32, 32);
    const glowMat = new THREE.MeshStandardMaterial({
      color: 0xff8800, emissive: 0xff6600, emissiveIntensity: 0.4,
      transparent: true, opacity: 0.15, side: THREE.BackSide,
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    this.centralObjects.push(glow);
    this.scene.add(glow);

    const outerGeo = new THREE.SphereGeometry(75, 32, 32);
    const outerMat = new THREE.MeshStandardMaterial({
      color: 0xff4400, emissive: 0xff2200, emissiveIntensity: 0.2,
      transparent: true, opacity: 0.06, side: THREE.BackSide,
    });
    const outerGlow = new THREE.Mesh(outerGeo, outerMat);
    this.centralObjects.push(outerGlow);
    this.scene.add(outerGlow);

    const centralLight = new THREE.PointLight(0xffaa44, 2, 5000);
    centralLight.position.set(0, 0, 0);
    this.centralObjects.push(centralLight);
    this.scene.add(centralLight);

    const label = this.createStarLabel(`⭐ ${rootFolder.name}`, new THREE.Vector3(0, 60, 0), 140);
    this.starLabels.push(label);
    this.scene.add(label);
  }

  private createStarLabel(
    name: string,
    position: THREE.Vector3,
    scaleWidth: number = 120
  ): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 6;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
      map: texture, transparent: true, depthWrite: false, depthTest: false,
    });

    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.scale.set(scaleWidth, scaleWidth / 4, 1);
    sprite.userData = { type: 'label' };
    return sprite;
  }

  private initSpacecraftMode(): void {
    window.addEventListener('keydown', (e) => {
      if (this.isTextInputTarget(e.target)) {
        return;
      }

      this.keys[e.key.toLowerCase()] = true;
      if (e.key === 'f' && !e.ctrlKey) {
        this.spacecraftMode = !this.spacecraftMode;
        this.controls.enabled = !this.spacecraftMode;
        this.showModeIndicator(this.spacecraftMode);
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.key.toLowerCase()] = false;
    });

    this.renderer.domElement.addEventListener('click', () => {
      if (this.spacecraftMode) {
        this.renderer.domElement.requestPointerLock();
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.spacecraftMode) { return; }
      if (document.pointerLockElement !== this.renderer.domElement) { return; }

      const sensitivity = 0.001;
      this.yaw -= e.movementX * sensitivity;
      this.pitch -= e.movementY * sensitivity;
      this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));

      const quaternion = new THREE.Quaternion();
      const pitchQuat = new THREE.Quaternion();
      const yawQuat = new THREE.Quaternion();
      yawQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
      pitchQuat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.pitch);
      quaternion.multiplyQuaternions(yawQuat, pitchQuat);
      this.camera.quaternion.copy(quaternion);
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
    if (!this.spacecraftMode) { return; }

    const speed = this.keys['shift'] ? 50 : 3;
    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();

    this.camera.getWorldDirection(forward);
    right.crossVectors(forward, this.camera.up).normalize();
    up.copy(this.camera.up).normalize();

    if (this.keys['w']) { this.camera.position.addScaledVector(forward, speed); }
    if (this.keys['s']) { this.camera.position.addScaledVector(forward, -speed); }
    if (this.keys['a']) { this.camera.position.addScaledVector(right, -speed); }
    if (this.keys['d']) { this.camera.position.addScaledVector(right, speed); }
    if (this.keys['q']) { this.camera.position.addScaledVector(up, speed); }
    if (this.keys['e']) { this.camera.position.addScaledVector(up, -speed); }

    const target = this.camera.position.clone().add(forward.multiplyScalar(100));
    this.controls.target.copy(target);
  }

  private showModeIndicator(spacecraft: boolean): void {
    const indicator = document.getElementById('mode-indicator');
    if (!indicator) { return; }
    indicator.textContent = spacecraft
      ? '🚀 Spacecraft — WASD to fly, Click to capture mouse'
      : '🔭 Orbit Mode — F to switch';
    indicator.style.opacity = '1';
    setTimeout(() => { indicator.style.opacity = '0'; }, 2000);
  }

  private animate(): void {
    requestAnimationFrame(() => this.animate());

    // Pulse circular dependency lines
    const pulse = (Math.sin(Date.now() * 0.003) + 1) / 2; // 0 to 1
    this.lines.forEach(depLine => {
      if (depLine.dependency.layer === DependencyLayer.CIRCULAR) {
        const material = depLine.line.material as THREE.LineBasicMaterial;
        if (!this.focusedFileId && !this.focusedStarId) {
          material.opacity = 0.4 + pulse * 0.5; // pulses between 0.4 and 0.9
        }
      }
    });

    this.updateSpacecraft();

    if (!this.spacecraftMode) {
      this.controls.update();
    }

    // Orbital animation — only if enabled
    if (this.settings.enableAnimation) {

      if (this.centralCore) {
        this.centralCore.rotation.y += 0.0005;
        this.centralCore.rotation.x += 0.0002;
      }

      this.stars.forEach(star => {
        star.mesh.rotation.y += 0.0005;
      });

      this.orbitalData.forEach((orbital, fileId) => {
        const planet = this.planets.get(fileId);

        if (!planet) {
          return;
        }

        orbital.angle += orbital.speed * this.settings.orbitalSpeed;

        planet.mesh.position.x =
          orbital.starPosition.x +
          orbital.radius *
          Math.sin(orbital.inclination) *
          Math.cos(orbital.angle);

        planet.mesh.position.y =
          orbital.starPosition.y +
          orbital.radius *
          Math.cos(orbital.inclination);

        planet.mesh.position.z =
          orbital.starPosition.z +
          orbital.radius *
          Math.sin(orbital.inclination) *
          Math.sin(orbital.angle);

        planet.mesh.rotation.y += 0.002;
      });

      this.updateDependencyLines();
    }

    // Proximity labels — only if enabled
    if (this.settings.showProximityLabels) {
      this.updateProximityLabels();
    }

    this.renderer.render(this.scene, this.camera);
  }

  private updateDependencyLines(): void {
    this.lines.forEach(depLine => {
      const sourcePlanet = this.planets.get(depLine.dependency.sourceId);
      const targetPlanet = this.planets.get(depLine.dependency.targetId);
      if (!sourcePlanet || !targetPlanet) { return; }

      const positions = depLine.line.geometry.attributes.position;
      positions.setXYZ(0,
        sourcePlanet.mesh.position.x,
        sourcePlanet.mesh.position.y,
        sourcePlanet.mesh.position.z
      );
      positions.setXYZ(1,
        targetPlanet.mesh.position.x,
        targetPlanet.mesh.position.y,
        targetPlanet.mesh.position.z
      );
      positions.needsUpdate = true;
    });
  }

  private initHelpButton(): void {
    const button = document.getElementById('help-button')!;
    const panel = document.getElementById('shortcuts-panel')!;
    button.addEventListener('click', () => {
      panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
    });
    button.addEventListener('mouseenter', () => { button.style.background = 'rgba(255,255,255,0.1)'; });
    button.addEventListener('mouseleave', () => { button.style.background = 'rgba(0,0,0,0.85)'; });
  }

  private updateProximityLabels(): void {
    this.planets.forEach((planet, fileId) => {
      const distance = this.camera.position.distanceTo(planet.mesh.position);
      let label = this.planetLabels.get(fileId);

      if (distance < this.LABEL_SHOW_DISTANCE) {
        const file = this.data?.files[fileId];
        if (!file) { return; }

        if (!label) {
          label = this.createPlanetLabel(file.name);
          this.planetLabels.set(fileId, label);
          this.scene.add(label);
        }

        label.position.copy(planet.mesh.position);
        label.position.y += 8;
        const opacity = 1 - (distance / this.LABEL_SHOW_DISTANCE);
        (label.material as THREE.SpriteMaterial).opacity = opacity;
        label.visible = true;
      } else if (label) {
        label.visible = false;
      }
    });
  }

  private createPlanetLabel(name: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 48;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 8;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = '22px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
      map: texture, transparent: true, depthWrite: false, depthTest: false,
    });

    const sprite = new THREE.Sprite(material);
    sprite.scale.set(50, 12, 1);
    return sprite;
  }

  public applySettings(settings: SettingsState): void {
    this.settings = settings;
    // Sync checkboxes immediately so panel reflects saved state when opened
    this.syncPanelToSettings();
    // Apply to scene — if build() hasn't run yet, lines/stars are empty so this is a no-op
    // build() will call applySettingsToScene() again once objects exist
    this.applySettingsToScene();
  }

  private applySettingsToScene(): void {
    // Fog
    this.scene.fog = this.settings.enableFog
      ? new THREE.FogExp2(0x000000, 0.00006)
      : null;

    // Background stars
    if (this.backgroundStars) {
      this.backgroundStars.visible = this.settings.showBackgroundStars;
    }

    // Folder labels
    this.starLabels.forEach(label => {
      label.visible = this.settings.showFolderLabels;
    });

    // Legend
    const legend = document.getElementById('legend');
    if (legend) {
      legend.style.display = this.settings.showLegend ? 'block' : 'none';
    }

    // Dependency lines
    this.lines.forEach(depLine => {
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
  }

  private initSettingsPanel(): void {
    const panel = document.getElementById('settings-panel')!;
    const btn = document.getElementById('settings-btn')!;

    // Toggle panel
    btn.addEventListener('click', () => {
      panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
    });

    // Helper to sync checkbox to setting and save
    const bindCheckbox = (id: string, key: keyof SettingsState) => {
      const el = document.getElementById(id) as HTMLInputElement;
      if (!el) { return; }

      // Set initial state
      el.checked = this.settings[key] as boolean;

      el.addEventListener('change', () => {
        (this.settings as any)[key] = el.checked;
        this.applySettingsToScene();
        this.saveSettings();
      });
    };

    // Helper to sync slider
    const bindSlider = (id: string, key: keyof SettingsState) => {
      const el = document.getElementById(id) as HTMLInputElement;
      if (!el) { return; }

      el.value = String(this.settings[key]);

      el.addEventListener('input', () => {
        (this.settings as any)[key] = parseFloat(el.value);
        this.saveSettings();
      });
    };

    bindCheckbox('s-direct', 'showDirectLines');
    bindCheckbox('s-indirect', 'showIndirectLines');
    bindCheckbox('s-layer3', 'showLayer3Lines');
    bindCheckbox('s-circular', 'showCircularLines');
    bindCheckbox('s-animation', 'enableAnimation');
    bindCheckbox('s-folder-labels', 'showFolderLabels');
    bindCheckbox('s-proximity-labels', 'showProximityLabels');
    bindCheckbox('s-bg-stars', 'showBackgroundStars');
    bindCheckbox('s-fog', 'enableFog');
    bindCheckbox('s-legend', 'showLegend');
    bindSlider('s-speed', 'orbitalSpeed');

    // Preset buttons
    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = (btn as HTMLElement).dataset.preset as keyof typeof PRESETS;
        this.applyPreset(preset);
        this.syncPanelToSettings();
      });
    });
  }

  private applyPreset(preset: keyof typeof PRESETS): void {
    this.settings = { ...PRESETS[preset] };
    this.applySettingsToScene();
    this.saveSettings();
  }

  private syncPanelToSettings(): void {
    const set = (id: string, val: boolean) => {
      const el = document.getElementById(id) as HTMLInputElement;
      if (el) { el.checked = val; }
    };
    const setVal = (id: string, val: number) => {
      const el = document.getElementById(id) as HTMLInputElement;
      if (el) { el.value = String(val); }
    };

    set('s-direct', this.settings.showDirectLines);
    set('s-indirect', this.settings.showIndirectLines);
    set('s-layer3', this.settings.showLayer3Lines);
    set('s-circular', this.settings.showCircularLines);
    set('s-animation', this.settings.enableAnimation);
    set('s-folder-labels', this.settings.showFolderLabels);
    set('s-proximity-labels', this.settings.showProximityLabels);
    set('s-bg-stars', this.settings.showBackgroundStars);
    set('s-fog', this.settings.enableFog);
    set('s-legend', this.settings.showLegend);
    setVal('s-speed', this.settings.orbitalSpeed);
  }

  private saveSettings(): void {
    sendToExtension({ type: 'SAVE_SETTINGS', payload: this.settings });
  }

  private enterStarFocusMode(folderId: string): void {
    this.focusedStarId = folderId;
    this.flyToStar(folderId);
    const folder = this.data?.folders[folderId];
    if (!folder) { return; }

    const folderFileIds = new Set(folder.fileIds);

    // Fade all planets not in this folder
    this.planets.forEach((planet, fileId) => {
      const material = planet.mesh.material as THREE.MeshStandardMaterial;
      if (folderFileIds.has(fileId)) {
        material.opacity = 1;
        material.transparent = false;
      } else {
        material.opacity = 0.05;
        material.transparent = true;
      }
    });

    // Fade all stars except clicked one
    this.stars.forEach((star, id) => {
      const material = star.mesh.material as THREE.MeshStandardMaterial;
      if (id === folderId) {
        material.opacity = 1;
        material.transparent = false;
      } else {
        material.opacity = 0.05;
        material.transparent = true;
      }
    });

    // Fade labels — keep only clicked star's label
    this.starLabels.forEach(label => {
      (label.material as THREE.SpriteMaterial).opacity = 0.05;
    });

    // Show only dependency lines connected to this folder's files
    this.lines.forEach(depLine => {
      const isConnected =
        folderFileIds.has(depLine.dependency.sourceId) ||
        folderFileIds.has(depLine.dependency.targetId);
      depLine.line.visible = isConnected;
      const material = depLine.line.material as THREE.LineBasicMaterial;
      if (isConnected) { material.opacity = 0.9; }
    });
  }

  private exitStarFocusMode(): void {
    this.focusedStarId = null;

    this.planets.forEach(planet => {
      const material = planet.mesh.material as THREE.MeshStandardMaterial;
      material.opacity = 1;
      material.transparent = false;
    });

    this.stars.forEach(star => {
      const material = star.mesh.material as THREE.MeshStandardMaterial;
      material.opacity = 1;
      material.transparent = false;
    });

    this.starLabels.forEach(label => {
      (label.material as THREE.SpriteMaterial).opacity = 1;
    });

    this.lines.forEach(depLine => {
      const material = depLine.line.material as THREE.LineBasicMaterial;
      material.opacity = depLine.baseOpacity;
      material.transparent = true;
    });
    // Re-apply settings — restores visibility correctly per user toggle state
    this.applySettingsToScene();
  }

  private initRefreshButton(): void {
    const button = document.getElementById('refresh-universe');
    if (!button) { return; }

    button.addEventListener('click', () => {
      sendToExtension({ type: 'REFRESH' });
      // Show brief loading state
      const overlay = document.getElementById('loading-overlay');
      const loadingText = document.getElementById('loading-text');
      if (overlay && loadingText) {
        loadingText.textContent = 'Refreshing universe...';
        overlay.style.display = 'flex';
        overlay.style.opacity = '1';
      }
    });

    button.addEventListener('mouseenter', () => {
      button.style.background = 'rgba(255,255,255,0.1)';
    });
    button.addEventListener('mouseleave', () => {
      button.style.background = 'rgba(0,0,0,0.85)';
    });
  }

  private initFilterBar(): void {
    const bar = document.getElementById('filter-bar')!;
    const toggleBtn = document.getElementById('filter-btn')!;

    toggleBtn.addEventListener('click', () => {
      bar.style.display = bar.style.display === 'flex' ? 'none' : 'flex';
    });
    toggleBtn.addEventListener('mouseenter', () => {
      toggleBtn.style.background = 'rgba(255,255,255,0.1)';
    });
    toggleBtn.addEventListener('mouseleave', () => {
      toggleBtn.style.background = 'rgba(0,0,0,0.85)';
    });

    // Keyboard shortcut T
    window.addEventListener('keydown', (e) => {
      if ((e.key === 't' || e.key === 'T') && !e.ctrlKey && !this.isTextInputTarget(e.target)) {
        bar.style.display = bar.style.display === 'flex' ? 'none' : 'flex';
      }
    });
  }

  private applyFilter(): void {
    // First update planet visibility based on extension
    this.planets.forEach((planet, fileId) => {
      const file = this.data?.files[fileId];
      if (!file) { return; }
      // Match by extension — dynamic filter uses raw extensions
      planet.mesh.visible = this.visibleTypes.has(file.extension.toLowerCase());
    });

    // Then update lines — only show if both endpoints are visible
    this.lines.forEach(depLine => {
      const sourceVisible = this.planets.get(depLine.dependency.sourceId)?.mesh.visible ?? false;
      const targetVisible = this.planets.get(depLine.dependency.targetId)?.mesh.visible ?? false;
      depLine.line.visible = sourceVisible && targetVisible;
    });
  }
}
