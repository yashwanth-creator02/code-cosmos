// webview/universe/Universe.ts

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CosmosData } from '../../src/types';
import { Star } from './Star';
import { Planet } from './Planet';
import { DependencyLine } from './DependencyLine';
import { CosmosDependency } from '../../src/types';
import { sendToExtension } from '../bridge/messageBridge';

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



  constructor(canvas: HTMLCanvasElement) {
    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      75,
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      10000
    );
    this.camera.position.z = 1000;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    this.scene.add(ambientLight);

    const axesHelper = new THREE.AxesHelper(200);
    this.scene.add(axesHelper);

    const pointLight = new THREE.PointLight(0xffffff, 1, 5000);
    pointLight.position.set(0, 0, 0);
    this.scene.add(pointLight);

    // Orbit controls — zoom, pan, rotate
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;

    canvas.addEventListener('click', (event) => this.onClick(event, canvas));
    canvas.addEventListener('mousemove', (event) => this.onMouseMove(event, canvas));
    // Handle window resize
    window.addEventListener('resize', () => this.onResize(canvas));

    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { this.exitFocusMode(); }
    });
    // Start the animation loop
    this.animate();
  }

  // Called once with CosmosData to build the universe
  public build(data: CosmosData): void {
    this.data = data;
    this.dependencies = data.dependencies;
    this.stars.forEach((star) => this.scene.remove(star.mesh));
    this.planets.forEach((planet) => this.scene.remove(planet.mesh));

    this.stars.clear();
    this.planets.clear();

    // Place stars using golden angle distribution
    const folderIds = Object.keys(data.folders);
    folderIds.forEach((folderId, index) => {
      const folder = data.folders[folderId];
      const position = this.goldenAnglePosition(index, folderIds.length, 500);
      const star = new Star(folder, position);
      this.stars.set(folderId, star);
      this.scene.add(star.mesh);

      // Place planets around this star
      folder.fileIds.forEach((fileId, planetIndex) => {
        const file = data.files[fileId];
        if (!file) { return; }
        const planetPosition = this.orbitalPosition(
          position,
          planetIndex,
          folder.fileIds.length * 4,
          100
        );
        const planet = new Planet(file, planetPosition);
        this.planets.set(fileId, planet);
        this.scene.add(planet.mesh);
      });
    });
    this.drawDependencies(data.dependencies);
  }

  // Distributes points evenly across a sphere surface
  private goldenAnglePosition(index: number, total: number, radius: number): THREE.Vector3 {
    const phi = Math.acos(1 - (2 * (index + 0.5)) / total);
    const theta = Math.PI * (1 + Math.sqrt(5)) * index;
    return new THREE.Vector3(
      radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.sin(phi) * Math.sin(theta),
      radius * Math.cos(phi)
    );
  }

  // Places a planet in a ring around its parent star
  private orbitalPosition(
    starPosition: THREE.Vector3,
    index: number,
    total: number,
    radius: number
  ): THREE.Vector3 {
    const angle = (index / total) * Math.PI * 2;
    return new THREE.Vector3(
      starPosition.x + radius * Math.cos(angle),
      starPosition.y + (Math.random() - 0.5) * 20,
      starPosition.z + radius * Math.sin(angle)
    );
  }

  // Animation loop — runs every frame
  private animate(): void {
    requestAnimationFrame(() => this.animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  // Handle canvas resize
  private onResize(canvas: HTMLCanvasElement): void {
    this.camera.aspect = canvas.clientWidth / canvas.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(
      canvas.clientWidth,
      canvas.clientHeight
    );
  }

  private drawDependencies(dependencies: CosmosDependency[]): void {
    dependencies.forEach(dep => {
      const sourcePlanet = this.planets.get(dep.sourceId);
      const targetPlanet = this.planets.get(dep.targetId);

      // Both endpoints must exist as planets in the universe
      if (!sourcePlanet || !targetPlanet) { return; }

      const line = new DependencyLine(
        dep,
        sourcePlanet.mesh.position,
        targetPlanet.mesh.position
      );

      this.lines.push(line);
      this.scene.add(line.line);
    });
  }

  private onClick(event: MouseEvent, canvas: HTMLCanvasElement): void {
    const rect = canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const planetMeshes = Array.from(this.planets.values()).map(p => p.mesh);
    const intersects = this.raycaster.intersectObjects(planetMeshes);

    if (intersects.length > 0) {
      const clicked = intersects[0].object;
      const fileId = clicked.userData.id as string;

      if (this.focusedFileId === fileId) {
        // Clicking same planet again — exit focus mode
        this.exitFocusMode();
      } else {
        // Enter focus mode on this planet
        this.enterFocusMode(fileId);
        // Open file in editor
        sendToExtension({ type: 'OPEN_FILE', payload: { fileId } });
      }
    } else {
      // Clicked empty space — exit focus mode
      this.exitFocusMode();
    }
  }

  private onMouseMove(event: MouseEvent, canvas: HTMLCanvasElement): void {
    const rect = canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const planetMeshes = Array.from(this.planets.values()).map(p => p.mesh);
    const intersects = this.raycaster.intersectObjects(planetMeshes);

    const tooltip = document.getElementById('tooltip')!;

    if (intersects.length > 0) {
      const hovered = intersects[0].object;
      const fileId = hovered.userData.id as string;
      const file = this.data?.files[fileId];
      if (!file) { return; }

      // Count how many files this one depends on
      const dependsOn = this.dependencies.filter(d => d.sourceId === fileId).length;
      // Count how many files depend on this one
      const dependedBy = this.dependencies.filter(d => d.targetId === fileId).length;

      tooltip.style.display = 'block';
      tooltip.style.left = `${event.clientX + 15}px`;
      tooltip.style.top = `${event.clientY + 15}px`;
      tooltip.innerHTML = `
      <strong>${file.name}</strong><br>
      Type: ${file.extension.toUpperCase()}<br>
      Depends on: ${dependsOn} files<br>
      Used by: ${dependedBy} files
    `;
    } else {
      tooltip.style.display = 'none';
    }
  }

  private enterFocusMode(fileId: string): void {
    this.focusedFileId = fileId;

    // Find all files directly connected to this one
    const connectedIds = new Set<string>();
    connectedIds.add(fileId);

    this.dependencies.forEach(dep => {
      if (dep.sourceId === fileId) { connectedIds.add(dep.targetId); }
      if (dep.targetId === fileId) { connectedIds.add(dep.sourceId); }
    });

    // Fade all unrelated planets
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

    // Fade all unrelated stars
    this.stars.forEach((star) => {
      const material = star.mesh.material as THREE.MeshStandardMaterial;
      material.opacity = 0.05;
      material.transparent = true;
    });

    // Fade unrelated lines — keep only lines connecting to focused planet
    this.lines.forEach((depLine) => {
      const material = depLine.line.material as THREE.LineBasicMaterial;
      const isConnected =
        depLine.dependency.sourceId === fileId ||
        depLine.dependency.targetId === fileId;
      if (isConnected) {
        material.opacity = 0.9;
      } else {
        material.opacity = 0.02;
      }
    });
  }

  private exitFocusMode(): void {
    this.focusedFileId = null;

    // Restore all planets
    this.planets.forEach((planet) => {
      const material = planet.mesh.material as THREE.MeshStandardMaterial;
      material.opacity = 1;
      material.transparent = false;
    });

    // Restore all stars
    this.stars.forEach((star) => {
      const material = star.mesh.material as THREE.MeshStandardMaterial;
      material.opacity = 1;
      material.transparent = false;
    });

    // Restore all lines to original opacity
    this.lines.forEach((depLine) => {
      const material = depLine.line.material as THREE.LineBasicMaterial;
      material.opacity = 0.4;
    });
  }
}
