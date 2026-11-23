// "הצופן הזוגי", room 5 — הבית שבנינו: a warm, open hall around a great building table. On it stands the house the two
// built, all but its last wall: five gaps, each marked with a sign. A stone the server accepts slides into its gap and
// glows; once the wall is whole the house lights up and its heart turns. (The part models of the retired house build stay
// here: they now dress the finished house.)
import * as THREE from 'three';
import { RoomSnapshot } from '../../core/models';
import { rugTexture } from '../../world/textures';
import {
  RoomCtx, RoomPart, approach, box, brass, candle, canvasTex, copper, cyl, drawSymbol, dressWalls, gearGeometry, iron, mechIn, pd,
  plane, solvedIn, sprite, std, symbolTex, table, wallpaperTex, wood,
} from './cc-kit';
import { bake, deco } from './cc-decor';
import { dressHome } from './cc-dress';

const HW = 0.8, HD = 0.55, WALL_H = 0.5;
const TOP = 1.07;

/** Which end of each wall its opening is near at rotation 0 (rotation bit 2 swaps the ends, bit 1 turns the face inward). */
const FIRST_END: Record<string, 'east' | 'west' | 'north' | 'south'> = { 'w-n': 'east', 'w-e': 'north', 'w-s': 'west', 'w-w': 'south' };

export function wallFaceText(item: string, rot: number, socket: string) {
  const inward = (rot & 1) === 1;
  const swapped = (rot & 2) === 2;
  const opp: Record<string, string> = { east: 'west', west: 'east', north: 'south', south: 'north' };
  const he: Record<string, string> = { east: 'המזרחי', west: 'המערבי', north: 'הצפוני', south: 'הדרומי' };
  const first = FIRST_END[socket] ?? 'east';
  const end = swapped ? opp[first] : first;
  const face = inward ? 'הצד המעוטר פונה פנימה' : 'הצד המעוטר פונה החוצה';
  if (item === 'cc-wall-door') return `${face} · הפתח בקצה ${he[end]}`;
  if (item === 'cc-wall-hidden') return `${face} · החלון בקצה ${he[end]}`;
  return face;
}

function wallTex(item: string, outside: boolean) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 192;
  const g = c.getContext('2d')!;
  g.fillStyle = outside ? '#c89a62' : '#a8825a'; g.fillRect(0, 0, 512, 192);
  g.strokeStyle = 'rgba(60,30,10,0.35)'; g.lineWidth = 3;
  for (let x = 0; x < 512; x += 42) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 192); g.stroke(); }
  const hole = (x: number, y: number, w: number, h: number) => { g.fillStyle = '#1a1008'; g.fillRect(x, y, w, h); g.strokeStyle = '#f0e0c0'; g.lineWidth = 6; g.strokeRect(x, y, w, h); };
  // the opening is near the first end (the left of the texture, from outside)
  if (item === 'cc-wall-garden' || item === 'cc-wall-cracked') [120, 226, 332].forEach((x) => hole(x, 50, 60, 70));
  if (item === 'cc-wall-twin') [150, 302].forEach((x) => hole(x, 50, 60, 70));
  if (item === 'cc-wall-hidden') hole(46, 50, 60, 70);
  if (item === 'cc-wall-door') hole(40, 40, 80, 152);
  if (item === 'cc-wall-cracked') { g.strokeStyle = '#1a1008'; g.lineWidth = 5; g.beginPath(); g.moveTo(0, 30); g.lineTo(140, 90); g.lineTo(260, 70); g.lineTo(512, 150); g.stroke(); }
  if (outside && item === 'cc-wall-garden') for (let k = 0; k < 9; k++) drawSymbol(g, 'leaf', 30 + k * 56, 160, 30, '#4a6a2a');
  if (outside && item !== 'cc-wall-garden' && item !== 'cc-wall-plain') { g.fillStyle = 'rgba(255,240,200,0.4)'; g.fillRect(0, 0, 512, 10); g.fillRect(0, 182, 512, 10); }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A wall part: a panel whose outside face carries its openings and decoration, turned as the server says. */
export function wallPart(item: string, rot: number, len: number) {
  const g = new THREE.Group();
  const outT = wallTex(item, true), inT = wallTex(item, false);
  const swap = (rot & 2) === 2;
  for (const t of [outT, inT]) { t.wrapS = THREE.RepeatWrapping; if (swap) { t.repeat.x = -1; t.offset.x = 1; } }
  const edge = std('#8a6a42');
  const out = std('#ffffff', { map: outT, roughness: 0.7 }), inn = std('#ffffff', { map: inT, roughness: 0.8 });
  const inward = (rot & 1) === 1;
  // faces: +z is outside (unless turned inward)
  const panel = new THREE.Mesh(new THREE.BoxGeometry(len, WALL_H, 0.05), [edge, edge, edge, edge, inward ? inn : out, inward ? out : inn]);
  panel.position.y = WALL_H / 2;
  g.add(panel);
  return g;
}

export function partModel(item: string): THREE.Object3D {
  const g = new THREE.Group();
  if (item.startsWith('cc-base-') || item === 'cc-foundation-stone') {
    const stone = item === 'cc-foundation-stone' ? brass({ color: '#b88a40', roughness: 0.3 }) : std('#9a9088', { roughness: 0.95 });
    box(g, 0.18, 0.12, 0.18, stone, 0, 0.06, 0);
    const sym = item === 'cc-foundation-stone' ? 'leaf' : item.replace('cc-base-', '');
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    drawSymbol(c.getContext('2d')!, sym, 64, 64, 90, item === 'cc-foundation-stone' ? '#3a2408' : '#2a2420');
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const top = plane(g, 0.15, 0.15, new THREE.MeshBasicMaterial({ map: tex, transparent: true }), 0, 0.121, 0);
    top.rotation.x = -Math.PI / 2;
    return g;
  }
  if (item === 'cc-door' || item === 'cc-door-plain') {
    box(g, 0.13, 0.3, 0.03, wood(item === 'cc-door' ? '#6a3a1a' : '#8a7a6a'), 0, 0.15, 0);
    if (item === 'cc-door') cyl(g, 0.012, 0.012, 0.02, brass(), 0.04, 0.15, 0.02, 8).rotation.x = Math.PI / 2;
    return g;
  }
  if (item.startsWith('cc-win-')) {
    const amber = std('#ffcf7a', { emissive: '#ff9a3a', emissiveIntensity: 0.5, transparent: true, opacity: 0.85 });
    const clear = std('#cfe8ff', { transparent: true, opacity: 0.5, roughness: 0.05 });
    if (item === 'cc-win-round') {
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 8, 20), brass());
      r.position.y = 0.2;
      g.add(r);
    } else {
      const xs = item === 'cc-win-trio' ? [-0.106, 0, 0.106] : [0];
      for (const x of xs) {
        box(g, 0.07, 0.08, 0.012, item === 'cc-win-trio' ? amber : clear, x, 0.21, 0);
        box(g, 0.08, 0.01, 0.02, wood('#f0e0c0'), x, 0.255, 0);
      }
    }
    return g;
  }
  if (item.startsWith('cc-roof-')) {
    const flat = item === 'cc-roof-flat';
    const mat = flat ? std('#8a8a90', { metalness: 0.6, roughness: 0.4 }) : std('#a8442a', { roughness: 0.55 });
    const slab = box(g, HW + 0.12, 0.03, HD + 0.08, mat, 0, 0, 0);
    if (!flat) for (let k = 0; k < 6; k++) box(slab, HW + 0.12, 0.012, 0.01, std('#7a2a1a'), 0, 0.02, -HD / 2 + k * (HD / 5));
    return g;
  }
  if (item === 'cc-seal' || item === 'cc-ridge-plain') {
    if (item === 'cc-seal') {
      box(g, 0.09, 0.06, 0.06, brass({ roughness: 0.2 }), 0, 0.03, 0);
      const r = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.06, 4), brass({ roughness: 0.2 }));
      r.position.y = 0.09;
      r.rotation.y = Math.PI / 4;
      g.add(r);
    } else {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), iron());
      g.add(dome);
    }
    return g;
  }
  if (item === 'cc-heart-gear' || item === 'cc-gear-plain') {
    const gear = new THREE.Mesh(gearGeometry(0.12, item === 'cc-heart-gear' ? 24 : 20, 0.03), item === 'cc-heart-gear' ? copper() : iron());
    gear.rotation.x = 0;
    g.add(gear);
    if (item === 'cc-heart-gear') {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      drawSymbol(c.getContext('2d')!, 'heart', 32, 32, 40, '#ff6a5a');
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      plane(g, 0.06, 0.06, new THREE.MeshBasicMaterial({ map: tex, transparent: true }), 0, 0, 0.02);
    }
    return g;
  }
  // a wall laid flat on the shelf
  const w = wallPart(item, 0, 0.6);
  w.rotation.x = -Math.PI / 2;
  w.position.y = 0.03;
  g.add(w);
  return g;
}

/** The emblem carved on each building stone; the gaps of the last wall carry the plan's signs (west → east). */
const STONE_EMBLEM: Record<string, string> = { 'cc-stone-bell': 'bell', 'cc-stone-gear': 'gear', 'cc-stone-key': 'key', 'cc-stone-letter': 'envelope', 'cc-stone-home': 'home' };
const GAP_X = [-0.6, -0.3, 0, 0.3, 0.6];
const GAP = 0.19;

/** A building stone: dressed sandstone with its emblem carved on the face. */
export function stoneModel(item: string) {
  const g = new THREE.Group();
  box(g, GAP - 0.01, GAP - 0.01, 0.08, std('#c8b08a', { roughness: 0.95 }), 0, 0, 0);
  const face = plane(g, GAP * 0.8, GAP * 0.8, new THREE.MeshBasicMaterial({ map: symbolTex(STONE_EMBLEM[item] ?? '', '#4a3418'), transparent: true }), 0, 0, 0.041);
  face.renderOrder = 2;
  return g;
}

/** The last wall: sandstone masonry with five dark gaps, the sign of each place carved under it. */
function lastWallTex(signs: string[]) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 320;
  const g = c.getContext('2d')!;
  g.fillStyle = '#b89a70'; g.fillRect(0, 0, 1024, 320);
  g.strokeStyle = 'rgba(70,45,20,.45)'; g.lineWidth = 4;
  for (let row = 0; row < 8; row++) {
    const y = row * 40;
    g.beginPath(); g.moveTo(0, y); g.lineTo(1024, y); g.stroke();
    for (let x = (row % 2) * 40; x < 1024; x += 80) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 40); g.stroke(); }
  }
  signs.forEach((sign, k) => {
    const cx = 512 + (GAP_X[k] / (HW * 2)) * 1024;
    g.fillStyle = '#1a1008'; g.fillRect(cx - 60, 40, 120, 120);
    g.strokeStyle = '#e8d8b0'; g.lineWidth = 5; g.strokeRect(cx - 60, 40, 120, 120);
    drawSymbol(g, sign, cx, 236, 92, '#3a2410');
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The plan of the last wall on the left wall of the room: the five signs, and a little house drawn above the star. */
function planTex(signs: string[]) {
  return canvasTex('cc6-wall-plan' + signs.join(), 768, 520, (g, w, h) => {
    g.fillStyle = '#e8f0f8'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(26,58,106,.18)'; g.lineWidth = 1;
    for (let x = 0; x < w; x += 24) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y < h; y += 24) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.fillStyle = '#1a3a6a'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.direction = 'rtl';
    g.font = 'bold 50px "Frank Ruehl CLM", "David", serif';
    g.fillText('תוכנית הקיר האחרון', w / 2, 52);
    g.strokeStyle = '#1a3a6a'; g.lineWidth = 4; g.strokeRect(54, 120, w - 108, 230);
    signs.forEach((sign, k) => {
      const cx = 54 + ((w - 108) / 5) * (k + 0.5);
      g.setLineDash([10, 8]); g.strokeRect(cx - 50, 150, 100, 100); g.setLineDash([]);
      drawSymbol(g, sign, cx, 300, 70, '#1a3a6a');
      if (sign === 'star') { g.save(); g.globalAlpha = 0.75; drawSymbol(g, 'home', cx, 200, 60, '#5a5a62'); g.restore(); }
    });
    g.font = 'italic 30px "Frank Ruehl CLM", "David", serif'; g.fillStyle = '#1a3a6a';
    g.fillText('„כל חדר השאיר לכם מזכרת.', w / 2, 410);
    g.fillText('מה שנחרט עליה יחד — שייך יחד.”', w / 2, 456);
  });
}

export function buildHomeRoom(ctx: RoomCtx): RoomPart {
  const g = ctx.group;
  const anim: ((t: number, dt: number) => void)[] = [];
  dressWalls(ctx, wallpaperTex('#e0c8a0', '#a8784a', 'damask', [6, 3]), '#6a4426', '#4a2e18');
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(8, 5.2), std('#ffffff', { map: rugTexture('#7a4a2a', '#f0d8a0', 21), roughness: 0.95 }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0, 0.01, -0.6);
  g.add(rug);

  // ---- the great building table: the house the two built, all but its last (south) wall
  table(g, 3.6, 2.4, 1.0, 0, -1.4, '#5a3a1e');
  const site = new THREE.Group();
  site.position.set(0, TOP, -1.4);
  g.add(site);
  box(site, 2.2, 0.05, 1.7, std('#5a7a3a', { roughness: 0.95 }), 0, -0.02, 0);
  const at = (o: THREE.Object3D, x: number, y: number, z: number, ry = 0) => { o.position.set(x, y, z); o.rotation.y = ry; site.add(o); return o; };
  for (const [item, x, z] of [['cc-base-arch', -HW, -HD], ['cc-base-flame', HW, -HD], ['cc-foundation-stone', HW, HD], ['cc-base-wave', -HW, HD]] as [string, number, number][]) at(partModel(item), x, 0, z);
  at(wallPart('cc-wall-hidden', 2, HW * 2), 0, 0.12, -HD, Math.PI);
  at(wallPart('cc-wall-door', 2, HD * 2), HW, 0.12, 0, Math.PI / 2);
  at(wallPart('cc-wall-plain', 0, HD * 2), -HW, 0.12, 0, -Math.PI / 2);
  at(partModel('cc-door'), HW + 0.035, 0.12, HD - 0.18, Math.PI / 2);
  at(partModel('cc-roof-left'), -HW / 2 - 0.02, 0.12 + WALL_H + 0.2, 0).rotation.z = 0.5;
  at(partModel('cc-roof-right'), HW / 2 + 0.02, 0.12 + WALL_H + 0.2, 0).rotation.z = -0.5;
  at(partModel('cc-seal'), 0, 0.12 + WALL_H + 0.42, 0);
  cyl(site, 0.025, 0.025, 0.62, iron(), 0, 0.12 + WALL_H + 0.31, HD + 0.02, 10);
  const heart = at(partModel('cc-heart-gear'), 0, 0.12 + WALL_H + 0.62, HD + 0.045);

  // the last wall, facing the players (south, +z), with its five gaps
  const signs: string[] = (pd<{ slots?: { id: string }[] }>(ctx, 'cc6-wall').slots ?? []).map((s) => s.id);
  const lastWall = at(new THREE.Group(), 0, 0.12, HD);
  const edge = std('#9a7e58');
  const face = new THREE.Mesh(new THREE.BoxGeometry(HW * 2, WALL_H, 0.05), [edge, edge, edge, edge, std('#ffffff', { map: lastWallTex(signs), roughness: 0.9 }), edge]);
  face.position.y = WALL_H / 2;
  lastWall.add(face);
  const gaps = signs.map((sign, k) => {
    const h = new THREE.Group();
    // the gap's centre on the wall: the texture puts it 40–160 px down a 320 px tall face
    h.position.set(GAP_X[k], WALL_H * (1 - 100 / 320), 0.03);
    lastWall.add(h);
    const glowM = new THREE.Mesh(new THREE.PlaneGeometry(GAP + 0.04, GAP + 0.04), new THREE.MeshBasicMaterial({ color: '#ffd890', transparent: true, opacity: 0, depthWrite: false }));
    glowM.position.z = 0.002;
    h.add(glowM);
    return { sign, h, glow: glowM, stone: null as THREE.Object3D | null, item: '', inAt: 1, flash: 0 };
  });
  const houseGlow = sprite(site, '#ffcf7a', 2.6, 0, 0.6, 0, 0);
  const houseLight = new THREE.PointLight('#ffb860', 0, 3.5, 1.6);
  houseLight.position.set(0, 0.4, 0.4);
  site.add(houseLight);
  ctx.addLight(0, 3.4, -0.6, '#fff0d0', 8, 8, false);

  // ---- the plan of the last wall on the left wall
  const plan = new THREE.Group();
  plan.position.set(-7.9, 2.3, -1.2);
  plan.rotation.y = Math.PI / 2;
  g.add(plan);
  box(plan, 2.0, 1.4, 0.05, wood('#3a2410'), 0, 0, -0.01);
  // unlit, so the lamps near the corner never wash the print out
  plane(plan, 1.86, 1.26, new THREE.MeshBasicMaterial({ color: '#d8d8d8', map: planTex(signs) }), 0, 0, 0.02);
  ctx.addLight(-6.6, 3.2, -1.2, '#fff0d8', 3.5, 5, false);

  // ---- the shelf on the right wall: the five building stones lying in the room
  const shelf = new THREE.Group();
  shelf.position.set(7.55, 0, -1.4);
  shelf.rotation.y = -Math.PI / 2;
  g.add(shelf);
  box(shelf, 3.6, 2.6, 0.8, wood('#3a2416'), 0, 1.3, -0.1);
  for (let k = 0; k < 3; k++) box(shelf, 3.5, 0.05, 0.7, wood('#6a4428'), 0, 0.5 + k * 0.75, 0.0);
  const shelfParts = new Map<string, THREE.Object3D>();
  Object.keys(STONE_EMBLEM).forEach((id, k) => {
    const p = stoneModel(id);
    p.scale.setScalar(1.6);
    p.position.set(-1.2 + k * 0.6, 1.25 + 0.16, 0.05);
    shelf.add(p);
    shelfParts.set(id, p);
  });
  ctx.addLight(6.4, 2.8, -1.4, '#ffd8a8', 3.5, 5, false);

  // warmth: candles on side tables, lanterns, a reading corner
  for (const [x, z] of [[-5.5, 4.6], [5.5, 4.6]]) {
    table(g, 1.0, 0.6, 0.8, x, z, '#4a2a16');
    candle(ctx, anim, x - 0.2, 0.84, z, true);
    candle(ctx, anim, x + 0.2, 0.84, z, false, 0.16);
  }
  ctx.addLight(0, 4.9, 2.6, '#ffd8a0', 7, 12);

  // ---- the room's dressing (architecture, furniture, lamps, details): merged per material
  const dressing = deco(ctx, anim);
  dressHome(dressing);
  bake(dressing);

  // ---- state: a stone the server accepted slides into its gap and glows; once the wall is whole, the house lights up
  let done = false, lit = 0, heartTurn = 0, first = true;
  return {
    apply(s: RoomSnapshot, live: boolean) {
      const world = new Set(s.worldItems);
      const slots = mechIn(s, 'cc6-wall')?.slots ?? {};
      done = s.phase === 'completed' || solvedIn(s, 'cc6-wall');
      for (const gap of gaps) {
        const item = slots[gap.sign] ?? '';
        if (gap.item === item) continue;
        gap.item = item;
        if (gap.stone) gap.h.remove(gap.stone);
        gap.stone = item ? stoneModel(item) : null;
        if (gap.stone) {
          gap.h.add(gap.stone);
          const animate = live && !first;
          gap.inAt = animate ? 0 : 1;
          gap.flash = animate ? 1 : 0;
        }
      }
      for (const [id, p] of shelfParts) p.visible = world.has(id);
      first = false;
    },
    update(dt, t) {
      for (const gap of gaps) {
        if (gap.stone) {
          gap.inAt = approach(gap.inAt, 1, dt, 1.4);
          const e = 1 - Math.pow(1 - gap.inAt, 3);
          gap.stone.position.z = (1 - e) * 0.35;
          gap.stone.position.y = (1 - e) * 0.12;
        }
        gap.flash = Math.max(0, gap.flash - dt * 0.6);
        (gap.glow.material as THREE.MeshBasicMaterial).opacity = Math.max(gap.flash * 0.8, lit * 0.35);
      }
      lit = approach(lit, done ? 1 : 0, dt, 0.6);
      (houseGlow.material as THREE.SpriteMaterial).opacity = lit * (0.45 + Math.sin(t * 1.5) * 0.06);
      houseLight.intensity = lit * 2.5;
      heartTurn += dt * (done ? 1.2 : 0);
      heart.rotation.z = -heartTurn;
      for (const a of anim) a(t, dt);
    },
  };
}
