// Spatial layout of "הפורטל האחרון": six rooms in a row along -Z, joined by short corridors with doors.
// The 3D world uses its own coordinates; RTL applies only to the UI (spec §6).

export const ZONE_ORDER = ['library', 'symbols', 'echo', 'mirrors', 'items', 'portal'] as const;
export type ZoneId = (typeof ZONE_ORDER)[number];

export const ROOM_HALF_W = 8;
export const ROOM_HALF_D = 7;
export const ROOM_SPACING = 16;
export const WALL_H = 6.5;

export const zoneCenter = (zone: string) => -ROOM_SPACING * Math.max(0, ZONE_ORDER.indexOf(zone as ZoneId));

export function zoneAt(z: number): ZoneId {
  const i = Math.round(-z / ROOM_SPACING);
  return ZONE_ORDER[Math.min(ZONE_ORDER.length - 1, Math.max(0, i))];
}

export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

const inset = 0.6;

/** Areas the player may stand in; corridors count only when the door after the room is open. */
export function walkableRects(unlocked: Set<string>): Rect[] {
  const rects: Rect[] = [];
  ZONE_ORDER.forEach((zone, i) => {
    if (!unlocked.has(zone)) return;
    const c = -ROOM_SPACING * i;
    rects.push({ x0: -ROOM_HALF_W + inset, x1: ROOM_HALF_W - inset, z0: c - ROOM_HALF_D + inset, z1: c + ROOM_HALF_D - inset });
    const next = ZONE_ORDER[i + 1];
    if (next && unlocked.has(next)) {
      rects.push({ x0: -1.1, x1: 1.1, z0: c - ROOM_SPACING + ROOM_HALF_D - inset - 0.1, z1: c - ROOM_HALF_D + inset + 0.1 });
    }
  });
  return rects;
}

export const inRects = (rects: Rect[], x: number, z: number) => rects.some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);

export type PanelId =
  | 'cipher-key'
  | 'cipher-message'
  | 'cipher-lock'
  | 'plaque'
  | 'sequence-lock'
  | 'sound-box'
  | 'sound-lock'
  | 'mirror'
  | 'split-lock'
  | 'workbench'
  | 'pedestal'
  | 'portal-lock'
  | 'map';

export interface InteractableDef {
  id: string;
  zone: ZoneId;
  label: string;
  panel?: PanelId;
  /** extra data for the panel, e.g. which plaque */
  ref?: string;
  itemId?: string;
  /** world position (x, y, z-offset from room center) */
  pos: [number, number, number];
  radius: number;
}

export const INTERACTABLES: InteractableDef[] = [
  // ספרייה
  { id: 'wall-map', zone: 'library', label: 'מפת האחוזה', panel: 'map', pos: [-7.6, 2.3, 1.45], radius: 1.0 },
  { id: 'key-book', zone: 'library', label: 'ספר פתוח על הדוכן', panel: 'cipher-key', pos: [-5.2, 1.25, -2.5], radius: 0.8 },
  { id: 'parchment', zone: 'library', label: 'קלף ישן על הקיר — לחצו להגדלה', panel: 'cipher-message', pos: [7.6, 2.55, -1.5], radius: 1.2 },
  { id: 'handle', zone: 'library', label: 'ידית ברזל', itemId: 'handle', pos: [5.4, 1.0, 4.2], radius: 0.6 },
  { id: 'door-symbols', zone: 'library', label: 'שער נעול — מנעול אותיות', panel: 'cipher-lock', pos: [0, 1.8, -6.9], radius: 1.5 },
  // חדר הסמלים
  { id: 'plaque-a', zone: 'symbols', label: 'לוח אבן', panel: 'plaque', ref: 'plaque-a', pos: [-7.6, 2.3, 1.5], radius: 1.0 },
  { id: 'plaque-b', zone: 'symbols', label: 'לוח אבן', panel: 'plaque', ref: 'plaque-b', pos: [7.6, 2.3, -2.0], radius: 1.0 },
  { id: 'plaque-c', zone: 'symbols', label: 'לוח אבן', panel: 'plaque', ref: 'plaque-c', pos: [-4.5, 2.3, 6.9], radius: 1.0 },
  { id: 'door-echo', zone: 'symbols', label: 'מנגנון הסמלים', panel: 'sequence-lock', pos: [0, 1.8, -6.9], radius: 1.5 },
  // חדר ההדים
  { id: 'music-box', zone: 'echo', label: 'תיבת נגינה עתיקה', panel: 'sound-box', pos: [-5, 1.1, 2.5], radius: 0.8 },
  { id: 'bells', zone: 'echo', label: 'ארבעה פעמונים', panel: 'sound-lock', pos: [0, 3.0, -1], radius: 2.2 },
  { id: 'crystal', zone: 'echo', label: 'גביש כחול', itemId: 'crystal', pos: [6.2, 1.3, -4.5], radius: 0.6 },
  // חדר המראות
  { id: 'mirror-1', zone: 'mirrors', label: 'מראה עתיקה', panel: 'mirror', pos: [-7.6, 2.4, 0], radius: 1.4 },
  { id: 'mirror-2', zone: 'mirrors', label: 'מראה עתיקה', panel: 'mirror', pos: [7.6, 2.4, 0], radius: 1.4 },
  { id: 'mirror-3', zone: 'mirrors', label: 'מראה עתיקה', panel: 'mirror', pos: [-4, 2.4, 6.9], radius: 1.4 },
  { id: 'code-box', zone: 'mirrors', label: 'קופסה נעולה — קוד בן 3 ספרות', panel: 'split-lock', pos: [0, 0.9, -2.5], radius: 0.9 },
  { id: 'gear', zone: 'mirrors', label: 'גלגל שיניים', itemId: 'gear', pos: [0, 1.25, -2.5], radius: 0.5 },
  // חדר החפצים
  { id: 'workbench', zone: 'items', label: 'שולחן עבודה', panel: 'workbench', pos: [-5, 1.1, 1], radius: 1.2 },
  { id: 'pedestal', zone: 'items', label: 'הכן הגדול', panel: 'pedestal', pos: [0, 1.2, -3], radius: 1.1 },
  // הפורטל
  { id: 'portal', zone: 'portal', label: 'מנעול הפורטל', panel: 'portal-lock', pos: [0, 3.2, -5.6], radius: 2.6 },
];

export const worldPos = (d: InteractableDef): [number, number, number] => [d.pos[0], d.pos[1], zoneCenter(d.zone) + d.pos[2]];

/** Where each puzzle's door stands (the door between a zone and the next one). */
export const DOOR_AFTER: Record<string, ZoneId> = {
  library: 'symbols',
  symbols: 'echo',
  echo: 'mirrors',
  mirrors: 'items',
  items: 'portal',
};

/** Furniture footprints (x0, x1, z0, z1 relative to the room center) that block walking. */
const LOCAL_OBSTACLES: Record<ZoneId, [number, number, number, number][]> = {
  library: [
    [-8, -7.0, -4.5, 0.5], [-8, -7.0, 2.4, 5.8], [7.0, 8, 1.4, 5.8], // shelves (gap on the left wall for the mansion map)
    [-5.7, -4.7, -3.0, -2.0], // lectern
    [4.4, 6.4, 3.6, 4.8], // desk
    [-1.6, 1.6, -0.3, 1.3], // reading table
  ],
  symbols: [
    [-7.2, -6.0, -6.2, -5.0], [6.0, 7.2, -6.2, -5.0], [-7.2, -6.0, 5.0, 6.2], [6.0, 7.2, 5.0, 6.2], // pillars
    [-6.0, -5.2, -4.6, -3.8], [5.2, 6.0, -4.6, -3.8], [-6.0, -5.2, 3.8, 4.6], [5.2, 6.0, 3.8, 4.6], // braziers
  ],
  echo: [[-5.7, -4.3, 2.0, 3.0]],
  mirrors: [[-0.75, 0.75, -3.0, -2.0]],
  items: [[-6.4, -3.6, 0.4, 1.6], [-1.2, 1.2, -4.2, -1.8], [7.2, 8, -2.8, 1.0]],
  portal: [
    [-6.6, -5.4, -4.6, -3.4], [5.4, 6.6, -4.6, -3.4], [-6.6, -5.4, 2.4, 3.6], [5.4, 6.6, 2.4, 3.6], // columns
    [-3, 3, -6.4, -4.8], // portal base
    [-4.4, -3.6, 0.6, 1.4], [3.6, 4.4, 0.6, 1.4], // braziers
  ],
};

export const PLAYER_RADIUS = 0.3;

export function obstacleRects(): Rect[] {
  const out: Rect[] = [];
  for (const zone of ZONE_ORDER) {
    const c = zoneCenter(zone);
    for (const [x0, x1, z0, z1] of LOCAL_OBSTACLES[zone]) {
      out.push({ x0: x0 - PLAYER_RADIUS, x1: x1 + PLAYER_RADIUS, z0: c + z0 - PLAYER_RADIUS, z1: c + z1 + PLAYER_RADIUS });
    }
  }
  return out;
}
