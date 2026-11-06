import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { AdminApiService, Statistics } from '../core/admin-api.service';
import { CHART_COLORS, ChartRow, ChartSeries, StatChartComponent } from '../ui/stat-chart.component';

type Preset = 'today' | 'week' | 'month' | 'year' | 'custom';
type Bucket = 'day' | 'week' | 'month';

/** Today in Israel as yyyy-MM-dd (the server counts days in Israel time too). */
function israelToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function addDays(day: string, n: number): string {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const [GOLD, BLUE, PINK] = CHART_COLORS;

/**
 * The "statistics" tab of the admin area: sales, activity, games and personal links in a chosen range, with charts.
 * Every number comes from the server's real tables; an order, a verified payment, a game opened, a game played and a
 * participant are counted apart, and only verified payments (less refunds) are revenue.
 */
@Component({
  selector: 'px-admin-stats',
  imports: [StatChartComponent],
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
    @if (loading() && !data()) { <p class="muted">טוענים נתונים...</p> }

    @if (data(); as d) {
      <h2>מכירות והכנסות</h2>
      <div class="cards">
        <div class="stat card"><span>רכישות ששולמו</span><b>{{ d.sales.purchases }}</b><small>תשלום שאושר מול ספק הסליקה · מתוך {{ d.sales.ordersCreated }} הזמנות שנוצרו</small></div>
        <div class="stat card"><span>הכנסות בפועל</span><b>{{ money(d.sales.net) }}</b><small>{{ money(d.sales.gross) }} ששולמו, פחות {{ money(d.sales.refunds) }} החזרים</small></div>
        <div class="stat card"><span>משחקים שנרכשו ונפתחו</span><b>{{ d.sales.paidGamesOpened }}</b><small>{{ d.sales.paidGamesStarted }} מהם התחילו לשחק</small></div>
        <div class="stat card"><span>הזמנות שלא הושלמו</span><b>{{ d.sales.pending + d.sales.failed + d.sales.cancelled }}</b>
          <small>{{ d.sales.pending }} ממתינות · {{ d.sales.failed }} נכשלו · {{ d.sales.cancelled }} בוטלו · לא נספרות כהכנסה</small></div>
      </div>

      <h2>פעילות</h2>
      <div class="cards">
        <div class="stat card"><span>משחקים שנפתחו</span><b>{{ d.activity.gamesOpened }}</b><small>חדר משחק שנוצר · {{ d.activity.gamesStarted }} התחילו בפועל</small></div>
        <div class="stat card"><span>שחקנים שהשתתפו</span><b>{{ d.activity.participants }}</b><small>מושב במשחק ששוחק בפועל · חזרה לאותו מושב נספרת פעם אחת</small></div>
        <div class="stat card"><span>פתיחות של המשחק החינמי</span><b>{{ d.activity.freeOpened }}</b><small>{{ d.activity.freeStarted }} התחילו · {{ d.activity.freeParticipants }} שחקנים</small></div>
        <div class="stat card"><span>חדרים שהמנהל פתח</span><b>{{ d.activity.adminOpened }}</b><small>ללא תשלום · לא נספרים כמכירה</small></div>
      </div>

      <div class="charts">
        <px-stat-chart [title]="'הכנסות ' + bucketName()" subtitle="תשלומים מאומתים פחות החזרים, לפי יום התשלום" [series]="revenueSeries" [rows]="revenueRows()" [fmt]="moneyFmt" />
        <px-stat-chart [title]="'רכישות ' + bucketName()" subtitle="רכישות ששולמו בפועל" [series]="purchaseSeries" [rows]="purchaseRows()" />
        <px-stat-chart [title]="'פתיחות משחקים ' + bucketName()" subtitle="חדרים שנפתחו, וחדרים שבהם השחקנים נכנסו למשחק" [series]="gamesSeries" [rows]="gamesRows()" />
        <px-stat-chart [title]="'המשחק החינמי ' + bucketName()" subtitle="פתיחות, משחקים שהתחילו ושחקנים" [series]="freeSeries" [rows]="freeRows()" />
      </div>

      <h2>לפי משחק</h2>
      <div class="split">
        <px-stat-chart title="השוואה בין המשחקים" subtitle="רכישות, פתיחות ומשחקים שהתחילו בטווח" rowHeader="משחק" [horizontal]="true" [series]="productSeries" [rows]="productRows()" />
        <div class="table-wrap card">
          <table>
            <thead><tr><th>משחק</th><th>סוג</th><th>נרכש</th><th>הכנסה בפועל</th><th>נפתח</th><th>התחיל</th><th>שחקנים</th></tr></thead>
            <tbody>
              @for (p of d.byProduct; track p.productId) {
                <tr><td>{{ p.name }}</td><td>{{ p.isFree ? 'חינמי' : 'בתשלום' }}</td><td>{{ p.isFree ? '—' : p.purchases }}</td>
                  <td>{{ p.isFree ? '—' : money(p.net) }}</td><td>{{ p.opened }}</td><td>{{ p.started }}</td><td>{{ p.participants }}</td></tr>
              }
              <tr class="sum"><td>בתשלום</td><td></td><td>{{ paidTotals().purchases }}</td><td>{{ money(paidTotals().net) }}</td><td>{{ paidTotals().opened }}</td><td>{{ paidTotals().started }}</td><td>{{ paidTotals().participants }}</td></tr>
              <tr class="sum"><td>חינמי</td><td></td><td>—</td><td>—</td><td>{{ freeTotals().opened }}</td><td>{{ freeTotals().started }}</td><td>{{ freeTotals().participants }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <h2>קישורים אישיים</h2>
      <div class="cards three">
        <div class="stat card"><span>כניסות דרך קישורים אישיים</span><b>{{ d.referrals.visits }}</b><small>ביקור חדש דרך קישור · רענון לא נספר</small></div>
        <div class="stat card"><span>רכישות דרך קישורים</span><b>{{ d.referrals.purchases }}</b><small>ששולמו בפועל · ללא רכישה עצמית</small></div>
        <div class="stat card"><span>משחקים חינמיים דרך קישורים</span><b>{{ d.referrals.freeGames }}</b><small>כל משחק פעם אחת, כשהשחקנים נכנסו אליו</small></div>
      </div>
      <div class="charts">
        <px-stat-chart title="השוואת ביצועי הקישורים" subtitle="עשרת הקישורים המובילים בטווח" rowHeader="קישור" [horizontal]="true" [series]="linkSeries" [rows]="linkRows()" />
        <px-stat-chart [title]="'כניסות דרך קישורים ' + bucketName()" [series]="visitSeries" [rows]="visitRows()" />
      </div>
      @if (d.referrals.links.length) {
        <div class="table-wrap card">
          <table>
            <thead><tr><th>קישור</th><th>כניסות</th><th>רכישות</th><th>משחקים חינמיים</th></tr></thead>
            <tbody>
              @for (l of d.referrals.links; track l.id) { <tr><td>{{ l.name }}</td><td>{{ l.visits }}</td><td>{{ l.purchases }}</td><td>{{ l.freeGames }}</td></tr> }
            </tbody>
          </table>
        </div>
      }
      <p class="muted small">הכנסות: רק תשלומים שספק הסליקה אישר, בניכוי החזרים ביום ההחזר. רכישות בדיקה, הזמנות ממתינות, תשלומים שנכשלו והזמנות שבוטלו אינם נספרים כהכנסה.</p>
    }
  `,
  styles: [`
    .filters { display:flex; flex-wrap:wrap; gap:.6rem 1rem; align-items:flex-end; padding:.8rem 1rem; margin-bottom:1rem; }
    .filters label { display:flex; flex-direction:column; gap:.2rem; font-size:.85rem; color:var(--muted); }
    .presets { display:flex; flex-wrap:wrap; gap:.35rem; }
    .range { margin-inline-start:auto; }
    h2 { font-family:var(--font-title); font-size:1.3rem; margin:1.2rem 0 .6rem; }
    .cards { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:.8rem; }
    .cards.three { grid-template-columns:repeat(3, minmax(0,1fr)); }
    .stat { display:flex; flex-direction:column; gap:.2rem; padding:1rem; }
    .stat span { color:var(--muted); font-size:.9rem; } .stat b { font-size:1.7rem; color:var(--gold-2); } .stat small { color:var(--muted); }
    .charts { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:.8rem; margin-top:.8rem; }
    .table-wrap { overflow-x:auto; padding:0; margin-top:.8rem; }
    /* the game comparison and its table: one above the other, both full width */
    .split { display:flex; flex-direction:column; gap:.8rem; }
    .split .table-wrap { margin-top:0; }
    table { width:100%; border-collapse:collapse; font-size:.9rem; }
    th, td { padding:.5rem .6rem; text-align:start; border-bottom:1px solid rgba(201,162,77,.15); white-space:nowrap; }
    th { background:var(--panel-solid); color:var(--gold-2); }
    tr.sum td { color:var(--muted); font-weight:700; }
    .msg-box { padding:.6rem .9rem; border-radius:10px; background:rgba(255,120,100,.12); color:#ffd2c8; }
    .small { font-size:.8rem; }
    select { background:var(--panel-solid); color:var(--text); border:1px solid var(--line); border-radius:10px; padding:.45rem .6rem; min-height:40px; }
    @media (max-width: 900px) { .cards, .cards.three { grid-template-columns:repeat(2, minmax(0,1fr)); } .charts { grid-template-columns:1fr; } }
    @media (max-width: 560px) { .cards, .cards.three { grid-template-columns:1fr; } .range { margin-inline-start:0; } }
  `],
})
export class AdminStatsComponent {
  private api = inject(AdminApiService);

  presets: { id: Preset; label: string }[] = [
    { id: 'today', label: 'היום' }, { id: 'week', label: 'השבוע האחרון' }, { id: 'month', label: 'החודש האחרון' },
    { id: 'year', label: 'השנה' }, { id: 'custom', label: 'טווח מותאם' },
  ];
  preset = signal<Preset>('month');
  from = signal(addDays(israelToday(), -29));
  to = signal(israelToday());
  bucket = signal<Bucket>('day');
  data = signal<Statistics | null>(null);
  loading = signal(false);
  error = signal<string | null>(null);

  revenueSeries: ChartSeries[] = [{ key: 'revenue', label: 'הכנסה בפועל', color: GOLD }];
  purchaseSeries: ChartSeries[] = [{ key: 'purchases', label: 'רכישות', color: GOLD }];
  gamesSeries: ChartSeries[] = [{ key: 'opened', label: 'נפתחו', color: GOLD }, { key: 'started', label: 'התחילו', color: BLUE }];
  freeSeries: ChartSeries[] = [
    { key: 'opened', label: 'נפתחו', color: GOLD }, { key: 'started', label: 'התחילו', color: BLUE }, { key: 'players', label: 'שחקנים', color: PINK },
  ];
  productSeries: ChartSeries[] = [
    { key: 'purchases', label: 'נרכש', color: GOLD }, { key: 'opened', label: 'נפתח', color: BLUE }, { key: 'started', label: 'התחיל', color: PINK },
  ];
  linkSeries: ChartSeries[] = [
    { key: 'visits', label: 'כניסות', color: GOLD }, { key: 'purchases', label: 'רכישות', color: BLUE }, { key: 'free', label: 'משחקים חינמיים', color: PINK },
  ];
  visitSeries: ChartSeries[] = [{ key: 'visits', label: 'כניסות', color: GOLD }];

  moneyFmt = (v: number) => '₪' + Math.round(v).toLocaleString('he-IL');
  money = (v: number) => '₪' + (v ?? 0).toLocaleString('he-IL', { maximumFractionDigits: 2 });

  bucketName = computed(() => ({ day: 'לפי ימים', week: 'לפי שבועות', month: 'לפי חודשים' })[this.bucket()]);

  private label(start: string) {
    const [y, m, d] = start.split('-');
    if (this.bucket() === 'month') return `${m}/${y.slice(2)}`;
    return `${+d}.${+m}`;
  }

  dayLabel(day: string) {
    const [y, m, d] = day.split('-');
    return `${+d}.${+m}.${y}`;
  }

  private rowsOf(pick: (p: Statistics['series'][number]) => Record<string, number>): ChartRow[] {
    return (this.data()?.series ?? []).map((p) => ({ label: this.label(p.start), values: pick(p) }));
  }

  revenueRows = computed(() => this.rowsOf((p) => ({ revenue: p.revenue })));
  purchaseRows = computed(() => this.rowsOf((p) => ({ purchases: p.purchases })));
  gamesRows = computed(() => this.rowsOf((p) => ({ opened: p.gamesOpened, started: p.gamesStarted })));
  freeRows = computed(() => this.rowsOf((p) => ({ opened: p.freeOpened, started: p.freeStarted, players: p.participants })));
  visitRows = computed(() => this.rowsOf((p) => ({ visits: p.visits })));
  productRows = computed<ChartRow[]>(() => (this.data()?.byProduct ?? []).map((p) => ({
    label: p.name + (p.isFree ? ' (חינמי)' : ''), values: { purchases: p.purchases, opened: p.opened, started: p.started },
  })));
  linkRows = computed<ChartRow[]>(() => (this.data()?.referrals.links ?? []).slice(0, 10)
    .filter((l) => l.visits + l.purchases + l.freeGames > 0)
    .map((l) => ({ label: l.name || '—', values: { visits: l.visits, purchases: l.purchases, free: l.freeGames } })));

  private totals(free: boolean) {
    const list = (this.data()?.byProduct ?? []).filter((p) => p.isFree === free);
    return {
      purchases: list.reduce((a, p) => a + p.purchases, 0), net: list.reduce((a, p) => a + p.net, 0),
      opened: list.reduce((a, p) => a + p.opened, 0), started: list.reduce((a, p) => a + p.started, 0),
      participants: list.reduce((a, p) => a + p.participants, 0),
    };
  }
  paidTotals = computed(() => this.totals(false));
  freeTotals = computed(() => this.totals(true));

  constructor() {
    this.load();
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

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.data.set(await this.api.statistics(this.from(), this.to(), this.bucket()));
    } catch (e: any) {
      this.error.set(e.message);
    } finally {
      this.loading.set(false);
    }
  }
}
