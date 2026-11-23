// "הצופן הזוגי": the eight old letters of the letter room. Each one is read on the same letter card (one size, centred),
// and the one word in it marked **like this** in the scenario is printed truly bold — never named or labelled.

/** The eight letters of the letters table (cc-letter-s1 … cc-letter-s8). */
export const isLetterItem = (id: string) => id.startsWith('cc-letter-s');

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** The text as safe HTML: everything escaped, then **word** becomes a bold word. */
export function letterHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESC[c]).replace(/\*\*(.+?)\*\*/g, '<b class="bold-word">$1</b>');
}

/** The same text without the marks (for a tooltip or a screen reader label). */
export const plainText = (text: string) => text.replace(/\*\*(.+?)\*\*/g, '$1');

/** The letter card, the same in the backpack note and in the table window. */
export const LETTER_CARD_CSS = `
  .letter-card { box-sizing:border-box; width:100%; min-height:13rem; margin:.4rem 0; padding:1.6rem 1.5rem; display:grid; place-content:center;
    text-align:center; background:#f3e6c6; color:#2a1a0a; border-radius:6px; box-shadow: inset 0 0 0 1px #b08a50, 0 6px 22px rgba(0,0,0,.4);
    font: 1.3rem/1.9 "Frank Ruehl CLM", "David", serif; overflow-wrap:anywhere;
    background-image: radial-gradient(ellipse at 50% 40%, rgba(255,250,235,.55), transparent 70%); }
  .letter-card p { margin:0; }
  .letter-card ::ng-deep .bold-word { font-weight:900; color:#1a0d02; }
`;
