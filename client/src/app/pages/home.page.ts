import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AdminApiService } from '../core/admin-api.service';
import { ApiService, Campaign } from '../core/api.service';
import { AudioService } from '../core/audio.service';
import { SiteService } from '../core/site.service';
import { FaqEntryView, Product, formatPrice, playersLabel } from '../core/models';
import { DrawCountdownComponent } from '../ui/draw-countdown.component';
import { PrizeGiftComponent } from '../ui/prize-gift.component';
import { HowItWorksComponent } from '../ui/how-it-works.component';
import { SettingsPanelComponent } from '../ui/settings-panel.component';

/** Shared entry gate: a catalog of both games, each with its own server-side price (spec §2). */
@Component({
  selector: 'px-home',
  imports: [RouterLink, SettingsPanelComponent, DrawCountdownComponent, PrizeGiftComponent, HowItWorksComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bg" aria-hidden="true"></div>
    <header class="top">
      <div class="bar">
        <a routerLink="/" class="brand gold-title">PORTAL X</a>
        <nav class="links" aria-label="ניווט ראשי">
          <a class="anchor" href="#games" (click)="scrollTo($event, 'games')">המשחקים</a>
          <a class="anchor" href="#how" (click)="scrollTo($event, 'how')">איך משחקים?</a>
          <a class="anchor" href="#faq" (click)="scrollTo($event, 'faq')">שאלות ותשובות</a>
        </nav>
        <div class="actions">
          <a routerLink="/join" class="btn small code-btn"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M7 7h10a5 5 0 0 1 4.9 6l-.8 4a2.6 2.6 0 0 1-4.5 1.2L14.3 16H9.7l-2.3 2.2A2.6 2.6 0 0 1 2.9 17l-.8-4A5 5 0 0 1 7 7Zm0 3v1.5H5.5v1.5H7v1.5h1.5V13H10v-1.5H8.5V10H7Zm9 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm-2 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"/></svg><span>יש לי קוד משחק</span></a>
          @if (isAdmin()) { <a routerLink="/admin" class="btn small wide-only">כניסת מנהל</a> }
          <button type="button" class="btn small ghost wide-only" (click)="showSettings.set(true)"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M10.3 2h3.4l.5 2.6c.6.2 1.2.5 1.7.9l2.5-.9 1.7 2.9-2 1.8c.1.6.1 1.2 0 1.8l2 1.8-1.7 2.9-2.5-.9c-.5.4-1.1.7-1.7.9l-.5 2.6h-3.4l-.5-2.6c-.6-.2-1.2-.5-1.7-.9l-2.5.9-1.7-2.9 2-1.8a6 6 0 0 1 0-1.8l-2-1.8 1.7-2.9 2.5.9c.5-.4 1.1-.7 1.7-.9L10.3 2ZM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" transform="translate(0 1.5) scale(.95)"/></svg><span>הגדרות</span></button>
          <!-- on phones every item moves into a menu instead of shrinking -->
          <button type="button" class="btn small ghost menu-btn" (click)="menuOpen.set(!menuOpen())"
            [attr.aria-expanded]="menuOpen()" aria-controls="mobile-menu" [attr.aria-label]="menuOpen() ? 'סגירת התפריט' : 'פתיחת התפריט'">
            <span class="burger" [class.x]="menuOpen()" aria-hidden="true"><i></i><i></i><i></i></span>
          </button>
        </div>
      </div>
      @if (menuOpen()) {
        <nav id="mobile-menu" class="mobile-menu" aria-label="תפריט">
          <a href="#games" (click)="scrollTo($event, 'games')">המשחקים</a>
          <a href="#how" (click)="scrollTo($event, 'how')">איך משחקים?</a>
          <a href="#faq" (click)="scrollTo($event, 'faq')">שאלות ותשובות</a>
          <a routerLink="/join"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M7 7h10a5 5 0 0 1 4.9 6l-.8 4a2.6 2.6 0 0 1-4.5 1.2L14.3 16H9.7l-2.3 2.2A2.6 2.6 0 0 1 2.9 17l-.8-4A5 5 0 0 1 7 7Zm0 3v1.5H5.5v1.5H7v1.5h1.5V13H10v-1.5H8.5V10H7Zm9 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm-2 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"/></svg> יש לי קוד משחק</a>
          @if (isAdmin()) { <a routerLink="/admin">כניסת מנהל</a> }
          <button type="button" (click)="menuOpen.set(false); showSettings.set(true)"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M10.3 2h3.4l.5 2.6c.6.2 1.2.5 1.7.9l2.5-.9 1.7 2.9-2 1.8c.1.6.1 1.2 0 1.8l2 1.8-1.7 2.9-2.5-.9c-.5.4-1.1.7-1.7.9l-.5 2.6h-3.4l-.5-2.6c-.6-.2-1.2-.5-1.7-.9l-2.5.9-1.7-2.9 2-1.8a6 6 0 0 1 0-1.8l-2-1.8 1.7-2.9 2.5.9c.5-.4 1.1-.7 1.7-.9L10.3 2ZM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" transform="translate(0 1.5) scale(.95)"/></svg> הגדרות</button>
        </nav>
      }
    </header>

    <main>
      <!-- the personal-link invitation and the draw: a slim banner, one row on a computer (button, countdown, text, prize, logo
           from right to left), a few short rows on a phone -->
      <section class="share" [class.with-prize]="campaignOn()" aria-labelledby="share-title">
        <a class="btn share-cta" routerLink="/share">
          <svg class="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M18 2a4 4 0 1 1-2.9 6.8l-6.2 3.1a4 4 0 0 1 0 .2l6.2 3.1a4 4 0 1 1-.9 1.8l-6.2-3.1a4 4 0 1 1 0-5.8l6.2-3.1A4 4 0 0 1 18 2Z"/></svg>
          <span>יצירת קישור אישי</span>
        </a>
        @if (campaignOn()) {
          <px-draw-countdown class="share-timer" compact [drawAt]="campaign()?.drawAt" [serverNow]="campaign()?.serverNow" />
        }
        <div class="share-text">
          <h2 id="share-title">אהבתם? שתפו את PORTAL X</h2>
          @if (campaignOn()) {
            <!-- the "friend brings a friend" draw (same terms as the campaign: one ticket for every paid purchase through the link) -->
            <p class="promo">
              <svg class="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M20 7h-2.2A3 3 0 0 0 12 3.8 3 3 0 0 0 6.2 7H4a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h7V7h2v5h7a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1Zm-11-.1a1.1 1.1 0 1 1 2-.6V7H9.5a1 1 0 0 1-.5-.1ZM15 7h-2v-.7A1.1 1.1 0 1 1 15 7ZM4 13.5V20a1 1 0 0 0 1 1h6v-7.5H4Zm9 7.5h6a1 1 0 0 0 1-1v-6.5h-7V21Z"/></svg>
              <span>כל רכישה דרך הקישור האישי = כרטיס להגרלה על <b>{{ campaign()?.prize || '888 ₪' }}</b>!</span>
            </p>
            <p class="draw">ההגרלה: יום ראשון, ג׳ בטבת תשפ״ז, 13.12.2026, 20:00</p>
          } @else {
            <p class="lead">צרו קישור אישי ושתפו אותו עם חברים ומכרים.</p>
          }
        </div>
        @if (campaignOn()) {
          <px-prize-gift class="share-gift" [amount]="campaign()?.prize || '888 ₪'" />
        }
        <span class="share-brand gold-title" aria-hidden="true">PORTAL X</span>
      </section>

      <section class="hero" aria-labelledby="hero-title">
        <div class="hero-text">
          <span class="kicker">חדרי בריחה תלת־ממדיים · חוויה קבוצתית</span>
          <h1 id="hero-title">בוחרים את ההרפתקה שלכם</h1>
          <span class="divider" aria-hidden="true"><i></i></span>
          <p class="pitch">חדרי בריחה תלת־ממדיים מלאי חידות, חפצים ומנגנונים. חוקרים, מפענחים רמזים ופותרים אתגרים יחד — כל קבוצה יוצאת למסע משלה.</p>
          <a class="btn hero-cta" href="#games" (click)="scrollTo($event, 'games')">למשחקים <span class="arrow" aria-hidden="true">←</span></a>
        </div>
        <figure class="hero-art">
          <img src="img/home/hero-explorers.webp" width="760" height="309" fetchpriority="high"
            alt="ארבעה ילדים חוקרים מפה עתיקה בספרייה מסתורית, ומאחוריהם שער קסום זוהר בכחול" />
          <!-- soft living light: the gate's glow, warm lamplight and a few drifting sparks (calm with reduced motion) -->
          <span class="gate-glow" aria-hidden="true"></span>
          <span class="lamp-glow" aria-hidden="true"></span>
          <span class="sparks" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>
        </figure>
      </section>

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
                      @if (p.saleState === 'scheduled') { <span class="sale-soon">הרכישה תיפתח ב־{{ p.saleOpensLabel }}</span> }
                      @else if (p.saleState === 'paused') { <span class="sale-soon">המכירה מושהית כרגע</span> }
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

      <px-how-it-works [freeGameId]="freeGameId()" />


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
        <a routerLink="/info/terms">ביטולים והחזרים</a>
        <a routerLink="/info/contact">יצירת קשר</a>
        <a routerLink="/info/about">על PORTAL X</a>
        <a routerLink="/share">יצירת קישור אישי</a>
      </nav>
      <p class="contact">יצירת קשר: <a [href]="'mailto:' + site.info().contactEmail" dir="ltr">{{ site.info().contactEmail }}</a></p>
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
    main, footer { position:relative; z-index:1; max-width:1200px; margin:0 auto; padding-inline:16px; }
    /* ---- top navigation: one calm bar; on phones a menu */
    .top { position:sticky; top:0; z-index:5; background:rgba(8,13,34,.82); backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px);
      border-bottom:1px solid rgba(224,185,92,.18); }
    .bar { max-width:1200px; margin:0 auto; padding:10px 16px; display:flex; align-items:center; gap:1.5rem; }
    .brand { font-weight:900; letter-spacing:.06em; font-size:1.55rem; text-decoration:none; direction:ltr; white-space:nowrap; }
    .links { display:flex; align-items:center; gap:1.6rem; }
    .links a { color:var(--text); text-decoration:none; font-weight:600; padding:.3rem 0; border-bottom:2px solid transparent; transition:color .2s, border-color .2s; }
    .links a:hover, .links a:focus-visible { color:var(--gold-2); border-bottom-color:var(--gold); }
    .links a:first-child { color:var(--gold-2); }
    .actions { margin-inline-start:auto; display:flex; align-items:center; gap:.6rem; }
    .actions .btn { display:inline-flex; align-items:center; gap:.45rem; border-radius:999px; }
    .code-btn { border-color:rgba(224,185,92,.6); }
    .ico { width:1.15em; height:1.15em; flex-shrink:0; color:var(--gold-2); }
    .menu-btn { display:none !important; width:44px; height:44px; padding:0; justify-content:center; }
    .burger { position:relative; width:20px; height:14px; display:block; }
    .burger i { position:absolute; inset-inline:0; height:2px; border-radius:2px; background:var(--gold-2); transition:transform .25s, opacity .2s; }
    .burger i:nth-child(1) { top:0; } .burger i:nth-child(2) { top:6px; } .burger i:nth-child(3) { top:12px; }
    .burger.x i:nth-child(1) { transform:translateY(6px) rotate(45deg); } .burger.x i:nth-child(2) { opacity:0; }
    .burger.x i:nth-child(3) { transform:translateY(-6px) rotate(-45deg); }
    .mobile-menu { display:flex; flex-direction:column; padding:.4rem 16px 1rem; border-top:1px solid var(--line); }
    .mobile-menu a, .mobile-menu button { display:flex; align-items:center; gap:.5rem; min-height:48px; padding:.2rem .4rem; color:var(--text);
      text-decoration:none; font:inherit; font-weight:700; font-size:1.05rem; background:none; border:0; border-bottom:1px solid var(--line); text-align:start; cursor:pointer; }
    .mobile-menu a:hover, .mobile-menu button:hover { color:var(--gold-2); }

    /* ---- hero: text on the right, the illustration on the left (RTL), real elements over a real picture */
    .hero { display:grid; grid-template-columns:minmax(0, 5fr) minmax(0, 7fr); align-items:center; gap:clamp(1rem, 3vw, 2.5rem);
      padding-block:clamp(1.5rem, 4vw, 3.5rem) clamp(1.5rem, 3vw, 2.5rem); }
    .hero-text { display:flex; flex-direction:column; align-items:flex-start; }
    .hero-text > * { animation:rise .8s cubic-bezier(.2,.7,.2,1) both; }
    .hero-text > :nth-child(2) { animation-delay:.08s; } .hero-text > :nth-child(3) { animation-delay:.16s; }
    .hero-text > :nth-child(4) { animation-delay:.24s; } .hero-text > :nth-child(5) { animation-delay:.32s; }
    @keyframes rise { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:none; } }
    .kicker { color:#9cc4ff; font-weight:700; letter-spacing:.02em; font-size:1rem; }
    h1 { font-family:var(--font-title); font-weight:900; font-size:clamp(2.3rem, 5.2vw, 4.2rem); line-height:1.08; margin:.25em 0 .15em; max-width:12ch;
      background:linear-gradient(180deg, #fff1c4 0%, #f6d78d 38%, #e0b95c 70%, #b98a34 100%); -webkit-background-clip:text; background-clip:text; color:transparent;
      filter:drop-shadow(0 2px 10px rgba(224,185,92,.18)); text-wrap:balance; }
    .divider { position:relative; display:block; width:min(320px, 80%); height:14px; margin:.2rem 0 .9rem; }
    .divider::before { content:''; position:absolute; inset-inline:0; top:6px; height:1px;
      background:linear-gradient(90deg, transparent, var(--gold) 20%, var(--gold) 80%, transparent); }
    .divider i { position:absolute; inset-inline-start:50%; top:2px; width:9px; height:9px; transform:translateX(50%) rotate(45deg);
      background:var(--bg); border:1px solid var(--gold-2); box-shadow:0 0 8px rgba(246,215,141,.6); }
    .pitch { font-size:clamp(1.05rem, 1.4vw, 1.2rem); line-height:1.75; color:#ece5d3; margin:0 0 1.6rem; max-width:34ch; }
    .hero-cta { display:inline-flex; align-items:center; justify-content:center; gap:.7rem; min-height:56px; padding:.8em 2.6em; font-size:1.2rem; font-weight:900;
      border-radius:999px; border:1px solid #ffe7a3; color:#2a1606; text-decoration:none; cursor:pointer;
      background:linear-gradient(180deg, #ffe7a3 0%, #f2c96a 45%, #d9a645 100%);
      box-shadow:0 8px 24px rgba(0,0,0,.35), 0 0 0 1px rgba(255,231,163,.25), inset 0 1px 0 rgba(255,255,255,.55);
      transition:transform .18s ease, box-shadow .18s ease, filter .18s ease; }
    .hero-cta:hover { transform:translateY(-2px); filter:brightness(1.05); box-shadow:0 12px 30px rgba(0,0,0,.4), 0 0 24px rgba(246,215,141,.35), inset 0 1px 0 rgba(255,255,255,.55); }
    .hero-cta:active { transform:translateY(1px) scale(.98); box-shadow:0 4px 12px rgba(0,0,0,.35); }
    .hero-cta:focus-visible { outline:3px solid #fff1c4; outline-offset:3px; }
    .hero-cta .arrow { font-size:1.3em; line-height:1; transition:transform .18s ease; }
    .hero-cta:hover .arrow { transform:translateX(-4px); }
    .hero-art { position:relative; margin:0; aspect-ratio:760 / 309; border-radius:20px; overflow:hidden;
      box-shadow:0 20px 50px rgba(0,0,0,.5), 0 0 0 1px rgba(224,185,92,.28);
      animation:rise 1s ease both .1s; }
    .hero-art img { width:100%; height:100%; display:block; object-fit:cover; }
    /* the picture fades into the page towards the text, so the two halves read as one scene */
    .hero-art::after { content:''; position:absolute; inset:0; pointer-events:none;
      background:linear-gradient(90deg, transparent 72%, rgba(7,11,28,.55) 100%), linear-gradient(0deg, rgba(7,11,28,.35), transparent 30%); }
    .gate-glow { position:absolute; left:76%; top:6%; width:16%; height:60%; border-radius:50% 50% 12% 12%; pointer-events:none; mix-blend-mode:screen;
      background:radial-gradient(closest-side, rgba(120,190,255,.55), rgba(90,150,255,.18) 60%, transparent);
      animation:gate 6s ease-in-out infinite; }
    @keyframes gate { 0%, 100% { opacity:.45; transform:scale(1); } 50% { opacity:.9; transform:scale(1.06); } }
    .lamp-glow { position:absolute; left:1%; top:48%; width:16%; height:44%; pointer-events:none; mix-blend-mode:screen;
      background:radial-gradient(closest-side, rgba(255,170,70,.45), transparent); animation:lamp 4.5s ease-in-out infinite; }
    @keyframes lamp { 0%, 100% { opacity:.55; } 45% { opacity:.85; } 60% { opacity:.65; } }
    .sparks i { position:absolute; bottom:-6px; width:4px; height:4px; border-radius:50%; background:#ffe7a3; box-shadow:0 0 6px 2px rgba(255,214,120,.7);
      opacity:0; animation:spark 9s linear infinite; }
    .sparks i:nth-child(1) { left:12%; animation-delay:0s; } .sparks i:nth-child(2) { left:28%; animation-delay:1.6s; }
    .sparks i:nth-child(3) { left:44%; animation-delay:3.1s; } .sparks i:nth-child(4) { left:58%; animation-delay:4.4s; }
    .sparks i:nth-child(5) { left:70%; animation-delay:5.8s; } .sparks i:nth-child(6) { left:86%; animation-delay:7s; }
    .sparks i:nth-child(7) { left:35%; animation-delay:8.1s; width:3px; height:3px; }
    @keyframes spark { 0% { opacity:0; transform:translateY(0); } 15% { opacity:.9; } 80% { opacity:.5; } 100% { opacity:0; transform:translate(10px, -230px); } }
    @media (prefers-reduced-motion: reduce) {
      .hero-text > *, .hero-art { animation:none; }
      .gate-glow { animation:none; opacity:.6; } .lamp-glow { animation:none; opacity:.6; } .sparks { display:none; }
      .hero-cta, .hero-cta .arrow, .burger i, .links a { transition:none; }
    }
    .big { font-size:1.15rem; padding:.85em 2em; }
    h2 { font-family:var(--font-title); font-size:2rem; margin:0 0 1rem; }
    .games { padding-block:1rem 2rem; scroll-margin-top:84px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); gap:1.25rem; }
    .product { position:relative; }
    .product.free { border-color: var(--gold); box-shadow: 0 0 0 1px rgba(224,185,92,.4), var(--shadow); }
    .ribbon { position:absolute; top:12px; inset-inline-start:12px; z-index:2; background:linear-gradient(180deg,#ffe08a,#c9a24d); color:#2a1606;
      font-weight:900; padding:.25rem .8rem; border-radius:999px; box-shadow:0 4px 14px rgba(0,0,0,.4); }
    /* the questions stand in the middle of the page on a computer, as a centered column */
    .faq { padding-block:1rem 2.5rem; scroll-margin-top:84px; max-width:860px; margin-inline:auto; }
    .faq > h2 { text-align:center; }
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
    .product:hover .cover img { transform:scale(1.04); }
    .product { transition:transform .25s ease, box-shadow .25s ease, border-color .25s ease; }
    .product:hover { transform:translateY(-4px); border-color:rgba(224,185,92,.55); box-shadow:0 18px 40px rgba(0,0,0,.45); }
    @media (prefers-reduced-motion: reduce) { .product, .cover img { transition:none; } .product:hover { transform:none; } }
    .body { padding:1.1rem 1.25rem 1.25rem; display:flex; flex-direction:column; gap:.6rem; flex:1; }
    h3 { margin:0; font-family:var(--font-title); font-size:1.7rem; }
    h3 a { color:var(--text); text-decoration:none; }
    .tagline { margin:0; color:var(--muted); line-height:1.6; }
    .features { list-style:none; padding:0; margin:.2rem 0; display:flex; flex-wrap:wrap; gap:.4rem; }
    .buy { margin-top:auto; display:flex; align-items:center; justify-content:space-between; gap:1rem; flex-wrap:wrap; padding-top:.6rem; border-top:1px solid var(--line); }
    .price { display:flex; flex-direction:column; }
    .price b { font-size:1.8rem; color:var(--gold-2); line-height:1.1; }
    .price span { font-size:.9rem; color:var(--muted); }
    .price .sale-soon { display:block; color:var(--gold-2); font-weight:700; }
    /* the personal-link banner: slim, navy and gold, a thin glowing frame; never taller than about 160px on a computer */
    .share { display:grid; align-items:center; gap:clamp(.55rem, 1vw, 1rem); margin-block:1rem 0; padding:.6rem clamp(.7rem, 1.3vw, 1.1rem);
      grid-template-columns: auto minmax(0, 1fr) auto; grid-template-areas: "cta text brand";
      border-radius:18px; border:1px solid rgba(240,200,110,.75); color:#fbf3e4;
      background: radial-gradient(circle at 20% 50%, rgba(244,184,74,.14), transparent 35%), linear-gradient(90deg, #0b1435, #111c44 50%, #0b1435);
      box-shadow: 0 0 0 3px rgba(240,200,110,.07), 0 0 18px rgba(240,200,110,.22), 0 10px 26px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,230,160,.15); }
    .share.with-prize { grid-template-columns: auto auto minmax(0, 1fr) auto auto; grid-template-areas: "cta timer text gift brand"; }
    .share-cta { grid-area:cta; }
    .share-timer { grid-area:timer; }
    .share-text { grid-area:text; min-width:0; display:flex; flex-direction:column; gap:.25rem; padding-inline-start:clamp(.4rem, 1vw, .9rem); }
    .share-gift { grid-area:gift; width:clamp(80px, 7vw, 100px); }
    .share-brand { grid-area:brand; font-size:clamp(1.1rem, 1.5vw, 1.45rem); font-weight:800; letter-spacing:.04em; white-space:nowrap; filter: drop-shadow(0 2px 6px rgba(0,0,0,.5)); }
    /* a thin gold line between the text and the prize */
    .share.with-prize .share-text { border-inline-end:1px solid rgba(240,200,110,.45); padding-inline-end:clamp(.6rem, 1.2vw, 1.1rem); }
    .share h2 { margin:0; font-family:var(--font-title); font-weight:900; font-size:clamp(1.2rem, 1.9vw, 1.65rem); line-height:1.15;
      background: linear-gradient(180deg, #fff1bf, #f2c45a 55%, #c58d2f); -webkit-background-clip:text; background-clip:text; color:transparent;
      filter: drop-shadow(0 2px 5px rgba(0,0,0,.45)); }
    .share .ico { width:1.3em; height:1.3em; flex-shrink:0; }
    .share .promo { margin:0; display:flex; align-items:center; gap:.45rem; color:#f6eedf; font-weight:700; font-size:clamp(.88rem, 1.05vw, 1rem); line-height:1.35; }
    .share .promo .ico { color:var(--gold-2); }
    .share .promo b { color:var(--gold-2); font-weight:900; white-space:nowrap; }
    .share .draw { margin:0; color:#b9b4a8; font-size:.8rem; }
    .share .lead { margin:0; color:#e8e1d2; font-size:.95rem; }
    .share-cta { display:inline-flex; align-items:center; justify-content:center; gap:.5rem; min-height:54px; max-width:11.5em; padding:.5rem 1.1rem; border-radius:999px; text-align:center;
      border:1px solid #fff0c0; color:#14193a; font-weight:900; font-size:clamp(.95rem, 1.1vw, 1.08rem); line-height:1.2; text-decoration:none;
      background: linear-gradient(180deg, #fff0bd, #f3c75e 50%, #d8a03c); box-shadow: 0 0 18px rgba(240,200,110,.4), 0 6px 14px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.7);
      transition: transform .18s ease, box-shadow .18s ease, filter .18s ease; }
    .share-cta .ico { color:#14193a; width:1.35em; height:1.35em; }
    .share-cta:hover { transform:translateY(-1px); filter:brightness(1.07); box-shadow: 0 0 26px rgba(240,200,110,.55), 0 8px 18px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.7); }
    .share-cta:active { transform:translateY(1px) scale(.98); filter:brightness(.97); }
    .share-cta:focus-visible { outline:3px solid #fff3c4; outline-offset:3px; }
    @media (prefers-reduced-motion: no-preference) { .share { animation: share-in .6s ease both; } }
    @keyframes share-in { from { opacity:0; transform: translateY(6px) } }
    /* narrower computers: the logo steps aside (the page header already shows it) */
    @media (max-width: 1360px) {
      .share { grid-template-columns: auto minmax(0, 1fr); grid-template-areas: "cta text"; }
      .share.with-prize { grid-template-columns: auto auto minmax(0, 1fr) auto; grid-template-areas: "cta timer text gift"; }
      .share-brand { display:none; }
    }
    /* tablet: two short rows — the text and the prize, then the countdown and the button */
    @media (max-width: 1000px) {
      .share.with-prize { grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "text gift" "timer cta"; row-gap:.6rem; }
      .share.with-prize .share-text { border:0; padding:0; }
      .share-timer { justify-self:start; }
    }
    /* phone: the title and offer with a small prize beside them, then the countdown, then a full-width button */
    @media (max-width: 640px) {
      .share, .share.with-prize { grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "text gift" "timer timer" "cta cta"; gap:.55rem; margin-top:.7rem; padding:.7rem .75rem .8rem; border-radius:16px; }
      .share:not(.with-prize) { grid-template-areas: "text text" "cta cta"; }
      .share-gift { width:62px; }
      .share-timer { justify-self:stretch; }
      .share h2 { font-size:clamp(1.02rem, 5.2vw, 1.25rem); white-space:nowrap; }
      .share-text { gap:.2rem; }
      .share .promo { align-items:flex-start; font-size:.9rem; line-height:1.3; }
      .share-cta { width:100%; max-width:none; min-height:48px; }
    }
    footer nav { display:flex; justify-content:center; flex-wrap:wrap; gap:.4rem 1.4rem; }
    footer a { color:var(--text); }
    footer .contact { margin:.8rem 0 .2rem; text-align:center; } footer .contact a { color:var(--gold-2); font-weight:700; }
    .small { font-size:.85rem; }
    .center { text-align:center; }
    @media (max-width: 1060px) { .links { gap:1rem; } .bar { gap:1rem; } }
    @media (max-width: 960px) {
      /* tablets: the picture on top at full width, the text under it */
      .hero { grid-template-columns:1fr; }
      .hero-art { order:-1; }
      .hero-text { align-items:center; text-align:center; }
      h1 { max-width:none; } .pitch { max-width:40ch; }
      .divider i { inset-inline-start:50%; }
    }
    @media (max-width: 860px) {
      .links, .wide-only { display:none !important; }
      .menu-btn { display:inline-flex !important; }
    }
    @media (max-width: 760px) {
      .grid { grid-template-columns:1fr; }
      .hero { padding-block:1rem 1.75rem; gap:1.1rem; }
      .hero-art { border-radius:16px; }
      .hero-cta { width:100%; max-width:420px; }
    }
    @media (max-width: 420px) {
      .brand { font-size:1.25rem; }
      .code-btn span { display:none; } .code-btn { width:44px; height:44px; padding:0; justify-content:center; }
      .code-btn .ico { width:1.4em; height:1.4em; }
    }
  `],
})
export class HomePage {
  private api = inject(ApiService);
  private audio = inject(AudioService);
  private adminApi = inject(AdminApiService);
  site = inject(SiteService);
  /** The admin button appears only for a verified admin session (the server decides). */
  isAdmin = signal(false);
  products = signal<Product[]>([]);
  /** The free trial game, for the "want to try first?" box of how it works. */
  freeGameId = computed(() => this.products().find((p) => p.isFree)?.id ?? 'gate-of-secrets');
  loading = signal(true);
  error = signal<string | null>(null);
  showSettings = signal(false);
  menuOpen = signal(false);
  faq = signal<FaqEntryView[]>([]);
  /** The friend-brings-a-friend draw is summed up in the personal-link banner while the campaign is on. */
  campaignOn = signal(false);
  /** The campaign settings, for the countdown to the draw inside the personal-link card. */
  campaign = signal<Campaign | null>(null);
  openFaq = signal<string | null>(null);
  price = formatPrice;
  players = playersLabel;

  constructor() {
    this.audio.setMusic('home');
    this.load();
    this.site.load();
    this.api.faq().then((f) => this.faq.set(f)).catch(() => {});
    this.api.campaign().then((c) => { this.campaign.set(c); this.campaignOn.set(c.enabled); }).catch(() => {});
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
    return p.isFree ? 'לשחק בחינם' : p.id === 'hanukkah-oil' ? 'לפרטים ולרכישה' : 'לפרטים ולרכישה';
  }

  toggleFaq(id: string) {
    this.openFaq.set(this.openFaq() === id ? null : id);
  }

  scrollTo(ev: Event, id: string) {
    ev.preventDefault();
    this.menuOpen.set(false);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
