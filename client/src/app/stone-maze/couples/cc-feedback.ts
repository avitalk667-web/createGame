// "הצופן הזוגי": the one look for "placed right" / "placed wrong", shared by every placing puzzle of the game. The frames
// are the pull puzzle's in "סוד פך השמן" (hanukkah/h-panel.component.ts, .ped.right / .ped.wrong) — the same green and
// red — with a ✓ / ✗ mark beside them so colour is never the only sign. A mark appears the moment the server answers the
// action and fades after a moment; the state itself (what lies where) always comes from the server for both players.
import { signal } from '@angular/core';

export type Verdict = 'right' | 'wrong';

export class PlacementFeedback {
  readonly marks = signal<Record<string, Verdict>>({});
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Marks one place (a slot, a socket, a pin) right or wrong for a moment. */
  show(key: string, verdict: Verdict, ms = verdict === 'wrong' ? 1600 : 2200) {
    clearTimeout(this.timers.get(key));
    this.marks.update((m) => ({ ...m, [key]: verdict }));
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key);
      this.marks.update((m) => {
        const next = { ...m };
        delete next[key];
        return next;
      });
    }, ms));
  }

  /** Marks several places at once (a whole arrangement checked together: never one place more than another). */
  showAll(keys: string[], verdict: Verdict) {
    keys.forEach((k) => this.show(k, verdict));
  }

  of(key: string): Verdict | null {
    return this.marks()[key] ?? null;
  }

  dispose() {
    this.timers.forEach(clearTimeout);
    this.timers.clear();
  }
}

/** The frames and marks, for any element given the class fb-right / fb-wrong (and a .fb-mark child for the ✓ / ✗). */
export const FEEDBACK_CSS = `
  .fb-right { border:2px solid #3fbf6a !important; background: rgba(63,191,106,.16) !important; box-shadow: 0 0 12px rgba(63,191,106,.35); }
  .fb-wrong { border:2px solid #e2715b !important; background: rgba(226,113,91,.16) !important; box-shadow: 0 0 12px rgba(226,113,91,.35); animation: fb-shake .35s ease-in-out; }
  .fb-mark { position:absolute; top:-9px; inset-inline-end:-9px; width:22px; height:22px; border-radius:50%; display:grid; place-items:center;
    font-size:.8rem; font-weight:800; color:#fff; box-shadow: 0 2px 6px rgba(0,0,0,.4); }
  .fb-mark.right { background:#3fbf6a; } .fb-mark.wrong { background:#e2715b; }
  .fb-host { position:relative; }
  @keyframes fb-shake { 20% { transform: translateX(-4px); } 40% { transform: translateX(4px); } 60% { transform: translateX(-3px); } 80% { transform: translateX(2px); } }
  @media (prefers-reduced-motion: reduce) { .fb-wrong { animation: none; } }
`;
