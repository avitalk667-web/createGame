import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input } from '@angular/core';
import { ChallengeService, progressText } from './challenge.service';

/**
 * The player's way to the challenge's minimum, under the score board. Encouragement only: the server decides who is
 * eligible from its own records when the game ends. Small, never covers the game, hidden when the campaign is off.
 */
@Component({
  selector: 'px-coupon-progress',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shown(); as c) {
      <div class="cp" [class.done]="reached()" role="status" aria-live="polite">
        <div class="bar" aria-hidden="true"><i [style.width.%]="percent()"></i></div>
        <p>{{ text() }}</p>
      </div>
    }
  `,
  styles: [`
    .cp { margin-top:.45rem; padding-top:.45rem; border-top:1px solid var(--line); }
    .bar { height:6px; border-radius:999px; background: rgba(255,255,255,.12); overflow:hidden; }
    .bar i { display:block; height:100%; border-radius:inherit; background: linear-gradient(90deg, var(--gold), var(--gold-2)); transition: width .5s ease; }
    @media (prefers-reduced-motion: reduce) { .bar i { transition:none; } }
    p { margin:.3rem 0 0; font-size:.8rem; line-height:1.45; color:#dfe5f7; }
    .done p { color: var(--gold-2); font-weight:700; }
  `],
})
export class CouponProgressComponent implements OnInit {
  /** The player's own points as the game shows them. */
  score = input.required<number>();
  private svc = inject(ChallengeService);

  shown = computed(() => {
    const c = this.svc.campaign();
    return c?.active && c.showProgress && c.minimumScore ? c : null;
  });
  reached = computed(() => this.score() >= (this.shown()?.minimumScore ?? Infinity));
  percent = computed(() => Math.min(100, Math.round((100 * this.score()) / (this.shown()?.minimumScore ?? 1))));
  text = computed(() => progressText(this.score(), this.shown()?.minimumScore ?? 0, this.shown()?.discountPercent ?? 0));

  ngOnInit() { void this.svc.load(); }
}
