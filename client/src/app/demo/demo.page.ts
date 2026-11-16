import { ChangeDetectionStrategy, Component, ElementRef, NgZone, OnDestroy, computed, inject, isDevMode, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AudioService } from '../core/audio.service';
import { SettingsService } from '../core/settings.service';
import { JoystickComponent } from '../ui/joystick.component';
import { DEMO_ITEMS, DEMO_SPOTS, DemoSpot, DemoSpotId } from './demo-content';
import { DemoInspectComponent } from './demo-inspect.component';
import { DemoWorld } from './demo-world';

type Phase = 'gate' | 'loading' | 'play' | 'error';
type ItemId = (typeof DEMO_ITEMS)[number];

/**
 * "טעימה מהפורטל" — the free taste (route /demo): a short opening screen, the locked room in 3D, and (in later stages)
 * the keypad, the success moment and the games. No sign-up, no payment, no server game room.
 */
@Component({
  selector: 'px-demo-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, JoystickComponent, DemoInspectComponent],
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
            <button class="btn primary enter" (click)="enter()">כניסה לחדר</button>
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

        @if (focus(); as f) { @if (!inspecting() && !doorNote()) {
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

        @if (touch && playing() && !inspecting() && !doorNote()) {
          <px-joystick class="joy" (changed)="world?.setJoystick($event.x, $event.y)" />
          <button class="btn primary act" [disabled]="!focus()" (click)="world?.interactNearest()" [attr.aria-label]="focus() ? focus()!.verb + ' ' + focus()!.label : 'אין חפץ קרוב'">
            {{ focus() ? '🔍 ' + focus()!.button : '🔍' }}
          </button>
        }

        @if (inspecting(); as id) { <px-demo-inspect [item]="id" (closed)="closeInspect()" /> }

        @if (doorNote()) {
          <div class="overlay" (click)="doorNote.set(false)">
            <section class="panel-modal note" role="dialog" aria-modal="true" aria-label="הדלת הנעולה" (click)="$event.stopPropagation()">
              <h2 class="gold-title">הדלת הנעולה</h2>
              <p>הדלת הכבדה נעולה במנעול של ארבע ספרות. רק מי שמפענח את סוד החדר יוכל לפתוח אותה.</p>
              <button class="btn primary" (click)="doorNote.set(false)">חזרה לחקירה</button>
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
    .skip { position:fixed; bottom: calc(max(14px, env(safe-area-inset-bottom)) + 20px); left:50%; transform:translateX(-50%); z-index:11; }

    @media (pointer: coarse) {
      .prompt { bottom: calc(max(14px, env(safe-area-inset-bottom)) + 120px); }
    }
    @media (max-width: 520px) {
      .title b { display:none; }
      .mission { top: calc(max(10px, env(safe-area-inset-top)) + 58px); font-size:.92rem; }
    }
  `],
})
export class DemoPage implements OnDestroy {
  private zone = inject(NgZone);
  private audio = inject(AudioService);
  private settings = inject(SettingsService);
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
  doorNote = signal(false);
  showHelp = signal(false);
  toast = signal<string | null>(null);
  private toastTimer?: ReturnType<typeof setTimeout>;

  label(id: DemoSpotId) {
    return DEMO_SPOTS.find((s) => s.id === id)?.label ?? '';
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
    try {
      const world = this.zone.runOutsideAngular(() => new DemoWorld(this.canvas().nativeElement, this.settings.settings().quality, {
        onFocus: (s) => this.zone.run(() => this.focus.set(s)),
        onInteract: (s) => this.zone.run(() => this.interact(s)),
        onTooFar: (s) => this.zone.run(() => this.say(`התקרבו אל ${s.label} כדי לבדוק אותו.`)),
        onIntroDone: () => this.zone.run(() => {
          this.playing.set(true);
          setTimeout(() => this.introDone.set(true), 5000);
        }),
      }));
      this.world = world;
      // development builds only: the room is reachable from the console for visual checks
      if (isDevMode()) (window as unknown as { pxDemo?: DemoWorld }).pxDemo = world;
      world.sensitivity = this.settings.settings().lookSensitivity ?? 1;
      await this.zone.runOutsideAngular(() => world.load((p) => this.zone.run(() => this.progress.set(p))));
      if (this.world !== world) return;
      world.setInspected(this.inspected());
      world.setMode('intro');
      this.zone.runOutsideAngular(() => world.start());
      this.phase.set('play');
    } catch {
      this.phase.set('error');
    }
  }

  private interact(s: DemoSpot) {
    if (s.id === 'door') {
      this.audio.sfx('metal');
      this.doorNote.set(true);
      return;
    }
    this.open(s.id);
  }

  open(id: ItemId) {
    this.audio.sfx(id === 'letter' ? 'paper' : id === 'clock' ? 'mechanism' : 'metal');
    this.world?.clearInput();
    this.inspecting.set(id);
    if (!this.inspected().has(id)) {
      const next = new Set(this.inspected());
      next.add(id);
      this.inspected.set(next);
      this.world?.setInspected(next);
    }
  }

  closeInspect() {
    this.inspecting.set(null);
    if (this.inspected().size === DEMO_ITEMS.length) this.say('בדקתם את כל ארבעת הסימנים. עכשיו גשו ללוח המקשים שליד הדלת.');
  }

  private say(text: string) {
    this.toast.set(text);
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(null), 3200);
  }

  ngOnDestroy() {
    clearTimeout(this.toastTimer);
    this.world?.dispose();
    this.world = undefined;
  }
}
