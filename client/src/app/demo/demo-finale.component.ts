import { AfterViewInit, ChangeDetectionStrategy, Component, NgZone, OnDestroy, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AudioService } from '../core/audio.service';
import { Product, formatPreviousPrice, formatPrice, playersLabel } from '../core/models';
import { demoTrack } from './demo.api';
import { DemoFinale, FinaleCard } from './demo-finale';
import { DemoWorld } from './demo-world';

/**
 * The end of "טעימה מהפורטל" (/demo) only: once the server recorded the right code and the door opened, the doorway wakes
 * up as a portal and the games the taste's coupon is good for come out of it as floating 3D cards (DemoFinale, in the
 * taste room's own scene). This component starts it, hands it the games, reports the steps to the taste's own funnel and
 * shows the words around the cards. The coupon screen of the taste stays one click away. Nothing outside /demo uses it.
 */
@Component({
  selector: 'px-demo-finale',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    @if (!ready()) { <div class="letterbox top"></div><div class="letterbox bottom"></div> }

    <header class="bar" [class.shown]="seconds() > 4.5 || ready()">
      <div class="won">
        <b class="gold-title">פתחתם את השער!</b>
        <span>הטעימה הושלמה</span>
      </div>
      <div class="bar-actions">
        <button class="btn small primary gift" (click)="gift.emit()">🎁 @if (discount(); as d) { <bdi>{{ d }}%</bdi> הנחה — } ההטבה שלכם</button>
        <a class="btn small ghost" routerLink="/">יציאה</a>
      </div>
    </header>

    @if (ready()) {
      @if (focused() === null && !explored()) {
        <section class="message" aria-labelledby="finale-title">
          <h2 id="finale-title" class="gold-title">ההרפתקאות מחכות לכם מעבר לדלת...</h2>
          <p class="sub">פתחתם את הפורטל. עכשיו הגיע הזמן לגלות עולמות חדשים!</p>
          <p>בחרו את ההרפתקה הבאה שלכם, אספו את החברים וצאו למשחק שלא תשכחו.</p>
          <div class="row">
            @if (cards().length) { <button class="btn primary" (click)="explore()">גלו את המשחק הבא שלכם</button> }
            <a class="btn ghost" routerLink="/" fragment="games">לכל המשחקים</a>
          </div>
        </section>
      }

      @if (cards().length > 1) {
        @if (canScroll(-1) || canScroll(1)) {
          <button class="nav prev" (click)="scroll(-1)" [disabled]="!canScroll(-1)" aria-label="המשחק הקודם">›</button>
          <button class="nav next" (click)="scroll(1)" [disabled]="!canScroll(1)" aria-label="המשחק הבא">‹</button>
        }
        <nav class="dots" aria-label="המשחקים שיצאו מהפורטל">
          @for (c of cards(); track c.id; let i = $index) {
            <button class="dot" [class.on]="i === (focused() ?? position())" (click)="pick(i)" [attr.aria-label]="c.name"
              [attr.aria-pressed]="i === focused()"></button>
          }
        </nav>
      }

      @if (focusedProduct(); as p) {
        <section class="details" role="dialog" aria-modal="false" [attr.aria-label]="p.name">
          <button class="close btn small ghost" (click)="pick(null)" aria-label="חזרה לכל הכרטיסים">✕</button>
          <h2 class="gold-title">{{ p.name }}</h2>
          <p class="tag">{{ p.tagline }}</p>
          <p class="desc">{{ p.description }}</p>
          <p class="meta">{{ playersOf(p) }}</p>
          <p class="price">
            @if (price(p); as pr) { <b>{{ pr }}</b> }
            @if (previous(p); as prev) { <s aria-label="מחיר קודם">{{ prev }}</s> }
          </p>
          @if (discount(); as d) { <p class="coupon-note">🎁 הקופון האישי שלכם ({{ d }}% הנחה) ימולא אוטומטית בעמוד המשחק.</p> }
          <div class="row">
            <button class="btn primary big" (click)="open(p)" [disabled]="leaving()">אני רוצה לשחק!</button>
            <a class="btn ghost" routerLink="/" fragment="games">לכל המשחקים</a>
          </div>
        </section>
      }

      @if (!cards().length && products()) {
        <p class="none" role="status">המשחקים הבאים בדרך — בינתיים אפשר להציץ בכל המשחקים באתר.</p>
      }
    }
  `,
  styles: [`
    :host { position: fixed; inset: 0; z-index: 20; pointer-events: none; direction: rtl; }
    :host > * { pointer-events: auto; }
    .letterbox { position: fixed; inset-inline: 0; height: 9vh; background: #000; pointer-events: none; animation: fade .6s ease both; }
    .letterbox.top { top: 0 } .letterbox.bottom { bottom: 0 }
    .bar { position: fixed; top: max(10px, env(safe-area-inset-top)); inset-inline: 10px; display: flex; align-items: center; justify-content: space-between; gap: .8rem; flex-wrap: wrap;
      padding: .45rem .6rem .45rem 1rem; border-radius: 999px; background: rgba(8,12,30,.72); border: 1px solid rgba(246,215,141,.45);
      backdrop-filter: blur(6px); box-shadow: 0 6px 24px rgba(0,0,0,.45); z-index: 3; }
    .won { display: flex; align-items: baseline; gap: .7rem; opacity: 0; transition: opacity 1.2s ease; min-width: 0; }
    .bar.shown .won { opacity: 1; }
    .won b { font-size: 1.5rem; } .won span { color: var(--text); font-size: .95rem; }
    .bar-actions { display: flex; gap: .4rem; align-items: center; }
    .message { position: fixed; bottom: max(14px, env(safe-area-inset-bottom)); left: 0; right: 0; margin-inline: auto; width: min(640px, calc(100% - 32px)); text-align: center;
      background: linear-gradient(180deg, rgba(14,20,48,.88), rgba(8,10,26,.94)); border: 1px solid rgba(246,215,141,.55); border-radius: 18px;
      padding: .75rem 1.1rem .85rem; box-shadow: 0 0 40px rgba(80,160,255,.25), var(--shadow); animation: rise .8s cubic-bezier(.2,.9,.3,1) both; }
    .message h2 { margin: 0 0 .2rem; font-size: clamp(1.3rem, 3.2vw, 1.9rem); }
    .message p { margin: .1rem 0; line-height: 1.45; } .message .sub { color: #bfe3ff; font-weight: 700; }
    .row { display: flex; gap: .5rem; justify-content: center; flex-wrap: wrap; margin-top: .55rem; }
    .nav { position: fixed; top: calc(50% - 23px); z-index: 1; width: 46px; height: 46px; border-radius: 50%; border: 1px solid rgba(246,215,141,.6); background: rgba(8,12,30,.7); color: var(--gold-2);
      font-size: 1.8rem; line-height: 1; cursor: pointer; font-family: inherit; }
    .nav.prev { right: 10px; } .nav.next { left: 10px; }
    .nav:disabled { opacity: .25; cursor: default; }
    .nav:focus-visible, .dot:focus-visible { outline: 2px solid var(--gold-2); outline-offset: 3px; }
    .dots { position: fixed; top: calc(max(10px, env(safe-area-inset-top)) + 58px); left: 0; right: 0; margin-inline: auto; width: fit-content; display: flex; gap: .4rem; padding: .3rem .5rem;
      border-radius: 999px; background: rgba(8,12,30,.55); }
    .dot { width: 10px; height: 10px; border-radius: 50%; border: 1px solid var(--gold-2); background: transparent; padding: 0; cursor: pointer; }
    .dot.on { background: var(--gold-2); box-shadow: 0 0 8px rgba(246,215,141,.8); }
    .details { position: fixed; top: 50%; left: 4vw; transform: translateY(-50%); width: min(400px, 40vw); max-height: calc(100% - 140px); overflow: auto;
      background: linear-gradient(180deg, rgba(20,16,6,.92), rgba(10,14,34,.95)); border: 2px solid var(--gold-2); border-radius: 18px;
      padding: 1rem 1.2rem; box-shadow: 0 0 50px rgba(224,185,92,.35), var(--shadow); animation: slide .45s ease both; z-index: 2; }
    .details h2 { margin: 0 2rem .2rem 0; font-size: clamp(1.4rem, 3vw, 2rem); }
    .details .tag { color: #bfe3ff; font-weight: 700; margin: .2rem 0; }
    .details .desc { margin: .3rem 0; line-height: 1.55; display: -webkit-box; -webkit-line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden; }
    .details .meta { color: var(--muted); font-size: .9rem; margin: .2rem 0; }
    .details .price { display: flex; gap: .7rem; align-items: baseline; margin: .4rem 0; }
    .details .price b { font-size: 1.8rem; } .details .price s { color: var(--muted); font-size: 1.1rem; }
    .details .coupon-note { color: var(--gold-2); font-size: .9rem; margin: .2rem 0 .4rem; }
    .details .close { position: absolute; top: 8px; inset-inline-end: 8px; }
    .details .row { justify-content: flex-start; }
    .btn.big { font-size: 1.15rem; padding: .7em 1.4em; }
    .none { position: fixed; bottom: 18px; left: 0; right: 0; margin-inline: auto; width: fit-content; max-width: calc(100% - 32px);
      background: rgba(8,12,30,.8); border: 1px solid var(--line); border-radius: 12px; padding: .5rem 1rem; }
    @keyframes rise { from { opacity: 0; transform: translateY(24px) } to { opacity: 1; transform: none } }
    @keyframes slide { from { opacity: 0; transform: translate(-16px, -50%) } to { opacity: 1; transform: translateY(-50%) } }
    @keyframes fade { from { opacity: 0 } }
    @media (max-width: 760px), (max-aspect-ratio: 1/1) {
      .bar { border-radius: 14px; padding: .4rem .6rem; }
      .won b { font-size: 1.15rem; } .won span { display: none; }
      .details { top: auto; bottom: 10px; left: 10px; right: 10px; transform: none; width: auto; max-height: 48vh; animation: rise .4s ease both; }
      .details .desc { -webkit-line-clamp: 3; }
      .nav { top: 38%; }
      .dots { top: calc(max(10px, env(safe-area-inset-top)) + 100px); }
      .message { bottom: 10px; padding: .6rem .8rem .7rem; }
      .message h2 { font-size: 1.2rem; }
      .message p { font-size: .86rem; line-height: 1.35; }
      .message .row { flex-wrap: nowrap; } .message .btn { padding: .55em .9em; font-size: .9rem; }
    }
    @media (prefers-reduced-motion: reduce) { .message, .details, .letterbox { animation: none; } .won { transition: none; } }
  `],
})
export class DemoFinaleComponent implements AfterViewInit, OnDestroy {
  world = input.required<DemoWorld>();
  /** The games to show (the page's list: on sale and good for the coupon); null while it loads. */
  products = input<Product[] | null>(null);
  /** Shown as it is after the animation: a player returning to a taste already solved (a refresh or a later visit). */
  settled = input(false);
  /** The coupon's discount, when there is an active one. */
  discount = input<number | null>(null);
  /** A game was chosen: the page passes the coupon on and opens the game's own page. */
  chosen = output<Product>();
  /** The coupon screen of the taste. */
  gift = output<void>();

  private audio = inject(AudioService);
  private zone = inject(NgZone);
  private finale?: DemoFinale;
  private shown: Product[] = [];
  private started = performance.now();
  private timer?: ReturnType<typeof setInterval>;

  seconds = signal(0);
  ready = signal(false);
  explored = signal(false);
  leaving = signal(false);
  cards = signal<FinaleCard[]>([]);
  focused = signal<number | null>(null);
  position = signal(0);
  private list = signal<Product[]>([]);
  focusedProduct = computed(() => {
    const i = this.focused();
    return i == null ? null : this.list()[i] ?? null;
  });

  price = formatPrice;
  previous = formatPreviousPrice;
  playersOf = playersLabel;

  constructor() {
    // the games arrive after the coupon (the list is narrowed to what it is good for); the cards come out once they are in
    effect(() => {
      const list = this.products();
      if (list) untracked(() => this.setGames(list));
    });
  }

  ngAfterViewInit() {
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const settled = this.settled();
    const run = <T>(f: () => T) => this.zone.run(f);
    this.finale = this.zone.runOutsideAngular(() =>
      this.world().startFinale({
        reducedMotion,
        settled,
        events: {
          onStage: (s) => s === 'vortex' && this.audio.sfx('whoosh'),
          onComplete: () => run(() => this.complete()),
          onFocus: (i) => run(() => this.onFocus(i)),
          onOpen: (i) => run(() => this.open(this.shown[i])),
          onScroll: (o) => run(() => this.position.set(Math.round(o))),
        },
      }),
    );
    this.position.set(this.finale.position);
    demoTrack('demo_finale_entered');
    if (!settled) demoTrack('demo_portal_started');
    this.timer = setInterval(() => this.seconds.set((performance.now() - this.started) / 1000), 500);
    const list = this.products();
    if (list) this.setGames(list);
  }

  private setGames(list: Product[]) {
    if (!this.finale || this.shown.length) return;
    this.shown = list;
    this.list.set(list);
    const cards: FinaleCard[] = list.map((p) => ({
      id: p.id, name: p.name, tagline: p.tagline, price: formatPrice(p), previousPrice: formatPreviousPrice(p), players: playersLabel(p), cover: p.coverImage,
    }));
    this.cards.set(cards);
    this.zone.runOutsideAngular(() => this.finale?.setCards(cards));
    this.position.set(this.finale.position);
  }

  private complete() {
    this.ready.set(true);
    if (!this.settled()) demoTrack('demo_portal_completed');
    if (this.cards().length) demoTrack('demo_cards_displayed');
  }

  private onFocus(i: number | null) {
    this.focused.set(i);
    if (i == null) return;
    this.explored.set(true);
    this.position.set(i);
    this.audio.sfx('select');
    const p = this.shown[i];
    if (p) demoTrack('demo_card_selected', p.id);
  }

  /** "גלו את המשחק הבא שלכם": the card in the middle comes forward. */
  explore() {
    this.explored.set(true);
    this.finale?.focus(this.finale.position);
  }

  pick(i: number | null) {
    this.finale?.focus(i);
    if (i == null) this.focused.set(null);
  }

  scroll(dir: number) {
    // the arrows point the Hebrew way: "next" (‹, on the left) moves forward in the list
    this.finale?.scroll(dir);
    this.position.set(this.finale?.position ?? 0);
  }

  canScroll(dir: number) {
    this.position();
    this.focused();
    return this.finale?.canScroll(dir) ?? false;
  }

  /** The game's own page, with its existing purchase. */
  open(p: Product | undefined) {
    if (!p || this.leaving()) return;
    this.leaving.set(true);
    this.chosen.emit(p);
  }

  ngOnDestroy() {
    clearInterval(this.timer);
    this.world().endFinale();
  }
}
