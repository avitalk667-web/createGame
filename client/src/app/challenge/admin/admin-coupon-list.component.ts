import { DatePipe, DecimalPipe, JsonPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, output, signal } from '@angular/core';
import { ApiError } from '../../core/api.service';
import {
  ADMIN_CHALLENGE_STYLES, AdminChallengeApi, COUPON_STATUS_LABEL, ChallengeCouponDetail, ChallengeCouponFilters, ChallengeCouponRow, EMAIL_STATUS_LABEL,
} from './admin-challenge.api';

const ACTION_LABEL: Record<string, string | undefined> = {
  issued: 'הונפק', 'email-sent': 'המייל נשלח', 'email-failed': 'שליחת המייל נכשלה', 'email-uncertain': 'שליחת המייל לא ודאית',
  'resend-requested': 'בקשה לשליחה חוזרת', cancelled: 'בוטל',
};

/** The personal coupons: search, filters, details with history, cancel, resend and export (CSV that opens in Excel). */
@Component({
  selector: 'px-admin-coupon-list',
  imports: [DatePipe, DecimalPipe, JsonPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2>הקופונים שהונפקו</h2>
    <form class="card filters" (submit)="$event.preventDefault(); load()">
      <label>חיפוש לפי מייל או קוד <input dir="ltr" [value]="f().search ?? ''" (input)="setF('search', $any($event.target).value)" placeholder="name@… / PX-…" /></label>
      <label>סטטוס
        <select [value]="f().status ?? ''" (change)="setF('status', $any($event.target).value)">
          <option value="">הכול</option><option value="active">פעיל</option><option value="redeemed">מומש</option><option value="expired">פג תוקף</option><option value="cancelled">בוטל</option>
        </select>
      </label>
      <label>הונפק מתאריך <input type="date" [value]="f().from ?? ''" (change)="setF('from', $any($event.target).value)" /></label>
      <label>עד תאריך <input type="date" [value]="f().to ?? ''" (change)="setF('to', $any($event.target).value)" /></label>
      <div class="row">
        <button class="btn small" type="submit">סינון</button>
        <a class="btn small ghost" [href]="csvUrl()" download>ייצוא לאקסל (CSV)</a>
      </div>
    </form>
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    <p class="muted small">{{ rows().length }} קופונים{{ loading() ? ' · טוען…' : '' }}</p>
    <div class="table-wrap">
      <table>
        <thead><tr><th>קוד קופון</th><th>מייל</th><th>ניקוד</th><th>תאריך הנפקה</th><th>תאריך תפוגה</th><th>סטטוס</th><th>משחק שנרכש</th><th>תאריך מימוש</th><th>מייל נשלח</th><th></th></tr></thead>
        <tbody>
          @for (r of rows(); track r.id) {
            <tr [class.sel]="detail()?.id === r.id">
              <td dir="ltr" class="code">{{ r.code }}</td><td dir="ltr">{{ r.email }}</td><td>{{ r.score }}</td>
              <td>{{ r.issuedAt | date: 'd.M.yy HH:mm' }}</td><td>{{ r.expiresAt | date: 'd.M.yy HH:mm' }}</td>
              <td><span class="st" [attr.data-s]="r.status">{{ label[r.status] }}</span></td>
              <td>{{ r.purchasedGame ?? '—' }}@if (r.orderNumber) { <span class="muted small"> · הזמנה {{ r.orderNumber }}</span> }</td>
              <td>{{ r.redeemedAt ? (r.redeemedAt | date: 'd.M.yy HH:mm') : '—' }}</td>
              <td><span class="st" [attr.data-s]="r.emailStatus">{{ mail[r.emailStatus ?? ''] ?? '—' }}</span></td>
              <td><button class="btn small ghost" type="button" (click)="open(r.id)">פרטים</button></td>
            </tr>
          } @empty {
            <tr><td colspan="10" class="muted">אין קופונים להצגה.</td></tr>
          }
        </tbody>
      </table>
    </div>
    <p class="muted small">התאריכים בשעון ישראל. הקופון פג בדיוק במועד התפוגה.</p>

    @if (detail(); as d) {
      <section class="card detail" aria-labelledby="cd-title">
        <div class="bar">
          <h3 id="cd-title">קופון <span dir="ltr">{{ d.code }}</span> <span class="st" [attr.data-s]="d.status">{{ label[d.status] }}</span></h3>
          <button class="btn small ghost" type="button" (click)="detail.set(null)" aria-label="סגירת הפרטים">✕</button>
        </div>
        <dl>
          <dt>מייל</dt><dd dir="ltr">{{ d.email }}</dd>
          <dt>ניקוד במשחק</dt><dd>{{ d.score }}@if (d.roomCode) { <span class="muted small"> · משחק {{ d.roomCode }}</span> }</dd>
          <dt>הנחה</dt><dd>{{ d.discountPercent }}%</dd>
          <dt>משחקים</dt><dd>{{ d.games.join(' · ') }}</dd>
          <dt>הונפק</dt><dd>{{ d.issuedAt | date: 'd.M.yy HH:mm' }}</dd>
          <dt>תוקף עד</dt><dd><b>{{ d.expiresAtText }}</b></dd>
          <dt>מייל הקופון</dt><dd>{{ mail[d.emailStatus ?? ''] ?? '—' }} · {{ d.emailAttempts }} ניסיונות@if (d.emailLastError) { · {{ d.emailLastError }} }</dd>
          <dt>הסכמה לדיוור</dt><dd>@if (d.consent?.marketingConsent) { כן · {{ d.consent!.consentAt | date: 'd.M.yy HH:mm' }} · נוסח {{ d.consent!.consentVersion }} · {{ d.consent!.consentSource }} } @else { לא }</dd>
          @if (d.cancelledAt) { <dt>בוטל</dt><dd>{{ d.cancelledAt | date: 'd.M.yy HH:mm' }} · {{ d.cancelledBy }}</dd> }
        </dl>
        @if (d.uses.length) {
          <h3>הזמנות עם הקופון</h3>
          <ul class="list">
            @for (u of d.uses; track u.number) {
              <li>הזמנה {{ u.number }} · {{ u.productName }} · {{ u.originalPrice | number: '1.0-2' }} ₪ − {{ u.discount | number: '1.0-2' }} ₪ = {{ u.finalPrice | number: '1.0-2' }} ₪ ·
                {{ useLabel[u.status] ?? u.status }}@if (u.isTest) { (בדיקה) } · {{ u.updatedAt | date: 'd.M.yy HH:mm' }}</li>
            }
          </ul>
        }
        <h3>היסטוריית פעולות</h3>
        <ul class="list">
          @for (e of d.events; track $index) {
            <li>{{ e.at | date: 'd.M.yy HH:mm:ss' }} · {{ actions[e.action] ?? e.action }} · {{ e.actor === 'system' ? 'המערכת' : e.actor === 'player' ? 'השחקן' : e.actor }}
              @if (hasDetails(e.details)) { <code class="small">{{ e.details | json }}</code> }</li>
          }
        </ul>
        @if (actionError()) { <p class="error" role="alert">{{ actionError() }}</p> }
        <div class="row">
          @if (d.status === 'active') {
            <button class="btn small" type="button" (click)="resend(d.id)" [disabled]="busy()">שליחת המייל שוב</button>
            <button class="btn small danger" type="button" (click)="cancel(d.id)" [disabled]="busy()">ביטול הקופון</button>
          }
        </div>
      </section>
    }
  `,
  styles: [ADMIN_CHALLENGE_STYLES + `
    .filters { display:flex; flex-wrap:wrap; gap:.6rem 1rem; align-items:flex-end; padding:.8rem 1rem; margin-bottom:.6rem; }
    td.code { font-family: ui-monospace, monospace; font-weight:700; }
    tr.sel td { background: rgba(224,185,92,.08); }
    .detail { margin-top:1rem; }
    .bar { display:flex; justify-content:space-between; align-items:center; gap:1rem; }
    dl { display:grid; grid-template-columns:max-content 1fr; gap:.3rem 1rem; margin:.4rem 0; } dt { color:var(--muted); } dd { margin:0; }
    .list { margin:.3rem 0; padding-inline-start:1.2rem; line-height:1.8; }
    code { background:rgba(255,255,255,.06); padding:.05rem .35rem; border-radius:6px; }
    .danger { border-color:var(--bad); color:#ffc2b5; }
  `],
})
export class AdminCouponListComponent implements OnInit {
  /** A coupon was cancelled or mailed again: the figures above change. */
  changed = output<void>();
  private api = inject(AdminChallengeApi);
  label = COUPON_STATUS_LABEL;
  mail = EMAIL_STATUS_LABEL;
  actions = ACTION_LABEL;
  useLabel: Record<string, string | undefined> = { reserved: 'שמור לתשלום', redeemed: 'מומש', released: 'שוחרר (התשלום לא הושלם)', refunded: 'הוחזר' };

  f = signal<ChallengeCouponFilters>({});
  rows = signal<ChallengeCouponRow[]>([]);
  detail = signal<ChallengeCouponDetail | null>(null);
  loading = signal(false);
  busy = signal(false);
  error = signal<string | null>(null);
  actionError = signal<string | null>(null);
  csvUrl = computed(() => this.api.csvUrl(this.f()));

  ngOnInit() { void this.load(); }

  setF(k: keyof ChallengeCouponFilters, v: string) {
    this.f.update((f) => ({ ...f, [k]: v.trim() || undefined }));
    if (k === 'status') void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.rows.set(await this.api.coupons(this.f()));
    } catch (e) {
      this.error.set(e instanceof ApiError ? e.message : 'טעינת הקופונים נכשלה.');
    } finally {
      this.loading.set(false);
    }
  }

  async open(id: string) {
    this.actionError.set(null);
    try {
      this.detail.set(await this.api.coupon(id));
    } catch (e) {
      this.error.set(e instanceof ApiError ? e.message : 'טעינת הקופון נכשלה.');
    }
  }

  hasDetails(d: Record<string, unknown>) {
    return Object.values(d ?? {}).some((v) => v !== null && v !== undefined);
  }

  private async act(f: () => Promise<ChallengeCouponDetail>) {
    this.busy.set(true);
    this.actionError.set(null);
    try {
      this.detail.set(await f());
      await this.load();
      this.changed.emit();
    } catch (e) {
      this.actionError.set(e instanceof ApiError ? e.message : 'הפעולה נכשלה.');
    } finally {
      this.busy.set(false);
    }
  }

  cancel(id: string) {
    if (!confirm('לבטל את הקופון? הוא יפסיק לעבוד מיד, והפעולה תירשם ביומן. אי אפשר לבטל את הביטול.')) return;
    void this.act(() => this.api.cancel(id));
  }

  resend(id: string) { void this.act(() => this.api.resend(id)); }
}
