// "שער הסודות" 2.0, the Stone Hall, puzzle 2 — the rune disc on the left wall (part of stonehall.glb). This module only
// shows what the server decides: the stage's lights, played from its start on the server's clock (a light "in the dark"
// pulses the disc's hub instead of a symbol), the symbols pressed so far, red and green flashes, and, once the chain is
// complete, all four lit and the disc turning with a click. The free game only; the Hanukkah game never reaches it.
import * as THREE from 'three';
import { MechanismState } from '../core/models';

/** The disc's centre in the room (game metres, relative to the room centre) — as in tools/blender/stonehall_build.py. */
const DISC = new THREE.Vector3(-7.84, 2.75, -1.6);
const OFF = new THREE.Color('#04101e');
const ON = new THREE.Color('#38c8ff');
const DONE = new THREE.Color('#2a8bd0');
const BAD = new THREE.Color('#ff3a2a');
const GOOD = new THREE.Color('#3dffa0');
const DARK = new THREE.Color('#9a4dff');
/** The symbol the light in the dark lit, as its holder sees it: a bright violet-white, far brighter than anything around. */
const SECRET = new THREE.Color('#e3b8ff');

export interface RuneData { stones: string[]; leadSeconds?: number; stepSeconds?: number; slowAfter?: number; slowStepSeconds?: number; darkHoldSeconds?: number }

/**
 * When each light of a shown stage is on, in seconds from the show's start, by the server's timing: one step each, the
 * light in the dark ('?') a longer step (darkHoldSeconds more), so whoever sees it has time to tell which symbol it is.
 */
export function runeSchedule(d: RuneData, shown: string[], misses: number) {
  const step = misses >= (d.slowAfter ?? 3) ? d.slowStepSeconds ?? 1.4 : d.stepSeconds ?? 0.9;
  let at = d.leadSeconds ?? 0.8;
  const lights = shown.map((s) => {
    const len = s === '?' ? step + (d.darkHoldSeconds ?? 0) : step;
    const l = { symbol: s, from: at, on: len * (s === '?' ? 0.88 : 0.7), len };
    at += len;
    return l;
  });
  return { lights, end: at };
}

export class RuneDisc {
  private pivot = new THREE.Group();
  private rings = new Map<string, THREE.MeshStandardMaterial[]>();
  private emblems = new Map<string, THREE.MeshStandardMaterial[]>();
  private stones: THREE.MeshStandardMaterial[] = [];
  private hub?: THREE.MeshStandardMaterial;
  private cabinetLight = new THREE.PointLight('#ffd27a', 0, 4, 1.6);
  /** The light in the dark, for everyone: the disc goes dim, a violet halo pulses around it and a violet glow on the wall. */
  private halo: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  private darkGlow = new THREE.PointLight('#a35cff', 0, 5, 1.4);
  private darkOn = 0;
  /** The symbol the light in the dark showed, for the one player who holds that clue only (null for the rest). */
  darkSymbol: () => string | null = () => null;
  private mech?: MechanismState;
  private status = 'locked';
  private flash: { color: THREE.Color; until: number } | null = null;
  private spin = 0;
  /** The light that is on at the moment (a symbol, '?' for the dark one, or null) — the play screen plays a sound on change. */
  current: string | null = null;

  constructor(root: THREE.Object3D, group: THREE.Group, private data: () => RuneData | undefined) {
    this.pivot.position.copy(DISC);
    group.add(this.pivot);
    const toPivot: THREE.Object3D[] = [];
    root.traverse((o) => { if (/^(RuneDisc|RuneSocket_|Rune_|RuneLight_)/.test(o.name) && o.parent && !/^(RuneDisc|Rune_|RuneLight_|RuneSocket_)/.test(o.parent.name)) toPivot.push(o); });
    group.updateMatrixWorld(true);
    for (const o of toPivot) this.pivot.attach(o);   // keeps each part where it is, now turning with the disc
    // the parts now live under the pivot, no longer under the model's root: look them up in both
    const find = (name: string) => root.getObjectByName(name) ?? this.pivot.getObjectByName(name);
    // a part may be one mesh or a group of meshes: each gets its own copy of its material, to light it alone
    const mats = (name: string) => {
      const list: THREE.MeshStandardMaterial[] = [];
      find(name)?.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.material) { m.material = (m.material as THREE.Material).clone(); list.push(m.material as THREE.MeshStandardMaterial); }
      });
      return list;
    };
    for (const sym of ['compass', 'key', 'book', 'lamp']) {
      this.rings.set(sym, mats(`RuneLight_${sym}`));
      this.emblems.set(sym, mats(`Rune_${sym}`));
    }
    for (let k = 1; k <= 4; k++) {
      this.stones.push(...mats(`RuneStoneMark_${k}`));
    }
    this.hub = mats('RuneDiscHub')[0];
    // when the chain is complete, the four symbols on the locked cabinet begin to glow
    this.cabinetLight.position.set(-4.4, 2.1, -6.0);
    group.add(this.cabinetLight);
    // the halo stands just in front of the disc's face (the disc faces +x), not turning with it
    this.halo = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.05, 10, 72),
      new THREE.MeshBasicMaterial({ color: DARK, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.halo.position.copy(DISC).add(new THREE.Vector3(0.3, 0, 0));
    this.halo.rotation.y = Math.PI / 2;
    this.halo.visible = false;
    this.halo.renderOrder = 5;
    this.darkGlow.position.copy(DISC).add(new THREE.Vector3(1.1, 0, 0));
    group.add(this.halo, this.darkGlow);
  }

  apply(mech: MechanismState | undefined, status: string) {
    this.mech = mech;
    this.status = status;
  }

  /** A red flash for a wrong press, green for a finished stage. */
  flashStones(kind: 'bad' | 'good', now: number) {
    this.flash = { color: kind === 'bad' ? BAD : GOOD, until: now + 0.9 };
  }

  /** The light of the stage on at this moment, by the server's clock: a symbol, '?' (dark), or null between lights. */
  lightAt(serverMs: number): string | null {
    const m = this.mech;
    const d = this.data();
    if (!m?.startedAt || !m.shown?.length || !d) return null;
    const t = (serverMs - Date.parse(m.startedAt)) / 1000;
    const l = runeSchedule(d, m.shown, m.misses ?? 0).lights.find((x) => t >= x.from && t < x.from + x.len);
    return l && t - l.from < l.on ? l.symbol : null;
  }

  update(dt: number, t: number, serverMs: number) {
    const solved = this.status === 'solved';
    const light = solved ? null : this.lightAt(serverMs);
    this.current = light;
    const input = new Set(this.mech?.input ?? []);
    // before the first show the four symbols blink softly (the map has woken the disc); while locked they are dark
    const waking = this.status === 'active' && !this.mech?.startedAt;
    const dark = light === '?';
    // the one who holds the clue sees which symbol the light in the dark lit — in violet; nobody else does
    const secret = dark ? this.darkSymbol() : null;
    for (const [sym, ringMats] of this.rings) {
      let c = OFF;
      let k = 0.5;
      if (solved) { c = ON; k = 2.2 + 0.4 * Math.sin(t * 3); }
      else if (secret === sym) { c = SECRET; k = 4.5 + Math.sin(t * 9) * 0.8; }
      else if (dark) { c = OFF; k = 0.15; }
      else if (light === sym) { c = ON; k = 3.2; }
      else if (input.has(sym)) { c = DONE; k = 1.4; }
      else if (waking) { c = ON; k = 0.6 + 0.6 * Math.max(0, Math.sin(t * 3 + sym.length)); }
      for (const mat of ringMats) {
        mat.emissive.lerp(c, Math.min(1, dt * 14));
        mat.emissiveIntensity = THREE.MathUtils.lerp(mat.emissiveIntensity, k, Math.min(1, dt * 14));
      }
      for (const em of this.emblems.get(sym) ?? []) {
        em.emissive.copy(secret === sym ? SECRET : ON);
        em.emissiveIntensity = THREE.MathUtils.lerp(em.emissiveIntensity, secret === sym ? 2.2 : light === sym || solved ? 1.2 : 0, Math.min(1, dt * 14));
      }
    }
    if (this.hub) {
      // the light in the dark: the hub pulses violet
      this.hub.emissive.copy(DARK);
      this.hub.emissiveIntensity = THREE.MathUtils.lerp(this.hub.emissiveIntensity, dark ? 0.9 + Math.sin(t * 30) * 0.3 : 0, Math.min(1, dt * 16));
    }
    this.darkOn = THREE.MathUtils.clamp(this.darkOn + (dark ? dt / 0.15 : -dt / 0.3), 0, 1);
    this.halo.visible = this.darkOn > 0.01;
    this.halo.material.opacity = this.darkOn * (0.55 + 0.25 * Math.sin(t * 12));
    this.halo.scale.setScalar(1 + 0.04 * Math.sin(t * 6));
    this.darkGlow.intensity = this.darkOn * 1.6;
    // the stones: a flash after a press, all lit once the chain is complete
    const flashing = this.flash && t < this.flash.until ? this.flash : null;
    for (const mat of this.stones) {
      const c = flashing ? flashing.color : solved ? ON : OFF;
      mat.emissive.lerp(c, Math.min(1, dt * 18));
      mat.emissiveIntensity = flashing ? 2.4 * (0.6 + 0.4 * Math.sin(t * 24)) : solved ? 1.8 : 0.7;
    }
    // complete: the disc turns a quarter with a click, and the cabinet's symbols glow
    this.spin = THREE.MathUtils.clamp(this.spin + (solved ? dt / 1.2 : -1), 0, 1);
    this.pivot.rotation.x = THREE.MathUtils.smootherstep(this.spin, 0, 1) * (Math.PI / 2);
    this.cabinetLight.intensity = THREE.MathUtils.lerp(this.cabinetLight.intensity, solved ? 4 : 0, Math.min(1, dt * 2));
  }
}
