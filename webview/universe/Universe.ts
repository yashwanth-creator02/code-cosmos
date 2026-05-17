// webview/universe/Universe.ts

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Star } from './Star';
import { Planet } from './Planet';
import { DependencyLine } from './DependencyLine';
import { sendToExtension } from '../bridge/messageBridge';
import { CosmosFolder, CosmosDependency, DependencyLayer, CosmosData } from '../../src/types';


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
  private defaultCameraPosition = new THREE.Vector3(0, 0, 1000);
  private centralCore: THREE.Mesh | null = null;
  private spacecraftMode = false;
  private keys: Record<string, boolean> = {};
  private pitch = 0; // up/down rotation
  private yaw = 0;   // left/right rotation;


  constructor(canvas: HTMLCanvasElement) {
    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.scene.fog = new THREE.FogExp2(0x000000, 0.00008);

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      75,
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      10000
    );
    this.camera.position.z = 1000;
    this.defaultCameraPosition = this.camera.position.clone();

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    this.scene.add(ambientLight);

    const pointLight = new THREE.PointLight(0xffffff, 1, 5000);
    pointLight.position.set(0, 0, 0);
    this.scene.add(pointLight);

    // Orbit controls — zoom, pan, rotate
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 8000;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = true;
    this.controls.rotateSpeed = 0.8;
    this.controls.zoomSpeed = 1.2;
    this.controls.panSpeed = 0.8;

    canvas.addEventListener('click', (event) => this.onClick(event, canvas));
    canvas.addEventListener('mousemove', (event) => this.onMouseMove(event, canvas));
    canvas.addEventListener('mouseleave', () => {
      const tooltip = document.getElementById('tooltip')!;
      tooltip.style.display = 'none';
    });

    // Handle window resize
    window.addEventListener('resize', () => this.onResize(canvas));

    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { this.exitFocusMode(); }
    });

    this.initSpacecraftMode();
    this.initSearch();
    this.initResetButton();
    this.addBackgroundStars();
    // Start the animation loop
    this.animate();
  }

  // Called once with CosmosData to build the universe
  public build(data: CosmosData): void {
    this.data = data;
    this.dependencies = data.dependencies;

    // Clear old stars
    this.stars.forEach((star) => {
      this.scene.remove(star.mesh);
      this.scene.remove(star.light);
    });

    // Clear old planets
    this.planets.forEach((planet) => {
      this.scene.remove(planet.mesh);
    });

    this.stars.clear();
    this.planets.clear();

    // Clear old dependency lines
    this.lines.forEach((line) => {
      this.scene.remove(line.line);
    });
    this.lines = [];

    // Remove old central core if exists
    if (this.centralCore) {
      this.scene.remove(this.centralCore);
      this.centralCore = null;
    }

    this.addCentralBody(data.folders[data.rootFolderId]);

    // Place stars using golden angle distribution
    const folderIds = Object.keys(data.folders);

    folderIds.forEach((folderId, index) => {
      const folder = data.folders[folderId];

      const position = this.goldenAnglePosition(
        index,
        folderIds.length,
        500
      );

      const star = new Star(folder, position);

      star.mesh.userData = {
        type: 'star',
        id: folderId,
        name: folder.name,
      };

      this.stars.set(folderId, star);

      this.scene.add(star.light);
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
    const tooltip = document.getElementById('tooltip')!;
    const allMeshes = [
      ...Array.from(this.planets.values()).map(p => p.mesh),
      ...Array.from(this.stars.values()).map(s => s.mesh),
    ];
    if (this.centralCore) { allMeshes.push(this.centralCore); }

    const intersects = this.raycaster.intersectObjects(allMeshes);

    if (intersects.length > 0) {
      const hovered = intersects[0].object;

      if (hovered.userData.type === 'central') {
        tooltip.style.display = 'block';
        tooltip.style.left = `${event.clientX + 15}px`;
        tooltip.style.top = `${event.clientY + 15}px`;
        tooltip.innerHTML = `
        <strong>⭐ ${hovered.userData.name}</strong><br>
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

        const fileCount = folder.fileIds.length;
        const subFolderCount = folder.childFolderIds.length;

        // Count dependencies for files in this folder
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
        <strong>📁 ${folder.name}</strong><br>
        Files: ${fileCount}<br>
        Subfolders: ${subFolderCount}<br>
        <span style="color:#ffffff">⬤</span> Outgoing: ${outgoing} / Incoming: ${incoming}<br>
        ${hasCircular ? '<span style="color:#FF1744">⬤ Contains circular dependency</span>' : ''}
      `;
        return;
      }

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
      <strong>${file.name}</strong><br>
      Type: ${file.extension.toUpperCase()}<br>
      <span style="color:#ffffff">⬤</span> Direct: ${dependsOn} out / ${dependedBy} in<br>
      <span style="color:#4488ff">⬤</span> Indirect: ${indirectCount}<br>
      <span style="color:#FFB300">⬤</span> Shared dependent: ${sharedDependentCount}<br>
      <span style="color:#00BCD4">⬤</span> Shared dependency: ${sharedDependencyCount}<br>
      ${isCircular ? '<span style="color:#FF1744">⬤ Circular dependency detected</span><br>' : ''}
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

  private initSearch(): void {
    const container = document.getElementById('search-container')!;
    const input = document.getElementById('search-input') as HTMLInputElement;
    const results = document.getElementById('search-results')!;

    // Toggle search with Ctrl+F or /
    window.addEventListener('keydown', (e) => {
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
        this.exitFocusMode();
      }
      if (e.key === 'r' || e.key === 'R') {
        this.resetCamera();
      }
    });

    // Filter results as user types
    input.addEventListener('input', () => {
      const query = input.value.trim().toLowerCase();
      if (!query || !this.data) {
        results.style.display = 'none';
        return;
      }

      // Find matching files
      const matches = Object.values(this.data.files)
        .filter(f => f.name.toLowerCase().includes(query))
        .slice(0, 8); // max 8 results

      if (matches.length === 0) {
        results.style.display = 'none';
        return;
      }

      results.style.display = 'block';
      results.innerHTML = matches.map(f => `
      <div class="search-result" data-id="${f.id}" style="
        padding: 8px 14px;
        color: white;
        font-family: sans-serif;
        font-size: 12px;
        cursor: pointer;
        border-bottom: 1px solid rgba(255,255,255,0.05);
      ">
        <span style="opacity:0.5">${f.relativePath.replace(f.name, '')}</span>${f.name}
      </div>
    `).join('');

      // Click a result — fly to planet
      results.querySelectorAll('.search-result').forEach(el => {
        el.addEventListener('click', () => {
          const fileId = (el as HTMLElement).dataset.id!;
          this.flyToPlanet(fileId);
          container.style.display = 'none';
        });

        // Hover highlight
        el.addEventListener('mouseenter', () => {
          (el as HTMLElement).style.background = 'rgba(255,255,255,0.1)';
        });
        el.addEventListener('mouseleave', () => {
          (el as HTMLElement).style.background = 'transparent';
        });
      });
    });
  }

  private flyToPlanet(fileId: string): void {
    const planet = this.planets.get(fileId);
    if (!planet) { return; }

    const target = planet.mesh.position.clone();

    // Animate camera toward the planet
    const startPosition = this.camera.position.clone();
    const endPosition = target.clone().add(new THREE.Vector3(0, 0, 100));

    let progress = 0;
    const duration = 60; // frames

    const fly = () => {
      if (progress >= duration) {
        this.enterFocusMode(fileId);
        return;
      }
      progress++;
      const t = progress / duration;
      // Ease in-out
      const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

      this.camera.position.lerpVectors(startPosition, endPosition, eased);
      this.controls.target.lerpVectors(this.controls.target, target, eased);
      this.controls.update();

      requestAnimationFrame(fly);
    };

    fly();
  }

  private initResetButton(): void {
    const button = document.getElementById('reset-camera')!;

    button.addEventListener('click', () => {
      this.resetCamera();
    });

    button.addEventListener('mouseenter', () => {
      button.style.background = 'rgba(255,255,255,0.1)';
    });

    button.addEventListener('mouseleave', () => {
      button.style.background = 'rgba(0,0,0,0.85)';
    });
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
      positions[i] = (Math.random() - 0.5) * 8000;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 1.5,
      transparent: true,
      opacity: 0.6,
    });

    const stars = new THREE.Points(geometry, material);
    this.scene.add(stars);
  }

  private addCentralBody(rootFolder: CosmosFolder): void {
    // Core sphere
    const coreGeometry = new THREE.SphereGeometry(40, 32, 32);
    const coreMaterial = new THREE.MeshStandardMaterial({
      color: 0xfff5c0,
      emissive: 0xffaa00,
      emissiveIntensity: 0.8,
      transparent: true,
      opacity: 0.95,
    });
    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    this.centralCore = core;
    this.scene.add(core);

    // Inner glow layer
    const glowGeometry = new THREE.SphereGeometry(55, 32, 32);
    const glowMaterial = new THREE.MeshStandardMaterial({
      color: 0xff8800,
      emissive: 0xff6600,
      emissiveIntensity: 0.4,
      transparent: true,
      opacity: 0.15,
      side: THREE.BackSide,
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    this.scene.add(glow);

    // Outer glow layer
    const outerGlowGeometry = new THREE.SphereGeometry(75, 32, 32);
    const outerGlowMaterial = new THREE.MeshStandardMaterial({
      color: 0xff4400,
      emissive: 0xff2200,
      emissiveIntensity: 0.2,
      transparent: true,
      opacity: 0.06,
      side: THREE.BackSide,
    });
    const outerGlow = new THREE.Mesh(outerGlowGeometry, outerGlowMaterial);
    this.scene.add(outerGlow);

    // Powerful central light illuminating everything
    const centralLight = new THREE.PointLight(0xffaa44, 2, 3000);
    centralLight.position.set(0, 0, 0);
    this.scene.add(centralLight);

    // Label — repo name
    // Store mesh userData for hover
    core.userData = { type: 'central', name: rootFolder.name };
  }

  private initSpacecraftMode(): void {
    window.addEventListener('keydown', (e) => {
      this.keys[e.key.toLowerCase()] = true;

      // Toggle spacecraft mode with F key
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

      // Clamp pitch so you can't flip upside down
      this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));

      // Apply rotation to camera
      const quaternion = new THREE.Quaternion();
      const pitchQuat = new THREE.Quaternion();
      const yawQuat = new THREE.Quaternion();

      yawQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
      pitchQuat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.pitch);

      quaternion.multiplyQuaternions(yawQuat, pitchQuat);
      this.camera.quaternion.copy(quaternion);
    });

    // Release pointer lock when exiting spacecraft mode
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== this.renderer.domElement) {
        // Pointer lock released — sync yaw/pitch with current camera rotation
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

    // Update orbit controls target to camera direction
    // So when you switch back to orbit mode it feels natural
    const target = this.camera.position.clone().add(forward.multiplyScalar(100));
    this.controls.target.copy(target);
  }

  private showModeIndicator(spacecraft: boolean): void {
    const indicator = document.getElementById('mode-indicator');
    if (!indicator) { return; }

    indicator.textContent = spacecraft
      ? '🚀 Spacecraft Mode — WASD to fly, Click to capture mouse, Esc to release'
      : '🔭 Orbit Mode — F to switch';

    indicator.style.opacity = '1';
    setTimeout(() => { indicator.style.opacity = '0'; }, 2000);
  }


  private animate(): void {
    requestAnimationFrame(() => this.animate());
    this.updateSpacecraft();

    if (!this.spacecraftMode) {
      this.controls.update();
    }

    // Slowly rotate the central body
    if (this.centralCore) {
      this.centralCore.rotation.y += 0.002;
      this.centralCore.rotation.x += 0.001;
    }

    this.renderer.render(this.scene, this.camera);
  }
}
