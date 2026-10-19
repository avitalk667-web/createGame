import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, inject, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiService, sessionStore } from '../core/api.service';
import { AudioService } from '../core/audio.service';
import { ScenarioSummary } from '../core/models';
import { SettingsService } from '../core/settings.service';
import { GameWorld } from '../world/world';
import { IconComponent } from '../ui/icon.component';
import { SettingsPanelComponent } from '../ui/settings-panel.component';

/** Step 1 — home: game name, short pitch, the "start adventure" button, the featured adventure (spec §4). */
@Component({
  selector: 'px-home',
  imports: [RouterLink, IconComponent, SettingsPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bg"><canvas #c aria-hidden="true"></canvas><div class="shade"></div></div>
    <main>
      <header class="top">
        <span class="brand gold-title">PORTAL X</span>
        <button class="btn small ghost" (click)="showSettings.set(true)">הגדרות</button>
      </header>

      <section class="hero">
        <h1><span class="gold-title">PORTAL X</span></h1>
        <p class="sub">חדר בריחה קולנועי, דיגיטלי ורב־משתתפים</p>
        <p class="pitch">קבוצה של 4–8 חברים, כל אחד מהבית או יחד בחדר אחד. חוקרים אחוזה עתיקה בתלת־ממד, פותרים חידות שמחייבות שיתוף פעולה — ופותחים את הפורטל לפני שייסגר.</p>
        <div class="actions">
          <button class="btn primary big" (click)="create()" [disabled]="busy()">
            {{ busy() ? 'יוצרים חדר...' : 'התחלת הרפתקה' }} <span aria-hidden="true">‹</span>
          </button>
        </div>
        <form class="join" (submit)="$event.preventDefault(); join()">
          <label for="code">יש לכם קוד חדר?</label>
          <div class="row">
            <input id="code" [value]="code()" (input)="code.set($any($event.target).value.toUpperCase())" maxlength="8"
              placeholder="7G3KQ2" autocomplete="off" dir="ltr" />
            <button class="btn" type="submit" [disabled]="code().trim().length < 4">הצטרפות</button>
          </div>
        </form>
        @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
      </section>

      <section class="featured card">
        <div class="feat-img"><img src="img/concept-hunt.jpg" alt="ארבעה בנים עם כיפות וחולצות לבנות חוקרים ספרייה עתיקה לאור פנסים" /></div>
        <div class="feat-body">
          <span class="chip">ההרפתקה הראשונה</span>
          <h2>{{ scenario()?.name ?? 'הפורטל האחרון' }}</h2>
          <p>{{ scenario()?.description ?? 'הקבוצה נכנסת לאחוזה מסתורית ומקבלת הודעה מדמות שומרת: פורטל עתיק עומד להיסגר.' }}</p>
          <ul class="facts">
            <li><px-icon name="hint" [size]="18" /> {{ scenario()?.durationMinutes ?? '25–35' }} דקות</li>
            <li><px-icon name="compass" [size]="18" /> {{ scenario()?.minPlayers ?? 4 }}–{{ scenario()?.maxPlayers ?? 8 }} משתתפים</li>
            <li><px-icon name="dial" [size]="18" /> רמת קושי: {{ scenario()?.difficulty ?? 'בינונית' }}</li>
            <li><px-icon name="portal" [size]="18" /> 6 אזורים · 6 סוגי חידות</li>
          </ul>
        </div>
      </section>

      <section class="how">
        <h2>איך זה עובד?</h2>
        <ol>
          <li><b>יוצרים חדר</b><span>מקבלים קישור וקוד ושולחים לחברים.</span></li>
          <li><b>בוחרים דמות</b><span>כל משתתף בוחר כינוי ודמות ומסמן „מוכן”.</span></li>
          <li><b>יוצאים לדרך</b><span>סצנת פתיחה, חקירה, חידות משותפות — ופתיחת הפורטל!</span></li>
        </ol>
        <p class="muted">עובד בדפדפן במחשב ובטלפון. לא צריך מצלמה או מיקרופון, ולא צריך להירשם.</p>
      </section>

      <footer>
        <a routerLink="/info/privacy">מדיניות פרטיות</a> · <a routerLink="/info/terms">תנאי שימוש</a> · <a routerLink="/info/about">על המשחק</a>
      </footer>
    </main>
    @if (showSettings()) { <px-settings (close)="showSettings.set(false)" /> }
  `,
  styles: [`
    :host { display:block; min-height:100dvh; position:relative; }
    .bg { position:fixed; inset:0; z-index:0; }
    .bg canvas { width:100%; height:100%; display:block; }
    .shade { position:absolute; inset:0; background: linear-gradient(90deg, rgba(7,11,28,.15), rgba(7,11,28,.55) 55%, rgba(7,11,28,.92)); }
    main { position:relative; z-index:1; max-width: 1100px; margin: 0 auto; padding: 16px 16px 40px; }
    .top { display:flex; justify-content:space-between; align-items:center; }
    .brand { font-weight: 900; letter-spacing: .08em; font-size: 1.2rem; }
    .hero { min-height: 72dvh; display:flex; flex-direction:column; justify-content:center; max-width: 560px; }
    h1 { font-size: clamp(3rem, 10vw, 6rem); letter-spacing: .04em; margin:0; font-family: var(--font-title); font-weight: 900; direction:ltr; text-align:right; }
    .sub { font-size: clamp(1.2rem, 3vw, 1.7rem); color: var(--gold-2); font-family: var(--font-title); margin: .2em 0 .8em; }
    .pitch { font-size: 1.1rem; line-height: 1.7; color: #e6e0cf; }
    .actions { margin: 1.4rem 0 1.2rem; } .big { font-size: 1.25rem; padding: .9em 2.2em; }
    .join label { font-weight:700; display:block; margin-bottom:.35rem; }
    .join .row { display:flex; gap:.5rem; } .join input { width: 200px; letter-spacing: .15em; font-weight: 700; text-align:center; }
    .featured { display:grid; grid-template-columns: 1fr 1.2fr; gap: 1.2rem; align-items:center; margin-top: 1rem; }
    .feat-img img { width:100%; border-radius: 12px; display:block; border:1px solid var(--line); }
    .facts { list-style:none; padding:0; display:grid; grid-template-columns: 1fr 1fr; gap:.4rem; color: var(--gold-2); }
    .facts li { display:flex; align-items:center; gap:.4rem; }
    .how { margin-top: 2.5rem; } .how ol { list-style:none; padding:0; display:grid; grid-template-columns: repeat(3,1fr); gap: 1rem; counter-reset: s; }
    .how li { background: var(--panel); border:1px solid var(--line); border-radius: 14px; padding: 1rem; counter-increment: s; display:flex; flex-direction:column; gap:.3rem; }
    .how li::before { content: counter(s); font-family: var(--font-title); font-size: 2rem; color: var(--gold); font-weight:900; }
    footer { margin-top: 2rem; text-align:center; color: var(--muted); }
    @media (max-width: 760px) {
      .featured { grid-template-columns: 1fr; } .how ol { grid-template-columns: 1fr; }
      .shade { background: rgba(7,11,28,.7); } .join input { width: 100%; flex:1; }
    }
  `],
})
export class HomePage implements AfterViewInit, OnDestroy {
  private api = inject(ApiService);
  private router = inject(Router);
  private audio = inject(AudioService);
  private settings = inject(SettingsService);
  private canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('c');
  private world?: GameWorld;
  scenario = signal<ScenarioSummary | null>(null);
  busy = signal(false);
  error = signal<string | null>(null);
  code = signal('');
  showSettings = signal(false);

  constructor() {
    this.api.scenarios().then((s) => this.scenario.set(s[0] ?? null)).catch(() => {});
    this.audio.setMusic('home');
  }

  ngAfterViewInit() {
    try {
      const q = this.settings.settings().quality === 'high' ? 'medium' : this.settings.settings().quality;
      this.world = new GameWorld(this.canvas().nativeElement, q);
      this.world.build(null);
      this.world.setMode('showcase');
      this.world.start();
    } catch {
      // WebGL unavailable: the page still works with the dark background.
    }
  }

  async create() {
    this.audio.unlock();
    this.audio.sfx('click');
    this.busy.set(true);
    this.error.set(null);
    try {
      const r = await this.api.createRoom(this.scenario()?.id ?? 'last-portal');
      sessionStore.setHostClaim(r.code, r.hostClaim);
      await this.router.navigate(['/join', r.code]);
    } catch (e: any) {
      this.error.set(e.message);
    } finally {
      this.busy.set(false);
    }
  }

  join() {
    const c = this.code().trim().replace(/[\s-]/g, '');
    if (c) this.router.navigate(['/join', c]);
  }

  ngOnDestroy() {
    this.world?.dispose();
  }
}
