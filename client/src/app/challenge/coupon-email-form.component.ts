import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { ApiError } from '../core/api.service';
import { ChallengeService, ChallengeStatus } from './challenge.service';

/**
 * The address the coupon is sent to, and — separately, never ticked in advance and never a condition — consent to
 * marketing email. The server checks eligibility again and issues the coupon.
 */
@Component({
  selector: 'px-coupon-email-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form (submit)="$event.preventDefault(); submit()" novalidate>
      <label for="ch-email">כתובת דואר אלקטרוני</label>
      <input id="ch-email" type="email" dir="ltr" autocomplete="email" inputmode="email" maxlength="254" placeholder="name@example.com"
        required [value]="email()" (input)="email.set($any($event.target).value); error.set(null)" [attr.aria-invalid]="!!error()" aria-describedby="ch-email-note" />
      <small id="ch-email-note" class="muted">הכתובת משמשת להנפקת הקופון ולשליחתו אליכם.</small>
      <label class="consent">
        <input type="checkbox" [checked]="consent()" (change)="consent.set($any($event.target).checked)" />
        <span>{{ consentText() }}</span>
      </label>
      @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
      <button class="btn primary big" type="submit" [disabled]="busy()">{{ busy() ? 'מנפיקים את הקופון...' : 'קבלת הקופון שלי' }}</button>
    </form>
  `,
  styles: [`
    form { display:flex; flex-direction:column; gap:.45rem; text-align:start; }
    label { font-weight:700; }
    input[type=email] { width:100%; box-sizing:border-box; min-height:44px; font-size:1rem; }
    .consent { display:flex; gap:.55rem; align-items:flex-start; font-weight:400; font-size:.88rem; line-height:1.55; color:#d6ddf2; cursor:pointer; margin-top:.3rem; }
    .consent input { width:20px; height:20px; flex-shrink:0; margin-top:.15rem; accent-color: var(--gold); }
    .error { margin:.2rem 0 0; }
    .big { margin-top:.4rem; }
  `],
})
export class CouponEmailFormComponent {
  code = input.required<string>();
  token = input<string | null>(null);
  consentText = input.required<string>();
  issued = output<ChallengeStatus>();
  private svc = inject(ChallengeService);

  email = signal('');
  /** Never ticked in advance. */
  consent = signal(false);
  busy = signal(false);
  error = signal<string | null>(null);

  async submit() {
    const email = this.email().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      this.error.set('כתובת המייל אינה תקינה. בדקו אותה ונסו שוב.');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      this.issued.emit(await this.svc.issue(this.code(), this.token(), email, this.consent()));
    } catch (e) {
      this.error.set(e instanceof ApiError ? e.message : 'לא הצלחנו להנפיק את הקופון. נסו שוב.');
    } finally {
      this.busy.set(false);
    }
  }
}
