import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiService, orderStore, sessionStore } from '../core/api.service';
import { AudioService } from '../core/audio.service';
import { OrderView } from '../core/models';

const POLL_MS = 2000;
const POLL_LIMIT_MS = 90_000;

/**
 * /checkout/:orderId — the buyer's order: waits for the server to confirm the payment, then opens the group game.
 * Nothing here trusts the browser: the status, the price and the right to open a game all come from the server.
 */
@Component({
  selector: 'px-checkout',
  imports: [RouterLink, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main>
      <a routerLink="/" class="back">‹ חזרה לדף הבית</a>
      <section class="card">
        @if (!key()) {
          <h1>הרכישה לא נמצאה במכשיר הזה</h1>
          <p>כדי לחזור לרכישה, פתחו את קישור הרכישה ששמרתם אחרי התשלום (הוא כולל קוד סודי בסופו).</p>
          <a class="btn primary" routerLink="/">לכל המשחקים</a>
        } @else if (!order()) {
          @if (error()) {
            <h1>לא הצלחנו לטעון את ההזמנה</h1>
            <p class="error" role="alert">{{ error() }}</p>
            <button class="btn" (click)="refresh()">נסו שוב</button>
          } @else {
            <p class="muted">טוענים את ההזמנה...</p>
          }
        } @else {
          @let o = order()!;
          <header>
            <span class="chip">הזמנה {{ o.number }}</span>
            @if (o.isTest) { <span class="chip test">רכישת בדיקה — ללא חיוב</span> }
          </header>
          <h1>{{ o.productName }}</h1>
          <dl>
            @if (o.discount && o.couponCode) {
              <dt>מחיר המשחק</dt><dd>{{ o.originalPrice }} ₪</dd>
              <dt>קופון</dt><dd dir="ltr">{{ o.couponCode }} · −{{ o.discount }} ₪</dd>
            }
            <dt>סכום</dt><dd>{{ o.price }} {{ o.currency === 'ILS' ? '₪' : o.currency }} · משחק קבוצתי אחד, עד {{ o.maxPlayers }} משתתפים</dd>
            <dt>נוצרה</dt><dd>{{ o.createdAt | date: 'd.M.yyyy HH:mm' }}</dd>
          </dl>

          @switch (o.status) {
            @case ('pending') {
              <div class="state wait" role="status">
                <span class="spinner" aria-hidden="true"></span>
                <div>
                  <b>ממתינים לאישור התשלום</b>
                  <p>המשחק ייפתח רק אחרי שספק התשלום יאשר את העסקה לשרת. זה בדרך כלל לוקח כמה שניות.</p>
                </div>
              </div>
              @if (pollGaveUp()) {
                <p class="muted">האישור עדיין לא הגיע. אפשר לרענן בעוד רגע.</p>
                <button class="btn" (click)="refresh(true)">בדיקה חוזרת</button>
              }
            }
            @case ('paid') {
              <div class="state ok" role="status"><b>התשלום אושר</b> {{ o.paidAt ? '· ' + (o.paidAt | date: 'd.M.yyyy HH:mm') : '' }}</div>
              @if (o.game) {
                <p>המשחק שלכם נפתח. קוד המשחק: <b class="code" dir="ltr">{{ o.game.code }}</b> · {{ o.game.playerCount }} משתתפים הצטרפו.</p>
                @if (o.canOpenGame) {
                  <button class="btn primary big" (click)="open()" [disabled]="busy()">כניסה לחדר ההמתנה כמארחים</button>
                } @else {
                  <a class="btn primary big" [routerLink]="['/join', o.game.code]">חזרה למשחק</a>
                }
              } @else if (o.canOpenGame) {
                <p>עכשיו יוצרים את המשחק ומקבלים קוד להזמנת עד {{ o.maxPlayers - 1 }} משתתפים נוספים.</p>
                <button class="btn primary big" (click)="open()" [disabled]="busy()">{{ busy() ? 'יוצרים משחק...' : 'יצירת משחק' }}</button>
              }
              @if (o.gameBlockedReason) { <p class="error" role="alert">{{ o.gameBlockedReason }}</p> }
            }
            @case ('refunded') {
              <div class="state bad" role="status"><b>הרכישה הוחזרה</b><p>לא ניתן לפתוח משחק עם רכישה שהוחזרה.</p></div>
            }
            @default {
              <div class="state bad" role="alert"><b>התשלום לא הושלם. אפשר לנסות שוב.</b><p>לא בוצע חיוב, והמשחק לא נפתח.</p></div>
              <a class="btn primary" [routerLink]="['/games', o.productId]">ניסיון חוזר</a>
            }
          }
          @if (error()) { <p class="error" role="alert">{{ error() }}</p> }

          @if (o.status === 'paid') {
            <div class="recovery">
              <label for="link">קישור הרכישה שלכם — שמרו אותו כדי לחזור למשחק מכל מכשיר:</label>
              <div class="row">
                <input id="link" readonly dir="ltr" [value]="recoveryLink()" (focus)="$any($event.target).select()" />
                <button class="btn small" (click)="copy()">{{ copied() ? 'הועתק' : 'העתקה' }}</button>
              </div>
              <p class="muted small">מי שמחזיק בקישור יכול לפתוח את המשחק. אל תפרסמו אותו.</p>
            </div>
          }
        }
      </section>
    </main>
  `,
  styles: [`
    :host { display:block; min-height:100dvh; background: radial-gradient(60rem 30rem at 85% -10%, rgba(224,185,92,.12), transparent 60%), var(--bg); }
    main { max-width:640px; margin:0 auto; padding:16px 16px 48px; }
    .back { display:inline-block; margin-bottom:1rem; }
    header { display:flex; gap:.4rem; flex-wrap:wrap; }
    .chip.test { color:#cfe2ff; border-color:var(--blue); }
    h1 { font-family:var(--font-title); color:var(--gold-2); margin:.5rem 0; }
    dl { display:grid; grid-template-columns:auto 1fr; gap:.3rem .8rem; margin:0 0 1rem; }
    dt { color:var(--muted); } dd { margin:0; }
    .state { border-radius:12px; padding:.8rem 1rem; margin:.5rem 0 1rem; display:flex; gap:.8rem; align-items:flex-start; flex-wrap:wrap; }
    .state p { margin:.25rem 0 0; }
    .state.wait { border:1px solid var(--line); background:rgba(255,255,255,.04); }
    .state.ok { border:1px solid var(--ok); background:rgba(63,191,106,.12); }
    .state.bad { border:1px solid var(--bad); background:rgba(226,113,91,.12); flex-direction:column; gap:0; }
    .spinner { width:22px; height:22px; border-radius:50%; border:3px solid var(--line); border-top-color:var(--gold); animation:spin 1s linear infinite; flex:none; margin-top:2px; }
    @keyframes spin { to { transform:rotate(1turn); } }
    .code { font-size:1.3rem; letter-spacing:.15em; color:var(--gold-2); }
    .big { font-size:1.1rem; }
    .recovery { margin-top:1.5rem; border-top:1px solid var(--line); padding-top:1rem; }
    .recovery label { font-weight:700; display:block; margin-bottom:.35rem; }
    .row { display:flex; gap:.5rem; } .row input { flex:1; min-width:0; font-size:.85rem; }
    .small { font-size:.85rem; }
  `],
})
export class CheckoutPage implements OnDestroy {
  private api = inject(ApiService);
  private router = inject(Router);
  private audio = inject(AudioService);
  orderId = input.required<string>();
  key = signal<string | null>(null);
  order = signal<OrderView | null>(null);
  error = signal<string | null>(null);
  busy = signal(false);
  copied = signal(false);
  pollGaveUp = signal(false);
  private timer?: ReturnType<typeof setTimeout>;
  private pollStarted = 0;

  recoveryLink = computed(() => `${location.origin}/checkout/${this.orderId()}#k=${this.key() ?? ''}`);

  constructor() {
    effect(() => this.start(this.orderId()));
  }

  private start(id: string) {
    // a saved recovery link carries the key in the #fragment (never sent to the server); keep it, then hide it
    const m = /(?:^|&)k=([^&]+)/.exec(location.hash.slice(1));
    if (m) {
      orderStore.save({ orderId: id, key: decodeURIComponent(m[1]), productId: '', productName: '', createdAt: new Date().toISOString() });
      history.replaceState(history.state, '', location.pathname);
    }
    this.key.set(orderStore.get(id)?.key ?? null);
    if (this.key()) this.refresh(true);
  }

  async refresh(restartPolling = false) {
    clearTimeout(this.timer);
    if (restartPolling) {
      this.pollStarted = Date.now();
      this.pollGaveUp.set(false);
    }
    try {
      const o = await this.api.order(this.orderId(), this.key()!);
      this.order.set(o);
      this.error.set(null);
      const stored = orderStore.get(o.id);
      if (stored && !stored.productId) orderStore.save({ ...stored, productId: o.productId, productName: o.productName });
      if (o.status === 'pending') {
        if (Date.now() - this.pollStarted < POLL_LIMIT_MS) this.timer = setTimeout(() => this.refresh(), POLL_MS);
        else this.pollGaveUp.set(true);
      }
    } catch (e: any) {
      this.error.set(e.message);
      if (e.code === 'no-order') {
        orderStore.remove(this.orderId());
        this.key.set(null);
      }
    }
  }

  async open() {
    this.audio.unlock();
    this.audio.sfx('click');
    this.busy.set(true);
    this.error.set(null);
    try {
      const g = await this.api.openGame(this.orderId(), this.key()!);
      if (g.hostClaim) sessionStore.setHostClaim(g.code, g.hostClaim);
      await this.router.navigate(['/join', g.code]);
    } catch (e: any) {
      this.error.set(e.message);
      this.busy.set(false);
      this.refresh();
    }
  }

  async copy() {
    try {
      await navigator.clipboard.writeText(this.recoveryLink());
      this.copied.set(true);
    } catch {
      (document.getElementById('link') as HTMLInputElement | null)?.select();
    }
  }

  ngOnDestroy() {
    clearTimeout(this.timer);
  }
}
