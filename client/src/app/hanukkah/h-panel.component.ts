import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, HostListener, computed, inject, input, output, signal } from '@angular/core';
import { AudioService } from '../core/audio.service';
import { GameService } from '../core/game.service';
import { MechanismState, PuzzleContent, PuzzleStateDto } from '../core/models';
import { HPanel } from './h-layout';

const PANEL_PUZZLE: Record<HPanel, string> = {
  riddle: 'h1-riddle', lamp: 'h2-lamp', maze: 'h3-maze', box: 'h3-box', wheel: 'h4-wheel', stand: 'h5-stand',
  lock: 'h5-lock', jugs: 'h6-jugs', mosaic: 'h7-mosaic', pedestals: 'h8-pedestals', final: 'h8-final',
  map: 'g1-map', symbols: 'g1-symbols', cabinet: 'g1-cabinet', gears: 'g2-gears', mirror: 'g2-mirrors',
};

export const ITEM_EMOJI: Record<string, string> = {
  'antique-key': '🗝️', 'lamp-base': '⚱️', 'lamp-tank': '🫙', 'lamp-wick': '🧵', 'lamp-glass': '🔮', 'lamp-cover': '🔔',
  'menorah-symbol': '🕎', 'golden-key': '🔑', 'light-stone': '💎', 'dreidel-nun': 'נ', 'dreidel-gimel': 'ג', 'dreidel-he': 'ה',
  'dreidel-pe': 'פ', 'flame-symbol': '🔥', 'golden-jug': '🏺', 'blue-crystal': '🔷',
  'map-left': '🗺️', 'map-middle': '🗺️', 'map-right': '🗺️', 'sym-compass': '🧭', 'sym-key': '🗝️', 'sym-book': '📖', 'sym-lamp': '🪔',
  'gs-golden-key': '🔑', 'gear-large': '⚙️', 'gear-small': '⚙️', 'gear-medium': '⚙️',
};

const LETTERS = 'אבגדהוזחטיכלמנסעפצקרשת'.split('');
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
                    <span class="mc" [class.wall]="cell.ch === '#'" [class.gate]="cell.gate" [class.open]="cell.open" [class.key]="cell.key">{{ cell.key ? '🔑' : cell.label }}</span>
                  }
                </div>
                <div class="controls">
                  <div class="pad" dir="ltr">
                    <span></span><button class="btn" (click)="move('N')" aria-label="למעלה">▲</button><span></span>
                    <button class="btn" (click)="move('W')" aria-label="שמאלה">◀</button><span class="mid">🧲</span><button class="btn" (click)="move('E')" aria-label="ימינה">▶</button>
                    <span></span><button class="btn" (click)="move('S')" aria-label="למטה">▼</button><span></span>
                  </div>
                  <div class="levers">
                    @for (l of data().levers; track $index; let i = $index) {
                      <button class="btn lever" [class.on]="mech()?.levers?.[i]" (click)="operate({ op: 'lever', index: i })" [disabled]="busy() || state()?.status === 'solved'">
                        {{ l.label }}: {{ mech()?.levers?.[i] ? 'מופעל' : 'כבוי' }}
                      </button>
                    }
                  </div>
                  <p class="progress">סמלים לפי הסדר: @for (s of ['star', 'flame', 'menorah']; track s; let i = $index) { <span [class.ok]="(mech()?.progress ?? 0) > i">{{ data().symbolNames[s] }} {{ (mech()?.progress ?? 0) > i ? '✓' : '·' }}</span> }</p>
                  <p class="muted small">אפשר גם עם מקשי החיצים כשהחלון פתוח.</p>
                </div>
              </div>
              @if (mech()?.revealed) { <p class="reveal">תא האיסוף נפתח. הקוד: <b dir="ltr">{{ mech()!.revealed }}</b></p> }
            }
            @case ('box') { <ng-container *ngTemplateOutlet="digits" /> }
            @case ('cabinet') {
              @if (backsLine()) { <p class="reveal">בגב הסמלים, לפי סדר המקומות: <b dir="ltr">{{ backsLine() }}</b></p> }
              <ng-container *ngTemplateOutlet="digits" />
            }
            @case ('mirror') {
              <p class="muted small">אפשר ללחוץ על המראות בחדר עצמו, או כאן. כל לחיצה מסובבת מראה בשמינית סיבוב.</p>
              <div class="options">
                @for (d of data().dials; track $index; let i = $index) {
                  <button class="btn" (click)="operate({ op: 'rotate', index: i, dir: -1 })" [disabled]="busy() || state()?.status === 'solved'">↺ {{ d.label }}</button>
                  <button class="btn" (click)="operate({ op: 'rotate', index: i })" [disabled]="busy() || state()?.status === 'solved'">{{ d.label }} ↻</button>
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
                  <button class="slot ped" [class.focus]="ref() === sl.id" [class.full]="!!mech()?.slots?.[sl.id]" (click)="slotClick(sl.id)" [disabled]="busy() || state()?.status === 'solved'">
                    <small>כן {{ sl.id.slice(1) }} · {{ sl.label }}</small>
                    <b>{{ mech()?.slots?.[sl.id] ? emoji(mech()!.slots[sl.id]) + ' ' + itemName(mech()!.slots[sl.id]) : 'ריק' }}</b>
                  </button>
                }
              </div>
              <ng-container *ngTemplateOutlet="bag" />
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
                <input [value]="text()" (input)="text.set(digitsOnly($any($event.target).value))" inputmode="numeric" [attr.maxlength]="data().digits"
                  dir="ltr" class="code" placeholder="{{ '•'.repeat(data().digits ?? 3) }}" aria-label="קוד" />
                <button class="btn primary" type="submit" [disabled]="text().length !== data().digits || busy()">פתיחה</button>
              </form>
            }
          </ng-template>

          <ng-template #bag>
            <div class="bag">
              <span class="muted small">בתיק:</span>
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
                <button class="btn small" (click)="hint()" [disabled]="busy()">בקשת רמז (−{{ penalty() }} לניקוד הקבוצתי של החדר)</button>
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
    .controls { display:flex; flex-direction:column; gap:.6rem; }
    .pad { display:grid; grid-template-columns: repeat(3, 52px); gap:4px; } .pad .mid { display:grid; place-items:center; font-size:1.4rem; }
    .levers { display:flex; flex-direction:column; gap:.3rem; } .lever.on { border-color: var(--ok); color:#9be3b4; }
    .progress span { margin-inline-end:.6rem; color: var(--muted); } .progress span.ok { color:#9be3b4; }
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
    .warn { color:#ffd59a; } .msg { margin:.6rem 0 0; } .msg.bad { color:#ffb4a3; }
    footer { margin-top:1rem; border-top:1px solid var(--line); padding-top:.6rem; display:flex; flex-direction:column; gap:.4rem; align-items:flex-start; }
    .hint { margin:0; color:#cfe2ff; }
    .small { font-size:.85rem; }
  `],
  imports: [NgTemplateOutlet],
})
export class HPanelComponent {
  game = inject(GameService);
  private audio = inject(AudioService);
  panel = input.required<HPanel>();
  ref = input<string | undefined>();
  close = output<void>();
  /** The letters chosen on the wheel, so the 3D wheel in the room turns with them. */
  wheelChange = output<string[]>();

  text = signal('');
  busy = signal(false);
  selected = signal<string | null>(null);
  candidate = signal<string | null>(null);
  wheel = signal(['א', 'א', 'א']);
  message = signal<{ ok: boolean; text: string } | null>(null);

  puzzleId = computed(() => PANEL_PUZZLE[this.panel()]);
  puzzle = computed<PuzzleContent | undefined>(() => this.game.scenario()?.puzzles.find((p) => p.id === this.puzzleId()));
  state = computed<PuzzleStateDto | undefined>(() => this.game.snapshot()?.puzzles.find((p) => p.id === this.puzzleId()));
  mech = computed<MechanismState | undefined>(() => this.game.snapshot()?.mechanisms?.[this.puzzleId()]);
  data = computed(() => this.puzzle()?.publicData ?? {});
  slots = computed<{ id: string; label: string }[]>(() => this.data().slots ?? []);
  bagItems = computed(() => {
    const accepts: string[] = this.data().accepts ?? [];
    return (this.game.snapshot()?.inventory ?? []).filter((i) => accepts.includes(i));
  });
  /** Hint texts stay on the server until requested; only their number is public. */
  hintCount = computed(() => this.puzzle()?.hintCount ?? 0);
  penalty = computed(() => this.game.scenario()?.scoring?.hintPenalty ?? 10);
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
    this.audio.sfx('click');
  }

  @HostListener('window:keydown', ['$event'])
  onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') this.close.emit();
    if (this.panel() !== 'maze') return;
    const dir: Record<string, string> = { ArrowUp: 'N', ArrowDown: 'S', ArrowLeft: 'W', ArrowRight: 'E' };
    if (dir[e.key]) {
      e.preventDefault();
      e.stopPropagation();
      this.move(dir[e.key]);
    }
  }

  move(dir: string) {
    if (this.state()?.status !== 'solved') this.operate({ op: 'move', dir }, true);
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
      const r = await this.game.operate(this.puzzleId(), action);
      if (!r.ok) {
        this.message.set({ ok: false, text: r.message });
        this.audio.sfx('wrong');
      } else if (!quiet || r.message) this.message.set(r.message ? { ok: true, text: r.message } : null);
      if (r.ok && !quiet) this.audio.sfx('click');
    } finally {
      this.busy.set(false);
    }
  }

  async answer(value: string) {
    if (!value.trim()) return;
    this.busy.set(true);
    try {
      const r = await this.game.submitAnswer(this.puzzleId(), value.trim());
      this.message.set({ ok: r.ok, text: r.message });
      if (r.ok) this.text.set('');
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
