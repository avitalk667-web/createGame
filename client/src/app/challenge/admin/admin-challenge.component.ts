import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { ApiError } from '../../core/api.service';
import { AdminChallengeApi, ChallengeAdminView } from './admin-challenge.api';
import { AdminCouponCampaignComponent } from './admin-coupon-campaign.component';
import { AdminCouponListComponent } from './admin-coupon-list.component';
import { AdminCouponStatisticsComponent } from './admin-coupon-statistics.component';
import { AdminTasteCouponsComponent } from './admin-taste-coupons.component';

/**
 * "Challenge 240" and the personal coupons, shown inside the admin tab "קופונים והנחות": the campaign settings and figures,
 * the coupons of a finished taste and every issued coupon. `section` picks one part (the tab shows them as sub-tabs).
 */
@Component({
  selector: 'px-admin-challenge',
  imports: [AdminCouponCampaignComponent, AdminCouponStatisticsComponent, AdminTasteCouponsComponent, AdminCouponListComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    @if (view(); as v) {
      @if (section() === 'all' || section() === 'challenge') {
        <px-admin-coupon-campaign [view]="v" (changed)="view.set($event)" />
        <px-admin-coupon-statistics [stats]="v.statistics" />
      }
      @if (section() === 'all' || section() === 'taste') { <px-admin-taste-coupons [catalog]="v" /> }
      @if (section() === 'all' || section() === 'issued') { <px-admin-coupon-list (changed)="reload()" /> }
    } @else if (!error()) {
      <p class="muted">טוען…</p>
    }
  `,
  styles: [`.error { color:#ffc2b5; }`],
})
export class AdminChallengeComponent implements OnInit {
  private api = inject(AdminChallengeApi);
  section = input<'all' | 'challenge' | 'taste' | 'issued'>('all');
  view = signal<ChallengeAdminView | null>(null);
  error = signal<string | null>(null);

  ngOnInit() { void this.reload(); }

  async reload() {
    try {
      this.view.set(await this.api.view());
      this.error.set(null);
    } catch (e) {
      this.error.set(e instanceof ApiError ? e.message : 'טעינת האתגר נכשלה.');
    }
  }
}
