import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService, sessionStore } from '../core/api.service';
import { AudioService } from '../core/audio.service';
import { TreasureView } from '../core/models';

/** Sparks flying out of the chest: fixed directions (no randomness on the page), spread around the opening. */
const SPARKS = Array.from({ length: 22 }, (_, i) => {
  const a = (-90 + (i - 10.5) * 8.5) * (Math.PI / 180);
  const r = 120 + (i % 4) * 34;
  return { x: Math.round(Math.cos(a) * r), y: Math.round(Math.sin(a) * r), d: (i % 5) * 0.07, s: 4 + (i % 3) * 2 };
});

/**
 * The treasure chest of a paid order ("תיבת האוצר"), shown on the order page. The draw already happened on the server when
 * the payment was confirmed; this only shows it. A prize waits closed (on any device, with the order's recovery link)
 * until the buyer opens it, once, as a reveal; after that it stays here as a card. No prize = a short thank-you, never a
 * winning message.
 *
 * The chest is drawn in SVG and moved with CSS (no WebGL), so it never competes with the games' 3D scenes and loads
 * nothing extra. Reduced motion, or a weak device, gets a plain fade instead of the opening, the light and the sparks.
 */
@Component({
  selector: 'px-treasure-chest',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (view(); as v) {
      @if (v.state === 'drawn') {
        @if (!v.hasPrize) {
          @if (v.prize; as p) {
            <section class="thanks" aria-labelledby="tc-thanks">
              <h2 id="tc-thanks">{{ p.title || 'תודה שבחרתם ב-PORTAL X!' }}</h2>
              @if (p.message) { <p>{{ p.message }}</p> }
            </section>
          }
        } @else if (!v.revealed && !stage()) {
          <!-- a closed chest waits on the page (also after leaving and coming back) until it is opened -->
          <section class="waiting" aria-labelledby="tc-wait">
            <div class="mini" aria-hidden="true"><ng-container *ngTemplateOutlet="chestBody" /></div>
            <div>
              <h2 id="tc-wait">{{ v.surprise }}</h2>
              <p>תיבת אוצר סגורה מחכה לכם.</p>
              <button class="btn primary" (click)="show()">לתיבת האוצר</button>
            </div>
          </section>
        } @else if (v.prize; as p) {
          <ng-container *ngTemplateOutlet="card; context: { $implicit: p }" />
        }
      }
    }

    <!-- a native dialog: it opens in the top layer (above every card and stacking context), keeps the focus inside and closes with Esc -->
    <dialog #dlg class="overlay" aria-labelledby="tc-title" [class.simple]="simple()" (cancel)="onCancel($event)">
    @if (stage(); as s) {
        <div class="glow" [class.on]="s !== 'closed'" aria-hidden="true"></div>
        @if (view()?.animation === 'glow' && !simple()) { <div class="rays" [class.on]="s !== 'closed'" aria-hidden="true"></div> }
        <div class="panel">
          @if (s !== 'revealed') {
            <h2 id="tc-title" class="gold-title">{{ view()?.surprise }}</h2>
          }
          <div class="stage" [class.opening]="s === 'opening' || s === 'revealed'" [class.revealed]="s === 'revealed'" aria-hidden="true">
            <div class="chest">
              <div class="lid"><ng-container *ngTemplateOutlet="chestLid" /></div>
              <div class="base"><ng-container *ngTemplateOutlet="chestBody" /></div>
            </div>
            @if (!simple()) {
              <div class="sparks">
                @for (k of sparks; track $index) {
                  <i [style]="{ '--x': k.x + 'px', '--y': k.y + 'px', '--d': k.d + 's', '--s': k.s + 'px' }"></i>
                }
              </div>
            }
          </div>

          @if (s === 'closed') {
            @if (view()?.needsEmail) {
              <label class="email">הפרס אישי. לאיזו כתובת דוא״ל לשייך אותו?
                <input #email type="email" dir="ltr" autocomplete="email" inputmode="email" [value]="emailValue()" (input)="emailValue.set($any($event.target).value)" />
              </label>
              <p class="note">רק עם הכתובת הזו אפשר יהיה להשתמש בפרס.</p>
            }
            <button #openBtn class="btn primary big" (click)="open()" [disabled]="busy()">{{ busy() ? 'פותחים...' : 'פתחו את תיבת האוצר' }}</button>
            <button class="btn ghost small" (click)="later()">אחר כך</button>
          } @else if (s === 'revealed' && view()?.prize; as p) {
            <ng-container *ngTemplateOutlet="card; context: { $implicit: p, dialog: true }" />
            <button class="btn ghost" (click)="close()">סגירה</button>
          } @else {
            <p class="opening-text" role="status">התיבה נפתחת...</p>
          }
          @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
        </div>
    }
    </dialog>

    <ng-template #chestBody><svg viewBox="0 0 220 120" focusable="false"><defs>
        <linearGradient id="tc-w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a2a6e"/><stop offset="1" stop-color="#191338"/></linearGradient>
        <linearGradient id="tc-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff1bf"/><stop offset=".5" stop-color="#f2c45a"/><stop offset="1" stop-color="#a8741f"/></linearGradient></defs>
        <rect x="8" y="4" width="204" height="112" rx="10" fill="url(#tc-w)" stroke="url(#tc-g)" stroke-width="5"/>
        <rect x="34" y="4" width="16" height="112" fill="url(#tc-g)"/><rect x="170" y="4" width="16" height="112" fill="url(#tc-g)"/>
        <rect x="90" y="10" width="40" height="44" rx="7" fill="url(#tc-g)"/><circle cx="110" cy="28" r="6" fill="#2a1d55"/><rect x="107" y="30" width="6" height="14" rx="2" fill="#2a1d55"/>
        <path d="M14 98 H206" stroke="#f6d78d" stroke-opacity=".25" stroke-width="2"/></svg></ng-template>
    <ng-template #chestLid><svg viewBox="0 0 220 84" focusable="false"><defs>
        <linearGradient id="tc-lw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a3f9e"/><stop offset="1" stop-color="#2b1f5e"/></linearGradient>
        <linearGradient id="tc-lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff1bf"/><stop offset=".5" stop-color="#f2c45a"/><stop offset="1" stop-color="#a8741f"/></linearGradient></defs>
        <path d="M8 82 V40 Q8 4 110 4 Q212 4 212 40 V82 Z" fill="url(#tc-lw)" stroke="url(#tc-lg)" stroke-width="5"/>
        <path d="M34 82 V14 Q40 9 50 8 V82 Z" fill="url(#tc-lg)"/><path d="M186 82 V14 Q180 9 170 8 V82 Z" fill="url(#tc-lg)"/>
        <rect x="96" y="58" width="28" height="24" rx="5" fill="url(#tc-lg)"/>
        <path d="M30 30 Q110 10 190 30" stroke="#f6d78d" stroke-opacity=".35" stroke-width="3" fill="none"/></svg></ng-template>

    <ng-template #card let-p let-dialog="dialog">
      <section class="prize" [class.in-dialog]="dialog" aria-labelledby="tc-prize" [attr.aria-live]="dialog ? 'polite' : null">
        <h2 id="tc-prize" [attr.tabindex]="dialog ? -1 : null">{{ p.title || p.name }}</h2>
        @if (p.revoked) {
          <p class="error">הפרס בוטל, כי הרכישה שזיכתה בו הוחזרה.</p>
        } @else if (p.coupon; as c) {
          <p>{{ p.message }}</p>
          <div class="coupon">
            <span class="pct"><bdi>{{ c.percent }}%</bdi> הנחה</span>
            <code dir="ltr">{{ c.code }}</code>
            <button class="btn small" (click)="copy(c.code)">{{ copied() ? 'הועתק ✓' : 'העתקת הקוד' }}</button>
          </div>
          <p class="muted">בתוקף עד {{ c.expiresAtText }} · {{ statusText(c.status) }}</p>
          <p class="how">איך משתמשים? בוחרים משחק באתר, מזינים את הקוד בשדה הקופון וממלאים את כתובת הדוא״ל @if (c.email) {<bdi dir="ltr">{{ c.email }}</bdi>} שאליה הקופון שויך. הקופון טוב לרכישה אחת, ולא לרכישה הנוכחית.</p>
        } @else if (p.gift; as g) {
          <div class="gift">
            @if (g.coverImage) { <img [src]="g.coverImage" alt="" loading="lazy" width="160" height="100" /> }
            <div>
              <b>{{ g.name }}</b>
              @if (g.tagline) { <p class="muted">{{ g.tagline }}</p> }
            </div>
          </div>
          <p>{{ p.message }}</p>
          @if (g.canOpen) {
            <button class="btn primary" (click)="openGift()" [disabled]="busy()">{{ g.gameCode ? 'חזרה לחדר ההמתנה של המתנה' : 'יצירת משחק המתנה' }}</button>
          } @else if (g.gameCode) {
            <p class="muted">משחק המתנה נפתח. קוד המשחק: <b dir="ltr">{{ g.gameCode }}</b></p>
          }
          <p class="how">המשחק שייך לרכישה הזו: אפשר לפתוח אותו מתי שתרצו מדף ההזמנה או מקישור הרכישה.</p>
        }
      </section>
    </ng-template>
  `,
  styles: [`
    :host { display:block; }
    h2 { font-family:var(--font-title); color:var(--gold-2); margin:0 0 .4rem; font-size:1.3rem; }
    .thanks, .waiting, .prize { margin:1rem 0; padding:1rem; border-radius:14px; border:1px solid var(--line);
      background:linear-gradient(160deg, rgba(122,76,190,.18), rgba(224,185,92,.08)); }
    .thanks p, .prize p { margin:.3rem 0; }
    .waiting { display:flex; gap:1rem; align-items:center; }
    .waiting p { margin:.2rem 0 .6rem; }
    .mini { width:84px; flex:none; filter:drop-shadow(0 0 14px rgba(246,215,141,.45)); }
    .mini svg { width:100%; height:auto; display:block; }
    .coupon { display:flex; flex-wrap:wrap; gap:.6rem; align-items:center; margin:.6rem 0; }
    .pct { font-weight:800; color:var(--gold-2); font-size:1.2rem; }
    code { font-size:1.25rem; letter-spacing:.12em; padding:.35rem .7rem; border:2px dashed var(--gold); border-radius:10px; color:var(--gold-2); background:rgba(0,0,0,.25); }
    .how { font-size:.9rem; color:var(--muted); }
    .gift { display:flex; gap:.8rem; align-items:center; margin:.4rem 0; }
    .gift img { width:120px; height:auto; border-radius:10px; border:1px solid var(--line); object-fit:cover; aspect-ratio:16/10; }
    .gift p { margin:.15rem 0 0; }

    .overlay { position:fixed; inset:0; width:100vw; height:100dvh; max-width:none; max-height:none; margin:0; border:0; padding:16px; box-sizing:border-box;
      color:inherit; background:radial-gradient(40rem 30rem at 50% 40%, rgba(88,52,150,.55), rgba(5,7,20,.94)); overflow:auto; }
    .overlay[open] { display:grid; place-items:center; animation:fade .35s ease-out both; }
    .overlay::backdrop { background:rgba(5,7,20,.5); }
    .panel { position:relative; width:min(460px, 100%); text-align:center; display:flex; flex-direction:column; align-items:center; gap:.6rem; }
    .panel .gold-title { font-size:clamp(1.3rem, 5vw, 1.8rem); margin:0; }
    .glow { position:absolute; left:50%; top:42%; width:min(90vw, 620px); aspect-ratio:1; translate:-50% -50%; border-radius:50%; pointer-events:none;
      background:radial-gradient(circle, rgba(255,231,163,.85), rgba(244,184,74,.3) 35%, rgba(150,90,220,.15) 55%, transparent 70%);
      opacity:0; scale:.4; transition:opacity .8s ease, scale 1.2s cubic-bezier(.2,.8,.2,1); }
    .glow.on { opacity:1; scale:1; }
    .rays { position:absolute; left:50%; top:42%; width:min(110vw, 760px); aspect-ratio:1; translate:-50% -50%; pointer-events:none; opacity:0; transition:opacity 1s;
      background:repeating-conic-gradient(from 0deg, rgba(255,226,150,.16) 0 6deg, transparent 6deg 18deg); border-radius:50%;
      mask:radial-gradient(circle, #000 20%, transparent 68%); animation:spin 18s linear infinite; }
    .rays.on { opacity:1; }

    .stage { position:relative; width:220px; height:190px; perspective:700px; margin:.4rem 0; }
    .chest { position:absolute; inset:0; animation:bob 2.6s ease-in-out infinite; }
    .base { position:absolute; left:0; right:0; bottom:0; height:62%; }
    .lid { position:absolute; left:0; right:0; top:4%; height:44%; transform-origin:50% 100%; transition:transform .9s cubic-bezier(.3,1.4,.5,1); z-index:2; }
    .base svg, .lid svg { width:100%; height:100%; display:block; }
    .stage::after { content:''; position:absolute; left:18%; right:18%; top:38%; height:30%; border-radius:50%; pointer-events:none;
      background:radial-gradient(ellipse, rgba(255,240,190,.95), rgba(255,200,90,.4) 50%, transparent 72%); opacity:0; transition:opacity .5s .35s; }
    .stage.opening .chest { animation:shake .45s ease-in-out 1; }
    .stage.opening .lid { transform:translateY(-14px) rotateX(-68deg); }
    .stage.opening::after { opacity:1; }
    .stage.revealed { height:150px; }
    .sparks { position:absolute; left:50%; top:45%; pointer-events:none; }
    .sparks i { position:absolute; width:var(--s); height:var(--s); border-radius:50%; background:#ffe9a8; box-shadow:0 0 10px 2px rgba(255,214,120,.9); opacity:0; }
    .stage.opening .sparks i { animation:spark 1.3s cubic-bezier(.15,.7,.3,1) calc(.35s + var(--d)) both; }
    .email { display:flex; flex-direction:column; gap:.35rem; width:100%; text-align:start; font-weight:700; }
    .email input { width:100%; }
    .note { margin:0; font-size:.85rem; color:var(--muted); }
    .big { font-size:1.15rem; padding-inline:1.6rem; }
    .opening-text { color:var(--gold-2); }
    .prize.in-dialog { margin:0; width:100%; text-align:start; animation:rise .6s cubic-bezier(.2,.8,.2,1) both; background:rgba(10,14,36,.92); }

    /* reduced motion or a weak device: no opening, no light, no sparks — the prize simply fades in */
    .overlay.simple .chest, .overlay.simple .lid { animation:none !important; transition:none !important; }
    .overlay.simple .glow { transition:opacity .3s; scale:1; }
    @media (prefers-reduced-motion: reduce) {
      .overlay, .chest, .stage.opening .chest, .rays, .prize.in-dialog { animation:none !important; }
      .lid, .glow { transition:none !important; }
      .sparks { display:none; }
    }
    @keyframes fade { from { opacity:0; } }
    @keyframes spin { to { rotate:1turn; } }
    @keyframes bob { 50% { translate:0 -5px; } }
    @keyframes shake { 25% { rotate:-3deg; } 50% { rotate:3deg; } 75% { rotate:-2deg; } }
    @keyframes spark { 0% { opacity:0; transform:translate(0,0) scale(.4); } 15% { opacity:1; } 100% { opacity:0; transform:translate(var(--x), var(--y)) scale(1); } }
    @keyframes rise { from { opacity:0; transform:translateY(16px) scale(.97); } }
    @media (max-width: 420px) { .waiting { flex-direction:column; text-align:center; } .stage { width:180px; height:160px; } }
  `],
  imports: [NgTemplateOutlet],
})
export class TreasureChestComponent {
  private api = inject(ApiService);
  private audio = inject(AudioService);
  private router = inject(Router);
  private host = inject(ElementRef<HTMLElement>);
  orderId = input.required<string>();
  orderKey = input.required<string>();

  view = signal<TreasureView | null>(null);
  /** The reveal dialog: closed chest → opening → prize. Null = not shown. */
  stage = signal<'closed' | 'opening' | 'revealed' | null>(null);
  busy = signal(false);
  error = signal<string | null>(null);
  copied = signal(false);
  emailValue = signal('');
  sparks = SPARKS;
  private openBtn = viewChild<ElementRef<HTMLButtonElement>>('openBtn');
  private dlg = viewChild<ElementRef<HTMLDialogElement>>('dlg');
  private lastFocus: HTMLElement | null = null;

  /** No opening animation for reduced motion, a weak device, or a prize configured as "simple". */
  simple = signal(false);

  constructor() {
    effect(() => {
      const id = this.orderId(), key = this.orderKey();
      untracked(() => this.load(id, key));
    });
  }

  private async load(id: string, key: string, attempt = 0) {
    try {
      const v = await this.api.treasure(id, key);
      this.view.set(v);
      // a closed chest opens its surprise screen by itself, the first time the order page shows it
      if (v.state === 'drawn' && v.hasPrize && !v.revealed && !this.stage()) this.show();
    } catch {
      // a slow or lost answer: try again a little later (the draw is stored on the server, so nothing is lost)
      if (attempt < 3) setTimeout(() => this.load(id, key, attempt + 1), 1500 * (attempt + 1));
    }
  }

  show() {
    const v = this.view();
    const weak = typeof navigator !== 'undefined' && (navigator.hardwareConcurrency ?? 4) <= 2;
    const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.simple.set(reduced || weak || v?.animation === 'simple');
    this.lastFocus = document.activeElement as HTMLElement | null;
    this.error.set(null);
    this.stage.set('closed');
    const d = this.dlg()?.nativeElement;
    if (d && !d.open) d.showModal?.();
    setTimeout(() => this.openBtn()?.nativeElement.focus(), 50);
  }

  /** Esc: closes the dialog only before opening (the chest stays on the page) or after the prize is shown. */
  onCancel(e: Event) {
    e.preventDefault();
    if (this.stage() === 'closed') this.later();
    else if (this.stage() === 'revealed') this.close();
  }

  later() {
    if (this.stage() !== 'closed') return;
    this.close();
  }

  close() {
    this.stage.set(null);
    this.dlg()?.nativeElement.close?.();
    this.lastFocus?.focus();
  }

  async open() {
    const v = this.view();
    if (!v || this.busy()) return;
    const email = this.emailValue().trim();
    if (v.needsEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      this.error.set('הזינו כתובת דוא״ל תקינה כדי לשייך אליה את הפרס.');
      return;
    }
    this.audio.unlock();
    this.busy.set(true);
    this.error.set(null);
    const started = Date.now();
    try {
      const opened = await this.api.revealTreasure(this.orderId(), this.orderKey(), v.needsEmail ? email : null);
      this.stage.set('opening');
      this.audio.sfx('open');
      // the lid, the light and the sparks have their moment before the prize appears
      const wait = this.simple() ? 250 : Math.max(0, 1500 - (Date.now() - started));
      setTimeout(() => {
        this.view.set(opened);
        this.stage.set('revealed');
        this.audio.sfx('success');
        setTimeout(() => (this.host.nativeElement.querySelector('#tc-prize') as HTMLElement | null)?.focus(), 60);
      }, wait);
    } catch (e: any) {
      this.error.set(e?.message ?? 'לא הצלחנו לפתוח את התיבה. נסו שוב בעוד רגע — הפרס שמור.');
    } finally {
      this.busy.set(false);
    }
  }

  async copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2500);
    } catch {
      this.error.set('ההעתקה לא הצליחה. אפשר לסמן את הקוד ולהעתיק אותו ידנית.');
    }
  }

  async openGift() {
    this.audio.unlock();
    this.audio.sfx('click');
    this.busy.set(true);
    this.error.set(null);
    try {
      const g = await this.api.openTreasureGame(this.orderId(), this.orderKey());
      if (g.hostClaim) sessionStore.setHostClaim(g.code, g.hostClaim);
      await this.router.navigate(['/join', g.code]);
    } catch (e: any) {
      this.error.set(e?.message ?? 'לא הצלחנו לפתוח את משחק המתנה.');
      this.busy.set(false);
    }
  }

  statusText(s: string) {
    return ({ active: 'פעיל', redeemed: 'מומש', expired: 'פג תוקף', cancelled: 'בוטל' } as Record<string, string>)[s] ?? s;
  }
}

