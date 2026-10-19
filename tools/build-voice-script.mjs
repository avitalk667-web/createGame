// Builds the Hebrew voice script (spec §16–17): one line = one audio file with a fixed id.
//   client/public/audio/he/voice-script.json  — used by the game for captions and audio playback
//   docs/VOICE_SCRIPT.he.md                   — recording script for the voice actors
// Usage: node tools/build-voice-script.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scenario = JSON.parse(fs.readFileSync(path.join(root, 'server/PortalX.Server/Content/scenarios/last-portal.he.json'), 'utf8'));

const GUARD = 'שומר הפורטל';
const GUIDE = 'יהודה';

const lines = [
  // opening cinematic (timed in play.component.ts INTRO_LINES)
  ['intro_01', GUARD, 'ברוכים הבאים, אורחים צעירים. אני שומר הפורטל, ואני שומר על האחוזה הזאת כבר מאות שנים.'],
  ['intro_02', GUARD, 'בלב האחוזה עומד פורטל עתיק — שער של אור. הלילה, האור שלו מתחיל לדעוך.'],
  ['intro_03', GUARD, 'אם הפורטל ייסגר, הסוד שהוא שומר יאבד לעולם. רק קבוצה שפועלת יחד, בשיתוף ובאמון, יכולה לפתוח אותו מחדש.'],
  ['intro_04', GUARD, 'עליכם לעבור בחדרי האחוזה, לפענח את החידות, לאסוף שלושה חפצים ולגלות את מילת הסוד.'],
  ['intro_05', GUARD, 'זכרו: כל אחד מכם רואה משהו שהאחרים אינם רואים. דברו ושתפו — ויחד תצליחו. השער נפתח... בהצלחה!'],
  ['mission', GUARD, 'המשימה התחילה. היכנסו לספרייה, והקשיבו ליהודה המדריך.'],
  // guide dialogue
  ['guide_01', GUIDE, 'שלום! אני יהודה, ואני מכיר את האחוזה הזאת היטב. כל חדר כאן נעול בחידה, וכל חידה שתפתרו תפתח את הדלת לחדר הבא.'],
  ['guide_02', GUIDE, 'לחצו על חפצים מסומנים כדי לבדוק אותם. חפצים שאפשר לאסוף ייכנסו לתיק המשותף של הקבוצה, וכל אחד מכם יוכל להשתמש בהם.'],
  ['guide_03', GUIDE, 'בכל חידה שתפתרו תקבלו אות זהב. שמרו עליהן — בסוף הדרך הן יפתחו את הפורטל.'],
  ['guide_04', GUIDE, 'ואם נתקעתם — אפשר לבקש רמז. יש שלוש דרגות רמזים, מרמז עדין ועד רמז כמעט מפורש. בהצלחה, ושתפו הרבה!'],
  // zone entries
  ['zone_library', GUIDE, 'זו הספרייה העתיקה. חפשו ספר שנראה שונה מכל השאר, וקלף עם סמלים מוזרים.'],
  ['zone_symbols', GUIDE, 'חדר הסמלים! על הקירות תלויים לוחות אבן. קראו את כולם לפני שאתם מסובבים את המנגנון.'],
  ['zone_echo', GUIDE, 'שמעתם את ההד? זה חדר ההדים. תיבת הנגינה תלמד אתכם את שיר הפעמונים.'],
  ['zone_mirrors', GUIDE, 'חדר המראות. כל אחד מכם יראה במראה משהו אחר. ספרו זה לזה מה אתם רואים!'],
  ['zone_items', GUIDE, 'זה חדר החפצים. בדקו מה יש בתיק המשותף, ומה אפשר לחבר על שולחן העבודה.'],
  ['zone_portal', GUARD, 'הגעתם אל הפורטל. הציבו את אותיות הזהב במקומן — ופתחו את השער.'],
  // items
  ['item_found', GUIDE, 'מצאתם חפץ חדש! הוא נמצא עכשיו בתיק המשותף.'],
  ['item_combined', GUIDE, 'יפה מאוד! חיברתם את החפצים.'],
  // finale
  ['outro_success', GUARD, 'עשיתם זאת! הפורטל נפתח והאור חוזר לזרוח. בזכות שיתוף הפעולה שלכם, הסוד של האחוזה נשמר.'],
  ['outro_02', GUARD, 'זכרו תמיד: כשעובדים יחד, באמונה ובכבוד הדדי — אין דלת שלא נפתחת. תודה לכם, אלופי הפורטל!'],
];

for (const p of scenario.puzzles) {
  lines.push([`${p.id}_success`, GUARD, p.success]);
  lines.push([`${p.id}_fail`, GUARD, p.failure]);
  p.hints.forEach((h, i) => lines.push([`${p.id}_hint${i + 1}`, GUIDE, h]));
}

const out = lines.map(([id, speaker, text]) => ({
  id,
  speaker,
  text,
  file: `audio/he/${id}.mp3`,
  durationMs: Math.round(Math.min(10000, 1500 + text.length * 68)),
}));

const jsonPath = path.join(root, 'client/public/audio/he/voice-script.json');
fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
fs.writeFileSync(jsonPath, JSON.stringify({ language: 'he', lines: out }, null, 2) + '\n');

const md = [
  '# תסריט דיבוב — PORTAL X: הפורטל האחרון',
  '',
  'כל שורה היא קובץ שמע נפרד. שם הקובץ חייב להיות בדיוק כמו המזהה, בפורמט MP3, ולהישמר בתיקייה `client/public/audio/he/`.',
  'הנחיות: עברית תקינה, נקייה ומכבדת. קריינים גברים / נערים בלבד. אין להוסיף מילים שאינן בתסריט. לבדוק ניקוד שמות ומספרים לפני הקלטה.',
  'אחרי הוספת קבצים אין צורך לשנות קוד — המשחק מנגן קובץ קיים ומציג כתוביות תמיד.',
  '',
  '| מזהה (שם קובץ) | דובר | טקסט |',
  '|---|---|---|',
  ...out.map((l) => `| \`${l.id}.mp3\` | ${l.speaker} | ${l.text.replace(/\|/g, '\\|')} |`),
  '',
];
fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
fs.writeFileSync(path.join(root, 'docs/VOICE_SCRIPT.he.md'), md.join('\n'));
console.log(`voice lines: ${out.length}`);
