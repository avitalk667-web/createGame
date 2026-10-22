import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiService, sessionStore } from '../core/api.service';
import { AudioService } from '../core/audio.service';
import { Product, formatPrice, playersLabel } from '../core/models';

/** /games/:id — one product: large image, what's included, players, price and the next step (spec §2). */
@Component({
  selector: 'px-game',
  imports: [RouterLink],
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
            @if (p.playable) {
              <!-- Until orders and payments are added (stage 3) this game keeps its current free room creation. -->
              <button class="btn primary big" (click)="create(p)" [disabled]="busy()">
                {{ busy() ? 'יוצרים משחק...' : 'יצירת משחק' }}
              </button>
            } @else {
              <button class="btn primary big" disabled>רכישה{{ price(p) ? ' — ' + price(p) : '' }}</button>
              <p class="muted note">המשחק בשלבי פיתוח אחרונים. הרכישה תיפתח עם ההשקה.</p>
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
    } catch (e: any) {
      this.product.set(null);
      this.error.set(e.message);
    } finally {
      this.loading.set(false);
    }
  }

  async create(p: Product) {
    this.audio.unlock();
    this.audio.sfx('click');
    this.busy.set(true);
    this.error.set(null);
    try {
      const r = await this.api.createRoom(p.scenarioId!);
      sessionStore.setHostClaim(r.code, r.hostClaim);
      await this.router.navigate(['/join', r.code]);
    } catch (e: any) {
      this.error.set(e.message);
    } finally {
      this.busy.set(false);
    }
  }
}
