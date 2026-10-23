import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AdminApiService } from '../core/admin-api.service';
import { ApiService, orderStore } from '../core/api.service';
import { AudioService } from '../core/audio.service';
import { FaqEntryView, Product, formatPrice, playersLabel } from '../core/models';
import { SettingsPanelComponent } from '../ui/settings-panel.component';

/** Shared entry gate: a catalog of both games, each with its own server-side price (spec §2). */
@Component({
  selector: 'px-home',
  imports: [RouterLink, SettingsPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bg" aria-hidden="true"></div>
    <header class="top">
      <a routerLink="/" class="brand gold-title">PORTAL X</a>
      <nav aria-label="ניווט ראשי">
        <a class="anchor" href="#games" (click)="scrollTo($event, 'games')">המשחקים</a>
        <a class="anchor" href="#how" (click)="scrollTo($event, 'how')">איך משחקים?</a>
        <a class="anchor" href="#faq" (click)="scrollTo($event, 'faq')">שאלות ותשובות</a>
        <a routerLink="/join" class="btn small">יש לי קוד משחק</a>
        @if (isAdmin()) { <a routerLink="/admin" class="btn small">כניסת מנהל</a> }
        <button class="btn small ghost" (click)="showSettings.set(true)">הגדרות</button>
      </nav>
    </header>

    <main>
      <section class="hero">
        <span class="kicker">חדרי בריחה תלת־ממדיים · בעברית מלאה</span>
        <h1>בחרו את ההרפתקה שלכם</h1>
        <p class="pitch">משחקים קבוצתיים בדפדפן: נכנסים יחד לעולם תלת־ממדי, חוקרים, אוספים חפצים ופותרים חידות שמחייבות שיתוף פעולה. רכישה אחת לכל הקבוצה — וכל החברים מצטרפים עם קוד משחק.</p>
        <a class="btn primary big" href="#games" (click)="scrollTo($event, 'games')">למשחקים <span aria-hidden="true">↓</span></a>
      </section>

      @if (myOrders.length) {
        <section class="mine card" aria-label="הרכישות שלכם">
          <b>הרכישות שלכם במכשיר הזה:</b>
          @for (o of myOrders; track o.orderId) {
            <a [routerLink]="['/checkout', o.orderId]">{{ o.productName || 'רכישה' }}</a>
          }
        </section>
      }

      <section id="games" class="games" aria-labelledby="games-title">
        <h2 id="games-title">המשחקים</h2>
        @if (loading()) {
          <p class="muted">טוענים את המשחקים...</p>
        } @else if (error()) {
          <div class="card center">
            <p class="error" role="alert">{{ error() }}</p>
            <button class="btn" (click)="load()">נסו שוב</button>
          </div>
        } @else {
          <div class="grid">
            @for (p of products(); track p.id) {
              <article class="product card" [class.free]="p.isFree">
                @if (p.isFree) { <span class="ribbon">חינם</span> }
                <a class="cover" [routerLink]="['/games', p.id]" [attr.aria-label]="'פרטים על ' + p.name">
                  <img [src]="p.coverImage" [alt]="p.name" loading="lazy" />
                </a>
                <div class="body">
                  <h3><a [routerLink]="['/games', p.id]">{{ p.name }}</a></h3>
                  <p class="tagline">{{ p.tagline }}</p>
                  <ul class="features">
                    @for (f of p.features; track f) { <li class="chip">{{ f }}</li> }
                  </ul>
                  <div class="buy">
                    <div class="price">
                      @if (p.isFree) {
                        <b>חינם</b> <span>משחק התנסות · {{ players(p) }}</span>
                      } @else if (price(p); as pr) {
                        <b>{{ pr }}</b> <span>למשחק קבוצתי · {{ players(p) }}</span>
                      } @else {
                        <span class="muted">המחיר יפורסם בקרוב</span>
                      }
                    </div>
                    <a class="btn primary" [routerLink]="['/games', p.id]">{{ cta(p) }}</a>
                  </div>
                </div>
              </article>
            } @empty {
              <p class="muted">אין כרגע משחקים זמינים.</p>
            }
          </div>
        }
      </section>

      <section id="how" class="how" aria-labelledby="how-title">
        <h2 id="how-title">איך זה עובד?</h2>
        <ol>
          <li><b>בוחרים משחק</b><span>כל משחק עם עולם, חידות ומחיר משלו.</span></li>
          <li><b>רכישה אחת לקבוצה</b><span>משלמים פעם אחת — לא לכל משתתף.</span></li>
          <li><b>מקבלים קוד משחק</b><span>הקוד נוצר אחרי אישור התשלום בשרת.</span></li>
          <li><b>עד 4 משתתפים מצטרפים</b><span>כל אחד מזין את הקוד, בוחר כינוי ודמות. המארח נספר בין הארבעה.</span></li>
          <li><b>משחקים יחד</b><span>המארח מתחיל, וכל הקבוצה נכנסת להרפתקה.</span></li>
        </ol>
        <p class="muted">עובד בדפדפן במחשב ובטלפון. לא צריך מצלמה, מיקרופון או הרשמה. רוצים לנסות קודם? „שער הסודות” חינמי לגמרי.</p>
      </section>

      <section id="faq" class="faq" aria-labelledby="faq-title">
        <h2 id="faq-title">שאלות ותשובות נפוצות</h2>
        <div class="faq-list">
          @for (q of faq(); track q.id) {
            <div class="faq-item" [class.open]="openFaq() === q.id">
              <h3>
                <button type="button" class="faq-q" [attr.aria-expanded]="openFaq() === q.id" [attr.aria-controls]="'faq-' + q.id" (click)="toggleFaq(q.id)">
                  <span>{{ q.question }}</span><span class="sign" aria-hidden="true">+</span>
                </button>
              </h3>
              <!-- the answer is plain text: anything the admin typed is shown as text, never run -->
              <div class="faq-a" [id]="'faq-' + q.id" role="region"><div><p>{{ q.answer }}</p></div></div>
            </div>
          } @empty {
            <p class="muted">טוענים את השאלות...</p>
          }
        </div>
      </section>
    </main>

    <footer>
      <nav aria-label="מידע">
        <a routerLink="/info/terms">תנאי שימוש</a>
        <a routerLink="/info/privacy">מדיניות פרטיות</a>
        <a routerLink="/info/refunds">ביטולים והחזרים</a>
        <a routerLink="/info/contact">יצירת קשר</a>
        <a routerLink="/info/about">על PORTAL X</a>
      </nav>
      <p class="muted small">פרטי העסק יעודכנו כאן לפני פתיחת המכירות.</p>
    </footer>
    @if (showSettings()) { <px-settings (close)="showSettings.set(false)" /> }
  `,
  styles: [`
    :host { display:block; min-height:100dvh; position:relative; }
    .bg { position:fixed; inset:0; z-index:0; pointer-events:none;
      background:
        radial-gradient(60rem 30rem at 85% -10%, rgba(224,185,92,.18), transparent 60%),
        radial-gradient(50rem 30rem at 0% 30%, rgba(106,168,255,.14), transparent 60%),
        linear-gradient(180deg, #0a1230 0%, var(--bg) 60%); }
    .top, main, footer { position:relative; z-index:1; max-width:1160px; margin:0 auto; padding-inline:16px; }
    .top { display:flex; justify-content:space-between; align-items:center; gap:1rem; padding-block:14px; flex-wrap:wrap; }
    .brand { font-weight:900; letter-spacing:.08em; font-size:1.3rem; text-decoration:none; direction:ltr; }
    .top nav { display:flex; align-items:center; gap:1rem; flex-wrap:wrap; }
    .top nav a:not(.btn) { color:var(--text); text-decoration:none; font-weight:600; }
    .top nav a:not(.btn):hover { color:var(--gold-2); }
    .hero { min-height:56dvh; display:flex; flex-direction:column; justify-content:center; align-items:flex-start; max-width:680px; padding-block:2rem; }
    .kicker { color:var(--blue); font-weight:700; letter-spacing:.02em; }
    h1 { font-family:var(--font-title); font-size:clamp(2.4rem, 7vw, 4.4rem); line-height:1.1; margin:.3em 0; color:var(--gold-2); }
    .pitch { font-size:1.15rem; line-height:1.75; color:#e6e0cf; margin:0 0 1.5rem; }
    .big { font-size:1.15rem; padding:.85em 2em; }
    h2 { font-family:var(--font-title); font-size:2rem; margin:0 0 1rem; }
    .games { padding-block:1rem 2rem; scroll-margin-top:16px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); gap:1.25rem; }
    .product { position:relative; }
    .product.free { border-color: var(--gold); box-shadow: 0 0 0 1px rgba(224,185,92,.4), var(--shadow); }
    .ribbon { position:absolute; top:12px; inset-inline-start:12px; z-index:2; background:linear-gradient(180deg,#ffe08a,#c9a24d); color:#2a1606;
      font-weight:900; padding:.25rem .8rem; border-radius:999px; box-shadow:0 4px 14px rgba(0,0,0,.4); }
    .faq { padding-block:1rem 2.5rem; scroll-margin-top:16px; max-width:860px; }
    .faq-list { display:flex; flex-direction:column; gap:.5rem; }
    .faq-item { background:var(--panel); border:1px solid var(--line); border-radius:var(--radius); overflow:hidden; }
    .faq-item h3 { margin:0; font-family:inherit; font-size:1.05rem; }
    .faq-q { width:100%; display:flex; justify-content:space-between; align-items:center; gap:1rem; padding:.9rem 1.1rem; background:none; border:0;
      color:var(--text); font:inherit; font-weight:700; text-align:start; cursor:pointer; }
    .faq-q:hover, .faq-q:focus-visible { color:var(--gold-2); }
    .sign { font-size:1.4rem; color:var(--gold); transition:transform .25s ease; flex-shrink:0; }
    .open .sign { transform:rotate(45deg); }
    .faq-a { display:grid; grid-template-rows:0fr; transition:grid-template-rows .3s ease; }
    .open .faq-a { grid-template-rows:1fr; }
    .faq-a > div { overflow:hidden; }
    .faq-a p { margin:0; padding:0 1.1rem 1rem; color:#e6e0cf; line-height:1.7; white-space:pre-line; }
    @media (prefers-reduced-motion: reduce) { .faq-a, .sign { transition:none; } }
    .product { padding:0; overflow:hidden; display:flex; flex-direction:column; }
    .cover { display:block; aspect-ratio:16/9; overflow:hidden; background:var(--bg-2); }
    .cover img { width:100%; height:100%; object-fit:cover; display:block; transition:transform .4s; }
    .product:hover .cover img { transform:scale(1.03); }
    .body { padding:1.1rem 1.25rem 1.25rem; display:flex; flex-direction:column; gap:.6rem; flex:1; }
    h3 { margin:0; font-family:var(--font-title); font-size:1.7rem; }
    h3 a { color:var(--text); text-decoration:none; }
    .tagline { margin:0; color:var(--muted); line-height:1.6; }
    .features { list-style:none; padding:0; margin:.2rem 0; display:flex; flex-wrap:wrap; gap:.4rem; }
    .buy { margin-top:auto; display:flex; align-items:center; justify-content:space-between; gap:1rem; flex-wrap:wrap; padding-top:.6rem; border-top:1px solid var(--line); }
    .price { display:flex; flex-direction:column; }
    .price b { font-size:1.8rem; color:var(--gold-2); line-height:1.1; }
    .price span { font-size:.9rem; color:var(--muted); }
    .mine { display:flex; flex-wrap:wrap; gap:.4rem 1rem; align-items:center; padding:.8rem 1.1rem; margin-bottom:1.25rem; }
    .how { padding-block:2rem; scroll-margin-top:16px; }
    .how ol { list-style:none; padding:0; margin:0; display:grid; grid-template-columns:repeat(5, minmax(0,1fr)); gap:1rem; counter-reset:s; }
    .how li { background:var(--panel); border:1px solid var(--line); border-radius:var(--radius); padding:1rem; counter-increment:s; display:flex; flex-direction:column; gap:.3rem; }
    .how li::before { content:counter(s); font-family:var(--font-title); font-size:2rem; color:var(--gold); font-weight:900; }
    .how li span { color:var(--muted); line-height:1.5; }
    footer { text-align:center; padding-block:2rem 2.5rem; border-top:1px solid var(--line); margin-top:1rem; }
    footer nav { display:flex; justify-content:center; flex-wrap:wrap; gap:.4rem 1.4rem; }
    footer a { color:var(--text); }
    .small { font-size:.85rem; }
    .center { text-align:center; }
    @media (max-width: 900px) { .how ol { grid-template-columns:repeat(2, minmax(0,1fr)); } }
    @media (max-width: 760px) {
      .grid { grid-template-columns:1fr; }
      .how ol { grid-template-columns:1fr; }
      .top nav { gap:.5rem; } .top nav .anchor { display:none; }
      .hero { min-height:auto; padding-block:1.5rem 2rem; }
    }
  `],
})
export class HomePage {
  private api = inject(ApiService);
  private audio = inject(AudioService);
  private adminApi = inject(AdminApiService);
  /** The admin button appears only for a verified admin session (the server decides). */
  isAdmin = signal(false);
  products = signal<Product[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  showSettings = signal(false);
  faq = signal<FaqEntryView[]>([]);
  openFaq = signal<string | null>(null);
  myOrders = orderStore.all().slice(0, 5);
  price = formatPrice;
  players = playersLabel;

  constructor() {
    this.audio.setMusic('home');
    this.load();
    this.api.faq().then((f) => this.faq.set(f)).catch(() => {});
    this.adminApi.session().then((s) => this.isAdmin.set(s.admin)).catch(() => {});
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.products.set(await this.api.products());
    } catch (e: any) {
      this.error.set(e.message);
    } finally {
      this.loading.set(false);
    }
  }

  cta(p: Product) {
    return p.isFree ? 'לשחק בחינם' : p.id === 'hanukkah-oil' ? 'לרכישת משחק החנוכה' : 'לפרטים ולרכישה';
  }

  toggleFaq(id: string) {
    this.openFaq.set(this.openFaq() === id ? null : id);
  }

  scrollTo(ev: Event, id: string) {
    ev.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
