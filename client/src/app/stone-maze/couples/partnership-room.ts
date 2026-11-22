// "הצופן הזוגי", room 2 — חדר שיתוף הפעולה: a copper-and-oak workshop. The swaying bridge over a pit (two halves on one
// axle, a lever station on each side, a brass container at its end), the gears table with its drawer, and the ball
// track board on the right wall with two brass lamps. Everything moves as the server says: the halves tilt to their
// values, the latches show, the ball rolls along the stations it passed (and falls when it fell), placed gears turn.
import * as THREE from 'three';
import { RoomSnapshot } from '../../core/models';
import { rugTexture } from '../../world/textures';
import {
  RoomCtx, RoomPart, approach, box, brass, copper, cyl, dressWalls, gearGeometry, glow, iron, mechIn, paperTex, pd, plane, sheet,
  solvedIn, sprite, std, table, textTex, wallpaperTex, wood,
} from './cc-kit';
import { BRASS, DARKIRON, IRON, STONE, bake, bx, chain, deco, gear, girder } from './cc-decor';
import { dressPartnership } from './cc-dress';

const DEG = Math.PI / 180;
const STEP_DEG = 6;
const HALF = 2.6;
const BRIDGE_Y = 1.25;
const BRIDGE_Z = -2.5;
/** The pit under the bridge: a real opening in the floor, [x0, x1, z0, z1], and how deep it goes. */
const PIT: [number, number, number, number] = [-3.2, 3.2, BRIDGE_Z - 0.85, BRIDGE_Z + 0.85];
const PIT_DEPTH = 3.2;

const GEARS: Record<string, { r: number; teeth: number; mat: () => THREE.Material }> = {
  'cc-gear-r3-24': { r: 3, teeth: 24, mat: copper }, 'cc-gear-r3-20': { r: 3, teeth: 20, mat: copper },
  'cc-gear-r1-8': { r: 1, teeth: 8, mat: () => brass() }, 'cc-gear-r2-16': { r: 2, teeth: 16, mat: iron }, 'cc-gear-r2-14': { r: 2, teeth: 14, mat: iron },
};
const UNIT = 0.08;
/** Each half of the bridge and its station share a colour: the left one blue, the right one amber. */
const SIDE_COLOR = ['#3a8ad8', '#e0962a'];
const SIDE_NAME = ['החצי השמאלי', 'החצי הימני'];

function trackTileTex(kind: string, wet: boolean) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#3a2614'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#6a4424'; g.lineWidth = 6; g.strokeRect(3, 3, 122, 122);
  g.strokeStyle = wet ? '#ffcf6a' : '#b8b8c4'; g.lineWidth = 18; g.lineCap = 'butt';
  g.beginPath();
  // rotation 0: S joins east–west, L joins north–east (as on the server)
  if (kind === 'S') { g.moveTo(0, 64); g.lineTo(128, 64); } else { g.moveTo(64, 0); g.quadraticCurveTo(64, 64, 128, 64); }
  g.stroke();
  g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 3;
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildPartnershipRoom(ctx: RoomCtx): RoomPart {
  const g = ctx.group;
  const anim: ((t: number, dt: number) => void)[] = [];
  dressWalls(ctx, wallpaperTex('#3a4a3a', '#c89a5a', 'stripe', [8, 3]), '#4a3018');
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 3.0), std('#ffffff', { map: rugTexture('#2a3a4a', '#c8904a', 5), roughness: 0.95 }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(-4.8, 0.01, 3.6);
  g.add(rug);

  // ---- the pit and the bridge
  const dressing = deco(ctx, anim);
  dressPartnership(dressing, PIT);
  const rim = brass({ color: '#8a6a3a', roughness: 0.5 });
  for (const dz of [-0.88, 0.88]) box(g, 6.6, 0.08, 0.1, rim, 0, 0.04, BRIDGE_Z + dz);
  for (const dx of [-3.25, 3.25]) box(g, 0.1, 0.08, 1.86, rim, dx, 0.04, BRIDGE_Z);
  const pitGlow = sprite(g, '#ff7a3a', 4, 0, -1.6, BRIDGE_Z, 0.25);
  // the axle in the middle, on a stone pier
  bx(dressing.s, 0.56, BRIDGE_Y + PIT_DEPTH - 0.05, 0.56, STONE('#8a8076', [1, 3]), 0, (BRIDGE_Y - 0.05 - PIT_DEPTH) / 2, BRIDGE_Z);
  bx(dressing.s, 0.7, 0.14, 0.7, DARKIRON(), 0, BRIDGE_Y - 0.12, BRIDGE_Z);
  const axle = cyl(g, 0.08, 0.08, 0.9, brass(), 0, BRIDGE_Y, BRIDGE_Z, 18);
  axle.rotation.x = Math.PI / 2;
  // the start platform and the container at the far end
  bx(dressing.s, 0.6, BRIDGE_Y + 0.1 + PIT_DEPTH, 0.7, STONE('#8a8076', [1, 3]), -HALF - 0.35, (BRIDGE_Y + 0.1 - PIT_DEPTH) / 2, BRIDGE_Z);
  const cupPts: THREE.Vector2[] = [];
  for (let k = 0; k <= 8; k++) cupPts.push(new THREE.Vector2(0.12 + (k / 8) * 0.12, (k / 8) * 0.3));
  const cup = new THREE.Mesh(new THREE.LatheGeometry(cupPts, 28), brass({ side: THREE.DoubleSide, roughness: 0.22 }));
  cup.position.set(HALF + 0.3, BRIDGE_Y - 0.55, BRIDGE_Z);
  g.add(cup);
  bx(dressing.s, 0.5, BRIDGE_Y - 0.55 + PIT_DEPTH, 0.5, STONE('#8a8076', [1, 3]), HALF + 0.3, (BRIDGE_Y - 0.55 - PIT_DEPTH) / 2, BRIDGE_Z);
  const cupGlow = sprite(g, '#ffd98a', 1.2, HALF + 0.3, BRIDGE_Y - 0.3, BRIDGE_Z, 0);

  const halves: THREE.Group[] = [];
  const latchLamps: THREE.Mesh[] = [];
  const plank = std('#ffffff', { map: wallpaperTex('#7a5230', '#3a2412', 'stripe', [6, 1]), roughness: 0.7 });
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0, BRIDGE_Y, BRIDGE_Z);
    const half = box(pivot, HALF, 0.08, 0.5, plank, side * HALF / 2, 0, 0);
    half.castShadow = true;
    for (const dz of [-0.27, 0.27]) box(pivot, HALF, 0.14, 0.04, copper(), side * HALF / 2, 0.06, dz);
    // station marks along the half
    for (let k = 1; k <= 2; k++) box(pivot, 0.03, 0.01, 0.5, std('#f0d090', { emissive: '#ffcf7a', emissiveIntensity: 0.4 }), side * k * 1.3, 0.045, 0);
    // the half's own colour (the same as its station's sign): blue on the left, amber on the right
    box(pivot, 0.18, 0.012, 0.5, std(SIDE_COLOR[side < 0 ? 0 : 1], { emissive: SIDE_COLOR[side < 0 ? 0 : 1], emissiveIntensity: 0.35 }), side * (HALF - 0.15), 0.047, 0);
    g.add(pivot);
    halves.push(pivot);
  }
  // the iron gantry over the pit: two columns, a riveted girder, pulleys and a chain down to the end of each half
  for (const sx of [-1, 1]) {
    bx(dressing.s, 0.3, 5.0, 0.3, IRON(), sx * 3.75, 2.5, PIT[2] - 0.35);
    bx(dressing.s, 0.5, 0.2, 0.5, DARKIRON(), sx * 3.75, 0.1, PIT[2] - 0.35);
    bx(dressing.s, 0.24, 0.24, 0.9, IRON(), sx * 3.75, 4.9, BRIDGE_Z - 0.75);
  }
  girder(dressing, -3.9, 3.9, 5.0, BRIDGE_Z);
  const pulleys = [-1, 1].map((sx) => gear(dressing, sx * 2.3, 4.72, BRIDGE_Z + 0.22, 0, 0.2, 12, 0, BRASS(), 0.06));
  const chains = [-1, 1].map((sx) => chain(dressing, new THREE.Vector3(sx * 2.3, 4.55, BRIDGE_Z), new THREE.Vector3(sx * 2.3, BRIDGE_Y, BRIDGE_Z), 0.07));
  const hub = gear(dressing, 0, BRIDGE_Y, BRIDGE_Z + 0.48, 0, 0.3, 16, 0, BRASS(), 0.06);
  const tipFrom = [-1, 1].map((sx) => new THREE.Vector3(sx * 2.3, 4.55, BRIDGE_Z));
  const tip = new THREE.Vector3();

  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.12, 24, 16), std('#d8d8e0', { metalness: 0.95, roughness: 0.12 }));
  g.add(ball);
  const ballGlow = sprite(ball, '#bfe0ff', 0.6, 0, 0, 0, 0.3);

  // the two lever stations. On each: a green lever that raises the end of its half, a red one that lowers it, a brass
  // bolt that latches the half (its lamp turns red), engraved plates under them, a sign in the half's colour, and a small
  // model of the half that tilts with it. The plunger by the start platform releases the ball. No window: these are used
  // in the room (cc-layout.ts), and the server decides what happens.
  const levers: THREE.Group[] = [];
  const minis: THREE.Group[] = [];
  const plate = (parent: THREE.Object3D, text: string, x: number, y: number, z: number, w = 0.27, color = '#2a1608', bg = '#e8d6a8') =>
    plane(parent, w, w * 0.5, new THREE.MeshBasicMaterial({ map: textTex(text, { color, bg, w: 256, h: 128, size: 58 }) }), x, y, z);
  for (const side of [-1, 1]) {
    const i = side < 0 ? 0 : 1;
    const st = new THREE.Group();
    st.position.set(side * 3.7, 0, -0.6);
    box(st, 0.95, 0.95, 0.7, wood('#4a2c16'), 0, 0.475, 0);
    box(st, 1.0, 0.06, 0.8, brass({ color: '#8a6a3a' }), 0, 0.98, 0);
    // the same order on both stations, left to right: raise (green), lower (red), bolt
    const ctl = [[-0.28, '#2fae55', '▲ הרמה'], [0, '#c8321e', '▼ הורדה']];
    for (const [x, color, label] of ctl as [number, string, string][]) {
      const arm = new THREE.Group();
      arm.position.set(x, 1.01, 0.15);
      box(st, 0.1, 0.03, 0.22, iron(), x, 1.02, 0.15);
      cyl(arm, 0.022, 0.022, 0.42, iron(), 0, 0.21, 0, 10);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), std(color, { roughness: 0.35, emissive: color, emissiveIntensity: 0.25 }));
      knob.position.y = 0.44;
      arm.add(knob);
      st.add(arm);
      levers.push(arm);
      plate(st, label, x, 0.8, 0.356, 0.25, '#ffffff', color);
    }
    // the bolt and its lamp
    const bolt = box(st, 0.2, 0.07, 0.1, brass(), 0.28, 1.05, 0.15);
    bolt.castShadow = false;
    box(st, 0.05, 0.12, 0.05, brass(), 0.36, 1.08, 0.15);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 10), glow('#3a6a3a'));
    lamp.position.set(0.28, 1.17, 0.15);
    st.add(lamp);
    latchLamps.push(lamp);
    plate(st, '🔒 בריח', 0.28, 0.8, 0.356, 0.25, '#2a1608', '#d8b870');
    // the sign in the half's colour, and the small model of the half
    box(st, 0.06, 1.0, 0.06, iron(), 0, 1.5, -0.3);
    plate(st, SIDE_NAME[i], 0, 2.0, -0.26, 0.9, '#ffffff', SIDE_COLOR[i]);
    const mini = new THREE.Group();
    mini.position.set(0, 1.62, -0.25);
    box(mini, 0.06, 0.06, 0.06, brass(), 0, 0, 0);
    box(mini, 0.55, 0.035, 0.12, std(SIDE_COLOR[i], { emissive: SIDE_COLOR[i], emissiveIntensity: 0.3 }), side * 0.27, 0, 0);
    st.add(mini);
    minis.push(mini);
    g.add(st);
  }
  // the release plunger by the start platform
  const plunger = new THREE.Group();
  plunger.position.set(-4.6, 0, -2.5);
  cyl(plunger, 0.16, 0.2, 0.95, iron(), 0, 0.475, 0, 16);
  cyl(plunger, 0.2, 0.2, 0.05, brass(), 0, 0.97, 0, 20);
  const press = cyl(plunger, 0.13, 0.13, 0.08, std('#c8321e', { roughness: 0.3, emissive: '#7a1008', emissiveIntensity: 0.4 }), 0, 1.03, 0, 24);
  plate(plunger, 'שחרור הכדור', 0, 0.68, 0.21, 0.36);
  g.add(plunger);
  ctx.addLight(-4.4, 2.2, -1.9, '#ffc890', 1.6, 3.5);
  sheet(g, 0.5, 0.32, paperTex(['שני חצאים', 'על ציר אחד'], { size: 52, w: 512, h: 320, bg: '#d8c49a' }), 0, 0.86, -0.2);
  box(g, 0.6, 0.84, 0.4, wood('#3a2410'), 0, 0.42, -0.2);
  ctx.addLight(0, 3.6, BRIDGE_Z + 0.6, '#ffd9a8', 7, 8, false);
  ctx.addLight(-3.7, 2.4, -0.4, '#ffb070', 2.5, 4);
  ctx.addLight(3.7, 2.4, -0.4, '#ffb070', 2.5, 4);

  // ---- the gears table: the motor and three pins, the spare gears lying beside, the drawer
  table(g, 2.4, 1.4, 1.0, -5.4, 3.4, '#5a3a1e');
  const gearsAt = new THREE.Group();
  gearsAt.position.set(-5.9, 1.09, 3.25);
  g.add(gearsAt);
  const motor = new THREE.Mesh(gearGeometry(2 * UNIT, 16), iron());
  motor.rotation.x = -Math.PI / 2;
  gearsAt.add(motor);
  cyl(gearsAt, 0.07, 0.09, 0.1, std('#2a2a2e', { metalness: 0.7 }), 0, -0.04, 0, 16);
  const pinX = [5, 9, 12].map((u) => u * UNIT);
  const pins = pinX.map((x) => {
    cyl(gearsAt, 0.012, 0.012, 0.1, brass(), x, 0.02, 0, 8);
    const holder = new THREE.Group();
    holder.position.set(x, 0.01, 0);
    gearsAt.add(holder);
    return holder;
  });
  const spare = new THREE.Group();
  spare.position.set(-5.4, 1.08, 3.85);
  g.add(spare);
  const spareMesh = new Map<string, THREE.Object3D>();
  Object.keys(GEARS).forEach((id, k) => {
    const m = new THREE.Mesh(gearGeometry(GEARS[id].r * UNIT, GEARS[id].teeth), GEARS[id].mat());
    m.rotation.x = -Math.PI / 2;
    m.position.set(-0.9 + k * 0.45, 0.01, 0);
    spare.add(m);
    spareMesh.set(id, m);
  });
  const drawer = box(g, 0.8, 0.14, 0.6, wood('#6a4424'), -5.4, 0.86, 2.75);
  const drawerGlow = sprite(g, '#ffd98a', 0.8, -5.4, 0.95, 2.5, 0);
  sheet(g, 0.7, 0.5, paperTex(['5 · 4 · 3', '×8'], { size: 64, bg: '#cbd8e8', ink: '#1a3a6a', w: 448, h: 320 }), -4.55, 1.09, 3.0, 0.15);
  // the blueprint on the left wall
  const bp = plane(g, 1.4, 1.0, std('#ffffff', { map: paperTex(['מנוע ← 5 ← 4 ← 3'], { size: 44, bg: '#1d4a7a', ink: '#e6f0ff', w: 560, h: 400 }) }), -7.92, 2.4, 1.4, Math.PI / 2);
  bp.castShadow = false;
  ctx.addLight(-5.4, 2.8, 3.4, '#ffcf90', 4, 5.5);

  // ---- the ball track board on the right wall
  const track = pd<{ tiles?: string[]; source?: { row: number }; tank?: { row: number; col: number }; checkpoints?: string[] }>(ctx, 'cc2-track');
  const tiles = track.tiles ?? ['LLSLLS', 'LLLLSL', 'LLLLLL', 'SLSLLS'];
  const rows = tiles.length, cols = tiles[0].length, T = 0.42;
  const tb = new THREE.Group();
  tb.position.set(7.88, 2.25, 2.4);
  tb.rotation.y = -Math.PI / 2;
  g.add(tb);
  box(tb, cols * T + 0.6, rows * T + 0.5, 0.08, wood('#3a2210'), 0, 0, -0.04);
  const tileMeshes: { mesh: THREE.Mesh; kind: string; wet: boolean; key: string }[] = [];
  const mats = new Map<string, THREE.Material>();
  const mat = (kind: string, wet: boolean) => {
    const k = kind + wet;
    if (!mats.has(k)) mats.set(k, std('#ffffff', { map: trackTileTex(kind, wet), roughness: 0.6, emissive: wet ? '#ffb040' : '#000000', emissiveIntensity: wet ? 0.35 : 0 }));
    return mats.get(k)!;
  };
  tiles.forEach((row, r) => [...row].forEach((kind, c) => {
    const m = plane(tb, T - 0.03, T - 0.03, mat(kind, false), (c - (cols - 1) / 2) * T, ((rows - 1) / 2 - r) * T, 0.01);
    tileMeshes.push({ mesh: m, kind, wet: false, key: `${r},${c}` });
  }));
  const ends = (r: number, c: number) => new THREE.Vector3((c - (cols - 1) / 2) * T, ((rows - 1) / 2 - r) * T, 0.06);
  const src = new THREE.Mesh(new THREE.SphereGeometry(0.08, 14, 10), std('#d8d8e0', { metalness: 0.9, roughness: 0.15 }));
  src.position.copy(ends(track.source?.row ?? 1, -0.85));
  tb.add(src);
  const tank = cyl(tb, 0.12, 0.1, 0.18, brass(), 0, 0, 0, 18);
  tank.position.copy(ends(track.tank?.row ?? 3, (track.tank?.col ?? 5) + 0.85));
  const tankGlow = sprite(tb, '#ffd98a', 0.7, tank.position.x, tank.position.y, 0.15, 0);
  const cpLamps = (track.checkpoints ?? []).map((cp) => {
    const [r, c] = cp.split(',').map(Number);
    const at = ends(r, c);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), glow('#4a3010'));
    lamp.position.set(at.x + T * 0.32, at.y + T * 0.32, 0.08);
    tb.add(lamp);
    return { key: cp, lamp };
  });
  // the two valves under the board
  const valves = [-0.5, 0.5].map((x) => {
    const v = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.02, 8, 20), x < 0 ? std('#8a1a14') : brass());
    v.position.set(x, -rows * T / 2 - 0.15, 0.06);
    tb.add(v);
    return v;
  });
  // the escape hatch under the board: it swings open once the ball is in the container (the heart gear lies inside)
  const hatchAt = new THREE.Vector3(tank.position.x, -rows * T / 2 - 0.62, 0);
  box(tb, 0.56, 0.44, 0.22, wood('#2a180a'), hatchAt.x, hatchAt.y, 0.08);
  box(tb, 0.6, 0.05, 0.24, brass(), hatchAt.x, hatchAt.y + 0.24, 0.08);
  const hatch = new THREE.Group();
  hatch.position.set(hatchAt.x, hatchAt.y - 0.2, 0.2);
  box(hatch, 0.48, 0.38, 0.03, wood('#6a4424'), 0, 0.19, 0);
  cyl(hatch, 0.025, 0.025, 0.03, brass(), 0, 0.3, 0.02, 10).rotation.x = Math.PI / 2;
  tb.add(hatch);
  const hatchGlow = sprite(tb, '#ffd98a', 0.6, hatchAt.x, hatchAt.y, 0.22, 0);
  // the ball that runs the solved route on the board, and the route it follows (worked out from the tiles, as the server does)
  const runner = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), std('#e8e8f0', { metalness: 0.95, roughness: 0.1 }));
  runner.visible = false;
  tb.add(runner);
  const runnerGlow = sprite(runner, '#fff0c0', 0.5, 0, 0, 0, 0.6);
  const STEP = [[-1, 0], [0, 1], [1, 0], [0, -1]]; // N E S W as [row, col]
  const OPEN: Record<string, number[]> = { S: [1, 3], L: [0, 1] };
  const edge = (r: number, c: number, d: number) => ends(r, c).add(new THREE.Vector3(STEP[d][1] * T * 0.5, -STEP[d][0] * T * 0.5, 0));
  const route = (rot: number[]) => {
    const pts: THREE.Vector3[] = [src.position.clone()];
    const lit: { at: number; key: string }[] = [];
    let r = track.source?.row ?? 1, c = 0, from = 3;
    for (let n = 0; n < rows * cols; n++) {
      if (r < 0 || r >= rows || c < 0 || c >= cols) break;
      const open = OPEN[tiles[r][c]].map((d) => (d + (rot[r * cols + c] ?? 0)) % 4);
      if (!open.includes(from)) break;
      const to = open[0] === from ? open[1] : open[0];
      pts.push(edge(r, c, from), ends(r, c), edge(r, c, to));
      lit.push({ at: pts.length - 2, key: `${r},${c}` });
      r += STEP[to][0]; c += STEP[to][1]; from = (to + 2) % 4;
    }
    pts.push(tank.position.clone().setZ(0.12));
    return { pts, lit };
  };
  let run: { pts: THREE.Vector3[]; lit: { at: number; key: string }[]; t: number; len: number[] } | null = null;
  let hatchOpen = 0, hatchTarget = 0;

  sheet(g, 0.3, 0.22, paperTex(['שני פנסים'], { size: 56, w: 384, h: 256 }), 6.9, 1.02, 4.7);
  box(g, 1.0, 0.98, 0.9, wood('#3a2410'), 6.9, 0.49, 4.7);
  ctx.addLight(6.6, 3.4, 2.4, '#ffd9a8', 4.5, 6, false);

  // tool crate, oil can, workshop lamps
  box(g, 1.0, 0.7, 0.7, wood('#6a4a2a'), 5.6, 0.35, -5.8);
  cyl(g, 0.12, 0.16, 0.3, std('#3a5a3a', { metalness: 0.5 }), 6.4, 0.85, -5.7, 14);
  ctx.addLight(0, 4.8, 2.0, '#ffc07a', 6, 12);

  bake(dressing);

  // ---- state
  const data = pd<{ start?: number[]; joint?: number; stations?: number }>(ctx, 'cc2-bridge');
  const stations = data.stations ?? 4;
  const val = [...(data.start ?? [-2, 2])], shown = [...val];
  let latched = [false, false];
  let progress = 0;
  let solvedBridge = false, solvedGears = false, solvedTrack = false;
  let play: { path: number[]; fall: boolean; t: number; key: string } | null = null;
  let lastKey = '';
  let pressT = 9;
  const slots: Record<string, string> = {};
  let world = new Set<string>();

  const stationX = (p: number) => -HALF + (p * 2 * HALF) / stations;
  const surfaceY = (x: number) => {
    const a = x <= 0 ? shown[0] : shown[1];
    return BRIDGE_Y + 0.16 - x * Math.tan(a * STEP_DEG * DEG);
  };

  return {
    apply(s: RoomSnapshot, live: boolean) {
      const m = mechIn(s, 'cc2-bridge');
      if (m?.rotations?.length === 2) { val[0] = m.rotations[0]; val[1] = m.rotations[1]; }
      latched = [!!m?.levers?.[0], !!m?.levers?.[1]];
      solvedBridge = solvedIn(s, 'cc2-bridge');
      const found = (m?.found ?? []).map(Number);
      const key = `${found.join(',')}|${m?.revealed ?? ''}|${m?.misses ?? 0}|${m?.progress ?? 0}`;
      const fell = ['steep', 'joint', 'bounced'].includes(m?.revealed ?? '');
      if (live && key !== lastKey && found.length > 1) play = { path: found, fall: fell, t: 0, key };
      else if (live && key !== lastKey && fell && found.length) play = { path: found, fall: true, t: 0, key };
      if (play && play.t === 0) pressT = 0;
      lastKey = key;
      progress = solvedBridge ? stations : m?.progress ?? 0;
      // the gears: placed on their pins; the others lie on the table
      const gm = mechIn(s, 'cc2-gears');
      for (const k of Object.keys(slots)) delete slots[k];
      Object.assign(slots, gm?.slots ?? {});
      world = new Set(s.worldItems);
      solvedGears = solvedIn(s, 'cc2-gears');
      ['g1', 'g2', 'g3'].forEach((slot, i) => {
        const want = slots[slot] ?? '';
        if (pins[i].userData['item'] === want) return;
        pins[i].clear();
        pins[i].userData['item'] = want;
        const spec = GEARS[want];
        if (spec) {
          const gm2 = new THREE.Mesh(gearGeometry(spec.r * UNIT, spec.teeth), spec.mat());
          gm2.rotation.x = -Math.PI / 2;
          pins[i].add(gm2);
        }
      });
      for (const [id, mesh] of spareMesh) mesh.visible = world.has(id);
      // the track
      const tm = mechIn(s, 'cc2-track');
      const wet = new Set(tm?.found ?? []);
      const was = solvedTrack;
      solvedTrack = solvedIn(s, 'cc2-track');
      if (solvedTrack && !was && live) {
        // the run starts a moment later, once the puzzle window has closed
        const r = route(tm?.rotations ?? []);
        const len = [0];
        for (let k = 1; k < r.pts.length; k++) len.push(len[k - 1] + r.pts[k].distanceTo(r.pts[k - 1]));
        run = { ...r, t: -1.4, len };
        hatchTarget = 0;
      } else if (solvedTrack && !run) hatchTarget = 1;
      if (!solvedTrack) { hatchTarget = 0; run = null; }
      tileMeshes.forEach((t, i) => {
        t.mesh.rotation.z = -((tm?.rotations?.[i] ?? 0) * Math.PI) / 2;
        const w = wet.has(t.key) || solvedTrack;
        if (w !== t.wet) { t.wet = w; t.mesh.material = mat(t.kind, w); }
      });
      cpLamps.forEach((c) => (c.lamp.material as THREE.MeshBasicMaterial).color.set(wet.has(c.key) || solvedTrack ? '#ffd76a' : '#4a3010'));
      (valves[0] as THREE.Mesh).rotation.z = tm?.levers?.[1] ? Math.PI / 2 : 0;
    },
    update(dt, t) {
      for (let i = 0; i < 2; i++) {
        shown[i] = approach(shown[i], val[i], dt, 5);
        halves[i].rotation.z = -shown[i] * STEP_DEG * DEG;
        minis[i].rotation.z = -shown[i] * STEP_DEG * DEG;
        (latchLamps[i].material as THREE.MeshBasicMaterial).color.set(latched[i] ? '#ff5a3a' : '#5ae07a');
        const a = halves[i].rotation.z, sx = i ? 1 : -1, r = HALF * 0.88;
        tip.set(Math.cos(a) * sx * r, BRIDGE_Y + 0.05 + Math.sin(a) * sx * r, BRIDGE_Z);
        chains[i](tipFrom[i], tip);
        pulleys[i].rotation.z = a * 8 * sx;
      }
      hub.rotation.z = (halves[0].rotation.z + halves[1].rotation.z) * 3;
      pressT += dt;
      press.position.y = 1.03 - (pressT < 0.35 ? Math.sin((pressT / 0.35) * Math.PI) * 0.045 : 0);
      levers.forEach((l, k) => (l.rotation.x = Math.sin(t * 0.9 + k) * 0.02));
      // the ball: rolling along the last path, falling into the pit, or resting at its station
      if (play) {
        play.t += dt;
        const per = 0.45;
        const k = Math.min(play.path.length - 1, Math.floor(play.t / per));
        const f = Math.min(1, (play.t - k * per) / per);
        const a = play.path[k], b = play.path[Math.min(play.path.length - 1, k + 1)];
        const x = stationX(a + (b - a) * f);
        const done = play.t >= per * (play.path.length - 1);
        if (!done) ball.position.set(x, surfaceY(x), BRIDGE_Z);
        else if (play.fall) {
          const ft = play.t - per * (play.path.length - 1);
          ball.position.y -= dt * (2 + ft * 9);
          if (ft > 0.9) play = null;
        } else play = null;
      } else {
        const x = solvedBridge ? HALF + 0.3 : stationX(progress);
        ball.position.set(x, solvedBridge ? BRIDGE_Y - 0.3 : surfaceY(x), BRIDGE_Z);
      }
      ball.rotation.z = -ball.position.x / 0.12;
      (ballGlow.material as THREE.SpriteMaterial).opacity = 0.25 + Math.sin(t * 3) * 0.08;
      (cupGlow.material as THREE.SpriteMaterial).opacity = solvedBridge ? 0.55 : 0.08;
      (pitGlow.material as THREE.SpriteMaterial).opacity = 0.18 + Math.sin(t * 0.8) * 0.06;
      // gears: the motor always turns slowly; once the train is right, every gear turns with it at its ratio
      const w = solvedGears ? 1.4 : 0.25;
      motor.rotation.z += dt * w;
      pins.forEach((p, i) => {
        const spec = GEARS[p.userData['item'] ?? ''];
        if (!spec || !solvedGears) return;
        p.rotation.y += dt * w * (2 / spec.r) * (i % 2 ? 1 : -1);
      });
      drawer.position.z = approach(drawer.position.z, solvedGears ? 2.45 : 2.75, dt, 3);
      (drawerGlow.material as THREE.SpriteMaterial).opacity = solvedGears ? 0.5 : 0;
      src.position.y += Math.sin(t * 2) * 0.0004;
      // the ball runs the route at a steady pace, lighting the brass lamps it passes; then the hatch opens
      if (run) {
        run.t += dt;
        const d = Math.max(0, run.t) * 1.5, total = run.len[run.len.length - 1];
        let k = 1;
        while (k < run.len.length - 1 && run.len[k] < d) k++;
        const f = Math.min(1, Math.max(0, (d - run.len[k - 1]) / Math.max(1e-4, run.len[k] - run.len[k - 1])));
        runner.visible = run.t > 0 && d < total + 0.4;
        runner.position.lerpVectors(run.pts[k - 1], run.pts[k], f);
        src.visible = run.t <= 0;
        if (d >= total) {
          runner.position.y -= (d - total) * 0.4;
          if (d > total + 0.4) { run = null; hatchTarget = 1; }
        }
        cpLamps.forEach((c) => {
          const passed = run ? run.lit.some((l) => l.key === c.key && run!.len[l.at] <= d) : true;
          (c.lamp.material as THREE.MeshBasicMaterial).color.set(passed ? '#fff2a0' : '#4a3010');
          c.lamp.scale.setScalar(passed ? 1.5 : 1);
        });
      } else src.visible = !solvedTrack;
      (runnerGlow.material as THREE.SpriteMaterial).opacity = 0.5 + Math.sin(t * 8) * 0.1;
      hatchOpen = approach(hatchOpen, hatchTarget, dt, 1.6);
      hatch.rotation.x = hatchOpen * 1.45;
      (hatchGlow.material as THREE.SpriteMaterial).opacity = hatchOpen * 0.7;
      (tankGlow.material as THREE.SpriteMaterial).opacity = solvedTrack && !run ? 0.6 : 0;
      for (const a of anim) a(t, dt);
    },
  };
}
