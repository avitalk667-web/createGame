import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { ApiError } from '../../core/api.service';
import { ADMIN_CHALLENGE_STYLES, AdminChallengeApi, CampaignUpdate, ChallengeAdminView } from './admin-challenge.api';

/**
 * The campaign's settings: on/off, issuing paused, minimum score, discount, validity, quota, source game and the
 * participating games. A change applies to coupons issued from now on; an issued coupon keeps its own terms.
 */
@Component({
  selector: 'px-admin-coupon-campaign',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let c = view().campaign;
    <section class="card head">
      <div class="title">
        <h2>{{ c.name }}</h2>
        <span class="st" [attr.data-s]="c.isActive ? 'on' : 'off'">{{ c.isActive ? 'פעיל' : 'לא פעיל' }}</span>
        @if (c.isActive && c.issuingPaused) { <span class="st" data-s="off">הנפקה מושהית</span> }
      </div>
      <div class="row">
        @if (c.isActive) {
          <button class="btn small" type="button" (click)="active(false)" [disabled]="busy()">השבתת המבצע</button>
          @if (c.issuingPaused) {
            <button class="btn primary small" type="button" (click)="paused(false)" [disabled]="busy()">הפעלה מחדש של ההנפקה</button>
          } @else {
            <button class="btn small" type="button" (click)="paused(true)" [disabled]="busy()">עצירת הנפקת קופונים</button>
          }
        } @else {
          <button class="btn primary small" type="button" (click)="active(true)" [disabled]="busy()">הפעלת המבצע</button>
        }
      </div>
      <p class="muted small">
        מבצע עצמאי ומתמשך. כשהוא פעיל: חלונית בכניסה למשחק החינמי, מד התקדמות וחלונית קבלת קופון לזכאים. השבתה עוצרת הכול — קופונים שכבר הונפקו נשארים בתוקף עד תאריך התפוגה שלהם.
        @if (c.startedAt) { הופעל לראשונה: {{ c.startedAt | date: 'd.M.yy HH:mm' }}. }
      </p>
    </section>

    <form class="card settings" (submit)="$event.preventDefault(); save()">
      <h3>הגדרות המבצע</h3>
      <div class="grid">
        <label>שם המבצע <input maxlength="80" [value]="form().name" (input)="set('name', $any($event.target).value)" /></label>
        <label>ציון מינימלי (כולל) <input type="number" min="1" step="1" dir="ltr" [value]="form().minimumScore" (input)="set('minimumScore', +$any($event.target).value)" /></label>
        <label>אחוז הנחה <input type="number" min="1" max="99" step="0.5" dir="ltr" [value]="form().discountPercentage" (input)="set('discountPercentage', +$any($event.target).value)" /></label>
        <label>תוקף קופון (ימים) <input type="number" min="1" max="365" step="1" dir="ltr" [value]="form().validityDays" (input)="set('validityDays', +$any($event.target).value)" /></label>
        <label>מכסה כוללת <input type="number" min="0" step="1" dir="ltr" [value]="form().maxCoupons" (input)="set('maxCoupons', +$any($event.target).value)" />
          <small>הונפקו עד כה: {{ c.issuedCouponsCount }}</small></label>
        <label>משחק מקור
          <select [value]="form().sourceProductId" (change)="set('sourceProductId', $any($event.target).value)">
            @for (p of freeProducts(); track p.id) { <option [value]="p.id">{{ p.name }}</option> }
          </select>
        </label>
        <label class="check"><input type="checkbox" [checked]="form().showEntryPopup" (change)="set('showEntryPopup', $any($event.target).checked)" /> הצגת הודעת כניסה</label>
        <label class="check"><input type="checkbox" [checked]="form().showProgress" (change)="set('showProgress', $any($event.target).checked)" /> הצגת מד התקדמות</label>
      </div>
      <label>תיאור פנימי <input maxlength="500" [value]="form().description" (input)="set('description', $any($event.target).value)" /></label>
      <fieldset>
        <legend>משחקים לרכישה עם הקופון</legend>
        @for (p of paidProducts(); track p.id) {
          <label class="check"><input type="checkbox" [checked]="form().productIds.includes(p.id)" (change)="toggle(p.id, $any($event.target).checked)" />
            {{ p.name }}{{ p.priceIls ? ' · ' + p.priceIls + ' ₪' : '' }}@if (p.status !== 'published') { <span class="muted small">(לא מפורסם)</span> }</label>
        }
      </fieldset>
      <p class="muted small">„יותר מ-240 נקודות” = ציון מינימלי 241. שינוי ההנחה, התוקף או המשחקים חל על קופונים חדשים בלבד.</p>
      @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
      @if (saved()) { <p class="ok" role="status">ההגדרות נשמרו.</p> }
      <div class="row"><button class="btn primary small" type="submit" [disabled]="busy() || !dirty()">שמירת ההגדרות</button></div>
    </form>
  `,
  styles: [ADMIN_CHALLENGE_STYLES + `
    .head .title { display:flex; gap:.6rem; align-items:center; flex-wrap:wrap; } .head h2 { margin:0; }
    .head .row { margin:.6rem 0 .2rem; }
    .settings { margin-top:1rem; display:flex; flex-direction:column; gap:.7rem; }
    .grid { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:.6rem .9rem; align-items:end; }
    fieldset { border:1px solid var(--line); border-radius:10px; display:flex; flex-wrap:wrap; gap:.4rem 1.2rem; padding:.6rem .9rem; }
    legend { color:var(--gold-2); padding:0 .3rem; }
    @media (max-width: 900px) { .grid { grid-template-columns:repeat(2, minmax(0,1fr)); } }
    @media (max-width: 560px) { .grid { grid-template-columns:1fr; } }
  `],
})
export class AdminCouponCampaignComponent {
  view = input.required<ChallengeAdminView>();
  changed = output<ChallengeAdminView>();
  private api = inject(AdminChallengeApi);

  form = signal<Required<CampaignUpdate>>(this.blank());
  busy = signal(false);
  error = signal<string | null>(null);
  saved = signal(false);
  freeProducts = computed(() => this.view().products.filter((p) => p.isFree));
  paidProducts = computed(() => this.view().products.filter((p) => !p.isFree));
  dirty = computed(() => JSON.stringify(this.form()) !== JSON.stringify(this.fromView()));

  constructor() {
    effect(() => this.form.set(this.fromView()));
  }

  private blank(): Required<CampaignUpdate> {
    return { name: '', description: '', minimumScore: 241, discountPercentage: 10, validityDays: 8, maxCoupons: 0, sourceProductId: '', productIds: [], showEntryPopup: true, showProgress: true };
  }

  private fromView(): Required<CampaignUpdate> {
    const c = this.view().campaign;
    return {
      name: c.name, description: c.description, minimumScore: c.minimumScore, discountPercentage: c.discountPercentage, validityDays: c.validityDays,
      maxCoupons: c.maxCoupons, sourceProductId: c.sourceProductId, productIds: [...c.productIds].sort(), showEntryPopup: c.showEntryPopup, showProgress: c.showProgress,
    };
  }

  set<K extends keyof CampaignUpdate>(k: K, v: Required<CampaignUpdate>[K]) {
    this.form.update((f) => ({ ...f, [k]: v }));
    this.saved.set(false);
  }

  toggle(id: string, on: boolean) {
    const ids = new Set(this.form().productIds);
    if (on) ids.add(id); else ids.delete(id);
    this.set('productIds', [...ids].sort());
  }

  private async run(f: () => Promise<ChallengeAdminView>, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      this.changed.emit(await f());
      return true;
    } catch (e) {
      this.error.set(e instanceof ApiError ? e.message : 'הפעולה נכשלה.');
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  async save() {
    if (await this.run(() => this.api.update(this.form()))) this.saved.set(true);
  }

  active(on: boolean) {
    void this.run(() => this.api.setActive(on), on ? undefined : 'להשבית את המבצע? החלונית ומד ההתקדמות יוסתרו ולא יונפקו קופונים חדשים. קופונים שכבר הונפקו נשארים בתוקף.');
  }

  paused(on: boolean) {
    void this.run(() => this.api.setPaused(on), on ? 'לעצור את הנפקת הקופונים? המבצע יישאר מוצג, אך שחקנים זכאים לא יקבלו קופון עד ההפעלה מחדש.' : undefined);
  }
}
