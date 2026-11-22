import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, HostListener, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AudioService } from '../../../core/audio.service';
import { GameService } from '../../../core/game.service';
import { LetterView } from '../../../core/models';
import { LettersStore } from './letters.store';

const MAX = 4000;

/**
 * The personal letters of "הצופן הזוגי": writing (with the draft kept on this device), the mailbox of letters received,
 * and the soft door before the letter room's puzzles — an offer to write first, never a condition to go on.
 */
@Component({
  selector: 'px-cc-letters',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="overlay" (click)="close.emit()">
      <section class="panel-modal letters" role="dialog" aria-modal="true" [attr.aria-label]="title()" (click)="$event.stopPropagation()">
        <header>
          <h2>{{ title() }}</h2>
          <button class="btn small ghost" (click)="close.emit()" aria-label="סגירה">✕</button>
        </header>

        @if (mode() === 'gate') {
          <p class="lead">לפני החידות של החדר אפשר לכתוב מכתב אישי{{ store.solo() ? ' — לעצמכם, לשמור.' : ' למי שמשחק איתכם. רק הוא יוכל לקרוא אותו.' }}</p>
          <div class="row wrap">
            <button class="btn primary" (click)="writing.set(true)">✍️ כתיבת המכתב</button>
            <button class="btn ghost" (click)="later()">אחר כך — להמשיך לחידה</button>
          </div>
        }

        @if (mode() === 'write' || writing()) {
          @if (store.sent(); as sent) {
            <div class="status">
              <p>✉️ {{ sent.hasRecipient ? 'המכתב שלכם נשלח.' : 'המכתב נשמר אצלכם.' }}</p>
              @if (sent.hasRecipient) {
                <p class="muted small">{{ sent.openedAt ? 'המכתב נפתח ונקרא.' : sent.deliveredAt ? 'המכתב הגיע ומחכה שיפתחו אותו.' : 'המכתב בדרך.' }}</p>
              }
            </div>
            @if (store.kept(); as k) { <ng-container *ngTemplateOutlet="paper; context: { $implicit: k }" /> }
          } @else {
            <p class="muted small">{{ store.solo() ? 'אתם משחקים לבד: המכתב יישמר רק בשבילכם.' : 'המכתב פרטי: הוא נשמר מוצפן ונמסר רק למי שמשחק איתכם. אפשר לכתוב אחד בכל משחק.' }}</p>
            <label class="sheet">
              <span class="sr">המכתב</span>
              <textarea [value]="store.draft()" (input)="store.setDraft($any($event.target).value)" [attr.maxlength]="max" rows="9"
                placeholder="כתבו כאן…" dir="auto"></textarea>
            </label>
            <div class="row between">
              <span class="muted small" [class.warn]="store.draft().length > max - 200">{{ store.draft().length }} / {{ max }}</span>
              <span class="muted small">הטיוטה נשמרת במכשיר הזה עד השליחה.</span>
            </div>
            @if (store.error(); as e) { <p class="msg bad" role="status">{{ e }}</p> }
            <div class="row wrap">
              <button class="btn primary" (click)="send()" [disabled]="!store.draft().trim() || store.sending()">
                {{ store.sending() ? 'שומרים…' : store.solo() ? 'שמירת המכתב' : 'שליחת המכתב' }}</button>
              @if (mode() !== 'gate') { <button class="btn ghost" (click)="close.emit()">אחר כך</button> }
            </div>
          }
          @if (mode() === 'gate' && store.decided()) { <button class="btn" (click)="go.emit()">להמשיך לחידה</button> }
        }

        @if (mode() === 'inbox') {
          @if (reading(); as l) {
            <ng-container *ngTemplateOutlet="paper; context: { $implicit: l }" />
            <button class="btn ghost" (click)="reading.set(null)">חזרה לתיבה</button>
          } @else {
            @for (l of store.inbox(); track l.id) {
              <button class="envelope-row" (click)="read(l)">
                <span aria-hidden="true">{{ l.openedAt ? '📭' : '📩' }}</span>
                <span>מכתב מ{{ l.from }}</span>
                <span class="muted small">{{ l.openedAt ? 'נקרא' : 'חדש' }}{{ l.round > 1 ? ' · משחק ' + l.round : '' }}</span>
              </button>
            } @empty {
              <p class="muted">{{ store.solo() ? 'במשחק לבד לא מגיעים מכתבים — אבל המכתב שכתבתם שמור.' : 'התיבה ריקה. כשיגיע מכתב, הדגל יורם.' }}</p>
            }
            @if (store.kept(); as k) { <h3>המכתב ששמרתם</h3><ng-container *ngTemplateOutlet="paper; context: { $implicit: k }" /> }
          }
        }

        <ng-template #paper let-l>
          <article class="paper" dir="auto">
            <p class="from">{{ l.from ? 'מאת ' + l.from : '' }}</p>
            <p class="body">{{ l.text }}</p>
          </article>
        </ng-template>
      </section>
    </div>
  `,
  styles: [`
    .letters { width: min(640px, calc(100% - 24px)); max-height: calc(100dvh - 32px); overflow:auto; }
    header { display:flex; justify-content:space-between; align-items:center; gap:1rem; }
    h2 { margin:.2rem 0 .6rem; font-family: var(--font-title); color: var(--gold-2); }
    .lead { line-height:1.7; }
    .row { display:flex; gap:.5rem; align-items:center; margin:.5rem 0; } .row.wrap { flex-wrap:wrap; } .row.between { justify-content:space-between; }
    .sheet textarea { width:100%; box-sizing:border-box; min-height:12rem; resize:vertical; background:#f3e6c6; color:#2a1a0a; border:1px solid #b08a50; border-radius:10px;
      padding:.9rem 1rem; font: 1.1rem/1.8 "Frank Ruehl CLM", "David", serif; background-image: repeating-linear-gradient(transparent 0 1.95rem, rgba(120,80,30,.18) 1.95rem 2rem); }
    .sr { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); }
    .muted { color: var(--muted); } .small { font-size:.85rem; } .warn { color:#f0c27a; }
    .msg.bad { color:#f0a08a; }
    .status { border:1px solid #8a6a3a; border-radius:12px; padding:.6rem .9rem; margin-bottom:.6rem; }
    .envelope-row { width:100%; display:flex; gap:.8rem; align-items:center; background:#2a1c10; border:1px solid #8a6a3a; border-radius:12px; padding:.7rem .9rem; margin:.35rem 0; color:inherit; cursor:pointer; text-align:start; }
    .paper { background:#f3e6c6; color:#2a1a0a; border-radius:6px; padding:1.1rem 1.3rem; box-shadow: 0 6px 24px rgba(0,0,0,.4); margin:.6rem 0; }
    .paper .from { margin:0 0 .5rem; font-weight:700; } .paper .body { margin:0; white-space:pre-wrap; font: 1.1rem/1.8 "Frank Ruehl CLM", "David", serif; overflow-wrap:anywhere; }
  `],
  imports: [NgTemplateOutlet],
})
export class CcLettersComponent {
  store = inject(LettersStore);
  private audio = inject(AudioService);
  mode = input<'write' | 'inbox' | 'gate'>('write');
  /** Open on this letter (from the arrival). */
  letter = input<string | undefined>();
  close = output<void>();
  /** The gate: continue to the puzzle the player was going to. */
  go = output<void>();
  writing = signal(false);
  reading = signal<LetterView | null>(null);
  readonly max = MAX;

  title = computed(() => (this.mode() === 'inbox' ? 'תיבת הדואר' : this.store.solo() ? 'מכתב לעצמכם' : 'מכתב אישי'));

  constructor() {
    queueMicrotask(() => {
      const id = this.letter();
      const l = id && this.store.inbox().find((x) => x.id === id);
      if (l) void this.read(l);
    });
  }

  @HostListener('window:keydown', ['$event'])
  onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') this.close.emit();
  }

  async read(l: LetterView) {
    this.reading.set(l);
    if (!l.openedAt) {
      this.audio.sfx('paper');
      await this.store.open(l.id);
    }
  }

  async send() {
    const ok = await this.store.send(this.store.solo());
    if (ok) this.audio.sfx('letter');
  }

  later() {
    this.store.writeLater();
    this.go.emit();
  }
}

/**
 * An envelope that just arrived: it flies in and waits, sealed, until its reader opens it (or puts it away for later).
 * While a puzzle window is open it waits as a small envelope in the corner instead, so it never interrupts.
 */
@Component({
  selector: 'px-cc-arrival',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.arrivals()[0]; as e) {
      @if (compact()) {
        <button class="mini" (click)="openIt.emit(e.id)" [attr.aria-label]="'הגיע מכתב מ' + e.from">📩</button>
      } @else {
        <div class="arrive" role="dialog" aria-modal="true" [attr.aria-label]="'הגיע מכתב מ' + e.from">
          <div class="env" [class.open]="opening()">
            <div class="flap"></div>
            <div class="seal" aria-hidden="true">❦</div>
            <div class="card">מכתב מ{{ e.from }}</div>
          </div>
          <p class="who">הגיע מכתב מ{{ e.from }}</p>
          <div class="row">
            <button class="btn primary" (click)="open(e.id)">פתיחת המכתב</button>
            <button class="btn ghost" (click)="store.arrivalDone(e.id)">אחר כך — הוא יחכה בתיבת הדואר</button>
          </div>
        </div>
      }
    }
  `,
  styles: [`
    .arrive { position:fixed; inset:0; z-index:60; display:grid; place-content:center; justify-items:center; gap:1rem; background:rgba(10,6,4,.72); animation: fade .4s ease; }
    .env { position:relative; width:min(300px, 70vw); aspect-ratio: 3/2; background:#efe0bc; border-radius:6px; box-shadow:0 16px 40px rgba(0,0,0,.55);
      animation: fly 1.2s cubic-bezier(.2,.8,.2,1); overflow:hidden; }
    .flap { position:absolute; inset:0 0 auto 0; height:58%; background:#e2cf9f; clip-path: polygon(0 0, 100% 0, 50% 100%); transform-origin:top; transition: transform .6s ease; z-index:2; }
    .env.open .flap { transform: rotateX(180deg); }
    .seal { position:absolute; top:44%; left:50%; translate:-50% -50%; width:58px; height:58px; border-radius:50%; background:radial-gradient(circle at 35% 35%, #d8443a, #8a1a14);
      color:#ffd8c8; display:grid; place-items:center; font-size:1.7rem; z-index:3; transition: opacity .4s, transform .4s; }
    .env.open .seal { opacity:0; transform: scale(1.6); }
    .card { position:absolute; inset:18% 10% 12%; background:#fbf3de; border-radius:4px; display:grid; place-items:center; color:#3a2410; font-family:"Frank Ruehl CLM","David",serif; font-size:1.2rem;
      transform: translateY(30%); transition: transform .6s .3s ease; }
    .env.open .card { transform: translateY(-18%); z-index:4; }
    .who { margin:0; color:#f4e2b8; font-size:1.2rem; }
    .row { display:flex; gap:.6rem; flex-wrap:wrap; justify-content:center; }
    .mini { position:fixed; top:84px; inset-inline-start:16px; z-index:61; width:52px; height:52px; border-radius:50%; border:2px solid var(--gold-2); background:#2a1c10;
      font-size:1.5rem; cursor:pointer; animation: bob 1.6s ease-in-out infinite; }
    @keyframes fly { from { transform: translate(-60vw, -40vh) rotate(-35deg) scale(.4); opacity:0; } 60% { opacity:1; } to { transform:none; } }
    @keyframes fade { from { opacity:0; } }
    @keyframes bob { 50% { transform: translateY(-5px); } }
    @media (prefers-reduced-motion: reduce) { .env, .arrive, .mini { animation:none; } .flap, .seal, .card { transition:none; } }
  `],
})
export class CcArrivalComponent {
  store = inject(LettersStore);
  private audio = inject(AudioService);
  private game = inject(GameService);
  compact = input(false);
  /** Open the letter (in the mailbox window). */
  openIt = output<string>();
  opening = signal(false);

  constructor() {
    this.game.letter$.pipe(takeUntilDestroyed()).subscribe(() => this.audio.sfx('letter'));
  }

  open(id: string) {
    this.opening.set(true);
    this.audio.sfx('paper');
    setTimeout(() => {
      this.opening.set(false);
      this.openIt.emit(id);
    }, 900);
  }
}
