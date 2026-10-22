import { DatePipe, DecimalPipe, JsonPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { sessionStore } from '../core/api.service';
import {
  AdminApiService, AdminFilters, AdminGame, AdminOrder, AdminProduct, AuditEntry, Dashboard,
} from '../core/admin-api.service';

type Tab = 'dashboard' | 'orders' | 'games' | 'products' | 'audit';

/** Unsaved edits of one product, as typed in the form. */
interface ProductEdit { name?: string; tagline?: string; description?: string; coverImage?: string; priceIls?: string; maxPlayers?: string; status?: string }

const STATUS: Record<string, string> = {
  pending: 'ממתין', paid: 'שולם', failed: 'נכשל', cancelled: 'בוטל', refunded: 'הוחזר',
  'not-opened': 'טרם נפתח', 'not-started': 'טרם התחיל', 'in-progress': 'בתהליך', completed: 'הושלם',
  purchase: 'רכישה', 'admin-free': 'חינמי (מנהל)', legacy: 'ישן (לפני רכישות)',
  published: 'מפורסם', hidden: 'מוסתר', draft: 'טיוטה',
  lobby: 'חדר המתנה', intro: 'פתיחה', playing: 'במשחק',
};

const ACTIONS: Record<string, string> = {
  login: 'כניסה', 'login-failed': 'כניסה שנכשלה', 'free-game-opened': 'פתיחת משחק חינמי',
  'product-updated': 'עדכון מוצר', 'product-price-changed': 'שינוי מחיר', 'sales-exported': 'ייצוא מכירות',
};

/**
 * /admin — private area (spec Part F). The page only displays what the server returns; every request is
 * authorised on the server, so a regular visitor who types this address just sees "אין הרשאה".
 */
@Component({
  selector: 'px-admin',
  imports: [RouterLink, DatePipe, DecimalPipe, JsonPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (state() === 'loading') {
      <main><p class="muted">בודקים הרשאה...</p></main>
    } @else if (state() === 'denied') {
      <main class="narrow">
        <section class="card">
          <h1>אין הרשאה</h1>
          <p>העמוד הזה מיועד למנהלת המערכת בלבד.</p>
          <a class="btn" routerLink="/">לדף הבית</a>
          <a class="btn ghost" routerLink="/admin/login">כניסת מנהל</a>
        </section>
      </main>
    } @else {
      <header class="top">
        <a routerLink="/" class="brand gold-title">PORTAL X</a>
        <span class="muted">אזור ניהול · {{ name() }}</span>
        <button class="btn small ghost" (click)="logout()">יציאה</button>
      </header>
      <main>
        <section class="card free">
          <div>
            <b>פתח משחק ללא תשלום עבורי</b>
            <p class="muted small">נוצר משחק פנימי שמקושר לחשבון המנהל. הוא לא נרשם כעסקה ולא כהכנסה. אפשר להזמין אליו משתתפים עם הקוד.</p>
          </div>
          <div class="row">
            <select [value]="freeProduct()" (change)="freeProduct.set($any($event.target).value)" aria-label="משחק">
              @for (p of products(); track p.id) { <option [value]="p.id" [disabled]="!p.playable">{{ p.name }}{{ p.playable ? '' : ' (לא זמין)' }}</option> }
            </select>
            <button class="btn primary" (click)="openFree()" [disabled]="busy()">פתח משחק ללא תשלום</button>
          </div>
          @if (freeCode()) {
            <p class="ok">נפתח משחק חינמי. קוד: <b dir="ltr">{{ freeCode() }}</b>
              <button class="btn small" (click)="enter(freeCode()!)">כניסה כמארח</button></p>
          }
        </section>

        <nav class="tabs" role="tablist">
          @for (t of tabs; track t.id) {
            <button role="tab" [attr.aria-selected]="tab() === t.id" [class.on]="tab() === t.id" (click)="go(t.id)">{{ t.label }}</button>
          }
        </nav>

        @if (tab() !== 'products' && tab() !== 'audit') {
          <form class="filters card" (submit)="$event.preventDefault(); reload()">
            <label>מתאריך <input type="date" [value]="f().from ?? ''" (change)="set('from', $any($event.target).value)" /></label>
            <label>עד תאריך <input type="date" [value]="f().to ?? ''" (change)="set('to', $any($event.target).value)" /></label>
            <label>משחק
              <select [value]="f().productId ?? ''" (change)="set('productId', $any($event.target).value)">
                <option value="">כל המשחקים</option>
                @for (p of products(); track p.id) { <option [value]="p.id">{{ p.name }}</option> }
              </select>
            </label>
            @if (tab() === 'orders') {
              <label>סטטוס תשלום
                <select [value]="f().status ?? ''" (change)="set('status', $any($event.target).value)">
                  <option value="">הכול</option>
                  @for (s of ['paid','refunded','pending','failed','cancelled']; track s) { <option [value]="s">{{ label(s) }}</option> }
                </select>
              </label>
              <label>חיפוש <input placeholder="מספר הזמנה או דוא״ל" [value]="f().search ?? ''" (input)="set('search', $any($event.target).value)" /></label>
            }
            @if (tab() === 'games') {
              <label>דרך גישה
                <select [value]="f().access ?? ''" (change)="set('access', $any($event.target).value)">
                  <option value="">הכול</option><option value="purchase">רכישה</option><option value="admin-free">חינמי (מנהל)</option><option value="legacy">ישן</option>
                </select>
              </label>
              <label>קוד משחק <input dir="ltr" [value]="f().search ?? ''" (input)="set('search', $any($event.target).value)" /></label>
            }
            <label class="check"><input type="checkbox" [checked]="f().includeTest" (change)="set('includeTest', $any($event.target).checked)" /> כולל רכישות בדיקה</label>
            <button class="btn small" type="submit">סינון</button>
          </form>
        }
        @if (error()) { <p class="error" role="alert">{{ error() }}</p> }

        @switch (tab()) {
          @case ('dashboard') {
            @if (dash(); as d) {
              <div class="cards">
                <div class="stat card"><span>הכנסות ברוטו</span><b>{{ d.revenue.gross | number: '1.0-2' }} ₪</b><small>{{ d.revenue.paidCount }} עסקאות שאושרו</small></div>
                <div class="stat card"><span>החזרים וביטולים</span><b>{{ d.revenue.refunds | number: '1.0-2' }} ₪</b><small>{{ d.revenue.refundCount }} עסקאות</small></div>
                <div class="stat card"><span>הכנסות לאחר החזרים</span><b>{{ d.revenue.afterRefunds | number: '1.0-2' }} ₪</b><small>לפני עמלות סליקה, מסים והוצאות</small></div>
                <div class="stat card"><span>משחקים שנפתחו</span><b>{{ d.games.opened }}</b><small>{{ d.games.started }} התחילו · {{ d.games.completed }} הושלמו</small></div>
                <div class="stat card"><span>משחקים ששולמו והתחילו</span><b>{{ d.games.paidStarted }}</b><small>{{ d.games.purchasedNotStarted }} נרכשו וטרם התחילו</small></div>
                <div class="stat card"><span>משחקים חינמיים של המנהל</span><b>{{ d.games.adminFree }}</b><small>{{ d.games.adminFreeStarted }} התחילו</small></div>
                <div class="stat card"><span>משתתפים</span><b>{{ d.participants }}</b><small>ללא ספירה כפולה בתוך אותו משחק</small></div>
                <div class="stat card"><span>רוכשים (דוא״ל ייחודי)</span><b>{{ d.buyersWithEmail }}</b><small>אין חשבונות לקוח — נספרים רק מי שהשאירו דוא״ל</small></div>
              </div>
              <p class="muted small">
                הזמנות שלא הושלמו: {{ d.orders.pending }} ממתינות · {{ d.orders.failed }} נכשלו · {{ d.orders.cancelled }} בוטלו.
                @if (d.testPaidOrders) { רכישות בדיקה ({{ d.testPaidOrders }}) אינן נכללות בהכנסות. }
              </p>
              <h2>לפי משחק</h2>
              <div class="table-wrap">
                <table>
                  <thead><tr><th>משחק</th><th>ברוטו</th><th>החזרים</th><th>לאחר החזרים</th><th>עסקאות</th><th>משחקים שנפתחו</th></tr></thead>
                  <tbody>
                    @for (p of d.byProduct; track p.productId) {
                      <tr><td>{{ p.name }}</td><td>{{ p.money.gross | number: '1.0-2' }} ₪</td><td>{{ p.money.refunds | number: '1.0-2' }} ₪</td>
                        <td>{{ p.money.afterRefunds | number: '1.0-2' }} ₪</td><td>{{ p.money.paidCount }}</td><td>{{ p.games }}</td></tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          }
          @case ('orders') {
            <div class="bar"><span class="muted">{{ orders().length }} הזמנות</span><a class="btn small" [href]="csvUrl()" download>ייצוא CSV</a></div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>מס׳</th><th>תאריך</th><th>דוא״ל</th><th>משחק</th><th>סכום</th><th>תשלום</th><th>מזהה עסקה</th><th>קוד משחק</th><th>משתתפים</th><th>משחק</th></tr></thead>
                <tbody>
                  @for (o of orders(); track o.id) {
                    <tr [class.test]="o.isTest">
                      <td>{{ o.number }}{{ o.isTest ? ' (בדיקה)' : '' }}</td><td>{{ o.createdAt | date: 'd.M.yy HH:mm' }}</td><td dir="ltr">{{ o.email ?? '—' }}</td>
                      <td>{{ o.productName }}</td><td>{{ o.amount | number: '1.0-2' }} {{ o.currency === 'ILS' ? '₪' : o.currency }}</td>
                      <td><span class="st" [attr.data-s]="o.status">{{ label(o.status) }}</span></td><td dir="ltr" class="small">{{ o.transactionId ?? '—' }}</td>
                      <td dir="ltr">{{ o.gameCode ?? '—' }}</td><td>{{ o.players }}</td><td>{{ o.gameStatus ? label(o.gameStatus) : '—' }}</td>
                    </tr>
                  } @empty { <tr><td colspan="10" class="muted">אין הזמנות בסינון הזה.</td></tr> }
                </tbody>
              </table>
            </div>
          }
          @case ('games') {
            <div class="table-wrap">
              <table>
                <thead><tr><th>קוד</th><th>משחק</th><th>גישה</th><th>בעלים</th><th>נוצר</th><th>התחיל</th><th>הסתיים</th><th>משתתפים</th><th>מצב</th><th>תוצאה</th><th>ניקוד קבוצתי</th></tr></thead>
                <tbody>
                  @for (g of games(); track g.code) {
                    <tr class="click" (click)="showGame(g.code)" [class.test]="g.isTest">
                      <td dir="ltr">{{ g.code }}</td><td>{{ g.productName ?? '—' }}</td><td>{{ label(g.access) }}{{ g.isTest ? ' · בדיקה' : '' }}</td><td>{{ g.owner ?? '—' }}</td>
                      <td>{{ g.createdAt | date: 'd.M.yy HH:mm' }}</td><td>{{ g.startedAt ? (g.startedAt | date: 'd.M HH:mm') : '—' }}</td><td>{{ g.endedAt ? (g.endedAt | date: 'd.M HH:mm') : '—' }}</td>
                      <td>{{ g.players }}</td><td>{{ label(g.status) }}</td>
                      <td>{{ g.result ? g.result.puzzlesSolved + '/' + g.result.puzzlesTotal + ' חידות · ' + minutes(g.result.durationSeconds) : '—' }}</td>
                      <td>{{ g.groupScore ?? '—' }}</td>
                    </tr>
                  } @empty { <tr><td colspan="11" class="muted">אין משחקים בסינון הזה.</td></tr> }
                </tbody>
              </table>
            </div>
            @if (game(); as g) {
              <section class="card details" aria-label="פרטי משחק">
                <div class="bar"><h2>משחק {{ g.code }} · {{ label(g.phase) }}</h2><button class="btn small ghost" (click)="game.set(null)">סגירה</button></div>
                @if (g.access === 'admin-free' && g.phase === 'lobby') { <button class="btn small" (click)="enter(g.code)">כניסה כמארח</button> }
                <h3>משתתפים</h3>
                <ul>
                  @for (p of g.players; track p.nickname) {
                    <li>{{ p.nickname }}{{ p.isHost ? ' (מארח)' : '' }} · {{ p.isConnected ? 'מחובר' : 'לא מחובר' }} · תרומות: {{ p.contributions ?? 0 }}@if (p.points != null) { · <b>{{ p.points }} נקודות</b> }</li>
                  } @empty { <li class="muted">עדיין אין משתתפים.</li> }
                </ul>
                <h3>התקדמות</h3>
                <ul>
                  @for (p of g.puzzles; track p.puzzleId) {
                    <li>{{ p.title ?? p.puzzleId }} · {{ p.status === 'solved' ? 'נפתר' : p.status === 'active' ? 'פעיל' : 'נעול' }} · ניסיונות {{ p.attempts }} · רמזים {{ p.hintsRevealed }}</li>
                  }
                </ul>
                @if (g.results.length) {
                  <h3>תוצאות</h3>
                  <ul>@for (r of g.results; track r.round) { <li>סבב {{ r.round }}: {{ r.puzzlesSolved }}/{{ r.puzzlesTotal }} חידות · {{ minutes(r.durationSeconds) }} · {{ r.hintsUsed }} רמזים</li> }</ul>
                }
                @if (g.groupScore != null) { <p>ניקוד קבוצתי: <b>{{ g.groupScore }}</b></p> }
              </section>
            }
          }
          @case ('products') {
            <div class="products">
              @for (p of products(); track p.id) {
                <form class="card product" (submit)="$event.preventDefault(); save(p.id)">
                  <div class="bar"><h2>{{ p.name }}</h2><span class="st" [attr.data-s]="p.status">{{ label(p.status) }}</span></div>
                  @for (w of p.warnings; track w) { <p class="warn">{{ w }}</p> }
                  <label>שם <input [value]="edit(p.id).name ?? p.name" (input)="patch(p.id, 'name', $any($event.target).value)" /></label>
                  <label>תקציר <input [value]="edit(p.id).tagline ?? p.tagline" (input)="patch(p.id, 'tagline', $any($event.target).value)" /></label>
                  <label>תיאור <textarea rows="4" [value]="edit(p.id).description ?? p.description" (input)="patch(p.id, 'description', $any($event.target).value)"></textarea></label>
                  <label>תמונת כיסוי <input dir="ltr" [value]="edit(p.id).coverImage ?? p.coverImage" (input)="patch(p.id, 'coverImage', $any($event.target).value)" /></label>
                  <div class="row3">
                    <label>מחיר (₪) <input type="number" min="1" step="0.01" dir="ltr" [value]="edit(p.id).priceIls ?? p.price ?? ''" (input)="patch(p.id, 'priceIls', $any($event.target).value)" /></label>
                    <label>משתתפים מרבי <input type="number" min="1" max="8" dir="ltr" [value]="edit(p.id).maxPlayers ?? p.maxPlayers" (input)="patch(p.id, 'maxPlayers', $any($event.target).value)" /></label>
                    <label>סטטוס
                      <select [value]="edit(p.id).status ?? p.status" (change)="patch(p.id, 'status', $any($event.target).value)">
                        <option value="published">מפורסם</option><option value="hidden">מוסתר</option><option value="draft">טיוטה</option>
                      </select>
                    </label>
                  </div>
                  <button class="btn primary small" type="submit" [disabled]="busy()">שמירה</button>
                  @if (saved() === p.id) { <span class="ok">נשמר</span> }
                </form>
              }
            </div>
          }
          @case ('audit') {
            <div class="table-wrap">
              <table>
                <thead><tr><th>מועד</th><th>מנהל</th><th>פעולה</th><th>יעד</th><th>פרטים</th></tr></thead>
                <tbody>
                  @for (a of audit(); track a.id) {
                    <tr><td>{{ a.createdAt | date: 'd.M.yy HH:mm:ss' }}</td><td>{{ a.adminName }}</td><td>{{ actionLabel(a.action) }}</td>
                      <td dir="ltr">{{ a.targetId ?? '' }}</td><td class="small" dir="ltr">{{ a.details | json }}</td></tr>
                  }
                </tbody>
              </table>
            </div>
          }
        }
      </main>
    }
  `,
  styles: [`
    :host { display:block; min-height:100dvh; background:var(--bg); }
    .top { display:flex; align-items:center; gap:1rem; justify-content:space-between; max-width:1280px; margin:0 auto; padding:12px 16px; flex-wrap:wrap; }
    .brand { font-weight:900; letter-spacing:.08em; text-decoration:none; direction:ltr; }
    main { max-width:1280px; margin:0 auto; padding:0 16px 48px; }
    main.narrow { max-width:520px; padding-top:2rem; }
    .narrow .card { display:flex; flex-direction:column; gap:.6rem; align-items:flex-start; }
    h1, h2 { font-family:var(--font-title); }
    h2 { font-size:1.3rem; margin:1rem 0 .5rem; } h3 { margin:.8rem 0 .3rem; font-size:1rem; }
    .free { display:flex; flex-wrap:wrap; gap:.8rem 1.5rem; align-items:center; justify-content:space-between; margin-bottom:1rem; }
    .free p { margin:.2rem 0 0; }
    .row { display:flex; gap:.5rem; flex-wrap:wrap; align-items:center; }
    .tabs { display:flex; gap:.25rem; border-bottom:1px solid var(--line); margin-bottom:1rem; overflow-x:auto; }
    .tabs button { background:none; border:none; color:var(--muted); padding:.6rem 1rem; font-weight:700; cursor:pointer; border-bottom:3px solid transparent; white-space:nowrap; font-size:1rem; }
    .tabs button.on { color:var(--gold-2); border-bottom-color:var(--gold); }
    .filters { display:flex; flex-wrap:wrap; gap:.6rem 1rem; align-items:flex-end; padding:.8rem 1rem; margin-bottom:1rem; }
    .filters label { display:flex; flex-direction:column; gap:.2rem; font-size:.85rem; color:var(--muted); }
    .filters label.check { flex-direction:row; align-items:center; gap:.4rem; }
    .cards { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:.8rem; }
    .stat { display:flex; flex-direction:column; gap:.2rem; padding:1rem; }
    .stat span { color:var(--muted); font-size:.9rem; } .stat b { font-size:1.7rem; color:var(--gold-2); } .stat small { color:var(--muted); }
    .table-wrap { overflow-x:auto; border:1px solid var(--line); border-radius:var(--radius); }
    table { width:100%; border-collapse:collapse; font-size:.9rem; }
    th, td { padding:.5rem .6rem; text-align:start; border-bottom:1px solid rgba(201,162,77,.15); white-space:nowrap; }
    th { background:var(--panel-solid); color:var(--gold-2); position:sticky; top:0; }
    tr.test td { opacity:.65; } tr.click { cursor:pointer; } tr.click:hover td { background:rgba(255,255,255,.04); }
    .st { padding:.1em .55em; border-radius:999px; border:1px solid var(--line); font-size:.8rem; }
    .st[data-s=paid], .st[data-s=published] { border-color:var(--ok); color:#9be3b4; }
    .st[data-s=refunded], .st[data-s=failed] { border-color:var(--bad); color:#ffc2b5; }
    .bar { display:flex; justify-content:space-between; align-items:center; gap:1rem; margin-bottom:.5rem; }
    .bar h2 { margin:0; }
    .details { margin-top:1rem; } .details ul { margin:0; padding-inline-start:1.2rem; line-height:1.7; }
    .products { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:1rem; }
    .product { display:flex; flex-direction:column; gap:.5rem; }
    .product label { display:flex; flex-direction:column; gap:.2rem; font-size:.85rem; color:var(--muted); }
    .product input, .product textarea, .product select { width:100%; }
    .product textarea { background:rgba(255,255,255,.06); color:var(--text); border:1px solid var(--line); border-radius:10px; padding:.5rem; font:inherit; }
    .row3 { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:.5rem; }
    .warn { margin:0; color:#ffd59a; font-size:.9rem; }
    .ok { color:#9be3b4; } .small { font-size:.8rem; }
    select { background:var(--panel-solid); color:var(--text); border:1px solid var(--line); border-radius:10px; padding:.45rem .6rem; min-height:40px; }
    @media (max-width: 900px) { .cards { grid-template-columns:repeat(2, minmax(0,1fr)); } .products { grid-template-columns:1fr; } }
    @media (max-width: 560px) { .cards { grid-template-columns:1fr; } .row3 { grid-template-columns:1fr; } }
  `],
})
export class AdminPage {
  private api = inject(AdminApiService);
  private router = inject(Router);
  tabs: { id: Tab; label: string }[] = [
    { id: 'dashboard', label: 'לוח בקרה' }, { id: 'orders', label: 'רכישות' }, { id: 'games', label: 'משחקים' },
    { id: 'products', label: 'מוצרים ומחירים' }, { id: 'audit', label: 'יומן פעולות' },
  ];
  state = signal<'loading' | 'denied' | 'ok'>('loading');
  name = signal('');
  tab = signal<Tab>('dashboard');
  f = signal<AdminFilters>({});
  dash = signal<Dashboard | null>(null);
  orders = signal<AdminOrder[]>([]);
  games = signal<AdminGame[]>([]);
  game = signal<any | null>(null);
  products = signal<AdminProduct[]>([]);
  audit = signal<AuditEntry[]>([]);
  edits = signal<Record<string, ProductEdit>>({});
  saved = signal<string | null>(null);
  freeProduct = signal('');
  freeCode = signal<string | null>(null);
  busy = signal(false);
  error = signal<string | null>(null);
  csvUrl = computed(() => this.api.csvUrl(this.f()));

  constructor() {
    this.init();
  }

  private async init() {
    try {
      const s = await this.api.session();
      if (!s.admin) return this.state.set('denied');
      this.name.set(s.name ?? '');
      this.state.set('ok');
      const products = await this.api.products();
      this.products.set(products);
      this.freeProduct.set(products.find((p) => p.playable)?.id ?? '');
      await this.reload();
    } catch (e: any) {
      if (e.code === 'unauthorized' || e.code === 'forbidden') this.state.set('denied');
      else { this.state.set('ok'); this.error.set(e.message); }
    }
  }

  label = (s: string) => STATUS[s] ?? s;
  actionLabel = (s: string) => ACTIONS[s] ?? s;
  minutes = (sec: number) => `${Math.round(sec / 60)} דק׳`;
  edit = (id: string): ProductEdit => this.edits()[id] ?? {};

  set(key: keyof AdminFilters, value: string | boolean) {
    this.f.update((f) => ({ ...f, [key]: value }));
  }

  go(t: Tab) {
    this.tab.set(t);
    this.f.update((f) => ({ ...f, status: undefined, access: undefined, search: undefined }));
    this.game.set(null);
    this.reload();
  }

  async reload() {
    this.error.set(null);
    try {
      switch (this.tab()) {
        case 'dashboard': this.dash.set(await this.api.dashboard(this.f())); break;
        case 'orders': this.orders.set(await this.api.orders(this.f())); break;
        case 'games': this.games.set(await this.api.games(this.f())); break;
        case 'products': this.products.set(await this.api.products()); break;
        case 'audit': this.audit.set(await this.api.audit()); break;
      }
    } catch (e: any) {
      this.fail(e);
    }
  }

  private fail(e: any) {
    if (e.code === 'unauthorized') this.state.set('denied');
    else this.error.set(e.message);
  }

  async showGame(code: string) {
    try { this.game.set(await this.api.game(code)); } catch (e: any) { this.fail(e); }
  }

  patch(id: string, key: keyof ProductEdit, value: string) {
    this.edits.update((e) => ({ ...e, [id]: { ...(e[id] ?? {}), [key]: value } }));
    this.saved.set(null);
  }

  async save(id: string) {
    const e = this.edit(id);
    const body: Record<string, unknown> = {};
    for (const k of ['name', 'tagline', 'description', 'coverImage', 'status'] as const) if (e[k] !== undefined) body[k] = e[k];
    if (e.priceIls !== undefined) {
      if (String(e.priceIls).trim() === '') body['clearPrice'] = true;
      else body['priceIls'] = Number(e.priceIls);
    }
    if (e.maxPlayers !== undefined) body['maxPlayers'] = Number(e.maxPlayers);
    this.busy.set(true);
    this.error.set(null);
    try {
      const updated = await this.api.updateProduct(id, body);
      this.products.update((list) => list.map((p) => (p.id === id ? updated : p)));
      this.edits.update((x) => ({ ...x, [id]: {} }));
      this.saved.set(id);
    } catch (err: any) {
      this.fail(err);
    } finally {
      this.busy.set(false);
    }
  }

  async openFree() {
    if (!this.freeProduct()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const g = await this.api.freeGame(this.freeProduct());
      sessionStore.setHostClaim(g.code, g.hostClaim);
      this.freeCode.set(g.code);
      if (this.tab() === 'dashboard' || this.tab() === 'games') this.reload();
    } catch (e: any) {
      this.fail(e);
    } finally {
      this.busy.set(false);
    }
  }

  /** Enters a free admin game as host (a fresh host claim is issued while it is in the lobby). */
  async enter(code: string) {
    try {
      const g = await this.api.reclaim(code);
      if (g.hostClaim) sessionStore.setHostClaim(g.code, g.hostClaim);
      await this.router.navigate(['/join', g.code]);
    } catch (e: any) {
      this.fail(e);
    }
  }

  async logout() {
    try { await this.api.logout(); } catch {}
    await this.router.navigate(['/']);
  }
}
