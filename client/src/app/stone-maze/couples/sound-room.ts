// "הצופן הזוגי", room 1 — חדר הצלילים: a warm music salon. The brass sound device in the middle, the rack of four bells,
// the stone symbols board, the broken wall clock with eight symbols, three paintings and the music box. The clock's two
// hands follow the server; the device's lamps light as the room is solved; the music box opens with the clock.
import * as THREE from 'three';
import { RoomSnapshot } from '../../core/models';
import { rugTexture } from '../../world/textures';
import {
  RoomCtx, RoomPart, approach, box, brass, candle, curtainTex, cyl, drawSymbol, dressWalls, frame, glow, mechIn, paperTex, pd, plane,
  sheet, solvedIn, sprite, statusIn, std, symbolTex, table, wallpaperTex, wood,
} from './cc-kit';
import { bake, deco } from './cc-decor';
import { dressSounds } from './cc-dress';

const MARKS = ['arch', 'leaf', 'wave', 'flame', 'bell', 'key', 'star', 'home'];

function paintingTex(kind: 'river' | 'lantern' | 'orchard') {
  const c = document.createElement('canvas');
  c.width = 384; c.height = 288;
  const g = c.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, 0, 288);
  sky.addColorStop(0, kind === 'lantern' ? '#1a1630' : '#f2c890'); sky.addColorStop(1, kind === 'lantern' ? '#3a2a30' : '#c88a58');
  g.fillStyle = sky; g.fillRect(0, 0, 384, 288);
  const figure = (x: number, y: number, s = 1) => {
    g.fillStyle = '#2a1a14';
    g.beginPath(); g.arc(x, y - 52 * s, 9 * s, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(x - 12 * s, y); g.lineTo(x - 7 * s, y - 42 * s); g.lineTo(x + 7 * s, y - 42 * s); g.lineTo(x + 12 * s, y); g.fill();
  };
  if (kind === 'river') {
    g.fillStyle = '#5a7a4a'; g.fillRect(0, 170, 384, 118);
    g.fillStyle = '#3a6a9a';
    g.beginPath(); g.moveTo(0, 200); g.bezierCurveTo(120, 180, 220, 250, 384, 215); g.lineTo(384, 288); g.lineTo(0, 288); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 2;
    for (let k = 0; k < 6; k++) { g.beginPath(); g.moveTo(40 + k * 55, 240 + (k % 2) * 12); g.quadraticCurveTo(60 + k * 55, 232, 80 + k * 55, 240 + (k % 2) * 12); g.stroke(); }
    figure(120, 190);
  } else if (kind === 'lantern') {
    g.fillStyle = '#2a2018'; g.fillRect(0, 210, 384, 78);
    const halo = g.createRadialGradient(230, 170, 4, 230, 170, 110);
    halo.addColorStop(0, 'rgba(255,190,90,0.9)'); halo.addColorStop(1, 'rgba(255,150,60,0)');
    g.fillStyle = halo; g.fillRect(100, 50, 260, 220);
    g.fillStyle = '#ffcc66'; g.beginPath(); g.ellipse(230, 175, 10, 18, 0, 0, Math.PI * 2); g.fill();
    figure(160, 230);
  } else {
    g.fillStyle = '#6a8a3a'; g.fillRect(0, 180, 384, 108);
    for (let k = 0; k < 6; k++) {
      const x = 30 + k * 62, y = 150 + (k % 2) * 10;
      g.fillStyle = '#4a3020'; g.fillRect(x - 4, y, 8, 40);
      g.fillStyle = '#3a6a2a'; g.beginPath(); g.arc(x, y, 26, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#f0a030'; for (let o = 0; o < 4; o++) { g.beginPath(); g.arc(x - 14 + o * 9, y - 6 + (o % 2) * 12, 4, 0, Math.PI * 2); g.fill(); }
    }
    figure(175, 255, 1.1); figure(205, 255, 1.0);
    g.strokeStyle = '#2a1a14'; g.lineWidth = 5; g.beginPath(); g.moveTo(181, 222); g.lineTo(199, 222); g.stroke();
  }
  // the little clock in the corner with its single hand
  const hand = { river: 'wave', lantern: 'flame', orchard: 'leaf' }[kind];
  const a = (MARKS.indexOf(hand) / 8) * Math.PI * 2;
  g.fillStyle = '#f4e8c8'; g.beginPath(); g.arc(340, 44, 30, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#6a4a20'; g.lineWidth = 3; g.stroke();
  g.lineWidth = 3; g.beginPath(); g.moveTo(340, 44); g.lineTo(340 + Math.sin(a) * 22, 44 - Math.cos(a) * 22); g.stroke();
  drawSymbol(g, hand, 340 + Math.sin(a) * 22, 44 - Math.cos(a) * 22, 14, '#a0302a');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function clockFaceTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(256, 256, 40, 256, 256, 256);
  grd.addColorStop(0, '#f6ecd0'); grd.addColorStop(1, '#d4bf8a');
  g.fillStyle = grd; g.beginPath(); g.arc(256, 256, 250, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#6a4a20'; g.lineWidth = 6; g.beginPath(); g.arc(256, 256, 236, 0, Math.PI * 2); g.stroke();
  MARKS.forEach((m, k) => {
    const a = (k / 8) * Math.PI * 2;
    drawSymbol(g, m, 256 + Math.sin(a) * 180, 256 - Math.cos(a) * 180, 62, '#4a2a12');
    g.lineWidth = 4; g.beginPath(); g.moveTo(256 + Math.sin(a + Math.PI / 8) * 236, 256 - Math.cos(a + Math.PI / 8) * 236);
    g.lineTo(256 + Math.sin(a + Math.PI / 8) * 214, 256 - Math.cos(a + Math.PI / 8) * 214); g.stroke();
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function symbolsBoardTex() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 384;
  const g = c.getContext('2d')!;
  g.fillStyle = '#6e6a66'; g.fillRect(0, 0, 512, 384);
  for (let k = 0; k < 900; k++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},0.05)`; g.fillRect(Math.random() * 512, Math.random() * 384, 3, 3); }
  const rows: [string, number][] = [['arch', 3], ['leaf', 8], ['wave', 1], ['flame', 6]];
  rows.forEach(([sym, dots], i) => {
    const y = 60 + i * 82;
    drawSymbol(g, sym, 400, y, 58, '#2a2420');
    g.fillStyle = '#2a2420';
    for (let d = 0; d < dots; d++) { g.beginPath(); g.arc(320 - d * 30, y, 9, 0, Math.PI * 2); g.fill(); }
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildSoundRoom(ctx: RoomCtx): RoomPart {
  const g = ctx.group;
  const anim: ((t: number, dt: number) => void)[] = [];
  dressWalls(ctx, wallpaperTex('#5a1e22', '#d9a860', 'damask', [6, 3]), '#3a2214');
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 5.4), std('#ffffff', { map: rugTexture('#6a1a1e', '#d8a24a', 3), roughness: 0.95 }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0, 0.01, 0.4);
  g.add(rug);

  // (the curtains are pleated and hung by the room's dressing, cc-dress.ts)

  // ---- the sound device: a carved pedestal, a brass cabinet with four lamps and a great horn
  const dev = new THREE.Group();
  dev.position.set(0, 0, -1.3);
  g.add(dev);
  box(dev, 1.5, 0.86, 0.9, wood('#3e2414'), 0, 0.43, 0);
  box(dev, 1.6, 0.06, 1.0, wood('#2a160a'), 0, 0.89, 0);
  for (const sx of [-1, 1]) box(dev, 0.08, 0.7, 0.92, brass({ roughness: 0.4 }), sx * 0.66, 0.43, 0);
  const cab = box(dev, 0.9, 0.32, 0.6, brass(), 0, 1.08, 0);
  cab.castShadow = true;
  const lamps: THREE.Mesh[] = [];
  const lampColor = ['#ffb84a', '#7fe08a', '#5ab8ff', '#ff6a4a'];
  ['arch', 'leaf', 'wave', 'flame'].forEach((sym, k) => {
    const x = -0.3 + k * 0.2;
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 10), glow('#3a2a1a'));
    lamp.position.set(x, 1.28, 0.24);
    dev.add(lamp);
    lamps.push(lamp);
    const plate = plane(dev, 0.12, 0.12, new THREE.MeshBasicMaterial({ map: symbolTex(sym, '#2a1608'), transparent: true }), x, 1.12, 0.305);
    plate.renderOrder = 2;
  });
  const hornPts: THREE.Vector2[] = [];
  for (let k = 0; k <= 12; k++) hornPts.push(new THREE.Vector2(0.04 + Math.pow(k / 12, 2.4) * 0.55, k * 0.07));
  const horn = new THREE.Mesh(new THREE.LatheGeometry(hornPts, 32), brass({ side: THREE.DoubleSide, roughness: 0.25 }));
  horn.position.set(0.15, 1.24, -0.1);
  horn.rotation.set(-0.9, 0, -0.35);
  dev.add(horn);
  const crank = new THREE.Group();
  crank.position.set(0.47, 1.08, 0);
  box(crank, 0.03, 0.03, 0.22, brass(), 0, 0, 0.11);
  box(crank, 0.03, 0.14, 0.03, brass(), 0, 0.07, 0.22);
  dev.add(crank);
  const devGlow = sprite(dev, '#ffcf7a', 1.6, 0, 1.4, 0, 0);
  ctx.addLight(0, 2.4, -1.3, '#ffcf8a', 5, 6, false);
  sheet(g, 0.26, 0.18, paperTex(['המכשיר מנגן', 'את השיר'], { size: 46, w: 384, h: 256 }), -0.95, 1.01, -0.75, 0.3);

  // ---- the bell rack on the left wall: four bells, largest to smallest, each with its symbol on the beam
  const rack = new THREE.Group();
  rack.position.set(-7.0, 0, -1.6);
  g.add(rack);
  const rw = wood('#4a2a16');
  for (const z of [-1.3, 1.3]) box(rack, 0.14, 2.6, 0.14, rw, 0, 1.3, z);
  box(rack, 0.2, 0.16, 2.9, rw, 0, 2.6, 0);
  box(rack, 0.6, 0.1, 2.9, rw, 0, 0.05, 0);
  const bells: THREE.Object3D[] = [];
  [1, 0.82, 0.66, 0.5].forEach((size, k) => {
    const z = -0.95 + k * 0.63;
    const pivot = new THREE.Group();
    pivot.position.set(0.1, 2.52, z);
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 10; i++) { const u = i / 10; pts.push(new THREE.Vector2(0.03 + 0.22 * size * (0.35 + 0.65 * Math.pow(u, 1.6)) + (u > 0.9 ? 0.03 * size : 0), -u * 0.45 * size)); }
    const bell = new THREE.Mesh(new THREE.LatheGeometry(pts, 28), brass({ color: '#d8a848', side: THREE.DoubleSide, roughness: 0.22 }));
    bell.position.y = -0.22;
    pivot.add(bell);
    cyl(pivot, 0.01, 0.01, 0.22, std('#2a2a2a'), 0, -0.11, 0, 6);
    rack.add(pivot);
    bells.push(pivot);
    const sym = plane(rack, 0.22, 0.22, new THREE.MeshBasicMaterial({ map: symbolTex(['arch', 'leaf', 'wave', 'flame'][k], '#f0d090'), transparent: true }), 0.12, 2.6, z, Math.PI / 2);
    sym.position.x = 0.105;
  });
  anim.push((t) => bells.forEach((b, k) => (b.rotation.x = Math.sin(t * (0.9 + k * 0.2) + k) * 0.03)));
  // a little mallet on the base
  const mallet = cyl(rack, 0.02, 0.02, 0.4, wood('#8a5a30'), 0.2, 0.15, 0.4, 8);
  mallet.rotation.x = Math.PI / 2;
  ctx.addLight(-6.2, 2.9, -1.6, '#ffc078', 3.5, 5);

  // ---- the stone symbols board on the right wall
  const board = new THREE.Group();
  board.position.set(7.9, 2.1, -1.4);
  board.rotation.y = -Math.PI / 2;
  box(board, 1.8, 1.4, 0.12, std('#7a7470', { roughness: 0.95 }), 0, 0, 0);
  plane(board, 1.6, 1.2, std('#ffffff', { map: symbolsBoardTex(), roughness: 0.95 }), 0, 0, 0.065);
  g.add(board);
  ctx.addLight(6.6, 3.2, -1.4, '#ffd9a8', 3, 5, false);

  // ---- the broken clock on the back wall: a case, the face of eight symbols, two hands and a pendulum
  const clock = new THREE.Group();
  clock.position.set(-3.6, 0, -6.8);
  g.add(clock);
  box(clock, 1.5, 4.0, 0.4, wood('#3a2010'), 0, 2.0, 0.1);
  box(clock, 1.7, 0.2, 0.5, wood('#2a1408'), 0, 4.05, 0.1);
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.58, 48), std('#ffffff', { map: clockFaceTex(), roughness: 0.6 }));
  face.position.set(0, 2.7, 0.32);
  clock.add(face);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.04, 10, 48), brass());
  ring.position.copy(face.position);
  clock.add(ring);
  const hands: THREE.Group[] = [];
  for (const [len, wid, zoff] of [[0.34, 0.05, 0.34], [0.5, 0.035, 0.36]] as [number, number, number][]) {
    const h = new THREE.Group();
    h.position.set(0, 2.7, zoff);
    box(h, wid, len, 0.012, std('#1a120a', { metalness: 0.6, roughness: 0.4 }), 0, len / 2 - 0.05, 0);
    clock.add(h);
    hands.push(h);
  }
  cyl(clock, 0.04, 0.04, 0.04, brass(), 0, 2.7, 0.38, 14).rotation.x = Math.PI / 2;
  const glass = box(clock, 0.9, 1.6, 0.02, std('#a0b8c0', { transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.1 }), 0, 1.15, 0.31);
  glass.castShadow = false;
  const pend = new THREE.Group();
  pend.position.set(0, 1.85, 0.2);
  box(pend, 0.03, 1.0, 0.02, brass(), 0, -0.5, 0);
  const bob = cyl(pend, 0.14, 0.14, 0.03, brass({ roughness: 0.2 }), 0, -1.05, 0, 28);
  bob.rotation.x = Math.PI / 2;
  clock.add(pend);
  const clockHalo = sprite(clock, '#ffe0a0', 1.8, 0, 2.7, 0.5, 0);
  sheet(g, 0.22, 0.28, paperTex(['המחוגים', 'נפגשים'], { size: 50, w: 320, h: 400 }), -2.2, 1.45, -6.75).rotation.set(0, 0, 0.06);
  ctx.addLight(-3.6, 3.6, -5.6, '#ffd9a8', 3.5, 5, false);

  // ---- three paintings on the right wall
  (['river', 'lantern', 'orchard'] as const).forEach((kind, k) => {
    const f = frame(g, 1.15, 0.86, paintingTex(kind), 7.92, 2.45, 1.6 + k * 1.4, -Math.PI / 2, '#b08a3a');
    const lamp = cyl(f, 0.02, 0.02, 0.5, brass(), 0, 0.62, 0.12, 8);
    lamp.rotation.z = Math.PI / 2;
  });
  ctx.addLight(6.8, 3.6, 3.0, '#ffd2a0', 4, 5.5, false);

  // ---- the music box on its side table, the cards beside it
  table(g, 1.8, 0.9, 0.95, 3.4, -1.9, '#4a2a16');
  const mbox = new THREE.Group();
  mbox.position.set(3.6, 0.99, -1.95);
  g.add(mbox);
  box(mbox, 0.5, 0.2, 0.34, wood('#6a3a1e'), 0, 0.1, 0);
  const drum = cyl(mbox, 0.05, 0.05, 0.36, brass({ roughness: 0.2 }), 0, 0.17, 0, 16);
  drum.rotation.z = Math.PI / 2;
  const lid = new THREE.Group();
  lid.position.set(0, 0.2, -0.17);
  box(lid, 0.52, 0.04, 0.36, wood('#7a4424'), 0, 0.02, 0.17);
  const inlay = plane(lid, 0.2, 0.2, new THREE.MeshBasicMaterial({ map: symbolTex('bell', '#e8c070'), transparent: true }), 0, 0.042, 0.17);
  inlay.rotation.x = -Math.PI / 2;
  mbox.add(lid);
  const mboxGlow = sprite(mbox, '#ffd98a', 0.9, 0, 0.3, 0, 0);
  ['א', 'ב', 'ג', 'ד'].forEach((l, k) => sheet(g, 0.16, 0.22, paperTex([l], { size: 120, w: 256, h: 352 }), 2.55 + (k % 2) * 0.2, 1.0 + k * 0.002, -1.8 + Math.floor(k / 2) * 0.26, -0.1 + k * 0.08));
  candle(ctx, anim, 4.1, 0.99, -2.15, true);

  // ---- the piano, a cello, music stands and candles: the salon itself
  const piano = new THREE.Group();
  piano.position.set(-5.6, 0, 4.6);
  piano.rotation.y = Math.PI;
  box(piano, 2.0, 1.3, 0.7, wood('#1e120c'), 0, 0.65, 0);
  box(piano, 2.0, 0.06, 0.36, std('#f4efe0', { roughness: 0.4 }), 0, 0.82, 0.5);
  for (let k = 0; k < 14; k++) box(piano, 0.06, 0.04, 0.2, std('#111'), -0.85 + k * 0.13, 0.86, 0.45);
  box(piano, 1.6, 0.5, 0.05, wood('#2a1810'), 0, 1.5, -0.1);
  g.add(piano);
  candle(ctx, anim, -6.3, 1.3, 4.5, true);
  candle(ctx, anim, -4.9, 1.3, 4.5);
  const cello = new THREE.Group();
  cello.position.set(5.9, 0, 5.4);
  cello.rotation.set(0, -0.6, 0.18);
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.32, 20, 14), wood('#8a3e1a'));
  body.scale.set(1, 1.5, 0.35);
  body.position.y = 0.6;
  cello.add(body);
  box(cello, 0.06, 0.9, 0.05, std('#1a1008'), 0, 1.35, 0.06);
  g.add(cello);
  for (const [x, z, r] of [[-2.8, 3.6, 0.4], [2.8, 3.8, -0.4]] as [number, number, number][]) {
    const st = new THREE.Group();
    st.position.set(x, 0, z);
    st.rotation.y = r;
    cyl(st, 0.015, 0.015, 1.15, iron2(), 0, 0.58, 0, 6);
    box(st, 0.5, 0.36, 0.02, iron2(), 0, 1.25, 0).rotation.x = -0.35;
    plane(st, 0.46, 0.32, std('#ffffff', { map: paperTex([], { w: 256, h: 192 }) }), 0, 1.26, 0.02).rotation.x = -0.35;
    g.add(st);
  }
  ctx.addLight(0, 4.8, 2.6, '#ffc88a', 6, 12);
  ctx.addLight(-5.2, 2.2, 3.2, '#ffb070', 3, 5);

  // ---- the room's dressing (architecture, furniture, lamps, details): merged per material
  const dressing = deco(ctx, anim);
  dressSounds(dressing);
  bake(dressing);

  // ---- state
  const clockData = pd<{ start?: number[] }>(ctx, 'cc1-clock');
  const target = [...(clockData.start ?? [4, 6])];
  const angle = target.map((k) => (k / 8) * Math.PI * 2);
  let lit = 0, clockOpen = 0, clockOpenTarget = 0, boxOpen = 0, boxOpenTarget = 0, devOn = 0, devTarget = 0;

  return {
    apply(s: RoomSnapshot) {
      const rot = mechIn(s, 'cc1-clock')?.rotations;
      if (rot?.length === 2) rot.forEach((r, k) => (target[k] = r));
      lit = ['cc1-listen', 'cc1-clock', 'cc1-missing'].filter((id) => solvedIn(s, id)).length;
      clockOpenTarget = solvedIn(s, 'cc1-clock') ? 1 : 0;
      boxOpenTarget = statusIn(s, 'cc1-missing') !== 'locked' ? 1 : 0;
      devTarget = solvedIn(s, 'cc1-listen') ? 1 : 0;
    },
    update(dt, t) {
      // hands turn the short way round to their mark
      target.forEach((k, i) => {
        const want = (k / 8) * Math.PI * 2;
        let d = want - angle[i];
        d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
        angle[i] += d * Math.min(1, dt * 5);
        hands[i].rotation.z = -angle[i];
      });
      clockOpen = approach(clockOpen, clockOpenTarget, dt, 2);
      pend.rotation.z = clockOpen * Math.sin(t * 2.2) * 0.18;
      (clockHalo.material as THREE.SpriteMaterial).opacity = clockOpen * (0.35 + Math.sin(t * 2) * 0.08);
      boxOpen = approach(boxOpen, boxOpenTarget, dt, 2);
      lid.rotation.x = -boxOpen * 1.6;
      drum.rotation.x += dt * boxOpen * 1.5;
      (mboxGlow.material as THREE.SpriteMaterial).opacity = boxOpen * 0.4;
      devOn = approach(devOn, devTarget, dt, 2);
      crank.rotation.z += dt * (0.4 + devOn * 1.2);
      (devGlow.material as THREE.SpriteMaterial).opacity = 0.12 + devOn * 0.3 + lit * 0.05;
      lamps.forEach((l, k) => {
        // idle: the lamps breathe in the order of the tune; solved: all lit
        const on = devOn > 0.5 ? 1 : Math.max(0, Math.sin(t * 1.6 - k * 1.1)) * 0.5;
        (l.material as THREE.MeshBasicMaterial).color.set(lampColor[k]).multiplyScalar(0.25 + on * 0.9);
      });
      for (const a of anim) a(t, dt);
    },
  };
}

function iron2() {
  return std('#2a2a2e', { metalness: 0.7, roughness: 0.45 });
}
