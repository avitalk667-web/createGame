// "הצופן הזוגי" — the dressing of the six rooms, on the shared decor kit (cc-decor.ts).
//
// THE DESIGN LANGUAGE (one house, six rooms):
//   An old mansion of puzzles and mechanisms, in warm cinematic light. Every room is a real place: a floor with its own
//   material and border, panelled walls up to a carved crown, a coffered or timbered ceiling, columns and door casings,
//   furniture in layers (the room's centrepiece, its working furniture, set dressing, and small details), and light that
//   always comes from something in the room (chandeliers, lanterns, lamps, candles, windows). Shared materials: walnut
//   and oak, brass and gold, dark iron, copper, stone, velvet, paper. Each room has its own palette and motif:
//     1 Sounds       crimson velvet, gold, dark walnut · musical frieze · candlelit salon
//     2 Partnership  soot stone, iron, copper, amber · gear frieze · industrial pendants over a real pit
//     3 Trust        deep navy, walnut, brass, banker's green · key frieze · focused desk lamps in a dark archive
//     5 Letters      burgundy, rosewood, cream paper, gold · envelope frieze · romantic lamplight and a sunset window
//     6 Home         honey oak, sandstone, terracotta · house frieze · exposed roof trusses and lanterns
// Nothing here is a puzzle: every station keeps its place, and the furniture added here is listed as obstacles in
// cc-layout.ts. All assets are made in code (no third-party models or textures).
import * as THREE from 'three';
import {
  BRASS, COPPER, DARKIRON, Deco, EMIT, GLASS, GOLD, IRON, S, STONE, TEXM, W, armchair, ashlarTex, at, barrel, blocks, bookRow, bookStack,
  bookcase, bottles, bx, candlestick, ceiling, chair, chain, chandelier, cm, crate, curtain, cy, deskLamp, deskTable, doorCasing, drawers,
  dust, flagstoneTex, floor, floorLamp, friezeTex, gauge, gear, girder, globe, inkwell, keyBoard, painting, panelTex, papers, parquetTex,
  pendant, pilasters, pinned, pipe, pl, plankTex, rep, rug, sconce, scrolls, sketchTex, toolWall, truss, upperWalls, valve, wallClock, windowBay,
} from './cc-decor';
import { blueprintTex, paperTex, std } from './cc-kit';

const L = Math.PI / 2; // faces +x (on the left wall)
const R = -Math.PI / 2; // faces −x (on the right wall)
const F = Math.PI; // faces −z (on the front wall)

/** Small instruments for shelves: drums, a flute, a horn, a small harp. */
function instruments(d: Deco, shelf: THREE.Object3D, k: number, w: number, y: number) {
  if (k % 2 === 0) { bookRow(d, shelf, -w / 2 + 0.08, 0, y, 0.02, 0.26, ['#3a1a14', '#5a2a1a', '#2a1a10', '#7a5a2a'], 0.3); }
  const x0 = k % 2 === 0 ? 0.25 : -w / 2 + 0.3;
  const drum = cy(shelf, 0.12, 0.12, 0.16, W('#7a3a1a'), x0, y + 0.08, 0.02, 18);
  drum.castShadow = false;
  cy(shelf, 0.125, 0.125, 0.02, S('#e8dcc0', 0.6), x0, y + 0.17, 0.02, 18);
  const fl = cy(shelf, 0.015, 0.015, 0.5, BRASS(), x0 + 0.35, y + 0.03, 0.05, 8);
  fl.rotation.z = L;
  const horn = cy(shelf, 0.02, 0.08, 0.2, BRASS(), x0 + 0.65, y + 0.1, 0.02, 14);
  horn.rotation.z = 0.3;
}

// ------------------------------------------------------------------------------------------------ 1 · Sounds

export function dressSounds(d: Deco) {
  const walnut = W('#2a1408'), gold = GOLD();
  floor(d, TEXM('parq-snd', () => parquetTex('#8a5a32', [7, 6]), 0.55), { border: gold, skirting: walnut });
  upperWalls(d, TEXM('upw-snd', () => rep(panelTex('#4a1612', '#a8803a'), [10, 1]), 0.85), TEXM('frz-snd', () => friezeTex('#2a0a08', '#d8b060', 'notes'), 0.6), gold);
  ceiling(d, TEXM('ceil-snd', () => rep(panelTex('#3a1210', '#9a7432'), [4, 6]), 0.8), walnut, [[0, 1.5], [0, -3.6]]);
  pilasters(d, [-5.4, 0.7, 6.2], W('#3a1a0c'), gold);
  doorCasing(d, -1, W('#3a1a0c'), gold);
  doorCasing(d, 1, W('#3a1a0c'), gold);
  chandelier(d, 0, 4.7, -3.6, 10, 0.8);
  dust(d, -2, 2, 2.5, 4.6, -5, -2, 40, '#ffd9a0');

  // pleated velvet drapes in the back corners and by the entrance (they sway a little)
  for (const [x, z, ry] of [[-6.6, -6.82, 0], [6.6, -6.82, 0]] as [number, number, number][]) curtain(d, x, 5.1, z, ry, 1.7, 5.0, '#6a1418', 0.5);
  for (const [x, z, ry] of [[-7.82, 6.0, L], [7.82, 6.0, R]] as [number, number, number][]) curtain(d, x, 5.1, z, ry, 1.6, 5.0, '#6a1418', 0.5);
  for (const x of [-6.6, 6.6]) bx(d.s, 2.2, 0.3, 0.2, gold, x, 5.15, -6.8);

  // the bell rack's carved arch and velvet back panel: the bells are the wall's centrepiece, not a prop
  const ba = at(d.s, -7.9, 0, -1.6, L);
  bx(ba, 3.2, 3.2, 0.04, S('#3a0c10', 0.95), 0, 1.75, 0.0);
  const arch = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.1, 10, 32, Math.PI), gold);
  arch.position.set(0, 3.0, 0.08);
  ba.add(arch);
  for (const sx of [-1, 1]) { cy(ba, 0.09, 0.11, 3.0, gold, sx * 1.55, 1.5, 0.08, 14); bx(ba, 0.3, 0.2, 0.3, gold, sx * 1.55, 0.1, 0.08); }
  bx(ba, 0.5, 0.36, 0.08, gold, 0, 4.6, 0.1);
  sconce(d, 7.92, 2.9, -3.0, R);

  // the instrument cabinet (glass doors, violins inside) on the back wall
  const ic = at(d.s, 4.7, 0, -6.6);
  bx(ic, 2.0, 2.7, 0.5, W('#2a1408'), 0, 1.35, 0);
  bx(ic, 2.15, 0.16, 0.6, gold, 0, 2.78, 0.02);
  for (let k = 0; k < 3; k++) {
    const vx = -0.6 + k * 0.6;
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 18, 12), W('#8a3a14'));
    body.scale.set(1, 1.6, 0.35);
    body.position.set(vx, 1.15, 0.05);
    ic.add(body);
    bx(ic, 0.04, 0.55, 0.03, W('#1a0c06'), vx, 1.65, 0.07);
  }
  bx(ic, 1.8, 0.03, 0.4, W('#4a2412'), 0, 1.9, 0);
  bookRow(d, ic, -0.85, 0.85, 1.92, 0.02, 0.3, ['#3a0e0c', '#5a2a14', '#2a1a10', '#8a6a2a'], 0.3);
  const glass = bx(ic, 1.86, 2.4, 0.02, GLASS(), 0, 1.3, 0.27);
  glass.castShadow = false;
  for (const x of [-0.93, 0, 0.93]) bx(ic, 0.04, 2.4, 0.04, gold, x, 1.3, 0.28);

  // shelves of small instruments and music books on the left wall, between the bells and the piano
  bookcase(d, -7.72, 1.9, L, 2.4, 2.3, { tone: '#3a1a0c', dep: 0.42, shelves: 4, fill: (sh, k, w, y) => instruments(d, sh, k, w, y) });

  // a reading corner: armchair, side table with music and a candle, a floor lamp by the piano
  armchair(d, 3.6, 4.4, -2.5, '#5a1418');
  deskTable(d, 4.4, 5.3, 0, 0.7, 0.7, 0.72, '#2a1408');
  papers(d, 4.4, 0.73, 5.3, 3, 0.2);
  candlestick(d, 4.6, 0.73, 5.1);
  floorLamp(d, -3.9, 6.1, '#e0b880');

  // portraits above the wainscot
  painting(d, -7.93, 3.4, -4.4, L, 1.0, 1.3, 7);
  painting(d, 7.93, 3.4, -4.4, R, 1.0, 1.3, 12);
  painting(d, 2.9, 3.6, -6.93, 0, 1.3, 0.95, 19);
}

// ------------------------------------------------------------------------------------------------ 2 · Partnership

export function dressPartnership(d: Deco, pit: [number, number, number, number]) {
  const stone = TEXM('flag-prt', () => flagstoneTex('#8a8278', [5, 4]), 0.9);
  floor(d, stone, { holes: [pit], border: IRON(), skirting: S('#3a3430', 0.9) });
  // the pit itself: stone walls going down into the glow
  const [x0, x1, z0, z1] = pit, depth = 3.2, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const wallM = TEXM('ash-pit', () => ashlarTex('#5a5048', [3, 2]), 0.95);
  pl(d.s, x1 - x0, depth, wallM, cx, -depth / 2, z0 + 0.01, 0);
  pl(d.s, x1 - x0, depth, wallM, cx, -depth / 2, z1 - 0.01, F);
  pl(d.s, z1 - z0, depth, wallM, x0 + 0.01, -depth / 2, cz, L);
  pl(d.s, z1 - z0, depth, wallM, x1 - 0.01, -depth / 2, cz, R);
  pl(d.s, x1 - x0, z1 - z0, cm('embers', () => new THREE.MeshBasicMaterial({ color: '#5a1a06', toneMapped: false })), cx, -depth, cz, 0, -L);
  dust(d, x0 + 0.3, x1 - 0.3, -depth + 0.2, 1.4, z0 + 0.2, z1 - 0.2, 70, '#ff8a3a');
  // an iron guard rail along the long sides of the pit
  for (const z of [z0 - 0.12, z1 + 0.12]) {
    for (let x = x0 + 0.2; x <= x1 - 0.1; x += 1.0) cy(d.s, 0.03, 0.03, 0.9, DARKIRON(), x, 0.45, z, 8);
    const rail = cy(d.s, 0.03, 0.03, x1 - x0 - 0.3, IRON(), cx, 0.9, z, 8);
    rail.rotation.z = L;
  }

  const ash = TEXM('ash-prt', () => rep(ashlarTex('#8a7e70', [1, 1]), [10, 1]), 0.9);
  upperWalls(d, ash, TEXM('frz-prt', () => friezeTex('#2a2018', '#b8783e', 'gears'), 0.6), DARKIRON());
  ceiling(d, TEXM('ceil-prt', () => rep(plankTex('#4a3626', [1, 1]), [4, 3]), 0.85), W('#2e1e12'));
  for (const [sx, z] of [[-1, -5.2], [-1, 0.2], [-1, 3.4], [1, -5.2], [1, 0.2], [1, 5.8]] as [number, number][]) {
    // timber posts with iron shoes
    bx(d.s, 0.3, 5.2, 0.34, W('#3a2414', [1, 3]), sx * 7.82, 2.6, z);
    bx(d.s, 0.36, 0.3, 0.4, DARKIRON(), sx * 7.8, 0.15, z);
    bx(d.s, 0.36, 0.2, 0.4, DARKIRON(), sx * 7.8, 5.1, z);
  }
  doorCasing(d, -1, STONE('#7a7066'), DARKIRON());
  doorCasing(d, 1, STONE('#7a7066'), DARKIRON());
  // iron girders across the ceiling, riveted
  for (const z of [-5.0, 0.5, 4.5]) girder(d, -7.8, 7.8, 5.95, z);

  // great wall gears on the back wall, meshing, turning slowly
  gear(d, -4.6, 3.1, -6.86, 0, 1.15, 30, 0.12, IRON(), 0.1);
  gear(d, -3.29, 4.2, -6.8, 0, 0.62, 16, -0.12 * (1.15 / 0.62), COPPER(), 0.09);
  gear(d, 4.7, 3.3, -6.86, 0, 0.95, 24, -0.1, COPPER(), 0.1);
  gear(d, 5.72, 2.35, -6.8, 0, 0.5, 13, 0.1 * (0.95 / 0.5), IRON(), 0.08);
  gear(d, 3.7, 4.17, -6.8, 0, 0.42, 11, 0.1 * (0.95 / 0.42), BRASS(), 0.07);

  // copper pipes along the back wall and down the corners, with valves and gauges
  pipe(d, [[-7.7, 5.0, -6.75], [-2.2, 5.0, -6.75], [-2.2, 4.4, -6.75]], 0.07);
  pipe(d, [[2.2, 4.4, -6.75], [2.2, 5.0, -6.75], [7.7, 5.0, -6.75], [7.7, 0.2, -6.75]], 0.07);
  pipe(d, [[-7.75, 5.0, -6.75], [-7.75, 0.2, -6.75]], 0.07);
  pipe(d, [[-7.7, 4.2, 6.7], [-2.6, 4.2, 6.7]], 0.06, IRON());
  pipe(d, [[2.6, 4.2, 6.7], [7.5, 4.2, 6.7], [7.5, 4.2, -6.6]], 0.06, IRON());
  valve(d, -7.55, 1.4, -6.75, L, 0.18);
  valve(d, 7.55, 1.5, -6.75, R, 0.18, '#2a5a2a');
  gauge(d, -7.55, 2.2, -6.2, L);
  gauge(d, 7.55, 2.3, -6.2, R);
  gauge(d, -6.4, 1.7, -6.75, 0, 0.12);
  // hanging chains with hooks in the corners
  for (const [x, z] of [[-6.8, -5.8], [6.6, 5.9], [-6.6, 5.9]] as [number, number][]) {
    chain(d, new THREE.Vector3(x, 6.4, z), new THREE.Vector3(x, 3.4, z));
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.02, 6, 14, Math.PI * 1.4), DARKIRON());
    hook.position.set(x, 3.3, z);
    d.s.add(hook);
  }

  // the workbench on the left wall with a pegboard of tools, a vise and parts
  deskTable(d, -7.25, 5.6, L, 2.4, 0.9, 0.95, '#5a3a20', false);
  toolWall(d, -7.95, 2.3, 5.6, L, 2.2);
  const vise = at(d.s, -6.95, 0.95, 4.8);
  bx(vise, 0.2, 0.16, 0.16, IRON(), 0, 0.08, 0);
  bx(vise, 0.2, 0.16, 0.04, IRON(), 0, 0.08, 0.16);
  cy(vise, 0.015, 0.015, 0.4, IRON(), 0, 0.08, 0.3, 6).rotation.x = L;
  for (let k = 0; k < 4; k++) { const gm = cy(d.s, 0.08 + k * 0.02, 0.08 + k * 0.02, 0.03, k % 2 ? BRASS() : IRON(), -7.3 + (k % 2) * 0.2, 0.97, 5.8 + k * 0.22, 10); gm.castShadow = false; }
  bottles(d, -7.4, 0.95, 6.4, 3);
  pendant(d, -6.9, 3.9, 5.6, 'cone', '#ffd090');

  // shelving of mechanical parts on the front wall, crates and barrels in the corners
  bookcase(d, 4.8, 6.68, F, 2.4, 2.6, {
    tone: '#3a2818', dep: 0.5, shelves: 4, fill: (sh, k, w, y) => {
      for (let j = 0; j < 4; j++) {
        const x = -w / 2 + 0.3 + j * (w / 4);
        if ((j + k) % 3 === 0) { const gm = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.04, 6, 14), (j + k) % 2 ? BRASS() : IRON()); gm.position.set(x, y + 0.16, 0); sh.add(gm); }
        else if ((j + k) % 3 === 1) bx(sh, 0.3, 0.2, 0.3, W('#6a4a2a'), x, y + 0.1, 0);
        else cy(sh, 0.08, 0.08, 0.24, COPPER(), x, y + 0.12, 0, 12);
      }
    },
  });
  barrel(d, -4.4, 6.3);
  barrel(d, -3.6, 6.4, 0.8, '#5a3a1e');
  crate(d, -5.2, 0, 6.3, 0.7, 0.3);
  crate(d, -5.15, 0.7, 6.3, 0.5, -0.2);
  barrel(d, 7.0, -6.1);
  crate(d, 6.5, 0, -4.9, 0.6, 0.5);

  // industrial pendants over the bridge and the stations
  pendant(d, -2.0, 4.3, -2.5, 'cone', '#ffcf8a');
  pendant(d, 2.0, 4.3, -2.5, 'cone', '#ffcf8a');
  pendant(d, -3.7, 3.8, -0.6, 'cone', '#ffcf8a');
  pendant(d, 3.7, 3.8, -0.6, 'cone', '#ffcf8a');
}

// ------------------------------------------------------------------------------------------------ 3 · Trust

export function dressTrust(d: Deco) {
  const walnut = W('#2a1a10');
  floor(d, TEXM('plank-tr', () => plankTex('#5a3a22', [4, 5]), 0.7), { border: BRASS(), skirting: walnut });
  upperWalls(d, TEXM('upw-tr', () => rep(panelTex('#1a2632', '#5a4a30'), [10, 1]), 0.85), TEXM('frz-tr', () => friezeTex('#121a24', '#c8a050', 'keys'), 0.6), walnut);
  ceiling(d, TEXM('ceil-tr', () => rep(panelTex('#1a222c', '#3a3020'), [4, 6]), 0.85), walnut, [[0, -1.2], [-4, 3.5], [4, 3.5]]);
  pilasters(d, [-4.9, 5.9], W('#24180e'), BRASS());
  doorCasing(d, -1, W('#24180e'), BRASS());
  doorCasing(d, 1, W('#24180e'), BRASS());
  // focused lamps: green globes over the desk, two lanterns over the shelves
  pendant(d, -0.8, 4.0, -1.2, 'globe', '#ffe2a8');
  pendant(d, 0.8, 4.0, -1.2, 'globe', '#ffe2a8');
  pendant(d, -4, 4.4, 3.5, 'lantern', '#ffc070');
  pendant(d, 4, 4.4, 3.5, 'lantern', '#ffc070');
  dust(d, -1.5, 1.5, 1.2, 3.8, -2.0, -0.4, 30, '#ffe8c0');

  // tall archive shelving on the front wall (ledgers and file boxes) with a library ladder
  const files = (sh: THREE.Object3D, k: number, w: number, y: number) => {
    if (k % 2) bookRow(d, sh, -w / 2 + 0.08, w / 2 - 0.08, y, 0.02, 0.3, ['#3a2a1a', '#1e2a3a', '#4a3a24', '#2a2018'], 0.34);
    else for (let j = 0; j < Math.floor(w / 0.34); j++) {
      bx(sh, 0.3, 0.26, 0.34, W(j % 2 ? '#8a6a44' : '#7a5a38'), -w / 2 + 0.2 + j * 0.34, y + 0.13, 0.02);
      pl(sh, 0.12, 0.06, S('#efe2c0', 0.9), -w / 2 + 0.2 + j * 0.34, y + 0.16, 0.2);
    }
  };
  bookcase(d, -4.6, 6.66, F, 3.0, 3.6, { tone: '#2e1e12', dep: 0.55, shelves: 6, fill: files });
  bookcase(d, 4.6, 6.66, F, 3.0, 3.6, { tone: '#2e1e12', dep: 0.55, shelves: 6, fill: files });
  const lad = at(d.s, -3.4, 0, 6.2, 0.18);
  for (const sx of [-1, 1]) { const rail = bx(lad, 0.05, 3.6, 0.05, W('#5a3a20'), sx * 0.22, 1.75, 0); rail.rotation.x = -0.12; }
  for (let k = 0; k < 9; k++) bx(lad, 0.44, 0.03, 0.06, W('#5a3a20'), 0, 0.3 + k * 0.38, 0.04 - k * 0.045);

  // the left wall: proper shelving where the old flat shelves were, the hanging keys and a portrait
  bookcase(d, -7.7, 4.4, L, 1.8, 3.4, { tone: '#2e1e12', dep: 0.45, shelves: 5, fill: files });
  bookcase(d, -7.7, 6.2, L, 1.7, 3.4, { tone: '#2e1e12', dep: 0.45, shelves: 5 });
  bookcase(d, 7.7, 4.8, R, 1.8, 3.4, { tone: '#2e1e12', dep: 0.45, shelves: 5, fill: files });
  keyBoard(d, 4.0, 3.3, -6.92, 0, 10);
  wallClock(d, -4.2, 3.9, -6.9, 0, 0.36);
  painting(d, -7.93, 3.6, -4.2, L, 1.0, 1.3, 5);
  painting(d, 7.93, 3.6, -5.2, R, 1.0, 1.3, 23);
  painting(d, 7.93, 3.5, 3.6, R, 0.8, 1.0, 31);
  // a tall wall cabinet in the back-left corner
  const wc = at(d.s, -6.85, 0, -6.6);
  bx(wc, 1.5, 3.2, 0.5, W('#24180e'), 0, 1.6, 0);
  for (const sx of [-1, 1]) {
    pl(wc, 0.66, 2.7, TEXM('cabdoor-tr', () => panelTex('#2e2014', '#6a5434'), 0.7), sx * 0.36, 1.65, 0.26);
    bx(wc, 0.03, 0.18, 0.04, BRASS(), sx * 0.06, 1.6, 0.28);
  }
  bx(wc, 1.62, 0.14, 0.58, BRASS(), 0, 3.25, 0.02);

  // a card catalogue on the right, near the reading stand
  drawers(d, 7.35, 3.25, R, 1.2, 1.3, 0.6, 5, 3, '#3a2616');
  // wax, seals and papers on the archive desk
  for (let k = 0; k < 3; k++) cy(d.s, 0.03, 0.03, 0.02, S('#9a1a14', 0.4), 1.25 + k * 0.08, 1.02, -1.75, 12);
  cy(d.s, 0.015, 0.03, 0.12, W('#3a1a0a'), 1.6, 1.07, -1.7, 8);
  bookStack(d, -1.9, 0.98, -1.75, 4, 0.3);
  armchair(d, 2.9, 0.9, -2.6, '#1e3a3a');
  floorLamp(d, 3.7, 0.3, '#d8c898');
  globe(d, -5.6, -4.6, 0.9);
  rug(d, -5.6, -3.8, 2.4, 1.6, '#2a1a3a', '#c8a050', 9);
}

// ------------------------------------------------------------------------------------------------ 5 · Letters

export function dressLetters(d: Deco) {
  const rose = W('#3a1810'), gold = GOLD();
  floor(d, TEXM('parq-lt', () => parquetTex('#7a4a2a', [7, 6]), 0.55), { border: gold, skirting: rose });
  upperWalls(d, TEXM('upw-lt', () => rep(panelTex('#3e1216', '#a8803a'), [10, 1]), 0.85), TEXM('frz-lt', () => friezeTex('#2a0a0c', '#d8b070', 'letters'), 0.6), gold);
  ceiling(d, TEXM('ceil-lt', () => rep(panelTex('#30100e', '#8a6a32'), [4, 6]), 0.8), rose, [[0, 1.5], [0, -3.6]]);
  pilasters(d, [-5.0, 6.2], W('#2e120c'), gold);
  doorCasing(d, -1, W('#2e120c'), gold);
  doorCasing(d, 1, W('#2e120c'), gold);
  chandelier(d, 0, 4.7, -3.6, 8, 0.7);
  // a sunset window on the right wall, with heavy drapes
  windowBay(d, 1, 4.6, 1.6, 2.6, 1.4, { frame: W('#3a1a10'), curtain: '#7a1e22', sky: '#ffcf9a', shaft: '#ffc890' });
  for (const [x, z] of [[-6.6, -6.82], [6.6, -6.82]] as [number, number][]) curtain(d, x, 5.1, z, 0, 1.6, 5.0, '#7a1e22', 0.5);
  for (const x of [-6.6, 6.6]) bx(d.s, 2.1, 0.3, 0.2, gold, x, 5.15, -6.8);

  // the great wall of pigeonholes on the back wall, letters waiting in some of the cells
  const ph = at(d.s, 4.0, 0, -6.6);
  bx(ph, 3.0, 3.0, 0.5, W('#3a1a10'), 0, 1.5, -0.02);
  bx(ph, 3.15, 0.14, 0.6, gold, 0, 3.07, 0);
  const cols = 8, rows = 7, cw = 2.8 / cols, ch = 2.6 / rows;
  for (let c = 0; c <= cols; c++) bx(ph, 0.025, 2.6, 0.48, W('#5a2a16'), -1.4 + c * cw, 1.6, 0.02);
  for (let r = 0; r <= rows; r++) bx(ph, 2.8, 0.025, 0.48, W('#5a2a16'), 0, 0.3 + r * ch, 0.02);
  for (let k = 0; k < 26; k++) {
    const c = (k * 5) % cols, r = (k * 3) % rows;
    const env = bx(ph, cw * 0.7, 0.012 + (k % 3) * 0.01, 0.34, S(k % 4 ? '#efe2c4' : '#e8cfc0', 0.9), -1.4 + cw * (c + 0.5), 0.3 + r * ch + 0.02 + (k % 3) * 0.01, 0.06);
    env.castShadow = false;
  }
  // bookshelves on the back wall, left of the door
  bookcase(d, -4.2, -6.66, 0, 3.0, 3.2, { tone: '#3a1a10', dep: 0.42, shelves: 6, palette: ['#5a1a1a', '#2a1a2a', '#6a4a2a', '#1e2a3a', '#8a6a3a'] });

  // a typewriter on its own small table by the window
  deskTable(d, 5.8, 5.6, R, 1.0, 0.7, 0.78, '#3a1a10');
  const tw = at(d.s, 5.8, 0.78, 5.6, R);
  bx(tw, 0.46, 0.14, 0.36, DARKIRON(), 0, 0.07, 0);
  bx(tw, 0.42, 0.1, 0.12, DARKIRON(), 0, 0.17, -0.1);
  const roller = cy(tw, 0.04, 0.04, 0.5, S('#1a1a1a', 0.5), 0, 0.24, -0.12, 14);
  roller.rotation.z = L;
  pl(tw, 0.24, 0.26, TEXM('tw-paper', () => paperTex([], { w: 256, h: 280 }), 0.9), 0, 0.36, -0.14, 0, -0.25);
  for (let r = 0; r < 3; r++) for (let k = 0; k < 9; k++) cy(tw, 0.013, 0.013, 0.02, S('#e8e0d0', 0.4), -0.17 + k * 0.042, 0.15 + r * 0.015, 0.06 + r * 0.04, 8);
  chair(d, 5.0, 5.6, L, '#3a1a10', '#6a1a1e');

  // the writing desk dressed: ink and quills, letters, envelopes, sealing wax, a lamp
  papers(d, -5.7, 0.995, 3.5, 4, 0.3);
  for (let k = 0; k < 5; k++) bx(d.s, 0.22, 0.012, 0.14, S(k % 2 ? '#efe2c4' : '#e8d4c0', 0.9), -6.0, 1.0 + k * 0.012, 3.75, 0.1 * k);
  for (let k = 0; k < 2; k++) cy(d.s, 0.016, 0.016, 0.14, S('#9a1a14', 0.4), -4.0 + k * 0.05, 1.005, 3.55, 8).rotation.z = L;
  deskLamp(d, -4.2, 0.995, 3.05, -0.4, '#a8382a');
  bx(d.s, 2.3, 0.6, 0.18, W('#3a1a10'), -5.2, 1.3, 2.86);
  for (let k = 0; k < 6; k++) bx(d.s, 0.32, 0.22, 0.02, W('#5a2a16'), -6.05 + k * 0.34, 1.32, 2.96);

  // reading corner, floor lamp, wall clock, portraits
  armchair(d, -2.9, 5.6, 2.7, '#6a1a1e');
  floorLamp(d, -7.0, 6.1, '#e8c0a0');
  wallClock(d, 7.9, 3.7, 2.5, R, 0.34);
  painting(d, -7.93, 3.7, -3.8, L, 1.0, 1.3, 15);
  painting(d, 7.93, 3.7, -6.1, R, 1.0, 0.8, 27);
  painting(d, -1.5, 5.6, 6.93, F, 1.0, 0.7, 33);
  rug(d, -5.0, 3.4, 3.4, 2.4, '#4a1418', '#d8b070', 25);

  // a line of letters strung across the room, swaying
  const line = at(d.live, 0, 4.3, 0.6);
  const strung: THREE.Object3D[] = [];
  const twine = cy(line, 0.006, 0.006, 15.8, S('#c8b088', 0.9), 0, 0, 0, 4);
  twine.rotation.z = L;
  for (let k = 0; k < 14; k++) {
    const p = at(line, -6.5 + k * 1.0, -0.02, 0);
    const env = pl(p, 0.26, 0.18, cm('env-hang' + (k % 3), () => std(['#efe2c4', '#e8d0c0', '#f2e8d8'][k % 3], { roughness: 0.9, side: THREE.DoubleSide })), 0, -0.12, 0);
    env.rotation.z = (k % 2 ? 1 : -1) * 0.1;
    cy(p, 0.012, 0.012, 0.03, W('#8a6a3a'), 0, -0.02, 0, 6);
    strung.push(p);
  }
  d.anim.push((t) => strung.forEach((p, k) => (p.rotation.x = Math.sin(t * 0.8 + k * 0.7) * 0.12)));
}

// ------------------------------------------------------------------------------------------------ 6 · Home

export function dressHome(d: Deco) {
  const oak = W('#8a5a30', [1, 3]), sand = STONE('#c8b08a', [2, 2]);
  floor(d, TEXM('plank-hm', () => plankTex('#9a7048', [4, 5]), 0.7), { border: W('#5a3a1e'), skirting: W('#5a3a1e') });
  // a stone platform under the building table
  bx(d.s, 6.4, 0.06, 4.8, TEXM('flag-hm', () => flagstoneTex('#c8b08a', [2, 2]), 0.85), 0, 0.03, -1.4);
  for (const sz of [-1, 1]) bx(d.s, 6.6, 0.1, 0.16, sand, 0, 0.05, -1.4 + sz * 2.4);
  for (const sx of [-1, 1]) bx(d.s, 0.16, 0.1, 4.8, sand, sx * 3.2, 0.05, -1.4);
  upperWalls(d, TEXM('upw-hm', () => rep(plankTex('#8a6438', [1, 1]), [6, 1]), 0.8), TEXM('frz-hm', () => friezeTex('#4a3018', '#e8c890', 'house'), 0.6), W('#5a3a1e'));
  ceiling(d, TEXM('ceil-hm', () => rep(plankTex('#7a5430', [1, 1]), [4, 3]), 0.85), W('#4a2e16'));
  // exposed roof trusses, as in a house being built
  for (const z of [-5.2, -1.4, 2.4, 5.6]) truss(d, z, oak, 5.25, 1.05);
  for (const z of [-5.0, 2.0, 5.6]) for (const sx of [-1, 1]) { bx(d.s, 0.3, 5.25, 0.3, oak, sx * 7.82, 2.62, z); bx(d.s, 0.4, 0.3, 0.4, sand, sx * 7.8, 0.15, z); }
  doorCasing(d, -1, oak, sand);
  doorCasing(d, 1, oak, sand);

  // a timber hoist over the table: two posts, a beam, a pulley and a chain with a hook above the house
  for (const sx of [-1, 1]) { bx(d.s, 0.22, 4.6, 0.22, oak, sx * 2.8, 2.3, -3.5); bx(d.s, 0.4, 0.12, 0.4, DARKIRON(), sx * 2.8, 0.06, -3.5); }
  bx(d.s, 6.0, 0.26, 0.26, oak, 0, 4.7, -3.5);
  bx(d.s, 0.24, 0.24, 2.5, oak, 0, 4.7, -2.3);
  const pulley = gear(d, 0, 4.45, -1.4, L, 0.22, 14, 0.25, IRON(), 0.06);
  pulley.castShadow = true;
  chain(d, new THREE.Vector3(0, 4.4, -1.4), new THREE.Vector3(0, 2.7, -1.4), 0.06);
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.018, 6, 14, Math.PI * 1.4), DARKIRON());
  hook.position.set(0, 2.62, -1.4);
  d.live.add(hook);

  // lanterns around the table
  for (const [x, z] of [[-2.2, -0.2], [2.2, -0.2], [-2.2, -2.6], [2.2, -2.6]] as [number, number][]) pendant(d, x, 3.7, z, 'lantern', '#ffc070');
  dust(d, -2.5, 2.5, 1.4, 4.0, -3.0, 0.2, 50, '#ffe0a8');

  // scaffolding in the back corners, loaded with bricks and stones
  for (const sx of [-1, 1]) {
    const sc = at(d.s, sx * 5.6, 0, -6.2);
    for (const px of [-1.1, 1.1]) for (const pz of [-0.4, 0.4]) cy(sc, 0.05, 0.05, 3.6, W('#9a7a50'), px, 1.8, pz, 8);
    for (const y of [1.3, 2.6]) {
      bx(sc, 2.5, 0.06, 1.0, W('#b08a5a', [3, 1]), 0, y, 0);
      const br = bx(sc, 2.5, 0.04, 0.04, W('#9a7a50'), 0, y + 0.55, 0.42);
      br.castShadow = false;
    }
    const dg = cy(sc, 0.03, 0.03, 2.6, W('#9a7a50'), 0, 1.3, 0.42, 6);
    dg.rotation.z = sx * 0.9;
    blocks(d, sx * 5.6 - 0.4, -6.2, 6, S('#a8442a', 0.85), [0.24, 0.08, 0.12]);
    for (let k = 0; k < 4; k++) bx(sc, 0.3, 0.18, 0.2, sand, -0.6 + k * 0.4, 1.42, 0);
    for (let k = 0; k < 5; k++) bx(sc, 0.22, 0.07, 0.11, S('#a8442a', 0.85), -0.8 + k * 0.32, 2.67, 0.1);
  }

  // sample doors and windows leaning on the left wall, timber and stone on the right
  for (let k = 0; k < 3; k++) {
    const fr = at(d.s, -7.7, 0, 2.9 + k * 0.85, L);
    fr.rotation.x = -0.12;
    const isWin = k === 1;
    const fw = isWin ? 0.9 : 0.8, fh = isWin ? 1.1 : 2.0;
    for (const sx of [-1, 1]) bx(fr, 0.08, fh, 0.08, W(isWin ? '#efe0c0' : '#6a3a1a'), sx * fw / 2, fh / 2 + (isWin ? 0.5 : 0), 0);
    bx(fr, fw, 0.08, 0.08, W(isWin ? '#efe0c0' : '#6a3a1a'), 0, fh + (isWin ? 0.5 : 0), 0);
    if (isWin) { bx(fr, fw, 0.08, 0.08, W('#efe0c0'), 0, 0.5, 0); bx(fr, 0.04, fh, 0.03, W('#efe0c0'), 0, 1.05, 0); const gl = bx(fr, fw - 0.08, fh - 0.08, 0.01, GLASS(), 0, 1.05, 0); gl.castShadow = false; }
    else bx(fr, fw - 0.08, fh - 0.08, 0.04, W(k ? '#8a4a22' : '#5a3a1e'), 0, fh / 2, -0.02);
  }
  for (let k = 0; k < 6; k++) bx(d.s, 2.6, 0.14, 0.18, W('#b08050'), 6.6, 0.07 + Math.floor(k / 2) * 0.14, 2.9 + (k % 2) * 0.2, 0.02 * k);
  blocks(d, 6.4, 5.6, 9, sand, [0.42, 0.24, 0.26]);
  // a sawhorse with a plank, measuring tools on a side table
  for (const sx of [-1, 1]) { const leg = bx(d.s, 0.06, 0.8, 0.06, W('#8a6a40'), 4.4 + sx * 0.25, 0.4, 2.2); leg.rotation.z = sx * 0.25; bx(d.s, 0.06, 0.8, 0.06, W('#8a6a40'), 4.4 + sx * 0.25, 0.4, 2.8).rotation.z = sx * 0.25; }
  bx(d.s, 0.12, 0.1, 0.9, W('#8a6a40'), 4.4, 0.78, 2.5);
  bx(d.s, 2.2, 0.05, 0.3, W('#c8a070'), 4.4, 0.86, 2.5, 0.1);
  const wheel = at(d.s, -5.25, 0.84, 4.5);
  const wr = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 8, 24), DARKIRON());
  wr.position.y = 0.16;
  wheel.add(wr);
  const hd = bx(wheel, 0.02, 0.6, 0.02, W('#6a4424'), 0.2, 0.4, 0);
  hd.rotation.z = -0.5;
  for (const sx of [-1, 1]) { const leg = bx(d.s, 0.012, 0.3, 0.012, BRASS(), -5.75 + sx * 0.05, 0.98, 4.7); leg.rotation.z = sx * 0.3; }

  // the front wall: shelves of miniature roofs and wall pieces, a pegboard of tools, plans on the back wall
  bookcase(d, 4.6, 6.66, F, 3.0, 2.8, {
    tone: '#6a4428', dep: 0.45, shelves: 4, fill: (sh, k, w, y) => {
      for (let j = 0; j < 5; j++) {
        const x = -w / 2 + 0.35 + j * 0.58;
        if ((j + k) % 2) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.36, 3), S(['#a8442a', '#8a5a2a', '#6a6a72'][(j + k) % 3], 0.6)); r.rotation.set(0, 0, L); r.position.set(x, y + 0.12, 0); r.scale.set(0.6, 1, 1); sh.add(r); }
        else bx(sh, 0.4, 0.22, 0.05, S('#c89a62', 0.8), x, y + 0.11, 0);
      }
    },
  });
  toolWall(d, -4.6, 2.2, 6.93, F, 2.6);
  for (const sx of [-1, 1]) pinned(d, sx * 3.1, 2.9, -6.93, 0, 1.3, 0.95, () => (sx > 0 ? sketchTex(2) : blueprintTex(0)), 'hm-plan' + sx);
  painting(d, 7.93, 3.7, 3.6, R, 1.1, 0.8, 44);
  // compass dividers standing on the table edge as a sculpture
  const cmp = at(d.s, 1.55, 1.07, -2.45);
  for (const sx of [-1, 1]) { const l = cy(cmp, 0.012, 0.004, 0.42, BRASS(), sx * 0.06, 0.2, 0, 6); l.rotation.z = sx * 0.3; }
  cy(cmp, 0.03, 0.03, 0.04, BRASS(), 0, 0.41, 0, 10);
}
