import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { MechanismState, PlayerDto, RemotePosition, RoomSnapshot, ScenarioContent } from '../core/models';
import { Quality } from '../core/settings.service';
import { BoyAvatar } from '../world/avatar';
import {
  bookSpinesTexture, glowSpriteTexture, labelTexture, panelTexture, parchmentTexture, rugTexture, stoneTexture, woodFloorTexture,
} from '../world/textures';
import { Hanukkiah } from './hanukkiah';
import {
  H_HALF_D, H_HALF_W, H_INTERACTABLES, H_SPACING, H_WALL, H_ZONES, HInteractable, HRect, HZone,
  hCenter, hInRects, hObstacles, hWalkable, hWorldPos, hZoneAt,
} from './h-layout';

export type HMode = 'intro' | 'play' | 'outro' | 'cutscene';

export interface HWorldCallbacks {
  onHover?(def: HInteractable | null): void;
  onInteract?(def: HInteractable): void;
  onTooFar?(def: HInteractable): void;
  onZoneChange?(zone: HZone): void;
  onMove?(x: number, y: number, z: number, ry: number, zone: string): void;
}

const DOOR_W = 2.4;
const DOOR_H = 3.4;
const INTERACT_DISTANCE = 4.2;
const SPAWN = new THREE.Vector3(0, 0, 4.6);
const MAZE_CELL = 0.3;

interface Flicker { light: THREE.PointLight; base: number; seed: number }

/** Emoji/letter on a transparent canvas, for symbols drawn on props. */
function glyphTexture(text: string, color = '#ffd36b', size = 128, font = 'Segoe UI Emoji, Noto Color Emoji, Frank Ruhl Libre, serif') {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold ${Math.round(size * 0.7)}px ${font}`;
  g.fillStyle = color;
  g.fillText(text, size / 2, size / 2 + size * 0.04);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A text sheet (parchment / board) drawn on a canvas, right-to-left. */
function sheetTexture(lines: string[], opts: { bg?: string; color?: string; w?: number; h?: number; size?: number; title?: string } = {}) {
  const w = opts.w ?? 512;
  const h = opts.h ?? 384;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = opts.bg ?? '#e9d8ad';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(80,50,20,.6)';
  g.lineWidth = 6;
  g.strokeRect(8, 8, w - 16, h - 16);
  g.direction = 'rtl';
  g.textAlign = 'center';
  g.fillStyle = opts.color ?? '#3a2410';
  let y = 56;
  if (opts.title) {
    g.font = `bold ${Math.round((opts.size ?? 30) * 1.15)}px Frank Ruhl Libre, serif`;
    g.fillText(opts.title, w / 2, y);
    y += (opts.size ?? 30) * 1.7;
  }
  g.font = `${opts.size ?? 30}px Frank Ruhl Libre, Heebo, serif`;
  for (const line of lines) {
    g.fillText(line, w / 2, y);
    y += (opts.size ?? 30) * 1.45;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Groove pattern of a mosaic stone at rotation 0 (openings: straight N–S, corner N–E, dead N only). */
function stoneGrooveTexture(kind: string, lit: boolean) {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2e3a52';
  g.fillRect(0, 0, s, s);
  g.strokeStyle = '#1a2236';
  g.lineWidth = 8;
  g.strokeRect(4, 4, s - 8, s - 8);
  g.strokeStyle = lit ? '#9fd0ff' : '#c9a24d';
  g.lineWidth = 16;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(s / 2, 0);
  g.lineTo(s / 2, s / 2);
  if (kind === 'straight') g.lineTo(s / 2, s);
  if (kind === 'corner') g.lineTo(s, s / 2);
  g.stroke();
  if (kind === 'dead') {
    g.fillStyle = '#5a4a30';
    g.fillRect(s / 2 - 20, s / 2 - 6, 40, 16);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * "סוד פך השמן": eight interior rooms with the props of the spec, a shared hanukkiah model, puzzle mechanisms
 * that follow the server state, the local player and the other players. The server decides everything;
 * this class only shows the state and reports what the player clicks.
 */
export class HanukkahWorld {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.05, 400);
  private composer?: EffectComposer;
  private clock = new THREE.Clock();
  private raf = 0;
  private watchdog?: ReturnType<typeof setInterval>;
  private disposed = false;
  private resizeObs: ResizeObserver;
  private mode: HMode = 'intro';
  private modeTime = 0;
  private flickers: Flicker[] = [];
  private animated: ((t: number, dt: number) => void)[] = [];
  private keyLight?: THREE.SpotLight;

  // interaction
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2(10, 10);
  private hitTargets = new Map<string, THREE.Mesh>();
  private hovered: HInteractable | null = null;
  private drag?: { x: number; y: number; moved: boolean; id: number };

  // world state
  private doors = new Map<HZone, THREE.Object3D>();
  private doorOpen = new Map<HZone, number>();
  private doorProgress = new Map<HZone, number>();
  private unlocked = new Set<string>(['library']);
  private rects: HRect[] = hWalkable(this.unlocked);
  private obstacles: HRect[] = hObstacles();
  private cut?: { from: THREE.Vector3; to: THREE.Vector3; look: THREE.Vector3; t: number; dur: number };
  private itemMeshes = new Map<string, THREE.Object3D>();
  private worldItems = new Set<string>();
  private hanukkiot: Hanukkiah[] = [];
  private hallHanukkiah?: Hanukkiah;
  private outroLit = 0;

  // mechanisms
  private lampSlots: THREE.Object3D[] = [];
  private lampGlow?: THREE.PointLight;
  private keySymbol?: THREE.Mesh;
  private mazeKey?: THREE.Object3D;
  private mazeKeyTarget = new THREE.Vector3();
  private mazeGates = new Map<string, THREE.Mesh>();
  private mazeLevers: THREE.Object3D[] = [];
  private mazeOrigin = new THREE.Vector3();
  private metalBoxLid?: THREE.Object3D;
  private drawerFront?: THREE.Object3D;
  private wheelRings: THREE.Mesh[] = [];
  private standSlots = new Map<string, THREE.Object3D>();
  private woodBoxLid?: THREE.Object3D;
  private jugGlow?: THREE.Mesh;
  private mosaicStones: { mesh: THREE.Mesh; kind: string; lit?: boolean }[] = [];
  private mosaicBeam?: THREE.Mesh;
  private pedestalItems = new Map<string, THREE.Object3D>();
  private hallGate?: THREE.Mesh;
  private gatePower = 0.2;
  private gateTarget = 0.2;
  private particles?: THREE.Points;
  private openTargets = new Map<THREE.Object3D, { axis: 'x' | 'y' | 'z'; kind: 'rot' | 'pos'; from: number; to: number; on: boolean }>();

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
  private lastSent = 0;
  private lastSentKey = '';
  private currentZone: HZone = 'library';
  private snapCamera = false;
  sensitivity = 1;

  constructor(private canvas: HTMLCanvasElement, private quality: Quality, private cb: HWorldCallbacks = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 2 : quality === 'medium' ? 1.5 : 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.45;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color('#060a1a');
    this.scene.fog = new THREE.FogExp2('#0a1026', 0.014);
    if (quality !== 'low') {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(512, 512), quality === 'high' ? 0.65 : 0.5, 0.45, 0.9));
      this.composer.addPass(new OutputPass());
    }
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(canvas.parentElement ?? canvas);
    this.resize();
    this.bindInput();
  }

  // ======================================================================= build

  build(scenario: ScenarioContent | null) {
    H_ZONES.forEach((z, i) => this.buildShell(z, i));
    this.buildLibrary();
    this.buildWorkshop();
    this.buildMaze(scenario);
    this.buildCipher();
    this.buildDreidels();
    this.buildLab(scenario);
    this.buildMosaic(scenario);
    this.buildHall();
    for (const def of H_INTERACTABLES) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(def.radius, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
      m.position.set(...hWorldPos(def));
      m.userData['def'] = def;
      this.scene.add(m);
      this.hitTargets.set(def.id, m);
    }
    this.scene.add(new THREE.HemisphereLight('#9aa6d8', '#3a2a16', 1.15));
    this.scene.add(new THREE.AmbientLight('#a0a8c8', 0.3));
    if (this.quality !== 'low') {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.keyLight = new THREE.SpotLight('#ffd9a8', 26, 22, Math.PI / 3, 0.7, 1.4);
      this.keyLight.castShadow = true;
      this.keyLight.shadow.mapSize.set(1024, 1024);
      this.keyLight.shadow.bias = -0.0006;
      this.scene.add(this.keyLight, this.keyLight.target);
      this.placeKeyLight('library');
      this.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mat = m.material as THREE.Material;
        const flat = m.geometry instanceof THREE.PlaneGeometry || m.geometry instanceof THREE.CircleGeometry;
        m.receiveShadow = true;
        m.castShadow = !flat && !mat.transparent && !(mat instanceof THREE.MeshBasicMaterial);
      });
    }
  }

  private std(color: string, opts: THREE.MeshStandardMaterialParameters = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...opts });
  }
  private gold = () => this.std('#d4a640', { metalness: 0.9, roughness: 0.3 });
  private wood = (c = '#5a3a20') => this.std(c, { map: panelTexture([2, 1]), roughness: 0.7 });

  private box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.scene) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
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
    if (light) this.addLight(x, y + 0.45, z, '#ffb469', 5, 8);
    return g;
  }

  private halo(obj: THREE.Object3D, color = '#ffe6a0', size = 0.8) {
    const h = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowSpriteTexture(color), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.55 }));
    h.scale.set(size, size, 1);
    obj.add(h);
    return h;
  }

  private label(text: string, w: number, h: number, x: number, y: number, z: number, rotY = 0, opts: { color?: string; bg?: string } = {}) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({
      map: labelTexture(text, { color: opts.color ?? '#3a2410', bg: opts.bg ?? '#e9d8ad', width: 512, height: Math.round(512 * h / w) }), transparent: true,
    }));
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    this.scene.add(m);
    return m;
  }

  /** Floor, ceiling, stone walls with door gaps, wainscot, a chandelier and the door to the next room. */
  private buildShell(zone: HZone, i: number) {
    const c = -H_SPACING * i;
    const tint: Record<HZone, string> = {
      library: '#7a6e66', workshop: '#786a5c', maze: '#6e6a78', cipher: '#6a6680', dreidels: '#7a6a5a', lab: '#666e78', mosaic: '#5e6684', hall: '#5c6290',
    };
    const wallMat = this.std(tint[zone], { map: stoneTexture([5, 2.5]) });
    const floorMat = ['library', 'workshop', 'dreidels'].includes(zone)
      ? this.std('#9a7a5a', { map: woodFloorTexture([4, 4]), roughness: 0.7 })
      : this.std('#6a6470', { map: stoneTexture([6, 6]), roughness: 0.6 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(H_HALF_W * 2, H_HALF_D * 2), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, c);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(H_HALF_W * 2, H_HALF_D * 2), this.std('#2b2420'));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, H_WALL, c);
    this.scene.add(floor, ceil);
    for (const sx of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(H_HALF_D * 2, H_WALL), wallMat);
      wall.rotation.y = -sx * Math.PI / 2;
      wall.position.set(sx * H_HALF_W, H_WALL / 2, c);
      this.scene.add(wall);
      const panel = this.box(0.06, 1.3, H_HALF_D * 2, this.std('#ffffff', { map: panelTexture([7, 1]), roughness: 0.6 }), sx * (H_HALF_W - 0.03), 0.65, c);
      panel.castShadow = false;
    }
    const last = i === H_ZONES.length - 1;
    this.wallWithGap(c - H_HALF_D, 0, wallMat, last ? 0 : DOOR_W);
    this.wallWithGap(c + H_HALF_D, Math.PI, wallMat, i === 0 ? 0 : DOOR_W);
    for (const bx of [-4, 0, 4]) this.box(0.3, 0.3, H_HALF_D * 2, this.std('#3a2a1c'), bx, H_WALL - 0.18, c);

    // brass chandelier
    if (zone !== 'mosaic') {
      const brass = this.std('#b8913f', { metalness: 0.85, roughness: 0.3 });
      const g = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.05, 10, 40), brass);
      ring.rotation.x = Math.PI / 2;
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 6), brass);
      chain.position.y = 0.6;
      g.add(ring, chain);
      g.position.set(0, H_WALL - 1.5, c + 1.5);
      this.scene.add(g);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        this.candle(Math.cos(a) * 0.8, g.position.y + 0.04, g.position.z + Math.sin(a) * 0.8);
      }
      if (this.quality !== 'low') this.addLight(0, g.position.y - 0.4, g.position.z, '#ffc48a', 13, 16);
    }
    // a wall sconce on each side
    for (const sx of [-1, 1]) {
      this.box(0.14, 0.4, 0.14, this.std('#2a2018', { metalness: 0.5 }), sx * (H_HALF_W - 0.1), 2.6, c + 3);
      this.candle(sx * (H_HALF_W - 0.25), 2.8, c + 3, this.quality === 'high');
    }

    // corridor and door to the next room, with the room number on it
    if (!last) {
      const z0 = c - H_HALF_D;
      const len = H_SPACING - H_HALF_D * 2;
      const cf = new THREE.Mesh(new THREE.PlaneGeometry(DOOR_W, len), this.std('#4a4450', { map: stoneTexture([1, 1]) }));
      cf.rotation.x = -Math.PI / 2;
      cf.position.set(0, 0.005, z0 - len / 2);
      const cc = new THREE.Mesh(new THREE.PlaneGeometry(DOOR_W, len), this.std('#221c18'));
      cc.rotation.x = Math.PI / 2;
      cc.position.set(0, DOOR_H, z0 - len / 2);
      this.scene.add(cf, cc);
      for (const sx of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.PlaneGeometry(len, DOOR_H), wallMat);
        w.rotation.y = -sx * Math.PI / 2;
        w.position.set(sx * DOOR_W / 2, DOOR_H / 2, z0 - len / 2);
        this.scene.add(w);
      }
      const tex = sheetTexture([String(i + 2)], { bg: '#4a2f1b', color: '#e2c27a', w: 256, h: 360, size: 150 });
      const door = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W, DOOR_H, 0.18), [
        this.std('#3a2414'), this.std('#3a2414'), this.std('#3a2414'), this.std('#3a2414'),
        this.std('#ffffff', { map: tex }), this.std('#ffffff', { map: tex }),
      ]);
      door.position.set(0, DOOR_H / 2, z0 - 0.12);
      this.scene.add(door);
      const next = H_ZONES[i + 1];
      this.doors.set(next, door);
      this.doorOpen.set(next, 0);
    }
  }

  private wallWithGap(z: number, rotY: number, mat: THREE.Material, gapW: number) {
    const W = H_HALF_W * 2;
    const add = (w: number, h: number, x: number, y: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      m.rotation.y = rotY;
      m.position.set(x, y, z);
      this.scene.add(m);
    };
    if (!gapW) return add(W, H_WALL, 0, H_WALL / 2);
    const side = (W - gapW) / 2;
    add(side, H_WALL, -(gapW / 2 + side / 2), H_WALL / 2);
    add(side, H_WALL, gapW / 2 + side / 2, H_WALL / 2);
    add(gapW, H_WALL - DOOR_H, 0, DOOR_H + (H_WALL - DOOR_H) / 2);
  }

  private placeKeyLight(zone: HZone) {
    if (!this.keyLight) return;
    const c = hCenter(zone);
    this.keyLight.position.set(1.2, H_WALL - 0.6, c + 2.5);
    this.keyLight.target.position.set(0, 0, c - 0.5);
  }

  private desk(c: number, w = 5.2, d = 1.6, z = -1.3, color = '#5a3a20') {
    const top = this.box(w, 0.1, d, this.wood(color), 0, 0.95, c + z);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) this.box(0.12, 0.9, 0.12, this.std('#3a2414'), sx * (w / 2 - 0.15), 0.45, c + z + sz * (d / 2 - 0.15));
    return top;
  }

  private shelfWall(x: number, c: number, z: number, rotY: number, seed: number) {
    const g = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(3.2, 4.2, 0.5), this.std('#3a2414'));
    frame.position.y = 2.1;
    g.add(frame);
    for (let k = 0; k < 4; k++) {
      const books = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 0.8), this.std('#ffffff', { map: bookSpinesTexture(seed + k) }));
      books.position.set(0, 0.6 + k * 1.0, 0.26);
      g.add(books);
    }
    g.position.set(x, 0, c + z);
    g.rotation.y = rotY;
    this.scene.add(g);
  }

  private scroll(x: number, y: number, z: number, rot = 0) {
    const g = new THREE.Group();
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.36), this.std('#ffffff', { map: parchmentTexture(), side: THREE.DoubleSide }));
    sheet.rotation.x = -Math.PI / 2;
    const r1 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 8), this.std('#7a5230'));
    r1.rotation.z = Math.PI / 2;
    r1.position.z = -0.2;
    const r2 = r1.clone();
    r2.position.z = 0.2;
    g.add(sheet, r1, r2);
    g.position.set(x, y, z);
    g.rotation.y = rot;
    this.scene.add(g);
    return g;
  }

  // ---------------------------------------------------------------------- 1 · library

  private buildLibrary() {
    const c = hCenter('library');
    this.shelfWall(-H_HALF_W + 0.3, c, -2.5, Math.PI / 2, 1);
    this.shelfWall(-H_HALF_W + 0.3, c, 1.5, Math.PI / 2, 5);
    this.shelfWall(H_HALF_W - 0.3, c, -2.5, -Math.PI / 2, 9);
    this.shelfWall(H_HALF_W - 0.3, c, 1.5, -Math.PI / 2, 13);
    this.desk(c);
    // the folded letter
    const letter = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.3), this.std('#ffffff', { map: parchmentTexture() }));
    letter.rotation.x = -Math.PI / 2;
    letter.rotation.z = 0.25;
    letter.position.set(-1.2, 1.01, c - 1.2);
    this.scene.add(letter);
    this.halo(letter, '#fff1c0', 0.6).position.z = 0.1;
    // locked drawer under the desk
    this.box(1.0, 0.36, 0.5, this.wood('#4a2c16'), 0.4, 0.62, c - 1.2);
    this.drawerFront = this.box(0.9, 0.3, 0.06, this.wood('#5e3a1e'), 0.4, 0.62, c - 0.93);
    this.box(0.12, 0.12, 0.04, this.gold(), 0.4, 0.62, c - 0.89);
    this.openTargets.set(this.drawerFront, { axis: 'z', kind: 'pos', from: c - 0.93, to: c - 0.45, on: false });
    // magnifier, oil lamp, globe, three books
    const lens = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.015, 8, 24), this.gold());
    lens.rotation.x = -Math.PI / 2;
    lens.position.set(-0.3, 1.02, c - 1.5);
    const glass = new THREE.Mesh(new THREE.CircleGeometry(0.09, 20), new THREE.MeshStandardMaterial({ color: '#cfe8ff', transparent: true, opacity: 0.35, metalness: 0.2, roughness: 0.05 }));
    glass.rotation.x = -Math.PI / 2;
    glass.position.set(-0.3, 1.025, c - 1.5);
    this.box(0.03, 0.03, 0.22, this.std('#3a2414'), -0.3, 1.02, c - 1.33);
    this.scene.add(lens, glass);
    this.oilLamp(1.6, 1.0, c - 1.6, true);
    const globeStand = this.box(0.08, 0.6, 0.08, this.std('#3a2414'), 3.4, 0.3, c - 3.2);
    globeStand.castShadow = true;
    const globe = new THREE.Mesh(new THREE.SphereGeometry(0.38, 24, 16), this.std('#2e5a7a', { roughness: 0.5 }));
    globe.position.set(3.4, 1.0, c - 3.2);
    const meridian = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.02, 8, 32), this.gold());
    meridian.position.copy(globe.position);
    this.scene.add(globe, meridian);
    this.animated.push((t) => (globe.rotation.y = t * 0.2));
    [['#8a1f1f', -2.9], ['#1f5a2a', -2.6], ['#1f3a7a', -2.3]].forEach(([col, x]) => this.box(0.22, 0.32, 0.28, this.std(col as string), x as number, 1.16, c - 1.6));
    // maps and scrolls on a side table
    this.box(1.2, 0.08, 0.7, this.wood(), -6.6, 1.0, c + 2.5);
    this.box(0.08, 1.0, 0.08, this.std('#3a2414'), -6.6, 0.5, c + 2.5);
    this.scroll(-6.7, 1.08, c + 2.3, 0.5);
    this.scroll(-6.4, 1.1, c + 2.7, -0.3);
    // a small hanukkiah on a cabinet: same model as the hall, lit by the stage of the game
    this.box(1.6, 1.1, 0.6, this.wood('#4a2c16'), 4.6, 0.55, c - 6.4);
    const h = new Hanukkiah(0.7);
    h.root.position.set(4.6, 1.1, c - 6.4);
    this.scene.add(h.root);
    this.hanukkiot.push(h);
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(6, 4), this.std('#ffffff', { map: rugTexture('#5a1d1d', '#c9a24d', 2), roughness: 0.95 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0, 0.012, c + 1.8);
    this.scene.add(rug);
    // the antique key lies in the drawer; it shows when the drawer slides open (it also goes straight to the bag)
    const key = this.keyMesh('#c9a060', 0.5);
    key.position.set(0, 0.12, 0);
    this.drawerFront.add(key);
  }

  private oilLamp(x: number, y: number, z: number, light: boolean) {
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), this.std('#b07a3a', { metalness: 0.6, roughness: 0.4 }));
    body.scale.set(1.5, 0.8, 1);
    body.rotation.x = Math.PI;
    body.position.set(x, y + 0.08, z);
    this.scene.add(body);
    this.candle(x + 0.12, y + 0.02, z, light).scale.setScalar(0.6);
  }

  private keyMesh(color: string, scale = 1) {
    const g = new THREE.Group();
    const m = this.std(color, { metalness: 0.9, roughness: 0.25, emissive: '#2a1a04' });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.02, 8, 20), m);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.3, 8), m);
    shaft.rotation.z = Math.PI / 2;
    shaft.position.x = 0.22;
    const bit = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.08, 0.02), m);
    bit.position.set(0.34, -0.04, 0);
    g.add(ring, shaft, bit);
    g.scale.setScalar(scale);
    return g;
  }

  /** A pickable or placeable item; `bob` makes it float and spin while it waits to be picked up. */
  private addItem(id: string, obj: THREE.Object3D, bob = true) {
    obj.visible = false;
    this.scene.add(obj);
    this.itemMeshes.set(id, obj);
    if (!bob) return;
    this.halo(obj);
    const y0 = obj.position.y;
    this.animated.push((t) => {
      obj.position.y = y0 + Math.sin(t * 2 + y0) * 0.05;
      obj.rotation.y = t * 0.8;
    });
  }

  /** Small 3D model of a journey item (used on pedestals and as pickups). */
  private itemModel(id: string): THREE.Object3D {
    const g = new THREE.Group();
    const glow = (col: string) => this.std(col, { emissive: col, emissiveIntensity: 0.6, roughness: 0.3 });
    switch (id) {
      case 'antique-key': return this.keyMesh('#c9a060', 0.6);
      case 'golden-key': return this.keyMesh('#ffd24a', 0.6);
      case 'lamp-base': g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.08, 20), this.gold())); break;
      case 'lamp-tank': g.add(new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), this.std('#b07a3a', { metalness: 0.7 }))); break;
      case 'lamp-wick': g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.16, 6), this.std('#f1e7cf'))); break;
      case 'lamp-glass': g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.22, 20, 1, true), new THREE.MeshStandardMaterial({ color: '#dff1ff', transparent: true, opacity: 0.4, side: THREE.DoubleSide }))); break;
      case 'lamp-cover': g.add(new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.12, 16), this.gold())); break;
      case 'menorah-symbol': {
        const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), new THREE.MeshBasicMaterial({ map: glyphTexture('🕎'), transparent: true, side: THREE.DoubleSide }));
        g.add(plate);
        break;
      }
      case 'flame-symbol': g.add(new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), new THREE.MeshBasicMaterial({ map: glyphTexture('🔥'), transparent: true, side: THREE.DoubleSide }))); break;
      case 'light-stone': g.add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.13), glow('#ffe9a6'))); break;
      case 'blue-crystal': g.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.15), glow('#5aa8ff'))); break;
      case 'golden-jug': {
        const pts = [0, 0.1, 0.13, 0.11, 0.05, 0.06, 0.08].map((r, k) => new THREE.Vector2(r, k * 0.05));
        g.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 20), this.std('#e7b84a', { metalness: 0.9, roughness: 0.25, emissive: '#3a2604' })));
        break;
      }
      default:
        if (id.startsWith('dreidel-')) return this.dreidelModel(id, 0.25);
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.15), this.gold()));
    }
    return g;
  }

  private dreidelModel(id: string, s: number) {
    const letter: Record<string, string> = { 'dreidel-nun': 'נ', 'dreidel-gimel': 'ג', 'dreidel-he': 'ה', 'dreidel-pe': 'פ' };
    const colors: Record<string, string> = { 'dreidel-nun': '#c94a3a', 'dreidel-gimel': '#3a7ac9', 'dreidel-he': '#3aa65a', 'dreidel-pe': '#c9a03a' };
    const g = new THREE.Group();
    const tex = glyphTexture(letter[id] ?? '?', '#fff4cf', 128, 'Frank Ruhl Libre, serif');
    const faceMat = this.std(colors[id] ?? '#c9a03a', { map: tex, roughness: 0.5 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), faceMat);
    body.position.y = s * 0.9;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(s * 0.7, s * 0.7, 4), this.std(colors[id] ?? '#c9a03a'));
    tip.rotation.set(Math.PI, Math.PI / 4, 0);
    tip.position.y = s * 0.35;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.08, s * 0.08, s * 0.5, 8), this.std('#3a2414'));
    handle.position.y = s * 1.6;
    g.add(body, tip, handle);
    return g;
  }

  // ---------------------------------------------------------------------- 2 · workshop

  private buildWorkshop() {
    const c = hCenter('workshop');
    this.desk(c, 5.2, 1.6, -1.4, '#6a4a2a');
    // five assembly zones on the bench, numbered from the bottom part (right) to the top (left as seen from the room)
    for (let k = 0; k < 5; k++) {
      const x = 1.6 - k * 0.8;
      const pad = new THREE.Mesh(new THREE.CircleGeometry(0.24, 24), new THREE.MeshBasicMaterial({ map: glyphTexture(String(k + 1), '#e2c27a', 128, 'Heebo, sans-serif'), transparent: true, opacity: 0.85 }));
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(x, 1.006, c - 1.4);
      this.scene.add(pad);
      const slot = new THREE.Group();
      slot.position.set(x, 1.02, c - 1.4);
      this.scene.add(slot);
      this.lampSlots.push(slot);
    }
    // the assembled lamp lights up and projects a key symbol on the back wall
    this.lampGlow = new THREE.PointLight('#ffcf7a', 0, 9, 1.4);
    this.lampGlow.position.set(0, 2.0, c - 1.6);
    this.scene.add(this.lampGlow);
    this.keySymbol = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), new THREE.MeshBasicMaterial({ map: glyphTexture('🗝️'), transparent: true, opacity: 0, depthWrite: false }));
    this.keySymbol.position.set(0, 3.2, c - H_HALF_D + 0.05);
    this.scene.add(this.keySymbol);
    this.scroll(-2.0, 1.02, c - 1.6, 0.2);
    // oil bottle, tools wall, drawers, shelves
    const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.3, 14), new THREE.MeshStandardMaterial({ color: '#b8a040', transparent: true, opacity: 0.7, roughness: 0.1 }));
    bottle.position.set(1.9, 1.15, c - 1.7);
    this.scene.add(bottle);
    this.box(0.1, 1.6, 2.4, this.wood('#3a2414'), -7.85, 2.2, c + 0.5);
    for (let k = 0; k < 6; k++) this.box(0.06, 0.4 + (k % 3) * 0.1, 0.06, this.std('#7a7a80', { metalness: 0.8 }), -7.7, 2.0, c - 0.5 + k * 0.4);
    this.box(1.2, 1.0, 0.6, this.wood('#4a2c16'), -6.4, 0.5, c - 4.2);
    this.box(0.6, 2.8, 2.4, this.wood('#3a2414'), 7.6, 1.4, c + 1.5);
    for (let k = 0; k < 5; k++) {
      const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.3, 12), this.std(['#7a4a2a', '#4a6a7a', '#8a7a3a'][k % 3]));
      jar.position.set(7.4, 2.95, c + 0.7 + k * 0.4);
      this.scene.add(jar);
    }
    this.box(1.4, 0.06, 0.6, this.wood(), 6.2, 1.3, c - 3.6);
    this.box(0.08, 1.3, 0.08, this.std('#3a2414'), 6.2, 0.65, c - 3.6);
    this.box(0.8, 0.06, 0.4, this.wood(), 2.4, 2.1, c - 6.6);
    // the five parts lying around the room
    const where: Record<string, [number, number, number]> = {
      'lamp-base': [-5.4, 0.35, 3.2], 'lamp-tank': [6.2, 1.55, -3.6], 'lamp-wick': [-6.4, 1.15, -4.2], 'lamp-glass': [4.6, 0.3, 4.4], 'lamp-cover': [2.4, 2.35, -6.4],
    };
    for (const [id, [x, y, z]] of Object.entries(where)) {
      const m = this.itemModel(id);
      m.position.set(x, y, c + z);
      m.scale.setScalar(1.6);
      this.addItem(id, m);
    }
    this.addLight(0, 2.4, c - 2.5, '#ffb46a', 4, 7);
  }

  // ---------------------------------------------------------------------- 3 · magnetic maze

  private buildMaze(scenario: ScenarioContent | null) {
    const c = hCenter('maze');
    const grid: string[] = scenario?.puzzles.find((p) => p.id === 'h3-maze')?.publicData?.grid ?? [];
    const rows = grid.length;
    const cols = grid[0]?.length ?? 0;
    // the mechanical table under a glass top
    this.box(cols * MAZE_CELL + 0.6, 0.9, rows * MAZE_CELL + 0.6, this.wood('#3a2414'), 0, 0.45, c - 1.0);
    const board = this.box(cols * MAZE_CELL + 0.3, 0.06, rows * MAZE_CELL + 0.3, this.std('#1e2a44', { roughness: 0.5 }), 0, 0.93, c - 1.0);
    board.castShadow = false;
    this.mazeOrigin.set(-(cols - 1) * MAZE_CELL / 2, 0.98, c - 1.0 - (rows - 1) * MAZE_CELL / 2);
    const cell = (r: number, col: number) => new THREE.Vector3(this.mazeOrigin.x + col * MAZE_CELL, this.mazeOrigin.y, this.mazeOrigin.z + r * MAZE_CELL);
    const wallMat = this.std('#8a6a3a', { metalness: 0.6, roughness: 0.4 });
    const gateMat = this.std('#5a8ad0', { metalness: 0.7, roughness: 0.3, emissive: '#10204a' });
    const symbols: Record<string, string> = { '*': '⭐', F: '🔥', M: '🕎', E: '📦' };
    grid.forEach((line, r) => [...line].forEach((ch, col) => {
      const p = cell(r, col);
      if (ch === '#') this.box(MAZE_CELL, 0.12, MAZE_CELL, wallMat, p.x, p.y + 0.04, p.z).castShadow = false;
      else if ('abc'.includes(ch)) {
        const gate = this.box(MAZE_CELL * 0.9, 0.12, MAZE_CELL * 0.9, gateMat, p.x, p.y + 0.04, p.z);
        this.mazeGates.set(ch, gate);
      } else if (symbols[ch]) {
        const s = new THREE.Mesh(new THREE.PlaneGeometry(MAZE_CELL * 0.85, MAZE_CELL * 0.85), new THREE.MeshBasicMaterial({ map: glyphTexture(symbols[ch]), transparent: true }));
        s.rotation.x = -Math.PI / 2;
        s.position.set(p.x, p.y - 0.01, p.z);
        this.scene.add(s);
      }
    }));
    const glass = new THREE.Mesh(new THREE.BoxGeometry(cols * MAZE_CELL + 0.3, 0.02, rows * MAZE_CELL + 0.3), new THREE.MeshStandardMaterial({ color: '#cfe8ff', transparent: true, opacity: 0.12, roughness: 0.05 }));
    glass.position.set(0, 1.18, c - 1.0);
    this.scene.add(glass);
    this.mazeKey = this.keyMesh('#ffd24a', 0.45);
    this.mazeKey.position.copy(cell(1, 1)).add(new THREE.Vector3(0, 0.05, 0));
    this.mazeKeyTarget.copy(this.mazeKey.position);
    this.scene.add(this.mazeKey);
    this.halo(this.mazeKey, '#ffe08a', 0.5);
    // magnetic rod
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 10), this.std('#c03030', { metalness: 0.5 }));
    rod.rotation.z = 0.6;
    rod.position.set(-1.9, 1.1, c - 0.4);
    this.scene.add(rod);
    // three levers
    for (let k = 0; k < 3; k++) {
      this.box(0.18, 0.1, 0.3, this.std('#3a2a1c'), 2.4, 0.95, c - 1.6 + k * 0.6);
      const lever = new THREE.Group();
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 8), this.std('#9a9aa0', { metalness: 0.8 }));
      arm.position.y = 0.25;
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), this.std(['#c03030', '#3070c0', '#30a050'][k]));
      knob.position.y = 0.5;
      lever.add(arm, knob);
      lever.position.set(2.4, 1.0, c - 1.6 + k * 0.6);
      lever.rotation.z = 0.5;
      this.scene.add(lever);
      this.mazeLevers.push(lever);
    }
    // symbol board on the back wall
    const boardTex = sheetTexture(['⭐   🔥   🕎'], { bg: '#2a2016', color: '#ffd36b', w: 512, h: 220, size: 80 });
    const sb = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.0), this.std('#ffffff', { map: boardTex }));
    sb.position.set(0, 2.6, c - H_HALF_D + 0.06);
    this.scene.add(sb);
    this.scroll(-2.8, 1.02, c - 1.0, -0.2);
    this.box(0.8, 0.06, 0.6, this.wood(), -2.8, 0.97, c - 1.0);
    // metal box at the end of the maze
    this.box(0.5, 0.35, 0.4, this.std('#6a6a72', { metalness: 0.85, roughness: 0.35 }), 2.6, 1.12, c - 2.2);
    const lid = new THREE.Group();
    const lidMesh = this.box(0.5, 0.06, 0.4, this.std('#7a7a82', { metalness: 0.85, roughness: 0.3 }), 0, 0, 0.2, lid);
    lidMesh.castShadow = true;
    lid.position.set(2.6, 1.32, c - 2.4);
    this.scene.add(lid);
    this.metalBoxLid = lid;
    this.openTargets.set(lid, { axis: 'x', kind: 'rot', from: 0, to: -1.6, on: false });
    this.addLight(0, 2.6, c - 1, '#9ab8ff', 5, 8);
  }

  // ---------------------------------------------------------------------- 4 · cipher room

  private buildCipher() {
    const c = hCenter('cipher');
    this.desk(c, 6.0, 1.8, -1.1);
    // three number tablets on the back wall: 1 — 6 — 200, read from left to right
    ['1', '6', '200'].forEach((n, k) => {
      const t = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), this.std('#ffffff', { map: sheetTexture([n], { bg: '#3a3446', color: '#9fd0ff', w: 256, h: 256, size: 110 }), emissive: '#0a1430' }));
      t.position.set(-1.6 + k * 1.6, 2.4, c - H_HALF_D + 0.06);
      this.scene.add(t);
    });
    // the gematria board on the left wall
    const rows = ['א=1  ב=2  ג=3  ד=4  ה=5  ו=6', 'ז=7  ח=8  ט=9  י=10  כ=20', 'ל=30  מ=40  נ=50  ס=60  ע=70', 'פ=80  צ=90  ק=100  ר=200', 'ש=300  ת=400'];
    const gb = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.9), this.std('#ffffff', { map: sheetTexture(rows, { title: 'לוח ערכי גימטריה', w: 640, h: 480, size: 34 }) }));
    gb.rotation.y = Math.PI / 2;
    gb.position.set(-H_HALF_W + 0.06, 2.2, c - 1.5);
    this.scene.add(gb);
    // letter wheel: three rings on an axle, over a drawer with a three-wheel mechanism
    for (let k = 0; k < 3; k++) {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 22), this.std('#c9a24d', { metalness: 0.85, roughness: 0.3, map: glyphTexture('א ב ג', '#3a2410', 256, 'Frank Ruhl Libre, serif') }));
      ring.rotation.z = Math.PI / 2;
      ring.position.set(0.35 + k * 0.14, 1.22, c - 1.2);
      this.scene.add(ring);
      this.wheelRings.push(ring);
    }
    this.box(0.9, 0.3, 0.5, this.wood('#4a2c16'), 0.5, 0.75, c - 1.2);
    this.scroll(-2.2, 1.02, c - 1.2, 0.3);
    const book = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.42), this.std('#ffffff', { map: parchmentTexture() }));
    book.position.set(2.4, 1.04, c - 1.2);
    this.scene.add(book);
    for (let k = 0; k < 3; k++) this.box(0.03, 0.12, 0.01, this.std('#a02020'), 2.25 + k * 0.12, 1.1, c - 1.0);
    const inkwell = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.08, 12), this.std('#141418', { roughness: 0.2 }));
    inkwell.position.set(1.6, 1.04, c - 0.7);
    const quill = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.4, 6), this.std('#f2efe6'));
    quill.position.set(1.65, 1.2, c - 0.7);
    quill.rotation.z = 0.4;
    this.scene.add(inkwell, quill);
    for (let k = 0; k < 3; k++) {
      const seal = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 14), this.std('#9a1a1a'));
      seal.position.set(-1.35 + k * 0.13, 1.01, c - 0.7);
      this.scene.add(seal);
    }
    // the blue lamp lighting the numbers
    this.addLight(0, 3.6, c - 5.4, '#6aa8ff', 9, 7, false);
    const blue = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), new THREE.MeshBasicMaterial({ color: '#8fc4ff' }));
    blue.position.set(0, 3.8, c - 5.6);
    this.scene.add(blue);
    this.halo(blue, '#8fc4ff', 1.4);
    this.shelfWall(H_HALF_W - 0.3, c, -1.0, -Math.PI / 2, 21);
  }

  // ---------------------------------------------------------------------- 5 · dreidels

  private buildDreidels() {
    const c = hCenter('dreidels');
    // the giant golden dreidel on a rotating base
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.1, 0.5, 32), this.wood('#4a2c16'));
    base.position.set(0, 0.25, c - 3.4);
    this.scene.add(base);
    const big = new THREE.Group();
    const faces = ['נ', 'ג', 'ה', 'פ'].map((l) => this.std('#e2b34a', { metalness: 0.85, roughness: 0.3, map: glyphTexture(l, '#5a2a08', 256, 'Frank Ruhl Libre, serif') }));
    const cube = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 1.0), [faces[0], faces[1], this.gold(), this.gold(), faces[2], faces[3]]);
    cube.position.y = 1.4;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.7, 0.7, 4), this.gold());
    tip.rotation.set(Math.PI, Math.PI / 4, 0);
    tip.position.y = 0.75;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.6, 12), this.gold());
    handle.position.y = 2.2;
    big.add(cube, tip, handle);
    big.position.set(0, 0.0, c - 3.4);
    this.scene.add(big);
    this.animated.push((t) => (big.rotation.y = t * 0.35));
    this.addLight(0, 3.2, c - 2.4, '#ffcf80', 7, 8);
    // wooden stand with four places (2×2), and the table with four hint cards
    this.box(3.4, 0.08, 1.4, this.wood(), 2.8, 0.95, c - 1.2);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) this.box(0.1, 0.9, 0.1, this.std('#3a2414'), 2.8 + sx * 1.5, 0.45, c - 1.2 + sz * 0.55);
    const stand = this.box(1.1, 0.7, 0.2, this.wood('#6a4422'), 2.8, 1.35, c - 1.75);
    stand.castShadow = true;
    // physical positions as seen by a player standing in front of the stand (looking towards -z): left = -x
    const pos: Record<string, [number, number]> = { tl: [-0.27, 0.17], tr: [0.27, 0.17], bl: [-0.27, -0.17], br: [0.27, -0.17] };
    for (const [id, [dx, dy]] of Object.entries(pos)) {
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.11, 18), this.std('#2a1a0c'));
      hole.position.set(2.8 + dx, 1.35 + dy, c - 1.64);
      this.scene.add(hole);
      const slot = new THREE.Group();
      slot.position.set(2.8 + dx, 1.35 + dy - 0.08, c - 1.55);
      this.scene.add(slot);
      this.standSlots.set(id, slot);
    }
    for (let k = 0; k < 4; k++) {
      const card = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.24), this.std('#ffffff', { map: parchmentTexture() }));
      card.rotation.x = -Math.PI / 2;
      card.position.set(1.7 + k * 0.6 + (k > 1 ? 0.2 : 0), 1.0, c - 0.75);
      this.scene.add(card);
    }
    // wooden box with a numeric lock
    this.box(1.0, 0.6, 0.6, this.wood('#5a3416'), -2.8, 0.3, c - 1.6);
    const lid = new THREE.Group();
    this.box(1.0, 0.08, 0.6, this.wood('#6a4422'), 0, 0, 0.3, lid).castShadow = true;
    lid.position.set(-2.8, 0.64, c - 1.9);
    this.scene.add(lid);
    this.woodBoxLid = lid;
    this.openTargets.set(lid, { axis: 'x', kind: 'rot', from: 0, to: -1.7, on: false });
    this.box(0.36, 0.16, 0.04, this.std('#b8913f', { metalness: 0.8 }), -2.8, 0.42, c - 1.28);
    // floor with direction marks, gears, coins and candlesticks
    const marks = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ map: glyphTexture('⬆', '#c9a24d'), transparent: true, opacity: 0.35 }));
    marks.rotation.x = -Math.PI / 2;
    marks.position.set(0, 0.015, c + 2.2);
    this.scene.add(marks);
    for (let k = 0; k < 3; k++) {
      const gear = new THREE.Mesh(new THREE.TorusGeometry(0.35 - k * 0.08, 0.06, 6, 12), this.std('#8a6a3a', { metalness: 0.8 }));
      gear.position.set(-7.85, 2.4 + k * 0.6, c - 2 + k * 0.7);
      gear.rotation.y = Math.PI / 2;
      this.scene.add(gear);
      this.animated.push((t) => (gear.rotation.x = t * (k % 2 ? -0.4 : 0.4)));
    }
    this.box(1.4, 0.06, 0.7, this.wood(), -6.6, 1.0, c + 1.0);
    for (let k = 0; k < 6; k++) {
      const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.015, 14), this.gold());
      coin.position.set(-6.9 + k * 0.1, 1.04, c + 0.9 + (k % 2) * 0.15);
      this.scene.add(coin);
    }
    this.candle(-6.2, 1.03, c + 1.2, true);
    // the four small dreidels hidden in the room
    const where: Record<string, [number, number, number]> = {
      'dreidel-nun': [-5.6, 0.05, 3.6], 'dreidel-gimel': [5.8, 0.95, -4.4], 'dreidel-he': [-6.2, 0.95, -3.2], 'dreidel-pe': [4.2, 0.05, 4.8],
    };
    this.box(1.0, 0.9, 0.6, this.wood('#4a2c16'), 5.8, 0.45, c - 4.4);
    this.box(1.0, 0.9, 0.6, this.wood('#4a2c16'), -6.2, 0.45, c - 3.2);
    for (const [id, [x, y, z]] of Object.entries(where)) {
      const m = this.dreidelModel(id, 0.22);
      m.position.set(x, y, c + z);
      this.addItem(id, m);
    }
  }

  // ---------------------------------------------------------------------- 6 · oil lab

  private buildLab(scenario: ScenarioContent | null) {
    const c = hCenter('lab');
    this.box(6.4, 0.9, 1.6, this.std('#6a6670', { map: stoneTexture([2, 1]) }), 0, 0.45, c - 2.2);
    const jugs: { id: string; text: string }[] = scenario?.puzzles.find((p) => p.id === 'h6-jugs')?.publicData?.jugs ?? [];
    const pts = [0, 0.32, 0.42, 0.38, 0.22, 0.14, 0.18, 0.2].map((r, k) => new THREE.Vector2(r, k * 0.14));
    jugs.forEach((j, k) => {
      // left to right as seen from the room: א, ב, ג, ד
      const x = -2.4 + k * 1.6;
      const jug = new THREE.Mesh(new THREE.LatheGeometry(pts, 24), this.std('#c8a46a', { roughness: 0.55 }));
      jug.position.set(x, 0.9, c - 2.2);
      this.scene.add(jug);
      const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ map: glyphTexture(j.id, '#3a2410', 128, 'Frank Ruhl Libre, serif'), transparent: true }));
      tag.position.set(x, 1.35, c - 1.78);
      this.scene.add(tag);
      this.label(j.text, 1.4, 0.35, x, 0.55, c - 1.39, 0);
    });
    const sign = this.label('„רק אחת מארבע הכתובות שעל הכדים נכונה.”', 4.8, 0.6, 0, 3.1, c - 3.55, 0, { bg: '#2a2016', color: '#ffd36b' });
    sign.renderOrder = 1;
    this.box(5.2, 0.8, 0.1, this.std('#2a2016'), 0, 3.1, c - 3.62);
    // the pure oil jug revealed in a niche after the right choice
    this.jugGlow = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), new THREE.MeshBasicMaterial({ color: '#ffd36b', transparent: true, opacity: 0 }));
    this.jugGlow.position.set(0, 1.4, c - 3.3);
    this.scene.add(this.jugGlow);
    // scales, test tubes, shelves, book, lab lamp
    const scaleBar = this.box(0.9, 0.04, 0.04, this.gold(), -4.4, 1.6, c - 3.0);
    this.box(0.04, 0.7, 0.04, this.gold(), -4.4, 1.25, c - 3.0);
    for (const sx of [-1, 1]) {
      const pan = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.04, 16), this.gold());
      pan.position.set(-4.4 + sx * 0.4, 1.35, c - 3.0);
      this.scene.add(pan);
    }
    this.animated.push((t) => (scaleBar.rotation.z = Math.sin(t * 0.8) * 0.04));
    this.box(1.0, 0.9, 0.7, this.std('#5a5660', { map: stoneTexture([1, 1]) }), -4.4, 0.45, c - 3.0);
    this.box(1.2, 0.9, 0.7, this.std('#5a5660', { map: stoneTexture([1, 1]) }), 4.4, 0.45, c - 3.0);
    for (let k = 0; k < 5; k++) {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 10), new THREE.MeshStandardMaterial({ color: ['#e6c85a', '#c8a03a', '#a8c86a', '#d6b46a', '#f0e090'][k], transparent: true, opacity: 0.75 }));
      tube.position.set(4.0 + k * 0.18, 1.06, c - 3.0);
      this.scene.add(tube);
    }
    this.box(2.0, 0.9, 1.0, this.std('#5a5660', { map: stoneTexture([1, 1]) }), 3.0, 0.45, c - 0.4);
    const book = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.42), this.std('#ffffff', { map: parchmentTexture() }));
    book.position.set(3.0, 0.93, c - 0.4);
    this.scene.add(book);
    this.shelfWall(-H_HALF_W + 0.3, c, 2.0, Math.PI / 2, 31);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), new THREE.MeshBasicMaterial({ color: '#fff0c0' }));
    lamp.position.set(0, 4.6, c - 2.2);
    this.scene.add(lamp);
    this.addLight(0, 4.2, c - 2.0, '#fff0c0', 8, 8);
    // locking mechanism on the gate
    this.box(0.6, 0.6, 0.12, this.std('#7a7a82', { metalness: 0.85 }), 1.6, 2.0, c - H_HALF_D + 0.1);
  }

  // ---------------------------------------------------------------------- 7 · mosaic and mirrors

  private buildMosaic(scenario: ScenarioContent | null) {
    const c = hCenter('mosaic');
    const data = scenario?.puzzles.find((p) => p.id === 'h7-mosaic')?.publicData;
    const tiles: string[] = data?.tiles ?? [];
    const size = 0.95;
    const cx = 0;
    const cy = 2.3;
    // stone frame
    this.box(size * 3 + 0.5, size * 3 + 0.5, 0.2, this.std('#3a3448', { map: stoneTexture([1, 1]) }), cx, cy, c - H_HALF_D + 0.12);
    tiles.forEach((kind, i) => {
      const r = Math.floor(i / 3);
      const col = i % 3;
      const mat = new THREE.MeshStandardMaterial({ map: stoneGrooveTexture(kind, false), roughness: 0.6 });
      const m = new THREE.Mesh(new THREE.BoxGeometry(size * 0.94, size * 0.94, 0.12), [this.std('#2e3a52'), this.std('#2e3a52'), this.std('#2e3a52'), this.std('#2e3a52'), mat, mat]);
      m.position.set(cx + (col - 1) * size, cy + (1 - r) * size, c - H_HALF_D + 0.28);
      this.scene.add(m);
      this.mosaicStones.push({ mesh: m, kind });
    });
    // blue light source at the entry (left of the middle row) and the golden menorah symbol at the target (right)
    const src = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12), new THREE.MeshBasicMaterial({ color: '#7ab8ff' }));
    src.position.set(cx - size * 2, cy, c - H_HALF_D + 0.3);
    this.scene.add(src);
    this.halo(src, '#7ab8ff', 1.6);
    this.addLight(cx - size * 2, cy, c - H_HALF_D + 0.8, '#7ab8ff', 6, 6, false);
    const target = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), new THREE.MeshBasicMaterial({ map: glyphTexture('🕎'), transparent: true }));
    target.position.set(cx + size * 2, cy, c - H_HALF_D + 0.3);
    this.scene.add(target);
    this.mosaicBeam = new THREE.Mesh(new THREE.PlaneGeometry(size * 5, 0.12), new THREE.MeshBasicMaterial({ color: '#9fd0ff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.mosaicBeam.position.set(cx, cy, c - H_HALF_D + 0.4);
    this.scene.add(this.mosaicBeam);
    // small mirrors, levers, spare stones; the stone gate with the flame symbol is the door to the hall
    for (let k = 0; k < 3; k++) {
      const mirror = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.9), this.std('#cfe2ff', { metalness: 1, roughness: 0.05 }));
      mirror.position.set(-5.8 + k * 0.4, 1.6, c - 3.4 + k * 0.6);
      mirror.rotation.y = 0.6;
      this.scene.add(mirror);
    }
    for (let k = 0; k < 2; k++) {
      const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 8), this.std('#9a9aa0', { metalness: 0.8 }));
      lever.position.set(3.2 + k * 0.4, 1.0, c - 5.6);
      lever.rotation.z = 0.4;
      this.scene.add(lever);
    }
    this.box(1.0, 0.8, 0.8, this.std('#4a4458', { map: stoneTexture([1, 1]) }), 3.4, 0.4, c - 5.6);
    for (let k = 0; k < 4; k++) this.box(0.4, 0.4, 0.1, this.std('#3a4662'), 5.2 + (k % 2) * 0.45, 0.25, c - 2.6 + Math.floor(k / 2) * 0.3);
    const flame = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), new THREE.MeshBasicMaterial({ map: glyphTexture('🔥'), transparent: true }));
    flame.position.set(0, DOOR_H + 0.5, c - H_HALF_D + 0.05);
    this.scene.add(flame);
    this.addLight(0, 3.0, c - 2.0, '#7a9cff', 7, 10);
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), this.std('#ffffff', { map: rugTexture('#1d2a4a', '#9fd0ff', 4), roughness: 0.95 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0, 0.012, c + 0.5);
    this.scene.add(rug);
  }

  // ---------------------------------------------------------------------- 8 · hall of light

  private buildHall() {
    const c = hCenter('hall');
    // central stone pedestal with the glowing oil jug
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.75, 1.2, 24), this.std('#6a6476', { map: stoneTexture([1, 1]) }));
    ped.position.set(0, 0.6, c - 1.6);
    this.scene.add(ped);
    const jug = this.itemModel('golden-jug');
    jug.scale.setScalar(2.2);
    jug.position.set(0, 1.2, c - 1.6);
    this.scene.add(jug);
    this.halo(jug, '#ffd36b', 1.6);
    // the hall hanukkiah: same model, larger
    const h = new Hanukkiah(2.0);
    h.root.position.set(0, 0, c - 5.2);
    this.scene.add(h.root);
    this.hanukkiot.push(h);
    this.hallHanukkiah = h;
    this.box(4.2, 0.3, 1.0, this.std('#4a4458', { map: stoneTexture([2, 1]) }), 0, 0.15, c - 5.2);
    // seven pedestals in an arc, each with a hint plaque and a place for its item
    for (let k = 1; k <= 7; k++) {
      const a = Math.PI * (0.15 + (k - 1) * (0.7 / 6));
      const x = Math.cos(a) * -4.6;
      const z = -1.2 - Math.sin(a) * 3.4;
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 1.0, 16), this.std('#5a5468', { map: stoneTexture([1, 1]) }));
      p.position.set(x, 0.5, c + z);
      this.scene.add(p);
      const num = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), new THREE.MeshBasicMaterial({ map: glyphTexture(String(k), '#ffd36b', 128, 'Heebo, sans-serif'), transparent: true }));
      num.position.set(x, 0.6, c + z + 0.41);
      this.scene.add(num);
      const slot = new THREE.Group();
      slot.position.set(x, 1.15, c + z);
      this.scene.add(slot);
      this.pedestalItems.set(`p${k}`, slot);
    }
    // the open book with the last riddle on a lectern
    this.box(0.12, 1.0, 0.12, this.wood('#3a2414'), 0, 0.5, c + 1.4);
    const book = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.5), this.std('#ffffff', { map: parchmentTexture() }));
    book.position.set(0, 1.05, c + 1.4);
    book.rotation.x = -0.3;
    this.scene.add(book);
    // the blue gate on the back wall
    this.hallGate = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 4.6), new THREE.MeshBasicMaterial({ map: glowSpriteTexture('#4a8cff'), transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.hallGate.position.set(0, 2.5, c - H_HALF_D + 0.08);
    this.scene.add(this.hallGate);
    const arch = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.18, 10, 40, Math.PI), this.std('#3a3448', { map: stoneTexture([2, 1]) }));
    arch.position.set(0, 2.6, c - H_HALF_D + 0.15);
    this.scene.add(arch);
    // treasure chest
    this.box(1.2, 0.6, 0.7, this.wood('#5a3416'), 5.2, 0.3, c + 2.4);
    const lid = new THREE.Group();
    this.box(1.2, 0.12, 0.7, this.std('#c9a24d', { metalness: 0.7 }), 0, 0, 0.35, lid);
    lid.position.set(5.2, 0.66, c + 2.05);
    this.scene.add(lid);
    this.openTargets.set(lid, { axis: 'x', kind: 'rot', from: 0, to: -1.6, on: false });
    this.chestLid = lid;
    // floating particles of light
    const n = this.quality === 'low' ? 80 : 220;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pos.set([(Math.random() - 0.5) * 12, Math.random() * 5, c + (Math.random() - 0.5) * 10], i * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.particles = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#ffe6a0', size: 0.05, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.scene.add(this.particles);
    this.addLight(0, 3.2, c - 3, '#7a9cff', 8, 12);
    this.addLight(0, 2.0, c - 1.0, '#ffcf80', 5, 8);
  }

  private chestLid?: THREE.Object3D;

  // ======================================================================= state

  /** Shows the server state: open doors, items, mechanisms and the hanukkiah's lit candles. */
  applySnapshot(s: RoomSnapshot, scenario: ScenarioContent | null) {
    this.unlocked = new Set(s.unlockedZones);
    this.rects = hWalkable(this.unlocked);
    for (const [zone] of this.doors) this.doorOpen.set(zone, this.unlocked.has(zone) ? 1 : 0);
    this.worldItems = new Set(s.worldItems);
    const solved = (id: string) => s.puzzles.find((p) => p.id === id)?.status === 'solved';
    for (const [id, mesh] of this.itemMeshes) mesh.visible = this.worldItems.has(id);
    const m = s.mechanisms ?? {};

    this.setOpen(this.drawerFront, solved('h1-riddle'));
    this.fillSlots(this.lampSlots, ['s1', 's2', 's3', 's4', 's5'], m['h2-lamp'], (slot, item) => {
      const k = ['s1', 's2', 's3', 's4', 's5'].indexOf(slot);
      const o = this.itemModel(item);
      o.scale.setScalar(1.3);
      o.position.y = 0.06 + k * 0.02;
      return o;
    });
    const lampLit = solved('h2-lamp');
    if (this.lampGlow) this.lampGlow.intensity = lampLit ? 9 : 0;
    if (this.keySymbol) (this.keySymbol.material as THREE.MeshBasicMaterial).opacity = lampLit ? 0.9 : 0;

    const maze = m['h3-maze'];
    if (maze?.key?.length === 2) this.mazeKeyTarget.set(this.mazeOrigin.x + maze.key[1] * MAZE_CELL, this.mazeOrigin.y + 0.05, this.mazeOrigin.z + maze.key[0] * MAZE_CELL);
    if (maze) {
      ['a', 'b', 'c'].forEach((g, i) => {
        const gate = this.mazeGates.get(g);
        if (gate) gate.position.y = this.mazeOrigin.y + (maze.levers[i] ? -0.12 : 0.04);
        const lever = this.mazeLevers[i];
        if (lever) lever.rotation.z = maze.levers[i] ? -0.5 : 0.5;
      });
    }
    this.setOpen(this.metalBoxLid, solved('h3-box'));
    if (solved('h4-wheel')) this.wheelRings.forEach((r, k) => (r.rotation.x = 0.6 + k * 0.4));
    this.fillSlots([...this.standSlots.values()], [...this.standSlots.keys()], m['h5-stand'], (_slot, item) => this.dreidelModel(item, 0.16));
    this.setOpen(this.woodBoxLid, solved('h5-lock'));
    if (this.jugGlow) (this.jugGlow.material as THREE.MeshBasicMaterial).opacity = solved('h6-jugs') ? 0.35 : 0;

    const mosaic = m['h7-mosaic'];
    if (mosaic?.rotations) {
      const lit = new Set((mosaic.lit ?? []).map(([r, c]) => r * 3 + c));
      this.mosaicStones.forEach((st, i) => {
        st.mesh.rotation.z = -(mosaic.rotations[i] ?? 0) * (Math.PI / 2);
        const on = lit.has(i);
        if (st.lit !== on) {
          st.lit = on;
          const mat = new THREE.MeshStandardMaterial({ map: stoneGrooveTexture(st.kind, on), roughness: 0.6, emissive: on ? '#1a3a6a' : '#000000' });
          const mats = st.mesh.material as THREE.Material[];
          mats[4] = mat;
          mats[5] = mat;
        }
      });
      if (this.mosaicBeam) (this.mosaicBeam.material as THREE.MeshBasicMaterial).opacity = mosaic.reached ? 0.7 : 0;
    }
    this.fillSlots([...this.pedestalItems.values()], [...this.pedestalItems.keys()], m['h8-pedestals'], (_slot, item) => this.itemModel(item));

    // the hanukkiah follows the stage of the game: one candle per completed room, the shamash once the journey began
    const done = scenario ? H_ZONES.filter((z) => {
      const ps = scenario.puzzles.filter((p) => p.zone === z);
      return ps.length > 0 && ps.every((p) => solved(p.id));
    }).length : 0;
    if (this.mode !== 'outro') for (const h of this.hanukkiot) h.setLit(Math.min(done, 8), done > 0);
    this.gateTarget = s.phase === 'completed' ? 1.4 : this.unlocked.has('hall') ? 0.5 : 0.2;
    this.setOpen(this.chestLid, s.phase === 'completed');
  }

  private fillSlots(holders: THREE.Object3D[], ids: string[], mech: MechanismState | undefined, make: (slot: string, item: string) => THREE.Object3D) {
    ids.forEach((slot, k) => {
      const holder = holders[k];
      if (!holder) return;
      const want = mech?.slots?.[slot] ?? '';
      if (holder.userData['item'] === want) return;
      holder.clear();
      holder.userData['item'] = want;
      if (want) holder.add(make(slot, want));
    });
  }

  private setOpen(obj: THREE.Object3D | undefined, on: boolean) {
    const t = obj && this.openTargets.get(obj);
    if (t) t.on = on;
  }

  setPlayers(players: PlayerDto[], myId: string | null, positions: Map<string, RemotePosition & { t: number }>) {
    this.positions = positions;
    const me = players.find((p) => p.id === myId);
    if (me && !this.local) {
      this.local = new BoyAvatar(me.characterId, me.appearance);
      this.scene.add(this.local.root);
      this.local.root.position.copy(this.localPos);
      this.local.root.visible = this.mode !== 'intro';
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
        const start = new THREE.Vector3(-2 + (p.seat % 5), 0, SPAWN.z + 0.8);
        avatar.root.position.copy(start);
        avatar.root.visible = this.mode !== 'intro';
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

  resetPlayer() {
    this.localPos.copy(SPAWN);
    this.localYaw = Math.PI;
    this.camYaw = 0;
  }

  placePlayer(p: RemotePosition) {
    if (this.canStand(p.x, p.z)) this.localPos.set(p.x, 0, p.z);
  }

  focusOn(objectId: string) {
    return this.hitTargets.get(objectId)?.position.clone() ?? null;
  }

  setMode(mode: HMode) {
    this.mode = mode;
    this.modeTime = 0;
    const show = mode !== 'intro';
    if (this.local) this.local.root.visible = show;
    for (const r of this.remotes.values()) r.avatar.root.visible = show;
    if (mode === 'outro') this.outroLit = this.hallHanukkiah?.litCount ?? 0;
  }

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
      this.tick(Math.min(0.05, this.clock.getDelta()), this.clock.elapsedTime);
    };
    loop();
    // keep the world updating at a low rate when requestAnimationFrame is throttled (hidden/embedded views)
    this.watchdog = setInterval(() => {
      if (this.disposed || document.hidden || performance.now() - lastFrame < 250) return;
      this.tick(Math.min(0.1, this.clock.getDelta()), this.clock.elapsedTime);
    }, 100);
  }

  private tick(dt: number, t: number) {
    this.modeTime += dt;
    for (const f of this.flickers) f.light.intensity = f.base * (0.85 + 0.15 * Math.sin(t * 9 + f.seed) * Math.sin(t * 5.3 + f.seed * 2));
    for (const a of this.animated) a(t, dt);
    for (const h of this.hanukkiot) h.update(t);
    for (const [zone, door] of this.doors) {
      const target = this.doorOpen.get(zone) ?? 0;
      const cur = this.doorProgress.get(zone) ?? target;
      const next = THREE.MathUtils.lerp(cur, target, Math.min(1, dt * 1.2));
      this.doorProgress.set(zone, next);
      door.position.y = DOOR_H / 2 + next * (DOOR_H + 0.2);
    }
    for (const [obj, o] of this.openTargets) {
      const goal = o.on ? o.to : o.from;
      if (o.kind === 'rot') obj.rotation[o.axis] = THREE.MathUtils.lerp(obj.rotation[o.axis], goal, Math.min(1, dt * 3));
      else obj.position[o.axis] = THREE.MathUtils.lerp(obj.position[o.axis], goal, Math.min(1, dt * 3));
    }
    if (this.mazeKey) this.mazeKey.position.lerp(this.mazeKeyTarget, Math.min(1, dt * 10));
    this.gatePower = THREE.MathUtils.lerp(this.gatePower, this.gateTarget, Math.min(1, dt));
    if (this.hallGate) (this.hallGate.material as THREE.MeshBasicMaterial).opacity = 0.25 + this.gatePower * 0.5 + Math.sin(t * 2) * 0.05;
    if (this.particles) {
      const p = this.particles.geometry.attributes['position'] as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        let y = p.getY(i) + dt * (0.15 + this.gatePower * 0.4);
        if (y > 5.5) y = 0;
        p.setY(i, y);
      }
      p.needsUpdate = true;
    }

    if (this.mode === 'intro') this.introCamera(this.modeTime);
    else if (this.mode === 'outro') this.outroCamera(this.modeTime, t);
    else if (this.mode === 'cutscene' && this.cut) this.cutsceneCamera(dt, t);
    else this.playUpdate(dt, t);

    this.updateRemotes(dt, t);
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /** Opening scene in the library: around the desk and the letter, ending at the group's starting point. */
  private introCamera(s: number) {
    const keys: [number, THREE.Vector3, THREE.Vector3][] = [
      [0, new THREE.Vector3(6, 4.2, 6), new THREE.Vector3(4.6, 1.6, -6.4)],
      [7, new THREE.Vector3(2, 2.6, -2.5), new THREE.Vector3(4.6, 1.8, -6.4)],
      [14, new THREE.Vector3(-4.5, 3.0, 3.5), new THREE.Vector3(0, 1.0, -1.2)],
      [20, new THREE.Vector3(-1.0, 2.0, 0.6), new THREE.Vector3(-1.2, 1.0, -1.2)],
      [24, new THREE.Vector3(0, 2.4, 7.5), new THREE.Vector3(0, 1.4, -1.5)],
    ];
    let i = 0;
    while (i < keys.length - 2 && s > keys[i + 1][0]) i++;
    const [t0, p0, l0] = keys[i];
    const [t1, p1, l1] = keys[i + 1];
    const k = THREE.MathUtils.smootherstep(Math.min(1, Math.max(0, (s - t0) / (t1 - t0))), 0, 1);
    this.camera.position.lerpVectors(p0, p1, k);
    this.camera.lookAt(new THREE.Vector3().lerpVectors(l0, l1, k));
  }

  /** Finale in the hall: the eight candles light one after another, the shamash stays separate and higher. */
  private outroCamera(s: number, t: number) {
    const c = hCenter('hall');
    this.camera.position.lerpVectors(new THREE.Vector3(0, 3.0, c + 5.5), new THREE.Vector3(0, 2.4, c + 1.5), THREE.MathUtils.smootherstep(Math.min(1, s / 8), 0, 1));
    this.camera.lookAt(0, 2.0, c - 5.2);
    const want = Math.min(8, Math.max(this.outroLit, Math.floor((s - 1) / 0.7)));
    if (this.hallHanukkiah && want !== this.hallHanukkiah.litCount) for (const h of this.hanukkiot) h.setLit(want, true);
    if (s > 7) this.gateTarget = 1.6;
    const all = [this.local, ...[...this.remotes.values()].map((r) => r.avatar)].filter(Boolean) as BoyAvatar[];
    all.forEach((a, k) => {
      const x = (k - (all.length - 1) / 2) * 1.1;
      a.root.position.lerp(new THREE.Vector3(x, 0, c - 0.2), 0.05);
      a.root.rotation.y = Math.PI;
      a.root.visible = true;
      if (s > 6.5) a.cheer(t + k);
      else a.update(0.016, 2, t);
    });
  }

  private playUpdate(dt: number, t: number) {
    if (!this.local) return;
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
      let diff = Math.atan2(dx, dz) - this.localYaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.localYaw += diff * Math.min(1, dt * 12);
      this.localSpeed = speed;
    } else this.localSpeed = 0;
    if (!hInRects(this.rects, this.localPos.x, this.localPos.z)) this.localPos.copy(SPAWN);
    this.local.root.position.copy(this.localPos);
    this.local.root.rotation.y = this.localYaw;
    this.local.update(dt, this.localSpeed, t);

    const pivot = new THREE.Vector3(this.localPos.x, 1.6, this.localPos.z);
    const dir = new THREE.Vector3(Math.sin(this.camYaw) * Math.cos(this.camPitch), Math.sin(this.camPitch), Math.cos(this.camYaw) * Math.cos(this.camPitch));
    const cam = new THREE.Vector3();
    const roomish = this.rects.map((r) => ({ x0: r.x0 - 0.45, x1: r.x1 + 0.45, z0: r.z0 - 0.45, z1: r.z1 + 0.45 }));
    for (let dist = this.camDist; dist > 0.8; dist -= 0.2) {
      cam.copy(pivot).addScaledVector(dir, dist);
      if (hInRects(roomish, cam.x, cam.z) && cam.y < H_WALL - 0.3) break;
    }
    if (this.snapCamera) {
      this.camera.position.copy(cam);
      this.snapCamera = false;
    } else this.camera.position.lerp(cam, Math.min(1, dt * 10));
    this.camera.lookAt(pivot);

    const zone = hZoneAt(this.localPos.z);
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

  canStand(x: number, z: number) {
    return hInRects(this.rects, x, z) && !hInRects(this.obstacles, x, z);
  }

  /** The camera turns to the door that just opened and watches it rise. */
  playDoorCutscene(zone: string) {
    const i = H_ZONES.indexOf(zone as HZone);
    if (i <= 0 || this.mode !== 'play') return;
    const doorZ = hCenter(H_ZONES[i - 1]) - H_HALF_D;
    this.doorProgress.set(zone as HZone, 0);
    this.cut = { from: this.camera.position.clone(), to: new THREE.Vector3(2.2, 2.6, doorZ + 6), look: new THREE.Vector3(0, 1.9, doorZ - 2.5), t: 0, dur: 5 };
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

  /** Moves the local player to the entrance of a room (group transition or reconnect). */
  transferTo(zone: HZone, slot: number) {
    this.cut = undefined;
    if (this.mode === 'cutscene') this.mode = 'play';
    const c = hCenter(zone);
    const z = zone === 'library' ? SPAWN.z : c + 5.2;
    const x = ((slot % 5) - 2) * 0.9;
    if (this.canStand(x, z)) this.localPos.set(x, 0, z);
    else this.localPos.set(0, 0, z);
    this.localYaw = Math.PI;
    this.camYaw = 0;
    this.snapCamera = true;
    this.lastSentKey = '';
    this.lastSent = 0;
    if (this.currentZone !== zone) {
      this.currentZone = zone;
      this.placeKeyLight(zone);
      this.cb.onZoneChange?.(zone);
    }
  }

  get localZone(): HZone {
    return hZoneAt(this.localPos.z);
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
    // E uses the object under the pointer, or else the nearest one in reach (keyboard-only play)
    if (e.code === 'KeyE' && this.mode === 'play') {
      if (this.hovered) this.tryInteract(this.hovered);
      else this.interactNearest();
    }
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
    c.addEventListener('wheel', (e) => (this.camDist = THREE.MathUtils.clamp(this.camDist + e.deltaY * 0.004, 2.4, 7.5)), { passive: true });
  }

  private available(def: HInteractable) {
    return this.unlocked.has(def.zone) && (!def.itemId || this.worldItems.has(def.itemId));
  }

  private pick(): HInteractable | null {
    if (Math.abs(this.pointer.x) > 1) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const targets = [...this.hitTargets.values()].filter((m) => this.available(m.userData['def'] as HInteractable));
    const hits = this.raycaster.intersectObjects(targets, false);
    if (!hits.length) return null;
    const item = hits.find((h) => (h.object.userData['def'] as HInteractable).itemId && h.distance < hits[0].distance + 1.5);
    return ((item ?? hits[0]).object.userData['def'] as HInteractable) ?? null;
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

  private tryInteract(def: HInteractable) {
    const [x, , z] = hWorldPos(def);
    const d = Math.hypot(x - this.localPos.x, z - this.localPos.z);
    if (d > INTERACT_DISTANCE + def.radius) this.cb.onTooFar?.(def);
    else this.cb.onInteract?.(def);
  }

  /** Uses the nearest object in reach (mobile action button / keyboard). */
  interactNearest() {
    let best: HInteractable | null = null;
    let bestD = Infinity;
    for (const def of H_INTERACTABLES) {
      if (!this.available(def)) continue;
      const [x, , z] = hWorldPos(def);
      // decorations only win when nothing useful is about as close
      const d = Math.hypot(x - this.localPos.x, z - this.localPos.z) - def.radius + (def.kind === 'decor' ? 1.2 : 0);
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
