// "הצופן הזוגי", room 5 — חדר המכתבים: a rose-and-walnut post room. The writing desk for the players' own letters and
// the mailbox whose flag rises when an envelope arrives (local to each player, never shared), the table of eight old
// letters that move to the events board when placed, the ledger, the wall of eighteen drawers and the stamp stand.
import * as THREE from 'three';
import { RoomSnapshot } from '../../core/models';
import { rugTexture } from '../../world/textures';
import {
  RoomCtx, RoomPart, approach, box, brass, candle, curtainTex, cyl, dressWalls, glow, mechIn, paperTex, plane, sheet, solvedIn, sprite,
  statusIn, std, symbolTex, table, textTex, wallpaperTex, wood,
} from './cc-kit';
import { bake, deco } from './cc-decor';
import { dressLetters } from './cc-dress';

const EVENTS = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8'];
const STAMP_SYMBOL: Record<string, string> = { 'cc-stamp-a': 'flame', 'cc-stamp-b': 'wave', 'cc-stamp-c': 'heart', 'cc-stamp-d': 'wave' };

function envelope(stamp: number) {
  const g = new THREE.Group();
  box(g, 0.34, 0.012, 0.22, std('#efe2c4', { roughness: 0.9 }), 0, 0.006, 0);
  const flap = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.11, 3), std('#e6d4ae', { roughness: 0.9 }));
  flap.rotation.set(Math.PI / 2, 0, Math.PI);
  flap.scale.set(1, 1, 0.05);
  flap.position.set(0, 0.014, -0.05);
  g.add(flap);
  const st = plane(g, 0.07, 0.08, std('#ffffff', { map: textTex(String(stamp), { color: '#fff4d8', bg: '#a8342a', w: 96, h: 112, size: 64 }) }), 0.12, 0.014, 0.06);
  st.rotation.x = -Math.PI / 2;
  return g;
}

export interface LettersRoomPart extends RoomPart {
  /** The writing desk glows until this player has written (or chosen not to); the mailbox flag rises for unread mail. */
  setLetterState(deskGlow: boolean, unread: boolean): void;
}

export function buildLettersRoom(ctx: RoomCtx): LettersRoomPart {
  const g = ctx.group;
  const anim: ((t: number, dt: number) => void)[] = [];
  dressWalls(ctx, wallpaperTex('#6a3a3e', '#e8b8a0', 'leaf', [7, 3]), '#4a2a1c', '#2e1a10');
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(6.0, 4.0), std('#ffffff', { map: rugTexture('#5a2a2e', '#e8c08a', 17), roughness: 0.95 }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0, 0.01, 0.2);
  g.add(rug);

  // ---- the writing desk: ink, a quill, paper, an envelope and a candle
  table(g, 2.2, 1.0, 0.95, -5.2, 3.4, '#3a2014');
  sheet(g, 0.42, 0.56, paperTex([], { w: 384, h: 512 }), -5.3, 0.995, 3.4, 0.1);
  cyl(g, 0.05, 0.06, 0.07, std('#1a1a2a', { metalness: 0.3, roughness: 0.2 }), -4.6, 1.03, 3.2, 14);
  const quill = cyl(g, 0.004, 0.012, 0.42, std('#f4f0e8'), -4.62, 1.2, 3.2, 6);
  quill.rotation.z = 0.5;
  const env = envelope(0);
  env.position.set(-4.5, 0.995, 3.7);
  env.rotation.y = -0.3;
  g.add(env);
  candle(ctx, anim, -6.0, 0.995, 3.2, true);
  const chair = new THREE.Group();
  chair.position.set(-5.2, 0, 4.3);
  box(chair, 0.55, 0.06, 0.5, wood('#4a2a16'), 0, 0.5, 0);
  box(chair, 0.55, 0.7, 0.05, wood('#4a2a16'), 0, 0.88, 0.24);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(chair, 0.04, 0.5, 0.04, wood('#3a2010'), sx * 0.23, 0.25, sz * 0.21);
  g.add(chair);
  const deskGlow = sprite(g, '#ffd8a0', 1.6, -5.2, 1.3, 3.4, 0);

  // ---- the mailbox on the left wall, with its flag
  const mb = new THREE.Group();
  mb.position.set(-7.8, 1.5, 0.9);
  mb.rotation.y = Math.PI / 2;
  g.add(mb);
  box(mb, 0.6, 0.7, 0.3, brass({ color: '#8a6a3a', roughness: 0.35 }), 0, 0, 0.15);
  box(mb, 0.4, 0.04, 0.02, std('#1a1208'), 0, 0.15, 0.31);
  const flag = new THREE.Group();
  flag.position.set(0.33, -0.15, 0.2);
  box(flag, 0.03, 0.4, 0.03, iron2(), 0, 0.2, 0);
  box(flag, 0.04, 0.14, 0.18, std('#b8241c', { roughness: 0.5 }), 0, 0.33, 0.08);
  mb.add(flag);
  const mbGlow = sprite(mb, '#ffe0a0', 1.0, 0, 0, 0.4, 0);
  // the pigeonholes around it
  const ph = new THREE.Group();
  ph.position.set(-7.85, 2.9, 4.6);
  ph.rotation.y = Math.PI / 2;
  g.add(ph);
  box(ph, 2.2, 1.4, 0.3, wood('#3a2416'), 0, 0, 0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {
    box(ph, 0.3, 0.26, 0.02, std('#1a1008'), -0.85 + c * 0.34, 0.48 - r * 0.32, 0.15);
    if ((r * 6 + c) % 5 === 1) box(ph, 0.24, 0.05, 0.12, std('#efe2c4'), -0.85 + c * 0.34, 0.39 - r * 0.32, 0.12);
  }
  ctx.addLight(-6.6, 2.6, 1.8, '#ffc8a0', 3, 5);

  // ---- the events board (left wall) with eight places, where placed letters are pinned
  const eb = new THREE.Group();
  eb.position.set(-7.88, 2.3, -2.6);
  eb.rotation.y = Math.PI / 2;
  g.add(eb);
  box(eb, 2.6, 1.6, 0.05, std('#a8804a', { roughness: 1 }), 0, 0, 0);
  const pinned = EVENTS.map((_, k) => {
    const x = -0.96 + (k % 4) * 0.64, y = k < 4 ? 0.38 : -0.42;
    plane(eb, 0.56, 0.12, new THREE.MeshBasicMaterial({ map: textTex(String(k + 1), { color: '#3a2410', bg: '#efe2c4', w: 256, h: 64, size: 40 }) }), x, y + 0.26, 0.03);
    const holder = new THREE.Group();
    holder.position.set(x, y - 0.06, 0.04);
    eb.add(holder);
    return holder;
  });
  ctx.addLight(-6.6, 3.2, -2.6, '#ffe0c0', 3.5, 5, false);

  // ---- the table of eight letters
  table(g, 2.4, 1.2, 0.95, -3.8, -2.2, '#4a2a18');
  const letters = new Map<string, THREE.Object3D>();
  for (let k = 1; k <= 8; k++) {
    const e = envelope(k);
    e.position.set(-4.7 + ((k - 1) % 4) * 0.55, 0.995, -2.5 + Math.floor((k - 1) / 4) * 0.5);
    e.rotation.y = (k % 3 - 1) * 0.2;
    g.add(e);
    letters.set('cc-letter-s' + k, e);
  }
  const firstLetter = sheet(g, 0.26, 0.2, paperTex(['...ומאז'], { size: 52, w: 320, h: 240 }), -2.9, 1.0, -1.75, 0.2);

  // ---- the ledger on its lectern
  const lec = new THREE.Group();
  lec.position.set(3.2, 0, -1.2);
  g.add(lec);
  cyl(lec, 0.08, 0.14, 1.05, wood('#3a2010'), 0, 0.52, 0, 12);
  const deck = box(lec, 0.8, 0.05, 0.6, wood('#4a2a16'), 0, 1.1, 0);
  deck.rotation.x = 0.35;
  const book = sheet(lec, 0.66, 0.46, paperTex([], { title: 'ספר הרישום', size: 34, w: 512, h: 360 }), 0, 1.15, 0.02);
  book.rotation.x = -Math.PI / 2 + 0.35;
  const rulePage = sheet(g, 0.2, 0.24, paperTex(['מילה', 'מספר', 'סמל'], { size: 44, w: 256, h: 320 }), 3.45, 1.2, -1.45, 0.3);
  ctx.addLight(3.2, 2.4, -1.0, '#ffe0b8', 3.5, 4.5, false);

  // ---- the wall of eighteen drawers on the right wall (gold seals on 5 and 17, silver on 11)
  const dw = new THREE.Group();
  dw.position.set(7.75, 0, -1.2);
  dw.rotation.y = -Math.PI / 2;
  g.add(dw);
  box(dw, 3.0, 2.4, 0.5, wood('#3a2416'), 0, 1.6, 0);
  const drawerMesh: THREE.Mesh[] = [];
  for (let k = 0; k < 18; k++) {
    const r = Math.floor(k / 6), c = k % 6;
    const x = -1.2 + c * 0.48, y = 2.4 - r * 0.7;
    const d = box(dw, 0.44, 0.62, 0.06, wood('#6a4428'), x, y, 0.25);
    drawerMesh.push(d);
    plane(d, 0.14, 0.1, new THREE.MeshBasicMaterial({ map: textTex(String(k + 1), { color: '#2a1608', bg: '#e8d8b0', w: 96, h: 64, size: 46 }) }), 0, 0.2, 0.031);
    cyl(d, 0.025, 0.025, 0.04, brass(), 0, -0.05, 0.04, 10).rotation.x = Math.PI / 2;
    const seal = k === 4 || k === 16 ? '#e8b830' : k === 10 ? '#d8dce8' : null;
    if (seal) cyl(d, 0.05, 0.05, 0.015, std(seal, { metalness: 0.9, roughness: 0.25 }), 0.13, -0.18, 0.04, 16).rotation.x = Math.PI / 2;
  }
  const drawerGlow = sprite(dw, '#ffe0a0', 0.9, -1.2 + 4 * 0.48, 1.7, 0.5, 0);
  box(g, 0.4, 0.5, 0.3, brass(), 6.95, 1.2, 1.1);
  ctx.addLight(6.4, 3.0, -1.2, '#ffd8b8', 3.5, 5.5, false);

  // ---- the stamp stand and the last box
  table(g, 1.6, 0.9, 0.95, 4.6, 3.6, '#3a2014');
  const stamps = new Map<string, THREE.Object3D>();
  ['cc-stamp-a', 'cc-stamp-b', 'cc-stamp-c', 'cc-stamp-d'].forEach((id, k) => {
    const st = new THREE.Group();
    st.position.set(4.0 + k * 0.22, 0.995, 3.35);
    cyl(st, 0.025, 0.035, 0.14, wood('#2a1408'), 0, 0.14, 0, 10);
    cyl(st, 0.055, 0.055, 0.05, brass(), 0, 0.03, 0, 18);
    const face = plane(st, 0.08, 0.08, new THREE.MeshBasicMaterial({ map: symbolTex(STAMP_SYMBOL[id], '#2a1608', '#d8b870'), transparent: true }), 0, 0.058, 0);
    face.rotation.x = -Math.PI / 2;
    g.add(st);
    stamps.set(id, st);
  });
  const lastBox = new THREE.Group();
  lastBox.position.set(5.0, 0.995, 3.85);
  g.add(lastBox);
  box(lastBox, 0.4, 0.22, 0.3, wood('#6a2a1a'), 0, 0.11, 0);
  const boxLid = new THREE.Group();
  boxLid.position.set(0, 0.22, -0.15);
  box(boxLid, 0.42, 0.04, 0.32, wood('#7a3420'), 0, 0.02, 0.16);
  lastBox.add(boxLid);
  const boxStamp = new THREE.Group();
  boxStamp.position.set(0, 0.27, 0);
  lastBox.add(boxStamp);
  const boxGlow = sprite(lastBox, '#ffd98a', 0.9, 0, 0.35, 0, 0);
  ctx.addLight(4.6, 2.2, 3.6, '#ffc8a0', 3, 4.5);
  ctx.addLight(0, 4.9, 1.8, '#ffc8a8', 6, 12);

  // ---- the room's dressing (architecture, furniture, lamps, details): merged per material
  const dressing = deco(ctx, anim);
  dressLetters(dressing);
  bake(dressing);

  // ---- state
  let world = new Set<string>();
  let placed: Record<string, string> = {};
  let drawerOpen = 0, drawerTarget = 0, lidOpen = 0, lidTarget = 0, desk = 0, deskTarget = 1, unread = false, flagUp = 0;
  let stampOn = '';
  return {
    setLetterState(glowDesk: boolean, hasUnread: boolean) {
      deskTarget = glowDesk ? 1 : 0;
      unread = hasUnread;
    },
    apply(s: RoomSnapshot) {
      world = new Set(s.worldItems);
      placed = { ...(mechIn(s, 'cc5-order')?.slots ?? {}) };
      const onBoard = new Set(Object.values(placed));
      for (const [id, e] of letters) e.visible = world.has(id) && !onBoard.has(id);
      EVENTS.forEach((slot, k) => {
        const want = placed[slot] ?? '';
        const h = pinned[k];
        if (h.userData['item'] === want) return;
        h.clear();
        h.userData['item'] = want;
        if (want) {
          const e = envelope(Number(want.replace('cc-letter-s', '')));
          e.rotation.x = Math.PI / 2;
          e.scale.setScalar(1.3);
          h.add(e);
        }
      });
      firstLetter.visible = statusIn(s, 'cc5-keywords') !== 'locked';
      rulePage.visible = statusIn(s, 'cc5-stamp') !== 'locked';
      drawerTarget = solvedIn(s, 'cc5-keywords') ? 1 : 0;
      lidTarget = solvedIn(s, 'cc5-stamp') ? 1 : 0;
      const onBox = mechIn(s, 'cc5-stamp')?.slots?.['box'] ?? '';
      for (const [id, st] of stamps) st.visible = world.has(id) && onBox !== id;
      if (onBox !== stampOn) {
        stampOn = onBox;
        boxStamp.clear();
        if (onBox) {
          const st = stamps.get(onBox)!.clone();
          st.position.set(0, 0, 0);
          st.visible = true;
          boxStamp.add(st);
        }
      }
    },
    update(dt, t) {
      drawerOpen = approach(drawerOpen, drawerTarget, dt, 1.5);
      drawerMesh[10].position.z = 0.25 + drawerOpen * 0.4;
      (drawerGlow.material as THREE.SpriteMaterial).opacity = 0;
      lidOpen = approach(lidOpen, lidTarget, dt, 1.5);
      boxLid.rotation.x = -lidOpen * 1.7;
      (boxGlow.material as THREE.SpriteMaterial).opacity = lidOpen * 0.55;
      desk = approach(desk, deskTarget, dt, 2);
      (deskGlow.material as THREE.SpriteMaterial).opacity = desk * (0.28 + Math.sin(t * 2.2) * 0.08);
      flagUp = approach(flagUp, unread ? 1 : 0, dt, 3);
      flag.rotation.z = flagUp * Math.PI / 2;
      (mbGlow.material as THREE.SpriteMaterial).opacity = flagUp * (0.3 + Math.sin(t * 3) * 0.1);
      for (const a of anim) a(t, dt);
    },
  };
}

function iron2() {
  return std('#2a2a2e', { metalness: 0.7, roughness: 0.45 });
}
