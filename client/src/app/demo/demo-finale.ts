// "טעימה מהפורטל" (/demo) only — the portal awakening behind the opened door at the end of the taste, and the floating
// catalog that comes out of it. It belongs to the taste's own module: only DemoWorld creates it, and nothing in the
// worlds of the full games imports it, so their final rooms stay exactly as they are.
// It runs in the taste room's existing scene (no second world, no new models): the doorway, its glow and light stay;
// this module adds a vortex in the doorway, spinning energy arcs, light motes, gold sparks, a glow on the floor and one
// 3D card per game of the catalog. Everything it creates it disposes again.
//
// Timeline (seconds from start; reduced motion shortens it and drops the flights):
//   A 0–3   the room dims a little, the portal core brightens, the blue arcs start to spin, motes and gold sparks appear
//   B 3–6   the portal opens into a blue/cyan/purple vortex with stars and depth; its light spreads on the floor
//   C 6–9.5 the game covers fly out of the portal on curved paths, turning, trailing sparks, and settle as floating cards
//   then    idle: a slow vortex, drifting motes, gently floating cards, a soft light pulse
import * as THREE from 'three';
import type { Quality } from '../core/settings.service';
import { blobShadowTexture, glowSpriteTexture } from '../world/textures';

/** Where the finale stands in the room: the opening it comes out of, where the cards rest and where the camera waits. */
export interface FinaleLayout {
  /** Centre of the opening (the vortex faces +z, towards the room). */
  portal: THREE.Vector3;
  /** Radius of the vortex; the arcs, sparks and motes scale with it. */
  radius: number;
  /** Vertical stretch of the vortex and its arcs (a tall doorway rather than a round portal). */
  stretchY: number;
  /** Height and depth of the middle card. */
  cardY: number;
  cardZ: number;
  camRest: THREE.Vector3;
  /** A phone held upright: closer, so the middle card fills most of the width. */
  camRestNarrow: THREE.Vector3;
  lookRest: THREE.Vector3;
  /** The glow on the floor in front of the opening: its centre's z and its size. */
  floorZ: number;
  floorSize: [number, number];
}

/** What a card shows: all of it comes from the product catalog (/api/products), never written here. */
export interface FinaleCard {
  id: string;
  name: string;
  tagline: string;
  price: string | null;
  previousPrice: string | null;
  players: string;
  cover: string;
}

export type FinaleStage = 'awakening' | 'vortex' | 'cards' | 'idle';

export interface FinaleEvents {
  onStage?(stage: FinaleStage): void;
  /** A card left the portal (for a soft sound). */
  onCardOut?(index: number): void;
  /** The opening animation is over (cards settled, or none to show). */
  onComplete?(): void;
  /** A card was clicked in the 3D view: focused (index) or released (null). */
  onFocus?(index: number | null): void;
  /** The focused card was clicked again (its "details" button). */
  onOpen?(index: number): void;
  /** The carousel moved to show another group of cards. */
  onScroll?(offset: number): void;
}

const CARD_W = 1.6;
const CARD_H = 2.2;
const CARD_R = 0.12;
const CARD_D = 0.06;
const T_VORTEX = 3;
const T_CARDS = 6;
const FLIGHT = 1.8;
const STAGGER = 0.4;
const GOLD = new THREE.Color('#d9ad4f');
const CYAN = new THREE.Color('#4fd6ff');
const PURPLE = new THREE.Color('#9a5cff');

interface Card {
  data: FinaleCard;
  group: THREE.Group;
  frame: THREE.Mesh;
  frameMat: THREE.MeshStandardMaterial;
  face: THREE.Mesh;
  faceMat: THREE.MeshBasicMaterial;
  glow: THREE.Mesh;
  shadow: THREE.Mesh;
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  cover?: HTMLImageElement;
  /** Flies out of the portal (false: fades in at its place — out of view, or reduced motion). */
  flight: boolean;
  /** Seconds from start when it appears. */
  at: number;
  launched: boolean;
  settled: number;
  hover: number;
  focus: number;
  dim: number;
  curve?: THREE.QuadraticBezierCurve3;
  spin: number;
  seed: number;
}

function roundedRect(w: number, h: number, r: number) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** A flat rounded face whose UVs run 0–1 over its own box (ShapeGeometry gives raw coordinates). */
function faceGeometry(w: number, h: number, r: number) {
  const g = new THREE.ShapeGeometry(roundedRect(w, h, r), 6);
  const pos = g.attributes['position'] as THREE.BufferAttribute;
  const uv = g.attributes['uv'] as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
  uv.needsUpdate = true;
  return g;
}

const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b);

// ------------------------------------------------------------------------------------------------ shaders

const VORTEX_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }';

/** Spiral arms in polar coordinates, a tunnel (1/r) for depth, stars drifting out of it, a bright rim at the ring. */
const VORTEX_FRAG = `
  varying vec2 vUv;
  uniform float uTime; uniform float uOpen; uniform float uGlow; uniform float uSpeed;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main(){
    vec2 p = vUv - 0.5;
    float r = length(p) * 2.0;
    float a = atan(p.y, p.x);
    float depth = 0.35 / (r + 0.06);
    float tt = uTime * uSpeed;
    float arms = sin(a * 4.0 + depth * 3.2 - tt * 2.6) * 0.5 + 0.5;
    float arms2 = sin(a * 7.0 - depth * 5.0 + tt * 1.9) * 0.5 + 0.5;
    float rings = sin(depth * 9.0 - tt * 4.0) * 0.5 + 0.5;
    vec3 cyan = vec3(0.25, 0.95, 1.0);
    vec3 blue = vec3(0.12, 0.32, 1.0);
    vec3 purple = vec3(0.62, 0.22, 1.0);
    vec3 col = mix(blue, cyan, arms * arms2);
    col = mix(col, purple, smoothstep(0.35, 1.0, r) * (1.0 - arms) * 0.9);
    col += cyan * pow(rings, 6.0) * 0.35 * (1.0 - r);
    // stars streaming out of the depth
    vec2 su = vec2(a / 6.28318 * 28.0, depth * 2.2 - tt * 1.4);
    vec2 cell = floor(su);
    vec2 f = fract(su) - 0.5;
    float h = hash(cell);
    float star = step(0.82, h) * smoothstep(0.16, 0.0, length(f)) * (0.6 + 0.4 * sin(tt * 6.0 + h * 40.0));
    col += vec3(0.85, 0.95, 1.0) * star * 1.4;
    float core = pow(smoothstep(0.55, 0.0, r), 2.0);
    col += vec3(0.75, 0.9, 1.0) * core * uGlow * 0.35;
    float rim = smoothstep(0.8, 0.98, r) * smoothstep(1.02, 0.96, r);
    col += cyan * rim * 0.8;
    float open = smoothstep(uOpen + 0.04, uOpen - 0.08, r);
    float alpha = open * (0.55 + 0.45 * arms) * smoothstep(1.0, 0.94, r);
    gl_FragColor = vec4(col * (0.55 + 0.3 * uGlow), alpha * clamp(uGlow, 0.0, 1.0));
  }`;

/** Points moved on the GPU from per-point seeds: no per-frame work on the CPU. */
const MOTES_VERT = `
  attribute vec4 aSeed;
  uniform float uTime; uniform float uSize; uniform float uPixel; uniform float uMode; uniform float uSpeed; uniform float uScale;
  varying float vTw;
  void main(){
    float t = uTime * uSpeed;
    vec3 pos;
    if (uMode < 0.5) {
      // motes: born at the portal, drifting out into the room on a slow spiral, then again
      float life = fract(aSeed.x + t * (0.05 + aSeed.y * 0.05));
      float ang = aSeed.z * 6.28318 + life * (2.0 + aSeed.w * 2.0);
      float rad = (0.4 + life * (2.2 + aSeed.y * 2.5)) * uScale;
      pos = vec3(cos(ang) * rad, sin(ang) * rad * 0.75 + life * 0.6, life * (2.5 + aSeed.w * 3.0));
      vTw = sin(life * 3.14159) * (0.5 + 0.5 * sin(t * 4.0 + aSeed.z * 30.0));
    } else {
      // gold sparks: circling the rim of the opening, flickering
      float ang = aSeed.z * 6.28318 + t * (0.3 + aSeed.y * 0.6) * (aSeed.w > 0.5 ? 1.0 : -1.0);
      float rad = (2.45 + (aSeed.x - 0.5) * 0.55) * uScale;
      pos = vec3(cos(ang) * rad, sin(ang) * rad, 0.15 + aSeed.y * 0.35);
      vTw = pow(0.5 + 0.5 * sin(t * (5.0 + aSeed.w * 8.0) + aSeed.x * 50.0), 3.0);
    }
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = clamp(uSize * uPixel * (0.6 + aSeed.y) * (6.0 / -mv.z), 1.0, 18.0);
    gl_Position = projectionMatrix * mv;
  }`;

const POINTS_FRAG = `
  uniform vec3 uColor; uniform float uAlpha;
  varying float vTw;
  void main(){
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(uColor * (0.6 + a), a * a * vTw * uAlpha);
  }`;

/** Sparks thrown by the flying cards: a small pool updated on the CPU. */
const TRAIL_VERT = `
  attribute float aLife;
  uniform float uPixel;
  varying float vTw;
  void main(){
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vTw = aLife;
    gl_PointSize = clamp(26.0 * uPixel * aLife * (6.0 / -mv.z), 0.0, 40.0);
    gl_Position = projectionMatrix * mv;
  }`;

// ------------------------------------------------------------------------------------------------ the finale

export class DemoFinale {
  private root = new THREE.Group();
  private time = 0;
  private stage: FinaleStage | null = null;
  private completed = false;
  private cards: Card[] = [];
  private offset = 0;
  private offsetTarget = 0;
  private focused: number | null = null;
  private hovered: number | null = null;
  private interactive = false;
  private dragStart: number | null = null;
  /** Shown as it is after the animation (a returning player): the cards appear in place, nothing flies. */
  private instant = false;

  private vortex: THREE.Mesh;
  private vortexMat: THREE.ShaderMaterial;
  private arcs: { mesh: THREE.Mesh; speed: number; tilt: number }[] = [];
  private arcMat: THREE.MeshBasicMaterial;
  private motes: THREE.Points;
  private motesMat: THREE.ShaderMaterial;
  private sparks: THREE.Points;
  private sparksMat: THREE.ShaderMaterial;
  private trail: THREE.Points;
  private trailMat: THREE.ShaderMaterial;
  private trailLife: Float32Array;
  private trailVel: Float32Array;
  private trailNext = 0;
  private floorGlow: THREE.Mesh;
  private floorMat: THREE.MeshBasicMaterial;
  private textures: THREE.Texture[] = [];
  private frameGeo: THREE.ExtrudeGeometry;
  private faceGeo: THREE.ShapeGeometry;
  private glowGeo = new THREE.PlaneGeometry(CARD_W * 1.9, CARD_H * 1.6);
  private shadowGeo = new THREE.PlaneGeometry(CARD_W * 1.3, CARD_W * 0.8);
  private glowTex: THREE.Texture;
  private ray = new THREE.Raycaster();

  private camFrom = new THREE.Vector3();
  private camLookFrom = new THREE.Vector3();
  private readonly portal: THREE.Vector3;
  private readonly camRest: THREE.Vector3;
  private readonly lookRest: THREE.Vector3;
  private readonly camRestNarrow: THREE.Vector3;
  /** Size of this opening against the round portal the effects were first drawn for (radius 2.34). */
  private readonly unit: number;
  private baseExposure: number;
  private lightBase?: { color: THREE.Color; intensity: number };
  private cool = new THREE.Color();

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private renderer: THREE.WebGLRenderer,
    private layout: FinaleLayout,
    private quality: Quality,
    private reducedMotion: boolean,
    private portalLight: THREE.PointLight | undefined,
    private events: FinaleEvents = {},
  ) {
    this.portal = layout.portal.clone();
    this.camRest = layout.camRest.clone();
    this.lookRest = layout.lookRest.clone();
    this.camRestNarrow = layout.camRestNarrow.clone();
    this.unit = layout.radius / 2.34;
    this.baseExposure = renderer.toneMappingExposure;
    this.camFrom.copy(camera.position);
    camera.getWorldDirection(this.camLookFrom);
    this.camLookFrom.multiplyScalar(8).add(camera.position);
    const pixel = renderer.getPixelRatio();

    // the vortex, in front of the portal's own disc and inside its gold ring
    this.vortexMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      uniforms: { uTime: { value: 0 }, uOpen: { value: 0 }, uGlow: { value: 0 }, uSpeed: { value: 1 } },
      vertexShader: VORTEX_VERT, fragmentShader: VORTEX_FRAG,
    });
    this.vortex = new THREE.Mesh(new THREE.CircleGeometry(layout.radius, quality === 'low' ? 48 : 96), this.vortexMat);
    this.vortex.position.copy(this.portal).add(new THREE.Vector3(0, 0, 0.09));
    this.vortex.renderOrder = 2;
    this.root.add(this.vortex);

    // energy arcs that spin around the door (partial tori, so the spin can be seen)
    this.arcMat = new THREE.MeshBasicMaterial({ color: '#5fd8ff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const arcDefs: [number, number, number, number][] = [[2.62, 0.022, Math.PI * 1.35, 0.9], [2.8, 0.014, Math.PI * 0.9, -0.6], [2.5, 0.016, Math.PI * 1.6, 1.4]];
    if (quality !== 'low') arcDefs.push([2.95, 0.01, Math.PI * 0.6, -1.1]);
    arcDefs.forEach(([r, tube, arc, speed], k) => {
      const mesh = new THREE.Mesh(new THREE.TorusGeometry(r * this.unit, tube, 6, quality === 'low' ? 48 : 96, arc), this.arcMat);
      mesh.position.copy(this.portal).add(new THREE.Vector3(0, 0, 0.12 + k * 0.03));
      mesh.rotation.z = k * 1.7;
      // stretched as a whole (a wrapper), so the arc keeps spinning around the tall opening
      const holder = new THREE.Group();
      holder.scale.set(1, layout.stretchY, 1);
      holder.position.copy(this.portal);
      mesh.position.sub(this.portal);
      holder.add(mesh);
      this.root.add(holder);
      this.arcs.push({ mesh, speed, tilt: k % 2 ? 0.18 : -0.12 });
    });

    // motes and gold sparks (counts capped by the quality level)
    const count = quality === 'low' ? 120 : quality === 'medium' ? 320 : 560;
    const sparkCount = quality === 'low' ? 60 : quality === 'medium' ? 140 : 220;
    const pointsMat = (color: string, mode: number, size: number) => new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      uniforms: {
        uTime: { value: 0 }, uSize: { value: size }, uPixel: { value: pixel }, uMode: { value: mode }, uSpeed: { value: 1 }, uScale: { value: this.unit },
        uColor: { value: new THREE.Color(color) }, uAlpha: { value: 0 },
      },
      vertexShader: MOTES_VERT, fragmentShader: POINTS_FRAG,
    });
    const seeded = (n: number) => {
      const g = new THREE.BufferGeometry();
      const seeds = new Float32Array(n * 4);
      for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
      g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 3), 12);
      return g;
    };
    this.motesMat = pointsMat('#9fdcff', 0, 3.2);
    this.motes = new THREE.Points(seeded(count), this.motesMat);
    this.motes.position.copy(this.portal);
    this.sparksMat = pointsMat('#ffc861', 1, 5);
    this.sparks = new THREE.Points(seeded(sparkCount), this.sparksMat);
    this.sparks.position.copy(this.portal);
    this.sparks.scale.set(1, layout.stretchY, 1);
    this.root.add(this.motes, this.sparks);

    // sparks thrown by the flying cards
    const trailCount = quality === 'low' ? 80 : 240;
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(trailCount * 3), 3));
    this.trailLife = new Float32Array(trailCount);
    this.trailVel = new Float32Array(trailCount * 3);
    tg.setAttribute('aLife', new THREE.BufferAttribute(this.trailLife, 1));
    tg.boundingSphere = new THREE.Sphere(this.portal.clone().add(new THREE.Vector3(0, 0, 4)), 12);
    this.trailMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      uniforms: { uPixel: { value: pixel }, uColor: { value: new THREE.Color('#ffd27a') }, uAlpha: { value: 1 } },
      vertexShader: TRAIL_VERT, fragmentShader: POINTS_FRAG,
    });
    this.trail = new THREE.Points(tg, this.trailMat);
    this.trail.frustumCulled = false;
    this.root.add(this.trail);

    // the vortex's light on the stone floor in front of the door
    const floorTex = glowSpriteTexture('#4fb6ff');
    this.textures.push(floorTex);
    this.floorMat = new THREE.MeshBasicMaterial({ map: floorTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.floorGlow = new THREE.Mesh(new THREE.PlaneGeometry(layout.floorSize[0], layout.floorSize[1]), this.floorMat);
    this.floorGlow.rotation.x = -Math.PI / 2;
    this.floorGlow.position.set(this.portal.x, 0.03, layout.floorZ);
    this.root.add(this.floorGlow);

    // shared card geometry: a gold slab with rounded corners and a soft bevel; the face sits on its front
    this.frameGeo = new THREE.ExtrudeGeometry(roundedRect(CARD_W, CARD_H, CARD_R), {
      depth: CARD_D, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.018, bevelSegments: quality === 'low' ? 1 : 3, curveSegments: 6,
    });
    this.frameGeo.translate(0, 0, -CARD_D / 2);
    this.faceGeo = faceGeometry(CARD_W - 0.1, CARD_H - 0.1, CARD_R - 0.04);
    this.glowTex = glowSpriteTexture('#ffcf6a');
    this.textures.push(this.glowTex);

    scene.add(this.root);
  }

  // ---------------------------------------------------------------------------------------------- control

  /** Starts the awakening; with `settled` the room is shown as it is after it (a player returning to the screen). */
  start(settled = false) {
    this.time = settled ? T_CARDS + 6 : 0;
    this.instant = settled;
    this.setStage(settled ? 'idle' : 'awakening');
    if (this.portalLight) this.lightBase = { color: this.portalLight.color.clone(), intensity: this.portalLight.intensity };
  }

  /** The games to show (any number). May arrive after start(): the cards then come out as soon as they can. */
  setCards(cards: FinaleCard[]) {
    if (this.cards.length) return;
    const first = this.firstOffset(cards.length);
    this.offset = this.offsetTarget = first;
    const quality = this.quality;
    const [cw, ch] = quality === 'low' ? [384, 528] : [512, 704];
    const start = Math.max(this.time, this.reducedMotion ? 1.5 : T_CARDS);
    cards.forEach((data, i) => {
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = quality === 'high' ? 4 : 1;
      this.textures.push(texture);
      const frameMat = new THREE.MeshStandardMaterial({ color: '#d9ad4f', metalness: 0.92, roughness: 0.28, emissive: '#6a4510', emissiveIntensity: 0.6 });
      const frame = new THREE.Mesh(this.frameGeo, frameMat);
      frame.userData['card'] = i;
      const faceMat = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, transparent: true });
      faceMat.color.setScalar(0.9);
      const face = new THREE.Mesh(this.faceGeo, faceMat);
      face.position.z = CARD_D / 2 + 0.017;
      face.userData['card'] = i;
      const glow = new THREE.Mesh(this.glowGeo, new THREE.MeshBasicMaterial({ map: this.glowTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.position.z = -0.08;
      const group = new THREE.Group();
      group.add(glow, frame, face);
      group.visible = false;
      group.scale.setScalar(0.001);
      const shadow = new THREE.Mesh(this.shadowGeo, new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, opacity: 0, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2;
      this.root.add(group, shadow);
      const slot = i - first;
      const inView = Math.abs(slot) <= 1.01 && !this.instant;
      const order = cards.slice(0, i).filter((_, k) => Math.abs(k - first) <= 1.01).length;
      const card: Card = {
        data, group, frame, frameMat, face, faceMat, glow, shadow, canvas, texture,
        flight: !this.reducedMotion && inView,
        at: !this.reducedMotion && inView ? start + order * STAGGER : Math.max(this.time, this.reducedMotion ? 1.5 : T_CARDS + 1.2),
        launched: false, settled: 0, hover: 0, focus: 0, dim: 0, spin: (i % 2 ? 1 : -1) * (Math.PI * 2 + 0.6), seed: Math.random() * 10,
      };
      this.cards.push(card);
      this.draw(card);
      // the cover is fetched only now, when the card is about to be seen
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        card.cover = img;
        this.draw(card);
      };
      img.src = data.cover;
    });
    // the fonts of the site may still be loading: draw the text again once they are in
    document.fonts?.ready.then(() => this.cards.forEach((c) => this.draw(c))).catch(() => {});
  }

  get count() {
    return this.cards.length;
  }

  /** Brings a card forward (null: back to the row). */
  focus(index: number | null) {
    if (index != null && (index < 0 || index >= this.cards.length)) return;
    if (index === this.focused) return;
    this.focused = index;
    if (index != null) this.offsetTarget = this.clampOffset(index);
    this.events.onFocus?.(index);
  }

  /** Moves the carousel by whole cards (arrows, swipe, keyboard). */
  scroll(dir: number) {
    const next = this.clampOffset(Math.round(this.offsetTarget) + dir);
    if (next === this.offsetTarget) return;
    this.offsetTarget = next;
    if (this.focused != null) this.focus(Math.round(next));
    this.events.onScroll?.(next);
  }

  /** Whether the carousel can move that way (for the arrows). */
  canScroll(dir: number) {
    return this.clampOffset(Math.round(this.offsetTarget) + dir) !== this.offsetTarget;
  }

  /** The carousel's position (the card in the middle). */
  get position() {
    return Math.round(this.offsetTarget);
  }

  /** Cards may be clicked and scrolled (after they came out). */
  get isInteractive() {
    return this.interactive;
  }

  // ---------------------------------------------------------------------------------------------- input (from the world)

  /** Pointer over the canvas (NDC); returns true when it is over a card. */
  hover(ndc: THREE.Vector2) {
    const i = this.pick(ndc);
    this.hovered = i;
    return i != null;
  }

  click(ndc: THREE.Vector2) {
    if (!this.interactive) return;
    const i = this.pick(ndc);
    if (i == null) {
      if (this.focused != null) this.focus(null);
      return;
    }
    if (i === this.focused) this.events.onOpen?.(i);
    else this.focus(i);
  }

  /** A horizontal drag over the canvas: the row follows the finger, then snaps to a card. */
  drag(dxFraction: number, done: boolean) {
    if (!this.interactive || this.cards.length < 2) return;
    if (this.dragStart == null) this.dragStart = this.offsetTarget;
    const per = this.narrow() ? 0.5 : 0.25;
    // RTL: dragging to the left brings the next card (as in the site's own lists)
    const raw = this.dragStart - dxFraction / per;
    this.offsetTarget = THREE.MathUtils.clamp(raw, this.minOffset(), this.maxOffset());
    if (done) {
      this.dragStart = null;
      const snapped = this.clampOffset(Math.round(this.offsetTarget));
      this.offsetTarget = snapped;
      if (this.focused != null) this.focus(snapped);
      this.events.onScroll?.(snapped);
    }
  }

  private pick(ndc: THREE.Vector2): number | null {
    if (!this.cards.length || Math.abs(ndc.x) > 1) return null;
    this.ray.setFromCamera(ndc, this.camera);
    const targets = this.cards.filter((c) => c.group.visible && c.settled > 0.6 && c.faceMat.opacity > 0.3).map((c) => c.frame);
    const hit = this.ray.intersectObjects(targets, false)[0];
    return hit ? (hit.object.userData['card'] as number) : null;
  }

  // ---------------------------------------------------------------------------------------------- frame

  /** Called every frame by the world while the finale is on. Moves the camera (the world leaves it alone). */
  update(dt: number, t: number) {
    this.time += dt;
    const s = this.time;
    const rm = this.reducedMotion;
    const speed = rm ? 0.25 : 1;

    // A · awakening
    const a = smooth(0, 3, s);
    const b = smooth(T_VORTEX, T_CARDS, s);
    const idle = smooth(T_CARDS + 3.5, T_CARDS + 6, s);
    if (s >= T_VORTEX && this.stage === 'awakening') this.setStage('vortex');
    this.renderer.toneMappingExposure = THREE.MathUtils.lerp(this.baseExposure, this.baseExposure * 0.8, a) + Math.sin(t * 0.7) * 0.02 * idle;

    this.vortexMat.uniforms['uTime'].value = t;
    this.vortexMat.uniforms['uSpeed'].value = (rm ? 0.2 : 1.0 - idle * 0.55);
    this.vortexMat.uniforms['uOpen'].value = 0.18 * a + 0.9 * b;
    this.vortexMat.uniforms['uGlow'].value = Math.min(1.25, 0.35 * a + 0.75 * b + Math.sin(t * 1.3) * 0.05 * idle);
    const vs = 0.92 + 0.08 * b;
    this.vortex.scale.set(vs, vs * this.layout.stretchY, vs);

    this.arcMat.opacity = 0.75 * a * (1 - 0.35 * idle);
    for (const arc of this.arcs) {
      arc.mesh.rotation.z += dt * arc.speed * speed * (1 + 1.5 * (b - idle * 0.8));
      arc.mesh.rotation.x = arc.tilt * b;
    }
    for (const m of [this.motesMat, this.sparksMat]) {
      m.uniforms['uTime'].value = t;
      m.uniforms['uSpeed'].value = speed * (1 - idle * 0.4);
    }
    this.motesMat.uniforms['uAlpha'].value = 0.9 * a;
    this.sparksMat.uniforms['uAlpha'].value = smooth(0.8, 3, s) * (1 - 0.4 * idle);
    this.floorMat.opacity = (0.15 * a + 0.5 * b) * (0.9 + 0.1 * Math.sin(t * 1.3));
    if (this.portalLight && this.lightBase) {
      this.cool.copy(CYAN).lerp(PURPLE, 0.5 + 0.5 * Math.sin(t * 0.6) * idle);
      this.portalLight.color.copy(this.lightBase.color).lerp(this.cool, b * 0.8);
    }

    // C · the cards
    this.offset = THREE.MathUtils.lerp(this.offset, this.offsetTarget, Math.min(1, dt * 6));
    const narrow = this.narrow();
    const spacing = narrow ? 1.75 : 2.05;
    let allSettled = true;
    this.cards.forEach((c, i) => {
      const slot = i - this.offset;
      const target = this.slotPose(slot, narrow, spacing, t, c.seed);
      if (!c.launched) {
        if (s >= c.at) {
          c.launched = true;
          c.group.visible = true;
          if (c.flight) {
            const side = target.pos.x === 0 ? (i % 2 ? 1 : -1) : Math.sign(target.pos.x);
            const ctrl = new THREE.Vector3(target.pos.x * 1.6 + side * 1.3, this.portal.y + 1.4 + Math.random() * 0.6, (this.portal.z + target.pos.z) / 2);
            c.curve = new THREE.QuadraticBezierCurve3(this.portal.clone().add(new THREE.Vector3(0, 0, 0.2)), ctrl, target.pos.clone());
            this.events.onCardOut?.(i);
          }
          if (this.stage !== 'cards' && this.stage !== 'idle') this.setStage('cards');
        }
      }
      if (!c.launched) {
        allSettled = false;
        return;
      }
      if (c.flight && c.settled < 1) {
        // flying out of the portal on a curve, turning, trailing sparks
        const k = clamp01((s - c.at) / FLIGHT);
        const e = easeOutCubic(k);
        c.curve!.v2.copy(target.pos);
        c.group.position.copy(c.curve!.getPoint(e));
        c.group.rotation.set(Math.sin(k * Math.PI) * 0.25, target.rotY + c.spin * (1 - e), Math.sin(k * Math.PI * 2) * 0.18 * (1 - k));
        c.group.scale.setScalar(THREE.MathUtils.lerp(0.12, target.scale, e));
        c.faceMat.opacity = smooth(0, 0.25, k);
        c.settled = k;
        if (k < 0.95) this.emit(c.group.position, 2);
        if (k >= 1) c.settled = 1;
      } else {
        // in its place (or fading in there): floating gently, following the carousel and the focus
        c.settled = Math.min(1, c.settled + dt * (rm ? 1.5 : 1.2));
        const fade = c.flight ? 1 : smooth(0, 1, c.settled);
        c.focus = THREE.MathUtils.lerp(c.focus, this.focused === i ? 1 : 0, Math.min(1, dt * 5));
        c.hover = THREE.MathUtils.lerp(c.hover, this.hovered === i && this.focused == null ? 1 : 0, Math.min(1, dt * 8));
        c.dim = THREE.MathUtils.lerp(c.dim, this.focused != null && this.focused !== i ? 1 : 0, Math.min(1, dt * 5));
        const pose = this.focusPose(target, c.focus, narrow);
        const follow = Math.min(1, dt * 7);
        c.group.position.lerp(pose.pos, follow);
        c.group.rotation.x = THREE.MathUtils.lerp(c.group.rotation.x, 0, follow);
        c.group.rotation.y = THREE.MathUtils.lerp(c.group.rotation.y, pose.rotY, follow);
        c.group.rotation.z = THREE.MathUtils.lerp(c.group.rotation.z, rm ? 0 : Math.sin(t * 0.6 + c.seed) * 0.02 * (1 - c.focus), follow);
        c.group.scale.setScalar(THREE.MathUtils.lerp(c.group.scale.x, pose.scale * (1 + c.hover * 0.05), follow));
        c.faceMat.opacity = fade * target.alpha;
      }
      if (c.settled < 1) allSettled = false;
      c.group.visible = c.faceMat.opacity > 0.01;
      // gold frame: brighter on hover and focus; the other cards dim while one is in focus
      c.frameMat.emissiveIntensity = 0.5 + c.hover * 0.6 + c.focus * 1.6 + Math.sin(t * 2 + c.seed) * 0.08;
      c.faceMat.color.setScalar(0.9 * (1 - 0.6 * c.dim));
      c.frameMat.color.copy(GOLD).multiplyScalar(1 - 0.5 * c.dim);
      (c.glow.material as THREE.MeshBasicMaterial).opacity = c.faceMat.opacity * (0.22 + c.hover * 0.2 + c.focus * 0.45) * (1 - 0.7 * c.dim);
      // its soft shadow on the stone floor
      c.shadow.position.set(c.group.position.x, 0.025, c.group.position.z + 0.2);
      (c.shadow.material as THREE.MeshBasicMaterial).opacity = c.faceMat.opacity * 0.55 * (1 - 0.6 * c.focus);
    });
    this.updateTrail(dt);

    if (!this.completed && s > T_CARDS && (allSettled || (!this.cards.length && s > T_CARDS + 2))) {
      this.completed = true;
      this.interactive = true;
      this.setStage('idle');
      this.events.onComplete?.();
    }
    if (rm && !this.completed && s > 2.6 && this.cards.length && allSettled) {
      this.completed = true;
      this.interactive = true;
      this.setStage('idle');
      this.events.onComplete?.();
    }
    this.updateCamera(dt, t);
  }

  /** Where card slot `slot` (0 = middle) rests: an arc in front of the portal, the outer ones turned in and further back. */
  private slotPose(slot: number, narrow: boolean, spacing: number, t: number, seed: number) {
    const abs = Math.abs(slot);
    const bob = this.reducedMotion ? 0 : Math.sin(t * 0.9 + seed) * 0.07;
    return {
      pos: new THREE.Vector3(slot * spacing, this.layout.cardY + bob - Math.min(abs, 2) * 0.08, this.layout.cardZ - Math.min(abs, 2.5) * (narrow ? 0.9 : 0.5)),
      rotY: -THREE.MathUtils.clamp(slot, -2, 2) * (narrow ? 0.45 : 0.3),
      scale: 1 - Math.min(abs, 2) * (narrow ? 0.14 : 0.07),
      alpha: clamp01(1.9 - abs),
    };
  }

  /** The focused card comes towards the camera (beside the details on a wide screen, above them on a phone). */
  private focusPose(rest: { pos: THREE.Vector3; rotY: number; scale: number }, k: number, narrow: boolean) {
    if (k < 0.001) return rest;
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const dist = CARD_H / ((narrow ? 0.42 : 0.6) * 2 * Math.tan(fov / 2));
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    const right = new THREE.Vector3().crossVectors(fwd, this.camera.up).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const halfH = dist * Math.tan(fov / 2);
    const halfW = halfH * this.camera.aspect;
    const p = this.camera.position.clone().addScaledVector(fwd, dist);
    if (narrow) p.addScaledVector(up, halfH * 0.42);
    else p.addScaledVector(right, halfW * 0.38);
    return { pos: rest.pos.clone().lerp(p, k), rotY: THREE.MathUtils.lerp(rest.rotY, 0, k), scale: THREE.MathUtils.lerp(rest.scale, 1, k) };
  }

  private updateCamera(dt: number, t: number) {
    const s = this.time;
    const k = THREE.MathUtils.smootherstep(clamp01(s / (this.reducedMotion ? 1.5 : 6)), 0, 1);
    // a phone held upright: closer, so the card in the middle fills most of the width
    const rest = this.narrow() ? this.camRestNarrow : this.camRest;
    const pos = this.camFrom.clone().lerp(rest, k);
    const look = this.camLookFrom.clone().lerp(this.lookRest, k);
    if (!this.reducedMotion) {
      // a slow breath of the camera; a short shake while the vortex opens
      pos.x += Math.sin(t * 0.21) * 0.12 * k;
      pos.y += Math.sin(t * 0.17) * 0.05 * k;
      const shake = smooth(T_VORTEX, T_VORTEX + 0.4, s) * (1 - smooth(T_VORTEX + 0.6, T_VORTEX + 2, s));
      pos.x += Math.sin(t * 37) * 0.015 * shake;
      pos.y += Math.sin(t * 29) * 0.015 * shake;
    }
    this.camera.position.lerp(pos, Math.min(1, dt * 4));
    this.camera.lookAt(look);
  }

  private emit(at: THREE.Vector3, n: number) {
    const pos = this.trail.geometry.attributes['position'] as THREE.BufferAttribute;
    const count = this.trailLife.length;
    for (let j = 0; j < n; j++) {
      const i = this.trailNext;
      this.trailNext = (this.trailNext + 1) % count;
      pos.setXYZ(i, at.x + (Math.random() - 0.5) * 0.5, at.y + (Math.random() - 0.5) * 0.6, at.z + (Math.random() - 0.5) * 0.2);
      this.trailVel.set([(Math.random() - 0.5) * 0.8, Math.random() * 0.6 - 0.2, (Math.random() - 0.5) * 0.4], i * 3);
      this.trailLife[i] = 1;
    }
  }

  private updateTrail(dt: number) {
    const pos = this.trail.geometry.attributes['position'] as THREE.BufferAttribute;
    let any = false;
    for (let i = 0; i < this.trailLife.length; i++) {
      if (this.trailLife[i] <= 0) continue;
      any = true;
      this.trailLife[i] = Math.max(0, this.trailLife[i] - dt * 1.3);
      pos.setXYZ(i, pos.getX(i) + this.trailVel[i * 3] * dt, pos.getY(i) + (this.trailVel[i * 3 + 1] - 0.4) * dt, pos.getZ(i) + this.trailVel[i * 3 + 2] * dt);
    }
    if (any) {
      pos.needsUpdate = true;
      (this.trail.geometry.attributes['aLife'] as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  private setStage(stage: FinaleStage) {
    if (this.stage === stage) return;
    this.stage = stage;
    this.events.onStage?.(stage);
  }

  private narrow() {
    return this.camera.aspect < 1;
  }

  private firstOffset(n: number) {
    // three in view: the middle one of the first three; on a narrow screen one card in the middle, its neighbours peeking
    if (this.narrow()) return n >= 3 ? 1 : 0;
    return n >= 3 ? 1 : (n - 1) / 2;
  }

  private minOffset() {
    return this.cards.length >= 3 && !this.narrow() ? 1 : 0;
  }

  private maxOffset() {
    const n = this.cards.length;
    return Math.max(this.minOffset(), n >= 3 && !this.narrow() ? n - 2 : n - 1);
  }

  private clampOffset(v: number) {
    if (this.cards.length < 3 && !this.narrow()) return (this.cards.length - 1) / 2;
    return THREE.MathUtils.clamp(v, this.minOffset(), this.maxOffset());
  }

  // ---------------------------------------------------------------------------------------------- the card's face

  /** Cover, name, short description, players, price (and the previous price, when there is one) and the button. */
  private draw(card: Card) {
    const cv = card.canvas;
    const g = cv.getContext('2d')!;
    const W = cv.width;
    const H = cv.height;
    const u = W / 512;
    const d = card.data;
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#16203f');
    bg.addColorStop(1, '#0a0f22');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);

    // the cover (cropped to fill), or a soft placeholder while it loads
    const cx = 18 * u;
    const cy = 18 * u;
    const cw = W - 36 * u;
    const chh = H * 0.5;
    g.save();
    this.roundPath(g, cx, cy, cw, chh, 18 * u);
    g.clip();
    if (card.cover && card.cover.naturalWidth) {
      const img = card.cover;
      const scale = Math.max(cw / img.naturalWidth, chh / img.naturalHeight);
      const iw = img.naturalWidth * scale;
      const ih = img.naturalHeight * scale;
      g.drawImage(img, cx + (cw - iw) / 2, cy + (chh - ih) / 2, iw, ih);
    } else {
      const ph = g.createRadialGradient(W / 2, cy + chh / 2, 10, W / 2, cy + chh / 2, cw * 0.7);
      ph.addColorStop(0, '#2a4a8a');
      ph.addColorStop(1, '#101a36');
      g.fillStyle = ph;
      g.fillRect(cx, cy, cw, chh);
    }
    const fadeTop = g.createLinearGradient(0, cy + chh * 0.6, 0, cy + chh);
    fadeTop.addColorStop(0, 'rgba(10,15,34,0)');
    fadeTop.addColorStop(1, 'rgba(10,15,34,0.85)');
    g.fillStyle = fadeTop;
    g.fillRect(cx, cy, cw, chh);
    g.restore();
    g.strokeStyle = 'rgba(246,215,141,0.7)';
    g.lineWidth = 2 * u;
    this.roundPath(g, cx, cy, cw, chh, 18 * u);
    g.stroke();

    g.direction = 'rtl';
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    let y = cy + chh + 52 * u;
    g.fillStyle = '#ffe39a';
    g.font = `700 ${46 * u}px 'Frank Ruhl Libre', 'Heebo', serif`;
    y = this.wrap(g, d.name, W / 2, y + 4 * u, W - 60 * u, 48 * u, 1) + 6 * u;
    g.fillStyle = '#eef1fb';
    g.font = `500 ${27 * u}px 'Heebo', 'Segoe UI', Arial, sans-serif`;
    y = this.wrap(g, d.tagline, W / 2, y, W - 56 * u, 33 * u, 2);
    g.fillStyle = '#b9c6e6';
    g.font = `400 ${22 * u}px 'Heebo', 'Segoe UI', Arial, sans-serif`;
    g.fillText(d.players, W / 2, y + 4 * u);

    // the price row and the button sit at the bottom
    const by = H - 92 * u;
    if (d.price) {
      g.font = `800 ${38 * u}px 'Heebo', 'Segoe UI', Arial, sans-serif`;
      const pw = g.measureText(d.price).width;
      let prevW = 0;
      if (d.previousPrice) {
        g.font = `400 ${24 * u}px 'Heebo', 'Segoe UI', Arial, sans-serif`;
        prevW = g.measureText(d.previousPrice).width + 18 * u;
      }
      const total = pw + prevW;
      const right = W / 2 + total / 2;
      g.textAlign = 'right';
      g.fillStyle = '#ffffff';
      g.font = `800 ${38 * u}px 'Heebo', 'Segoe UI', Arial, sans-serif`;
      g.fillText(d.price, right, by - 18 * u);
      if (d.previousPrice) {
        const px = right - pw - 18 * u;
        g.fillStyle = '#8f97b3';
        g.font = `400 ${24 * u}px 'Heebo', 'Segoe UI', Arial, sans-serif`;
        g.fillText(d.previousPrice, px, by - 20 * u);
        const w = prevW - 18 * u;
        g.strokeStyle = '#c9726a';
        g.lineWidth = 2.5 * u;
        g.beginPath();
        g.moveTo(px - w, by - 28 * u);
        g.lineTo(px, by - 28 * u);
        g.stroke();
      }
      g.textAlign = 'center';
    }
    const bw = W - 120 * u;
    const bh = 54 * u;
    const bx = (W - bw) / 2;
    const btn = g.createLinearGradient(0, by, 0, by + bh);
    btn.addColorStop(0, '#ffe39a');
    btn.addColorStop(1, '#d9a23a');
    g.fillStyle = btn;
    this.roundPath(g, bx, by, bw, bh, bh / 2);
    g.fill();
    g.fillStyle = '#1d1405';
    g.font = `700 ${25 * u}px 'Heebo', 'Segoe UI', Arial, sans-serif`;
    g.textBaseline = 'middle';
    g.fillText('לפרטים ולרכישה', W / 2, by + bh / 2 + 1 * u);
    card.texture.needsUpdate = true;
  }

  private roundPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  /** Wraps RTL text into at most `lines` centred lines (the last one ends with "…" when cut); returns the next y. */
  private wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, lh: number, lines: number) {
    const words = (text ?? '').split(/\s+/).filter(Boolean);
    let line = '';
    let n = 0;
    for (let i = 0; i < words.length; i++) {
      const test = line ? line + ' ' + words[i] : words[i];
      if (g.measureText(test).width > max && line) {
        if (n === lines - 1) {
          let cut = line;
          while (cut && g.measureText(cut + '…').width > max) cut = cut.slice(0, -1);
          g.fillText(cut + '…', x, y);
          return y + lh;
        }
        g.fillText(line, x, y);
        y += lh;
        n++;
        line = words[i];
      } else line = test;
    }
    if (line) {
      g.fillText(line, x, y);
      y += lh;
    }
    return y;
  }

  // ---------------------------------------------------------------------------------------------- cleanup

  dispose() {
    this.renderer.toneMappingExposure = this.baseExposure;
    if (this.portalLight && this.lightBase) this.portalLight.color.copy(this.lightBase.color);
    this.scene.remove(this.root);
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) geos.add(m.geometry);
      if (m.material) mats.add(m.material as THREE.Material);
    });
    geos.forEach((g) => g.dispose());
    mats.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
    this.cards.forEach((c) => {
      if (c.cover) c.cover.src = '';
    });
    this.cards = [];
  }
}
