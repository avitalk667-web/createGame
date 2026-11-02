import { ChangeDetectionStrategy, Component, HostListener, OnDestroy, booleanAttribute, computed, inject, input, output, signal } from '@angular/core';
import { AudioService } from '../core/audio.service';
import { GameService } from '../core/game.service';

const PUZZLE = 'h3-maze';
/** A long press repeats a step this often (the server allows a few actions a second per player). */
const REPEAT_MS = 320;
/** How long a press must last before it starts repeating. */
const HOLD_MS = 380;
const KEY_DIRS: Record<string, string> = { ArrowUp: 'N', ArrowDown: 'S', ArrowLeft: 'W', ArrowRight: 'E' };

/**
 * The magnetic maze's control pad (spec room 3): a short press moves the key one cell, a long press keeps moving it one
 * cell at a time until released. Every step waits for the server's answer before the next one, so nothing jumps or piles
 * up. One player holds the magnet at a time — the server decides; the pad shows who is moving the key and steps aside
 * while someone else does. Works with touch, mouse and the arrow keys; no drag and no hover needed.
 */
@Component({
  selector: 'px-maze-pad',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="who" role="status" aria-live="polite">
      @if (holder(); as h) { <span [class.mine]="h.mine">🧲 {{ h.mine ? 'אתם מזיזים את המפתח' : h.name + ' מזיז כרגע את המפתח' }}</span> }
      @else { <span class="free">🧲 המפתח פנוי — כל אחד יכול להזיז אותו</span> }
    </div>
    <div class="pad" dir="ltr" [class.shake]="shake()" [class.locked]="lockedOut()">
      <span></span>
      <button type="button" class="arrow" aria-label="למעלה" (pointerdown)="press($event, 'N')" (pointerup)="onUp()" (lostpointercapture)="onUp()">▲</button>
      <span></span>
      <button type="button" class="arrow" aria-label="שמאלה" (pointerdown)="press($event, 'W')" (pointerup)="onUp()" (lostpointercapture)="onUp()">◀</button>
      <span class="mid" aria-hidden="true">🧲</span>
      <button type="button" class="arrow" aria-label="ימינה" (pointerdown)="press($event, 'E')" (pointerup)="onUp()" (lostpointercapture)="onUp()">▶</button>
      <span></span>
      <button type="button" class="arrow" aria-label="למטה" (pointerdown)="press($event, 'S')" (pointerup)="onUp()" (lostpointercapture)="onUp()">▼</button>
      <span></span>
    </div>
    @if (msg(); as m) { <p class="msg" role="status">{{ m }}</p> }
    @if (!compact()) { <p class="muted small tip">לחיצה קצרה — צעד אחד. לחיצה ארוכה — תנועה רציפה עד שמרפים. אפשר גם עם מקשי החיצים.</p> }
  `,
  styles: [`
    :host { display:block; user-select:none; -webkit-user-select:none; }
    .who { font-size:.9rem; margin:.2rem 0 .4rem; } .who .mine { color:#9be3b4; font-weight:700; } .who .free { color: var(--muted); }
    .who span:not(.mine):not(.free) { color:#ffd59a; font-weight:700; }
    /* big enough for a thumb, small enough that the whole pad fits beside the maze on a phone, upright or sideways */
    .pad { display:grid; grid-template-columns: repeat(3, max(42px, min(72px, 15vw, 8dvh))); gap:6px; justify-content:center; touch-action:none; }
    .arrow { aspect-ratio:1; font-size:1.6rem; border-radius:14px; border:1px solid var(--gold); background: rgba(224,185,92,.14); color: var(--gold-2);
      cursor:pointer; touch-action:none; -webkit-tap-highlight-color: transparent; }
    .arrow:active { background: rgba(224,185,92,.35); transform: scale(.96); }
    .mid { display:grid; place-items:center; font-size:1.6rem; }
    .pad.locked .arrow { opacity:.45; }
    .pad.shake { animation: shake .35s ease; }
    @keyframes shake { 0%,100% { transform:none } 25% { transform: translateX(-6px) } 75% { transform: translateX(6px) } }
    .msg { color:#ffb4a3; margin:.4rem 0 0; text-align:center; font-weight:700; }
    .tip { text-align:center; margin:.4rem 0 0; }
    :host([compact]) .who { font-size:.78rem; margin:0 0 .3rem; max-width:13rem; text-align:center; margin-inline:auto; }
  `],
})
export class MazePadComponent implements OnDestroy {
  private game = inject(GameService);
  private audio = inject(AudioService);
  /** The small floating dock beside the maze: no tip line, a shorter status. */
  compact = input(false, { transform: booleanAttribute });
  /** The key hit a wall or a closed gate (the room shakes the key). */
  blocked = output<string>();
  msg = signal<string | null>(null);
  shake = signal(false);

  private dir: string | null = null;
  private busy = false;
  /** A step was sent since the last release. */
  private needsRelease = false;
  private holdTimer?: ReturnType<typeof setTimeout>;
  private repeatTimer?: ReturnType<typeof setTimeout>;
  private tick = signal(0);
  private clock = setInterval(() => this.tick.update((n) => n + 1), 300);

  /** Who holds the magnet now (the server's controller, while the hold lasts). */
  holder = computed(() => {
    this.tick();
    const m = this.game.snapshot()?.mechanisms?.[PUZZLE];
    if (!m?.controller || !m.controlUntil || Date.parse(m.controlUntil) <= this.game.serverNow()) return null;
    const mine = m.controller === this.game.playerId();
    return { mine, name: this.game.playerName(m.controller) };
  });
  lockedOut = computed(() => !!this.holder() && !this.holder()!.mine);

  press(e: PointerEvent, dir: string) {
    e.preventDefault();
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch { /* not a live pointer (e.g. a synthetic event): the window still reports the release */ }
    this.start(dir);
  }

  // the buttons report their own release too: some panels keep pointer events from reaching the window
  @HostListener('window:pointerup')
  @HostListener('window:pointercancel')
  onUp() {
    this.stop();
  }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(e: KeyboardEvent) {
    const dir = KEY_DIRS[e.key];
    if (!dir || (e.target as HTMLElement)?.closest?.('input, textarea')) return;
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat) this.start(dir);
  }

  @HostListener('window:keyup', ['$event'])
  onKeyUp(e: KeyboardEvent) {
    if (KEY_DIRS[e.key] === this.dir) this.stop();
  }

  private start(dir: string) {
    this.stopTimers();
    this.dir = dir;
    void this.step();
    this.holdTimer = setTimeout(() => this.repeat(), HOLD_MS);
  }

  private repeat() {
    if (!this.dir) return;
    void this.step();
    this.repeatTimer = setTimeout(() => this.repeat(), REPEAT_MS);
  }

  private stop() {
    this.dir = null;
    this.stopTimers();
    // letting go hands the magnet to the others at once — one release per press, sent right after its last step (the
    // server handles a player's commands in order); the button, its capture and the window may all report the release
    if (!this.needsRelease) return;
    this.needsRelease = false;
    void this.game.operate(PUZZLE, { op: 'release' });
  }

  private stopTimers() {
    clearTimeout(this.holdTimer);
    clearTimeout(this.repeatTimer);
  }

  /** One step; the next waits for this one's answer, so the key never moves twice at once. */
  private async step() {
    if (this.busy || !this.dir) return;
    this.busy = true;
    try {
      this.needsRelease = true;
      const r = await this.game.operate(PUZZLE, { op: 'move', dir: this.dir });
      if (r.ok) {
        this.msg.set(null);
        return;
      }
      this.msg.set(r.message);
      if (r.code === 'blocked') {
        this.shake.set(true);
        setTimeout(() => this.shake.set(false), 360);
        navigator.vibrate?.(60);
        this.blocked.emit(r.message);
        this.dir = null;          // a wall ends a long press: no grinding against it
        this.stopTimers();
      } else if (r.code === 'maze-busy') {
        this.dir = null;
        this.stopTimers();
      } else if (r.code !== 'too-fast') this.audio.sfx('wrong');
    } finally {
      this.busy = false;
    }
  }

  ngOnDestroy() {
    this.stop();
    clearInterval(this.clock);
  }
}
