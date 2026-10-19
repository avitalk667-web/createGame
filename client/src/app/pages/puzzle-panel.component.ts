import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { AudioService } from '../core/audio.service';
import { GameService } from '../core/game.service';
import { PuzzleContent } from '../core/models';
import { SettingsService } from '../core/settings.service';
import { IconComponent } from '../ui/icon.component';
import { PanelId } from '../world/layout';

const PANEL_PUZZLE: Record<PanelId, string | null> = {
  guide: null,
  'cipher-key': 'p1-cipher',
  'cipher-message': 'p1-cipher',
  'cipher-lock': 'p1-cipher',
  plaque: 'p2-sequence',
  'sequence-lock': 'p2-sequence',
  'sound-box': 'p3-sound',
  'sound-lock': 'p3-sound',
  mirror: 'p4-split',
  'split-lock': 'p4-split',
  workbench: 'p5-items',
  pedestal: 'p5-items',
  'portal-lock': 'p6-final',
  map: null,
};

const HEB_LETTERS = 'אבגדהוזחטיכלמנסעפצקרשת'.split('');

/** Every puzzle UI. All answers go to the server for validation; the panel only collects input. */
@Component({
  selector: 'px-puzzle-panel',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="overlay" (click)="close.emit()">
      <section class="panel-modal" role="dialog" aria-modal="true" [attr.aria-label]="title()" (click)="$event.stopPropagation()" (keydown.escape)="close.emit()">
        <header>
          <div>
            @if (puzzle(); as p) { <span class="chip">{{ zoneName(p.zone) }}</span> }
            <h2>{{ title() }}</h2>
          </div>
          <button class="btn small ghost" (click)="close.emit()" aria-label="סגירה">✕</button>
        </header>

        @switch (panel()) {
          @case ('guide') {
            <div class="guide">
              <img src="img/char-scholar.jpg" alt="יהודה המדריך" />
              <div>
                <p class="speech">{{ guideText() }}</p>
                <button class="btn small" (click)="nextGuide()">{{ guideStep() < guideLines.length - 1 ? 'המשך ‹' : 'תודה, יהודה!' }}</button>
              </div>
            </div>
          }
          @case ('cipher-key') {
            <p class="muted">{{ data()?.keyTitle }}</p>
            @if (keyInfo(); as k) {
              <div class="key-table">
                @for (e of k.key; track e.symbol) {
                  <div class="kcell"><px-icon [name]="e.symbol" [size]="44" /><span class="eq">=</span><b>{{ e.letter }}</b></div>
                }
              </div>
              @if (k.parts < k.total) {
                <p class="note">ספר קסום! אתם רואים רק חצי מלוח הסמלים — לחבר אחר בקבוצה מופיע החצי השני. כתבו בצ׳אט אילו סמלים ואותיות אתם רואים, ובקשו מהם לשתף את שלהם.</p>
              }
            } @else { <p class="muted">הדפים מתהפכים...</p> }
          }
          @case ('cipher-message') {
            <div class="parchment">
              <p>{{ data()?.messageTitle }}</p>
              <div class="msg">@for (s of data()?.message ?? []; track $index) { <px-icon [name]="s" [size]="76" /> }</div>
              <small>{{ data()?.messageNote }}</small>
            </div>
          }
          @case ('map') {
            <p class="muted">הדרך באחוזה עוברת בשישה חדרים לפי הסדר. כל חידה שנפתרת פותחת את הדלת לחדר הבא.</p>
            <ol class="mansion" aria-label="חדרי האחוזה">
              @for (z of zonesSorted(); track z.id; let k = $index) {
                <li [class.open]="isOpen(z.id)" [class.here]="here() === z.id" [class.done]="zoneDone(z.id)">
                  <span class="num">{{ k + 1 }}</span>
                  <px-icon [name]="isOpen(z.id) ? z.icon : 'lock'" [size]="30" />
                  <b>{{ z.name }}</b>
                  <small>
                    @if (here() === z.id) { אתם כאן }
                    @else if (zoneDone(z.id)) { נפתר ✓ }
                    @else if (isOpen(z.id)) { פתוח }
                    @else { נעול }
                  </small>
                </li>
              }
            </ol>
            <p class="muted small">אותיות זהב שנאספו: {{ game.snapshot()?.letters?.length ?? 0 }} מתוך 5 · חפצים בתיק: {{ game.snapshot()?.inventory?.length ?? 0 }}</p>
          }
          @case ('plaque') {
            <div class="plaque"><p>{{ plaqueText() }}</p></div>
          }
          @case ('sound-box') {
            <p>תיבת נגינה עתיקה. כשמסובבים את הידית שלה, הפעמונים שבחדר מתעוררים.</p>
            <button class="btn primary" (click)="playTune()" [disabled]="playing()">{{ playing() ? 'מנגן...' : 'השמעת המנגינה ♪' }}</button>
            <div class="bells small-bells">
              @for (b of data()?.bells ?? []; track b.id) {
                <div class="bell" [class.lit]="litBell() === b.id"><px-icon name="bell" [size]="34" /><b>{{ b.label }}</b></div>
              }
            </div>
            <p class="muted small">בזמן הנגינה כל פעמון מאיר כשהוא מצלצל — כך אפשר לשחק גם בלי קול.</p>
          }
          @case ('mirror') {
            @if (clues().length) {
              @for (c of clues(); track c.index) {
                <div class="clue">
                  <div class="visual" [attr.aria-label]="c.title" role="img">
                    @switch (c.visual) {
                      @case ('stars') {
                        <svg viewBox="0 0 200 140"><rect width="200" height="140" fill="#0b1230" />
                          @for (s of starPts; track $index) { <path [attr.transform]="'translate(' + s[0] + ',' + s[1] + ') scale(0.7)'" fill="#ffe9a8" d="M12 1.8l3.1 6.9 7.3.7-5.5 4.9 1.6 7.3L12 17.9l-6.5 3.7 1.6-7.3-5.5-4.9 7.3-.7z" /> }
                          <polyline [attr.points]="starLine" fill="none" stroke="#ffe9a8" stroke-opacity=".35" stroke-width="1.5" /></svg>
                      }
                      @case ('stairs') {
                        <svg viewBox="0 0 200 140"><rect width="200" height="140" fill="#d9b77a" />
                          <path d="M30 120 H70 V95 H100 V70 H130 V45 H160 V20 H175" fill="none" stroke="#3b2410" stroke-width="5" />
                          <path d="M30 125 H180" stroke="#3b2410" stroke-width="3" /></svg>
                      }
                      @case ('tet') {
                        <svg viewBox="0 0 200 140"><rect width="200" height="140" fill="#d9b77a" />
                          <circle cx="100" cy="70" r="55" fill="none" stroke="#3b2410" stroke-width="4" />
                          <text x="100" y="98" text-anchor="middle" font-size="80" font-family="Frank Ruhl Libre, serif" fill="#3b2410">ט</text></svg>
                      }
                    }
                  </div>
                  <div><h3>{{ c.title }}</h3><p>{{ c.text }}</p></div>
                </div>
              }
              <p class="note">רק אתם רואים את הרמז הזה. ספרו לחברים בצ׳אט מה גיליתם — בלי זה לא תצליחו לפתוח את הקופסה!</p>
            } @else { <p class="muted">המראה מתבהרת...</p> }
          }
        }

        <!-- answer areas -->
        @if (puzzle(); as p) {
          @if (isLockPanel()) {
            <p class="instructions">{{ p.instructions }}</p>
            @if (state()?.status === 'solved') {
              <p class="solved"><px-icon name="check" [size]="22" /> {{ p.success }}</p>
            } @else if (state()?.status === 'locked') {
              <p class="muted">החידה עדיין נעולה. התקדמו קודם בחדרים הקודמים.</p>
            } @else {
              @switch (p.type) {
                @case ('cipher') {
                  <div class="slots" dir="rtl">
                    @for (i of [0, 1, 2]; track i) { <span class="slot" [class.filled]="letters()[i]">{{ letters()[i] ?? '' }}</span> }
                  </div>
                  <div class="keypad" dir="rtl" aria-label="מקלדת אותיות">
                    @for (l of hebLetters; track l) { <button (click)="addLetter(l)">{{ l }}</button> }
                    <button class="wide" (click)="letters.set(letters().slice(0, -1))" aria-label="מחיקת אות">⌫</button>
                  </div>
                  <button class="btn primary" (click)="submit(letters().join(''))" [disabled]="letters().length < 3 || busy() || cooling()">בדיקת תשובה</button>
                }
                @case ('sequence') {
                  <div class="dial" dir="rtl">
                    @for (i of [0, 1, 2, 3]; track i) {
                      <div class="dslot"><small>{{ i + 1 }}</small>@if (seq()[i]; as s) { <px-icon [name]="s" [size]="46" /> }</div>
                    }
                  </div>
                  <div class="choices">
                    @for (s of data()?.symbols ?? []; track s.id) {
                      <button class="sym" (click)="addSeq(s.id)" [disabled]="seq().length >= 4"><px-icon [name]="s.id" [size]="40" /><span>{{ s.name }}</span></button>
                    }
                  </div>
                  <div class="row"><button class="btn small" (click)="seq.set([])">ניקוי</button>
                    <button class="btn primary" (click)="submit(seq())" [disabled]="seq().length < 4 || busy() || cooling()">סיבוב המנגנון</button></div>
                }
                @case ('sound') {
                  <button class="btn small" (click)="playTune()" [disabled]="playing()">{{ playing() ? 'מנגן...' : 'השמעת המנגינה שוב ♪' }}</button>
                  <div class="bells">
                    @for (b of data()?.bells ?? []; track b.id) {
                      <button class="bell big" [class.lit]="litBell() === b.id" (click)="tapBell(b)" [disabled]="playing() || seq().length >= (data()?.length ?? 5)" [attr.aria-label]="'פעמון ' + b.label">
                        <px-icon name="bell" [size]="48" /><b>{{ b.label }}</b></button>
                    }
                  </div>
                  <div class="entered">המנגינה שלכם: @for (s of seq(); track $index) { <b>{{ bellLabel(s) }}</b> } @empty { <span class="muted">הקישו על הפעמונים</span> }</div>
                  <div class="row"><button class="btn small" (click)="seq.set([])">ניקוי</button>
                    <button class="btn primary" (click)="submit(seq())" [disabled]="seq().length < (data()?.length ?? 5) || busy() || cooling()">בדיקה</button></div>
                }
                @case ('split') {
                  <div class="digits" dir="ltr">
                    @for (i of [0, 1, 2]; track i) {
                      <div class="digit">
                        <button (click)="bump(i, 1)" aria-label="הגדלה">▲</button>
                        <b>{{ digits()[i] }}</b>
                        <button (click)="bump(i, -1)" aria-label="הקטנה">▼</button>
                      </div>
                    }
                  </div>
                  <button class="btn primary" (click)="submit(digits().join(''))" [disabled]="busy() || cooling()">פתיחת הקופסה</button>
                }
                @case ('items') {
                  @if (panel() === 'workbench') {
                    <p>בחרו שני חפצים לחיבור:</p>
                    <div class="inv">
                      @for (id of game.snapshot()?.inventory ?? []; track id) {
                        <button class="item" [class.sel]="picked().includes(id)" (click)="togglePick(id)"><px-icon [name]="id" [size]="36" /><span>{{ itemName(id) }}</span></button>
                      } @empty { <p class="muted">אין לכם עדיין חפצים. חפשו אותם בחדרים!</p> }
                    </div>
                    <button class="btn primary" (click)="combine()" [disabled]="picked().length !== 2 || busy()">חיבור החפצים</button>
                  } @else {
                    <div class="sockets">
                      @for (req of data()?.required ?? []; track req) {
                        <div class="socket" [class.full]="game.snapshot()?.placedItems?.includes(req)"><px-icon [name]="req" [size]="40" /><span>{{ itemName(req) }}</span></div>
                      }
                    </div>
                    <p>החפצים שלכם:</p>
                    <div class="inv">
                      @for (id of game.snapshot()?.inventory ?? []; track id) {
                        <button class="item" (click)="place(id)" [disabled]="busy()"><px-icon [name]="id" [size]="36" /><span>{{ itemName(id) }}</span><small>הנחה על הכן</small></button>
                      } @empty { <p class="muted">אין חפצים בתיק הקבוצתי.</p> }
                    </div>
                  }
                }
                @case ('final') {
                  <div class="frame" dir="rtl">
                    @for (z of data()?.slots ?? []; track z; let i = $index) {
                      <button class="fslot" (click)="fillSlot(i)" [attr.aria-label]="'משבצת ' + (i + 1) + ' — ' + zoneName(z)">
                        <px-icon [name]="zoneIcon(z)" [size]="26" /><b>{{ finalSlots()[i] ?? '' }}</b>
                      </button>
                    }
                  </div>
                  <p class="muted small">בחרו אות זהב ואז לחצו על המשבצת המתאימה. לחיצה על משבצת מלאה מרוקנת אותה.</p>
                  <div class="tiles">
                    @for (l of game.snapshot()?.letters ?? []; track $index) {
                      <button class="tile" [class.sel]="selectedTile() === $index" [class.used]="usedTile($index)" (click)="selectedTile.set($index)">
                        <b>{{ l.letter }}</b><small>{{ zoneName(l.zone) }}</small></button>
                    }
                  </div>
                  <button class="btn primary" (click)="submit(finalSlots())" [disabled]="filledSlots() < (data()?.slots?.length ?? 5) || busy() || cooling()">פתיחת הפורטל</button>
                }
              }
            }
          }

          @if (feedback(); as f) { <p class="fb" [class.good]="f.ok" role="alert">{{ f.text }}</p> }
          @if (cooling()) { <p class="fb" role="status">המנגנון נעול עוד {{ cooldownLeft() }} שניות.</p> }

          @if (state()?.status !== 'solved' && state()?.status !== 'locked') {
            <section class="hints" aria-label="רמזים">
              @for (h of state()?.hints ?? []; track $index) {
                <p class="hint"><px-icon name="hint" [size]="18" /> <b>רמז {{ $index + 1 }}:</b> {{ h }}</p>
              }
              @if ((state()?.hintsRevealed ?? 0) < 3) {
                <button class="btn small" (click)="hint()" [disabled]="busy()">
                  <px-icon name="hint" [size]="18" /> {{ hintLabel() }} ({{ (state()?.hintsRevealed ?? 0) + 1 }}/3)
                </button>
              }
            </section>
          }
        }
      </section>
    </div>
  `,
  styles: [`
    header { display:flex; justify-content:space-between; align-items:flex-start; gap:1rem; }
    h2 { font-size: 1.7rem; margin:.3rem 0 .6rem; }
    .instructions { line-height: 1.65; color: #e9e2cf; border-inline-start: 3px solid var(--gold); padding-inline-start: .8rem; }
    .muted.small, .small { font-size: .88rem; }
    .row { display:flex; gap:.6rem; align-items:center; margin-top:.6rem; }
    .guide { display:flex; gap:1rem; align-items:flex-start; } .guide img { width: 110px; border-radius: 12px; border:1px solid var(--line); }
    .speech { font-size: 1.15rem; line-height:1.7; background: rgba(255,255,255,.05); padding: .8rem 1rem; border-radius: 12px; }
    .key-table { display:grid; grid-template-columns: repeat(4, 1fr); gap:.6rem; }
    .kcell { display:flex; align-items:center; justify-content:center; gap:.4rem; background: #e8d3a3; color:#3b2410; border-radius: 10px; padding:.6rem; }
    .kcell b { font-size: 2rem; font-family: var(--font-title); }
    .parchment, .plaque { border-radius: 14px; padding: 1.2rem; text-align:center; }
    .parchment { background: radial-gradient(circle, #f1deb4, #b8925a); color:#3b2410; }
    .parchment .msg { display:flex; justify-content:center; gap: 1rem; margin: .8rem 0; flex-direction: row; }
    .mansion { list-style:none; padding:0; margin: .8rem 0; display:grid; grid-template-columns: repeat(3, 1fr); gap:.6rem; direction: rtl; }
    .mansion li { position:relative; display:flex; flex-direction:column; align-items:center; gap:.25rem; padding:.8rem .4rem; border-radius: 14px;
      background: linear-gradient(180deg,#e8d3a3,#c7a66a); color:#3b2410; border: 2px solid #6b4422; opacity:.55; }
    .mansion li.open { opacity: 1; }
    .mansion li.here { box-shadow: 0 0 0 3px #8a1f1f, 0 0 18px rgba(255,200,120,.6); }
    .mansion li.done small { color:#1f6b35; font-weight:700; }
    .mansion .num { position:absolute; top:4px; inset-inline-start: 8px; font-weight:800; }
    .mansion b { font-size: 1.05rem; }
    .plaque { background: #6b6b70; color:#16130e; font-family: var(--font-title); font-size: 1.7rem; border: 6px solid #3f3f44; }
    .slots { display:flex; justify-content:center; gap:.6rem; margin: .8rem 0; }
    .slot { width: 64px; height: 72px; border-radius: 10px; border: 2px solid var(--gold); display:grid; place-items:center; font-size: 2.4rem; font-family: var(--font-title); background: rgba(0,0,0,.3); }
    .slot.filled { background: rgba(224,185,92,.18); }
    .keypad { display:grid; grid-template-columns: repeat(8, 1fr); gap:.3rem; margin-bottom:.8rem; }
    .keypad button { min-height: 42px; font-size: 1.3rem; font-family: var(--font-title); border-radius: 8px; border: 1px solid var(--line); background: rgba(255,255,255,.06); color: var(--text); cursor:pointer; }
    .keypad button:hover { background: rgba(224,185,92,.2); } .keypad .wide { grid-column: span 2; }
    .dial { display:flex; justify-content:center; gap:.7rem; margin: 1rem 0; padding: 1rem; border-radius: 50%/30%; background: radial-gradient(circle, #5a4630, #2b2016); }
    .dslot { width: 76px; height: 76px; border-radius: 12px; background: #c9a46a; color:#3b2410; display:grid; place-items:center; position:relative; box-shadow: inset 0 0 12px rgba(0,0,0,.5); }
    .dslot small { position:absolute; top: 2px; inset-inline-start: 6px; font-weight:800; }
    .choices, .bells, .inv, .tiles, .sockets { display:flex; flex-wrap:wrap; gap:.6rem; justify-content:center; }
    .sym, .item, .tile { display:flex; flex-direction:column; align-items:center; gap:.2rem; padding:.6rem .8rem; border-radius: 12px; border:1px solid var(--line);
      background: rgba(255,255,255,.06); color: var(--text); cursor:pointer; font-family: inherit; min-width: 84px; }
    .sym:hover:not(:disabled), .item:hover:not(:disabled), .tile:hover { border-color: var(--gold-2); }
    .item.sel, .tile.sel { border-color: var(--gold-2); background: rgba(224,185,92,.2); }
    .tile b { font-size: 2rem; font-family: var(--font-title); color: var(--gold-2); } .tile.used { opacity: .35; }
    .bell { display:flex; flex-direction:column; align-items:center; padding:.6rem; border-radius: 50% 50% 14px 14px; border: 2px solid #8a6530; background: linear-gradient(180deg,#6b4a1e,#3a2810); color: #f6d78d; min-width: 70px; transition: transform .1s, box-shadow .1s; }
    .bell.big { cursor:pointer; min-width: 90px; min-height: 100px; font-family: inherit; }
    .bell b { font-size: 1.6rem; font-family: var(--font-title); }
    .bell.lit { box-shadow: 0 0 30px #ffd27a; transform: translateY(-4px) rotate(-6deg); background: linear-gradient(180deg,#e0b95c,#8a6530); color:#1d1405; }
    .small-bells .bell { min-width: 56px; }
    .entered { margin: .8rem 0; text-align:center; } .entered b { font-size: 1.5rem; margin: 0 .25rem; color: var(--gold-2); font-family: var(--font-title); }
    .clue { display:flex; gap: 1rem; align-items:center; margin-bottom: .8rem; } .clue .visual { width: 220px; flex-shrink:0; }
    .clue svg { width:100%; border-radius: 10px; border: 3px solid var(--gold-dark); }
    .note { background: rgba(106,168,255,.12); border: 1px solid rgba(106,168,255,.4); padding: .6rem .8rem; border-radius: 10px; }
    .digits { display:flex; justify-content:center; gap: 1rem; margin: 1rem 0; }
    .digit { display:flex; flex-direction:column; align-items:center; gap:.3rem; }
    .digit b { font-size: 2.6rem; width: 64px; text-align:center; background:#0a0f22; border:2px solid var(--gold); border-radius: 10px; }
    .digit button { width: 52px; height: 36px; border-radius: 8px; border:1px solid var(--line); background: rgba(255,255,255,.08); color: var(--text); cursor:pointer; }
    .socket { display:flex; flex-direction:column; align-items:center; padding:.8rem; border-radius: 50%; width: 110px; height:110px; justify-content:center; border: 2px dashed var(--line); color: var(--muted); }
    .socket.full { border-style: solid; border-color: var(--ok); color: var(--text); box-shadow: 0 0 18px rgba(63,191,106,.35); }
    .frame { display:flex; justify-content:center; gap:.5rem; padding: 1rem; border-radius: 120px 120px 16px 16px; background: radial-gradient(circle at 50% 0, #2a4b9a, #0b1230); border:3px solid var(--gold); margin-bottom: .6rem; }
    .fslot { width: 70px; height: 92px; border-radius: 10px; border: 2px solid var(--gold); background: rgba(0,0,0,.35); color: var(--gold-2); display:flex; flex-direction:column; align-items:center; justify-content:space-between; padding:.4rem; cursor:pointer; }
    .fslot b { font-size: 2.2rem; font-family: var(--font-title); color: #fff; min-height: 1.2em; }
    .fb { padding:.6rem .9rem; border-radius: 10px; background: rgba(226,113,91,.15); border: 1px solid rgba(226,113,91,.4); }
    .fb.good, .solved { background: rgba(63,191,106,.15); border: 1px solid rgba(63,191,106,.45); padding:.6rem .9rem; border-radius: 10px; display:flex; gap:.4rem; align-items:center; }
    .hints { margin-top: 1rem; border-top: 1px solid var(--line); padding-top: .8rem; display:flex; flex-direction:column; gap:.4rem; align-items:flex-start; }
    .hint { margin:0; line-height:1.6; display:flex; gap:.3rem; align-items:flex-start; } .hint px-icon { color: var(--gold); margin-top: 3px; }
    @media (max-width: 560px) { .keypad { grid-template-columns: repeat(6, 1fr); } .clue { flex-direction: column; } .key-table { grid-template-columns: repeat(2, 1fr); } }
  `],
})
export class PuzzlePanelComponent implements OnInit, OnDestroy {
  panel = input.required<PanelId>();
  ref = input<string | undefined>();
  /** Zone the local player stands in (for the map's "you are here"). */
  here = input<string | undefined>();
  ringBell = input<(id: string) => void>(() => {});
  close = output<void>();

  game = inject(GameService);
  private audio = inject(AudioService);
  private settings = inject(SettingsService);

  hebLetters = HEB_LETTERS;
  busy = signal(false);
  feedback = signal<{ ok: boolean; text: string } | null>(null);
  letters = signal<string[]>([]);
  seq = signal<string[]>([]);
  digits = signal([0, 0, 0]);
  picked = signal<string[]>([]);
  finalSlots = signal<(string | null)[]>([null, null, null, null, null]);
  selectedTile = signal<number | null>(null);
  filledSlots = computed(() => this.finalSlots().filter((x) => !!x).length);
  clues = signal<{ index: number; title: string; text: string; visual: string }[]>([]);
  keyInfo = signal<{ key: { symbol: string; letter: string }[]; parts: number; total: number } | null>(null);
  playing = signal(false);
  litBell = signal<string | null>(null);
  guideStep = signal(0);
  now = signal(Date.now());
  private timer?: ReturnType<typeof setInterval>;

  starPts = [[20, 30], [55, 18], [90, 40], [120, 25], [150, 60], [118, 95], [70, 100]];
  starLine = this.starPts.map((p) => `${p[0] + 8},${p[1] + 8}`).join(' ');

  puzzle = computed<PuzzleContent | undefined>(() => {
    const id = this.panel() === 'guide' ? this.currentPuzzleId() : PANEL_PUZZLE[this.panel()];
    return this.game.scenario()?.puzzles.find((p) => p.id === id);
  });
  state = computed(() => this.game.snapshot()?.puzzles.find((p) => p.id === this.puzzle()?.id));
  data = computed(() => this.puzzle()?.publicData);
  isLockPanel = computed(() =>
    ['cipher-lock', 'sequence-lock', 'sound-lock', 'split-lock', 'workbench', 'pedestal', 'portal-lock'].includes(this.panel()),
  );
  cooldownLeft = computed(() => {
    const until = this.state()?.cooldownUntil;
    if (!until) return 0;
    return Math.max(0, Math.ceil((new Date(until).getTime() - this.game.serverNow() + 0 * this.now()) / 1000));
  });
  cooling = computed(() => this.cooldownLeft() > 0);
  title = computed(() => {
    switch (this.panel()) {
      case 'guide': return 'יהודה המדריך';
      case 'map': return 'מפת האחוזה';
      case 'cipher-key': return 'ספר המפתח';
      case 'cipher-message': return 'הקלף הישן';
      case 'plaque': return 'לוח אבן';
      case 'sound-box': return 'תיבת הנגינה';
      case 'mirror': return 'המראה העתיקה';
      case 'workbench': return 'שולחן העבודה';
      default: return this.puzzle()?.title ?? '';
    }
  });
  plaqueText = computed(() => (this.data()?.plaques ?? []).find((p: any) => p.id === this.ref())?.text ?? '');
  hintLabel = computed(() => ['בקשת רמז עדין', 'בקשת רמז ממוקד', 'בקשת רמז כמעט מפורש'][this.state()?.hintsRevealed ?? 0] ?? 'רמז');

  guideLines = [
    'שלום! אני יהודה, ואני מכיר את האחוזה הזאת היטב. כל חדר כאן נעול בחידה, וכל חידה שתפתרו תפתח את הדלת לחדר הבא.',
    'לחצו על חפצים מסומנים כדי לבדוק אותם. חפצים שאפשר לאסוף ייכנסו לתיק המשותף של הקבוצה, וכל אחד מכם יוכל להשתמש בהם.',
    'בכל חידה שתפתרו תקבלו אות זהב. שמרו עליהן — בסוף הדרך הן יפתחו את הפורטל.',
    'ואם נתקעתם — אפשר לבקש רמז. יש שלוש דרגות רמזים, מרמז עדין ועד רמז כמעט מפורש. בהצלחה, ושתפו הרבה!',
  ];
  guideText = computed(() => this.guideLines[this.guideStep()]);

  ngOnInit() {
    this.timer = setInterval(() => this.now.set(Date.now()), 500);
    if (this.panel() === 'mirror') this.loadClues();
    if (this.panel() === 'cipher-key') this.loadKey();
    if (this.panel() === 'guide') this.audio.speak('guide_01', this.guideLines[0], 'יהודה', true);
    this.audio.sfx('open');
  }

  ngOnDestroy() {
    clearInterval(this.timer);
    this.playing.set(false);
  }

  private currentPuzzleId() {
    return this.game.snapshot()?.puzzles.find((p) => p.status === 'active')?.id ?? null;
  }

  zonesSorted() {
    return [...(this.game.scenario()?.zones ?? [])].sort((a, b) => a.order - b.order);
  }
  isOpen(zone: string) {
    return this.game.snapshot()?.unlockedZones.includes(zone) ?? false;
  }
  zoneDone(zone: string) {
    const ids = (this.game.scenario()?.puzzles ?? []).filter((p) => p.zone === zone).map((p) => p.id);
    return ids.length > 0 && ids.every((id) => this.game.snapshot()?.puzzles.find((s) => s.id === id)?.status === 'solved');
  }

  zoneName(id: string) {
    return this.game.scenario()?.zones.find((z) => z.id === id)?.name ?? id;
  }
  zoneIcon(id: string) {
    return this.game.scenario()?.zones.find((z) => z.id === id)?.icon ?? 'lock';
  }
  itemName(id: string) {
    return this.game.scenario()?.items.find((i) => i.id === id)?.name ?? id;
  }
  bellLabel(id: string) {
    return (this.data()?.bells ?? []).find((b: any) => b.id === id)?.label ?? '?';
  }

  nextGuide() {
    if (this.guideStep() >= this.guideLines.length - 1) return this.close.emit();
    this.guideStep.update((s) => s + 1);
    this.audio.speak(`guide_0${this.guideStep() + 1}`, this.guideText(), 'יהודה', true);
  }

  addLetter(l: string) {
    if (this.letters().length < 3) this.letters.update((x) => [...x, l]);
    this.audio.sfx('click');
  }
  addSeq(id: string) {
    this.seq.update((s) => [...s, id]);
    this.audio.sfx('click');
  }
  bump(i: number, d: number) {
    this.digits.update((ds) => ds.map((v, k) => (k === i ? (v + d + 10) % 10 : v)));
    this.audio.sfx('click');
  }
  togglePick(id: string) {
    this.picked.update((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-2)));
  }
  usedTile(i: number) {
    const l = this.game.snapshot()?.letters[i]?.letter;
    const used = this.finalSlots().filter((x) => x === l).length;
    const sameBefore = (this.game.snapshot()?.letters ?? []).slice(0, i).filter((x) => x.letter === l).length;
    return used > sameBefore;
  }
  fillSlot(i: number) {
    const slots = [...this.finalSlots()];
    const t = this.selectedTile();
    if (slots[i]) slots[i] = null;
    else if (t !== null) {
      slots[i] = this.game.snapshot()?.letters[t]?.letter ?? null;
      this.selectedTile.set(null);
    }
    this.finalSlots.set(slots);
    this.audio.sfx('click');
  }

  async tapBell(b: { id: string; frequency: number }) {
    this.audio.bell(b.frequency);
    this.ringBell()(b.id);
    this.flash(b.id, 300);
    this.seq.update((s) => [...s, b.id]);
  }

  private flash(id: string, ms: number) {
    this.litBell.set(id);
    setTimeout(() => this.litBell() === id && this.litBell.set(null), ms);
  }

  async playTune() {
    const r = await this.game.getTune('p3-sound');
    if (!r.ok || !r.data) {
      this.feedback.set({ ok: false, text: r.message });
      return;
    }
    this.playing.set(true);
    const bells: { id: string; frequency: number }[] = this.data()?.bells ?? [];
    for (const id of r.data.sequence) {
      if (!this.playing()) break;
      const b = bells.find((x) => x.id === id);
      if (b) {
        this.audio.bell(b.frequency);
        this.ringBell()(b.id);
        this.flash(b.id, 550);
      }
      await new Promise((res) => setTimeout(res, 800));
    }
    this.playing.set(false);
  }

  private async loadKey() {
    const r = await this.game.getPersonalClues('p1-cipher');
    if (r.ok && r.data) this.keyInfo.set({ key: (r.data as any).key ?? [], parts: (r.data as any).keyParts ?? 1, total: (r.data as any).keyPartsTotal ?? 1 });
    else this.feedback.set({ ok: false, text: r.message });
  }

  private async loadClues() {
    const r = await this.game.getPersonalClues('p4-split');
    if (r.ok && r.data) this.clues.set(r.data.clues);
    else this.feedback.set({ ok: false, text: r.message });
  }

  async submit(answer: unknown) {
    const p = this.puzzle();
    if (!p) return;
    this.busy.set(true);
    const r = await this.game.submitAnswer(p.id, answer);
    this.busy.set(false);
    this.handle(r.ok, r.message, r.code);
    if (!r.ok) {
      this.seq.set([]);
      this.letters.set([]);
    }
  }

  async hint() {
    const p = this.puzzle();
    if (!p) return;
    this.busy.set(true);
    const r = await this.game.requestHint(p.id);
    this.busy.set(false);
    if (!r.ok) this.feedback.set({ ok: false, text: r.message });
  }

  async combine() {
    const [a, b] = this.picked();
    this.busy.set(true);
    const r = await this.game.combine(a, b);
    this.busy.set(false);
    this.handle(r.ok, r.message, r.code);
    if (r.ok) this.picked.set([]);
  }

  async place(id: string) {
    this.busy.set(true);
    const r = await this.game.placeItem('p5-items', id);
    this.busy.set(false);
    this.handle(r.ok, r.message, r.code);
  }

  private handle(ok: boolean, text: string, code: string) {
    this.feedback.set({ ok, text });
    if (ok && code === 'solved') setTimeout(() => this.close.emit(), 1800);
  }
}
