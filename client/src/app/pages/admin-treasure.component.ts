import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, Injectable, signal } from '@angular/core';
import { ApiError } from '../core/api.service';

export interface TreasurePrizeConfig {
  key: string; kind: 'none' | 'percent' | 'gift'; name: string; weight: number; active: boolean;
  discountPercent?: number | null; validityDays: number; maxWins?: number | null; budgetIls?: number | null;
  title: string; message: string; animation: 'chest' | 'glow' | 'simple';
}

export interface TreasureConfigView {
  id: number; enabled: boolean; fallbackKey: string; prizes: TreasurePrizeConfig[]; createdAt: string; createdBy: string;
  totalWeight: number; animations: string[];
  given: { key: string; count: number; cost: number }[];
  history: { id: number; enabled: boolean; createdBy: string; createdAt: string; isActive: boolean }[];
}

export interface TreasureGiftRow { id: string; name: string; coverImage: string; priceIls?: number | null; status: string; playable: boolean; selected: boolean }

export interface TreasureStats {
  participated: number; wins: number; winRate: number; fallbacks: number;
  byPrize: { key: string; count: number; fallback: number }[];
  couponsCreated: number; couponsRedeemed: number; couponsExpired: number; redemptionRate: number;
  giftsGranted: number; giftsOpened: number; revoked: number;
  totalCost: number; giftCost: number; discountGiven: number; committedCost: number; couponRevenue: number;
  repeatWithCoupon: number; repeatWithCouponRevenue: number; repeatWithoutCoupon: number; repeatWithoutCouponRevenue: number;
  avgHoursToRepeat?: number | null; unrevealed: number; withoutEmail: number;
}

export interface TreasureWinRow {
  id: string; at: string; orderId: string; orderNumber: number; game: string; email?: string | null;
  prizeKey: string; prizeKind: string; drawnKey: string; isFallback: boolean; fallbackReason?: string | null; status: string; isTest: boolean;
  revealedAt?: string | null; couponCode?: string | null; couponPercent?: number | null; couponExpiresAt?: string | null; couponStatus: string;
  redeemedOrderNumber?: number | null; giftGame?: string | null; giftStatus: string; cost: number;
}

export interface TreasureFilters { from?: string; to?: string; status?: string; search?: string; includeTest?: boolean }

function query(f: TreasureFilters) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== null && v !== '' && v !== false) p.set(k, String(v));
  const s = p.toString();
  return s ? '?' + s : '';
}

/** The "תיבת האוצר" admin API (/api/admin/treasure/*), with the same session, CSRF header and errors as the rest of the admin area. */
@Injectable({ providedIn: 'root' })
export class AdminTreasureApi {
  private async request<T>(method: string, url: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(url, {
        method, credentials: 'same-origin',
        headers: { 'X-PortalX-Admin': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError('network', 'אין חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב.');
    }
    if (res.status === 401) throw new ApiError('unauthorized', 'אין הרשאה. יש להתחבר כמנהל.');
    if (res.status === 403) throw new ApiError('forbidden', 'אין הרשאה.');
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(data?.code ?? 'error', data?.message ?? 'אירעה שגיאה. נסו שוב.');
    return data as T;
  }
  config() { return this.request<TreasureConfigView>('GET', '/api/admin/treasure/config'); }
  saveConfig(body: { enabled: boolean; fallbackKey: string; prizes: TreasurePrizeConfig[] }) { return this.request<{ id: number }>('PUT', '/api/admin/treasure/config', body); }
  gifts() { return this.request<TreasureGiftRow[]>('GET', '/api/admin/treasure/gifts'); }
  setGift(id: string, selected: boolean) { return this.request<void>('PUT', `/api/admin/treasure/gifts/${encodeURIComponent(id)}`, { selected }); }
  stats(f: TreasureFilters) { return this.request<TreasureStats>('GET', '/api/admin/treasure/stats' + query(f)); }
  wins(f: TreasureFilters) { return this.request<{ total: number; rows: TreasureWinRow[] }>('GET', '/api/admin/treasure/wins' + query(f)); }
  csvUrl(f: TreasureFilters) { return '/api/admin/treasure/wins.csv' + query(f); }
}

const KIND: Record<string, string> = { none: 'ללא פרס', percent: 'הנחה באחוזים', gift: 'משחק מתנה' };
const ANIM: Record<string, string> = { chest: 'פתיחת תיבה', glow: 'תיבה עם קרני אור', simple: 'פשוטה (ללא אנימציה)' };
const REASON: Record<string, string> = { limit: 'מגבלת חלוקה', budget: 'מגבלת תקציב', inactive: 'הפרס כבוי', 'no-gift-game': 'אין משחק מתנה מתאים' };
const STATUS: Record<string, string> = {
  active: 'פעיל', redeemed: 'מומש', expired: 'פג תוקף', cancelled: 'בוטל', granted: 'הוענק', opened: 'נפתח משחק', revoked: 'בוטל',
  noprize: 'ללא פרס', coupon: 'קופון', gift: 'מתנה',
};

/**
 * The admin's "תיבת האוצר" tab: the numbers, the prizes and their chances (saved as a new version only when they add up to
 * 100%), the games offered as gifts, and the history of every draw with search, filters and CSV export.
 */
@Component({
  selector: 'px-admin-treasure',
  imports: [DatePipe, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error()) { <p class="msg-box" role="alert">{{ error() }}</p> }

    <!-- the numbers -->
    <section class="section" aria-labelledby="tr-stats">
      <div class="bar">
        <h2 id="tr-stats">מדדים</h2>
        <label class="check"><input type="checkbox" [checked]="f().includeTest" (change)="setF('includeTest', $any($event.target).checked)" /> כולל רכישות בדיקה</label>
      </div>
      @if (stats(); as s) {
        <div class="cards">
          <div class="stat"><span>רכישות שהשתתפו</span><b>{{ s.participated }}</b><small>הגרלה אחת לכל רכישה ששולמה</small></div>
          <div class="stat accent"><span>זכיות</span><b>{{ s.wins }}</b><small>{{ s.winRate }}% בפועל · {{ s.fallbacks }} דרך פרס הגיבוי</small></div>
          <div class="stat"><span>קופונים שנוצרו</span><b>{{ s.couponsCreated }}</b><small>{{ s.couponsExpired }} פגו</small></div>
          <div class="stat"><span>קופונים שמומשו</span><b>{{ s.couponsRedeemed }}</b><small>{{ s.redemptionRate }}% מימוש</small></div>
          <div class="stat"><span>משחקי מתנה שחולקו</span><b>{{ s.giftsGranted }}</b><small>{{ s.giftsOpened }} כבר נפתחו כמשחק · {{ s.revoked }} פרסים בוטלו בהחזר</small></div>
          <div class="stat"><span>עלות ההטבות בפועל</span><b>{{ s.totalCost | number: '1.0-2' }} ₪</b><small>מתנות {{ s.giftCost | number: '1.0-2' }} ₪ · הנחות {{ s.discountGiven | number: '1.0-2' }} ₪</small></div>
          <div class="stat accent"><span>הכנסות מרכישות חוזרות עם קופון</span><b>{{ s.repeatWithCouponRevenue | number: '1.0-2' }} ₪</b><small>{{ s.repeatWithCoupon }} רכישות</small></div>
          <div class="stat"><span>רכישות חוזרות בלי הקופון</span><b>{{ s.repeatWithoutCoupon }}</b><small>{{ s.repeatWithoutCouponRevenue | number: '1.0-2' }} ₪</small></div>
          <div class="stat"><span>זמן ממוצע עד רכישה חוזרת</span><b>{{ s.avgHoursToRepeat == null ? '—' : hours(s.avgHoursToRepeat) }}</b><small>מהזכייה לרכישה הבאה באותה כתובת</small></div>
        </div>
        @if (s.byPrize.length) {
          <p class="note">לפי פרס: @for (b of s.byPrize; track b.key) { <span class="pill">{{ prizeName(b.key) }} · {{ b.count }}</span> }</p>
        }
        <p class="note">התחייבות מרבית (אם כל הקופונים ימומשו על המשחק היקר): {{ s.committedCost | number: '1.0-2' }} ₪. {{ s.unrevealed }} תיבות עם פרס עדיין לא נפתחו. רכישה חוזרת מזוהה לפי כתובת הדוא״ל{{ s.withoutEmail ? ' (' + s.withoutEmail + ' זכיות בלי כתובת לא נספרות)' : '' }}.</p>
      }
    </section>

    <!-- the prizes -->
    <section class="section" aria-labelledby="tr-prizes">
      @if (draft(); as d) {
        <div class="bar">
          <h2 id="tr-prizes">פרסים וסיכויים</h2>
          <label class="check switch"><input type="checkbox" [checked]="d.enabled" (change)="patch({ enabled: $any($event.target).checked })" />
            <b>{{ d.enabled ? 'תיבת האוצר פעילה' : 'תיבת האוצר כבויה' }}</b></label>
        </div>
        <div class="table-wrap">
          <table class="prizes">
            <thead><tr><th>פעיל</th><th>שם</th><th>סוג</th><th>סיכוי (%)</th><th>הנחה (%)</th><th>תוקף (ימים)</th><th>מגבלת חלוקה</th><th>תקציב (₪)</th><th>אנימציה</th><th>כותרת והסבר ללקוח</th></tr></thead>
            <tbody>
              @for (p of d.prizes; track p.key; let i = $index) {
                <tr [class.off]="!p.active">
                  <td><input type="checkbox" [checked]="p.active" (change)="edit(i, { active: $any($event.target).checked })" [attr.aria-label]="'פעיל: ' + p.name" /></td>
                  <td><input class="w-name" [value]="p.name" (input)="edit(i, { name: $any($event.target).value })" aria-label="שם הפרס" /><small class="muted" dir="ltr">{{ p.key }}</small></td>
                  <td>{{ kind(p.kind) }}</td>
                  <td><input class="w-num" type="number" min="0" max="100" step="0.01" [value]="p.weight / 100" (input)="edit(i, { weight: pct($any($event.target).value) })" aria-label="סיכוי באחוזים" /></td>
                  <td>@if (p.kind === 'percent') { <input class="w-num" type="number" min="1" max="99" [value]="p.discountPercent" (input)="edit(i, { discountPercent: num($any($event.target).value) })" aria-label="אחוז הנחה" /> } @else { — }</td>
                  <td>@if (p.kind === 'percent') { <input class="w-num" type="number" min="1" max="365" [value]="p.validityDays" (input)="edit(i, { validityDays: num($any($event.target).value) ?? 30 })" aria-label="תוקף בימים" /> } @else { — }</td>
                  <td>@if (p.kind !== 'none') { <input class="w-num" type="number" min="0" placeholder="ללא" [value]="p.maxWins ?? ''" (input)="edit(i, { maxWins: num($any($event.target).value) })" aria-label="מגבלת חלוקה" /><small class="muted">חולקו {{ given(p.key) }}</small> } @else { — }</td>
                  <td>@if (p.kind !== 'none') { <input class="w-num" type="number" min="0" placeholder="ללא" [value]="p.budgetIls ?? ''" (input)="edit(i, { budgetIls: num($any($event.target).value) })" aria-label="מגבלת תקציב" /> } @else { — }</td>
                  <td><select [value]="p.animation" (change)="edit(i, { animation: $any($event.target).value })" aria-label="סוג אנימציה">
                    @for (a of animations; track a) { <option [value]="a" [selected]="a === p.animation">{{ anim(a) }}</option> }</select></td>
                  <td class="texts">
                    <input [value]="p.title" maxlength="120" (input)="edit(i, { title: $any($event.target).value })" aria-label="כותרת" placeholder="כותרת" />
                    <textarea rows="2" maxlength="400" (input)="edit(i, { message: $any($event.target).value })" aria-label="הסבר" placeholder="הסבר">{{ p.message }}</textarea>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <div class="bar save">
          <span [class.bad]="sum() !== 10000" [class.ok]="sum() === 10000" role="status">סכום הסיכויים של הפרסים הפעילים: <b>{{ sum() / 100 | number: '1.0-2' }}%</b>{{ sum() !== 10000 ? ' — חייב להיות 100% בדיוק' : '' }}</span>
          <label>פרס גיבוי
            <select [value]="d.fallbackKey" (change)="patch({ fallbackKey: $any($event.target).value })">
              <option value="none" [selected]="d.fallbackKey === 'none'">ללא פרס</option>
              @for (p of d.prizes; track p.key) { @if (p.kind === 'percent' && p.active) { <option [value]="p.key" [selected]="d.fallbackKey === p.key">{{ p.name }}</option> } }
            </select>
          </label>
          <button class="btn primary" (click)="save()" [disabled]="busy() || sum() !== 10000 || !dirty()">שמירת גרסה חדשה</button>
          @if (dirty()) { <button class="btn ghost small" (click)="reset()">ביטול השינויים</button> }
        </div>
        @if (saved()) { <p class="msg-box ok" role="status">{{ saved() }}</p> }
        <p class="note">פרס הגיבוי ניתן כשהפרס שהוגרל אינו זמין: הגיע למגבלה או לתקציב, או שאין משחק מתנה שהלקוח עדיין לא מחזיק בו. שמירה יוצרת גרסה חדשה; כל הגרלה שומרת את הגרסה שהייתה בתוקף בזמן התשלום, ולכן שינוי לא משנה זכיות קודמות.</p>
        @if (config()?.history?.length) {
          <details><summary>גרסאות אחרונות</summary>
            <ul class="hist">@for (h of config()!.history; track h.id) { <li>#{{ h.id }} · {{ h.createdAt | date: 'd.M.yyyy HH:mm' }} · {{ h.createdBy }} · {{ h.enabled ? 'פעילה' : 'כבויה' }}{{ h.isActive ? ' · בתוקף עכשיו' : '' }}</li> }</ul>
          </details>
        }
      } @else { <p class="loading">טוענים את ההגדרות…</p> }
    </section>

    <!-- the gift games -->
    <section class="section" aria-labelledby="tr-gifts">
      <h2 id="tr-gifts">משחקים זמינים כמתנה</h2>
      <p class="note">משחק המתנה נבחר באקראי מבין המשחקים המסומנים, ולעולם לא משחק שהלקוח כבר מחזיק (שנרכש באותה כתובת, או זה שנרכש עכשיו).</p>
      <ul class="gifts">
        @for (g of gifts(); track g.id) {
          <li>
            <label class="check"><input type="checkbox" [checked]="g.selected" (change)="toggleGift(g, $any($event.target).checked)" [disabled]="busy()" />
              <b>{{ g.name }}</b> <span class="muted">{{ g.priceIls ? g.priceIls + ' ₪' : 'ללא מחיר' }}{{ g.status !== 'published' || !g.playable ? ' · לא זמין כרגע ולכן לא יוגרל' : '' }}</span></label>
          </li>
        } @empty { <li class="muted">אין משחקים בתשלום בקטלוג.</li> }
      </ul>
    </section>

    <!-- the history -->
    <section class="section" aria-labelledby="tr-hist">
      <div class="bar">
        <h2 id="tr-hist">היסטוריית זכיות</h2>
        <a class="btn small" [href]="csvUrl()" download>ייצוא CSV</a>
      </div>
      <div class="filters">
        <label>מתאריך <input type="date" [value]="f().from ?? ''" (change)="setF('from', $any($event.target).value)" /></label>
        <label>עד תאריך <input type="date" [value]="f().to ?? ''" (change)="setF('to', $any($event.target).value)" /></label>
        <label>הצגה
          <select (change)="setF('status', $any($event.target).value)">
            <option value="">הכול</option><option value="won">זכיות בלבד</option><option value="none">ללא פרס</option><option value="coupon">קופונים</option>
            <option value="redeemed">קופונים שמומשו</option><option value="gift">משחקי מתנה</option><option value="fallback">דרך פרס הגיבוי</option><option value="revoked">בוטלו בהחזר</option>
          </select>
        </label>
        <label>חיפוש <input placeholder="מספר הזמנה, דוא״ל או קוד" [value]="f().search ?? ''" (change)="setF('search', $any($event.target).value)" /></label>
      </div>
      @if (wins(); as w) {
        <div class="table-wrap">
          <table>
            <thead><tr><th>תאריך</th><th>הזמנה</th><th>משחק שנרכש</th><th>דוא״ל</th><th>פרס</th><th>קוד קופון</th><th>סטטוס מימוש</th><th>משחק מתנה</th><th>סטטוס הענקה</th><th>נחשף</th></tr></thead>
            <tbody>
              @for (r of w.rows; track r.id) {
                <tr [class.test]="r.isTest">
                  <td>{{ r.at | date: 'd.M.yyyy HH:mm' }}</td>
                  <td>{{ r.orderNumber }}@if (r.isTest) { <small class="muted"> · בדיקה</small> }</td>
                  <td>{{ r.game }}</td>
                  <td dir="ltr">{{ r.email ?? '—' }}</td>
                  <td>{{ prizeName(r.prizeKey) }}@if (r.isFallback) { <small class="muted"> · גיבוי ({{ reason(r.fallbackReason) }}; הוגרל: {{ prizeName(r.drawnKey) }})</small> }</td>
                  <td dir="ltr">{{ r.couponCode ?? '—' }}</td>
                  <td>{{ r.couponCode ? status(r.couponStatus) + (r.redeemedOrderNumber ? ' · הזמנה ' + r.redeemedOrderNumber : '') : '—' }}</td>
                  <td>{{ r.giftGame ?? '—' }}</td>
                  <td>{{ r.giftGame ? status(r.giftStatus) : r.status === 'revoked' ? 'בוטל' : '—' }}</td>
                  <td>{{ r.revealedAt ? (r.revealedAt | date: 'd.M HH:mm') : (r.prizeKind === 'none' ? '—' : 'עדיין לא') }}</td>
                </tr>
              } @empty { <tr><td colspan="10" class="muted">אין עדיין הגרלות בטווח הזה.</td></tr> }
            </tbody>
          </table>
        </div>
        @if (w.total > w.rows.length) { <p class="note">מוצגות {{ w.rows.length }} מתוך {{ w.total }}. לכל השורות — ייצוא CSV.</p> }
      }
    </section>
  `,
  styles: [`
    .prizes input, .prizes select, .prizes textarea { font-size:.85rem; }
    .w-name { width:9rem; } .w-num { width:5.2rem; }
    .texts { min-width:14rem; } .texts input, .texts textarea { width:100%; display:block; margin:.15rem 0; }
    tr.off td { opacity:.55; }
    td small { display:block; }
    .save { flex-wrap:wrap; gap:.8rem; align-items:center; margin-top:.6rem; }
    .save .bad { color:var(--bad); } .save .ok { color:var(--ok); }
    .filters { display:flex; flex-wrap:wrap; gap:.6rem; margin:.4rem 0 .8rem; }
    .gifts { list-style:none; padding:0; display:grid; gap:.35rem; }
    .pill { display:inline-block; border:1px solid var(--line); border-radius:99px; padding:.05rem .5rem; margin:.1rem; }
    .hist { margin:.4rem 0; font-size:.85rem; }
    .switch b { margin-inline-start:.3rem; }
    tr.test td { opacity:.8; }
  `],
})
export class AdminTreasureComponent {
  private api = inject(AdminTreasureApi);
  config = signal<TreasureConfigView | null>(null);
  draft = signal<{ enabled: boolean; fallbackKey: string; prizes: TreasurePrizeConfig[] } | null>(null);
  gifts = signal<TreasureGiftRow[]>([]);
  stats = signal<TreasureStats | null>(null);
  wins = signal<{ total: number; rows: TreasureWinRow[] } | null>(null);
  f = signal<TreasureFilters>({});
  error = signal<string | null>(null);
  saved = signal<string | null>(null);
  busy = signal(false);
  animations = ['chest', 'glow', 'simple'];
  sum = computed(() => (this.draft()?.prizes ?? []).filter((p) => p.active).reduce((a, p) => a + (p.weight || 0), 0));
  dirty = computed(() => {
    const c = this.config(), d = this.draft();
    return !!c && !!d && JSON.stringify({ e: c.enabled, f: c.fallbackKey, p: c.prizes }) !== JSON.stringify({ e: d.enabled, f: d.fallbackKey, p: d.prizes });
  });
  csvUrl = computed(() => this.api.csvUrl(this.f()));

  constructor() {
    this.loadConfig();
    this.loadData();
  }

  private async run(fn: () => Promise<void>) {
    this.error.set(null);
    try { await fn(); } catch (e: any) { this.error.set(e?.message ?? 'אירעה שגיאה. נסו שוב.'); }
  }

  loadConfig() {
    return this.run(async () => {
      const [c, g] = await Promise.all([this.api.config(), this.api.gifts()]);
      this.config.set(c);
      this.gifts.set(g);
      this.reset();
    });
  }

  loadData() {
    return this.run(async () => {
      const [s, w] = await Promise.all([this.api.stats(this.f()), this.api.wins(this.f())]);
      this.stats.set(s);
      this.wins.set(w);
    });
  }

  reset() {
    const c = this.config();
    if (c) this.draft.set({ enabled: c.enabled, fallbackKey: c.fallbackKey, prizes: c.prizes.map((p) => ({ ...p })) });
  }

  patch(p: Partial<{ enabled: boolean; fallbackKey: string }>) {
    this.saved.set(null);
    this.draft.update((d) => (d ? { ...d, ...p } : d));
  }

  edit(i: number, p: Partial<TreasurePrizeConfig>) {
    this.saved.set(null);
    this.draft.update((d) => (d ? { ...d, prizes: d.prizes.map((x, j) => (j === i ? { ...x, ...p } : x)) } : d));
  }

  async save() {
    const d = this.draft();
    if (!d) return;
    this.busy.set(true);
    await this.run(async () => {
      const r = await this.api.saveConfig(d);
      this.saved.set(`נשמרה גרסה #${r.id}. היא חלה על רכישות שישולמו מעכשיו.`);
      await this.loadConfig();
    });
    this.busy.set(false);
  }

  async toggleGift(g: TreasureGiftRow, selected: boolean) {
    this.busy.set(true);
    await this.run(async () => {
      await this.api.setGift(g.id, selected);
      this.gifts.set(await this.api.gifts());
    });
    this.busy.set(false);
  }

  setF(k: keyof TreasureFilters, v: string | boolean) {
    this.f.update((f) => ({ ...f, [k]: v || undefined }));
    this.loadData();
  }

  /** Percent typed by the admin → basis points (two decimals). */
  pct(v: string) { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) : 0; }
  num(v: string) { return v === '' || !Number.isFinite(Number(v)) ? null : Number(v); }
  kind(k: string) { return KIND[k] ?? k; }
  anim(a: string) { return ANIM[a] ?? a; }
  reason(r?: string | null) { return (r && REASON[r]) ?? r ?? ''; }
  status(s: string) { return STATUS[s] ?? s; }
  given(key: string) { return this.config()?.given.find((g) => g.key === key)?.count ?? 0; }
  prizeName(key: string) { return this.config()?.prizes.find((p) => p.key === key)?.name ?? (key === 'none' ? 'ללא פרס' : key); }
  hours(h: number) { return h < 48 ? `${h} שעות` : `${Math.round(h / 24)} ימים`; }
}
