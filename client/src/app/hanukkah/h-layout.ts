// Spatial layout of "סוד פך השמן": eight rooms in a row along -Z, joined by short corridors with doors.
// The 3D world uses its own coordinates; RTL applies only to the UI.

export const H_ZONES = ['library', 'workshop', 'maze', 'cipher', 'dreidels', 'lab', 'mosaic', 'hall'] as const;
export type HZone = (typeof H_ZONES)[number];

export const H_HALF_W = 8;
export const H_HALF_D = 7;
export const H_SPACING = 16;
export const H_WALL = 6.5;

export const hCenter = (zone: string) => -H_SPACING * Math.max(0, H_ZONES.indexOf(zone as HZone));

export function hZoneAt(z: number): HZone {
  const i = Math.round(-z / H_SPACING);
  return H_ZONES[Math.min(H_ZONES.length - 1, Math.max(0, i))];
}

export interface HRect { x0: number; x1: number; z0: number; z1: number }

const inset = 0.6;

/** Areas the player may stand in; a corridor counts only when the next room is open. */
export function hWalkable(unlocked: Set<string>): HRect[] {
  const rects: HRect[] = [];
  H_ZONES.forEach((zone, i) => {
    if (!unlocked.has(zone)) return;
    const c = -H_SPACING * i;
    rects.push({ x0: -H_HALF_W + inset, x1: H_HALF_W - inset, z0: c - H_HALF_D + inset, z1: c + H_HALF_D - inset });
    const next = H_ZONES[i + 1];
    if (next && unlocked.has(next))
      rects.push({ x0: -1.1, x1: 1.1, z0: c - H_SPACING + H_HALF_D - inset - 0.1, z1: c - H_HALF_D + inset + 0.1 });
  });
  return rects;
}

export const hInRects = (rects: HRect[], x: number, z: number) => rects.some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);

/** The action word shown on an interactive object (spec §9). */
export type Verb = 'בדיקה' | 'הרמה' | 'פתיחה' | 'סיבוב' | 'הנחה' | 'הפעלה' | 'קריאה';

/**
 * What opens when an object is used:
 *  clue → reads a clue (first finder scores) · panel → a puzzle panel · item → picks up an item ·
 *  decor → a short description only (never scores, never part of a solution).
 */
export type HKind = 'clue' | 'panel' | 'item' | 'decor';

export type HPanel = 'riddle' | 'lamp' | 'maze' | 'box' | 'wheel' | 'stand' | 'lock' | 'jugs' | 'mosaic' | 'pedestals' | 'final';

export interface HInteractable {
  id: string;
  zone: HZone;
  label: string;
  verb: Verb;
  kind: HKind;
  panel?: HPanel;
  clueId?: string;
  itemId?: string;
  /** decor text, or the slot a pedestal stands for */
  text?: string;
  ref?: string;
  /** x, y, z offset from the room centre */
  pos: [number, number, number];
  radius: number;
}

export const H_INTERACTABLES: HInteractable[] = [
  // 1 · הספרייה הסודית
  { id: 'letter', zone: 'library', label: 'מכתב מקופל', verb: 'קריאה', kind: 'clue', clueId: 'r1-letter', panel: 'riddle', pos: [-1.2, 1.05, -1.2], radius: 0.55 },
  { id: 'drawer', zone: 'library', label: 'מגירה נעולה', verb: 'פתיחה', kind: 'panel', panel: 'riddle', pos: [0.4, 0.62, -0.95], radius: 0.5 },
  { id: 'magnifier', zone: 'library', label: 'זכוכית מגדלת', verb: 'בדיקה', kind: 'decor', text: 'זכוכית מגדלת עתיקה. דרכה האותיות במכתב נראות ברורות יותר.', pos: [-0.3, 1.02, -1.5], radius: 0.4 },
  { id: 'globe', zone: 'library', label: 'גלובוס עתיק', verb: 'סיבוב', kind: 'decor', text: 'גלובוס עתיק מסתובב בחריקה. הוא יפה, אבל לא קשור לחידה.', pos: [3.4, 1.0, -3.2], radius: 0.6 },
  { id: 'books3', zone: 'library', label: 'שלושה ספרים', verb: 'בדיקה', kind: 'decor', text: 'שלושה ספרים בכריכות שונות: אדומה, ירוקה וכחולה. ספרי היסטוריה ישנים.', pos: [-2.6, 1.05, -1.6], radius: 0.5 },
  { id: 'oil-lamp-1', zone: 'library', label: 'מנורת שמן', verb: 'בדיקה', kind: 'decor', text: 'מנורת שמן קטנה מאירה את השולחן באור חם.', pos: [1.6, 1.05, -1.6], radius: 0.4 },
  { id: 'maps', zone: 'library', label: 'מפות ומגילות', verb: 'בדיקה', kind: 'decor', text: 'מפות ישנות של האחוזה ומגילות מגולגלות.', pos: [-6.6, 1.3, 2.5], radius: 0.7 },

  // 2 · סדנת מנורת השמן
  { id: 'part-base', zone: 'workshop', label: 'בסיס המנורה', verb: 'הרמה', kind: 'item', itemId: 'lamp-base', pos: [-5.4, 0.35, 3.2], radius: 0.5 },
  { id: 'part-tank', zone: 'workshop', label: 'מכל שמן', verb: 'הרמה', kind: 'item', itemId: 'lamp-tank', pos: [6.2, 1.55, -3.6], radius: 0.45 },
  { id: 'part-wick', zone: 'workshop', label: 'פתיל', verb: 'הרמה', kind: 'item', itemId: 'lamp-wick', pos: [-6.4, 0.95, -4.2], radius: 0.45 },
  { id: 'part-glass', zone: 'workshop', label: 'זכוכית', verb: 'הרמה', kind: 'item', itemId: 'lamp-glass', pos: [4.6, 0.3, 4.4], radius: 0.45 },
  { id: 'part-cover', zone: 'workshop', label: 'מכסה', verb: 'הרמה', kind: 'item', itemId: 'lamp-cover', pos: [2.4, 2.35, -6.4], radius: 0.45 },
  { id: 'workbench', zone: 'workshop', label: 'שולחן העבודה — אזורי ההרכבה', verb: 'הנחה', kind: 'panel', panel: 'lamp', pos: [0, 1.0, -1.4], radius: 1.1 },
  { id: 'r2-scroll', zone: 'workshop', label: 'מגילה עם איור המנורה', verb: 'קריאה', kind: 'clue', clueId: 'r2-scroll', pos: [-2.35, 1.05, -1.95], radius: 0.45 },
  { id: 'oil-bottle', zone: 'workshop', label: 'בקבוק שמן', verb: 'בדיקה', kind: 'decor', text: 'בקבוק שמן זית. ריחו חזק.', pos: [2.35, 1.1, -1.95], radius: 0.4 },
  { id: 'tools', zone: 'workshop', label: 'כלי עבודה', verb: 'בדיקה', kind: 'decor', text: 'פטישים, צבתות ומברגים קטנים של אומן מנורות.', pos: [-6.9, 2.0, 0.5], radius: 0.8 },
  { id: 'shelf-2', zone: 'workshop', label: 'מדף עם חפצים', verb: 'בדיקה', kind: 'decor', text: 'כדים, קופסאות וכלים ישנים — רק קישוט.', pos: [6.9, 2.4, 1.5], radius: 0.8 },

  // 3 · מבוך המפתח המגנטי
  { id: 'maze-table', zone: 'maze', label: 'שולחן המבוך והמוט המגנטי', verb: 'הפעלה', kind: 'panel', panel: 'maze', pos: [0, 1.0, -1.0], radius: 1.4 },
  { id: 'levers', zone: 'maze', label: 'שלושה מנופים', verb: 'הפעלה', kind: 'panel', panel: 'maze', pos: [2.6, 1.0, -1.0], radius: 0.6 },
  { id: 'r3-scroll', zone: 'maze', label: 'המגילה', verb: 'קריאה', kind: 'clue', clueId: 'r3-scroll', pos: [-2.8, 1.05, -1.0], radius: 0.45 },
  { id: 'symbol-board', zone: 'maze', label: 'לוח עם סמלי מסלול', verb: 'בדיקה', kind: 'decor', text: 'על הלוח מצוירים שלושה סמלים: כוכב, להבה ומנורה.', pos: [0, 2.6, -6.6], radius: 0.9 },
  { id: 'metal-box', zone: 'maze', label: 'תיבת המתכת בקצה המבוך', verb: 'פתיחה', kind: 'panel', panel: 'box', pos: [2.6, 1.0, -2.2], radius: 0.5 },

  // 4 · חדר הכתב המוצפן
  { id: 'tablets', zone: 'cipher', label: 'שלושה לוחות מספרים', verb: 'קריאה', kind: 'decor', text: 'על שלושת הלוחות מופיעים המספרים: 1 — 6 — 200', pos: [0, 2.4, -6.6], radius: 1.0 },
  { id: 'r4-scroll', zone: 'cipher', label: 'מגילה', verb: 'קריאה', kind: 'clue', clueId: 'r4-scroll', pos: [-2.2, 1.05, -1.2], radius: 0.45 },
  { id: 'gematria', zone: 'cipher', label: 'לוח ערכי גימטריה', verb: 'קריאה', kind: 'clue', clueId: 'r4-gematria', pos: [-6.9, 2.2, -1.5], radius: 0.9 },
  { id: 'wheel', zone: 'cipher', label: 'גלגל האותיות והמגירה', verb: 'סיבוב', kind: 'panel', panel: 'wheel', pos: [0.6, 1.1, -1.2], radius: 0.7 },
  { id: 'open-book', zone: 'cipher', label: 'ספר פתוח עם סימניות', verb: 'קריאה', kind: 'decor', text: 'ספר עבה עם סימניות רבות. המילה הסודית אינה כתובה בו.', pos: [2.4, 1.05, -1.2], radius: 0.45 },
  { id: 'ink', zone: 'cipher', label: 'דיו וקולמוס', verb: 'בדיקה', kind: 'decor', text: 'קסת דיו וקולמוס נוצה של סופר.', pos: [1.6, 1.05, -0.7], radius: 0.35 },
  { id: 'seals', zone: 'cipher', label: 'חותמות שעווה', verb: 'בדיקה', kind: 'decor', text: 'חותמות שעווה אדומות של שומרי האחוזה.', pos: [-1.2, 1.05, -0.7], radius: 0.35 },

  // 5 · חדר סביבוני הסוד
  { id: 'dreidel-nun', zone: 'dreidels', label: 'סביבון קטן', verb: 'הרמה', kind: 'item', itemId: 'dreidel-nun', pos: [-5.6, 0.25, 3.6], radius: 0.4 },
  { id: 'dreidel-gimel', zone: 'dreidels', label: 'סביבון קטן', verb: 'הרמה', kind: 'item', itemId: 'dreidel-gimel', pos: [5.8, 1.15, -4.4], radius: 0.4 },
  { id: 'dreidel-he', zone: 'dreidels', label: 'סביבון קטן', verb: 'הרמה', kind: 'item', itemId: 'dreidel-he', pos: [-6.2, 1.15, -3.2], radius: 0.4 },
  { id: 'dreidel-pe', zone: 'dreidels', label: 'סביבון קטן', verb: 'הרמה', kind: 'item', itemId: 'dreidel-pe', pos: [4.2, 0.25, 4.8], radius: 0.4 },
  { id: 'stand', zone: 'dreidels', label: 'מתקן העץ — ארבעה מקומות', verb: 'הנחה', kind: 'panel', panel: 'stand', pos: [2.8, 1.0, -1.4], radius: 0.8 },
  { id: 'card-1', zone: 'dreidels', label: 'קלף רמז', verb: 'קריאה', kind: 'clue', clueId: 'r5-card-1', pos: [1.7, 1.02, -0.8], radius: 0.3 },
  { id: 'card-2', zone: 'dreidels', label: 'קלף רמז', verb: 'קריאה', kind: 'clue', clueId: 'r5-card-2', pos: [2.3, 1.02, -0.7], radius: 0.3 },
  { id: 'card-3', zone: 'dreidels', label: 'קלף רמז', verb: 'קריאה', kind: 'clue', clueId: 'r5-card-3', pos: [3.3, 1.02, -0.7], radius: 0.3 },
  { id: 'card-4', zone: 'dreidels', label: 'קלף רמז', verb: 'קריאה', kind: 'clue', clueId: 'r5-card-4', pos: [3.9, 1.02, -0.8], radius: 0.3 },
  { id: 'dreidel-box', zone: 'dreidels', label: 'תיבת עץ עם מנעול מספרי', verb: 'פתיחה', kind: 'panel', panel: 'lock', pos: [-2.8, 0.55, -1.6], radius: 0.6 },
  { id: 'big-dreidel', zone: 'dreidels', label: 'סביבון מוזהב גדול', verb: 'סיבוב', kind: 'decor', text: 'סביבון ענק על בסיס מסתובב. הוא מסתובב לאט ומנצנץ.', pos: [0, 1.6, -3.4], radius: 1.0 },
  { id: 'coins', zone: 'dreidels', label: 'מטבעות עתיקים ופמוטים', verb: 'בדיקה', kind: 'decor', text: 'מטבעות עתיקים ופמוטי נחושת — קישוט בלבד.', pos: [-6.6, 1.2, 1.0], radius: 0.7 },

  // 6 · מעבדת השמן
  { id: 'jugs', zone: 'lab', label: 'ארבעה כדי שמן', verb: 'בדיקה', kind: 'panel', panel: 'jugs', pos: [0, 1.3, -2.2], radius: 1.6 },
  { id: 'r6-sign', zone: 'lab', label: 'הכתובת מעל הכדים', verb: 'קריאה', kind: 'clue', clueId: 'r6-sign', pos: [0, 3.1, -3.6], radius: 0.9 },
  { id: 'scales', zone: 'lab', label: 'מאזניים עתיקים', verb: 'בדיקה', kind: 'decor', text: 'מאזני נחושת. שני הכפות מאוזנות.', pos: [-4.4, 1.3, -3.0], radius: 0.6 },
  { id: 'tubes', zone: 'lab', label: 'מבחנות', verb: 'בדיקה', kind: 'decor', text: 'מבחנות זכוכית עם שמן בגוונים שונים. צבע השמן לא יעזור לכם.', pos: [4.4, 1.15, -3.0], radius: 0.6 },
  { id: 'lab-book', zone: 'lab', label: 'ספר בדיקות פתוח', verb: 'קריאה', kind: 'decor', text: '„בודקים משפט אחר משפט. מניחים שכד אחד הוא הטהור, וסופרים כמה משפטים אמת.”', pos: [3.0, 1.05, -0.4], radius: 0.45 },

  // 7 · חדר הפסיפס והמראות
  { id: 'mosaic', zone: 'mosaic', label: 'לוח הפסיפס 3×3', verb: 'סיבוב', kind: 'panel', panel: 'mosaic', pos: [0, 2.3, -6.6], radius: 1.8 },
  { id: 'mosaic-levers', zone: 'mosaic', label: 'מנופים להזזת האבנים', verb: 'הפעלה', kind: 'panel', panel: 'mosaic', pos: [3.4, 1.0, -5.6], radius: 0.6 },
  { id: 'mirrors', zone: 'mosaic', label: 'מראות קטנות', verb: 'בדיקה', kind: 'decor', text: 'מראות קטנות מחזירות את האור הכחול אל הקירות.', pos: [-5.4, 1.6, -3.0], radius: 0.7 },
  { id: 'spare-stones', zone: 'mosaic', label: 'אבני פסיפס חלופיות', verb: 'בדיקה', kind: 'decor', text: 'אבני פסיפס חלופיות. הן לא נכנסות ללוח — אלה מסיחים.', pos: [5.4, 0.5, -2.4], radius: 0.6 },

  // 8 · היכל האור
  ...[1, 2, 3, 4, 5, 6, 7].map((k): HInteractable => {
    const a = Math.PI * (0.15 + (k - 1) * (0.7 / 6));
    return {
      id: `pedestal-${k}`, zone: 'hall', label: `כן ${k}`, verb: 'הנחה', kind: 'panel', panel: 'pedestals', ref: `p${k}`,
      pos: [Math.cos(a) * -4.6, 1.2, -1.2 - Math.sin(a) * 3.4], radius: 0.5,
    };
  }),
  { id: 'final-book', zone: 'hall', label: 'ספר פתוח עם החידה האחרונה', verb: 'קריאה', kind: 'panel', panel: 'final', pos: [0, 1.2, 1.4], radius: 0.6 },
  { id: 'hall-jug', zone: 'hall', label: 'פך שמן זוהר', verb: 'בדיקה', kind: 'decor', text: 'פך שמן זוהר על הכן המרכזי.', pos: [0, 1.6, -1.6], radius: 0.6 },
  { id: 'chest', zone: 'hall', label: 'תיבת אוצר', verb: 'פתיחה', kind: 'decor', text: 'תיבת האוצר נעולה. היא תיפתח בסוף המסע.', pos: [5.2, 0.6, 2.4], radius: 0.7 },
];

/** World position of an interactable. */
export const hWorldPos = (d: HInteractable): [number, number, number] => [d.pos[0], d.pos[1], hCenter(d.zone) + d.pos[2]];

/** Furniture the player cannot walk through: [zone, x0, x1, z0, z1] relative to the room centre. */
const OBSTACLES: [HZone, number, number, number, number][] = [
  ['library', -3.2, 2.2, -2.2, -0.4],
  ['workshop', -2.6, 2.6, -2.2, -0.6],
  ['maze', -2.4, 3.2, -2.6, 0.4],
  ['cipher', -3.0, 3.0, -2.0, -0.2],
  ['dreidels', -1.2, 1.2, -4.6, -2.2], ['dreidels', 1.2, 4.4, -2.0, -0.4], ['dreidels', -3.4, -2.2, -2.2, -1.0],
  ['lab', -3.4, 3.4, -3.2, -1.2], ['lab', 2.0, 4.0, -1.0, 0.2],
  ['mosaic', -1.0, 1.0, -0.8, 0.8],
  ['hall', -1.0, 1.0, -2.6, -0.6],
];

export function hObstacles(): HRect[] {
  return OBSTACLES.map(([zone, x0, x1, z0, z1]) => {
    const c = hCenter(zone);
    return { x0, x1, z0: c + z0, z1: c + z1 };
  });
}
