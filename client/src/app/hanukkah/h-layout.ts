// Spatial layout of the room-by-room games: "סוד פך השמן" (eight rooms) and the free trial "שער הסודות" (two rooms),
// in a row along -Z, joined by short corridors with doors. The 3D world uses its own coordinates; RTL applies only to the UI.

export const HANUKKAH_ZONES = ['library', 'workshop', 'maze', 'cipher', 'dreidels', 'lab', 'mosaic', 'hall'] as const;
export const SAMPLE_ZONES = ['maproom', 'gearworks'] as const;
export type HZone = (typeof HANUKKAH_ZONES)[number] | (typeof SAMPLE_ZONES)[number];

/** The rooms of the game being played (set by useLayout before the world is built). */
export let H_ZONES: readonly HZone[] = HANUKKAH_ZONES;

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

export type HPanel = 'riddle' | 'lamp' | 'maze' | 'box' | 'wheel' | 'stand' | 'lock' | 'jugs' | 'mosaic' | 'pedestals' | 'final'
  | 'map' | 'symbols' | 'cabinet' | 'gears' | 'scales';

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

const HANUKKAH_INTERACTABLES: HInteractable[] = [
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
  { id: 'maze-table', zone: 'maze', label: 'לוח המבוך — הזזת המפתח', verb: 'הפעלה', kind: 'panel', panel: 'maze', pos: [0, 1.0, -1.0], radius: 1.4 },
  { id: 'levers', zone: 'maze', label: 'שלוש ידיות המנגנון', verb: 'הפעלה', kind: 'panel', panel: 'maze', pos: [2.6, 1.0, -1.0], radius: 0.6 },
  { id: 'r3-scroll', zone: 'maze', label: 'המגילה', verb: 'קריאה', kind: 'clue', clueId: 'r3-scroll', pos: [-2.8, 1.05, -1.0], radius: 0.45 },
  { id: 'symbol-board', zone: 'maze', label: 'לוח עם סמלי מסלול', verb: 'בדיקה', kind: 'decor', text: 'על הלוח מצוירים שלושה סמלים: כוכב, להבה ומנורה.', pos: [0, 2.6, -6.6], radius: 0.9 },
  { id: 'metal-box', zone: 'maze', label: 'לחצו על התיבה כדי לבדוק את המנעול', verb: 'פתיחה', kind: 'panel', panel: 'box', pos: [3.3, 1.2, -2.25], radius: 0.6 },

  // 4 · חדר הכתב המוצפן
  { id: 'tablets', zone: 'cipher', label: 'שלושה לוחות מספרים', verb: 'קריאה', kind: 'decor', text: 'על שלושת הלוחות מופיעים המספרים: 1 — 6 — 200', pos: [-3.8, 2.6, -6.6], radius: 1.6 },
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
  { id: 'stand', zone: 'dreidels', label: 'מתקן הסביבונים — ארבעה מקומות', verb: 'הנחה', kind: 'panel', panel: 'stand', pos: [2.8, 1.1, -1.4], radius: 0.85 },
  { id: 'card-1', zone: 'dreidels', label: 'קלף רמז', verb: 'קריאה', kind: 'clue', clueId: 'r5-card-1', pos: [1.45, 1.02, -1.65], radius: 0.3 },
  { id: 'card-2', zone: 'dreidels', label: 'קלף רמז', verb: 'קריאה', kind: 'clue', clueId: 'r5-card-2', pos: [1.45, 1.02, -1.0], radius: 0.3 },
  { id: 'card-3', zone: 'dreidels', label: 'קלף רמז', verb: 'קריאה', kind: 'clue', clueId: 'r5-card-3', pos: [4.15, 1.02, -1.65], radius: 0.3 },
  { id: 'card-4', zone: 'dreidels', label: 'קלף רמז', verb: 'קריאה', kind: 'clue', clueId: 'r5-card-4', pos: [4.15, 1.02, -1.0], radius: 0.3 },
  { id: 'dreidel-box', zone: 'dreidels', label: 'תיבת עץ סגורה', verb: 'בדיקה', kind: 'decor', text: 'תיבת עץ סגורה היטב. נראה שהיא קשורה למנעול הקוד שבדלת החדר.', pos: [-2.8, 0.55, -1.6], radius: 0.6 },
  { id: 'door-lock', zone: 'dreidels', label: 'מנעול הקוד בדלת — לחצו כדי להזין קוד', verb: 'פתיחה', kind: 'panel', panel: 'lock', pos: [0.62, 1.45, -6.95], radius: 0.45 },
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
  // a bonus puzzle in the same room: the ancient scales, their three inscriptions and the four things to weigh
  { id: 'bonus-scales', zone: 'mosaic', label: 'המאזניים העתיקים — חידת בונוס', verb: 'הנחה', kind: 'panel', panel: 'scales', pos: [-4.6, 1.4, 2.75], radius: 0.9 },
  { id: 'scale-note-1', zone: 'mosaic', label: 'חריטה ראשונה על הקיר', verb: 'קריאה', kind: 'clue', clueId: 'h7-scale-1', pos: [-7.9, 2.3, -0.6], radius: 0.55 },
  { id: 'scale-note-2', zone: 'mosaic', label: 'חריטה שנייה על הקיר', verb: 'קריאה', kind: 'clue', clueId: 'h7-scale-2', pos: [-7.9, 2.3, 0.65], radius: 0.55 },
  { id: 'scale-note-3', zone: 'mosaic', label: 'חריטה שלישית על הקיר', verb: 'קריאה', kind: 'clue', clueId: 'h7-scale-3', pos: [-7.9, 2.3, 1.9], radius: 0.55 },
  { id: 'sc-feather', zone: 'mosaic', label: 'נוצה', verb: 'הרמה', kind: 'item', itemId: 'sc-feather', pos: [-7.6, 1.45, 4.3], radius: 0.35 },
  { id: 'sc-key', zone: 'mosaic', label: 'מפתח עתיק', verb: 'הרמה', kind: 'item', itemId: 'sc-key', pos: [6.15, 0.77, 2.8], radius: 0.35 },
  { id: 'sc-crystal', zone: 'mosaic', label: 'גביש קסום', verb: 'הרמה', kind: 'item', itemId: 'sc-crystal', pos: [5.4, 0.67, 0.2], radius: 0.35 },
  { id: 'sc-hourglass', zone: 'mosaic', label: 'שעון חול', verb: 'הרמה', kind: 'item', itemId: 'sc-hourglass', pos: [-2.6, 0.16, 5.2], radius: 0.35 },

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

/** The free trial game "שער הסודות": the map room and the mechanism workshop. */
const SAMPLE_INTERACTABLES: HInteractable[] = [
  // 1 · חדר המפה והסמלים
  { id: 'map-table', zone: 'maproom', label: 'שולחן המפה — הרכבת החלקים', verb: 'הנחה', kind: 'panel', panel: 'map', pos: [0, 1.05, -1.5], radius: 1.0 },
  { id: 'piece-left', zone: 'maproom', label: 'חלק מפה מתחת לספר', verb: 'הרמה', kind: 'item', itemId: 'map-left', pos: [-1.9, 1.05, -0.95], radius: 0.4 },
  { id: 'note', zone: 'maproom', label: 'פתק ליד המגירות', verb: 'קריאה', kind: 'clue', clueId: 'g1-note', pos: [-7.0, 1.3, 1.2], radius: 0.45 },
  { id: 'piece-middle', zone: 'maproom', label: 'חלק מפה במגירה', verb: 'הרמה', kind: 'item', itemId: 'map-middle', pos: [-6.7, 0.95, 1.9], radius: 0.4 },
  { id: 'piece-right', zone: 'maproom', label: 'חלק מפה מאחורי הגלובוס', verb: 'הרמה', kind: 'item', itemId: 'map-right', pos: [7.2, 1.6, -2.45], radius: 0.4 },
  { id: 'magnifier', zone: 'maproom', label: 'זכוכית מגדלת', verb: 'בדיקה', kind: 'clue', clueId: 'g1-magnifier', pos: [1.9, 1.05, -0.9], radius: 0.4 },
  { id: 'sym-compass', zone: 'maproom', label: 'סמל המצפן', verb: 'הרמה', kind: 'item', itemId: 'sym-compass', pos: [1.5, 1.1, -2.0], radius: 0.35 },
  { id: 'sym-key', zone: 'maproom', label: 'סמל המפתח על וו', verb: 'הרמה', kind: 'item', itemId: 'sym-key', pos: [-2.4, 1.7, -6.6], radius: 0.35 },
  { id: 'sym-book', zone: 'maproom', label: 'סמל הספר בין הספרים', verb: 'הרמה', kind: 'item', itemId: 'sym-book', pos: [-7.3, 1.45, -3.4], radius: 0.35 },
  { id: 'sym-lamp', zone: 'maproom', label: 'סמל המנורה ליד המנורה', verb: 'הרמה', kind: 'item', itemId: 'sym-lamp', pos: [5.6, 1.1, 2.6], radius: 0.35 },
  { id: 'symbol-board', zone: 'maproom', label: 'לוח הסמלים — ארבעה מקומות', verb: 'הנחה', kind: 'panel', panel: 'symbols', pos: [4.0, 1.05, -3.4], radius: 0.9 },
  { id: 'cabinet', zone: 'maproom', label: 'הארון הנעול — מנעול בן ארבע ספרות', verb: 'פתיחה', kind: 'panel', panel: 'cabinet', pos: [-4.2, 1.4, -6.1], radius: 0.8 },
  { id: 'globe', zone: 'maproom', label: 'גלובוס קטן', verb: 'סיבוב', kind: 'decor', text: 'גלובוס קטן על המדף. נראה שמשהו מוסתר מאחוריו.', pos: [7.1, 1.6, -1.9], radius: 0.4 },
  { id: 'compass', zone: 'maproom', label: 'מצפן עתיק', verb: 'בדיקה', kind: 'decor', text: 'מצפן נחושת עתיק. המחט שלו מראה את הכיוון.', pos: [1.1, 1.05, -2.0], radius: 0.35 },
  { id: 'four-books', zone: 'maproom', label: 'ארבעה ספרים', verb: 'בדיקה', kind: 'decor', text: 'ארבעה ספרים בכריכות שונות: אדומה, ירוקה, כחולה וחומה.', pos: [-7.3, 1.45, -2.6], radius: 0.6 },
  { id: 'writing', zone: 'maproom', label: 'כלי כתיבה', verb: 'בדיקה', kind: 'decor', text: 'קסת דיו וקולמוס של חוקר מפות.', pos: [-1.0, 1.05, -2.0], radius: 0.35 },

  // 2 · סדנת המנגנון
  { id: 'gear-bench', zone: 'gearworks', label: 'שולחן העבודה — צירי הגלגלים', verb: 'הנחה', kind: 'panel', panel: 'gears', pos: [0, 1.05, -1.4], radius: 1.0 },
  { id: 'gear-lever', zone: 'gearworks', label: 'ידית מכנית', verb: 'הפעלה', kind: 'panel', panel: 'gears', pos: [2.0, 1.3, -1.5], radius: 0.4 },
  { id: 'gear-large', zone: 'gearworks', label: 'גלגל שיניים גדול', verb: 'הרמה', kind: 'item', itemId: 'gear-large', pos: [-7.2, 1.45, -3.0], radius: 0.45 },
  { id: 'gear-small', zone: 'gearworks', label: 'גלגל שיניים קטן', verb: 'הרמה', kind: 'item', itemId: 'gear-small', pos: [5.8, 0.75, 2.8], radius: 0.4 },
  { id: 'gear-medium', zone: 'gearworks', label: 'גלגל שיניים בינוני', verb: 'הרמה', kind: 'item', itemId: 'gear-medium', pos: [-3.0, 0.2, 3.5], radius: 0.4 },
  { id: 'gear-diagram', zone: 'gearworks', label: 'איור הגלגלים על הקיר', verb: 'קריאה', kind: 'clue', clueId: 'g2-diagram', pos: [-4.0, 2.3, -6.8], radius: 0.9 },
  { id: 'small-box', zone: 'gearworks', label: 'תיבה קטנה עם מנעול', verb: 'בדיקה', kind: 'decor', text: 'תיבת עץ קטנה ונעולה, עם מכסה מוזהב.', pos: [3.6, 0.4, -4.6], radius: 0.45 },
  { id: 'gate-sign', zone: 'gearworks', label: 'סמל השער מעל הדלת', verb: 'בדיקה', kind: 'decor', text: 'סמל השער. כשמנגנון גלגלי השיניים יופעל — השער ייפתח.', pos: [0, 3.9, -6.8], radius: 0.6 },
];

export let H_INTERACTABLES: HInteractable[] = HANUKKAH_INTERACTABLES;

/** Chooses the rooms and objects of the game about to be shown. */
export function useLayout(scenarioId: string | null | undefined) {
  const sample = scenarioId === 'gate-of-secrets';
  H_ZONES = sample ? SAMPLE_ZONES : HANUKKAH_ZONES;
  H_INTERACTABLES = sample ? SAMPLE_INTERACTABLES : HANUKKAH_INTERACTABLES;
}

/** World position of an interactable. */
export const hWorldPos = (d: HInteractable): [number, number, number] => [d.pos[0], d.pos[1], hCenter(d.zone) + d.pos[2]];

/** Furniture the player cannot walk through: [zone, x0, x1, z0, z1] relative to the room centre. */
const OBSTACLES: [HZone, number, number, number, number][] = [
  ['library', -3.2, 2.2, -2.2, -0.4],
  ['workshop', -2.6, 2.6, -2.2, -0.6],
  ['maze', -2.4, 3.8, -2.7, 0.4],
  ['cipher', -3.0, 3.0, -2.0, -0.2],
  ['dreidels', -1.2, 1.2, -4.6, -2.2], ['dreidels', 1.0, 4.6, -2.2, -0.2], ['dreidels', -3.4, -2.2, -2.2, -1.0],
  ['lab', -3.4, 3.4, -3.2, -1.2], ['lab', 2.0, 4.0, -1.0, 0.2],
  ['mosaic', -1.0, 1.0, -0.8, 0.8],
  ['mosaic', -6.0, -3.2, 1.95, 3.25], ['mosaic', 5.2, 6.4, 2.2, 3.4], ['mosaic', 5.0, 5.8, -0.1, 0.5],
  ['hall', -1.0, 1.0, -2.6, -0.6],
  ['maproom', -2.6, 2.6, -2.3, -0.4], ['maproom', 2.6, 5.4, -4.1, -2.6], ['maproom', -5.1, -3.3, -7.0, -5.8],
  ['maproom', -8.0, -6.3, 0.7, 2.3], ['maproom', 6.5, 8.0, -2.9, -1.1], ['maproom', 5.0, 6.2, 2.0, 3.2],
  ['gearworks', -2.6, 2.6, -2.2, -0.4],
  ['gearworks', 3.0, 4.2, -5.0, -4.2], ['gearworks', 5.2, 6.4, 2.2, 3.4], ['gearworks', -8.0, -6.4, -3.8, -2.2],
];

export function hObstacles(): HRect[] {
  return OBSTACLES.filter(([zone]) => H_ZONES.includes(zone)).map(([zone, x0, x1, z0, z1]) => {
    const c = hCenter(zone);
    return { x0, x1, z0: c + z0, z1: c + z1 };
  });
}
