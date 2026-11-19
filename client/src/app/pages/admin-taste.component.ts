import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { AdminApiService, TasteStats } from '../core/admin-api.service';
import { CHART_COLORS, ChartRow, ChartSeries, StatChartComponent } from '../ui/stat-chart.component';
import { addDays, israelToday } from './admin-stats.component';

type Preset = 'today' | 'week' | 'month' | 'year' | 'custom';
type Bucket = 'day' | 'week' | 'month';

const [GOLD, BLUE, PINK] = CHART_COLORS;

/** The steps as the admin reads them. */
const STEP: Record<string, string> = {
  demo_started: 'נכנסו לחדר', demo_item_inspected: 'בדקו חפצים', demo_hint_requested: 'ביקשו רמז', demo_code_attempt: 'ניסו קוד',
  demo_completed: 'פתרו', demo_offer_viewed: 'ראו את ההצעה', demo_product_clicked: 'לחצו על משחק',
  demo_checkout_started: 'התחילו רכישה', demo_purchase_completed: 'רכשו',
};
const DEVICE: Record<string, string> = { desktop: 'מחשב', mobile: 'נייד', tablet: 'טאבלט' };

/**
 * The "טעימה מהפורטל" tab of the admin area: the funnel of the free taste from the home page to a verified purchase,
 * with rates, times, where players stop, devices, variants, personal links and the newest sessions. Every number comes
 * from the server (GET /api/admin/taste); sessions are counted by the day they started.
 */
@Component({
  selector: 'px-admin-taste',
  imports: [StatChartComponent, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="filters card" (submit)="$event.preventDefault(); load()">
      <div class="presets" role="group" aria-label="טווח זמן">
        @for (p of presets; track p.id) {
          <button type="button" class="btn small" [class.primary]="preset() === p.id" [attr.aria-pressed]="preset() === p.id" (click)="choose(p.id)">{{ p.label }}</button>
        }
      </div>
      @if (preset() === 'custom') {
        <label>מתאריך <input type="date" [value]="from()" (change)="from.set($any($event.target).value)" /></label>
        <label>עד תאריך <input type="date" [value]="to()" (change)="to.set($any($event.target).value)" /></label>
        <button class="btn small" type="submit">הצגה</button>
      }
      <label>חלוקה בגרפים
        <select [value]="bucket()" (change)="setBucket($any($event.target).value)">
          <option value="day">לפי ימים</option><option value="week">לפי שבועות</option><option value="month">לפי חודשים</option>
        </select>
      </label>
      @if (data(); as d) { <span class="muted small range">{{ dayLabel(d.range.from) }} – {{ dayLabel(d.range.to) }} · שעון ישראל</span> }
    </form>

    @if (error()) { <p class="msg-box">{{ error() }}</p> }
    @if (loading() && !data()) { <p class="loading">טוענים נתונים...</p> }

    @if (data(); as d) {
      <h2>המשפך</h2>
      <div class="funnel card" role="table" aria-label="משפך הטעימה">
        @for (s of steps(); track s.label) {
          <div class="step" role="row">
            <span class="s-label" role="cell">{{ s.label }}</span>
            <span class="s-bar" role="cell"><i [style.width.%]="s.width"></i></span>
            <b role="cell">{{ s.count }}</b>
            <small role="cell">{{ s.rate }}</small>
          </div>
        }
      </div>

      <div class="cards">
        <div class="stat card"><span>שיעור התחלה</span><b>{{ d.rates.start }}%</b><small>נכנסו לחדר מתוך מי שראו את הטעימה בדף הבית</small></div>
        <div class="stat card"><span>שיעור השלמה</span><b>{{ d.rates.completion }}%</b><small>פתחו את הדלת מתוך מי שנכנסו</small></div>
        <div class="stat card"><span>מעבר למשחקים</span><b>{{ d.rates.product }}%</b><small>לחצו על משחק מתוך מי שראו את ההצעה</small></div>
        <div class="stat card"><span>שיעור רכישה</span><b>{{ d.rates.purchase }}%</b><small>רכשו מתוך מי שהתחילו רכישה · {{ d.rates.overall }}% מכל הנכנסים</small></div>
        <div class="stat card"><span>הכנסות מהטעימה</span><b>{{ money(d.funnel.revenue) }}</b><small>תשלומים מאומתים בלבד, פחות החזרים @if (d.funnel.testPurchases) { · {{ d.funnel.testPurchases }} רכישות בדיקה לא נספרו }</small></div>
        <div class="stat card"><span>זמן פתרון</span><b>{{ duration(d.time.averageSeconds) }}</b><small>ממוצע · חציון {{ duration(d.time.medianSeconds) }}</small></div>
        <div class="stat card"><span>ביקשו רמז</span><b>{{ d.rates.hints }}%</b><small>ממוצע {{ d.time.averageHints ?? '—' }} רמזים לשחקן · {{ d.time.averageAttempts ?? '—' }} ניסיונות קוד עד הפתרון</small></div>
        <div class="stat card"><span>לא סיימו</span><b>{{ d.rates.abandoned }}%</b><small>{{ d.leftPage }} מהם יצאו מהדף באמצע</small></div>
      </div>

      <div class="charts">
        <px-stat-chart [title]="'חשיפה, כניסה ופתרון ' + bucketName()" subtitle="נכנסו ופתרו לפי יום הכניסה לחדר" [series]="flowSeries" [rows]="flowRows()" />
        <px-stat-chart [title]="'רכישות מהטעימה ' + bucketName()" subtitle="רכישות ששולמו בפועל, לפי יום הכניסה לחדר" [series]="buySeries" [rows]="buyRows()" />
        <px-stat-chart title="איפה עוצרים" subtitle="השלב האחרון של מי שלא פתחו את הדלת" rowHeader="שלב" [horizontal]="true" [series]="stopSeries" [rows]="stopRows()" />
        <px-stat-chart title="לפי מכשיר" subtitle="נכנסו, פתרו ורכשו" rowHeader="מכשיר" [horizontal]="true" [series]="groupSeries" [rows]="deviceRows()" />
      </div>

      <h2>גרסאות (A/B)</h2>
      <div class="table-wrap card">
        <table>
          <thead><tr><th>גרסה</th><th>נכנסו</th><th>פתרו</th><th>לחצו על משחק</th><th>רכשו</th><th>שיעור השלמה</th></tr></thead>
          <tbody>
            @for (v of d.variants; track v.key) {
              <tr><td>{{ v.key }}</td><td>{{ v.started }}</td><td>{{ v.completed }}</td><td>{{ v.productClicked }}</td><td>{{ v.purchased }}</td><td>{{ pct(v.completed, v.started) }}</td></tr>
            } @empty { <tr><td colspan="6" class="muted">אין עדיין טעימות בטווח.</td></tr> }
          </tbody>
        </table>
      </div>

      <div class="split">
        <div>
          <h2>משחקים שנרכשו מהטעימה</h2>
          <div class="table-wrap card">
            <table>
              <thead><tr><th>משחק</th><th>רכישות</th><th>הכנסה</th></tr></thead>
              <tbody>
                @for (p of d.products; track p.productId) { <tr><td>{{ p.name }}</td><td>{{ p.purchases }}</td><td>{{ money(p.revenue) }}</td></tr> }
                @empty { <tr><td colspan="3" class="muted">אין עדיין רכישות מהטעימה בטווח.</td></tr> }
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h2>קישורים אישיים</h2>
          <div class="table-wrap card">
            <table>
              <thead><tr><th>קישור</th><th>נכנסו</th><th>פתרו</th><th>רכשו</th></tr></thead>
              <tbody>
                @for (l of d.referrals; track $index) { <tr><td>{{ l.name }}</td><td>{{ l.started }}</td><td>{{ l.completed }}</td><td>{{ l.purchased }}</td></tr> }
                @empty { <tr><td colspan="4" class="muted">אין טעימות שהגיעו דרך קישור אישי בטווח.</td></tr> }
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <h2>טעימות אחרונות</h2>
      <div class="table-wrap card">
        <table>
          <thead><tr><th>מזהה</th><th>התחלה</th><th>מכשיר</th><th>גרסה</th><th>חפצים</th><th>רמזים</th><th>ניסיונות</th><th>זמן פתרון</th><th>הצעה</th><th>משחק שנלחץ</th><th>רכישה</th><th>שלב אחרון</th><th>קישור</th></tr></thead>
          <tbody>
            @for (s of d.sessions; track s.id) {
              <tr>
                <td class="mono">{{ s.id }}</td><td>{{ s.startedAt | date: 'd.M.yy HH:mm' }}</td><td>{{ device(s.device) }}</td><td>{{ s.variant }}</td>
                <td>{{ s.inspected }}/4</td><td>{{ s.hints }}</td><td>{{ s.attempts }}</td><td>{{ s.seconds == null ? '—' : duration(s.seconds) }}</td>
                <td>{{ s.offer ? '✓' : '—' }}</td><td>{{ s.product ?? '—' }}</td>
                <td>{{ s.purchase ?? (s.testPurchase ? 'בדיקה' : s.checkout ? 'התחיל' : '—') }}</td>
                <td>{{ step(s.lastEvent) }}@if (s.leftPage) { <span class="muted"> · יצא</span> }</td><td>{{ s.referral ?? '—' }}</td>
              </tr>
            } @empty { <tr><td colspan="13" class="muted">אין עדיין טעימות בטווח.</td></tr> }
          </tbody>
        </table>
      </div>
      <p class="muted small">טעימות נספרות לפי יום הכניסה לחדר; חשיפות ולחיצות בדף הבית לפי היום שבו קרו. רכישה נספרת רק כשספק הסליקה אישר את התשלום בשרת, ורכישות בדיקה אינן נספרות. לא נשמר מידע אישי על השחקנים.</p>
    }
  `,
  styles: [`
    /* cards, tables, toolbars and headings come from the admin theme (src/admin-theme.scss) */
    .presets { display:flex; flex-wrap:wrap; gap:.35rem; }
    .range { margin-inline-start:auto; }
    .funnel { display:grid; gap:.45rem; padding:1rem; }
    .step { display:grid; grid-template-columns: 9.5rem minmax(0,1fr) 3.5rem 8rem; align-items:center; gap:.7rem; }
    .s-label { color:var(--muted); font-size:.92rem; }
    .s-bar { height:18px; border-radius:6px; background:rgba(255,255,255,.05); overflow:hidden; }
    .s-bar i { display:block; height:100%; min-width:2px; border-radius:6px; background:linear-gradient(90deg, #d9a645, #f2c96a); }
    .step b { color:var(--gold-2); font-size:1.1rem; text-align:end; }
    .step small { color:var(--muted); }
    .cards { margin-top:.8rem; }
    .charts { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:.8rem; margin-top:.8rem; }
    .split { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:.8rem; }
    .mono { font-family:monospace; direction:ltr; }
    .small { font-size:.8rem; }
    @media (max-width: 900px) { .charts, .split { grid-template-columns:1fr; } }
    @media (max-width: 560px) {
      .range { margin-inline-start:0; }
      .step { grid-template-columns: 7rem minmax(0,1fr) 2.6rem; } .step small { grid-column: 1 / -1; margin-top:-.3rem; }
    }
  `],
})
export class AdminTasteComponent {
  private api = inject(AdminApiService);

  presets: { id: Preset; label: string }[] = [
    { id: 'today', label: 'היום' }, { id: 'week', label: 'השבוע האחרון' }, { id: 'month', label: 'החודש האחרון' },
    { id: 'year', label: 'השנה' }, { id: 'custom', label: 'טווח מותאם' },
  ];
  preset = signal<Preset>('month');
  from = signal(addDays(israelToday(), -29));
  to = signal(israelToday());
  bucket = signal<Bucket>('day');
  data = signal<TasteStats | null>(null);
  loading = signal(false);
  error = signal<string | null>(null);

  flowSeries: ChartSeries[] = [
    { key: 'impressions', label: 'ראו בדף הבית', color: GOLD }, { key: 'started', label: 'נכנסו', color: BLUE }, { key: 'completed', label: 'פתרו', color: PINK },
  ];
  buySeries: ChartSeries[] = [{ key: 'purchased', label: 'רכשו', color: GOLD }];
  stopSeries: ChartSeries[] = [{ key: 'count', label: 'שחקנים', color: PINK }];
  groupSeries: ChartSeries[] = [
    { key: 'started', label: 'נכנסו', color: GOLD }, { key: 'completed', label: 'פתרו', color: BLUE }, { key: 'purchased', label: 'רכשו', color: PINK },
  ];

  money = (v: number) => '₪' + (v ?? 0).toLocaleString('he-IL', { maximumFractionDigits: 2 });
  step = (e: string) => STEP[e] ?? e;
  device = (d: string) => DEVICE[d] ?? d;
  pct = (part: number, whole: number) => (whole ? Math.round((1000 * part) / whole) / 10 + '%' : '—');

  duration(s: number | null) {
    if (s == null) return '—';
    const m = Math.floor(s / 60);
    return m ? `${m}:${String(s % 60).padStart(2, '0')} דק׳` : `${s} שנ׳`;
  }

  bucketName = computed(() => ({ day: 'לפי ימים', week: 'לפי שבועות', month: 'לפי חודשים' })[this.bucket()]);

  /** The funnel from the home page to a verified purchase: each bar against the first, each rate against the step before. */
  steps = computed(() => {
    const f = this.data()?.funnel;
    if (!f) return [];
    const list: [string, number][] = [
      ['ראו את הטעימה', f.impressions], ['לחצו "אני רוצה לנסות!"', f.clicks], ['נכנסו לחדר', f.started], ['פתחו את הדלת', f.completed],
      ['ראו את ההצעה', f.offerViewed], ['לחצו על משחק', f.productClicked], ['התחילו רכישה', f.checkoutStarted], ['רכשו (תשלום מאומת)', f.purchased],
    ];
    const top = Math.max(1, ...list.map(([, n]) => n));
    return list.map(([label, count], i) => ({
      label, count, width: (100 * count) / top,
      rate: i === 0 ? '' : list[i - 1][1] ? `${Math.round((1000 * count) / list[i - 1][1]) / 10}% מהשלב הקודם` : '—',
    }));
  });

  private label(start: string) {
    const [y, m, d] = start.split('-');
    return this.bucket() === 'month' ? `${m}/${y.slice(2)}` : `${+d}.${+m}`;
  }

  dayLabel(day: string) {
    const [y, m, d] = day.split('-');
    return `${+d}.${+m}.${y}`;
  }

  flowRows = computed<ChartRow[]>(() => (this.data()?.series ?? []).map((p) => ({
    label: this.label(p.start), values: { impressions: p.impressions, started: p.started, completed: p.completed },
  })));
  buyRows = computed<ChartRow[]>(() => (this.data()?.series ?? []).map((p) => ({ label: this.label(p.start), values: { purchased: p.purchased } })));
  stopRows = computed<ChartRow[]>(() => (this.data()?.stops ?? []).map((s) => ({ label: this.step(s.step), values: { count: s.count } })));
  deviceRows = computed<ChartRow[]>(() => (this.data()?.devices ?? []).map((g) => ({
    label: this.device(g.key), values: { started: g.started, completed: g.completed, purchased: g.purchased },
  })));

  constructor() {
    // entering the tab may show what was read in the last minute; the filters and presets always ask the server
    this.load(true);
  }

  choose(p: Preset) {
    this.preset.set(p);
    if (p === 'custom') return;
    const today = israelToday();
    this.to.set(today);
    this.from.set(p === 'today' ? today : p === 'week' ? addDays(today, -6) : p === 'month' ? addDays(today, -29) : today.slice(0, 4) + '-01-01');
    this.bucket.set(p === 'year' ? 'month' : 'day');
    this.load();
  }

  setBucket(b: Bucket) {
    this.bucket.set(b);
    this.load();
  }

  async load(cached = false) {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.data.set(await (cached ? this.api.cached() : this.api).taste(this.from(), this.to(), this.bucket()));
    } catch (e: any) {
      this.error.set(e.message);
    } finally {
      this.loading.set(false);
    }
  }
}
