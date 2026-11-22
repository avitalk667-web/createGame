// "הצופן הזוגי" — the modular decor kit shared by the six rooms: architecture (floors with openings, upper walls,
// coffered ceilings, pilasters, door casings, deep windows with curtains), furniture (bookcases with instanced books,
// drawer cabinets, chairs, tables, shelves), lamps (chandeliers, pendants, sconces, desk lamps), clutter (books, papers,
// ink, scrolls, crates, barrels, tools) and mechanics (wall gears, pipes, gauges, chains, trusses), plus dust and soft
// light shafts. Everything is made in code — no third-party models or textures — with one material per look, cached
// and shared. Static pieces go into the room's "static" group, which bake() merges into one mesh per material, so a
// richly furnished room stays a few dozen draw calls. Moving pieces go into the room's own group and animate.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { bookSpinesTexture, glowSpriteTexture, paintingTexture, rugTexture, stoneTexture, windowTexture } from '../../world/textures';
import { RoomCtx, curtainTex, gearGeometry, paperTex, std, wood } from './cc-kit';

export type Anim = (t: number, dt: number) => void;

/** One room's decorating session: static pieces (baked at the end), live pieces, animations, and the quality. */
export interface Deco {
  ctx: RoomCtx;
  /** Static decor: merged per material by bake(). Never put sprites, lights or moving parts here. */
  s: THREE.Group;
  /** Live objects (animated, sprites, particles): the room's own group. */
  live: THREE.Group;
  anim: Anim[];
  /** Medium and high quality: small clutter, dust and shafts. Low quality keeps the furniture and the architecture. */
  rich: boolean;
}

export function deco(ctx: RoomCtx, anim: Anim[]): Deco {
  const s = new THREE.Group();
  s.name = 'cc-static';
  ctx.group.add(s);
  return { ctx, s, live: ctx.group, anim, rich: ctx.quality !== 'low' };
}

// ------------------------------------------------------------------------------------------------ cached materials

const MATS = new Map<string, THREE.Material>();
export function cm<T extends THREE.Material>(key: string, make: () => T): T {
  let m = MATS.get(key) as T | undefined;
  if (!m) { m = make(); MATS.set(key, m); }
  return m;
}
export const W = (tone: string, rep: [number, number] = [1, 1]) => cm(`wood${tone}${rep}`, () => wood(tone, rep));
export const S = (color: string, rough = 0.8, metal = 0) => cm(`std${color}${rough}${metal}`, () => std(color, { roughness: rough, metalness: metal }));
export const BRASS = () => cm('brass', () => std('#c9a050', { metalness: 0.9, roughness: 0.32 }));
export const GOLD = () => cm('gold', () => std('#d8b060', { metalness: 1, roughness: 0.25 }));
export const IRON = () => cm('iron', () => std('#4a4e54', { metalness: 0.8, roughness: 0.5 }));
export const DARKIRON = () => cm('darkiron', () => std('#2a2c30', { metalness: 0.75, roughness: 0.55 }));
export const COPPER = () => cm('copper', () => std('#b8683e', { metalness: 0.9, roughness: 0.38 }));
export const GLASS = () => cm('glass', () => std('#cfe2ee', { metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.22, depthWrite: false }));
export const EMIT = (color: string) => cm(`emit${color}`, () => new THREE.MeshBasicMaterial({ color, toneMapped: false }));
export const TEXM = (key: string, tex: () => THREE.Texture, rough = 0.85) => cm(`tex${key}`, () => std('#ffffff', { map: tex(), roughness: rough }));

// ------------------------------------------------------------------------------------------------ textures drawn in code

const TEX = new Map<string, THREE.Texture>();
function tex(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, repeat?: [number, number]) {
  let t = TEX.get(key);
  if (!t) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d')!, w, h);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    TEX.set(key, t);
  }
  if (!repeat) return t;
  const r = t.clone();
  r.wrapS = r.wrapT = THREE.RepeatWrapping;
  r.repeat.set(...repeat);
  r.needsUpdate = true;
  return r;
}
/** A repeated copy of a cached texture. */
export function rep(t: THREE.Texture, r: [number, number]) {
  const c = t.clone();
  c.wrapS = c.wrapT = THREE.RepeatWrapping;
  c.repeat.set(...r);
  c.needsUpdate = true;
  return c;
}
let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const shade = (hex: string, k: number) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();

/** Irregular flagstones with grout. */
export function flagstoneTex(base: string, rep: [number, number]) {
  return tex('flag' + base, 512, 512, (g, w, h) => {
    g.fillStyle = shade(base, 0.45); g.fillRect(0, 0, w, h);
    const rows = 4;
    for (let r = 0; r < rows; r++) {
      let x = -rnd() * 60;
      const y0 = (r * h) / rows;
      while (x < w) {
        const sw = 90 + rnd() * 110;
        g.fillStyle = shade(base, 0.8 + rnd() * 0.35);
        g.fillRect(x + 4, y0 + 4, sw - 8, h / rows - 8);
        for (let k = 0; k < 40; k++) { g.fillStyle = `rgba(0,0,0,${rnd() * 0.08})`; g.fillRect(x + rnd() * sw, y0 + rnd() * (h / rows), 3 + rnd() * 8, 2 + rnd() * 5); }
        x += sw;
      }
    }
  }, rep);
}
/** Herringbone parquet. */
export function parquetTex(base: string, rep: [number, number]) {
  return tex('parq' + base, 512, 512, (g, w, h) => {
    g.fillStyle = shade(base, 0.6); g.fillRect(0, 0, w, h);
    const L = 128, T = 32;
    for (let y = -L; y < h + L; y += T * 2) for (let x = -L; x < w + L; x += L) {
      for (const dir of [0, 1]) {
        g.save();
        g.translate(x + dir * T * 2, y + dir * T);
        g.rotate(dir ? -Math.PI / 4 : Math.PI / 4);
        g.fillStyle = shade(base, 0.82 + rnd() * 0.3);
        g.fillRect(0, 0, L * 0.7, T - 3);
        g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 1;
        for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(4, 6 + k * 8); g.lineTo(L * 0.7 - 4, 6 + k * 8 + rnd() * 3); g.stroke(); }
        g.restore();
      }
    }
  }, rep);
}
/** Wide old planks. */
export function plankTex(base: string, rep: [number, number]) {
  return tex('plank' + base, 512, 512, (g, w, h) => {
    const n = 6;
    for (let k = 0; k < n; k++) {
      g.fillStyle = shade(base, 0.8 + rnd() * 0.35);
      g.fillRect(0, (k * h) / n, w, h / n);
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(0, (k * h) / n); g.lineTo(w, (k * h) / n); g.stroke();
      const cut = rnd() * w;
      g.beginPath(); g.moveTo(cut, (k * h) / n); g.lineTo(cut, ((k + 1) * h) / n); g.stroke();
      g.strokeStyle = 'rgba(0,0,0,0.08)'; g.lineWidth = 1;
      for (let j = 0; j < 8; j++) { const y = (k * h) / n + rnd() * (h / n); g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + 3, w * 0.6, y - 3, w, y + 1); g.stroke(); }
      g.fillStyle = 'rgba(30,20,10,0.5)';
      for (const x of [cut - 14, cut + 14]) { g.beginPath(); g.arc(x, (k * h) / n + 10, 2.4, 0, 7); g.arc(x, ((k + 1) * h) / n - 10, 2.4, 0, 7); g.fill(); }
    }
  }, rep);
}
/** Dressed stone blocks (ashlar) for walls. */
export function ashlarTex(base: string, rep: [number, number]) {
  return tex('ash' + base, 512, 512, (g, w, h) => {
    g.fillStyle = shade(base, 0.5); g.fillRect(0, 0, w, h);
    const rows = 6, bh = h / rows;
    for (let r = 0; r < rows; r++) {
      let x = r % 2 ? -64 : 0;
      while (x < w) {
        const bw = 120 + rnd() * 40;
        const grd = g.createLinearGradient(x, r * bh, x, (r + 1) * bh);
        const c = shade(base, 0.85 + rnd() * 0.3);
        grd.addColorStop(0, shade(c, 1.12)); grd.addColorStop(1, shade(c, 0.85));
        g.fillStyle = grd;
        g.fillRect(x + 3, r * bh + 3, bw - 6, bh - 6);
        for (let k = 0; k < 30; k++) { g.fillStyle = `rgba(0,0,0,${rnd() * 0.1})`; g.fillRect(x + rnd() * bw, r * bh + rnd() * bh, 2 + rnd() * 6, 2 + rnd() * 4); }
        x += bw;
      }
    }
  }, rep);
}
/** A recessed panel with a moulded border (coffers, wainscot, cabinet doors). */
export function panelTex(base: string, trim: string) {
  return tex('pan' + base + trim, 256, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    g.strokeStyle = trim; g.lineWidth = 10; g.strokeRect(14, 14, w - 28, h - 28);
    g.strokeStyle = shade(trim, 0.6); g.lineWidth = 3; g.strokeRect(32, 32, w - 64, h - 64);
    const grd = g.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, 'rgba(255,255,255,0.08)'); grd.addColorStop(1, 'rgba(0,0,0,0.18)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
}
/** A painted frieze band under the ceiling: a repeating motif between two gilded lines. */
export function friezeTex(base: string, ink: string, motif: 'notes' | 'gears' | 'keys' | 'compass' | 'letters' | 'house') {
  return tex('frz' + base + ink + motif, 512, 128, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    g.fillStyle = ink; g.fillRect(0, 10, w, 5); g.fillRect(0, h - 15, w, 5);
    g.strokeStyle = ink; g.fillStyle = ink; g.lineWidth = 4; g.lineCap = 'round';
    for (let k = 0; k < 4; k++) {
      const cx = 64 + k * 128, cy = h / 2;
      g.save(); g.translate(cx, cy);
      switch (motif) {
        case 'notes':
          g.beginPath(); g.ellipse(-14, 18, 11, 8, -0.4, 0, 7); g.fill(); g.beginPath(); g.moveTo(-4, 16); g.lineTo(-4, -26); g.lineTo(18, -18); g.lineTo(18, 10); g.stroke();
          g.beginPath(); g.ellipse(8, 12, 11, 8, -0.4, 0, 7); g.fill();
          break;
        case 'gears':
          for (let i = 0; i < 10; i++) { g.rotate(Math.PI / 5); g.fillRect(-5, -30, 10, 10); }
          g.beginPath(); g.arc(0, 0, 22, 0, 7); g.stroke(); g.beginPath(); g.arc(0, 0, 7, 0, 7); g.fill();
          break;
        case 'keys':
          g.beginPath(); g.arc(-22, 0, 12, 0, 7); g.moveTo(-10, 0); g.lineTo(30, 0); g.moveTo(22, 0); g.lineTo(22, 12); g.moveTo(14, 0); g.lineTo(14, 9); g.stroke();
          break;
        case 'compass':
          g.beginPath(); g.moveTo(0, -30); g.lineTo(7, 0); g.lineTo(0, 30); g.lineTo(-7, 0); g.closePath(); g.fill();
          g.beginPath(); g.moveTo(-30, 0); g.lineTo(0, 6); g.lineTo(30, 0); g.lineTo(0, -6); g.closePath(); g.globalAlpha = 0.6; g.fill(); g.globalAlpha = 1;
          g.beginPath(); g.arc(0, 0, 20, 0, 7); g.stroke();
          break;
        case 'letters':
          g.strokeRect(-26, -16, 52, 34); g.beginPath(); g.moveTo(-26, -16); g.lineTo(0, 4); g.lineTo(26, -16); g.stroke();
          break;
        default:
          g.beginPath(); g.moveTo(-28, 0); g.lineTo(0, -26); g.lineTo(28, 0); g.moveTo(-20, -6); g.lineTo(-20, 24); g.lineTo(20, 24); g.lineTo(20, -6); g.stroke();
      }
      g.restore();
      // a small rosette between the motifs
      g.beginPath(); g.arc(cx + 64, cy, 4, 0, 7); g.fill();
    }
  }, [4, 1]);
}
/** A vertical gradient for soft light shafts and halos (white → transparent). */
/** Daylight seen through a window: pale sky over far, soft trees and a garden wall. */
export function daySkyTex() {
  return tex('daysky', 128, 256, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#9cc4ec'); sky.addColorStop(0.55, '#d8ecfa'); sky.addColorStop(0.7, '#f4f1e6');
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.75)';
    for (const [x, y, r] of [[30, 50, 18], [52, 44, 22], [76, 52, 16], [100, 90, 14], [116, 86, 18]]) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
    g.fillStyle = '#8fae7a';
    for (let x = -10; x < w + 10; x += 22) { g.beginPath(); g.arc(x, h * 0.74, 18 + ((x * 7) % 9), 0, 7); g.fill(); }
    g.fillStyle = '#c8b898'; g.fillRect(0, h * 0.8, w, h * 0.2);
  });
}
export function fadeTex() {
  return tex('fade', 64, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    const side = g.createLinearGradient(0, 0, w, 0);
    side.addColorStop(0, 'rgba(0,0,0,1)'); side.addColorStop(0.25, 'rgba(0,0,0,0)'); side.addColorStop(0.75, 'rgba(0,0,0,0)'); side.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = side; g.fillRect(0, 0, w, h);
  });
}
/** A gauge face with ticks. */
export function dialTex(ink = '#2a1a0a', bg = '#f2e6c8') {
  return tex('dial' + ink + bg, 128, 128, (g, w) => {
    g.fillStyle = bg; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 2, 0, 7); g.fill();
    g.strokeStyle = ink; g.lineWidth = 3;
    for (let k = 0; k <= 10; k++) {
      const a = Math.PI * 0.75 + (k / 10) * Math.PI * 1.5;
      g.beginPath(); g.moveTo(w / 2 + Math.cos(a) * 44, w / 2 + Math.sin(a) * 44); g.lineTo(w / 2 + Math.cos(a) * (k % 5 ? 52 : 56), w / 2 + Math.sin(a) * (k % 5 ? 52 : 56)); g.stroke();
    }
    g.strokeStyle = '#a02010'; g.beginPath(); g.arc(w / 2, w / 2, 48, Math.PI * 1.95, Math.PI * 2.25); g.stroke();
  });
}
/** A clock face with roman-like ticks. */
export function clockFaceTex() {
  return tex('clockface', 256, 256, (g, w) => {
    g.fillStyle = '#efe2c0'; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 2, 0, 7); g.fill();
    g.strokeStyle = '#2a1a0a'; g.lineWidth = 4; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 14, 0, 7); g.stroke();
    g.fillStyle = '#2a1a0a'; g.font = 'bold 26px serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let k = 1; k <= 12; k++) { const a = (k / 12) * Math.PI * 2 - Math.PI / 2; g.fillText(String(k), w / 2 + Math.cos(a) * 92, w / 2 + Math.sin(a) * 92); }
  });
}
/** Pencil sketches of buildings (for walls and boards). */
export function sketchTex(variant: number) {
  return tex('sketch' + variant, 384, 288, (g, w, h) => {
    g.fillStyle = '#efe6d2'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(40,40,60,0.75)'; g.lineWidth = 2;
    const bx = 70 + (variant % 3) * 20, by = 90, bw = 230 - (variant % 2) * 40, bh = 140;
    g.strokeRect(bx, by, bw, bh);
    g.beginPath(); g.moveTo(bx - 10, by); g.lineTo(bx + bw / 2, by - 70 + variant * 6); g.lineTo(bx + bw + 10, by); g.stroke();
    for (let k = 0; k < 3; k++) g.strokeRect(bx + 20 + k * (bw / 3), by + 30, 34, 44);
    g.strokeRect(bx + bw / 2 - 18, by + bh - 70, 36, 70);
    g.strokeStyle = 'rgba(40,40,60,0.25)'; g.lineWidth = 1;
    for (let k = 0; k < 14; k++) { g.beginPath(); g.moveTo(rnd() * w, rnd() * h); g.lineTo(rnd() * w, rnd() * h); g.stroke(); }
    g.fillStyle = 'rgba(40,40,60,0.7)'; g.font = '16px serif'; g.fillText('1 : 50', w - 70, h - 18);
  });
}

// ------------------------------------------------------------------------------------------------ primitive helpers

export function bx(parent: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, ry = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
export function cy(parent: THREE.Object3D, rt: number, rb: number, h: number, mat: THREE.Material, x: number, y: number, z: number, seg = 16) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}
export function pl(parent: THREE.Object3D, w: number, h: number, mat: THREE.Material, x: number, y: number, z: number, ry = 0, rx = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, 0);
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
/** A group placed and turned in the room, for building a piece in its own frame. */
export function at(parent: THREE.Object3D, x: number, y: number, z: number, ry = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = ry;
  parent.add(g);
  return g;
}
export function halo(d: Deco, color: string, size: number, x: number, y: number, z: number, opacity = 0.7, parent: THREE.Object3D = d.live) {
  const s = new THREE.Sprite(cm(`halo${color}${opacity}`, () => new THREE.SpriteMaterial({ map: glowSpriteTexture(color), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity })));
  s.scale.set(size, size, 1);
  s.position.set(x, y, z);
  parent.add(s);
  return s;
}

// ------------------------------------------------------------------------------------------------ static batching

/**
 * Merges every plain mesh under the static group into one mesh per material (positions, normals and uvs kept). Sprites,
 * lights, points and instanced meshes are left as they are, so they must not hang under a plain mesh.
 */
export function bake(d: Deco) {
  const root = d.s;
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; cast: boolean }>();
  const done: THREE.Mesh[] = [];
  const rel = new THREE.Matrix4();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || Array.isArray(m.material)) return;
    let geo = m.geometry.clone();
    geo.applyMatrix4(rel.multiplyMatrices(inv, m.matrixWorld));
    if (geo.index) geo = geo.toNonIndexed();
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') geo.deleteAttribute(k);
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2));
    geo.clearGroups();
    const e = groups.get(m.material) ?? { geos: [], cast: false };
    e.geos.push(geo);
    e.cast ||= m.castShadow;
    groups.set(m.material, e);
    done.push(m);
  });
  // keep anything that is not a plain mesh (instanced books, links) by lifting it out before its parent goes
  const keep: THREE.Object3D[] = [];
  root.traverse((o) => { if (o !== root && !(o as THREE.Mesh).isMesh && !(o instanceof THREE.Group)) keep.push(o); if ((o as THREE.InstancedMesh).isInstancedMesh) keep.push(o); });
  for (const k of keep) root.attach(k);
  for (const m of done) { m.removeFromParent(); m.geometry.dispose(); }
  for (const c of [...root.children]) if (c instanceof THREE.Group) c.removeFromParent();
  for (const [mat, e] of groups) {
    const merged = mergeGeometries(e.geos, false);
    e.geos.forEach((g) => g.dispose());
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = e.cast && d.rich;
    mesh.receiveShadow = true;
    root.add(mesh);
  }
}

// ------------------------------------------------------------------------------------------------ architecture

const HW = 8, HD = 7, WALL = 6.5, DOOR = 1.2;

/** The room's floor (the shared shell leaves it to the room), with openings, a border inlay and skirting boards. */
export function floor(d: Deco, mat: THREE.Material, opts: { holes?: [number, number, number, number][]; border?: THREE.Material; skirting?: THREE.Material } = {}) {
  const holes = opts.holes ?? [];
  const xs = [...new Set([-HW, HW, ...holes.flatMap((h) => [h[0], h[1]])])].sort((a, b) => a - b);
  const zs = [...new Set([-HD - 0.05, HD + 0.05, ...holes.flatMap((h) => [h[2], h[3]])])].sort((a, b) => a - b);
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
    const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
    if (holes.some((h) => cx > h[0] && cx < h[1] && cz > h[2] && cz < h[3])) continue;
    const w = xs[i + 1] - xs[i], dd = zs[j + 1] - zs[j];
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, dd), mat);
    // keep the texture continuous across the pieces
    const uv = m.geometry.getAttribute('uv') as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, (xs[i] + uv.getX(k) * w + HW) / (HW * 2), (zs[j] + (1 - uv.getY(k)) * dd + HD) / (HD * 2));
    m.rotation.x = -Math.PI / 2;
    m.position.set(cx, 0, cz);
    m.receiveShadow = true;
    d.s.add(m);
  }
  if (opts.border) {
    const b = opts.border, k = 0.55;
    for (const sz of [-1, 1]) pl(d.s, HW * 2 - k * 2, 0.14, b, 0, 0.004, sz * (HD - k), 0, -Math.PI / 2);
    for (const sx of [-1, 1]) pl(d.s, 0.14, HD * 2 - k * 2, b, sx * (HW - k), 0.004, 0, 0, -Math.PI / 2);
  }
  const sk = opts.skirting ?? W('#2a1a0e');
  for (const sx of [-1, 1]) bx(d.s, 0.05, 0.18, HD * 2, sk, sx * (HW - 0.06), 0.09, 0);
  for (const sz of [-1, 1]) for (const [x0, x1] of [[-HW, -DOOR - 0.6], [DOOR + 0.6, HW]]) bx(d.s, x1 - x0, 0.18, 0.05, sk, (x0 + x1) / 2, 0.09, sz * (HD - 0.06));
}

/** The walls above the cornice up to the ceiling: a frieze band, a panelled upper wall and a crown moulding. */
export function upperWalls(d: Deco, wall: THREE.Material, frieze: THREE.Material | null, crown: THREE.Material) {
  const y0 = 5.2, h = WALL - y0;
  for (const sx of [-1, 1]) {
    pl(d.s, HD * 2, h, wall, sx * (HW - 0.03), y0 + h / 2, 0, -sx * Math.PI / 2);
    if (frieze) pl(d.s, HD * 2, 0.42, frieze, sx * (HW - 0.05), 5.55, 0, -sx * Math.PI / 2);
    bx(d.s, 0.24, 0.16, HD * 2, crown, sx * (HW - 0.12), WALL - 0.1, 0);
    bx(d.s, 0.12, 0.08, HD * 2, crown, sx * (HW - 0.08), 5.85, 0);
  }
  for (const sz of [-1, 1]) {
    pl(d.s, HW * 2, h, wall, 0, y0 + h / 2, sz * (HD - 0.03), sz > 0 ? Math.PI : 0);
    if (frieze) pl(d.s, HW * 2, 0.42, frieze, 0, 5.55, sz * (HD - 0.05), sz > 0 ? Math.PI : 0);
    bx(d.s, HW * 2, 0.16, 0.24, crown, 0, WALL - 0.1, sz * (HD - 0.12));
    bx(d.s, HW * 2, 0.08, 0.12, crown, 0, 5.85, sz * (HD - 0.08));
  }
}

/** A coffered ceiling: cross beams over the shell's long beams, recessed panels and a rosette for each lamp. */
export function ceiling(d: Deco, panel: THREE.Material, beam: THREE.Material, rosettes: [number, number][] = []) {
  pl(d.s, HW * 2, HD * 2, panel, 0, WALL - 0.04, 0, 0, Math.PI / 2);
  for (const z of [-4.67, -2.33, 0, 2.33, 4.67]) bx(d.s, HW * 2, 0.26, 0.22, beam, 0, WALL - 0.17, z);
  for (const x of [-6, -2, 2, 6]) bx(d.s, 0.16, 0.18, HD * 2, beam, x, WALL - 0.13, 0);
  for (const [x, z] of rosettes) {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.08, 24), beam);
    r.position.set(x, WALL - 0.3, z);
    d.s.add(r);
  }
}

/** Pilasters along the side walls (z positions), with a base and a capital. */
export function pilasters(d: Deco, zs: number[], mat: THREE.Material, cap: THREE.Material, top = 5.2, sides: number[] = [-1, 1]) {
  for (const sx of sides) for (const z of zs) {
    const x = sx * (HW - 0.12);
    bx(d.s, 0.24, 0.34, 0.6, cap, x, 0.17, z);
    bx(d.s, 0.18, top - 0.6, 0.44, mat, x, top / 2, z);
    for (const dz of [-0.12, 0, 0.12]) bx(d.s, 0.04, top - 0.9, 0.04, cap, x - sx * 0.1, top / 2, z + dz);
    bx(d.s, 0.26, 0.2, 0.62, cap, x, top - 0.25, z);
    bx(d.s, 0.3, 0.08, 0.7, cap, x, top - 0.11, z);
  }
}

/** A casing around a doorway in the back (−1) or front (+1) wall: columns, an entablature and a keystone. */
export function doorCasing(d: Deco, side: -1 | 1, mat: THREE.Material, trim: THREE.Material) {
  const z = side * (HD - 0.16);
  for (const sx of [-1, 1]) {
    bx(d.s, 0.42, 0.4, 0.34, trim, sx * 1.72, 0.2, z);
    cy(d.s, 0.14, 0.16, 3.3, mat, sx * 1.72, 2.05, z, 18);
    bx(d.s, 0.42, 0.22, 0.34, trim, sx * 1.72, 3.8, z);
  }
  bx(d.s, 4.0, 0.34, 0.36, mat, 0, 4.08, z);
  bx(d.s, 4.3, 0.1, 0.44, trim, 0, 4.3, z);
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.0, 0.3, 3, 1, false, -Math.PI / 2, Math.PI), mat);
  ped.rotation.set(Math.PI / 2, 0, 0);
  ped.scale.set(1, 1, 0.28);
  ped.position.set(0, 4.35, z);
  d.s.add(ped);
  bx(d.s, 0.3, 0.4, 0.4, trim, 0, 4.2, z + side * -0.03);
}

/** A curtain hung from a rod at the top centre (x, top y, z), pleated, swaying gently. */
export function curtain(d: Deco, x: number, top: number, z: number, ry: number, w: number, h: number, color: string, open = 0) {
  const pivot = at(d.live, x, top, z, ry);
  const geo = new THREE.PlaneGeometry(w, h, 28, 6);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let k = 0; k < pos.count; k++) {
    const px = pos.getX(k), py = pos.getY(k);
    const gather = 1 - open * (0.5 - py / h) * 0.6;
    pos.setX(k, px * gather);
    pos.setZ(k, Math.sin((px / w) * Math.PI * 9) * 0.07 + Math.sin((px / w) * 23) * 0.015);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, cm('curt' + color, () => std('#ffffff', { map: curtainTex(color), roughness: 0.9, side: THREE.DoubleSide })));
  m.position.y = -h / 2;
  m.castShadow = true;
  pivot.add(m);
  const ph = rnd() * 6;
  d.anim.push((t) => { pivot.rotation.x = Math.sin(t * 0.6 + ph) * 0.012; m.scale.x = 1 + Math.sin(t * 0.45 + ph) * 0.012; });
  return pivot;
}

/** A deep window on a side wall (side −1 = left, +1 = right): frame, mullions, sill, sky, curtains and a soft shaft. */
export function windowBay(d: Deco, side: -1 | 1, z: number, w: number, h: number, y0: number, o: { frame: THREE.Material; curtain: string; sky?: string; shaft?: string; arch?: boolean; day?: boolean }) {
  const x = side * (HW - 0.02), inward = -side;
  const g = at(d.s, x, 0, z);
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(w, h), cm('sky' + (o.sky ?? '') + (o.day ? 'day' : ''), () => new THREE.MeshBasicMaterial({ map: o.day ? daySkyTex() : windowTexture(), color: o.sky ?? '#ffffff', toneMapped: false })));
  sky.rotation.y = inward > 0 ? Math.PI / 2 : -Math.PI / 2;
  sky.position.set(inward * 0.03, y0 + h / 2, 0);
  d.live.add(sky);
  sky.position.add(g.position);
  const depth = 0.42;
  for (const dz of [-1, 1]) bx(g, depth, h + 0.3, 0.16, o.frame, inward * depth / 2, y0 + h / 2, dz * (w / 2 + 0.08));
  bx(g, depth, 0.16, w + 0.32, o.frame, inward * depth / 2, y0 + h + 0.08, 0);
  bx(g, depth + 0.18, 0.1, w + 0.5, o.frame, inward * (depth + 0.18) / 2, y0 - 0.05, 0);
  bx(g, 0.12, 0.3, w + 0.3, o.frame, inward * 0.35, y0 - 0.22, 0);
  for (const k of [-1, 0, 1]) bx(g, 0.06, h, 0.05, o.frame, inward * 0.06, y0 + h / 2, k * w / 3);
  for (const k of [1, 2, 3]) bx(g, 0.06, 0.05, w, o.frame, inward * 0.06, y0 + (k * h) / 4, 0);
  if (o.arch) {
    const a = new THREE.Mesh(new THREE.TorusGeometry(w / 2 + 0.08, 0.09, 8, 24, Math.PI), o.frame);
    a.rotation.y = Math.PI / 2;
    a.position.set(inward * 0.1, y0 + h, 0);
    g.add(a);
  }
  // pelmet and curtains
  bx(g, 0.3, 0.36, w + 1.4, o.frame, inward * 0.3, y0 + h + 0.5, 0);
  for (const dz of [-1, 1]) curtain(d, x + inward * 0.32, y0 + h + 0.4, z + dz * (w / 2 + 0.35), inward > 0 ? Math.PI / 2 : -Math.PI / 2, 0.9, h + 0.9, o.curtain, 0.6);
  if (d.rich && o.shaft) shaft(d, x + inward * 0.05, y0 + h * 0.6, z, inward, w * 0.8, o.shaft);
}

/** A soft, additive slanting light shaft from a window towards the floor (never grey: it only adds light). */
export function shaft(d: Deco, x: number, y: number, z: number, inward: number, width: number, color: string) {
  const mat = cm('shaft' + color, () => new THREE.MeshBasicMaterial({ map: fadeTex(), color, transparent: true, opacity: 0.085, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  const len = 4.6;
  const g = at(d.live, x, y, z);
  for (const k of [0, 1, 2]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(width * (0.8 + k * 0.15), len), mat);
    p.position.set(inward * len * 0.42, -len * 0.28, (k - 1) * 0.12);
    p.rotation.set(0, (k - 1) * 0.14, inward * -1.05);
    g.add(p);
  }
  dust(d, x + inward * 0.4, x + inward * 3.6, 0.3, y + 0.4, z - width / 2, z + width / 2, 60, color);
}

/** Dust motes drifting in light (additive points). */
export function dust(d: Deco, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, n: number, color = '#fff0d0') {
  if (!d.rich) return;
  const pos = new Float32Array(n * 3);
  const lo = [Math.min(x0, x1), y0, Math.min(z0, z1)], hi = [Math.max(x0, x1), y1, Math.max(z0, z1)];
  for (let k = 0; k < n; k++) for (let a = 0; a < 3; a++) pos[k * 3 + a] = lo[a] + rnd() * (hi[a] - lo[a]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, cm('dust' + color, () => new THREE.PointsMaterial({ map: glowSpriteTexture(color), size: 0.06, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })));
  d.live.add(pts);
  const attr = geo.getAttribute('position') as THREE.BufferAttribute;
  d.anim.push((t, dt) => {
    for (let k = 0; k < n; k++) {
      let y = attr.getY(k) + dt * (0.03 + (k % 5) * 0.008);
      if (y > hi[1]) y = lo[1];
      attr.setY(k, y);
      attr.setX(k, attr.getX(k) + Math.sin(t * 0.3 + k) * dt * 0.02);
    }
    attr.needsUpdate = true;
  });
}

/** A rug with a border pattern and fringes. */
export function rug(d: Deco, x: number, z: number, w: number, dd: number, base: string, accent: string, seedN: number, ry = 0) {
  const g = at(d.s, x, 0, z, ry);
  pl(g, w, dd, TEXM(`rug${base}${accent}${seedN}`, () => rugTexture(base, accent, seedN), 0.95), 0, 0.012, 0, 0, -Math.PI / 2);
  for (const sz of [-1, 1]) bx(g, w, 0.01, 0.08, S('#e8dcc0', 1), 0, 0.012, sz * (dd / 2 + 0.04));
}

// ------------------------------------------------------------------------------------------------ furniture

const BOOK_GEO = new THREE.BoxGeometry(1, 1, 1);
const BOOK_COLORS = ['#6a1a14', '#1e3a5a', '#2e4a26', '#5a3a14', '#3a1e3e', '#7a5a22', '#20302e', '#4a2a10', '#8a6a3a', '#2a2a40'];

/** Books standing on a shelf (one instanced mesh per call). */
export function bookRow(d: Deco, parent: THREE.Object3D, x0: number, x1: number, y: number, z: number, depth = 0.22, palette = BOOK_COLORS, maxH = 0.34) {
  const geo = BOOK_GEO;
  const n = Math.max(1, Math.floor((x1 - x0) / 0.05));
  const mesh = new THREE.InstancedMesh(geo, cm('bookmat', () => std('#ffffff', { roughness: 0.75 })), n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  let x = x0, i = 0;
  while (i < n && x < x1 - 0.03) {
    const bw = 0.025 + rnd() * 0.045, bh = maxH * (0.62 + rnd() * 0.38);
    if (rnd() < 0.08 && x + 0.2 < x1) { x += 0.08 + rnd() * 0.1; continue; }
    const lean = rnd() < 0.06 ? 0.25 : 0;
    q.setFromEuler(new THREE.Euler(0, 0, lean));
    p.set(x + bw / 2 + lean * bh * 0.5, y + bh / 2, z);
    s.set(bw, bh, depth * (0.8 + rnd() * 0.2));
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.set(palette[Math.floor(rnd() * palette.length)]).multiplyScalar(0.7 + rnd() * 0.5));
    x += bw + 0.004 + lean * bh * 0.6;
    i++;
  }
  mesh.count = i;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** A tall bookcase or open shelving: carcass, crown, plinth and shelves, with books or a filler per shelf. */
export function bookcase(d: Deco, x: number, z: number, ry: number, w: number, h: number, o: { tone?: string; dep?: number; shelves?: number; fill?: (shelf: THREE.Group, k: number, w: number, y: number) => void; books?: boolean; palette?: string[] } = {}) {
  const tone = o.tone ?? '#4a2c18', dep = o.dep ?? 0.42, n = o.shelves ?? Math.max(3, Math.round((h - 0.5) / 0.45));
  const g = at(d.s, x, 0, z, ry);
  const wm = W(tone, [1, 2]), dark = W(shade(tone, 0.6));
  bx(g, w, h, 0.03, dark, 0, h / 2, -dep / 2 + 0.015);
  for (const sx of [-1, 1]) bx(g, 0.06, h, dep, wm, sx * (w / 2 - 0.03), h / 2, 0);
  bx(g, w + 0.12, 0.12, dep + 0.08, wm, 0, h + 0.06, 0.02);
  bx(g, w + 0.18, 0.05, dep + 0.12, wm, 0, h + 0.14, 0.03);
  bx(g, w, 0.14, dep, dark, 0, 0.07, 0);
  const step = (h - 0.2) / n;
  for (let k = 0; k <= n; k++) bx(g, w - 0.1, 0.035, dep - 0.02, wm, 0, 0.15 + k * step, 0);
  for (let k = 0; k < n; k++) {
    const y = 0.17 + k * step;
    if (o.fill) o.fill(g, k, w, y);
    else if (o.books !== false) bookRow(d, g, -w / 2 + 0.07, w / 2 - 0.07, y, 0.02, dep * 0.7, o.palette, Math.min(0.36, step - 0.06));
  }
  return g;
}

/** A cabinet of drawers (rows × cols) with brass pulls and a top. */
export function drawers(d: Deco, x: number, z: number, ry: number, w: number, h: number, dep: number, rows: number, cols: number, tone = '#4a2c18', pull = BRASS()) {
  const g = at(d.s, x, 0, z, ry);
  const wm = W(tone), fr = W(shade(tone, 1.25));
  bx(g, w, h, dep, wm, 0, h / 2 + 0.08, 0);
  bx(g, w + 0.08, 0.05, dep + 0.06, fr, 0, h + 0.1, 0.02);
  bx(g, w - 0.04, 0.08, dep - 0.04, W(shade(tone, 0.6)), 0, 0.04, 0);
  const cw = (w - 0.08) / cols, rh = (h - 0.08) / rows;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const cx = -w / 2 + 0.04 + cw * (c + 0.5), cyy = 0.12 + rh * (r + 0.5);
    bx(g, cw - 0.03, rh - 0.03, 0.02, fr, cx, cyy, dep / 2 + 0.01);
    bx(g, Math.min(0.12, cw * 0.4), 0.02, 0.03, pull, cx, cyy, dep / 2 + 0.035);
  }
  return g;
}

/** A plain table (top, apron, square legs). */
export function deskTable(d: Deco, x: number, z: number, ry: number, w: number, dep: number, h: number, tone = '#4a2c18', turned = true) {
  const g = at(d.s, x, 0, z, ry);
  bx(g, w, 0.06, dep, W(tone, [w / 2, 1]), 0, h - 0.03, 0);
  bx(g, w - 0.14, 0.12, dep - 0.14, W(shade(tone, 0.8)), 0, h - 0.12, 0);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    if (turned) cy(g, 0.045, 0.03, h - 0.06, W(shade(tone, 0.8)), sx * (w / 2 - 0.1), (h - 0.06) / 2, sz * (dep / 2 - 0.1), 10);
    else bx(g, 0.07, h - 0.06, 0.07, W(shade(tone, 0.8)), sx * (w / 2 - 0.08), (h - 0.06) / 2, sz * (dep / 2 - 0.08));
  }
  return g;
}

/** A chair with a carved back, facing +z when ry = 0. */
export function chair(d: Deco, x: number, z: number, ry: number, tone = '#4a2c18', seat = '#6a1a1a') {
  const g = at(d.s, x, 0, z, ry);
  const wm = W(tone);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) bx(g, 0.05, 0.46, 0.05, wm, sx * 0.2, 0.23, sz * 0.2);
  bx(g, 0.48, 0.07, 0.48, S(seat, 0.9), 0, 0.49, 0);
  for (const sx of [-1, 1]) bx(g, 0.05, 0.62, 0.05, wm, sx * 0.2, 0.83, -0.22);
  bx(g, 0.46, 0.12, 0.04, wm, 0, 1.08, -0.22);
  bx(g, 0.3, 0.36, 0.03, wm, 0, 0.78, -0.22);
  return g;
}

/** A deep armchair with rolled arms (faces +z at ry = 0). */
export function armchair(d: Deco, x: number, z: number, ry: number, fabric: string, tone = '#3a2010') {
  const g = at(d.s, x, 0, z, ry);
  const f = S(fabric, 0.95), wm = W(tone);
  bx(g, 0.86, 0.32, 0.8, f, 0, 0.34, 0);
  bx(g, 0.86, 0.6, 0.18, f, 0, 0.78, -0.33);
  for (const sx of [-1, 1]) {
    bx(g, 0.16, 0.36, 0.8, f, sx * 0.43, 0.56, 0);
    const roll = cy(g, 0.1, 0.1, 0.8, f, sx * 0.43, 0.74, 0, 12);
    roll.rotation.x = Math.PI / 2;
  }
  bx(g, 0.66, 0.1, 0.62, S(shade(fabric, 1.15), 0.95), 0, 0.53, 0.05);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) cy(g, 0.035, 0.025, 0.18, wm, sx * 0.36, 0.09, sz * 0.32, 8);
  return g;
}

export function crate(d: Deco, x: number, y: number, z: number, s = 0.6, ry = 0, tone = '#7a5a34') {
  const g = at(d.s, x, y, z, ry);
  bx(g, s, s, s, W(tone, [1, 1]), 0, s / 2, 0);
  const strip = W(shade(tone, 0.7));
  for (const sz of [-1, 1]) {
    bx(g, s + 0.02, 0.06, 0.02, strip, 0, 0.06, sz * (s / 2 + 0.01));
    bx(g, s + 0.02, 0.06, 0.02, strip, 0, s - 0.06, sz * (s / 2 + 0.01));
    const diag = bx(g, s * 1.25, 0.06, 0.02, strip, 0, s / 2, sz * (s / 2 + 0.012));
    diag.rotation.z = Math.PI / 4;
  }
  return g;
}

export function barrel(d: Deco, x: number, z: number, h = 0.9, tone = '#6a4424') {
  const pts: THREE.Vector2[] = [];
  for (let k = 0; k <= 10; k++) { const y = (k / 10) * h; pts.push(new THREE.Vector2(0.3 + Math.sin((k / 10) * Math.PI) * 0.06, y)); }
  const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 20), W(tone, [3, 1]));
  m.position.set(x, 0, z);
  m.castShadow = true;
  d.s.add(m);
  for (const y of [0.12, h / 2, h - 0.12]) {
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.3 + Math.sin((y / h) * Math.PI) * 0.06 + 0.005, 0.012, 6, 28), DARKIRON());
    hoop.rotation.x = Math.PI / 2;
    hoop.position.set(x, y, z);
    d.s.add(hoop);
  }
  cy(d.s, 0.3, 0.3, 0.02, W(shade(tone, 0.8)), x, h - 0.02, z, 20);
}

// ------------------------------------------------------------------------------------------------ lamps

/** A brass chandelier of candle bulbs; one pooled light when `light` is given. */
export function chandelier(d: Deco, x: number, y: number, z: number, arms = 8, r = 0.7, light = 0, color = '#ffc88a') {
  const g = at(d.live, x, y, z);
  const b = BRASS();
  cy(g, 0.015, 0.015, 6.5 - y, b, 0, (6.5 - y) / 2, 0, 6);
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), b);
  g.add(body);
  cy(g, 0.05, 0.12, 0.3, b, 0, -0.2, 0, 12);
  for (const rr of [r, r * 0.55]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.02, 8, 36), b);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = rr === r ? -0.1 : 0.15;
    g.add(ring);
  }
  const flames: THREE.Sprite[] = [];
  for (let k = 0; k < arms; k++) {
    const a = (k / arms) * Math.PI * 2;
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    cy(g, 0.03, 0.04, 0.05, b, cx, -0.07, cz, 8);
    cy(g, 0.016, 0.016, 0.14, EMIT('#fff3dc'), cx, 0.03, cz, 6);
    flames.push(halo(d, color, 0.32, cx, 0.16, cz, 0.85, g));
  }
  halo(d, color, r * 3.4, 0, 0, 0, 0.18, g);
  d.anim.push((t) => flames.forEach((f, k) => f.scale.set(0.28 + Math.sin(t * 11 + k) * 0.03, 0.36 + Math.sin(t * 15 + k * 2) * 0.05, 1)));
  if (light) d.ctx.addLight(x, y - 0.3, z, color, light, 9);
  return g;
}

/** An industrial pendant (enamel cone) or a glass globe, hanging from the ceiling. */
export function pendant(d: Deco, x: number, y: number, z: number, kind: 'cone' | 'globe' | 'lantern' = 'cone', color = '#ffd8a0', light = 0, shadeColor = '#2e3a2e') {
  const g = at(d.live, x, y, z);
  cy(g, 0.01, 0.01, 6.5 - y, DARKIRON(), 0, (6.5 - y) / 2, 0, 6);
  if (kind === 'cone') {
    const sh = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.26, 24, 1, true), cm('shade' + shadeColor, () => std(shadeColor, { metalness: 0.5, roughness: 0.4, side: THREE.DoubleSide })));
    sh.position.y = -0.1;
    g.add(sh);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), EMIT('#fff2cc'));
    bulb.position.y = -0.2;
    g.add(bulb);
    halo(d, color, 0.9, 0, -0.25, 0, 0.55, g);
  } else if (kind === 'globe') {
    const glb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 14), cm('globeglass' + color, () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, toneMapped: false })));
    glb.position.y = -0.2;
    g.add(glb);
    cy(g, 0.06, 0.08, 0.08, BRASS(), 0, -0.02, 0, 12);
    halo(d, color, 1.1, 0, -0.2, 0, 0.5, g);
  } else {
    const frame = DARKIRON();
    cy(g, 0.14, 0.18, 0.06, frame, 0, -0.05, 0, 6);
    cy(g, 0.18, 0.14, 0.06, frame, 0, -0.5, 0, 6);
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; cy(g, 0.012, 0.012, 0.44, frame, Math.cos(a) * 0.16, -0.27, Math.sin(a) * 0.16, 4); }
    const glassy = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.4, 6), cm('lanternglass', () => new THREE.MeshBasicMaterial({ color: '#ffcf8a', transparent: true, opacity: 0.35, toneMapped: false })));
    glassy.position.y = -0.27;
    g.add(glassy);
    const fl = halo(d, color, 0.5, 0, -0.3, 0, 0.9, g);
    d.anim.push((t) => fl.scale.setScalar(0.45 + Math.sin(t * 9 + x) * 0.04));
  }
  if (light) d.ctx.addLight(x, y - 0.4, z, color, light, 7);
  return g;
}

/** A wall sconce (two candle bulbs on a brass plate); faces away from the wall it is on. */
export function sconce(d: Deco, x: number, y: number, z: number, ry: number, color = '#ffc88a') {
  const g = at(d.live, x, y, z, ry);
  bx(g, 0.18, 0.32, 0.03, BRASS(), 0, 0, 0);
  for (const sx of [-1, 1]) {
    const arm = cy(g, 0.012, 0.012, 0.26, BRASS(), sx * 0.1, 0.02, 0.1, 6);
    arm.rotation.x = Math.PI / 2;
    cy(g, 0.035, 0.025, 0.04, BRASS(), sx * 0.1, 0.06, 0.2, 10);
    cy(g, 0.014, 0.014, 0.1, EMIT('#fff3dc'), sx * 0.1, 0.13, 0.2, 6);
    halo(d, color, 0.3, sx * 0.1, 0.22, 0.2, 0.85, g);
  }
  halo(d, color, 1.2, 0, 0.15, 0.15, 0.2, g);
  return g;
}

/** A desk lamp with a coloured glass shade (banker's green, amber...). */
export function deskLamp(d: Deco, x: number, y: number, z: number, ry = 0, shadeColor = '#1e6a3a', light = 0) {
  const g = at(d.live, x, y, z, ry);
  cy(g, 0.09, 0.11, 0.03, BRASS(), 0, 0.015, 0, 16);
  cy(g, 0.012, 0.012, 0.34, BRASS(), 0, 0.18, 0, 8);
  const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.16, 0.12, 20, 1, true), cm('lampshade' + shadeColor, () => std(shadeColor, { emissive: shadeColor, emissiveIntensity: 0.5, roughness: 0.3, side: THREE.DoubleSide })));
  sh.position.y = 0.36;
  g.add(sh);
  halo(d, '#fff0c8', 0.45, 0, 0.3, 0, 0.7, g);
  if (light) d.ctx.addLight(x, y + 0.3, z, '#ffe2b0', light, 3.5, false);
  return g;
}

/** A floor lamp with a fabric shade. */
export function floorLamp(d: Deco, x: number, z: number, shadeColor = '#e8c898') {
  const g = at(d.live, x, 0, z);
  cy(g, 0.16, 0.2, 0.04, BRASS(), 0, 0.02, 0, 16);
  cy(g, 0.018, 0.018, 1.6, BRASS(), 0, 0.82, 0, 8);
  const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 0.32, 20, 1, true), cm('fshade' + shadeColor, () => std(shadeColor, { emissive: shadeColor, emissiveIntensity: 0.45, side: THREE.DoubleSide, roughness: 0.9 })));
  sh.position.y = 1.62;
  g.add(sh);
  halo(d, '#ffd9a0', 1.0, 0, 1.55, 0, 0.45, g);
  return g;
}

/** A candlestick with a flickering flame. */
export function candlestick(d: Deco, x: number, y: number, z: number, h = 0.2) {
  cy(d.s, 0.06, 0.07, 0.02, BRASS(), x, y + 0.01, z, 12);
  cy(d.s, 0.015, 0.02, 0.12, BRASS(), x, y + 0.07, z, 8);
  cy(d.s, 0.03, 0.03, h, S('#f0e6cc', 0.6), x, y + 0.13 + h / 2, z, 10);
  const f = halo(d, '#ffb84d', 0.26, x, y + 0.2 + h, z, 0.9);
  d.anim.push((t) => f.scale.set(0.22 + Math.sin(t * 13 + x * 5) * 0.03, 0.32 + Math.sin(t * 17 + z) * 0.05, 1));
}

// ------------------------------------------------------------------------------------------------ clutter

export function bookStack(d: Deco, x: number, y: number, z: number, n = 4, ry = 0) {
  let yy = y;
  for (let k = 0; k < n; k++) {
    const h = 0.04 + rnd() * 0.03;
    const b = bx(d.s, 0.22 + rnd() * 0.08, h, 0.16 + rnd() * 0.05, S(BOOK_COLORS[Math.floor(rnd() * BOOK_COLORS.length)], 0.8), x, yy + h / 2, z, ry + (rnd() - 0.5) * 0.4);
    b.castShadow = false;
    yy += h;
  }
  return yy;
}
export function papers(d: Deco, x: number, y: number, z: number, n = 3, spread = 0.25) {
  for (let k = 0; k < n; k++) {
    const p = pl(d.s, 0.21, 0.29, TEXM('paper' + (k % 3), () => paperTex([], { w: 256, h: 340 }), 0.95), x + (rnd() - 0.5) * spread, y + 0.002 + k * 0.001, z + (rnd() - 0.5) * spread, 0, -Math.PI / 2);
    p.rotation.z = (rnd() - 0.5) * 1.2;
  }
}
export function inkwell(d: Deco, x: number, y: number, z: number) {
  cy(d.s, 0.04, 0.05, 0.06, cm('ink', () => std('#101828', { metalness: 0.3, roughness: 0.1 })), x, y + 0.03, z, 12);
  cy(d.s, 0.02, 0.02, 0.02, BRASS(), x, y + 0.07, z, 8);
  const q = cy(d.s, 0.004, 0.012, 0.3, S('#f4efe4', 0.9), x + 0.03, y + 0.17, z, 6);
  q.rotation.z = -0.35;
}
export function scrolls(d: Deco, x: number, y: number, z: number, n = 3, ry = 0) {
  const g = at(d.s, x, y, z, ry);
  for (let k = 0; k < n; k++) {
    const r = cy(g, 0.04, 0.04, 0.5 + rnd() * 0.2, S(k % 2 ? '#e8dcc0' : '#d8e4f0', 0.9), (k - n / 2) * 0.09, 0.04 + (k % 2) * 0.06, 0, 10);
    r.rotation.z = Math.PI / 2;
  }
}
export function bottles(d: Deco, x: number, y: number, z: number, n = 3) {
  const cols = ['#2a4a2a', '#4a2a1a', '#1a2a4a', '#6a4a1a'];
  for (let k = 0; k < n; k++) {
    const m = cm('bottle' + k % 4, () => std(cols[k % 4], { roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.85 }));
    const h = 0.16 + rnd() * 0.1;
    cy(d.s, 0.04, 0.045, h, m, x + k * 0.1, y + h / 2, z + (rnd() - 0.5) * 0.06, 12);
    cy(d.s, 0.012, 0.016, 0.07, m, x + k * 0.1, y + h + 0.035, z, 8);
  }
}
export function globe(d: Deco, x: number, z: number, h = 1.0) {
  const g = at(d.live, x, 0, z);
  for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2; const leg = cy(g, 0.025, 0.02, h * 0.62, W('#3a2010'), Math.cos(a) * 0.18, h * 0.3, Math.sin(a) * 0.18, 8); leg.rotation.set(Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25); }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.015, 8, 36), BRASS());
  ring.position.y = h * 0.62 + 0.3;
  ring.rotation.y = 0.4;
  g.add(ring);
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.27, 28, 20), TEXM('globe', () => paintingTexture(41), 0.7));
  sphere.position.y = ring.position.y;
  sphere.rotation.z = 0.4;
  g.add(sphere);
  d.anim.push((_t, dt) => (sphere.rotation.y += dt * 0.15));
}
/** Hanging keys on a board (on a wall; faces away from it). */
export function keyBoard(d: Deco, x: number, y: number, z: number, ry: number, n = 9) {
  const g = at(d.s, x, y, z, ry);
  bx(g, 1.1, 0.6, 0.04, W('#3a2414'), 0, 0, 0);
  for (let k = 0; k < n; k++) {
    const kx = -0.45 + (k % 5) * 0.22, ky = k < 5 ? 0.12 : -0.14;
    cy(g, 0.01, 0.01, 0.05, BRASS(), kx, ky + 0.08, 0.04, 6).rotation.x = Math.PI / 2;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.007, 6, 14), k % 3 ? IRON() : BRASS());
    ring.position.set(kx, ky + 0.04, 0.05);
    g.add(ring);
    bx(g, 0.012, 0.12, 0.008, k % 3 ? IRON() : BRASS(), kx, ky - 0.04, 0.05);
    bx(g, 0.03, 0.012, 0.008, k % 3 ? IRON() : BRASS(), kx + 0.015, ky - 0.08, 0.05);
  }
}
/** A pegboard of tools (on a wall; faces away from it). */
export function toolWall(d: Deco, x: number, y: number, z: number, ry: number, w = 1.8) {
  const g = at(d.s, x, y, z, ry);
  bx(g, w, 1.0, 0.04, W('#8a6a44'), 0, 0, 0);
  const tool = (tx: number, kind: number) => {
    if (kind === 0) { bx(g, 0.04, 0.34, 0.03, W('#6a4424'), tx, -0.05, 0.04); bx(g, 0.16, 0.06, 0.05, IRON(), tx, 0.14, 0.04); }
    else if (kind === 1) { bx(g, 0.05, 0.36, 0.015, IRON(), tx, -0.02, 0.035); const r = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.016, 6, 12, Math.PI * 1.5), IRON()); r.position.set(tx, 0.18, 0.04); g.add(r); }
    else if (kind === 2) { bx(g, 0.3, 0.12, 0.01, cm('sawblade', () => std('#9aa0a8', { metalness: 0.9, roughness: 0.3 })), tx, 0.05, 0.035); bx(g, 0.1, 0.1, 0.03, W('#6a3a1a'), tx + 0.18, 0.05, 0.04); }
    else { cy(g, 0.015, 0.015, 0.3, IRON(), tx, 0, 0.04, 6); bx(g, 0.05, 0.1, 0.04, S('#8a2a1a', 0.6), tx, -0.18, 0.04); }
  };
  const n = Math.floor(w / 0.3);
  for (let k = 0; k < n; k++) tool(-w / 2 + 0.2 + k * 0.3, k % 4);
}
/** A framed painting (gilded), on a wall: faces +z of its own frame. */
export function painting(d: Deco, x: number, y: number, z: number, ry: number, w: number, h: number, seedN: number, frame: THREE.Material = GOLD()) {
  const g = at(d.s, x, y, z, ry);
  for (const sy of [-1, 1]) bx(g, w + 0.16, 0.08, 0.07, frame, 0, sy * (h / 2 + 0.04), 0.02);
  for (const sx of [-1, 1]) bx(g, 0.08, h, 0.07, frame, sx * (w / 2 + 0.04), 0, 0.02);
  pl(g, w, h, TEXM('paint' + seedN, () => paintingTexture(seedN), 0.8), 0, 0, 0.012);
  return g;
}
/** A pinned sheet (sketch, plan, note) on a wall or board. */
export function pinned(d: Deco, x: number, y: number, z: number, ry: number, w: number, h: number, map: () => THREE.Texture, key: string) {
  const g = at(d.s, x, y, z, ry);
  pl(g, w, h, TEXM(key, map, 0.9), 0, 0, 0.01);
  for (const sx of [-1, 1]) cy(g, 0.012, 0.012, 0.02, S('#a02010', 0.5), sx * (w / 2 - 0.04), h / 2 - 0.04, 0.02, 6).rotation.x = Math.PI / 2;
}
/** A wall clock with moving hands (real time). */
export function wallClock(d: Deco, x: number, y: number, z: number, ry: number, r = 0.32) {
  const g = at(d.live, x, y, z, ry);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.04, 10, 40), BRASS());
  g.add(rim);
  cy(g, r, r, 0.05, W('#3a2010'), 0, 0, -0.03, 32).rotation.x = Math.PI / 2;
  const face = pl(g, r * 1.9, r * 1.9, cm('clockface', () => new THREE.MeshStandardMaterial({ map: clockFaceTex(), transparent: true, roughness: 0.6 })), 0, 0, 0.01);
  face.receiveShadow = false;
  const hand = (len: number, wd: number) => { const p = at(g, 0, 0, 0.03); bx(p, wd, len, 0.01, DARKIRON(), 0, len / 2, 0); return p; };
  const hr = hand(r * 0.5, 0.025), mn = hand(r * 0.78, 0.016);
  d.anim.push(() => { const now = new Date(); const m = now.getMinutes() + now.getSeconds() / 60; mn.rotation.z = -(m / 60) * Math.PI * 2; hr.rotation.z = -(((now.getHours() % 12) + m / 60) / 12) * Math.PI * 2; });
}

// ------------------------------------------------------------------------------------------------ mechanics

/** A gear on a wall (or anywhere), turning at `speed` rad/s about its own axis (faces +z of its frame). */
export function gear(d: Deco, x: number, y: number, z: number, ry: number, r: number, teeth: number, speed: number, mat: THREE.Material = IRON(), depth = 0.08) {
  const g = at(d.live, x, y, z, ry);
  const m = new THREE.Mesh(gearGeometry(r, teeth, depth), mat);
  m.castShadow = true;
  g.add(m);
  const hub = cy(g, r * 0.2, r * 0.2, depth * 2.2, BRASS(), 0, 0, 0, 16);
  hub.rotation.x = Math.PI / 2;
  if (r > 0.4) for (let k = 0; k < 5; k++) { const sp = bx(m, r * 0.12, r * 1.4, depth * 0.8, mat, 0, 0, 0); sp.rotation.z = (k / 5) * Math.PI; }
  d.anim.push((_t, dt) => (m.rotation.z += dt * speed));
  return m;
}
/** A run of pipe through the given points, with round elbows and flanges. */
export function pipe(d: Deco, pts: [number, number, number][], r: number, mat: THREE.Material = COPPER(), flanges = true) {
  const a = new THREE.Vector3(), b = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (let k = 0; k < pts.length - 1; k++) {
    a.set(...pts[k]); b.set(...pts[k + 1]);
    const len = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize());
    m.castShadow = true;
    d.s.add(m);
    if (flanges && len > 1.2) {
      const f = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.6, r * 1.6, 0.05, 12), mat);
      f.position.copy(a).lerp(b, 0.5);
      f.quaternion.copy(m.quaternion);
      d.s.add(f);
    }
  }
  for (const p of pts.slice(1, -1)) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(r * 1.3, 12, 10), mat);
    s.position.set(...p);
    d.s.add(s);
  }
}
/** A valve wheel (faces +z of its frame), turning slowly. */
export function valve(d: Deco, x: number, y: number, z: number, ry: number, r = 0.16, color = '#8a1a14') {
  const g = at(d.live, x, y, z, ry);
  const m = cm('valve' + color, () => std(color, { metalness: 0.6, roughness: 0.4 }));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.12, 8, 24), m);
  g.add(ring);
  for (let k = 0; k < 3; k++) { const sp = bx(ring, r * 2, r * 0.1, r * 0.1, m, 0, 0, 0); sp.rotation.z = (k / 3) * Math.PI; }
  cy(g, r * 0.2, r * 0.2, r * 0.6, BRASS(), 0, 0, -r * 0.3, 10).rotation.x = Math.PI / 2;
  return g;
}
/** A gauge with a twitching needle (faces +z of its frame). */
export function gauge(d: Deco, x: number, y: number, z: number, ry: number, r = 0.14) {
  const g = at(d.live, x, y, z, ry);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.14, 8, 28), BRASS());
  g.add(rim);
  cy(g, r, r, 0.04, BRASS(), 0, 0, -0.02, 24).rotation.x = Math.PI / 2;
  pl(g, r * 1.9, r * 1.9, cm('dialface', () => new THREE.MeshStandardMaterial({ map: dialTex(), transparent: true, roughness: 0.5 })), 0, 0, 0.005);
  const needle = at(g, 0, 0, 0.02);
  bx(needle, 0.012, r * 0.8, 0.006, S('#a01a10', 0.4), 0, r * 0.4, 0);
  const ph = rnd() * 10;
  d.anim.push((t) => (needle.rotation.z = 0.4 + Math.sin(t * 0.7 + ph) * 0.5 + Math.sin(t * 7 + ph) * 0.03));
  return g;
}
/** A chain of links between two points; returns a function that re-hangs it (for moving ends). */
export function chain(d: Deco, from: THREE.Vector3, to: THREE.Vector3, link = 0.07, mat: THREE.Material = DARKIRON(), maxLinks = 60) {
  const geo = new THREE.TorusGeometry(link * 0.5, link * 0.14, 6, 12);
  geo.scale(1, 1.6, 1);
  const mesh = new THREE.InstancedMesh(geo, mat, maxLinks);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  d.live.add(mesh);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), dir = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const hang = (a: THREE.Vector3, b: THREE.Vector3) => {
    const len = a.distanceTo(b);
    const n = Math.min(maxLinks, Math.max(2, Math.floor(len / (link * 1.4))));
    dir.copy(b).sub(a).normalize();
    q.setFromUnitVectors(up, dir);
    for (let k = 0; k < n; k++) {
      p.copy(a).lerp(b, (k + 0.5) / n);
      q2.setFromAxisAngle(dir, k % 2 ? Math.PI / 2 : 0).multiply(q);
      m.compose(p, q2, s);
      mesh.setMatrixAt(k, m);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  };
  hang(from, to);
  return hang;
}
/** A timber roof truss across the room at depth z (rafters, tie beam, king post, struts). */
export function truss(d: Deco, z: number, mat: THREE.Material, y0 = 5.4, rise = 1.0) {
  const g = at(d.s, 0, y0, z);
  bx(g, HW * 2 - 0.1, 0.24, 0.22, mat, 0, 0, 0);
  const raf = Math.hypot(HW, rise);
  for (const sx of [-1, 1]) {
    const r = bx(g, raf, 0.22, 0.2, mat, sx * HW / 2, rise / 2, 0);
    r.rotation.z = -sx * Math.atan2(rise, HW);
    const st = bx(g, 1.8, 0.14, 0.14, mat, sx * 1.4, 0.45, 0);
    st.rotation.z = sx * 0.55;
    // iron straps at the joints
    bx(g, 0.3, 0.3, 0.24, DARKIRON(), sx * (HW - 0.6), 0.1, 0);
  }
  bx(g, 0.22, rise, 0.22, mat, 0, rise / 2, 0);
  bx(g, 0.34, 0.34, 0.26, DARKIRON(), 0, 0, 0);
}
/** An iron girder with rivets (I-section) between two x positions at height y, depth z. */
export function girder(d: Deco, x0: number, x1: number, y: number, z: number) {
  const len = x1 - x0, cx = (x0 + x1) / 2;
  bx(d.s, len, 0.04, 0.3, DARKIRON(), cx, y + 0.18, z);
  bx(d.s, len, 0.04, 0.3, DARKIRON(), cx, y - 0.18, z);
  bx(d.s, len, 0.36, 0.05, IRON(), cx, y, z);
  for (let x = x0 + 0.2; x < x1; x += 0.4) for (const sz of [-1, 1]) {
    const r = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 4), BRASS());
    r.position.set(x, y + 0.12, z + sz * 0.03);
    d.s.add(r);
  }
}
/** A small heap of stone blocks or bricks. */
export function blocks(d: Deco, x: number, z: number, n: number, mat: THREE.Material, s: [number, number, number] = [0.4, 0.2, 0.2]) {
  let k = 0;
  for (let layer = 0; k < n; layer++) for (let i = 0; i < 4 - layer && k < n; i++, k++) {
    bx(d.s, s[0], s[1], s[2], mat, x + (i - (3 - layer) / 2) * (s[0] + 0.02), s[1] / 2 + layer * s[1], z + (layer % 2) * 0.05, (rnd() - 0.5) * 0.15);
  }
}
/** A stone texture material (cached), reusing the shared stone texture. */
export const STONE = (tint: string, rep: [number, number] = [2, 2]) => cm(`stone${tint}${rep}`, () => std(tint, { map: stoneTexture(rep), roughness: 0.9 }));
/** Instanced book spines texture as a flat shelf front (cheap filler for deep shelving). */
export const SPINES = (n: number) => TEXM('spines' + n, () => bookSpinesTexture(n), 0.8);
