// "הצופן הזוגי": the six rooms in a row along -Z (the same grid as the other room-by-room games, sm-layout.ts), the
// objects that can be used in each, and the furniture the players cannot walk through. The 3D world uses its own
// coordinates; RTL applies only to the UI. Every puzzle object opens the couples panel ('couples', ref = puzzle id).
import type { HInteractable } from '../sm-layout';

export const COUPLES_ZONES = ['cc-sounds', 'cc-partnership', 'cc-trust', 'cc-letters', 'cc-home'] as const;
export type CcZone = (typeof COUPLES_ZONES)[number];

type Row = Omit<HInteractable, 'zone'>;
const P = (id: string, ref: string, label: string, verb: HInteractable['verb'], pos: [number, number, number], radius: number, needs?: string): Row =>
  ({ id, label, verb, kind: 'panel', panel: 'couples', ref, pos, radius, needs });
const C = (id: string, clueId: string, label: string, pos: [number, number, number], radius: number, needs?: string): Row =>
  ({ id, label, verb: 'קריאה', kind: 'clue', clueId, pos, radius, needs });
/** A control in the room that acts at once on a puzzle (no window): the server checks every action. */
const O = (id: string, ref: string, label: string, verb: HInteractable['verb'], op: Record<string, unknown>, pos: [number, number, number], radius: number): Row =>
  ({ id, label, verb, kind: 'panel', panel: 'cc-op', ref, op, pos, radius });
const D = (id: string, label: string, text: string, pos: [number, number, number], radius: number, verb: HInteractable['verb'] = 'בדיקה'): Row =>
  ({ id, label, verb, kind: 'decor', text, pos, radius });

/**
 * A safe already opened shows what it holds, never its lock again: the note inside (a clue), or a line when it is empty.
 * When it opens, the camera turns to it (cam → look, room coordinates) and the note opens by itself for both players.
 */
export const CC_OPENED: Record<string, { clue?: string; text?: string; cam: [number, number, number]; look: [number, number, number] }> = {
  'cc3-safe-a': { clue: 'cc3-note-a', cam: [2.6, 1.6, -4.4], look: [2.6, 1.05, -6.1] },
  'cc3-safe-b': { clue: 'cc3-note-b', cam: [4.0, 1.6, -4.4], look: [4.0, 1.05, -6.1] },
  'cc3-safe-c': { text: 'הכספת השלישית פתוחה. מה שהיה בה כבר בתיק.', cam: [5.4, 1.6, -4.4], look: [5.4, 1.05, -6.1] },
};

const ROOMS: Record<CcZone, Row[]> = {
  // 1 · חדר הצלילים — the sound device, the bells, the symbols board, the broken clock, the paintings and the music box
  'cc-sounds': [
    P('cc1-device', 'cc1-listen', 'מכשיר הצלילים', 'הפעלה', [0, 1.25, -1.3], 0.9),
    C('cc1-bells', 'cc1-bells', 'מתלה הפעמונים', [-6.9, 1.7, -1.6], 1.2),
    C('cc1-symbols', 'cc1-symbols-board', 'לוח הסמלים', [7.7, 2.1, -1.4], 1.1),
    P('cc1-clock', 'cc1-clock', 'השעון המקולקל', 'סיבוב', [-3.6, 2.7, -6.7], 1.1),
    C('cc1-clock-note', 'cc1-clock-note', 'פתק ליד השעון', [-2.2, 1.45, -6.75], 0.4),
    C('cc1-paintings', 'cc1-paintings', 'שלושה ציורים', [7.7, 2.4, 3.0], 1.5),
    // "הצליל החסר" (cc1-missing) is retired: the music box stays in the room as a closed keepsake, with no puzzle
    D('cc1-music-box', 'תיבת נגינה', 'תיבת נגינה ישנה וסגורה. היא לא חלק מהחידה.', [3.6, 1.12, -1.9], 0.55),
    D('cc1-piano', 'פסנתר ישן', 'פסנתר זקוף ישן. כמה קלידים חסרים — הוא לא חלק מהחידה.', [-5.6, 1.1, 4.4], 1.0),
    D('cc1-cello', 'צ׳לו', 'צ׳לו נשען על הקיר. המיתרים רפויים.', [5.9, 1.0, 5.2], 0.6),
  ],
  // 2 · חדר שיתוף הפעולה — the swaying bridge and its two lever stations, the gears table, the ball track
  'cc-partnership': [
    // the bridge has no window: each half is worked at its own station — one green lever (▲ raises the end of the half,
    // ▼ lowers it), a brass bolt that locks the half, and a gauge — and the plunger by the start platform releases the ball
    O('cc2-up-left', 'cc2-bridge', 'ידית ירוקה ▲ — הרמת הקצה של החצי השמאלי', 'משיכה', { op: 'tilt', side: 0, dir: 1 }, [-4.06, 1.2, -0.45], 0.15),
    O('cc2-down-left', 'cc2-bridge', 'ידית ירוקה ▼ — הורדת הקצה של החצי השמאלי', 'משיכה', { op: 'tilt', side: 0, dir: -1 }, [-3.74, 1.2, -0.45], 0.15),
    O('cc2-latch-left', 'cc2-bridge', 'בריח החצי השמאלי — נעילה או שחרור', 'הפעלה', { op: 'latch', side: 0 }, [-3.37, 1.1, -0.45], 0.17),
    O('cc2-up-right', 'cc2-bridge', 'ידית ירוקה ▲ — הרמת הקצה של החצי הימני', 'משיכה', { op: 'tilt', side: 1, dir: -1 }, [3.34, 1.2, -0.45], 0.15),
    O('cc2-down-right', 'cc2-bridge', 'ידית ירוקה ▼ — הורדת הקצה של החצי הימני', 'משיכה', { op: 'tilt', side: 1, dir: 1 }, [3.66, 1.2, -0.45], 0.15),
    O('cc2-latch-right', 'cc2-bridge', 'בריח החצי הימני — נעילה או שחרור', 'הפעלה', { op: 'latch', side: 1 }, [4.03, 1.1, -0.45], 0.17),
    O('cc2-release', 'cc2-bridge', 'כפתור שחרור הכדור', 'הפעלה', { op: 'release' }, [-4.6, 1.05, -2.5], 0.3),
    C('cc2-bridge-plate', 'cc2-bridge-plate', 'לוחית הגשר', [0, 0.9, -0.2], 0.45),
    P('cc2-gear-table', 'cc2-gears', 'שולחן גלגלי השיניים', 'הנחה', [-5.4, 1.05, 3.4], 1.1),
    C('cc2-blueprint', 'cc2-blueprint', 'השרטוט החלקי', [-7.75, 2.4, 1.4], 1.0),
    P('cc2-track', 'cc2-track', 'לוח מסילת הכדור', 'סיבוב', [7.6, 2.2, 2.4], 1.4),
    C('cc2-track-plate', 'cc2-track-plate', 'לוחית המסילה', [6.9, 1.05, 4.7], 0.4),
    D('cc2-tools', 'ארגז כלים', 'פטישים, מפתחות ברגים ושמן מכונות. רק כלים.', [5.6, 0.45, -5.8], 0.7),
  ],
  // 3 · חדר האמון — the key board, the document cabinet, the archive desk, the drawers and the three safes
  'cc-trust': [
    P('cc3-keyboard', 'cc3-key', 'לוח הקטיפה ושמונת המפתחות', 'בדיקה', [-7.7, 1.8, -1.2], 1.2),
    C('cc3-lock-plate', 'cc3-lock-plate', 'לוחית המנעול של ארון המסמכים', [-4.2, 1.35, -6.55], 0.45),
    C('cc3-card', 'cc3-card', 'כרטיס בארכיון', [5.4, 1.06, 4.1], 0.4),
    C('cc3-magnifier', 'cc3-magnifier', 'זכוכית מגדלת', [-1.8, 1.04, -0.85], 0.35),
    C('cc3-depth', 'cc3-depth', 'פתק השרברב', [-6.9, 0.85, 2.2], 0.4),
    P('cc3-docs', 'cc3-documents', 'מנעול ארון המסמכים', 'פתיחה', [-4.2, 1.0, -6.4], 0.7, 'cc3-documents'),
    C('cc3-doc-214', 'cc3-doc-214', 'מסמך 214', [-1.05, 1.03, -1.55], 0.3, 'cc3-documents'),
    C('cc3-doc-357', 'cc3-doc-357', 'מסמך 357', [-0.35, 1.03, -1.55], 0.3, 'cc3-documents'),
    C('cc3-doc-489', 'cc3-doc-489', 'מסמך 489', [0.35, 1.03, -1.55], 0.3, 'cc3-documents'),
    C('cc3-doc-562', 'cc3-doc-562', 'מסמך 562', [1.05, 1.03, -1.55], 0.3, 'cc3-documents'),
    C('cc3-record', 'cc3-record', 'הרישום המקורי', [-5.0, 1.55, -6.6], 0.4, 'cc3-documents'),
    C('cc3-board', 'cc3-board', 'לוח האירועים', [7.7, 2.3, -2.6], 1.0, 'cc3-documents'),
    C('cc3-diary', 'cc3-diary', 'יומן התאריכים', [1.9, 1.04, -0.9], 0.35, 'cc3-documents'),
    C('cc3-drawers', 'cc3-drawers', 'ארון תשע המגירות', [7.6, 1.3, 1.6], 1.0, 'cc3-safe-a'),
    P('cc3-safe-a', 'cc3-safe-a', 'הכספת הראשונה', 'פתיחה', [2.6, 1.0, -6.35], 0.55),
    P('cc3-safe-b', 'cc3-safe-b', 'הכספת השנייה', 'פתיחה', [4.0, 1.0, -6.35], 0.55),
    P('cc3-safe-c', 'cc3-safe-c', 'הכספת השלישית', 'פתיחה', [5.4, 1.0, -6.35], 0.55),
    C('cc3-note-a', 'cc3-note-a', 'הפתק בכספת הראשונה', [2.6, 1.05, -6.05], 0.42, 'cc3-safe-b'),
    C('cc3-note-b', 'cc3-note-b', 'הפתק בכספת השנייה', [4.0, 1.05, -6.05], 0.42, 'cc3-safe-c'),
    D('cc3-files', 'קלסרים ישנים', 'קלסרים מאובקים של חשבונות ישנים. שום דבר על אבן הפינה.', [-6.8, 2.4, 4.4], 0.9),
  ],
  // 5 · חדר המכתבים — the writing desk and the mailbox (personal letters), the letters table, the drawers and the stamps
  'cc-letters': [
    { id: 'cc5-desk', label: 'שולחן הכתיבה — מכתב אישי', verb: 'הנחה', kind: 'panel', panel: 'letters', ref: 'write', pos: [-5.2, 1.05, 3.4], radius: 1.0 },
    { id: 'cc5-mailbox', label: 'תיבת הדואר', verb: 'פתיחה', kind: 'panel', panel: 'letters', ref: 'inbox', pos: [-7.7, 1.5, 0.9], radius: 0.8 },
    C('cc5-events', 'cc5-events', 'לוח האירועים', [-7.75, 2.3, -2.6], 1.1),
    P('cc5-table', 'cc5-order', 'שולחן שמונת המכתבים', 'הנחה', [-3.8, 1.05, -2.2], 1.1),
    C('cc5-first-letter', 'cc5-first-letter', 'סוף המכתב הראשון', [-2.9, 1.04, -1.75], 0.3, 'cc5-keywords'),
    C('cc5-ledger', 'cc5-ledger', 'ספר הרישום', [3.0, 1.25, -1.0], 0.45),
    C('cc5-stamp-rule', 'cc5-stamp-rule', 'דף בספר הרישום', [3.45, 1.25, -1.45], 0.3, 'cc5-stamp'),
    C('cc5-drawers', 'cc5-drawers', 'קיר המגירות', [7.75, 2.2, -1.2], 1.2),
    P('cc5-drawer-lock', 'cc5-keywords', 'מנעול קיר המגירות', 'פתיחה', [6.9, 1.2, 1.1], 0.5),
    P('cc5-stamps', 'cc5-stamp', 'מעמד החותמות והתיבה', 'הנחה', [4.6, 1.05, 3.6], 0.9),
    D('cc5-pigeon', 'תאי דואר', 'עשרות תאים קטנים, רובם ריקים. רק תיבת הדואר שליד הדלת פעילה.', [-7.8, 2.8, 4.6], 0.9),
  ],
  // 5 · הבית שבנינו — the house on the building table with its last wall, the plan of that wall and the shelf of stones
  'cc-home': [
    P('cc6-table', 'cc6-wall', 'הקיר האחרון', 'הנחה', [0, 1.4, -0.85], 1.4),
    C('cc6-plan', 'cc6-plan', 'תוכנית הקיר האחרון', [-7.75, 2.3, -1.2], 1.1),
    D('cc6-shelf', 'מדף האבנים', 'על המדף מונחות חמש אבני בנייה, ועל כל אחת חרוט סמל. מניחים אותן בקיר האחרון שעל שולחן הבנייה.', [7.6, 1.6, -1.4], 1.2),
  ],
};

export const COUPLES_INTERACTABLES: HInteractable[] = COUPLES_ZONES.flatMap((zone) => ROOMS[zone].map((d) => ({ ...d, zone }) as HInteractable));

/** Furniture the player cannot walk through: [zone, x0, x1, z0, z1] relative to the room centre. */
export const COUPLES_OBSTACLES: [CcZone, number, number, number, number][] = [
  ['cc-sounds', -1.2, 1.2, -2.3, -0.3], ['cc-sounds', 2.4, 4.4, -2.5, -1.3], ['cc-sounds', -7.4, -6.3, -3.0, -0.2], ['cc-sounds', -6.8, -4.4, 3.9, 5.0],
  ['cc-partnership', -3.0, 3.0, -3.4, -1.6], ['cc-partnership', -4.2, -3.2, -1.1, -0.1], ['cc-partnership', 3.2, 4.2, -1.1, -0.1],
  ['cc-partnership', -6.6, -4.2, 2.7, 4.1], ['cc-partnership', 6.4, 7.4, 4.2, 5.2],
  ['cc-trust', -2.2, 2.6, -2.0, -0.4], ['cc-trust', -5.4, -3.0, -7.0, -5.8], ['cc-trust', 1.9, 6.1, -7.0, -5.9], ['cc-trust', 6.9, 8.0, 0.6, 2.6], ['cc-trust', 4.4, 6.2, 3.6, 4.6],
  ['cc-letters', -6.4, -4.0, 2.8, 4.0], ['cc-letters', -5.0, -2.6, -2.8, -1.6], ['cc-letters', 2.5, 3.9, -1.8, -0.4], ['cc-letters', 3.9, 5.3, 3.0, 4.2],
  ['cc-partnership', -4.85, -4.35, -2.75, -2.25],
  ['cc-home', -2.0, 2.0, -2.8, 0.0], ['cc-home', 7.0, 8.0, -3.4, 0.6],
  // the dressing (cc-dress.ts): free-standing furniture and the bigger wall pieces
  ['cc-sounds', 3.1, 4.1, 3.9, 4.9], ['cc-sounds', 4.0, 4.8, 4.9, 5.7], ['cc-sounds', -4.15, -3.65, 5.85, 6.35], ['cc-sounds', -8.0, -7.4, 0.7, 3.1], ['cc-sounds', 3.6, 5.8, -7.0, -6.25],
  ['cc-partnership', -3.25, 3.25, -3.4, -1.6], ['cc-partnership', -3.95, -3.55, -3.95, -3.45], ['cc-partnership', 3.55, 3.95, -3.95, -3.45],
  ['cc-partnership', -8.0, -6.75, 4.35, 6.85], ['cc-partnership', -5.6, -3.2, 5.9, 7.0], ['cc-partnership', 6.55, 7.45, -6.55, -5.65], ['cc-partnership', 6.1, 6.9, -5.3, -4.5], ['cc-partnership', 3.6, 6.0, 6.2, 7.0],
  ['cc-trust', 2.4, 3.4, 0.4, 1.4], ['cc-trust', 3.45, 3.95, 0.05, 0.55], ['cc-trust', -6.0, -5.2, -5.0, -4.2], ['cc-trust', 6.9, 8.0, 2.6, 3.9], ['cc-trust', -8.0, -7.2, 3.5, 7.0], ['cc-trust', 7.2, 8.0, 3.9, 5.7], ['cc-trust', -6.1, -3.1, 6.1, 7.0], ['cc-trust', 3.1, 6.1, 6.1, 7.0],
  ['cc-letters', 5.4, 6.2, 5.0, 6.2], ['cc-letters', 4.7, 5.3, 5.3, 5.9], ['cc-letters', -3.4, -2.4, 5.1, 6.1], ['cc-letters', -7.25, -6.75, 5.85, 6.35], ['cc-letters', -5.7, -2.7, -7.0, -6.2], ['cc-letters', 2.5, 5.5, -7.0, -6.25],
  ['cc-home', -2.95, -2.65, -3.65, -3.35], ['cc-home', 2.65, 2.95, -3.65, -3.35], ['cc-home', -7.0, -4.2, -7.0, -5.7], ['cc-home', 4.2, 7.0, -7.0, -5.7],
  ['cc-home', -8.0, -7.3, 2.4, 5.0], ['cc-home', 5.3, 7.9, 2.7, 3.3], ['cc-home', 5.9, 6.9, 5.2, 6.0], ['cc-home', 3.2, 5.6, 2.1, 2.9], ['cc-home', 3.1, 6.1, 6.2, 7.0],
];
