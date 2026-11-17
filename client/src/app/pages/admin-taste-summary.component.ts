import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';
import { AdminApiService, TasteStats } from '../core/admin-api.service';
import { AdminChallengeApi, TasteCouponStatistics } from '../challenge/admin/admin-challenge.api';

/**
 * "טעימת הפורטל" in short, for the dashboard, the statistics and the products tabs. It reads the same two server reports
 * as the taste tab itself (GET /api/admin/taste for the range, GET /api/admin/challenge/taste for the coupons), so every
 * number is the real one and nothing is counted twice: the purchases shown here are already part of the general revenue
 * and are never added to it again.
 */
@Component({
  selector: 'px-admin-taste-summary',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="section taste-sum" aria-labelledby="taste-sum-title">
      <div class="bar">
        <h2 id="taste-sum-title">{{ heading() }}</h2>
        <button class="btn small ghost" type="button" (click)="open.emit()">לפירוט המלא ‹</button>
      </div>
      @if (error()) {
        <p class="msg-box" role="alert">{{ error() }}</p>
      } @else if (!data()) {
        <p class="loading">טוענים את נתוני הטעימה…</p>
      } @else {
        @let d = data()!;
        @if (mode() === 'cards') {
          <div class="cards">
            <div class="stat"><span>ראו את הטעימה</span><b>{{ d.funnel.impressions }}</b><small>חשיפות בדף הבית</small></div>
            <div class="stat"><span>כניסות</span><b>{{ d.funnel.clicks }}</b><small>לחצו „אני רוצה לנסות!”</small></div>
            <div class="stat"><span>התחלות</span><b>{{ d.funnel.started }}</b><small>נכנסו לחדר · {{ d.rates.start }}% מהחשיפות</small></div>
            <div class="stat"><span>השלמות</span><b>{{ d.funnel.completed }}</b><small>פתחו את הדלת</small></div>
            <div class="stat accent"><span>אחוז השלמה</span><b>{{ d.rates.completion }}%</b><small>מתוך מי שהתחילו</small></div>
            @if (coupons(); as c) {
              <div class="stat"><span>קופונים שהונפקו</span><b>{{ c.issued }}</b><small>{{ c.active }} פעילים · מאז {{ day(c.since) }}</small></div>
              <div class="stat"><span>קופונים שמומשו</span><b>{{ c.redeemed }}</b><small>ברכישה ששולמה · {{ c.conversion }}% מימוש</small></div>
            }
            <div class="stat accent"><span>רכישות מיוחסות</span><b>{{ d.funnel.purchased }}</b><small>{{ money(d.funnel.revenue) }} · כבר כלול בהכנסות הכלליות</small></div>
          </div>
        } @else {
          <div class="table-wrap">
            <table>
              <thead><tr><th>משחק</th><th>רכישות מיוחסות לטעימה</th><th>הכנסה מיוחסת</th>@if (coupons()) { <th>מימושי קופון טעימה</th> }</tr></thead>
              <tbody>
                @for (p of d.products; track p.productId) {
                  <tr><td>{{ p.name }}</td><td>{{ p.purchases }}</td><td>{{ money(p.revenue) }}</td>@if (coupons()) { <td>{{ redeemedFor(p.productId) }}</td> }</tr>
                } @empty { <tr><td [attr.colspan]="coupons() ? 4 : 3" class="muted">אין עדיין רכישות שמקורן בטעימה בטווח הזה.</td></tr> }
              </tbody>
            </table>
          </div>
        }
        <p class="note">{{ rangeNote() }} רכישה מיוחסת רק כשספק הסליקה אישר את התשלום, ורכישות בדיקה אינן נספרות.@if (coupons()) { נתוני הקופונים מצטברים מאז הפעלתם. }</p>
      }
    </section>
  `,
  styles: [`.taste-sum .bar { margin-bottom:.8rem; }`],
})
export class AdminTasteSummaryComponent {
  private api = inject(AdminApiService);
  private challenge = inject(AdminChallengeApi);

  from = input.required<string>();
  to = input.required<string>();
  mode = input<'cards' | 'products'>('cards');
  heading = input('טעימת הפורטל');
  open = output<void>();

  data = signal<TasteStats | null>(null);
  coupons = signal<TasteCouponStatistics | null>(null);
  error = signal<string | null>(null);

  money = (v: number) => '₪' + (v ?? 0).toLocaleString('he-IL', { maximumFractionDigits: 2 });
  day = (iso: string) => new Date(iso).toLocaleDateString('he-IL');

  constructor() {
    effect(() => void this.load(this.from(), this.to()));
  }

  rangeNote() {
    const r = this.data()?.range;
    if (!r) return '';
    const f = (d: string) => d.split('-').reverse().map(Number).join('.');
    return `טווח: ${f(r.from)}–${f(r.to)} (שעון ישראל).`;
  }

  redeemedFor(productId: string) {
    return this.coupons()?.byGame.find((g) => g.productId === productId)?.count ?? 0;
  }

  private async load(from: string, to: string) {
    this.error.set(null);
    this.data.set(null);
    try {
      const [d, c] = await Promise.all([
        this.api.taste(from, to, 'day'),
        // the coupon figures are optional: the summary still shows if that report cannot be read
        this.challenge.tasteView().then((v) => v.statistics).catch(() => null),
      ]);
      this.data.set(d);
      this.coupons.set(c);
    } catch (e: any) {
      this.error.set(e?.message ?? 'טעינת נתוני הטעימה נכשלה.');
    }
  }
}
