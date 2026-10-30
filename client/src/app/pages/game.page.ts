import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiService, StoredOrder, orderStore, sessionStore } from '../core/api.service';
import { AudioService } from '../core/audio.service';
import { CouponQuote, Product, formatPrice, playersLabel } from '../core/models';

/** /games/:id — one product: large image, what's included, players, price and the next step (spec §2). */
@Component({
  selector: 'px-game',
  imports: [RouterLink, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main>
      <a routerLink="/" class="back">‹ חזרה לכל המשחקים</a>
      @if (loading()) {
        <p class="muted">טוענים את פרטי המשחק...</p>
      } @else if (!product()) {
        <section class="card center">
          <h1>המשחק לא נמצא</h1>
          <p class="error" role="alert">{{ error() }}</p>
          <a class="btn primary" routerLink="/">לכל המשחקים</a>
        </section>
      } @else {
        @let p = product()!;
        <section class="hero">
          <img class="cover" [src]="p.coverImage" [alt]="p.name" />
          <div class="intro">
            <span class="chip">{{ players(p) }}</span>
            <h1>{{ p.name }}</h1>
            <p class="tagline">{{ p.tagline }}</p>
            <p class="desc">{{ p.description }}</p>
            <ul class="features">
              @for (f of p.features; track f) { <li class="chip">{{ f }}</li> }
            </ul>
          </div>
        </section>

        <div class="layout">
          <section class="card included">
            <h2>מה כלול</h2>
            <ul>
              @for (line of p.included; track line) { <li>{{ line }}</li> }
            </ul>
            @if (p.isFree) {
              <h2>איך מתחילים?</h2>
              <ul>
                <li>המשחק חינמי לגמרי — בלי תשלום, בלי הרשמה ובלי פרטי תשלום.</li>
                <li>לוחצים „התחילו לשחק בחינם”, מקבלים קוד משחק ושולחים אותו לעד {{ p.maxPlayers - 1 }} משתתפים נוספים.</li>
                <li>המשחק מתחיל כשהמארח לוחץ „התחלת המשחק”. בסיום אפשר להכיר את המשחקים המלאים.</li>
              </ul>
            } @else {
            <h2>לפני הרכישה</h2>
            <ul>
              <li>הרכישה היא עבור משחק קבוצתי אחד — לא עבור כל שחקן בנפרד.</li>
              <li>אחרי אישור התשלום מקבלים קוד משחק ושולחים אותו לעד {{ p.maxPlayers - 1 }} משתתפים נוספים.</li>
              <li>המשתתפים מצטרפים עם הקוד, בוחרים כינוי ודמות, ולא משלמים שוב.</li>
              <li>המשחק מתחיל כשהמארח לוחץ „התחלת המשחק”.</li>
              <li>לא נדרשת הרשמה. כתובת דוא״ל תתבקש רק לצורך קבלה ואישור רכישה.</li>
            </ul>
            }
          </section>

          <aside class="card buy" aria-label="מחיר ורכישה">
            @if (p.isFree) {
              <b class="price">חינם</b>
              <span class="muted">משחק התנסות · {{ players(p) }}</span>
            } @else if (price(p); as pr) {
              <b class="price">{{ pr }}</b>
              <span class="muted">למשחק קבוצתי אחד · {{ players(p) }}</span>
            } @else {
              <b class="price soon">המחיר יפורסם בקרוב</b>
            }
            @if (p.saleState === 'scheduled') {
              <button class="btn primary big" disabled>הרכישה תיפתח ב־{{ p.saleOpensLabel }}</button>
              <p class="muted note sale-soon" role="status"><b>המכירה תיפתח בקרוב</b> — {{ p.saleOpensLabel }}.</p>
            } @else if (p.saleState === 'paused') {
              <button class="btn primary big" disabled>{{ p.isFree ? 'התחילו לשחק בחינם' : 'רכישת המשחק' }}</button>
              <p class="muted note" role="status">המכירה של המשחק הזה מושהית כרגע. נסו שוב מאוחר יותר.</p>
            } @else if (p.isFree) {
              <button class="btn primary big" (click)="playFree(p)" [disabled]="busy() || !p.playable">{{ busy() ? 'פותחים משחק...' : 'התחילו לשחק בחינם' }}</button>
              <p class="muted note">בלי תשלום ובלי חשבון. תקבלו קוד משחק להזמנת חברים.</p>
            } @else if (p.purchasable) {
              @if (!checkout()) {
                <button class="btn primary big" (click)="checkout.set(true)">רכישת המשחק — {{ price(p) }}</button>
              } @else {
                <form class="checkout" (submit)="$event.preventDefault(); pay(p)">
                  <h3>סיכום לפני תשלום</h3>
                  <dl>
                    <dt>משחק</dt><dd>{{ p.name }}</dd>
                    @if (quote(); as q) {
                      <dt>מחיר המשחק</dt><dd>{{ money(q.originalPrice) }}</dd>
                      <dt>קופון</dt><dd dir="ltr" class="code">{{ q.code }}</dd>
                      <dt>הנחה</dt><dd class="discount">{{ q.kind === 'percent' ? q.value + '% · ' : '' }}−{{ money(q.discount) }}</dd>
                      <dt>לתשלום</dt><dd class="final">{{ money(q.finalPrice) }}</dd>
                    } @else {
                      <dt>מחיר</dt><dd>{{ price(p) }}</dd>
                    }
                    <dt>כולל</dt><dd>משחק קבוצתי אחד, 1–{{ p.maxPlayers }} משתתפים. המשתתפים לא משלמים.</dd>
                  </dl>
                  <div class="coupon">
                    <label for="coupon">יש לך קוד קופון?</label>
                    @if (quote(); as q) {
                      <p class="ok" role="status">הקופון {{ q.code }} הוחל — חסכתם {{ money(q.discount) }}.</p>
                      <button class="btn small ghost" type="button" (click)="removeCoupon()">הסרת הקופון</button>
                    } @else {
                      <div class="row">
                        <input id="coupon" dir="ltr" autocomplete="off" maxlength="32" placeholder="לדוגמה HANUKKAH15" [value]="couponText()" (input)="couponText.set($any($event.target).value)" />
                        <button class="btn small" type="button" (click)="applyCoupon(p)" [disabled]="!couponText().trim() || couponBusy()">החל קופון</button>
                      </div>
                    }
                    @if (couponError()) { <p class="error" role="alert">{{ couponError() }}</p> }
                  </div>
                  <label for="email">דוא״ל לקבלה <span class="muted">(רשות)</span></label>
                  <input id="email" type="email" dir="ltr" autocomplete="email" maxlength="200" placeholder="name@example.com"
                    [value]="email()" (input)="email.set($any($event.target).value)" />
                  @if (p.testPayments) {
                    <p class="test" role="note">מצב בדיקה: התשלום מדומה, לא יתבצע חיוב, והרכישה לא נספרת כהכנסה.</p>
                  }
                  <p class="muted small">בלחיצה על „מעבר לתשלום” אתם מאשרים את <a routerLink="/info/terms">תנאי השימוש</a> ואת <a routerLink="/info/terms">מדיניות הביטולים</a>.</p>
                  <button class="btn primary big" type="submit" [disabled]="busy()">{{ busy() ? 'מכינים את התשלום...' : 'מעבר לתשלום — ' + (quote() ? money(quote()!.finalPrice) : price(p)) }}</button>
                  <button class="btn ghost small" type="button" (click)="checkout.set(false)">חזרה</button>
                </form>
              }
            } @else if (!p.priceSet) {
              <button class="btn primary big" disabled>רכישה</button>
              <p class="muted note">הרכישה תיפתח אחרי שייקבע מחיר למשחק.</p>
            } @else if (!p.playable) {
              <button class="btn primary big" disabled>רכישת המשחק — {{ price(p) }}</button>
              <p class="muted note">המשחק בשלבי פיתוח אחרונים. הרכישה תיפתח עם ההשקה.</p>
            } @else {
              <button class="btn primary big" disabled>רכישת המשחק — {{ price(p) }}</button>
              <p class="muted note">התשלום באתר עדיין לא פתוח. נסו שוב מאוחר יותר.</p>
            }
            @if (p.testCheckout) {
              <div class="demo">
                <button class="btn big demo-btn" (click)="playDemo(p)" [disabled]="busy()">{{ busy() ? 'פותחים משחק...' : 'פתיחת המשחק במצב הדגמה — ללא חיוב' }}</button>
                <p class="note" role="note">מצב בדיקה בלבד. לא מתבצע חיוב כספי אמיתי.</p>
              </div>
            }
            @for (o of myOrders(); track o.orderId) {
              <a class="btn" [routerLink]="['/checkout', o.orderId]">לרכישה שלכם מ־{{ o.createdAt | date: 'd.M.yy' }}</a>
            }
            <a routerLink="/join" class="btn">יש לי קוד משחק</a>
            @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
          </aside>
        </div>

        @if (p.gallery.length) {
          <section class="gallery" aria-labelledby="gal-title">
            <h2 id="gal-title">{{ p.gallery.length > 3 ? 'החדרים במשחק' : 'מתוך המשחק' }}</h2>
            <div class="tiles">
              @for (g of p.gallery; track g.src) {
                <figure>
                  <img [src]="g.src" [alt]="g.caption" loading="lazy" />
                  <figcaption>{{ g.caption }}</figcaption>
                </figure>
              }
            </div>
          </section>
        }
      }
    </main>
  `,
  styles: [`
    :host { display:block; min-height:100dvh; background: radial-gradient(60rem 30rem at 85% -10%, rgba(224,185,92,.14), transparent 60%), var(--bg); }
    main { max-width:1160px; margin:0 auto; padding:16px 16px 48px; }
    .back { display:inline-block; margin-bottom:1rem; }
    .hero { display:grid; grid-template-columns:1.15fr 1fr; gap:1.5rem; align-items:center; }
    .cover { width:100%; aspect-ratio:16/9; object-fit:cover; border-radius:var(--radius); border:1px solid var(--line); display:block; box-shadow:var(--shadow); }
    h1 { font-family:var(--font-title); font-size:clamp(2.2rem, 5vw, 3.4rem); margin:.3rem 0; color:var(--gold-2); }
    .tagline { font-size:1.2rem; color:var(--blue); margin:0 0 .6rem; }
    .desc { line-height:1.8; color:#e6e0cf; margin:0; }
    .features { list-style:none; padding:0; margin:1rem 0 0; display:flex; flex-wrap:wrap; gap:.4rem; }
    .layout { display:grid; grid-template-columns:1.6fr 1fr; gap:1.25rem; margin-top:1.75rem; align-items:start; }
    h2 { font-family:var(--font-title); margin:0 0 .6rem; }
    .included ul { line-height:1.8; padding-inline-start:1.2rem; margin:0 0 1.25rem; }
    .buy { display:flex; flex-direction:column; gap:.6rem; position:sticky; top:16px; }
    .price { font-size:2.4rem; color:var(--gold-2); line-height:1.1; }
    .price.soon { font-size:1.4rem; }
    .big { font-size:1.1rem; margin-top:.5rem; }
    .note { margin:0; font-size:.9rem; }
    .gallery { margin-top:2rem; }
    .tiles { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:1rem; }
    figure { margin:0; background:var(--panel); border:1px solid var(--line); border-radius:var(--radius); overflow:hidden; }
    figure img { width:100%; aspect-ratio:16/9.4; object-fit:cover; display:block; }
    figcaption { padding:.55rem .7rem; font-size:.9rem; line-height:1.4; }
    .center { text-align:center; }
    .checkout { display:flex; flex-direction:column; gap:.5rem; border-top:1px solid var(--line); padding-top:.75rem; }
    .checkout h3 { margin:0; font-family:var(--font-title); }
    dl { display:grid; grid-template-columns:auto 1fr; gap:.25rem .75rem; margin:0; }
    dt { color:var(--muted); } dd { margin:0; }
    .demo { display:flex; flex-direction:column; gap:.35rem; padding:.7rem; border:1px dashed var(--blue); border-radius:12px; background:rgba(106,168,255,.08); }
    .demo-btn { background:rgba(106,168,255,.16); border-color:var(--blue); color:var(--text); }
    .demo .note { margin:0; color:#bcd6ff; font-size:.9rem; }
    .coupon { display:flex; flex-direction:column; gap:.35rem; padding:.6rem 0; border-top:1px solid var(--line); border-bottom:1px solid var(--line); }
    .coupon .row { display:flex; gap:.4rem; } .coupon input { flex:1; min-width:0; text-transform:uppercase; }
    .coupon .ok { margin:0; color:#9be3b4; } .discount { color:#9be3b4; } .final { font-weight:900; color:var(--gold-2); font-size:1.2rem; }
    .code { font-weight:700; }
    .checkout input { width:100%; }
    .test { margin:0; padding:.5rem .7rem; border-radius:10px; border:1px dashed var(--blue); color:#cfe2ff; font-size:.9rem; }
    .small { font-size:.85rem; margin:0; }
    @media (max-width: 900px) { .tiles { grid-template-columns:repeat(2, minmax(0,1fr)); } }
    @media (max-width: 760px) {
      .hero, .layout { grid-template-columns:1fr; }
      .buy { position:static; }
    }
  `],
})
export class GamePage {
  private api = inject(ApiService);
  private router = inject(Router);
  private audio = inject(AudioService);
  id = input.required<string>();
  product = signal<Product | null>(null);
  loading = signal(true);
  busy = signal(false);
  error = signal<string | null>(null);
  checkout = signal(false);
  couponText = signal('');
  couponBusy = signal(false);
  couponError = signal<string | null>(null);
  /** The price with the coupon, as computed by the server; the order is priced by the server again. */
  quote = signal<CouponQuote | null>(null);
  email = signal('');
  myOrders = signal<StoredOrder[]>([]);
  price = formatPrice;
  players = playersLabel;

  private opensTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    effect(() => this.load(this.id()));
    inject(DestroyRef).onDestroy(() => clearTimeout(this.opensTimer));
  }

  /** A game waiting for its opening time is loaded again at that moment, so the purchase opens without a refresh. */
  private watchOpening(p: Product) {
    clearTimeout(this.opensTimer);
    if (p.saleState !== 'scheduled' || !p.saleOpensAt) return;
    const wait = Date.parse(p.saleOpensAt) - Date.now() + 1500;
    if (wait > 0 && wait < 2 ** 31 - 1) this.opensTimer = setTimeout(() => this.load(p.id), wait);
  }

  private async load(id: string) {
    this.loading.set(true);
    this.error.set(null);
    try {
      const p = await this.api.product(id);
      this.product.set(p);
      this.watchOpening(p);
      this.myOrders.set(orderStore.all().filter((o) => o.productId === id).slice(0, 3));
    } catch (e: any) {
      this.product.set(null);
      this.error.set(e.message);
    } finally {
      this.loading.set(false);
    }
  }

  money(n: number) {
    return (Number.isInteger(n) ? String(n) : n.toFixed(2)) + ' ₪';
  }

  async applyCoupon(p: Product) {
    this.couponBusy.set(true);
    this.couponError.set(null);
    try {
      this.quote.set(await this.api.checkCoupon(p.id, this.couponText().trim()));
      this.audio.sfx('click');
    } catch (e: any) {
      this.quote.set(null);
      this.couponError.set(e.message);
    } finally {
      this.couponBusy.set(false);
    }
  }

  removeCoupon() {
    this.quote.set(null);
    this.couponText.set('');
    this.couponError.set(null);
  }

  /** Demo mode: the server opens the game without payment (only while it allows it); this browser becomes its host. */
  async playDemo(p: Product) {
    this.audio.unlock();
    this.audio.sfx('click');
    this.busy.set(true);
    this.error.set(null);
    try {
      const g = await this.api.testGame(p.id);
      sessionStore.setHostClaim(g.code, g.hostClaim);
      await this.router.navigate(['/join', g.code], { state: { demoNotice: g.message } });
    } catch (e: any) {
      this.error.set(e.message);
      this.busy.set(false);
    }
  }

  /** The free trial: the server opens a game (no order, no payment) and this browser becomes its host. */
  async playFree(p: Product) {
    this.audio.unlock();
    this.audio.sfx('click');
    this.busy.set(true);
    this.error.set(null);
    try {
      const g = await this.api.freeGame(p.id);
      sessionStore.setHostClaim(g.code, g.hostClaim);
      await this.router.navigate(['/join', g.code]);
    } catch (e: any) {
      this.error.set(e.message);
      this.busy.set(false);
    }
  }

  /** Creates the order on the server (price from the catalog) and moves on to the provider's payment page. */
  async pay(p: Product) {
    this.audio.unlock();
    this.audio.sfx('click');
    this.busy.set(true);
    this.error.set(null);
    try {
      const o = await this.api.createOrder(p.id, this.email().trim() || null, this.quote()?.code);
      orderStore.save({ orderId: o.orderId, key: o.accessKey, productId: p.id, productName: p.name, createdAt: new Date().toISOString() });
      if (o.checkoutUrl.startsWith('/')) await this.router.navigateByUrl(o.checkoutUrl);
      else window.location.assign(o.checkoutUrl);
    } catch (e: any) {
      this.error.set(e.message);
      this.busy.set(false);
    }
  }
}
