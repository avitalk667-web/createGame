import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';

/**
 * Countdown to the campaign draw: days, hours, minutes and seconds in four boxes. The time left is always worked out
 * from the fixed moment of the draw (never by taking a second off each tick), corrected by the server's clock, so a
 * refresh, a slow tab or a device whose clock is wrong all show the same time left. At zero it stops and thanks the
 * players; it never says the winners were announced.
 */
@Component({
  selector: 'px-draw-countdown',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (target() !== null) {
      <div class="draw-timer" role="timer" aria-live="off">
        @if (left(); as l) {
          <p class="dt-title">ההגרלה הגדולה מתקרבת!</p>
          <div class="boxes" [attr.aria-label]="'נותרו ' + l.days + ' ימים, ' + l.hours + ' שעות, ' + l.minutes + ' דקות ו־' + l.seconds + ' שניות'">
            <div class="box"><b dir="ltr">{{ l.days }}</b><span>ימים</span></div>
            <div class="box"><b dir="ltr">{{ pad(l.hours) }}</b><span>שעות</span></div>
            <div class="box"><b dir="ltr">{{ pad(l.minutes) }}</b><span>דקות</span></div>
            <div class="box"><b dir="ltr">{{ pad(l.seconds) }}</b><span>שניות</span></div>
          </div>
        } @else {
          <p class="dt-done" role="status">ההגרלה הגיעה! תודה שהשתתפתם ב-PORTAL X</p>
        }
      </div>
    }
  `,
  styles: [`
    :host { display:block; }
    .draw-timer { margin-top:.8rem; padding:.7rem .7rem .8rem; border-radius:16px; text-align:center;
      background: radial-gradient(circle at 50% 0%, rgba(224,185,92,.16), transparent 70%), linear-gradient(180deg, #101a3a, #0a1128);
      border:1px solid rgba(224,185,92,.45); box-shadow: inset 0 1px 0 rgba(255,227,154,.15), 0 8px 26px rgba(0,0,0,.35); }
    .dt-title { margin:0 0 .55rem !important; font-family: var(--font-title); color: var(--gold-2) !important; font-size:clamp(1.05rem, 2vw, 1.3rem); font-weight:700;
      text-shadow: 0 0 14px rgba(255,215,122,.35); }
    .boxes { display:grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap:clamp(.35rem, 1.5vw, .7rem); max-width:420px; margin:0 auto; }
    .box { display:flex; flex-direction:column; align-items:center; gap:.15rem; padding:.55rem .2rem .45rem; border-radius:12px; min-width:0;
      background: linear-gradient(180deg, #16234d, #0b1430); border:1px solid rgba(224,185,92,.6);
      box-shadow: 0 0 12px rgba(224,185,92,.18), inset 0 -6px 12px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,227,154,.2); }
    .box b { font-family: var(--font-title); font-size:clamp(1.5rem, 6vw, 2.3rem); line-height:1; color:#ffe39a; font-variant-numeric: tabular-nums;
      text-shadow: 0 0 10px rgba(255,215,122,.55), 0 0 22px rgba(255,190,80,.25); }
    .box span { font-size:.78rem; color:#c9d2ee !important; }
    .dt-done { margin:.2rem 0 0 !important; color:#ffe39a !important; font-weight:700; font-size:1.05rem; text-shadow: 0 0 12px rgba(255,215,122,.4); }
    @media (prefers-reduced-motion: no-preference) { .box b { transition: color .3s; } }
  `],
})
export class DrawCountdownComponent {
  /** The moment of the draw (ISO with offset, from the server's campaign settings). */
  drawAt = input<string | null | undefined>(null);
  /** The server's time when the settings were read: the device clock is corrected by it. */
  serverNow = input<string | null | undefined>(null);

  private readonly loadedAt = Date.now();
  private now = signal(this.loadedAt);
  private readonly offset = computed(() => {
    const s = Date.parse(this.serverNow() ?? '');
    return Number.isFinite(s) ? s - this.loadedAt : 0;
  });

  target = computed(() => {
    const t = Date.parse(this.drawAt() ?? '');
    return Number.isFinite(t) ? t : null;
  });

  left = computed(() => {
    const t = this.target();
    if (t === null) return null;
    const ms = t - (this.now() + this.offset());
    if (ms <= 0) return null;
    const s = Math.floor(ms / 1000);
    return { days: Math.floor(s / 86400), hours: Math.floor(s / 3600) % 24, minutes: Math.floor(s / 60) % 60, seconds: s % 60 };
  });

  constructor() {
    let timer: ReturnType<typeof setTimeout>;
    // wake just after each new second, so the seconds change together with the real clock
    const tick = () => {
      this.now.set(Date.now());
      if (this.target() !== null && this.left() === null) return;   // reached zero: stop
      timer = setTimeout(tick, 1000 - (Date.now() % 1000) + 15);
    };
    tick();
    inject(DestroyRef).onDestroy(() => clearTimeout(timer));
  }

  pad(n: number) {
    return String(n).padStart(2, '0');
  }
}
