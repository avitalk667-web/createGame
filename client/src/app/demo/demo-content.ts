/**
 * The content of "טעימה מהפורטל" (the free taste): the objects of the locked room and what each one shows when examined.
 * The riddle "הסוד שמאחורי השעון": the letter gives the order (compass → clock → key → letter), each object gives one digit
 * (2, 7, 4, 1). The code itself is checked only on the server.
 */

export type DemoSpotId = 'compass' | 'clock' | 'letter' | 'key' | 'door';
/** The four objects of the riddle (the door is where the code is entered). */
export const DEMO_ITEMS: Exclude<DemoSpotId, 'door'>[] = ['letter', 'compass', 'clock', 'key'];

export interface DemoSpot {
  id: DemoSpotId;
  /** Shown in the prompt: "<verb> <label>". */
  label: string;
  verb: string;
  /** The touch button's word (the noun: "בדיקה", "קריאה"). */
  button: string;
  /** Where the player points or stands to use it (also the centre of its highlight). */
  pos: [number, number, number];
  radius: number;
  /** Where the object itself stands, when it differs from pos. */
  place?: [number, number, number];
  facing?: number;
}

export const DEMO_SPOTS: DemoSpot[] = [
  { id: 'letter', label: 'המכתב המסתורי', verb: 'קריאת', button: 'קריאה', pos: [-0.4, 1.02, -0.8], radius: 0.45, place: [-0.4, 1.005, -0.8] },
  { id: 'compass', label: 'המצפן', verb: 'בדיקת', button: 'בדיקה', pos: [-6.3, 1.08, 2.72], radius: 0.45, place: [-6.3, 1.04, 2.72] },
  { id: 'clock', label: 'שעון הקיר', verb: 'בדיקת', button: 'בדיקה', pos: [4.6, 3.1, -6.6], radius: 0.8, place: [4.6, 3.2, -6.86] },
  { id: 'key', label: 'המפתח העתיק', verb: 'בדיקת', button: 'בדיקה', pos: [5.5, 1.2, 3.55], radius: 0.45, place: [5.5, 1.24, 3.55], facing: 0.6 },
  { id: 'door', label: 'לוח המקשים שליד הדלת', verb: 'פתיחת', button: 'פתיחה', pos: [0.9, 1.5, -6.3], radius: 0.95 },
];

export interface DemoInspect {
  title: string;
  /** Paragraphs under the picture. */
  lines: string[];
  /** Which drawing to show (the digit is only in the drawing, never in title or lines). */
  art: Exclude<DemoSpotId, 'door'>;
}

export const DEMO_INSPECT: Record<Exclude<DemoSpotId, 'door'>, DemoInspect> = {
  letter: {
    title: 'מכתב מסתורי',
    art: 'letter',
    lines: [
      'ארבעה סימנים שמרו על סוד החדר.',
      'התחילו במה שמראה את הדרך,',
      'המשיכו במה שמודד את הזמן,',
      'אחר כך חפשו את מה שפותח מנעולים,',
      'ולבסוף קראו את מה שנשאר כתוב.',
    ],
  },
  compass: {
    title: 'מצפן נחושת',
    art: 'compass',
    lines: ['מצפן ישן מונח על שולחן המפות. המחוג שלו נעצר בנקודה מסוימת. האם יש לכך משמעות?'],
  },
  clock: {
    title: 'שעון הקיר',
    art: 'clock',
    lines: ['שעון עתיק שנעצר מזמן. המחוגים קפאו במקומם. האם השעה שבה נעצר השעון חשובה?'],
  },
  key: {
    title: 'מפתח עתיק',
    art: 'key',
    lines: ['מפתח עתיק וכבד. על גוף המפתח נראית חריטה מסתורית. אולי כדאי להתבונן בה מקרוב.'],
  },
};

/**
 * Under the letter: a mood line only. The digits are never written in any text: each one is seen only in its picture.
 */
export const LETTER_FADED_NOTE = 'מכתב ישן ובו שורות שנמחקו כמעט לחלוטין. נותרו בו סימנים בודדים שאולי יכולים לעזור לכם.';

export const DEMO_HINTS = [
  'המכתב אינו מציג את הקוד עצמו, אלא את הסדר שבו צריך לקרוא את הסימנים.',
  'התחילו במצפן, עברו לשעון, המשיכו למפתח וסיימו במכתב.',
];

export const DEMO_TEXT = {
  wrongCode: 'זה עדיין לא הסוד הנכון. חפשו שוב בין הרמזים.',
  rightCode: 'פתחתם את השער! הצלחתם לפענח את סוד החדר.',
};
