// "הצופן הזוגי", room 3 — חדר האמון: an old archive in cool blue-grey under a warm desk lamp. The velvet board of eight
// look-alike keys, the steel document cabinet and its lock, the reading desk with the four documents, the events board,
// the nine-drawer cabinet with its red seals, and three safes in a row. Keys leave the board when one is in the lock;
// the cabinet and each safe swing open as the server solves them.
import * as THREE from 'three';
import { RoomSnapshot } from '../../core/models';
import { bookSpinesTexture, rugTexture } from '../../world/textures';
import {
  RoomCtx, RoomPart, approach, box, brass, cyl, dressWalls, glow, iron, mechIn, paperTex, plane, sheet, solvedIn, sprite, statusIn, std,
  table, textTex, wallpaperTex, wood,
} from './cc-kit';
import { bake, deco } from './cc-decor';
import { dressTrust } from './cc-dress';

interface KeySpec { teeth: number; head: 'round' | 'clover' | 'square'; long: boolean; double: boolean }

/** The look of a key, read from its description in the game content ("שלוש שיניים · ראש תלתן · ארוך · חריץ כפול"). */
export function keySpec(description: string): KeySpec {
  return {
    teeth: description.includes('שתי') ? 2 : description.includes('ארבע') ? 4 : 3,
    head: description.includes('עגול') ? 'round' : description.includes('מרובע') ? 'square' : 'clover',
    long: !description.includes('קצר'),
    double: description.includes('כפול'),
  };
}

export function keyModel(spec: KeySpec, mat: THREE.Material) {
  const g = new THREE.Group();
  const len = spec.long ? 0.34 : 0.22;
  if (spec.head === 'round') {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.016, 10, 24), mat);
    ring.position.y = 0.06;
    g.add(ring);
  } else if (spec.head === 'square') {
    for (const [w, h, x, y] of [[0.13, 0.025, 0, 0.12], [0.13, 0.025, 0, 0.0], [0.025, 0.13, -0.055, 0.06], [0.025, 0.13, 0.055, 0.06]] as [number, number, number, number][]) box(g, w, h, 0.02, mat, x, y, 0);
  } else {
    for (const [x, y] of [[0, 0.1], [-0.045, 0.05], [0.045, 0.05]] as [number, number][]) {
      const leaf = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.012, 8, 18), mat);
      leaf.position.set(x, y, 0);
      g.add(leaf);
    }
  }
  box(g, 0.02, len, 0.018, mat, 0, -len / 2, 0);
  for (let k = 0; k < spec.teeth; k++) box(g, 0.035, 0.02, 0.016, mat, 0.022, -len + 0.02 + k * 0.04, 0);
  const grooves = spec.double ? [-0.004, 0.004] : [0];
  for (const x of grooves) box(g, 0.002, len * 0.8, 0.02, std('#1a1408'), x, -len / 2, 0.001);
  return g;
}

export function buildArchiveRoom(ctx: RoomCtx): RoomPart {
  const g = ctx.group;
  const anim: ((t: number, dt: number) => void)[] = [];
  dressWalls(ctx, wallpaperTex('#2e3a4e', '#8a9ab8', 'grid', [10, 4]), '#2a2a30', '#1e1e24');
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 4.2), std('#ffffff', { map: rugTexture('#22304a', '#b89a5a', 9), roughness: 0.95 }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0, 0.01, -0.6);
  g.add(rug);

  // archive shelves full of boxes and files at the front corners
  // (built with real books and file boxes by the room's dressing, cc-dress.ts)

  // ---- the velvet key board on the left wall
  const board = new THREE.Group();
  board.position.set(-7.9, 1.8, -1.2);
  board.rotation.y = Math.PI / 2;
  g.add(board);
  box(board, 2.2, 1.2, 0.08, wood('#3a2410'), 0, 0, 0);
  plane(board, 2.0, 1.0, std('#4a0e18', { roughness: 1 }), 0, 0, 0.045);
  const items = ctx.scenario?.items ?? [];
  const keyIds = Array.from({ length: 8 }, (_, k) => `cc-key-${k + 1}`);
  const keyMeshes = new Map<string, THREE.Object3D>();
  const keyMat = brass({ color: '#c8a050', roughness: 0.3 });
  keyIds.forEach((id, k) => {
    const spec = keySpec(items.find((i) => i.id === id)?.description ?? '');
    const key = keyModel(spec, keyMat);
    key.position.set(-0.84 + k * 0.24, 0.28, 0.07);
    board.add(key);
    keyMeshes.set(id, key);
    cyl(board, 0.01, 0.01, 0.04, brass(), -0.84 + k * 0.24, 0.38, 0.07, 6).rotation.x = Math.PI / 2;
    plane(board, 0.12, 0.08, new THREE.MeshBasicMaterial({ map: textTex(String(k + 1), { color: '#f0d090', w: 128, h: 96, size: 70 }), transparent: true }), -0.84 + k * 0.24, -0.38, 0.05);
  });
  ctx.addLight(-6.6, 2.8, -1.2, '#ffd9a8', 3.5, 5, false);

  // ---- the steel document cabinet on the back wall, with its lock
  const cab = new THREE.Group();
  cab.position.set(-4.2, 0, -6.6);
  g.add(cab);
  const steel = std('#5a6270', { metalness: 0.7, roughness: 0.4 });
  box(cab, 2.2, 2.2, 0.7, steel, 0, 1.1, 0);
  const inside = box(cab, 2.0, 2.0, 0.02, std('#20242a'), 0, 1.1, 0.25);
  inside.castShadow = false;
  const doors: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const hinge = new THREE.Group();
    hinge.position.set(side * 1.05, 0, 0.36);
    box(hinge, 1.05, 2.1, 0.04, std('#6a7280', { metalness: 0.7, roughness: 0.35 }), -side * 0.525, 1.1, 0);
    box(hinge, 0.04, 0.3, 0.05, brass(), -side * 0.95, 1.2, 0.03);
    cab.add(hinge);
    doors.push(hinge);
  }
  const lockPlate = box(cab, 0.18, 0.26, 0.03, brass(), 0, 1.35, 0.39);
  lockPlate.castShadow = false;
  const keyInLock = new THREE.Group();
  keyInLock.position.set(0, 1.35, 0.42);
  cab.add(keyInLock);
  sheet(g, 0.22, 0.3, paperTex(['14'], { size: 140, w: 256, h: 352 }), -5.0, 1.55, -6.55).rotation.set(0, 0, 0);
  const lockGlow = sprite(cab, '#ffe0a0', 0.6, 0, 1.35, 0.5, 0);
  ctx.addLight(-4.2, 3.2, -5.4, '#c8d8ff', 3, 5, false);

  // ---- the reading desk: four documents, a magnifier, the diary and a green banker's lamp
  table(g, 4.6, 1.6, 0.98, 0.2, -1.2, '#3a2416');
  const docs = ['214', '357', '489', '562'].map((n, k) => {
    const d = sheet(g, 0.5, 0.62, paperTex([], { title: 'מסמך ' + n, size: 34, w: 384, h: 480 }), -1.05 + k * 0.7, 1.03, -1.55, (k - 1.5) * 0.06);
    return d;
  });
  const mag = new THREE.Group();
  mag.position.set(-1.8, 1.04, -0.85);
  const lens = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.012, 10, 28), brass());
  lens.rotation.x = Math.PI / 2;
  mag.add(lens);
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.075, 24), std('#cfe6ff', { transparent: true, opacity: 0.3, roughness: 0.05 }));
  glass.rotation.x = -Math.PI / 2;
  glass.position.y = 0.003;
  mag.add(glass);
  box(mag, 0.16, 0.02, 0.025, wood('#2a1408'), 0.15, 0, 0);
  g.add(mag);
  const diary = box(g, 0.34, 0.06, 0.46, std('#6a1e1a', { roughness: 0.7 }), 1.9, 1.05, -0.9);
  diary.rotation.y = 0.25;
  const lamp = new THREE.Group();
  lamp.position.set(2.0, 1.02, -1.75);
  cyl(lamp, 0.1, 0.12, 0.04, brass(), 0, 0.02, 0, 16);
  cyl(lamp, 0.012, 0.012, 0.36, brass(), 0, 0.2, 0, 8);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.16, 0.12, 20, 1, true), std('#1e5a32', { side: THREE.DoubleSide, roughness: 0.3, emissive: '#0a2a14', emissiveIntensity: 0.5 }));
  shade.position.y = 0.42;
  shade.rotation.z = 0.2;
  lamp.add(shade);
  sprite(lamp, '#fff0c0', 0.5, 0, 0.36, 0, 0.7);
  g.add(lamp);
  ctx.addLight(2.0, 1.6, -1.6, '#ffe2b0', 5, 5, false);
  for (const x of [-1.2, 1.4]) {
    const chair = new THREE.Group();
    chair.position.set(x, 0, 0.3);
    box(chair, 0.5, 0.06, 0.5, wood('#4a2a16'), 0, 0.5, 0);
    box(chair, 0.5, 0.6, 0.05, wood('#4a2a16'), 0, 0.82, 0.23);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(chair, 0.04, 0.5, 0.04, wood('#3a2010'), sx * 0.21, 0.25, sz * 0.21);
    g.add(chair);
  }

  // ---- the events board on the right wall
  frame(g, 1.6, 1.1, paperTex(['12 · 14 · 15'], { title: 'לוח האירועים', size: 44, bg: '#c9b48a', w: 512, h: 352 }), 7.92, 2.3, -2.6, -Math.PI / 2);

  // ---- the nine-drawer cabinet with red wax seals on 2, 6 and 7
  const dc = new THREE.Group();
  dc.position.set(7.55, 0, 1.6);
  dc.rotation.y = -Math.PI / 2;
  g.add(dc);
  box(dc, 1.8, 1.8, 0.8, wood('#4a2c18'), 0, 0.9, 0);
  for (let k = 0; k < 9; k++) {
    const r = Math.floor(k / 3), c = k % 3;
    const x = -0.55 + c * 0.55, y = 1.45 - r * 0.5;
    box(dc, 0.5, 0.42, 0.03, wood('#6a4424'), x, y, 0.41);
    cyl(dc, 0.025, 0.025, 0.03, brass(), x - 0.15, y - 0.1, 0.44, 10).rotation.x = Math.PI / 2;
    // a big, bold brass-framed number on every drawer, readable from across the room
    box(dc, 0.3, 0.22, 0.01, brass(), x, y + 0.06, 0.428);
    plane(dc, 0.27, 0.19, new THREE.MeshBasicMaterial({ map: textTex(String(k + 1), { color: '#1a0c04', bg: '#f4e6c0', w: 128, h: 96, size: 84, font: 'Georgia, serif' }) }), x, y + 0.06, 0.435);
    if ([1, 5, 6].includes(k)) {
      const seal = cyl(dc, 0.05, 0.05, 0.015, std('#a01a14', { roughness: 0.5 }), x + 0.16, y - 0.13, 0.44, 16);
      seal.rotation.x = Math.PI / 2;
    }
  }
  ctx.addLight(6.4, 2.8, 1.6, '#ffd9a8', 3, 5, false);

  // ---- three safes in a row on the back wall
  const safes = [2.6, 4.0, 5.4].map((x, k) => {
    const s = new THREE.Group();
    s.position.set(x, 0, -6.55);
    g.add(s);
    box(s, 1.2, 0.5, 0.9, std('#3a3a40', { metalness: 0.5 }), 0, 0.25, 0);
    const body = box(s, 1.1, 1.1, 0.85, std(['#1f4a30', '#5a1a16', '#1a2a4a'][k], { metalness: 0.7, roughness: 0.32 }), 0, 1.05, 0);
    body.castShadow = true;
    box(s, 0.9, 0.9, 0.02, std('#0e0e10'), 0, 1.05, 0.42);
    const hinge = new THREE.Group();
    hinge.position.set(-0.5, 1.05, 0.44);
    box(hinge, 0.98, 0.98, 0.06, std('#4a4a52', { metalness: 0.85, roughness: 0.28 }), 0.49, 0, 0);
    const dial = cyl(hinge, 0.11, 0.11, 0.04, brass({ roughness: 0.2 }), 0.49, 0.1, 0.05, 28);
    dial.rotation.x = Math.PI / 2;
    box(hinge, 0.2, 0.04, 0.04, iron(), 0.49, -0.2, 0.05);
    // the first safe carries no number: only a red wax seal, like the ones on the drawers it remembers
    if (k === 0) {
      const seal = cyl(hinge, 0.075, 0.075, 0.02, std('#a01a14', { roughness: 0.5 }), 0.49, 0.36, 0.04, 20);
      seal.rotation.x = Math.PI / 2;
      cyl(hinge, 0.05, 0.05, 0.022, std('#c42a1e', { roughness: 0.45 }), 0.49, 0.36, 0.045, 16).rotation.x = Math.PI / 2;
    } else plane(hinge, 0.2, 0.14, new THREE.MeshBasicMaterial({ map: textTex(['א', 'ב', 'ג'][k], { color: '#f0d090', w: 128, h: 96, size: 72 }), transparent: true }), 0.49, 0.36, 0.035);
    s.add(hinge);
    // each safe has its own face (looks only; the locks are the same)
    const gilt = brass({ roughness: 0.25 });
    if (k === 0) {
      // A: banker's green with a gilded frame round the door and gilded feet
      for (const sy of [-1, 1]) box(s, 1.12, 0.05, 0.05, gilt, 0, 1.05 + sy * 0.52, 0.43);
      for (const sx of [-1, 1]) box(s, 0.05, 1.08, 0.05, gilt, sx * 0.54, 1.05, 0.43);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(s, 0.06, 0.08, 0.1, gilt, sx * 0.52, 0.05, sz * 0.38, 12);
      const ring = cyl(hinge, 0.16, 0.16, 0.02, gilt, 0.49, 0.1, 0.035, 32);
      ring.rotation.x = Math.PI / 2;
    } else if (k === 1) {
      // B: oxblood with riveted iron bands and a spoked wheel
      for (const y of [0.68, 1.42]) {
        box(s, 1.14, 0.08, 0.89, iron(), 0, y, 0);
        for (let r = 0; r < 6; r++) cyl(s, 0.018, 0.018, 0.02, iron(), -0.45 + r * 0.18, y, 0.45, 6).rotation.x = Math.PI / 2;
      }
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.018, 8, 28), iron());
      wheel.position.set(0.49, -0.12, 0.09);
      hinge.add(wheel);
      for (let r = 0; r < 4; r++) box(hinge, 0.34, 0.025, 0.025, iron(), 0.49, -0.12, 0.09).rotation.z = (r * Math.PI) / 4;
    } else {
      // C: navy with brass corner caps, a keyhole escutcheon and a small pediment
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) box(s, 0.14, 0.14, 0.88, gilt, sx * 0.5, 1.05 + sy * 0.5, 0);
      const pg = new THREE.Group();
      pg.position.set(0, 1.6, 0);
      pg.scale.set(1, 0.32, 1);
      s.add(pg);
      box(pg, 0.76, 0.76, 0.82, std('#1a2a4a', { metalness: 0.7, roughness: 0.32 }), 0, 0, 0).rotation.z = Math.PI / 4;
      box(s, 1.16, 0.05, 0.9, gilt, 0, 1.62, 0);
      const esc = cyl(hinge, 0.07, 0.07, 0.015, gilt, 0.49, -0.2, 0.07, 20);
      esc.rotation.x = Math.PI / 2;
      box(hinge, 0.025, 0.06, 0.02, std('#050505'), 0.49, -0.22, 0.08);
    }
    const note = sheet(s, 0.3, 0.22, paperTex([], { w: 256, h: 192 }), 0, 0.62, 0.15);
    const halo = sprite(s, '#ffe0a0', 0.9, 0, 1.05, 0.5, 0);
    return { hinge, dial, note, halo };
  });
  ctx.addLight(4.0, 3.0, -5.2, '#d8e2ff', 4, 6, false);

  // the card on a reading stand, the plumber's note on a pipe by the left wall
  table(g, 1.4, 0.8, 0.98, 5.3, 4.1, '#3a2416');
  sheet(g, 0.22, 0.14, paperTex(['ראש עגול'], { size: 48, w: 320, h: 200, bg: '#f0e6c8' }), 5.4, 1.03, 4.1, 0.2);
  const pipe = cyl(g, 0.07, 0.07, 1.8, std('#7a5a3a', { metalness: 0.7, roughness: 0.4 }), -7.7, 0.9, 2.2, 14);
  pipe.castShadow = true;
  sheet(g, 0.2, 0.15, paperTex(['קצר?'], { size: 52, w: 256, h: 192 }), -6.9, 0.85, 2.2, 0.4).rotation.x = -1.2;
  ctx.addLight(0, 4.9, 2.4, '#d0dcff', 5, 12);
  ctx.addLight(-4.0, 4.0, 3.0, '#ffc890', 3, 7);

  // ---- the room's dressing (architecture, furniture, lamps, details): merged per material
  const dressing = deco(ctx, anim);
  dressTrust(dressing);
  bake(dressing);

  // ---- state
  let world = new Set<string>();
  let docsOn = false, cabOpen = 0, cabTarget = 0;
  const safeOpen = [0, 0, 0], safeTarget = [0, 0, 0], safeHalo = [0, 0, 0];
  let lockedKey = '';

  return {
    apply(s: RoomSnapshot) {
      world = new Set(s.worldItems);
      const placed = mechIn(s, 'cc3-key')?.slots?.['lock'] ?? '';
      for (const [id, k] of keyMeshes) k.visible = world.has(id) && placed !== id;
      if (placed !== lockedKey) {
        lockedKey = placed;
        keyInLock.clear();
        if (placed) {
          const key = keyModel(keySpec(items.find((i) => i.id === placed)?.description ?? ''), keyMat);
          key.rotation.x = -Math.PI / 2;
          key.position.z = 0.15;
          keyInLock.add(key);
        }
      }
      cabTarget = solvedIn(s, 'cc3-key') ? 1 : 0;
      docsOn = statusIn(s, 'cc3-documents') !== 'locked';
      docs.forEach((d) => (d.visible = docsOn));
      ['cc3-safe-a', 'cc3-safe-b', 'cc3-safe-c'].forEach((id, k) => {
        safeTarget[k] = solvedIn(s, id) ? 1 : 0;
        safeHalo[k] = statusIn(s, id) === 'active' ? 1 : 0;
        safes[k].note.visible = solvedIn(s, id) && k < 2;
      });
    },
    update(dt, t) {
      cabOpen = approach(cabOpen, cabTarget, dt, 1.6);
      doors[0].rotation.y = -cabOpen * 1.7;
      doors[1].rotation.y = cabOpen * 1.7;
      keyInLock.rotation.z = cabOpen * Math.PI / 2;
      (lockGlow.material as THREE.SpriteMaterial).opacity = cabTarget ? 0 : 0.18 + Math.sin(t * 2) * 0.06;
      safes.forEach((sf, k) => {
        safeOpen[k] = approach(safeOpen[k], safeTarget[k], dt, 1.4);
        sf.hinge.rotation.y = -safeOpen[k] * 1.9;
        sf.dial.rotation.y = safeOpen[k] * 6;
        (sf.halo.material as THREE.SpriteMaterial).opacity = safeHalo[k] * (0.15 + Math.sin(t * 2 + k) * 0.06);
      });
      for (const a of anim) a(t, dt);
    },
  };
}

function frame(parent: THREE.Object3D, w: number, h: number, map: THREE.Texture, x: number, y: number, z: number, rotY: number) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = rotY;
  box(g, w + 0.12, h + 0.12, 0.05, wood('#3a2410'), 0, 0, -0.01);
  plane(g, w, h, std('#ffffff', { map, roughness: 0.9 }), 0, 0, 0.02);
  for (const [px, py] of [[-w / 2 + 0.08, h / 2 - 0.08], [w / 2 - 0.08, h / 2 - 0.08]]) {
    const pin = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), glow('#c02a20'));
    pin.position.set(px, py, 0.03);
    g.add(pin);
  }
  parent.add(g);
  return g;
}
