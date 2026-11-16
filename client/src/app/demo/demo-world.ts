import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Quality } from '../core/settings.service';
import { PlayerAvatar, createPlayerAvatar } from '../world/character';
import { characterLoader } from '../world/character/character-loader';
import { glowSpriteTexture, panelTexture, paintingTexture, parchmentTexture, stoneTexture, woodFloorTexture } from '../world/textures';
import { DEMO_SPOTS, DemoSpot, DemoSpotId } from './demo-content';

/**
 * "טעימה מהפורטל": the locked room of the free taste. One room of the mansion, played alone, with no server room and no
 * SignalR. It reuses what the games already have: the library modelled in Blender (models/library/library.glb), the shared
 * player character, the canvas textures, the third-person camera and the same controls (WASD/arrows, drag to look, E or a
 * click on an object, the touch joystick). Nothing here touches the worlds of the existing games.
 */

const HALF_W = 8;
const HALF_D = 7;
const WALL = 6.5;
const DOOR_W = 2.4;
const DOOR_H = 3.4;
const INTERACT_DISTANCE = 2.6;
const SPAWN = new THREE.Vector3(0, 0, 4.4);
const LIBRARY_MODEL_VERSION = 3;

type Rect = { x0: number; x1: number; z0: number; z1: number };
const WALKABLE: Rect[] = [{ x0: -7.2, x1: 7.2, z0: -6.0, z1: 6.3 }];
/** Furniture of the library model the player cannot walk through (the same footprint the games use). */
const OBSTACLES: Rect[] = [
  [-3.2, 2.2, -2.2, -0.4], [-7.6, -6.5, 0.6, 1.3], [-7.25, -5.95, 2.05, 2.95], [5.25, 5.95, 3.3, 3.9], [3.1, 3.7, -3.5, -2.9],
  [3.75, 5.45, -7.0, -6.0], [-2.8, -2.3, -6.6, -6.1], [2.3, 2.8, -6.6, -6.1], [6.85, 8.0, 2.35, 4.25],
].map(([x0, x1, z0, z1]) => ({ x0, x1, z0, z1 }));
const inRects = (rs: Rect[], x: number, z: number) => rs.some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);

export type DemoMode = 'intro' | 'play' | 'door' | 'done';

export interface DemoWorldCallbacks {
  /** The object the player would use now (pointed at, or the nearest one in reach), or null. */
  onFocus?(spot: DemoSpot | null): void;
  onInteract?(spot: DemoSpot): void;
  onTooFar?(spot: DemoSpot): void;
  onIntroDone?(): void;
  /** The door has finished opening. */
  onDoorOpened?(): void;
}

interface SpotView {
  spot: DemoSpot;
  hit: THREE.Mesh;
  glow: THREE.Sprite;
  spark: THREE.Sprite;
  mats: THREE.MeshStandardMaterial[];
  pos: THREE.Vector3;
}

export class DemoWorld {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(58, 1, 0.05, 200);
  private composer?: EffectComposer;
  private clock = new THREE.Clock();
  private raf = 0;
  private watchdog?: ReturnType<typeof setInterval>;
  private disposed = false;
  private resizeObs: ResizeObserver;
  private mode: DemoMode = 'intro';
  private modeTime = 0;
  private lastTick = 0;
  private animated: ((t: number, dt: number) => void)[] = [];
  private flickers: { light: THREE.PointLight; base: number; seed: number }[] = [];

  // player and camera
  private local?: PlayerAvatar;
  private localPos = SPAWN.clone();
  private localYaw = Math.PI;
  private localSpeed = 0;
  private camYaw = 0;
  private camPitch = 0.3;
  private camDist = 4.2;
  private snapCamera = true;
  private keys = new Set<string>();
  private joystick = new THREE.Vector2();
  sensitivity = 1;

  // interaction
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2(10, 10);
  private drag?: { x: number; y: number; moved: boolean; id: number; touch: boolean };
  private spots = new Map<DemoSpotId, SpotView>();
  private hovered: DemoSpot | null = null;
  private focused: DemoSpot | null = null;
  private inspected = new Set<DemoSpotId>();
  private time = 0;

  // the door and the finale
  private leaves: THREE.Object3D[] = [];
  private doorOpen = 0;
  private doorTarget = 0;
  private portalLight?: THREE.PointLight;
  private portalGlow?: THREE.Mesh;
  private keypadMat?: THREE.MeshStandardMaterial;
  private keypadFlash = 0;
  private hemi = new THREE.HemisphereLight('#b8a890', '#3a2a18', 0.7);
  private ambient = new THREE.AmbientLight('#b0a890', 0.22);
  private doorOpenedSent = false;

  constructor(private canvas: HTMLCanvasElement, private quality: Quality, private cb: DemoWorldCallbacks = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 2 : quality === 'medium' ? 1.5 : 1.25));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.5;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color('#060a1a');
    this.scene.fog = new THREE.FogExp2('#0a0e1c', 0.018);
    if (quality !== 'low') {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(512, 512), quality === 'high' ? 0.6 : 0.45, 0.45, 0.88));
      this.composer.addPass(new OutputPass());
    }
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(canvas.parentElement ?? canvas);
    this.resize();
    this.bindInput();
  }

  // ======================================================================= loading

  /**
   * Builds the room and loads its two downloads (the library model and the player character), reporting progress 0..1.
   * Either download may fail: the room then keeps a plain built-in look, and the player is drawn without a figure.
   */
  async load(onProgress: (p: number) => void): Promise<void> {
    this.buildShell();
    this.buildDoor();
    this.buildItems();
    this.buildLights();
    this.buildDust();
    let lib = 0;
    let figure = 0;
    const report = () => onProgress(Math.min(1, lib * 0.75 + figure * 0.25));
    const library = new Promise<void>((resolve) => {
      new GLTFLoader().load(`models/library/library.glb?v=${LIBRARY_MODEL_VERSION}`, (gltf) => {
        if (!this.disposed) this.addLibrary(gltf.scene);
        lib = 1;
        report();
        resolve();
      }, (e) => {
        if (e.total) {
          lib = Math.min(0.99, e.loaded / e.total);
          report();
        }
      }, () => {
        if (!this.disposed) this.buildClassicFurniture();
        lib = 1;
        report();
        resolve();
      });
    });
    const character = characterLoader.load().catch(() => undefined).then(() => {
      figure = 1;
      report();
    });
    await Promise.all([library, character]);
    if (this.disposed) return;
    this.local = createPlayerAvatar('detective', null);
    this.local.root.visible = false;
    this.scene.add(this.local.root);
    if (this.quality !== 'low') this.enableShadows();
    onProgress(1);
  }

  // ======================================================================= build

  private std(color: string, opts: THREE.MeshStandardMaterialParameters = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...opts });
  }

  private box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.scene) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  private buildShell() {
    const wallMat = this.std('#7a6e66', { map: stoneTexture([5, 2.5]) });
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, HALF_D * 2), this.std('#2b2420'));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = WALL;
    this.scene.add(ceil);
    for (const sx of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(HALF_D * 2, WALL), wallMat);
      wall.rotation.y = -sx * Math.PI / 2;
      wall.position.set(sx * HALF_W, WALL / 2, 0);
      this.scene.add(wall);
      this.box(0.06, 1.3, HALF_D * 2, this.std('#ffffff', { map: panelTexture([7, 1]), roughness: 0.6 }), sx * (HALF_W - 0.03), 0.65, 0);
    }
    // the front wall (behind the player at the start) is whole; the back wall has the doorway of the locked door
    const front = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, WALL), wallMat);
    front.rotation.y = Math.PI;
    front.position.set(0, WALL / 2, HALF_D);
    this.scene.add(front);
    const side = (HALF_W * 2 - DOOR_W) / 2;
    const add = (w: number, h: number, x: number, y: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat);
      m.position.set(x, y, -HALF_D);
      this.scene.add(m);
    };
    add(side, WALL, -(DOOR_W / 2 + side / 2), WALL / 2);
    add(side, WALL, DOOR_W / 2 + side / 2, WALL / 2);
    add(DOOR_W, WALL - DOOR_H, 0, DOOR_H + (WALL - DOOR_H) / 2);
    for (const bx of [-4, 0, 4]) this.box(0.3, 0.3, HALF_D * 2, this.std('#3a2a1c'), bx, WALL - 0.18, 0);

    // beyond the door: a short passage that ends in the glow of the portal (seen only once the door opens)
    const len = 3.2;
    const z0 = -HALF_D;
    const pf = new THREE.Mesh(new THREE.PlaneGeometry(DOOR_W, len), this.std('#4a4450', { map: stoneTexture([1, 1.4]) }));
    pf.rotation.x = -Math.PI / 2;
    pf.position.set(0, 0.004, z0 - len / 2);
    this.scene.add(pf);
    for (const sx of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(len, DOOR_H), wallMat);
      w.rotation.y = -sx * Math.PI / 2;
      w.position.set(sx * DOOR_W / 2, DOOR_H / 2, z0 - len / 2);
      this.scene.add(w);
    }
    const glowMat = new THREE.MeshBasicMaterial({ map: portalTexture(), transparent: true, opacity: 0, toneMapped: false, depthWrite: false });
    this.portalGlow = new THREE.Mesh(new THREE.PlaneGeometry(DOOR_W, DOOR_H), glowMat);
    this.portalGlow.position.set(0, DOOR_H / 2, z0 - len + 0.05);
    this.scene.add(this.portalGlow);
    this.portalLight = new THREE.PointLight('#8fc4ff', 0, 14, 1.4);
    this.portalLight.position.set(0, 1.8, z0 - 0.8);
    this.scene.add(this.portalLight);

    // a mysterious old map of the estate on the left wall, and a portrait on the right one
    const map = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.5), this.std('#ffffff', { map: estateMapTexture(), roughness: 0.9 }));
    map.rotation.y = Math.PI / 2;
    map.position.set(-HALF_W + 0.06, 2.6, 3.7);
    this.scene.add(map);
    const frameMat = this.std('#8a6a2a', { metalness: 0.7, roughness: 0.4 });
    this.frame(map, 2.2, 1.5, frameMat);
    const portrait = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.7), this.std('#ffffff', { map: paintingTexture(7), roughness: 0.8 }));
    portrait.rotation.y = -Math.PI / 2;
    portrait.position.set(HALF_W - 0.06, 3.0, 0.6);
    this.scene.add(portrait);
    this.frame(portrait, 1.3, 1.7, frameMat);
  }

  private frame(pic: THREE.Mesh, w: number, h: number, mat: THREE.Material) {
    const g = new THREE.Group();
    g.position.copy(pic.position);
    g.rotation.copy(pic.rotation);
    const t = 0.08;
    this.box(w + t * 2, t, 0.05, mat, 0, h / 2 + t / 2, 0, g);
    this.box(w + t * 2, t, 0.05, mat, 0, -h / 2 - t / 2, 0, g);
    this.box(t, h, 0.05, mat, w / 2 + t / 2, 0, 0, g);
    this.box(t, h, 0.05, mat, -w / 2 - t / 2, 0, 0, g);
    this.scene.add(g);
  }

  /** The heavy locked double door inside the model's stone portal, and the code keypad on its right pillar. */
  private buildDoor() {
    const door = new THREE.Group();
    door.position.set(0, 0, -HALF_D - 0.1);
    const edge = this.std('#2a170b');
    const iron = this.std('#2b2b30', { metalness: 0.8, roughness: 0.45 });
    for (const side of [-1, 1]) {
      const hinge = new THREE.Group();
      hinge.position.set(side * DOOR_W / 2, 0, 0);
      const face = this.std('#7a5030', { map: panelTexture([1, 3]), roughness: 0.65 });
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W / 2, DOOR_H, 0.14), [edge, edge, edge, edge, face, face]);
      leaf.position.set(-side * DOOR_W / 4, DOOR_H / 2, 0);
      hinge.add(leaf);
      // iron straps and studs
      for (const y of [0.55, 1.75, 2.95]) this.box(DOOR_W / 2 - 0.08, 0.09, 0.03, iron, -side * DOOR_W / 4, y, 0.085, hinge);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.02, 8, 22), this.std('#a88a4a', { metalness: 0.9, roughness: 0.35 }));
      ring.position.set(-side * (DOOR_W / 2 - 0.22), 1.3, 0.12);
      hinge.add(ring);
      door.add(hinge);
      this.leaves.push(hinge);
    }
    // a big lock plate at the seam, on the right leaf (it swings away with it)
    this.box(0.2, 0.42, 0.06, this.std('#8a6a2a', { metalness: 0.85, roughness: 0.35 }), -DOOR_W / 2 + 0.1, 1.45, 0.1, this.leaves[1]);
    this.scene.add(door);

    // the keypad: brass frame, a dark face with the twelve keys and a small screen, glowing once it opens the door
    const pad = new THREE.Group();
    pad.position.set(1.58, 1.5, -6.42);
    this.box(0.36, 0.52, 0.06, this.std('#b8913f', { metalness: 0.85, roughness: 0.32 }), 0, 0, 0, pad);
    this.keypadMat = this.std('#ffffff', { map: keypadTexture(), emissive: '#ffcf70', emissiveMap: keypadTexture(), emissiveIntensity: 0.35, roughness: 0.5 });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.46), this.keypadMat);
    face.position.z = 0.032;
    pad.add(face);
    this.scene.add(pad);
  }

  /** The four objects of the riddle: the compass on the map table, the wall clock, the letter on the desk and the key. */
  private buildItems() {
    const brass = () => this.std('#c9a25a', { metalness: 0.85, roughness: 0.3, emissive: '#ffcf70', emissiveIntensity: 0 });
    const objects: Record<DemoSpotId, () => { obj: THREE.Object3D; mats: THREE.MeshStandardMaterial[] }> = {
      compass: () => {
        const g = new THREE.Group();
        const m = brass();
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.18, 0.05, 32), m);
        const faceMat = this.std('#ffffff', { map: compassTexture(), roughness: 0.5, emissive: '#ffcf70', emissiveIntensity: 0 });
        const face = new THREE.Mesh(new THREE.CircleGeometry(0.15, 32), faceMat);
        face.rotation.x = -Math.PI / 2;
        face.position.y = 0.027;
        const lid = new THREE.Mesh(new THREE.TorusGeometry(0.165, 0.012, 8, 32), m);
        lid.rotation.x = Math.PI / 2;
        lid.position.y = 0.03;
        g.add(body, face, lid);
        g.rotation.y = 0.4;
        return { obj: g, mats: [m, faceMat] };
      },
      clock: () => {
        const g = new THREE.Group();
        const wood = this.std('#4a2c18', { map: panelTexture([1, 2]), roughness: 0.6, emissive: '#ffcf70', emissiveIntensity: 0 });
        this.box(0.74, 1.5, 0.2, wood, 0, 0, 0, g);
        this.box(0.84, 0.12, 0.26, wood, 0, 0.78, 0, g);
        const ring = brass();
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.025, 8, 40), ring);
        rim.position.set(0, 0.36, 0.11);
        const faceMat = this.std('#ffffff', { map: clockTexture(), roughness: 0.55, emissive: '#ffcf70', emissiveIntensity: 0 });
        const face = new THREE.Mesh(new THREE.CircleGeometry(0.28, 40), faceMat);
        face.position.set(0, 0.36, 0.105);
        // the pendulum hangs still behind the glass: the clock stopped
        const rod = this.box(0.02, 0.48, 0.01, ring, 0, -0.2, 0.1, g);
        rod.rotation.z = 0.05;
        const bob = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.02, 24), ring);
        bob.rotation.x = Math.PI / 2;
        bob.position.set(0.012, -0.46, 0.1);
        const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.62), new THREE.MeshStandardMaterial({ color: '#9fb8c8', transparent: true, opacity: 0.12, roughness: 0.1, metalness: 0.3 }));
        glass.position.set(0, -0.32, 0.112);
        g.add(rim, face, bob, glass);
        return { obj: g, mats: [wood, ring, faceMat] };
      },
      letter: () => {
        const g = new THREE.Group();
        const paper = this.std('#ffffff', { map: parchmentTexture(), roughness: 0.95, side: THREE.DoubleSide, emissive: '#ffcf70', emissiveIntensity: 0 });
        const sheet = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.46), paper);
        sheet.rotation.x = -Math.PI / 2;
        const ink = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.38), new THREE.MeshBasicMaterial({ map: letterLinesTexture(), transparent: true, depthWrite: false }));
        ink.rotation.x = -Math.PI / 2;
        ink.position.y = 0.002;
        const seal = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 20), this.std('#9a1f1f', { roughness: 0.5 }));
        seal.position.set(0.1, 0.006, 0.17);
        g.add(sheet, ink, seal);
        g.rotation.y = -0.25;
        return { obj: g, mats: [paper] };
      },
      key: () => {
        const g = new THREE.Group();
        const m = this.std('#d6b25e', { metalness: 0.9, roughness: 0.28, emissive: '#ffcf70', emissiveIntensity: 0 });
        const bow = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.016, 10, 24), m);
        bow.position.x = -0.13;
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.24, 10), m);
        shaft.rotation.z = Math.PI / 2;
        shaft.position.x = 0.03;
        g.add(bow, shaft);
        for (const [x, h] of [[0.12, 0.05], [0.09, 0.035]]) this.box(0.018, h, 0.012, m, x, -h / 2, 0, g);
        g.rotation.x = -Math.PI / 2;
        g.scale.setScalar(1.4);
        return { obj: g, mats: [m] };
      },
      door: () => ({ obj: new THREE.Group(), mats: [] }),
    };
    for (const spot of DEMO_SPOTS) {
      const pos = new THREE.Vector3(...spot.pos);
      const { obj, mats } = objects[spot.id]();
      obj.position.set(...(spot.place ?? spot.pos));
      if (spot.facing !== undefined) obj.rotation.y = spot.facing;
      this.scene.add(obj);
      const hit = new THREE.Mesh(new THREE.SphereGeometry(spot.radius, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.copy(pos);
      hit.userData['spot'] = spot;
      this.scene.add(hit);
      // the highlight when the object is in reach, and a slow twinkle until it was examined once
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowSpriteTexture('#ffd27a'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
      glow.scale.setScalar(spot.radius * 2.6);
      glow.position.copy(pos);
      const spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowSpriteTexture('#fff0c0'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
      spark.scale.setScalar(0.22);
      spark.position.copy(pos).add(new THREE.Vector3(0, spot.radius * 0.5, 0));
      this.scene.add(glow, spark);
      this.spots.set(spot.id, { spot, hit, glow, spark, mats, pos });
    }
  }

  private flame(x: number, y: number, z: number, size = 0.45, color = '#ffb469') {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowSpriteTexture(color), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    s.scale.set(size * 0.7, size, 1);
    s.position.set(x, y, z);
    this.scene.add(s);
    const seed = Math.random() * 10;
    this.animated.push((t) => s.scale.set(size * 0.7 * (0.92 + Math.sin(t * 11 + seed) * 0.06), size * (0.9 + Math.sin(t * 7 + seed) * 0.1), 1));
  }

  private light(x: number, y: number, z: number, color: string, intensity: number, distance: number, flicker = true) {
    const l = new THREE.PointLight(color, intensity, distance, 1.6);
    l.position.set(x, y, z);
    this.scene.add(l);
    if (flicker) this.flickers.push({ light: l, base: intensity, seed: Math.random() * 100 });
    return l;
  }

  private buildLights() {
    this.scene.add(this.hemi, this.ambient);
    // the candelabra by the door, the desk lamp and candle, and a soft warm fill over the desk
    for (const cx of [-2.55, 2.55]) {
      for (const dx of [-0.3, 0, 0.3]) this.flame(cx + dx, 1.9, -6.35, 0.8);
      this.light(cx, 2.2, -6.0, '#ffb066', 5, 7);
    }
    this.flame(1.79, 1.12, -1.6, 0.42);
    this.flame(-1.55, 1.53, -1.95, 0.45);
    this.light(0.4, 2.0, -1.4, '#ffd29a', 6, 7);
    this.light(0, WALL - 1.2, 1.5, '#ffe2b8', 9, 18, false);
    // small pools of light on the objects of the riddle, so nothing important sinks into shadow
    this.light(-6.3, 2.4, 2.6, '#ffc890', 3.2, 4.5);
    this.light(5.4, 2.4, 3.4, '#ffc890', 2.6, 4.5);
    this.light(4.4, 3.8, -5.6, '#ffd8a0', 3.4, 5, false);
    // sconces on both side walls
    for (const sx of [-1, 1]) {
      this.box(0.14, 0.4, 0.14, this.std('#2a2018', { metalness: 0.5 }), sx * (HALF_W - 0.1), 2.6, 4.6);
      this.flame(sx * (HALF_W - 0.25), 2.95, 4.6, 0.5);
    }
    // the light shafts falling from high on the right wall
    const shaftMat = new THREE.MeshBasicMaterial({ map: shaftTexture(), color: '#ffd9a0', transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    [[5.2, -2.6, 0.62], [4.6, -0.2, 0.55]].forEach(([x, z, tilt], k) => {
      const shaft = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 7.5), shaftMat);
      shaft.position.set(x - 2.3, 3.1, z);
      shaft.rotation.set(0, Math.PI / 2 - 0.25, tilt);
      this.scene.add(shaft);
      this.animated.push((t) => (shaftMat.opacity = 0.12 + Math.sin(t * 0.4 + k * 2) * 0.03));
    });
  }

  /** Dust drifting in the warm light (fewer motes on weak devices). */
  private buildDust() {
    const n = this.quality === 'low' ? 70 : this.quality === 'medium' ? 160 : 240;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pos.set([(Math.random() - 0.5) * 13, 0.4 + Math.random() * 4.6, (Math.random() - 0.5) * 11], i * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const dust = new THREE.Points(geo, new THREE.PointsMaterial({ map: glowSpriteTexture('#fff2d0'), color: '#ffe8c0', size: 0.045, transparent: true, opacity: 0.5,
      depthWrite: false, blending: THREE.AdditiveBlending }));
    dust.frustumCulled = false;
    this.scene.add(dust);
    const base = pos.slice();
    this.animated.push((t) => {
      const a = geo.attributes['position'] as THREE.BufferAttribute;
      for (let i = 0; i < n; i++) {
        a.array[i * 3] = base[i * 3] + Math.sin(t * 0.13 + i) * 0.35;
        a.array[i * 3 + 1] = base[i * 3 + 1] + Math.sin(t * 0.09 + i * 1.7) * 0.25;
        a.array[i * 3 + 2] = base[i * 3 + 2] + Math.cos(t * 0.11 + i * 0.6) * 0.35;
      }
      a.needsUpdate = true;
    });
  }

  private addLibrary(root: THREE.Group) {
    this.scene.add(root);
  }

  /** The room without its model (the download failed): a floor, the desk, two bookcases, the map table and the lectern. */
  private buildClassicFurniture() {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, HALF_D * 2), this.std('#9a7a5a', { map: woodFloorTexture([4, 4]), roughness: 0.7 }));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    const wood = this.std('#5a3a20', { map: panelTexture([2, 1]), roughness: 0.7 });
    this.box(5.2, 0.08, 1.7, wood, -0.5, 0.96, -1.3);
    for (const [x, z] of [[-3, -2], [2, -2], [-3, -0.6], [2, -0.6]]) this.box(0.12, 0.96, 0.12, wood, x, 0.48, z);
    this.box(1.2, 0.08, 0.9, wood, -6.6, 0.98, 2.5);
    this.box(0.3, 0.98, 0.3, wood, -6.6, 0.49, 2.5);
    this.box(0.6, 1.1, 0.5, wood, 5.6, 0.55, 3.6);
    this.box(1.6, 1.1, 0.8, wood, 4.6, 0.55, -6.5);
    for (const sx of [-1, 1]) this.box(0.6, 4.6, 3.2, this.std('#4a2c18'), sx * 7.6, 2.3, -4.0);
    this.box(0.12, 4.8, 0.6, this.std('#6e6660', { map: stoneTexture([1, 3]) }), 1.53, 2.4, -6.7);
    this.box(0.12, 4.8, 0.6, this.std('#6e6660', { map: stoneTexture([1, 3]) }), -1.53, 2.4, -6.7);
  }

  private enableShadows() {
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const key = new THREE.SpotLight('#ffd9a8', 24, 22, Math.PI / 3, 0.7, 1.4);
    key.position.set(2.5, WALL - 0.4, 3.5);
    key.target.position.set(-0.5, 0, -2);
    key.castShadow = true;
    key.shadow.mapSize.set(this.quality === 'high' ? 1024 : 512, this.quality === 'high' ? 1024 : 512);
    key.shadow.bias = -0.0006;
    this.scene.add(key, key.target);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.Material;
      const flat = m.geometry instanceof THREE.PlaneGeometry || m.geometry instanceof THREE.CircleGeometry;
      m.receiveShadow = true;
      m.castShadow = !flat && !Array.isArray(mat) && !mat.transparent && !(mat instanceof THREE.MeshBasicMaterial) && m.name !== 'Floor';
    });
  }

  // ======================================================================= state from the page

  setMode(mode: DemoMode) {
    this.mode = mode;
    this.modeTime = 0;
    if (this.local) this.local.root.visible = mode !== 'intro';
    if (mode === 'play') this.snapCamera = true;
  }

  /** Ends the opening flight now (the player pressed skip). */
  skipIntro() {
    if (this.mode === 'intro') this.modeTime = 99;
  }

  get currentMode() {
    return this.mode;
  }

  setJoystick(x: number, y: number) {
    this.joystick.set(x, y);
  }

  /** Objects already examined stop twinkling (they keep their highlight when in reach). */
  setInspected(ids: Iterable<DemoSpotId>) {
    this.inspected = new Set(ids);
  }

  /** A wrong code: the keypad blinks red for a moment. */
  flashKeypad(ok: boolean) {
    this.keypadFlash = ok ? 0 : 1;
    if (this.keypadMat) this.keypadMat.emissive.set(ok ? '#7dffb0' : '#ff5a4a');
    if (ok && this.keypadMat) this.keypadMat.emissiveIntensity = 1.4;
  }

  /** The correct code: the keypad lights up, the door swings open, the light of the portal floods in and the camera turns to it. */
  openDoor() {
    this.flashKeypad(true);
    this.doorTarget = 1;
    this.standAside();
    this.setMode('door');
  }

  /** The figure steps beside the door, facing it, so the camera sees the doors swing open. */
  private standAside() {
    this.localPos.set(1.3, 0, -4.0);
    this.localYaw = Math.atan2(-1.3, -3.2);
    if (this.local) this.local.root.rotation.y = this.localYaw;
  }

  /** Puts the room straight into its opened state (a returning player who already solved it). */
  showOpened() {
    this.flashKeypad(true);
    this.doorTarget = 1;
    this.doorOpen = 1;
    this.doorOpenedSent = true;
    this.standAside();
    this.setMode('done');
  }

  /** The nearest object in reach, used by E without a pointer and by the touch button. */
  interactNearest() {
    const s = this.focused;
    if (!s || this.mode !== 'play') return false;
    this.tryInteract(s);
    return true;
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
    // keep updating at a low rate when requestAnimationFrame is throttled (hidden or embedded views)
    this.watchdog = setInterval(() => {
      if (this.disposed || document.hidden || performance.now() - lastFrame < 250) return;
      this.tick(Math.min(0.1, this.clock.getDelta()), this.clock.elapsedTime);
    }, 100);
  }

  private tick(dt: number, t: number) {
    this.time = t;
    // scenes run on the wall clock, so a slow device sees the same four-second intro, only with fewer frames
    const now = performance.now();
    this.modeTime += Math.min(0.5, (now - (this.lastTick || now)) / 1000);
    this.lastTick = now;
    for (const f of this.flickers) f.light.intensity = f.base * (0.88 + 0.12 * Math.sin(t * 9 + f.seed) * Math.sin(t * 5.3 + f.seed * 2));
    for (const a of this.animated) a(t, dt);
    this.updateSpots(t);
    this.updateDoor(dt);

    if (this.mode === 'intro') this.introCamera(this.modeTime);
    else if (this.mode === 'door' || this.mode === 'done') this.doorCamera(dt);
    else this.playUpdate(dt, t);

    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /** A short flight over the room, from the locked door to the player's starting point (about four seconds). */
  private introCamera(s: number) {
    const keys: [number, THREE.Vector3, THREE.Vector3][] = [
      [0, new THREE.Vector3(0, 2.4, -4.6), new THREE.Vector3(0, 1.8, -7.2)],
      [1.6, new THREE.Vector3(-3.2, 3.2, -2.4), new THREE.Vector3(0.6, 1.4, -6.4)],
      [3.2, new THREE.Vector3(-1.5, 3.4, 4.8), new THREE.Vector3(-1.5, 1.0, -1.2)],
      [4.4, new THREE.Vector3(0, 2.6, 8.4), new THREE.Vector3(0, 1.4, -1.5)],
    ];
    let i = 0;
    while (i < keys.length - 2 && s > keys[i + 1][0]) i++;
    const [t0, p0, l0] = keys[i];
    const [t1, p1, l1] = keys[i + 1];
    const k = THREE.MathUtils.smootherstep(Math.min(1, Math.max(0, (s - t0) / (t1 - t0))), 0, 1);
    this.camera.position.lerpVectors(p0, p1, k);
    this.camera.lookAt(new THREE.Vector3().lerpVectors(l0, l1, k));
    if (s > keys[keys.length - 1][0]) {
      this.setMode('play');
      this.cb.onIntroDone?.();
    }
  }

  private doorCamera(dt: number) {
    const k = Math.min(1, dt * 1.6);
    this.camera.position.lerp(new THREE.Vector3(0.4, 2.0, -2.6), k);
    const look = new THREE.Vector3(0, 1.7, -7.5);
    const cur = new THREE.Vector3();
    this.camera.getWorldDirection(cur);
    const want = look.clone().sub(this.camera.position).normalize();
    cur.lerp(want, k).normalize();
    this.camera.lookAt(this.camera.position.clone().add(cur));
    if (this.local) {
      this.local.root.position.copy(this.localPos);
      this.local.update(dt, 0, this.time);
    }
    if (this.mode === 'door' && this.modeTime > 3.6 && !this.doorOpenedSent) {
      this.doorOpenedSent = true;
      this.cb.onDoorOpened?.();
    }
  }

  private updateDoor(dt: number) {
    if (this.doorOpen < this.doorTarget) this.doorOpen = Math.min(this.doorTarget, this.doorOpen + dt * (this.mode === 'door' && this.modeTime < 0.8 ? 0 : 0.45));
    const e = THREE.MathUtils.smootherstep(this.doorOpen, 0, 1);
    this.leaves.forEach((h, i) => (h.rotation.y = (i === 0 ? 1 : -1) * e * 1.75));
    if (this.portalLight) this.portalLight.intensity = e * 26;
    if (this.portalGlow) (this.portalGlow.material as THREE.MeshBasicMaterial).opacity = e;
    // the room turns from candle-warm to the cool light of the portal
    this.hemi.color.set('#b8a890').lerp(new THREE.Color('#9cc0ff'), e * 0.6);
    this.hemi.intensity = 0.7 + e * 0.5;
    if (this.keypadMat && this.keypadFlash > 0) {
      this.keypadFlash = Math.max(0, this.keypadFlash - dt * 1.4);
      this.keypadMat.emissiveIntensity = 0.35 + this.keypadFlash * 1.2;
      if (this.keypadFlash === 0) this.keypadMat.emissive.set('#ffcf70');
    }
  }

  private updateSpots(t: number) {
    for (const v of this.spots.values()) {
      const on = this.mode === 'play' && (this.focused?.id === v.spot.id || this.hovered?.id === v.spot.id);
      const gm = v.glow.material as THREE.SpriteMaterial;
      gm.opacity = THREE.MathUtils.lerp(gm.opacity, on ? 0.4 + Math.sin(t * 4) * 0.1 : 0, 0.15);
      for (const m of v.mats) m.emissiveIntensity = THREE.MathUtils.lerp(m.emissiveIntensity, on ? 0.35 + Math.sin(t * 4) * 0.1 : 0, 0.15);
      const sm = v.spark.material as THREE.SpriteMaterial;
      const twinkle = !this.inspected.has(v.spot.id) && v.spot.id !== 'door' && this.mode === 'play';
      sm.opacity = twinkle ? Math.max(0, Math.sin(t * 2.2 + v.pos.x)) * 0.8 : 0;
    }
  }

  private playUpdate(dt: number, t: number) {
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
    const speed = (run ? 5.0 : 3.2) * Math.min(1, len);
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
    if (this.local) {
      this.local.root.position.copy(this.localPos);
      this.local.root.rotation.y = this.localYaw;
      this.local.update(dt, this.localSpeed, t);
    }

    const pivot = new THREE.Vector3(this.localPos.x, 1.6, this.localPos.z);
    const dir = new THREE.Vector3(Math.sin(this.camYaw) * Math.cos(this.camPitch), Math.sin(this.camPitch), Math.cos(this.camYaw) * Math.cos(this.camPitch));
    const cam = new THREE.Vector3();
    for (let dist = this.camDist; dist > 0.8; dist -= 0.2) {
      cam.copy(pivot).addScaledVector(dir, dist);
      // bookcases line the walls: the camera keeps out of them, not only out of the walls
      if (Math.abs(cam.x) < HALF_W - 1.1 && Math.abs(cam.z) < HALF_D - 1.0 && cam.y < WALL - 0.3) break;
    }
    if (this.snapCamera) {
      this.camera.position.copy(cam);
      this.snapCamera = false;
    } else this.camera.position.lerp(cam, Math.min(1, dt * 10));
    this.camera.lookAt(pivot);
    this.updateFocus();
  }

  canStand(x: number, z: number) {
    return inRects(WALKABLE, x, z) && !inRects(OBSTACLES, x, z);
  }

  // ======================================================================= input

  /** A panel is open over the room: keys and clicks belong to it, not to the room. */
  private paused = false;
  setPaused(on: boolean) {
    this.paused = on;
    if (on) this.clearInput();
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.paused || (e.target as HTMLElement)?.closest?.('input, textarea, select, [role="dialog"]')) return;
    this.keys.add(e.code);
    if (e.code === 'KeyE' && this.mode === 'play') {
      if (this.hovered) this.tryInteract(this.hovered);
      else this.interactNearest();
    }
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private onBlur = () => this.keys.clear();

  /** Stops movement keys held while a panel opened (the key-up never reaches the room). */
  clearInput() {
    this.keys.clear();
    this.joystick.set(0, 0);
  }

  private bindInput() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this.drag = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId, touch: e.pointerType === 'touch' };
    });
    c.addEventListener('pointermove', (e) => {
      const rect = c.getBoundingClientRect();
      if (e.pointerType !== 'touch') this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      if (this.drag && this.drag.id === e.pointerId) {
        const dx = e.clientX - this.drag.x;
        const dy = e.clientY - this.drag.y;
        if (Math.abs(dx) + Math.abs(dy) > (this.drag.touch ? 12 : 4)) this.drag.moved = true;
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
      if (d && !d.moved && this.mode === 'play' && !this.paused) {
        const rect = c.getBoundingClientRect();
        this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
        const spot = this.pick();
        if (spot) this.tryInteract(spot);
        if (e.pointerType === 'touch') this.pointer.set(10, 10);
      }
    });
    c.addEventListener('pointercancel', () => (this.drag = undefined));
    c.addEventListener('pointerleave', () => this.pointer.set(10, 10));
    c.addEventListener('wheel', (e) => (this.camDist = THREE.MathUtils.clamp(this.camDist + e.deltaY * 0.004, 2.4, 6.5)), { passive: true });
  }

  private pick(): DemoSpot | null {
    if (Math.abs(this.pointer.x) > 1) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects([...this.spots.values()].map((v) => v.hit), false);
    return (hits[0]?.object.userData['spot'] as DemoSpot) ?? null;
  }

  private distanceTo(spot: DemoSpot) {
    return Math.hypot(spot.pos[0] - this.localPos.x, spot.pos[2] - this.localPos.z) - spot.radius;
  }

  /** The pointed-at object, else the nearest one in reach that the player is roughly facing. */
  private updateFocus() {
    if (!this.drag?.moved) {
      const p = this.pick();
      if (p?.id !== this.hovered?.id) {
        this.hovered = p;
        this.canvas.style.cursor = p ? 'pointer' : 'grab';
      }
    }
    let best: DemoSpot | null = null;
    let bestD = Infinity;
    for (const v of this.spots.values()) {
      const d = this.distanceTo(v.spot);
      if (d < INTERACT_DISTANCE && d < bestD) {
        best = v.spot;
        bestD = d;
      }
    }
    const next = this.hovered && this.distanceTo(this.hovered) < INTERACT_DISTANCE ? this.hovered : best;
    if (next?.id !== this.focused?.id) {
      this.focused = next;
      this.cb.onFocus?.(next);
    }
  }

  private tryInteract(spot: DemoSpot) {
    if (this.distanceTo(spot) > INTERACT_DISTANCE + 0.6) this.cb.onTooFar?.(spot);
    else {
      this.local?.reach(this.time);
      this.clearInput();
      this.cb.onInteract?.(spot);
    }
  }

  // ======================================================================= lifecycle

  private resize() {
    const el = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(1, el.clientWidth);
    const h = Math.max(1, el.clientHeight);
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    // a narrow phone screen sees a little wider, so the objects around the player stay in view
    this.camera.fov = w / h < 0.8 ? 70 : 58;
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
    this.local?.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose?.();
    });
    for (const t of ownTextures) t.dispose();
    ownTextures.length = 0;
    this.composer?.dispose();
    this.renderer.dispose();
  }
}

// ========================================================================= canvas textures of this room

/** Textures made here (not the shared cached ones): released when the room is closed. */
const ownTextures: THREE.Texture[] = [];

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  ownTextures.push(t);
  return t;
}

function shaftTexture() {
  return canvasTexture(64, 256, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 256);
    const side = g.createLinearGradient(0, 0, 64, 0);
    side.addColorStop(0, 'rgba(0,0,0,1)');
    side.addColorStop(0.5, 'rgba(0,0,0,0)');
    side.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = side;
    g.fillRect(0, 0, 64, 256);
  });
}

function portalTexture() {
  return canvasTexture(256, 360, (g) => {
    const grad = g.createRadialGradient(128, 190, 10, 128, 190, 200);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.25, '#bfe0ff');
    grad.addColorStop(0.6, '#4a7fd8');
    grad.addColorStop(1, '#0a1640');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 360);
    g.strokeStyle = 'rgba(255,255,255,.35)';
    for (let r = 30; r < 200; r += 22) {
      g.beginPath();
      g.ellipse(128, 190, r, r * 1.2, 0, 0, Math.PI * 2);
      g.stroke();
    }
  });
}

function keypadTexture() {
  return canvasTexture(192, 296, (g) => {
    g.fillStyle = '#16100a';
    g.fillRect(0, 0, 192, 296);
    g.fillStyle = '#2a3a2a';
    g.fillRect(18, 16, 156, 44);
    g.fillStyle = '#9fe0a0';
    g.font = 'bold 28px monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('_ _ _ _', 96, 39);
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓'];
    keys.forEach((k, i) => {
      const x = 22 + (i % 3) * 52;
      const y = 76 + Math.floor(i / 3) * 52;
      g.fillStyle = '#c9a25a';
      g.beginPath();
      g.roundRect(x, y, 44, 44, 8);
      g.fill();
      g.fillStyle = '#2a1a08';
      g.font = 'bold 24px sans-serif';
      g.fillText(k, x + 22, y + 23);
    });
  });
}

function compassTexture() {
  return canvasTexture(256, 256, (g) => {
    g.fillStyle = '#efe2c0';
    g.beginPath();
    g.arc(128, 128, 128, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#6a4a20';
    g.lineWidth = 3;
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const r0 = i % 8 === 0 ? 92 : 104;
      g.beginPath();
      g.moveTo(128 + Math.sin(a) * r0, 128 - Math.cos(a) * r0);
      g.lineTo(128 + Math.sin(a) * 118, 128 - Math.cos(a) * 118);
      g.stroke();
    }
    g.fillStyle = '#3a2a10';
    g.font = 'bold 30px serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('N', 128, 30);
    g.fillText('2', 180, 180);
    // the needle stopped pointing at the engraved sign, not at north
    g.save();
    g.translate(128, 128);
    g.rotate((135 * Math.PI) / 180);
    g.fillStyle = '#b8261f';
    g.beginPath();
    g.moveTo(0, -56);
    g.lineTo(12, 0);
    g.lineTo(-12, 0);
    g.fill();
    g.fillStyle = '#3a3a44';
    g.beginPath();
    g.moveTo(0, 40);
    g.lineTo(12, 0);
    g.lineTo(-12, 0);
    g.fill();
    g.restore();
  });
}

function clockTexture() {
  return canvasTexture(256, 256, (g) => {
    g.fillStyle = '#efe6d0';
    g.beginPath();
    g.arc(128, 128, 128, 0, Math.PI * 2);
    g.fill();
    const roman = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    g.fillStyle = '#2a1a0a';
    g.font = 'bold 22px serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    roman.forEach((r, i) => {
      const a = (i / 12) * Math.PI * 2;
      g.fillText(r, 128 + Math.sin(a) * 98, 128 - Math.cos(a) * 98);
    });
    // stopped at seven o'clock: the hour hand on VII, the minute hand on XII
    const hand = (a: number, len: number, w: number) => {
      g.strokeStyle = '#1a1208';
      g.lineWidth = w;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(128, 128);
      g.lineTo(128 + Math.sin(a) * len, 128 - Math.cos(a) * len);
      g.stroke();
    };
    hand((7 / 12) * Math.PI * 2, 58, 9);
    hand(0, 84, 5);
    g.fillStyle = '#8a6a2a';
    g.beginPath();
    g.arc(128, 128, 8, 0, Math.PI * 2);
    g.fill();
  });
}

function letterLinesTexture() {
  return canvasTexture(256, 320, (g) => {
    g.strokeStyle = 'rgba(40,24,10,.75)';
    g.lineWidth = 3;
    for (let i = 0; i < 9; i++) {
      const y = 40 + i * 26;
      g.beginPath();
      g.moveTo(30 + (i % 3) * 6, y);
      g.lineTo(226 - (i % 2) * 30, y);
      g.stroke();
    }
    g.fillStyle = 'rgba(40,24,10,.9)';
    g.font = 'bold 34px serif';
    g.fillText('1', 200, 300);
  });
}

function estateMapTexture() {
  return canvasTexture(512, 350, (g) => {
    g.fillStyle = '#d8c49a';
    g.fillRect(0, 0, 512, 350);
    const grad = g.createRadialGradient(256, 175, 60, 256, 175, 300);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(70,40,10,.55)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 350);
    g.strokeStyle = 'rgba(70,40,15,.8)';
    g.lineWidth = 3;
    g.strokeRect(70, 60, 180, 120);
    g.strokeRect(250, 60, 150, 200);
    g.strokeRect(110, 180, 140, 110);
    g.setLineDash([8, 8]);
    g.beginPath();
    g.moveTo(40, 300);
    g.bezierCurveTo(160, 250, 220, 330, 330, 160);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = 'rgba(150,30,20,.85)';
    g.font = 'bold 34px serif';
    g.fillText('✕', 318, 172);
    g.fillStyle = 'rgba(60,35,12,.9)';
    g.font = 'italic 22px serif';
    g.fillText('Portal Manor', 300, 320);
  });
}
