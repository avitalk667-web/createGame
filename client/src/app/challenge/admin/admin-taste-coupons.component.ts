import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { ApiError } from '../../core/api.service';
import { ADMIN_CHALLENGE_STYLES, AdminChallengeApi, ChallengeAdminView, TasteCouponUpdate, TasteCouponView } from './admin-challenge.api';

/**
 * "קופונים – סיום טעימה מהפורטל": the coupon a visitor gets once the server recorded that they opened the gate of the free
 * taste. Its own settings (a change applies to coupons issued from now on) and the whole funnel, from entering to paying.
 * The figures count real paid orders only (no test payments, no failed ones).
 */
@Component({
  selector: 'px-admin-taste-coupons',
  imports: [DatePipe, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card taste">
      <div class="title">
        <h2>קופונים – סיום טעימה מהפורטל</h2>
        @if (view(); as v) {
          <span class="st" [attr.data-s]="v.campaign.isActive ? 'on' : 'off'">{{ v.campaign.isActive ? 'פעיל' : 'לא פעיל' }}</span>
        }
      </div>
      <p class="muted small">מי שפותח את השער בטעימה החינמית יכול לקבל קופון אישי לשימוש אחד, פעם אחת לכל טעימה: אחרי שהזין מייל ואישר במפורש קבלת דיוור, השרת מנפיק את הקופון ושולח אותו במייל, והקוד מוצג באתר רק אחרי שספק המייל אישר את השליחה. שינוי ההגדרות חל על קופונים חדשים בלבד.</p>
      @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
      @if (view(); as v) {
        <form class="settings" (submit)="$event.preventDefault(); save()">
          <div class="grid">
            <label class="check"><input type="checkbox" [checked]="form().isActive" (change)="set('isActive', $any($event.target).checked)" /> הנפקת קופון בסיום הטעימה</label>
            <label>אחוז הנחה <input type="number" min="1" max="99" step="0.5" dir="ltr" [value]="form().discountPercentage" (input)="set('discountPercentage', +$any($event.target).value)" /></label>
            <label>תוקף קופון (ימים) <input type="number" min="1" max="365" step="1" dir="ltr" [value]="form().validityDays" (input)="set('validityDays', +$any($event.target).value)" /></label>
            <label>כמות מרבית (0 = ללא הגבלה) <input type="number" min="0" step="1" dir="ltr" [value]="form().maxCoupons" (input)="set('maxCoupons', +$any($event.target).value)" />
              <small>הונפקו עד כה: {{ v.campaign.issuedCouponsCount }}</small></label>
          </div>
          <fieldset>
            <legend>משחקים שעליהם חלה ההנחה</legend>
            @for (p of paidProducts(); track p.id) {
              <label class="check"><input type="checkbox" [checked]="form().productIds.includes(p.id)" (change)="toggle(p.id, $any($event.target).checked)" />
                {{ p.name }}{{ p.priceIls ? ' · ' + p.priceIls + ' ₪' : '' }}@if (p.status !== 'published') { <span class="muted small">(לא מפורסם)</span> }</label>
            }
          </fieldset>
          @if (saved()) { <p class="ok" role="status">ההגדרות נשמרו.</p> }
          <div class="row"><button class="btn primary small" type="submit" [disabled]="busy() || !dirty()">שמירת ההגדרות</button></div>
        </form>

        @let s = v.statistics;
        <h3>המשפך מאז {{ s.since | date: 'd.M.yy' }}</h3>
        <div class="cards">
          <div class="card stat"><span>התחילו טעימה</span><b>{{ s.started | number }}</b></div>
          <div class="card stat"><span>השלימו את הטעימה</span><b>{{ s.completed | number }}</b></div>
          <div class="card stat"><span>השאירו מייל</span><b>{{ s.leftEmail | number }}</b><small>אישרו דיוור: {{ s.consented | number }}</small></div>
          <div class="card stat"><span>קופונים שנשלחו בהצלחה</span><b>{{ s.emailsSent | number }}</b><small>שליחות שנכשלו: {{ s.emailsFailed | number }}</small></div>
          <div class="card stat"><span>קופונים שהונפקו</span><b>{{ s.issued | number }}</b>
            <small>פעילים {{ s.active | number }} · פגי תוקף {{ s.expired | number }} · בוטלו {{ s.cancelled | number }}@if (s.remaining !== null && s.remaining !== undefined) { · נותרו {{ s.remaining | number }} }</small></div>
          <div class="card stat"><span>העתיקו את הקוד</span><b>{{ s.copied | number }}</b></div>
          <div class="card stat"><span>עברו לעמוד משחק</span><b>{{ s.productClicked | number }}</b></div>
          <div class="card stat"><span>התחילו תשלום</span><b>{{ s.checkoutStarted | number }}</b></div>
          <div class="card stat"><span>רכישות עם הקופון</span><b>{{ s.purchases | number }}</b>
            <small>מומשו {{ s.redeemed | number }}@if (s.testRedemptions) { · מתוכם בדיקה {{ s.testRedemptions | number }} }</small></div>
          <div class="card stat"><span>הכנסות</span><b>{{ s.revenue | number: '1.0-2' }} ₪</b><small>הנחות שניתנו: {{ s.discounts | number: '1.0-2' }} ₪</small></div>
          <div class="card stat"><span>יחס המרה</span><b>{{ s.conversion | number: '1.0-1' }}%</b><small>רכישות מתוך משלימי הטעימה</small></div>
        </div>
        @if (s.byGame.length) {
          <p class="small muted">לפי משחק: @for (g of s.byGame; track g.productId) { {{ g.name }} — {{ g.count }} רכישות, {{ g.revenue | number: '1.0-2' }} ₪@if (!$last) { · } }</p>
        }
        <p class="muted small">רק הזמנות ששולמו בפועל נספרות; תשלומי בדיקה ותשלומים שנכשלו אינם נכללים.</p>
      } @else if (!error()) {
        <p class="muted">טוען…</p>
      }
    </section>
  `,
  styles: [ADMIN_CHALLENGE_STYLES + `
    .taste { margin-top:1.2rem; }
    .title { display:flex; gap:.6rem; align-items:center; flex-wrap:wrap; } .title h2 { margin:0; }
    .settings { margin:.6rem 0 .4rem; display:flex; flex-direction:column; gap:.7rem; }
    .grid { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:.6rem .9rem; align-items:end; }
    fieldset { border:1px solid var(--line); border-radius:10px; display:flex; flex-wrap:wrap; gap:.4rem 1.2rem; padding:.6rem .9rem; }
    legend { color:var(--gold-2); padding:0 .3rem; }
    .cards { grid-template-columns:repeat(3, minmax(0,1fr)); }
    @media (max-width: 900px) { .grid { grid-template-columns:repeat(2, minmax(0,1fr)); } }
    @media (max-width: 560px) { .grid { grid-template-columns:1fr; } }
  `],
})
export class AdminTasteCouponsComponent implements OnInit {
  /** The challenge view: its list of games (the same catalog). */
  catalog = input.required<ChallengeAdminView>();
  /** The settings changed: the coupon list below may be loaded again. */
  changed = output<void>();
  private api = inject(AdminChallengeApi);

  view = signal<TasteCouponView | null>(null);
  form = signal<TasteCouponUpdate>({ isActive: true, discountPercentage: 10, validityDays: 8, maxCoupons: 0, productIds: [] });
  busy = signal(false);
  error = signal<string | null>(null);
  saved = signal(false);
  paidProducts = computed(() => this.catalog().products.filter((p) => !p.isFree));
  dirty = computed(() => { const v = this.view(); return !!v && JSON.stringify(this.form()) !== JSON.stringify(this.fromView(v)); });

  ngOnInit() { void this.reload(); }

  async reload() {
    try {
      this.apply(await this.api.tasteView());
      this.error.set(null);
    } catch (e) {
      this.error.set(e instanceof ApiError ? e.message : 'טעינת קופוני הטעימה נכשלה.');
    }
  }

  private fromView(v: TasteCouponView): TasteCouponUpdate {
    const c = v.campaign;
    return { isActive: c.isActive, discountPercentage: c.discountPercentage, validityDays: c.validityDays, maxCoupons: c.maxCoupons, productIds: [...c.productIds].sort() };
  }

  private apply(v: TasteCouponView) {
    this.view.set(v);
    this.form.set(this.fromView(v));
  }

  set<K extends keyof TasteCouponUpdate>(k: K, v: TasteCouponUpdate[K]) {
    this.form.update((f) => ({ ...f, [k]: v }));
    this.saved.set(false);
  }

  toggle(id: string, on: boolean) {
    const ids = new Set(this.form().productIds);
    if (on) ids.add(id); else ids.delete(id);
    this.set('productIds', [...ids].sort());
  }

  async save() {
    if (!this.form().isActive && this.view()?.campaign.isActive
      && !confirm('לעצור את הנפקת הקופונים בסיום הטעימה? מי שיסיים מעכשיו לא יקבל קופון. קופונים שכבר הונפקו נשארים בתוקף.')) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      this.apply(await this.api.tasteUpdate(this.form()));
      this.saved.set(true);
      this.changed.emit();
    } catch (e) {
      this.error.set(e instanceof ApiError ? e.message : 'השמירה נכשלה.');
    } finally {
      this.busy.set(false);
    }
  }
}
