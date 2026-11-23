import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { AudioService } from '../../core/audio.service';
import { GameService } from '../../core/game.service';
import { ItemContent, MechanismState, PuzzleContent, PuzzleStateDto } from '../../core/models';
import { FEEDBACK_CSS, PlacementFeedback } from './cc-feedback';
import { LETTER_CARD_CSS, isLetterItem, letterHtml, plainText } from './cc-rich';
import { wallFaceText } from './home-room';

const SYMBOL_NAME: Record<string, string> = { arch: 'קשת', leaf: 'עלה', wave: 'גל', flame: 'להבה', bell: 'פעמון', key: 'מפתח', star: 'כוכב', home: 'בית' };
const SYMBOL_ICON: Record<string, string> = { arch: '⌒', leaf: '🍃', wave: '〰', flame: '🔥', bell: '🔔', key: '🗝', star: '★', home: '⌂' };
/** One neutral colour for every bar: the sound, not a colour, tells the bells apart. */
const BAR_COLOR = '#b89a6a';
const BASE_HZ = 261.63;

interface Note { note: number; at: number }

/**
 * Every puzzle window of "הצופן הזוגי". Like the other games' panels it only collects what the players do and sends it
 * to the server, which alone decides what is right. The device's tune is also drawn as bars whose height is the pitch,
 * all in one neutral colour, so nothing but the sound itself ties a note to a bell. A solve closes the window.
 */
@Component({
  selector: 'px-cc-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="overlay" (click)="close.emit()">
      <section class="panel-modal" role="dialog" aria-modal="true" [attr.aria-label]="puzzle()?.title" (click)="$event.stopPropagation()">
        <header>
          <div>
            <span class="chip">{{ zoneName() }}</span>
            <h2>{{ puzzle()?.title }}</h2>
          </div>
          <button class="btn small ghost" (click)="close.emit()" aria-label="סגירה">✕</button>
        </header>

        @if (state()?.status === 'locked') {
          <p class="locked">🔒 {{ lockedText() }}</p>
        } @else {
          <p class="instructions">{{ puzzle()?.instructions }}</p>
          @if (solved()) { <p class="solved">✔ {{ puzzle()?.success }}</p> }

          @switch (kind()) {
            @case ('listen') {
              <div class="bells" role="group" aria-label="הפעמונים">
                @for (b of data().bells; track b.id) {
                  <button class="bell" (click)="ring(b.note)" [style.--s]="b.size" [attr.aria-label]="'פעמון ' + symName(b.symbol)">
                    <span class="bell-ico" aria-hidden="true">🔔</span>
                    <b>{{ symIcon(b.symbol) }} {{ symName(b.symbol) }}</b>
                    <span class="bar bell-bar" aria-hidden="true"></span>
                  </button>
                }
              </div>
              <ng-container *ngTemplateOutlet="tuneTpl; context: { $implicit: data().tune, label: '▶ הפעלת המכשיר', who: 'device' }" />
              <ng-container *ngTemplateOutlet="digitsTpl" />
            }
            @case ('missing') {
              <ng-container *ngTemplateOutlet="tuneTpl; context: { $implicit: data().tune, label: '▶ המכשיר', who: 'device' }" />
              <ng-container *ngTemplateOutlet="tuneTpl; context: { $implicit: data().musicBox, label: '▶ תיבת הנגינה', who: 'box' }" />
              <p class="muted small">הגובה של כל עמודה הוא גובה הצליל: גבוה יותר — צליל גבוה יותר.</p>
              <ng-container *ngTemplateOutlet="digitsTpl" />
            }
            @case ('clock') {
              <svg class="clock" viewBox="-110 -110 220 220" role="img" [attr.aria-label]="clockLabel()">
                <circle r="104" class="face" />
                @for (m of data().marks; track m.id; let k = $index) {
                  <text [attr.x]="sin(k) * 82" [attr.y]="-cos(k) * 82 + 7" text-anchor="middle" class="mark">{{ symIcon(m.id) }}</text>
                }
                @for (h of handAngles(); track $index) {
                  <line x1="0" y1="0" [attr.x2]="sinA(h) * ($index ? 70 : 48)" [attr.y2]="-cosA(h) * ($index ? 70 : 48)" [class]="'hand h' + $index" />
                }
                <circle r="6" class="pin" />
              </svg>
              @if (!solved()) {
                <div class="hands">
                  @for (label of data().handLabels; track $index) {
                    <div class="hand-row">
                      <span>{{ label }}: <b>{{ markAt($index) }}</b></span>
                      <button class="btn small" (click)="operate({ op: 'turn', hand: $index, dir: -1 })" [disabled]="busy()" aria-label="סיבוב נגד כיוון השעון">⟲</button>
                      <button class="btn small" (click)="operate({ op: 'turn', hand: $index, dir: 1 })" [disabled]="busy()" aria-label="סיבוב עם כיוון השעון">⟳</button>
                    </div>
                  }
                </div>
                <button class="btn primary" (click)="operate({ op: 'press' })" [disabled]="busy()">לחיצה על המטוטלת</button>
              }
            }
            @case ('bridge') {
              <svg class="bridge" viewBox="-170 -70 340 140" role="img" [attr.aria-label]="bridgeLabel()">
                <rect x="-160" y="30" width="320" height="30" class="pit" />
                <g [attr.transform]="'rotate(' + (-tilt(0) * 6) + ')'"><rect x="-130" y="-4" width="130" height="8" class="plank" [class.locked]="latched(0)" /></g>
                <g [attr.transform]="'rotate(' + (-tilt(1) * 6) + ')'"><rect x="0" y="-4" width="130" height="8" class="plank" [class.locked]="latched(1)" /></g>
                <circle r="7" cx="0" cy="0" class="axle" />
                <path d="M138 -2 L162 -2 L158 18 L142 18 Z" class="cup" [class.full]="solved()" />
                @for (st of stations(); track st) { <line [attr.x1]="stationX(st)" [attr.x2]="stationX(st)" y1="-16" y2="-10" class="tick" /> }
                <circle r="8" [attr.cx]="ballX()" [attr.cy]="ballY()" class="ball" />
              </svg>
              @if (!solved()) {
                <p class="room-ctl">🕹 את הגשר מפעילים בחדר עצמו: בכל צד עמדה משלו — ידית ירוקה שמכוונת את הזווית (▲ / ▼), בריח שנועל את החצי ומד שיפוע. בריח נעול מחזיק את החצי במקומו, כך שאפשר לכוון את החצי השני לבד. כששני החצאים מיושרים ונעולים, נורית „הגשר מוכן” נדלקת ליד כפתור השחרור.</p>
                <p class="muted small">החצי השמאלי: שיפוע {{ tilt(0) }}{{ latched(0) ? ' · נעול 🔒' : '' }} · החצי הימני: שיפוע {{ tilt(1) }}{{ latched(1) ? ' · נעול 🔒' : '' }}</p>
                <p class="muted small">{{ bridgeStatus() }}</p>
              }
            }
            @case ('track') {
              <div class="track" dir="ltr" role="group" aria-label="לוח המסילה: הכדור נכנס משמאל, המכל מימין למטה">
                @for (cell of trackCells(); track cell.i) {
                  <button class="tt" [style.grid-row]="cell.r + 1" [style.grid-column]="cell.c + 2" [class.wet]="cell.wet" [class.cp]="cell.cp" [class.fixed]="!cell.turn"
                    (click)="operate({ op: 'rotate', index: cell.i })" [disabled]="busy() || !cell.turn || solved()" [attr.aria-label]="'חלק מסילה בשורה ' + (cell.r + 1) + ', עמודה ' + (cell.c + 1)">
                    <svg viewBox="0 0 100 100" aria-hidden="true"><g [attr.transform]="'rotate(' + cell.deg + ' 50 50)'">
                      @if (cell.kind === 'S') { <path d="M0 50 H100" /> } @else { <path d="M50 0 Q50 50 100 50" /> }
                    </g></svg>
                    @if (cell.cp) { <span class="lamp" aria-hidden="true">💡</span> }
                  </button>
                }
                <span class="end" [style.grid-row]="(data().source?.row ?? 0) + 1" style="grid-column:1">⚪</span>
                <span class="end" [style.grid-row]="(data().tank?.row ?? 0) + 1" style="grid-column:8">🪣</span>
              </div>
              @if (!solved()) {
                <div class="row wrap">
                  <button class="btn" (click)="operate({ op: 'valve', id: 'drain' })" [disabled]="busy()">{{ mech()?.levers?.[1] ? 'סגירת פתח המילוט' : 'פתיחת פתח המילוט' }}</button>
                  <button class="btn primary" (click)="operate({ op: 'valve', id: 'main' })" [disabled]="busy()">שחרור הכדור</button>
                </div>
                <p class="muted small">פתח המילוט {{ mech()?.levers?.[1] ? 'פתוח' : 'סגור' }} · {{ mech()?.found?.length ? 'בניסיון האחרון הכדור עבר ' + mech()!.found!.length + ' חלקים (מסומנים)' : 'הכדור עוד לא שוחרר' }}</p>
              }
            }
            @case ('slots') {
              @if (puzzleId() === 'cc2-gears') {
                <ol class="steps">
                  <li [class.on]="!selected()">בחרו גלגל מהשולחן (למטה).</li>
                  <li [class.on]="!!selected()">לחצו על פין פנוי. גלגל מתאים נשאר על הפין עם מסגרת ירוקה; גלגל שלא מתאים מסומן באדום וחוזר לשולחן.</li>
                  <li [class.on]="slotsFull()">כשעל כל שלושת הפינים יש גלגל — „{{ data().activateLabel ?? data().checkLabel }}”.</li>
                </ol>
                <svg class="gears" viewBox="0 0 240 150" role="group" aria-label="רכבת הגלגלים: מנוע ושלושה פינים">
                  <defs><marker id="cc-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L10 5 L0 10 z" class="arrowhead" /></marker></defs>
                  <line x1="34" y1="75" x2="196" y2="75" class="axis" />
                  <circle cx="34" cy="75" r="16" class="motor" />
                  <path d="M 34 49 A 26 26 0 0 1 60 75" class="spin" marker-end="url(#cc-arrow)" />
                  <text x="34" y="113" text-anchor="middle" class="lbl">מנוע</text>
                  <text x="34" y="127" text-anchor="middle" class="lbl">רדיוס 2</text>
                  <text x="102" y="134" text-anchor="middle" class="lbl">פינים</text>
                  @for (x of pinPx; track x; let i = $index) {
                    <g class="pinbox" [class.ready]="!!selected() && !gearR(i)" [class.fb-ok]="fb.of('g' + (i + 1)) === 'right'" [class.fb-no]="fb.of('g' + (i + 1)) === 'wrong'" (click)="slotClick('g' + (i + 1))" role="button" tabindex="0" [attr.aria-label]="'פין ' + (i + 1)">
                      @if (gearR(i)) {
                        <circle [attr.cx]="x" cy="75" [attr.r]="gearR(i) * 8" class="gear" />
                        <text [attr.x]="x" y="79" text-anchor="middle" class="teeth">{{ teethAt(i) }}</text>
                      } @else {
                        <circle [attr.cx]="x" cy="75" r="20" class="empty" />
                        <circle [attr.cx]="x" cy="75" r="4" class="pin" />
                      }
                      <text [attr.x]="x" y="115" text-anchor="middle" class="lbl pin-n">{{ i + 1 }}</text>
                      @if (fb.of('g' + (i + 1)); as v) { <text [attr.x]="x + 16" y="50" text-anchor="middle" class="fb-svg" [class.no]="v === 'wrong'">{{ v === 'right' ? '✓' : '✗' }}</text> }
                    </g>
                  }
                  <rect x="170" y="58" width="30" height="34" rx="4" class="drawer" />
                  <text x="185" y="111" text-anchor="middle" class="lbl">מגירה</text>
                  <path d="M 200 52 A 22 22 0 0 0 178 40" class="spin need" marker-end="url(#cc-arrow)" />
                  <text x="150" y="22" text-anchor="middle" class="lbl need-t">נפתחת בסיבוב נגד כיוון השעון</text>
                </svg>
              }
              <div class="slots" [class.many]="slots().length > 4">
                @for (sl of slots(); track sl.id) {
                  @let placed = mech()?.slots?.[sl.id];
                  <button class="slot fb-host" [class.full]="!!placed" [class.lit]="solved()" [class.fb-right]="fb.of(sl.id) === 'right'" [class.fb-wrong]="fb.of(sl.id) === 'wrong'" (click)="slotClick(sl.id)" [disabled]="busy() || (solved() && !readable(placed))" [class.reading]="solved() && !!placed && selected() === placed">
                    @if (fb.of(sl.id); as v) { <span class="fb-mark" [class.right]="v === 'right'" [class.wrong]="v === 'wrong'" aria-hidden="true">{{ v === 'right' ? '✓' : '✗' }}</span> }
                    <small>{{ sl.label }}</small>
                    <b>{{ placed ? itemName(placed) : 'ריק' }}</b>
                    @if (by(sl.id); as b) { <em class="by">✋ {{ b }}</em> }
                  </button>
                }
              </div>
              @if (solved() && hasReadable()) { <p class="muted small">לחצו על מכתב שעל השולחן כדי לקרוא אותו שוב.</p> }
              <ng-container *ngTemplateOutlet="bagTpl" />
              <!-- judged one by one with nothing to activate (the last wall): the last right piece completes it by itself -->
              @if (!solved() && !(data().judgeEach && data().mode !== 'activate')) { <button class="btn primary" (click)="operate({ op: 'activate' })" [disabled]="busy()">{{ data().activateLabel ?? data().checkLabel ?? 'בדיקה' }}</button> }
            }
            @case ('model') {
              <div class="views">
                <span><b>חזית:</b> {{ viewText('front') }}</span>
                <span><b>צד:</b> {{ viewText('side') }}</span>
                <span><b>מלמעלה:</b> {{ data().views?.top }}</span>
              </div>
              <p class="muted small">השורה העליונה היא החלק האחורי של המודל, התחתונה — החזית. החץ מראה לאן החלק פונה. בחרו חלק ואחר כך חלק אחר כדי להחליף ביניהם.</p>
              <div class="grid" dir="ltr">
                @for (cell of modelCells(); track cell.slot) {
                  <div class="cell" [class.sel]="pick() === cell.piece">
                    <button class="piece" (click)="pickPiece(cell.piece)" [disabled]="busy() || solved()">
                      <span class="arrow" [style.transform]="'rotate(' + cell.rot * 90 + 'deg)'">⬇</span>
                      <small dir="rtl">{{ cell.label }}</small>
                    </button>
                    @if (!solved()) { <button class="btn small ghost" (click)="operate({ op: 'rotate', piece: cell.piece })" [disabled]="busy()" aria-label="סיבוב החלק">⟳</button> }
                  </div>
                }
              </div>
            }
            @case ('build') {
              <ol class="stages">
                @for (st of data().stages; track st.id; let k = $index) {
                  <li [class.done]="k < progress()" [class.now]="k === progress()">{{ k < progress() ? '✔' : k === progress() ? '◆' : '·' }} {{ st.label }}</li>
                }
              </ol>
              @if (currentStage(); as st) {
                <div class="slots many">
                  @for (sock of st.sockets; track sock.id) {
                    @let placed = mech()?.slots?.[sock.id];
                    <div class="slot" [class.full]="!!placed">
                      <small>{{ sock.label }}</small>
                      <b>{{ placed ? itemName(placed) : 'ריק' }}</b>
                      @if (placed && rotatable(placed)) { <span class="muted small">{{ faceText(placed, sock.id) }}</span> }
                      @if (by(sock.id); as b) { <em class="by">✋ {{ b }}</em> }
                      <div class="row">
                        @if (placed) {
                          @if (rotatable(placed)) { <button class="btn small" (click)="operate({ op: 'turn', socket: sock.id })" [disabled]="busy()">⟳ סיבוב</button> }
                          <button class="btn small ghost" (click)="operate({ op: 'remove', socket: sock.id })" [disabled]="busy()">הרמה</button>
                        } @else {
                          <button class="btn small" (click)="placeAt(sock.id)" [disabled]="busy()">הנחה כאן</button>
                        }
                      </div>
                    </div>
                  }
                </div>
                <ng-container *ngTemplateOutlet="bagTpl" />
                <button class="btn primary" (click)="operate({ op: 'check' })" [disabled]="busy()">{{ data().checkLabel ?? 'בדיקת השלב' }}</button>
              }
            }
            @default {
              @if (kind() === 'safe') {
                <div class="chain" aria-hidden="true">
                  @for (k of [1, 2, 3]; track k) { <span [class.on]="k === data().chain" [class.done]="k < data().chain">🔒</span> }
                </div>
              }
              <ng-container *ngTemplateOutlet="digitsTpl" />
            }
          }

          <ng-template #digitsTpl>
            @if (!solved()) {
              <form class="row" (submit)="$event.preventDefault(); answer(text())">
                <input [value]="text()" (input)="text.set(digitsOnly($any($event.target).value))" inputmode="numeric" [attr.maxlength]="data().digits"
                  dir="ltr" class="code" placeholder="{{ '•'.repeat(data().digits ?? 3) }}" aria-label="קוד" />
                <button class="btn primary" type="submit" [disabled]="text().length !== data().digits || busy()">פתיחה</button>
              </form>
            }
          </ng-template>

          <ng-template #tuneTpl let-tune let-label="label" let-who="who">
            <div class="tune">
              <button class="btn" (click)="playTune(tune, who)">{{ label }}</button>
              <div class="bars" aria-label="ייצוג חזותי של הצלילים">
                @for (n of tune; track $index) {
                  <span class="bar" [class.now]="playing()?.who === who && playing()?.index === $index" [style.height.px]="barH(n)" [style.background]="barColor">
                    <small>{{ $index + 1 }}</small>
                  </span>
                }
              </div>
            </div>
          </ng-template>

          <ng-template #bagTpl>
            <div class="bag">
              <span class="muted small">{{ data().fromRoom ? 'בחדר:' : 'זמין:' }}</span>
              @for (id of bagItems(); track id) {
                <button class="inv" [class.sel]="selected() === id" (click)="select(id)" [title]="plainText(itemDesc(id))">{{ itemName(id) }}</button>
              } @empty { <span class="muted small">אין חלקים זמינים.</span> }
            </div>
            @if (selected(); as id) {
              @if (isLetterItem(id)) { <article class="letter-card" dir="rtl"><p [innerHTML]="letterHtml(itemDesc(id))"></p></article> }
              @else { <p class="desc">🔎 {{ itemDesc(id) }}</p> }
            }
          </ng-template>

          @if (cooldown()) { <p class="warn">{{ cooldown() }}</p> }
          @if (message(); as m) { <p class="msg" [class.bad]="!m.ok" role="status">{{ m.text }}</p> }

          @if (!solved()) {
            <footer>
              @for (h of state()?.hints ?? []; track $index) { <p class="hint">💡 {{ h }}</p> }
              @if ((state()?.hintsRevealed ?? 0) < hintCount()) {
                <button class="btn small" (click)="hint()" [disabled]="busy()">בקשת רמז (−{{ penalty() }} לניקוד הקבוצתי של החדר)</button>
              }
            </footer>
          }
        }
      </section>
    </div>
  `,
  styles: [FEEDBACK_CSS, LETTER_CARD_CSS, `
    .panel-modal { width: min(780px, calc(100% - 24px)); max-height: calc(100dvh - 32px); overflow:auto; }
    header { display:flex; justify-content:space-between; align-items:flex-start; gap:1rem; }
    h2 { margin:.3rem 0 .4rem; font-family: var(--font-title); color: var(--gold-2); }
    .instructions { line-height:1.7; margin:.2rem 0 .8rem; }
    .locked { font-size:1.1rem; color: var(--muted); }
    .solved { color:#9be3b4; border:1px solid var(--ok); border-radius:10px; padding:.5rem .8rem; }
    .row { display:flex; gap:.5rem; align-items:center; } .row.wrap { flex-wrap:wrap; } .row input { flex:1; min-width:0; }
    .code { font-size:1.4rem; letter-spacing:.4em; text-align:center; }
    .msg { margin:.6rem 0 0; color:#9be3b4; } .msg.bad { color:#f0a08a; } .warn { color:#f0c27a; }
    .hint { margin:0; color:#cfe2ff; } footer { margin-top:.8rem; display:grid; gap:.4rem; }
    .muted { color: var(--muted); } .small { font-size:.85rem; }
    .bells { display:flex; gap:.6rem; justify-content:center; align-items:flex-end; margin:.4rem 0 .8rem; }
    .bell { display:grid; justify-items:center; gap:.25rem; background:#2a1c10; border:1px solid #8a6a3a; border-radius:12px; padding:.5rem .7rem; color:inherit; cursor:pointer; }
    .bell-ico { font-size: calc(1.2rem + var(--s) * 1.4rem); }
    .bell .bar, .bars .bar { display:block; width:22px; border-radius:6px 6px 2px 2px; }
    .bell .bell-bar { height:34px; background:#5a4a36; }
    .tune { display:flex; gap:.8rem; align-items:flex-end; margin:.4rem 0; flex-wrap:wrap; }
    .bars { display:flex; gap:.35rem; align-items:flex-end; min-height:90px; padding:.3rem .5rem; background:#1a120a; border-radius:10px; }
    .bars .bar { position:relative; opacity:.55; transition: opacity .15s, transform .15s; }
    .bars .bar.now { opacity:1; transform: scaleX(1.25); box-shadow:0 0 10px #ffe0a0; }
    .bars .bar small { position:absolute; bottom:-1.2rem; left:0; right:0; text-align:center; font-size:.7rem; color:var(--muted); }
    .clock { width:min(260px, 70vw); display:block; margin:.2rem auto .6rem; }
    .clock .face { fill:#efe2bf; stroke:#6a4a20; stroke-width:4; } .clock .mark { font-size:20px; fill:#3a2410; }
    .clock .hand { stroke:#1a120a; stroke-linecap:round; transition: all .3s; } .clock .h0 { stroke-width:7; } .clock .h1 { stroke-width:4; } .clock .pin { fill:#b8862f; }
    .hands { display:grid; gap:.4rem; margin-bottom:.6rem; } .hand-row { display:flex; gap:.5rem; align-items:center; justify-content:space-between; }
    .bridge { width:100%; max-width:520px; display:block; margin:0 auto .6rem; }
    .bridge .pit { fill:#120a06; } .bridge .plank { fill:#a8784a; stroke:#5a3a1a; transition: all .3s; } .bridge .plank.locked { fill:#c8a058; stroke:#ffd27a; stroke-width:2; }
    .bridge .axle { fill:#c9a050; } .bridge .cup { fill:#b8862f; } .bridge .cup.full { fill:#ffd76a; } .bridge .ball { fill:#d8d8e0; stroke:#6a6a7a; }
    .bridge .tick { stroke:#f0d090; stroke-width:2; }
    .room-ctl { background:#1e2a1e; border:1px solid #4a7a4a; border-radius:10px; padding:.5rem .8rem; line-height:1.6; }
    .stations { display:grid; grid-template-columns: 1fr 1fr; gap:.6rem; margin-bottom:.6rem; }
    .station { display:grid; gap:.35rem; border:1px solid #6a4a2a; border-radius:12px; padding:.5rem; } .station.mine { border-color: var(--gold-2); box-shadow:0 0 0 1px var(--gold-2) inset; }
    .track { display:grid; grid-template-columns:1.6rem repeat(6, minmax(0, 56px)) 1.6rem; gap:4px; justify-content:center; align-items:center; margin:.3rem 0 .6rem; }
    .tt { position:relative; aspect-ratio:1; padding:0; border-radius:8px; border:2px solid #8a6a3a; background:#2e1e10; cursor:pointer; }
    .tt:disabled { opacity:1; } .tt.fixed { border-color:#555; }
    .tt svg { width:100%; height:100%; display:block; } .tt path { fill:none; stroke:#a8a8b4; stroke-width:16; }
    .tt.wet path { stroke:#ffcf6a; } .tt.cp { box-shadow:0 0 0 2px #c9a050 inset; } .tt .lamp { position:absolute; top:1px; right:2px; font-size:.75rem; }
    .end { font-size:1.2rem; text-align:center; }
    .slots { display:grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap:.5rem; margin:.4rem 0; }
    .slot { display:grid; gap:.2rem; text-align:center; background:#21170e; border:1px dashed #8a6a3a; border-radius:12px; padding:.55rem; color:inherit; }
    button.slot { cursor:pointer; } .slot.full { border-style:solid; } .slot.lit { border-color: var(--ok); } .slot.reading { box-shadow: 0 0 0 2px #e6c27a; }
    .by { font-size:.75rem; color: var(--muted); }
    .bag { display:flex; flex-wrap:wrap; gap:.4rem; align-items:center; margin:.5rem 0; }
    .inv { background:#2a1c10; border:1px solid #8a6a3a; border-radius:999px; padding:.3rem .7rem; color:inherit; cursor:pointer; }
    .inv.sel { border-color: var(--gold-2); background:#3a2810; }
    .desc { background:#efe2bf; color:#3a2410; border-radius:10px; padding:.5rem .8rem; line-height:1.6; }
    .gears { width:100%; max-width:460px; display:block; margin:.2rem auto .4rem; background:#1a1410; border-radius:12px; }
    .gears .axis { stroke:#3a2e22; stroke-width:2; stroke-dasharray:4 4; } .gears .motor { fill:#55595f; stroke:#8a8e94; stroke-width:2; }
    .gears .gear { fill:#c0714a; stroke:#ffd9a0; stroke-width:1.5; opacity:.9; } .gears .pin { fill:#c9a050; }
    .gears .empty { fill:none; stroke:#8a6a3a; stroke-width:2; stroke-dasharray:5 4; }
    .gears .pinbox.fb-ok circle { stroke:#3fbf6a; stroke-width:4; } .gears .pinbox.fb-no .empty { stroke:#e2715b; stroke-width:4; fill: rgba(226,113,91,.18); }
    .gears .fb-svg { fill:#3fbf6a; font-size:16px; font-weight:800; } .gears .fb-svg.no { fill:#e2715b; }
    .gears .pinbox { cursor:pointer; } .gears .pinbox.ready .empty { stroke:#ffd76a; stroke-width:3; animation: ccpulse 1s ease-in-out infinite; }
    .gears .teeth { fill:#1a0e06; font-size:11px; font-weight:700; } .gears .lbl { fill:#d8c8a8; font-size:11px; }
    .gears .drawer { fill:#6a4424; stroke:#c9a050; } .gears .spin { fill:none; stroke:#9be3b4; stroke-width:2.5; } .gears .arrowhead { fill:#9be3b4; }
    .gears .spin.need { stroke:#ffd76a; } .gears .need-t { fill:#ffd76a; } .gears .pin-n { font-weight:700; font-size:12px; }
    @keyframes ccpulse { 50% { opacity:.4; } }
    .steps { margin:.2rem 0 .4rem; padding-inline-start:1.3rem; line-height:1.7; color: var(--muted); } .steps li.on { color: var(--gold-2); font-weight:700; }
    .views { display:grid; gap:.25rem; background:#1a2a3a; border-radius:10px; padding:.5rem .8rem; margin-bottom:.4rem; }
    .grid { display:grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap:.5rem; margin:.4rem 0 .6rem; }
    .cell { display:grid; gap:.3rem; justify-items:center; } .cell.sel .piece { border-color: var(--gold-2); background:#3a2810; }
    .piece { width:100%; display:grid; justify-items:center; gap:.2rem; background:#21170e; border:1px solid #8a6a3a; border-radius:12px; padding:.6rem .3rem; color:inherit; cursor:pointer; }
    .arrow { display:inline-block; font-size:1.3rem; transition: transform .3s; }
    .stages { display:flex; flex-wrap:wrap; gap:.4rem .9rem; padding:0; list-style:none; margin:.2rem 0 .6rem; }
    .stages li { color: var(--muted); } .stages li.done { color:#9be3b4; } .stages li.now { color: var(--gold-2); font-weight:700; }
    .chain { display:flex; gap:.6rem; justify-content:center; font-size:1.6rem; margin-bottom:.4rem; }
    .chain span { opacity:.35; } .chain span.on { opacity:1; } .chain span.done { opacity:.8; filter: hue-rotate(80deg); }
    @media (max-width: 560px) { .stations { grid-template-columns: 1fr; } .track { grid-template-columns:1.2rem repeat(6, minmax(0, 1fr)) 1.2rem; } }
  `],
  imports: [NgTemplateOutlet],
})
export class CcPanelComponent {
  game = inject(GameService);
  private audio = inject(AudioService);
  puzzleId = input.required<string>();
  /** The object used to open it (the bridge has a station on each side). */
  from = input<string | undefined>();
  close = output<void>();

  text = signal('');
  busy = signal(false);
  selected = signal<string | null>(null);
  /** Right / wrong frames on the places just used (cc-feedback.ts). */
  readonly fb = new PlacementFeedback();
  pick = signal<string | null>(null);
  message = signal<{ ok: boolean; text: string } | null>(null);
  playing = signal<{ who: string; index: number } | null>(null);
  private timers: ReturnType<typeof setTimeout>[] = [];

  puzzle = computed<PuzzleContent | undefined>(() => this.game.scenario()?.puzzles.find((p) => p.id === this.puzzleId()));
  state = computed<PuzzleStateDto | undefined>(() => this.game.snapshot()?.puzzles.find((p) => p.id === this.puzzleId()));
  mech = computed<MechanismState | undefined>(() => this.game.snapshot()?.mechanisms?.[this.puzzleId()]);
  data = computed<any>(() => ({ ...(this.puzzle()?.publicData ?? {}), ...(this.game.snapshot()?.questions?.[this.puzzleId()] ?? {}) }));
  solved = computed(() => this.state()?.status === 'solved');
  kind = computed(() => {
    const p = this.puzzle();
    if (!p) return 'none';
    if (p.id === 'cc1-listen') return 'listen';
    if (p.id === 'cc1-missing') return 'missing';
    if (p.type === 'compass') return 'clock';
    if (p.type === 'bridge') return 'bridge';
    if (p.type === 'pipes') return 'track';
    if (p.type === 'slots') return 'slots';
    if (p.type === 'assembly') return 'model';
    if (p.type === 'build') return 'build';
    return p.id.startsWith('cc3-safe') ? 'safe' : 'code';
  });
  zoneName = computed(() => this.game.scenario()?.zones.find((z) => z.id === this.puzzle()?.zone)?.name ?? '');
  lockedText = computed(() => {
    const req = this.puzzle()?.requiresPuzzle;
    const title = this.game.scenario()?.puzzles.find((p) => p.id === req)?.title;
    return title ? `המנגנון הזה נעול. קודם צריך להשלים את „${title}”.` : 'החדר הזה עדיין נעול.';
  });
  cooldown = computed(() => {
    const until = this.state()?.cooldownUntil;
    if (!until) return null;
    const sec = Math.ceil((Date.parse(until) - this.game.serverNow()) / 1000);
    return sec > 0 ? `המנגנון נעול עוד ${sec} שניות — נצלו את הזמן לחשוב יחד.` : null;
  });
  hintCount = computed(() => this.puzzle()?.hintCount ?? 0);
  penalty = computed(() => this.game.scenario()?.scoring?.hintPenalty ?? 10);
  private items = computed(() => new Map<string, ItemContent>((this.game.scenario()?.items ?? []).map((i) => [i.id, i])));

  constructor() {
    inject(DestroyRef).onDestroy(() => { this.timers.forEach(clearTimeout); clearTimeout(this.closing); this.fb.dispose(); });
    // a solve confirmed by the server while this window is open closes it after a moment, so the room's mechanism can be
    // seen moving; a window opened on an already solved puzzle stays open, and a wrong answer never closes it
    effect(() => {
      const st = this.state();
      if (!st) return;
      if (st.status !== 'solved') this.sawOpen = true;
      else if (this.sawOpen && !this.closing) this.closing = setTimeout(() => this.close.emit(), 1300);
    });
    // the other player's placements frame the same places here: a piece judged on its own from the shared state (a new
    // right piece, or the one place the server last judged wrong), a whole arrangement from the room's notices. Only
    // what someone else did (my own actions are framed from the server's answer), and nothing here touches the score.
    effect(() => {
      const m = this.mech();
      untracked(() => this.framePartnerChange(m));
    });
    const sub = this.game.notices$.subscribe((n) => {
      if (n.puzzleId !== this.puzzleId() || this.judgedEach()) return;
      if (n.kind === 'wrong-answer' && n.playerId && n.playerId !== this.game.playerId()) this.fb.showAll(this.filledPlaces(), 'wrong');
      else if (n.kind === 'team-solved') this.fb.showAll(this.filledPlaces(), 'right');
    });
    inject(DestroyRef).onDestroy(() => sub.unsubscribe());
  }
  private judgedEach = () => !!this.data().judgeEach || !!this.data().checkEach;
  private seen: { rev: number; slots: Record<string, string>; misses: number } | null = null;
  private framePartnerChange(m: MechanismState | undefined) {
    const prev = this.seen;
    this.seen = m ? { rev: m.rev ?? 0, slots: { ...(m.slots ?? {}) }, misses: m.misses ?? 0 } : null;
    if (!prev || !m || (m.rev ?? 0) <= prev.rev || !m.lastById || m.lastById === this.game.playerId() || !this.judgedEach()) return;
    for (const [k, v] of Object.entries(m.slots ?? {})) if (v && prev.slots[k] !== v) this.fb.show(k, 'right');
    if ((m.misses ?? 0) > prev.misses) for (const [k, ok] of Object.entries(m.verdict ?? {})) if (!ok) this.fb.show(k, 'wrong');
  }
  private sawOpen = false;
  private closing?: ReturnType<typeof setTimeout>;

  @HostListener('window:keydown', ['$event'])
  onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') this.close.emit();
  }

  // ---------------------------------------------------------------- items and slots

  itemName = (id: string) => this.items().get(id)?.name ?? id;
  readonly isLetterItem = isLetterItem;
  readonly letterHtml = letterHtml;
  readonly plainText = plainText;
  itemDesc = (id: string) => this.items().get(id)?.description ?? '';
  slots = computed<{ id: string; label: string }[]>(() => this.data().slots ?? []);
  bagItems = computed(() => {
    const accepts: string[] = this.data().accepts ?? [];
    const s = this.game.snapshot();
    const own = (s?.inventory ?? []).filter((i) => accepts.includes(i));
    const room = (s?.worldItems ?? []).filter((i) => accepts.includes(i) && !own.includes(i) && (this.data().fromRoom || this.kind() === 'build'));
    return [...room, ...own];
  });
  by(slot: string): string | null {
    const id = this.mech()?.slotBy?.[slot];
    if (!id || !this.mech()?.slots?.[slot]) return null;
    return this.game.playerName(id) || null;
  }
  select(id: string) {
    this.selected.set(this.selected() === id ? null : id);
  }
  /** A letter stays readable on the table after the puzzle is solved (its bold word is needed for the next puzzle). */
  readable(id: string | null | undefined) {
    return !!id && isLetterItem(id);
  }
  hasReadable = computed(() => Object.values(this.mech()?.slots ?? {}).some((id) => this.readable(id)));
  slotClick(slot: string) {
    const placed = this.mech()?.slots?.[slot];
    if (this.solved()) {
      if (this.readable(placed)) this.selected.set(this.selected() === placed ? null : placed!);
      return;
    }
    if (placed) return void this.operate({ op: 'remove', slot });
    const item = this.selected() ?? (this.bagItems().length === 1 ? this.bagItems()[0] : null);
    if (!item) return this.message.set({ ok: false, text: 'בחרו קודם פריט.' });
    this.selected.set(null);
    void this.operate({ op: 'place', slot, item });
  }
  placeAt(socket: string) {
    const item = this.selected();
    if (!item) return this.message.set({ ok: false, text: 'בחרו קודם חלק מהרשימה.' });
    this.selected.set(null);
    void this.operate({ op: 'place', socket, item });
  }
  /** Where the three pins stand in the drawing: 5, 4 and 3 units apart, as on the table (8 px a unit). */
  readonly pinPx = [74, 106, 130];
  teethAt(i: number) {
    return /-(\d+)$/.exec(this.mech()?.slots?.['g' + (i + 1)] ?? '')?.[1] ?? '';
  }
  gearR(i: number) {
    const id = this.mech()?.slots?.['g' + (i + 1)] ?? '';
    const m = /r(\d)/.exec(id);
    return m ? Number(m[1]) : 0;
  }

  // ---------------------------------------------------------------- sounds and their visual aid

  symName = (id: string) => SYMBOL_NAME[id] ?? id;
  symIcon = (id: string) => SYMBOL_ICON[id] ?? '·';
  barH = (note: number) => 22 + note * 5;
  readonly barColor = BAR_COLOR;
  ring(note: number) {
    this.audio.unlock();
    this.audio.bell(BASE_HZ * Math.pow(2, note / 12));
  }
  playTune(tune: number[], who: string) {
    this.audio.unlock();
    this.timers.forEach(clearTimeout);
    this.timers = [];
    const seq: Note[] = tune.map((note, k) => ({ note, at: k * 700 }));
    seq.forEach((n, index) => this.timers.push(setTimeout(() => {
      this.playing.set({ who, index });
      this.audio.bell(BASE_HZ * Math.pow(2, n.note / 12));
    }, n.at)));
    this.timers.push(setTimeout(() => this.playing.set(null), tune.length * 700 + 300));
  }

  // ---------------------------------------------------------------- the clock

  sin = (k: number) => Math.sin((k / 8) * Math.PI * 2);
  cos = (k: number) => Math.cos((k / 8) * Math.PI * 2);
  sinA = (a: number) => Math.sin(a);
  cosA = (a: number) => Math.cos(a);
  handAngles = computed(() => (this.mech()?.rotations ?? this.data().start ?? [0, 0]).map((k: number) => (k / 8) * Math.PI * 2));
  markAt(hand: number) {
    const k = (this.mech()?.rotations ?? this.data().start ?? [0, 0])[hand] ?? 0;
    return this.symName(this.data().marks?.[k]?.id ?? '');
  }
  clockLabel = computed(() => `מחוג השעות על ${this.markAt(0)}, מחוג הדקות על ${this.markAt(1)}`);

  // ---------------------------------------------------------------- the bridge

  tilt = (side: number) => (this.mech()?.rotations ?? this.data().start ?? [0, 0])[side] ?? 0;
  latched = (side: number) => !!this.mech()?.levers?.[side];
  stations = computed(() => Array.from({ length: (this.data().stations ?? 4) + 1 }, (_, k) => k));
  stationX = (p: number) => -130 + (p * 260) / (this.data().stations ?? 4);
  ballX = computed(() => (this.solved() ? 150 : this.stationX(this.mech()?.progress ?? 0)));
  ballY = computed(() => {
    if (this.solved()) return 6;
    const x = this.ballX();
    const a = x <= 0 ? this.tilt(0) : this.tilt(1);
    return -12 - x * Math.tan((a * 6 * Math.PI) / 180);
  });
  mySide = computed(() => (this.from() === 'cc2-lever-left' ? 0 : this.from() === 'cc2-lever-right' ? 1 : -1));
  bridgeLabel = computed(() => `החצי השמאלי בשיפוע ${this.tilt(0)}, הימני בשיפוע ${this.tilt(1)}, הכדור בתחנה ${this.mech()?.progress ?? 0}`);
  bridgeStatus = computed(() => {
    const r = this.mech()?.revealed;
    const d = this.data();
    const misses = this.mech()?.misses ?? 0;
    const last = r === 'rest' ? `הכדור נעצר בתחנה ${this.mech()?.progress ?? 0}.` : r === 'stuck' ? d.stuckMessage : r ? d[r + 'Message'] ?? '' : 'הכדור על משטח ההתחלה.';
    return `${last}${misses ? ` · נפילות: ${misses}` : ''}`;
  });

  // ---------------------------------------------------------------- the track

  trackCells = computed(() => {
    const d = this.data();
    const tiles: string[] = d.tiles ?? [];
    const turnable: string[] = d.turnable ?? [];
    const cps: string[] = d.checkpoints ?? [];
    const m = this.mech();
    const found = new Set(m?.found ?? []);
    const cells: { i: number; r: number; c: number; kind: string; turn: boolean; deg: number; wet: boolean; cp: boolean }[] = [];
    tiles.forEach((row, r) => [...row].forEach((kind, c) => {
      const i = r * row.length + c;
      cells.push({ i, r, c, kind, turn: turnable.includes(`${r},${c}`), deg: (m?.rotations?.[i] ?? 0) * 90, wet: found.has(`${r},${c}`) || this.solved(), cp: cps.includes(`${r},${c}`) });
    }));
    return cells;
  });

  // ---------------------------------------------------------------- the model

  viewText(which: 'front' | 'side') {
    const ids: string[] = this.data().views?.[which] ?? [];
    const label = new Map<string, string>((this.data().pieces ?? []).map((p: { id: string; label: string }) => [p.id, p.label]));
    return ids.map((id) => label.get(id) ?? id).join(' · ');
  }
  modelCells = computed(() => {
    const pieces: { id: string; label: string }[] = this.data().pieces ?? [];
    const m = this.mech();
    const order: string[] = m?.slots && Object.keys(m.slots).length ? Array.from({ length: 6 }, (_, k) => m.slots['p' + (k + 1)]) : this.data().start?.order ?? [];
    const turns: number[] = m?.rotations?.length ? m.rotations : this.data().start?.turns ?? [];
    // shown with the back row on top: p4 p5 p6 / p1 p2 p3
    return [3, 4, 5, 0, 1, 2].map((k) => {
      const piece = order[k];
      const idx = pieces.findIndex((p) => p.id === piece);
      return { slot: 'p' + (k + 1), piece, label: pieces[idx]?.label ?? '', rot: turns[idx] ?? 0 };
    });
  });
  pickPiece(id: string) {
    const first = this.pick();
    if (!first) return this.pick.set(id);
    this.pick.set(null);
    if (first !== id) void this.operate({ op: 'swap', a: first, b: id });
  }

  // ---------------------------------------------------------------- the house

  progress = computed(() => this.mech()?.progress ?? 0);
  currentStage = computed<{ id: string; label: string; sockets: { id: string; label: string }[] } | undefined>(() => this.data().stages?.[this.progress()]);
  rotatable = (item: string) => (this.data().rotatable ?? []).includes(item);
  faceText(item: string, socket: string) {
    return wallFaceText(item, Number(this.mech()?.backs?.[socket] ?? 0), socket);
  }

  // ---------------------------------------------------------------- talking to the server

  digitsOnly = (v: string) => v.replace(/[^0-9]/g, '');

  async operate(action: Record<string, unknown>) {
    this.busy.set(true);
    try {
      const op = String(action['op'] ?? '');
      const sent = ['place', 'remove', 'turn', 'swap', 'rotate'].includes(op) ? { ...action, rev: this.mech()?.rev ?? 0 } : action;
      const r = await this.game.operate(this.puzzleId(), sent);
      this.feedback(op, action, r.ok, r.code);
      if (!r.ok) {
        this.message.set({ ok: false, text: r.message });
        this.audio.sfx('wrong');
      } else {
        this.message.set(r.message ? { ok: true, text: r.message } : null);
        this.audio.sfx(op === 'release' || op === 'valve' ? 'lever' : op === 'turn' || op === 'rotate' ? 'gear' : 'click');
      }
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * The right / wrong frames, from the server's answer only. A place judged on its own (the gears) gets its own frame; an
   * arrangement checked as a whole gets one verdict on all its places, so a check never tells which place is wrong.
   */
  private feedback(op: string, action: Record<string, unknown>, ok: boolean, code: string) {
    const key = String(action['slot'] ?? action['socket'] ?? '');
    const judgedEach = !!this.data().judgeEach || !!this.data().checkEach;
    if (op === 'place' && key) {
      if (code === 'wrong-place') this.fb.show(key, 'wrong');
      else if (ok && judgedEach) this.fb.show(key, 'right');
      return;
    }
    if (op === 'activate' || op === 'check') {
      const keys = this.filledPlaces();
      if (ok && (code === 'solved' || code === 'stage' || code === 'built')) this.fb.showAll(keys, 'right');
      else if (code === 'wrong-answer') this.fb.showAll(keys, 'wrong');
    }
  }

  /** The places holding something right now (slots, or the sockets of the current building stage). */
  private filledPlaces(): string[] {
    const m = this.mech();
    return Object.keys(m?.slots ?? {}).filter((k) => !!m?.slots?.[k]);
  }

  slotsFull = computed(() => this.slots().length > 0 && this.slots().every((sl) => !!this.mech()?.slots?.[sl.id]));

  async answer(value: string) {
    if (!value.trim()) return;
    this.busy.set(true);
    try {
      const r = await this.game.submitAnswer(this.puzzleId(), value.trim());
      if (r.ok) { this.audio.sfx('key'); this.text.set(''); }
      this.message.set({ ok: r.ok, text: r.message });
    } finally {
      this.busy.set(false);
    }
  }

  async hint() {
    this.busy.set(true);
    try {
      const r = await this.game.requestHint(this.puzzleId());
      if (!r.ok) this.message.set({ ok: false, text: r.message });
    } finally {
      this.busy.set(false);
    }
  }
}
