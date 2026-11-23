// "הצופן הזוגי", room 2 — חדר שיתוף הפעולה: a copper-and-oak workshop. The gears table with its drawer and the blueprint
// on the wall, and the ball track board on the right wall with two brass lamps. Everything moves as the server says:
// placed gears turn, the track's tiles turn and the ball runs the solved route. (The swaying bridge over a pit was taken
// out of this room; its puzzle is kept in the scenario's "retired" section.)
import * as THREE from 'three';
import { RoomSnapshot } from '../../core/models';
import { rugTexture } from '../../world/textures';
import {
  RoomCtx, RoomPart, approach, box, brass, canvasTex, copper, cyl, dressWalls, gearGeometry, glow, iron, mechIn, paperTex, pd, plane, sheet,
  solvedIn, sprite, std, table, textTex, wallpaperTex, wood,
} from './cc-kit';
import { BRASS, DARKIRON, IRON, STONE, bake, bx, chain, deco, gear, girder } from './cc-decor';
import { dressPartnership } from './cc-dress';

const GEARS: Record<string, { r: number; teeth: number; mat: () => THREE.Material }> = {
  'cc-gear-r3-24': { r: 3, teeth: 24, mat: copper }, 'cc-gear-r3-20': { r: 3, teeth: 20, mat: copper },
  'cc-gear-r1-8': { r: 1, teeth: 8, mat: () => brass() }, 'cc-gear-r2-16': { r: 2, teeth: 16, mat: iron }, 'cc-gear-r2-14': { r: 2, teeth: 14, mat: iron },
};
const UNIT = 0.08;
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

/**
 * The gear train blueprint on the wall: the motor (radius 2, turning clockwise), the three pins at 5, 4 and 3 from each
 * other, the drawer that opens only when the last gear turns counter-clockwise, and the rule of the teeth in the margin.
 */
function blueprintTex() {
  return canvasTex('cc2-blueprint-v2', 1120, 800, (g, w, h) => {
    g.fillStyle = '#1d4a7a'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(230,240,255,.12)'; g.lineWidth = 2;
    for (let x = 0; x < w; x += 40) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y < h; y += 40) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    const ink = '#e6f0ff', gold = '#ffd76a';
    g.fillStyle = ink; g.strokeStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 54px "Frank Ruehl CLM", "David", serif';
    g.fillText('רכבת הגלגלים', w / 2, 62);
    // left to right on paper: the motor, then the pins (a unit is 44 px: 5, 4 and 3 units apart)
    const U = 44, cy = 380, mx = 150;
    const xs = [mx, mx + 5 * U, mx + 9 * U, mx + 12 * U];
    g.setLineDash([10, 10]); g.lineWidth = 3;
    g.beginPath(); g.moveTo(mx, cy); g.lineTo(xs[3] + 150, cy); g.stroke(); g.setLineDash([]);
    g.lineWidth = 5; g.beginPath(); g.arc(mx, cy, 2 * U, 0, Math.PI * 2); g.stroke();
    g.font = 'bold 34px "Frank Ruehl CLM", "David", serif';
    g.fillText('מנוע', mx, cy + 2 * U + 40);
    g.fillText('רדיוס 2', mx, cy + 2 * U + 80);
    [1, 2, 3].forEach((n) => {
      const x = xs[n];
      g.beginPath(); g.arc(x, cy, 10, 0, Math.PI * 2); g.fill();
      g.fillText('פין ' + n, x, cy + 2 * U + 40);
    });
    // the distances, above the axis
    const dist = (a: number, b: number, t: string) => {
      const y = cy - 2 * U - 50;
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(a, y); g.lineTo(b, y); g.stroke();
      g.beginPath(); g.moveTo(a, y - 14); g.lineTo(a, y + 14); g.moveTo(b, y - 14); g.lineTo(b, y + 14); g.stroke();
      g.font = 'bold 40px Arial, sans-serif'; g.fillText(t, (a + b) / 2, y - 30);
    };
    dist(xs[0], xs[1], '5'); dist(xs[1], xs[2], '4'); dist(xs[2], xs[3], '3');
    // a turning arrow: clockwise on the motor, counter-clockwise wanted on the last pin
    const turn = (x: number, r: number, cw: boolean, color: string) => {
      g.strokeStyle = color; g.fillStyle = color; g.lineWidth = 6;
      const a0 = -Math.PI * 0.85, a1 = -Math.PI * 0.15;
      g.beginPath(); g.arc(x, cy, r, cw ? a0 : a1, cw ? a1 : a0, !cw); g.stroke();
      const end = cw ? a1 : a0, tx = x + r * Math.cos(end), ty = cy + r * Math.sin(end);
      const dir = end + (cw ? Math.PI / 2 : -Math.PI / 2);
      g.beginPath();
      g.moveTo(tx + 22 * Math.cos(dir), ty + 22 * Math.sin(dir));
      g.lineTo(tx + 13 * Math.cos(dir + 2.2), ty + 13 * Math.sin(dir + 2.2));
      g.lineTo(tx + 13 * Math.cos(dir - 2.2), ty + 13 * Math.sin(dir - 2.2));
      g.closePath(); g.fill();
    };
    turn(mx, 2 * U + 22, true, '#9be3b4');
    turn(xs[3], 2 * U - 10, false, gold);
    g.font = 'bold 30px "Frank Ruehl CLM", "David", serif';
    g.fillStyle = '#9be3b4'; g.fillText('המנוע: עם כיוון השעון', mx + 40, cy + 2 * U + 125);
    g.fillStyle = gold; g.fillText('הגלגל האחרון: נגד כיוון השעון — רק אז המגירה נפתחת', w / 2 + 80, cy + 2 * U + 175);
    // the margin
    g.fillStyle = ink; g.font = 'italic bold 36px "Frank Ruehl CLM", "David", serif';
    g.fillText('„כל הגלגלים באותו פסיעה: מספר השיניים הוא פי 8 מהרדיוס.”', w / 2, h - 60);
  });
}

export function buildPartnershipRoom(ctx: RoomCtx): RoomPart {
  const g = ctx.group;
  const anim: ((t: number, dt: number) => void)[] = [];
  dressWalls(ctx, wallpaperTex('#3a4a3a', '#c89a5a', 'stripe', [8, 3]), '#4a3018');
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 3.0), std('#ffffff', { map: rugTexture('#2a3a4a', '#c8904a', 5), roughness: 0.95 }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(-4.8, 0.01, 3.6);
  g.add(rug);

  // ---- the room's dressing (a whole floor: there is no bridge and no pit in this room any more)
  const dressing = deco(ctx, anim);
  dressPartnership(dressing);
  ctx.addLight(0, 3.6, -1.9, '#ffd9a8', 7, 8, false);

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
  const bp = plane(g, 1.4, 1.0, std('#ffffff', { map: blueprintTex() }), -7.92, 2.4, 1.4, Math.PI / 2);
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
  let solvedGears = false, solvedTrack = false;
  const slots: Record<string, string> = {};
  let world = new Set<string>();

  return {
    apply(s: RoomSnapshot, live: boolean) {
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
