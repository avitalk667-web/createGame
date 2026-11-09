// "שער הסודות" 2.0, the Stone Hall, puzzle 3 — the mechanical cabinet (part of stonehall.glb) and the optional golden chest.
// Shows what the server decides: each wheel turns to the symbol it shows (quarter turns, always forward); when all four are
// right the stone cover over the number plate rises and the ancient letters appear in its windows; when the code opens the
// cabinet its doors swing out on the glowing ancient key. The chest's lid opens in a golden glow. The free game only.
import * as THREE from 'three';
import { MechanismState } from '../core/models';

const CX = -4.4;
const CZ = -7 + 0.45;
const GOLD = new THREE.Color('#ffcf6a');
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

function letterTexture(letter: string) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 160;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1a1208'; g.fillRect(0, 0, 128, 160);
  g.fillStyle = '#ffd36b'; g.font = 'bold 118px "Frank Ruehl CLM", "David", serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(letter, 64, 84);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class StoneCabinet {
  private wheels: THREE.Object3D[] = [];
  /** Each moving part keeps the turn the model gave it; the motion is added on top, about an axis of the room. */
  private base = new Map<THREE.Object3D, THREE.Quaternion>();
  private turns: { shown?: number; goal: number; cur: number }[] = [];
  private cover?: THREE.Object3D;
  private coverY = 0;
  private letters: THREE.Mesh[] = [];
  private doors: THREE.Object3D[] = [];
  private key = new THREE.Group();
  private keyLight = new THREE.PointLight('#ffd27a', 0, 3, 1.6);
  private chestLid?: THREE.Object3D;
  private chestLight = new THREE.PointLight('#ffcf6a', 0, 4, 1.6);
  private mech?: MechanismState;
  private status = 'locked';
  private chestStatus = 'locked';
  private ready = 0;
  private open = 0;
  private openedAt = -1;
  private lid = 0;
  start: () => number[] | undefined = () => undefined;

  constructor(root: THREE.Object3D, group: THREE.Group) {
    for (let k = 1; k <= 4; k++) {
      const w = root.getObjectByName(`CabinetWheel_${k}`);
      if (w) { this.wheels.push(w); this.turns.push({ goal: 0, cur: 0 }); this.base.set(w, w.quaternion.clone()); }
    }
    this.cover = root.getObjectByName('CodeCover');
    this.coverY = this.cover?.position.y ?? 0;
    for (const n of ['CabinetDoor_L', 'CabinetDoor_R']) { const d = root.getObjectByName(n); if (d) this.doors.push(d); }
    this.chestLid = root.getObjectByName('ChestLid');
    if (this.chestLid) this.base.set(this.chestLid, this.chestLid.quaternion.clone());
    for (const d of this.doors) this.base.set(d, d.quaternion.clone());
    // the four windows of the number plate
    for (let k = 0; k < 4; k++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.17), new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: new THREE.Color('#ffd36b'), emissiveIntensity: 0.6 }));
      m.position.set(CX - 0.39 + k * 0.26, 1.45, CZ + 0.518);
      m.visible = false;
      group.add(m);
      this.letters.push(m);
    }
    // the ancient key inside the cabinet
    const gold = new THREE.MeshStandardMaterial({ color: '#ffcf6a', metalness: 1, roughness: 0.25, emissive: GOLD, emissiveIntensity: 0.4 });
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.022, 10, 24), gold);
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.03, 0.03), gold);
    shaft.position.x = 0.2;
    const bit = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.08, 0.03), gold);
    bit.position.set(0.31, -0.04, 0);
    this.key.add(bow, shaft, bit);
    this.key.position.set(CX - 0.1, 1.0, CZ + 0.15);
    this.key.visible = false;
    this.keyLight.position.set(CX, 1.2, CZ + 0.5);
    this.chestLight.position.set(6.25, 1.1, 4.9);
    group.add(this.key, this.keyLight, this.chestLight);
  }

  private turn(o: THREE.Object3D, axis: THREE.Vector3, angle: number) {
    o.quaternion.copy(this.base.get(o) ?? o.quaternion).premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
  }

  apply(mech: MechanismState | undefined, status: string, chestStatus: string) {
    this.mech = mech;
    if (status === 'solved' && this.status !== 'solved' && this.openedAt < 0) this.openedAt = -2;   // just opened: start the reveal
    this.status = status;
    this.chestStatus = chestStatus;
    const letters = mech?.backs ?? {};
    this.letters.forEach((m, k) => {
      const l = letters[`w${k + 1}`];
      if (l && m.userData['l'] !== l) {
        (m.material as THREE.MeshStandardMaterial).map = letterTexture(l);
        (m.material as THREE.MeshStandardMaterial).emissiveMap = (m.material as THREE.MeshStandardMaterial).map;
        (m.material as THREE.MeshStandardMaterial).needsUpdate = true;
        m.userData['l'] = l;
      }
    });
  }

  update(dt: number, t: number) {
    const solved = this.status === 'solved';
    // each wheel shows its symbol under the pointer: quarter turns, always forward (3 → 0 is one more quarter)
    const rot = this.mech?.rotations ?? this.start() ?? [];
    this.wheels.forEach((w, k) => {
      const r = rot[k] ?? 0;
      const s = this.turns[k];
      if (s.shown === undefined) { s.shown = r; s.goal = s.cur = (-r * Math.PI) / 2; }
      else if (r !== s.shown) { s.goal -= (((r - s.shown + 4) % 4) * Math.PI) / 2; s.shown = r; }
      s.cur = THREE.MathUtils.lerp(s.cur, s.goal, Math.min(1, dt * 9));
      this.turn(w, Z, s.cur);
    });
    // all four right: the cover rises and the letters show
    const aligned = !!this.mech?.ready || solved;
    this.ready = THREE.MathUtils.clamp(this.ready + (aligned ? dt / 0.8 : -dt / 0.5), 0, 1);
    if (this.cover) this.cover.position.y = this.coverY + THREE.MathUtils.smootherstep(this.ready, 0, 1) * 0.42;
    this.letters.forEach((m) => (m.visible = this.ready > 0.6 && !!m.userData['l']));
    // opened: the doors swing out slowly, golden light, the key glows a few seconds and goes into the bag
    this.open = THREE.MathUtils.clamp(this.open + (solved ? dt / 2.2 : -dt), 0, 1);
    const e = THREE.MathUtils.smootherstep(this.open, 0, 1);
    if (this.doors[0]) this.turn(this.doors[0], Y, -e * 1.9);
    if (this.doors[1]) this.turn(this.doors[1], Y, e * 1.9);
    if (this.openedAt === -2 && solved) this.openedAt = t;
    const since = this.openedAt >= 0 ? t - this.openedAt : 99;
    this.key.visible = solved && since < 6;
    if (this.key.visible) {
      this.key.position.y = 1.0 + Math.min(1, since / 2) * 0.35 + Math.sin(t * 2) * 0.02;
      this.key.rotation.y = t * 1.2;
      this.key.scale.setScalar(since > 5 ? Math.max(0.01, 6 - since) : 1);
    }
    this.keyLight.intensity = THREE.MathUtils.lerp(this.keyLight.intensity, solved && since < 8 ? 5 : solved ? 1.5 : 0, Math.min(1, dt * 2));
    // the golden chest: its lid lifts in a golden glow
    const chestOpen = this.chestStatus === 'solved';
    this.lid = THREE.MathUtils.clamp(this.lid + (chestOpen ? dt / 1.4 : -dt), 0, 1);
    if (this.chestLid) this.turn(this.chestLid, X, -THREE.MathUtils.smootherstep(this.lid, 0, 1) * 1.2);
    this.chestLight.intensity = chestOpen ? 4 + Math.sin(t * 5) * 1.2 : this.chestStatus === 'active' ? 0.6 + Math.sin(t * 2) * 0.3 : 0;
  }
}
