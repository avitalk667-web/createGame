import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ChallengeCoupon, pendingCoupon } from './challenge.service';

/** "Your coupon is ready!": the code, its expiry (prominent, Israel time), copy, the games, and the email's status. */
@Component({
  selector: 'px-coupon-result',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let c = coupon();
    <div class="res">
      @switch (c.status) {
        @case ('redeemed') { <p class="state">הקופון הזה כבר מומש. תודה ובהנאה!</p> }
        @case ('expired') { <p class="state bad">תוקף הקופון הסתיים.</p> }
        @case ('cancelled') { <p class="state bad">הקופון בוטל.</p> }
      }
      <p class="lead">קיבלתם <b>{{ c.discountPercent }}% הנחה</b> על אחד ממשחקי PORTAL X.</p>
      <span class="lbl">קוד הקופון:</span>
      <div class="code-row">
        <output class="code" dir="ltr" aria-label="קוד הקופון">{{ c.code }}</output>
        <button class="btn" type="button" (click)="copy()">{{ copied() ? 'הועתק ✓' : 'העתקת קוד הקופון' }}</button>
      </div>
      <div class="expiry" [class.bad]="c.status === 'expired'">
        <span>תוקף עד:</span>
        <b>{{ c.expiresAtText }}</b>
        <small>שעון ישראל · מימוש אחד בלבד</small>
      </div>
      @if (c.games.length) { <p class="games muted small">תקף לרכישת: {{ c.games.join(' · ') }}</p> }
      <p class="mail small" role="status">{{ mailLine() }}</p>
      <div class="actions">
        <a class="btn primary" routerLink="/" fragment="games" (click)="remember()">מעבר למשחקים</a>
        @if (c.canResend && c.status === 'active') {
          <button class="btn ghost small" type="button" (click)="resend.emit()" [disabled]="resending()">{{ resending() ? 'שולחים...' : 'שליחת המייל שוב' }}</button>
        }
      </div>
      @if (resendMessage()) { <p class="small" [class.error]="resendFailed()" role="status">{{ resendMessage() }}</p> }
    </div>
  `,
  styles: [`
    .res { display:flex; flex-direction:column; gap:.45rem; align-items:center; text-align:center; }
    .lead { margin:0; font-size:1.05rem; } .lead b { color: var(--gold-2); }
    .lbl { color: var(--muted); font-size:.9rem; margin-top:.2rem; }
    .code-row { display:flex; gap:.5rem; align-items:center; justify-content:center; flex-wrap:wrap; }
    .code { font-family: ui-monospace, 'Courier New', monospace; font-size: clamp(1.5rem, 6vw, 2rem); font-weight:800; letter-spacing:.12em; color:#fff;
      padding:.45rem .9rem; border:2px dashed var(--gold); border-radius:12px; background: rgba(224,185,92,.08); user-select:all; }
    .expiry { display:flex; flex-direction:column; align-items:center; gap:.1rem; padding:.55rem 1.1rem; border-radius:12px; background: rgba(224,185,92,.14); border:1px solid var(--gold); }
    .expiry span { font-size:.9rem; color:#e8ecfb; } .expiry b { font-size:1.25rem; color: var(--gold-2); } .expiry small { color: var(--muted); }
    .expiry.bad { border-color:#d45d5d; background: rgba(212,93,93,.12); } .expiry.bad b { color:#ffb3b3; }
    .state { margin:0; font-weight:700; color:#9be3b4; } .state.bad { color:#ffb3b3; }
    .games, .mail { margin:0; } .small { font-size:.86rem; }
    .actions { display:flex; gap:.5rem; flex-wrap:wrap; justify-content:center; margin-top:.3rem; }
  `],
})
export class CouponResultComponent {
  coupon = input.required<ChallengeCoupon>();
  resending = input(false);
  resendMessage = input<string | null>(null);
  resendFailed = input(false);
  resend = output<void>();
  copied = signal(false);

  mailLine = computed(() => {
    const c = this.coupon();
    switch (c.emailStatus) {
      case 'sent': return `הקופון נשלח גם למייל ${c.email}. כדאי לבדוק גם בתיקיית הספאם.`;
      case 'failed': return `לא הצלחנו לשלוח את המייל ל-${c.email}. הקופון שמור כאן, ואפשר לנסות לשלוח שוב.`;
      case 'uncertain': return `ייתכן שהמייל ל-${c.email} לא נשלח. בדקו בעוד כמה דקות, ואם לא הגיע — שלחו שוב.`;
      default: return `המייל ל-${c.email} בדרך.`;
    }
  });

  async copy() {
    try {
      await navigator.clipboard.writeText(this.coupon().code);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2500);
    } catch {
      // no clipboard (an old browser or a blocked permission): the code itself can be selected
    }
  }

  /** The game page fills the code in by itself. */
  remember() {
    try { sessionStorage.setItem(pendingCoupon.key, this.coupon().code); } catch { /* it can still be typed */ }
  }
}
