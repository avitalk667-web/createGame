import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { GameService } from '../../../core/game.service';
import { LetterEnvelope, LetterView, LettersView } from '../../../core/models';

const KEY = 'px-cc-letters:';
/** The letter room's first puzzle: the letter may be written once it is solved (the server holds the same rule). */
export const LETTERS_AFTER = 'cc5-order';
/** A letter is a few words that stay (the server holds the same limit). */
export const MAX_WORDS = 20;

/** Words as the writer sees them: runs of non-space characters. */
export const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length;

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(KEY + key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(KEY + key);
    else localStorage.setItem(KEY + key, JSON.stringify(value));
  } catch { /* storage may be blocked: the letter still goes to the server */ }
}

/**
 * The personal letters of "הצופן הזוגי" on this screen. The server keeps every letter; this keeps only conveniences in
 * the browser: the unsent draft (with the id that makes a resend the same letter), whether this player chose to write
 * later, and which envelopes already played their arrival. Everything is fetched again after every reconnection.
 */
@Injectable()
export class LettersStore {
  private game = inject(GameService);

  readonly view = signal<LettersView | null>(null);
  readonly draft = signal('');
  readonly sending = signal(false);
  readonly error = signal<string | null>(null);
  /** Envelopes waiting for their arrival animation (shown once per letter on this device). */
  readonly arrivals = signal<LetterEnvelope[]>([]);
  readonly later = signal(false);

  readonly active = computed(() => this.game.snapshot()?.scenarioId === 'couples-cipher' && this.game.snapshot()?.phase === 'playing');
  private scope = computed(() => {
    const s = this.game.snapshot();
    return s && this.game.playerId() ? `${s.roomId}:${this.game.playerId()}:${s.round}` : null;
  });
  /** The desk opens once the letter room's first puzzle is solved. */
  readonly unlocked = computed(() => this.active() && this.game.snapshot()?.puzzles.find((p) => p.id === LETTERS_AFTER)?.status === 'solved');
  readonly sent = computed(() => this.view()?.sent ?? null);
  readonly inbox = computed<LetterView[]>(() => this.view()?.inbox ?? []);
  readonly kept = computed(() => this.view()?.kept ?? null);
  readonly solo = computed(() => !!this.view()?.solo);
  readonly unread = computed(() => this.inbox().filter((l) => !l.openedAt).length);
  /** Written (sent or kept) or set aside for later: the room's puzzles no longer offer the letter first. */
  readonly decided = computed(() => !!this.sent() || this.later());

  constructor() {
    // load on every (re)connection while playing this game, and whenever the round changes
    effect(() => {
      this.game.handshakes();
      const scope = this.scope();
      if (!this.active() || !scope) return;
      untracked(() => {
        this.draft.set(read<{ text: string }>('draft:' + scope, { text: '' }).text);
        this.later.set(read('later:' + scope, false));
        void this.refresh();
      });
    });
    const subs = [
      this.game.letter$.subscribe((e) => {
        void this.game.letterSeen(e.id);
        this.queueArrival(e);
        void this.refresh();
      }),
      this.game.letterOpened$.subscribe(() => void this.refresh()),
    ];
    inject(DestroyRef).onDestroy(() => subs.forEach((s) => s.unsubscribe()));
  }

  async refresh() {
    const r = await this.game.getMyLetters();
    if (!r.ok || !r.data) return;
    const v: LettersView = { inbox: r.data.inbox ?? [], sent: r.data.sent ?? null, kept: r.data.kept ?? null, solo: !!r.data.solo };
    this.view.set(v);
    // a letter that arrived while away plays its arrival once, when the player is back
    for (const l of v.inbox) if (!l.openedAt) this.queueArrival(l);
  }

  private queueArrival(e: LetterEnvelope) {
    const seen = read<string[]>('arrived', []);
    if (seen.includes(e.id) || this.arrivals().some((a) => a.id === e.id)) return;
    this.arrivals.update((a) => [...a, { id: e.id, from: e.from, createdAt: e.createdAt, openedAt: e.openedAt, round: e.round }]);
  }

  /** The arrival was shown (opened or put away): it never plays again on this device. */
  arrivalDone(id: string) {
    write('arrived', [...read<string[]>('arrived', []).filter((x) => x !== id).slice(-50), id]);
    this.arrivals.update((a) => a.filter((x) => x.id !== id));
  }

  setDraft(text: string) {
    this.draft.set(text);
    const scope = this.scope();
    if (!scope) return;
    const prev = read<{ text: string; id?: string }>('draft:' + scope, { text: '' });
    write('draft:' + scope, { text, id: prev.id });
  }

  writeLater() {
    this.later.set(true);
    const scope = this.scope();
    if (scope) write('later:' + scope, true);
  }

  /** Sends (or, alone, keeps) the letter. The same draft keeps its id, so a retry after a lost answer is one letter. */
  async send(keepAlone: boolean): Promise<boolean> {
    const scope = this.scope();
    const text = this.draft().trim();
    if (!scope || !text || this.sending()) return false;
    this.sending.set(true);
    this.error.set(null);
    try {
      const saved = read<{ text: string; id?: string }>('draft:' + scope, { text });
      const id = saved.id ?? `l-${crypto.getRandomValues(new Uint32Array(3)).join('-')}`;
      write('draft:' + scope, { text, id });
      const r = await this.game.sendLetter(id, text, keepAlone);
      if (!r.ok) {
        this.error.set(r.message);
        return false;
      }
      write('draft:' + scope, null);
      this.draft.set('');
      await this.refresh();
      return true;
    } finally {
      this.sending.set(false);
    }
  }

  async open(id: string) {
    const r = await this.game.openLetter(id);
    if (r.ok) {
      this.view.update((v) => v && { ...v, inbox: v.inbox.map((l) => (l.id === id && !l.openedAt ? { ...l, openedAt: new Date().toISOString() } : l)) });
      this.arrivalDone(id);
    }
    return r.ok;
  }
}
