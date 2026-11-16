import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ApiError } from '../../core/api.service';
import { AdminChallengeApi, ChallengeAdminView } from './admin-challenge.api';
import { AdminCouponCampaignComponent } from './admin-coupon-campaign.component';
import { AdminCouponListComponent } from './admin-coupon-list.component';
import { AdminCouponStatisticsComponent } from './admin-coupon-statistics.component';
import { AdminTasteCouponsComponent } from './admin-taste-coupons.component';

/** The admin tab "Challenge 240 and coupons": settings, figures, the coupons of a finished taste and all the personal coupons. */
@Component({
  selector: 'px-admin-challenge',
  imports: [AdminCouponCampaignComponent, AdminCouponStatisticsComponent, AdminTasteCouponsComponent, AdminCouponListComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    @if (view(); as v) {
      <px-admin-coupon-campaign [view]="v" (changed)="view.set($event)" />
      <px-admin-coupon-statistics [stats]="v.statistics" />
      <px-admin-taste-coupons [catalog]="v" />
      <px-admin-coupon-list (changed)="reload()" />
    } @else if (!error()) {
      <p class="muted">טוען…</p>
    }
  `,
  styles: [`.error { color:#ffc2b5; }`],
})
export class AdminChallengeComponent implements OnInit {
  private api = inject(AdminChallengeApi);
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
