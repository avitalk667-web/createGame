// "שער הסודות" 2.0, room 1: the Stone Hall, built in Blender (tools/blender/stonehall_build.py → models/stonehall/stonehall.glb).
// This module loads the room, gives it its cold blue light, and shows what the server decides: the crystal pendulum's
// swing (drawn from the round's start on the server's clock), the ice breaking as each piece is freed, the three map
// pieces floating over the table in the order and turn the group has set, and the whole map lighting up.
// Only the free game builds it; the Hanukkah game never reaches this code.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MechanismState, RoomSnapshot } from '../core/models';
import { RuneData, RuneDisc } from './rune-disc';
import { StoneCabinet } from './stone-cabinet';

export const STONE_HALL_MODEL_VERSION = 3;

/** Room geometry shared with the Blender script. */
const TABLE_Z = -1.3;
const PIVOT_Y = 7.05;
const ARM = 4.85;
const GAUGE_Z = TABLE_Z - 0.42;
const GAUGE_R = ARM - 0.05;
const PIECE_X = [-1.05, 0, 1.05];      // the three pieces frozen on the table, left to right
const SLOT_X = [-0.6, 0, 0.6];         // where the freed pieces float (they meet when the map is whole)

export interface PendulumRound { kind?: string; period: number; amplitude: number; vary?: number; pauseAt?: number; pauseSeconds?: number }

/** The swing's angle in degrees — the same formula as GameEngine.PendulumAngle on the server, which judges every stop. */
export function pendulumAngle(round: PendulumRound, seconds: number): number {
  const t = Math.max(0, seconds);
  const { period, amplitude } = round;
  let phase: number;
  if (round.kind === 'varying') {
    phase = (2 * Math.PI * t) / period + (round.vary ?? 0.9) * Math.sin((2 * Math.PI * t) / (2.7 * period));
  } else if (round.kind === 'pause') {
    const hold = round.pauseSeconds ?? 0.45;
    const at = (round.pauseAt ?? 0.4) * period;
    const cycle = period + hold;
    const n = Math.floor(t / cycle);
    const u = t - n * cycle;
    const tau = n * period + (u < at ? u : u < at + hold ? at : u - hold);
    phase = (2 * Math.PI * tau) / period;
  } else {
    phase = (2 * Math.PI * t) / period;
  }
  return amplitude * Math.sin(phase);
}

/** A cold reflection environment made in code (no image): crystal blue to the sides, the vault above, a warm entrance. */
export function stoneHallEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const env = new THREE.Scene();
  env.background = new THREE.Color('#0a0f1a');
  const panel = (color: string, intensity: number, w: number, h: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  panel('#6fa8ff', 2.2, 6, 2, -8, 2, -2);
  panel('#4a8cff', 1.8, 6, 2, 8, 1, 1);
  panel('#cfe0ff', 2.8, 4, 4, 0, 9, 0);
  panel('#ffcf9a', 1.4, 5, 2, 0, 2, 9);
  panel('#22324a', 1.0, 20, 20, 0, -6, 0);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.04).texture;
  pmrem.dispose();
  env.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } });
  return tex;
}

// ---------------------------------------------------------------------------------------------- the map's art

/**
 * The whole map, drawn once: a parchment with an ornamented frame on its outer edges, a title running across all three
 * pieces (so the right order and the upright turn can be read), a coastline and a dotted path running from piece to piece,
 * a lake in the middle and the four symbols (the compass, lit first, when the map is whole).
 */
function drawMap(lit: boolean): HTMLCanvasElement {
  const W = 1536, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#e8d6a8'); bg.addColorStop(0.5, '#dcc690'); bg.addColorStop(1, '#e4cf9c');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(120,80,30,${rnd() * 0.08})`; g.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 6, 2 + rnd() * 6); }
  // the sea under the coastline
  g.beginPath();
  g.moveTo(0, 400);
  g.bezierCurveTo(300, 330, 450, 460, 700, 400);
  g.bezierCurveTo(950, 340, 1150, 470, 1536, 360);
  g.lineTo(1536, H); g.lineTo(0, H); g.closePath();
  g.fillStyle = 'rgba(70,110,140,0.35)'; g.fill();
  g.lineWidth = 6; g.strokeStyle = '#3a2a14'; g.stroke();
  for (let y = 420; y < H - 20; y += 18) { g.beginPath(); g.moveTo(40, y); g.lineTo(W - 40, y + 4); g.strokeStyle = 'rgba(40,70,100,0.18)'; g.lineWidth = 2; g.stroke(); }
  // the lake in the middle piece
  g.beginPath(); g.ellipse(768, 250, 120, 60, -0.1, 0, Math.PI * 2);
  g.fillStyle = 'rgba(70,110,140,0.45)'; g.fill(); g.lineWidth = 5; g.strokeStyle = '#3a2a14'; g.stroke();
  // the dotted path, across all three pieces
  g.setLineDash([16, 14]); g.lineWidth = 6; g.strokeStyle = '#7a2a14';
  g.beginPath(); g.moveTo(130, 300); g.bezierCurveTo(400, 180, 560, 360, 700, 330); g.bezierCurveTo(900, 290, 1000, 150, 1400, 250); g.stroke();
  g.setLineDash([]);
  // the title, running across the three pieces
  g.fillStyle = '#4a2a10'; g.font = 'bold 76px "Frank Ruehl CLM", "David", serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('ארץ השער העתיק', W / 2, 92);
  // the four symbols
  const syms: [string, number, number][] = [['🧭', 300, 230], ['🗝️', 600, 420 - 70], ['📖', 1010, 205], ['🪔', 1290, 330]];
  syms.forEach(([s, x, y], k) => {
    g.beginPath(); g.arc(x, y, 44, 0, Math.PI * 2);
    g.fillStyle = lit && k === 0 ? 'rgba(120,200,255,0.9)' : 'rgba(255,240,200,0.75)'; g.fill();
    g.lineWidth = 4; g.strokeStyle = lit ? '#2a6ab0' : '#5a3a14'; g.stroke();
    g.font = '52px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif'; g.fillStyle = '#000';
    g.fillText(s, x, y + 2);
  });
  // the ornamented frame on the outer edges (left on the first piece, right on the last), thin lines along top and bottom
  g.strokeStyle = '#5a3a14'; g.lineWidth = 5;
  g.strokeRect(14, 14, W - 28, H - 28);
  for (const x of [34, W - 34]) {
    g.lineWidth = 10; g.beginPath(); g.moveTo(x, 30); g.lineTo(x, H - 30); g.stroke();
    for (let y = 60; y < H - 40; y += 56) {
      g.beginPath(); g.moveTo(x, y - 16); g.lineTo(x + 14, y); g.lineTo(x, y + 16); g.lineTo(x - 14, y); g.closePath();
      g.fillStyle = '#8a5a1a'; g.fill();
    }
  }
  return c;
}

/** One third of the map, with torn inner edges that match its neighbours (the same tears on both sides of a cut). */
function pieceCanvas(whole: HTMLCanvasElement, index: number): HTMLCanvasElement {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d')!;
  const tear = (cut: number) => {
    const pts: [number, number][] = [];
    let seed = 31 + cut * 17;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let y = 0; y <= S; y += 32) pts.push([(rnd() - 0.5) * 34, y]);
    return pts;
  };
  const left = index > 0 ? tear(index) : null;
  const right = index < 2 ? tear(index + 1) : null;
  g.beginPath();
  if (left) left.forEach(([dx, y], k) => (k ? g.lineTo(dx + 18, y) : g.moveTo(dx + 18, y)));
  else { g.moveTo(0, 0); g.lineTo(0, S); }
  if (right) [...right].reverse().forEach(([dx, y]) => g.lineTo(S - 18 + dx, y));
  else { g.lineTo(S, S); g.lineTo(S, 0); }
  g.closePath();
  g.save(); g.clip();
  g.drawImage(whole, index * S, 0, S, S, 0, 0, S, S);
  g.restore();
  return c;
}

let pieceImages: string[] | null = null;
/** The three pieces as images, for the tiles of the map's control bar (the same art as in the room). */
export function mapPieceImages(): string[] {
  if (!pieceImages) {
    const whole = drawMap(false);
    pieceImages = [0, 1, 2].map((i) => pieceCanvas(whole, i).toDataURL('image/png'));
  }
  return pieceImages;
}

// ---------------------------------------------------------------------------------------------- the room

interface PendulumData { rounds: PendulumRound[]; window?: number; widenAfter?: number; widenedWindow?: number }

export class StoneHall {
  readonly group = new THREE.Group();
  /** The door slab: sits in a group the world opens like its other doors (it slides down into the floor). */
  readonly door = new THREE.Group();
  loaded = false;
  private pendulum?: THREE.Object3D;
  private bobLight?: THREE.PointLight;
  private freezeButton?: THREE.Mesh;
  private ice: THREE.Object3D[] = [];
  private frozenPieces: THREE.Object3D[] = [];
  private pieces: THREE.Mesh[] = [];
  private wholeMap?: THREE.Mesh;
  private target?: THREE.Mesh;
  private targetWindow = 0;
  private crystalMats = new Set<THREE.MeshStandardMaterial>();
  // what the server says
  private mech?: MechanismState;
  private map?: MechanismState;
  private pendulumSolved = false;
  private mapSolved = false;
  private freed = 0;
  private iceT = [0, 0, 0];
  private rise = [0, 0, 0];
  private glow = 0;
  private parked = 0;
  /** Puzzle 2: the rune disc (rune-disc.ts). */
  runes?: RuneDisc;
  runeData: () => RuneData | undefined = () => undefined;
  /** Puzzle 3 and the golden chest (stone-cabinet.ts). */
  cabinet?: StoneCabinet;
  cabinetStart: () => number[] | undefined = () => undefined;

  constructor(private c: number, private quality: string, private data: () => PendulumData | undefined, private onLoad: () => void, onError: () => void) {
    this.group.position.set(0, 0, c);
    this.door.position.set(0, 0, c);
    this.door.userData['slab'] = true;
    new GLTFLoader().load(`models/stonehall/stonehall.glb?v=${STONE_HALL_MODEL_VERSION}`, (gltf) => this.setUp(gltf.scene), undefined, () => onError());
  }

  private setUp(root: THREE.Object3D) {
    const shadows = this.quality !== 'low';
    const aniso = this.quality === 'low' ? 4 : 8;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      for (const t of [mat.map, mat.normalMap, mat.roughnessMap]) if (t) t.anisotropy = aniso;
      m.receiveShadow = shadows;
      m.castShadow = shadows && !mat.transparent && !/^Static_Hall(Wall|Floor|Dark|Groove|Icicle)$/.test(m.name);
      if (mat.name === 'HallCrystal') this.crystalMats.add(mat);
      // the ice: frosted and see-through (real refraction re-renders the room every frame — too slow for phones)
      if (/^IceBlock_/.test(m.name)) {
        m.material = new THREE.MeshPhysicalMaterial({ color: '#cfe6ff', roughness: 0.16, transparent: true, opacity: 0.62, depthWrite: false, clearcoat: 1,
          clearcoatRoughness: 0.08, emissive: new THREE.Color('#0d2c55'), envMapIntensity: 1.6, flatShading: true, side: THREE.DoubleSide });
        m.renderOrder = 2;
        m.castShadow = false;
      }
    });
    // the dark block that closes the corridor in the preview: the game builds its own corridor to the workshop
    root.getObjectByName('Corridor')?.removeFromParent();
    this.pendulum = root.getObjectByName('Pendulum');
    this.freezeButton = root.getObjectByName('FreezeButton') as THREE.Mesh | undefined;
    if (this.freezeButton) this.freezeButton.material = (this.freezeButton.material as THREE.Material).clone();
    this.ice = [1, 2, 3].map((i) => root.getObjectByName(`IceBlock_${i}`)!).filter(Boolean);
    this.frozenPieces = [1, 2, 3].map((i) => root.getObjectByName(`MapPiece_${i}`)!).filter(Boolean);
    root.getObjectByName('TargetArc')?.removeFromParent();   // replaced by a zone that can widen
    const slab = root.getObjectByName('DoorSlab');
    if (slab) { slab.removeFromParent(); this.door.add(slab); }   // (keeps its place in the model: the back wall)
    this.group.add(root);
    this.runes = new RuneDisc(root, this.group, () => this.runeData());
    this.cabinet = new StoneCabinet(root, this.group);
    this.cabinet.start = () => this.cabinetStart();

    // the crystal's own light travels with it
    this.bobLight = new THREE.PointLight('#7cc4ff', 3, 6, 1.6);
    this.group.add(this.bobLight);

    // the three freed pieces and the whole map (drawn in code)
    const whole = drawMap(false);
    const lit = drawMap(true);
    for (let i = 0; i < 3; i++) {
      const tex = new THREE.CanvasTexture(pieceCanvas(whole, i));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = aniso;
      const piece = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6), new THREE.MeshStandardMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, roughness: 0.9, emissive: new THREE.Color('#ffffff'), emissiveMap: tex, emissiveIntensity: 0.15 }));
      piece.visible = false;
      piece.renderOrder = 3;
      this.group.add(piece);
      this.pieces.push(piece);
    }
    const litTex = new THREE.CanvasTexture(lit);
    litTex.colorSpace = THREE.SRGBColorSpace;
    this.wholeMap = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.6), new THREE.MeshStandardMaterial({ map: litTex, transparent: true, opacity: 0, side: THREE.DoubleSide,
      emissive: new THREE.Color('#9fd4ff'), emissiveMap: litTex, emissiveIntensity: 0.9, depthWrite: false }));
    this.wholeMap.position.set(0, 1.55, TABLE_Z);
    this.wholeMap.rotation.x = -0.9;
    this.wholeMap.renderOrder = 4;
    this.group.add(this.wholeMap);

    // the entrance inscription on its tablet
    this.group.add(this.inscription());
    this.loaded = true;
    this.onLoad();
  }

  private inscription() {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 300;
    const g = c.getContext('2d')!;
    g.fillStyle = '#0e1420'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#9fd0ff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.direction = 'rtl';
    g.font = 'bold 40px "Frank Ruehl CLM", "David", serif';
    g.fillText('„לא הכוח יפתח את השער, ולא המפתח לבדו.', 512, 80);
    g.fillText('רק מי שיבין את הסימנים, יפעיל את המנגנונים', 512, 150);
    g.fillText('ויחבר את כל העדויות — יגלה את הסוד.”', 512, 220);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 0.67), new THREE.MeshStandardMaterial({ map: tex, emissive: new THREE.Color('#ffffff'), emissiveMap: tex, emissiveIntensity: 0.35, roughness: 0.8 }));
    m.position.set(0, 2.6, 7 - 0.105);
    m.rotation.y = Math.PI;
    return m;
  }

  /** The target zone on the time scale: a lit arc of ±window degrees, rebuilt when it widens. */
  private setWindow(deg: number) {
    if (deg === this.targetWindow) return;
    this.targetWindow = deg;
    this.target?.removeFromParent();
    this.target?.geometry.dispose();
    const w = THREE.MathUtils.degToRad(deg);
    const geo = new THREE.RingGeometry(GAUGE_R - 0.15, GAUGE_R + 0.01, 16, 1, -Math.PI / 2 - w, 2 * w);
    const mat = (this.target?.material as THREE.MeshStandardMaterial) ?? new THREE.MeshStandardMaterial({ color: '#0d3350', emissive: new THREE.Color('#1fa8ff'), emissiveIntensity: 1, side: THREE.DoubleSide });
    this.target = new THREE.Mesh(geo, mat);
    this.target.position.set(0, PIVOT_Y, GAUGE_Z + 0.045);
    this.group.add(this.target);
  }

  /** Before anyone touches the map (the server keeps no state for it yet), the pieces lie as the scenario starts them. */
  mapStart: () => { order: string[]; turns: number[] } | undefined = () => undefined;

  /** The server's state of the two puzzles (called with every snapshot). */
  apply(s: RoomSnapshot) {
    this.mech = s.mechanisms?.['g1-pendulum'];
    this.map = s.mechanisms?.['g1-map'];
    this.pendulumSolved = s.puzzles.find((p) => p.id === 'g1-pendulum')?.status === 'solved';
    this.mapSolved = s.puzzles.find((p) => p.id === 'g1-map')?.status === 'solved';
    this.freed = this.pendulumSolved ? 3 : this.mech?.progress ?? 0;
    this.runes?.apply(s.mechanisms?.['g1-runes'], s.puzzles.find((p) => p.id === 'g1-runes')?.status ?? 'locked');
    this.cabinet?.apply(s.mechanisms?.['g1-cabinet'], s.puzzles.find((p) => p.id === 'g1-cabinet')?.status ?? 'locked',
      s.puzzles.find((p) => p.id === 'g1-chest')?.status ?? 'locked');
    const d = this.data();
    if (d && this.loaded) this.setWindow((this.mech?.misses ?? 0) >= (d.widenAfter ?? 3) ? d.widenedWindow ?? 12 : d.window ?? 7);
  }

  /** Draws the frame: the swing (from the server's clock), the ice, the floating pieces, the glow of the whole map. */
  update(dt: number, t: number, serverMs: number) {
    if (!this.loaded) return;
    this.runes?.update(dt, t, serverMs);
    this.cabinet?.update(dt, t);
    const d = this.data();
    // the swing: running → the round's motion since its start; stopped → where it stopped; never started → at rest
    let angle = 0;
    const m = this.mech;
    if (m?.running && m.startedAt && d) {
      const round = d.rounds[Math.min(m.progress ?? 0, d.rounds.length - 1)];
      angle = pendulumAngle(round, (serverMs - Date.parse(m.startedAt)) / 1000);
    } else if (m?.frozenAngle != null && !this.pendulumSolved) {
      angle = m.frozenAngle;
    }
    // once all three pieces are free, the pendulum swings slowly aside and rests there, clear of the floating map
    this.parked = THREE.MathUtils.clamp(this.parked + (this.pendulumSolved ? dt / 2.5 : -1), 0, 1);
    if (this.parked > 0) angle = THREE.MathUtils.lerp(m?.frozenAngle ?? 0, -33, THREE.MathUtils.smootherstep(this.parked, 0, 1));
    if (this.pendulum) this.pendulum.rotation.z = THREE.MathUtils.degToRad(angle);
    if (this.bobLight) {
      const a = THREE.MathUtils.degToRad(angle);
      this.bobLight.position.set(Math.sin(a) * ARM, PIVOT_Y - Math.cos(a) * ARM - 0.3, TABLE_Z + 0.9);
      this.bobLight.intensity = 3 + Math.sin(t * 2.3) * 0.6;
    }
    // the target zone pulses while the swing runs, and the freeze button glows
    if (this.target) {
      const mat = this.target.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = m?.running ? 0.8 + 0.6 * Math.max(0, Math.cos(t * 5)) : 0.35;
      this.target.visible = !this.pendulumSolved;
    }
    if (this.freezeButton) (this.freezeButton.material as THREE.MeshStandardMaterial).emissiveIntensity = m?.running ? 1.2 + Math.sin(t * 8) * 0.5 : 0.6;
    for (const mat of this.crystalMats) mat.emissiveIntensity = 1 + 0.15 * Math.sin(t * 1.7);

    // each freed piece: its ice shrinks away, then the piece rises over the table and turns as the group sets it
    for (let i = 0; i < 3; i++) {
      const free = i < this.freed;
      this.iceT[i] = THREE.MathUtils.clamp(this.iceT[i] + (free ? dt / 0.6 : -dt / 0.6), 0, 1);
      const ice = this.ice[i];
      if (ice) {
        const k = 1 - this.iceT[i];
        ice.scale.setScalar(Math.max(0.001, k));
        ice.visible = k > 0.01;
      }
      if (this.frozenPieces[i]) this.frozenPieces[i].visible = !free;
      this.rise[i] = THREE.MathUtils.clamp(this.rise[i] + (free ? dt / 1.2 : -dt), 0, 1);
      const p = this.pieces[i];
      p.visible = free && this.rise[i] > 0.01 && !(this.mapSolved && this.glow >= 1);
      const id = `map-${i + 1}`;
      // where it floats: its place in the order the group set (before the map is touched: as it fell, above its ice)
      const start = this.mapStart();
      const slot = this.map?.slots ? Object.entries(this.map.slots).find(([, v]) => v === id)?.[0] : undefined;
      const place = slot ? Number(slot.slice(1)) - 1 : start ? start.order.indexOf(id) : -1;
      const x = place >= 0 ? SLOT_X[place] : PIECE_X[i];
      // quarter turns only ever go forward: 3 → 0 is one more quarter, never three back
      const turns = this.map?.rotations?.[i] ?? start?.turns[i] ?? 0;
      const u = p.userData as { turns?: number; goal?: number; cur?: number };
      if (u.turns === undefined) { u.turns = turns; u.goal = u.cur = (-turns * Math.PI) / 2; }
      else if (turns !== u.turns) { u.goal! += (-((turns - u.turns + 4) % 4) * Math.PI) / 2; u.turns = turns; }
      u.cur = THREE.MathUtils.lerp(u.cur!, u.goal!, Math.min(1, dt * 8));
      const e = THREE.MathUtils.smootherstep(this.rise[i], 0, 1);
      p.position.lerp(new THREE.Vector3(x, 1.1 + 0.45 * e, TABLE_Z), Math.min(1, dt * 6));
      p.rotation.set(-0.9 * e, 0, 0);
      p.rotateZ(u.cur!);
    }
    // the whole map: the pieces meet, then it lights up blue with its four symbols
    this.glow = THREE.MathUtils.clamp(this.glow + (this.mapSolved ? dt / 1.0 : -dt), 0, 1);
    if (this.wholeMap) {
      const mat = this.wholeMap.material as THREE.MeshStandardMaterial;
      mat.opacity = this.glow;
      mat.emissiveIntensity = 0.7 + 0.3 * Math.sin(t * 2);
      this.wholeMap.visible = this.glow > 0.01;
    }
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) { (mat as THREE.MeshStandardMaterial).map?.dispose(); mat.dispose(); }
    });
  }
}
