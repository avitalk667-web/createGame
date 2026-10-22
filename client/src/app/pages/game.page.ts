import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiService, StoredOrder, orderStore } from '../core/api.service';
import { AudioService } from '../core/audio.service';
import { Product, formatPrice, playersLabel } from '../core/models';

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
            <h2>לפני הרכישה</h2>
            <ul>
              <li>הרכישה היא עבור משחק קבוצתי אחד — לא עבור כל שחקן בנפרד.</li>
              <li>אחרי אישור התשלום מקבלים קוד משחק ושולחים אותו לעד {{ p.maxPlayers - 1 }} משתתפים נוספים.</li>
              <li>המשתתפים מצטרפים עם הקוד, בוחרים כינוי ודמות, ולא משלמים שוב.</li>
              <li>המשחק מתחיל כשהמארח לוחץ „התחלת המשחק”.</li>
              <li>לא נדרשת הרשמה. כתובת דוא״ל תתבקש רק לצורך קבלה ואישור רכישה.</li>
            </ul>
          </section>

          <aside class="card buy" aria-label="מחיר ורכישה">
            @if (price(p); as pr) {
              <b class="price">{{ pr }}</b>
              <span class="muted">למשחק קבוצתי אחד · {{ players(p) }}</span>
            } @else {
              <b class="price soon">המחיר יפורסם בקרוב</b>
            }
            @if (p.purchasable) {
              @if (!checkout()) {
                <button class="btn primary big" (click)="checkout.set(true)">רכישת המשחק — {{ price(p) }}</button>
              } @else {
                <form class="checkout" (submit)="$event.preventDefault(); pay(p)">
                  <h3>סיכום לפני תשלום</h3>
                  <dl>
                    <dt>משחק</dt><dd>{{ p.name }}</dd>
                    <dt>מחיר</dt><dd>{{ price(p) }}</dd>
                    <dt>כולל</dt><dd>משחק קבוצתי אחד, עד {{ p.maxPlayers }} משתתפים. המשתתפים לא משלמים.</dd>
                  </dl>
                  <label for="email">דוא״ל לקבלה <span class="muted">(רשות)</span></label>
                  <input id="email" type="email" dir="ltr" autocomplete="email" maxlength="200" placeholder="name@example.com"
                    [value]="email()" (input)="email.set($any($event.target).value)" />
                  @if (p.testPayments) {
                    <p class="test" role="note">מצב בדיקה: התשלום מדומה, לא יתבצע חיוב, והרכישה לא נספרת כהכנסה.</p>
                  }
                  <p class="muted small">בלחיצה על „מעבר לתשלום” אתם מאשרים את <a routerLink="/info/terms">תנאי השימוש</a> ואת <a routerLink="/info/refunds">מדיניות הביטולים</a>.</p>
                  <button class="btn primary big" type="submit" [disabled]="busy()">{{ busy() ? 'מכינים את התשלום...' : 'מעבר לתשלום' }}</button>
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
  email = signal('');
  myOrders = signal<StoredOrder[]>([]);
  price = formatPrice;
  players = playersLabel;

  constructor() {
    effect(() => this.load(this.id()));
  }

  private async load(id: string) {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.product.set(await this.api.product(id));
      this.myOrders.set(orderStore.all().filter((o) => o.productId === id).slice(0, 3));
    } catch (e: any) {
      this.product.set(null);
      this.error.set(e.message);
    } finally {
      this.loading.set(false);
    }
  }

  /** Creates the order on the server (price from the catalog) and moves on to the provider's payment page. */
  async pay(p: Product) {
    this.audio.unlock();
    this.audio.sfx('click');
    this.busy.set(true);
    this.error.set(null);
    try {
      const o = await this.api.createOrder(p.id, this.email().trim() || null);
      orderStore.save({ orderId: o.orderId, key: o.accessKey, productId: p.id, productName: p.name, createdAt: new Date().toISOString() });
      if (o.checkoutUrl.startsWith('/')) await this.router.navigateByUrl(o.checkoutUrl);
      else window.location.assign(o.checkoutUrl);
    } catch (e: any) {
      this.error.set(e.message);
      this.busy.set(false);
    }
  }
}
