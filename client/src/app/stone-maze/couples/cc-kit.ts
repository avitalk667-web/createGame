// "הצופן הזוגי": the shared building kit of the six rooms — materials, textures drawn in code (wallpaper, curtains,
// paper, blueprints, the eight symbols), small helpers, and each room's own light mood and reflection environment.
// Everything is built in code (no model files), so the rooms load at once; the general renderer settings are untouched.
import * as THREE from 'three';
import { MechanismState, RoomSnapshot, ScenarioContent } from '../../core/models';
import { Quality } from '../../core/settings.service';
import { glowSpriteTexture } from '../../world/textures';

export interface RoomCtx {
  /** The room's own group, already placed at the room's centre (x 0, z = centre): build in room coordinates. */
  group: THREE.Group;
  quality: Quality;
  scenario: ScenarioContent | null;
  /** A pooled point light (room coordinates). */
  addLight(x: number, y: number, z: number, color: string, intensity: number, distance: number, flicker?: boolean): void;
}

/** What a room shows of the shared state, and its own animation. */
export interface RoomPart {
  apply(s: RoomSnapshot, live: boolean): void;
  update(dt: number, t: number): void;
}

export const pd = <T = any>(ctx: RoomCtx, puzzleId: string): T => (ctx.scenario?.puzzles.find((p) => p.id === puzzleId)?.publicData ?? {}) as T;
export const solvedIn = (s: RoomSnapshot, id: string) => s.puzzles.find((p) => p.id === id)?.status === 'solved';
export const statusIn = (s: RoomSnapshot, id: string) => s.puzzles.find((p) => p.id === id)?.status ?? 'locked';
export const mechIn = (s: RoomSnapshot, id: string): MechanismState | undefined => s.mechanisms?.[id];

// ------------------------------------------------------------------------------------------------ materials

const cache = new Map<string, THREE.Texture>();
export function canvasTex(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, repeat?: [number, number]) {
  let tex = cache.get(key);
  if (!tex) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d')!, w, h);
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    cache.set(key, tex);
  }
  if (!repeat) return tex;
  const t = tex.clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.needsUpdate = true;
  return t;
}

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

export const std = (color: string, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...o });
export const brass = (o: THREE.MeshStandardMaterialParameters = {}) => std('#c9a050', { metalness: 0.9, roughness: 0.32, ...o });
export const copper = () => std('#c0714a', { metalness: 0.9, roughness: 0.35 });
export const iron = () => std('#55595f', { metalness: 0.8, roughness: 0.45 });
export const glow = (color: string, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, toneMapped: false });

/** A fine wood grain, in any tone. */
export function woodTex(base: string, repeat: [number, number] = [1, 1]) {
  return canvasTex('wood' + base, 256, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      const y = rnd() * h;
      g.strokeStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,230,190'},${0.04 + rnd() * 0.08})`;
      g.lineWidth = 1 + rnd() * 3;
      g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin(x / 30 + i) * 3);
      g.stroke();
    }
  }, repeat);
}
export const wood = (base = '#6a4426', repeat: [number, number] = [1, 1]) => std('#ffffff', { map: woodTex(base, repeat), roughness: 0.65 });

/** Damask-like wallpaper: a soft repeated motif over a base colour. */
export function wallpaperTex(base: string, ink: string, motif: 'damask' | 'stripe' | 'grid' | 'leaf', repeat: [number, number]) {
  return canvasTex(`wp${base}${ink}${motif}`, 256, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    g.strokeStyle = ink; g.fillStyle = ink; g.globalAlpha = 0.35; g.lineWidth = 3;
    if (motif === 'stripe') {
      for (let x = 0; x < w; x += 32) { g.fillRect(x, 0, 10, h); g.globalAlpha = 0.15; g.fillRect(x + 16, 0, 3, h); g.globalAlpha = 0.35; }
    } else if (motif === 'grid') {
      for (let x = 0; x <= w; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
      for (let y = 0; y <= h; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    } else {
      for (const [cx, cy] of [[64, 64], [192, 192], [192, 64], [64, 192]] as [number, number][]) {
        const small = (cx + cy) % 256 !== 128;
        g.save(); g.translate(cx, cy); g.scale(small ? 0.55 : 1, small ? 0.55 : 1);
        if (motif === 'leaf') drawSymbol(g, 'leaf', 0, 0, 70, ink);
        else {
          g.beginPath();
          for (let k = 0; k < 4; k++) { g.rotate(Math.PI / 2); g.moveTo(0, 0); g.bezierCurveTo(20, -18, 36, -6, 0, -44); g.bezierCurveTo(-36, -6, -20, -18, 0, 0); }
          g.fill();
          g.beginPath(); g.arc(0, 0, 8, 0, Math.PI * 2); g.globalAlpha = 0.5; g.fill(); g.globalAlpha = 0.35;
        }
        g.restore();
      }
    }
    g.globalAlpha = 1;
    // age: a soft vignette of dust
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, 'rgba(0,0,0,0.05)'); grd.addColorStop(1, 'rgba(0,0,0,0.18)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  }, repeat);
}

/** Heavy curtain folds. */
export function curtainTex(color: string) {
  return canvasTex('curtain' + color, 256, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, 0);
    for (let k = 0; k <= 8; k++) grd.addColorStop(k / 8, k % 2 ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.12)');
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
}

/** Old paper with handwriting-like lines (or given text). */
export function paperTex(lines: string[] = [], opts: { bg?: string; ink?: string; title?: string; w?: number; h?: number; size?: number } = {}) {
  const w = opts.w ?? 512, h = opts.h ?? 640;
  return canvasTex('paper' + lines.join('|') + (opts.title ?? '') + (opts.bg ?? '') + w + h, w, h, (g) => {
    g.fillStyle = opts.bg ?? '#ead9b0'; g.fillRect(0, 0, w, h);
    const grd = g.createRadialGradient(w / 2, h / 2, w * 0.2, w / 2, h / 2, w * 0.8);
    grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(90,50,10,0.35)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.fillStyle = opts.ink ?? '#3a2410'; g.textAlign = 'center'; g.direction = 'rtl';
    let y = 70;
    if (opts.title) { g.font = `bold ${Math.round((opts.size ?? 40) * 1.2)}px "Frank Ruehl CLM", "David", serif`; g.fillText(opts.title, w / 2, y); y += 70; }
    g.font = `${opts.size ?? 40}px "Frank Ruehl CLM", "David", serif`;
    if (!lines.length) {
      g.strokeStyle = 'rgba(58,36,16,0.55)'; g.lineWidth = 3;
      for (let k = 0; y < h - 50 && k < 14; k++, y += 38) {
        g.beginPath(); g.moveTo(60 + rnd() * 40, y);
        for (let x = 80; x < w - 60 - rnd() * 80; x += 12) g.lineTo(x, y + Math.sin(x * 0.4) * 2);
        g.stroke();
      }
    } else for (const l of lines) { g.fillText(l, w / 2, y); y += (opts.size ?? 40) * 1.5; }
  });
}

/** A blueprint sheet: blue paper, a grid, a house outline. */
export function blueprintTex(variant: number) {
  return canvasTex('blueprint' + variant, 512, 384, (g, w, h) => {
    g.fillStyle = '#1d4a7a'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(200,225,255,0.18)'; g.lineWidth = 1;
    for (let x = 0; x < w; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y < h; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.strokeStyle = '#e6f0ff'; g.lineWidth = 4;
    g.strokeRect(96, 96, 320, 200);
    g.beginPath(); g.moveTo(256, 96); g.lineTo(256, 296); g.moveTo(96, 200); g.lineTo(variant ? 416 : 256, 200); g.stroke();
    g.lineWidth = 2;
    const wins = variant ? [130, 170, 210] : [150, 200];
    for (const x of wins) g.strokeRect(x, 290, 28, 12);
    g.fillStyle = '#e6f0ff'; g.font = 'bold 30px sans-serif'; g.textAlign = 'center';
    g.fillText(variant ? '746' : '128', w / 2, 60);
  });
}

export function textTex(text: string, opts: { color?: string; bg?: string; w?: number; h?: number; size?: number; font?: string } = {}) {
  const w = opts.w ?? 512, h = opts.h ?? 128;
  return canvasTex('text' + text + JSON.stringify(opts), w, h, (g) => {
    if (opts.bg) { g.fillStyle = opts.bg; g.fillRect(0, 0, w, h); }
    g.fillStyle = opts.color ?? '#ffd9a0'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.direction = 'rtl';
    g.font = `bold ${opts.size ?? 54}px ${opts.font ?? '"Frank Ruehl CLM", "David", serif'}`;
    const rows = text.split('\n');
    rows.forEach((r, i) => g.fillText(r, w / 2, (h / (rows.length + 1)) * (i + 1)));
  });
}

/** The eight symbols of the game, drawn as simple engraved shapes. */
export function drawSymbol(g: CanvasRenderingContext2D, id: string, cx: number, cy: number, s: number, color: string) {
  g.save();
  g.translate(cx, cy);
  g.strokeStyle = color; g.fillStyle = color; g.lineWidth = Math.max(2, s * 0.08); g.lineCap = 'round'; g.lineJoin = 'round';
  const r = s / 2;
  g.beginPath();
  switch (id) {
    case 'arch':
      g.moveTo(-r * 0.8, r * 0.8); g.lineTo(-r * 0.8, 0); g.arc(0, 0, r * 0.8, Math.PI, 0); g.lineTo(r * 0.8, r * 0.8);
      g.moveTo(-r * 0.45, r * 0.8); g.lineTo(-r * 0.45, 0); g.arc(0, 0, r * 0.45, Math.PI, 0); g.lineTo(r * 0.45, r * 0.8);
      g.stroke(); break;
    case 'leaf':
      g.moveTo(0, r); g.bezierCurveTo(r, r * 0.2, r * 0.7, -r * 0.7, 0, -r); g.bezierCurveTo(-r * 0.7, -r * 0.7, -r, r * 0.2, 0, r);
      g.moveTo(0, r); g.lineTo(0, -r * 0.7); g.stroke(); break;
    case 'wave':
      for (const y of [-r * 0.35, r * 0.25]) { g.moveTo(-r, y); g.bezierCurveTo(-r * 0.5, y - r * 0.5, -r * 0.2, y + r * 0.5, 0, y); g.bezierCurveTo(r * 0.2, y - r * 0.5, r * 0.5, y + r * 0.5, r, y); }
      g.stroke(); break;
    case 'flame':
      g.moveTo(0, r); g.bezierCurveTo(r * 0.9, r * 0.6, r * 0.5, -r * 0.3, 0, -r); g.bezierCurveTo(-r * 0.1, -r * 0.3, -r * 0.9, 0, -r * 0.5, r * 0.5);
      g.quadraticCurveTo(-r * 0.3, r, 0, r); g.fill(); break;
    case 'bell':
      g.moveTo(-r * 0.7, r * 0.6); g.quadraticCurveTo(-r * 0.6, -r * 0.8, 0, -r * 0.8); g.quadraticCurveTo(r * 0.6, -r * 0.8, r * 0.7, r * 0.6); g.closePath(); g.fill();
      g.beginPath(); g.arc(0, r * 0.78, r * 0.16, 0, Math.PI * 2); g.fill(); break;
    case 'key':
      g.arc(-r * 0.45, 0, r * 0.35, 0, Math.PI * 2); g.moveTo(-r * 0.1, 0); g.lineTo(r, 0); g.moveTo(r * 0.7, 0); g.lineTo(r * 0.7, r * 0.35); g.moveTo(r * 0.45, 0); g.lineTo(r * 0.45, r * 0.25);
      g.stroke(); break;
    case 'star':
      for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? r * 0.42 : r; k ? g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      g.closePath(); g.fill(); break;
    case 'home':
      g.moveTo(-r * 0.8, -r * 0.05); g.lineTo(0, -r * 0.85); g.lineTo(r * 0.8, -r * 0.05); g.moveTo(-r * 0.6, -r * 0.2); g.lineTo(-r * 0.6, r * 0.8); g.lineTo(r * 0.6, r * 0.8); g.lineTo(r * 0.6, -r * 0.2);
      g.moveTo(-r * 0.18, r * 0.8); g.lineTo(-r * 0.18, r * 0.3); g.lineTo(r * 0.18, r * 0.3); g.lineTo(r * 0.18, r * 0.8); g.stroke(); break;
    case 'gear':
      for (let k = 0; k < 16; k++) { const a = (k * Math.PI) / 8, rr = k % 2 ? r * 0.68 : r * 0.9; k ? g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      g.closePath(); g.moveTo(r * 0.28, 0); g.arc(0, 0, r * 0.28, 0, Math.PI * 2); g.stroke(); break;
    case 'envelope':
      g.rect(-r * 0.85, -r * 0.55, r * 1.7, r * 1.1); g.moveTo(-r * 0.85, -r * 0.55); g.lineTo(0, r * 0.12); g.lineTo(r * 0.85, -r * 0.55); g.stroke(); break;
    case 'heart':
      g.moveTo(0, r * 0.8); g.bezierCurveTo(-r * 1.2, 0, -r * 0.6, -r, 0, -r * 0.35); g.bezierCurveTo(r * 0.6, -r, r * 1.2, 0, 0, r * 0.8); g.fill(); break;
    default:
      g.arc(0, 0, r * 0.5, 0, Math.PI * 2); g.stroke();
  }
  g.restore();
}

export function symbolTex(id: string, color = '#ffd98a', bg?: string) {
  return canvasTex(`sym${id}${color}${bg ?? ''}`, 256, 256, (g, w) => {
    if (bg) { g.fillStyle = bg; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 4, 0, Math.PI * 2); g.fill(); }
    drawSymbol(g, id, w / 2, w / 2, w * 0.62, color);
  });
}

// ------------------------------------------------------------------------------------------------ mesh helpers

export function box(parent: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material | THREE.Material[], x: number, y: number, z: number) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
export function cyl(parent: THREE.Object3D, rt: number, rb: number, h: number, mat: THREE.Material, x: number, y: number, z: number, seg = 20) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
export function plane(parent: THREE.Object3D, w: number, h: number, mat: THREE.Material, x: number, y: number, z: number, rotY = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z);
  m.rotation.y = rotY;
  parent.add(m);
  return m;
}
/** A flat sheet lying on a table (paper, a card, a plan). */
export function sheet(parent: THREE.Object3D, w: number, d: number, map: THREE.Texture, x: number, y: number, z: number, rot = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), std('#ffffff', { map, roughness: 0.9 }));
  m.rotation.set(-Math.PI / 2, 0, rot);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
export function sprite(parent: THREE.Object3D, color: string, size: number, x: number, y: number, z: number, opacity = 0.8) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowSpriteTexture(color), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity }));
  s.scale.set(size, size, 1);
  s.position.set(x, y, z);
  parent.add(s);
  return s;
}

/** A table: top, apron and turned legs. */
export function table(parent: THREE.Object3D, w: number, d: number, h: number, x: number, z: number, tone = '#5a3a20') {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const top = wood(tone, [w / 2, 1]);
  box(g, w, 0.08, d, top, 0, h, 0);
  box(g, w - 0.2, 0.14, d - 0.2, wood(tone), 0, h - 0.11, 0);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const leg = cyl(g, 0.05, 0.035, h - 0.08, wood(tone), sx * (w / 2 - 0.12), (h - 0.08) / 2, sz * (d / 2 - 0.12), 10);
    leg.castShadow = true;
  }
  parent.add(g);
  return g;
}

/** A candle with a flickering flame (and, optionally, a pooled light). */
export function candle(ctx: RoomCtx, anim: ((t: number, dt: number) => void)[], x: number, y: number, z: number, light = false, h = 0.22) {
  const wax = cyl(ctx.group, 0.045, 0.05, h, std('#f0e6cc', { roughness: 0.6 }), x, y + h / 2, z, 10);
  const flame = sprite(ctx.group, '#ffb84d', 0.32, x, y + h + 0.09, z, 0.9);
  anim.push((t) => flame.scale.set(0.3 + Math.sin(t * 13 + x * 3) * 0.03, 0.42 + Math.sin(t * 17 + z) * 0.05, 1));
  if (light) ctx.addLight(x, y + h + 0.25, z, '#ffb469', 3.2, 6);
  return wax;
}

/** A framed picture on a wall (faces +x when rotY = π/2, −x when −π/2). */
export function frame(parent: THREE.Object3D, w: number, h: number, map: THREE.Texture, x: number, y: number, z: number, rotY: number, tone = '#8a6a2a') {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = rotY;
  const f = brass({ color: tone, roughness: 0.4 });
  box(g, w + 0.14, 0.07, 0.06, f, 0, h / 2 + 0.035, 0);
  box(g, w + 0.14, 0.07, 0.06, f, 0, -h / 2 - 0.035, 0);
  box(g, 0.07, h, 0.06, f, -w / 2 - 0.035, 0, 0);
  box(g, 0.07, h, 0.06, f, w / 2 + 0.035, 0, 0);
  plane(g, w, h, std('#ffffff', { map, roughness: 0.85 }), 0, 0, 0.01);
  parent.add(g);
  return g;
}

/** Wall dressing of a room: wainscot panels and a cornice along the two long walls and the back, plus a rug. */
export function dressWalls(ctx: RoomCtx, paper: THREE.Texture, wainscot: string, cornice = '#3a2614') {
  const g = ctx.group;
  const W = 8, D = 7;
  const wp = std('#ffffff', { map: paper, roughness: 0.9 });
  const pan = wood(wainscot, [6, 1]);
  const cor = wood(cornice);
  for (const sx of [-1, 1]) {
    plane(g, D * 2 - 0.1, 3.6, wp, sx * (W - 0.02), 3.25, 0, -sx * Math.PI / 2);
    box(g, 0.05, 1.25, D * 2 - 0.1, pan, sx * (W - 0.04), 0.66, 0);
    box(g, 0.1, 0.08, D * 2 - 0.1, cor, sx * (W - 0.07), 1.3, 0);
    box(g, 0.14, 0.18, D * 2 - 0.1, cor, sx * (W - 0.08), 5.1, 0);
  }
  for (const [x0, x1] of [[-W, -1.25], [1.25, W]]) {
    const w = x1 - x0, cx = (x0 + x1) / 2;
    plane(g, w - 0.05, 3.6, wp, cx, 3.25, -D + 0.02, 0);
    box(g, w - 0.05, 1.25, 0.05, pan, cx, 0.66, -D + 0.04);
    box(g, w - 0.05, 0.08, 0.1, cor, cx, 1.3, -D + 0.07);
    plane(g, w - 0.05, 3.6, wp, cx, 3.25, D - 0.02, Math.PI);
    box(g, w - 0.05, 1.25, 0.05, pan, cx, 0.66, D - 0.04);
  }
}

/** A warm reflection environment made in code, from a few coloured light panels. */
export function moodEnvironment(renderer: THREE.WebGLRenderer, panels: [string, number, number, number, number, number, number][], back = '#120c08') {
  const env = new THREE.Scene();
  env.background = new THREE.Color(back);
  for (const [color, k, w, h, x, y, z] of panels) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    env.add(m);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.04).texture;
  pmrem.dispose();
  env.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } });
  return tex;
}

/** Each room's mood: the sky/ground fill, the ambient light and the reflection panels (spec: cinematic warm realism). */
export interface Mood { sky: string; ground: string; hemi: number; ambient: number; ambientColor: string; env: [string, number, number, number, number, number, number][] }
export const MOODS: Record<string, Mood> = {
  'cc-sounds': { sky: '#ffd6a8', ground: '#2a1a12', hemi: 0.85, ambient: 0.28, ambientColor: '#e8b890', env: [['#ffb878', 2.2, 6, 4, 0, 9, 0], ['#ff9050', 1.2, 4, 3, -8, 2, 0], ['#ffd9a8', 1.0, 5, 2, 0, 2, 9]] },
  'cc-partnership': { sky: '#ffc890', ground: '#26180e', hemi: 0.8, ambient: 0.26, ambientColor: '#e0a878', env: [['#ffb070', 2.4, 6, 4, 0, 9, 0], ['#ff7a2a', 1.4, 4, 2, -8, 1, 6], ['#88c8ff', 0.4, 4, 2, 8, 2, -1]] },
  'cc-trust': { sky: '#c8d2ff', ground: '#1c1820', hemi: 0.75, ambient: 0.26, ambientColor: '#b8b0d8', env: [['#e8d8b0', 1.8, 6, 4, 0, 9, 0], ['#7088c0', 1.0, 4, 3, 8, 2, 0], ['#ffcf90', 0.9, 4, 2, -8, 2, 3]] },
  'cc-letters': { sky: '#ffd8b8', ground: '#2a1a14', hemi: 0.8, ambient: 0.28, ambientColor: '#e8b8a0', env: [['#ffc090', 2.0, 6, 4, 0, 9, 0], ['#ff8a60', 1.0, 4, 3, 8, 2, 0], ['#ffe0b0', 1.0, 5, 2, 0, 2, 9]] },
  'cc-home': { sky: '#ffe2b8', ground: '#2a2014', hemi: 0.95, ambient: 0.32, ambientColor: '#f0c898', env: [['#ffd090', 2.6, 6, 4, 0, 9, 0], ['#ffb060', 1.2, 4, 3, -8, 2, 4], ['#a8d0ff', 0.5, 4, 2, 8, 3, -2]] },
};

/** Eases a value toward a target (frame-rate independent). */
export const approach = (v: number, target: number, dt: number, speed = 6) => v + (target - v) * Math.min(1, dt * speed);

/** Gear geometry: a disc with teeth (radius in metres, teeth count). */
export function gearGeometry(radius: number, teeth: number, depth = 0.06) {
  const shape = new THREE.Shape();
  const inner = radius * 0.86, outer = radius;
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2, step = (Math.PI * 2) / teeth;
    const pts: [number, number][] = [[a0, inner], [a0 + step * 0.15, outer], [a0 + step * 0.45, outer], [a0 + step * 0.6, inner]];
    pts.forEach(([a, r], k) => (i === 0 && k === 0 ? shape.moveTo(Math.cos(a) * r, Math.sin(a) * r) : shape.lineTo(Math.cos(a) * r, Math.sin(a) * r)));
  }
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, radius * 0.18, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 1, curveSegments: 6 });
  geo.center();
  return geo;
}
