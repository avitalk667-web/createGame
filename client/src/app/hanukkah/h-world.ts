import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { MechanismState, PlayerDto, RemotePosition, RoomSnapshot, ScenarioContent } from '../core/models';
import { Quality } from '../core/settings.service';
import { BoyAvatar } from '../world/avatar';
import {
  bookSpinesTexture, glowSpriteTexture, labelTexture, panelTexture, parchmentTexture, rugTexture, stoneTexture, woodFloorTexture,
} from '../world/textures';
import { Hanukkiah } from './hanukkiah';
import {
  H_HALF_D, H_HALF_W, H_INTERACTABLES, H_SPACING, H_WALL, H_ZONES, HInteractable, HRect, HZone,
  hCenter, hInRects, hObstacles, hWalkable, hWorldPos, hZoneAt,
} from './h-layout';

export type HMode = 'intro' | 'play' | 'outro' | 'cutscene' | 'bench' | 'maze';

export interface HWorldCallbacks {
  onHover?(def: HInteractable | null): void;
  onInteract?(def: HInteractable): void;
  onTooFar?(def: HInteractable): void;
  onZoneChange?(zone: HZone): void;
  onMove?(x: number, y: number, z: number, ry: number, zone: string): void;
  /** A part was dropped on an assembly table: on a zone (`slot`) or off them (`slot` null); `from` is where it was. */
  onBenchDrop?(puzzle: string, item: string, slot: string | null, from: string | null): void;
  /** Escape at a table or the maze board. */
  onBenchExit?(): void;
  /** The maze key was dragged one cell (N/E/S/W); resolves with whether the server accepted the step. */
  onMazeStep?(dir: string): Promise<boolean>;
  onMazeLever?(index: number): void;
  onMazeBlocked?(text: string): void;
  onMazeBox?(): void;
  /** The lever by the gear axles was pulled (while at the bench). */
  onBenchLever?(): void;
}

const DOOR_W = 2.4;
const DOOR_H = 3.4;
const INTERACT_DISTANCE = 4.2;
const SPAWN = new THREE.Vector3(0, 0, 4.6);
const MAZE_CELL = 0.3;

// the lamp bench in room 2, relative to the room's centre: five assembly zones (1 = the bottom part) and a tray in front
const BENCH_SLOTS = ['s1', 's2', 's3', 's4', 's5'];
const BENCH_PAD: Record<string, [number, number]> = { s1: [1.6, -1.45], s2: [0.8, -1.45], s3: [0, -1.45], s4: [-0.8, -1.45], s5: [-1.6, -1.45] };
const BENCH_TRAY: Record<string, [number, number]> = {
  'lamp-cover': [1.5, -0.85], 'lamp-wick': [0.75, -0.85], 'lamp-base': [0, -0.85], 'lamp-glass': [-0.75, -0.85], 'lamp-tank': [-1.5, -0.85],
};
const BENCH_TOP = 1.0;
/** Height of each part's centre above the bench when it rests on it, and inside the assembled lamp. */
const BENCH_SCALE = 1.1;
const BENCH_REST: Record<string, number> = { 'lamp-base': 0.045, 'lamp-tank': 0.135, 'lamp-wick': 0.09, 'lamp-glass': 0.125, 'lamp-cover': 0.07 };
const BENCH_STACK: Record<string, number> = { 'lamp-base': 0.045, 'lamp-tank': 0.22, 'lamp-wick': 0.4, 'lamp-glass': 0.42, 'lamp-cover': 0.61 };

// the ancient scales (a bonus puzzle in room 7, the mosaic room), relative to the room centre: on a table at the front left
const SCALE_X = -4.6;
const SCALE_Z = 2.6;
const SCALE_ARM = 0.78;
const SCALE_PIVOT_Y = 1.92;
const SCALE_PAN_Y = 1.35;

/** A drag-and-drop assembly on a table — the lamp bench and the dreidel stand. Positions are relative to the room centre. */
interface Assembly {
  zone: HZone;
  slots: string[];
  pad: Record<string, [number, number]>;
  tray: Record<string, [number, number]>;
  top: number;
  rest: Record<string, number>;
  /** Where the camera looks, and the half width that must stay in view. */
  look: [number, number];
  halfWidth: number;
  bounds: [number, number, number, number];
  /** Height of the tray when it is not the height of the zones (the scales: the pans hang above the table). */
  trayTop?: number;
  /** Where the local player stands while using it (x, z, facing). */
  stand: [number, number, number];
  snap: number;
}
const ASSEMBLIES: Record<string, Assembly> = {
  'h2-lamp': {
    zone: 'workshop', slots: BENCH_SLOTS, pad: BENCH_PAD, tray: BENCH_TRAY, top: BENCH_TOP, rest: BENCH_REST,
    look: [0, -1.15], halfWidth: 2.2, bounds: [-2.4, 2.4, -2.1, -0.65], stand: [3.3, -1.2, -Math.PI / 2], snap: 0.42,
  },
  // 2×2 as the hints describe it, seen from the front of the table: top row = the far row
  'h5-stand': {
    zone: 'dreidels', slots: ['tl', 'tr', 'bl', 'br'],
    pad: { tl: [2.4, -1.7], tr: [3.2, -1.7], bl: [2.4, -1.1], br: [3.2, -1.1] },
    tray: { 'dreidel-he': [2.0, -0.52], 'dreidel-nun': [2.53, -0.52], 'dreidel-pe': [3.07, -0.52], 'dreidel-gimel': [3.6, -0.52] },
    top: 1.05, rest: { 'dreidel-nun': 0, 'dreidel-gimel': 0, 'dreidel-he': 0, 'dreidel-pe': 0 },
    look: [2.8, -1.15], halfWidth: 1.9, bounds: [1.3, 4.3, -2.05, -0.35], stand: [0.5, -1.0, Math.PI / 2], snap: 0.32,
  },
  'g1-map': {
    zone: 'maproom', slots: ['m1', 'm2', 'm3'],
    pad: { m1: [-1.0, -1.5], m2: [0, -1.5], m3: [1.0, -1.5] },
    tray: { 'map-right': [-1.0, -0.72], 'map-left': [0, -0.72], 'map-middle': [1.0, -0.72] },
    top: 1.0, rest: { 'map-left': 0.012, 'map-middle': 0.012, 'map-right': 0.012 },
    look: [0, -1.15], halfWidth: 2.1, bounds: [-2.3, 2.3, -2.1, -0.5], stand: [3.0, -1.2, -Math.PI / 2], snap: 0.48,
  },
  'g1-symbols': {
    zone: 'maproom', slots: ['s1', 's2', 's3', 's4'],
    pad: { s1: [3.1, -3.5], s2: [3.7, -3.5], s3: [4.3, -3.5], s4: [4.9, -3.5] },
    tray: { 'sym-book': [3.1, -2.85], 'sym-lamp': [3.7, -2.85], 'sym-compass': [4.3, -2.85], 'sym-key': [4.9, -2.85] },
    top: 1.015, rest: { 'sym-compass': 0.14, 'sym-key': 0.14, 'sym-book': 0.14, 'sym-lamp': 0.14 },
    look: [4.0, -3.2], halfWidth: 1.7, bounds: [2.8, 5.2, -3.9, -2.7], stand: [2.3, -3.0, Math.PI / 2], snap: 0.28,
  },
  'g2-gears': {
    zone: 'gearworks', slots: ['a1', 'a2', 'a3'],
    pad: { a1: [-0.9, -1.5], a2: [0, -1.5], a3: [0.9, -1.5] },
    tray: { 'gear-medium': [-0.9, -0.72], 'gear-large': [0, -0.72], 'gear-small': [0.9, -0.72] },
    top: 1.0, rest: { 'gear-large': 0.03, 'gear-small': 0.03, 'gear-medium': 0.03 },
    look: [0, -1.15], halfWidth: 2.1, bounds: [-2.3, 2.3, -2.1, -0.5], stand: [3.0, -1.2, -Math.PI / 2], snap: 0.42,
  },
  // the ancient scales: two places in each pan (l = the left pan, r = the right one, as the players see it)
  'h7-scales': {
    zone: 'mosaic', slots: ['l1', 'l2', 'r1', 'r2'],
    pad: { l1: [SCALE_X - SCALE_ARM - 0.15, SCALE_Z], l2: [SCALE_X - SCALE_ARM + 0.15, SCALE_Z], r1: [SCALE_X + SCALE_ARM - 0.15, SCALE_Z], r2: [SCALE_X + SCALE_ARM + 0.15, SCALE_Z] },
    tray: { 'sc-feather': [SCALE_X - 0.9, SCALE_Z + 0.45], 'sc-key': [SCALE_X - 0.4, SCALE_Z + 0.45], 'sc-crystal': [SCALE_X + 0.4, SCALE_Z + 0.45], 'sc-hourglass': [SCALE_X + 0.9, SCALE_Z + 0.45] },
    top: SCALE_PAN_Y + 0.025, trayTop: 1.0, rest: { 'sc-feather': 0.02, 'sc-key': 0.02, 'sc-crystal': 0, 'sc-hourglass': 0 },
    look: [SCALE_X, SCALE_Z + 0.1], halfWidth: 1.45, bounds: [SCALE_X - 1.25, SCALE_X + 1.25, SCALE_Z - 0.5, SCALE_Z + 0.55], stand: [-6.3, SCALE_Z + 0.05, Math.PI / 2], snap: 0.2,
  },
};
/** Where the digits of a solved arrangement appear, relative to each place (dreidels: beside; symbols: in front). */
const BACKS_OFFSET: Record<string, [number, number, number]> = { 'h5-stand': [0.2, 0.03, 0.08], 'g1-symbols': [0, 0.02, 0.24] };
const LETTERS = 'אבגדהוזחטיכלמנסעפצקרשת'.split('');
/** Symbols carved on each door, by the room it leads to. */
const DOOR_SYMBOL: Partial<Record<HZone, string>> = {
  workshop: '🪔', maze: '🧭', cipher: '📜', dreidels: 'נ ג', lab: '🏺', mosaic: '💎', hall: '🕎', gearworks: '⚙️',
};

interface Flicker { light: THREE.PointLight; base: number; seed: number }

/** The easel drawing in room 2: the lamp's silhouette with its five levels numbered from the bottom (no names). */
function lampDrawingTexture() {
  const w = 512;
  const h = 700;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ead9ae';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(80,50,20,.6)';
  g.lineWidth = 8;
  g.strokeRect(10, 10, w - 20, h - 20);
  g.fillStyle = '#3a2410';
  g.textAlign = 'center';
  g.direction = 'rtl';
  g.font = 'bold 40px Frank Ruhl Libre, serif';
  g.fillText('מנורת השמן', w / 2, 66);
  g.strokeStyle = '#3a2410';
  g.lineWidth = 5;
  const cx = w / 2 - 30;
  // 1 base, 2 tank, 3 wick, 4 glass, 5 cover — drawn bottom to top
  g.beginPath(); g.ellipse(cx, 610, 120, 22, 0, 0, Math.PI * 2); g.stroke();
  g.strokeRect(cx - 120, 575, 240, 35);
  g.beginPath(); g.arc(cx, 495, 80, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(cx, 415); g.lineTo(cx, 330); g.stroke();
  g.strokeRect(cx - 62, 230, 124, 180);
  g.beginPath(); g.moveTo(cx - 80, 228); g.lineTo(cx, 120); g.lineTo(cx + 80, 228); g.closePath(); g.stroke();
  g.font = 'bold 34px Heebo, sans-serif';
  g.fillStyle = '#7a4a10';
  ([[1, 600], [2, 500], [3, 360], [4, 280], [5, 185]] as const).forEach(([n, y]) => {
    g.beginPath(); g.moveTo(cx + 130, y - 10); g.lineTo(cx + 175, y - 10); g.stroke();
    g.beginPath(); g.arc(cx + 200, y - 10, 22, 0, Math.PI * 2); g.stroke();
    g.fillText(String(n), cx + 200, y + 2);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = MAX_ANISO;
  return t;
}

/** The renderer's best anisotropic filtering (set once the renderer exists; capped for weak devices). */
let MAX_ANISO = 1;

/**
 * The four symbols of the free game's first room, drawn as sharp vector icons (not emoji, which differ between
 * devices and blur when small): dark ink on parchment in a gold ring, 512 px.
 */
function symbolTexture(kind: 'compass' | 'key' | 'book' | 'lamp') {
  const s = 512;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const m = s / 2;
  g.beginPath(); g.arc(m, m, m - 6, 0, Math.PI * 2); g.fillStyle = '#f5e6c0'; g.fill();
  g.lineWidth = 22; g.strokeStyle = '#b8862f'; g.stroke();
  g.beginPath(); g.arc(m, m, m - 30, 0, Math.PI * 2); g.lineWidth = 4; g.strokeStyle = '#7a5a12'; g.stroke();
  const ink = '#1d1408';
  g.strokeStyle = ink; g.fillStyle = ink; g.lineCap = 'round'; g.lineJoin = 'round';
  switch (kind) {
    case 'compass': {
      g.lineWidth = 16; g.beginPath(); g.arc(m, m, 150, 0, Math.PI * 2); g.stroke();
      for (let k = 0; k < 8; k++) { const a = (k * Math.PI) / 4; g.lineWidth = k % 2 ? 8 : 14; g.beginPath(); g.moveTo(m + Math.cos(a) * 128, m + Math.sin(a) * 128); g.lineTo(m + Math.cos(a) * 150, m + Math.sin(a) * 150); g.stroke(); }
      // the needle: north half red, south half ink
      g.beginPath(); g.moveTo(m, m - 125); g.lineTo(m + 30, m); g.lineTo(m - 30, m); g.closePath(); g.fillStyle = '#b3261e'; g.fill();
      g.beginPath(); g.moveTo(m, m + 125); g.lineTo(m + 30, m); g.lineTo(m - 30, m); g.closePath(); g.fillStyle = ink; g.fill();
      g.beginPath(); g.arc(m, m, 14, 0, Math.PI * 2); g.fillStyle = '#b8862f'; g.fill();
      break;
    }
    case 'key': {
      g.lineWidth = 26;
      g.beginPath(); g.arc(m - 95, m, 62, 0, Math.PI * 2); g.stroke();                       // bow
      g.beginPath(); g.arc(m - 95, m, 20, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.moveTo(m - 33, m); g.lineTo(m + 160, m); g.stroke();                   // shaft
      g.beginPath(); g.moveTo(m + 160, m); g.lineTo(m + 160, m + 62); g.stroke();             // bit
      g.beginPath(); g.moveTo(m + 110, m); g.lineTo(m + 110, m + 44); g.stroke();
      g.beginPath(); g.moveTo(m + 62, m); g.lineTo(m + 62, m + 30); g.stroke();
      break;
    }
    case 'book': {
      g.lineWidth = 14;
      // an open book: two pages meeting at the spine, with lines of text
      g.beginPath(); g.moveTo(m, m - 105); g.quadraticCurveTo(m - 80, m - 135, m - 165, m - 105); g.lineTo(m - 165, m + 110);
      g.quadraticCurveTo(m - 80, m + 85, m, m + 115); g.closePath(); g.stroke();
      g.beginPath(); g.moveTo(m, m - 105); g.quadraticCurveTo(m + 80, m - 135, m + 165, m - 105); g.lineTo(m + 165, m + 110);
      g.quadraticCurveTo(m + 80, m + 85, m, m + 115); g.closePath(); g.stroke();
      g.beginPath(); g.moveTo(m, m - 105); g.lineTo(m, m + 115); g.stroke();
      g.lineWidth = 9;
      for (let k = 0; k < 4; k++) {
        const y = m - 55 + k * 40;
        g.beginPath(); g.moveTo(m - 135, y); g.lineTo(m - 30, y + 4); g.stroke();
        g.beginPath(); g.moveTo(m + 30, y + 4); g.lineTo(m + 135, y); g.stroke();
      }
      break;
    }
    case 'lamp': {
      // a classic oil lamp seen from the side: a round body, a long spout to the right with its flame, a handle and a lid
      g.save();
      g.translate(-48, -10);
      const y0 = m + 70;
      g.beginPath();
      g.moveTo(m - 150, y0 - 20);
      g.bezierCurveTo(m - 150, y0 + 55, m + 40, y0 + 60, m + 85, y0 - 5);
      g.lineTo(m + 185, y0 - 55);
      g.lineTo(m + 175, y0 - 75);
      g.bezierCurveTo(m + 110, y0 - 55, m + 60, y0 - 45, m + 30, y0 - 50);
      g.bezierCurveTo(m - 20, y0 - 60, m - 120, y0 - 60, m - 150, y0 - 20);
      g.closePath(); g.fill();
      g.beginPath(); g.ellipse(m - 45, y0 - 62, 62, 14, 0, 0, Math.PI * 2); g.fill();                 // lid
      g.beginPath(); g.arc(m - 45, y0 - 88, 16, 0, Math.PI * 2); g.fill();                              // knob
      g.lineWidth = 18;
      g.beginPath(); g.moveTo(m - 145, y0 - 30); g.bezierCurveTo(m - 230, y0 - 50, m - 225, y0 + 40, m - 135, y0 + 15); g.stroke(); // handle
      g.beginPath(); g.ellipse(m - 30, y0 + 52, 70, 14, 0, 0, Math.PI * 2); g.fill();                  // foot
      // the flame above the tip of the spout
      const fx = m + 182;
      const fy = y0 - 78;
      g.beginPath(); g.moveTo(fx, fy); g.bezierCurveTo(fx - 55, fy - 50, fx - 10, fy - 120, fx + 5, fy - 175);
      g.bezierCurveTo(fx + 30, fy - 110, fx + 55, fy - 55, fx, fy); g.closePath(); g.fillStyle = '#d9640f'; g.fill();
      g.beginPath(); g.moveTo(fx, fy - 8); g.bezierCurveTo(fx - 25, fy - 40, fx - 5, fy - 80, fx + 3, fy - 110);
      g.bezierCurveTo(fx + 18, fy - 75, fx + 28, fy - 40, fx, fy - 8); g.closePath(); g.fillStyle = '#ffd36b'; g.fill();
      g.restore();
      break;
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = MAX_ANISO;
  return t;
}

/** Emoji/letter on a transparent canvas, for symbols drawn on props. */
function glyphTexture(text: string, color = '#ffd36b', size = 256, font = 'Segoe UI Emoji, Noto Color Emoji, Frank Ruhl Libre, serif') {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold ${Math.round(size * 0.7)}px ${font}`;
  g.fillStyle = color;
  g.fillText(text, size / 2, size / 2 + size * 0.04);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = MAX_ANISO;
  return t;
}

/** A text sheet (parchment / board) drawn on a canvas, right-to-left. */
function sheetTexture(lines: string[], opts: { bg?: string; color?: string; w?: number; h?: number; size?: number; title?: string } = {}) {
  const w = opts.w ?? 512;
  const h = opts.h ?? 384;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = opts.bg ?? '#e9d8ad';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(80,50,20,.6)';
  g.lineWidth = 6;
  g.strokeRect(8, 8, w - 16, h - 16);
  g.direction = 'rtl';
  g.textAlign = 'center';
  g.fillStyle = opts.color ?? '#3a2410';
  let y = 56;
  if (opts.title) {
    g.font = `bold ${Math.round((opts.size ?? 30) * 1.15)}px Frank Ruhl Libre, serif`;
    g.fillText(opts.title, w / 2, y);
    y += (opts.size ?? 30) * 1.7;
  }
  g.font = `${opts.size ?? 30}px Frank Ruhl Libre, Heebo, serif`;
  for (const line of lines) {
    g.fillText(line, w / 2, y);
    y += (opts.size ?? 30) * 1.45;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = MAX_ANISO;
  return t;
}

/** A number on a tablet, centred and sized to fit, so long numbers (200) are never cut. */
function numberTexture(text: string) {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.fillStyle = '#3a3446';
  g.fillRect(0, 0, s, s);
  g.strokeStyle = '#c9a24d';
  g.lineWidth = 8;
  g.strokeRect(10, 10, s - 20, s - 20);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = 150;
  g.font = `bold ${size}px Frank Ruhl Libre, Heebo, serif`;
  while (size > 40 && g.measureText(text).width > s - 56) {
    size -= 6;
    g.font = `bold ${size}px Frank Ruhl Libre, Heebo, serif`;
  }
  g.fillStyle = '#9fd0ff';
  g.fillText(text, s / 2, s / 2 + size * 0.05);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = MAX_ANISO;
  return t;
}

/** One leaf of a room door: dark carved wood, gilded borders and panels, and the symbol of the next room. */
function doorLeafTexture(symbol: string, mirror: boolean) {
  const w = 256;
  const h = 720;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, mirror ? '#2a170b' : '#3c2412');
  grad.addColorStop(1, mirror ? '#3c2412' : '#2a170b');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  // wood grain
  g.strokeStyle = 'rgba(0,0,0,.25)';
  g.lineWidth = 2;
  for (let x = 6; x < w; x += 11) {
    g.beginPath();
    g.moveTo(x, 0);
    g.bezierCurveTo(x + 4, h * 0.3, x - 4, h * 0.6, x + 2, h);
    g.stroke();
  }
  const gold = (x: number, y: number, ww: number, hh: number, lw: number) => {
    g.strokeStyle = '#e2b84a';
    g.lineWidth = lw;
    g.strokeRect(x, y, ww, hh);
    g.strokeStyle = 'rgba(90,50,10,.8)';
    g.lineWidth = 2;
    g.strokeRect(x + lw, y + lw, ww - lw * 2, hh - lw * 2);
  };
  gold(8, 8, w - 16, h - 16, 8);
  // two carved panels
  g.fillStyle = 'rgba(0,0,0,.28)';
  g.fillRect(36, 40, w - 72, 300);
  g.fillRect(36, 380, w - 72, 300);
  gold(36, 40, w - 72, 300, 5);
  gold(36, 380, w - 72, 300, 5);
  // corner rosettes
  g.fillStyle = '#e2b84a';
  for (const [x, y] of [[36, 40], [w - 36, 40], [36, 340], [w - 36, 340], [36, 380], [w - 36, 380], [36, 680], [w - 36, 680]]) {
    g.beginPath();
    g.arc(x, y, 7, 0, Math.PI * 2);
    g.fill();
  }
  // the room's symbol in a gilded medallion
  g.beginPath();
  g.arc(w / 2, 190, 74, 0, Math.PI * 2);
  g.fillStyle = 'rgba(20,12,4,.6)';
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = '#e2b84a';
  g.stroke();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold ${symbol.length > 2 ? 54 : 80}px Segoe UI Emoji, Noto Color Emoji, Frank Ruhl Libre, serif`;
  g.fillStyle = '#f2d27a';
  g.fillText(symbol, w / 2, 196);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = MAX_ANISO;
  return t;
}

/** The band of one ring of the letter wheel: the 22 letters in separate engraved segments. */
function wheelBandTexture() {
  const seg = 96;
  const w = seg * LETTERS.length;
  const h = 128;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d8b25a';
  g.fillRect(0, 0, w, h);
  LETTERS.forEach((l, i) => {
    const x = i * seg;
    g.fillStyle = i % 2 ? '#cfa64c' : '#e0bd66';
    g.fillRect(x + 3, 10, seg - 6, h - 20);
    g.strokeStyle = '#6a4610';
    g.lineWidth = 4;
    g.strokeRect(x + 3, 10, seg - 6, h - 20);
    g.save();
    // the band runs around the wheel, so each letter is drawn turned to stand upright on the cylinder
    g.translate(x + seg / 2, h / 2);
    g.rotate(Math.PI / 2);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 72px Frank Ruhl Libre, serif';
    g.fillStyle = '#2a1606';
    g.fillText(l, 0, 4);
    g.restore();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = MAX_ANISO;
  return t;
}

/** The torn map of the free game: one drawing, cut into three pieces (each with its straight edge), or whole with its riddle. */
function mapTexture(kind: 'left' | 'middle' | 'right' | 'whole' | 'wall') {
  const W = 900;
  const H = 300;
  const full = document.createElement('canvas');
  full.width = W;
  full.height = H;
  const g = full.getContext('2d')!;
  g.fillStyle = '#e7d3a2';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(90,60,20,.55)';
  g.lineWidth = 3;
  // coast, river and paths
  g.beginPath();
  g.moveTo(20, 220);
  for (let x = 20; x < W - 20; x += 40) g.lineTo(x, 200 + Math.sin(x / 50) * 30);
  g.stroke();
  g.setLineDash([10, 8]);
  g.beginPath();
  g.moveTo(80, 80);
  g.bezierCurveTo(300, 40, 500, 180, 820, 90);
  g.stroke();
  g.setLineDash([]);
  g.font = '42px Segoe UI Emoji, Noto Color Emoji';
  g.fillText('⛰️', 160, 140);
  g.fillText('🌲', 420, 130);
  g.fillText('🏰', 700, 150);
  g.font = 'bold 30px Frank Ruhl Libre, serif';
  g.fillStyle = '#5a3a10';
  g.fillText('✕', 812, 100);
  // ornamented outer border only on the outer edges
  g.strokeStyle = '#7a4a10';
  g.lineWidth = 10;
  g.strokeRect(8, 8, W - 16, H - 16);
  if (kind === 'whole' || kind === 'wall') {
    if (kind === 'whole') {
      g.fillStyle = 'rgba(250,240,210,.88)';
      g.fillRect(40, 30, W - 80, 110);
      g.fillStyle = '#3a2410';
      g.direction = 'rtl';
      g.textAlign = 'center';
      g.font = 'bold 26px Frank Ruhl Libre, Heebo, serif';
      g.fillText('„התחילו במה שמראה כיוון, המשיכו במה שפותח מנעול,', W / 2, 75);
      g.fillText('אחר כך חפשו את מה שקוראים בו, וסיימו במה שמפיצה אור.”', W / 2, 115);
    }
    const t = new THREE.CanvasTexture(full);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = MAX_ANISO;
    return t;
  }
  const i = kind === 'left' ? 0 : kind === 'middle' ? 1 : 2;
  const c = document.createElement('canvas');
  c.width = W / 3;
  c.height = H;
  const p = c.getContext('2d')!;
  p.drawImage(full, -i * (W / 3), 0);
  // torn inner edges
  p.globalCompositeOperation = 'destination-out';
  for (const side of [i > 0 ? 0 : -1, i < 2 ? W / 3 : -1]) {
    if (side < 0) continue;
    p.beginPath();
    for (let y = 0; y <= H; y += 12) p.lineTo(side + (side === 0 ? 1 : -1) * (4 + Math.random() * 10), y);
    p.lineTo(side, H);
    p.lineTo(side, 0);
    p.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = MAX_ANISO;
  return t;
}

/** A digit on a gold disc, readable on dark and light surfaces alike. */
function digitTexture(d: string) {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.beginPath();
  g.arc(s / 2, s / 2, s / 2 - 8, 0, Math.PI * 2);
  g.fillStyle = '#f2d27a';
  g.fill();
  g.lineWidth = 12;
  g.strokeStyle = '#7a4a10';
  g.stroke();
  g.fillStyle = '#2a1606';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 168px Heebo, sans-serif';
  g.fillText(d, s / 2, s / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = MAX_ANISO;
  return t;
}

/** The diagram on the workshop wall: three gears, left to right — large, small, medium. */
function gearDiagramTexture() {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 380;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e9d8ad';
  g.fillRect(0, 0, 640, 380);
  g.strokeStyle = 'rgba(80,50,20,.6)';
  g.lineWidth = 8;
  g.strokeRect(10, 10, 620, 360);
  g.fillStyle = '#3a2410';
  g.textAlign = 'center';
  g.direction = 'rtl';
  g.font = 'bold 34px Frank Ruhl Libre, serif';
  g.fillText('המנגנון — משמאל לימין', 320, 60);
  const gear = (x: number, r: number) => {
    g.beginPath();
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const rr = k % 2 ? r : r + 14;
      g.lineTo(x + Math.cos(a) * rr, 210 + Math.sin(a) * rr);
    }
    g.closePath();
    g.lineWidth = 5;
    g.strokeStyle = '#5a3a10';
    g.stroke();
    g.beginPath();
    g.arc(x, 210, 10, 0, Math.PI * 2);
    g.stroke();
  };
  gear(150, 95);
  gear(320, 45);
  gear(470, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = MAX_ANISO;
  return t;
}

/** Groove pattern of a mosaic stone at rotation 0 (openings: straight N–S, corner N–E, dead N only). */
function stoneGrooveTexture(kind: string, lit: boolean) {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2e3a52';
  g.fillRect(0, 0, s, s);
  g.strokeStyle = '#1a2236';
  g.lineWidth = 8;
  g.strokeRect(4, 4, s - 8, s - 8);
  g.strokeStyle = lit ? '#9fd0ff' : '#c9a24d';
  g.lineWidth = 16;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(s / 2, 0);
  g.lineTo(s / 2, s / 2);
  if (kind === 'straight') g.lineTo(s / 2, s);
  if (kind === 'corner') g.lineTo(s, s / 2);
  g.stroke();
  if (kind === 'dead') {
    g.fillStyle = '#5a4a30';
    g.fillRect(s / 2 - 20, s / 2 - 6, 40, 16);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = MAX_ANISO;
  return t;
}

/**
 * "סוד פך השמן": eight interior rooms with the props of the spec, a shared hanukkiah model, puzzle mechanisms
 * that follow the server state, the local player and the other players. The server decides everything;
 * this class only shows the state and reports what the player clicks.
 */
export class HanukkahWorld {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.05, 400);
  private composer?: EffectComposer;
  private clock = new THREE.Clock();
  private raf = 0;
  private watchdog?: ReturnType<typeof setInterval>;
  private disposed = false;
  private resizeObs: ResizeObserver;
  private mode: HMode = 'intro';
  private modeTime = 0;
  private flickers: Flicker[] = [];
  private animated: ((t: number, dt: number) => void)[] = [];
  private keyLight?: THREE.SpotLight;

  // interaction
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2(10, 10);
  private hitTargets = new Map<string, THREE.Mesh>();
  private hovered: HInteractable | null = null;
  private drag?: { x: number; y: number; moved: boolean; id: number; touch: boolean };

  // world state
  private doors = new Map<HZone, THREE.Object3D>();
  private doorOpen = new Map<HZone, number>();
  private doorProgress = new Map<HZone, number>();
  private unlocked = new Set<string>(['library']);
  private rects: HRect[] = hWalkable(this.unlocked);
  private obstacles: HRect[] = hObstacles();
  private cut?: { from: THREE.Vector3; to: THREE.Vector3; look: THREE.Vector3; t: number; dur: number };
  private itemMeshes = new Map<string, THREE.Object3D>();
  private worldItems = new Set<string>();
  private hanukkiot: Hanukkiah[] = [];
  private hallHanukkiah?: Hanukkiah;
  private outroLit = 0;

  // mechanisms
  private lampGlow?: THREE.PointLight;
  private lampFlame?: THREE.Mesh;
  private lampBeam?: THREE.Mesh;
  private wallPanel?: THREE.Object3D;
  private keySymbol?: THREE.Mesh;
  // assembly tables (lamp bench, dreidel stand): parts follow the server state; the local player drags them
  private asm = new Map<string, { def: Assembly; pads: Map<string, THREE.Mesh>; parts: Map<string, THREE.Object3D>; slots: Record<string, string>; flash: number }>();
  private benchId: string | null = null;
  private benchInv = new Set<string>();
  // digits shown once an arrangement with numbered backs is solved (dreidel stand, symbol board)
  private solvedAsm = new Set<string>();
  private solvedBacks = new Map<string, Record<string, string>>();
  private backPlates = new Map<string, THREE.Mesh>();
  // the free trial game
  private mapWhole?: THREE.Mesh;
  private mapDrawer?: THREE.Object3D;
  private mapSolved = false;
  private cabinetDoors: THREE.Object3D[] = [];
  private gearLever?: THREE.Object3D;
  private gearsRunning = false;
  // the scales: the beam leans as the server says (-1 left heavier, 1 right heavier); the pans hang from its ends
  private scaleBeam?: THREE.Object3D;
  private scalePans: THREE.Object3D[] = [];
  private scaleTilt = 0;
  private scaleAngle = 0;
  private scaleGlow?: THREE.PointLight;
  private scaleShine: THREE.MeshStandardMaterial[] = [];
  private exitDoor?: THREE.Object3D;
  private gateGlow?: THREE.Mesh;
  private sampleDone = false;
  private scalesDone = false;
  // maze table (room 3): the key is dragged on the board itself and the levers are pulled in the room
  private mazeGrid: string[] = [];
  private mazeGateIds: string[] = [];
  private mazeLeverState: boolean[] = [];
  private mazeKeyCell: [number, number] = [0, 0];
  private mazeServerKey: [number, number] = [0, 0];
  private mazeBusy = false;
  private mazeDrag?: { pointerId: number };
  private mazeAim: [number, number] | null = null;
  private mazeLastStep = 0;
  private mazeBlockedAt = -10;
  private mazeShake = -10;
  private mazeHover: string | null = null;
  private mazeSolved = false;
  private mazeHints: THREE.Object3D[] = [];
  private mazeCodePlate?: THREE.Mesh;
  private mazeCode = '';
  private metalBox?: THREE.Mesh;
  private boxHalo?: THREE.Sprite;
  private boxGlow = false;
  // the letter wheel (room 4) and the code lock on the door of room 5
  private wheelTarget = [0, 0, 0].map(() => -(0.5 / 22) * Math.PI * 2);
  private wheelSolved = false;
  private doorLockDial?: THREE.Mesh;
  private doorLockPlate?: THREE.Object3D;
  private benchGuess = new Map<string, string | null>();
  private benchShake = new Map<string, number>();
  private benchDrag?: { id: string; from: string | null; pointerId: number; pos: THREE.Vector3; x: number; y: number; far: boolean };
  /** A part chosen with a tap (no drag): the next tap on a free place puts it there — easy with a finger. */
  private benchPicked: string | null = null;
  private benchHover: string | null = null;
  private benchPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(BENCH_TOP + 0.18));
  private lampSeq = -1;
  private firstApply = true;
  // short-lived effects (items flying to a player, keys turning, door glows) and the hover/sparkle feedback
  private effects: ((t: number, dt: number) => boolean)[] = [];
  private hoverRing?: THREE.Mesh;
  private sparkles?: THREE.Points;
  private time = 0;
  private mazeKey?: THREE.Object3D;
  private mazeKeyTarget = new THREE.Vector3();
  private mazeGates = new Map<string, THREE.Mesh>();
  private mazeLevers: THREE.Object3D[] = [];
  private mazeOrigin = new THREE.Vector3();
  private metalBoxLid?: THREE.Object3D;
  private drawerFront?: THREE.Object3D;
  private wheelRings: THREE.Object3D[] = [];
  private woodBoxLid?: THREE.Object3D;
  private jugGlow?: THREE.Mesh;
  private mosaicStones: { mesh: THREE.Mesh; kind: string; lit?: boolean }[] = [];
  private mosaicBeam?: THREE.Mesh;
  private pedestalItems = new Map<string, THREE.Object3D>();
  /** A glowing ring on each pedestal after "check the arrangement": green right, red wrong. */
  private pedestalMarks = new Map<string, THREE.Mesh>();
  private hallGate?: THREE.Mesh;
  private gatePower = 0.2;
  private gateTarget = 0.2;
  private particles?: THREE.Points;
  private openTargets = new Map<THREE.Object3D, { axis: 'x' | 'y' | 'z'; kind: 'rot' | 'pos'; from: number; to: number; on: boolean }>();

  // players
  private local?: BoyAvatar;
  private localPos = SPAWN.clone();
  private localYaw = Math.PI;
  private localSpeed = 0;
  private camYaw = 0;
  private camPitch = 0.32;
  private camDist = 4.6;
  private keys = new Set<string>();
  private joystick = new THREE.Vector2();
  private remotes = new Map<string, { avatar: BoyAvatar; pos: THREE.Vector3; yaw: number; speed: number; connected: boolean }>();
  private positions?: Map<string, RemotePosition & { t: number }>;
  private lastSent = 0;
  private lastSentKey = '';
  private currentZone: HZone = 'library';
  private snapCamera = false;
  sensitivity = 1;

  constructor(private canvas: HTMLCanvasElement, private quality: Quality, private cb: HWorldCallbacks = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 2 : quality === 'medium' ? 1.5 : 1.25));
    MAX_ANISO = Math.min(quality === 'low' ? 4 : 8, this.renderer.capabilities.getMaxAnisotropy());
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.55;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color('#060a1a');
    this.scene.fog = new THREE.FogExp2('#0a1026', 0.014);
    if (quality !== 'low') {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(512, 512), quality === 'high' ? 0.65 : 0.5, 0.45, 0.9));
      this.composer.addPass(new OutputPass());
    }
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(canvas.parentElement ?? canvas);
    this.resize();
    this.bindInput();
  }

  // ======================================================================= build

  build(scenario: ScenarioContent | null) {
    H_ZONES.forEach((z, i) => this.buildShell(z, i));
    // only the rooms of the game being played
    const rooms: Partial<Record<HZone, () => void>> = {
      library: () => this.buildLibrary(), workshop: () => this.buildWorkshop(), maze: () => this.buildMaze(scenario),
      cipher: () => this.buildCipher(), dreidels: () => this.buildDreidels(), lab: () => this.buildLab(scenario),
      mosaic: () => this.buildMosaic(scenario), hall: () => this.buildHall(),
      maproom: () => this.buildMapRoom(), gearworks: () => this.buildGearworks(),
    };
    for (const z of H_ZONES) rooms[z]?.();
    for (const def of H_INTERACTABLES) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(def.radius, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
      m.position.set(...hWorldPos(def));
      m.userData['def'] = def;
      this.scene.add(m);
      this.hitTargets.set(def.id, m);
    }
    // brighter but still mysterious: a soft sky/ground fill, no near-black corners (spec 10)
    this.scene.add(new THREE.HemisphereLight('#a8b4e6', '#4a3620', 1.35));
    this.scene.add(new THREE.AmbientLight('#b0b6d0', 0.45));
    this.buildLightPool();
    this.assignLights('library');
    this.buildFeedback();
    if (this.quality !== 'low') {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.keyLight = new THREE.SpotLight('#ffd9a8', 26, 22, Math.PI / 3, 0.7, 1.4);
      this.keyLight.castShadow = true;
      this.keyLight.shadow.mapSize.set(1024, 1024);
      this.keyLight.shadow.bias = -0.0006;
      this.scene.add(this.keyLight, this.keyLight.target);
      this.placeKeyLight('library');
      this.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mat = m.material as THREE.Material;
        const flat = m.geometry instanceof THREE.PlaneGeometry || m.geometry instanceof THREE.CircleGeometry;
        m.receiveShadow = true;
        m.castShadow = !flat && !mat.transparent && !(mat instanceof THREE.MeshBasicMaterial);
      });
    }
  }

  private std(color: string, opts: THREE.MeshStandardMaterialParameters = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...opts });
  }
  private gold = () => this.std('#d4a640', { metalness: 0.9, roughness: 0.3 });
  private wood = (c = '#5a3a20') => this.std(c, { map: panelTexture([2, 1]), roughness: 0.7 });

  private box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.scene) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  /**
   * Local lights are described per room and served by a small fixed pool that follows the player
   * (spec 10, 12): every room can be well lit, while the renderer only ever handles a few lights.
   */
  private addLight(x: number, y: number, z: number, color: string, intensity: number, distance: number, flicker = true) {
    this.lightSpecs.push({ zone: hZoneAt(z), x, y, z, color, intensity, distance, flicker, seed: Math.random() * 100 });
  }

  private lightSpecs: { zone: HZone; x: number; y: number; z: number; color: string; intensity: number; distance: number; flicker: boolean; seed: number }[] = [];
  private lightPool: { light: THREE.PointLight; spec: HanukkahWorld['lightSpecs'][number] | null }[] = [];
  private static readonly POOL = 10;

  private buildLightPool() {
    for (let i = 0; i < HanukkahWorld.POOL; i++) {
      const light = new THREE.PointLight('#ffffff', 0, 10, 1.6);
      this.scene.add(light);
      this.lightPool.push({ light, spec: null });
    }
  }

  /** The room's own lights (strongest first) plus the brightest one of the next room, seen through its door. */
  private assignLights(zone: HZone) {
    const next = H_ZONES[H_ZONES.indexOf(zone) + 1];
    const here = this.lightSpecs.filter((s) => s.zone === zone).sort((a, b) => b.intensity - a.intensity).slice(0, HanukkahWorld.POOL - 3);
    const ahead = this.lightSpecs.filter((s) => s.zone === next).sort((a, b) => b.intensity - a.intensity).slice(0, HanukkahWorld.POOL - here.length);
    const chosen = [...here, ...ahead];
    this.lightPool.forEach((p, i) => {
      const s = chosen[i] ?? null;
      p.spec = s;
      p.light.intensity = s ? s.intensity : 0;
      if (s) {
        p.light.color.set(s.color);
        p.light.distance = s.distance;
        p.light.position.set(s.x, s.y, s.z);
      }
    });
  }

  private candle(x: number, y: number, z: number, light = false) {
    const g = new THREE.Group();
    const wax = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.22, 10), this.std('#efe6cf'));
    wax.position.y = 0.11;
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowSpriteTexture('#ffb84d'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    flame.scale.set(0.35, 0.5, 1);
    flame.position.y = 0.32;
    g.add(wax, flame);
    g.position.set(x, y, z);
    this.scene.add(g);
    this.animated.push((t) => flame.scale.set(0.33 + Math.sin(t * 13 + x) * 0.03, 0.48 + Math.sin(t * 17 + z) * 0.05, 1));
    if (light) this.addLight(x, y + 0.45, z, '#ffb469', 5, 8);
    return g;
  }

  private halo(obj: THREE.Object3D, color = '#ffe6a0', size = 0.8) {
    const h = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowSpriteTexture(color), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.55 }));
    h.scale.set(size, size, 1);
    obj.add(h);
    return h;
  }

  private label(text: string, w: number, h: number, x: number, y: number, z: number, rotY = 0, opts: { color?: string; bg?: string } = {}) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({
      map: labelTexture(text, { color: opts.color ?? '#3a2410', bg: opts.bg ?? '#e9d8ad', width: 512, height: Math.round(512 * h / w) }), transparent: true,
    }));
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    this.scene.add(m);
    return m;
  }

  /** Floor, ceiling, stone walls with door gaps, wainscot, a chandelier and the door to the next room. */
  private buildShell(zone: HZone, i: number) {
    const c = -H_SPACING * i;
    const tint: Record<HZone, string> = {
      library: '#7a6e66', workshop: '#786a5c', maze: '#6e6a78', cipher: '#6a6680', dreidels: '#7a6a5a', lab: '#666e78', mosaic: '#5e6684', hall: '#5c6290',
      maproom: '#76695c', gearworks: '#666a76',
    };
    const wallMat = this.std(tint[zone], { map: stoneTexture([5, 2.5]) });
    const floorMat = ['library', 'workshop', 'dreidels', 'maproom'].includes(zone)
      ? this.std('#9a7a5a', { map: woodFloorTexture([4, 4]), roughness: 0.7 })
      : this.std('#6a6470', { map: stoneTexture([6, 6]), roughness: 0.6 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(H_HALF_W * 2, H_HALF_D * 2), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, c);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(H_HALF_W * 2, H_HALF_D * 2), this.std('#2b2420'));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, H_WALL, c);
    this.scene.add(floor, ceil);
    for (const sx of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(H_HALF_D * 2, H_WALL), wallMat);
      wall.rotation.y = -sx * Math.PI / 2;
      wall.position.set(sx * H_HALF_W, H_WALL / 2, c);
      this.scene.add(wall);
      const panel = this.box(0.06, 1.3, H_HALF_D * 2, this.std('#ffffff', { map: panelTexture([7, 1]), roughness: 0.6 }), sx * (H_HALF_W - 0.03), 0.65, c);
      panel.castShadow = false;
    }
    const last = i === H_ZONES.length - 1;
    // the free game's last room ends in a door of its own (the gate), so its back wall has an opening too
    const exit = last && zone === 'gearworks';
    this.wallWithGap(c - H_HALF_D, 0, wallMat, last && !exit ? 0 : DOOR_W);
    this.wallWithGap(c + H_HALF_D, Math.PI, wallMat, i === 0 ? 0 : DOOR_W);
    for (const bx of [-4, 0, 4]) this.box(0.3, 0.3, H_HALF_D * 2, this.std('#3a2a1c'), bx, H_WALL - 0.18, c);
    // a warm fill over the area where the puzzles are, so nothing important sinks into shadow
    this.addLight(0, H_WALL - 0.9, c - 1.4, '#ffe2b8', 11, 22, false);

    // brass chandelier
    if (zone !== 'mosaic') {
      const brass = this.std('#b8913f', { metalness: 0.85, roughness: 0.3 });
      const g = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.05, 10, 40), brass);
      ring.rotation.x = Math.PI / 2;
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 6), brass);
      chain.position.y = 0.6;
      g.add(ring, chain);
      g.position.set(0, H_WALL - 1.5, c + 1.5);
      this.scene.add(g);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        this.candle(Math.cos(a) * 0.8, g.position.y + 0.04, g.position.z + Math.sin(a) * 0.8);
      }
      this.addLight(0, g.position.y - 0.4, g.position.z, '#ffc48a', 13, 17);
    }
    // a wall sconce on each side
    for (const sx of [-1, 1]) {
      this.box(0.14, 0.4, 0.14, this.std('#2a2018', { metalness: 0.5 }), sx * (H_HALF_W - 0.1), 2.6, c + 3);
      this.candle(sx * (H_HALF_W - 0.25), 2.8, c + 3, true);
    }

    // corridor and the carved door to the next room
    if (!last) {
      const z0 = c - H_HALF_D;
      const len = H_SPACING - H_HALF_D * 2;
      const cf = new THREE.Mesh(new THREE.PlaneGeometry(DOOR_W, len), this.std('#4a4450', { map: stoneTexture([1, 1]) }));
      cf.rotation.x = -Math.PI / 2;
      cf.position.set(0, 0.005, z0 - len / 2);
      const cc = new THREE.Mesh(new THREE.PlaneGeometry(DOOR_W, len), this.std('#221c18'));
      cc.rotation.x = Math.PI / 2;
      cc.position.set(0, DOOR_H, z0 - len / 2);
      this.scene.add(cf, cc);
      for (const sx of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.PlaneGeometry(len, DOOR_H), wallMat);
        w.rotation.y = -sx * Math.PI / 2;
        w.position.set(sx * DOOR_W / 2, DOOR_H / 2, z0 - len / 2);
        this.scene.add(w);
      }
      const next = H_ZONES[i + 1];
      const door = this.buildDoor(next, z0);
      this.doors.set(next, door);
      this.doorOpen.set(next, 0);
    }
  }

  /**
   * A carved double door with gilded panels, metal ring handles and the next room's symbol. While locked it shows a
   * padlock — or, on the dreidel room's door, its code lock; once unlocked the trim glows and the leaves swing open.
   */
  private buildDoor(next: HZone, z0: number, symbolOverride?: string) {
    const door = new THREE.Group();
    door.position.set(0, 0, z0 - 0.12);
    const symbol = symbolOverride ?? DOOR_SYMBOL[next] ?? '✦';
    const edge = this.std('#2a170b');
    const leaves: THREE.Object3D[] = [];
    for (const side of [-1, 1]) {
      const hinge = new THREE.Group();
      hinge.position.set(side * DOOR_W / 2, 0, 0);
      const face = this.std('#ffffff', { map: doorLeafTexture(symbol, side > 0), roughness: 0.6, metalness: 0.15 });
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W / 2, DOOR_H, 0.14), [edge, edge, edge, edge, face, face]);
      leaf.position.set(-side * DOOR_W / 4, DOOR_H / 2, 0);
      hinge.add(leaf);
      // antique ring handle near the middle
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.018, 8, 20), this.std('#a88a4a', { metalness: 0.9, roughness: 0.35 }));
      ring.position.set(-side * (DOOR_W / 2 - 0.2), 1.25, 0.1);
      const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 14), this.gold());
      boss.rotation.x = Math.PI / 2;
      boss.position.set(-side * (DOOR_W / 2 - 0.2), 1.36, 0.08);
      hinge.add(ring, boss);
      door.add(hinge);
      leaves.push(hinge);
    }
    // gilded frame around the doorway, on the room side
    const trim = this.std('#c9a24d', { metalness: 0.85, roughness: 0.3, emissive: '#ffb347', emissiveIntensity: 0 });
    for (const sx of [-1, 1]) this.box(0.16, DOOR_H + 0.2, 0.12, trim, sx * (DOOR_W / 2 + 0.08), (DOOR_H + 0.2) / 2, 0.14, door);
    this.box(DOOR_W + 0.48, 0.2, 0.14, trim, 0, DOOR_H + 0.1, 0.14, door);
    const crest = new THREE.Mesh(new THREE.CircleGeometry(0.22, 24), new THREE.MeshBasicMaterial({ map: glyphTexture(symbol.split(' ')[0], '#f2d27a', 128), transparent: true }));
    crest.position.set(0, DOOR_H + 0.42, 0.2);
    const crestBack = new THREE.Mesh(new THREE.CircleGeometry(0.26, 24), trim);
    crestBack.position.set(0, DOOR_H + 0.42, 0.19);
    door.add(crestBack, crest);
    // the lock: a padlock across the seam, or the code lock on the dreidel room's door
    let lock: THREE.Object3D;
    if (next === 'lab' && !symbolOverride) {
      lock = new THREE.Group();
      const plate = this.box(0.42, 0.62, 0.05, this.gold(), 0, 0, 0, lock);
      plate.userData['doorLock'] = true;
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.16), new THREE.MeshBasicMaterial({ map: labelTexture('▢ ▢ ▢ ▢', { color: '#ffd36b', bg: '#1a1208', width: 256, height: 120 }) }));
      face.position.set(0, 0.16, 0.03);
      const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.05, 24), this.std('#e2b84a', { metalness: 0.9, roughness: 0.25, map: glyphTexture('🔒', '#000', 128) }));
      dial.rotation.x = Math.PI / 2;
      dial.position.set(0, -0.12, 0.04);
      lock.add(face, dial);
      lock.position.set(0.62, 1.45, 0.12);
      this.doorLockDial = dial;
      this.doorLockPlate = lock;
      this.halo(lock, '#ffd36b', 1.0);
    } else {
      lock = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.17, 0.07), this.std('#8a6a2a', { metalness: 0.85, roughness: 0.35 }));
      const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.016, 8, 20, Math.PI), this.std('#b8b8c0', { metalness: 0.9, roughness: 0.3 }));
      shackle.position.y = 0.085;
      lock.add(body, shackle);
      lock.userData['shackle'] = shackle;
      lock.position.set(0, 1.25, 0.12);
    }
    door.add(lock);
    door.userData = { leaves, lock, trim, unlockT: 0, lockY: lock.position.y };
    this.scene.add(door);
    return door;
  }

  private wallWithGap(z: number, rotY: number, mat: THREE.Material, gapW: number) {
    const W = H_HALF_W * 2;
    const add = (w: number, h: number, x: number, y: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      m.rotation.y = rotY;
      m.position.set(x, y, z);
      this.scene.add(m);
    };
    if (!gapW) return add(W, H_WALL, 0, H_WALL / 2);
    const side = (W - gapW) / 2;
    add(side, H_WALL, -(gapW / 2 + side / 2), H_WALL / 2);
    add(side, H_WALL, gapW / 2 + side / 2, H_WALL / 2);
    add(gapW, H_WALL - DOOR_H, 0, DOOR_H + (H_WALL - DOOR_H) / 2);
  }

  private placeKeyLight(zone: HZone) {
    this.assignLights(zone);
    if (!this.keyLight) return;
    const c = hCenter(zone);
    this.keyLight.position.set(1.2, H_WALL - 0.6, c + 2.5);
    this.keyLight.target.position.set(0, 0, c - 0.5);
  }

  private desk(c: number, w = 5.2, d = 1.6, z = -1.3, color = '#5a3a20') {
    const top = this.box(w, 0.1, d, this.wood(color), 0, 0.95, c + z);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) this.box(0.12, 0.9, 0.12, this.std('#3a2414'), sx * (w / 2 - 0.15), 0.45, c + z + sz * (d / 2 - 0.15));
    return top;
  }

  private shelfWall(x: number, c: number, z: number, rotY: number, seed: number) {
    const g = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(3.2, 4.2, 0.5), this.std('#3a2414'));
    frame.position.y = 2.1;
    g.add(frame);
    for (let k = 0; k < 4; k++) {
      const books = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 0.8), this.std('#ffffff', { map: bookSpinesTexture(seed + k) }));
      books.position.set(0, 0.6 + k * 1.0, 0.26);
      g.add(books);
    }
    g.position.set(x, 0, c + z);
    g.rotation.y = rotY;
    this.scene.add(g);
  }

  private scroll(x: number, y: number, z: number, rot = 0) {
    const g = new THREE.Group();
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.36), this.std('#ffffff', { map: parchmentTexture(), side: THREE.DoubleSide }));
    sheet.rotation.x = -Math.PI / 2;
    const r1 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 8), this.std('#7a5230'));
    r1.rotation.z = Math.PI / 2;
    r1.position.z = -0.2;
    const r2 = r1.clone();
    r2.position.z = 0.2;
    g.add(sheet, r1, r2);
    g.position.set(x, y, z);
    g.rotation.y = rot;
    this.scene.add(g);
    return g;
  }

  // ---------------------------------------------------------------------- 1 · library

  private buildLibrary() {
    const c = hCenter('library');
    this.shelfWall(-H_HALF_W + 0.3, c, -2.5, Math.PI / 2, 1);
    this.shelfWall(-H_HALF_W + 0.3, c, 1.5, Math.PI / 2, 5);
    this.shelfWall(H_HALF_W - 0.3, c, -2.5, -Math.PI / 2, 9);
    this.shelfWall(H_HALF_W - 0.3, c, 1.5, -Math.PI / 2, 13);
    this.desk(c);
    // the folded letter
    const letter = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.3), this.std('#ffffff', { map: parchmentTexture() }));
    letter.rotation.x = -Math.PI / 2;
    letter.rotation.z = 0.25;
    letter.position.set(-1.2, 1.01, c - 1.2);
    this.scene.add(letter);
    this.halo(letter, '#fff1c0', 0.6).position.z = 0.1;
    // locked drawer under the desk
    this.box(1.0, 0.36, 0.5, this.wood('#4a2c16'), 0.4, 0.62, c - 1.2);
    this.drawerFront = this.box(0.9, 0.3, 0.06, this.wood('#5e3a1e'), 0.4, 0.62, c - 0.93);
    this.box(0.12, 0.12, 0.04, this.gold(), 0.4, 0.62, c - 0.89);
    this.openTargets.set(this.drawerFront, { axis: 'z', kind: 'pos', from: c - 0.93, to: c - 0.45, on: false });
    // magnifier, oil lamp, globe, three books
    const lens = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.015, 8, 24), this.gold());
    lens.rotation.x = -Math.PI / 2;
    lens.position.set(-0.3, 1.02, c - 1.5);
    const glass = new THREE.Mesh(new THREE.CircleGeometry(0.09, 20), new THREE.MeshStandardMaterial({ color: '#cfe8ff', transparent: true, opacity: 0.35, metalness: 0.2, roughness: 0.05 }));
    glass.rotation.x = -Math.PI / 2;
    glass.position.set(-0.3, 1.025, c - 1.5);
    this.box(0.03, 0.03, 0.22, this.std('#3a2414'), -0.3, 1.02, c - 1.33);
    this.scene.add(lens, glass);
    this.oilLamp(1.6, 1.0, c - 1.6, true);
    const globeStand = this.box(0.08, 0.6, 0.08, this.std('#3a2414'), 3.4, 0.3, c - 3.2);
    globeStand.castShadow = true;
    const globe = new THREE.Mesh(new THREE.SphereGeometry(0.38, 24, 16), this.std('#2e5a7a', { roughness: 0.5 }));
    globe.position.set(3.4, 1.0, c - 3.2);
    const meridian = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.02, 8, 32), this.gold());
    meridian.position.copy(globe.position);
    this.scene.add(globe, meridian);
    this.animated.push((t) => (globe.rotation.y = t * 0.2));
    [['#8a1f1f', -2.9], ['#1f5a2a', -2.6], ['#1f3a7a', -2.3]].forEach(([col, x]) => this.box(0.22, 0.32, 0.28, this.std(col as string), x as number, 1.16, c - 1.6));
    // maps and scrolls on a side table
    this.box(1.2, 0.08, 0.7, this.wood(), -6.6, 1.0, c + 2.5);
    this.box(0.08, 1.0, 0.08, this.std('#3a2414'), -6.6, 0.5, c + 2.5);
    this.scroll(-6.7, 1.08, c + 2.3, 0.5);
    this.scroll(-6.4, 1.1, c + 2.7, -0.3);
    // a small hanukkiah on a cabinet: same model as the hall, lit by the stage of the game
    this.box(1.6, 1.1, 0.6, this.wood('#4a2c16'), 4.6, 0.55, c - 6.4);
    const h = new Hanukkiah(0.7);
    h.root.position.set(4.6, 1.1, c - 6.4);
    this.scene.add(h.root);
    this.hanukkiot.push(h);
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(6, 4), this.std('#ffffff', { map: rugTexture('#5a1d1d', '#c9a24d', 2), roughness: 0.95 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0, 0.012, c + 1.8);
    this.scene.add(rug);
    // the antique key lies in the drawer; it shows when the drawer slides open (it also goes straight to the bag)
    const key = this.keyMesh('#c9a060', 0.5);
    key.position.set(0, 0.12, 0);
    this.drawerFront.add(key);
  }

  private oilLamp(x: number, y: number, z: number, light: boolean) {
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), this.std('#b07a3a', { metalness: 0.6, roughness: 0.4 }));
    body.scale.set(1.5, 0.8, 1);
    body.rotation.x = Math.PI;
    body.position.set(x, y + 0.08, z);
    this.scene.add(body);
    this.candle(x + 0.12, y + 0.02, z, light).scale.setScalar(0.6);
  }

  private keyMesh(color: string, scale = 1) {
    const g = new THREE.Group();
    const m = this.std(color, { metalness: 0.9, roughness: 0.25, emissive: '#2a1a04' });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.02, 8, 20), m);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.3, 8), m);
    shaft.rotation.z = Math.PI / 2;
    shaft.position.x = 0.22;
    const bit = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.08, 0.02), m);
    bit.position.set(0.34, -0.04, 0);
    g.add(ring, shaft, bit);
    g.scale.setScalar(scale);
    return g;
  }

  /** A pickable or placeable item; `bob` makes it float and spin while it waits to be picked up. */
  private addItem(id: string, obj: THREE.Object3D, bob = true) {
    obj.visible = false;
    this.scene.add(obj);
    this.itemMeshes.set(id, obj);
    if (!bob) return;
    this.halo(obj);
    const y0 = obj.position.y;
    this.animated.push((t) => {
      if (obj.userData['flying']) return;
      obj.position.y = y0 + Math.sin(t * 2 + y0) * 0.05;
      obj.rotation.y = t * 0.8;
    });
  }

  /** Small 3D model of a journey item (used on pedestals and as pickups). */
  private itemModel(id: string): THREE.Object3D {
    const g = new THREE.Group();
    const glow = (col: string) => this.std(col, { emissive: col, emissiveIntensity: 0.6, roughness: 0.3 });
    switch (id) {
      case 'antique-key': return this.keyMesh('#c9a060', 0.6);
      case 'golden-key': return this.keyMesh('#ffd24a', 0.6);
      case 'lamp-base': g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.08, 20), this.gold())); break;
      case 'lamp-tank': g.add(new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), this.std('#b07a3a', { metalness: 0.7 }))); break;
      case 'lamp-wick': g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.16, 6), this.std('#f1e7cf'))); break;
      case 'lamp-glass': g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.22, 20, 1, true), new THREE.MeshStandardMaterial({ color: '#dff1ff', transparent: true, opacity: 0.4, side: THREE.DoubleSide }))); break;
      case 'lamp-cover': g.add(new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.12, 16), this.gold())); break;
      case 'menorah-symbol': {
        const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), new THREE.MeshBasicMaterial({ map: glyphTexture('🕎'), transparent: true, side: THREE.DoubleSide }));
        g.add(plate);
        break;
      }
      case 'flame-symbol': g.add(new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), new THREE.MeshBasicMaterial({ map: glyphTexture('🔥'), transparent: true, side: THREE.DoubleSide }))); break;
      case 'light-stone': g.add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.13), glow('#ffe9a6'))); break;
      case 'blue-crystal': g.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.15), glow('#5aa8ff'))); break;
      case 'golden-jug': {
        const pts = [0, 0.1, 0.13, 0.11, 0.05, 0.06, 0.08].map((r, k) => new THREE.Vector2(r, k * 0.05));
        g.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 20), this.std('#e7b84a', { metalness: 0.9, roughness: 0.25, emissive: '#3a2604' })));
        break;
      }
      case 'map-left':
      case 'map-middle':
      case 'map-right': {
        const piece = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.9), new THREE.MeshStandardMaterial({
          map: mapTexture(id.slice(4) as 'left' | 'middle' | 'right'), transparent: true, side: THREE.DoubleSide, roughness: 0.9,
        }));
        piece.rotation.x = -Math.PI / 2;
        g.add(piece);
        break;
      }
      case 'sym-compass':
      case 'sym-key':
      case 'sym-book':
      case 'sym-lamp': {
        const kind = ({ 'sym-compass': 'compass', 'sym-key': 'key', 'sym-book': 'book', 'sym-lamp': 'lamp' } as const)[id];
        const face = symbolTexture(kind);
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.04, 40), [
          this.wood('#6a4422'), this.std('#ffffff', { map: face, emissive: '#ffffff', emissiveMap: face, emissiveIntensity: 0.45, roughness: 0.7 }), this.wood('#6a4422'),
        ]);
        disc.rotation.x = Math.PI / 2;
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.012, 6, 28), this.gold());
        g.add(disc, rim);
        break;
      }
      case 'gs-golden-key': return this.keyMesh('#ffd24a', 0.6);
      // the four things weighed on the ancient scales; each one stands on y = 0
      case 'sc-feather': {
        const vane = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 8), this.std('#f6f1e4', { roughness: 0.95, emissive: '#2a2620' }));
        vane.scale.set(0.07, 0.012, 0.19);
        vane.position.set(0, 0.02, 0.02);
        const quill = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.004, 0.26, 6), this.std('#d9c9a0'));
        quill.rotation.x = Math.PI / 2;
        quill.position.y = 0.02;
        g.add(vane, quill);
        g.rotation.y = 0.5;
        break;
      }
      case 'sc-key': {
        const key = this.keyMesh('#8a7a60', 0.55);
        key.rotation.x = -Math.PI / 2;
        key.position.set(-0.1, 0.03, 0);
        g.add(key);
        break;
      }
      case 'sc-crystal': {
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.1), glow('#b77cff'));
        gem.scale.y = 1.6;
        gem.position.y = 0.17;
        g.add(gem);
        break;
      }
      case 'sc-hourglass': {
        const wood = this.std('#6a4422');
        const glass = new THREE.MeshStandardMaterial({ color: '#e8f4ff', transparent: true, opacity: 0.45, roughness: 0.1 });
        const sand = this.std('#e2bd6a');
        for (const y of [0.012, 0.268]) {
          const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.024, 16), wood);
          disc.position.y = y;
          g.add(disc);
        }
        const upper = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.12, 16, 1, true), glass);
        upper.position.y = 0.2;
        upper.rotation.x = Math.PI;
        const lower = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.12, 16, 1, true), glass);
        lower.position.y = 0.08;
        const heap = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.06, 16), sand);
        heap.position.y = 0.055;
        g.add(upper, lower, heap);
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * Math.PI * 2;
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.25, 6), this.gold());
          post.position.set(Math.cos(a) * 0.075, 0.14, Math.sin(a) * 0.075);
          g.add(post);
        }
        break;
      }
      case 'gear-large':
      case 'gear-small':
      case 'gear-medium': {
        const r = id === 'gear-large' ? 0.34 : id === 'gear-small' ? 0.17 : 0.25;
        const brass = this.std('#c9a24d', { metalness: 0.85, roughness: 0.3 });
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.05, 32), brass);
        g.add(wheel);
        const teeth = Math.round(r * 60);
        for (let k = 0; k < teeth; k++) {
          const a = (k / teeth) * Math.PI * 2;
          const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), brass);
          tooth.position.set(Math.cos(a) * (r + 0.02), 0, Math.sin(a) * (r + 0.02));
          tooth.rotation.y = -a;
          g.add(tooth);
        }
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.07, 12), this.std('#3a2414'));
        g.add(hub);
        break;
      }
      default:
        if (id.startsWith('dreidel-')) return this.dreidelModel(id, 0.25);
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.15), this.gold()));
    }
    return g;
  }

  private dreidelModel(id: string, s: number) {
    const letter: Record<string, string> = { 'dreidel-nun': 'נ', 'dreidel-gimel': 'ג', 'dreidel-he': 'ה', 'dreidel-pe': 'פ' };
    const colors: Record<string, string> = { 'dreidel-nun': '#c94a3a', 'dreidel-gimel': '#3a7ac9', 'dreidel-he': '#3aa65a', 'dreidel-pe': '#c9a03a' };
    const g = new THREE.Group();
    const tex = glyphTexture(letter[id] ?? '?', '#fff4cf', 128, 'Frank Ruhl Libre, serif');
    const faceMat = this.std(colors[id] ?? '#c9a03a', { map: tex, roughness: 0.5 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), faceMat);
    body.position.y = s * 0.9;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(s * 0.7, s * 0.7, 4), this.std(colors[id] ?? '#c9a03a'));
    tip.rotation.set(Math.PI, Math.PI / 4, 0);
    tip.position.y = s * 0.35;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.08, s * 0.08, s * 0.5, 8), this.std('#3a2414'));
    handle.position.y = s * 1.6;
    g.add(body, tip, handle);
    return g;
  }

  // ---------------------------------------------------------------------- 2 · workshop

  /** Zones on a table and the separate parts that are dragged onto them (shown there once the group has them). */
  private buildAssembly(puzzle: string, kind: 'ring' | 'square' | 'pan', make: (item: string) => THREE.Object3D, gripY: number) {
    const def = ASSEMBLIES[puzzle];
    const c = hCenter(def.zone);
    const pads = new Map<string, THREE.Mesh>();
    def.slots.forEach((slot, k) => {
      const [x, z] = def.pad[slot];
      const ring = new THREE.Mesh(
        kind === 'ring' ? new THREE.RingGeometry(0.2, 0.27, 32) : kind === 'pan' ? new THREE.RingGeometry(0.1, 0.13, 28) : new THREE.RingGeometry(0.27, 0.33, 4, 1),
        // not tone-mapped, so the red of a wrong arrangement stays red in the bright room
        new THREE.MeshBasicMaterial({ color: '#e2c27a', transparent: true, opacity: 0.55, toneMapped: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      if (kind === 'square') ring.rotation.z = Math.PI / 4;
      ring.position.set(x, def.top + 0.007, c + z);
      this.scene.add(ring);
      if (kind === 'ring') {
        const num = new THREE.Mesh(new THREE.CircleGeometry(0.19, 24), new THREE.MeshBasicMaterial({ map: glyphTexture(String(k + 1), '#e2c27a', 128, 'Heebo, sans-serif'), transparent: true, opacity: 0.6 }));
        num.rotation.x = -Math.PI / 2;
        num.position.set(x, def.top + 0.006, c + z);
        this.scene.add(num);
      } else if (kind === 'square') {
        // a softly lit square where the dreidel stands
        const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.44), new THREE.MeshBasicMaterial({ color: '#ffe6a0', transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }));
        glow.rotation.x = -Math.PI / 2;
        glow.position.set(x, def.top + 0.005, c + z);
        this.scene.add(glow);
      }
      pads.set(slot, ring);
    });
    const parts = new Map<string, THREE.Object3D>();
    for (const id of Object.keys(def.tray)) {
      const part = make(id);
      part.visible = false;
      part.userData['benchItem'] = id;
      // a generous invisible grip, so thin parts (the wick) are easy to take with a finger too
      const grip = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8), new THREE.MeshBasicMaterial({ visible: false }));
      grip.position.y = gripY;
      part.add(grip);
      this.scene.add(part);
      parts.set(id, part);
    }
    this.asm.set(puzzle, { def, pads, parts, slots: {}, flash: -10 });
  }

  private buildWorkshop() {
    const c = hCenter('workshop');
    this.desk(c, 5.2, 1.6, -1.4, '#6a4a2a');
    // five separate assembly zones on the bench (1 = the bottom of the lamp); parts are dragged onto them
    this.buildAssembly('h2-lamp', 'ring', (id) => {
      const part = this.itemModel(id);
      part.scale.setScalar(BENCH_SCALE);
      return part;
    }, 0);
    // an easel with a clear drawing of the assembled lamp
    const easel = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.5), this.std('#ffffff', { map: lampDrawingTexture(), roughness: 0.8 }));
    easel.position.set(-3.3, 1.75, c - 1.9);
    easel.rotation.set(-0.15, 0.35, 0);
    this.box(0.06, 1.6, 0.06, this.std('#3a2414'), -3.3, 0.8, c - 2.05).rotation.z = 0.06;
    this.scene.add(easel);
    // the assembled lamp lights up, its beam hits the wall, the key symbol appears and the hidden panel slides open
    const [lx, lz] = BENCH_PAD['s3'];
    this.lampGlow = new THREE.PointLight('#ffcf7a', 0, 9, 1.4);
    this.lampGlow.position.set(lx, BENCH_TOP + 0.55, c + lz);
    this.scene.add(this.lampGlow);
    this.lampFlame = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.12, 10), new THREE.MeshBasicMaterial({ color: '#ffcf6a', transparent: true, opacity: 0 }));
    this.lampFlame.position.set(lx, BENCH_TOP + 0.5, c + lz);
    this.scene.add(this.lampFlame);
    this.lampBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.45, 1, 20, 1, true), new THREE.MeshBasicMaterial({
      color: '#ffd98a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    const from = new THREE.Vector3(lx, BENCH_TOP + 0.65, c + lz);
    const to = new THREE.Vector3(-2.6, 2.3, c - H_HALF_D + 0.1);
    this.lampBeam.scale.set(1, from.distanceTo(to), 1);
    this.lampBeam.position.copy(from).lerp(to, 0.5);
    this.lampBeam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    this.scene.add(this.lampBeam);
    this.keySymbol = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), new THREE.MeshBasicMaterial({ map: glyphTexture('🗝️'), transparent: true, opacity: 0, depthWrite: false }));
    this.keySymbol.position.set(-2.6, 2.3, c - H_HALF_D + 0.05);
    this.scene.add(this.keySymbol);
    // hidden compartment in the wall: a dark niche with the key, behind a sliding wooden panel
    this.box(0.9, 0.7, 0.05, this.std('#120c08'), 1.8, 1.6, c - H_HALF_D + 0.03);
    const hiddenKey = this.keyMesh('#c9a060', 0.6);
    hiddenKey.position.set(1.65, 1.6, c - H_HALF_D + 0.12);
    this.scene.add(hiddenKey);
    this.wallPanel = this.box(0.95, 0.75, 0.08, this.wood('#5e3a1e'), 1.8, 1.6, c - H_HALF_D + 0.12);
    this.openTargets.set(this.wallPanel, { axis: 'x', kind: 'pos', from: 1.8, to: 2.85, on: false });
    this.addLight(1.8, 2.4, c - H_HALF_D + 1.2, '#ffd9a8', 3, 4, false);
    this.scroll(-2.35, 1.02, c - 1.95, 0.2);
    // oil bottle, tools wall, drawers, shelves
    const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.3, 14), new THREE.MeshStandardMaterial({ color: '#b8a040', transparent: true, opacity: 0.7, roughness: 0.1 }));
    bottle.position.set(2.35, 1.15, c - 1.95);
    this.scene.add(bottle);
    this.box(0.1, 1.6, 2.4, this.wood('#3a2414'), -7.85, 2.2, c + 0.5);
    for (let k = 0; k < 6; k++) this.box(0.06, 0.4 + (k % 3) * 0.1, 0.06, this.std('#7a7a80', { metalness: 0.8 }), -7.7, 2.0, c - 0.5 + k * 0.4);
    this.box(1.2, 1.0, 0.6, this.wood('#4a2c16'), -6.4, 0.5, c - 4.2);
    this.box(0.6, 2.8, 2.4, this.wood('#3a2414'), 7.6, 1.4, c + 1.5);
    for (let k = 0; k < 5; k++) {
      const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.3, 12), this.std(['#7a4a2a', '#4a6a7a', '#8a7a3a'][k % 3]));
      jar.position.set(7.4, 2.95, c + 0.7 + k * 0.4);
      this.scene.add(jar);
    }
    this.box(1.4, 0.06, 0.6, this.wood(), 6.2, 1.3, c - 3.6);
    this.box(0.08, 1.3, 0.08, this.std('#3a2414'), 6.2, 0.65, c - 3.6);
    this.box(0.8, 0.06, 0.4, this.wood(), 2.4, 2.1, c - 6.6);
    // the five parts lying around the room
    const where: Record<string, [number, number, number]> = {
      'lamp-base': [-5.4, 0.35, 3.2], 'lamp-tank': [6.2, 1.55, -3.6], 'lamp-wick': [-6.4, 1.15, -4.2], 'lamp-glass': [4.6, 0.3, 4.4], 'lamp-cover': [2.4, 2.35, -6.4],
    };
    for (const [id, [x, y, z]] of Object.entries(where)) {
      const m = this.itemModel(id);
      m.position.set(x, y, c + z);
      m.scale.setScalar(1.6);
      this.addItem(id, m);
    }
    this.addLight(0, 2.4, c - 2.5, '#ffb46a', 4, 7);
  }

  // ---------------------------------------------------------------------- 3 · magnetic maze

  private buildMaze(scenario: ScenarioContent | null) {
    const c = hCenter('maze');
    const grid: string[] = scenario?.puzzles.find((p) => p.id === 'h3-maze')?.publicData?.grid ?? [];
    const rows = grid.length;
    const cols = grid[0]?.length ?? 0;
    this.mazeGrid = grid;
    this.mazeGateIds = (scenario?.puzzles.find((p) => p.id === 'h3-maze')?.publicData?.levers ?? []).map((l: { gate: string }) => l.gate);
    // the mechanical table under a glass top
    this.box(cols * MAZE_CELL + 0.6, 0.9, rows * MAZE_CELL + 0.6, this.wood('#3a2414'), 0, 0.45, c - 1.0);
    const board = this.box(cols * MAZE_CELL + 0.3, 0.06, rows * MAZE_CELL + 0.3, this.std('#1e2a44', { roughness: 0.5 }), 0, 0.93, c - 1.0);
    board.castShadow = false;
    this.mazeOrigin.set(-(cols - 1) * MAZE_CELL / 2, 0.98, c - 1.0 - (rows - 1) * MAZE_CELL / 2);
    const cell = (r: number, col: number) => new THREE.Vector3(this.mazeOrigin.x + col * MAZE_CELL, this.mazeOrigin.y, this.mazeOrigin.z + r * MAZE_CELL);
    const wallMat = this.std('#8a6a3a', { metalness: 0.6, roughness: 0.4 });
    const gateMat = this.std('#5a8ad0', { metalness: 0.7, roughness: 0.3, emissive: '#10204a' });
    const symbols: Record<string, string> = { '*': '⭐', F: '🔥', M: '🕎', E: '📦' };
    grid.forEach((line, r) => [...line].forEach((ch, col) => {
      const p = cell(r, col);
      if (ch === '#') this.box(MAZE_CELL, 0.12, MAZE_CELL, wallMat, p.x, p.y + 0.04, p.z).castShadow = false;
      else if ('abc'.includes(ch)) {
        const gate = this.box(MAZE_CELL * 0.9, 0.12, MAZE_CELL * 0.9, gateMat, p.x, p.y + 0.04, p.z);
        this.mazeGates.set(ch, gate);
      } else if (symbols[ch]) {
        const s = new THREE.Mesh(new THREE.PlaneGeometry(MAZE_CELL * 0.85, MAZE_CELL * 0.85), new THREE.MeshBasicMaterial({ map: glyphTexture(symbols[ch]), transparent: true }));
        s.rotation.x = -Math.PI / 2;
        s.position.set(p.x, p.y - 0.01, p.z);
        this.scene.add(s);
      }
    }));
    const glass = new THREE.Mesh(new THREE.BoxGeometry(cols * MAZE_CELL + 0.3, 0.02, rows * MAZE_CELL + 0.3), new THREE.MeshStandardMaterial({ color: '#cfe8ff', transparent: true, opacity: 0.12, roughness: 0.05 }));
    glass.position.set(0, 1.18, c - 1.0);
    this.scene.add(glass);
    this.mazeKey = this.keyMesh('#ffd24a', 0.45);
    this.mazeKey.position.copy(cell(1, 1)).add(new THREE.Vector3(0, 0.05, 0));
    this.mazeKeyTarget.copy(this.mazeKey.position);
    this.scene.add(this.mazeKey);
    this.halo(this.mazeKey, '#ffe08a', 0.5);
    // an easy grip around the small key
    const keyGrip = new THREE.Mesh(new THREE.SphereGeometry(0.36, 10, 8), new THREE.MeshBasicMaterial({ visible: false }));
    keyGrip.position.x = 0.15;
    keyGrip.userData['maze'] = 'key';
    this.mazeKey.add(keyGrip);
    // magnetic rod
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 10), this.std('#c03030', { metalness: 0.5 }));
    rod.rotation.z = 0.6;
    rod.position.set(-1.9, 1.1, c - 0.4);
    this.scene.add(rod);
    // three levers
    for (let k = 0; k < 3; k++) {
      this.box(0.18, 0.1, 0.3, this.std('#3a2a1c'), 2.4, 0.95, c - 1.6 + k * 0.6);
      const lever = new THREE.Group();
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 8), this.std('#9a9aa0', { metalness: 0.8 }));
      arm.position.y = 0.25;
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), this.std(['#c03030', '#3070c0', '#30a050'][k]));
      knob.position.y = 0.5;
      // bigger levers with a clear grip
      arm.scale.set(1.6, 1.3, 1.6);
      arm.position.y = 0.32;
      knob.scale.setScalar(1.7);
      knob.position.y = 0.66;
      const grip = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshBasicMaterial({ visible: false }));
      grip.position.y = 0.55;
      grip.userData['maze'] = 'lever' + k;
      lever.add(arm, knob, grip);
      lever.userData['knob'] = knob;
      lever.position.set(2.4, 1.0, c - 1.6 + k * 0.6);
      lever.rotation.z = 0.5;
      this.scene.add(lever);
      this.mazeLevers.push(lever);
    }
    // symbol board on the back wall
    const boardTex = sheetTexture(['⭐   🔥   🕎'], { bg: '#2a2016', color: '#ffd36b', w: 512, h: 220, size: 80 });
    const sb = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.0), this.std('#ffffff', { map: boardTex }));
    sb.position.set(0, 2.6, c - H_HALF_D + 0.06);
    this.scene.add(sb);
    this.scroll(-2.8, 1.02, c - 1.0, -0.2);
    this.box(0.8, 0.06, 0.6, this.wood(), -2.8, 0.97, c - 1.0);
    // metal box at the end of the maze: bigger, gilded edges, a soft gold light and a halo once it can be opened
    this.box(0.9, 0.06, 0.7, this.wood('#3a2414'), 3.3, 0.95, c - 2.25);
    this.metalBox = this.box(0.66, 0.42, 0.5, this.std('#70707a', { metalness: 0.85, roughness: 0.32 }), 3.3, 1.19, c - 2.25);
    this.metalBox.userData['maze'] = 'box';
    for (const dx of [-0.34, 0.34]) this.box(0.03, 0.44, 0.52, this.gold(), 3.3 + dx, 1.19, c - 2.25);
    const lockPlate = this.box(0.16, 0.16, 0.02, this.gold(), 3.3, 1.2, c - 1.99);
    lockPlate.userData['maze'] = 'box';
    this.boxHalo = this.halo(this.metalBox, '#ffd36b', 1.6);
    this.boxHalo.material.opacity = 0.2;
    this.addLight(3.3, 2.1, c - 1.6, '#ffd59a', 3.5, 4, false);
    const lid = new THREE.Group();
    const lidMesh = this.box(0.68, 0.07, 0.52, this.std('#80808a', { metalness: 0.85, roughness: 0.3 }), 0, 0, 0.26, lid);
    lidMesh.castShadow = true;
    lid.position.set(3.3, 1.43, c - 2.51);
    this.scene.add(lid);
    this.metalBoxLid = lid;
    this.openTargets.set(lid, { axis: 'x', kind: 'rot', from: 0, to: -1.6, on: false });
    this.addLight(0, 2.6, c - 1, '#9ab8ff', 5, 8);
    // short instructions next to the mechanism, and the code plate of the collection compartment
    const leverHint = this.label('לחצו על ידית כדי להזיז אותה', 1.3, 0.26, 3.75, 1.6, c - 0.55, -0.7, { bg: '#2a2016', color: '#ffd36b' });
    const keyHint = this.label('גררו את המפתח על הלוח לאורך המסלול', 2.0, 0.3, 0, 1.5, c - 2.4, 0, { bg: '#2a2016', color: '#ffd36b' });
    this.mazeHints.push(leverHint, keyHint);
    this.mazeCodePlate = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.32), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }));
    this.mazeCodePlate.position.set(this.mazeOrigin.x + (cols - 1) * MAZE_CELL + 0.45, 1.3, this.mazeOrigin.z + 5 * MAZE_CELL);
    this.mazeCodePlate.rotation.y = -0.5;
    this.scene.add(this.mazeCodePlate);
  }

  // ---------------------------------------------------------------------- 4 · cipher room

  private buildCipher() {
    const c = hCenter('cipher');
    this.desk(c, 6.0, 1.8, -1.1);
    // three number tablets on the back wall: 1 — 6 — 200, read from left to right
    ['1', '6', '200'].forEach((n, k) => {
      const t = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), this.std('#ffffff', { map: numberTexture(n), emissive: '#0a1430' }));
      // on the wall left of the door, still read from left to right
      t.position.set(-5.2 + k * 1.4, 2.6, c - H_HALF_D + 0.06);
      this.scene.add(t);
    });
    // the gematria board on the left wall
    const rows = ['א=1  ב=2  ג=3  ד=4  ה=5  ו=6', 'ז=7  ח=8  ט=9  י=10  כ=20', 'ל=30  מ=40  נ=50  ס=60  ע=70', 'פ=80  צ=90  ק=100  ר=200', 'ש=300  ת=400'];
    const gb = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.9), this.std('#ffffff', { map: sheetTexture(rows, { title: 'לוח ערכי גימטריה', w: 640, h: 480, size: 34 }) }));
    gb.rotation.y = Math.PI / 2;
    gb.position.set(-H_HALF_W + 0.06, 2.2, c - 1.5);
    this.scene.add(gb);
    // the letter wheel: a large mechanism on the desk — three engraved gilded rings on one axle between carved posts,
    // with a dark wooden base, gold rims between the rings and a blue light under it
    const wx = 0.45;
    const wy = 1.72;
    const wz = c - 1.35;
    const darkWood = this.wood('#2e1a0c');
    this.box(1.5, 0.16, 0.8, darkWood, wx, 1.08, wz);
    this.box(1.6, 0.04, 0.9, this.gold(), wx, 1.0, wz);
    const band = wheelBandTexture();
    for (let k = 0; k < 3; k++) {
      const ring = new THREE.Group();
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.26, LETTERS.length, 1, true), this.std('#c9b48a', { map: band, metalness: 0.35, roughness: 0.55 }));
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.25, 32), this.std('#2a1a0c'));
      ring.add(drum, disc);
      // the holder lays the drum on the axle; the drum spins around it — the letter facing the player is the one that counts
      const holder = new THREE.Group();
      holder.rotation.z = Math.PI / 2;
      holder.position.set(wx - 0.32 + k * 0.32, wy, wz);
      holder.add(ring);
      this.scene.add(holder);
      this.wheelRings.push(ring);
    }
    for (let k = 0; k < 4; k++) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.49, 0.035, 10, 48), this.gold());
      rim.rotation.y = Math.PI / 2;
      rim.position.set(wx - 0.48 + k * 0.32, wy, wz);
      this.scene.add(rim);
    }
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.5, 12), this.gold());
    axle.rotation.z = Math.PI / 2;
    axle.position.set(wx, wy, wz);
    this.scene.add(axle);
    for (const sx of [-1, 1]) {
      this.box(0.12, 0.66, 0.24, darkWood, wx + sx * 0.7, 1.45, wz);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 10), this.gold());
      cap.position.set(wx + sx * 0.7, 1.8, wz);
      this.scene.add(cap);
    }
    // a gilded reading window marks the letters that count
    for (const dy of [-0.15, 0.15]) this.box(1.02, 0.025, 0.025, this.gold(), wx, wy + dy, wz + 0.47);
    for (const dx of [-0.51, 0.51]) this.box(0.025, 0.32, 0.025, this.gold(), wx + dx, wy, wz + 0.47);
    this.addLight(wx, 1.3, wz + 0.9, '#6aa8ff', 1.8, 3, false);
    this.box(0.9, 0.3, 0.5, this.wood('#4a2c16'), 0.5, 0.75, c - 1.2);
    this.scroll(-2.2, 1.02, c - 1.2, 0.3);
    const book = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.42), this.std('#ffffff', { map: parchmentTexture() }));
    book.position.set(2.4, 1.04, c - 1.2);
    this.scene.add(book);
    for (let k = 0; k < 3; k++) this.box(0.03, 0.12, 0.01, this.std('#a02020'), 2.25 + k * 0.12, 1.1, c - 1.0);
    const inkwell = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.08, 12), this.std('#141418', { roughness: 0.2 }));
    inkwell.position.set(1.6, 1.04, c - 0.7);
    const quill = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.4, 6), this.std('#f2efe6'));
    quill.position.set(1.65, 1.2, c - 0.7);
    quill.rotation.z = 0.4;
    this.scene.add(inkwell, quill);
    for (let k = 0; k < 3; k++) {
      const seal = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 14), this.std('#9a1a1a'));
      seal.position.set(-1.35 + k * 0.13, 1.01, c - 0.7);
      this.scene.add(seal);
    }
    // the blue lamp lighting the numbers
    this.addLight(-3.8, 3.6, c - 5.4, '#6aa8ff', 9, 7, false);
    const blue = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), new THREE.MeshBasicMaterial({ color: '#8fc4ff' }));
    blue.position.set(-3.8, 3.9, c - 5.6);
    this.scene.add(blue);
    this.halo(blue, '#8fc4ff', 1.4);
    this.shelfWall(H_HALF_W - 0.3, c, -1.0, -Math.PI / 2, 21);
  }

  // ---------------------------------------------------------------------- 5 · dreidels

  private buildDreidels() {
    const c = hCenter('dreidels');
    // the giant golden dreidel on a rotating base
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.1, 0.5, 32), this.wood('#4a2c16'));
    base.position.set(0, 0.25, c - 3.4);
    this.scene.add(base);
    const big = new THREE.Group();
    const faces = ['נ', 'ג', 'ה', 'פ'].map((l) => this.std('#e2b34a', { metalness: 0.85, roughness: 0.3, map: glyphTexture(l, '#5a2a08', 256, 'Frank Ruhl Libre, serif') }));
    const cube = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 1.0), [faces[0], faces[1], this.gold(), this.gold(), faces[2], faces[3]]);
    cube.position.y = 1.4;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.7, 0.7, 4), this.gold());
    tip.rotation.set(Math.PI, Math.PI / 4, 0);
    tip.position.y = 0.75;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.6, 12), this.gold());
    handle.position.y = 2.2;
    big.add(cube, tip, handle);
    big.position.set(0, 0.0, c - 3.4);
    this.scene.add(big);
    this.animated.push((t) => (big.rotation.y = t * 0.35));
    this.addLight(0, 3.2, c - 2.4, '#ffcf80', 7, 8);
    // the table with the dreidel stand: a large gilded 2×2 board, softly lit, and four hint cards beside it
    this.box(3.6, 0.08, 1.9, this.wood(), 2.8, 0.95, c - 1.2);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) this.box(0.1, 0.9, 0.1, this.std('#3a2414'), 2.8 + sx * 1.6, 0.45, c - 1.2 + sz * 0.8);
    this.box(1.6, 0.05, 1.25, this.wood('#2e1a0c'), 2.8, 1.02, c - 1.4);
    for (const dz of [-0.64, 0.64]) this.box(1.66, 0.07, 0.06, this.gold(), 2.8, 1.04, c - 1.4 + dz);
    for (const dx of [-0.82, 0.82]) this.box(0.06, 0.07, 1.34, this.gold(), 2.8 + dx, 1.04, c - 1.4);
    this.box(0.03, 0.02, 1.2, this.gold(), 2.8, 1.05, c - 1.4);
    this.box(1.56, 0.02, 0.03, this.gold(), 2.8, 1.05, c - 1.4);
    this.label('מתקן הסביבונים', 1.2, 0.26, 2.8, 1.35, c - 2.1, 0, { bg: '#2a2016', color: '#ffd36b' });
    this.addLight(2.8, 2.6, c - 1.0, '#ffe2a8', 5, 5, false);
    this.buildAssembly('h5-stand', 'square', (id) => this.dreidelModel(id, 0.2), 0.18);
    const cards: [number, number][] = [[1.45, -1.65], [1.45, -1.0], [4.15, -1.65], [4.15, -1.0]];
    for (const [x, z] of cards) {
      const card = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.24), this.std('#ffffff', { map: parchmentTexture() }));
      card.rotation.x = -Math.PI / 2;
      card.position.set(x, 1.0, c + z);
      this.scene.add(card);
    }
    // wooden box with a numeric lock
    this.box(1.0, 0.6, 0.6, this.wood('#5a3416'), -2.8, 0.3, c - 1.6);
    const lid = new THREE.Group();
    this.box(1.0, 0.08, 0.6, this.wood('#6a4422'), 0, 0, 0.3, lid).castShadow = true;
    lid.position.set(-2.8, 0.64, c - 1.9);
    this.scene.add(lid);
    this.woodBoxLid = lid;
    this.openTargets.set(lid, { axis: 'x', kind: 'rot', from: 0, to: -1.7, on: false });
    // floor with direction marks, gears, coins and candlesticks
    const marks = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ map: glyphTexture('⬆', '#c9a24d'), transparent: true, opacity: 0.35 }));
    marks.rotation.x = -Math.PI / 2;
    marks.position.set(0, 0.015, c + 2.2);
    this.scene.add(marks);
    for (let k = 0; k < 3; k++) {
      const gear = new THREE.Mesh(new THREE.TorusGeometry(0.35 - k * 0.08, 0.06, 6, 12), this.std('#8a6a3a', { metalness: 0.8 }));
      gear.position.set(-7.85, 2.4 + k * 0.6, c - 2 + k * 0.7);
      gear.rotation.y = Math.PI / 2;
      this.scene.add(gear);
      this.animated.push((t) => (gear.rotation.x = t * (k % 2 ? -0.4 : 0.4)));
    }
    this.box(1.4, 0.06, 0.7, this.wood(), -6.6, 1.0, c + 1.0);
    for (let k = 0; k < 6; k++) {
      const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.015, 14), this.gold());
      coin.position.set(-6.9 + k * 0.1, 1.04, c + 0.9 + (k % 2) * 0.15);
      this.scene.add(coin);
    }
    this.candle(-6.2, 1.03, c + 1.2, true);
    // the four small dreidels hidden in the room
    const where: Record<string, [number, number, number]> = {
      'dreidel-nun': [-5.6, 0.05, 3.6], 'dreidel-gimel': [5.8, 0.95, -4.4], 'dreidel-he': [-6.2, 0.95, -3.2], 'dreidel-pe': [4.2, 0.05, 4.8],
    };
    this.box(1.0, 0.9, 0.6, this.wood('#4a2c16'), 5.8, 0.45, c - 4.4);
    this.box(1.0, 0.9, 0.6, this.wood('#4a2c16'), -6.2, 0.45, c - 3.2);
    for (const [id, [x, y, z]] of Object.entries(where)) {
      const m = this.dreidelModel(id, 0.22);
      m.position.set(x, y, c + z);
      this.addItem(id, m);
    }
  }

  // ---------------------------------------------------------------------- 6 · oil lab

  private buildLab(scenario: ScenarioContent | null) {
    const c = hCenter('lab');
    this.box(6.4, 0.9, 1.6, this.std('#6a6670', { map: stoneTexture([2, 1]) }), 0, 0.45, c - 2.2);
    const jugs: { id: string; text: string }[] = scenario?.puzzles.find((p) => p.id === 'h6-jugs')?.publicData?.jugs ?? [];
    const pts = [0, 0.32, 0.42, 0.38, 0.22, 0.14, 0.18, 0.2].map((r, k) => new THREE.Vector2(r, k * 0.14));
    jugs.forEach((j, k) => {
      // left to right as seen from the room: א, ב, ג, ד
      const x = -2.4 + k * 1.6;
      const jug = new THREE.Mesh(new THREE.LatheGeometry(pts, 24), this.std('#c8a46a', { roughness: 0.55 }));
      jug.position.set(x, 0.9, c - 2.2);
      this.scene.add(jug);
      const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ map: glyphTexture(j.id, '#3a2410', 128, 'Frank Ruhl Libre, serif'), transparent: true }));
      tag.position.set(x, 1.35, c - 1.78);
      this.scene.add(tag);
      this.label(j.text, 1.4, 0.35, x, 0.55, c - 1.39, 0);
    });
    const sign = this.label('„רק אחת מארבע הכתובות שעל הכדים נכונה.”', 4.8, 0.6, 0, 3.1, c - 3.55, 0, { bg: '#2a2016', color: '#ffd36b' });
    sign.renderOrder = 1;
    this.box(5.2, 0.8, 0.1, this.std('#2a2016'), 0, 3.1, c - 3.62);
    // the pure oil jug revealed in a niche after the right choice
    this.jugGlow = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), new THREE.MeshBasicMaterial({ color: '#ffd36b', transparent: true, opacity: 0 }));
    this.jugGlow.position.set(0, 1.4, c - 3.3);
    this.scene.add(this.jugGlow);
    // scales, test tubes, shelves, book, lab lamp
    const scaleBar = this.box(0.9, 0.04, 0.04, this.gold(), -4.4, 1.6, c - 3.0);
    this.box(0.04, 0.7, 0.04, this.gold(), -4.4, 1.25, c - 3.0);
    for (const sx of [-1, 1]) {
      const pan = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.04, 16), this.gold());
      pan.position.set(-4.4 + sx * 0.4, 1.35, c - 3.0);
      this.scene.add(pan);
    }
    this.animated.push((t) => (scaleBar.rotation.z = Math.sin(t * 0.8) * 0.04));
    this.box(1.0, 0.9, 0.7, this.std('#5a5660', { map: stoneTexture([1, 1]) }), -4.4, 0.45, c - 3.0);
    this.box(1.2, 0.9, 0.7, this.std('#5a5660', { map: stoneTexture([1, 1]) }), 4.4, 0.45, c - 3.0);
    for (let k = 0; k < 5; k++) {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 10), new THREE.MeshStandardMaterial({ color: ['#e6c85a', '#c8a03a', '#a8c86a', '#d6b46a', '#f0e090'][k], transparent: true, opacity: 0.75 }));
      tube.position.set(4.0 + k * 0.18, 1.06, c - 3.0);
      this.scene.add(tube);
    }
    this.box(2.0, 0.9, 1.0, this.std('#5a5660', { map: stoneTexture([1, 1]) }), 3.0, 0.45, c - 0.4);
    const book = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.42), this.std('#ffffff', { map: parchmentTexture() }));
    book.position.set(3.0, 0.93, c - 0.4);
    this.scene.add(book);
    this.shelfWall(-H_HALF_W + 0.3, c, 2.0, Math.PI / 2, 31);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), new THREE.MeshBasicMaterial({ color: '#fff0c0' }));
    lamp.position.set(0, 4.6, c - 2.2);
    this.scene.add(lamp);
    this.addLight(0, 4.2, c - 2.0, '#fff0c0', 8, 8);
    // locking mechanism on the gate
    this.box(0.6, 0.6, 0.12, this.std('#7a7a82', { metalness: 0.85 }), 1.6, 2.0, c - H_HALF_D + 0.1);
  }

  // ---------------------------------------------------------------------- 7 · mosaic and mirrors

  private buildMosaic(scenario: ScenarioContent | null) {
    const c = hCenter('mosaic');
    const data = scenario?.puzzles.find((p) => p.id === 'h7-mosaic')?.publicData;
    const tiles: string[] = data?.tiles ?? [];
    const size = 0.95;
    const cx = 0;
    const cy = 2.3;
    // stone frame
    this.box(size * 3 + 0.5, size * 3 + 0.5, 0.2, this.std('#3a3448', { map: stoneTexture([1, 1]) }), cx, cy, c - H_HALF_D + 0.12);
    tiles.forEach((kind, i) => {
      const r = Math.floor(i / 3);
      const col = i % 3;
      const mat = new THREE.MeshStandardMaterial({ map: stoneGrooveTexture(kind, false), roughness: 0.6 });
      const m = new THREE.Mesh(new THREE.BoxGeometry(size * 0.94, size * 0.94, 0.12), [this.std('#2e3a52'), this.std('#2e3a52'), this.std('#2e3a52'), this.std('#2e3a52'), mat, mat]);
      m.position.set(cx + (col - 1) * size, cy + (1 - r) * size, c - H_HALF_D + 0.28);
      this.scene.add(m);
      this.mosaicStones.push({ mesh: m, kind });
    });
    // blue light source at the entry (left of the middle row) and the golden menorah symbol at the target (right)
    const src = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12), new THREE.MeshBasicMaterial({ color: '#7ab8ff' }));
    src.position.set(cx - size * 2, cy, c - H_HALF_D + 0.3);
    this.scene.add(src);
    this.halo(src, '#7ab8ff', 1.6);
    this.addLight(cx - size * 2, cy, c - H_HALF_D + 0.8, '#7ab8ff', 6, 6, false);
    const target = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), new THREE.MeshBasicMaterial({ map: glyphTexture('🕎'), transparent: true }));
    target.position.set(cx + size * 2, cy, c - H_HALF_D + 0.3);
    this.scene.add(target);
    this.mosaicBeam = new THREE.Mesh(new THREE.PlaneGeometry(size * 5, 0.12), new THREE.MeshBasicMaterial({ color: '#9fd0ff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.mosaicBeam.position.set(cx, cy, c - H_HALF_D + 0.4);
    this.scene.add(this.mosaicBeam);
    // small mirrors, levers, spare stones; the stone gate with the flame symbol is the door to the hall
    for (let k = 0; k < 3; k++) {
      const mirror = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.9), this.std('#cfe2ff', { metalness: 1, roughness: 0.05 }));
      mirror.position.set(-5.8 + k * 0.4, 1.6, c - 3.4 + k * 0.6);
      mirror.rotation.y = 0.6;
      this.scene.add(mirror);
    }
    for (let k = 0; k < 2; k++) {
      const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 8), this.std('#9a9aa0', { metalness: 0.8 }));
      lever.position.set(3.2 + k * 0.4, 1.0, c - 5.6);
      lever.rotation.z = 0.4;
      this.scene.add(lever);
    }
    this.box(1.0, 0.8, 0.8, this.std('#4a4458', { map: stoneTexture([1, 1]) }), 3.4, 0.4, c - 5.6);
    // the ancient scales — a bonus puzzle beside the mosaic, at the front of the room, clear of the board and its light
    this.buildScales(c);
    for (let k = 0; k < 4; k++) this.box(0.4, 0.4, 0.1, this.std('#3a4662'), 5.2 + (k % 2) * 0.45, 0.25, c - 2.6 + Math.floor(k / 2) * 0.3);
    const flame = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), new THREE.MeshBasicMaterial({ map: glyphTexture('🔥'), transparent: true }));
    flame.position.set(0, DOOR_H + 0.5, c - H_HALF_D + 0.05);
    this.scene.add(flame);
    this.addLight(0, 3.0, c - 2.0, '#7a9cff', 7, 10);
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), this.std('#ffffff', { map: rugTexture('#1d2a4a', '#9fd0ff', 4), roughness: 0.95 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0, 0.012, c + 0.5);
    this.scene.add(rug);
  }

  // ---------------------------------------------------------------------- 8 · hall of light

  private buildHall() {
    const c = hCenter('hall');
    // central stone pedestal with the glowing oil jug
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.75, 1.2, 24), this.std('#6a6476', { map: stoneTexture([1, 1]) }));
    ped.position.set(0, 0.6, c - 1.6);
    this.scene.add(ped);
    const jug = this.itemModel('golden-jug');
    jug.scale.setScalar(2.2);
    jug.position.set(0, 1.2, c - 1.6);
    this.scene.add(jug);
    this.halo(jug, '#ffd36b', 1.6);
    // the hall hanukkiah: same model, larger
    const h = new Hanukkiah(2.0);
    h.root.position.set(0, 0, c - 5.2);
    this.scene.add(h.root);
    this.hanukkiot.push(h);
    this.hallHanukkiah = h;
    this.box(4.2, 0.3, 1.0, this.std('#4a4458', { map: stoneTexture([2, 1]) }), 0, 0.15, c - 5.2);
    // seven pedestals in an arc, each with a hint plaque and a place for its item
    for (let k = 1; k <= 7; k++) {
      const a = Math.PI * (0.15 + (k - 1) * (0.7 / 6));
      const x = Math.cos(a) * -4.6;
      const z = -1.2 - Math.sin(a) * 3.4;
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 1.0, 16), this.std('#5a5468', { map: stoneTexture([1, 1]) }));
      p.position.set(x, 0.5, c + z);
      this.scene.add(p);
      const num = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), new THREE.MeshBasicMaterial({ map: glyphTexture(String(k), '#ffd36b', 128, 'Heebo, sans-serif'), transparent: true }));
      num.position.set(x, 0.6, c + z + 0.41);
      this.scene.add(num);
      const slot = new THREE.Group();
      slot.position.set(x, 1.15, c + z);
      this.scene.add(slot);
      this.pedestalItems.set(`p${k}`, slot);
      const mark = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.035, 8, 40), new THREE.MeshBasicMaterial({ color: '#3fbf6a', toneMapped: false }));
      mark.rotation.x = Math.PI / 2;
      mark.position.set(x, 1.02, c + z);
      mark.visible = false;
      this.scene.add(mark);
      this.pedestalMarks.set(`p${k}`, mark);
    }
    // the open book with the last riddle on a lectern
    this.box(0.12, 1.0, 0.12, this.wood('#3a2414'), 0, 0.5, c + 1.4);
    const book = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.5), this.std('#ffffff', { map: parchmentTexture() }));
    book.position.set(0, 1.05, c + 1.4);
    book.rotation.x = -0.3;
    this.scene.add(book);
    // the blue gate on the back wall
    this.hallGate = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 4.6), new THREE.MeshBasicMaterial({ map: glowSpriteTexture('#4a8cff'), transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.hallGate.position.set(0, 2.5, c - H_HALF_D + 0.08);
    this.scene.add(this.hallGate);
    const arch = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.18, 10, 40, Math.PI), this.std('#3a3448', { map: stoneTexture([2, 1]) }));
    arch.position.set(0, 2.6, c - H_HALF_D + 0.15);
    this.scene.add(arch);
    // treasure chest
    this.box(1.2, 0.6, 0.7, this.wood('#5a3416'), 5.2, 0.3, c + 2.4);
    const lid = new THREE.Group();
    this.box(1.2, 0.12, 0.7, this.std('#c9a24d', { metalness: 0.7 }), 0, 0, 0.35, lid);
    lid.position.set(5.2, 0.66, c + 2.05);
    this.scene.add(lid);
    this.openTargets.set(lid, { axis: 'x', kind: 'rot', from: 0, to: -1.6, on: false });
    this.chestLid = lid;
    // floating particles of light
    const n = this.quality === 'low' ? 80 : 220;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pos.set([(Math.random() - 0.5) * 12, Math.random() * 5, c + (Math.random() - 0.5) * 10], i * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.particles = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#ffe6a0', size: 0.05, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.scene.add(this.particles);
    this.addLight(0, 3.2, c - 3, '#7a9cff', 8, 12);
    this.addLight(0, 2.0, c - 1.0, '#ffcf80', 5, 8);
  }

  // ======================================================================= free trial game "שער הסודות"

  // ---------------------------------------------------------------------- 1 · map room

  private buildMapRoom() {
    const c = hCenter('maproom');
    // the big table with the three places for the map pieces, a book over one of them, a compass and a magnifier
    this.desk(c, 4.8, 1.8, -1.3, '#5e3e22');
    this.buildAssembly('g1-map', 'square', (id) => this.itemModel(id), 0.02);
    this.mapWhole = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 0.95), new THREE.MeshBasicMaterial({ map: mapTexture('whole'), transparent: true, opacity: 0, toneMapped: false }));
    this.mapWhole.rotation.x = -Math.PI / 2;
    this.mapWhole.position.set(0, 1.03, c - 1.5);
    this.scene.add(this.mapWhole);
    const book = this.box(0.42, 0.08, 0.32, this.std('#7a2a1e'), -1.9, 1.06, c - 0.85);
    book.rotation.y = 0.35;
    const compass = new THREE.Group();
    const caseMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.05, 24), this.gold());
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.11, 24), new THREE.MeshBasicMaterial({ map: glyphTexture('🧭', '#000', 128) }));
    face.rotation.x = -Math.PI / 2;
    face.position.y = 0.03;
    compass.add(caseMesh, face);
    compass.position.set(1.1, 1.03, c - 2.0);
    this.scene.add(compass);
    const glass = new THREE.Group();
    const lens = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.015, 8, 24), this.gold());
    lens.rotation.x = Math.PI / 2;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.22, 8), this.std('#3a2414'));
    handle.rotation.z = Math.PI / 2;
    handle.position.x = 0.2;
    glass.add(lens, handle);
    glass.position.set(1.9, 1.03, c - 0.9);
    this.scene.add(glass);
    this.scroll(-1.0, 1.02, c - 2.0, 0.3);
    const ink = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.08, 12), this.std('#141418', { roughness: 0.2 }));
    ink.position.set(-0.6, 1.04, c - 2.05);
    this.scene.add(ink);
    // a chest of drawers by the left wall: the note on top opens the upper drawer
    this.box(1.2, 1.1, 0.9, this.wood('#4a2c16'), -7.2, 0.55, c + 1.5);
    this.mapDrawer = this.box(0.9, 0.22, 0.08, this.wood('#6a4422'), -6.56, 0.92, c + 1.5);
    this.mapDrawer.rotation.y = Math.PI / 2;
    this.openTargets.set(this.mapDrawer, { axis: 'x', kind: 'pos', from: -6.56, to: -6.0, on: false });
    this.box(0.9, 0.22, 0.08, this.wood('#6a4422'), -6.56, 0.62, c + 1.5).rotation.y = Math.PI / 2;
    this.box(0.9, 0.22, 0.08, this.wood('#6a4422'), -6.56, 0.32, c + 1.5).rotation.y = Math.PI / 2;
    const note = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.22), this.std('#ffffff', { map: parchmentTexture() }));
    note.rotation.x = -Math.PI / 2;
    note.position.set(-7.0, 1.11, c + 1.2);
    this.scene.add(note);
    // a shelf with a small globe on the right wall; a map piece hides behind it
    this.box(0.6, 0.06, 1.6, this.wood('#3a2414'), 7.55, 1.4, c - 2.0);
    this.box(0.06, 1.2, 1.6, this.wood('#3a2414'), 7.85, 1.6, c - 2.0);
    const globe = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 14), this.std('#3d6a8a', { roughness: 0.5 }));
    globe.position.set(7.35, 1.65, c - 1.9);
    this.scene.add(globe);
    this.animated.push((t) => (globe.rotation.y = t * 0.3));
    // the bookcase with four books of different covers and the book symbol between them
    this.shelfWall(-7.6, c, -3.0, Math.PI / 2, 31);
    ['#8a2a1e', '#2a6a3a', '#2a4a8a', '#6a4a2a'].forEach((col, k) => this.box(0.08, 0.32, 0.24, this.std(col), -7.25, 1.5, c - 2.3 - k * 0.12));
    // the symbol board: four numbered places on a small table at the back right
    this.box(2.6, 0.08, 1.4, this.wood('#5e3e22'), 4.0, 0.95, c - 3.3);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) this.box(0.1, 0.9, 0.1, this.std('#3a2414'), 4.0 + sx * 1.15, 0.45, c - 3.3 + sz * 0.6);
    this.box(2.4, 0.03, 0.6, this.wood('#2e1a0c'), 4.0, 1.0, c - 3.5);
    this.label('לוח הסמלים', 1.0, 0.24, 4.0, 1.3, c - 3.95, 0, { bg: '#2a2016', color: '#ffd36b' });
    this.buildAssembly('g1-symbols', 'ring', (id) => this.itemModel(id), 0.14);
    // the locked cabinet with a four-digit lock; a golden key waits inside
    const body = this.box(1.6, 2.6, 0.7, this.wood('#3a2010'), -4.2, 1.3, c - 6.45);
    body.castShadow = true;
    this.box(1.4, 2.3, 0.05, this.std('#120c08'), -4.2, 1.3, c - 6.1);
    const key = this.keyMesh('#ffd24a', 0.7);
    key.position.set(-4.35, 1.4, c - 6.2);
    this.scene.add(key);
    this.halo(key, '#ffe08a', 0.6);
    for (const side of [-1, 1]) {
      const hinge = new THREE.Group();
      hinge.position.set(-4.2 + side * 0.75, 1.3, c - 6.06);
      this.box(0.74, 2.4, 0.06, this.wood('#5e3a1e'), -side * 0.37, 0, 0, hinge);
      this.box(0.6, 0.04, 0.07, this.gold(), -side * 0.37, 0.9, 0, hinge);
      this.box(0.6, 0.04, 0.07, this.gold(), -side * 0.37, -0.9, 0, hinge);
      this.scene.add(hinge);
      this.openTargets.set(hinge, { axis: 'y', kind: 'rot', from: 0, to: side * 1.9, on: false });
      this.cabinetDoors.push(hinge);
    }
    const plate = this.box(0.26, 0.34, 0.03, this.gold(), -4.2, 1.35, c - 6.0);
    const digits = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.1), new THREE.MeshBasicMaterial({ map: labelTexture('▢ ▢ ▢ ▢', { color: '#ffd36b', bg: '#1a1208', width: 256, height: 120 }) }));
    digits.position.set(-4.2, 1.42, c - 5.98);
    this.scene.add(digits);
    this.halo(plate, '#ffd36b', 0.8);
    // the symbols hidden around the room, maps on the walls, candles and a lamp
    const where: Record<string, [number, number, number]> = {
      'map-left': [-1.9, 1.04, -0.95], 'map-middle': [-6.7, 0.98, 1.9], 'map-right': [7.25, 1.5, -2.45],
      'sym-compass': [1.5, 1.18, -2.0], 'sym-key': [-2.4, 1.7, -6.6], 'sym-book': [-7.25, 1.5, -3.4], 'sym-lamp': [5.6, 1.18, 2.6],
    };
    for (const [id, [x, y, z]] of Object.entries(where)) {
      const m = this.itemModel(id);
      m.position.set(x, y, c + z);
      this.addItem(id, m);
    }
    this.box(1.0, 0.06, 0.8, this.wood(), 5.6, 0.95, c + 2.6);
    this.box(0.1, 0.95, 0.1, this.std('#3a2414'), 5.6, 0.47, c + 2.6);
    this.oilLamp(5.3, 1.0, c + 2.4, true);
    this.box(0.2, 0.06, 0.08, this.std('#7a7a80', { metalness: 0.8 }), -2.4, 1.85, c - 6.9);
    const wallMap = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.4), this.std('#ffffff', { map: mapTexture('wall'), roughness: 0.8 }));
    wallMap.position.set(3.4, 2.6, c - 6.93);
    this.scene.add(wallMap);
    this.candle(-1.9, 1.0, c - 2.0, true);
    this.addLight(4.0, 2.6, c - 3.0, '#ffe2a8', 4, 5, false);
    this.addLight(-4.2, 2.8, c - 4.6, '#ffd59a', 4, 5, false);
  }

  // ---------------------------------------------------------------------- 2 · mechanism workshop

  private buildGearworks() {
    const c = hCenter('gearworks');
    // the work bench with three axles; the lever on its right starts the mechanism
    this.desk(c, 4.8, 1.8, -1.3, '#4e3420');
    this.buildAssembly('g2-gears', 'ring', (id) => this.itemModel(id), 0.03);
    for (const slot of ASSEMBLIES['g2-gears'].slots) {
      const [x, z] = ASSEMBLIES['g2-gears'].pad[slot];
      const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 8), this.std('#9a9aa0', { metalness: 0.8 }));
      axle.position.set(x, 1.08, c + z);
      this.scene.add(axle);
    }
    const lever = new THREE.Group();
    this.box(0.24, 0.12, 0.3, this.std('#3a2a1c'), 0, -0.06, 0, lever);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.55, 8), this.std('#9a9aa0', { metalness: 0.8 }));
    arm.position.y = 0.27;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), this.std('#c03030'));
    knob.position.y = 0.55;
    const grip = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshBasicMaterial({ visible: false }));
    grip.position.y = 0.4;
    grip.userData['lever'] = true;
    lever.add(arm, knob, grip);
    lever.position.set(2.0, 1.06, c - 1.5);
    lever.rotation.z = 0.5;
    this.scene.add(lever);
    this.gearLever = lever;
    // the diagram of the gears on the back wall (large · small · medium, left to right)
    const diagram = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.3), this.std('#ffffff', { map: gearDiagramTexture(), roughness: 0.8 }));
    diagram.position.set(-4.0, 2.3, c - 6.93);
    this.scene.add(diagram);
    // the gears lying around the room: on a shelf, in a crate, on the floor
    this.box(1.4, 0.06, 0.6, this.wood('#3a2414'), -7.5, 1.35, c - 3.0);
    this.box(1.2, 0.7, 1.0, this.wood('#5a3a20'), 5.8, 0.35, c + 2.8);
    const where: Record<string, [number, number, number]> = {
      'gear-large': [-7.3, 1.42, -3.0], 'gear-small': [5.8, 0.75, 2.8], 'gear-medium': [-3.0, 0.08, 3.5],
    };
    for (const [id, [x, y, z]] of Object.entries(where)) {
      const m = this.itemModel(id);
      m.position.set(x, y, c + z);
      this.addItem(id, m);
    }
    // a small locked box
    this.box(0.7, 0.45, 0.5, this.wood('#5a3416'), 3.6, 0.23, c - 4.6);
    this.box(0.72, 0.06, 0.52, this.gold(), 3.6, 0.48, c - 4.6);
    // the exit: a gilded door with the gate symbol, which glows once the mechanism turns
    this.exitDoor = this.buildDoor('gearworks', c - H_HALF_D, '🚪');
    this.doors.set('exit' as HZone, this.exitDoor);
    this.doorOpen.set('exit' as HZone, 0);
    const beyond = new THREE.Mesh(new THREE.PlaneGeometry(DOOR_W, DOOR_H), new THREE.MeshBasicMaterial({ color: '#ffe9b0', toneMapped: false }));
    beyond.position.set(0, DOOR_H / 2, c - H_HALF_D - 1.2);
    this.scene.add(beyond);
    this.gateGlow = new THREE.Mesh(new THREE.CircleGeometry(0.42, 32), new THREE.MeshBasicMaterial({
      color: '#ffd98a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    this.gateGlow.position.set(0, DOOR_H + 0.42, c - H_HALF_D + 0.12);
    this.scene.add(this.gateGlow);
    this.addLight(0, 3.0, c - 3.5, '#9ab8ff', 4, 7, false);
    this.addLight(-4.0, 2.8, c - 5.0, '#ffd59a', 3.5, 5, false);
  }

  /**
   * The ancient scales on their own table: a post, a beam that leans toward the heavier pan (as the server says —
   * the weights never reach the client), two hanging pans, the three inscriptions on the wall beside them and the
   * four things to weigh, found around the room.
   */
  private buildScales(c: number) {
    this.box(2.6, 0.1, 1.2, this.wood('#4a2e1a'), SCALE_X, 0.95, c + SCALE_Z);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) this.box(0.1, 0.9, 0.1, this.std('#3a2414'), SCALE_X + sx * 1.15, 0.45, c + SCALE_Z + sz * 0.45);
    const brass = this.std('#c9a24d', { metalness: 0.85, roughness: 0.3 });
    this.scaleShine.push(brass);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.06, 24), brass);
    foot.position.set(SCALE_X, 1.03, c + SCALE_Z);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, SCALE_PIVOT_Y - 1.0, 12), brass);
    post.position.set(SCALE_X, (SCALE_PIVOT_Y + 1.0) / 2, c + SCALE_Z);
    const crown = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 12), brass);
    crown.position.set(SCALE_X, SCALE_PIVOT_Y + 0.1, c + SCALE_Z);
    this.scene.add(foot, post, crown);
    const beam = new THREE.Group();
    beam.position.set(SCALE_X, SCALE_PIVOT_Y, c + SCALE_Z);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(SCALE_ARM * 2 + 0.1, 0.04, 0.05), brass);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.08, 16), brass);
    hub.rotation.x = Math.PI / 2;
    // the needle points down from the pivot and swings with the beam
    const needle = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.22, 8), this.std('#7a1a10'));
    needle.position.y = -0.14;
    needle.rotation.z = Math.PI;
    beam.add(bar, hub, needle);
    for (const dx of [-SCALE_ARM, SCALE_ARM]) {
      const end = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), brass);
      end.position.x = dx;
      beam.add(end);
    }
    this.scene.add(beam);
    this.scaleBeam = beam;
    // each pan: a shallow brass dish on three cords that meet under the end of the beam
    const hang = SCALE_PIVOT_Y - SCALE_PAN_Y;
    for (let k = 0; k < 2; k++) {
      const pan = new THREE.Group();
      const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.3, 0.05, 32), brass);
      pan.add(dish);
      for (let j = 0; j < 3; j++) {
        const a = (j / 3) * Math.PI * 2 + 0.5;
        const from = new THREE.Vector3(Math.cos(a) * 0.33, 0.02, Math.sin(a) * 0.33);
        const to = new THREE.Vector3(0, hang, 0);
        const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, from.distanceTo(to), 5), this.std('#3a2a1a'));
        cord.position.copy(from).lerp(to, 0.5);
        cord.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
        pan.add(cord);
      }
      pan.position.set(SCALE_X + (k ? SCALE_ARM : -SCALE_ARM), SCALE_PAN_Y, c + SCALE_Z);
      this.scene.add(pan);
      this.scalePans.push(pan);
    }
    this.buildAssembly('h7-scales', 'pan', (id) => {
      const part = this.itemModel(id);
      part.scale.multiplyScalar(1.3);
      return part;
    }, 0.08);
    this.scaleGlow = new THREE.PointLight('#ffd98a', 0, 4, 1.5);
    this.scaleGlow.position.set(SCALE_X, SCALE_PIVOT_Y + 0.3, c + SCALE_Z + 0.4);
    this.scene.add(this.scaleGlow);
    // the three inscriptions, on the wall to the left of the scales
    const lines = ['שתי נוצות שוקלות כמו המפתח.', 'הגביש שוקל כמו המפתח והנוצה יחד.', 'שעון החול שוקל בדיוק כמו המפתח.'];
    lines.forEach((text, k) => {
      this.box(0.05, 0.5, 1.14, this.wood('#3a2414'), -7.97, 2.3, c - 0.6 + k * 1.25);
      this.label(text, 1.05, 0.42, -7.93, 2.3, c - 0.6 + k * 1.25, Math.PI / 2, { bg: '#e9d8ad' });
    });
    // the four things to weigh: on a wall shelf, on a crate, on a stone block and on the floor
    this.box(1.4, 0.06, 0.6, this.wood('#3a2414'), -7.5, 1.35, c + 4.3);
    this.box(1.2, 0.7, 1.0, this.wood('#5a3a20'), 5.8, 0.35, c + 2.8);
    this.box(0.7, 0.45, 0.5, this.std('#4a4458', { map: stoneTexture([1, 1]) }), 5.4, 0.23, c + 0.2);
    const where: Record<string, [number, number, number]> = {
      'sc-feather': [-7.6, 1.4, 4.3], 'sc-key': [6.15, 0.72, 2.8], 'sc-crystal': [5.4, 0.5, 0.2], 'sc-hourglass': [-2.6, 0.02, 5.2],
    };
    for (const [id, [x, y, z]] of Object.entries(where)) {
      const m = this.itemModel(id);
      m.position.set(x, y, c + z);
      this.addItem(id, m);
    }
  }

  /** The free game's lever follows the gears; the beam of the scales (room 7) leans toward the heavier pan and the pans follow it. */
  private updateSample(dt: number, t: number) {
    if (this.gearLever) this.gearLever.rotation.z = THREE.MathUtils.lerp(this.gearLever.rotation.z, this.gearsRunning ? -0.5 : 0.5, Math.min(1, dt * 5));
    if (this.scaleBeam) {
      const goal = -this.scaleTilt * 0.16;
      // the beam settles slowly, with a faint breathing sway
      this.scaleAngle += (goal - this.scaleAngle) * Math.min(1, dt * 3);
      this.scaleBeam.rotation.z = this.scaleAngle + Math.sin(t * 2.2) * 0.004;
      this.scalePans.forEach((pan, k) => {
        const dx = k ? SCALE_ARM : -SCALE_ARM;
        pan.position.x = SCALE_X + dx * Math.cos(this.scaleBeam!.rotation.z);
        pan.position.y = SCALE_PAN_Y + dx * Math.sin(this.scaleBeam!.rotation.z);
      });
    }
    // balanced: the scales shine; the mechanism turns: the sign above the free game's gate glows
    const shine = this.scalesDone ? 0.5 + Math.sin(t * 3) * 0.15 : 0;
    for (const m of this.scaleShine) {
      m.emissive.set('#ffb347');
      m.emissiveIntensity = THREE.MathUtils.lerp(m.emissiveIntensity, shine, Math.min(1, dt * 2));
    }
    if (this.scaleGlow) this.scaleGlow.intensity = THREE.MathUtils.lerp(this.scaleGlow.intensity, this.scalesDone ? 7 : 0, Math.min(1, dt * 2));
    if (this.gateGlow) (this.gateGlow.material as THREE.MeshBasicMaterial).opacity = this.sampleDone ? 0.7 + Math.sin(t * 4) * 0.2 : 0;
    if (this.mapWhole) {
      const mat = this.mapWhole.material as THREE.MeshBasicMaterial;
      mat.opacity = THREE.MathUtils.lerp(mat.opacity, this.mapSolved ? 1 : 0, Math.min(1, dt * 2));
    }
  }

  private chestLid?: THREE.Object3D;

  // ======================================================================= state

  /** Shows the server state: open doors, items, mechanisms and the hanukkiah's lit candles. */
  applySnapshot(s: RoomSnapshot, scenario: ScenarioContent | null) {
    const live = !this.firstApply;
    const newlyOpen = [...this.doors.keys()].filter((z) => s.unlockedZones.includes(z) && !this.unlocked.has(z));
    this.unlocked = new Set(s.unlockedZones);
    this.rects = hWalkable(this.unlocked);
    for (const [zone, door] of this.doors) {
      this.doorOpen.set(zone, this.unlocked.has(zone) ? 1 : 0);
      // doors that were already open on arrival are shown open, without replaying the lock
      if (!live && this.unlocked.has(zone)) {
        door.userData['unlockT'] = 10;
        this.doorProgress.set(zone, 1);
      }
    }
    if (live) newlyOpen.forEach((z) => this.doorGlow(z));
    const before = this.worldItems;
    this.worldItems = new Set(s.worldItems);
    const solved = (id: string) => s.puzzles.find((p) => p.id === id)?.status === 'solved';
    for (const [id, mesh] of this.itemMeshes) {
      // an item that was just picked up flies to the player who took it, then disappears into the bag
      if (live && before.has(id) && !this.worldItems.has(id) && mesh.visible) this.flyAway(mesh);
      else if (!mesh.userData['flying']) mesh.visible = this.worldItems.has(id);
    }
    const m = s.mechanisms ?? {};

    this.setOpen(this.drawerFront, solved('h1-riddle'));
    // assembly tables: parts on their zones, the rest in the group's bag (laid out on the tray while at the table)
    for (const [pid, a] of this.asm) a.slots = { ...(m[pid]?.slots ?? {}) };
    this.benchInv = new Set(s.inventory);
    this.solvedAsm = new Set([...this.asm.keys()].filter((pid) => solved(pid)));
    for (const pid of Object.keys(BACKS_OFFSET)) {
      if (this.solvedAsm.has(pid) && m[pid]?.backs) this.solvedBacks.set(pid, { ...m[pid]!.backs });
      else this.solvedBacks.delete(pid);
    }
    // the free trial game
    this.mapSolved = solved('g1-map');
    this.setOpen(this.mapDrawer, !!s.clues?.['g1-note']);
    for (const d of this.cabinetDoors) this.setOpen(d, solved('g1-cabinet'));
    this.gearsRunning = solved('g2-gears');
    this.scaleTilt = m['h7-scales']?.tilt ?? 0;
    this.scalesDone = solved('h7-scales');
    this.sampleDone = solved('g2-gears');
    if (this.exitDoor) this.doorOpen.set('exit' as HZone, s.phase === 'completed' ? 1 : 0);
    this.benchGuess.clear();
    const lampLit = solved('h2-lamp');
    // the lamp's success sequence plays once, live; on arrival (late join, reconnect) it is shown finished
    if (!lampLit) this.lampSeq = -1;
    else if (this.lampSeq < 0) this.lampSeq = this.firstApply ? 99 : 0;
    if (!lampLit) this.setOpen(this.wallPanel, false);

    const maze = m['h3-maze'];
    if (maze?.key?.length === 2) {
      this.mazeServerKey = [maze.key[0], maze.key[1]];
      if (!this.mazeBusy) this.setMazeKey(this.mazeServerKey);
    }
    if (maze) {
      this.mazeLeverState = [...(maze.levers ?? [])];
      this.mazeGateIds.forEach((g, i) => {
        const gate = this.mazeGates.get(g);
        if (gate) gate.position.y = this.mazeOrigin.y + (maze.levers[i] ? -0.12 : 0.04);
      });
      if (maze.revealed && maze.revealed !== this.mazeCode && this.mazeCodePlate) {
        this.mazeCode = maze.revealed;
        const mat = this.mazeCodePlate.material as THREE.MeshBasicMaterial;
        mat.map = labelTexture(maze.revealed, { color: '#ffd36b', bg: '#1a1208', width: 256, height: 164 });
        mat.needsUpdate = true;
      }
    }
    this.mazeSolved = solved('h3-maze');
    this.boxGlow = this.mazeSolved && !solved('h3-box');
    this.setOpen(this.metalBoxLid, solved('h3-box'));
    this.wheelSolved = solved('h4-wheel');
    if (this.wheelSolved) this.setWheel(['א', 'ו', 'ר']);
    this.setOpen(this.woodBoxLid, solved('h5-lock'));
    if (this.jugGlow) (this.jugGlow.material as THREE.MeshBasicMaterial).opacity = solved('h6-jugs') ? 0.35 : 0;

    const mosaic = m['h7-mosaic'];
    if (mosaic?.rotations) {
      const lit = new Set((mosaic.lit ?? []).map(([r, c]) => r * 3 + c));
      this.mosaicStones.forEach((st, i) => {
        st.mesh.rotation.z = -(mosaic.rotations[i] ?? 0) * (Math.PI / 2);
        const on = lit.has(i);
        if (st.lit !== on) {
          st.lit = on;
          const mat = new THREE.MeshStandardMaterial({ map: stoneGrooveTexture(st.kind, on), roughness: 0.6, emissive: on ? '#1a3a6a' : '#000000' });
          const mats = st.mesh.material as THREE.Material[];
          mats[4] = mat;
          mats[5] = mat;
        }
      });
      if (this.mosaicBeam) (this.mosaicBeam.material as THREE.MeshBasicMaterial).opacity = mosaic.reached ? 0.7 : 0;
    }
    this.fillSlots([...this.pedestalItems.values()], [...this.pedestalItems.keys()], m['h8-pedestals'], (_slot, item) => this.itemModel(item));
    const verdict = m['h8-pedestals']?.verdict ?? {};
    for (const [slot, mark] of this.pedestalMarks) {
      const v = verdict[slot];
      mark.visible = v !== undefined && !solved('h8-pedestals');
      (mark.material as THREE.MeshBasicMaterial).color.set(v ? '#3fbf6a' : '#e2715b');
    }

    // the hanukkiah follows the stage of the game: one candle per completed room, the shamash once the journey began
    const done = scenario ? H_ZONES.filter((z) => {
      const ps = scenario.puzzles.filter((p) => p.zone === z);
      return ps.length > 0 && ps.every((p) => solved(p.id));
    }).length : 0;
    if (this.mode !== 'outro') for (const h of this.hanukkiot) h.setLit(Math.min(done, 8), done > 0);
    this.gateTarget = s.phase === 'completed' ? 1.4 : this.unlocked.has('hall') ? 0.5 : 0.2;
    this.setOpen(this.chestLid, s.phase === 'completed');
    this.firstApply = false;
  }

  private fillSlots(holders: THREE.Object3D[], ids: string[], mech: MechanismState | undefined, make: (slot: string, item: string) => THREE.Object3D) {
    ids.forEach((slot, k) => {
      const holder = holders[k];
      if (!holder) return;
      const want = mech?.slots?.[slot] ?? '';
      if (holder.userData['item'] === want) return;
      holder.clear();
      holder.userData['item'] = want;
      if (want) holder.add(make(slot, want));
    });
  }

  /** Opens or closes a lid/drawer/panel. Opening live first turns a key in its lock (spec 8). */
  private setOpen(obj: THREE.Object3D | undefined, on: boolean) {
    const t = obj && this.openTargets.get(obj);
    if (!t || !obj || t.on === on || obj.userData['opening']) return;
    if (!on || this.firstApply || obj === this.wallPanel || obj === this.chestLid || obj === this.mapDrawer) {
      t.on = on;
      return;
    }
    obj.userData['opening'] = true;
    const at = obj.getWorldPosition(new THREE.Vector3());
    const toCam = this.camera.position.clone().sub(at).setY(0).normalize();
    const key = this.keyMesh('#d9b060', 0.5);
    key.position.copy(at).addScaledVector(toCam, 0.32);
    key.lookAt(at.x, key.position.y, at.z);
    key.rotateY(Math.PI / 2);
    this.scene.add(key);
    let k = 0;
    this.effects.push((_t, dt) => {
      k += dt;
      key.position.addScaledVector(toCam, k < 0.35 ? -dt * 0.25 : 0);
      if (k > 0.35) key.rotation.x = Math.min(Math.PI / 2, (k - 0.35) * 3.2);
      if (k > 1.0) {
        t.on = true;
        obj.userData['opening'] = false;
        this.removeFx(key);
        return false;
      }
      return true;
    });
  }

  // ======================================================================= feedback (spec 8)

  /** A pulsing ring under the object the pointer is on, and a few sparkles around items waiting to be found. */
  private buildFeedback() {
    this.hoverRing = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 40), new THREE.MeshBasicMaterial({
      color: '#ffe6a0', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    this.hoverRing.rotation.x = -Math.PI / 2;
    this.scene.add(this.hoverRing);
    const n = this.quality === 'low' ? 24 : 60;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.sparkles = new THREE.Points(geo, new THREE.PointsMaterial({
      map: glowSpriteTexture('#fff2c0'), size: 0.09, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: '#ffe6a0',
    }));
    this.sparkles.frustumCulled = false;
    this.scene.add(this.sparkles);
    // a soft golden arrow over the next task's object, shown for a few seconds after a task is completed
    this.guide = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.36, 16), new THREE.MeshBasicMaterial({
      color: '#ffd98a', transparent: true, opacity: 0, depthWrite: false, toneMapped: false,
    }));
    this.guide.rotation.x = Math.PI;
    this.guide.visible = false;
    this.scene.add(this.guide);
    this.animated.push((t) => {
      const g = this.guide!;
      const left = this.guideUntil - t;
      g.visible = !!this.guideAt && left > 0;
      if (!g.visible || !this.guideAt) return;
      g.position.set(this.guideAt[0], this.guideAt[1] + 0.75 + Math.sin(t * 3) * 0.08, this.guideAt[2]);
      (g.material as THREE.MeshBasicMaterial).opacity = Math.min(0.85, left * 0.5);
    });
  }

  private guide?: THREE.Mesh;
  private guideAt: [number, number, number] | null = null;
  private guideUntil = 0;

  /** Points at the object of the next task (only when exactly one object in the room belongs to it). */
  showGuide(interactableId: string | null, seconds = 8) {
    const def = interactableId ? H_INTERACTABLES.find((d) => d.id === interactableId) : undefined;
    this.guideAt = def ? hWorldPos(def) : null;
    this.guideUntil = this.time + seconds;
  }

  private updateFeedback(t: number, dt: number) {
    this.time = t;
    this.effects = this.effects.filter((fx) => fx(t, dt));
    if (this.hoverRing) {
      const def = this.mode === 'play' ? this.hovered : null;
      const mat = this.hoverRing.material as THREE.MeshBasicMaterial;
      mat.opacity = THREE.MathUtils.lerp(mat.opacity, def ? 0.55 + Math.sin(t * 5) * 0.2 : 0, Math.min(1, dt * 10));
      if (def) {
        const [x, y, z] = hWorldPos(def);
        this.hoverRing.position.set(x, Math.max(0.02, y - def.radius * 0.6), z);
        this.hoverRing.scale.setScalar(Math.max(0.6, def.radius * 1.4) * (1 + Math.sin(t * 5) * 0.05));
      }
    }
    if (this.sparkles) {
      const pos = this.sparkles.geometry.attributes['position'] as THREE.BufferAttribute;
      const near = [...this.itemMeshes.values()].filter((m) => m.visible && !m.userData['flying'] && Math.abs(m.position.z - this.localPos.z) < 9).slice(0, 6);
      for (let i = 0; i < pos.count; i++) {
        const host = near[i % Math.max(1, near.length)];
        if (!host) {
          pos.setXYZ(i, 0, -50, 0);
          continue;
        }
        const a = t * 0.9 + i * 2.39;
        const r = 0.28 + (i % 3) * 0.08;
        pos.setXYZ(i, host.position.x + Math.cos(a) * r, host.position.y + ((t * 0.35 + i * 0.137) % 1) * 0.6 - 0.2, host.position.z + Math.sin(a) * r);
      }
      pos.needsUpdate = true;
    }
  }

  /** The picked item flies to the nearest player (the one who took it) and shrinks into their bag. */
  private flyAway(mesh: THREE.Object3D) {
    const avatars = [this.local, ...[...this.remotes.values()].map((r) => r.avatar)].filter(Boolean) as BoyAvatar[];
    const to = avatars.reduce<BoyAvatar | null>((best, a) => (!best || a.root.position.distanceTo(mesh.position) < best.root.position.distanceTo(mesh.position) ? a : best), null);
    to?.reach(this.time);
    const start = mesh.position.clone();
    const scale = mesh.scale.x;
    mesh.userData['flying'] = true;
    let k = 0;
    this.effects.push((_t, dt) => {
      k = Math.min(1, k + dt / 0.8);
      const goal = to ? to.root.position.clone().setY(1.0) : start.clone().setY(start.y + 1);
      mesh.position.lerpVectors(start, goal, THREE.MathUtils.smoothstep(k, 0, 1));
      mesh.position.y += Math.sin(k * Math.PI) * 0.6;
      mesh.scale.setScalar(scale * (1 - k * 0.8));
      if (k < 1) return true;
      mesh.visible = false;
      mesh.position.copy(start);
      mesh.scale.setScalar(scale);
      mesh.userData['flying'] = false;
      mesh.visible = this.worldItems.has([...this.itemMeshes].find(([, m]) => m === mesh)?.[0] ?? '');
      return false;
    });
  }

  /** A warm glow fills the doorway of a room that just opened. */
  private doorGlow(zone: HZone) {
    const door = this.doors.get(zone);
    if (!door) return;
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(DOOR_W * 1.1, DOOR_H * 1.05), new THREE.MeshBasicMaterial({
      color: '#ffd98a', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    glow.position.set(door.position.x, DOOR_H / 2, door.position.z + 0.2);
    this.scene.add(glow);
    let k = 0;
    this.effects.push((_t, dt) => {
      k += dt;
      (glow.material as THREE.MeshBasicMaterial).opacity = Math.sin(Math.min(1, k / 5) * Math.PI) * 0.55;
      if (k < 5) return true;
      this.removeFx(glow);
      return false;
    });
  }

  private removeFx(obj: THREE.Object3D) {
    this.scene.remove(obj);
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      (m.material as THREE.Material | undefined)?.dispose?.();
    });
  }

  // ======================================================================= assembly tables (lamp bench, dreidel stand)

  get isBench() {
    return this.mode === 'bench';
  }

  get benchPuzzle() {
    return this.mode === 'bench' ? this.benchId : null;
  }

  /** Steps up to a table: the camera looks down at it and the parts can be dragged with the mouse or a finger. */
  enterBench(puzzle: string) {
    if (this.mode !== 'play' || !this.asm.has(puzzle)) return;
    this.benchId = puzzle;
    this.benchPlane.constant = -(ASSEMBLIES[puzzle].top + 0.18);
    this.mode = 'bench';
    this.modeTime = 0;
    this.keys.clear();
    this.hovered = null;
    this.cb.onHover?.(null);
  }

  exitBench() {
    if (this.mode !== 'bench') return;
    this.benchDrag = undefined;
    this.benchPicked = null;
    this.benchHover = null;
    this.benchId = null;
    this.mode = 'play';
    this.snapCamera = false;
    this.canvas.style.cursor = 'grab';
  }

  /** The server refused a drop: the part shakes and goes back to where it was. */
  benchRejected(item: string) {
    this.benchGuess.delete(item);
    this.benchShake.set(item, this.time);
  }

  /** A wrong arrangement: the zones of that table blink red for a moment. */
  flashBench(puzzle: string) {
    const a = this.asm.get(puzzle);
    if (a) a.flash = this.time;
  }

  private slotOf(item: string) {
    for (const a of this.asm.values()) {
      const slot = Object.keys(a.slots).find((k) => a.slots[k] === item);
      if (slot) return slot;
    }
    return null;
  }

  private benchLocked(puzzle: string) {
    return puzzle === 'h2-lamp' ? this.lampSeq >= 0 : this.solvedAsm.has(puzzle);
  }

  /**
   * Where the camera stands to look down at a table from distance d: never above the chandeliers or behind the room's
   * front wall — on a tall phone screen it backs away instead of climbing — and, on a portrait screen, aimed a little
   * nearer so the table sits above the instruction card.
   */
  private focusCamera(look: THREE.Vector3, d: number, rise: number, c: number) {
    const portrait = this.camera.aspect < 1;
    if (portrait) look.z += 0.9;
    let h = d * rise;
    let back = Math.sqrt(Math.max(0, d * d - h * h));
    const maxH = 4.4 - look.y;
    if (h > maxH) {
      h = maxH;
      back = Math.sqrt(Math.max(0, d * d - h * h));
    }
    const goal = new THREE.Vector3(look.x, look.y + h, Math.min(look.z + back, c + H_HALF_D - 0.4));
    return goal;
  }

  private benchCamera(dt: number, t: number) {
    const def = ASSEMBLIES[this.benchId ?? 'h2-lamp'];
    const c = hCenter(def.zone);
    const look = new THREE.Vector3(def.look[0], def.top, c + def.look[1]);
    // far enough that the whole table fits, also on a narrow phone screen
    const tanH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect;
    const d = Math.max(def.halfWidth * 1.32, def.halfWidth / Math.max(0.2, tanH));
    const goal = this.focusCamera(look, d, 0.78, c);
    // once the lamp is lit, the camera rises with its beam to the wall: the key symbol and the opening panel
    if (this.benchId === 'h2-lamp' && this.lampSeq > 0 && this.lampSeq < 50) {
      const k = THREE.MathUtils.smoothstep((this.lampSeq - 2.6) / 1.6, 0, 1);
      look.lerp(new THREE.Vector3(-0.3, 1.75, c - H_HALF_D), k);
      goal.lerp(new THREE.Vector3(0.2, 2.5, c + 1.4), k);
    }
    this.camera.position.lerp(goal, Math.min(1, dt * 4));
    this.camera.lookAt(look);
    if (this.local) {
      this.local.root.position.lerp(new THREE.Vector3(def.stand[0], 0, c + def.stand[1]), Math.min(1, dt * 5));
      this.local.root.rotation.y = def.stand[2];
      this.local.update(dt, 0, t);
    }
  }

  private updateBench(dt: number, t: number) {
    const solvedSeq = this.lampSeq >= 0;
    if (solvedSeq) this.lampSeq += dt;
    const seq = this.lampSeq;
    for (const [pid, a] of this.asm) {
      const def = a.def;
      const c = hCenter(def.zone);
      const here = this.mode === 'bench' && this.benchId === pid;
      const lampDone = pid === 'h2-lamp' && solvedSeq;
      for (const [id, part] of a.parts) {
        const guess = this.benchGuess.has(id) ? this.benchGuess.get(id)! : undefined;
        const slot = guess !== undefined ? guess : Object.keys(a.slots).find((k) => a.slots[k] === id) ?? null;
        let goal: THREE.Vector3 | null = null;
        if (this.benchDrag?.id === id) goal = this.benchDrag.pos;
        else if (lampDone) {
          // the five parts lift off their zones one after another and join into one lamp on the middle zone
          const order = Object.keys(BENCH_STACK).indexOf(id);
          const [px, pz] = BENCH_PAD[BENCH_SLOTS[order]];
          const [sx, sz] = BENCH_PAD['s3'];
          const m = THREE.MathUtils.smoothstep(seq - order * 0.35, 0, 1);
          goal = new THREE.Vector3(
            THREE.MathUtils.lerp(px, sx, m),
            BENCH_TOP + THREE.MathUtils.lerp(BENCH_REST[id], BENCH_STACK[id], m) + Math.sin(m * Math.PI) * 0.35,
            c + THREE.MathUtils.lerp(pz, sz, m),
          );
          if (seq > 50) goal.set(sx, BENCH_TOP + BENCH_STACK[id], c + sz);
        } else if (slot) {
          const [px, pz] = def.pad[slot];
          goal = new THREE.Vector3(px, def.top + def.rest[id] + this.panLift(pid, slot), c + pz);
        } else if (this.benchInv.has(id) && here) {
          const [tx, tz] = def.tray[id];
          goal = new THREE.Vector3(tx, (def.trayTop ?? def.top) + def.rest[id], c + tz);
        }
        // a part chosen with a tap rises a little, until it is put somewhere
        if (goal && here && this.benchPicked === id && this.benchDrag?.id !== id) goal = goal.clone().setY(goal.y + 0.1 + Math.sin(t * 5) * 0.02);
        if (!goal) {
          part.visible = false;
          continue;
        }
        if (!part.visible) {
          // appears on the tray by rising out of the bag
          part.position.copy(goal).setY(goal.y - 0.3);
          part.visible = true;
        }
        const fast = lampDone || this.benchDrag?.id === id || pid === 'h7-scales';
        part.position.lerp(goal, Math.min(1, dt * (fast ? 14 : 9)));
        const shook = this.benchShake.get(id);
        if (shook !== undefined) {
          const age = t - shook;
          if (age > 0.6) this.benchShake.delete(id);
          else part.position.x += Math.sin(age * 45) * 0.04 * (1 - age / 0.6);
        }
        const spin = pid === 'g2-gears' && this.gearsRunning ? ({ 'gear-large': 0.6, 'gear-small': -1.2, 'gear-medium': 0.82 } as Record<string, number>)[id] ?? 0 : 0;
        part.rotation.y = this.benchDrag?.id === id ? Math.sin(t * 3) * 0.2 : spin * t;
      }
      // zones: glow where the dragged part would land, gold where a part sits, a red blink after a wrong arrangement
      const flashing = t - a.flash < 1.2;
      for (const [slot, ring] of a.pads) {
        const mat = ring.material as THREE.MeshBasicMaterial;
        const hot = here && (this.benchHover === slot || (!!this.benchPicked && !a.slots[slot]));
        if (pid === 'h7-scales') ring.position.y = def.top + 0.007 + this.panLift(pid, slot);
        if (flashing) {
          mat.color.set('#e8281a');
          mat.opacity = 0.5 + Math.abs(Math.sin((t - a.flash) * 9)) * 0.5;
        } else {
          mat.color.set(hot ? '#9fe0ff' : a.slots[slot] ? '#ffd36b' : '#e2c27a');
          mat.opacity = hot ? 0.95 : here ? 0.55 + Math.sin(t * 3 + slot.charCodeAt(1)) * 0.15 : 0.5;
        }
        ring.scale.setScalar(hot ? 1.15 : 1);
      }
    }
    // a solved arrangement with numbered backs (dreidels, symbols): each digit is shown by its piece
    for (const [pid, a] of this.asm) {
      const backs = this.solvedBacks.get(pid);
      const [ox, oy, oz] = BACKS_OFFSET[pid] ?? [0, 0, 0];
      const c = hCenter(a.def.zone);
      for (const slot of a.def.slots) {
        const key = pid + ':' + slot;
        let plate = this.backPlates.get(key);
        const digit = backs?.[slot];
        if (!plate && digit) {
          plate = new THREE.Mesh(new THREE.CircleGeometry(0.1, 24), new THREE.MeshBasicMaterial({ map: digitTexture(digit), transparent: true, opacity: 0, toneMapped: false }));
          const [x, z] = a.def.pad[slot];
          plate.position.set(x + ox, a.def.top + oy, c + z + oz);
          plate.rotation.x = -1.15;
          this.scene.add(plate);
          this.backPlates.set(key, plate);
        }
        if (plate) {
          const mat = plate.material as THREE.MeshBasicMaterial;
          mat.opacity = digit ? Math.min(1, mat.opacity + dt * 0.8) : 0;
        }
      }
    }
    // the lamp: it lights, its beam reaches the wall, the key symbol appears and the wall panel slides open
    const ramp = (from: number, len: number) => (solvedSeq ? THREE.MathUtils.clamp((seq - from) / len, 0, 1) : 0);
    const lit = ramp(2.2, 1.0);
    if (this.lampGlow) this.lampGlow.intensity = lit * (8 + Math.sin(t * 9) * 0.6);
    if (this.lampFlame) {
      (this.lampFlame.material as THREE.MeshBasicMaterial).opacity = lit;
      this.lampFlame.scale.set(1, 1 + Math.sin(t * 13) * 0.15, 1);
    }
    if (this.lampBeam) (this.lampBeam.material as THREE.MeshBasicMaterial).opacity = ramp(3.0, 1.0) * (0.18 + Math.sin(t * 2) * 0.03);
    if (this.keySymbol) (this.keySymbol.material as THREE.MeshBasicMaterial).opacity = ramp(3.6, 1.0) * 0.9;
    if (solvedSeq && seq > 4.6) {
      const tgt = this.wallPanel && this.openTargets.get(this.wallPanel);
      if (tgt) tgt.on = true;
    }
  }

  /** How far a place has moved up or down with the beam of the scales (0 everywhere else). */
  private panLift(pid: string, slot: string) {
    if (pid !== 'h7-scales' || !this.scaleBeam) return 0;
    return (slot[0] === 'l' ? -SCALE_ARM : SCALE_ARM) * Math.sin(this.scaleBeam.rotation.z);
  }

  private benchPick(): string | null {
    const a = this.benchId ? this.asm.get(this.benchId) : undefined;
    if (!a) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const parts = [...a.parts.values()].filter((p) => p.visible);
    const hit = this.raycaster.intersectObjects(parts, true)[0];
    let o: THREE.Object3D | null = hit?.object ?? null;
    while (o && !o.userData['benchItem']) o = o.parent;
    return (o?.userData['benchItem'] as string) ?? null;
  }

  private benchPointer(e: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  }

  private benchDown(e: PointerEvent) {
    if (!this.benchId || this.benchLocked(this.benchId)) return;
    this.benchPointer(e);
    if (this.benchId === 'g2-gears' && this.gearLever) {
      this.raycaster.setFromCamera(this.pointer, this.camera);
      if (this.raycaster.intersectObject(this.gearLever, true).length) {
        this.local?.reach(this.time);
        this.cb.onBenchLever?.();
        return;
      }
    }
    const id = this.benchPick();
    if (!id) {
      if (this.benchPicked) this.benchPlace(this.benchPicked);
      return;
    }
    const part = this.asm.get(this.benchId)!.parts.get(id)!;
    this.benchDrag = {
      id, from: this.slotOf(id), pointerId: e.pointerId, pos: part.position.clone().setY(ASSEMBLIES[this.benchId].top + 0.3),
      x: e.clientX, y: e.clientY, far: false,
    };
    this.canvas.style.cursor = 'grabbing';
    this.local?.reach(this.time);
  }

  private benchMove(e: PointerEvent) {
    this.benchPointer(e);
    const d = this.benchDrag;
    if (!d || d.pointerId !== e.pointerId || !this.benchId) {
      this.canvas.style.cursor = this.benchId && !this.benchLocked(this.benchId) && this.benchPick() ? 'grab' : 'default';
      return;
    }
    // a finger trembles: only a real movement turns a tap into a drag
    if (!d.far && Math.hypot(e.clientX - d.x, e.clientY - d.y) < (e.pointerType === 'touch' ? 12 : 5)) return;
    d.far = true;
    this.benchPicked = null;
    const def = ASSEMBLIES[this.benchId];
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.benchPlane, p)) return;
    const c = hCenter(def.zone);
    p.x = THREE.MathUtils.clamp(p.x, def.bounds[0], def.bounds[1]);
    p.z = THREE.MathUtils.clamp(p.z, c + def.bounds[2], c + def.bounds[3]);
    d.pos.set(p.x, def.top + 0.3, p.z);
    // the place under the pointer is found at the height of the places themselves, not of the dragged part
    const at = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -def.top), at)) at.copy(p);
    let best: string | null = null;
    let bestD = def.snap;
    for (const slot of def.slots) {
      const [x, z] = def.pad[slot];
      const dist = Math.hypot(at.x - x, at.z - (c + z));
      if (dist < bestD) {
        bestD = dist;
        best = slot;
      }
    }
    this.benchHover = best;
  }

  private benchUp(e: PointerEvent) {
    const d = this.benchDrag;
    if (!d || d.pointerId !== e.pointerId || !this.benchId) return;
    const puzzle = this.benchId;
    const slots = this.asm.get(puzzle)!.slots;
    this.benchDrag = undefined;
    const slot = this.benchHover;
    this.benchHover = null;
    this.canvas.style.cursor = 'grab';
    // a tap (no drag) chooses the part — or lets it go when it was already chosen
    if (!d.far) {
      this.benchPicked = this.benchPicked === d.id ? null : d.id;
      return;
    }
    // a part already sitting on that zone keeps it; the dropped part goes back
    if (slot && slots[slot] && slots[slot] !== d.id) {
      this.benchRejected(d.id);
      this.cb.onBenchDrop?.(puzzle, d.id, slot, d.from);
      return;
    }
    if (slot === d.from) return;
    this.benchGuess.set(d.id, slot);
    this.cb.onBenchDrop?.(puzzle, d.id, slot, d.from);
  }

  /** The second tap: the chosen part goes to the free place nearest the finger, or back to the bag when it is far from all. */
  private benchPlace(id: string) {
    const puzzle = this.benchId!;
    const def = ASSEMBLIES[puzzle];
    const slots = this.asm.get(puzzle)!.slots;
    this.benchPicked = null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -def.top), p)) return;
    const c = hCenter(def.zone);
    let best: string | null = null;
    let bestD = def.snap * 1.6;
    for (const slot of def.slots) {
      const [x, z] = def.pad[slot];
      const dist = Math.hypot(p.x - x, p.z - (c + z));
      if (dist < bestD) {
        bestD = dist;
        best = slot;
      }
    }
    const from = this.slotOf(id);
    if (best === from) return;
    if (best && slots[best]) {
      this.benchRejected(id);
      this.cb.onBenchDrop?.(puzzle, id, best, from);
      return;
    }
    // far from every place: a part from the bag stays where it is; a placed part goes back to the bag
    if (!best && !from) return;
    this.local?.reach(this.time);
    this.benchGuess.set(id, best);
    this.cb.onBenchDrop?.(puzzle, id, best, from);
  }

  // ======================================================================= maze table (room 3): key and levers used directly

  get isMaze() {
    return this.mode === 'maze';
  }

  /** Steps up to the maze table: the key is dragged on the board itself, the levers are pulled where they stand. */
  enterMaze() {
    if (this.mode !== 'play') return;
    this.mode = 'maze';
    this.modeTime = 0;
    this.keys.clear();
    this.hovered = null;
    this.cb.onHover?.(null);
  }

  exitMaze() {
    if (this.mode !== 'maze') return;
    this.mazeDrag = undefined;
    this.mazeAim = null;
    this.mode = 'play';
    this.canvas.style.cursor = 'grab';
  }

  private setMazeKey([r, col]: [number, number]) {
    this.mazeKeyCell = [r, col];
    this.mazeKeyTarget.set(this.mazeOrigin.x + col * MAZE_CELL, this.mazeOrigin.y + 0.05, this.mazeOrigin.z + r * MAZE_CELL);
  }

  private mazeOpen(r: number, col: number) {
    const ch = this.mazeGrid[r]?.[col];
    if (!ch || ch === '#') return false;
    const gate = this.mazeGateIds.indexOf(ch);
    return gate < 0 || !!this.mazeLeverState[gate];
  }

  private mazeCamera(dt: number, t: number) {
    const c = hCenter('maze');
    const look = new THREE.Vector3(0.9, 1.0, c - 0.75);
    const tanH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect;
    const d = Math.max(4.4, 3.3 / Math.max(0.2, tanH));
    const goal = this.focusCamera(look, d, 0.84, c);
    this.camera.position.lerp(goal, Math.min(1, dt * 4));
    this.camera.lookAt(look);
    if (this.local) {
      this.local.root.position.lerp(new THREE.Vector3(-2.0, 0, c + 0.9), Math.min(1, dt * 5));
      this.local.root.rotation.y = Math.PI * 0.85;
      this.local.update(dt, 0, t);
    }
  }

  /** Levers swing to their state; the key follows the drag one open cell at a time, never through walls. */
  private updateMaze(dt: number, t: number) {
    this.mazeLevers.forEach((lever, i) => {
      lever.rotation.z = THREE.MathUtils.lerp(lever.rotation.z, this.mazeLeverState[i] ? -0.5 : 0.5, Math.min(1, dt * 8));
      const knob = lever.userData['knob'] as THREE.Mesh | undefined;
      if (knob) (knob.material as THREE.MeshStandardMaterial).emissive.set(this.mode === 'maze' && this.mazeHover === 'lever' + i ? '#664400' : '#000000');
    });
    if (this.mazeKey) {
      const lift = this.mazeDrag ? 0.05 : 0;
      this.mazeKey.position.y = THREE.MathUtils.lerp(this.mazeKey.position.y, this.mazeKeyTarget.y + lift, Math.min(1, dt * 10));
      const s = (this.mazeHover === 'key' || this.mazeDrag ? 0.52 : 0.45) * (this.mode === 'maze' && !this.mazeSolved ? 1 + Math.sin(t * 4) * 0.04 : 1);
      this.mazeKey.scale.setScalar(THREE.MathUtils.lerp(this.mazeKey.scale.x, s, Math.min(1, dt * 10)));
      const age = t - this.mazeShake;
      if (age < 0.4) this.mazeKey.position.x += Math.sin(age * 50) * 0.015 * (1 - age / 0.4);
    }
    for (const h of this.mazeHints) h.visible = !this.mazeSolved;
    if (this.mazeCodePlate) {
      const mat = this.mazeCodePlate.material as THREE.MeshBasicMaterial;
      mat.opacity = THREE.MathUtils.lerp(mat.opacity, this.mazeCode ? 1 : 0, Math.min(1, dt * 2));
    }
    if (this.boxHalo) this.boxHalo.material.opacity = this.boxGlow ? 0.45 + Math.sin(t * 3) * 0.2 : 0.12;
    // while dragging — and after release, until the key reaches the release point or is stopped by a wall
    if (this.mode !== 'maze' || !this.mazeAim || this.mazeBusy || this.mazeSolved || t - this.mazeLastStep < 0.13) return;
    const [r, col] = this.mazeKeyCell;
    const [tr, tc] = this.mazeAim;
    if (tr === r && tc === col) {
      if (!this.mazeDrag) this.mazeAim = null;
      return;
    }
    const dr = Math.sign(tr - r);
    const dc = Math.sign(tc - col);
    const vert: [number, number, string] = [dr, 0, dr < 0 ? 'N' : 'S'];
    const hor: [number, number, string] = [0, dc, dc > 0 ? 'E' : 'W'];
    const tries = Math.abs(tr - r) >= Math.abs(tc - col) ? [vert, hor] : [hor, vert];
    const options = tries.filter(([a, b]) => a !== 0 || b !== 0);
    const step = options.find(([a, b]) => this.mazeOpen(r + a, col + b));
    if (!step) {
      if (!this.mazeDrag) this.mazeAim = null;
      this.mazeLastStep = t;
      this.mazeShake = t;
      if (t - this.mazeBlockedAt > 1.5 && options.length) {
        this.mazeBlockedAt = t;
        const [a, b] = options[0];
        this.cb.onMazeBlocked?.(this.mazeGrid[r + a]?.[col + b] === '#' ? 'קיר — המפתח לא יכול לעבור. נסו כיוון אחר.' : 'שער סגור חוסם את הדרך. הזיזו ידית כדי לפתוח אותו.');
      }
      return;
    }
    this.mazeBusy = true;
    this.mazeLastStep = t;
    this.setMazeKey([r + step[0], col + step[1]]);
    Promise.resolve(this.cb.onMazeStep?.(step[2]) ?? false)
      .then((ok) => {
        if (ok) return;
        this.setMazeKey(this.mazeServerKey);
        this.mazeAim = this.mazeDrag ? this.mazeAim : null;
      })
      .catch(() => this.setMazeKey(this.mazeServerKey))
      .finally(() => (this.mazeBusy = false));
  }

  private mazePick(): string | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const targets: THREE.Object3D[] = [...this.mazeLevers];
    if (this.mazeKey && !this.mazeSolved) targets.push(this.mazeKey);
    if (this.metalBox) targets.push(this.metalBox);
    for (const hit of this.raycaster.intersectObjects(targets, true)) {
      let o: THREE.Object3D | null = hit.object;
      while (o && !o.userData['maze']) o = o.parent;
      if (o) return o.userData['maze'] as string;
    }
    return null;
  }

  private mazeDown(e: PointerEvent) {
    this.benchPointer(e);
    const what = this.mazePick();
    if (what === 'key') {
      this.mazeDrag = { pointerId: e.pointerId };
      this.canvas.style.cursor = 'grabbing';
      this.local?.reach(this.time);
    } else if (what?.startsWith('lever')) {
      this.local?.reach(this.time);
      this.cb.onMazeLever?.(+what.slice(5));
    } else if (what === 'box') this.cb.onMazeBox?.();
  }

  private mazeMove(e: PointerEvent) {
    this.benchPointer(e);
    if (!this.mazeDrag || this.mazeDrag.pointerId !== e.pointerId) {
      this.mazeHover = this.mazePick();
      this.canvas.style.cursor = this.mazeHover ? (this.mazeHover === 'key' ? 'grab' : 'pointer') : 'default';
      return;
    }
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -(this.mazeOrigin.y + 0.05)), p)) return;
    this.mazeAim = [Math.round((p.z - this.mazeOrigin.z) / MAZE_CELL), Math.round((p.x - this.mazeOrigin.x) / MAZE_CELL)];
  }

  private mazeUp(e: PointerEvent) {
    if (!this.mazeDrag || this.mazeDrag.pointerId !== e.pointerId) return;
    this.mazeMove(e);
    this.mazeDrag = undefined;
    this.canvas.style.cursor = 'grab';
  }

  // ======================================================================= letter wheel (room 4)

  /** Turns the three rings so the given letters face the reading window. */
  setWheel(letters: string[]) {
    letters.forEach((l, k) => {
      const i = LETTERS.indexOf(l);
      if (i >= 0) this.wheelTarget[k] = -((i + 0.5) / LETTERS.length) * Math.PI * 2;
    });
  }

  private updateWheel(dt: number, t: number) {
    this.wheelRings.forEach((ring, k) => {
      // the shortest way round to the target
      let diff = this.wheelTarget[k] - ring.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      ring.rotation.y += diff * Math.min(1, dt * 5);
      const drum = ring.children[0] as THREE.Mesh;
      const mat = drum.material as THREE.MeshStandardMaterial;
      mat.emissive.set(this.wheelSolved ? '#3a6aff' : '#000000');
      mat.emissiveIntensity = this.wheelSolved ? 0.25 + Math.sin(t * 2 + k) * 0.1 : 0;
    });
  }

  setPlayers(players: PlayerDto[], myId: string | null, positions: Map<string, RemotePosition & { t: number }>) {
    this.positions = positions;
    const me = players.find((p) => p.id === myId);
    if (me && !this.local) {
      this.local = new BoyAvatar(me.characterId, me.appearance);
      this.scene.add(this.local.root);
      this.local.root.position.copy(this.localPos);
      this.local.root.visible = this.mode !== 'intro';
    }
    const ids = new Set(players.filter((p) => p.id !== myId).map((p) => p.id));
    for (const [id, r] of this.remotes) {
      if (!ids.has(id)) {
        this.scene.remove(r.avatar.root);
        r.avatar.dispose();
        this.remotes.delete(id);
      }
    }
    players.forEach((p) => {
      if (p.id === myId) return;
      let r = this.remotes.get(p.id);
      if (!r) {
        const avatar = new BoyAvatar(p.characterId, p.appearance, p.nickname);
        const start = new THREE.Vector3(-2 + (p.seat % 5), 0, SPAWN.z + 0.8);
        avatar.root.position.copy(start);
        avatar.root.visible = this.mode !== 'intro';
        this.scene.add(avatar.root);
        r = { avatar, pos: start.clone(), yaw: Math.PI, speed: 0, connected: true };
        this.remotes.set(p.id, r);
      }
      if (r.connected !== p.isConnected) {
        r.avatar.setConnected(p.isConnected);
        r.connected = p.isConnected;
      }
    });
  }

  resetPlayer() {
    this.localPos.copy(SPAWN);
    this.localYaw = Math.PI;
    this.camYaw = 0;
  }

  placePlayer(p: RemotePosition) {
    if (this.canStand(p.x, p.z)) this.localPos.set(p.x, 0, p.z);
  }

  focusOn(objectId: string) {
    return this.hitTargets.get(objectId)?.position.clone() ?? null;
  }

  setMode(mode: HMode) {
    this.mode = mode;
    this.modeTime = 0;
    const show = mode !== 'intro';
    if (this.local) this.local.root.visible = show;
    for (const r of this.remotes.values()) r.avatar.root.visible = show;
    if (mode === 'outro') this.outroLit = this.hallHanukkiah?.litCount ?? 0;
  }

  setIntroTime(seconds: number) {
    this.modeTime = seconds;
  }

  setJoystick(x: number, y: number) {
    this.joystick.set(x, y);
  }

  // ======================================================================= loop

  start() {
    let lastFrame = performance.now();
    const loop = () => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      lastFrame = performance.now();
      this.tick(Math.min(0.05, this.clock.getDelta()), this.clock.elapsedTime);
    };
    loop();
    // keep the world updating at a low rate when requestAnimationFrame is throttled (hidden/embedded views)
    this.watchdog = setInterval(() => {
      if (this.disposed || document.hidden || performance.now() - lastFrame < 250) return;
      this.tick(Math.min(0.1, this.clock.getDelta()), this.clock.elapsedTime);
    }, 100);
  }

  private tick(dt: number, t: number) {
    this.modeTime += dt;
    for (const f of this.flickers) f.light.intensity = f.base * (0.85 + 0.15 * Math.sin(t * 9 + f.seed) * Math.sin(t * 5.3 + f.seed * 2));
    for (const { light, spec } of this.lightPool)
      if (spec?.flicker) light.intensity = spec.intensity * (0.88 + 0.12 * Math.sin(t * 9 + spec.seed) * Math.sin(t * 5.3 + spec.seed * 2));
    this.updateFeedback(t, dt);
    for (const a of this.animated) a(t, dt);
    for (const h of this.hanukkiot) h.update(t);
    for (const [zone, door] of this.doors) this.updateDoor(zone, door, dt, t);
    for (const [obj, o] of this.openTargets) {
      const goal = o.on ? o.to : o.from;
      if (o.kind === 'rot') obj.rotation[o.axis] = THREE.MathUtils.lerp(obj.rotation[o.axis], goal, Math.min(1, dt * 3));
      else obj.position[o.axis] = THREE.MathUtils.lerp(obj.position[o.axis], goal, Math.min(1, dt * 3));
    }
    if (this.mazeKey) {
      this.mazeKey.position.x = THREE.MathUtils.lerp(this.mazeKey.position.x, this.mazeKeyTarget.x, Math.min(1, dt * 12));
      this.mazeKey.position.z = THREE.MathUtils.lerp(this.mazeKey.position.z, this.mazeKeyTarget.z, Math.min(1, dt * 12));
    }
    this.gatePower = THREE.MathUtils.lerp(this.gatePower, this.gateTarget, Math.min(1, dt));
    if (this.hallGate) (this.hallGate.material as THREE.MeshBasicMaterial).opacity = 0.25 + this.gatePower * 0.5 + Math.sin(t * 2) * 0.05;
    if (this.particles) {
      const p = this.particles.geometry.attributes['position'] as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        let y = p.getY(i) + dt * (0.15 + this.gatePower * 0.4);
        if (y > 5.5) y = 0;
        p.setY(i, y);
      }
      p.needsUpdate = true;
    }

    if (this.mode === 'intro') this.introCamera(this.modeTime);
    else if (this.mode === 'outro') this.outroCamera(this.modeTime, t);
    else if (this.mode === 'cutscene' && this.cut) this.cutsceneCamera(dt, t);
    else if (this.mode === 'bench') this.benchCamera(dt, t);
    else if (this.mode === 'maze') this.mazeCamera(dt, t);
    else this.playUpdate(dt, t);
    this.updateBench(dt, t);
    this.updateMaze(dt, t);
    this.updateWheel(dt, t);
    this.updateSample(dt, t);

    this.updateRemotes(dt, t);
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /** Opening scene in the library: around the desk and the letter, ending at the group's starting point. */
  private introCamera(s: number) {
    // the free game opens over the map table, the cabinet and the symbol board
    const keys: [number, THREE.Vector3, THREE.Vector3][] = H_ZONES[0] === 'maproom' ? [
      [0, new THREE.Vector3(6, 4.2, 6), new THREE.Vector3(0, 1.0, -1.5)],
      [6, new THREE.Vector3(-1.5, 2.8, -2.0), new THREE.Vector3(-4.2, 1.4, -6.4)],
      [12, new THREE.Vector3(2.0, 2.6, -0.5), new THREE.Vector3(4.0, 1.0, -3.4)],
      [18, new THREE.Vector3(0, 2.4, 7.5), new THREE.Vector3(0, 1.4, -1.5)],
      [19, new THREE.Vector3(0, 2.4, 7.5), new THREE.Vector3(0, 1.4, -1.5)],
    ] : [
      [0, new THREE.Vector3(6, 4.2, 6), new THREE.Vector3(4.6, 1.6, -6.4)],
      [7, new THREE.Vector3(2, 2.6, -2.5), new THREE.Vector3(4.6, 1.8, -6.4)],
      [14, new THREE.Vector3(-4.5, 3.0, 3.5), new THREE.Vector3(0, 1.0, -1.2)],
      [20, new THREE.Vector3(-1.0, 2.0, 0.6), new THREE.Vector3(-1.2, 1.0, -1.2)],
      [24, new THREE.Vector3(0, 2.4, 7.5), new THREE.Vector3(0, 1.4, -1.5)],
    ];
    let i = 0;
    while (i < keys.length - 2 && s > keys[i + 1][0]) i++;
    const [t0, p0, l0] = keys[i];
    const [t1, p1, l1] = keys[i + 1];
    const k = THREE.MathUtils.smootherstep(Math.min(1, Math.max(0, (s - t0) / (t1 - t0))), 0, 1);
    this.camera.position.lerpVectors(p0, p1, k);
    this.camera.lookAt(new THREE.Vector3().lerpVectors(l0, l1, k));
  }

  /** Finale in the hall: the eight candles light one after another, the shamash stays separate and higher. */
  private outroCamera(s: number, t: number) {
    if (!H_ZONES.includes('hall')) return this.gateOutro(s, t);
    const c = hCenter('hall');
    this.camera.position.lerpVectors(new THREE.Vector3(0, 3.0, c + 5.5), new THREE.Vector3(0, 2.4, c + 1.5), THREE.MathUtils.smootherstep(Math.min(1, s / 8), 0, 1));
    this.camera.lookAt(0, 2.0, c - 5.2);
    const want = Math.min(8, Math.max(this.outroLit, Math.floor((s - 1) / 0.7)));
    if (this.hallHanukkiah && want !== this.hallHanukkiah.litCount) for (const h of this.hanukkiot) h.setLit(want, true);
    if (s > 7) this.gateTarget = 1.6;
    const all = [this.local, ...[...this.remotes.values()].map((r) => r.avatar)].filter(Boolean) as BoyAvatar[];
    all.forEach((a, k) => {
      const x = (k - (all.length - 1) / 2) * 1.1;
      a.root.position.lerp(new THREE.Vector3(x, 0, c - 0.2), 0.05);
      a.root.rotation.y = Math.PI;
      a.root.visible = true;
      if (s > 6.5) a.cheer(t + k);
      else a.update(0.016, 2, t);
    });
  }

  private playUpdate(dt: number, t: number) {
    if (!this.local) return;
    let fx = 0;
    let fz = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) fz += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) fz -= 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) fx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) fx += 1;
    fx += this.joystick.x;
    fz += this.joystick.y;
    const len = Math.hypot(fx, fz);
    const run = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const speed = (run ? 5.5 : 3.4) * Math.min(1, len);
    if (len > 0.05) {
      const nx = fx / len;
      const nz = fz / len;
      const sin = Math.sin(this.camYaw);
      const cos = Math.cos(this.camYaw);
      const dx = nx * cos - nz * sin;
      const dz = -nx * sin - nz * cos;
      const step = speed * dt;
      const tx = this.localPos.x + dx * step;
      const tz = this.localPos.z + dz * step;
      if (this.canStand(tx, tz)) this.localPos.set(tx, 0, tz);
      else if (this.canStand(tx, this.localPos.z)) this.localPos.x = tx;
      else if (this.canStand(this.localPos.x, tz)) this.localPos.z = tz;
      let diff = Math.atan2(dx, dz) - this.localYaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.localYaw += diff * Math.min(1, dt * 12);
      this.localSpeed = speed;
    } else this.localSpeed = 0;
    if (!hInRects(this.rects, this.localPos.x, this.localPos.z)) this.localPos.copy(SPAWN);
    this.local.root.position.copy(this.localPos);
    this.local.root.rotation.y = this.localYaw;
    this.local.update(dt, this.localSpeed, t);

    const pivot = new THREE.Vector3(this.localPos.x, 1.6, this.localPos.z);
    const dir = new THREE.Vector3(Math.sin(this.camYaw) * Math.cos(this.camPitch), Math.sin(this.camPitch), Math.cos(this.camYaw) * Math.cos(this.camPitch));
    const cam = new THREE.Vector3();
    const roomish = this.rects.map((r) => ({ x0: r.x0 - 0.45, x1: r.x1 + 0.45, z0: r.z0 - 0.45, z1: r.z1 + 0.45 }));
    for (let dist = this.camDist; dist > 0.8; dist -= 0.2) {
      cam.copy(pivot).addScaledVector(dir, dist);
      // stay inside the player's room — or in line with the doorway — so walls and door leaves never block the view
      const sameRoom = hZoneAt(cam.z) === hZoneAt(pivot.z) || Math.abs(cam.x) < DOOR_W / 2 - 0.25;
      if (hInRects(roomish, cam.x, cam.z) && cam.y < H_WALL - 0.3 && sameRoom) break;
    }
    if (this.snapCamera) {
      this.camera.position.copy(cam);
      this.snapCamera = false;
    } else this.camera.position.lerp(cam, Math.min(1, dt * 10));
    this.camera.lookAt(pivot);

    const zone = hZoneAt(this.localPos.z);
    if (zone !== this.currentZone) {
      this.currentZone = zone;
      this.placeKeyLight(zone);
      this.cb.onZoneChange?.(zone);
    }
    const now = performance.now();
    if (now - this.lastSent > 100) {
      const key = `${this.localPos.x.toFixed(2)},${this.localPos.z.toFixed(2)},${this.localYaw.toFixed(2)}`;
      if (key !== this.lastSentKey) {
        this.lastSentKey = key;
        this.lastSent = now;
        this.cb.onMove?.(this.localPos.x, 0, this.localPos.z, this.localYaw, zone);
      }
    }
    this.updateHover();
  }

  canStand(x: number, z: number) {
    return hInRects(this.rects, x, z) && !hInRects(this.obstacles, x, z);
  }

  /** The camera turns to the door that just opened and watches it rise. */
  playDoorCutscene(zone: string) {
    const i = H_ZONES.indexOf(zone as HZone);
    if (i <= 0 || this.mode !== 'play') return;
    const doorZ = hCenter(H_ZONES[i - 1]) - H_HALF_D;
    this.doorProgress.set(zone as HZone, 0);
    const d = this.doors.get(zone as HZone);
    if (d) d.userData['unlockT'] = 0;
    this.cut = { from: this.camera.position.clone(), to: new THREE.Vector3(2.2, 2.6, doorZ + 6), look: new THREE.Vector3(0, 1.9, doorZ - 2.5), t: 0, dur: 5 };
    this.mode = 'cutscene';
  }

  private cutsceneCamera(dt: number, t: number) {
    const c = this.cut!;
    c.t += dt;
    const k = THREE.MathUtils.smootherstep(Math.min(1, c.t / 1.3), 0, 1);
    const push = THREE.MathUtils.smootherstep(Math.max(0, (c.t - 2.2) / 2.8), 0, 1);
    const pos = new THREE.Vector3().lerpVectors(c.from, c.to, k);
    pos.lerp(new THREE.Vector3(0.3, 2.0, c.look.z + 4.2), push * 0.75);
    this.camera.position.copy(pos);
    this.camera.lookAt(c.look);
    this.local?.update(dt, 0, t);
    if (c.t >= c.dur) {
      this.cut = undefined;
      this.mode = 'play';
    }
  }

  /**
   * Doors: locked → the padlock (or code lock) stays; unlocked → the lock opens and drops away (or the dial turns),
   * the gilded trim lights up and the two leaves fold back against the wall.
   */
  private updateDoor(zone: HZone, door: THREE.Object3D, dt: number, t: number) {
    const u = door.userData as { leaves: THREE.Object3D[]; lock: THREE.Object3D; trim: THREE.MeshStandardMaterial; unlockT: number; lockY: number };
    const target = this.doorOpen.get(zone) ?? 0;
    if (target > 0) u.unlockT += dt;
    else u.unlockT = 0;
    const cur = this.doorProgress.get(zone) ?? target;
    // the leaves wait until the lock has opened
    const goal = target > 0 && u.unlockT > 1.0 ? 1 : 0;
    const next = THREE.MathUtils.lerp(cur, goal, Math.min(1, dt * 1.3));
    this.doorProgress.set(zone, next);
    // the leaves fold back against the wall of the room the group is leaving, clear of the corridor and the camera
    u.leaves[0].rotation.y = -next * 3.08;
    u.leaves[1].rotation.y = next * 3.08;
    const k = THREE.MathUtils.clamp(u.unlockT / 1.0, 0, 1);
    if (u.lock === this.doorLockPlate) {
      if (this.doorLockDial) this.doorLockDial.rotation.y = k * Math.PI * 4;
      u.lock.visible = next < 0.05;
    } else {
      const shackle = u.lock.userData['shackle'] as THREE.Object3D;
      shackle.position.y = 0.085 + Math.min(1, k * 2) * 0.05;
      u.lock.position.y = u.lockY - Math.max(0, k - 0.5) * 2 * 1.1;
      u.lock.visible = target === 0 || k < 1;
    }
    u.trim.emissiveIntensity = target > 0 ? 0.35 + Math.sin(t * 2) * 0.1 : 0;
  }

  /** Finale of the free game: the group stands before the open, glowing gate and cheers. */
  private gateOutro(s: number, t: number) {
    const c = hCenter(H_ZONES[H_ZONES.length - 1]);
    this.camera.position.lerpVectors(new THREE.Vector3(0, 3.0, c + 4.5), new THREE.Vector3(0, 2.3, c + 0.5), THREE.MathUtils.smootherstep(Math.min(1, s / 7), 0, 1));
    this.camera.lookAt(0, 2.0, c - H_HALF_D);
    const all = [this.local, ...[...this.remotes.values()].map((r) => r.avatar)].filter(Boolean) as BoyAvatar[];
    all.forEach((a, k) => {
      const x = (k - (all.length - 1) / 2) * 1.1;
      a.root.position.lerp(new THREE.Vector3(x, 0, c - 3.6), 0.05);
      a.root.rotation.y = Math.PI;
      a.root.visible = true;
      if (s > 5) a.cheer(t + k);
      else a.update(0.016, 2, t);
    });
  }

  /** Moves the local player to the entrance of a room (group transition or reconnect). */
  transferTo(zone: HZone, slot: number) {
    this.cut = undefined;
    if (this.mode === 'cutscene') this.mode = 'play';
    const c = hCenter(zone);
    const z = zone === 'library' ? SPAWN.z : c + 5.2;
    const x = ((slot % 5) - 2) * 0.9;
    if (this.canStand(x, z)) this.localPos.set(x, 0, z);
    else this.localPos.set(0, 0, z);
    this.localYaw = Math.PI;
    this.camYaw = 0;
    this.snapCamera = true;
    this.lastSentKey = '';
    this.lastSent = 0;
    if (this.currentZone !== zone) {
      this.currentZone = zone;
      this.placeKeyLight(zone);
      this.cb.onZoneChange?.(zone);
    }
  }

  get localZone(): HZone {
    return hZoneAt(this.localPos.z);
  }

  get isCutscene() {
    return this.mode === 'cutscene';
  }

  private updateRemotes(dt: number, t: number) {
    if (this.mode === 'outro') return;
    for (const [id, r] of this.remotes) {
      const p = this.positions?.get(id);
      if (p) {
        const target = new THREE.Vector3(p.x, 0, p.z);
        const before = r.pos.clone();
        r.pos.lerp(target, Math.min(1, dt * 8));
        r.speed = before.distanceTo(r.pos) / Math.max(dt, 0.001);
        let diff = p.ry - r.yaw;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        r.yaw += diff * Math.min(1, dt * 10);
      } else r.speed = 0;
      r.avatar.root.position.copy(r.pos);
      r.avatar.root.rotation.y = r.yaw;
      r.avatar.update(dt, r.speed, t);
    }
  }

  // ======================================================================= input

  private onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest?.('input, textarea, select')) return;
    if (this.mode === 'bench' || this.mode === 'maze') {
      if (e.code === 'Escape') this.cb.onBenchExit?.();
      return;
    }
    this.keys.add(e.code);
    // E uses the object under the pointer, or else the nearest one in reach (keyboard-only play)
    if (e.code === 'KeyE' && this.mode === 'play') {
      if (this.hovered) this.tryInteract(this.hovered);
      else this.interactNearest();
    }
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private onBlur = () => this.keys.clear();

  private bindInput() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      if (this.mode === 'bench') return this.benchDown(e);
      if (this.mode === 'maze') return this.mazeDown(e);
      this.drag = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId, touch: e.pointerType === 'touch' };
    });
    c.addEventListener('pointermove', (e) => {
      if (this.mode === 'bench') return this.benchMove(e);
      if (this.mode === 'maze') return this.mazeMove(e);
      const rect = c.getBoundingClientRect();
      this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      if (this.drag && this.drag.id === e.pointerId) {
        const dx = e.clientX - this.drag.x;
        const dy = e.clientY - this.drag.y;
        if (Math.abs(dx) + Math.abs(dy) > (this.drag.touch ? 12 : 4)) this.drag.moved = true;
        if (this.drag.moved && this.mode === 'play') {
          this.camYaw -= dx * 0.005 * this.sensitivity;
          this.camPitch = THREE.MathUtils.clamp(this.camPitch + dy * 0.004 * this.sensitivity, 0.05, 1.1);
          this.drag.x = e.clientX;
          this.drag.y = e.clientY;
        }
      }
    });
    c.addEventListener('pointerup', (e) => {
      if (this.mode === 'bench') return this.benchUp(e);
      if (this.mode === 'maze') return this.mazeUp(e);
      const d = this.drag;
      this.drag = undefined;
      if (d && !d.moved && this.mode === 'play') {
        const rect = c.getBoundingClientRect();
        this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
        const def = this.pick();
        if (def) this.tryInteract(def);
      }
    });
    c.addEventListener('pointerleave', () => this.pointer.set(10, 10));
    c.addEventListener('wheel', (e) => (this.camDist = THREE.MathUtils.clamp(this.camDist + e.deltaY * 0.004, 2.4, 7.5)), { passive: true });
  }

  private available(def: HInteractable) {
    return this.unlocked.has(def.zone) && (!def.itemId || this.worldItems.has(def.itemId));
  }

  private pick(): HInteractable | null {
    if (Math.abs(this.pointer.x) > 1) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const targets = [...this.hitTargets.values()].filter((m) => this.available(m.userData['def'] as HInteractable));
    const hits = this.raycaster.intersectObjects(targets, false);
    if (!hits.length) return null;
    const item = hits.find((h) => (h.object.userData['def'] as HInteractable).itemId && h.distance < hits[0].distance + 1.5);
    return ((item ?? hits[0]).object.userData['def'] as HInteractable) ?? null;
  }

  private updateHover() {
    if (this.drag?.moved) return;
    const def = this.pick();
    if (def?.id !== this.hovered?.id) {
      this.hovered = def;
      this.canvas.style.cursor = def ? 'pointer' : 'grab';
      this.cb.onHover?.(def);
    }
  }

  private tryInteract(def: HInteractable) {
    const [x, , z] = hWorldPos(def);
    const d = Math.hypot(x - this.localPos.x, z - this.localPos.z);
    if (d > INTERACT_DISTANCE + def.radius) this.cb.onTooFar?.(def);
    else {
      this.local?.reach(this.time);
      this.cb.onInteract?.(def);
    }
  }

  /** Uses the nearest object in reach (keyboard). On phones objects are tapped directly. */
  interactNearest() {
    let best: HInteractable | null = null;
    let bestD = Infinity;
    for (const def of H_INTERACTABLES) {
      if (!this.available(def)) continue;
      const [x, , z] = hWorldPos(def);
      // decorations only win when nothing useful is about as close
      const d = Math.hypot(x - this.localPos.x, z - this.localPos.z) - def.radius + (def.kind === 'decor' ? 1.2 : 0);
      if (d < bestD) {
        bestD = d;
        best = def;
      }
    }
    if (best && bestD < INTERACT_DISTANCE) {
      this.local?.reach(this.time);
      this.cb.onInteract?.(best);
    }
    return best && bestD < INTERACT_DISTANCE ? best : null;
  }

  private resize() {
    const el = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(1, el.clientWidth);
    const h = Math.max(1, el.clientHeight);
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 72 : 60;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    clearInterval(this.watchdog);
    this.resizeObs.disconnect();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose?.();
    });
    this.composer?.dispose();
    this.renderer.dispose();
  }
}
