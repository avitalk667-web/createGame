import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { AudioService } from '../core/audio.service';
import { GameService } from '../core/game.service';

/**
 * The slow, synchronised parts of moving between rooms (spec 2 / 9), shared by both games:
 *  - "The next room opened" stays on screen until the group presses Continue (the host at once; anyone when the
 *    host is away or after a while). The server decides when the group moves, so everyone moves together.
 *  - When the group enters a room — and for anyone who joins late or reconnects — the room's name, story and
 *    first task appear and stay until the player closes them.
 */
@Component({
  selector: 'px-room-overlays',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (pending(); as p) {
      <div class="veil" role="dialog" aria-modal="true" aria-labelledby="next-title">
        <section class="sheet">
          <span class="kicker">הדלת נפתחה</span>
          <h2 id="next-title">החדר הבא נפתח!</h2>
          <p class="name">{{ p.name }}</p>
          @if (p.byName) { <p class="line l1">{{ p.byName }} {{ p.verb }} את „{{ p.title }}”.</p> }
          @if (p.success) { <p class="line l2">{{ p.success }}</p> }
          <div class="actions line l3">
            @if (canContinue()) {
              <button class="btn primary big" (click)="go()" [disabled]="busy()">המשך לחדר הבא ‹</button>
            } @else {
              <span class="wait">ממתינים ש{{ game.hostName() || 'המארח' }} ימשיך — קראו בינתיים את ההודעה.</span>
              <small class="muted">אפשר יהיה להמשיך בעצמכם בעוד {{ secondsLeft() }} שניות.</small>
            }
            @if (error()) { <small class="err">{{ error() }}</small> }
          </div>
        </section>
      </div>
    } @else if (intro(); as r) {
      <div class="veil soft" role="dialog" aria-modal="true" aria-labelledby="room-title">
        <section class="sheet">
          <span class="kicker">{{ r.number }}</span>
          <h2 id="room-title">{{ r.name }}</h2>
          @if (r.story) { <p class="line l1 story">{{ r.story }}</p> }
          @if (r.task) { <p class="line l2 task"><b>המשימה הראשונה:</b> {{ r.task }}</p> }
          <div class="actions line l3"><button class="btn primary big" (click)="closeIntro()">התחלה</button></div>
        </section>
      </div>
    }
  `,
  styles: [`
    .veil { position:fixed; inset:0; z-index:66; display:grid; place-items:center; padding:16px;
      background: radial-gradient(circle at 50% 35%, rgba(20,30,70,.72), rgba(3,5,12,.9)); animation: fade .9s ease both; }
    .veil.soft { background: radial-gradient(circle at 50% 35%, rgba(20,30,70,.55), rgba(3,5,12,.82)); }
    .sheet { width:min(620px, 100%); text-align:center; background: linear-gradient(180deg, rgba(40,30,8,.94), rgba(14,20,44,.96));
      border:2px solid var(--gold-2); border-radius:20px; padding:1.4rem 1.6rem 1.6rem; box-shadow: 0 0 60px rgba(224,185,92,.35); max-height: calc(100dvh - 32px); overflow:auto; }
    .kicker { color: var(--blue); font-weight:700; letter-spacing:.03em; }
    h2 { font-family: var(--font-title); font-size: clamp(1.8rem, 5vw, 2.6rem); color: var(--gold-2); margin:.2rem 0; }
    .name { font-family: var(--font-title); font-size:1.5rem; margin:0 0 .6rem; }
    .line { opacity:0; animation: rise 1.2s ease forwards; line-height:1.8; font-size:1.12rem; }
    .l1 { animation-delay: .8s; } .l2 { animation-delay: 2.4s; } .l3 { animation-delay: 3.6s; }
    .story { color:#efe6cf; } .task { background: rgba(255,255,255,.06); border-radius:12px; padding:.5rem .8rem; }
    .actions { display:flex; flex-direction:column; align-items:center; gap:.4rem; margin-top:.8rem; }
    .big { font-size:1.15rem; padding:.8em 2em; }
    .wait { color: var(--gold-2); } .err { color:#ffb4a3; }
    @keyframes fade { from { opacity:0 } }
    @keyframes rise { from { opacity:0; transform: translateY(8px) } to { opacity:1; transform:none } }
    @media (prefers-reduced-motion: reduce) { .line { animation: none; opacity:1; } .veil { animation:none; } }
  `],
})
export class RoomOverlaysComponent implements OnDestroy {
  game = inject(GameService);
  private audio = inject(AudioService);
  /** Seconds after the room opened before the card appears, so the door (and the mechanism) can be watched first. */
  holdSeconds = input(0);
  busy = signal(false);
  error = signal<string | null>(null);
  private tick = signal(0);
  private ticker = setInterval(() => this.tick.update((t) => t + 1), 1000);
  private introFor = signal<string | null>(null);
  private shownIntro = new Set<string>();

  private zone(id: string | null | undefined) {
    const sc = this.game.scenario();
    return sc?.zones.find((z) => z.id === id);
  }

  pending = computed(() => {
    const s = this.game.snapshot();
    const sc = this.game.scenario();
    this.tick();
    if (!s || !sc || s.phase !== 'playing' || !s.pendingZone) return null;
    if (s.pendingSince && this.game.serverNow() - Date.parse(s.pendingSince) < this.holdSeconds() * 1000) return null;
    const z = this.zone(s.pendingZone);
    // the puzzle whose solution opened this room
    const opener = sc.puzzles.find((p) => p.unlocksZone === s.pendingZone);
    const state = s.puzzles.find((p) => p.id === opener?.id);
    const mechanism = ['slots', 'maze', 'mosaic', 'items'].includes(opener?.type ?? '');
    return {
      name: z?.name ?? '',
      title: opener?.title ?? '',
      success: opener?.success ?? '',
      byName: this.game.playerName(state?.solvedBy),
      verb: mechanism ? 'הפעיל את המנגנון' : 'פתר',
    };
  });

  /** The host may always continue; anyone may when the host is away or after the fallback time. */
  canContinue = computed(() => {
    this.tick();
    const s = this.game.snapshot();
    if (!s?.pendingZone) return false;
    return this.game.isHost() || this.game.hostAway() || this.secondsLeft() <= 0;
  });

  secondsLeft = computed(() => {
    this.tick();
    const s = this.game.snapshot();
    if (!s?.pendingSince) return 0;
    const end = Date.parse(s.pendingSince) + (s.continueFallbackSeconds ?? 90) * 1000;
    return Math.max(0, Math.ceil((end - this.game.serverNow()) / 1000));
  });

  intro = computed(() => {
    const id = this.introFor();
    const s = this.game.snapshot();
    const sc = this.game.scenario();
    if (!id || !s || !sc || s.phase !== 'playing') return null;
    const z = this.zone(id);
    if (!z) return null;
    const zones = [...sc.zones].sort((a, b) => a.order - b.order);
    const first = sc.puzzles
      .filter((p) => p.zone === id)
      .sort((a, b) => a.order - b.order)
      .find((p) => s.puzzles.find((x) => x.id === p.id)?.status !== 'solved');
    return {
      number: `חדר ${zones.findIndex((x) => x.id === id) + 1} מתוך ${zones.length}`,
      name: z.name,
      story: z.story ?? '',
      task: first?.objective ?? '',
    };
  });

  constructor() {
    // show the room's introduction once per room and round — when the group enters it, or on arrival (late join / reconnect)
    effect(() => {
      const s = this.game.snapshot();
      const sc = this.game.scenario();
      if (!s || !sc || s.phase !== 'playing') return;
      const key = `${s.round}:${s.activeZone}`;
      untracked(() => {
        if (this.shownIntro.has(key)) return;
        this.shownIntro.add(key);
        this.introFor.set(s.activeZone);
      });
    });
  }

  async go() {
    this.busy.set(true);
    this.error.set(null);
    this.audio.sfx('door');
    try {
      const r = await this.game.continueToNext();
      if (!r.ok) this.error.set(r.message);
    } finally {
      this.busy.set(false);
    }
  }

  closeIntro() {
    this.audio.sfx('click');
    this.introFor.set(null);
  }

  ngOnDestroy() {
    clearInterval(this.ticker);
  }
}
