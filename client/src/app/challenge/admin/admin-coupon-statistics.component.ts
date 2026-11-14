import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ADMIN_CHALLENGE_STYLES, ChallengeStatistics } from './admin-challenge.api';

/** The campaign's figures since it was first switched on. Issued and redeemed coupons are always counted apart. */
@Component({
  selector: 'px-admin-coupon-statistics',
  imports: [DecimalPipe, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let s = stats();
    <h2>נתוני המבצע</h2>
    <p class="muted small">מאז {{ s.since | date: 'd.M.yy HH:mm' }} · משחקי „המשחק החינמי” בלבד.</p>
    <div class="cards">
      <div class="stat card"><span>כניסות למשחק</span><b>{{ s.gamesStarted }}</b><small>{{ s.gamesOpened }} משחקים נפתחו</small></div>
      <div class="stat card"><span>משחקים שהושלמו</span><b>{{ s.gamesCompleted }}</b><small>השער נפתח בהצלחה</small></div>
      <div class="stat card"><span>משתתפים ייחודיים</span><b>{{ s.uniqueParticipants }}</b><small>לפי מושב שחקן · רענון לא נספר שוב</small></div>
      <div class="stat card"><span>הגיעו לציון הסף</span><b>{{ s.eligiblePlayers }}</b><small>{{ s.eligibleRate | number: '1.0-1' }}% מהמשתתפים · {{ s.checkedPlayers }} נבדקו</small></div>
      <div class="stat card"><span>כתובות מייל שנאספו</span><b>{{ s.emailsCollected }}</b><small>{{ s.marketingConsents }} הסכימו לדיוור</small></div>
      <div class="stat card"><span>קופונים שהונפקו</span><b>{{ s.issued }}</b><small>מתוך מכסה של {{ s.maxCoupons }} · נותרו {{ s.remaining }}</small></div>
      <div class="stat card"><span>קופונים שמומשו</span><b>{{ s.redeemed }}</b><small>{{ s.redemptionRate | number: '1.0-1' }}% מימוש · {{ s.active }} פעילים · {{ s.expired }} פגו · {{ s.cancelled }} בוטלו</small></div>
      <div class="stat card"><span>הכנסות מרכישות עם קופון</span><b>{{ s.revenue | number: '1.0-2' }} ₪</b><small>סך ההנחות: {{ s.discounts | number: '1.0-2' }} ₪</small></div>
    </div>
    @if (s.testRedemptions) { <p class="muted small">{{ s.testRedemptions }} מימושים ברכישות בדיקה אינם נכללים בהכנסות.</p> }
    @if (s.byGame.length) {
      <h3>רכישות עם קופון לפי משחק</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>משחק</th><th>רכישות</th><th>הכנסות</th><th>הנחות</th></tr></thead>
          <tbody>
            @for (g of s.byGame; track g.productId) {
              <tr><td>{{ g.name }}</td><td>{{ g.count }}</td><td>{{ g.revenue | number: '1.0-2' }} ₪</td><td>{{ g.discounts | number: '1.0-2' }} ₪</td></tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styles: [ADMIN_CHALLENGE_STYLES],
})
export class AdminCouponStatisticsComponent {
  stats = input.required<ChallengeStatistics>();
}
