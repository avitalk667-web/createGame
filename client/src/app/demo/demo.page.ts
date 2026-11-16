import { Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, HostListener, NgZone, OnDestroy, OnInit, computed, effect, inject, isDevMode, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiError, ApiService } from '../core/api.service';
import { AudioService } from '../core/audio.service';
import { Product, formatPreviousPrice, formatPrice, playersLabel } from '../core/models';
import { SettingsService } from '../core/settings.service';
import { JoystickComponent } from '../ui/joystick.component';
import { DEMO_ITEMS, DEMO_SPOTS, DemoSpot, DemoSpotId } from './demo-content';
import { pendingCoupon } from '../challenge/challenge.service';
import { DemoApi, DemoState, TasteCoupon, TasteCouponReply, demoDevice, demoTrack } from './demo.api';
import { DemoGateSceneComponent } from './demo-gate-scene.component';
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
  imports: [RouterLink, JoystickComponent, DemoGateSceneComponent, DemoInspectComponent, DemoKeypadComponent],
  template: `
    <div class="stage" [class.hidden]="phase() === 'gate'"><canvas #canvas aria-label="החדר הנעול בתלת־ממד"></canvas></div>

    @switch (phase()) {
      @case ('gate') {
        <section class="gate" aria-labelledby="gate-title">
          <px-demo-gate-scene />
          <div class="gate-scroll">
            <div class="gate-card">
              <p class="g-logo">PORTAL <span>X</span></p>
              <p class="g-badge"><span>טעימה מהפורטל</span></p>
              <h1 id="gate-title" class="g-title">הפורטל נפתח בפניכם...</h1>
              <svg class="g-swoosh" viewBox="0 0 600 44" aria-hidden="true">
                <defs>
                  <linearGradient id="g-swoosh-gold" x1="0" x2="1">
                    <stop offset="0" stop-color="#f0c060" stop-opacity="0" /><stop offset=".25" stop-color="#f6cf6a" />
                    <stop offset=".5" stop-color="#fff6d6" /><stop offset=".75" stop-color="#f6cf6a" /><stop offset="1" stop-color="#f0c060" stop-opacity="0" />
                  </linearGradient>
                  <radialGradient id="g-swoosh-glow" r=".5"><stop offset="0" stop-color="#fff2c0" stop-opacity=".9" /><stop offset="1" stop-color="#ffd37a" stop-opacity="0" /></radialGradient>
                </defs>
                <path class="sw-blue" d="M60 30 C200 4 400 4 560 22" />
                <path class="sw-line" d="M20 30 C170 8 430 8 580 26" />
                <path class="sw-spark" d="M20 30 C170 8 430 8 580 26" />
                <ellipse cx="300" cy="14" rx="70" ry="9" fill="url(#g-swoosh-glow)" />
              </svg>
              <p class="g-lead">אתם עומדים להיכנס לחדר מסתורי.<br class="wide-br" /> הדלת מאחוריכם ננעלה, ורק מי שיצליח לחשוף את הסוד יוכל לצאת.</p>
              @if (resume(); as r) {
                <p class="g-badge g-status"><span>{{ r.completed ? 'כבר פתחתם את השער — ההטבה שלכם מחכה.' : 'ממשיכים מאיפה שהפסקתם: ' + r.inspected.length + ' מתוך 4 סימנים נמצאו.' }}</span></p>
              }
              <div class="g-cta">
                <button type="button" class="enter" (click)="enter()">
                  <span class="label">{{ resume()?.completed ? 'להטבה שלכם' : resume() ? 'המשך בחדר' : 'כניסה לחדר' }}</span>
                  <svg class="chev" viewBox="0 0 28 24" aria-hidden="true"><path d="M13 4 L5 12 L13 20 M23 4 L15 12 L23 20" /></svg>
                  <span class="shine" aria-hidden="true"></span>
                </button>
              </div>
              <ul class="g-facts">
                <li><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9" /></svg>טעימה חינמית</li>
                <li><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2.5" /></svg>כ־3–5 דקות</li>
                <li><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" /><circle cx="12" cy="9.5" r="3" /><path d="M6.8 17.6c1.4-2.1 3.1-3 5.2-3s3.8.9 5.2 3M5.3 5.3l13.4 13.4" /></svg>ללא הרשמה</li>
              </ul>
              <a routerLink="/" class="g-home">חזרה לדף הבית</a>
            </div>
          </div>
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
      }
    }

    @if (success()) {
      <!-- the end of the taste: once the server recorded the right code there is no way back into the room, only what comes next -->
      <div class="overlay win-bg finish-wrap">
        <section class="finish" role="dialog" aria-modal="true" aria-labelledby="finish-title">
          <div class="rays" aria-hidden="true"></div>
          <p class="kicker">טעימה מהפורטל · הושלמה</p>
          <h2 id="finish-title" class="gold-title">כל הכבוד! פתחתם את שער הפורטל!</h2>
          @if (seconds(); as t) { <p class="time">⏱ פתרתם ב־{{ duration(t) }}</p> }

          <!-- the coupon: never shown before the address and the consent were given and the server confirmed the email was sent -->
          <div class="gift" aria-live="polite">
            @switch (couponState()) {
              @case ('sent') {
                @if (coupon(); as c) {
                  <p class="gift-kicker">📧 הקופון בדרך אליכם!</p>
                  <p>שלחנו את ההטבה לכתובת המייל שהזנתם@if (sentTo()) { (<bdi dir="ltr">{{ sentTo() }}</bdi>) }.</p>
                  @if (c.status === 'active' && left() > 0) {
                    <p class="code-label">קוד הקופון שלכם:</p>
                    <div class="code-row">
                      <span class="code" dir="ltr">{{ c.code }}</span>
                      <button type="button" class="btn primary copy" (click)="copyCode(c.code)">{{ copied() ? 'הקוד הועתק ✓' : 'העתקת קוד הקופון' }}</button>
                    </div>
                    <p class="gift-big"><bdi>{{ c.discountPercent }}%</bdi> הנחה על משחקים זכאים.</p>
                    <p class="valid">בתוקף עד: <b><bdi>{{ c.expiresAtText }}</bdi></b></p>
                    <p class="countdown" role="timer" aria-label="הזמן שנותר להטבה">נותרו <b>{{ countdown() }}</b></p>
                  } @else {
                    <p class="code-row"><span class="code used" dir="ltr">{{ c.code }}</span></p>
                    <p class="muted">{{ c.status === 'redeemed' ? 'כבר השתמשתם בקופון הזה ברכישה. תודה!' : c.status === 'cancelled' ? 'הקופון הזה בוטל.' : 'תוקף הקופון הסתיים ב־' + c.expiresAtText + '.' }}</p>
                  }
                  <p class="muted small">לא קיבלתם את המייל? בדקו גם בתיקיית הספאם.</p>
                }
              }
              @case ('form') {
                <p class="gift-kicker">נהניתם מהטעימה? מחכה לכם מתנה מיוחדת:</p>
                <p class="gift-big"><bdi>{{ percent() }}%</bdi> הנחה על רכישת משחק מלא ב־PORTAL&nbsp;X!</p>
                <p>כדי לקבל את הקופון, מלאו את כתובת המייל שלכם ואשרו קבלת עדכונים והטבות.</p>
                <form class="coupon-form" (submit)="$event.preventDefault(); sendCoupon()" novalidate>
                  <label class="field">כתובת מייל
                    <input type="email" dir="ltr" autocomplete="email" inputmode="email" maxlength="254" required placeholder="name@example.com"
                      [value]="email()" (input)="email.set($any($event.target).value); formError.set(null)" [attr.aria-invalid]="email() && !emailOk() ? true : null" />
                  </label>
                  <label class="consent">
                    <input type="checkbox" required [checked]="consent()" (change)="consent.set($any($event.target).checked); formError.set(null)" />
                    <span>אני מאשר/ת לקבל מיילים עם עדכונים, הטבות ומבצעים מ־PORTAL&nbsp;X. ניתן להסיר את ההרשמה בכל עת.</span>
                  </label>
                  @if (formError(); as e) { <p class="err" role="alert">{{ e }}</p> }
                  <button type="submit" class="btn primary send" [disabled]="!emailOk() || !consent() || busySend()">{{ busySend() ? 'שולחים…' : 'שלחו לי את הקופון' }}</button>
                </form>
              }
              @case ('sending') {
                <p class="muted" role="status">שולחים את הקופון למייל שלכם…</p>
              }
              @case ('failed') {
                <p class="err" role="alert">{{ failMessage() }}</p>
                @if (sentTo()) { <p class="muted small">המייל יישלח שוב לכתובת <bdi dir="ltr">{{ sentTo() }}</bdi>.</p> }
                <button type="button" class="btn primary" [disabled]="busySend()" (click)="retrySend()">{{ busySend() ? 'שולחים…' : 'נסה שוב' }}</button>
              }
              @case ('loading') {
                <p class="muted" role="status">מכינים לכם מתנה…</p>
              }
              @case ('error') {
                <p class="muted">לא הצלחנו להציג את ההטבה כרגע.</p>
                <button type="button" class="btn small" (click)="loadCoupon()">לנסות שוב</button>
              }
              @default {
                <p>ההרפתקה האמיתית מחכה לכם במשחקי PORTAL&nbsp;X.</p>
              }
            }
          </div>

          @if (products(); as list) {
            @if (list.length) {
              <h3 class="pick">בחרו את ההרפתקה הבאה שלכם</h3>
              <div class="games">
                @for (p of list; track p.id) {
                  <article class="game">
                    <a class="cover" [routerLink]="['/games', p.id]" (click)="productClicked(p)" [attr.aria-label]="'לצפייה במשחק ' + p.name"><img [src]="p.coverImage" [alt]="p.name" loading="lazy" (error)="$any($event.target).style.visibility = 'hidden'" /></a>
                    <div class="g-body">
                      <h4><a [routerLink]="['/games', p.id]" (click)="productClicked(p)">{{ p.name }}</a></h4>
                      <p class="tagline">{{ p.tagline }}</p>
                      <div class="g-buy">
                        <div class="g-price">
                          @if (previousPrice(p); as was) {
                            <s><span class="sr-only">מחיר קודם: </span><bdi>{{ was }}</bdi></s>
                          }
                          <b><span class="sr-only">מחיר: </span><bdi>{{ price(p) }}</bdi></b>
                          <small>{{ players(p) }}</small>
                        </div>
                        <a class="btn primary" [routerLink]="['/games', p.id]" (click)="productClicked(p)">לרכישת המשחק</a>
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
            <a class="btn ghost" routerLink="/">לדף הבית</a>
          </div>
        </section>
      </div>
    }
  `,
  styles: [`
    :host { display:block; position:fixed; inset:0; overflow:hidden; background:#060a1a; direction:rtl; }
    .stage { position:absolute; inset:0; } .stage.hidden { visibility:hidden; }
    canvas { width:100%; height:100%; display:block; outline:none; touch-action:none; cursor:grab; }

    /* the opening screen: the scenery (px-demo-gate-scene) behind, the words and the way in on top, all real text */
    .gate { position:absolute; inset:0; overflow:hidden; background:#050816; }
    .gate-scroll { position:absolute; inset:0; z-index:4; overflow-y:auto; overflow-x:hidden; display:grid; place-items:center;
      --g-side: calc(clamp(0px, calc(50vw - 600px), 150px) + clamp(22px, 8vw, 150px));
      padding: clamp(46px, 7vh, 64px) calc(var(--g-side) + 14px) max(18px, env(safe-area-inset-bottom)); }
    .gate-card { width:min(820px, 100%); display:flex; flex-direction:column; align-items:center; text-align:center; }

    .g-logo { margin:0 0 clamp(.7rem, 2.2vh, 1.3rem); font-family: var(--font-title); font-weight:800; letter-spacing:.06em; line-height:1;
      font-size: clamp(1.6rem, min(3.6vw, 4.6vh), 2.6rem); direction:ltr;
      background: linear-gradient(180deg, #fff6d2 8%, #f2cd6c 50%, #b07b22 92%); -webkit-background-clip:text; background-clip:text; color:transparent;
      filter: drop-shadow(0 2px 0 rgba(70,44,8,.9)) drop-shadow(0 0 14px rgba(255,205,110,.45)); }
    .g-logo span { font-size:1.28em; }

    /* the framed gold plaques: an elongated hexagon with a gold rim and small diamonds */
    .g-badge { --cut: 18px; margin:0; padding:2px; display:inline-block;
      background: linear-gradient(180deg, #fff0b8, #c08f2c 50%, #f5d27a);
      clip-path: polygon(var(--cut) 0, calc(100% - var(--cut)) 0, 100% 50%, calc(100% - var(--cut)) 100%, var(--cut) 100%, 0 50%);
      filter: drop-shadow(0 0 10px rgba(255,200,100,.25)); }
    .g-badge > span { position:relative; display:block; padding: .5em 3.1em; font-weight:800; color:#f7d98c;
      font-size: clamp(1.02rem, min(2.3vw, 2.7vh), 1.6rem); background: linear-gradient(180deg, #17245a, #0a1233);
      clip-path: polygon(calc(var(--cut) - 1px) 0, calc(100% - var(--cut) + 1px) 0, 100% 50%, calc(100% - var(--cut) + 1px) 100%, calc(var(--cut) - 1px) 100%, 0 50%); }
    .g-badge > span::before, .g-badge > span::after { content:''; position:absolute; top:50%; width:8px; height:8px; margin-top:-4px;
      background: linear-gradient(135deg, #fff1c0, #d4a23e); transform: rotate(45deg); }
    .g-badge > span::before { right: 1.5em; } .g-badge > span::after { left: 1.5em; }

    .g-title { margin: clamp(.9rem, 3vh, 1.6rem) 0 0; font-family: var(--font-title); font-weight:900; line-height:1.12;
      font-size: clamp(2.2rem, min(7.2vw, 9.4vh), 5.6rem);
      background: linear-gradient(180deg, #fffbe6 0%, #ffe08a 34%, #f1b740 62%, #b97a1c 100%); -webkit-background-clip:text; background-clip:text; color:transparent;
      filter: drop-shadow(0 3px 0 #6d4810) drop-shadow(0 6px 6px rgba(0,0,0,.55)) drop-shadow(0 0 22px rgba(255,196,90,.38));
      animation: g-appear 1.3s cubic-bezier(.2,.7,.2,1) .15s both; }
    @keyframes g-appear { from { opacity:0; transform: translateY(14px) scale(.96); letter-spacing:.08em; } }

    /* the line of light under the title: it draws itself, then a spark keeps running along it */
    .g-swoosh { width: min(600px, 96%); height:auto; max-height: 5.4vh; margin: .1rem 0 clamp(.6rem, 2vh, 1rem); overflow:visible; }
    .g-swoosh path { fill:none; stroke-linecap:round; }
    .sw-line { stroke: url(#g-swoosh-gold); stroke-width:2.6; stroke-dasharray:620; animation: g-draw 1.4s ease-out .7s both; }
    .sw-blue { stroke: rgba(120,180,255,.55); stroke-width:1.4; stroke-dasharray:620; animation: g-draw 1.6s ease-out .9s both; }
    .sw-spark { stroke:#fffbe8; stroke-width:3.6; stroke-dasharray: 46 900; stroke-dashoffset: 46; opacity:0;
      filter: drop-shadow(0 0 4px #ffe6a0); animation: g-spark 4.5s ease-in-out 2.1s infinite both; }
    @keyframes g-draw { from { stroke-dashoffset:620; } to { stroke-dashoffset:0; } }
    @keyframes g-spark { 0% { stroke-dashoffset:46; opacity:0; } 8% { opacity:.95; } 55% { stroke-dashoffset:-600; opacity:.9; } 60%, 100% { stroke-dashoffset:-600; opacity:0; } }

    .g-lead { margin: 0 0 clamp(.8rem, 2.6vh, 1.6rem); max-width: 34ch; text-wrap: pretty; color:#f6f2ff; line-height:1.75; font-weight:500;
      font-size: clamp(1.06rem, min(2.4vw, 3vh), 1.8rem); text-shadow: 0 2px 10px rgba(0,0,0,.65); animation: g-fade 1s ease-out .55s both; }
    @keyframes g-fade { from { opacity:0; transform: translateY(8px); } }

    .g-status { --cut: 14px; margin-bottom: clamp(1rem, 3vh, 1.5rem); }
    .g-status > span { font-size: clamp(.95rem, min(2vw, 2.4vh), 1.3rem); padding: .45em 2.8em; color:#f2d891; }

    /* the main button: a gold hexagon with an inner rim, a soft glow behind it and a light that crosses it now and then */
    .g-cta { position:relative; z-index:0; width: min(600px, 100%); margin-bottom: clamp(1.2rem, 3.4vh, 2rem); animation: g-fade 1s ease-out .8s both; }
    .g-cta::before { content:''; position:absolute; inset:-22px -30px; z-index:-1; pointer-events:none;
      background: radial-gradient(closest-side, rgba(255,196,80,.5), rgba(255,170,60,.18) 55%, transparent); animation: g-pulse 3.4s ease-in-out infinite; }
    @keyframes g-pulse { 50% { opacity:.55; transform: scale(.96); } }
    .enter { --cut: 34px; position:relative; width:100%; min-height: clamp(56px, 9vh, 84px); border:0; cursor:pointer; overflow:hidden;
      display:flex; align-items:center; justify-content:center; gap:.7em; padding: .5em calc(var(--cut) + 1rem);
      font: 800 clamp(1.25rem, min(3.2vw, 3.8vh), 1.95rem)/1.15 var(--font); color:#2a1604; -webkit-tap-highlight-color: transparent;
      background: linear-gradient(180deg, #fff6cc 0%, #ffdc72 28%, #f3b93f 60%, #c98a1f 100%);
      clip-path: polygon(var(--cut) 0, calc(100% - var(--cut)) 0, 100% 50%, calc(100% - var(--cut)) 100%, var(--cut) 100%, 0 50%);
      transition: transform .18s ease, filter .18s ease; }
    .enter::before, .enter::after { content:''; position:absolute; pointer-events:none;
      clip-path: polygon(var(--c) 0, calc(100% - var(--c)) 0, 100% 50%, calc(100% - var(--c)) 100%, var(--c) 100%, 0 50%); }
    .enter::before { --c: 31px; inset:5px; background: linear-gradient(180deg, rgba(255,255,255,.85), rgba(150,90,12,.75)); }
    .enter::after { --c: 30px; inset:7px; background: linear-gradient(180deg, #ffefb0 0%, #ffd463 32%, #f0b23a 64%, #d0921f 100%); }
    .enter .label, .enter .chev { position:relative; z-index:1; }
    .enter .label { text-shadow: 0 1px 0 rgba(255,240,190,.7); }
    .chev { width: 1.15em; height:auto; flex:none; fill:none; stroke:#2a1604; stroke-width:3; stroke-linecap:round; stroke-linejoin:round; }
    .shine { position:absolute; z-index:1; top:0; bottom:0; left:-30%; width:22%; pointer-events:none;
      background: linear-gradient(100deg, transparent, rgba(255,255,255,.65), transparent); transform: skewX(-18deg);
      animation: g-shine 5.5s ease-in-out 2.4s infinite both; }
    @keyframes g-shine { 0% { transform: translateX(0) skewX(-18deg); } 22%, 100% { transform: translateX(800%) skewX(-18deg); } }
    @media (hover: hover) { .enter:hover { transform: scale(1.03); filter: brightness(1.08) saturate(1.05); } }
    .enter:active { transform: translateY(2px) scale(.985); filter: brightness(.94); }
    .enter:active::after { background: linear-gradient(180deg, #f6d576 0%, #f0b73f 45%, #e8ab33 75%, #ffe59a 100%); }
    .g-cta:has(.enter:focus-visible) { outline: 3px solid #fff; outline-offset: 6px; border-radius: 14px; }

    .g-facts { list-style:none; margin: 0 0 clamp(.9rem, 2.6vh, 1.4rem); padding: .75rem 0; display:flex; justify-content:center; flex-wrap:wrap; row-gap:.4rem;
      width: min(680px, 100%); color:#ebe6f6; font-size: clamp(.9rem, min(1.9vw, 2.3vh), 1.25rem);
      border-bottom: 1px solid; border-image: linear-gradient(90deg, transparent, rgba(224,185,92,.55), transparent) 1; }
    .g-facts li { display:flex; align-items:center; gap:.45em; padding: 0 1.2em; }
    .g-facts li + li { border-inline-start: 1px solid rgba(224,185,92,.45); }
    .g-facts svg { width:1.35em; height:1.35em; flex:none; fill:none; stroke: var(--gold); stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round; }

    .g-home { color:#fff; font-size: clamp(1rem, min(2vw, 2.4vh), 1.3rem); text-decoration: underline; text-underline-offset: 5px; text-decoration-thickness: 1px;
      transition: color .2s, text-decoration-color .2s; padding:.3em .5em; }
    .g-home:hover { color: var(--gold-2); text-decoration-color: var(--gold); }

    @media (max-width: 699px) {
      .gate-scroll { --g-side: clamp(16px, 6vw, 40px); padding-inline: calc(var(--g-side) + 8px); }
      .wide-br { display:none; }
      .g-badge > span { padding-inline: 2.4em; }
      .enter { --cut: 24px; } .enter::before { --c: 21px; } .enter::after { --c: 20px; }
      .g-facts { flex-wrap:nowrap; font-size: clamp(.74rem, 3.5vw, .9rem); }
      .g-facts li { padding: 0 .55em; gap:.3em; white-space:nowrap; }
      .g-facts svg { width:1.15em; height:1.15em; }
    }
    /* short screens (a laptop, a phone on its side): tighter spacing so the whole gate fits without scrolling */
    @media (max-height: 820px) and (min-width: 700px) {
      .g-lead { max-width: 44ch; line-height:1.6; }
      .g-facts { padding-block: .5rem; }
    }
    @media (max-width: 340px) { .g-facts li { padding: 0 .35em; } .g-facts svg { display:none; } }
    @media (prefers-reduced-motion: reduce) {
      .g-title, .g-lead, .g-cta, .sw-line, .sw-blue { animation:none; }
      .sw-spark, .shine, .g-cta::before { animation:none; display:none; }
      .enter { transition:none; }
    }

    .kicker { color: var(--gold); letter-spacing:.12em; font-weight:700; margin:0 0 .4rem; }
    .lead { font-size: clamp(1.05rem, 3.6vw, 1.3rem); line-height:1.6; margin:0 0 1.6rem; }

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
    .rays { position:absolute !important; inset:-50%; pointer-events:none; background: conic-gradient(from 0deg, transparent 0 8%, rgba(255,214,120,.10) 10% 14%, transparent 16% 33%,
      rgba(255,214,120,.10) 35% 39%, transparent 41% 58%, rgba(255,214,120,.10) 60% 64%, transparent 66% 83%, rgba(255,214,120,.10) 85% 89%, transparent 91%);
      animation: spin 24s linear infinite; }
    .time { color: var(--gold-2); }
    /* the finish screen: a scrolling page over the room (or the gate), the coupon, then the catalog cards in a responsive grid */
    .finish-wrap { z-index: 70; overflow-y:auto; align-items:start; padding: max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom)); }
    .finish { position:relative; overflow:hidden; width:100%; max-width:980px; margin: auto; text-align:center; padding: 1.6rem clamp(1rem, 3vw, 2rem); border-radius:22px;
      background: linear-gradient(180deg, rgba(22,32,74,.97), rgba(10,16,40,.97)); border:1px solid var(--gold); box-shadow: 0 0 60px rgba(224,185,92,.25), var(--shadow);
      animation: rise .6s cubic-bezier(.2,.9,.3,1.1) both; }
    .finish > * { position:relative; }
    .finish h2 { font-family: var(--font-title); font-size: clamp(1.7rem, 5.4vw, 2.6rem); line-height:1.2; margin:.2rem auto .7rem; max-width:22ch; text-wrap:balance; }
    .finish .lead { font-weight:600; max-width:60ch; margin:0 auto 1.2rem; line-height:1.7; font-size:clamp(1rem, 2.6vw, 1.12rem); }
    .gift { max-width:620px; margin: 0 auto 1.4rem; padding: 1.1rem clamp(.9rem, 3vw, 1.6rem); border-radius:18px;
      background: linear-gradient(180deg, rgba(255,214,120,.14), rgba(255,214,120,.04)); border:2px dashed rgba(240,200,110,.75);
      box-shadow: 0 0 34px rgba(224,185,92,.22) inset; }
    .gift p { margin: .3rem 0; }
    .gift-kicker { font-family: var(--font-title); color: var(--gold-2); font-size: clamp(1.15rem, 3.4vw, 1.45rem); font-weight:800; }
    .gift-big { font-size: clamp(1.25rem, 4vw, 1.75rem); font-weight:800; }
    .gift-big bdi { color: var(--gold-2); font-size:1.3em; }
    .code-row { display:flex; justify-content:center; align-items:center; flex-wrap:wrap; gap:.6rem; margin: .7rem 0 .5rem !important; }
    .code-label { font-weight:700; margin-top:.7rem !important; }
    .coupon-form { display:flex; flex-direction:column; gap:.7rem; max-width:440px; margin: .9rem auto 0; text-align:right; }
    .field { display:flex; flex-direction:column; gap:.3rem; font-weight:700; }
    .field input { min-height:48px; font-size:1.05rem; text-align:left; }
    .consent { display:flex; align-items:flex-start; gap:.6rem; line-height:1.55; font-size:.98rem; cursor:pointer; }
    .consent input { width:22px; height:22px; margin-top:.15rem; flex:none; accent-color: var(--gold); }
    .send { min-height:50px; font-size:1.1rem; }
    .send:disabled { opacity:.55; cursor:not-allowed; }
    .code { font: 800 clamp(1.25rem, 4.4vw, 1.7rem)/1 ui-monospace, Consolas, monospace; letter-spacing:.08em; padding:.5em .9em; border-radius:12px;
      background: rgba(5,10,30,.75); border:1px solid rgba(240,200,110,.6); color:#fff3cf; user-select:all; }
    .code.used { opacity:.55; text-decoration: line-through; }
    .copy { min-width: 9.5em; }
    .valid { color:#ece6f6; }
    .countdown { font-size:1.1rem; } .countdown b { color: var(--gold-2); font-variant-numeric: tabular-nums; }
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
    @media (prefers-reduced-motion: reduce) { .finish, .game, .rays { animation:none; transition:none; } }
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
  private ngLocation = inject(Location);
  /** "/demo?ref=CODE" handed to the server before the session starts, so the session counts for that link. */
  private refReady: Promise<void> = Promise.resolve();
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
  /** The personal coupon of the finished taste — set only once the server confirmed it was emailed. */
  coupon = signal<TasteCoupon | null>(null);
  couponState = signal<'idle' | 'loading' | 'error' | 'form' | 'sending' | 'sent' | 'failed' | 'none'>('idle');
  /** The coupon form: the address and the consent box (empty until the visitor ticks it). */
  email = signal('');
  consent = signal(false);
  emailOk = computed(() => /^[^\s@<>()[\],;:"\\]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/.test(this.email().trim()));
  busySend = signal(false);
  formError = signal<string | null>(null);
  failMessage = signal('');
  /** The address the coupon goes to, as the server shows it (partly hidden). */
  sentTo = signal<string | null>(null);
  /** The campaign's percent, from the server (10 until it answers). */
  percent = signal(10);
  copied = signal(false);
  /** Milliseconds left until the coupon expires, by the server's clock (ticks every second). */
  left = signal(0);
  countdown = computed(() => {
    const t = Math.max(0, Math.floor(this.left() / 1000));
    const d = Math.floor(t / 86400), h = Math.floor((t % 86400) / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
    const clock = [h, m, sec].map((n) => String(n).padStart(2, '0')).join(':');
    return d ? `${d === 1 ? 'יום אחד' : d + ' ימים'} ו־${clock} שעות` : `${clock} שעות`;
  });
  /** The games the coupon is good for that can be bought now; null while loading, on failure an empty list (the "all games" link stays). */
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
  private countdownTimer?: ReturnType<typeof setInterval>;
  private copiedTimer?: ReturnType<typeof setTimeout>;
  private statusTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    effect(() => this.world?.setPaused(this.panelOpen() || this.showHelp()));
  }

  label(id: DemoSpotId) {
    return DEMO_SPOTS.find((s) => s.id === id)?.label ?? '';
  }

  async ngOnInit() {
    const ref = new URLSearchParams(location.search).get('ref');
    if (ref) {
      this.refReady = ref.length <= 64 ? this.api.ref(ref) : Promise.resolve();
      // the address bar no longer carries the code (as with "/r/CODE")
      this.ngLocation.replaceState('/demo');
    }
    demoTrack('demo_impression');
    try {
      this.resume.set(await this.api.state());
    } catch {
      /* offline: the room starts fresh */
    }
  }

  enter() {
    demoTrack('demo_click');
    this.audio.unlock();
    if (this.resume()?.completed) {
      // already solved: the finish screen with the coupon, never the room again
      this.completed.set(true);
      this.seconds.set(this.resume()?.seconds ?? null);
      return this.showSuccess(false);
    }
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
      await this.refReady;
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
    demoTrack('demo_offer_viewed');
    // the games at once (all that can be bought); the coupon's state from the server (the form, or the coupon already sent)
    this.loadGames();
    void this.loadCoupon();
  }

  /** What the server says about this session's coupon now (a refresh or a later visit): the form, or the sent coupon. */
  async loadCoupon() {
    this.couponState.set('loading');
    try {
      this.applyReply(await this.api.couponStatus());
    } catch {
      this.couponState.set('error');
    }
  }

  /** "שלחו לי את הקופון": checked again by the server, which answers with the code only once the email was accepted. */
  async sendCoupon() {
    if (!this.emailOk() || !this.consent() || this.busySend()) return;
    await this.send({ email: this.email().trim(), marketingConsent: true });
  }

  /** "נסה שוב": the same coupon to the same address (the server never makes a second one). */
  retrySend() {
    return this.send({ retry: true });
  }

  private async send(body: { email?: string; marketingConsent?: boolean; retry?: boolean }) {
    this.busySend.set(true);
    this.formError.set(null);
    try {
      this.applyReply(await this.api.sendCoupon(body));
    } catch (e) {
      // a refused address or consent stays on the form; anything else is a failed send that can be tried again
      if (e instanceof ApiError && ['bad-email', 'no-consent', 'email-used'].includes(e.code)) {
        this.formError.set(e.message);
        this.couponState.set('form');
      } else {
        this.failMessage.set(e instanceof ApiError && e.code === 'rate' ? e.message : 'לא הצלחנו לשלוח את הקופון כרגע. אפשר לנסות שוב.');
        this.couponState.set(body.retry || this.sentTo() ? 'failed' : 'form');
        if (!body.retry && !this.sentTo()) this.formError.set(this.failMessage());
      }
    } finally {
      this.busySend.set(false);
    }
  }

  private applyReply(r: TasteCouponReply) {
    clearTimeout(this.statusTimer);
    if (r.discountPercent) this.percent.set(r.discountPercent);
    this.sentTo.set(r.email ?? null);
    switch (r.state) {
      case 'sent':
        if (r.coupon) { this.showCoupon(r.coupon); return; }
        this.couponState.set('error');
        return;
      case 'form':
        this.couponState.set('form');
        return;
      case 'failed':
        this.failMessage.set(r.message ?? 'לא הצלחנו לשלוח את הקופון כרגע. אפשר לנסות שוב.');
        this.couponState.set('failed');
        return;
      case 'sending':
        // another tab is sending it right now: look again in a moment
        this.couponState.set('sending');
        this.statusTimer = setTimeout(() => void this.loadCoupon(), 3000);
        return;
      default:
        // switched off, the quota used up, or no finished session here: no coupon to offer
        this.couponState.set('none');
    }
  }

  /** The coupon the server confirmed was emailed; the countdown follows the server's clock. */
  private showCoupon(coupon: TasteCoupon) {
    this.coupon.set(coupon);
    this.couponState.set('sent');
    // the games list narrows to what the coupon is good for
    this.loadGames();
    const skew = Date.parse(coupon.serverNow) - Date.now();
    const end = Date.parse(coupon.expiresAt);
    const tick = () => {
      const left = Math.max(0, end - (Date.now() + skew));
      this.left.set(left);
      if (!left) clearInterval(this.countdownTimer);
    };
    clearInterval(this.countdownTimer);
    tick();
    this.countdownTimer = setInterval(tick, 1000);
  }

  private loadGames() {
    this.products.set(null);
    // the same public list as the home page; only what the server says can be bought now (published, priced, on sale)
    this.catalog.products().then((list) => {
      const eligible = this.coupon()?.productIds;
      this.products.set(list.filter((p) => p.purchasable && (!eligible?.length || eligible.includes(p.id))));
    }).catch(() => this.products.set([]));
  }

  async copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      /* no clipboard permission: the code stays selectable */
    }
    this.copied.set(true);
    clearTimeout(this.copiedTimer);
    this.copiedTimer = setTimeout(() => this.copied.set(false), 2500);
    demoTrack('demo_coupon_copied');
  }

  /** The way to a game: the coupon goes with this tab (filled in on the game page; the server checks it again). */
  productClicked(p: Product) {
    const c = this.coupon();
    if (c && c.status === 'active' && this.left() > 0) {
      try { sessionStorage.setItem(pendingCoupon.key, c.code); } catch { /* it can still be typed */ }
    }
    demoTrack('demo_product_clicked', p.id);
  }

  /** Leaving before the door opened (closing the tab, or going elsewhere on the site); the server counts it once. */
  @HostListener('window:pagehide')
  leave() {
    if (this.session && !this.completed()) demoTrack('demo_abandoned');
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
    this.leave();
    clearTimeout(this.toastTimer);
    clearTimeout(this.doorTimer);
    clearInterval(this.cooldownTimer);
    clearInterval(this.countdownTimer);
    clearTimeout(this.copiedTimer);
    clearTimeout(this.statusTimer);
    this.world?.dispose();
    this.world = undefined;
  }
}
