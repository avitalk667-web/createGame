// "שער הסודות" 2.0, room 2: the Mechanism Workshop, built in Blender (tools/blender/workshop_build.py → models/workshop/workshop.glb).
// This module loads the room, gives it its warm light, and shows what the server decides:
//   puzzle 4 — the levers swing when pulled, the gauges' needles and the counterweights follow the values; balanced, the
//              great gears turn;
//   puzzle 5 — the energy orb runs along the rails it is sent on (the rails it passed glow behind it, a dead end flashes red),
//              into the core;
//   puzzle 6 — the whole room turns over (2 s, or a fade with reduced motion), the three signs show on what was the ceiling,
//              the secret cell opens on the exit code;
//   the gate — its leaves open and its lamps light when the game is won.
// The free game only; the Hanukkah game never reaches it.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MechanismState, RoomSnapshot } from '../core/models';

export const WORKSHOP_MODEL_VERSION = 1;
const CEIL = 7.6;
const RX = 7.76;                       // the plane of the rails on the right wall
const RAIL_PTS: Record<string, [number, number][]> = {   // (z, y) points of each rail, as in the Blender script
  'S-J1': [[-4.0, 2.0], [-2.4, 2.0]],
  'J1-moon': [[-2.4, 2.0], [-2.4, 3.2], [-1.6, 3.9], [-0.4, 3.9]],
  'J1-sun': [[-2.4, 2.0], [-1.7, 1.55], [-1.0, 1.55]],
  'J1-star': [[-2.4, 2.0], [-2.9, 2.7], [-3.6, 2.85], [-4.15, 2.6], [-4.15, 2.15], [-4.0, 2.0]],
  'J2-moon': [[-0.4, 3.9], [-0.4, 4.75], [0.2, 4.75]],
  'J2-sun': [[-0.4, 3.9], [0.6, 3.4], [1.0, 2.6], [1.5, 2.2]],
  'J2-star': [[-0.4, 3.9], [-1.0, 3.2], [-1.7, 2.6], [-2.4, 2.0]],
  'J3-moon': [[1.5, 2.2], [1.5, 1.55], [2.2, 1.55]],
  'J3-sun': [[1.5, 2.2], [0.9, 1.75], [0.0, 1.75], [-0.4, 2.4], [-0.4, 3.3], [-0.4, 3.9]],
  'J3-star': [[1.5, 2.2], [2.3, 2.8], [2.6, 3.6], [2.85, 4.25]],
};
const NODE: Record<string, [number, number]> = { S: [-4.0, 2.0], J1: [-2.4, 2.0], J2: [-0.4, 3.9], J3: [1.5, 2.2], core: [2.85, 4.25] };
const ENERGY = new THREE.Color('#2ff5e0');
const RED = new THREE.Color('#ff3a2a');
const SIGN = new THREE.Color('#ffb44a');

/** A warm reflection environment made in code (no image): amber lamps, the furnace, turquoise from the rails. */
export function workshopEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const env = new THREE.Scene();
  env.background = new THREE.Color('#140c06');
  const panel = (color: string, intensity: number, w: number, h: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  panel('#ffb070', 2.6, 6, 4, 0, 9, 0);
  panel('#ff7a2a', 1.8, 4, 2, -8, 1, 6);
  panel('#3ff0d8', 0.3, 4, 2, 8, 2, -1);
  panel('#ffd9a8', 1.2, 5, 2, 0, 2, 9);
  panel('#2a1a10', 1.0, 20, 20, 0, -6, 0);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.04).texture;
  pmrem.dispose();
  env.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } });
  return tex;
}

function textPlane(lines: string[], w: number, h: number, color = '#ffd9a0', bg = '#1a120a', font = 'bold 44px "Frank Ruehl CLM", "David", serif') {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = Math.round(1024 * h / w);
  const g = c.getContext('2d')!;
  g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#b07a30'; g.lineWidth = 8; g.strokeRect(6, 6, c.width - 12, c.height - 12);
  g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle'; g.direction = 'rtl'; g.font = font;
  lines.forEach((l, i) => g.fillText(l, c.width / 2, (c.height / (lines.length + 1)) * (i + 1)));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, emissive: new THREE.Color('#ffffff'), emissiveMap: tex, emissiveIntensity: 0.5, roughness: 0.8 }));
}

/** Drops a mesh's triangles that lie wholly beyond z = <paramref>limit</paramref> in the model's coordinates (in front of the front wall). */
function cutInFrontOf(mesh: THREE.Mesh, limit: number) {
  const geo = mesh.geometry;
  const pos = geo.getAttribute('position');
  mesh.updateMatrix();
  const v = new THREE.Vector3();
  const z = (i: number) => v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrix).z;
  const index = geo.index ? Array.from(geo.index.array) : Array.from({ length: pos.count }, (_, i) => i);
  const keep: number[] = [];
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [index[t], index[t + 1], index[t + 2]];
    if (z(a) > limit && z(b) > limit && z(c) > limit) continue;
    keep.push(a, b, c);
  }
  geo.setIndex(keep);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
}

export class Workshop {
  readonly group = new THREE.Group();
  loaded = false;
  /** 0..1 — how far the room has turned over (the world dims the light by `fade` when motion is reduced). */
  flip = 0;
  fade = 0;
  private flipGroup = new THREE.Group();
  private root?: THREE.Object3D;
  private levers: THREE.Object3D[] = [];
  private leverBase: THREE.Quaternion[] = [];
  private kick = [0, 0, 0];
  private needles: THREE.Object3D[] = [];
  private weights: THREE.Object3D[] = [];
  private weightY: number[] = [];
  private gears: THREE.Object3D[] = [];
  private ceilGears: THREE.Object3D[] = [];
  private rails = new Map<string, THREE.MeshStandardMaterial>();
  private orb?: THREE.Object3D;
  private core?: THREE.MeshStandardMaterial;
  private coil?: THREE.Object3D;
  private signs: THREE.MeshStandardMaterial[] = [];
  private hatch?: THREE.Object3D;
  private hatchBase = new THREE.Quaternion();
  private gateBase: THREE.Quaternion[] = [];
  private codePlate?: THREE.Mesh;
  private gates: THREE.Object3D[] = [];
  private gateLamps: THREE.MeshStandardMaterial[] = [];
  private shown: number[] = [];
  // what the server says
  private status = new Map<string, string>();
  private levMech?: MechanismState;
  private railMech?: MechanismState;
  private gravMech?: MechanismState;
  private won = false;
  private leverStart: number[] = [4, 0, 2];
  private reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  private gearT = 0;
  private gateT = 0;
  private hatchT = 0;

  constructor(c: number, private quality: string, onLoad: () => void, onError: () => void) {
    this.group.position.set(0, 0, c);
    this.flipGroup.position.set(0, CEIL / 2, 0);
    this.group.add(this.flipGroup);
    new GLTFLoader().load(`models/workshop/workshop.glb?v=${WORKSHOP_MODEL_VERSION}`, (gltf) => { this.setUp(gltf.scene); onLoad(); }, undefined, () => onError());
  }

  set leverStartValues(v: number[] | undefined) { if (v) this.leverStart = v; }

  private setUp(root: THREE.Object3D) {
    const shadows = this.quality !== 'low';
    const aniso = this.quality === 'low' ? 4 : 8;
    const tint: Record<string, string> = { WsWall: '#d9b48e', WsFloor: '#c79f80', WsWood: '#e0b890' };   // the approved textures, warmed
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      for (const t of [mat.map, mat.normalMap, mat.roughnessMap]) if (t) t.anisotropy = aniso;
      if (tint[mat.name]) mat.color.set(tint[mat.name]);
      m.receiveShadow = shadows;
      m.castShadow = shadows && !/^Static_Ws(Wall|Floor|Dark|DarkSteel)$/.test(m.name);
    });
    // the dark block behind the entrance in the preview: the game has its own corridor from the Stone Hall
    root.getObjectByName('EntranceCorridor')?.removeFromParent();
    // the model build merged that block into the dark mesh (so the line above finds nothing): its triangles, in front of
    // the workshop's front wall, stood in the Stone Hall's doorway and hid the hall's stone door behind a black box
    const dark = root.getObjectByName('Static_WsDark') as THREE.Mesh | undefined;
    if (dark?.isMesh) cutInFrontOf(dark, 7.3);
    root.position.set(0, -CEIL / 2, 0);
    this.flipGroup.add(root);
    this.root = root;
    for (const n of ['A', 'B', 'C']) {
      const lever = root.getObjectByName(`Lever_${n}`)!;
      this.levers.push(lever);
      this.leverBase.push(lever.quaternion.clone());
      this.needles.push(root.getObjectByName(`Needle_${n}`)!);
      const w = root.getObjectByName(`Weight_${n}`)!;
      this.weights.push(w);
      this.weightY.push(w.position.y);
    }
    for (const n of ['Gear_1', 'Gear_2', 'Gear_3', 'Gear_4', 'Gear_5', 'GateCrown']) { const g = root.getObjectByName(n); if (g) this.gears.push(g); }
    for (const n of ['CeilGear_1', 'CeilGear_2', 'CeilGear_3']) { const g = root.getObjectByName(n); if (g) this.ceilGears.push(g); }
    for (const key of Object.keys(RAIL_PTS)) {
      const r = root.getObjectByName('Rail_' + key.replace('-', '_')) as THREE.Mesh | undefined;
      if (!r) continue;
      r.material = (r.material as THREE.Material).clone();
      this.rails.set(key, r.material as THREE.MeshStandardMaterial);
    }
    this.orb = root.getObjectByName('EnergyOrb');
    const core = root.getObjectByName('Core') as THREE.Mesh | undefined;
    if (core) { core.material = (core.material as THREE.Material).clone(); this.core = core.material as THREE.MeshStandardMaterial; }
    this.coil = root.getObjectByName('Coil');
    for (let k = 1; k <= 3; k++) {
      const s = root.getObjectByName(`CeilSignMark_${k}`) as THREE.Mesh | undefined;
      if (s) { s.material = (s.material as THREE.Material).clone(); this.signs.push(s.material as THREE.MeshStandardMaterial); }
    }
    this.hatch = root.getObjectByName('CellHatch');
    if (this.hatch) this.hatchBase.copy(this.hatch.quaternion);
    for (const n of ['GateLeft', 'GateRight']) { const g = root.getObjectByName(n); if (g) { this.gates.push(g); this.gateBase.push(g.quaternion.clone()); } }
    root.traverse((o) => {
      if (!/^GateLamp_/.test(o.name)) return;
      const m = o as THREE.Mesh;
      m.material = (m.material as THREE.Material).clone();
      this.gateLamps.push(m.material as THREE.MeshStandardMaterial);
    });
    // the inscription by the gravity rod (on the platform's edge, facing the entrance)
    const ins = textPlane(['„כאשר העולם מתהפך, האמת שהוסתרה מתגלה.', 'תחילה הסימן שזוכר, אחריו הסימן שמאזן,', 'ולבסוף הסימן שמוביל את הדרך.”'], 2.2, 0.62, '#ffe2b0', '#2a1a0c', 'bold 40px "Frank Ruehl CLM", "David", serif');
    ins.position.set(0, 0.55 + 0.04, 1.25);
    ins.rotation.x = -0.55;
    root.add(ins);
    // the exit code on a plate inside the secret cell (shown once the cell opens)
    this.codePlate = textPlane(['קוד היציאה'], 0.5, 0.36);
    this.codePlate.position.set(4.4, 5.35, -6.6 + 0.37);
    this.codePlate.visible = false;
    root.add(this.codePlate);
    this.loaded = true;
  }

  private setCode(code: string) {
    if (!this.codePlate || this.codePlate.userData['code'] === code) return;
    const fresh = textPlane(['קוד היציאה', code.split('').join(' ')], 0.5, 0.36, '#ffffff', '#3a2a10', 'bold 120px "Segoe UI", Arial, sans-serif');
    fresh.position.copy(this.codePlate.position);
    fresh.userData['code'] = code;
    this.codePlate.parent?.add(fresh);
    this.codePlate.removeFromParent();
    this.codePlate = fresh;
  }

  /** The server's state of room 2 (called with every snapshot). */
  apply(s: RoomSnapshot) {
    for (const id of ['g2-levers', 'g2-rails', 'g2-gravity', 'g2-gate']) this.status.set(id, s.puzzles.find((p) => p.id === id)?.status ?? 'locked');
    const before = this.levMech?.rotations?.slice() ?? this.leverStart;
    this.levMech = s.mechanisms?.['g2-levers'];
    const now = this.levMech?.rotations ?? this.leverStart;
    // a pulled lever: its own value went up — swing it
    now.forEach((v, k) => { if (v > (before[k] ?? v)) this.kick[k] = 1; });
    this.railMech = s.mechanisms?.['g2-rails'];
    this.gravMech = s.mechanisms?.['g2-gravity'];
    this.won = s.phase === 'completed';
    if (this.gravMech?.revealed) this.setCode(this.gravMech.revealed);
  }

  update(dt: number, t: number, serverMs: number) {
    if (!this.loaded) return;
    const solved = (id: string) => this.status.get(id) === 'solved';
    // ---- levers: needles and weights follow the values; a pulled lever swings and settles back
    const values = this.levMech?.rotations ?? this.leverStart;
    values.forEach((v, k) => {
      if (this.shown[k] === undefined) this.shown[k] = v;
      this.shown[k] = THREE.MathUtils.lerp(this.shown[k], v, Math.min(1, dt * 5));
      const n = this.needles[k];
      if (n) n.rotation.x = THREE.MathUtils.degToRad(120 - 60 * this.shown[k]);
      const w = this.weights[k];
      if (w) w.position.y = this.weightY[k] + (this.shown[k] - 2) * 0.22;
      this.kick[k] = Math.max(0, this.kick[k] - dt * 2.2);
      const lever = this.levers[k];
      if (lever) {
        const swing = Math.sin(Math.min(1, 1 - this.kick[k]) * Math.PI) * 0.7 * (this.kick[k] > 0 ? 1 : 0);
        lever.quaternion.copy(this.leverBase[k]).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -swing));
      }
    });
    // balanced: the great gears turn, faster once the energy flows
    this.gearT = THREE.MathUtils.clamp(this.gearT + (solved('g2-levers') ? dt / 2 : -dt), 0, 1);
    const speed = this.gearT * (solved('g2-rails') ? 0.35 : 0.15);
    this.gears.forEach((g, k) => g.rotateZ(dt * speed * (k % 2 ? -1.7 : 1)));
    this.ceilGears.forEach((g, k) => g.rotateZ(dt * (solved('g2-rails') ? 0.4 : 0.05) * (k ? -1.6 : 1)));

    // ---- rails: lit behind the orb; a dead end flashes red; the orb runs the last rail from the moment it was sent
    const path = this.railMech?.input ?? [];
    const at = this.railMech?.revealed ?? 'S';
    const last = path[path.length - 1];
    const sent = this.railMech?.startedAt ? (serverMs - Date.parse(this.railMech.startedAt)) / 1000 : 99;
    const run = THREE.MathUtils.clamp(sent / 1.2, 0, 1);
    for (const [key, mat] of this.rails) {
      const on = solved('g2-rails') || (path.includes(key) && (key !== last || run >= 1)) && at !== 'S';
      const dead = at === 'dead' && key === last && run >= 1;
      const target = dead ? RED : on ? ENERGY : new THREE.Color('#0d4a46');
      mat.emissive.lerp(target, Math.min(1, dt * 8));
      mat.emissiveIntensity = dead ? 1.6 + Math.sin(t * 18) * 0.8 : on ? 1.5 : this.status.get('g2-rails') === 'active' ? 0.55 : 0.25;
    }
    if (this.orb) {
      let p: [number, number] = NODE['S'];
      if (last && RAIL_PTS[last] && at !== 'S') {
        const pts = RAIL_PTS[last];
        const seg = pts.length - 1;
        const f = run * seg;
        const i = Math.min(seg - 1, Math.floor(f));
        const a = pts[i], b = pts[i + 1];
        const k = f - i;
        p = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
      }
      this.orb.position.set(RX - 0.3, p[1] + Math.sin(t * 2) * 0.03, p[0]);
      this.orb.visible = !(solved('g2-rails') && run >= 1);
    }
    if (this.core) this.core.emissiveIntensity = solved('g2-rails') ? 2.2 + Math.sin(t * 3) * 0.4 : 0.6;
    this.coil?.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m?.name === 'WsEnergy') m.emissiveIntensity = solved('g2-rails') ? 1.6 + 0.5 * Math.sin(t * 4) : 0.15;
    });

    // ---- gravity: the room turns over (or fades over) from the moment the rod was used
    const g = this.gravMech;
    const since = g?.startedAt ? (serverMs - Date.parse(g.startedAt)) / 1000 : 99;
    const k = THREE.MathUtils.clamp(since / 2, 0, 1);
    const goal = g?.running ? 1 : 0;
    const from = 1 - goal;
    const target = this.reduced ? (k >= 0.5 ? goal : from) : from + (goal - from) * THREE.MathUtils.smootherstep(k, 0, 1);
    this.flip = target;
    this.fade = this.reduced && k < 1 && since < 2 ? Math.sin(k * Math.PI) : 0;
    this.flipGroup.rotation.z = this.flip * Math.PI;
    // the signs on the ceiling light up once it is the floor
    for (const m of this.signs) {
      m.emissive.copy(SIGN);
      m.emissiveIntensity = THREE.MathUtils.lerp(m.emissiveIntensity, this.flip > 0.8 ? 1.4 + Math.sin(t * 3) * 0.3 : 0, Math.min(1, dt * 4));
    }
    // the cell opens on the exit code
    this.hatchT = THREE.MathUtils.clamp(this.hatchT + (solved('g2-gravity') ? dt / 1.2 : -dt), 0, 1);
    if (this.hatch) this.hatch.quaternion.copy(this.hatchBase).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -this.hatchT * 1.9));
    if (this.codePlate) this.codePlate.visible = this.hatchT > 0.3;

    // ---- the gate: lamps light along it and its leaves open when the game is won
    this.gateT = THREE.MathUtils.clamp(this.gateT + (this.won ? dt / 3 : -dt), 0, 1);
    const e = THREE.MathUtils.smootherstep(this.gateT, 0, 1);
    // (each leaf hangs on its outer edge: the left one swings toward the room by turning negative, the right one positive)
    this.gates.forEach((g, k) => g.quaternion.copy(this.gateBase[k]).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (k ? 1 : -1) * e * 1.6)));
    for (const m of this.gateLamps) m.emissiveIntensity = this.won ? 2.6 : solved('g2-gravity') ? 1.2 + Math.sin(t * 4) * 0.4 : 0.4;
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
