import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { AudioService } from '../core/audio.service';
import { GameService } from '../core/game.service';
import { MechanismState, PuzzleContent, PuzzleStateDto } from '../core/models';
import { HPanel } from './h-layout';
import { InspectViewerComponent } from './inspect-viewer.component';
import { MazePadComponent } from './maze-pad.component';

const PANEL_PUZZLE: Record<HPanel, string> = {
  riddle: 'h1-riddle', lamp: 'h2-lamp', maze: 'h3-maze', box: 'h3-box', wheel: 'h4-wheel', stand: 'h5-stand',
  lock: 'h5-lock', jugs: 'h6-jugs', mosaic: 'h7-mosaic', pedestals: 'h8-pedestals', final: 'h8-final',
  map: 'g1-map', symbols: 'g1-books', compass: 'g1-compass', cabinet: 'g1-cabinet', scales: 'h7-scales', pipes: 'g2-pipes', weights: 'g2-weights', gatelock: 'g2-gate',
  evidence: 'h1-evidence', board: 'h1-board', book: 'h1-book', wicks: 'h2-wicks', lamptest: 'h2-test', blueprint: 'h2-blueprint',
  sequence: 'h4-sequence', mirror: 'h4-mirror', spin: 'h5-spin', memory: 'h5-memory', corners: 'h5-corners', shelf: 'h6-shelf', oilscale: 'h6-scales',
};

export const ITEM_EMOJI: Record<string, string> = {
  'antique-key': '🗝️', 'lamp-base': '⚱️', 'lamp-tank': '🫙', 'lamp-wick': '🧵', 'lamp-glass': '🔮', 'lamp-cover': '🔔',
  'menorah-symbol': '🕎', 'golden-key': '🔑', 'light-stone': '💎', 'dreidel-nun': 'נ', 'dreidel-gimel': 'ג', 'dreidel-he': 'ה',
  'dreidel-pe': 'פ', 'flame-symbol': '🔥', 'golden-jug': '🏺', 'blue-crystal': '🔷',
  'map-ridge': '🗺️', 'map-river': '🗺️', 'map-rose': '🗺️', 'book-red': '📕', 'book-green': '📗', 'book-blue': '📘', 'book-brown': '📙',
  'gs-golden-key': '🔑', 'w-book': '📖', 'w-candle': '🕯️', 'w-clock': '🕰️', 'w-cube': '🧊',
  'sc-feather': '🪶', 'sc-key': '🗝️', 'sc-crystal': '💎', 'sc-hourglass': '⏳',
  'ev-book': '📖', 'ev-hourglass': '⏳', 'ev-lamp': '🪔', 'ev-scroll': '📜',
  'w-short': '🧵', 'w-medium': '🧵', 'w-long': '🧵', 'w-star': '⭐',
  'mirror-scroll': '📜',
  'jar-blue': '🫙', 'jar-gold': '🏺', 'jar-flame': '🔥', 'jar-small': '🫗', 'bottle-red': '🍾', 'bottle-green': '🍾', 'bottle-blue': '🍾',
};

const LETTERS = 'אבגדהוזחטיכלמנסעפצקרשת'.split('');
/** The free game's cabinet: the digits typed so far, by game (closing the window keeps them). */
const CABINET_DRAFT = new Map<string, string>();
/** The colours of the free game's four books (the compass's marks too). */
const BOOK_CSS: Record<string, string> = { 'book-red': '#c0392b', 'book-green': '#2e8b4a', 'book-blue': '#2f5fb3', 'book-brown': '#8a5a2b' };
const MAZE_SYMBOLS: Record<string, string> = { '*': '⭐', F: '🔥', M: '🕎', E: '📦', S: '·' };

/**
 * Every Hanukkah puzzle UI. It only collects what the players do and sends it to the server;
 * whether something is right is decided there (answers, placements, maze moves, mosaic turns).
 */
@Component({
  selector: 'px-h-panel',
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
          @if (state()?.status === 'solved') { <p class="solved">✔ {{ puzzle()?.success }}</p> }

          @switch (panel()) {
            @case ('evidence') {
              @if (target(); as t) {
                <p class="look">{{ t.look }}</p>
                <px-inspect-viewer [kind]="t.id" [revealed]="isRevealed(t.id)" (found)="reveal(t.id)" />
                <p class="muted small">גררו את החפץ כדי לסובב אותו, או השתמשו בכפתורים. הסמל חרוט בצד שלא רואים מיד.</p>
                @if (isRevealed(t.id)) { <p class="reveal">✓ התגלה {{ emoji(t.item) }} {{ itemName(t.item) }} — נכנס לתיק העדויות</p> }
              }
              <div class="evlist">
                @for (x of data().targets; track x.id) { <span [class.ok]="isRevealed(x.id)">{{ isRevealed(x.id) ? '✓' : '·' }} {{ x.label }}</span> }
              </div>
            }
            @case ('board') {
              <ol class="inscriptions">@for (l of data().inscriptions; track $index) { <li>{{ l }}</li> }</ol>
              <p class="muted small">המקומות ממוספרים משמאל לימין, כפי שהלוח עומד מולכם על הקיר.</p>
              <div class="evboard" dir="ltr">
                @for (sl of slots(); track sl.id) {
                  <button class="slot" [class.full]="!!mech()?.slots?.[sl.id]" [class.lit]="state()?.status === 'solved'" (click)="slotClick(sl.id)"
                    [disabled]="busy() || state()?.status === 'solved'">
                    <small dir="rtl">{{ sl.label }}</small>
                    <b class="dl">{{ mech()?.slots?.[sl.id] ? emoji(mech()!.slots[sl.id]) : '' }}</b>
                    <span dir="rtl" class="small">{{ mech()?.slots?.[sl.id] ? itemName(mech()!.slots[sl.id]) : 'ריק' }}</span>
                    @if (by(sl.id); as b) { <em class="by">✋ {{ b }}</em> }
                  </button>
                }
              </div>
              <ng-container *ngTemplateOutlet="bag" />
              @if (state()?.status !== 'solved') {
                <button class="btn primary" (click)="operate({ op: 'activate' })" [disabled]="busy()">בדיקת הסידור</button>
              }
            }
            @case ('wicks') {
              <div class="wscroll" aria-label="המגילה עם איורי הפתילים">
                @for (row of data().scroll; track row.wick) {
                  <div class="wrow">
                    <b class="mark">{{ row.mark }}</b><span class="arrow">←</span>
                    <span class="wick" [class.star]="row.star" [style.width.px]="30 + row.length * 34"></span>@if (row.star) { <span class="wstar">★</span> }
                    <small>{{ row.text }}</small>
                  </div>
                }
              </div>
              <div class="evboard" dir="ltr">
                @for (sl of slots(); track sl.id) {
                  @let placed = mech()?.slots?.[sl.id];
                  <button class="slot vessel" [attr.aria-label]="sl.label + (placed ? ' — ' + itemName(placed) : '')" [class.full]="!!placed" [class.lit]="state()?.status === 'solved'" (click)="slotClick(sl.id)"
                    [disabled]="busy() || state()?.status === 'solved'">
                    <span class="pot" [style.transform]="'scale(' + (0.7 + $any(sl).size * 0.15) + ')'">🏺</span>
                    <b class="mark">{{ $any(sl).mark }}</b>
                    <small dir="rtl">{{ placed ? itemName(placed) : sl.label }}</small>
                    @if (by(sl.id); as b) { <em class="by">✋ {{ b }}</em> }
                  </button>
                }
              </div>
              <div class="bag">
                <span class="muted small">על השולחן:</span>
                @for (id of bagItems(); track id) {
                  <button class="inv" [class.sel]="selected() === id" (click)="selected.set(selected() === id ? null : id)">
                    <span class="wick mini" [class.star]="id === 'w-star'" [style.width.px]="wickLen(id)"></span> {{ itemName(id) }}
                  </button>
                } @empty { <span class="muted small">כל הפתילים כבר בכלים.</span> }
              </div>
              @if (state()?.status !== 'solved') {
                <button class="btn primary" (click)="operate({ op: 'activate' })" [disabled]="busy()">בדיקת ההתאמה</button>
              }
            }
            @case ('lamptest') {
              <div class="lamps">
                @for (l of data().lamps; track l.id; let i = $index) {
                  <div class="lampcard" [class.on]="lit() === i || (state()?.status === 'solved' && l.id === '3')">
                    <b>{{ l.label }}</b>
                    <svg viewBox="0 0 100 120" class="shadow" [class.shown]="lit() === i || (state()?.status === 'solved' && l.id === '3')" aria-hidden="true">
                      @switch (l.shadow) {
                        @case ('full') { <path d="M50 8 C80 45 84 78 50 112 C16 78 20 45 50 8 Z" /> }
                        @case ('partial') { <path d="M18 62 C20 82 30 98 50 112 C70 98 80 82 82 62 Z" /> }
                        @default { <ellipse cx="50" cy="70" rx="44" ry="18" transform="rotate(-18 50 70)" class="blur" /> }
                      }
                    </svg>
                    @if (lit() === i) { <p class="small">{{ l.text }}</p> }
                    <button class="btn small" (click)="light(i)">{{ lit() === i ? 'כיבוי' : 'הדלקה' }}</button>
                    @if (state()?.status !== 'solved') {
                      <button class="btn small primary" (click)="answer(l.id)" [disabled]="busy()">זו המנורה הנכונה</button>
                    }
                  </div>
                }
              </div>
            }
            @case ('blueprint') {
              <div class="blueprint" aria-label="השרטוט החרוט, מלמטה למעלה">
                @for (id of blueprintTop(); track id; let i = $index) {
                  <div class="bp"><span class="n">{{ blueprintTop().length - i }}</span> {{ emoji(id) }} {{ itemName(id) }}</div>
                  @if (i < blueprintTop().length - 1) { <span class="up">▲</span> }
                }
                <small class="muted">מלמטה (1) למעלה (5)</small>
              </div>
              @if (state()?.status !== 'solved') {
                <button class="btn primary" (click)="operate({ op: 'inspect', target: 'plate' })" [disabled]="busy()">בחינת השרטוט</button>
              }
            }
            @case ('sequence') {
              <div class="tablets series" dir="ltr" aria-label="סדרת המספרים">
                @for (n of data().numbers; track $index) { <span>{{ n }}</span> }
                <span class="q">{{ state()?.status === 'solved' ? data().numbers[data().numbers.length - 1] * 2 : '?' }}</span>
              </div>
              <ng-container *ngTemplateOutlet="digits" />
            }
            @case ('mirror') {
              <p class="muted small">{{ state()?.status === 'solved' ? 'ההודעה כפי שהיא נראית במראה:' : 'המגילה כפי שהיא כתובה — הפוך:' }}</p>
              <blockquote class="riddle" [class.backwards]="state()?.status !== 'solved'" [attr.aria-label]="state()?.status === 'solved' ? data().message : 'טקסט בכתב מראה'">{{ data().message }}</blockquote>
              <div class="evboard one">
                @for (sl of slots(); track sl.id) {
                  <button class="slot" [class.full]="!!mech()?.slots?.[sl.id]" [class.lit]="state()?.status === 'solved'" (click)="slotClick(sl.id)"
                    [disabled]="busy() || state()?.status === 'solved'" [attr.aria-label]="sl.label">
                    <span class="pot">🪞</span>
                    <small>{{ mech()?.slots?.[sl.id] ? emoji(mech()!.slots[sl.id]) + ' ' + itemName(mech()!.slots[sl.id]) : sl.label }}</small>
                    @if (by(sl.id); as b) { <em class="by">✋ {{ b }}</em> }
                  </button>
                }
              </div>
              <ng-container *ngTemplateOutlet="bag" />
            }
            @case ('spin') {
              <p class="progress-line">עצירה {{ mech()?.progress ?? 0 }} מתוך {{ data().sequence?.length ?? 4 }}</p>
              <div class="dreidel-face" [class.shown]="!!spinLetter()" aria-live="polite">{{ spinLetter() || '?' }}</div>
              @if (state()?.status !== 'solved') {
                <button class="btn primary big" (click)="operate({ op: 'spin' })" [disabled]="busy() || !!spinLetter()">🌀 סיבוב הסביבון</button>
              }
              <p class="muted small">כל השחקנים רואים את אותה עצירה. האות מוצגת כמה שניות — זכרו אותה.</p>
            }
            @case ('memory') {
              @if (memShowing()) {
                <div class="mem-show" dir="rtl" aria-live="polite">@for (l of memSequence(); track $index) { <span>{{ l }}</span> }</div>
                <p class="muted small">זכרו את הסדר — האותיות ייעלמו עוד רגע.</p>
              } @else {
                <div class="mem-entered" dir="rtl" aria-label="הסדר שבחרתם">@for (i of [0, 1, 2, 3]; track i) { <span>{{ memEntered()[i] ?? '·' }}</span> }</div>
                @if (state()?.status !== 'solved') {
                  <div class="mem-buttons">@for (l of data().buttons; track l) { <button class="btn big" (click)="memPress(l)" [disabled]="busy()">{{ l }}</button> }</div>
                  <div class="row">
                    <button class="btn small" (click)="memEntered.set([])">ניקוי</button>
                    <button class="btn small" (click)="memShow()">הצגת האותיות שוב</button>
                  </div>
                }
              }
            }
            @case ('corners') {
              <p class="sign">„{{ data().clue }}”</p>
              <div class="corners" dir="ltr">
                @for (k of data().corners; track k.id) {
                  <button class="slot corner" [attr.aria-label]="k.label + ' — ' + k.letter" (click)="answer(k.id)" [disabled]="busy() || state()?.status === 'solved'">
                    <b class="dl">{{ k.letter }}</b><small dir="rtl">{{ k.label }}</small>
                  </button>
                }
              </div>
            }
            @case ('shelf') {
              <ol class="inscriptions">@for (l of data().clues; track $index) { <li>{{ l }}</li> }</ol>
              <p class="muted small">המקומות ממוספרים משמאל לימין, כפי שהמדף עומד מולכם.</p>
              <div class="evboard" dir="ltr">
                @for (sl of slots(); track sl.id) {
                  <button class="slot" [class.full]="!!mech()?.slots?.[sl.id]" [class.lit]="state()?.status === 'solved'" (click)="slotClick(sl.id)"
                    [disabled]="busy() || state()?.status === 'solved'" [attr.aria-label]="sl.label + (mech()?.slots?.[sl.id] ? ' — ' + itemName(mech()!.slots[sl.id]) : '')">
                    <small dir="rtl">{{ sl.label }}</small>
                    <b class="dl">{{ mech()?.slots?.[sl.id] ? emoji(mech()!.slots[sl.id]) : '' }}</b>
                    <span dir="rtl" class="small">{{ mech()?.slots?.[sl.id] ? itemName(mech()!.slots[sl.id]) : 'ריק' }}</span>
                    @if (by(sl.id); as b) { <em class="by">✋ {{ b }}</em> }
                  </button>
                }
              </div>
              <ng-container *ngTemplateOutlet="bag" />
              @if (state()?.status !== 'solved') {
                <button class="btn primary" (click)="operate({ op: 'activate' })" [disabled]="busy()">בדיקת הסידור</button>
              }
            }
            @case ('oilscale') {
              <ul class="facts">@for (f of data().facts; track $index) { <li>{{ f }}</li> }</ul>
              <div class="scale-read" [class.level]="scaleReading() === data().counterweight" aria-live="polite">
                <span>⚖️ משקולת: <b>{{ data().counterweight }} גרם</b></span>
                <span>בכף השנייה: <b>{{ scaleReading() === null ? '—' : scaleReading() + ' גרם' }}</b></span>
                <small>{{ scaleReading() === null ? 'הניחו בקבוק על הכף' : scaleReading() === data().counterweight ? 'המאזניים מאוזנים' : scaleReading()! > data().counterweight ? 'הכף עם הבקבוק שוקעת' : 'הכף עם הבקבוק עולה' }}</small>
              </div>
              <div class="evboard one">
                @for (sl of slots(); track sl.id) {
                  <button class="slot" [class.full]="!!mech()?.slots?.[sl.id]" [class.lit]="state()?.status === 'solved'" (click)="slotClick(sl.id)"
                    [disabled]="busy() || state()?.status === 'solved'" [attr.aria-label]="sl.label">
                    <span class="pot">⚖️</span>
                    <small>{{ mech()?.slots?.[sl.id] ? emoji(mech()!.slots[sl.id]) + ' ' + itemName(mech()!.slots[sl.id]) : sl.label }}</small>
                    @if (by(sl.id); as b) { <em class="by">✋ {{ b }}</em> }
                  </button>
                }
              </div>
              <ng-container *ngTemplateOutlet="bag" />
            }
            @case ('book') {
              @if (state()?.status !== 'solved') {
                <button class="btn primary big" (click)="operate({ op: 'inspect', target: 'glow-book' })" [disabled]="busy()">משיכת הספר הזוהר</button>
              }
            }
            @case ('riddle') {
              <blockquote class="riddle">{{ data().riddle }}</blockquote>
              @if (state()?.status !== 'solved') {
                <div class="options">
                  @for (o of data().options; track o) { <button class="btn" (click)="answer(o)" [disabled]="busy()">{{ o }}</button> }
                </div>
                <form class="row" (submit)="$event.preventDefault(); answer(text())">
                  <input [value]="text()" (input)="text.set($any($event.target).value)" placeholder="או כתבו את התשובה..." aria-label="התשובה" />
                  <button class="btn primary" type="submit" [disabled]="!text().trim() || busy()">שליחה</button>
                </form>
              }
            }
            @case ('lamp') {
              <p class="muted small">בחרו חלק מהתיק ואז לחצו על מקום פנוי. לחיצה על חלק מונח מחזירה אותו לתיק.</p>
              <div class="lamp">
                @for (sl of slots(); track sl.id; let i = $index) {
                  <button class="slot" [class.full]="!!mech()?.slots?.[sl.id]" (click)="slotClick(sl.id)" [disabled]="busy() || state()?.status === 'solved'">
                    <small>{{ sl.label }}</small>
                    <b>{{ mech()?.slots?.[sl.id] ? emoji(mech()!.slots[sl.id]) + ' ' + itemName(mech()!.slots[sl.id]) : 'ריק' }}</b>
                    @if (by(sl.id); as b) { <em class="by">✋ {{ b }}</em> }
                  </button>
                }
              </div>
              <ng-container *ngTemplateOutlet="bag" />
              @if (state()?.status !== 'solved') {
                <button class="btn primary big" (click)="operate({ op: 'activate' })" [disabled]="!mech()?.ready || busy()">{{ data().activateLabel }}</button>
              }
            }
            @case ('maze') {
              <div class="maze-wrap">
                <div class="maze" dir="ltr" [style.grid-template-columns]="'repeat(' + mazeCols() + ', 1fr)'">
                  @for (cell of mazeCells(); track $index) {
                    <span class="mc" [class.wall]="cell.ch === '#'" [class.gate]="cell.gate" [class.open]="cell.open" [class.key]="cell.key">@if (cell.key) { 🔑 } @else if (cell.ch === 'M') { <svg class="menorah" viewBox="0 0 24 24" role="img" aria-label="מנורה"><path d="M12 4v15M7.5 21h9M3 6v2a9 6 0 0 0 18 0V6M5.3 6v2a6.7 4.6 0 0 0 13.4 0V6M7.5 6v2a4.5 3.2 0 0 0 9 0V6M9.8 6v2a2.2 1.6 0 0 0 4.4 0V6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><g fill="currentColor"><circle cx="3" cy="4.4" r="1"/><circle cx="5.3" cy="4.4" r="1"/><circle cx="7.5" cy="4.4" r="1"/><circle cx="9.8" cy="4.4" r="1"/><circle cx="12" cy="2.6" r="1"/><circle cx="14.2" cy="4.4" r="1"/><circle cx="16.5" cy="4.4" r="1"/><circle cx="18.7" cy="4.4" r="1"/><circle cx="21" cy="4.4" r="1"/></g></svg> } @else { {{ cell.label }} }</span>
                  }
                </div>
                <div class="controls">
                  @if (state()?.status !== 'solved') { <px-maze-pad /> }
                  <div class="levers">
                    @for (l of data().levers; track $index; let i = $index) {
                      <button class="btn lever" [class.on]="mech()?.levers?.[i]" (click)="operate({ op: 'lever', index: i })" [disabled]="busy() || state()?.status === 'solved'">
                        {{ l.label }}: {{ mech()?.levers?.[i] ? 'מופעל' : 'כבוי' }}
                      </button>
                    }
                  </div>
                  <p class="progress">סמלים לפי הסדר: @for (s of ['star', 'flame', 'menorah']; track s; let i = $index) { <span [class.ok]="(mech()?.progress ?? 0) > i">{{ data().symbolNames[s] }} {{ (mech()?.progress ?? 0) > i ? '✓' : '·' }}</span> }</p>
                </div>
              </div>
              @if (mech()?.revealed) { <p class="reveal">תא האיסוף נפתח. הקוד: <b dir="ltr">{{ mech()!.revealed }}</b></p> }
            }
            @case ('box') { <ng-container *ngTemplateOutlet="digits" /> }
            @case ('cabinet') {
              <ng-container *ngTemplateOutlet="digits" />
            }
            @case ('pipes') {
              <div class="pipes" dir="ltr" role="group" aria-label="קיר הצינורות: מקור המים משמאל, המיכל מימין">
                @for (cell of pipeCells(); track cell.i) {
                  <button class="pp" [style.grid-row]="cell.r + 1" [style.grid-column]="cell.c + 2" [class.fixed]="!cell.turn" [class.wet]="cell.wet" [class.leak]="cell.leak"
                    (click)="operate({ op: 'rotate', index: cell.i })" [disabled]="busy() || !cell.turn || state()?.status === 'solved'"
                    [attr.aria-label]="cell.turn ? 'סיבוב צינור בשורה ' + (cell.r + 1) + ', עמודה ' + (cell.c + 1) : (cell.kind === 'X' ? 'צינור סדוק' : 'צינור מקובע')">
                    <svg viewBox="0 0 100 100" aria-hidden="true"><g [attr.transform]="'rotate(' + cell.deg + ' 50 50)'">
                      @switch (cell.kind) {
                        @case ('S') { <path d="M0 50 H100" /> }
                        @case ('L') { <path d="M50 0 Q50 50 100 50" /> }
                        @default { <path d="M0 50 H34 M66 50 H100" /><path class="crack" d="M40 30 L48 46 L42 54 L52 70" /> }
                      }
                    </g></svg>
                  </button>
                }
                <span class="pp-end src" [style.grid-row]="(data().source?.row ?? 0) + 1" style="grid-column:1">💧</span>
                <span class="pp-end tank" [class.full]="state()?.status === 'solved'" [style.grid-row]="(data().tank?.row ?? 0) + 1" style="grid-column:7">🛢️</span>
              </div>
              @if (state()?.status !== 'solved') {
                <div class="valves">
                  <button class="btn" [class.on]="mech()?.levers?.[1]" (click)="operate({ op: 'valve', id: 'drain' })" [disabled]="busy()">
                    {{ mech()?.levers?.[1] ? 'סגירת ברז הניקוז' : 'פתיחת ברז הניקוז' }}</button>
                  <button class="btn primary" (click)="operate({ op: 'valve', id: 'main' })" [disabled]="busy()">פתיחת הברז הראשי</button>
                </div>
                <p class="muted small">ברז הניקוז {{ mech()?.levers?.[1] ? 'פתוח' : 'סגור' }} · {{ mech()?.found?.length ? 'בניסיון האחרון המים עברו ' + mech()!.found!.length + ' צינורות ונעצרו (מסומן בכתום)' : (state()?.attempts ? 'בניסיון האחרון המים לא נכנסו אפילו לצינור הראשון' : 'המים עוד לא זרמו') }}</p>
              }
            }
            @case ('gatelock') {
              <div class="gatelock">
                <span class="lock-icon" aria-hidden="true">🔒</span>
                @if (state()?.status === 'solved') {
                  <p>המפתח המוזהב מסתובב במנעול — השער נפתח!</p>
                } @else if (hasGoldenKey()) {
                  <button class="btn primary big" (click)="operate({ op: 'use' })" [disabled]="busy()">🔑 הכנסת המפתח המוזהב וסיבובו</button>
                } @else {
                  <p class="muted">המפתח המוזהב לא נמצא בתיק.</p>
                }
              </div>
            }
            @case ('compass') {
              <div class="compass-ui">
                <div class="dial" [class.awake]="state()?.status === 'solved'" aria-hidden="true">
                  @for (mk of data().marks; track mk.id; let i = $index) {
                    <span class="mk" [style.--a]="(i * 90) + 'deg'" [style.--c]="markColor(mk.id)"></span>
                  }
                  <span class="needle" [style.--a]="((mech()?.progress ?? 0) * 90) + 'deg'"></span>
                </div>
                <p class="points">המחט מצביעה על: <b>{{ data().marks[mech()?.progress ?? 0]?.label }}</b></p>
                @if (state()?.status !== 'solved') {
                  <div class="turns">
                    <button class="btn" (click)="operate({ op: 'turn', dir: -1 })" [disabled]="busy()" aria-label="סיבוב המחט נגד כיוון השעון">↺ סיבוב</button>
                    <button class="btn" (click)="operate({ op: 'turn', dir: 1 })" [disabled]="busy()" aria-label="סיבוב המחט עם כיוון השעון">סיבוב ↻</button>
                  </div>
                  <button class="btn primary big" (click)="operate({ op: 'press' })" [disabled]="busy()">לחיצה על המצפן</button>
                } @else {
                  <button class="btn primary" (click)="operate({ op: 'press' })" [disabled]="busy()">הפעלת ההבזק שוב</button>
                }
              </div>
            }
            @case ('lock') {
              @if (backsLine()) { <p class="reveal">בגב הסביבונים: <b dir="ltr">{{ backsLine() }}</b></p> }
              <ng-container *ngTemplateOutlet="digits" />
            }
            @case ('wheel') {
              <div class="tablets" dir="ltr">@for (n of data().numbers; track $index) { <span>{{ n }}</span> }</div>
              <div class="wheels" dir="ltr" aria-label="גלגל האותיות, משמאל לימין">
                @for (w of wheel(); track $index; let i = $index) {
                  <div class="wh">
                    <button class="btn small" (click)="spin(i, -1)" aria-label="אות קודמת">▲</button>
                    <span class="dial">@for (l of [w]; track l) { <b class="turn">{{ l }}</b> }</span>
                    <button class="btn small" (click)="spin(i, 1)" aria-label="אות הבאה">▼</button>
                  </div>
                }
              </div>
              @if (state()?.status !== 'solved') {
                <button class="btn primary" (click)="answer(wheel().join(''))" [disabled]="busy()">סיבוב הגלגלים</button>
              }
            }
            @case ('stand') {
              <p class="muted small">המתקן כפי שהוא עומד מולכם: שמאל הוא שמאל, ימין הוא ימין.</p>
              <div class="stand" dir="ltr">
                @for (sl of slots(); track sl.id) {
                  <button class="slot" [class.full]="!!mech()?.slots?.[sl.id]" (click)="slotClick(sl.id)" [disabled]="busy() || state()?.status === 'solved'">
                    <small dir="rtl">{{ sl.label }}</small>
                    <b class="dl">{{ mech()?.slots?.[sl.id] ? emoji(mech()!.slots[sl.id]) : '' }}</b>
                    @if (mech()?.backs?.[sl.id]) { <span class="back">גב: {{ mech()!.backs[sl.id] }}</span> }
                    @if (by(sl.id); as b) { <em class="by">✋ {{ b }}</em> }
                  </button>
                }
              </div>
              <ng-container *ngTemplateOutlet="bag" />
            }
            @case ('jugs') {
              <p class="sign">{{ data().sign }}</p>
              <div class="jugs">
                @for (j of data().jugs; track j.id) {
                  <div class="jug" [class.cand]="candidate() === j.id">
                    <b>כד {{ j.id }}</b>
                    <span>{{ j.text }}</span>
                    <button class="btn small" (click)="candidate.set(j.id)">סימון כמועמד</button>
                  </div>
                }
              </div>
              @if (candidate(); as c) {
                <p class="check">אם השמן הטהור בכד {{ c }} — מספר הכתובות הנכונות: <b>{{ truths(c) }}</b> {{ truths(c) === 1 ? '(בדיוק אחת, כנדרש)' : '' }}</p>
                @if (state()?.status !== 'solved') { <button class="btn primary" (click)="answer(c)" [disabled]="busy()">זה הכד — בדיקה במנגנון</button> }
              }
            }
            @case ('mosaic') {
              <div class="mosaic-wrap" dir="ltr">
                <span class="src" title="מקור האור">💡</span>
                <div class="mosaic">
                  @for (t of mosaicTiles(); track $index; let i = $index) {
                    <button class="stone" [class.lit]="t.lit" (click)="operate({ op: 'rotate', index: i })" [disabled]="busy() || state()?.status === 'solved'" [attr.aria-label]="'סיבוב אבן ' + (i + 1)">
                      <svg viewBox="0 0 40 40" [style.transform]="'rotate(' + t.rot * 90 + 'deg)'">
                        <path [attr.d]="groove(t.kind)" />
                        @if (t.kind === 'dead') { <rect x="14" y="17" width="12" height="6" /> }
                      </svg>
                    </button>
                  }
                </div>
                <span class="dst" title="סמל המנורה">🕎</span>
              </div>
              <p class="muted small">לחצו על אבן כדי לסובב אותה ברבע סיבוב. האבנים המוארות הן המסלול שהאור עובר כרגע.</p>
            }
            @case ('pedestals') {
              <div class="peds">
                @for (sl of slots(); track sl.id) {
                  @let v = mech()?.verdict?.[sl.id];
                  <button class="slot ped" [class.focus]="ref() === sl.id" [class.full]="!!mech()?.slots?.[sl.id]" [class.right]="v === true" [class.wrong]="v === false"
                    (click)="slotClick(sl.id)" [disabled]="busy() || state()?.status === 'solved' || v === true">
                    <small>כן {{ sl.id.slice(1) }} · {{ sl.label }}</small>
                    <b>{{ mech()?.slots?.[sl.id] ? emoji(mech()!.slots[sl.id]) + ' ' + itemName(mech()!.slots[sl.id]) : 'ריק' }}</b>
                    @if (v === true) { <span class="verdict ok" role="status">✓ מיקום נכון</span> }
                    @else if (v === false) { <span class="verdict bad" role="status">✗ מיקום שגוי — אפשר להזיז</span> }
                    @if (by(sl.id); as b) { <em class="by">✋ {{ b }}</em> }
                  </button>
                }
              </div>
              <ng-container *ngTemplateOutlet="bag" />
              @if (data().verify && state()?.status !== 'solved') {
                <div class="row check-row">
                  @if (allPlaced()) {
                    <button class="btn primary" (click)="operate({ op: 'activate' })" [disabled]="busy()">{{ data().checkLabel }}</button>
                  } @else {
                    <span class="muted small">כשכל שבעת הפריטים יונחו על הכנים, יופיע כאן הכפתור „{{ data().checkLabel }}”.</span>
                  }
                </div>
              }
            }
            @case ('final') {
              <blockquote class="riddle">{{ data().question }}</blockquote>
              @if (state()?.status !== 'solved') {
                <form class="row" (submit)="$event.preventDefault(); answer(text())">
                  <input [value]="text()" (input)="text.set($any($event.target).value)" inputmode="numeric" placeholder="המספר" aria-label="התשובה" dir="ltr" />
                  <button class="btn primary" type="submit" [disabled]="!text().trim() || busy()">הזנה במנגנון המרכזי</button>
                </form>
              }
            }
          }

          <ng-template #digits>
            @if (state()?.status !== 'solved') {
              <form class="row" (submit)="$event.preventDefault(); answer(text())">
                <input [value]="text()" (input)="setText(digitsOnly($any($event.target).value))" inputmode="numeric" [attr.maxlength]="data().digits"
                  dir="ltr" class="code" placeholder="{{ '•'.repeat(data().digits ?? 3) }}" aria-label="קוד" />
                <button class="btn primary" type="submit" [disabled]="text().length !== data().digits || busy()">פתיחה</button>
              </form>
            }
          </ng-template>

          <ng-template #bag>
            <div class="bag">
              <span class="muted small">{{ data().fromRoom ? 'בחדר:' : 'בתיק:' }}</span>
              @for (id of bagItems(); track id) {
                <button class="inv" [class.sel]="selected() === id" (click)="selected.set(selected() === id ? null : id)">{{ emoji(id) }} {{ itemName(id) }}</button>
              } @empty { <span class="muted small">אין בתיק חלקים מתאימים — חפשו בחדר והרימו אותם.</span> }
            </div>
          </ng-template>

          @if (cooldown()) { <p class="warn">{{ cooldown() }}</p> }
          @if (message(); as m) { <p class="msg" [class.bad]="!m.ok" role="status">{{ m.text }}</p> }

          @if (state()?.status !== 'solved') {
            <footer>
              @for (h of state()?.hints ?? []; track $index) { <p class="hint">💡 {{ h }}</p> }
              @if ((state()?.hintsRevealed ?? 0) < hintCount()) {
                <button class="btn small" (click)="hint()" [disabled]="busy()">בקשת רמז (−{{ penalty() }} לניקוד הקבוצתי של החדר{{ noHintBonus() ? ', ובלי בונוס של ' + noHintBonus() + ' על פתרון בלי רמז' : '' }})</button>
              }
            </footer>
          }
        }
      </section>
    </div>
  `,
  styles: [`
    .panel-modal { width: min(760px, calc(100% - 24px)); max-height: calc(100dvh - 32px); overflow:auto; }
    header { display:flex; justify-content:space-between; align-items:flex-start; gap:1rem; }
    h2 { margin:.3rem 0 .4rem; font-family: var(--font-title); color: var(--gold-2); }
    .instructions { line-height:1.7; margin:.2rem 0 .8rem; }
    .locked { font-size:1.1rem; color: var(--muted); }
    .solved { color: #9be3b4; border:1px solid var(--ok); border-radius:10px; padding:.5rem .8rem; }
    .riddle { font-family: var(--font-title); font-size:1.35rem; line-height:1.7; background: #e9d8ad; color:#3a2410; border-radius:12px; padding:1rem 1.2rem; margin:.4rem 0 1rem; }
    .options { display:flex; flex-wrap:wrap; gap:.5rem; margin-bottom:.8rem; }
    .row { display:flex; gap:.5rem; } .row input { flex:1; min-width:0; }
    .code { letter-spacing:.5em; font-size:1.6rem; text-align:center; font-weight:900; }
    .lamp { display:flex; flex-direction:column-reverse; gap:.35rem; margin:.5rem 0; }
    .slot { display:flex; flex-direction:column; align-items:flex-start; gap:.15rem; background: rgba(255,255,255,.05); border:1px dashed var(--line);
      border-radius:10px; padding:.45rem .7rem; color: var(--text); cursor:pointer; font-family: inherit; text-align:start; }
    .slot.full { border-style:solid; border-color: var(--gold); background: rgba(224,185,92,.1); }
    .slot small { color: var(--muted); } .slot b { color: var(--gold-2); }
    .bag { display:flex; flex-wrap:wrap; gap:.35rem; align-items:center; margin:.6rem 0; }
    .inv { background: rgba(255,255,255,.07); border:1px solid var(--line); border-radius:999px; padding:.3rem .7rem; color: var(--text); cursor:pointer; font-family: inherit; }
    .inv.sel { border-color: var(--gold-2); background: rgba(224,185,92,.25); }
    .big { font-size:1.1rem; margin-top:.4rem; }
    .maze-wrap { display:flex; gap:1rem; flex-wrap:wrap; align-items:flex-start; }
    .maze { display:grid; gap:2px; background:#0d1424; padding:6px; border-radius:10px; width:min(360px, 100%); }
    .mc { aspect-ratio:1; display:grid; place-items:center; font-size:.95rem; background:#1e2a44; border-radius:3px; }
    .mc.wall { background:#8a6a3a; } .mc.gate { background:#3a5a9a; } .mc.gate.open { background:#1e2a44; outline: 1px dashed #6a9ae0; }
    .mc.key { background:#5a4a1a; box-shadow: inset 0 0 0 2px #ffd24a; }
    .mc .menorah { width:88%; height:88%; color:#ffd36b; filter: drop-shadow(0 0 2px rgba(255,200,90,.6)); }
    .controls { display:flex; flex-direction:column; gap:.6rem; }
    .pad { display:grid; grid-template-columns: repeat(3, 52px); gap:4px; } .pad .mid { display:grid; place-items:center; font-size:1.4rem; }
    .levers { display:flex; flex-direction:column; gap:.3rem; } .lever.on { border-color: var(--ok); color:#9be3b4; }
    .progress span { margin-inline-end:.6rem; color: var(--muted); } .progress span.ok { color:#9be3b4; }
    .pipes { display:grid; grid-template-columns:2rem repeat(5, minmax(0, 58px)) 2rem; gap:4px; justify-content:center; align-items:center; margin:.3rem 0; }
    .pipes .pp { aspect-ratio:1; padding:0; border-radius:8px; border:2px solid #b8862f; background:#3a2a16; cursor:pointer; }
    .pipes .pp.fixed { border-color:#555; background:#2a2622; cursor:default; }
    .pipes .pp:disabled { opacity:1; }
    .pipes .pp svg { width:100%; height:100%; display:block; }
    .pipes .pp path { fill:none; stroke:#8d8d96; stroke-width:16; stroke-linecap:butt; }
    .pipes .pp .crack { stroke:#1a1208; stroke-width:4; }
    .pipes .pp.wet path:not(.crack) { stroke:#3d9be0; }
    .pipes .pp.leak { box-shadow:0 0 0 3px #e08a2a; }
    .pipes .pp-end { font-size:1.4rem; text-align:center; }
    .pipes .tank.full { filter:drop-shadow(0 0 6px #3d9be0); }
    .valves { display:flex; gap:.5rem; justify-content:center; flex-wrap:wrap; }
    .valves .btn.on { border-color:#e05545; }
    .gatelock { display:flex; flex-direction:column; align-items:center; gap:.6rem; }
    .gatelock .lock-icon { font-size:2.6rem; }
    .compass-ui { display:flex; flex-direction:column; align-items:center; gap:.6rem; }
    .compass-ui .dial { position:relative; width:170px; height:170px; border-radius:50%; background:radial-gradient(circle, #f3e7c8 0 62%, #c9a24e 63% 70%, #6a4a1a 71%); box-shadow:0 0 0 3px #3a2410 inset; }
    .compass-ui .dial.awake { box-shadow:0 0 0 3px #3a2410 inset, 0 0 26px 4px rgba(180,92,255,.55); }
    .compass-ui .mk { position:absolute; left:50%; top:50%; width:22px; height:22px; margin:-11px; border-radius:50%; background:var(--c); border:2px solid #2a1606; transform:rotate(var(--a)) translateY(-58px); }
    .compass-ui .needle { position:absolute; left:50%; top:50%; width:8px; height:62px; margin-left:-4px; margin-top:-56px; background:linear-gradient(#2a1606 0 70%, transparent 70%); clip-path:polygon(50% 0, 100% 70%, 50% 100%, 0 70%); transform-origin:50% 56px; transform:rotate(var(--a)); transition:transform .35s ease; }
    .compass-ui .points { margin:0; } .compass-ui .turns { display:flex; gap:.5rem; }
    .reveal { font-size:1.2rem; background: rgba(224,185,92,.12); border:1px solid var(--gold); border-radius:10px; padding:.5rem .8rem; }
    .reveal b { font-size:1.6rem; letter-spacing:.2em; color: var(--gold-2); }
    .tablets { display:flex; gap:1rem; justify-content:center; font-size:2rem; font-weight:900; color:#9fd0ff; margin:.4rem 0; }
    .tablets span { background:#3a3446; border-radius:10px; padding:.2rem 1rem; }
    .wheels { display:flex; gap:1rem; justify-content:center; margin:.6rem 0; }
    .wh { display:flex; flex-direction:column; align-items:center; gap:.3rem; }
    .dial { display:grid; place-items:center; width:84px; height:84px; border-radius:50%; overflow:visible;
      background: radial-gradient(circle at 50% 40%, #e8c873, #9a7426 70%, #5a3e10); border:3px solid #ffd77a;
      box-shadow: 0 0 18px rgba(106,168,255,.45), inset 0 0 12px rgba(0,0,0,.45); }
    .dial b { font-family: var(--font-title); font-size:2.4rem; line-height:1; color:#2a1606; }
    .turn { animation: turn .35s ease; } @keyframes turn { from { transform: rotateX(80deg); opacity:.2 } to { transform:none; opacity:1 } }
    .stand { display:grid; grid-template-columns: 1fr 1fr; gap:.5rem; max-width:420px; margin:.5rem auto; }
    .stand .slot { align-items:center; min-height:96px; justify-content:center; }
    .dl { font-family: var(--font-title); font-size:2.2rem; } .back { color:#9fd0ff; font-weight:700; }
    .sign { font-family: var(--font-title); font-size:1.2rem; text-align:center; color: var(--gold-2); }
    .jugs { display:grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap:.5rem; }
    .jug { display:flex; flex-direction:column; gap:.3rem; background: rgba(255,255,255,.05); border:1px solid var(--line); border-radius:12px; padding:.6rem; }
    .jug.cand { border-color: var(--gold-2); background: rgba(224,185,92,.12); } .jug b { color: var(--gold-2); }
    .check { font-size:1.05rem; } .check b { font-size:1.3rem; color: var(--gold-2); }
    .mosaic-wrap { display:flex; align-items:center; justify-content:center; gap:.6rem; margin:.4rem 0; }
    .src, .dst { font-size:2rem; }
    .mosaic { display:grid; grid-template-columns: repeat(3, 84px); gap:4px; background:#141a2a; padding:6px; border-radius:10px; }
    .stone { width:84px; height:84px; background:#2e3a52; border:1px solid #1a2236; border-radius:6px; cursor:pointer; padding:6px; }
    .stone svg { width:100%; height:100%; transition: transform .25s ease; }
    .stone path { stroke:#c9a24d; stroke-width:6; stroke-linecap:round; fill:none; } .stone rect { fill:#5a4a30; }
    .stone.lit { background:#1a3a6a; box-shadow: 0 0 12px #5aa8ff; } .stone.lit path { stroke:#9fd0ff; }
    .peds { display:grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap:.4rem; }
    .ped.focus { outline: 2px solid var(--gold-2); }
    /* after "check the arrangement": green — the right place (it stays), red — the wrong place (move it and check again) */
    .ped.right { border:2px solid #3fbf6a; background: rgba(63,191,106,.16); box-shadow: 0 0 12px rgba(63,191,106,.35); }
    .ped.wrong { border:2px solid #e2715b; background: rgba(226,113,91,.16); box-shadow: 0 0 12px rgba(226,113,91,.35); }
    .ped:disabled.right { opacity:1; cursor:default; }
    .verdict { font-weight:800; font-size:.85rem; } .verdict.ok { color:#9be3b4; } .verdict.bad { color:#ffb4a3; }
    .check-row { margin-top:.6rem; }
    .look { font-style:italic; color:#e9d8ad; margin:.2rem 0 .6rem; }
    .evlist { display:flex; flex-wrap:wrap; gap:.4rem .9rem; margin-top:.6rem; color: var(--muted); } .evlist .ok { color:#9be3b4; }
    .inscriptions { background:#e9d8ad; color:#3a2410; border-radius:12px; padding:.7rem 2rem .7rem 1rem; margin:.3rem 0 .6rem; line-height:1.8;
      font-family: var(--font-title); }
    .evboard { display:grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap:.4rem; margin:.5rem 0; }
    .evboard .slot { align-items:center; min-height:96px; justify-content:center; text-align:center; }
    .evboard .slot.lit { border-color:#ffd77a; box-shadow: 0 0 14px rgba(255,215,122,.5); }
    .slot .by { display:block; font-style:normal; font-size:.72rem; color: var(--muted); max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    /* a phone keeps the row of four (places 1–4 read left to right, as on the wall): only the boxes get smaller */
    @media (max-width: 480px) { .evboard { gap:.25rem; } .evboard .slot { min-height:78px; padding:.35rem .15rem; min-width:0; } .evboard .slot small { font-size:.68rem; line-height:1.25; }
      .evboard .slot .small { font-size:.7rem; } .evboard .dl { font-size:1.35rem; } .evboard .slot .pot { font-size:1.4rem; } }
    .wscroll { background:#e9d8ad; color:#3a2410; border-radius:12px; padding:.6rem .9rem; display:flex; flex-direction:column; gap:.35rem; margin:.3rem 0 .6rem; }
    .wrow { display:flex; align-items:center; gap:.5rem; flex-wrap:wrap; } .wrow .mark { font-size:1.4rem; min-width:2.4rem; text-align:center; }
    .wrow small { flex-basis:100%; color:#5a3e1e; }
    .wick { display:inline-block; height:6px; border-radius:3px; background:#5a4430; vertical-align:middle; }
    .wick.star { height:9px; background: repeating-linear-gradient(90deg, #a07a2a 0 6px, #e8d6a8 6px 10px); }
    .wick.mini { height:5px; background:#f2ecd8; } .wick.mini.star { height:7px; }
    .wstar { color:#c99a2e; font-size:1.2rem; }
    .vessel .pot { font-size:1.8rem; display:inline-block; } .vessel .mark { font-size:1.3rem; color: var(--gold-2); }
    .lamps { display:grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap:.5rem; }
    .lampcard { display:flex; flex-direction:column; align-items:center; gap:.35rem; background: rgba(255,255,255,.05); border:1px solid var(--line);
      border-radius:12px; padding:.6rem; text-align:center; }
    .lampcard.on { border-color: var(--gold-2); box-shadow: 0 0 14px rgba(255,200,110,.35); }
    .shadow { width:90px; height:108px; background:#cdbb95; border-radius:8px; }
    .shadow path, .shadow ellipse { fill:#1a1008; opacity:0; transition: opacity .3s; } .shadow.shown path, .shadow.shown ellipse { opacity:.85; }
    .shadow .blur { filter: blur(4px); }
    .blueprint { display:flex; flex-direction:column; align-items:center; gap:.2rem; background:#2a2f36; border:2px solid #8a8478; border-radius:12px;
      padding:.7rem; margin:.4rem 0 .6rem; color:#ffe6a0; }
    .bp { font-size:1.15rem; font-weight:700; } .bp .n { color:#9fd0ff; margin-inline-end:.3rem; } .up { color:#ffd98a; }
    .series .q { color:#ffd77a; background:#4a3a1a; }
    .backwards { transform: scaleX(-1); }
    .evboard.one { grid-template-columns: minmax(0, 240px); justify-content:center; }
    .progress-line { text-align:center; font-weight:700; color: var(--gold-2); }
    .dreidel-face { width:120px; height:120px; margin:.4rem auto; display:grid; place-items:center; border-radius:18px; font-family: var(--font-title);
      font-size:4.2rem; color:#5a2a08; background: radial-gradient(circle at 50% 40%, #f2d07a, #b8862a 75%); opacity:.45; transition: opacity .3s, transform .3s; }
    .dreidel-face.shown { opacity:1; transform: scale(1.06); box-shadow: 0 0 22px rgba(255,210,110,.6); }
    .mem-show, .mem-entered { display:flex; justify-content:center; gap:.6rem; margin:.6rem 0; }
    .mem-show span, .mem-entered span { width:64px; height:64px; display:grid; place-items:center; border-radius:12px; font-family: var(--font-title); font-size:2.4rem;
      background:#2a2016; color:#ffd36b; border:1px solid var(--gold); }
    .mem-buttons { display:grid; grid-template-columns: repeat(4, 1fr); gap:.5rem; margin:.4rem 0; } .mem-buttons .btn { font-family: var(--font-title); font-size:2rem; }
    .corners { display:grid; grid-template-columns: 1fr 1fr; gap:.5rem; max-width:360px; margin:.5rem auto; }
    .corner { align-items:center; min-height:96px; justify-content:center; }
    .facts { margin:.2rem 0 .6rem; line-height:1.8; }
    .scale-read { display:flex; flex-direction:column; align-items:center; gap:.2rem; background: rgba(255,255,255,.05); border:1px solid var(--line); border-radius:12px; padding:.6rem; margin:.4rem 0; }
    .scale-read.level { border-color:#3fbf6a; box-shadow: 0 0 12px rgba(63,191,106,.35); } .scale-read b { color: var(--gold-2); }
    .warn { color:#ffd59a; } .msg { margin:.6rem 0 0; } .msg.bad { color:#ffb4a3; }
    footer { margin-top:1rem; border-top:1px solid var(--line); padding-top:.6rem; display:flex; flex-direction:column; gap:.4rem; align-items:flex-start; }
    .hint { margin:0; color:#cfe2ff; }
    .small { font-size:.85rem; }
  `],
  imports: [NgTemplateOutlet, InspectViewerComponent, MazePadComponent],
})
export class HPanelComponent {
  game = inject(GameService);
  private audio = inject(AudioService);
  panel = input.required<HPanel>();
  ref = input<string | undefined>();
  close = output<void>();
  /** The letters chosen on the wheel, so the 3D wheel in the room turns with them. */
  wheelChange = output<string[]>();
  /** The test lamp lit in the light-test window, so the room shows its flame and shadow. */
  testLamp = output<number | null>();
  lit = signal<number | null>(null);

  text = signal('');
  /** What was typed so far in the free game's cabinet lock: kept while the players go back to the books. */
  setText(v: string) {
    this.text.set(v);
    if (this.puzzleId() === 'g1-cabinet') CABINET_DRAFT.set(this.game.snapshot()?.roomId ?? '', v);
  }
  busy = signal(false);
  selected = signal<string | null>(null);
  candidate = signal<string | null>(null);
  wheel = signal(['א', 'א', 'א']);
  message = signal<{ ok: boolean; text: string } | null>(null);

  puzzleId = computed(() => PANEL_PUZZLE[this.panel()]);
  puzzle = computed<PuzzleContent | undefined>(() => this.game.scenario()?.puzzles.find((p) => p.id === this.puzzleId()));
  state = computed<PuzzleStateDto | undefined>(() => this.game.snapshot()?.puzzles.find((p) => p.id === this.puzzleId()));
  mech = computed<MechanismState | undefined>(() => this.game.snapshot()?.mechanisms?.[this.puzzleId()]);
  /** Who placed what is in a slot (the server records it with each placement), shown to everyone under the item. */
  by(slot: string): string | null {
    const id = this.mech()?.slotBy?.[slot];
    if (!id || !this.mech()?.slots?.[slot]) return null;
    return this.game.snapshot()?.players.find((p) => p.id === id)?.nickname ?? null;
  }
  /** The puzzle's public data, with the texts the admin set for this game (fixed when it started) over it. */
  data = computed(() => ({ ...(this.puzzle()?.publicData ?? {}), ...(this.game.snapshot()?.questions?.[this.puzzleId()] ?? {}) }));
  allPlaced = computed(() => this.slots().length > 0 && this.slots().every((s) => !!this.mech()?.slots?.[s.id]));
  slots = computed<{ id: string; label: string }[]>(() => this.data().slots ?? []);
  bagItems = computed(() => {
    const accepts: string[] = this.data().accepts ?? [];
    const own = (this.game.snapshot()?.inventory ?? []).filter((i) => accepts.includes(i));
    // a table that takes its pieces straight from the room also offers what still lies there (the wicks)
    const room = this.data().fromRoom ? (this.game.snapshot()?.worldItems ?? []).filter((i) => accepts.includes(i) && !own.includes(i)) : [];
    return [...room, ...own];
  });
  /** Hint texts stay on the server until requested; only their number is public. */
  hintCount = computed(() => this.puzzle()?.hintCount ?? 0);
  penalty = computed(() => this.game.scenario()?.scoring?.hintPenalty ?? 10);
  /** The group bonus this puzzle still offers for being solved without a hint (0 when it has none). */
  noHintBonus = computed(() => {
    const s = this.game.scenario()?.scoring;
    const zone = this.puzzle()?.zone ?? '';
    return s?.noHint && !s.noHintSkipZones?.includes(zone) && !this.state()?.hintsRevealed ? s.noHint : 0;
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
  markColor = (id: string) => BOOK_CSS[id] ?? '#888';
  hasGoldenKey = computed(() => !!this.game.snapshot()?.inventory.includes('gs-golden-key'));
  /** The free game's pipe wall, piece by piece: its kind, how it lies, whether it turns, and the last flow through it. */
  pipeCells = computed(() => {
    const d = this.data();
    const tiles: string[] = d.tiles ?? [];
    const turnable: string[] = d.turnable ?? [];
    const m = this.mech();
    const found: string[] = m?.found ?? [];
    const solved = this.state()?.status === 'solved';
    const cells: { i: number; r: number; c: number; kind: string; turn: boolean; deg: number; wet: boolean; leak: boolean }[] = [];
    tiles.forEach((row, r) => [...row].forEach((kind, c) => {
      const i = r * row.length + c;
      const k = found.indexOf(`${r},${c}`);
      cells.push({ i, r, c, kind, turn: turnable.includes(`${r},${c}`), deg: (m?.rotations?.[i] ?? 0) * 90, wet: k >= 0, leak: !solved && k >= 0 && k === found.length - 1 });
    }));
    return cells;
  });
  backsLine = computed(() => {
    // the digits appear only once the arrangement is right
    const src = this.panel() === 'cabinet' ? { id: 'g1-symbols', order: ['s1', 's2', 's3', 's4'] } : { id: 'h5-stand', order: ['tl', 'tr', 'bl', 'br'] };
    if (this.game.snapshot()?.puzzles.find((p) => p.id === src.id)?.status !== 'solved') return '';
    const b = this.game.snapshot()?.mechanisms?.[src.id]?.backs;
    if (!b || !Object.keys(b).length) return '';
    return src.order.map((k) => b[k] ?? '?').join(' ');
  });

  mazeCols = computed(() => (this.data().grid?.[0] ?? '').length);
  mazeCells = computed(() => {
    const grid: string[] = this.data().grid ?? [];
    const m = this.mech();
    const levers: { gate: string }[] = this.data().levers ?? [];
    const cells: { ch: string; label: string; gate: boolean; open: boolean; key: boolean }[] = [];
    grid.forEach((line, r) => [...line].forEach((ch, c) => {
      const li = levers.findIndex((l) => l.gate === ch);
      cells.push({
        ch, gate: li >= 0, open: li >= 0 && !!m?.levers?.[li], key: m?.key?.[0] === r && m?.key?.[1] === c,
        label: li >= 0 ? (m?.levers?.[li] ? '' : '▮') : MAZE_SYMBOLS[ch] ?? '',
      });
    }));
    return cells;
  });
  mosaicTiles = computed(() => {
    const tiles: string[] = this.data().tiles ?? [];
    const m = this.mech();
    const lit = new Set((m?.lit ?? []).map(([r, c]) => r * 3 + c));
    return tiles.map((kind, i) => ({ kind, rot: m?.rotations?.[i] ?? 0, lit: lit.has(i) }));
  });

  /** The piece of library evidence this panel shows (the object the player used). */
  target = computed<{ id: string; label: string; item: string; look: string } | undefined>(() =>
    (this.data().targets ?? []).find((t: { id: string }) => t.id === this.ref()));
  isRevealed = (id: string) => !!this.mech()?.symbols?.includes(id);
  private inspected = new Set<string>();

  constructor() {
    // the free game's cabinet opens with what was typed before the players went back to the books
    effect(() => {
      if (this.puzzleId() !== 'g1-cabinet') return;
      const room = this.game.snapshot()?.roomId ?? '';
      untracked(() => { if (!this.text()) this.text.set(CABINET_DRAFT.get(room) ?? ''); });
    });
    // opening an object's window examines it (once; the server scores only the first time anyone does)
    effect(() => {
      const id = this.panel() === 'evidence' ? this.ref() : undefined;
      if (!id || this.state()?.status !== 'active' || this.mech()?.found?.includes(id) || this.inspected.has(id)) return;
      this.inspected.add(id);
      untracked(() => this.operate({ op: 'inspect', target: id }, true));
    });
    // the memory board shows the letters once when it is opened (and again on request)
    effect(() => {
      if (this.panel() !== 'memory' || this.state()?.status !== 'active' || this.memShown) return;
      this.memShown = true;
      untracked(() => this.memShow());
    });
    inject(DestroyRef).onDestroy(() => {
      clearInterval(this.clockTimer);
      clearTimeout(this.memTimer);
    });
  }

  /** The hidden side of the object faced the player: the server records the symbol and puts it in the bag. */
  async reveal(id: string) {
    if (this.isRevealed(id) || this.state()?.status !== 'active') return;
    await this.operate({ op: 'reveal', target: id }, true);
    if (this.isRevealed(id)) this.audio.sfx('success');
  }

  /** The scale's reading for the bottle on its pan (the weights are public; whether it balances is decided on the server). */
  scaleReading = computed<number | null>(() => {
    const onPan = this.mech()?.slots?.['pan'];
    return onPan ? (this.data().weights?.[onPan] ?? null) : null;
  });

  /** The letter the giant dreidel stopped on, while it is still shown (the server's stop time). */
  private clock = signal(0);
  private clockTimer = setInterval(() => this.clock.update((n) => n + 1), 400);
  spinLetter = computed(() => {
    this.clock();
    const m = this.mech();
    const seq: string[] = this.data().sequence ?? [];
    if (this.panel() !== 'spin' || !m?.progress || !m.controlUntil || Date.parse(m.controlUntil) <= this.game.serverNow()) return '';
    return seq[m.progress - 1] ?? '';
  });

  /** The memory board: the dreidel's letters show for a few seconds, then the players repeat them with four buttons. */
  memShowing = signal(false);
  memEntered = signal<string[]>([]);
  memSequence = computed<string[]>(() => this.game.scenario()?.puzzles.find((p) => p.id === 'h5-spin')?.publicData?.sequence ?? []);
  private memTimer?: ReturnType<typeof setTimeout>;
  private memShown = false;

  memShow() {
    clearTimeout(this.memTimer);
    this.memEntered.set([]);
    this.memShowing.set(true);
    this.memTimer = setTimeout(() => this.memShowing.set(false), (this.data().showSeconds ?? 4) * 1000);
  }

  async memPress(letter: string) {
    const next = [...this.memEntered(), letter];
    this.memEntered.set(next);
    if (next.length < (this.data().length ?? 4)) return;
    await this.answer(next.join(''));
    if (this.state()?.status !== 'solved') setTimeout(() => this.memEntered.set([]), 900);
  }

  /** The blueprint from the top part down, so the lamp reads as it stands (the base at the bottom). */
  blueprintTop = computed<string[]>(() => [...(this.data().blueprint ?? [])].reverse());
  wickLen = (id: string) => ({ 'w-short': 30, 'w-medium': 52, 'w-long': 76, 'w-star': 52 } as Record<string, number>)[id] ?? 40;

  /** Lights one test lamp (or puts it out): the shadow shows here and on the wall, for this player only. */
  light(i: number) {
    this.lit.set(this.lit() === i ? null : i);
    this.testLamp.emit(this.lit());
    this.audio.sfx('select');
  }

  emoji = (id: string) => ITEM_EMOJI[id] ?? '◆';
  itemName = (id: string) => this.game.scenario()?.items.find((i) => i.id === id)?.name ?? id;

  groove(kind: string) {
    return kind === 'straight' ? 'M20 0 L20 40' : kind === 'corner' ? 'M20 0 L20 20 L40 20' : 'M20 0 L20 18';
  }

  /** Statements on the jugs: „נמצא בכד X” is true only for X, „אינו בכד X” for every other jug. */
  truths(candidate: string) {
    const jugs: { id: string; text: string }[] = this.data().jugs ?? [];
    return jugs.filter((j) => {
      const m = /(אינו|נמצא) בכד (\S)/.exec(j.text);
      if (!m) return false;
      return m[1] === 'נמצא' ? m[2] === candidate : m[2] !== candidate;
    }).length;
  }

  spin(i: number, d: number) {
    this.wheel.update((w) => w.map((l, k) => (k === i ? LETTERS[(LETTERS.indexOf(l) + d + LETTERS.length) % LETTERS.length] : l)));
    this.wheelChange.emit(this.wheel());
    this.audio.sfx('gear');
  }

  @HostListener('window:keydown', ['$event'])
  onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') this.close.emit();
  }

  digitsOnly = (v: string) => v.replace(/[^0-9]/g, '');

  slotClick(slot: string) {
    const placed = this.mech()?.slots?.[slot];
    if (placed) {
      this.operate({ op: 'remove', slot });
      return;
    }
    const item = this.selected() ?? (this.bagItems().length === 1 ? this.bagItems()[0] : null);
    if (!item) {
      this.message.set({ ok: false, text: 'בחרו קודם פריט מהתיק.' });
      return;
    }
    this.selected.set(null);
    this.operate({ op: 'place', slot, item });
  }

  async operate(action: object, quiet = false) {
    this.busy.set(true);
    try {
      // a change to a shared puzzle carries the version this player sees, so it never overwrites a change made by another
      // player that has not reached this screen yet (the server refuses it and the new state shows)
      const op = (action as { op?: string }).op ?? '';
      const sent = ['place', 'remove', 'reset'].includes(op) ? { ...action, rev: this.mech()?.rev ?? 0 } : action;
      const r = await this.game.operate(this.puzzleId(), sent);
      if (!r.ok) {
        this.message.set({ ok: false, text: r.message });
        this.audio.sfx('wrong');
      } else if (!quiet || r.message) this.message.set(r.message ? { ok: true, text: r.message } : null);
      if (r.ok && !quiet) this.audio.sfx(this.panel() === 'mosaic' ? 'glass' : 'click');
    } finally {
      this.busy.set(false);
    }
  }

  async answer(value: string) {
    if (!value.trim()) return;
    this.busy.set(true);
    try {
      const r = await this.game.submitAnswer(this.puzzleId(), value.trim());
      // a code lock turns for the player who opened it; the group hears the box or cabinet open with the celebration
      if (r.ok && ['box', 'lock', 'cabinet'].includes(this.panel() ?? '')) this.audio.sfx('key');
      this.message.set({ ok: r.ok, text: r.message });
      if (r.ok) { this.text.set(''); CABINET_DRAFT.delete(this.game.snapshot()?.roomId ?? ''); }
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
