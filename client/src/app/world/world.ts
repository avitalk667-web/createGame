import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { PlayerDto, RemotePosition, RoomSnapshot, ScenarioContent } from '../core/models';
import { Quality } from '../core/settings.service';
import { drawSymbol } from '../core/symbols';
import { BoyAvatar } from './avatar';
import {
  INTERACTABLES,
  InteractableDef,
  ROOM_HALF_D,
  ROOM_HALF_W,
  ROOM_SPACING,
  Rect,
  WALL_H,
  ZONE_ORDER,
  ZoneId,
  inRects,
  obstacleRects,
  walkableRects,
  worldPos,
  zoneAt,
  zoneCenter,
} from './layout';
import {
  bookSpinesTexture, glowSpriteTexture, labelTexture, paintingTexture, panelTexture, parchmentTexture, plaqueTexture, rugTexture,
  stoneTexture, windowTexture, woodFloorTexture,
} from './textures';

export type WorldMode = 'showcase' | 'intro' | 'play' | 'outro' | 'cutscene' | 'tour';

export interface WorldCallbacks {
  onHover?(def: InteractableDef | null): void;
  onInteract?(def: InteractableDef): void;
  onTooFar?(def: InteractableDef): void;
  onZoneChange?(zone: ZoneId): void;
  onMove?(x: number, y: number, z: number, ry: number, zone: string): void;
}

const DOOR_GAP_W = 2.4;
const DOOR_GAP_H = 3.4;
const INTERACT_DISTANCE = 4.2;
const SPAWN = new THREE.Vector3(0, 0, 4.6);

interface Flicker {
  light: THREE.PointLight;
  base: number;
  seed: number;
}

/**
 * The whole 3D experience: mansion exterior (used by the home page and the opening cinematic),
 * six interior rooms, puzzle props, the portal, the local player and the other players.
 */
export class GameWorld {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.05, 600);
  private composer?: EffectComposer;
  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;
  private resizeObs: ResizeObserver;
  private mode: WorldMode = 'showcase';
  private modeTime = 0;
  private flickers: Flicker[] = [];
  private animated: ((t: number, dt: number) => void)[] = [];

  // interaction
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2(10, 10);
  private hitTargets = new Map<string, THREE.Mesh>();
  private hovered: InteractableDef | null = null;
  private drag?: { x: number; y: number; moved: boolean; id: number };

  // world state
  private doors = new Map<ZoneId, THREE.Object3D>();
  private doorOpen = new Map<ZoneId, number>();
  private unlocked = new Set<string>(['library']);
  private rects: Rect[] = walkableRects(this.unlocked);
  private obstacles: Rect[] = obstacleRects();
  private cut?: { from: THREE.Vector3; to: THREE.Vector3; look: THREE.Vector3; t: number; dur: number };
  private itemMeshes = new Map<string, THREE.Object3D>();
  private worldItems = new Set<string>();
  private pedestalSlots = new Map<string, THREE.Object3D>();
  private chestLid?: THREE.Object3D;
  private chestOpen = 0;
  private chestTarget = 0;
  private bells = new Map<string, { group: THREE.Group; glow: THREE.Mesh; swing: number }>();
  private portalMat?: THREE.ShaderMaterial;
  private portalLight?: THREE.PointLight;
  private portalPower = 0.25;
  private portalTarget = 0.25;
  private portalParticles?: THREE.Points;
  private gateGlow?: THREE.Mesh;
  private letterSlots = new Map<string, THREE.Mesh>();

  // players
  private local?: BoyAvatar;
  private localPos = SPAWN.clone();
  private localYaw = Math.PI;
  private localSpeed = 0;
  private camYaw = 0;
  private camPitch = 0.32;
  private camDist = 4.6;
  private keys = new Set<string>();
  private joystick = new THREE.Vector2();
  private remotes = new Map<string, { avatar: BoyAvatar; pos: THREE.Vector3; yaw: number; speed: number; connected: boolean }>();
  private positions?: Map<string, RemotePosition & { t: number }>;
  private myId?: string;
  private lastSent = 0;
  private lastSentKey = '';
  private currentZone: ZoneId = 'library';
  private guide?: BoyAvatar;
  sensitivity = 1;

  constructor(private canvas: HTMLCanvasElement, private quality: Quality, private cb: WorldCallbacks = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 2 : quality === 'medium' ? 1.5 : 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.22;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color('#070b1c');
    this.scene.fog = new THREE.FogExp2('#0a1026', 0.012);

    if (quality !== 'low') {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(512, 512), quality === 'high' ? 0.6 : 0.45, 0.45, 0.92));
      this.composer.addPass(new OutputPass());
    }

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(canvas.parentElement ?? canvas);
    this.resize();
    this.bindInput();
  }

  // ======================================================================= build

  build(scenario: ScenarioContent | null) {
    this.buildSky();
    this.buildExterior();
    ZONE_ORDER.forEach((z, i) => {
      this.buildRoomShell(z, i);
      this.decorate(z, i);
    });
    this.buildLibrary(scenario);
    this.buildSymbols(scenario);
    this.buildEcho(scenario);
    this.buildMirrors();
    this.buildItemsRoom();
    this.buildPortal(scenario);
    for (const def of INTERACTABLES) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(def.radius, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
      m.position.set(...worldPos(def));
      m.userData['def'] = def;
      this.scene.add(m);
      this.hitTargets.set(def.id, m);
    }
    this.scene.add(new THREE.HemisphereLight('#7d8bc5', '#2a1d10', 0.85));
    if (this.quality !== 'low') {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.keyLight = new THREE.SpotLight('#ffd9a8', 28, 22, Math.PI / 3, 0.7, 1.4);
      this.keyLight.castShadow = true;
      this.keyLight.shadow.mapSize.set(this.quality === 'high' ? 2048 : 1024, this.quality === 'high' ? 2048 : 1024);
      this.keyLight.shadow.bias = -0.0006;
      this.keyLight.shadow.normalBias = 0.02;
      this.scene.add(this.keyLight, this.keyLight.target);
      this.placeKeyLight('library');
      this.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const material = m.material as THREE.Material;
        const flat = m.geometry instanceof THREE.PlaneGeometry || m.geometry instanceof THREE.CircleGeometry;
        m.receiveShadow = true;
        m.castShadow = !flat && !material.transparent && !(material instanceof THREE.MeshBasicMaterial) && !(material instanceof THREE.ShaderMaterial);
      });
    }
    this.scene.add(new THREE.AmbientLight('#8890b0', 0.12));
  }

  private std(color: string, opts: THREE.MeshStandardMaterialParameters = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...opts });
  }

  private addLight(x: number, y: number, z: number, color: string, intensity: number, distance: number, flicker = true) {
    const l = new THREE.PointLight(color, intensity, distance, 1.6);
    l.position.set(x, y, z);
    this.scene.add(l);
    if (flicker) this.flickers.push({ light: l, base: intensity, seed: Math.random() * 100 });
    return l;
  }

  private candle(x: number, y: number, z: number, light = false) {
    const g = new THREE.Group();
    const wax = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.22, 10), this.std('#efe6cf'));
    wax.position.y = 0.11;
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowSpriteTexture('#ffb84d'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    flame.scale.set(0.35, 0.5, 1);
    flame.position.y = 0.32;
    g.add(wax, flame);
    g.position.set(x, y, z);
    this.scene.add(g);
    this.animated.push((t) => flame.scale.set(0.33 + Math.sin(t * 13 + x) * 0.03, 0.48 + Math.sin(t * 17 + z) * 0.05, 1));
    if (light) this.addLight(x, y + 0.45, z, '#ffb469', 6, 9);
    return g;
  }

  private sconce(x: number, y: number, z: number, faceX: number) {
    const holder = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.4, 0.14), this.std('#2a2018', { metalness: 0.5, roughness: 0.4 }));
    holder.position.set(x, y, z);
    this.scene.add(holder);
    this.candle(x + faceX * 0.12, y + 0.2, z);
    if (this.quality === 'high') this.addLight(x + faceX * 0.6, y + 0.6, z, '#ffae5c', 7, 11);
  }

  private buildSky() {
    const starGeo = new THREE.BufferGeometry();
    const n = this.quality === 'low' ? 500 : 1500;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.random() * Math.PI * 0.45;
      pos.set([Math.cos(th) * Math.sin(ph) * 380, Math.cos(ph) * 380, Math.sin(th) * Math.sin(ph) * 380], i * 3);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: '#dfe6ff', size: 1.2, sizeAttenuation: false, fog: false }));
    this.scene.add(stars);
    const moon = new THREE.Mesh(new THREE.SphereGeometry(7, 24, 24), new THREE.MeshBasicMaterial({ color: '#f6f1d8', fog: false }));
    moon.position.set(55, 75, -120);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowSpriteTexture('#c8d4ff'), blending: THREE.AdditiveBlending, fog: false, transparent: true, depthWrite: false }));
    halo.scale.set(60, 60, 1);
    halo.position.copy(moon.position);
    this.scene.add(moon, halo);
    const moonLight = new THREE.DirectionalLight('#9fb2ff', 1.9);
    moonLight.position.set(40, 60, 40);
    this.scene.add(moonLight);
  }

  private buildExterior() {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), this.std('#141a1c'));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.02, 40);
    const path = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 60), this.std('#4b4743', { map: stoneTexture([2, 24]) }));
    path.rotation.x = -Math.PI / 2;
    path.position.set(0, 0.0, 37);
    this.scene.add(ground, path);

    const stone = this.std('#7a7380', { map: stoneTexture([10, 6]) });
    const darkStone = this.std('#4d4752', { map: stoneTexture([6, 6]) });
    // Facade with an entrance arch into the library (x ±1.6, height 4.2)
    const facadeW = 34;
    const facadeH = 14;
    const sideW = (facadeW - 3.2) / 2;
    for (const sx of [-1, 1]) {
      const part = new THREE.Mesh(new THREE.PlaneGeometry(sideW, facadeH), stone);
      part.position.set(sx * (1.6 + sideW / 2), facadeH / 2, ROOM_HALF_D + 0.2);
      this.scene.add(part);
    }
    const top = new THREE.Mesh(new THREE.PlaneGeometry(3.2, facadeH - 4.2), stone);
    top.position.set(0, 4.2 + (facadeH - 4.2) / 2, ROOM_HALF_D + 0.2);
    this.scene.add(top);
    // shell around the interior so the rooms are hidden from outside
    const shellLen = ROOM_SPACING * ZONE_ORDER.length + 4;
    for (const sx of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.5, facadeH, shellLen), darkStone);
      side.position.set(sx * (facadeW / 2), facadeH / 2, ROOM_HALF_D - shellLen / 2);
      this.scene.add(side);
    }
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.1, facadeW / 2 + 1, 7, 4, 1, false, Math.PI / 4), this.std('#1d2236'));
    roof.scale.set(1, 1, 0.25);
    roof.position.set(0, facadeH + 3.4, ROOM_HALF_D - 1.5);
    this.scene.add(roof);
    const roofBack = new THREE.Mesh(new THREE.BoxGeometry(facadeW, 0.6, shellLen), this.std('#1d2236'));
    roofBack.position.set(0, facadeH, ROOM_HALF_D - shellLen / 2);
    this.scene.add(roofBack);

    // Towers with conical roofs
    for (const sx of [-1, 1]) {
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.2, 20, 20), stone);
      tower.position.set(sx * (facadeW / 2 + 1), 10, ROOM_HALF_D - 1);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(3.7, 8, 20), this.std('#1b2140'));
      cone.position.set(sx * (facadeW / 2 + 1), 24, ROOM_HALF_D - 1);
      this.scene.add(tower, cone);
      for (let k = 0; k < 3; k++) this.window(sx * (facadeW / 2 + 1), 6 + k * 4.5, ROOM_HALF_D + 2.05, 0.9, 1.6);
    }
    for (const x of [-12, -7.5, 7.5, 12]) for (const y of [4, 9]) this.window(x, y, ROOM_HALF_D + 0.25, 1.4, 2.4);
    this.window(0, 8.6, ROOM_HALF_D + 0.25, 2.2, 2.2, true);

    // Arch trim around the entrance
    const arch = new THREE.Mesh(new THREE.TorusGeometry(1.75, 0.22, 10, 24, Math.PI), this.std('#b8a27a', { metalness: 0.3 }));
    arch.position.set(0, 4.2 - 0.1, ROOM_HALF_D + 0.3);
    this.scene.add(arch);
    // Shimmer in the doorway during the opening scene
    this.gateGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 4.2),
      new THREE.MeshBasicMaterial({ color: '#5fa8ff', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.gateGlow.position.set(0, 2.1, ROOM_HALF_D + 0.25);
    this.scene.add(this.gateGlow);

    // Lanterns along the path, trees on the sides
    for (const z of [16, 26, 36]) {
      for (const sx of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3, 8), this.std('#15151a', { metalness: 0.6 }));
        post.position.set(sx * 3.2, 1.5, z);
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowSpriteTexture('#ffc56b'), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
        glow.scale.set(1.4, 1.4, 1);
        glow.position.set(sx * 3.2, 3.1, z);
        this.scene.add(post, glow);
      }
    }
    this.addLight(0, 3.2, 18, '#ffb35c', 14, 18);
    // warm floodlights washing the facade
    this.addLight(-9, 1.5, 13, '#ffbf73', 60, 26, false);
    if (this.quality !== 'low') this.addLight(9, 1.5, 13, '#ffbf73', 60, 26, false);
    if (this.quality !== 'low') this.addLight(0, 3.2, 32, '#ffb35c', 10, 16);
    const treeMat = this.std('#0c1714');
    for (let i = 0; i < 26; i++) {
      const sx = i % 2 ? 1 : -1;
      const x = sx * (9 + Math.random() * 28);
      const z = 10 + Math.random() * 60;
      const h = 5 + Math.random() * 6;
      const tree = new THREE.Mesh(new THREE.ConeGeometry(h * 0.35, h, 8), treeMat);
      tree.position.set(x, h / 2, z);
      this.scene.add(tree);
    }
  }

  private window(x: number, y: number, z: number, w: number, h: number, round = false) {
    const mat = new THREE.MeshBasicMaterial({ color: round ? '#9cc8ff' : '#ffc777' });
    const geo = round ? new THREE.CircleGeometry(w / 2, 24) : new THREE.PlaneGeometry(w, h);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    this.scene.add(m);
    const frame = new THREE.Mesh(round ? new THREE.RingGeometry(w / 2, w / 2 + 0.15, 24) : new THREE.PlaneGeometry(w + 0.25, h + 0.25), this.std('#2a2420'));
    frame.position.set(x, y, z - 0.01);
    this.scene.add(frame);
  }

  private buildRoomShell(zone: ZoneId, i: number) {
    const c = -ROOM_SPACING * i;
    const wallMat = this.std(zone === 'portal' ? '#5d5f7d' : zone === 'mirrors' ? '#6b6478' : '#77707a', { map: stoneTexture([5, 2.5]) });
    const floorMat = zone === 'library' || zone === 'items'
      ? this.std('#9a7a5a', { map: woodFloorTexture([4, 4]), roughness: 0.7 })
      : this.std('#6a6470', { map: stoneTexture([6, 6]), roughness: 0.6 });

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_HALF_W * 2, ROOM_HALF_D * 2), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, c);
    floor.receiveShadow = true;
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_HALF_W * 2, ROOM_HALF_D * 2), this.std('#2b2420'));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, WALL_H, c);
    this.scene.add(floor, ceil);
    // beams
    for (const bz of [-4, 0, 4]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(ROOM_HALF_W * 2, 0.35, 0.35), this.std('#3a2a1c'));
      beam.position.set(0, WALL_H - 0.2, c + bz);
      this.scene.add(beam);
    }

    for (const sx of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_HALF_D * 2, WALL_H), wallMat);
      wall.rotation.y = -sx * Math.PI / 2;
      wall.position.set(sx * ROOM_HALF_W, WALL_H / 2, c);
      this.scene.add(wall);
    }
    // back wall (towards next room) and front wall (towards previous room / outside)
    const last = i === ZONE_ORDER.length - 1;
    this.wallWithGap(c - ROOM_HALF_D, 0, wallMat, last ? 0 : DOOR_GAP_W, DOOR_GAP_H);
    this.wallWithGap(c + ROOM_HALF_D, Math.PI, wallMat, i === 0 ? 3.2 : DOOR_GAP_W, i === 0 ? 4.2 : DOOR_GAP_H);

    // corridor + door to the next room
    if (!last) {
      const z0 = c - ROOM_HALF_D;
      const len = ROOM_SPACING - ROOM_HALF_D * 2;
      const cf = new THREE.Mesh(new THREE.PlaneGeometry(DOOR_GAP_W, len), this.std('#4a4450', { map: stoneTexture([1, 1]) }));
      cf.rotation.x = -Math.PI / 2;
      cf.position.set(0, 0.005, z0 - len / 2);
      const cc = new THREE.Mesh(new THREE.PlaneGeometry(DOOR_GAP_W, len), this.std('#221c18'));
      cc.rotation.x = Math.PI / 2;
      cc.position.set(0, DOOR_GAP_H, z0 - len / 2);
      this.scene.add(cf, cc);
      for (const sx of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.PlaneGeometry(len, DOOR_GAP_H), wallMat);
        w.rotation.y = -sx * Math.PI / 2;
        w.position.set(sx * DOOR_GAP_W / 2, DOOR_GAP_H / 2, z0 - len / 2);
        this.scene.add(w);
      }
      const next = ZONE_ORDER[i + 1];
      const door = this.makeDoor(zone);
      door.position.set(0, DOOR_GAP_H / 2, z0 - 0.12);
      this.scene.add(door);
      this.doors.set(next, door);
      this.doorOpen.set(next, 0);
    }
  }

  private wallWithGap(z: number, rotY: number, mat: THREE.Material, gapW: number, gapH: number) {
    const W = ROOM_HALF_W * 2;
    const add = (w: number, h: number, x: number, y: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      m.rotation.y = rotY;
      m.position.set(x, y, z);
      this.scene.add(m);
    };
    if (!gapW) return add(W, WALL_H, 0, WALL_H / 2);
    const side = (W - gapW) / 2;
    add(side, WALL_H, -(gapW / 2 + side / 2), WALL_H / 2);
    add(side, WALL_H, gapW / 2 + side / 2, WALL_H / 2);
    add(gapW, WALL_H - gapH, 0, gapH + (WALL_H - gapH) / 2);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(gapW + 0.4, 0.3, 0.3), this.std('#3c2c1e'));
    trim.position.set(0, gapH + 0.15, z);
    this.scene.add(trim);
  }

  /** Door with an emblem showing which lock it is. */
  private makeDoor(zone: ZoneId) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 360;
    const g = c.getContext('2d')!;
    g.fillStyle = '#4a2f1b';
    g.fillRect(0, 0, 256, 360);
    for (let x = 0; x < 256; x += 42) {
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(x, 0, 3, 360);
    }
    g.fillStyle = '#26221f';
    for (const y of [50, 300]) g.fillRect(0, y, 256, 18);
    g.fillStyle = 'rgba(214,170,80,0.95)';
    g.beginPath();
    g.arc(128, 175, 62, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#2a1a0e';
    g.beginPath();
    g.arc(128, 175, 54, 0, Math.PI * 2);
    g.fill();
    const emblem: Record<string, string> = { library: 'key', symbols: 'dial', echo: 'bell', mirrors: 'mirror', items: 'gear' };
    drawSymbol(g, emblem[zone] ?? 'lock', 128, 175, 70, '#e2c27a');
    if (zone === 'library') {
      g.fillStyle = '#e2c27a';
      for (let k = 0; k < 3; k++) g.fillRect(64 + k * 48, 255, 34, 30);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const door = new THREE.Mesh(new THREE.BoxGeometry(DOOR_GAP_W, DOOR_GAP_H, 0.18), [
      this.std('#3a2414'), this.std('#3a2414'), this.std('#3a2414'), this.std('#3a2414'),
      this.std('#ffffff', { map: tex }), this.std('#ffffff', { map: tex }),
    ]);
    return door;
  }

  /** Architectural detail shared by all rooms: wainscot, rails, coffers, chandelier, windows, paintings, rugs. */
  private decorate(zone: ZoneId, i: number) {
    const c = -ROOM_SPACING * i;
    const W = ROOM_HALF_W;
    const D = ROOM_HALF_D;
    const last = i === ZONE_ORDER.length - 1;
    const wood = this.std('#ffffff', { map: panelTexture([7, 1]), roughness: 0.6 });
    const trimMat = this.std('#2a1a0e', { roughness: 0.5 });
    const PH = 1.3;
    // side walls: panels, chair rail, baseboard, crown molding
    for (const sx of [-1, 1]) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.06, PH, D * 2), wood);
      panel.position.set(sx * (W - 0.03), PH / 2, c);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, D * 2), trimMat);
      rail.position.set(sx * (W - 0.06), PH, c);
      const crown = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, D * 2), trimMat);
      crown.position.set(sx * (W - 0.11), WALL_H - 0.11, c);
      this.scene.add(panel, rail, crown);
    }
    // front/back walls, leaving the door gaps open
    for (const [z, gap] of [[c - D + 0.03, last ? 0 : DOOR_GAP_W], [c + D - 0.03, i === 0 ? 3.2 : DOOR_GAP_W]] as [number, number][]) {
      const side = (W * 2 - gap) / 2;
      for (const sx of gap ? [-1, 1] : [0]) {
        const w = gap ? side : W * 2;
        const x = gap ? sx * (gap / 2 + side / 2) : 0;
        const panel = new THREE.Mesh(new THREE.BoxGeometry(w, PH, 0.06), wood);
        panel.position.set(x, PH / 2, z);
        const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, 0.12), trimMat);
        rail.position.set(x, PH, z);
        this.scene.add(panel, rail);
      }
      const crown = new THREE.Mesh(new THREE.BoxGeometry(W * 2, 0.22, 0.22), trimMat);
      crown.position.set(0, WALL_H - 0.11, z + (z < c ? 0.08 : -0.08));
      this.scene.add(crown);
    }
    // coffered ceiling: beams across the room
    for (const bx of [-4, 0, 4]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, D * 2), this.std('#3a2a1c'));
      beam.position.set(bx, WALL_H - 0.18, c);
      this.scene.add(beam);
    }

    // brass chandelier with candles
    if (zone !== 'portal') {
      const brass = this.std('#b8913f', { metalness: 0.85, roughness: 0.3 });
      const g = new THREE.Group();
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 6), brass);
      chain.position.y = 0.6;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.05, 10, 40), brass);
      ring.rotation.x = Math.PI / 2;
      const hub = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), brass);
      hub.position.y = -0.1;
      g.add(chain, ring, hub);
      for (let k = 0; k < 8; k++) {
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.8, 5), brass);
        const a = (k / 8) * Math.PI * 2;
        arm.position.set(Math.cos(a) * 0.4, -0.05, Math.sin(a) * 0.4);
        arm.rotation.set(0, -a, Math.PI / 2);
        g.add(arm);
      }
      g.position.set(0, WALL_H - 1.5, zone === 'mirrors' ? c + 1.5 : c);
      this.scene.add(g);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        this.candle(Math.cos(a) * 0.8, g.position.y + 0.04, g.position.z + Math.sin(a) * 0.8);
      }
      if (this.quality !== 'low') this.addLight(0, g.position.y - 0.4, g.position.z, '#ffc48a', 14, 16);
    }

    // moonlit arched windows with a pool of light on the floor
    const windows: Record<ZoneId, [number, number][]> = {
      library: [[1, -4.6]],
      symbols: [[-1, -3.5], [1, 3.5]],
      echo: [[-1, 2.2]],
      mirrors: [],
      items: [[-1, -3.8]],
      portal: [[-1, 0], [1, 0]],
    };
    for (const [sx, wz] of windows[zone]) {
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.45), new THREE.MeshBasicMaterial({ map: windowTexture(), transparent: true }));
      glass.rotation.y = -sx * Math.PI / 2;
      glass.position.set(sx * (W - 0.02), 3.3, c + wz);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.75, 1.7), this.std('#5d5866', { map: stoneTexture([1, 2]) }));
      frame.position.set(sx * (W - 0.0), 3.25, c + wz);
      const sill = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 1.8), this.std('#6a6470'));
      sill.position.set(sx * (W - 0.18), 2.0, c + wz);
      this.scene.add(frame, glass, sill);
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 3.4), new THREE.MeshBasicMaterial({
        map: glowSpriteTexture('#8fb4ff'), transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(sx * (W - 2.2), 0.02, c + wz);
      const shaft = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 4.2), new THREE.MeshBasicMaterial({
        map: glowSpriteTexture('#a9c6ff'), transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
      shaft.position.set(sx * (W - 1.2), 1.7, c + wz);
      shaft.rotation.set(0, Math.PI / 2, sx * 0.55);
      this.scene.add(pool, shaft);
    }

    // landscape paintings in gilded frames
    const paintings: Record<ZoneId, [number, number][]> = {
      library: [],
      symbols: [[-1, 4.6]],
      echo: [[1, -0.8]],
      mirrors: [],
      items: [[-1, 1.0]],
      portal: [],
    };
    paintings[zone].forEach(([sx, pz], k) => {
      const g = new THREE.Group();
      const art = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.1), this.std('#ffffff', { map: paintingTexture(i * 3 + k), roughness: 0.6 }));
      art.position.z = 0.05;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.75, 1.35, 0.08), this.std('#c9a24d', { metalness: 0.8, roughness: 0.35 }));
      g.add(frame, art);
      g.rotation.y = -sx * Math.PI / 2;
      g.position.set(sx * (W - 0.06), 3.2, c + pz);
      this.scene.add(g);
    });

    // rugs
    const rugs: Partial<Record<ZoneId, [number, number, number, number, string, string]>> = {
      echo: [0, -1, 6.5, 4.2, '#23345a', '#c9a24d'],
      mirrors: [0, -1.5, 5, 6, '#3a1d4a', '#d6b46a'],
      items: [0, 2.6, 4.5, 3, '#4a2a18', '#d0a050'],
    };
    const rg = rugs[zone];
    if (rg) {
      const rug = new THREE.Mesh(new THREE.PlaneGeometry(rg[2], rg[3]), this.std('#ffffff', { map: rugTexture(rg[4], rg[5], i), roughness: 0.95 }));
      rug.rotation.x = -Math.PI / 2;
      rug.position.set(rg[0], 0.012, c + rg[1]);
      this.scene.add(rug);
    }
  }

  /** One soft shadow-casting light that moves to the room the player is in. */
  private keyLight?: THREE.SpotLight;

  private placeKeyLight(zone: ZoneId) {
    if (!this.keyLight) return;
    const c = zoneCenter(zone);
    this.keyLight.position.set(1.2, WALL_H - 0.6, c + 2.5);
    this.keyLight.target.position.set(0, 0, c - 0.5);
  }

  private buildLibrary(scenario: ScenarioContent | null) {
    const c = zoneCenter('library');
    // bookshelves
    const shelfMat = this.std('#3b2416');
    const addShelf = (x: number, z: number, rotY: number, len: number, seed: number) => {
      const g = new THREE.Group();
      const back = new THREE.Mesh(new THREE.BoxGeometry(len, 4.4, 0.5), shelfMat);
      back.position.y = 2.2;
      g.add(back);
      for (let k = 0; k < 5; k++) {
        const books = new THREE.Mesh(new THREE.PlaneGeometry(len - 0.3, 0.7), this.std('#ffffff', { map: bookSpinesTexture(seed + k) }));
        books.position.set(0, 0.55 + k * 0.85, 0.26);
        g.add(books);
      }
      g.position.set(x, 0, z);
      g.rotation.y = rotY;
      this.scene.add(g);
    };
    addShelf(-ROOM_HALF_W + 0.3, c - 2, Math.PI / 2, 5, 1);
    addShelf(-ROOM_HALF_W + 0.3, c + 4.1, Math.PI / 2, 3.4, 9);
    this.buildWallMap(scenario, c);
    addShelf(ROOM_HALF_W - 0.3, c + 3.6, -Math.PI / 2, 4.4, 17);
    addShelf(-4.8, c - ROOM_HALF_D + 0.3, 0, 4.6, 23);
    addShelf(4.8, c - ROOM_HALF_D + 0.3, 0, 4.6, 31);

    // lectern with the key book
    const lectern = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.3, 1.0, 8), shelfMat);
    lectern.position.set(-5.2, 0.5, c - 2.5);
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.7), shelfMat);
    top.position.set(-5.2, 1.05, c - 2.5);
    top.rotation.x = -0.35;
    const pages = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.05, 0.55), this.std('#f1e2bd'));
    pages.position.set(-5.2, 1.12, c - 2.5);
    pages.rotation.x = -0.35;
    this.scene.add(lectern, top, pages);
    this.candle(-4.6, 1.05, c - 2.2, true);

    // parchment with the secret writing
    const pc = document.createElement('canvas');
    pc.width = 512;
    pc.height = 360;
    const g = pc.getContext('2d')!;
    const img = parchmentTexture().image as HTMLCanvasElement;
    g.drawImage(img, 0, 0, 512, 360);
    const message: string[] = scenario?.puzzles.find((p) => p.id === 'p1-cipher')?.publicData?.message ?? [];
    message.forEach((s, k) => drawSymbol(g, s, 512 - 110 - k * 145, 180, 110, '#3b2410'));
    const ptex = new THREE.CanvasTexture(pc);
    ptex.colorSpace = THREE.SRGBColorSpace;
    const parchment = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.55), this.std('#ffffff', { map: ptex, roughness: 1 }));
    parchment.rotation.y = -Math.PI / 2;
    parchment.position.set(ROOM_HALF_W - 0.04, 2.4, c - 1.5);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.8, 2.45), this.std('#5a3a1e', { metalness: 0.3 }));
    frame.position.set(ROOM_HALF_W - 0.02, 2.4, c - 1.5);
    this.scene.add(frame, parchment);

    // desk with the iron handle
    const desk = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.9, 1), shelfMat);
    desk.position.set(5.4, 0.45, c + 4.2);
    this.scene.add(desk);
    const handle = new THREE.Group();
    const bar = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 8, 16, Math.PI), this.std('#5c5c66', { metalness: 0.8, roughness: 0.35 }));
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.4, 8), this.std('#5c5c66', { metalness: 0.8, roughness: 0.35 }));
    base.rotation.z = Math.PI / 2;
    handle.add(bar, base);
    handle.position.set(5.4, 1.0, c + 4.2);
    this.addItem('handle', handle);
    this.candle(4.8, 0.9, c + 4.0, true);

    // reading table, rug, guide character
    const table = new THREE.Mesh(new THREE.BoxGeometry(3, 0.12, 1.4), shelfMat);
    table.position.set(0, 0.85, c + 0.5);
    for (const [x, z] of [[-1.3, -0.55], [1.3, -0.55], [-1.3, 0.55], [1.3, 0.55]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.85, 0.1), shelfMat);
      leg.position.set(x, 0.42, c + 0.5 + z);
      this.scene.add(leg);
    }
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(6, 4), this.std('#ffffff', { map: rugTexture('#5e1d22', '#c9a24d', 3), roughness: 0.95 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0, 0.01, c + 0.5);
    this.scene.add(table, rug);
    this.candle(-0.8, 0.91, c + 0.5);
    this.candle(0.8, 0.91, c + 0.5);
    this.addLight(0, 2.6, c + 0.5, '#ffb066', 9, 12);
    this.sconce(-ROOM_HALF_W + 0.15, 2.8, c - 5.5, 1);
    this.sconce(ROOM_HALF_W - 0.15, 2.8, c - 5.5, -1);

    this.guide = new BoyAvatar('scholar', { skin: 1, hair: 0, glasses: 1, bag: 2 }, 'יהודה המדריך');
    this.guide.root.position.set(-3.2, 0, c + 4.2);
    this.guide.root.rotation.y = 0.6;
    this.scene.add(this.guide.root);
  }

  /** Framed parchment map of the mansion, hanging between the library shelves. */
  private buildWallMap(scenario: ScenarioContent | null, c: number) {
    const names: Record<string, string> = Object.fromEntries((scenario?.zones ?? []).map((z) => [z.id, z.name]));
    const icons: Record<string, string> = Object.fromEntries((scenario?.zones ?? []).map((z) => [z.id, z.icon]));
    const cv = document.createElement('canvas');
    cv.width = 512;
    cv.height = 384;
    const g = cv.getContext('2d')!;
    g.drawImage(parchmentTexture().image as HTMLCanvasElement, 0, 0, 512, 384);
    g.direction = 'rtl';
    g.textAlign = 'center';
    g.fillStyle = '#3b2410';
    g.font = 'bold 34px "Frank Ruhl Libre", Heebo, serif';
    g.fillText('מפת האחוזה', 256, 44);
    // six rooms on a winding path, starting at the right like Hebrew reading order
    const cells: [number, number][] = [[400, 125], [256, 125], [112, 125], [112, 280], [256, 280], [400, 280]];
    g.strokeStyle = '#5a3a1c';
    g.lineWidth = 6;
    g.setLineDash([12, 10]);
    g.beginPath();
    cells.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
    g.setLineDash([]);
    ZONE_ORDER.forEach((z, k) => {
      const [x, y] = cells[k];
      g.fillStyle = k === ZONE_ORDER.length - 1 ? 'rgba(80,130,220,0.35)' : 'rgba(120,80,30,0.18)';
      g.strokeStyle = '#3b2410';
      g.lineWidth = 4;
      g.beginPath();
      g.roundRect(x - 62, y - 42, 124, 84, 12);
      g.fill();
      g.stroke();
      drawSymbol(g, icons[z] ?? 'lock', x, y - 12, 34, '#3b2410');
      g.fillStyle = '#3b2410';
      g.font = 'bold 19px Heebo, Arial, sans-serif';
      g.fillText(names[z] ?? z, x, y + 30);
    });
    g.fillStyle = '#8a1f1f';
    g.beginPath();
    g.arc(452, 96, 9, 0, Math.PI * 2);
    g.fill();
    g.font = 'bold 16px Heebo, Arial, sans-serif';
    g.fillText('אתם כאן', 452, 78);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const art = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.2), this.std('#ffffff', { map: tex, roughness: 1 }));
    art.rotation.y = Math.PI / 2;
    art.position.set(-ROOM_HALF_W + 0.07, 2.3, c + 1.45);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.38, 1.78), this.std('#6b4422', { roughness: 0.6 }));
    frame.position.set(-ROOM_HALF_W + 0.03, 2.3, c + 1.45);
    this.scene.add(frame, art);
  }

  private buildSymbols(scenario: ScenarioContent | null) {
    const c = zoneCenter('symbols');
    const plaques: { id: string; text: string }[] = scenario?.puzzles.find((p) => p.id === 'p2-sequence')?.publicData?.plaques ?? [];
    for (const def of INTERACTABLES.filter((d) => d.panel === 'plaque')) {
      const text = plaques.find((p) => p.id === def.ref)?.text ?? '';
      const slab = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.35, 0.15), [
        this.std('#55555a'), this.std('#55555a'), this.std('#55555a'), this.std('#55555a'),
        this.std('#ffffff', { map: plaqueTexture(text) }), this.std('#55555a'),
      ]);
      const [x, y, z] = worldPos(def);
      slab.position.set(x, y, z);
      if (Math.abs(x) > 7) slab.rotation.y = x > 0 ? -Math.PI / 2 : Math.PI / 2;
      else slab.rotation.y = Math.PI;
      slab.position.x += Math.abs(x) > 7 ? (x > 0 ? 0.05 : -0.05) : 0;
      this.scene.add(slab);
    }
    // floor mosaic with the four symbols
    const mc = document.createElement('canvas');
    mc.width = mc.height = 512;
    const g = mc.getContext('2d')!;
    g.fillStyle = '#2c2a33';
    g.beginPath();
    g.arc(256, 256, 250, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#c9a24d';
    g.lineWidth = 10;
    g.stroke();
    ['leaf', 'star', 'crown', 'sun'].forEach((s, k) => {
      const a = (k / 4) * Math.PI * 2;
      drawSymbol(g, s, 256 + Math.cos(a) * 150, 256 + Math.sin(a) * 150, 100, '#c9a24d');
    });
    const mt = new THREE.CanvasTexture(mc);
    mt.colorSpace = THREE.SRGBColorSpace;
    const mosaic = new THREE.Mesh(new THREE.CircleGeometry(3, 48), this.std('#ffffff', { map: mt, transparent: true }));
    mosaic.rotation.x = -Math.PI / 2;
    mosaic.position.set(0, 0.015, c);
    this.scene.add(mosaic);
    for (const [x, z] of [[-6.6, -5.6], [6.6, -5.6], [-6.6, 5.6], [6.6, 5.6]]) {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, WALL_H, 12), this.std('#8a8290', { map: stoneTexture([1, 3]) }));
      pillar.position.set(x, WALL_H / 2, c + z);
      this.scene.add(pillar);
      this.brazier(x * 0.85, c + z * 0.75);
    }
  }

  private brazier(x: number, z: number) {
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.18, 0.3, 12), this.std('#2a2220', { metalness: 0.6 }));
    bowl.position.set(x, 1.0, z);
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.12, 1.0, 8), this.std('#2a2220', { metalness: 0.6 }));
    stand.position.set(x, 0.5, z);
    const fire = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowSpriteTexture('#ff9a3c'), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    fire.scale.set(1, 1.2, 1);
    fire.position.set(x, 1.45, z);
    this.scene.add(bowl, stand, fire);
    this.animated.push((t) => fire.scale.set(0.95 + Math.sin(t * 9 + x) * 0.08, 1.2 + Math.sin(t * 11 + z) * 0.12, 1));
    if (this.quality !== 'low' || Math.abs(z % 2) < 1) this.addLight(x, 1.9, z, '#ff9a4a', 5, 9);
  }

  private buildEcho(scenario: ScenarioContent | null) {
    const c = zoneCenter('echo');
    const bells: { id: string; label: string }[] = scenario?.puzzles.find((p) => p.id === 'p3-sound')?.publicData?.bells ?? [];
    const beam = new THREE.Mesh(new THREE.BoxGeometry(8, 0.3, 0.3), this.std('#3a2a1c'));
    beam.position.set(0, 4.4, c - 1);
    this.scene.add(beam);
    const pts = [new THREE.Vector2(0.02, 0.6), new THREE.Vector2(0.18, 0.55), new THREE.Vector2(0.25, 0.3), new THREE.Vector2(0.32, 0.05), new THREE.Vector2(0.42, -0.1), new THREE.Vector2(0.4, -0.14)];
    const bronze = this.std('#b07d3a', { metalness: 0.85, roughness: 0.3 });
    bells.forEach((b, k) => {
      const x = -3 + k * 2;
      const group = new THREE.Group();
      group.position.set(x, 4.3, c - 1);
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.6, 4), this.std('#6b5a3a'));
      rope.position.y = -0.3;
      const bell = new THREE.Mesh(new THREE.LatheGeometry(pts, 24), bronze);
      bell.position.y = -1.2;
      bell.material = bronze;
      (bell.material as THREE.Material).side = THREE.DoubleSide;
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.position.y = -1.2;
      group.add(rope, bell, glow);
      const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(b.label, { bg: 'rgba(20,16,10,0.85)', color: '#f0cf7a', width: 128, height: 128 }), transparent: true }));
      tag.scale.set(0.8, 0.8, 1);
      tag.position.set(x, 2.3, c - 1);
      this.scene.add(group, tag);
      this.bells.set(b.id, { group, glow, swing: 0 });
    });
    // music box
    const tableTop = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 1), this.std('#3b2416'));
    tableTop.position.set(-5, 0.8, c + 2.5);
    const tableLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.15, 0.8, 8), this.std('#3b2416'));
    tableLeg.position.set(-5, 0.4, c + 2.5);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.35, 0.45), this.std('#6b3a1a', { roughness: 0.5 }));
    box.position.set(-5, 1.03, c + 2.5);
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.6, 20, 1, true), this.std('#c9a24d', { metalness: 0.8, roughness: 0.3, side: THREE.DoubleSide }));
    horn.position.set(-5, 1.45, c + 2.35);
    horn.rotation.x = -0.9;
    this.scene.add(tableTop, tableLeg, box, horn);
    // crystal niche
    const niche = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.1, 0.9), this.std('#1d1a24'));
    niche.position.set(ROOM_HALF_W - 0.08, 1.3, c - 4.5);
    this.scene.add(niche);
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.25, 0), new THREE.MeshStandardMaterial({ color: '#4aa8ff', emissive: '#2a6dff', emissiveIntensity: 1.6, roughness: 0.15, metalness: 0.2 }));
    crystal.scale.y = 1.6;
    crystal.position.set(6.2, 1.3, c - 4.5);
    this.addItem('crystal', crystal);
    this.sconce(-ROOM_HALF_W + 0.15, 2.8, c - 4, 1);
    this.sconce(ROOM_HALF_W - 0.15, 2.8, c + 3, -1);
    this.addLight(0, 3.2, c - 1, '#ffcf8a', 6, 10);
  }

  ringBell(id: string) {
    const b = this.bells.get(id);
    if (b) b.swing = 1;
  }

  private buildMirrors() {
    const c = zoneCenter('mirrors');
    const gold = this.std('#c9a24d', { metalness: 0.9, roughness: 0.3 });
    for (const def of INTERACTABLES.filter((d) => d.panel === 'mirror')) {
      const [x, y, z] = worldPos(def);
      const g = new THREE.Group();
      let glass: THREE.Object3D;
      if (this.quality === 'high') {
        glass = new Reflector(new THREE.PlaneGeometry(1.6, 2.8), {
          textureWidth: 512, textureHeight: 896, color: new THREE.Color('#9aa4c8'),
        });
      } else {
        glass = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.8), new THREE.MeshStandardMaterial({ color: '#8fa0d0', metalness: 1, roughness: 0.08, emissive: '#1a2448' }));
      }
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.9, 3.1, 0.1), gold);
      frame.position.z = -0.06;
      g.add(frame, glass);
      g.position.set(x, y, z);
      if (Math.abs(x) > 7) {
        g.rotation.y = x > 0 ? -Math.PI / 2 : Math.PI / 2;
        g.position.x += x > 0 ? -0.1 : 0.1;
      } else {
        g.rotation.y = Math.PI;
        g.position.z -= 0.1;
      }
      this.scene.add(g);
      const shimmer = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowSpriteTexture('#9fc3ff'), blending: THREE.AdditiveBlending, transparent: true, opacity: 0.35, depthWrite: false }));
      shimmer.scale.set(2.2, 3.2, 1);
      shimmer.position.copy(g.position);
      this.scene.add(shimmer);
      this.animated.push((t) => ((shimmer.material as THREE.SpriteMaterial).opacity = 0.2 + Math.sin(t * 1.5 + x) * 0.12));
    }
    // chest with three-digit lock
    const chest = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.75, 0.85), this.std('#5a3418'));
    body.position.y = 0.375;
    const bands = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.12, 0.89), gold);
    bands.position.y = 0.55;
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.25, 0.06), gold);
    lock.position.set(0, 0.5, 0.45);
    const lidPivot = new THREE.Group();
    lidPivot.position.set(0, 0.75, -0.42);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.22, 0.85), this.std('#5a3418'));
    lid.position.set(0, 0.11, 0.42);
    lidPivot.add(lid);
    chest.add(body, bands, lock, lidPivot);
    chest.position.set(0, 0, c - 2.5);
    this.scene.add(chest);
    this.chestLid = lidPivot;
    const gear = this.gearMesh();
    gear.position.set(0, 1.0, c - 2.5);
    this.addItem('gear', gear);
    this.addLight(0, 3.5, c, '#c8d6ff', 8, 12);
    this.sconce(-ROOM_HALF_W + 0.15, 2.8, c - 5, 1);
    this.sconce(ROOM_HALF_W - 0.15, 2.8, c + 4, -1);
  }

  private gearMesh() {
    const copper = this.std('#c27a42', { metalness: 0.85, roughness: 0.3 });
    const g = new THREE.Group();
    const disk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.07, 24), copper);
    g.add(disk);
    for (let k = 0; k < 10; k++) {
      const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.09), copper);
      const a = (k / 10) * Math.PI * 2;
      tooth.position.set(Math.cos(a) * 0.25, 0, Math.sin(a) * 0.25);
      tooth.rotation.y = -a;
      g.add(tooth);
    }
    g.rotation.x = Math.PI / 2;
    return g;
  }

  private buildItemsRoom() {
    const c = zoneCenter('items');
    const wood = this.std('#4a2e1a');
    const bench = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 1.1), wood);
    bench.position.set(-5, 0.95, c + 1);
    this.scene.add(bench);
    for (const [x, z] of [[-1.2, -0.45], [1.2, -0.45], [-1.2, 0.45], [1.2, 0.45]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.95, 0.1), wood);
      leg.position.set(-5 + x, 0.47, c + 1 + z);
      this.scene.add(leg);
    }
    const vise = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.25, 0.3), this.std('#555', { metalness: 0.7 }));
    vise.position.set(-5.8, 1.12, c + 1);
    const hammer = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.06), wood);
    hammer.position.set(-4.5, 1.05, c + 1.2);
    this.scene.add(vise, hammer);
    this.candle(-4.2, 1.01, c + 0.7, true);

    // pedestal with two sockets
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.2, 1.1, 8), this.std('#7a7380', { map: stoneTexture([2, 1]) }));
    ped.position.set(0, 0.55, c - 3);
    this.scene.add(ped);
    for (const [id, x] of [['mechanism', -0.4], ['crystal', 0.4]] as [string, number][]) {
      const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 16), this.std('#1d1a24'));
      socket.position.set(x, 1.13, c - 3);
      this.scene.add(socket);
      const placed = id === 'crystal'
        ? new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), new THREE.MeshStandardMaterial({ color: '#4aa8ff', emissive: '#2a6dff', emissiveIntensity: 2 }))
        : this.gearMesh();
      placed.position.set(x, 1.4, c - 3);
      placed.visible = false;
      this.scene.add(placed);
      this.pedestalSlots.set(id, placed);
    }
    // shelves with decor
    for (let k = 0; k < 4; k++) {
      const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.35, 10), this.std(['#2f5d50', '#6b3a1a', '#3b4a6b', '#7a6a2a'][k], { transparent: true, opacity: 0.85 }));
      jar.position.set(ROOM_HALF_W - 0.5, 1.2, c - 2 + k * 0.7);
      this.scene.add(jar);
    }
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 3.4), wood);
    shelf.position.set(ROOM_HALF_W - 0.5, 1.0, c - 0.95);
    this.scene.add(shelf);
    this.addLight(0, 3.5, c - 2, '#ffbe7a', 8, 11);
    this.sconce(ROOM_HALF_W - 0.15, 2.8, c + 4, -1);
  }

  private buildPortal(scenario: ScenarioContent | null) {
    const c = zoneCenter('portal');
    const pz = c - 5.6;
    this.portalMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uPower: { value: this.portalPower } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `
        varying vec2 vUv; uniform float uTime; uniform float uPower;
        void main(){
          vec2 p = vUv - 0.5; float r = length(p) * 2.0; float a = atan(p.y, p.x);
          float swirl = sin(a * 5.0 + r * 12.0 - uTime * 2.5) * 0.5 + 0.5;
          float swirl2 = sin(a * 3.0 - r * 8.0 + uTime * 1.7) * 0.5 + 0.5;
          float core = smoothstep(1.0, 0.0, r);
          vec3 col = mix(vec3(0.15,0.35,1.0), vec3(0.65,0.9,1.0), swirl * swirl2);
          col += vec3(1.0) * pow(core, 4.0) * uPower;
          float alpha = core * (0.35 + 0.65 * swirl) * clamp(uPower, 0.05, 1.5);
          gl_FragColor = vec4(col * (0.6 + uPower), alpha);
        }`,
    });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(2.3, 64), this.portalMat);
    disc.position.set(0, 3.2, pz + 0.05);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.45, 0.22, 16, 64), this.std('#c9a24d', { metalness: 0.9, roughness: 0.25, emissive: '#3a2a08' }));
    ring.position.set(0, 3.2, pz);
    this.scene.add(disc, ring);
    const base = new THREE.Mesh(new THREE.BoxGeometry(6, 0.6, 1.4), this.std('#5d5f7d', { map: stoneTexture([3, 1]) }));
    base.position.set(0, 0.3, pz);
    this.scene.add(base);
    this.portalLight = this.addLight(0, 3.2, pz + 1.5, '#6aa8ff', 10, 16, false);

    // five letter slots, each marked with a zone icon
    const slots: string[] = scenario?.puzzles.find((p) => p.id === 'p6-final')?.publicData?.slots ?? [];
    const icon: Record<string, string> = Object.fromEntries((scenario?.zones ?? []).map((z) => [z.id, z.icon]));
    slots.forEach((zone, k) => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 128;
      const g = cv.getContext('2d')!;
      g.fillStyle = '#1b1f35';
      g.fillRect(0, 0, 128, 128);
      g.strokeStyle = '#c9a24d';
      g.lineWidth = 6;
      g.strokeRect(4, 4, 120, 120);
      drawSymbol(g, icon[zone] ?? 'lock', 64, 64, 70, '#c9a24d');
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), this.std('#ffffff', { map: t }));
      // slot 1 is on the right (Hebrew reading order)
      plate.position.set(1.8 - k * 0.9, 0.95, pz + 0.72);
      this.scene.add(plate);
      this.letterSlots.set(zone, plate);
    });

    // floating particles
    const n = this.quality === 'low' ? 150 : 450;
    const geo = new THREE.BufferGeometry();
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) arr.set([(Math.random() - 0.5) * 8, Math.random() * 6, pz + Math.random() * 6], i * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    this.portalParticles = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#9fd0ff', size: 0.06, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.scene.add(this.portalParticles);
    for (const [x, z] of [[-6, -4], [6, -4], [-6, 3], [6, 3]]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, WALL_H, 12), this.std('#8d8aa8', { map: stoneTexture([1, 3]) }));
      col.position.set(x, WALL_H / 2, c + z);
      this.scene.add(col);
    }
    this.brazier(-4, c + 1);
    this.brazier(4, c + 1);
  }

  private addItem(id: string, obj: THREE.Object3D) {
    obj.visible = false;
    this.scene.add(obj);
    this.itemMeshes.set(id, obj);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowSpriteTexture('#ffe6a0'), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.6 }));
    halo.scale.set(0.9, 0.9, 1);
    obj.add(halo);
    const y0 = obj.position.y;
    this.animated.push((t) => {
      obj.position.y = y0 + Math.sin(t * 2 + y0) * 0.06;
      obj.rotation.y = t * 0.8;
    });
  }

  // ======================================================================= state

  applySnapshot(s: RoomSnapshot) {
    const newly = s.unlockedZones.filter((z) => !this.unlocked.has(z));
    this.unlocked = new Set(s.unlockedZones);
    this.rects = walkableRects(this.unlocked);
    for (const [zone] of this.doors) this.doorOpen.set(zone, this.unlocked.has(zone) ? 1 : 0);
    this.worldItems = new Set(s.worldItems);
    for (const [id, mesh] of this.itemMeshes) mesh.visible = this.worldItems.has(id);
    for (const [id, mesh] of this.pedestalSlots) mesh.visible = s.placedItems.includes(id);
    this.chestTarget = s.puzzles.find((p) => p.id === 'p4-split')?.status === 'solved' ? 1 : 0;
    const finalSolved = s.puzzles.find((p) => p.id === 'p6-final')?.status === 'solved';
    this.portalTarget = finalSolved ? 1.4 : this.unlocked.has('portal') ? 0.55 : 0.25;
    for (const l of s.letters) {
      const plate = this.letterSlots.get(l.zone);
      if (plate) (plate.material as THREE.MeshStandardMaterial).emissive = new THREE.Color('#3a2a08');
    }
    return newly;
  }

  /** Brief pulse on a door when the server announces it opened. */
  private doorProgress = new Map<ZoneId, number>();

  setPlayers(players: PlayerDto[], myId: string | null, positions: Map<string, RemotePosition & { t: number }>) {
    this.positions = positions;
    this.myId = myId ?? undefined;
    const me = players.find((p) => p.id === myId);
    if (me && !this.local) {
      this.local = new BoyAvatar(me.characterId, me.appearance);
      this.scene.add(this.local.root);
      this.local.root.position.copy(this.localPos);
    }
    const ids = new Set(players.filter((p) => p.id !== myId).map((p) => p.id));
    for (const [id, r] of this.remotes) {
      if (!ids.has(id)) {
        this.scene.remove(r.avatar.root);
        r.avatar.dispose();
        this.remotes.delete(id);
      }
    }
    players.forEach((p) => {
      if (p.id === myId) return;
      let r = this.remotes.get(p.id);
      if (!r) {
        const avatar = new BoyAvatar(p.characterId, p.appearance, p.nickname);
        const start = new THREE.Vector3(-2 + (p.seat % 5) * 1, 0, SPAWN.z + 0.8);
        avatar.root.position.copy(start);
        this.scene.add(avatar.root);
        r = { avatar, pos: start.clone(), yaw: Math.PI, speed: 0, connected: true };
        this.remotes.set(p.id, r);
      }
      if (r.connected !== p.isConnected) {
        r.avatar.setConnected(p.isConnected);
        r.connected = p.isConnected;
      }
    });
  }

  /** Puts the local player back at the start (new round). */
  resetPlayer() {
    this.localPos.copy(SPAWN);
    this.localYaw = Math.PI;
    this.camYaw = 0;
  }

  /** Restores the local player position after a reconnect. */
  placePlayer(p: RemotePosition) {
    if (this.canStand(p.x, p.z)) this.localPos.set(p.x, 0, p.z);
  }

  focusOn(objectId: string) {
    const t = this.hitTargets.get(objectId);
    if (!t) return null;
    return t.position.clone();
  }

  setMode(mode: WorldMode) {
    this.mode = mode;
    this.modeTime = 0;
    if (this.gateGlow) this.gateGlow.visible = mode === 'intro' || mode === 'showcase';
    if (this.local) this.local.root.visible = mode !== 'showcase' && mode !== 'intro';
    for (const r of this.remotes.values()) r.avatar.root.visible = mode !== 'showcase' && mode !== 'intro';
    if (mode === 'outro') this.portalTarget = 1.6;
  }

  /** Seeks the opening cinematic to the given second (keeps every client in sync after a late join). */
  setIntroTime(seconds: number) {
    this.modeTime = seconds;
  }

  setJoystick(x: number, y: number) {
    this.joystick.set(x, y);
  }

  // ======================================================================= loop

  start() {
    let lastFrame = performance.now();
    const loop = () => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      lastFrame = performance.now();
      const dt = Math.min(0.05, this.clock.getDelta());
      this.tick(dt, this.clock.elapsedTime);
    };
    loop();
    // Some embedded/throttled views stop requestAnimationFrame while the page still counts as visible;
    // keep the world (movement, other players, doors) updating at a low rate in that case.
    this.watchdog = setInterval(() => {
      if (this.disposed || document.hidden || performance.now() - lastFrame < 250) return;
      const dt = Math.min(0.1, this.clock.getDelta());
      this.tick(dt, this.clock.elapsedTime);
    }, 100);
  }

  private watchdog?: ReturnType<typeof setInterval>;

  private tick(dt: number, t: number) {
    this.modeTime += dt;
    for (const f of this.flickers) f.light.intensity = f.base * (0.85 + 0.15 * Math.sin(t * 9 + f.seed) * Math.sin(t * 5.3 + f.seed * 2));
    for (const a of this.animated) a(t, dt);
    for (const [zone, door] of this.doors) {
      const target = this.doorOpen.get(zone) ?? 0;
      const cur = this.doorProgress.get(zone) ?? target;
      const next = THREE.MathUtils.lerp(cur, target, Math.min(1, dt * 1.2));
      this.doorProgress.set(zone, next);
      door.position.y = DOOR_GAP_H / 2 + next * (DOOR_GAP_H + 0.2);
    }
    this.chestOpen = THREE.MathUtils.lerp(this.chestOpen, this.chestTarget, Math.min(1, dt * 2));
    if (this.chestLid) this.chestLid.rotation.x = -this.chestOpen * 1.9;
    for (const b of this.bells.values()) {
      b.swing = Math.max(0, b.swing - dt * 0.6);
      b.group.rotation.z = Math.sin(t * 12) * 0.3 * b.swing;
      (b.glow.material as THREE.MeshBasicMaterial).opacity = b.swing * 0.8;
    }
    this.portalPower = THREE.MathUtils.lerp(this.portalPower, this.portalTarget, Math.min(1, dt * 0.8));
    if (this.portalMat) {
      this.portalMat.uniforms['uTime'].value = t;
      this.portalMat.uniforms['uPower'].value = this.portalPower;
    }
    if (this.portalLight) this.portalLight.intensity = 6 + this.portalPower * 30;
    if (this.portalParticles) {
      this.portalParticles.rotation.y = Math.sin(t * 0.1) * 0.05;
      const p = this.portalParticles.geometry.attributes['position'] as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        let y = p.getY(i) + dt * (0.2 + this.portalPower * 0.6);
        if (y > 6) y = 0;
        p.setY(i, y);
      }
      p.needsUpdate = true;
    }
    if (this.gateGlow) (this.gateGlow.material as THREE.MeshBasicMaterial).opacity = 0.35 + Math.sin(t * 2) * 0.15;
    this.guide?.update(dt, 0, t);

    if (this.mode === 'showcase') this.showcaseCamera(t);
    else if (this.mode === 'intro') this.introCamera(this.modeTime);
    else if (this.mode === 'outro') this.outroCamera(this.modeTime, t);
    else if (this.mode === 'cutscene' && this.cut) this.cutsceneCamera(dt, t);
    else if (this.mode === 'tour') this.tourCamera(t);
    else this.playUpdate(dt, t);

    this.updateRemotes(dt, t);
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  private showcaseCamera(t: number) {
    const a = t * 0.05;
    this.camera.position.set(Math.sin(a) * 30, 9 + Math.sin(t * 0.1) * 2, 34 + Math.cos(a) * 12);
    this.camera.lookAt(0, 6, ROOM_HALF_D);
  }

  /** Opening cinematic: establishing shot → approach → through the gate → library reveal. */
  private introCamera(s: number) {
    const keys: [number, THREE.Vector3, THREE.Vector3][] = [
      [0, new THREE.Vector3(34, 18, 70), new THREE.Vector3(0, 8, ROOM_HALF_D)],
      [11, new THREE.Vector3(14, 9, 42), new THREE.Vector3(0, 6, ROOM_HALF_D)],
      [22, new THREE.Vector3(0, 3.4, 26), new THREE.Vector3(0, 2.5, ROOM_HALF_D)],
      [33, new THREE.Vector3(0, 2.3, 13), new THREE.Vector3(0, 2.1, ROOM_HALF_D)],
      [41, new THREE.Vector3(0, 2.0, 5.5), new THREE.Vector3(0, 1.8, -2)],
      [52, new THREE.Vector3(2.5, 3.2, 3), new THREE.Vector3(-3.5, 1.2, -2.5)],
    ];
    let i = 0;
    while (i < keys.length - 2 && s > keys[i + 1][0]) i++;
    const [t0, p0, l0] = keys[i];
    const [t1, p1, l1] = keys[i + 1];
    const k = THREE.MathUtils.smootherstep(Math.min(1, Math.max(0, (s - t0) / (t1 - t0))), 0, 1);
    this.camera.position.lerpVectors(p0, p1, k);
    const look = new THREE.Vector3().lerpVectors(l0, l1, k);
    this.camera.lookAt(look);
  }

  private outroCamera(s: number, t: number) {
    const c = zoneCenter('portal');
    const from = new THREE.Vector3(0, 2.6, c + 5);
    const to = new THREE.Vector3(0, 2.2, c + 0.5);
    this.camera.position.lerpVectors(from, to, THREE.MathUtils.smootherstep(Math.min(1, s / 8), 0, 1));
    this.camera.lookAt(0, 3, c - 5.6);
    // everyone gathers in front of the portal and cheers
    const all = [this.local, ...[...this.remotes.values()].map((r) => r.avatar)].filter(Boolean) as BoyAvatar[];
    all.forEach((a, k) => {
      const x = (k - (all.length - 1) / 2) * 1.1;
      a.root.position.lerp(new THREE.Vector3(x, 0, c - 2.6), 0.05);
      a.root.rotation.y = Math.PI;
      a.root.visible = true;
      if (s > 2.5) a.cheer(t + k);
      else a.update(0.016, 2, t);
    });
  }

  private playUpdate(dt: number, t: number) {
    if (!this.local) return;
    // movement relative to camera yaw
    let fx = 0;
    let fz = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) fz += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) fz -= 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) fx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) fx += 1;
    fx += this.joystick.x;
    fz += this.joystick.y;
    const len = Math.hypot(fx, fz);
    const run = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const speed = (run ? 5.5 : 3.4) * Math.min(1, len);
    if (len > 0.05) {
      const nx = fx / len;
      const nz = fz / len;
      // camera looks along -Z when camYaw = 0
      const sin = Math.sin(this.camYaw);
      const cos = Math.cos(this.camYaw);
      const dx = nx * cos - nz * sin;
      const dz = -nx * sin - nz * cos;
      const step = speed * dt;
      const tx = this.localPos.x + dx * step;
      const tz = this.localPos.z + dz * step;
      if (this.canStand(tx, tz)) this.localPos.set(tx, 0, tz);
      else if (this.canStand(tx, this.localPos.z)) this.localPos.x = tx;
      else if (this.canStand(this.localPos.x, tz)) this.localPos.z = tz;
      const targetYaw = Math.atan2(dx, dz);
      let diff = targetYaw - this.localYaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.localYaw += diff * Math.min(1, dt * 12);
      this.localSpeed = speed;
    } else this.localSpeed = 0;
    if (!inRects(this.rects, this.localPos.x, this.localPos.z)) this.localPos.copy(SPAWN);
    this.local.root.position.copy(this.localPos);
    this.local.root.rotation.y = this.localYaw;
    this.local.update(dt, this.localSpeed, t);

    // third-person camera, pulled in when a wall is behind the player
    const pivot = new THREE.Vector3(this.localPos.x, 1.6, this.localPos.z);
    let dist = this.camDist;
    const dir = new THREE.Vector3(Math.sin(this.camYaw) * Math.cos(this.camPitch), Math.sin(this.camPitch), Math.cos(this.camYaw) * Math.cos(this.camPitch));
    const cam = new THREE.Vector3();
    const roomish = this.rects.map((r) => ({ x0: r.x0 - 0.45, x1: r.x1 + 0.45, z0: r.z0 - 0.45, z1: r.z1 + 0.45 }));
    for (; dist > 0.8; dist -= 0.2) {
      cam.copy(pivot).addScaledVector(dir, dist);
      if (inRects(roomish, cam.x, cam.z) && cam.y < WALL_H - 0.3) break;
    }
    this.camera.position.lerp(cam, Math.min(1, dt * 10));
    this.camera.lookAt(pivot);

    const zone = zoneAt(this.localPos.z);
    if (zone !== this.currentZone) {
      this.currentZone = zone;
      this.placeKeyLight(zone);
      this.cb.onZoneChange?.(zone);
    }
    const now = performance.now();
    if (now - this.lastSent > 100) {
      const key = `${this.localPos.x.toFixed(2)},${this.localPos.z.toFixed(2)},${this.localYaw.toFixed(2)}`;
      if (key !== this.lastSentKey) {
        this.lastSentKey = key;
        this.lastSent = now;
        this.cb.onMove?.(this.localPos.x, 0, this.localPos.z, this.localYaw, zone);
      }
    }
    this.updateHover();
  }

  /** Inside an open room/corridor and not inside furniture. */
  canStand(x: number, z: number) {
    return inRects(this.rects, x, z) && !inRects(this.obstacles, x, z);
  }

  /** Short transition scene: the camera turns to the door that just opened and watches it rise. */
  playDoorCutscene(zone: string) {
    const i = ZONE_ORDER.indexOf(zone as ZoneId);
    if (i <= 0 || this.mode !== 'play') return;
    const doorZ = zoneCenter(ZONE_ORDER[i - 1]) - ROOM_HALF_D;
    this.doorProgress.set(zone as ZoneId, 0);
    this.cut = {
      from: this.camera.position.clone(),
      to: new THREE.Vector3(2.2, 2.6, doorZ + 6),
      look: new THREE.Vector3(0, 1.9, doorZ - 2.5),
      t: 0,
      dur: 5,
    };
    this.mode = 'cutscene';
  }

  private cutsceneCamera(dt: number, t: number) {
    const c = this.cut!;
    c.t += dt;
    const k = THREE.MathUtils.smootherstep(Math.min(1, c.t / 1.3), 0, 1);
    const push = THREE.MathUtils.smootherstep(Math.max(0, (c.t - 2.2) / 2.8), 0, 1);
    const pos = new THREE.Vector3().lerpVectors(c.from, c.to, k);
    pos.lerp(new THREE.Vector3(0.3, 2.0, c.look.z + 4.2), push * 0.75);
    this.camera.position.copy(pos);
    this.camera.lookAt(c.look);
    this.local?.update(dt, 0, t);
    if (c.t >= c.dur) {
      this.cut = undefined;
      this.mode = 'play';
    }
  }

  private tourView?: { pos: THREE.Vector3; look: THREE.Vector3 };
  private lineup: BoyAvatar[] = [];

  /** Design review: every door open, camera parked in the chosen room (or close to the characters). */
  setTour(view: ZoneId | 'characters' | 'wallmap') {
    this.mode = 'tour';
    for (const z of ZONE_ORDER) this.doorOpen.set(z, 1);
    if (this.gateGlow) this.gateGlow.visible = false;
    if (view === 'wallmap') {
      this.tourView = { pos: new THREE.Vector3(-4.9, 2.4, 1.45), look: new THREE.Vector3(-8, 2.3, 1.45) };
      this.placeKeyLight('library');
      return;
    }
    if (view === 'characters') {
      this.tourView = { pos: new THREE.Vector3(0, 2.45, 6.0), look: new THREE.Vector3(0, 1.5, 3.0) };
      this.placeKeyLight('library');
      return;
    }
    const c = zoneCenter(view);
    const views: Record<ZoneId, [number[], number[]]> = {
      library: [[5.6, 3.0, 6.2], [-2.0, 1.3, -3.0]],
      symbols: [[5.8, 3.4, 6.0], [-1.5, 1.4, -2.5]],
      echo: [[5.6, 3.0, 6.2], [-1.0, 2.6, -2.0]],
      mirrors: [[5.0, 2.8, 6.0], [-2.0, 1.6, -1.5]],
      items: [[5.6, 3.0, 6.2], [-2.0, 1.1, -1.5]],
      portal: [[0, 2.4, 6.4], [0, 2.8, -5.6]],
    };
    const [pos, look] = views[view];
    this.tourView = { pos: new THREE.Vector3(pos[0], pos[1], c + pos[2]), look: new THREE.Vector3(look[0], look[1], c + look[2]) };
    this.placeKeyLight(view);
    if (view === 'portal') this.portalTarget = 1.0;
  }

  /** Puts the four character types side by side in the library for a close look. */
  showLineup(avatars: BoyAvatar[]) {
    this.lineup.forEach((a) => this.scene.remove(a.root));
    this.lineup = avatars;
    avatars.forEach((a, k) => {
      a.root.position.set((k - (avatars.length - 1) / 2) * 0.95, 0, 3.0);
      this.scene.add(a.root);
    });
  }

  private tourCamera(t: number) {
    if (!this.tourView) return;
    const sway = new THREE.Vector3(Math.sin(t * 0.25) * 0.25, Math.sin(t * 0.18) * 0.08, 0);
    this.camera.position.copy(this.tourView.pos).add(sway);
    this.camera.lookAt(this.tourView.look);
    this.lineup.forEach((a, k) => {
      a.update(0.016, 0, t + k);
      a.root.rotation.y = Math.sin(t * 0.4 + k) * 0.35;
    });
  }

  get isCutscene() {
    return this.mode === 'cutscene';
  }

  private updateRemotes(dt: number, t: number) {
    if (this.mode === 'outro') return;
    for (const [id, r] of this.remotes) {
      const p = this.positions?.get(id);
      if (p) {
        const target = new THREE.Vector3(p.x, 0, p.z);
        const before = r.pos.clone();
        r.pos.lerp(target, Math.min(1, dt * 8));
        r.speed = before.distanceTo(r.pos) / Math.max(dt, 0.001);
        let diff = p.ry - r.yaw;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        r.yaw += diff * Math.min(1, dt * 10);
      } else r.speed = 0;
      r.avatar.root.position.copy(r.pos);
      r.avatar.root.rotation.y = r.yaw;
      r.avatar.update(dt, r.speed, t);
    }
  }

  // ======================================================================= input

  private onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest?.('input, textarea, select')) return;
    this.keys.add(e.code);
    if (e.code === 'KeyE' && this.hovered && this.mode === 'play') this.tryInteract(this.hovered);
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private onBlur = () => this.keys.clear();

  private bindInput() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      this.drag = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      const rect = c.getBoundingClientRect();
      this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      if (this.drag && this.drag.id === e.pointerId) {
        const dx = e.clientX - this.drag.x;
        const dy = e.clientY - this.drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) this.drag.moved = true;
        if (this.drag.moved && this.mode === 'play') {
          this.camYaw -= dx * 0.005 * this.sensitivity;
          this.camPitch = THREE.MathUtils.clamp(this.camPitch + dy * 0.004 * this.sensitivity, 0.05, 1.1);
          this.drag.x = e.clientX;
          this.drag.y = e.clientY;
        }
      }
    });
    c.addEventListener('pointerup', (e) => {
      const d = this.drag;
      this.drag = undefined;
      if (d && !d.moved && this.mode === 'play') {
        const rect = c.getBoundingClientRect();
        this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
        const def = this.pick();
        if (def) this.tryInteract(def);
      }
    });
    c.addEventListener('pointerleave', () => this.pointer.set(10, 10));
    c.addEventListener('wheel', (e) => {
      this.camDist = THREE.MathUtils.clamp(this.camDist + e.deltaY * 0.004, 2.4, 7.5);
    }, { passive: true });
  }

  private pick(): InteractableDef | null {
    if (Math.abs(this.pointer.x) > 1) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const targets = [...this.hitTargets.values()].filter((m) => {
      const def = m.userData['def'] as InteractableDef;
      if (!this.unlocked.has(def.zone)) return false;
      if (def.itemId && !this.worldItems.has(def.itemId)) return false;
      return true;
    });
    const hits = this.raycaster.intersectObjects(targets, false);
    if (!hits.length) return null;
    const item = hits.find((h) => (h.object.userData['def'] as InteractableDef).itemId && h.distance < hits[0].distance + 1.5);
    return ((item ?? hits[0]).object.userData['def'] as InteractableDef) ?? null;
  }

  private updateHover() {
    if (this.drag?.moved) return;
    const def = this.pick();
    if (def?.id !== this.hovered?.id) {
      this.hovered = def;
      this.canvas.style.cursor = def ? 'pointer' : 'grab';
      this.cb.onHover?.(def);
    }
  }

  private tryInteract(def: InteractableDef) {
    const [x, , z] = worldPos(def);
    const d = Math.hypot(x - this.localPos.x, z - this.localPos.z);
    if (d > INTERACT_DISTANCE + def.radius) this.cb.onTooFar?.(def);
    else this.cb.onInteract?.(def);
  }

  /** Interacts with the nearest object in reach (mobile "בדוק" button / keyboard). */
  interactNearest() {
    let best: InteractableDef | null = null;
    let bestD = Infinity;
    for (const def of INTERACTABLES) {
      if (!this.unlocked.has(def.zone) || (def.itemId && !this.worldItems.has(def.itemId))) continue;
      const [x, , z] = worldPos(def);
      const d = Math.hypot(x - this.localPos.x, z - this.localPos.z) - def.radius;
      if (d < bestD) {
        bestD = d;
        best = def;
      }
    }
    if (best && bestD < INTERACT_DISTANCE) this.cb.onInteract?.(best);
    return best && bestD < INTERACT_DISTANCE ? best : null;
  }

  private resize() {
    const el = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(1, el.clientWidth);
    const h = Math.max(1, el.clientHeight);
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 72 : 60;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    clearInterval(this.watchdog);
    this.resizeObs.disconnect();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose?.();
    });
    this.composer?.dispose();
    this.renderer.dispose();
  }
}
