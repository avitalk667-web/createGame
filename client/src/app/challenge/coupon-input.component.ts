import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CouponQuote } from '../core/models';

/**
 * "Have a coupon code?" on the purchase page. The check, the discount and the final price all come from the server
 * (POST /api/coupons/check); the order is priced by the server again. Ordinary and personal coupons alike.
 */
@Component({
  selector: 'px-coupon-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="coupon">
      <label for="coupon">יש לכם קוד קופון?</label>
      @if (quote(); as q) {
        <p class="ok" role="status">הקופון {{ q.code }} הוחל — חסכתם {{ money(q.discount) }}.</p>
        <button class="btn small ghost" type="button" (click)="remove.emit()">הסרת הקופון</button>
      } @else {
        <div class="row">
          <input id="coupon" dir="ltr" autocomplete="off" maxlength="32" placeholder="לדוגמה PX-AB23CD45" [value]="text()"
            (input)="textChange.emit($any($event.target).value)" (keydown.enter)="$event.preventDefault(); text().trim() && apply.emit()"
            [attr.aria-invalid]="!!error()" />
          <button class="btn small" type="button" (click)="apply.emit()" [disabled]="!text().trim() || busy()">{{ busy() ? 'בודקים...' : 'אישור' }}</button>
        </div>
      }
      @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    </div>
  `,
  styles: [`
    .coupon { display:flex; flex-direction:column; gap:.35rem; padding:.6rem 0; border-top:1px solid var(--line); border-bottom:1px solid var(--line); }
    .row { display:flex; gap:.4rem; } input { flex:1; min-width:0; text-transform:uppercase; }
    .ok { margin:0; color:#9be3b4; }
  `],
})
export class CouponInputComponent {
  text = input('');
  quote = input<CouponQuote | null>(null);
  busy = input(false);
  error = input<string | null>(null);
  textChange = output<string>();
  apply = output<void>();
  remove = output<void>();

  money(v: number) {
    // the same format as the purchase summary: 88 ₪, 8.80 ₪
    return (Number.isInteger(v) ? String(v) : v.toFixed(2)) + ' ₪';
  }
}
