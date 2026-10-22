import {
  AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, NgZone, OnDestroy, computed, effect, inject, output, signal, untracked, viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AudioService } from '../core/audio.service';
import { GameService } from '../core/game.service';
import { GameNotice, RoomSnapshot } from '../core/models';
import { SettingsService } from '../core/settings.service';
import { ChatComponent } from '../ui/chat.component';
import { JoystickComponent } from '../ui/joystick.component';
import { SettingsPanelComponent } from '../ui/settings-panel.component';
import { H_ZONES, HInteractable, HPanel, HZone } from './h-layout';
import { HPanelComponent, ITEM_EMOJI } from './h-panel.component';
import { HResultComponent } from './h-result.component';
import { HanukkahWorld } from './h-world';

interface Toast { id: number; text: string; kind: string }

const PUZZLE_PANEL: Record<string, HPanel> = {
  'h1-riddle': 'riddle', 'h2-lamp': 'lamp', 'h3-maze': 'maze', 'h3-box': 'box', 'h4-wheel': 'wheel', 'h5-stand': 'stand',
  'h5-lock': 'lock', 'h6-jugs': 'jugs', 'h7-mosaic': 'mosaic', 'h8-pedestals': 'pedestals', 'h8-final': 'final',
};

/** The Hanukkah game: opening scene, eight rooms, puzzles, scores, chat, finale and results. */
@Component({
  selector: 'px-h-play',
  imports: [ChatComponent, JoystickComponent, SettingsPanelComponent, HPanelComponent, HResultComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stage">
      <canvas #c tabindex="0" aria-label="עולם המשחק התלת־ממדי. השתמשו במקשי החיצים לתנועה ובעכבר לסיבוב."></canvas>
      @if (loading()) { <div class="loading">מכינים את האחוזה...</div> }
    </div>

    @if (phase() === 'intro') {
      <div class="letterbox top"></div><div class="letterbox bottom"></div>
      @if (introT() < 9) {
        <div class="title-card"><h1 class="gold-title">PORTAL X</h1><p>סוד פך השמן — מסע בעקבות נס החנוכה</p></div>
      } @else {
        <div class="mission card">
          <span class="chip">המשימה שלכם</span>
          <h2>גלו את סוד פך השמן</h2>
          <ul>
            <li>שמונה חדרים רציפים — כל חדר שנפתר פותח את הדלת לבא אחריו</li>
            <li>חקרו, אספו חפצים, פענחו רמזים והפעילו מנגנונים — יחד</li>
            <li>כל הקבוצה מתקדמת יחד, ולכל אחד ניקוד אישי משלו</li>
          </ul>
        </div>
      }
      <div class="cine-actions">
        @if (game.isHost()) { <button class="btn small" (click)="skipIntro()">דילוג על הפתיחה ›</button> }
        @else { <span class="muted small">רק המארח יכול לדלג על הפתיחה</span> }
      </div>
    }

    @if (phase() === 'playing') {
      <header class="hud-top">
        <div class="zone card">
          <b>{{ zoneName(zone()) }}</b>
          <span class="muted small">חדר {{ zoneIndex(zone()) }} מתוך 8</span>
          <span class="timer" aria-label="זמן משחק">{{ elapsed() }}</span>
        </div>
        <div class="tools">
          <button class="btn small" (click)="showHelp.set(!showHelp())">עזרה</button>
          <button class="btn small" (click)="showSettings.set(true)">הגדרות</button>
          <button class="btn small ghost" (click)="confirmLeave()">יציאה</button>
        </div>
      </header>

      <aside class="score card" aria-label="לוח ניקוד">
        <div class="score-head"><span>ניקוד קבוצתי</span><b>{{ game.snapshot()!.score?.group ?? 0 }}</b></div>
        <ol>
          @for (p of game.snapshot()!.score?.players ?? []; track p.playerId) {
            <li [class.me]="p.playerId === game.playerId()">
              <span class="rank">{{ p.rank }}</span><span class="nm">{{ p.nickname }}</span><b>{{ p.points }}</b>
              @for (f of floatsFor(p.playerId); track f.id) { <span class="float">{{ f.text }}</span> }
            </li>
          }
        </ol>
      </aside>

      <aside class="objectives card" [class.collapsed]="!showObjectives()">
        <button class="obj-head" (click)="showObjectives.set(!showObjectives())" [attr.aria-expanded]="showObjectives()">
          <b>המשימות בחדר</b><span>{{ showObjectives() ? '−' : '+' }}</span></button>
        @if (showObjectives()) {
          <ul>
            @for (p of objectives(); track p.id) {
              <li [class.done]="p.status === 'solved'" [class.locked]="p.status === 'locked'">
                <span class="box">{{ p.status === 'solved' ? '✓' : p.status === 'locked' ? '🔒' : '' }}</span>{{ p.objective }}
              </li>
            }
          </ul>
          <p class="players-line">
            @for (pl of game.snapshot()!.players; track pl.id) { <span [class.off]="!pl.isConnected">● {{ pl.nickname }}</span> }
          </p>
        }
      </aside>

      @if (hover(); as h) { <div class="hover-label">{{ h.label }} <small>· {{ h.verb }}</small></div> }

      <footer class="hud-bottom">
        <div class="inventory card" aria-label="תיק החפצים של הקבוצה">
          <span class="muted small">תיק הקבוצה</span>
          @for (id of game.snapshot()!.inventory; track id) {
            <button class="inv-item" (click)="inspectItem(id)" [attr.aria-label]="itemName(id)"><span class="em">{{ emoji(id) }}</span><small>{{ itemName(id) }}</small></button>
          } @empty { <span class="muted small">ריק — חפשו וחקרו בחדר</span> }
        </div>
        <div class="right-tools">
          <button class="btn" (click)="openHint()">💡 רמז</button>
          <button class="btn" (click)="showChat.set(!showChat())">צ׳אט @if (unread()) { <span class="badge">{{ unread() }}</span> }</button>
        </div>
      </footer>

      @if (showChat() && !panel()) {
        <section class="chat-pop card" [class.pulse]="chatPulse()" aria-label="צ׳אט הקבוצה">
          <header><b>צ׳אט הקבוצה</b><button class="btn small ghost" (click)="showChat.set(false)" aria-label="סגירת הצ׳אט">✕</button></header>
          <px-chat [system]="system()" />
        </section>
      }

      @if (showHelp()) {
        <section class="help card" aria-label="איך משחקים">
          <header><b>איך משחקים</b><button class="btn small ghost" (click)="showHelp.set(false)" aria-label="סגירה">✕</button></header>
          <ul>
            <li>תנועה: החיצים או W A S D · סיבוב המצלמה: גרירה עם העכבר או האצבע</li>
            <li>לחצו על חפצים בחדר: בדיקה, הרמה, פתיחה, סיבוב, הנחה, הפעלה או קריאה</li>
            <li>גילוי רמז, הפעלת מנגנון והנחת פריט במקום מזכים בניקוד אישי. רמז רשמי מוריד 10 נקודות מהניקוד הקבוצתי של החדר</li>
            <li>כשחדר נפתר, כל הקבוצה עוברת יחד לחדר הבא</li>
          </ul>
          <button class="btn small primary" (click)="showHelp.set(false)">הבנתי</button>
        </section>
      }

      @if (touch) {
        <px-joystick class="joy" (changed)="world?.setJoystick($event.x, $event.y)" />
        <button class="btn primary act" (click)="interactNearest()">פעולה</button>
      }
    }

    @if (note(); as n) {
      <div class="overlay" (click)="note.set(null)">
        <section class="panel-modal note" role="dialog" aria-modal="true" (click)="$event.stopPropagation()">
          <header><h2>{{ n.title }}</h2><button class="btn small ghost" (click)="note.set(null)" aria-label="סגירה">✕</button></header>
          <p class="note-text">{{ n.text }}</p>
          @if (n.by) { <p class="muted small">{{ n.by }}</p> }
        </section>
      </div>
    }

    @if (celebration(); as c) {
      <div class="celebrate" role="alert" aria-live="assertive">
        <div class="card-c">
          <span class="emoji" aria-hidden="true">🕎</span>
          <h2>{{ c.name }} {{ c.verb }}!</h2>
          <p class="what">{{ c.what }}</p>
          @if (c.points) { <p class="pts">+{{ c.points }} נקודות אישיות על החידה</p> }
          @if (c.next) { <small>המטרה הבאה: {{ c.next }}</small> }
        </div>
      </div>
    }
    @if (transfer(); as t) { <div class="transfer" role="status"><span>{{ t }}</span></div> }

    <div class="toasts" aria-live="polite">
      @for (t of toasts(); track t.id) { <div class="toast" [class]="t.kind">{{ t.text }}</div> }
    </div>

    @if (panel(); as p) { <px-h-panel [panel]="p.id" [ref]="p.ref" (close)="closePanel()" /> }
    @if (showSettings()) { <px-settings (close)="showSettings.set(false)" /> }

    @if (phase() === 'completed') {
      @if (!showResult()) {
        <div class="letterbox top"></div><div class="letterbox bottom"></div>
        @if (outroT() > 6) {
          <div class="success">
            <h1 class="gold-title">כל הכבוד!</h1>
            <p>גיליתם את סוד פך השמן והשלמתם את מסע החנוכה.</p>
            <button class="btn primary" (click)="showResult.set(true)">לתוצאות ‹</button>
          </div>
        }
      } @else {
        <px-h-result (home)="leave.emit()" />
      }
    }
  `,
  styles: [`
    :host { display:block; position:fixed; inset:0; overflow:hidden; }
    .stage { position:absolute; inset:0; } canvas { width:100%; height:100%; display:block; outline:none; touch-action:none; cursor:grab; }
    .loading { position:absolute; inset:0; display:grid; place-items:center; font-size:1.4rem; color: var(--gold-2); background: var(--bg); }
    .letterbox { position:fixed; inset-inline:0; height:9vh; background:#000; z-index:5; } .letterbox.top { top:0 } .letterbox.bottom { bottom:0 }
    .title-card { position:fixed; inset:0; display:grid; place-content:center; text-align:center; z-index:6; pointer-events:none; animation: fadein 2s ease; }
    .title-card h1 { font-size: clamp(3rem, 12vw, 7rem); font-weight:900; } .title-card p { font-family: var(--font-title); font-size: clamp(1.2rem, 4vw, 2rem); color: var(--gold-2); text-shadow: 0 2px 10px #000; }
    @keyframes fadein { from { opacity:0; transform: scale(1.05) } }
    .mission { position:fixed; top:14vh; left:0; right:0; margin-inline:auto; z-index:7; max-width:540px; width:calc(100% - 32px); animation: fadein .8s ease both; }
    .mission ul { line-height:1.9; padding-inline-start:1.2rem; }
    .cine-actions { position:fixed; bottom: calc(9vh + 12px); inset-inline-end:16px; z-index:8; }
    .hud-top { position:fixed; top:10px; inset-inline:10px; display:flex; gap:.6rem; align-items:flex-start; z-index:10; pointer-events:none; flex-wrap:wrap; }
    .hud-top > * { pointer-events:auto; }
    .zone { display:flex; align-items:center; gap:.6rem; padding:.5rem .9rem; color: var(--gold-2); }
    .timer { color: var(--text); font-variant-numeric: tabular-nums; direction:ltr; }
    .tools { margin-inline-start:auto; display:flex; gap:.4rem; }
    .score { position:fixed; top:66px; inset-inline-end:10px; width:230px; z-index:9; padding:.5rem .7rem; }
    .score-head { display:flex; justify-content:space-between; align-items:center; color: var(--gold-2); } .score-head b { font-size:1.3rem; }
    .score ol { list-style:none; padding:0; margin:.4rem 0 0; display:flex; flex-direction:column; gap:.2rem; }
    .score li { display:flex; gap:.4rem; align-items:center; position:relative; font-size:.92rem; } .score li.me { color: var(--gold-2); }
    .score .rank { width:18px; color: var(--muted); } .score .nm { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .float { position:absolute; inset-inline-end:-6px; top:-4px; transform: translateX(-100%); white-space:nowrap; background: rgba(63,191,106,.9); color:#06240f; font-weight:700;
      border-radius:999px; padding:0 .5rem; font-size:.78rem; animation: floatUp 2.6s ease forwards; pointer-events:none; }
    @keyframes floatUp { 0% { opacity:0; transform: translate(-100%, 6px) } 15% { opacity:1 } 80% { opacity:1 } 100% { opacity:0; transform: translate(-100%, -18px) } }
    .objectives { position:fixed; top:66px; inset-inline-start:10px; width:300px; z-index:9; padding:.6rem .9rem; }
    .obj-head { all: unset; cursor:pointer; display:flex; justify-content:space-between; width:100%; color: var(--gold-2); }
    .objectives ul { list-style:none; padding:0; margin:.5rem 0; display:flex; flex-direction:column; gap:.35rem; font-size:.92rem; }
    .objectives li { display:flex; gap:.45rem; align-items:center; } .objectives li.done { color: var(--muted); text-decoration: line-through; } .objectives li.locked { opacity:.55; }
    .box { width:18px; height:18px; border:1px solid var(--gold); border-radius:4px; display:grid; place-items:center; flex-shrink:0; color: var(--ok); font-size:.75rem; }
    .players-line { display:flex; flex-wrap:wrap; gap:.5rem; font-size:.82rem; margin:0; } .players-line span { color: var(--ok); } .players-line .off { color: var(--muted); }
    .hover-label { position:fixed; top:46%; left:50%; transform: translate(-50%, -140%); background: rgba(0,0,0,.75); padding:.35rem .8rem; border-radius:999px; border:1px solid var(--line); pointer-events:none; z-index:8; white-space:nowrap; }
    .hover-label small { color: var(--gold-2); }
    .hud-bottom { position:fixed; bottom:10px; inset-inline:10px; display:flex; gap:.6rem; align-items:flex-end; z-index:10; pointer-events:none; }
    .hud-bottom > * { pointer-events:auto; }
    .inventory { display:flex; align-items:center; gap:.4rem; padding:.45rem .8rem; flex-wrap:wrap; max-width: calc(100% - 220px); }
    .inv-item { display:flex; flex-direction:column; align-items:center; background: rgba(255,255,255,.07); border:1px solid var(--line); border-radius:10px; color: var(--gold-2); padding:.2rem .45rem; cursor:pointer; font-family:inherit; }
    .inv-item .em { font-size:1.3rem; line-height:1.2; } .inv-item small { color: var(--text); font-size:.7rem; }
    .right-tools { margin-inline-start:auto; display:flex; gap:.4rem; }
    .badge { background: var(--bad); color:#fff; border-radius:999px; font-size:.75rem; padding:0 .45em; }
    .chat-pop { position:fixed; bottom:80px; inset-inline-end:10px; width:min(360px, calc(100% - 20px)); height:400px; z-index:12; display:flex; flex-direction:column; padding:.6rem; animation: fadein .25s ease both; }
    .chat-pop header { display:flex; justify-content:space-between; align-items:center; } .chat-pop.pulse { box-shadow: 0 0 0 2px var(--gold-2), var(--shadow); }
    .help { position:fixed; bottom:90px; left:0; right:0; margin-inline:auto; z-index:11; width:min(560px, calc(100% - 24px)); padding:.7rem 1rem; }
    .help header { display:flex; justify-content:space-between; align-items:center; color: var(--gold-2); }
    .help ul { margin:.4rem 0 .6rem; padding-inline-start:1.1rem; line-height:1.7; font-size:.95rem; }
    .note { width:min(520px, calc(100% - 24px)); } .note header { display:flex; justify-content:space-between; align-items:center; }
    .note h2 { font-family: var(--font-title); color: var(--gold-2); margin:0; } .note-text { font-size:1.2rem; line-height:1.8; }
    .toasts { position:fixed; top:66px; left:50%; transform:translateX(-50%); display:flex; flex-direction:column; gap:.4rem; align-items:center; z-index:30; pointer-events:none; width:min(520px, calc(100% - 32px)); }
    .toast { background: rgba(10,16,36,.92); border:1px solid var(--line); padding:.5rem 1rem; border-radius:12px; box-shadow: var(--shadow); animation: fadein .3s ease; text-align:center; }
    .toast.zone-unlocked, .toast.clue, .toast.mechanism { border-color: var(--gold-2); color: var(--gold-2); } .toast.wrong-answer { border-color: rgba(226,113,91,.6); }
    .toast.hint { border-color: var(--blue); } .toast.score-group { border-color: var(--ok); color:#9be3b4; }
    .joy { position:fixed; bottom:90px; left:20px; z-index:11; }
    .act { position:fixed; bottom:110px; right:20px; z-index:11; width:86px; height:86px; border-radius:50%; }
    .celebrate { position:fixed; inset:0; z-index:70; pointer-events:none; display:flex; justify-content:center; align-items:flex-start; padding-top:15vh; }
    .card-c { pointer-events:auto; text-align:center; background: linear-gradient(180deg, rgba(40,30,8,.95), rgba(14,20,44,.95)); border:2px solid var(--gold-2);
      border-radius:20px; padding:1rem 2rem 1.2rem; box-shadow: 0 0 60px rgba(224,185,92,.45); animation: popIn .5s cubic-bezier(.2,1.4,.4,1) both; max-width:calc(100% - 32px); }
    .card-c .emoji { font-size:2.6rem; display:block; } .card-c h2 { font-size: clamp(1.5rem, 4.5vw, 2.4rem); margin:.2rem 0; color: var(--gold-2); }
    .card-c .what { margin:.2rem 0; font-size:1.05rem; } .card-c .pts { color:#9be3b4; font-weight:900; font-size:1.3rem; margin:.2rem 0; } .card-c small { color: var(--muted); }
    @keyframes popIn { from { opacity:0; transform: scale(.6) } to { opacity:1; transform: scale(1) } }
    .transfer { position:fixed; inset:0; z-index:65; background: radial-gradient(circle, rgba(10,16,40,.75), #03050c); display:grid; place-items:center; color: var(--gold-2); font-size:1.4rem; font-family: var(--font-title); animation: fadeInOut 1.1s ease both; }
    @keyframes fadeInOut { 0% { opacity:0 } 25%, 70% { opacity:1 } 100% { opacity:0 } }
    .success { position:fixed; inset:0; display:grid; place-content:center; text-align:center; z-index:20; animation: fadein 1.2s ease; gap:.6rem; }
    .success h1 { font-size: clamp(3rem, 11vw, 6rem); font-weight:900; } .success p { font-size:1.4rem; text-shadow: 0 2px 10px #000; }
    .small { font-size:.85rem; }
    @media (max-width: 760px) {
      .objectives { top:auto; bottom:150px; width:calc(100% - 20px); max-height:30vh; overflow:auto; } .objectives.collapsed { width:auto; }
      .score { top:58px; width:170px; font-size:.85rem; } .hover-label { display:none; } .inventory { max-width: calc(100% - 150px); }
    }
  `],
})
export class HPlayComponent implements AfterViewInit, OnDestroy {
  game = inject(GameService);
  private audio = inject(AudioService);
  private settings = inject(SettingsService);
  private ngZone = inject(NgZone);
  private destroyRef = inject(DestroyRef);
  leave = output<void>();

  private canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('c');
  world?: HanukkahWorld;
  touch = matchMedia('(pointer: coarse)').matches;

  loading = signal(true);
  zone = signal<HZone>('library');
  hover = signal<HInteractable | null>(null);
  panel = signal<{ id: HPanel; ref?: string } | null>(null);
  note = signal<{ title: string; text: string; by?: string } | null>(null);
  toasts = signal<Toast[]>([]);
  floats = signal<{ id: number; playerId: string; text: string }[]>([]);
  system = signal<{ id: string; text: string; at: number }[]>([]);
  showChat = signal(false);
  showSettings = signal(false);
  showHelp = signal(false);
  showObjectives = signal(!matchMedia('(max-width: 760px)').matches);
  showResult = signal(false);
  chatPulse = signal(false);
  unread = signal(0);
  celebration = signal<{ name: string; verb: string; what: string; points: number; next?: string; puzzleId: string } | null>(null);
  transfer = signal<string | null>(null);
  tick = signal(0);

  phase = computed(() => this.game.snapshot()?.phase ?? 'lobby');
  objectives = computed(() => {
    const sc = this.game.scenario();
    const s = this.game.snapshot();
    if (!sc || !s) return [];
    return sc.puzzles.filter((p) => p.zone === this.zone())
      .map((p) => ({ id: p.id, objective: p.objective, status: s.puzzles.find((x) => x.id === p.id)?.status ?? 'locked' }));
  });
  introT = computed(() => {
    this.tick();
    const s = this.game.snapshot();
    return s?.introStartedAt ? (this.game.serverNow() - Date.parse(s.introStartedAt)) / 1000 : 0;
  });
  outroT = computed(() => {
    this.tick();
    const s = this.game.snapshot();
    return s?.endedAt ? (this.game.serverNow() - Date.parse(s.endedAt)) / 1000 : 0;
  });
  elapsed = computed(() => {
    this.tick();
    const s = this.game.snapshot();
    if (!s?.startedAt) return '00:00';
    const sec = Math.max(0, Math.floor((this.game.serverNow() - Date.parse(s.startedAt)) / 1000));
    return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  });

  private toastId = 0;
  private ticker?: ReturnType<typeof setInterval>;
  private lastPhase: string | null = null;
  private introFinishSent = false;
  private seenChatIds: Set<string> | null = null;
  private announced = new Set<string>();
  private activeZoneApplied: string | null = null;
  private progressTimers: ReturnType<typeof setTimeout>[] = [];
  private pointsByPuzzle = new Map<string, number>();

  constructor() {
    this.ticker = setInterval(() => this.tick.update((t) => t + 1), 500);

    effect(() => {
      const s = this.game.snapshot();
      const sc = this.game.scenario();
      if (!s || !this.world) return;
      untracked(() => {
        if (this.loading() && sc) this.buildWorld();
        if (this.loading()) return;
        this.world!.applySnapshot(s, sc);
        this.world!.setPlayers(s.players, this.game.playerId(), this.game.positions);
        this.onPhase(s.phase);
        this.handleProgress(s);
      });
    });

    effect(() => {
      const t = this.introT();
      if (this.phase() !== 'intro') return;
      untracked(() => {
        if (!this.introFinishSent && t >= (this.game.snapshot()?.introSeconds ?? 24)) {
          this.introFinishSent = true;
          this.game.finishIntro(false).then((r) => {
            if (!r.ok) setTimeout(() => (this.introFinishSent = false), 2000);
          });
        }
      });
    });

    effect(() => {
      const list = this.game.chat();
      untracked(() => {
        if (this.seenChatIds === null) {
          this.seenChatIds = new Set(list.map((m) => m.id));
          return;
        }
        const fresh = list.filter((m) => !this.seenChatIds!.has(m.id));
        fresh.forEach((m) => this.seenChatIds!.add(m.id));
        if (!fresh.length) return;
        // a new message opens the team chat (spec §9)
        this.showChat.set(true);
        this.unread.set(0);
        this.chatPulse.set(true);
        setTimeout(() => this.chatPulse.set(false), 900);
      });
    });
    effect(() => {
      if (this.showChat()) untracked(() => this.unread.set(0));
    });

    this.game.notices$.pipe(takeUntilDestroyed()).subscribe((n) => this.onNotice(n));
    effect(() => {
      const sens = this.settings.settings().lookSensitivity;
      if (this.world) this.world.sensitivity = sens;
    });
    this.destroyRef.onDestroy(() => this.progressTimers.forEach(clearTimeout));
  }

  ngAfterViewInit() {
    try {
      this.world = this.ngZone.runOutsideAngular(() => new HanukkahWorld(this.canvas().nativeElement, this.settings.settings().quality, {
        onHover: (d) => this.ngZone.run(() => this.hover.set(d)),
        onInteract: (d) => this.ngZone.run(() => this.interact(d)),
        onTooFar: (d) => this.ngZone.run(() => this.toast(`התקרבו אל ${d.label} כדי ל${d.verb === 'הרמה' ? 'הרים' : 'השתמש'}`, 'info')),
        onZoneChange: (z) => this.ngZone.run(() => this.zone.set(z)),
        onMove: (x, y, z, ry, zone) => this.game.move(x, y, z, ry, zone),
      }));
      this.world.sensitivity = this.settings.settings().lookSensitivity;
      if (this.game.scenario()) this.buildWorld();
    } catch {
      this.loading.set(false);
      this.toast('הדפדפן אינו תומך בתלת־ממד (WebGL). נסו דפדפן מעודכן כמו Chrome, Edge או Firefox.', 'wrong-answer');
    }
  }

  private buildWorld() {
    if (!this.world || !this.loading()) return;
    this.ngZone.runOutsideAngular(() => {
      this.world!.build(this.game.scenario());
      this.world!.start();
    });
    this.loading.set(false);
    const s = this.game.snapshot()!;
    this.world.applySnapshot(s, this.game.scenario());
    this.world.setPlayers(s.players, this.game.playerId(), this.game.positions);
    const mine = this.game.positions.get(this.game.playerId() ?? '');
    if (mine && s.phase === 'playing') this.world.placePlayer(mine);
    this.onPhase(s.phase);
    this.handleProgress(s);
  }

  private onPhase(phase: string) {
    if (phase === this.lastPhase || !this.world) return;
    const prev = this.lastPhase;
    this.lastPhase = phase;
    if (phase === 'intro') {
      this.world.setMode('intro');
      this.world.setIntroTime(this.introT());
      this.audio.setMusic('intro');
      this.introFinishSent = false;
    } else if (phase === 'playing') {
      this.world.setMode('play');
      if (prev === 'intro' || prev === null) {
        this.world.resetPlayer();
        const mine = this.game.positions.get(this.game.playerId() ?? '');
        if (mine && prev === null) this.world.placePlayer(mine);
      }
      this.audio.setMusic('explore');
      if (prev === 'intro') {
        this.toast('המסע התחיל! על שולחן העץ מונח מכתב מסתורי.', 'zone-unlocked');
        this.showHelp.set(true);
        setTimeout(() => this.showHelp.set(false), 18000);
      }
      this.canvas().nativeElement.focus();
    } else if (phase === 'completed') {
      this.panel.set(null);
      this.note.set(null);
      this.world.setMode('outro');
      this.audio.setMusic('victory');
      this.showResult.set(prev === null);
    } else if (phase === 'lobby') {
      this.showResult.set(false);
    }
  }

  async skipIntro() {
    const r = await this.game.finishIntro(true);
    if (!r.ok) this.toast(r.message, 'info');
  }

  /** System lines go to the chat log (spec §20) and, while the chat is closed, also appear as toasts. */
  private systemLine(text: string, kind: string) {
    const id = String(++this.toastId);
    this.system.update((l) => [...l.slice(-60), { id, text, at: this.game.serverNow() }]);
    if (!this.showChat()) {
      this.unread.update((u) => u + 1);
      this.toast(text, kind);
    }
  }

  private onNotice(n: GameNotice) {
    const mine = n.playerId === this.game.playerId();
    switch (n.kind) {
      case 'clue':
      case 'mechanism':
      case 'team-solved':
        this.audio.sfx(n.kind === 'clue' ? 'letter' : 'success');
        this.systemLine(n.message, n.kind);
        break;
      case 'zone-unlocked':
        this.audio.sfx('door');
        this.systemLine(n.message, n.kind);
        break;
      case 'score':
        if (n.playerId) this.addFloat(n.playerId, n.message);
        if (n.puzzleId) this.addPoints(n.puzzleId, n.points ?? 0);
        break;
      case 'score-group':
        this.toast(n.message, n.kind);
        break;
      case 'hint':
        this.audio.sfx('hint');
        this.systemLine(n.message, n.kind);
        break;
      case 'wrong-answer':
        this.audio.sfx('wrong');
        if (!mine) this.toast(n.message, n.kind);
        break;
      case 'item-picked':
      case 'item-placed':
      case 'item-collected':
        this.audio.sfx('pickup');
        this.toast(n.message, n.kind);
        break;
      case 'maze-symbol':
        this.audio.sfx('letter');
        this.toast(n.message, 'clue');
        break;
      case 'puzzle-solved':
      case 'game-completed':
      case 'game-started':
        break;
      case 'player-disconnected':
      case 'player-connected':
      case 'player-joined':
      case 'player-left':
        if (this.phase() === 'playing') this.toast(n.message, 'info');
        break;
      default:
        if (n.message) this.toast(n.message, n.kind);
    }
  }

  private addFloat(playerId: string, text: string) {
    const id = ++this.toastId;
    this.floats.update((f) => [...f, { id, playerId, text }]);
    setTimeout(() => this.floats.update((f) => f.filter((x) => x.id !== id)), 2700);
  }

  floatsFor(playerId: string) {
    return this.floats().filter((f) => f.playerId === playerId);
  }

  /** Personal points given for a puzzle (answer, mechanism, placements) — shown in its celebration (spec §9). */
  private addPoints(puzzleId: string, points: number) {
    this.pointsByPuzzle.set(puzzleId, (this.pointsByPuzzle.get(puzzleId) ?? 0) + points);
    const c = this.celebration();
    if (c?.puzzleId === puzzleId) this.celebration.set({ ...c, points: c.points + points });
  }

  /** Celebrations and the group's move to the next room, driven by the server state (once per puzzle and round). */
  private handleProgress(s: RoomSnapshot) {
    if (s.phase !== 'playing' && s.phase !== 'completed') {
      this.activeZoneApplied = null;
      this.clearProgressTimers();
      return;
    }
    const now = this.game.serverNow();
    for (const p of s.puzzles) {
      if (p.status !== 'solved') continue;
      const key = `${s.round}:${p.id}`;
      if (this.announced.has(key)) continue;
      this.announced.add(key);
      if (p.solvedAt && now - Date.parse(p.solvedAt) < 8000) this.celebrate(s, p.id);
    }
    if (s.phase !== 'playing' || !this.world || s.activeZone === this.activeZoneApplied) return;
    const first = this.activeZoneApplied === null;
    const target = s.activeZone as HZone;
    this.activeZoneApplied = target;
    this.clearProgressTimers();
    const moveAt = s.activeZoneSince ? Date.parse(s.activeZoneSince) + s.transitionDelayMs : 0;
    const wait = moveAt - now;
    if (first && (wait <= 0 || !s.activeZoneSince)) {
      if (this.world.localZone !== target) this.world.transferTo(target, this.mySlot(s));
      return;
    }
    if (wait > 1200) {
      this.panel.set(null);
      this.progressTimers.push(setTimeout(() => this.world?.playDoorCutscene(target), Math.max(0, wait - 3400)));
      this.progressTimers.push(setTimeout(() => this.moveGroup(target), wait));
    } else this.moveGroup(target);
  }

  private celebrate(s: RoomSnapshot, puzzleId: string) {
    const sc = this.game.scenario();
    const state = s.puzzles.find((p) => p.id === puzzleId);
    const content = sc?.puzzles.find((p) => p.id === puzzleId);
    if (!content) return;
    const nextPuzzle = sc!.puzzles.find((p) => p.requiresPuzzle === puzzleId);
    const next = nextPuzzle?.objective ?? (content.unlocksZone ? `עוברים יחד אל ${this.zoneName(content.unlocksZone)}` : undefined);
    const mechanism = ['slots', 'maze', 'mosaic'].includes(content.type);
    this.audio.sfx('success');
    this.celebration.set({
      name: this.game.playerName(state?.solvedBy) || 'הקבוצה',
      verb: mechanism ? 'הפעיל את המנגנון' : 'פתר את החידה',
      what: content.success,
      points: this.pointsByPuzzle.get(puzzleId) ?? 0,
      next,
      puzzleId,
    });
    setTimeout(() => this.celebration()?.puzzleId === puzzleId && this.celebration.set(null), 4200);
  }

  private moveGroup(zone: HZone) {
    this.panel.set(null);
    this.transfer.set(`עוברים אל ${this.zoneName(zone)}...`);
    setTimeout(() => {
      const s = this.game.snapshot();
      if (s && this.world) this.world.transferTo(zone, this.mySlot(s));
    }, 320);
    setTimeout(() => this.transfer.set(null), 1100);
  }

  private mySlot(s: RoomSnapshot) {
    return Math.max(0, [...s.players].sort((a, b) => a.seat - b.seat).findIndex((p) => p.id === this.game.playerId()));
  }

  private clearProgressTimers() {
    this.progressTimers.forEach(clearTimeout);
    this.progressTimers = [];
  }

  toast(text: string, kind = 'info') {
    const id = ++this.toastId;
    this.toasts.update((t) => [...t.slice(-3), { id, text, kind }]);
    setTimeout(() => this.toasts.update((t) => t.filter((x) => x.id !== id)), 5200);
  }

  async interact(def: HInteractable) {
    this.game.ping(def.id);
    switch (def.kind) {
      case 'item': {
        const r = await this.game.pickUp(def.itemId!);
        if (!r.ok) this.toast(r.message, 'info');
        return;
      }
      case 'clue': {
        const clue = this.game.scenario()?.clues?.find((c) => c.id === def.clueId);
        const r = await this.game.discoverClue(def.clueId!);
        if (def.panel) this.panel.set({ id: def.panel, ref: def.ref });
        else if (clue) {
          const by = this.game.snapshot()?.clues?.[clue.id];
          this.note.set({ title: clue.title, text: clue.text, by: r.ok && by ? `נמצא לראשונה על ידי ${this.game.playerName(by)}` : undefined });
        }
        return;
      }
      case 'decor':
        this.note.set({ title: def.label, text: def.text ?? '' });
        return;
      case 'panel':
        this.panel.set({ id: def.panel!, ref: def.ref });
        return;
    }
  }

  interactNearest() {
    if (!this.world?.interactNearest()) this.toast('אין כאן חפץ קרוב. התקרבו לחפץ בחדר.', 'info');
  }

  closePanel() {
    this.panel.set(null);
    this.canvas().nativeElement.focus();
  }

  /** The hint button opens the active puzzle of the room the player is in. */
  openHint() {
    const s = this.game.snapshot();
    const p = this.game.scenario()?.puzzles
      .filter((x) => x.zone === this.zone())
      .sort((a, b) => a.order - b.order)
      .find((x) => s?.puzzles.find((y) => y.id === x.id)?.status === 'active');
    if (p && PUZZLE_PANEL[p.id]) this.panel.set({ id: PUZZLE_PANEL[p.id] });
    else this.toast('אין בחדר הזה חידה פתוחה.', 'info');
  }

  inspectItem(id: string) {
    const item = this.game.scenario()?.items.find((i) => i.id === id);
    if (item) this.note.set({ title: `${this.emoji(id)} ${item.name}`, text: item.description });
  }

  emoji = (id: string) => ITEM_EMOJI[id] ?? '◆';
  zoneName(id: string) {
    return this.game.scenario()?.zones.find((z) => z.id === id)?.name ?? '';
  }
  zoneIndex(id: string) {
    return H_ZONES.indexOf(id as HZone) + 1;
  }
  itemName(id: string) {
    return this.game.scenario()?.items.find((i) => i.id === id)?.name ?? id;
  }

  confirmLeave() {
    if (confirm('לצאת מהמשחק? אפשר לחזור לאותו משחק מאותה לשונית.')) this.leave.emit();
  }

  ngOnDestroy() {
    clearInterval(this.ticker);
    this.clearProgressTimers();
    this.world?.dispose();
  }
}
