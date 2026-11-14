import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { ChallengeService } from './challenge.service';

/**
 * "You have a new challenge!" — shown once when entering the free game (once per game in this tab: sessionStorage keeps
 * it through refreshes), only while the campaign is on and its entry popup is enabled. Loads in the background and never
 * blocks the game. No seasonal design.
 */
@Component({
  selector: 'px-coupon-entry-popup',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open() && svc.campaign(); as c) {
      <div class="veil" (click)="close()"></div>
      <section class="pop" role="dialog" aria-modal="true" aria-labelledby="ch-title" aria-describedby="ch-body">
        <button class="x" type="button" (click)="close()" aria-label="סגירה">✕</button>
        <span class="mark" aria-hidden="true">PORTAL X</span>
        <h2 id="ch-title">יש לכם אתגר חדש!</h2>
        <div class="figures" aria-hidden="true">
          <div class="fig"><b>{{ c.scoreAbove }}+</b><span>נקודות</span></div>
          <span class="arrow">←</span>
          <div class="fig gold"><b>{{ c.discountPercent }}%</b><span>הנחה</span></div>
        </div>
        <p id="ch-body">
          הצליחו לצבור <strong>יותר מ-{{ c.scoreAbove }} נקודות</strong> במשחק וקבלו קופון אישי של
          <strong>{{ c.discountPercent }}% הנחה</strong> לרכישת אחד ממשחקי PORTAL X!
        </p>
        <p class="note">ההטבה מוגבלת בזמן ובכמות.</p>
        <button class="btn primary big" type="button" (click)="close()">יוצאים לאתגר!</button>
      </section>
    }
  `,
  styles: [`
    .veil { position:fixed; inset:0; z-index:300; background: rgba(3,5,12,.62); }
    .pop { position:fixed; z-index:301; left:50%; top:50%; transform:translate(-50%, -50%); width:min(440px, calc(100% - 32px)); max-height:calc(100dvh - 32px);
      overflow:auto; box-sizing:border-box; text-align:center; background: radial-gradient(24rem 9rem at 50% 0%, rgba(224,185,92,.18), transparent 70%), #0a1230;
      border:2px solid var(--gold); border-radius:18px; padding:1.3rem 1.1rem 1.2rem; box-shadow: 0 0 40px rgba(224,185,92,.28); animation: in .3s ease both; }
    @keyframes in { from { opacity:0; transform:translate(-50%, -46%); } }
    @media (prefers-reduced-motion: reduce) { .pop { animation:none; } }
    .x { position:absolute; top:.45rem; inset-inline-end:.45rem; background:none; border:none; color: var(--muted); font-size:1.1rem; cursor:pointer; padding:.5rem; min-width:44px; min-height:44px; }
    .mark { display:block; direction:ltr; letter-spacing:.3em; font-size:.72rem; color: var(--gold); font-weight:700; }
    h2 { margin:.35rem 0 .7rem; font-family: var(--font-title); color:#fff; font-size:1.55rem; line-height:1.3; }
    .figures { display:flex; align-items:center; justify-content:center; gap:.8rem; margin:.2rem 0 .6rem; }
    .fig { display:flex; flex-direction:column; align-items:center; min-width:6.5rem; padding:.5rem .8rem; border-radius:14px; border:1px solid var(--line); background: rgba(255,255,255,.04); }
    .fig b { font-size:2.2rem; line-height:1.1; color:#fff; direction:ltr; } .fig span { color: var(--muted); font-size:.9rem; }
    .fig.gold { border-color: var(--gold); background: rgba(224,185,92,.1); } .fig.gold b { color: var(--gold-2); }
    .arrow { color: var(--gold); font-size:1.4rem; }
    p { margin:.4rem 0; line-height:1.7; color:#e8ecfb; } strong { color: var(--gold-2); }
    .note { color:#c9d2ee; font-size:.9rem; }
    .big { margin-top:.7rem; min-width:12rem; }
  `],
})
export class CouponEntryPopupComponent implements OnInit {
  /** The game's code: the popup is shown once per game in this tab. */
  code = input.required<string>();
  svc = inject(ChallengeService);
  open = signal(false);

  private get key() { return 'px_challenge_seen_' + this.code(); }

  async ngOnInit() {
    try { if (sessionStorage.getItem(this.key)) return; } catch { /* no storage: show it */ }
    const c = await this.svc.load();
    if (c.active && c.showEntryPopup) this.open.set(true);
  }

  close() {
    this.open.set(false);
    try { sessionStorage.setItem(this.key, '1'); } catch { /* nothing to remember */ }
  }
}
