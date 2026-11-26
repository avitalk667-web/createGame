import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, input, OnDestroy, signal, untracked } from '@angular/core';
import { ApiError } from '../core/api.service';

interface CompareRow {
  id: string; name: string; status: string; sentAt?: string | null; sent: number; openers: number; openRate: number | null; clickers: number; clicks: number;
  ctr: number | null; purchases: number; revenue: number;
}
interface Compare { issues: CompareRow[]; attributionDays: number }
interface LinkRow { slot: number; kind: string; category: string; label: string; unique: number; clicks: number; ctr: number | null; automated: number }
interface IssueStats {
  issue: { id: string; name: string; status: string; sendStartedAt?: string | null; sendFinishedAt?: string | null };
  cards: {
    sent: number; failed: number; uncertain: number; openers: number; openRate: number | null; openedByPicture: number;
    automatedOpens: number; testOpens: number; clickToOpen: number | null;
    clickers: number; ctr: number | null; clicks: number; automated: number;
    testClicks: number; purchases: number; revenue: number; currency: string; lastClickAt?: string | null;
  };
  links: LinkRow[];
  automatedReasons: { reason: string; count: number }[];
  days: { day: string; clicks: number; clickers: number }[];
  openDays: { day: string; openers: number }[];
  attributionDays: number;
}
interface RecipientRow {
  email: string; name?: string | null; status: string; sentAt: string; openedAt?: string | null; firstClickAt?: string | null; clicks: number;
  links: string[]; categories: string[]; purchase: 'yes' | 'unknown' | null; orders: { number: number; amount: number; paidAt?: string | null }[];
}
interface Recipients { filter: string; counts: Record<string, number>; rows: RecipientRow[] }

type SortKey = 'date' | 'opens' | 'ctr' | 'clicks' | 'purchases';

async function get<T>(url: string): Promise<T> {
  let res: Response;
  try { res = await fetch(url, { credentials: 'same-origin', headers: { 'X-PortalX-Admin': '1' } }); }
  catch { throw new ApiError('network', 'אין חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב.'); }
  if (res.status === 401) throw new ApiError('unauthorized', 'אין הרשאה. יש להתחבר כמנהל.');
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.code ?? 'error', data?.message ?? 'אירעה שגיאה. נסו שוב.');
  return data as T;
}

const FILTERS: { id: string; label: string }[] = [
  { id: 'all', label: 'כל הנמענים' }, { id: 'opened', label: 'פתחו (הערכה)' }, { id: 'not-opened', label: 'לא נראתה פתיחה' },
  { id: 'clicked', label: 'לחצו' }, { id: 'not-clicked', label: 'לא לחצו' },
  { id: 'game', label: 'לחצו על קישור למשחק' }, { id: 'catalog', label: 'לחצו על קטלוג המשחקים' },
  { id: 'share', label: 'פתחו את הקישור האישי לשיתוף' }, { id: 'purchased', label: 'רכשו אחרי הקלקה' },
];
const CATEGORY: Record<string, string> = { game: 'משחק', catalog: 'קטלוג / אתר', share: 'שיתוף הקישור', other: 'אחר' };
const REASON: Record<string, string> = {
  agent: 'דפדפן של סורק או כלי אוטומטי', head: 'בדיקת קישור בלי פתיחה', prefetch: 'טעינה מוקדמת',
  'too-fast': 'פחות מ־10 שניות אחרי השליחה', burst: 'כמה קישורים באותן שניות',
};
const STATUS: Record<string, string> = { draft: 'טיוטה', sending: 'בשליחה', paused: 'מושהה', sent: 'נשלח' };
const DELIVERY: Record<string, string> = { sent: 'נשלח', failed: 'נכשל', uncertain: 'לא ודאי', sending: 'לא ודאי' };

/**
 * The numbers of the "סודות הפורטל" mailings (admin only): every mailing side by side, and for one mailing its
 * cards, its links, its openings and clicks by day and who opened and clicked. Openings are an estimate (an invisible
 * picture, or a click). Only clicks of real emails by people count; suspected scanner
 * clicks and test emails are shown apart. A purchase counts only when the click's own browser key ties it to the order.
 */
@Component({
  selector: 'px-admin-newsletter-stats',
  imports: [DatePipe, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error()) { <p class="msg-box" role="alert">{{ error() }}</p> }

    <section class="card block" aria-label="השוואה בין הדיוורים">
      <div class="title-row">
        <h3>השוואה בין הדיוורים</h3>
        <span class="muted small">מתעדכן אוטומטית · {{ updated() ? (updated()! | date: 'HH:mm:ss') : '' }}</span>
      </div>
      @if (compare(); as cmp) {
        @if (cmp.issues.length) {
          @if (ctrBars().length) {
            <div class="chart" role="img" [attr.aria-label]="'אחוז הקלקה לפי דיוור: ' + ctrSummary()">
              <p class="chart-title">אחוז הקלקה (CTR) לפי דיוור</p>
              @for (b of ctrBars(); track b.id) {
                <button type="button" class="hbar" (click)="pick(b.id)" [class.on]="selectedId() === b.id">
                  <span class="hbar-label">{{ b.name }}</span>
                  <span class="hbar-track"><span class="hbar-fill" [style.width.%]="b.width"></span>
                    <span class="tip" role="tooltip">{{ b.name }} · {{ b.ctr | number: '1.0-1' }}% · {{ b.clickers }} לחצו מתוך {{ b.sent }}</span></span>
                  <span class="hbar-value">{{ b.ctr | number: '1.0-1' }}%</span>
                </button>
              }
            </div>
          }
          <div class="table-wrap">
            <table>
              <thead><tr>
                <th>דיוור</th>
                <th><button type="button" class="sort" (click)="sortBy('date')">תאריך שליחה {{ arrow('date') }}</button></th>
                <th>נשלחו בהצלחה</th>
                <th><button type="button" class="sort" (click)="sortBy('opens')">פתחו (הערכה) {{ arrow('opens') }}</button></th>
                <th>לחצו (ייחודיים)</th>
                <th><button type="button" class="sort" (click)="sortBy('ctr')">אחוז הקלקה {{ arrow('ctr') }}</button></th>
                <th><button type="button" class="sort" (click)="sortBy('clicks')">הקלקות {{ arrow('clicks') }}</button></th>
                <th><button type="button" class="sort" (click)="sortBy('purchases')">רכישות {{ arrow('purchases') }}</button></th>
                <th>הכנסות</th>
              </tr></thead>
              <tbody>
                @for (r of sorted(); track r.id) {
                  <tr [class.on]="selectedId() === r.id" (click)="pick(r.id)" tabindex="0" (keydown.enter)="pick(r.id)">
                    <td>{{ r.name }} <small class="muted">· {{ status(r.status) }}</small></td>
                    <td>{{ r.sentAt ? (r.sentAt | date: 'd.M.yy HH:mm') : '—' }}</td>
                    <td>{{ r.sent }}</td>
                    <td>{{ r.openers }}@if (r.openRate != null) { <small class="muted">· {{ r.openRate | number: '1.0-1' }}%</small> }</td>
                    <td>{{ r.clickers }}</td>
                    <td>{{ r.ctr == null ? '—' : (r.ctr | number: '1.0-1') + '%' }}</td>
                    <td>{{ r.clicks }}</td><td>{{ r.purchases }}</td><td>₪{{ r.revenue | number: '1.0-2' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <p class="muted small">רכישה נספרת רק כשהתשלום הושלם, בתוך {{ cmp.attributionDays }} ימים מהקלקה, ובאותו דפדפן שבו לחצו על הקישור. רכישות בדיקה והחזרים לא נספרים.</p>
        } @else {
          <p class="muted">עוד לא נשלח אף דיוור לרשימה. הנתונים יופיעו כאן אחרי השליחה הראשונה. הקלקות במיילי בדיקה לא נספרות.</p>
        }
      } @else if (!error()) { <p class="loading">טוענים...</p> }
    </section>

    @if (stats(); as s) {
      <section class="card block" aria-label="הנתונים של הדיוור">
        <div class="title-row">
          <h3>{{ s.issue.name }}</h3>
          <span class="muted small">{{ status(s.issue.status) }}{{ s.issue.sendStartedAt ? ' · נשלח ' + (s.issue.sendStartedAt | date: 'd.M.yy HH:mm') : '' }}</span>
        </div>
        <div class="cards">
          <div class="stat card"><span>נשלחו בהצלחה</span><b>{{ s.cards.sent }}</b>@if (s.cards.uncertain) { <small>{{ s.cards.uncertain }} לא ודאי</small> }</div>
          <div class="stat card"><span>נכשלו בשליחה</span><b>{{ s.cards.failed }}</b></div>
          <div class="stat card"><span>פתחו את המייל (הערכה)</span><b>{{ s.cards.openers }}</b><small>{{ s.cards.openRate == null ? '' : (s.cards.openRate | number: '1.0-1') + '% מהנשלחים' }}</small></div>
          <div class="stat card"><span>מתוך הפותחים — לחצו</span><b>{{ s.cards.clickToOpen == null ? '—' : (s.cards.clickToOpen | number: '1.0-1') + '%' }}</b><small>לחצו ÷ פתחו</small></div>
          <div class="stat card"><span>נמענים ייחודיים שלחצו</span><b>{{ s.cards.clickers }}</b><small>כל נמען נספר פעם אחת</small></div>
          <div class="stat card"><span>אחוז הקלקה (CTR)</span><b>{{ s.cards.ctr == null ? '—' : (s.cards.ctr | number: '1.0-1') + '%' }}</b><small>לחצו ÷ נשלחו בהצלחה</small></div>
          <div class="stat card"><span>סך כל ההקלקות</span><b>{{ s.cards.clicks }}</b><small>כולל הקלקות חוזרות</small></div>
          <div class="stat card"><span>רכישות מיוחסות</span><b>{{ s.cards.purchases }}</b><small>₪{{ s.cards.revenue | number: '1.0-2' }} הכנסות</small></div>
        </div>
        <p class="note small">
          <b>פתיחות הן הערכה:</b> פתיחה נספרת כשתמונה שקופה זעירה במייל נטענת ({{ s.cards.openedByPicture }} מיילים), או כשלחצו על קישור (לחיצה מוכיחה שהמייל נפתח גם כשהתמונות כבויות).
          באייפון ובאפליקציית Mail של אפל התמונות נטענות מראש לשמירת פרטיות, ולכן שם מייל יכול להיספר כ"נפתח" גם בלי שקראו אותו. מי שפותח בלי תמונות ובלי ללחוץ לא נספר.
          לא נספרו: {{ s.cards.automatedOpens }} טעינות שנראות אוטומטיות · {{ s.cards.testOpens }} במיילי בדיקה.
        </p>
        <p class="note small">
          לא נספרו כאנשים: {{ s.cards.automated }} הקלקות שנראות אוטומטיות (סורקי אבטחה של תיבות דואר)@if (s.automatedReasons.length) { — @for (a of s.automatedReasons; track a.reason; let last = $last) {{{ reason(a.reason) }}: {{ a.count }}{{ last ? '' : ' · ' }}} }
          · {{ s.cards.testClicks }} הקלקות במיילי בדיקה.
          @if (s.cards.lastClickAt) { הקלקה אחרונה: {{ s.cards.lastClickAt | date: 'd.M.yy HH:mm' }}. }
        </p>

        <h4>ביצועים לפי קישור</h4>
        <div class="table-wrap">
          <table>
            <thead><tr><th>קישור</th><th>סוג</th><th>נמענים ייחודיים</th><th>הקלקות כוללות</th><th>אחוז הקלקה</th><th>אוטומטיות</th></tr></thead>
            <tbody>
              @for (l of s.links; track l.slot) {
                <tr><td class="wrap">{{ l.label }}</td><td>{{ category(l.category) }}</td><td>{{ l.unique }}</td><td>{{ l.clicks }}</td>
                  <td>{{ l.ctr == null ? '—' : (l.ctr | number: '1.0-1') + '%' }}</td><td class="muted">{{ l.automated }}</td></tr>
              } @empty { <tr><td colspan="6" class="muted">לדיוור הזה עוד אין קישורים במעקב (הם נוצרים בשליחת הבדיקה הראשונה).</td></tr> }
            </tbody>
          </table>
        </div>

        @if (s.openDays.length) {
          <h4>פתיחות ראשונות לפי יום (הערכה)</h4>
          <div class="vchart" role="img" [attr.aria-label]="'פתיחות לפי יום: ' + openDaySummary()">
            @for (d of openDayBars(); track d.day) {
              <div class="vcol">
                <span class="vvalue">{{ d.openers }}</span>
                <span class="vtrack"><span class="vfill" [style.height.%]="d.height"></span>
                  <span class="tip" role="tooltip">{{ d.label }} · {{ d.openers }} פתחו לראשונה</span></span>
                <span class="vlabel">{{ d.label }}</span>
              </div>
            }
          </div>
        }

        @if (s.days.length) {
          <h4>הקלקות לפי יום</h4>
          <div class="vchart" role="img" [attr.aria-label]="'הקלקות לפי יום: ' + daySummary()">
            @for (d of dayBars(); track d.day) {
              <div class="vcol">
                <span class="vvalue">{{ d.clicks }}</span>
                <span class="vtrack"><span class="vfill" [style.height.%]="d.height"></span>
                  <span class="tip" role="tooltip">{{ d.label }} · {{ d.clicks }} הקלקות · {{ d.clickers }} נמענים</span></span>
                <span class="vlabel">{{ d.label }}</span>
              </div>
            }
          </div>
        }

        <h4>מי פתח ומי לחץ</h4>
        <div class="chips" role="group" aria-label="סינון נמענים">
          @for (f of filters; track f.id) {
            <button type="button" class="btn small" [class.on]="filter() === f.id" (click)="setFilter(f.id)">
              {{ f.label }}@if (recipients(); as r) { <span class="count">{{ r.counts[f.id] }}</span> }</button>
          }
        </div>
        @if (recipients(); as r) {
          <div class="table-wrap people">
            <table>
              <thead><tr><th>נמען</th><th>משלוח</th><th>נפתח (הערכה)</th><th>הקלקה ראשונה</th><th>הקלקות</th><th>קישורים</th><th>רכישה</th></tr></thead>
              <tbody>
                @for (p of r.rows; track p.email) {
                  <tr>
                    <td><span dir="ltr">{{ p.email }}</span>@if (p.name) { <small class="muted"> · {{ p.name }}</small> }</td>
                    <td>{{ delivery(p.status) }}</td>
                    <td>{{ p.openedAt ? (p.openedAt | date: 'd.M.yy HH:mm') : '—' }}</td>
                    <td>{{ p.firstClickAt ? (p.firstClickAt | date: 'd.M.yy HH:mm') : '—' }}</td>
                    <td>{{ p.clicks }}</td>
                    <td class="wrap">{{ p.links.length ? p.links.join(' · ') : '—' }}</td>
                    <td>
                      @if (p.purchase === 'yes') { @for (o of p.orders; track o.number) { <span class="buy">✓ הזמנה {{ o.number }} · ₪{{ o.amount | number: '1.0-2' }}</span> } }
                      @else if (p.purchase === 'unknown') { <span class="muted" title="אותה כתובת רכשה אחרי ההקלקה, אבל לא באותו דפדפן — אין ראיה שהרכישה הגיעה מהדיוור">לא ניתן לשייך</span> }
                      @else { — }
                    </td>
                  </tr>
                } @empty { <tr><td colspan="7" class="muted">אין נמענים בסינון הזה.</td></tr> }
              </tbody>
            </table>
          </div>
        } @else { <p class="loading">טוענים...</p> }
      </section>
    }
  `,
  styles: [`
    .block { padding:1rem; margin-top:1rem; }
    .title-row { display:flex; gap:.8rem; align-items:baseline; flex-wrap:wrap; justify-content:space-between; }
    h3 { margin:0 0 .6rem; font-size:1.05rem; color:var(--gold-2); }
    h4 { margin:1.1rem 0 .4rem; font-size:.95rem; color:var(--gold-2); }
    .small { font-size:.82rem; }
    .cards { margin:.4rem 0 .6rem; }
    td.wrap { white-space:normal; min-width:160px; }
    tbody tr[tabindex] { cursor:pointer; }
    tr.on td { background:rgba(224,185,92,.12); }
    .sort { background:none; border:0; color:inherit; font:inherit; cursor:pointer; padding:0; }
    .note { background:rgba(224,185,92,.08); border-right:3px solid var(--gold-dark); padding:.5rem .7rem; border-radius:8px; }
    .people { max-height:420px; }
    .buy { color:var(--ok); display:block; }
    .chips { display:flex; gap:.4rem; flex-wrap:wrap; margin:.3rem 0 .6rem; }
    .chips .btn.on { border-color:var(--gold); color:var(--gold-2); }
    .count { display:inline-block; margin-inline-start:.35rem; padding:0 .4rem; border-radius:999px; background:rgba(255,255,255,.08); font-size:.75rem; }

    /* charts: one series, one hue (validated against the panel), thin bars with rounded ends, values in text colour */
    .chart { margin:.2rem 0 1rem; }
    .chart-title { margin:0 0 .4rem; font-size:.85rem; color:var(--muted); }
    .hbar { display:grid; grid-template-columns:minmax(90px,200px) 1fr 3.6rem; gap:.6rem; align-items:center; width:100%; padding:.25rem 0;
      background:none; border:0; color:var(--text); font:inherit; font-size:.85rem; cursor:pointer; text-align:right; }
    .hbar-label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .hbar-track { position:relative; height:14px; border-inline-start:1px solid rgba(255,255,255,.18); }
    /* the bar grows from the right (RTL): only its far (left) end is rounded */
    .hbar-fill { position:absolute; inset-block:2px; inset-inline-start:0; min-width:2px; background:#b08330; border-radius:4px 0 0 4px; }
    .hbar:hover .hbar-fill, .hbar.on .hbar-fill { background:#c99a3c; }
    .hbar-value { color:var(--text); font-variant-numeric:tabular-nums; text-align:left; }
    .vchart { display:flex; gap:6px; align-items:flex-end; overflow-x:auto; padding:.2rem 0 .4rem; border-bottom:1px solid rgba(255,255,255,.18); }
    .vcol { display:flex; flex-direction:column; align-items:center; gap:.2rem; min-width:42px; font-size:.75rem; }
    .vtrack { position:relative; width:16px; height:110px; display:flex; align-items:flex-end; }
    .vfill { display:block; width:100%; min-height:2px; background:#b08330; border-radius:4px 4px 0 0; }
    .vcol:hover .vfill { background:#c99a3c; }
    .vvalue { color:var(--text); font-variant-numeric:tabular-nums; }
    .vlabel { color:var(--muted); white-space:nowrap; }
    .tip { position:absolute; bottom:calc(100% + 6px); inset-inline-start:0; z-index:3; display:none; white-space:nowrap; padding:.3rem .55rem;
      background:var(--panel-solid); border:1px solid var(--line); border-radius:8px; color:var(--text); font-size:.78rem; box-shadow:var(--shadow); pointer-events:none; }
    .hbar:hover .tip, .hbar:focus-visible .tip, .vcol:hover .tip { display:block; }
    @media (max-width: 640px) { .hbar { grid-template-columns:90px 1fr 3.2rem; } }
  `],
})
export class AdminNewsletterStatsComponent implements OnDestroy {
  /** The mailing to open first (from the editor's "נתונים" button). */
  readonly issueId = input<string | null>(null);

  readonly filters = FILTERS;
  compare = signal<Compare | null>(null);
  stats = signal<IssueStats | null>(null);
  recipients = signal<Recipients | null>(null);
  selectedId = signal<string | null>(null);
  filter = signal('all');
  sortKey = signal<SortKey>('date');
  sortDir = signal<1 | -1>(-1);
  error = signal<string | null>(null);
  updated = signal<Date | null>(null);
  private poll: ReturnType<typeof setInterval> | null = null;

  sorted = computed(() => {
    const rows = [...(this.compare()?.issues ?? [])];
    const k = this.sortKey(), dir = this.sortDir();
    const v = (r: CompareRow) => k === 'date' ? (r.sentAt ? Date.parse(r.sentAt) : 0) : k === 'opens' ? (r.openRate ?? -1) : k === 'ctr' ? (r.ctr ?? -1) : k === 'clicks' ? r.clicks : r.purchases;
    return rows.sort((a, b) => (v(a) - v(b)) * dir);
  });

  /** Mailings that were sent to someone, oldest first, as bars on a 0..max scale (never cut at zero). */
  ctrBars = computed(() => {
    const rows = (this.compare()?.issues ?? []).filter((r) => r.sent > 0)
      .sort((a, b) => (a.sentAt ? Date.parse(a.sentAt) : 0) - (b.sentAt ? Date.parse(b.sentAt) : 0));
    const max = Math.max(1, ...rows.map((r) => r.ctr ?? 0));
    return rows.map((r) => ({ id: r.id, name: r.name, ctr: r.ctr ?? 0, clickers: r.clickers, sent: r.sent, width: ((r.ctr ?? 0) / max) * 100 }));
  });
  ctrSummary = computed(() => this.ctrBars().map((b) => `${b.name} ${b.ctr}%`).join(', '));

  dayBars = computed(() => {
    const days = this.stats()?.days ?? [];
    const max = Math.max(1, ...days.map((d) => d.clicks));
    return days.map((d) => ({ ...d, label: d.day.slice(8, 10) + '.' + d.day.slice(5, 7), height: (d.clicks / max) * 100 }));
  });
  daySummary = computed(() => this.dayBars().map((d) => `${d.label}: ${d.clicks}`).join(', '));

  openDayBars = computed(() => {
    const days = this.stats()?.openDays ?? [];
    const max = Math.max(1, ...days.map((d) => d.openers));
    return days.map((d) => ({ ...d, label: d.day.slice(8, 10) + '.' + d.day.slice(5, 7), height: (d.openers / max) * 100 }));
  });
  openDaySummary = computed(() => this.openDayBars().map((d) => `${d.label}: ${d.openers}`).join(', '));

  constructor() {
    effect(() => {
      const id = this.issueId();
      untracked(() => { if (id) this.pick(id); });
    });
    this.loadCompare();
    // the numbers follow new clicks without reloading the page
    this.poll = setInterval(() => this.refreshAll(), 20000);
  }
  ngOnDestroy() { if (this.poll) clearInterval(this.poll); }

  status(s: string) { return STATUS[s] ?? s; }
  category(c: string) { return CATEGORY[c] ?? c; }
  reason(r: string) { return REASON[r] ?? r; }
  delivery(s: string) { return DELIVERY[s] ?? s; }
  arrow(k: SortKey) { return this.sortKey() === k ? (this.sortDir() === -1 ? '▼' : '▲') : ''; }
  sortBy(k: SortKey) {
    if (this.sortKey() === k) this.sortDir.set(this.sortDir() === -1 ? 1 : -1);
    else { this.sortKey.set(k); this.sortDir.set(-1); }
  }

  private fail(e: unknown) { this.error.set(e instanceof Error ? e.message : 'אירעה שגיאה.'); }

  async loadCompare() {
    try {
      this.compare.set(await get<Compare>('/api/admin/newsletters/compare'));
      this.updated.set(new Date());
      this.error.set(null);
    } catch (e) { this.fail(e); }
  }

  async pick(id: string) {
    if (this.selectedId() !== id) { this.selectedId.set(id); this.stats.set(null); this.recipients.set(null); this.filter.set('all'); }
    await this.loadIssue();
  }

  private async loadIssue() {
    const id = this.selectedId();
    if (!id) return;
    try {
      const [s, r] = await Promise.all([
        get<IssueStats>(`/api/admin/newsletters/${id}/stats`),
        get<Recipients>(`/api/admin/newsletters/${id}/stats/recipients?filter=${encodeURIComponent(this.filter())}`),
      ]);
      if (this.selectedId() !== id) return;
      this.stats.set(s);
      this.recipients.set(r);
      this.updated.set(new Date());
    } catch (e) { this.fail(e); }
  }

  async setFilter(f: string) {
    this.filter.set(f);
    this.recipients.set(null);
    await this.loadIssue();
  }

  private refreshAll() {
    if (document.hidden) return;
    this.loadCompare();
    this.loadIssue();
  }
}
