import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';

/**
 * Countdown to the campaign draw: days, hours, minutes and seconds in four gold-framed tiles. Read right to left they go
 * seconds, minutes, hours, days (days at the far left). The time left is always worked out from the fixed moment of the
 * draw (never by taking a second off each tick), corrected by the server's clock, so a refresh, a slow tab or a device
 * whose clock is wrong all show the same time left. At zero it stops and thanks the players; it never says the winners
 * were announced.
 */
@Component({
  selector: 'px-draw-countdown',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (target() !== null) {
      <div class="draw-timer" role="timer" aria-live="off">
        @if (left(); as l) {
          <p class="dt-title">
            <svg class="laurel" viewBox="0 0 24 40" aria-hidden="true" focusable="false"><path d="M18 38C8 32 5 20 10 4" /><g><ellipse cx="9" cy="30" rx="2.4" ry="4.6" transform="rotate(-40 9 30)" /><ellipse cx="7" cy="22" rx="2.4" ry="4.6" transform="rotate(-20 7 22)" /><ellipse cx="8" cy="14" rx="2.4" ry="4.6" transform="rotate(5 8 14)" /><ellipse cx="13" cy="33" rx="2.2" ry="4.2" transform="rotate(50 13 33)" /><ellipse cx="12" cy="25" rx="2.2" ry="4.2" transform="rotate(35 12 25)" /><ellipse cx="12.5" cy="17" rx="2.2" ry="4.2" transform="rotate(25 12.5 17)" /></g></svg>
            <span>ההגרלה הגדולה מתקרבת!</span>
            <svg class="laurel flip" viewBox="0 0 24 40" aria-hidden="true" focusable="false"><path d="M18 38C8 32 5 20 10 4" /><g><ellipse cx="9" cy="30" rx="2.4" ry="4.6" transform="rotate(-40 9 30)" /><ellipse cx="7" cy="22" rx="2.4" ry="4.6" transform="rotate(-20 7 22)" /><ellipse cx="8" cy="14" rx="2.4" ry="4.6" transform="rotate(5 8 14)" /><ellipse cx="13" cy="33" rx="2.2" ry="4.2" transform="rotate(50 13 33)" /><ellipse cx="12" cy="25" rx="2.2" ry="4.2" transform="rotate(35 12 25)" /><ellipse cx="12.5" cy="17" rx="2.2" ry="4.2" transform="rotate(25 12.5 17)" /></g></svg>
          </p>
          <!-- laid out left to right (days … seconds), so on the page seconds stand at the right and days at the left -->
          <div class="boxes" dir="ltr" [attr.aria-label]="'נותרו ' + l.days + ' ימים, ' + l.hours + ' שעות, ' + l.minutes + ' דקות ו־' + l.seconds + ' שניות'">
            <div class="box"><b>{{ l.days }}</b><span>ימים</span></div>
            <i class="sep" aria-hidden="true">:</i>
            <div class="box"><b>{{ pad(l.hours) }}</b><span>שעות</span></div>
            <i class="sep" aria-hidden="true">:</i>
            <div class="box"><b>{{ pad(l.minutes) }}</b><span>דקות</span></div>
            <i class="sep" aria-hidden="true">:</i>
            <div class="box"><b>{{ pad(l.seconds) }}</b><span>שניות</span></div>
          </div>
        } @else {
          <p class="dt-done" role="status">ההגרלה הגיעה! תודה שהשתתפתם ב-PORTAL X</p>
        }
      </div>
    }
  `,
  styles: [`
    :host { display:block; }
    .draw-timer { position:relative; margin-top:1.3rem; padding:1.55rem clamp(.6rem, 2vw, 1.4rem) clamp(.8rem, 2vw, 1.2rem); border-radius:20px; text-align:center;
      background: radial-gradient(circle at 50% 0%, rgba(244,190,90,.14), transparent 65%), linear-gradient(180deg, rgba(16,26,62,.92), rgba(8,14,38,.95));
      border:1.5px solid rgba(240,200,110,.75); box-shadow: 0 0 18px rgba(240,200,110,.22), inset 0 0 22px rgba(240,200,110,.07), 0 12px 28px rgba(0,0,0,.35); }
    .dt-title { position:absolute; top:0; left:50%; transform:translate(-50%, -55%); margin:0; display:flex; align-items:center; gap:.35rem; white-space:nowrap; }
    .dt-title span { padding:.38rem 1.3rem; border-radius:999px; font-family: var(--font-title); font-weight:900; color:#14193a; font-size:clamp(1rem, 2vw, 1.35rem);
      background: linear-gradient(180deg, #fff0bd, #f3c75e 55%, #d8a03c); box-shadow: 0 0 18px rgba(240,200,110,.45), inset 0 1px 0 rgba(255,255,255,.7); }
    .laurel { width:clamp(14px, 2vw, 20px); height:auto; flex-shrink:0; }
    .laurel path { fill:none; stroke:#e9b955; stroke-width:1.6; stroke-linecap:round; } .laurel g { fill:#e9b955; }
    .laurel.flip { transform: scaleX(-1); }
    .boxes { display:flex; align-items:center; justify-content:center; gap:clamp(.2rem, 1.2vw, .7rem); margin:0 auto; max-width:540px; }
    .box { flex:1 1 0; min-width:0; max-width:120px; display:flex; flex-direction:column; align-items:center; gap:.2rem; padding:clamp(.5rem, 1.6vw, .8rem) .15rem clamp(.45rem, 1.2vw, .65rem);
      border-radius:14px; background: linear-gradient(180deg, #172554, #0a1330); border:1.5px solid rgba(240,200,110,.8);
      box-shadow: 0 0 14px rgba(240,200,110,.22), inset 0 -8px 14px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,230,160,.25); }
    .box b { font-family: var(--font-title); font-weight:900; font-size:clamp(1.65rem, 6.2vw, 3rem); line-height:1; font-variant-numeric: tabular-nums;
      background: linear-gradient(180deg, #fff3c8, #f5c95e 55%, #c98f30); -webkit-background-clip:text; background-clip:text; color:transparent;
      filter: drop-shadow(0 0 6px rgba(255,205,110,.45)); }
    .box span { direction:rtl; font-size:clamp(.74rem, 1.6vw, .95rem); color:#f1e6cf; }
    .sep { font-style:normal; font-family: var(--font-title); font-weight:900; font-size:clamp(1.1rem, 3vw, 1.8rem); color:#e9b955; line-height:1; padding-bottom:1.1em; flex:0 0 auto; }
    .dt-done { margin:0; color:#ffe39a; font-weight:800; font-size:clamp(1.05rem, 2vw, 1.3rem); text-shadow: 0 0 12px rgba(255,215,122,.4); }
    @media (max-width: 360px) { .sep { display:none; } .dt-title span { padding-inline:.9rem; } }
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
