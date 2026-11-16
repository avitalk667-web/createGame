import { ChangeDetectionStrategy, Component, ElementRef, NgZone, OnDestroy, OnInit, computed, effect, inject, isDevMode, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiError, ApiService } from '../core/api.service';
import { AudioService } from '../core/audio.service';
import { Product, formatPreviousPrice, formatPrice, playersLabel } from '../core/models';
import { SettingsService } from '../core/settings.service';
import { JoystickComponent } from '../ui/joystick.component';
import { DEMO_ITEMS, DEMO_SPOTS, DemoSpot, DemoSpotId } from './demo-content';
import { DemoApi, DemoState, demoDevice } from './demo.api';
import { DemoInspectComponent } from './demo-inspect.component';
import { DemoKeypadComponent, KeypadStatus } from './demo-keypad.component';
import { DemoWorld } from './demo-world';

type Phase = 'gate' | 'loading' | 'play' | 'error';
type ItemId = (typeof DEMO_ITEMS)[number];

/**
 * "טעימה מהפורטל" — the free taste (route /demo): a short opening screen, the locked room in 3D, the keypad and two hints,
 * and the door opening onto the success screen. No sign-up, no payment, no server game room. The session (what was examined,
 * hints, attempts, completion) is kept on the server under an HttpOnly cookie, so a refresh or a later visit continues it;
 * the code is checked there, never here.
 */
@Component({
  selector: 'px-demo-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, JoystickComponent, DemoInspectComponent, DemoKeypadComponent],
  template: `
    <div class="stage" [class.hidden]="phase() === 'gate'"><canvas #canvas aria-label="החדר הנעול בתלת־ממד"></canvas></div>

    @switch (phase()) {
      @case ('gate') {
        <section class="gate" aria-labelledby="gate-title">
          <div class="gate-glow" aria-hidden="true"></div>
          <div class="gate-card">
            <p class="kicker">טעימה מהפורטל</p>
            <h1 id="gate-title" class="gold-title">הפורטל נפתח בפניכם...</h1>
            <p class="lead">אתם עומדים להיכנס לחדר מסתורי. הדלת מאחוריכם ננעלה, ורק מי שיצליח לחשוף את הסוד יוכל לצאת.</p>
            @if (resume(); as r) {
              <p class="resume">{{ r.completed ? 'כבר פתחתם את השער בטעימה הזו.' : 'ממשיכים מאיפה שהפסקתם: ' + r.inspected.length + ' מתוך 4 סימנים נמצאו.' }}</p>
            }
            <button class="btn primary enter" (click)="enter()">{{ resume()?.completed ? 'חזרה לחדר הפתוח' : resume() ? 'המשך בחדר' : 'כניסה לחדר' }}</button>
            <p class="muted small">טעימה חינמית · כ־3–5 דקות · ללא הרשמה</p>
          </div>
          <a routerLink="/" class="home-link">חזרה לדף הבית</a>
        </section>
      }
      @case ('loading') {
        <section class="loading" role="status" aria-live="polite">
          <p class="gold-title">פותחים את הדלת לחדר…</p>
          <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="pct()"><span [style.width.%]="pct()"></span></div>
          <small class="muted">{{ pct() }}%</small>
        </section>
      }
      @case ('error') {
        <section class="loading" role="alert">
          <p>לא הצלחנו להציג את החדר במכשיר הזה.</p>
          <p class="muted small">אפשר לנסות שוב, או לחזור לדף הבית ולגלות את המשחקים המלאים.</p>
          <div class="row"><button class="btn primary" (click)="retry()">לנסות שוב</button><a class="btn" routerLink="/">לדף הבית</a></div>
        </section>
      }
      @case ('play') {
        <header class="hud-top">
          <div class="title card">
            <b>החדר הנעול</b>
            <span class="found" aria-label="פריטים שנבדקו">
              @for (id of items; track id) {
                <button class="item" [class.on]="inspected().has(id)" [disabled]="!inspected().has(id)" (click)="open(id)"
                  [attr.aria-label]="inspected().has(id) ? 'הצגה חוזרת: ' + label(id) : 'עוד לא נמצא'">{{ emoji[id] }}</button>
              }
            </span>
          </div>
          <div class="tools">
            @if (!completed()) { <button class="btn small" (click)="openHints()" aria-label="רמזים">💡 רמז</button> }
            <button class="btn small" (click)="showHelp.set(!showHelp())" aria-label="איך משחקים">?</button>
            <a class="btn small" routerLink="/" aria-label="יציאה מהטעימה">יציאה</a>
          </div>
        </header>

        @if (!playing()) { <button class="btn small skip" (click)="world?.skipIntro()">דילוג ›</button> }
        @if (!introDone()) {
          <div class="mission" aria-live="polite">
            <b>הסוד שמאחורי השעון</b>
            <span>חקרו את החדר, מצאו את ארבעת הסימנים ופתחו את הדלת.</span>
          </div>
        }

        @if (focus(); as f) { @if (!panelOpen()) {
          <div class="prompt" aria-live="polite">
            @if (!touch) { <kbd>E</kbd> }{{ f.verb }} {{ f.label }}
          </div>
        } }
        @if (toast(); as t) { <div class="toast" role="status">{{ t }}</div> }

        @if (showHelp()) {
          <section class="help card" aria-label="איך משחקים">
            <b>איך משחקים</b>
            <ul>
              @if (touch) {
                <li>הזיזו את הדמות עם הג׳ויסטיק, וגררו על המסך כדי להסתובב.</li>
                <li>כשמתקרבים לחפץ מופיע כפתור — לחצו עליו כדי לבדוק.</li>
              } @else {
                <li>תנועה: W A S D או החיצים · סיבוב: גרירה עם העכבר.</li>
                <li>התקרבו לחפץ זוהר ולחצו E, או לחצו עליו בעכבר.</li>
              }
              <li>בדקו את ארבעת החפצים, הבינו את הסדר והזינו את הקוד ליד הדלת.</li>
            </ul>
            <button class="btn small primary" (click)="showHelp.set(false)">הבנתי</button>
          </section>
        }

        @if (touch && playing() && !panelOpen() && !opening()) {
          <px-joystick class="joy" (changed)="world?.setJoystick($event.x, $event.y)" />
          <button class="btn primary act" [disabled]="!focus()" (click)="world?.interactNearest()" [attr.aria-label]="focus() ? focus()!.verb + ' ' + focus()!.label : 'אין חפץ קרוב'">
            {{ focus() ? '🔍 ' + focus()!.button : '🔍' }}
          </button>
        }

        @if (inspecting(); as id) { <px-demo-inspect [item]="id" (closed)="closeInspect()" /> }

        @if (keypad()) {
          <px-demo-keypad [status]="padStatus()" [message]="padMessage()" [locked]="padLocked()"
            (submitted)="tryCode($event)" (edited)="padEdited()" (hint)="openHints()" (closed)="closeKeypad()" />
        }

        @if (hints()) {
          <div class="overlay top" (click)="hints.set(false)">
            <section class="panel-modal note" role="dialog" aria-modal="true" aria-labelledby="hints-title" (click)="$event.stopPropagation()">
              <h2 id="hints-title" class="gold-title">רמזים</h2>
              @for (h of hintTexts(); track $index) { <p class="hint"><b>רמז {{ $index + 1 }}:</b> {{ h }}</p> }
              @empty { <p class="muted">אפשר לקבל עד שני רמזים. נסו קודם לחקור — הרמז יחכה לכם כאן.</p> }
              @if (hintTexts().length < 2) {
                <button class="btn primary" [disabled]="busy()" (click)="askHint()">{{ hintTexts().length ? 'לרמז השני' : 'קבלו רמז' }} ({{ hintTexts().length + 1 }} מתוך 2)</button>
              } @else { <p class="muted small">קיבלתם את שני הרמזים.</p> }
              @if (hintError(); as e) { <p class="err" role="alert">{{ e }}</p> }
              <button class="btn small ghost back" (click)="hints.set(false)">חזרה</button>
            </section>
          </div>
        }

        @if (success() && offer()) {
          <!-- the offer: the real games of the catalog, as the server lists them (names, pictures and prices are never set here) -->
          <div class="overlay win-bg offer-wrap">
            <section class="offer" role="dialog" aria-modal="true" aria-labelledby="offer-title">
              <p class="kicker">טעימה מהפורטל · הושלמה</p>
              <h2 id="offer-title" class="gold-title">נהניתם מהטעימה? ההרפתקה האמיתית מתחילה עכשיו!</h2>
              <p class="lead">פתרתם חידה אחת. דמיינו מה מחכה לכם במשחק מלא – חדרים מסתוריים, חידות מתוחכמות, סודות נסתרים וחוויה משותפת עם החברים או המשפחה.</p>
              @if (products(); as list) {
                @if (list.length) {
                  <h3 class="pick">בחרו את ההרפתקה הבאה שלכם</h3>
                  <div class="games">
                    @for (p of list; track p.id) {
                      <article class="game">
                        <a class="cover" [routerLink]="['/games', p.id]" [attr.aria-label]="'לצפייה במשחק ' + p.name"><img [src]="p.coverImage" [alt]="p.name" loading="lazy" (error)="$any($event.target).style.visibility = 'hidden'" /></a>
                        <div class="g-body">
                          <h4><a [routerLink]="['/games', p.id]">{{ p.name }}</a></h4>
                          <p class="tagline">{{ p.tagline }}</p>
                          <div class="g-buy">
                            <div class="g-price">
                              @if (previousPrice(p); as was) {
                                <s><span class="sr-only">מחיר קודם: </span><bdi>{{ was }}</bdi></s>
                              }
                              <b><span class="sr-only">מחיר: </span><bdi>{{ price(p) }}</bdi></b>
                              <small>{{ players(p) }}</small>
                            </div>
                            <a class="btn primary" [routerLink]="['/games', p.id]">לצפייה במשחק</a>
                          </div>
                        </div>
                      </article>
                    }
                  </div>
                }
              } @else {
                <p class="muted" role="status">טוענים את המשחקים…</p>
              }
              <div class="offer-actions">
                <a class="btn" routerLink="/" fragment="games">לצפייה בכל המשחקים</a>
                <button class="btn ghost" (click)="closeOffer()">להסתכל שוב בחדר</button>
              </div>
            </section>
          </div>
        } @else if (success()) {
          <div class="overlay win-bg">
            <section class="win" role="dialog" aria-modal="true" aria-labelledby="win-title">
              <div class="rays" aria-hidden="true"></div>
              <p class="kicker">הסוד שמאחורי השעון · נפתר</p>
              <h2 id="win-title" class="gold-title">עשיתם את זה!</h2>
              <p class="lead">פיצחתם את החידה הראשונה שלכם ופתחתם את השער. אבל זו רק ההתחלה...</p>
              <p>מאחורי הפורטל מחכים לכם חדרים נוספים, סודות נסתרים וחידות שיאתגרו אתכם ואת החברים שלכם.</p>
              @if (seconds(); as t) { <p class="time">⏱ פתרתם ב־{{ duration(t) }}</p> }
              <div class="win-actions">
                <button class="btn primary" (click)="showOffer()">בחרו את ההרפתקה הבאה שלכם</button>
                <button class="btn ghost" (click)="closeOffer()">להסתכל שוב בחדר</button>
              </div>
            </section>
          </div>
        }
      }
    }
  `,
  styles: [`
    :host { display:block; position:fixed; inset:0; overflow:hidden; background:#060a1a; direction:rtl; }
    .stage { position:absolute; inset:0; } .stage.hidden { visibility:hidden; }
    canvas { width:100%; height:100%; display:block; outline:none; touch-action:none; cursor:grab; }

    .gate { position:absolute; inset:0; display:grid; place-items:center; padding:16px; text-align:center;
      background: radial-gradient(ellipse at 50% 40%, #1b2a5c 0%, #0a1026 55%, #04060f 100%); }
    .gate-glow { position:absolute; width:min(70vw, 520px); aspect-ratio: 3/4; border-radius: 50% 50% 8px 8px / 40% 40% 8px 8px;
      background: radial-gradient(ellipse at 50% 55%, rgba(170,210,255,.55), rgba(60,110,220,.25) 45%, transparent 70%);
      filter: blur(6px); animation: breathe 5s ease-in-out infinite; }
    @keyframes breathe { 50% { transform: scale(1.05); opacity:.8; } }
    .gate-card { position:relative; max-width:560px; }
    .kicker { color: var(--gold); letter-spacing:.12em; font-weight:700; margin:0 0 .4rem; }
    h1 { font-family: var(--font-title); font-size: clamp(2rem, 7vw, 3.4rem); margin:0 0 1rem; }
    .lead { font-size: clamp(1.05rem, 3.6vw, 1.3rem); line-height:1.6; margin:0 0 1.6rem; }
    .enter { font-size:1.25rem; padding:.9em 2.4em; }
    .resume { color: var(--gold-2); margin: 0 0 .9rem; font-weight:700; }
    .home-link { position:absolute; bottom: max(16px, env(safe-area-inset-bottom)); color: var(--muted); }

    .loading { position:absolute; inset:0; display:grid; place-content:center; gap:.8rem; text-align:center; padding:16px;
      background: radial-gradient(ellipse at center, #121c40, #04060f 75%); }
    .loading .gold-title { font-family: var(--font-title); font-size:1.6rem; margin:0; }
    .bar { width:min(320px, 80vw); height:8px; border-radius:99px; background: rgba(255,255,255,.1); overflow:hidden; margin-inline:auto; }
    .bar span { display:block; height:100%; background: linear-gradient(90deg, #e0a93f, #ffe39a); transition: width .2s; }
    .row { display:flex; gap:.6rem; justify-content:center; flex-wrap:wrap; }

    .hud-top { position:fixed; top: max(10px, env(safe-area-inset-top)); inset-inline: 10px; display:flex; justify-content:space-between; gap:.5rem; z-index:10; pointer-events:none; }
    .hud-top > * { pointer-events:auto; }
    .title { display:flex; align-items:center; gap:.7rem; padding:.45rem .8rem; }
    .found { display:flex; gap:.25rem; }
    .item { width:34px; height:34px; border-radius:50%; border:1px dashed var(--line); background: rgba(0,0,0,.3); font-size:1.05rem; cursor:pointer; filter: grayscale(1); opacity:.45; padding:0; }
    .item.on { filter:none; opacity:1; border-style:solid; border-color: var(--gold); box-shadow: 0 0 10px rgba(224,185,92,.4); }
    .item:disabled { cursor:default; }
    .tools { display:flex; gap:.4rem; align-items:flex-start; }

    .mission { position:fixed; top: calc(max(10px, env(safe-area-inset-top)) + 64px); left:50%; transform:translateX(-50%); z-index:9; text-align:center;
      background: rgba(5,8,20,.72); border:1px solid var(--line); border-radius:12px; padding:.6rem 1rem; display:grid; gap:.15rem; width:max-content; max-width: calc(100vw - 32px);
      animation: fadeIn .8s ease both; }
    .mission b { color: var(--gold-2); font-family: var(--font-title); font-size:1.15rem; }
    @keyframes fadeIn { from { opacity:0; transform: translate(-50%, -6px); } }

    .prompt { position:fixed; bottom: calc(max(16px, env(safe-area-inset-bottom)) + 24px); left:50%; transform:translateX(-50%); z-index:9;
      background: rgba(0,0,0,.78); border:1px solid var(--gold); border-radius:999px; padding:.45rem 1.1rem; white-space:nowrap; pointer-events:none; font-weight:700; }
    kbd { display:inline-block; background: var(--gold); color:#1d1405; border-radius:6px; padding:0 .45em; margin-inline-end:.45em; font-family: inherit; }
    .toast { position:fixed; top:40%; left:50%; transform:translateX(-50%); z-index:12; background: rgba(0,0,0,.82); border:1px solid var(--line); border-radius:12px; padding:.6rem 1rem; max-width: calc(100vw - 32px); text-align:center; }

    .help { position:fixed; top: calc(max(10px, env(safe-area-inset-top)) + 62px); inset-inline-start: 10px; z-index:12; max-width: min(360px, calc(100vw - 20px)); }
    .help ul { padding-inline-start:1.1rem; margin:.5rem 0 .8rem; line-height:1.55; }

    .joy { position:fixed; bottom: calc(max(14px, env(safe-area-inset-bottom)) + 14px); left: 18px; z-index:11; }
    .act { position:fixed; bottom: calc(max(14px, env(safe-area-inset-bottom)) + 34px); right: 18px; z-index:11; min-width:88px; min-height:64px; border-radius:20px; font-size:1.1rem; }
    .act:disabled { opacity:.35; }
    .note { max-width:420px; text-align:center; }
    .overlay.top { z-index: 60; }
    .hint { text-align:right; line-height:1.6; background: rgba(255,255,255,.04); border:1px solid var(--line); border-radius:10px; padding:.6rem .8rem; }
    .err { color:#ffc2b5; }
    .back { margin-top:.6rem; }
    .skip { position:fixed; bottom: calc(max(14px, env(safe-area-inset-bottom)) + 20px); left:50%; transform:translateX(-50%); z-index:11; }

    .win-bg { background: radial-gradient(ellipse at 50% 40%, rgba(80,130,230,.35), rgba(3,6,16,.86) 70%); }
    .win { position:relative; max-width:560px; text-align:center; padding: 2rem 1.4rem; border-radius:22px; overflow:hidden;
      background: linear-gradient(180deg, rgba(22,32,74,.96), rgba(10,16,40,.96)); border:1px solid var(--gold); box-shadow: 0 0 60px rgba(224,185,92,.35), var(--shadow);
      animation: rise .7s cubic-bezier(.2,.9,.3,1.2) both; }
    .win > * { position:relative; }
    .rays { position:absolute !important; inset:-50%; pointer-events:none; background: conic-gradient(from 0deg, transparent 0 8%, rgba(255,214,120,.10) 10% 14%, transparent 16% 33%,
      rgba(255,214,120,.10) 35% 39%, transparent 41% 58%, rgba(255,214,120,.10) 60% 64%, transparent 66% 83%, rgba(255,214,120,.10) 85% 89%, transparent 91%);
      animation: spin 24s linear infinite; }
    .win h2 { font-family: var(--font-title); font-size: clamp(2.4rem, 9vw, 3.6rem); margin: .2rem 0 .6rem; }
    .win .lead { font-size: 1.2rem; font-weight:700; margin-bottom:.8rem; }
    .time { color: var(--gold-2); }
    .win-actions { display:flex; flex-direction:column; gap:.6rem; margin-top:1.2rem; }
    /* the offer: a scrolling page over the room, the catalog cards in a responsive grid */
    .offer-wrap { overflow-y:auto; align-items:start; padding: max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom)); }
    .offer { position:relative; width:100%; max-width:980px; margin: auto; text-align:center; padding: 1.6rem clamp(1rem, 3vw, 2rem); border-radius:22px;
      background: linear-gradient(180deg, rgba(22,32,74,.97), rgba(10,16,40,.97)); border:1px solid var(--gold); box-shadow: 0 0 60px rgba(224,185,92,.25), var(--shadow);
      animation: rise .6s cubic-bezier(.2,.9,.3,1.1) both; }
    .offer h2 { font-family: var(--font-title); font-size: clamp(1.7rem, 5.4vw, 2.6rem); line-height:1.2; margin:.2rem auto .7rem; max-width:22ch; text-wrap:balance; }
    .offer .lead { max-width:60ch; margin:0 auto 1.2rem; line-height:1.7; font-size:clamp(1rem, 2.6vw, 1.12rem); }
    .pick { font-family: var(--font-title); color: var(--gold-2); font-size:1.35rem; margin: .4rem 0 .9rem; }
    .games { display:grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); gap: 1rem; text-align:right; }
    .game { display:flex; flex-direction:column; border-radius:16px; overflow:hidden; background: rgba(255,255,255,.04); border:1px solid var(--line);
      transition: transform .2s ease, border-color .2s ease; }
    .game:hover { transform: translateY(-3px); border-color: rgba(224,185,92,.6); }
    .game .cover { display:block; aspect-ratio:16/9; background: var(--bg-2); overflow:hidden; }
    .game .cover img { width:100%; height:100%; object-fit:cover; display:block; }
    .g-body { padding: .8rem .95rem 1rem; display:flex; flex-direction:column; gap:.4rem; flex:1; }
    .g-body h4 { margin:0; font-family: var(--font-title); font-size:1.35rem; }
    .g-body h4 a { color: var(--text); text-decoration:none; }
    .tagline { margin:0; color: var(--muted); line-height:1.55; font-size:.95rem; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
    .g-buy { margin-top:auto; padding-top:.6rem; border-top:1px solid var(--line); display:flex; align-items:center; justify-content:space-between; gap:.6rem; flex-wrap:wrap; }
    .g-price { display:flex; flex-wrap:wrap; align-items:baseline; gap:0 .5rem; }
    .g-price b { font-size:1.45rem; color: var(--gold-2); }
    .g-price s { color: var(--muted); }
    .g-price small { flex-basis:100%; color: var(--muted); }
    .offer-actions { display:flex; justify-content:center; flex-wrap:wrap; gap:.6rem; margin-top:1.3rem; }
    @media (max-width: 520px) { .offer-actions .btn { flex:1 1 100%; } .g-buy .btn { flex:1 1 100%; } }
    @media (prefers-reduced-motion: reduce) { .offer, .game { animation:none; transition:none; } }
    @keyframes rise { from { opacity:0; transform: translateY(24px) scale(.94); } }
    @keyframes spin { to { transform: rotate(360deg); } }

    @media (pointer: coarse) {
      .prompt { bottom: calc(max(14px, env(safe-area-inset-bottom)) + 120px); }
    }
    @media (max-width: 520px) {
      .title b { display:none; }
      .mission { top: calc(max(10px, env(safe-area-inset-top)) + 58px); font-size:.92rem; }
      .tools .btn.small { padding-inline: .7em; }
    }
  `],
})
export class DemoPage implements OnInit, OnDestroy {
  private zone = inject(NgZone);
  private audio = inject(AudioService);
  private settings = inject(SettingsService);
  private api = inject(DemoApi);
  private catalog = inject(ApiService);
  private canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  readonly items = DEMO_ITEMS;
  readonly emoji: Record<ItemId, string> = { letter: '📜', compass: '🧭', clock: '🕰️', key: '🗝️' };
  readonly touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

  world?: DemoWorld;
  phase = signal<Phase>('gate');
  progress = signal(0);
  pct = computed(() => Math.round(this.progress() * 100));
  /** The opening flight is over and the player controls the figure. */
  playing = signal(false);
  /** The mission card has been shown long enough. */
  introDone = signal(false);
  focus = signal<DemoSpot | null>(null);
  inspected = signal<ReadonlySet<ItemId>>(new Set());
  inspecting = signal<ItemId | null>(null);
  showHelp = signal(false);
  toast = signal<string | null>(null);
  /** This browser's session found on arrival (a refresh or a later visit). */
  resume = signal<DemoState | null>(null);

  keypad = signal(false);
  padStatus = signal<KeypadStatus>('idle');
  padMessage = signal('');
  busy = signal(false);
  cooldown = signal(0);
  padLocked = computed(() => this.busy() || this.cooldown() > 0 || this.padStatus() === 'right');
  hints = signal(false);
  hintTexts = signal<string[]>([]);
  hintError = signal<string | null>(null);
  completed = signal(false);
  /** The door is opening (the camera turns to it). */
  opening = signal(false);
  success = signal(false);
  seconds = signal<number | null>(null);
  /** The offer after the success card: the games of the catalog that can be bought now. */
  offer = signal(false);
  /** null while loading; on failure an empty list (the "all games" link stays). */
  products = signal<Product[] | null>(null);
  readonly price = formatPrice;
  readonly previousPrice = formatPreviousPrice;
  readonly players = playersLabel;
  panelOpen = computed(() => !!this.inspecting() || this.keypad() || this.hints() || this.success());

  /** Whether the server has this browser's session (the room still plays when it cannot be reached). */
  private session = false;
  /** Objects examined while the server could not be reached, sent with the next successful call. */
  private pending = new Set<ItemId>();
  private toastTimer?: ReturnType<typeof setTimeout>;
  private cooldownTimer?: ReturnType<typeof setInterval>;
  private doorTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    effect(() => this.world?.setPaused(this.panelOpen() || this.showHelp()));
  }

  label(id: DemoSpotId) {
    return DEMO_SPOTS.find((s) => s.id === id)?.label ?? '';
  }

  async ngOnInit() {
    try {
      this.resume.set(await this.api.state());
    } catch {
      /* offline: the room starts fresh */
    }
  }

  enter() {
    this.audio.unlock();
    this.audio.sfx('whoosh');
    this.start();
  }

  retry() {
    this.world?.dispose();
    this.world = undefined;
    this.start();
  }

  private async start() {
    this.phase.set('loading');
    this.progress.set(0);
    this.playing.set(false);
    // the session starts (or continues) while the room loads
    const session = this.connect();
    try {
      const world = this.zone.runOutsideAngular(() => new DemoWorld(this.canvas().nativeElement, this.settings.settings().quality, {
        onFocus: (s) => this.zone.run(() => this.focus.set(s)),
        onInteract: (s) => this.zone.run(() => this.interact(s)),
        onTooFar: (s) => this.zone.run(() => this.say(`התקרבו אל ${s.label} כדי לבדוק אותו.`)),
        onIntroDone: () => this.zone.run(() => {
          this.playing.set(true);
          setTimeout(() => this.introDone.set(true), 5000);
        }),
        onDoorOpened: () => this.zone.run(() => this.showSuccess()),
      }));
      this.world = world;
      // development builds only: the room is reachable from the console for visual checks
      if (isDevMode()) (window as unknown as { pxDemo?: DemoWorld }).pxDemo = world;
      world.sensitivity = this.settings.settings().lookSensitivity ?? 1;
      await this.zone.runOutsideAngular(() => world.load((p) => this.zone.run(() => this.progress.set(p))));
      if (this.world !== world) return;
      await session;
      world.setInspected(this.inspected());
      this.zone.runOutsideAngular(() => world.start());
      this.phase.set('play');
      if (this.completed()) {
        // a returning player who already solved it: the room as they left it, open, and the success screen
        world.showOpened();
        this.playing.set(true);
        this.introDone.set(true);
        this.showSuccess(false);
      } else if (this.resume()) {
        // continuing: no second opening flight
        world.skipIntro();
      }
    } catch {
      this.phase.set('error');
    }
  }

  /** Starts or continues this browser's session on the server. Never throws: without the server the room still plays. */
  private async connect() {
    try {
      this.apply(await this.api.start(demoDevice()));
      this.session = true;
      await this.flush();
    } catch {
      /* the room keeps playing; the next call tries again */
    }
  }

  private apply(s: DemoState) {
    const merged = new Set<ItemId>([...this.inspected(), ...(s.inspected as ItemId[])]);
    this.inspected.set(merged);
    this.world?.setInspected(merged);
    this.hintTexts.set(s.hints);
    this.completed.set(s.completed);
    this.seconds.set(s.seconds ?? null);
    this.startCooldown(s.cooldownSeconds);
  }

  /** Sends the objects examined while the server could not be reached. */
  private async flush() {
    for (const id of [...this.pending]) {
      this.apply(await this.api.inspect(id));
      this.pending.delete(id);
    }
  }

  private interact(s: DemoSpot) {
    if (s.id === 'door') return this.openKeypad();
    this.open(s.id);
  }

  open(id: ItemId) {
    this.audio.sfx(id === 'letter' ? 'paper' : id === 'clock' ? 'mechanism' : 'metal');
    this.world?.clearInput();
    this.inspecting.set(id);
    if (this.inspected().has(id)) return;
    const next = new Set(this.inspected());
    next.add(id);
    this.inspected.set(next);
    this.world?.setInspected(next);
    this.pending.add(id);
    this.sync();
  }

  private async sync() {
    try {
      if (!this.session) await this.connect();
      else await this.flush();
    } catch {
      /* kept in pending until the next successful call */
    }
  }

  closeInspect() {
    this.inspecting.set(null);
    if (this.inspected().size === DEMO_ITEMS.length && !this.completed()) this.say('בדקתם את כל ארבעת הסימנים. עכשיו גשו ללוח המקשים שליד הדלת.');
  }

  // ------------------------------------------------------------------ the keypad

  private openKeypad() {
    if (this.completed()) return this.say('השער כבר פתוח.');
    this.audio.sfx('metal');
    this.world?.clearInput();
    this.padStatus.set('idle');
    this.padMessage.set(this.cooldown() ? `לוח המקשים נח לרגע. נסו שוב בעוד ${this.cooldown()} שניות.` : '');
    this.keypad.set(true);
  }

  closeKeypad() {
    if (this.padStatus() !== 'right') this.keypad.set(false);
  }

  padEdited() {
    if (this.padStatus() === 'wrong') {
      this.padStatus.set('idle');
      this.padMessage.set('');
    }
    this.audio.sfx('click');
  }

  async tryCode(code: string) {
    if (this.padLocked()) return;
    this.busy.set(true);
    try {
      if (!this.session) await this.connect();
      const reply = await this.api.code(code);
      this.apply(reply.state);
      this.padMessage.set(reply.message);
      if (reply.ok) {
        this.padStatus.set('right');
        this.audio.sfx('codeOk');
        this.world?.flashKeypad(true);
        this.doorTimer = setTimeout(() => this.openDoor(), 1100);
      } else {
        this.padStatus.set('wrong');
        this.audio.sfx('wrong');
        // the wrong digits stay on the screen in red; the next key starts a fresh entry
        this.world?.flashKeypad(false);
      }
    } catch (e) {
      this.padStatus.set('idle');
      this.padMessage.set(e instanceof ApiError ? e.message : 'אירעה שגיאה. נסו שוב.');
    } finally {
      this.busy.set(false);
    }
  }

  private openDoor() {
    this.keypad.set(false);
    this.inspecting.set(null);
    this.hints.set(false);
    this.opening.set(true);
    this.focus.set(null);
    this.audio.sfx('gate');
    this.world?.openDoor();
  }

  private showSuccess(sound = true) {
    this.opening.set(false);
    this.success.set(true);
    if (sound) this.audio.sfx('complete');
  }

  showOffer() {
    this.offer.set(true);
    if (this.products()?.length) return;
    this.products.set(null);
    // the same public list as the home page; only what the server says can be bought now (published, priced, on sale)
    this.catalog.products().then((list) => this.products.set(list.filter((p) => p.purchasable))).catch(() => this.products.set([]));
  }

  /** Back to the open room; the success card returns from the door (or on the next visit). */
  closeOffer() {
    this.offer.set(false);
    this.success.set(false);
  }

  private startCooldown(seconds: number) {
    clearInterval(this.cooldownTimer);
    this.cooldown.set(Math.max(0, seconds));
    if (seconds <= 0) return;
    this.cooldownTimer = setInterval(() => {
      const left = Math.max(0, this.cooldown() - 1);
      this.cooldown.set(left);
      if (this.keypad() && this.padStatus() !== 'right')
        this.padMessage.set(left > 0 ? `לוח המקשים נח לרגע. נסו שוב בעוד ${left} שניות.` : 'אפשר לנסות שוב.');
      if (left <= 0) clearInterval(this.cooldownTimer);
    }, 1000);
  }

  // ------------------------------------------------------------------ hints (only on request)

  openHints() {
    this.world?.clearInput();
    this.hintError.set(null);
    this.hints.set(true);
  }

  async askHint() {
    this.busy.set(true);
    this.hintError.set(null);
    try {
      if (!this.session) await this.connect();
      this.apply(await this.api.hint());
      this.audio.sfx('hint');
    } catch (e) {
      this.hintError.set(e instanceof ApiError ? e.message : 'אירעה שגיאה. נסו שוב.');
    } finally {
      this.busy.set(false);
    }
  }

  duration(s: number) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m ? `${m}:${String(sec).padStart(2, '0')} דקות` : `${sec} שניות`;
  }

  private say(text: string) {
    this.toast.set(text);
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(null), 3200);
  }

  ngOnDestroy() {
    clearTimeout(this.toastTimer);
    clearTimeout(this.doorTimer);
    clearInterval(this.cooldownTimer);
    this.world?.dispose();
    this.world = undefined;
  }
}
