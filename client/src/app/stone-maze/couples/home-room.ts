// "הצופן הזוגי", room 6 — הבית שבנינו: a warm, open hall around a great building table. On the table's base the house
// rises stage by stage exactly as the server holds it: corner stones, four walls (each one turned as it was placed),
// the door and windows, the two roof halves and the seal on the ridge, and the heart gear. A stage that was checked
// right is fixed in full colour; parts of the stage being built show as placed. Once the heart turns, the house lights.
import * as THREE from 'three';
import { RoomSnapshot } from '../../core/models';
import { rugTexture } from '../../world/textures';
import {
  RoomCtx, RoomPart, approach, box, brass, candle, copper, cyl, drawSymbol, dressWalls, gearGeometry, glow, iron, mechIn, paperTex, pd,
  plane, sprite, std, table, wallpaperTex, wood,
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

export function buildHomeRoom(ctx: RoomCtx): RoomPart {
  const g = ctx.group;
  const anim: ((t: number, dt: number) => void)[] = [];
  dressWalls(ctx, wallpaperTex('#e0c8a0', '#a8784a', 'damask', [6, 3]), '#6a4426', '#4a2e18');
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(8, 5.2), std('#ffffff', { map: rugTexture('#7a4a2a', '#f0d8a0', 21), roughness: 0.95 }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0, 0.01, -0.6);
  g.add(rug);

  // ---- the great building table and its base with a compass rose (north = the back wall)
  table(g, 3.6, 2.4, 1.0, 0, -1.4, '#5a3a1e');
  const site = new THREE.Group();
  site.position.set(0, TOP, -1.4);
  g.add(site);
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const cg = c.getContext('2d')!;
  cg.fillStyle = '#5a7a3a'; cg.fillRect(0, 0, 512, 512);
  cg.strokeStyle = 'rgba(255,255,255,0.25)'; cg.lineWidth = 2;
  for (let k = 0; k < 512; k += 32) { cg.beginPath(); cg.moveTo(k, 0); cg.lineTo(k, 512); cg.stroke(); cg.beginPath(); cg.moveTo(0, k); cg.lineTo(512, k); cg.stroke(); }
  cg.fillStyle = '#f0e0b0'; cg.font = 'bold 44px serif'; cg.textAlign = 'center';
  cg.fillText('צ', 256, 44); cg.fillText('ד', 256, 500); cg.fillText('מז', 486, 270); cg.fillText('מע', 30, 270);
  const ground = new THREE.CanvasTexture(c);
  ground.colorSpace = THREE.SRGBColorSpace;
  box(site, 2.2, 0.05, 1.7, std('#ffffff', { map: ground, roughness: 0.95 }), 0, -0.02, 0);
  // the outline of the house drawn on the base
  const outline = std('#f0e0b0', { emissive: '#ffd890', emissiveIntensity: 0.25 });
  for (const [w, d, x, z] of [[HW * 2, 0.015, 0, -HD], [HW * 2, 0.015, 0, HD], [0.015, HD * 2, -HW, 0], [0.015, HD * 2, HW, 0]] as [number, number, number, number][]) box(site, w, 0.004, d, outline, x, 0.006, z);

  // socket positions in the site's frame (north = −z, east = +x)
  const SOCK: Record<string, { p: [number, number, number]; ry?: number }> = {
    'f-nw': { p: [-HW, 0, -HD] }, 'f-ne': { p: [HW, 0, -HD] }, 'f-se': { p: [HW, 0, HD] }, 'f-sw': { p: [-HW, 0, HD] },
    // a wall's outside faces away from the house; its "first end" is FIRST_END (the texture's left, seen from outside)
    'w-n': { p: [0, 0.12, -HD], ry: Math.PI }, 'w-e': { p: [HW, 0.12, 0], ry: Math.PI / 2 }, 'w-s': { p: [0, 0.12, HD], ry: 0 }, 'w-w': { p: [-HW, 0.12, 0], ry: -Math.PI / 2 },
    'o-door': { p: [HW + 0.035, 0.12, HD - 0.18], ry: Math.PI / 2 }, 'o-garden': { p: [0, 0.12, HD + 0.035], ry: 0 }, 'o-hidden': { p: [-HW + 0.2, 0.12, -HD - 0.035], ry: Math.PI },
    'r-west': { p: [-HW / 2 - 0.02, 0.12 + WALL_H + 0.2, 0], ry: 0 }, 'r-east': { p: [HW / 2 + 0.02, 0.12 + WALL_H + 0.2, 0], ry: 0 },
    'r-ridge': { p: [0, 0.12 + WALL_H + 0.42, 0] }, 'h-axle': { p: [0, 0.12 + WALL_H + 0.62, HD + 0.02] },
  };
  const WALL_LEN: Record<string, number> = { 'w-n': HW * 2, 'w-s': HW * 2, 'w-e': HD * 2, 'w-w': HD * 2 };
  const holders = new Map<string, THREE.Group>();
  for (const [id, s] of Object.entries(SOCK)) {
    const h = new THREE.Group();
    h.position.set(...s.p);
    h.rotation.y = s.ry ?? 0;
    site.add(h);
    holders.set(id, h);
  }
  // the heart's axle on a little chimney post
  const post = cyl(site, 0.025, 0.025, 0.62, iron(), 0, 0.12 + WALL_H + 0.31, HD + 0.02, 10);
  post.visible = false;
  const houseGlow = sprite(site, '#ffcf7a', 2.6, 0, 0.6, 0, 0);
  const houseLight = new THREE.PointLight('#ffb860', 0, 3.5, 1.6);
  houseLight.position.set(0, 0.4, 0);
  site.add(houseLight);
  ctx.addLight(0, 3.4, -0.6, '#fff0d0', 8, 8, false);

  // ---- the building plan on the left wall and the engraving on the base
  const plan = new THREE.Group();
  plan.position.set(-7.9, 2.3, -1.2);
  plan.rotation.y = Math.PI / 2;
  g.add(plan);
  box(plan, 2.0, 1.4, 0.05, wood('#3a2410'), 0, 0, -0.01);
  plane(plan, 1.86, 1.26, std('#ffffff', { map: paperTex(['צפון ↑', 'יסודות · קירות · פתחים · גג · לב'], { title: 'תוכנית הבנייה', size: 34, w: 640, h: 440, bg: '#e8f0f8', ink: '#1a3a6a' }) }), 0, 0, 0.02);
  ctx.addLight(-6.6, 3.2, -1.2, '#fff0d8', 3.5, 5, false);
  // the two house plans (they used to hang in the plans room): only one matches the original record from the trust room
  [['תוכנית מס׳ 128', 'דלת במערב · 2 חלונות לגן'], ['תוכנית מס׳ 746', 'דלת במזרח · 3 חלונות לגן']].forEach(([title, line], k) => {
    const pg = new THREE.Group();
    pg.position.set(-7.9, 2.6, k ? 3.3 : 0.75); // either side of the timber post at z 2
    pg.rotation.y = Math.PI / 2;
    g.add(pg);
    box(pg, 1.1, 0.8, 0.04, wood('#3a2410'), 0, 0, -0.01);
    // unlit, so the lamps near the corner never wash the print out: it reads the same from anywhere in the room
    plane(pg, 1.0, 0.7, new THREE.MeshBasicMaterial({ color: '#c8c8c8', map: paperTex([line], { title, size: 30, w: 512, h: 360, bg: '#1d4a7a', ink: '#e6f0ff' }) }), 0, 0, 0.02);
  });
  const engr = plane(g, 0.36, 0.12, std('#ffffff', { map: paperTex(['הצד המעוטר החוצה'], { size: 40, w: 512, h: 170, bg: '#c8a060', ink: '#3a2008' }) }), 1.9, 0.95, -0.15, 0);
  engr.rotation.x = -0.4;

  // ---- the shelf of parts on the right wall (the parts lying in the room)
  const shelf = new THREE.Group();
  shelf.position.set(7.55, 0, -1.4);
  shelf.rotation.y = -Math.PI / 2;
  g.add(shelf);
  box(shelf, 3.6, 2.6, 0.8, wood('#3a2416'), 0, 1.3, -0.1);
  for (let k = 0; k < 3; k++) box(shelf, 3.5, 0.05, 0.7, wood('#6a4428'), 0, 0.5 + k * 0.75, 0.0);
  const items = (ctx.scenario?.items ?? []).filter((i) => i.zone === 'cc-home').map((i) => i.id);
  const shelfParts = new Map<string, THREE.Object3D>();
  items.forEach((id, k) => {
    const p = partModel(id);
    const row = k % 3, col = Math.floor(k / 3);
    p.position.set(-1.5 + col * 0.55, 0.53 + row * 0.75, 0.05);
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

  // ---- state
  const build = pd<{ stages?: { id: string; sockets: { id: string }[] }[] }>(ctx, 'cc6-build');
  const stages = build.stages ?? [];
  let world = new Set<string>();
  let done = false, lit = 0, heartTurn = 0;
  const shownKey = new Map<string, string>();

  return {
    apply(s: RoomSnapshot) {
      world = new Set(s.worldItems);
      const m = mechIn(s, 'cc6-build');
      const slots = m?.slots ?? {};
      const backs = m?.backs ?? {};
      const progress = m?.progress ?? 0;
      done = s.phase === 'completed' || s.puzzles.find((p) => p.id === 'cc6-build')?.status === 'solved';
      stages.forEach((st, k) => st.sockets.forEach((sock) => {
        const h = holders.get(sock.id)!;
        const item = slots[sock.id] ?? '';
        const rot = Number(backs[sock.id] ?? 0);
        const fixed = k < progress || done;
        const key = `${item}@${rot}:${fixed}`;
        if (shownKey.get(sock.id) === key) return;
        shownKey.set(sock.id, key);
        h.clear();
        if (!item) return;
        const part = sock.id.startsWith('w-') ? wallPart(item, rot, WALL_LEN[sock.id]) : partModel(item);
        if (sock.id === 'r-west') part.rotation.z = item === 'cc-roof-flat' ? 0 : 0.5;
        if (sock.id === 'r-east') part.rotation.z = item === 'cc-roof-flat' ? 0 : -0.5;
        if (!fixed) part.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh && !Array.isArray(mesh.material)) {
            mesh.material = (mesh.material as THREE.Material).clone();
            (mesh.material as THREE.Material).transparent = true;
            (mesh.material as THREE.Material).opacity = 0.82;
          }
        });
        h.add(part);
      }));
      post.visible = progress >= 4 || done;
      for (const [id, p] of shelfParts) p.visible = world.has(id);
    },
    update(dt, t) {
      lit = approach(lit, done ? 1 : 0, dt, 0.8);
      (houseGlow.material as THREE.SpriteMaterial).opacity = lit * (0.45 + Math.sin(t * 1.5) * 0.06);
      houseLight.intensity = lit * 2.5;
      heartTurn += dt * (done ? 1.2 : 0);
      holders.get('h-axle')!.rotation.z = -heartTurn;
      for (const a of anim) a(t, dt);
    },
  };
}


