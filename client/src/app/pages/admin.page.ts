import { DatePipe, DecimalPipe } from '@angular/common';
import { AdminDrawComponent } from './admin-draw.component';
import { AdminTreasureComponent } from './admin-treasure.component';
import { AdminStatsComponent, addDays, israelToday } from './admin-stats.component';
import { AdminTasteComponent } from './admin-taste.component';
import { AdminTasteSummaryComponent } from './admin-taste-summary.component';
import { AdminChallengeComponent } from '../challenge/admin/admin-challenge.component';
import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { orderStore, sessionStore } from '../core/api.service';
import {
  AdminApiService, AdminFilters, AdminGame, AdminOrder, AdminProduct, CouponRow, CouponUse, CustomerDetails, Dashboard, FaqRow, EmailSetup, MailingFilters, MailingList,
  MailingRow, MoneyTotals, ReferralDetails, ReferralFilters, ReferralList } from '../core/admin-api.service';
import { adminCache, adminDataAt } from '../core/admin-cache';

/** The twelve tabs of the side menu, in their order. */
type Tab = 'dashboard' | 'statistics' | 'taste' | 'games' | 'products' | 'orders' | 'coupons' | 'treasure' | 'customers' | 'referrals' | 'faq' | 'draw' | 'settings';
type CouponSub = 'general' | 'challenge' | 'taste' | 'issued';
type ProductSub = 'edit' | 'taste';

/** Simple line icons (24×24, stroked with the current colour), one per tab. */
const ICON: Record<Tab, string> = {
  dashboard: 'M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z',
  statistics: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  taste: 'M12 2l2.6 6.6L21 9.3l-5 4.4 1.6 6.8L12 17l-5.6 3.5L8 13.7 3 9.3l6.4-.7z',
  games: 'M6 11h4M8 9v4M15 12h.01M18 10h.01M17.3 5H6.7a4 4 0 0 0-4 3.6L2 15a3 3 0 0 0 5.4 2l1.1-1.5h7l1.1 1.5A3 3 0 0 0 22 15l-.7-6.4A4 4 0 0 0 17.3 5z',
  products: 'M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01',
  orders: 'M3 6h18M3 6l1.6 13.2A2 2 0 0 0 6.6 21h10.8a2 2 0 0 0 2-1.8L21 6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
  coupons: 'M3 9a3 3 0 0 0 0 6v3a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-3a3 3 0 0 0 0-6V6a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1zM9 9h.01M15 15h.01M15 9l-6 6',
  treasure: 'M3 10a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v10H3zM3 13h18M11 11h2v4h-2zM8 6V5M16 6V5',
  customers: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  referrals: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  faq: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
  draw: 'M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
};

/** The side menu: four groups, the tabs in the order of the spec. */
const NAV: { group: string; items: { id: Tab; label: string }[] }[] = [
  { group: 'סקירה', items: [{ id: 'dashboard', label: 'לוח בקרה' }, { id: 'statistics', label: 'סטטיסטיקות' }, { id: 'taste', label: 'טעימת הפורטל' }] },
  { group: 'משחקים ומכירות', items: [{ id: 'games', label: 'משחקים' }, { id: 'products', label: 'מוצרים ומחירים' }, { id: 'orders', label: 'רכישות' }, { id: 'coupons', label: 'קופונים והנחות' }, { id: 'treasure', label: 'תיבת האוצר' }] },
  { group: 'לקוחות ותוכן', items: [{ id: 'customers', label: 'לקוחות ודיוור' }, { id: 'referrals', label: 'קישורים שיווקיים' }, { id: 'faq', label: 'שאלות ותשובות' }, { id: 'draw', label: 'הגרלה' }] },
  { group: 'מערכת', items: [{ id: 'settings', label: 'הגדרות מערכת' }] },
];

/** The head of every tab: its title and what it is for. */
const HEAD: Record<Tab, { title: string; text: string }> = {
  dashboard: { title: 'לוח בקרה', text: 'תמונת מצב כללית: הכנסות, משחקים, המשחק החינמי וטעימת הפורטל.' },
  statistics: { title: 'סטטיסטיקות', text: 'מכירות, פעילות, קישורים שיווקיים וטעימת הפורטל בטווח זמן לבחירה, עם גרפים.' },
  taste: { title: 'טעימת הפורטל', text: 'המשפך של הטעימה החינמית: מהחשיפה בדף הבית ועד רכישה מאומתת.' },
  games: { title: 'משחקים', text: 'כל החדרים שנפתחו: קוד, דרך גישה, משתתפים ותוצאות. לחיצה על שורה מציגה את פרטי המשחק.' },
  products: { title: 'מוצרים ומחירים', text: 'פרטי המשחקים, מחירים וזמינות לרכישה, ורכישות שמקורן בטעימת הפורטל.' },
  orders: { title: 'רכישות', text: 'כל ההזמנות והתשלומים, בדיקה מול SUMIT וסימון החזרים.' },
  coupons: { title: 'קופונים והנחות', text: 'קופונים כלליים, אתגר 240, קופוני סיום הטעימה וכל הקופונים האישיים שהונפקו.' },
  treasure: { title: 'תיבת האוצר', text: 'ההפתעה אחרי רכישה בתשלום: מדדים, פרסים וסיכויים, משחקי מתנה והיסטוריית זכיות.' },
  customers: { title: 'לקוחות ודיוור', text: 'מאגר אחד לכל כתובות המייל: תוצאות משחק, קישורים אישיים, אתגר 240 וטעימת הפורטל — עם הסכמה לדיוור והיסטוריה מלאה.' },
  referrals: { title: 'קישורים שיווקיים', text: 'הקישורים האישיים: כניסות, רכישות מיוחסות, הכנסות ומשחקים חינמיים.' },
  faq: { title: 'שאלות ותשובות', text: 'השאלות שמוצגות בדף הבית: הוספה, עריכה, סדר והסתרה.' },
  draw: { title: 'הגרלה', text: 'כרטיסי ההגרלה של בעלי הקישורים האישיים, מחושבים מההזמנות עצמן בכל טעינה.' },
  settings: { title: 'הגדרות מערכת', text: 'שליחת מיילים, מדיניות ההסכמה לדיוור ובדיקת החיבור לסליקה.' },
};

/** Old addresses (?tab=…) that still arrive, e.g. Google's return to "email-setup", and where they now live. */
const LEGACY: Record<string, Tab> = { 'email-setup': 'settings', mailing: 'customers', challenge: 'coupons', audit: 'dashboard' };

/** The coupon form as typed (spec 4.3). Dates are local date-time strings from the inputs. */
interface CouponForm {
  id?: string; code: string; name: string; note: string; kind: 'percent' | 'fixed'; value: string; productIds: string[];
  startsAt: string; endsAt: string; maxRedemptions: string; active: boolean;
}
const EMPTY_COUPON: CouponForm = { code: '', name: '', note: '', kind: 'percent', value: '', productIds: [], startsAt: '', endsAt: '', maxRedemptions: '', active: true };

/** Unsaved edits of one product, as typed in the form. */
interface ProductEdit {
  name?: string; tagline?: string; description?: string; coverImage?: string; priceIls?: string; previousPriceIls?: string; maxPlayers?: string; status?: string;
  saleDate?: string; saleTime?: string; showBeforeSale?: string; salePaused?: string;
}

const SALE_STATE: Record<string, string> = { open: 'פתוח לרכישה', scheduled: 'מתוכנן לפתיחה', paused: 'מכירה מושהית' };

const STATUS: Record<string, string> = {
  pending: 'ממתין', paid: 'שולם', failed: 'נכשל', cancelled: 'בוטל', refunded: 'הוחזר',
  'not-opened': 'טרם נפתח', 'not-started': 'טרם התחיל', 'in-progress': 'בתהליך', completed: 'הושלם',
  purchase: 'רכישה', 'admin-free': 'חינמי (מנהל)', 'free-sample': 'משחק התנסות חינמי', legacy: 'ישן (לפני רכישות)',
  active: 'פעיל', scheduled: 'ממתין לתחילת תוקף', expired: 'פג תוקף', disabled: 'מושבת',
  reserved: 'שמור לתשלום', redeemed: 'מומש', released: 'שוחרר', percent: 'אחוזים', fixed: 'סכום קבוע',
  published: 'מפורסם', hidden: 'מוסתר', draft: 'טיוטה',
  lobby: 'חדר המתנה', intro: 'פתיחה', playing: 'במשחק',
};

/**
 * /admin — private area (spec Part F). The page only displays what the server returns; every request is
 * authorised on the server, so a regular visitor who types this address just sees "אין הרשאה".
 *
 * Layout: one screen high (100dvh). The header and the free-game card stay on top, the side menu stays on the right,
 * and only the work area scrolls (on a phone the page scrolls and the menu folds). The free-game card is outside the
 * tab switch, so moving between tabs never reloads it.
 */
@Component({
  selector: 'px-admin',
  imports: [RouterLink, DatePipe, DecimalPipe, AdminStatsComponent, AdminTasteComponent, AdminTasteSummaryComponent, AdminDrawComponent, AdminChallengeComponent, AdminTreasureComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.shell]': "state() === 'ok'" },
  template: `
    @if (state() === 'loading') {
      <main class="plain"><p class="muted">בודקים הרשאה...</p></main>
    } @else if (state() === 'denied') {
      <main class="plain narrow">
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
      <div class="free-slot">
        <section class="card free">
          <div class="free-head">
            <div>
              <b>פתיחת משחק לשחקנים בלי תשלום</b>
              <p class="muted small">נוצר חדר עם קוד חדש. לא נוצרת הזמנה, אין סליקה ולא מופקת קבלה. הפתיחה נרשמת ביומן הפעולות.</p>
            </div>
            <button class="btn primary" type="button" (click)="toggleFree()" [attr.aria-expanded]="freeOpen()" aria-controls="free-panel">פתח משחק ללא תשלום</button>
          </div>
          @if (freeOpen()) {
            <div class="row" id="free-panel">
              <label>בחרו משחק
                <select [value]="freeProduct()" (change)="freeProduct.set($any($event.target).value)">
                  @for (p of playableProducts(); track p.id) { <option [value]="p.id">{{ p.name }}{{ p.isFree ? ' (חינמי)' : '' }}</option> }
                </select>
              </label>
              <button class="btn primary" type="button" (click)="openFree()" [disabled]="busy() || !freeProduct()">יצירת קוד חדר</button>
            </div>
          }
          @if (freeRooms().length) {
            <ul class="free-rooms" aria-label="חדרים שנפתחו עכשיו">
              @for (r of freeRooms(); track r.code) {
                <li>
                  <span>{{ r.productName }}:</span> <b dir="ltr" class="room-code">{{ r.code }}</b>
                  <button class="btn small" type="button" (click)="copyCode(r.code)">{{ copied() === r.code ? 'הועתק' : 'העתקת הקוד' }}</button>
                  <button class="btn small ghost" type="button" (click)="enter(r.code)">כניסה כמארח</button>
                </li>
              }
            </ul>
          }
        </section>
      </div>

      <div class="body pxa">
        <aside class="side" [class.open]="menuOpen()">
          <button class="menu-toggle" type="button" (click)="menuOpen.set(!menuOpen())" [attr.aria-expanded]="menuOpen()" aria-controls="admin-nav">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
            <span>תפריט ניהול</span><b>{{ head().title }}</b>
          </button>
          <nav id="admin-nav" aria-label="תפריט ניהול">
            @for (g of nav; track g.group) {
              <p class="group">{{ g.group }}</p>
              <ul>
                @for (t of g.items; track t.id) {
                  <li>
                    <button type="button" [class.on]="tab() === t.id" [attr.aria-current]="tab() === t.id ? 'page' : null" (click)="go(t.id)">
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="icon[t.id]" /></svg>
                      <span>{{ t.label }}</span>
                    </button>
                  </li>
                }
              </ul>
            }
          </nav>
        </aside>

        <main class="content" #content tabindex="-1" [attr.aria-labelledby]="'tab-title'">
          <div class="page-head">
            <div>
              <h1 id="tab-title">{{ head().title }}</h1>
              <p>{{ head().text }}</p>
            </div>
            <div class="actions">
              @switch (tab()) {
                @case ('orders') {
                  <a class="btn small" [href]="csvUrl()" download>ייצוא CSV</a>
                  <button class="btn small ghost" type="button" (click)="sumitCheck()">בדיקת חיבור ל-SUMIT</button>
                }
                @case ('customers') {
                  <a class="btn small" [href]="mailingCsvUrl()" download>ייצוא הרשימה (CSV)</a>
                  <a class="btn small ghost" [href]="audienceCsvUrl" download title="רק כתובות עם הסכמה פעילה, כל אחת עם קישור הסרה">ייצוא קהל לדיוור שיווקי</a>
                }
                @case ('referrals') { <a class="btn small" [href]="referralsCsvUrl()" download>ייצוא CSV</a> }
              }
              <!-- a tab entered again within a minute shows what was read then; the time says when, the button reads again -->
              @if (dataAt(); as at) { <small class="muted updated" aria-live="polite">עודכן {{ at }}</small> }
              <button class="btn small ghost" type="button" (click)="refresh()" title="קריאה מחדש של הנתונים מהשרת">רענון</button>
            </div>
          </div>

          @if (tab() === 'dashboard' || tab() === 'orders' || tab() === 'games') {
            <form class="filters" (submit)="$event.preventDefault(); reload()">
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
                    <option value="">הכול</option><option value="purchase">רכישה</option><option value="admin-free">חינמי (מנהל)</option><option value="free-sample">משחק התנסות חינמי</option><option value="test-checkout">הדגמה ישנה (סגור)</option><option value="legacy">ישן</option>
                  </select>
                </label>
                <label>קוד משחק <input dir="ltr" [value]="f().search ?? ''" (input)="set('search', $any($event.target).value)" /></label>
              }
              <label class="check"><input type="checkbox" [checked]="f().includeTest" (change)="set('includeTest', $any($event.target).checked)" /> כולל רכישות בדיקה</label>
              <button class="btn small" type="submit">סינון</button>
            </form>
          }
          @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
          @if (loadingTab()) { <p class="loading">טוענים…</p> }

          <!-- "רענון" builds the tab's parts again, so each of them reads its data from the server once more -->
          @for (k of [refreshKey()]; track k) {
          @switch (tab()) {
            @case ('statistics') { <px-admin-stats (openTaste)="go('taste')" /> }
            @case ('taste') { <px-admin-taste /> }
            @case ('draw') { <px-admin-draw /> }
            @case ('treasure') { <px-admin-treasure /> }

            @case ('dashboard') {
              @if (dash(); as d) {
                <div class="cards">
                  <div class="stat accent"><span>הכנסות ברוטו</span><b>{{ d.revenue.gross | number: '1.0-2' }} ₪</b><small>{{ d.revenue.paidCount }} עסקאות שאושרו</small></div>
                  <div class="stat"><span>החזרים וביטולים</span><b>{{ d.revenue.refunds | number: '1.0-2' }} ₪</b><small>{{ d.revenue.refundCount }} עסקאות</small></div>
                  <div class="stat accent"><span>הכנסות לאחר החזרים</span><b>{{ d.revenue.afterRefunds | number: '1.0-2' }} ₪</b><small>לפני עמלות סליקה, מסים והוצאות</small></div>
                  <div class="stat"><span>משחקים שנפתחו</span><b>{{ d.games.opened }}</b><small>{{ d.games.started }} התחילו · {{ d.games.completed }} הושלמו</small></div>
                  <div class="stat"><span>משחקים ששולמו והתחילו</span><b>{{ d.games.paidStarted }}</b><small>{{ d.games.purchasedNotStarted }} נרכשו וטרם התחילו</small></div>
                  @if (d.games.demo) { <div class="stat"><span>משחקי הדגמה ישנים (סגורים)</span><b>{{ d.games.demo }}</b><small>{{ d.games.demoStarted }} התחילו · {{ d.games.demoCompleted }} הושלמו · היסטוריה בלבד, לא נספר בהכנסות ובמכירות</small></div> }
                  <div class="stat"><span>משחקים חינמיים של המנהל</span><b>{{ d.games.adminFree }}</b><small>{{ d.games.adminFreeStarted }} התחילו</small></div>
                  <div class="stat"><span>משתתפים</span><b>{{ d.participants }}</b><small>ללא ספירה כפולה בתוך אותו משחק</small></div>
                  <div class="stat"><span>רוכשים (דוא״ל ייחודי)</span><b>{{ d.buyersWithEmail }}</b><small>אין חשבונות לקוח — נספרים רק מי שהשאירו דוא״ל</small></div>
                </div>
                <p class="note">
                  הזמנות שלא הושלמו: {{ d.orders.pending }} ממתינות · {{ d.orders.failed }} נכשלו · {{ d.orders.cancelled }} בוטלו.
                  @if (d.testPaidOrders) { רכישות בדיקה ({{ d.testPaidOrders }}) אינן נכללות בהכנסות. }
                </p>

                <px-admin-taste-summary [from]="rangeFrom()" [to]="rangeTo()" heading="טעימת הפורטל" (open)="go('taste')" />

                @if (d.freeGame; as g) {
                  <section class="section free-report" aria-labelledby="free-report-title">
                    <div class="bar">
                      <h2 id="free-report-title">„{{ g.name }}” — משחק חינמי</h2>
                      <button class="btn small ghost" type="button" (click)="freeGameHistory(g.productId)">להיסטוריית המשחקים ‹</button>
                    </div>
                    <div class="cards">
                      <div class="stat"><span>משחקים שנוצרו</span><b>{{ g.created }}</b><small>{{ g.notStarted }} נוצרו ולא התחילו</small></div>
                      <div class="stat"><span>משחקים שהתחילו בפועל</span><b>{{ g.started }}</b><small>היום: {{ g.today.started }}</small></div>
                      <div class="stat"><span>משחקים שהושלמו</span><b>{{ g.completed }}</b><small>היום: {{ g.today.completed }}</small></div>
                      <div class="stat"><span>משתתפים שהצטרפו</span><b>{{ g.participants }}</b><small>היום: {{ g.today.joined }} · חיבור מחדש לא נספר שוב</small></div>
                      <div class="stat"><span>משתתפים במשחקים שהתחילו</span><b>{{ g.participantsInStarted }}</b><small>סך ההשתתפויות בכל ההרצות שהתחילו</small></div>
                      <div class="stat"><span>הפעלה אחרונה</span><b class="date">{{ g.lastStartedAt ? (g.lastStartedAt | date: 'd.M.yy HH:mm') : '—' }}</b><small>חינמי · לא נספר בהכנסות</small></div>
                    </div>
                    <p class="note">משחק נספר פעם אחת לפי קוד המשחק, גם אם רעננו את הדף או נכנסו שוב. משתתף נספר פעם אחת בכל משחק, כי חיבור מחדש מחזיר אותו למקום שלו. אין חשבונות משתמש, ולכן אותו אדם בשני משחקים שונים נספר פעמיים. סינון התאריכים חל על מועד יצירת המשחק; נתוני „היום” לפי שעון ישראל.</p>
                  </section>
                }
                <h2>לפי משחק</h2>
                <div class="table-wrap">
                  <table>
                    <thead><tr><th>משחק</th><th>ברוטו</th><th>החזרים</th><th>לאחר החזרים</th><th>עסקאות</th><th>משחקים שנפתחו</th></tr></thead>
                    <tbody>
                      @for (p of d.byProduct; track p.productId) {
                        @if (p.isFree) {
                          <tr><td>{{ p.name }} <span class="st" data-s="free">חינמי</span></td><td colspan="4" class="muted-cell">משחק חינמי — אין מכירות ואין הכנסות</td><td>{{ p.games }}</td></tr>
                        } @else {
                        <tr><td>{{ p.name }}</td><td>{{ p.money.gross | number: '1.0-2' }} ₪</td><td>{{ p.money.refunds | number: '1.0-2' }} ₪</td>
                          <td>{{ p.money.afterRefunds | number: '1.0-2' }} ₪</td><td>{{ p.money.paidCount }}</td><td>{{ p.games }}</td></tr>
                        }
                      } @empty { <tr><td colspan="6" class="muted">אין עדיין משחקים בסינון הזה.</td></tr> }
                    </tbody>
                  </table>
                </div>
              }
            }
            @case ('orders') {
              @if (sumitStatus()) { <p class="msg-box ok" role="status">{{ sumitStatus() }}</p> }
              <div class="bar"><span class="muted">{{ orders().length }} הזמנות</span></div>
              <div class="table-wrap fill">
                <table>
                  <thead><tr><th>פעולות</th><th>מס׳</th><th>תאריך</th><th>דוא״ל</th><th>משחק</th><th>מחיר מקורי</th><th>הנחה</th><th>קופון</th><th>לתשלום</th><th>תשלום</th><th>מזהה עסקה</th><th>מסמך</th><th>לטיפול</th><th>קוד משחק</th><th>משתתפים</th><th>משחק</th></tr></thead>
                  <tbody>
                    @for (o of orders(); track o.id) {
                      <tr [class.test]="o.isTest">
                        <td class="row-actions">
                          @if (o.provider === 'sumit' && o.status !== 'refunded') { <button class="btn small ghost" type="button" (click)="checkPayment(o)">בדיקה מול SUMIT</button> }
                          @if (o.status === 'paid') { <button class="btn small ghost" type="button" (click)="markRefunded(o)">סימון כהוחזר</button> }
                        </td>
                        <td>{{ o.number }}{{ o.isTest ? ' (בדיקה)' : '' }}</td><td>{{ o.createdAt | date: 'd.M.yy HH:mm' }}</td><td dir="ltr">{{ o.email ?? '—' }}</td>
                        <td>{{ o.productName }}</td><td>{{ o.originalPrice | number: '1.0-2' }} ₪</td>
                        <td>{{ o.discount ? '−' + (o.discount | number: '1.0-2') + ' ₪' : '—' }}</td><td dir="ltr">{{ o.couponCode ?? '—' }}</td>
                        <td><b>{{ o.amount | number: '1.0-2' }} {{ o.currency === 'ILS' ? '₪' : o.currency }}</b></td>
                        <td><span class="st" [attr.data-s]="o.status">{{ label(o.status) }}</span></td><td dir="ltr" class="small">{{ o.transactionId ?? '—' }}</td>
                        <td dir="ltr" class="small">{{ o.documentNumber ?? o.documentId ?? '—' }}</td><td class="small">{{ issueLabel(o.issue) }}</td>
                        <td dir="ltr">{{ o.gameCode ?? '—' }}</td><td>{{ o.players }}</td><td>{{ o.gameStatus ? label(o.gameStatus) : '—' }}</td>
                      </tr>
                    } @empty { <tr><td colspan="16" class="muted">אין הזמנות בסינון הזה.</td></tr> }
                  </tbody>
                </table>
              </div>
            }
            @case ('games') {
              <div class="bar"><span class="muted">{{ games().length }} משחקים</span></div>
              <div class="table-wrap fill">
                <table>
                  <thead><tr><th>קוד</th><th>משחק</th><th>גישה</th><th>בעלים</th><th>נוצר</th><th>התחיל</th><th>הסתיים</th><th>משתתפים</th><th>מצב</th><th>תוצאה</th><th>ניקוד קבוצתי</th></tr></thead>
                  <tbody>
                    @for (g of games(); track g.code) {
                      <tr class="click" (click)="showGame(g.code)" [class.test]="g.isTest" [class.sel]="game()?.code === g.code">
                        <td dir="ltr">{{ g.code }}</td><td>{{ g.productName ?? '—' }}</td><td>{{ label(g.access) }}{{ g.isTest ? ' · בדיקה' : '' }}</td><td>{{ g.owner ?? '—' }}</td>
                        <td>{{ g.createdAt | date: 'd.M.yy HH:mm' }}</td><td>{{ g.startedAt ? (g.startedAt | date: 'd.M HH:mm') : '—' }}</td><td>{{ g.endedAt ? (g.endedAt | date: 'd.M HH:mm') : '—' }}</td>
                        <td>{{ g.players }}</td><td>{{ label(g.status) }}@if (g.disabled) { · <b class="bad">קוד מושבת</b> }</td>
                        <td>{{ g.result ? g.result.puzzlesSolved + '/' + g.result.puzzlesTotal + ' חידות · ' + minutes(g.result.durationSeconds) : '—' }}</td>
                        <td>{{ g.groupScore ?? '—' }}</td>
                      </tr>
                    } @empty { <tr><td colspan="11" class="muted">אין משחקים בסינון הזה.</td></tr> }
                  </tbody>
                </table>
              </div>
              @if (game(); as g) {
                <section class="section details" aria-label="פרטי משחק">
                  <div class="bar"><h2>משחק {{ g.code }} · {{ label(g.phase) }}</h2><button class="btn small ghost" (click)="game.set(null)">סגירה</button></div>
                  @if (g.disabledAt) {
                    <p class="bad">הקוד מושבת מאז {{ g.disabledAt | date: 'd.M.yy HH:mm' }}{{ g.disabledBy ? ' · ' + g.disabledBy : '' }}. מי שנכנס רואה שהקוד אינו פעיל.</p>
                    <button class="btn small" (click)="toggleGameDisabled(g.code, false)">הפעלה מחדש של הקוד</button>
                  } @else {
                    @if (g.access === 'admin-free' && g.phase === 'lobby') { <button class="btn small" (click)="enter(g.code)">כניסה כמארח</button> }
                    <button class="btn small ghost" (click)="toggleGameDisabled(g.code, true)">השבתת קוד המשחק</button>
                  }
                  <div class="detail-grid">
                    <div>
                      <h3>משתתפים</h3>
                      <ul>
                        @for (p of g.players; track p.nickname) {
                          <li>{{ p.nickname }}{{ p.isHost ? ' (מארח)' : '' }} · {{ p.isConnected ? 'מחובר' : 'לא מחובר' }} · תרומות: {{ p.contributions ?? 0 }}@if (p.points != null) { · <b>{{ p.points }} נקודות</b> }</li>
                        } @empty { <li class="muted">עדיין אין משתתפים.</li> }
                      </ul>
                    </div>
                    <div>
                      <h3>התקדמות</h3>
                      <ul>
                        @for (p of g.puzzles; track p.puzzleId) {
                          <li>{{ p.title ?? p.puzzleId }} · {{ p.status === 'solved' ? 'נפתר' : p.status === 'active' ? 'פעיל' : 'נעול' }} · ניסיונות {{ p.attempts }} · רמזים {{ p.hintsRevealed }}</li>
                        }
                      </ul>
                    </div>
                  </div>
                  @if (g.results.length) {
                    <h3>תוצאות</h3>
                    <ul>@for (r of g.results; track r.round) { <li>סבב {{ r.round }}: {{ r.puzzlesSolved }}/{{ r.puzzlesTotal }} חידות · {{ minutes(r.durationSeconds) }} · {{ r.hintsUsed }} רמזים</li> }</ul>
                  }
                  @if (g.groupScore != null) { <p>ניקוד קבוצתי: <b>{{ g.groupScore }}</b></p> }
                </section>
              }
            }
            @case ('products') {
              <div class="subtabs" role="tablist" aria-label="מוצרים ומחירים">
                <button type="button" role="tab" [class.on]="productSub() === 'edit'" [attr.aria-selected]="productSub() === 'edit'" (click)="productSub.set('edit')">עריכת משחקים ומחירים</button>
                <button type="button" role="tab" [class.on]="productSub() === 'taste'" [attr.aria-selected]="productSub() === 'taste'" (click)="productSub.set('taste')">רכישות מטעימת הפורטל</button>
              </div>
              @if (productSub() === 'taste') {
                <px-admin-taste-summary mode="products" [from]="yearStart" [to]="today" heading="רכישות שמקורן בטעימת הפורטל — מתחילת השנה" (open)="go('taste')" />
              } @else {
              <div class="products">
                @for (p of products(); track p.id) {
                  <form class="card product" (submit)="$event.preventDefault(); save(p.id)">
                    <div class="bar"><h2>{{ p.name }}</h2><span class="row"><span class="st" [attr.data-s]="p.status">{{ label(p.status) }}</span>@if (p.isFree) { <span class="st">משחק התנסות חינמי</span> }</span></div>
                    @for (w of p.warnings; track w) { <p class="warn">{{ w }}</p> }
                    <label>שם <input [value]="edit(p.id).name ?? p.name" (input)="patch(p.id, 'name', $any($event.target).value)" /></label>
                    <label>תקציר <input [value]="edit(p.id).tagline ?? p.tagline" (input)="patch(p.id, 'tagline', $any($event.target).value)" /></label>
                    <label>תיאור <textarea rows="4" [value]="edit(p.id).description ?? p.description" (input)="patch(p.id, 'description', $any($event.target).value)"></textarea></label>
                    <label>תמונת כיסוי <input dir="ltr" [value]="edit(p.id).coverImage ?? p.coverImage" (input)="patch(p.id, 'coverImage', $any($event.target).value)" /></label>
                    <fieldset class="prices">
                      <legend>מחיר</legend>
                      <div class="row2">
                        <label>מחיר נוכחי לתשלום (₪) <input type="number" min="1" step="0.01" dir="ltr" [value]="edit(p.id).priceIls ?? p.price ?? ''" (input)="patch(p.id, 'priceIls', $any($event.target).value)" /></label>
                        @if (!p.isFree) {
                          <label>מחיר קודם (אופציונלי, ₪) <input type="number" min="1" step="0.01" dir="ltr" placeholder="ריק = בלי מחיר קודם"
                            [attr.aria-invalid]="previousPriceProblem(p) ? 'true' : null" [attr.aria-describedby]="'prev-help-' + p.id"
                            [value]="edit(p.id).previousPriceIls ?? p.previousPrice ?? ''" (input)="patch(p.id, 'previousPriceIls', $any($event.target).value)" /></label>
                        }
                      </div>
                      @if (!p.isFree) {
                        <p class="muted small" [id]="'prev-help-' + p.id">המחיר הקודם מוצג באתר עם קו חוצה, לצד המחיר הנוכחי. הוא לתצוגה בלבד — החיוב תמיד לפי המחיר הנוכחי. השאירו ריק כדי לא להציג מחיר קודם.</p>
                        @if (previousPriceProblem(p); as problem) {
                          <p class="warn" role="alert">{{ problem }}</p>
                        } @else if (pricePreview(p); as pv) {
                          <p class="small preview">תצוגה באתר: @if (pv.was) { <s class="was"><bdi>{{ pv.was }} ₪</bdi></s> } <b><bdi>{{ pv.now }} ₪</bdi></b></p>
                        }
                      }
                    </fieldset>
                    <div class="row3">
                      <label>משתתפים מרבי (עד {{ p.maxPlayersLimit }}) <input type="number" min="1" [max]="p.maxPlayersLimit" dir="ltr" [value]="edit(p.id).maxPlayers ?? p.maxPlayers" (input)="patch(p.id, 'maxPlayers', $any($event.target).value)" /></label>
                      <label>סטטוס
                        <select [value]="edit(p.id).status ?? p.status" (change)="patch(p.id, 'status', $any($event.target).value)">
                          <option value="published">מפורסם</option><option value="hidden">מוסתר</option><option value="draft">טיוטה</option>
                        </select>
                      </label>
                    </div>
                    <fieldset class="sale">
                      <legend>הגדרות זמינות לרכישה <span class="st" [attr.data-s]="p.saleState === 'open' ? 'paid' : 'pending'">{{ saleLabel(p.saleState) }}</span></legend>
                      <div class="row3">
                        <label>תאריך פתיחת רכישה <input type="date" dir="ltr" [value]="edit(p.id).saleDate ?? p.saleDate ?? ''" (input)="patch(p.id, 'saleDate', $any($event.target).value)" /></label>
                        <label>שעת פתיחת רכישה <input type="time" dir="ltr" [value]="edit(p.id).saleTime ?? p.saleTime ?? ''" (input)="patch(p.id, 'saleTime', $any($event.target).value)" /></label>
                        <label>סטטוס זמינות לרכישה
                          <select [value]="(edit(p.id).salePaused ?? (p.salePaused ? 'true' : 'false'))" (change)="patch(p.id, 'salePaused', $any($event.target).value)">
                            <option value="false">פעיל (לפי מועד הפתיחה)</option><option value="true">מכירה מושהית</option>
                          </select>
                        </label>
                      </div>
                      <label class="check"><input type="checkbox" [checked]="(edit(p.id).showBeforeSale ?? (p.showBeforeSale ? 'true' : 'false')) === 'true'"
                        (change)="patch(p.id, 'showBeforeSale', $any($event.target).checked ? 'true' : 'false')" /> להציג את המשחק באתר לפני פתיחת הרכישה</label>
                      <p class="muted small">שעון ישראל. @if (p.saleOpensLabel) { הרכישה נפתחת ב־{{ p.saleOpensLabel }}, אוטומטית. } @else { לא נקבע מועד — המוצר זמין כרגיל. }
                        השינוי אינו משפיע על הזמנות ששולמו.
                        @if (p.saleDate) { <button type="button" class="btn small ghost" (click)="clearSale(p.id)" [disabled]="busy()">ביטול מועד הפתיחה</button> }</p>
                    </fieldset>
                    <div class="row">
                      <button class="btn primary small" type="submit" [disabled]="busy()">שמירה</button>
                      @if (!p.isFree && p.price) { <button class="btn small ghost" type="button" (click)="trialPurchase(p.id, p.name, p.price)" [disabled]="busy()">רכישת ניסיון אמיתית</button> }
                      @if (saved() === p.id) { <span class="ok">נשמר</span> }
                    </div>
                  </form>
                } @empty { <p class="empty">אין מוצרים להצגה.</p> }
              </div>
              }
            }
            @case ('faq') {
              <section class="section faq-form">
                <h2>{{ faqEdit().id ? 'עריכת שאלה' : 'הוספת שאלה חדשה' }}</h2>
                <label>שאלה <input maxlength="300" [value]="faqEdit().question" (input)="fe('question', $any($event.target).value)" /></label>
                <label>תשובה <textarea rows="4" maxlength="3000" [value]="faqEdit().answer" (input)="fe('answer', $any($event.target).value)"></textarea></label>
                <label class="check"><input type="checkbox" [checked]="faqEdit().published" (change)="fe('published', $any($event.target).checked)" /> מוצגת בדף הבית</label>
                <div class="row">
                  <button class="btn primary small" (click)="saveFaq()" [disabled]="busy()">{{ faqEdit().id ? 'שמירה' : 'הוספה' }}</button>
                  @if (faqEdit().id) { <button class="btn small ghost" (click)="faqEdit.set(emptyFaq())">ביטול</button> }
                </div>
                <p class="muted small">הטקסט מוצג כטקסט רגיל בלבד — תגיות HTML או קוד לא יופעלו.</p>
              </section>
              <h2>השאלות שבדף הבית</h2>
              <div class="table-wrap">
                <table>
                  <thead><tr><th>סדר</th><th>שאלה</th><th>תשובה</th><th>מצב</th><th>פעולות</th></tr></thead>
                  <tbody>
                    @for (q of faqRows(); track q.id; let i = $index) {
                      <tr>
                        <td>{{ i + 1 }}</td><td class="wrap">{{ q.question }}</td><td class="wrap small">{{ q.answer }}</td>
                        <td><span class="st" [attr.data-s]="q.published ? 'published' : ''">{{ q.published ? 'מוצגת' : 'מוסתרת' }}</span></td>
                        <td>
                          <div class="row">
                            <button class="btn small" (click)="moveFaq(i, -1)" [disabled]="i === 0" aria-label="העברה למעלה">↑</button>
                            <button class="btn small" (click)="moveFaq(i, 1)" [disabled]="i === faqRows().length - 1" aria-label="העברה למטה">↓</button>
                            <button class="btn small" (click)="faqEdit.set({ id: q.id, question: q.question, answer: q.answer, published: q.published }); toTop()">עריכה</button>
                            <button class="btn small" (click)="toggleFaq(q)">{{ q.published ? 'הסתרה' : 'הצגה' }}</button>
                            <button class="btn small ghost" (click)="faqDelete.set(q)">מחיקה</button>
                          </div>
                        </td>
                      </tr>
                    } @empty { <tr><td colspan="5" class="muted">אין שאלות. אפשר להוסיף שאלה בטופס שלמעלה.</td></tr> }
                  </tbody>
                </table>
              </div>
              @if (faqDelete(); as d) {
                <div class="confirm-veil" (click)="faqDelete.set(null)"></div>
                <section class="card confirm" role="alertdialog" aria-modal="true" aria-labelledby="faq-del-title" aria-describedby="faq-del-q">
                  <h2 id="faq-del-title">האם את בטוחה שברצונך למחוק את השאלה?</h2>
                  <p id="faq-del-q" class="muted">„{{ d.question }}”</p>
                  <div class="row">
                    <button class="btn small danger" (click)="deleteFaq(d)" [disabled]="busy()">מחיקה</button>
                    <button class="btn small ghost" (click)="faqDelete.set(null)">ביטול</button>
                  </div>
                </section>
              }
            }
            @case ('settings') {
              @if (gmailResult(); as g) {
                <p class="msg-box" [class.ok]="GMAIL_RESULT[g]?.ok" role="status">{{ GMAIL_RESULT[g]?.text ?? ('תוצאת החיבור: ' + g) }}</p>
              }
              @if (emailSetup(); as es) {
                <section class="section setup">
                  <h2>שליחת מיילים — Gmail API</h2>
                  <p class="muted small">המיילים נשלחים מהשרת דרך Gmail API (HTTPS) מהחשבון <b dir="ltr">{{ es.sender }}</b>, בהרשאת שליחה בלבד. אין שימוש ב־SMTP.</p>
                  <ul class="status-list">
                    <li>הגדרות OAuth בשרת: <b>{{ es.configured ? 'קיימות' : 'חסרות' }}</b>
                      @if (!es.configured) { — <span dir="ltr">{{ es.missing.join(', ') }}</span> }</li>
                    <li>כתובת החזרה (Redirect URI) שיש להגדיר ב־Google Cloud: <code dir="ltr">{{ es.redirectUri ?? 'לא הוגדרה' }}</code></li>
                    <li>מצב החיבור: <b [class.good]="es.connected" [class.bad]="es.needsReconnect">{{ es.connected ? 'מחובר' : es.needsReconnect ? 'דרוש חיבור מחדש' : 'לא מחובר' }}</b>
                      @if (es.connectedAt) { · חובר ב־{{ es.connectedAt | date: 'd.M.yy HH:mm' }} }</li>
                    @if (es.lastError) { <li>שגיאה אחרונה: <b class="bad">{{ emailErrorLabel(es.lastError) }}</b> @if (es.lastErrorAt) { ({{ es.lastErrorAt | date: 'd.M.yy HH:mm' }}) }</li> }
                    <li>מייל בדיקה אחרון שאושר: {{ es.lastTestSentAt ? (es.lastTestSentAt | date: 'd.M.yy HH:mm') : 'עדיין לא נשלח' }}</li>
                    <li>שליחה אחרונה שאושרה: {{ es.lastSendAt ? (es.lastSendAt | date: 'd.M.yy HH:mm') : '—' }}</li>
                    <li>קישור לקבוצת העדכונים: {{ es.communityGroup ? 'מוגדר' : es.communityGroupRejected ? 'הוגדר אבל אינו קישור https תקין' : 'לא מוגדר' }}</li>
                  </ul>
                  <div class="actions-row">
                    <button class="btn primary" (click)="connectGmail()" [disabled]="busy() || !es.configured">{{ es.connected || es.needsReconnect ? 'חיבור Gmail מחדש' : 'חיבור חשבון Gmail' }}</button>
                    <button class="btn" (click)="sendTestEmail()" [disabled]="busy() || !es.connected">שליחת מייל בדיקה אל {{ es.sender }}</button>
                  </div>
                  @if (testResult(); as t) { <p class="msg-box" [class.ok]="t.ok" role="status">{{ t.text }}</p> }
                  <p class="muted small">בחיבור תועברו לעמוד של Google. יש להתחבר בחשבון {{ es.sender }} ולאשר שליחת מיילים. הטוקנים נשמרים בשרת מוצפנים ואינם מוצגים כאן.</p>
                </section>
                <section class="section setup">
                  <h2>מדיניות הטופס בסיום המשחק</h2>
                  <ul class="status-list">
                    <li>שליחת תוצאות במייל: <b>{{ es.resultsPolicy.requireMarketingConsent ? 'רק עם הסכמה שיווקית מפורשת באותו טופס' : 'גם בלי הסכמה שיווקית' }}</b>
                      (הגדרה <code dir="ltr">PORTALX_RESULTS_REQUIRE_MARKETING_CONSENT</code>)</li>
                    <li>נוסח ההסכמה (גרסה <span dir="ltr">{{ es.resultsPolicy.consentVersion }}</span>): „{{ es.resultsPolicy.consentText }}”</li>
                    @if (es.resultsPolicy.requireMarketingConsent) { <li>הודעה למי שלא סימן הסכמה: „{{ es.resultsPolicy.refusedMessage }}”</li> }
                    <li>ההסכמה ובקשת התוצאות נשמרות בנפרד. אין לסמן מראש. ביטול הסכמה עוצר דיוור, ואינו מתחדש בלי סימון חדש.</li>
                  </ul>
                  <p class="muted small">התניית מייל שירות בהסכמה שיווקית עשויה לעורר קושי משפטי — יש לבדוק עם עורך דין לפני הפעלה מסחרית.</p>
                </section>
              }
              <section class="section setup">
                <h2>דיוור שיווקי והסכמות</h2>
                <ul class="status-list">
                  <li>הסכמה לדיוור נאספת בתיבת סימון מפורשת בכל מקורות איסוף המייל: טופס התוצאות, יצירת קישור אישי, קופון אתגר 240 וקופון טעימת הפורטל.</li>
                  <li>קהל הדיוור השיווקי הוא רק כתובות עם הסכמה פעילה. הבדיקה נעשית בשרת בכל ייצוא של הקהל, ולא בדפדפן.</li>
                  <li>כתובת שביטלה הסכמה נשארת ברשימת החסימה המרכזית ולא תיכלל בדיוור, עד סימון הסכמה חדש ומפורש.</li>
                  <li>הודעות תפעוליות (תוצאות משחק, קופון שהונפק, הקישור האישי) נשלחות בנפרד ואינן דיוור שיווקי.</li>
                </ul>
                <div class="actions-row"><button class="btn small" type="button" (click)="go('customers')">ללקוחות ודיוור ‹</button></div>
              </section>
              <section class="section setup">
                <h2>סליקה — SUMIT</h2>
                <p class="muted small">בדיקת קריאה בלבד: לא מבוצע חיוב ולא נוצר דבר.</p>
                <div class="actions-row"><button class="btn small" type="button" (click)="sumitCheck()">בדיקת חיבור ל-SUMIT</button></div>
                @if (sumitStatus()) { <p class="msg-box ok" role="status">{{ sumitStatus() }}</p> }
              </section>
            }
            @case ('customers') {
              <form class="filters" (submit)="$event.preventDefault(); reload()">
                <label>חיפוש כתובת <input dir="ltr" [value]="mf().search ?? ''" (input)="setM('search', $any($event.target).value)" placeholder="name@" /></label>
                <label>הסכמה שיווקית
                  <select [value]="mf().consent ?? ''" (change)="setM('consent', $any($event.target).value)">
                    <option value="">הכול</option><option value="active">פעילה</option><option value="revoked">בוטלה</option><option value="none">אין הסכמה</option>
                  </select>
                </label>
                <label>מקור הגעה
                  <select [value]="mf().source ?? ''" (change)="setM('source', $any($event.target).value)">
                    <option value="">הכול</option><option value="results">בקשת תוצאות משחק</option><option value="referral">יצירת קישור אישי</option><option value="group">קישור לקבוצה</option>
                    <option value="challenge">קופון אתגר 240</option><option value="taste">קופון טעימת הפורטל</option>
                  </select>
                </label>
                <label>שליחת תוצאות
                  <select [value]="mf().status ?? ''" (change)="setM('status', $any($event.target).value)">
                    <option value="">הכול</option><option value="sent">נשלח</option><option value="pending">ממתין</option><option value="failed">נכשל</option><option value="uncertain">לא ודאי</option>
                  </select>
                </label>
                <label>משחק
                  <select [value]="mf().game ?? ''" (change)="setM('game', $any($event.target).value)">
                    <option value="">כל המשחקים</option>
                    @for (p of products(); track p.id) { <option [value]="p.scenarioId ?? p.id">{{ p.name }}</option> }
                  </select>
                </label>
                <label>מתאריך <input type="date" [value]="mf().from ?? ''" (change)="setM('from', $any($event.target).value)" /></label>
                <label>עד תאריך <input type="date" [value]="mf().to ?? ''" (change)="setM('to', $any($event.target).value)" /></label>
                <button class="btn small" type="submit">סינון</button>
                <button class="btn small ghost" type="button" (click)="mf.set({}); customer.set(null); reload()">איפוס</button>
              </form>
              @if (mailing(); as m) {
                <div class="cards">
                  <div class="stat accent"><span>לקוחות במאגר</span><b>{{ m.totals.customers }}</b><small>כתובת ייחודית אחת לכל לקוח, מכל המקורות</small></div>
                  <div class="stat accent"><span>מנויים שיווקיים פעילים</span><b>{{ m.totals.activeSubscribers }}</b><small>רק הם בקהל הדיוור השיווקי</small></div>
                  <div class="stat"><span>רשימת חסימה (ביטלו)</span><b>{{ m.totals.revokedSubscribers }}</b><small>לא יקבלו דיוור עד הסכמה חדשה</small></div>
                  <div class="stat"><span>ביקשו תוצאות משחק</span><b>{{ m.totals.resultsAddresses }}</b><small>{{ m.totals.resultsSent }} מיילי תוצאות נשלחו · הודעה תפעולית</small></div>
                  <div class="stat"><span>יוצרי קישור אישי</span><b>{{ m.totals.referralCreators }}</b><small>אישרו דיוור בטופס</small></div>
                  <div class="stat"><span>קופון אתגר 240</span><b>{{ m.totals.challengeCustomers }}</b><small>כתובות שקיבלו קופון באתגר</small></div>
                  <div class="stat"><span>קופון טעימת הפורטל</span><b>{{ m.totals.tasteCustomers }}</b><small>כתובות שקיבלו קופון בסיום הטעימה</small></div>
                  <div class="stat"><span>בקשות קישור לקבוצה</span><b>{{ m.totals.groupLinkRequests }}</b><small>בקשת קישור בלבד — לא אישור הצטרפות</small></div>
                </div>
                <div class="bar" style="margin-top:1rem"><span class="muted">{{ m.rows.length }} לקוחות בסינון · לחיצה על שורה מציגה היסטוריה מלאה</span></div>
                <div class="table-wrap">
                  <table>
                    <thead><tr><th>כתובת מייל</th><th>שם</th><th>מקורות הגעה</th><th>הסכמה שיווקית</th><th>תאריך הסכמה</th><th>תאריך ביטול</th><th>קופונים</th><th>שליחת תוצאות</th><th>משחק אחרון</th><th>שליחה אחרונה</th><th></th></tr></thead>
                    <tbody>
                      @for (r of m.rows; track r.email) {
                        <tr class="click" [class.sel]="customer()?.row?.email === r.email" (click)="showCustomer(r)">
                          <td dir="ltr">{{ r.email }}</td>
                          <td>{{ r.firstName ? r.firstName + ' ' + r.lastName : '—' }}</td>
                          <td class="wrap">{{ sourcesLabel(r.sources) }}</td>
                          <td><span class="st" [attr.data-s]="r.consent === 'active' ? 'paid' : r.consent === 'revoked' ? 'failed' : ''">{{ consentLabel(r.consent) }}</span></td>
                          <td>{{ r.consentedAt ? (r.consentedAt | date: 'd.M.yy HH:mm') : '—' }}</td>
                          <td>{{ r.revokedAt ? (r.revokedAt | date: 'd.M.yy HH:mm') : '—' }}</td>
                          <td>{{ r.coupons || '—' }}</td>
                          <td>@if (r.resultsStatus) { <span class="st" [attr.data-s]="r.resultsStatus === 'sent' ? 'paid' : r.resultsStatus === 'failed' ? 'failed' : ''">{{ mailLabel(r.resultsStatus) }}</span> } @else { — }</td>
                          <td>{{ r.lastGameName ?? '—' }}</td>
                          <td>{{ r.lastSentAt ? (r.lastSentAt | date: 'd.M.yy HH:mm') : '—' }}</td>
                          <td><button type="button" class="btn small ghost" (click)="$event.stopPropagation(); showCustomer(r)">פרטים</button></td>
                        </tr>
                      } @empty { <tr><td colspan="11" class="muted">אין לקוחות בסינון הזה.</td></tr> }
                    </tbody>
                  </table>
                </div>
                @if (customer(); as c) {
                  <section class="section details" aria-label="פרטי לקוח" #customerBox>
                    <div class="bar">
                      <h2 dir="ltr">{{ c.row.email }}</h2>
                      <button class="btn small ghost" type="button" (click)="customer.set(null)">סגירה</button>
                    </div>
                    @if (!c.details) {
                      <p class="loading">טוענים היסטוריה…</p>
                    } @else {
                      @let x = c.details;
                      <div class="cards">
                        <div class="stat" [class.accent]="x.mailable"><span>דיוור שיווקי</span><b class="date">{{ x.mailable ? 'מותר' : 'אסור' }}</b><small>הסכמה: {{ consentLabel(x.consent) }}@if (x.consentVersion) { · נוסח <span dir="ltr">{{ x.consentVersion }}</span> }</small></div>
                        <div class="stat"><span>מקורות הגעה</span><b class="date">{{ sourcesLabel(c.row.sources) }}</b><small>@if (c.row.registeredAt) { הגיע לראשונה {{ c.row.registeredAt | date: 'd.M.yy' }} }</small></div>
                        <div class="stat"><span>קופונים</span><b>{{ x.coupons.length }}</b><small>{{ redeemedCount(x) }} מומשו</small></div>
                        <div class="stat"><span>בקשות תוצאות</span><b>{{ x.results.length }}</b><small>@if (x.groupLinkRequests) { {{ x.groupLinkRequests }} בקשות קישור לקבוצה } @else { ללא בקשת קישור לקבוצה }</small></div>
                      </div>
                      <div class="detail-grid">
                        <div>
                          <h3>היסטוריית הסכמה והסרה</h3>
                          <ul class="timeline">
                            @for (h of x.history; track $index) {
                              <li [class.bad]="h.action === 'revoked'"><b>{{ h.action === 'granted' ? 'אישר/ה דיוור' : h.action === 'revoked' ? 'הסיר/ה את עצמו/ה' : h.action }}</b>
                                · {{ consentSourceLabel(h.source) }} · {{ h.at | date: 'd.M.yy HH:mm' }}</li>
                            } @empty { <li class="muted">לא ניתנה הסכמה לדיוור.</li> }
                          </ul>
                          @if (x.referral; as rf) {
                            <h3>קישור אישי</h3>
                            <p>{{ rf.firstName }} {{ rf.lastName }} · נוצר {{ rf.createdAt | date: 'd.M.yy' }} · {{ rf.status === 'active' ? 'פעיל' : 'מושבת' }}
                              @if (c.row.referralUrl) { · <a dir="ltr" [href]="c.row.referralUrl" target="_blank" rel="noopener">{{ shortUrl(c.row.referralUrl) }}</a> }</p>
                          }
                        </div>
                        <div>
                          <h3>קופונים</h3>
                          <ul>
                            @for (k of x.coupons; track k.code) {
                              <li><b dir="ltr">{{ k.code }}</b> · {{ k.source === 'taste' ? 'טעימת הפורטל' : 'אתגר 240' }} · {{ k.issuedAt | date: 'd.M.yy' }} · <span class="st" [attr.data-s]="k.status === 'redeemed' ? 'paid' : k.status === 'active' ? '' : 'failed'">{{ label(k.status) === k.status ? k.status : label(k.status) }}</span></li>
                            } @empty { <li class="muted">לא הונפקו קופונים לכתובת הזאת.</li> }
                          </ul>
                          <h3>בקשות תוצאות אחרונות</h3>
                          <ul>
                            @for (r of x.results.slice(0, 5); track $index) {
                              <li>{{ gameName(r.scenarioId) }} · {{ r.requestedAt | date: 'd.M.yy HH:mm' }} · {{ mailLabel(r.status) }}</li>
                            } @empty { <li class="muted">לא ביקש/ה תוצאות.</li> }
                          </ul>
                        </div>
                      </div>
                    }
                  </section>
                }
                <p class="note">לקוח אחד לכל כתובת מייל (אותיות קטנות, בלי רווחים), מכל המקורות יחד. קהל הדיוור השיווקי הוא רק הכתובות שהסכמתן „פעילה” — הייצוא שלו נבדק בשרת וכולל קישור הסרה אישי לכל מנוי. כתובת שביקשה תוצאות או קיבלה קופון בלי הסכמה אינה מנויה.</p>
              } @else if (!error()) { <p class="loading">טוענים לקוחות…</p> }
            }
            @case ('referrals') {
              <form class="filters" (submit)="$event.preventDefault(); reload()">
                <label>חיפוש שם או מייל <input [value]="rf().search ?? ''" (input)="setR('search', $any($event.target).value)" /></label>
                <label>סטטוס
                  <select [value]="rf().status ?? ''" (change)="setR('status', $any($event.target).value)">
                    <option value="">הכול</option><option value="active">פעיל</option><option value="disabled">מושבת</option>
                  </select>
                </label>
                <label>משחק שנרכש
                  <select [value]="rf().game ?? ''" (change)="setR('game', $any($event.target).value)">
                    <option value="">כל המשחקים</option>
                    @for (p of paidProducts(); track p.id) { <option [value]="p.id">{{ p.name }}</option> }
                  </select>
                </label>
                <label>קישור נוצר מ־ <input type="date" [value]="rf().createdFrom ?? ''" (change)="setR('createdFrom', $any($event.target).value)" /></label>
                <label>עד <input type="date" [value]="rf().createdTo ?? ''" (change)="setR('createdTo', $any($event.target).value)" /></label>
                <label>רכישות שולמו מ־ <input type="date" [value]="rf().paidFrom ?? ''" (change)="setR('paidFrom', $any($event.target).value)" /></label>
                <label>עד <input type="date" [value]="rf().paidTo ?? ''" (change)="setR('paidTo', $any($event.target).value)" /></label>
                <label>מינימום רכישות <input type="number" min="0" step="1" dir="ltr" [value]="rf().minPurchases ?? ''" (input)="setR('minPurchases', $any($event.target).value)" /></label>
                <label>מינימום הכנסה נטו <input type="number" min="0" step="1" dir="ltr" [value]="rf().minNet ?? ''" (input)="setR('minNet', $any($event.target).value)" /></label>
                <button class="btn small" type="submit">סינון</button>
                <button class="btn small ghost" type="button" (click)="rf.set({}); refDetail.set(null); reload()">איפוס</button>
              </form>
              @if (referrals(); as rl) {
                <div class="cards">
                  <div class="stat"><span>קישורים אישיים</span><b>{{ rl.summary.links }}</b><small>{{ rl.summary.activeLinks }} פעילים</small></div>
                  <div class="stat"><span>סך רכישות ששולמו</span><b>{{ rl.summary.purchases }}</b><small>{{ rl.summary.refunded }} מהן הוחזרו · ללא רכישות בדיקה ורכישה עצמית</small></div>
                  <div class="stat"><span>סך מכירות ברוטו</span><b>{{ money(rl.summary.money, 'gross') }}</b><small>סך החזרים: {{ money(rl.summary.money, 'refunds') }}</small></div>
                  <div class="stat accent"><span>הכנסה נטו מיוחסת</span><b>{{ money(rl.summary.money, 'net') }}</b><small>ברוטו פחות החזרים בפועל</small></div>
                  <div class="stat"><span>כניסות דרך הקישורים</span><b>{{ rl.summary.visits }}</b><small>ביקור שנפתח דרך קישור אישי · רענון של אותו ביקור לא נספר</small></div>
                  <div class="stat"><span>משחקים חינמיים שנפתחו</span><b>{{ rl.summary.freeGames }}</b><small>כל משחק פעם אחת, רק כשהשחקנים נכנסו למשחק עצמו</small></div>
                </div>
                <div class="bar" style="margin-top:1rem"><span class="muted">{{ rl.rows.length }} קישורים · תאריכי „קישור נוצר” מסננים קישורים; תאריכי „רכישות שולמו” מסננים את הרכישות שנספרות</span></div>
                <div class="table-wrap">
                  <table>
                    <thead><tr><th>שם פרטי</th><th>שם משפחה</th><th>מייל</th><th>קישור אישי</th><th>תאריך יצירה</th><th>מספר רכישות</th><th>מכירות ברוטו</th><th>החזרים</th><th>הכנסה נטו</th><th>כניסות</th><th>משחקים חינמיים</th><th>משחקים שנרכשו</th><th>סטטוס</th><th></th></tr></thead>
                    <tbody>
                      @for (r of rl.rows; track r.id) {
                        <tr class="click" [class.sel]="refDetail()?.id === r.id" (click)="showReferral(r.id)">
                          <td>{{ r.firstName }}</td><td>{{ r.lastName }}</td><td dir="ltr">{{ r.email }}</td>
                          <td><span dir="ltr">{{ shortUrl(r.url) }}</span> <button type="button" class="btn small ghost" (click)="$event.stopPropagation(); copyUrl(r.url)">{{ copied() === r.url ? 'הועתק ✓' : 'העתקה' }}</button></td>
                          <td>{{ r.createdAt | date: 'd.M.yy HH:mm' }}</td>
                          <td>{{ r.purchases }}</td>
                          <td>{{ money(r.money, 'gross') }}</td><td>{{ money(r.money, 'refunds') }}</td><td><b>{{ money(r.money, 'net') }}</b></td>
                          <td>{{ r.visits }}</td><td>{{ r.freeGames }}</td>
                          <td class="wrap">@for (g of r.games; track g.productId) { <span>{{ g.name }} ({{ g.purchases }})</span>@if (!$last) {<span> · </span>} } @empty { — }</td>
                          <td><span class="st" [attr.data-s]="r.status === 'active' ? 'paid' : 'failed'">{{ r.status === 'active' ? 'פעיל' : 'מושבת' }}</span></td>
                          <td><button type="button" class="btn small" (click)="$event.stopPropagation(); showReferral(r.id)">פרטים</button></td>
                        </tr>
                      } @empty { <tr><td colspan="14" class="muted">אין קישורים בסינון הזה.</td></tr> }
                    </tbody>
                  </table>
                </div>
                @if (refDetail(); as d) {
                  <section class="section details" aria-label="פרטי קישור">
                    <div class="bar">
                      <h2>{{ d.firstName }} {{ d.lastName }}</h2>
                      <div class="row">
                        <button class="btn small" (click)="toggleReferral(d)" [disabled]="busy()">{{ d.status === 'active' ? 'השבתת הקישור' : 'הפעלת הקישור' }}</button>
                        <button class="btn small ghost" (click)="refDetail.set(null)">סגירה</button>
                      </div>
                    </div>
                    <ul>
                      <li>מייל: <span dir="ltr">{{ d.email }}</span></li>
                      <li>קישור: <a dir="ltr" [href]="d.url" target="_blank" rel="noopener">{{ d.url }}</a></li>
                      <li>נוצר: {{ d.createdAt | date: 'd.M.yy HH:mm' }} · סטטוס: {{ d.status === 'active' ? 'פעיל' : 'מושבת' }}@if (d.disabledAt) { (מ־{{ d.disabledAt | date: 'd.M.yy HH:mm' }}) }</li>
                      <li>מייל הקישור: {{ emailStatusLabel(d.lastEmailStatus) }}@if (d.lastEmailAt) { · אחרון {{ d.lastEmailAt | date: 'd.M.yy HH:mm' }} } · נשלח {{ d.emailsSent }} פעמים</li>
                      <li>הסכמה שיווקית: {{ consentLabel(d.consent) }}@if (d.consentAt) { · {{ d.consentAt | date: 'd.M.yy HH:mm' }} }@if (d.consentRevokedAt) { · בוטלה {{ d.consentRevokedAt | date: 'd.M.yy HH:mm' }} }</li>
                      <li>רכישות שנספרו: <b>{{ d.purchases }}</b> · הכנסה נטו: <b>{{ money(d.money, 'net') }}</b></li>
                      <li>כניסות דרך הקישור: <b>{{ d.visits }}</b> · משחקים חינמיים שנפתחו ושוחקו: <b>{{ d.freeGames }}</b> · כרטיסי הגרלה: <b>{{ d.drawTickets }}</b></li>
                      <li class="muted">עמלות: לא פעילות (אין חישוב ואין תשלום).</li>
                    </ul>
                    <div class="table-wrap">
                      <table>
                        <thead><tr><th>הזמנה</th><th>תאריך</th><th>משחק</th><th>סכום ששולם</th><th>סטטוס תשלום</th><th>החזר</th><th>נספרת לקישור</th><th>סיבת החרגה</th></tr></thead>
                        <tbody>
                          @for (o of d.orders; track o.id) {
                            <tr [class.test]="o.isTest">
                              <td>#{{ o.number }}</td>
                              <td>{{ (o.paidAt ?? o.createdAt) | date: 'd.M.yy HH:mm' }}</td>
                              <td>{{ o.productName }}</td>
                              <td>{{ o.amount | number: '1.0-2' }} {{ cur(o.currency) }}</td>
                              <td><span class="st" [attr.data-s]="o.status">{{ label(o.status) }}</span>@if (o.isTest) { <small> · בדיקה</small> }</td>
                              <td>@if (o.refunded) { {{ o.refunded | number: '1.0-2' }} {{ cur(o.currency) }}@if (o.refundedAt) { · {{ o.refundedAt | date: 'd.M.yy' }} } } @else { — }</td>
                              <td>{{ o.counted ? 'כן' : 'לא' }}</td>
                              <td>{{ exclusionLabel(o.excluded) }}</td>
                            </tr>
                          } @empty { <tr><td colspan="8" class="muted">עדיין אין הזמנות דרך הקישור הזה.</td></tr> }
                        </tbody>
                      </table>
                    </div>
                  </section>
                }
                <p class="note">רכישה נספרת לקישור רק אם התחילה באותו ביקור שבו נפתח הקישור, אושרה בתשלום אמיתי, אינה רכישת בדיקה ואינה רכישה של בעל הקישור עצמו. כל רכישה כזאת מזכה את בעל הקישור בכרטיס אחד להגרלה (בלשונית „הגרלה”). אין תגמול כספי ואין הנחה לרוכשים.</p>
              }
            }
            @case ('coupons') {
              <div class="subtabs" role="tablist" aria-label="קופונים והנחות">
                @for (s of couponSubs; track s.id) {
                  <button type="button" role="tab" [class.on]="couponSub() === s.id" [attr.aria-selected]="couponSub() === s.id" (click)="couponSub.set(s.id)">{{ s.label }}</button>
                }
              </div>
              @switch (couponSub()) {
                @case ('challenge') { <px-admin-challenge section="challenge" /> }
                @case ('taste') { <px-admin-challenge section="taste" /> }
                @case ('issued') { <px-admin-challenge section="issued" /> }
                @default {
                  <section class="section coupon-form">
                    <h2>{{ couponForm().id ? 'עריכת קופון' : 'קופון חדש' }}</h2>
                    <div class="grid3">
                      <label>קוד הקופון <input dir="ltr" maxlength="32" [value]="couponForm().code" (input)="cf('code', $any($event.target).value.toUpperCase())" placeholder="HANUKKAH15" /></label>
                      <label>שם פנימי <input maxlength="80" [value]="couponForm().name" (input)="cf('name', $any($event.target).value)" /></label>
                      <label>סוג ההנחה
                        <select [value]="couponForm().kind" (change)="cf('kind', $any($event.target).value)">
                          <option value="percent">אחוזים</option><option value="fixed">סכום קבוע (₪)</option>
                        </select>
                      </label>
                      <label>ערך ההנחה {{ couponForm().kind === 'percent' ? '(%)' : '(₪)' }} <input type="number" min="0.01" step="0.01" dir="ltr" [value]="couponForm().value" (input)="cf('value', $any($event.target).value)" /></label>
                      <label>תחילת תוקף <input type="datetime-local" [value]="couponForm().startsAt" (input)="cf('startsAt', $any($event.target).value)" /></label>
                      <label>סיום תוקף <input type="datetime-local" [value]="couponForm().endsAt" (input)="cf('endsAt', $any($event.target).value)" /></label>
                      <label>מספר מימושים מרבי <input type="number" min="0" step="1" dir="ltr" placeholder="ללא הגבלה" [value]="couponForm().maxRedemptions" (input)="cf('maxRedemptions', $any($event.target).value)" /></label>
                      <label class="check"><input type="checkbox" [checked]="couponForm().active" (change)="cf('active', $any($event.target).checked)" /> פעיל</label>
                    </div>
                    <fieldset>
                      <legend>המשחקים שעליהם חלה ההנחה</legend>
                      @for (p of paidProducts(); track p.id) {
                        <label class="check"><input type="checkbox" [checked]="couponForm().productIds.includes(p.id)" (change)="toggleCouponProduct(p.id, $any($event.target).checked)" /> {{ p.name }}{{ p.price ? ' · ' + p.price + ' ₪' : '' }}</label>
                      }
                    </fieldset>
                    <label>הערה פנימית <input maxlength="500" [value]="couponForm().note" (input)="cf('note', $any($event.target).value)" /></label>
                    <div class="row">
                      <button class="btn primary small" (click)="saveCoupon()" [disabled]="busy()">{{ couponForm().id ? 'שמירה' : 'יצירת קופון' }}</button>
                      @if (couponForm().id) { <button class="btn small ghost" (click)="couponForm.set(blankCoupon())">ביטול</button> }
                    </div>
                  </section>
                  <h2>הקופונים הכלליים</h2>
                  <div class="table-wrap">
                    <table>
                      <thead><tr><th>קוד</th><th>שם</th><th>משחקים</th><th>הנחה</th><th>תוקף</th><th>מצב</th><th>מימושים</th><th>ממתינים לתשלום</th><th>הנחה שניתנה</th><th>נוצר</th><th>פעולות</th></tr></thead>
                      <tbody>
                        @for (c of coupons(); track c.id) {
                          <tr>
                            <td dir="ltr"><b>{{ c.code }}</b></td><td>{{ c.name }}</td>
                            <td class="wrap">{{ couponProducts(c) }}</td>
                            <td>{{ c.kind === 'percent' ? c.value + '%' : (c.value | number: '1.0-2') + ' ₪' }}</td>
                            <td class="small">{{ c.startsAt ? (c.startsAt | date: 'd.M.yy HH:mm') : 'מיד' }} – {{ c.endsAt ? (c.endsAt | date: 'd.M.yy HH:mm') : 'ללא סיום' }}</td>
                            <td><span class="st" [attr.data-s]="c.state === 'active' ? 'paid' : c.state === 'expired' || c.state === 'disabled' ? 'failed' : ''">{{ label(c.state) }}</span></td>
                            <td>{{ c.redeemed }}{{ c.maxRedemptions ? ' / ' + c.maxRedemptions : '' }}</td><td>{{ c.reserved }}</td>
                            <td>{{ c.discountGiven | number: '1.0-2' }} ₪</td><td class="small">{{ c.createdAt | date: 'd.M.yy' }}</td>
                            <td>
                              <div class="row">
                                <button class="btn small" (click)="editCoupon(c)">עריכה</button>
                                <button class="btn small" (click)="toggleCoupon(c)">{{ c.active ? 'השבתה' : 'הפעלה' }}</button>
                                <button class="btn small ghost" (click)="showCouponOrders(c)">רכישות</button>
                              </div>
                            </td>
                          </tr>
                        } @empty { <tr><td colspan="11" class="muted">עדיין אין קופונים כלליים.</td></tr> }
                      </tbody>
                    </table>
                  </div>
                  @if (couponUses(); as u) {
                    <section class="section details" aria-label="רכישות עם הקופון">
                      <div class="bar"><h2>רכישות עם {{ u.code }}</h2><button class="btn small ghost" (click)="couponUses.set(null)">סגירה</button></div>
                      <div class="table-wrap">
                        <table>
                          <thead><tr><th>הזמנה</th><th>משחק</th><th>מחיר מקורי</th><th>הנחה</th><th>שולם</th><th>מצב הקופון</th><th>תשלום</th><th>מועד</th></tr></thead>
                          <tbody>
                            @for (x of u.rows; track $index) {
                              <tr [class.test]="x.isTest"><td>{{ x.orderNumber }}{{ x.isTest ? ' (בדיקה)' : '' }}</td><td>{{ x.productName }}</td>
                                <td>{{ x.originalPrice | number: '1.0-2' }} ₪</td><td>−{{ x.discount | number: '1.0-2' }} ₪</td><td>{{ x.finalPrice | number: '1.0-2' }} ₪</td>
                                <td>{{ label(x.redemption) }}</td><td>{{ x.orderStatus ? label(x.orderStatus) : '—' }}</td><td>{{ x.createdAt | date: 'd.M.yy HH:mm' }}</td></tr>
                            } @empty { <tr><td colspan="8" class="muted">הקופון עדיין לא שימש ברכישה.</td></tr> }
                          </tbody>
                        </table>
                      </div>
                    </section>
                  }
                }
              }
            }
          }
          }
        </main>
      </div>
    }
  `,
  styles: [`
    /* ------------------------------------------------ the shell: one screen high, only the work area scrolls */
    :host { display:block; min-height:100dvh; background:var(--bg); }
    :host(.shell) { display:flex; flex-direction:column; height:100dvh; overflow:hidden; }
    .top, .free-slot, .body { width:100%; max-width:1680px; margin:0 auto; }
    .top { flex:none; display:flex; align-items:center; gap:1rem; justify-content:space-between; padding:12px 16px; flex-wrap:wrap; }
    .brand { font-weight:900; letter-spacing:.08em; text-decoration:none; direction:ltr; }
    .free-slot { flex:none; padding:0 16px; }
    .body { flex:1 1 auto; min-height:0; display:flex; gap:16px; padding:0 16px 16px; }
    main.plain { max-width:1280px; margin:0 auto; padding:0 16px 48px; }
    main.narrow { max-width:520px; padding-top:2rem; }
    .narrow .card { display:flex; flex-direction:column; gap:.6rem; align-items:flex-start; }

    /* ------------------------------------------------ the side menu (right, since the page is RTL) */
    .side { flex:none; width:236px; min-height:0; display:flex; flex-direction:column; background:linear-gradient(180deg, #101a3a, #0b1230);
      border:1px solid rgba(201,162,77,.25); border-radius:16px; overflow:hidden; }
    .side nav { flex:1 1 auto; min-height:0; overflow-y:auto; padding:.6rem .55rem .9rem; overscroll-behavior:contain; }
    .side .group { margin:.75rem .55rem .3rem; font-size:.72rem; font-weight:800; letter-spacing:.06em; color:var(--gold-dark); text-transform:uppercase; }
    .side .group:first-child { margin-top:.2rem; }
    .side ul { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:2px; }
    .side nav button { width:100%; display:flex; align-items:center; gap:.65rem; padding:.55rem .7rem; min-height:40px; border:0; border-radius:10px;
      background:transparent; color:var(--muted); font:inherit; font-size:.94rem; font-weight:600; text-align:start; cursor:pointer; position:relative;
      transition:background .15s, color .15s; }
    .side nav button:hover { background:rgba(255,255,255,.05); color:var(--text); }
    .side nav button:focus-visible { outline:2px solid var(--gold-2); outline-offset:-2px; }
    .side nav button.on { background:linear-gradient(90deg, rgba(224,185,92,.06), rgba(224,185,92,.2)); color:var(--gold-2); font-weight:800;
      box-shadow:inset 0 0 0 1px rgba(224,185,92,.45); }
    .side nav button.on::after { content:''; position:absolute; inset-inline-start:-.55rem; top:20%; bottom:20%; width:4px; border-radius:0 4px 4px 0;
      background:var(--gold); }
    .side svg { width:19px; height:19px; flex:none; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
    .menu-toggle { display:none; }

    /* ------------------------------------------------ the work area */
    .content { flex:1 1 auto; min-width:0; min-height:0; overflow-y:auto; overflow-x:hidden; padding:1.1rem 1.25rem 2rem;
      background:linear-gradient(180deg, #0b1330, #090f26); border:1px solid rgba(201,162,77,.25); border-radius:16px; overscroll-behavior:contain;
      scrollbar-gutter:stable; }
    .content:focus { outline:none; }
    /* the main list of a tab fills what is left of the screen, so the work area itself does not scroll as well */
    .content .table-wrap.fill { max-height:max(300px, calc(100dvh - 530px)); }
    .content > .filters { position:sticky; top:-1.1rem; z-index:3; box-shadow:0 8px 18px rgba(3,6,16,.55); }

    /* ------------------------------------------------ the free-game card: unchanged from before the redesign */
    .row { display:flex; gap:.5rem; flex-wrap:wrap; align-items:center; }
    .free { margin-bottom:1rem; }
    .free p { margin:.2rem 0 0; }
    .free-head { display:flex; flex-wrap:wrap; gap:.8rem 1.5rem; align-items:center; justify-content:space-between; }
    #free-panel { display:flex; flex-wrap:wrap; gap:.6rem; align-items:flex-end; margin-top:.8rem; }
    #free-panel label { display:flex; flex-direction:column; gap:.25rem; }
    .free-rooms { list-style:none; margin:.8rem 0 0; padding:0; display:flex; flex-direction:column; gap:.4rem; }
    .free-rooms li { display:flex; flex-wrap:wrap; gap:.5rem; align-items:center; }
    .room-code { font-size:1.15rem; letter-spacing:.12em; color:var(--gold-2); }
    .small { font-size:.8rem; }
    .free select { background:var(--panel-solid); color:var(--text); border:1px solid var(--line); border-radius:10px; padding:.45rem .6rem; min-height:40px; }

    /* ------------------------------------------------ tab contents */
    h3 { margin:.8rem 0 .3rem; font-size:1rem; color:var(--gold-2); }
    .status-list { margin:.6rem 0; padding-inline-start:1.2rem; line-height:1.9; } .status-list code { background:rgba(255,255,255,.06); padding:.1rem .4rem; border-radius:6px; word-break:break-all; }
    .good { color:#9be3b4; } .bad { color:#ffb4a6; }
    .actions-row { display:flex; gap:.6rem; flex-wrap:wrap; margin:.6rem 0; }
    .updated { align-self:center; color:var(--muted); font-size:.82rem; white-space:nowrap; }
    .free-report { margin-top:1rem; border-color:rgba(224,185,92,.5); }
    .free-report .bar, .details .bar { margin-bottom:.8rem; }
    td.muted-cell { color:var(--muted); }
    tr.test td { opacity:.65; } tr.click { cursor:pointer; } tr.sel td { background:rgba(224,185,92,.1) !important; }
    .row-actions { display:flex; gap:.3rem; }
    .st[data-s=paid], .st[data-s=published] { border-color:var(--ok); color:#9be3b4; }
    .st[data-s=refunded], .st[data-s=failed] { border-color:var(--bad); color:#ffc2b5; }
    .details { margin-top:1rem; border-color:rgba(224,185,92,.5); } .details ul { margin:0; padding-inline-start:1.2rem; line-height:1.75; }
    .details .cards { margin-bottom:.4rem; }
    .details .stat b.date { font-size:1rem; }
    .detail-grid { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:.4rem 1.5rem; }
    .timeline li.bad { color:#ffc2b5; }
    .products { display:grid; grid-template-columns:repeat(auto-fill, minmax(420px, 1fr)); gap:1rem; }
    .product { display:flex; flex-direction:column; gap:.55rem; }
    .product h2 { margin:0; }
    .product label { display:flex; flex-direction:column; gap:.2rem; font-size:.85rem; color:var(--muted); }
    .product input, .product textarea, .product select { width:100%; }
    .row3 { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:.5rem; }
    .row2 { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:.5rem; width:100%; }
    fieldset.prices { flex-direction:column; flex-wrap:nowrap; gap:.4rem; margin:0; }
    fieldset.prices p { margin:0; }
    .product input[aria-invalid="true"] { border-color:#ff9a7a; }
    .preview b { color:var(--gold-2); font-size:1rem; }
    .preview .was { color:var(--muted); margin-inline-end:.35rem; }
    .sale { border:1px solid rgba(201,162,77,.25); border-radius:12px; padding:.5rem .8rem .6rem; margin:0; display:flex; flex-direction:column; gap:.4rem; }
    .sale legend { color:var(--gold-2); font-weight:700; padding:0 .3rem; display:flex; gap:.4rem; align-items:center; }
    .sale label.check { flex-direction:row; align-items:center; gap:.4rem; }
    .sale p { margin:0; }
    .warn { margin:0; color:#ffd59a; font-size:.9rem; }
    .faq-form, .coupon-form { display:flex; flex-direction:column; gap:.55rem; }
    .faq-form h2, .coupon-form h2 { margin-top:0; }
    .faq-form label, .coupon-form label { display:flex; flex-direction:column; gap:.2rem; font-size:.85rem; color:var(--muted); }
    .faq-form label.check, .coupon-form label.check { flex-direction:row; align-items:center; gap:.4rem; color:var(--text); }
    .grid3 { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:.5rem .8rem; align-items:end; }
    fieldset { border:1px solid rgba(201,162,77,.25); border-radius:10px; padding:.5rem .8rem; display:flex; flex-wrap:wrap; gap:.4rem 1.2rem; }
    legend { color:var(--gold-2); font-size:.85rem; padding:0 .3rem; }
    td.wrap { white-space:normal; min-width:180px; max-width:420px; }
    .confirm-veil { position:fixed; inset:0; z-index:50; background:rgba(3,5,12,.6); }
    .confirm { position:fixed; z-index:51; left:50%; top:50%; transform:translate(-50%, -50%); width:min(440px, calc(100% - 32px)); box-sizing:border-box; }
    .confirm h2 { margin-top:0; font-size:1.15rem; }
    .ok { color:#9be3b4; }
    @media (max-width: 1100px) { .grid3 { grid-template-columns:repeat(2, minmax(0,1fr)); } .products { grid-template-columns:1fr; } }
    @media (max-width: 1100px) and (min-width: 861px) { .side { width:208px; } }

    /* ------------------------------------------------ phone and small tablet: the page scrolls, the menu folds */
    @media (max-width: 860px) {
      :host(.shell) { height:auto; min-height:100dvh; overflow:visible; display:block; }
      .body { display:block; padding:0 12px 24px; }
      .free-slot { padding:0 12px; }
      .side { position:sticky; top:0; z-index:20; width:auto; margin-bottom:12px; border-radius:14px; box-shadow:0 10px 24px rgba(3,6,16,.6); }
      .menu-toggle { display:flex; align-items:center; gap:.6rem; width:100%; min-height:48px; padding:.6rem .9rem; border:0; background:transparent;
        color:var(--text); font:inherit; font-weight:700; cursor:pointer; text-align:start; }
      .menu-toggle span { color:var(--muted); font-size:.85rem; }
      .menu-toggle b { margin-inline-start:auto; color:var(--gold-2); }
      .menu-toggle:focus-visible { outline:2px solid var(--gold-2); outline-offset:-2px; }
      .side nav { display:none; max-height:min(70dvh, 560px); border-top:1px solid rgba(201,162,77,.2); }
      .side.open nav { display:block; }
      .content { overflow:visible; padding:1rem .9rem 1.5rem; }
      .content > .filters { position:static; box-shadow:none; }
      .content .table-wrap.fill { max-height:70dvh; }
      .detail-grid { grid-template-columns:1fr; }
    }
    @media (max-width: 560px) {
      .grid3, .row3, .row2 { grid-template-columns:1fr; }
      .products { grid-template-columns:1fr; }
    }
  `],
})
export class AdminPage {
  private api = inject(AdminApiService);
  private router = inject(Router);
  private contentEl = viewChild<ElementRef<HTMLElement>>('content');
  readonly nav = NAV;
  readonly icon = ICON;
  state = signal<'loading' | 'denied' | 'ok'>('loading');
  name = signal('');
  tab = signal<Tab>('dashboard');
  head = computed(() => HEAD[this.tab()]);
  /** The side menu on a phone: folded until opened. */
  menuOpen = signal(false);
  /** A tab whose data is on its way (its own loading line instead of an empty screen). */
  loadingTab = signal(false);
  productSub = signal<ProductSub>('edit');
  couponSub = signal<CouponSub>('general');
  readonly couponSubs: { id: CouponSub; label: string }[] = [
    { id: 'general', label: 'קופונים כלליים' }, { id: 'challenge', label: 'אתגר 240' },
    { id: 'taste', label: 'קופוני טעימת הפורטל' }, { id: 'issued', label: 'קופונים אישיים שהונפקו' },
  ];
  readonly today = israelToday();
  readonly yearStart = this.today.slice(0, 4) + '-01-01';
  /** The range of the dashboard filters, or the last 30 days. */
  rangeFrom = computed(() => this.f().from || addDays(this.today, -29));
  rangeTo = computed(() => this.f().to || this.today);
  f = signal<AdminFilters>({});
  dash = signal<Dashboard | null>(null);
  orders = signal<AdminOrder[]>([]);
  games = signal<AdminGame[]>([]);
  game = signal<any | null>(null);
  products = signal<AdminProduct[]>([]);
  edits = signal<Record<string, ProductEdit>>({});
  saved = signal<string | null>(null);
  sumitStatus = signal<string | null>(null);
  freeOpen = signal(false);
  freeProduct = signal('');
  freeRooms = signal<{ code: string; productName: string }[]>([]);
  playableProducts = computed(() => this.products().filter((p) => p.playable));
  busy = signal(false);
  error = signal<string | null>(null);
  csvUrl = computed(() => this.api.csvUrl(this.f()));
  // mailing list and consents (results emails, marketing consent and group-link requests kept apart)
  mf = signal<MailingFilters>({});
  mailing = signal<MailingList | null>(null);
  // email setup: Gmail API with OAuth (status only — the page never sees a token)
  emailSetup = signal<EmailSetup | null>(null);
  gmailResult = signal<string | null>(null);
  testResult = signal<{ ok: boolean; text: string } | null>(null);
  readonly GMAIL_RESULT: Record<string, { ok: boolean; text: string }> = {
    connected: { ok: true, text: 'חשבון Gmail חובר בהצלחה. אפשר לשלוח מייל בדיקה.' },
    denied: { ok: false, text: 'האישור בוטל בעמוד של Google. החשבון לא חובר.' },
    'wrong-account': { ok: false, text: 'אושר חשבון אחר. יש להתחבר בחשבון info.portalx@gmail.com בלבד. ההרשאה של החשבון האחר בוטלה.' },
    'missing-scope': { ok: false, text: 'לא אושרה הרשאת השליחה. יש לחבר שוב ולאשר את שליחת המיילים.' },
    'no-refresh-token': { ok: false, text: 'Google לא החזיר הרשאה קבועה. יש לחבר שוב.' },
    'expired-state': { ok: false, text: 'עבר זמן רב מדי מתחילת החיבור. יש להתחיל מחדש.' },
    'used-state': { ok: false, text: 'קישור החיבור כבר נוצל. יש להתחיל מחדש.' },
    'bad-state': { ok: false, text: 'בקשת החיבור אינה תקפה (ייתכן שנפתחה בדפדפן אחר). יש להתחיל מחדש מהדף הזה.' },
    'exchange-failed': { ok: false, text: 'Google לא אישר את קוד החיבור. בדקו את הגדרות ה־OAuth ונסו שוב.' },
    'not-configured': { ok: false, text: 'הגדרות OAuth חסרות בשרת.' },
    'google-error': { ok: false, text: 'Google החזיר שגיאה. נסו שוב.' },
  };
  emailErrorLabel = (e?: string | null) => (e ? ({
    invalid_grant: 'ההרשאה בוטלה או פגה (למשל אחרי 7 ימים במצב Testing)', 'key-changed': 'מפתח ההצפנה השתנה', 'token-unreadable': 'הטוקן השמור אינו קריא',
    unauthorized: 'Gmail דחה את ההרשאה', 'insufficient-scope': 'חסרה הרשאת שליחה', invalid_client: 'פרטי ה־OAuth Client שגויים', unauthorized_client: 'ה־OAuth Client אינו מורשה',
  } as Record<string, string>)[e] ?? e : '');

  async connectGmail() {
    this.busy.set(true);
    this.testResult.set(null);
    try {
      const r = await this.api.startGmail();
      // Google's consent page; it returns to the server's callback, which brings the admin back here
      location.href = r.url;
    } catch (e: any) {
      this.error.set(e.message);
      this.busy.set(false);
    }
  }

  async sendTestEmail() {
    this.busy.set(true);
    this.testResult.set(null);
    try {
      const r = await this.api.testEmail();
      this.testResult.set({ ok: true, text: r.message });
    } catch (e: any) {
      this.testResult.set({ ok: false, text: e.message });
    } finally {
      this.busy.set(false);
      this.emailSetup.set(await this.api.emailSetup());
    }
  }
  mailingCsvUrl = computed(() => this.api.mailingCsvUrl(this.mf()));
  readonly audienceCsvUrl = this.api.audienceCsvUrl();
  /** The customer whose history is open: its row at once, the details once the server answered. */
  customer = signal<{ row: MailingRow; details: CustomerDetails | null } | null>(null);
  async showCustomer(row: MailingRow) {
    this.customer.set({ row, details: null });
    try {
      const details = await this.api.customer(row.email);
      if (this.customer()?.row.email === row.email) this.customer.set({ row, details });
    } catch (e: any) {
      this.customer.set(null);
      this.fail(e);
    }
  }
  redeemedCount = (x: CustomerDetails) => x.coupons.filter((k) => k.status === 'redeemed').length;
  consentSourceLabel = (s: string) => ({ results: 'טופס תוצאות', referral: 'יצירת קישור אישי', 'challenge-240': 'קופון אתגר 240', taste: 'קופון טעימת הפורטל',
    'unsubscribe-link': 'קישור הסרה במייל' } as Record<string, string>)[s] ?? s;
  // personal links (affiliate spec 10)
  rf = signal<ReferralFilters>({});
  referrals = signal<ReferralList | null>(null);
  refDetail = signal<ReferralDetails | null>(null);
  copied = signal<string | null>(null);
  referralsCsvUrl = computed(() => this.api.referralsCsvUrl(this.rf()));
  setR(key: keyof ReferralFilters, value: string) {
    this.rf.update((f) => ({ ...f, [key]: value || undefined }));
  }
  cur = (c: string) => (c === 'ILS' ? '₪' : c);
  /** Amounts of each currency side by side — never added across currencies. */
  money(list: MoneyTotals[], key: 'gross' | 'refunds' | 'net') {
    if (!list.length) return '0 ₪';
    return list.map((m) => `${m[key].toLocaleString('he-IL', { maximumFractionDigits: 2 })} ${this.cur(m.currency)}`).join(' · ');
  }
  shortUrl = (u: string) => u.replace(/^https?:\/\//, '');
  sourcesLabel = (s: string[]) => s.map((x) => ({ results: 'בקשת תוצאות', referral: 'יצירת קישור אישי', group: 'קישור לקבוצה', challenge: 'אתגר 240', taste: 'טעימת הפורטל' } as Record<string, string>)[x] ?? x).join(' · ') || '—';
  emailStatusLabel = (s?: string | null) => ({ sent: 'נשלח (אושר ב־Gmail)', failed: 'השליחה נכשלה', uncertain: 'לא ודאי', 'not-configured': 'שליחת מיילים לא הוגדרה', sending: 'בשליחה' } as Record<string, string>)[s ?? ''] ?? 'לא נשלח';
  exclusionLabel = (s?: string | null) => ({ 'self-purchase': 'רכישה עצמית', test: 'רכישת בדיקה', 'not-paid': 'לא שולמה' } as Record<string, string>)[s ?? ''] ?? '—';
  async copyUrl(url: string) {
    try { await navigator.clipboard.writeText(url); this.copied.set(url); setTimeout(() => this.copied.set(null), 2000); } catch { /* the link is shown, it can be copied by hand */ }
  }
  async showReferral(id: string) {
    try { this.refDetail.set(await this.api.referral(id)); } catch (e: any) { this.fail(e); }
  }
  async toggleReferral(d: ReferralDetails) {
    this.busy.set(true);
    try {
      await this.api.setReferralActive(d.id, d.status !== 'active');
      this.refDetail.set(await this.api.referral(d.id));
      this.referrals.set(await this.api.referrals(this.rf()));
    } catch (e: any) {
      this.fail(e);
    } finally {
      this.busy.set(false);
    }
  }
  mailLabel = (s: string) => ({ sent: 'נשלח', pending: 'ממתין', failed: 'נכשל', uncertain: 'לא ודאי' } as Record<string, string>)[s] ?? s;
  consentLabel = (s: string) => ({ active: 'פעילה', revoked: 'בוטלה', pending: 'ממתינה לאימות', none: 'אין' } as Record<string, string>)[s] ?? s;
  gameName = (id?: string | null) => (id === 'personal-link' ? 'יצירת קישור אישי' : id ? this.products().find((p) => (p.scenarioId ?? p.id) === id)?.name ?? id : '—');
  setM(key: keyof MailingFilters, value: string) {
    this.mf.update((f) => ({ ...f, [key]: value || undefined }));
  }
  // FAQ management (spec 2.4)
  faqRows = signal<FaqRow[]>([]);
  /** The question waiting for "delete" to be confirmed. */
  faqDelete = signal<FaqRow | null>(null);
  emptyFaq = () => ({ id: '' as string, question: '', answer: '', published: true });
  faqEdit = signal(this.emptyFaq());
  // coupons (spec 4.2–4.9)
  coupons = signal<CouponRow[]>([]);
  blankCoupon = (): CouponForm => ({ ...EMPTY_COUPON, productIds: [] });
  couponForm = signal<CouponForm>(this.blankCoupon());
  couponUses = signal<{ code: string; rows: CouponUse[] } | null>(null);
  paidProducts = computed(() => this.products().filter((p) => !p.isFree));

  /** When the data on the screen was read from the server (shown next to the refresh button). */
  dataAt = computed(() => {
    const at = adminDataAt();
    return at == null ? null : new Date(at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  });
  /** Changed by "רענון": the tab's parts are built again and read their data from the server. */
  refreshKey = signal(0);

  constructor() {
    this.init();
  }

  /** Reads the open tab again from the server, its own parts included (nothing from the last minute is used). */
  refresh() {
    adminCache.clear();
    this.refreshKey.update((k) => k + 1);
    void this.reload();
  }

  private async init() {
    try {
      const s = await this.api.session();
      if (!s.admin) return this.state.set('denied');
      this.name.set(s.name ?? '');
      this.state.set('ok');
      const products = await this.api.products();
      this.products.set(products);
      // the tab in the address (?tab=…) opens again after a reload. Old names still arrive — e.g. Google's return to
      // "email-setup", which now lives in the system settings (its result is a short code, never a token).
      const q = new URLSearchParams(location.search);
      const asked = q.get('tab');
      if (asked) {
        if (asked === 'challenge') this.couponSub.set('challenge');
        const t = (LEGACY[asked] ?? asked) as Tab;
        if (t in HEAD) this.tab.set(t);
        if (q.get('gmail')) this.gmailResult.set(q.get('gmail'));
        this.syncUrl();
      }
      await this.reload();
    } catch (e: any) {
      if (e.code === 'unauthorized' || e.code === 'forbidden') this.state.set('denied');
      else { this.state.set('ok'); this.error.set(e.message); }
    }
  }

  label = (s: string) => STATUS[s] ?? s;
  minutes = (sec: number) => `${Math.round(sec / 60)} דק׳`;
  edit = (id: string): ProductEdit => this.edits()[id] ?? {};

  set(key: keyof AdminFilters, value: string | boolean) {
    this.f.update((f) => ({ ...f, [key]: value }));
  }

  go(t: Tab) {
    const changed = this.tab() !== t;
    this.tab.set(t);
    this.menuOpen.set(false);
    this.f.update((f) => ({ ...f, status: undefined, access: undefined, search: undefined }));
    this.game.set(null);
    this.customer.set(null);
    if (changed) {
      this.gmailResult.set(null);
      this.syncUrl();
      this.toTop(false);
    }
    // entering another tab may show what was read in the last minute; pressing the open tab again reads it anew
    this.reload(changed);
  }

  /** Keeps the open tab in the address, so a reload or a shared link opens the same place. */
  private syncUrl() {
    history.replaceState(null, '', this.tab() === 'dashboard' ? location.pathname : location.pathname + '?tab=' + this.tab());
  }

  /** Back to the top of the work area (the only part that scrolls on a computer; on a phone, the page). */
  toTop(smooth = true) {
    const behavior: ScrollBehavior = smooth ? 'smooth' : 'auto';
    this.contentEl()?.nativeElement.scrollTo({ top: 0, behavior });
    if (window.matchMedia('(max-width: 860px)').matches) window.scrollTo({ top: 0, behavior });
  }

  /** The games table filtered to the free trial: every run with its dates, players and status. */
  freeGameHistory(productId: string) {
    this.tab.set('games');
    this.syncUrl();
    this.toTop(false);
    this.f.update((f) => ({ ...f, productId, status: undefined, access: 'free-sample', search: undefined }));
    this.game.set(null);
    this.reload();
  }

  /** Loads the open tab. Only entering a tab passes `cached` (see core/admin-cache.ts); filters, saves and refresh never do. */
  async reload(cached = false) {
    this.error.set(null);
    const api = cached ? this.api.cached() : this.api;
    const tab = this.tab();
    // a loading line only where the tab has nothing to show yet (the child tabs show their own)
    this.loadingTab.set((tab === 'dashboard' && !this.dash()) || (tab === 'settings' && !this.emailSetup()) || (tab === 'games' && !this.games().length)
      || (tab === 'orders' && !this.orders().length) || (tab === 'referrals' && !this.referrals()));
    try {
      switch (this.tab()) {
        case 'dashboard': this.dash.set(await api.dashboard(this.f())); break;
        case 'orders': this.orders.set(await api.orders(this.f())); break;
        case 'games': this.games.set(await api.games(this.f())); break;
        case 'products': this.products.set(await api.products()); break;
        case 'faq': {
          const f = await api.faq();
          this.faqRows.set(f.custom);
          break;
        }
        case 'coupons': this.coupons.set(await api.coupons()); break;
        case 'settings': this.emailSetup.set(await api.emailSetup()); break;
        case 'referrals':
          if (!this.products().length) this.products.set(await api.products());
          this.referrals.set(await api.referrals(this.rf()));
          break;
        case 'customers':
          if (!this.products().length) this.products.set(await api.products());
          this.mailing.set(await api.mailing(this.mf()));

          break;
      }
    } catch (e: any) {
      this.fail(e);
    } finally {
      this.loadingTab.set(false);
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

  saleLabel = (s: string) => SALE_STATE[s] ?? s;

  async clearSale(id: string) {
    this.busy.set(true);
    this.error.set(null);
    try {
      const updated = await this.api.updateProduct(id, { clearSaleOpening: true });
      this.products.update((list) => list.map((p) => (p.id === id ? updated : p)));
      this.edits.update((x) => ({ ...x, [id]: { ...(x[id] ?? {}), saleDate: undefined, saleTime: undefined } }));
    } catch (err: any) {
      this.fail(err);
    } finally {
      this.busy.set(false);
    }
  }

  /** The current and previous price as they will be saved (the typed value, else the stored one); null = empty. */
  private pricesOf(p: AdminProduct): { now: number | null; was: number | null; wasText: string } {
    const e = this.edit(p.id);
    const num = (v: string | number | null | undefined) => (v == null || String(v).trim() === '' ? null : Number(v));
    const wasText = String(e.previousPriceIls ?? p.previousPrice ?? '').trim();
    return { now: num(e.priceIls ?? p.price), was: num(wasText), wasText };
  }

  /** A clear message when the previous price cannot be saved, checked again whenever either price changes. */
  previousPriceProblem(p: AdminProduct): string | null {
    if (p.isFree) return null;
    const { now, was, wasText } = this.pricesOf(p);
    if (was == null) return null;
    if (!Number.isFinite(was) || was <= 0 || Math.abs(Math.round(was * 100) - was * 100) > 1e-6 || was > 10000) return `המחיר הקודם "${wasText}" אינו תקין: יש להזין סכום חיובי בשקלים, עד שתי ספרות אחרי הנקודה.`;
    if (now == null || !(now > 0)) return 'אי אפשר לשמור מחיר קודם בלי מחיר נוכחי. קבעו מחיר נוכחי או מחקו את המחיר הקודם.';
    if (was <= now) return `המחיר הקודם (${was} ₪) חייב להיות גבוה מהמחיר הנוכחי (${now} ₪). תקנו אחד מהם, או מחקו את המחיר הקודם.`;
    return null;
  }

  /** How the price will look on the site, for the admin form. */
  pricePreview(p: AdminProduct): { now: number; was: number | null } | null {
    const { now, was } = this.pricesOf(p);
    return now != null && now > 0 ? { now, was } : null;
  }

  async save(id: string) {
    const e = this.edit(id);
    const body: Record<string, unknown> = {};
    for (const k of ['name', 'tagline', 'description', 'coverImage', 'status'] as const) if (e[k] !== undefined) body[k] = e[k];
    if (e.priceIls !== undefined) {
      if (String(e.priceIls).trim() === '') body['clearPrice'] = true;
      else body['priceIls'] = Number(e.priceIls);
    }
    // the previous price is display only; checked here for a quick message and again on the server
    const product = this.products().find((x) => x.id === id);
    const problem = product ? this.previousPriceProblem(product) : null;
    if (problem) { this.error.set(problem); return; }
    if (e.previousPriceIls !== undefined) {
      if (String(e.previousPriceIls).trim() === '') body['clearPreviousPrice'] = true;
      else body['previousPriceIls'] = Number(e.previousPriceIls);
    }
    if (e.maxPlayers !== undefined) body['maxPlayers'] = Number(e.maxPlayers);
    // the opening date and time go together (Israel time); the server checks them and stores UTC
    if (e.saleDate !== undefined || e.saleTime !== undefined) {
      const p = this.products().find((x) => x.id === id);
      body['saleDate'] = e.saleDate ?? p?.saleDate ?? '';
      body['saleTime'] = e.saleTime ?? p?.saleTime ?? '';
    }
    if (e.showBeforeSale !== undefined) body['showBeforeSale'] = e.showBeforeSale === 'true';
    if (e.salePaused !== undefined) body['salePaused'] = e.salePaused === 'true';
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

  toggleFree() {
    this.freeOpen.update((o) => !o);
    if (!this.freeProduct()) this.freeProduct.set(this.playableProducts()[0]?.id ?? '');
  }

  /** Each press makes one more room with its own code; the server checks that this is the admin. */
  async openFree() {
    if (!this.freeProduct()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const g = await this.api.freeGame(this.freeProduct());
      sessionStore.setHostClaim(g.code, g.hostClaim);
      this.freeRooms.update((rooms) => [{ code: g.code, productName: g.productName }, ...rooms]);
      if (this.tab() === 'dashboard' || this.tab() === 'games') this.reload();
    } catch (e: any) {
      this.fail(e);
    } finally {
      this.busy.set(false);
    }
  }

  async copyCode(code: string) {
    try { await navigator.clipboard.writeText(code); this.copied.set(code); setTimeout(() => this.copied.set(null), 2000); } catch { /* the code is on the screen */ }
  }

  /** Enters a room the admin opened as its host (a fresh host claim is issued while it is in the lobby). */
  async enter(code: string) {
    try {
      const g = await this.api.reclaim(code);
      if (g.hostClaim) sessionStore.setHostClaim(g.code, g.hostClaim);
      await this.router.navigate(['/join', g.code]);
    } catch (e: any) {
      this.fail(e);
    }
  }

  // ------------------------------------------------------------------ FAQ

  fe(key: 'question' | 'answer' | 'published', value: string | boolean) {
    this.faqEdit.update((e) => ({ ...e, [key]: value }));
  }

  async saveFaq() {
    const e = this.faqEdit();
    this.busy.set(true);
    this.error.set(null);
    try {
      const body = { question: e.question, answer: e.answer, published: e.published };
      if (e.id) await this.api.updateFaq(e.id, body);
      else await this.api.addFaq(body);
      this.faqEdit.set(this.emptyFaq());
      await this.reload();
    } catch (err: any) {
      this.fail(err);
    } finally {
      this.busy.set(false);
    }
  }

  async toggleFaq(q: FaqRow) {
    try { await this.api.updateFaq(q.id, { published: !q.published }); await this.reload(); } catch (e: any) { this.fail(e); }
  }

  async deleteFaq(q: FaqRow) {
    this.busy.set(true);
    try {
      await this.api.deleteFaq(q.id);
      this.faqDelete.set(null);
      await this.reload();
    } catch (e: any) {
      this.fail(e);
    } finally {
      this.busy.set(false);
    }
  }

  /** Swaps the order of two added questions. */
  async moveFaq(i: number, dir: number) {
    const list = this.faqRows();
    const a = list[i];
    const b = list[i + dir];
    if (!a || !b) return;
    try {
      await this.api.updateFaq(a.id, { sortOrder: i + dir + 1 });
      await this.api.updateFaq(b.id, { sortOrder: i + 1 });
      for (const [k, q] of list.entries()) if (k !== i && k !== i + dir && q.sortOrder !== k + 1) await this.api.updateFaq(q.id, { sortOrder: k + 1 });
      await this.reload();
    } catch (e: any) {
      this.fail(e);
    }
  }

  // ------------------------------------------------------------------ coupons

  cf<K extends keyof CouponForm>(key: K, value: CouponForm[K]) {
    this.couponForm.update((f) => ({ ...f, [key]: value }));
  }

  toggleCouponProduct(id: string, on: boolean) {
    this.couponForm.update((f) => ({ ...f, productIds: on ? [...new Set([...f.productIds, id])] : f.productIds.filter((x) => x !== id) }));
  }

  couponProducts = (c: CouponRow) => c.products.map((p) => p.name).join(', ');

  private local(iso?: string | null) {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  editCoupon(c: CouponRow) {
    this.couponForm.set({
      id: c.id, code: c.code, name: c.name, note: c.note ?? '', kind: c.kind, value: String(c.value), productIds: c.products.map((p) => p.id),
      startsAt: this.local(c.startsAt), endsAt: this.local(c.endsAt), maxRedemptions: c.maxRedemptions ? String(c.maxRedemptions) : '', active: c.active,
    });
    this.toTop();
  }

  async saveCoupon() {
    const f = this.couponForm();
    const body = {
      code: f.code.trim(), name: f.name.trim(), note: f.note, kind: f.kind, value: Number(f.value), productIds: f.productIds,
      // the inputs are local time; the server stores UTC
      startsAt: f.startsAt ? new Date(f.startsAt).toISOString() : null,
      endsAt: f.endsAt ? new Date(f.endsAt).toISOString() : null,
      maxRedemptions: f.maxRedemptions.trim() === '' ? 0 : Number(f.maxRedemptions), active: f.active,
    };
    this.busy.set(true);
    this.error.set(null);
    try {
      if (f.id) await this.api.updateCoupon(f.id, body);
      else await this.api.createCoupon(body);
      this.couponForm.set(this.blankCoupon());
      await this.reload();
    } catch (err: any) {
      this.fail(err);
    } finally {
      this.busy.set(false);
    }
  }

  async toggleCoupon(c: CouponRow) {
    const msg = c.active ? `להשבית את הקופון ${c.code}? רכישות קודמות שהשתמשו בו לא ישתנו.` : `להפעיל מחדש את הקופון ${c.code}?`;
    if (!confirm(msg)) return;
    try { await this.api.setCouponActive(c.id, !c.active); await this.reload(); } catch (e: any) { this.fail(e); }
  }

  /** Reads only: charges nothing and creates nothing. */
  async sumitCheck() {
    try {
      const r = await this.api.sumitCheck();
      this.sumitStatus.set(!r.configured ? 'SUMIT לא מוגדר בשרת הזה (חסרים משתני סביבה).'
        : !r.connected ? `אין חיבור ל-SUMIT: ${r.problem ?? ''}`
        : !r.billing ? `החיבור תקין (${r.organization ?? ''}), אבל מודול הסליקה לא ענה: ${r.problem ?? ''}`
        : `החיבור תקין: ${r.organization ?? ''}. ${r.vatExempt ? 'מוגדר כעוסק פטור: תקין, קבלה בלבד.' : `לא מוגדר כעוסק פטור (סוג ${r.organizationType ?? 'לא ידוע'}): דף תשלום לא ייפתח.`} הספק ${r.providerActive ? 'פעיל' : 'כבוי'}. לא בוצע חיוב.`);
    } catch (e: any) { this.fail(e); }
  }

  /** The admin's one real purchase: charged only if the card is entered and approved on SUMIT's page. */
  async trialPurchase(id: string, name: string, price: number) {
    if (!confirm(`רכישת ניסיון אמיתית של "${name}": הכרטיס יחויב ב-${price} ₪ בדף של SUMIT, ותופק קבלה אמיתית. ההחזר נעשה ידנית ב-SUMIT. להמשיך?`)) return;
    try {
      const o = await this.api.trialOrder(id);
      orderStore.save({ orderId: o.orderId, key: o.accessKey, productId: id, productName: o.productName, createdAt: new Date().toISOString() });
      window.location.assign(o.checkoutUrl);
    } catch (e: any) { this.fail(e); }
  }

  issueLabel(issue?: string | null) {
    if (!issue) return '—';
    if (issue === 'document-missing') return 'לא הופק מסמך';
    if (issue === 'document-draft') return 'המסמך בטיוטה';
    if (issue === 'document-not-receipt') return 'המסמך שהופק אינו קבלה';
    if (issue.startsWith('payment-mismatch:')) return `תשלום לא תואם (${issue.slice(17)}): לבדוק ב-SUMIT`;
    if (issue.startsWith('coupon-limit:')) return `מכסת הקופון מלאה (${issue.slice(13)}): נדרש החזר`;
    if (issue.startsWith('second-payment:')) return `תשלום כפול (${issue.slice(15)}): נדרש החזר`;
    return issue;
  }

  private checkLabel(result: string) {
    return ({ inactive: 'ספק SUMIT כבוי, ולא נשלחה בדיקה.', none: 'לא נמצא תשלום ב-SUMIT.', 'applied:paid': 'התשלום אומת וההזמנה סומנה כשולמה.', already: 'ההזמנה כבר מעודכנת.',
      unavailable: 'SUMIT לא זמינה כרגע. נסו שוב.', incomplete: 'הבדיקה לא הושלמה. נסו שוב.' } as Record<string, string>)[result] ?? `תוצאה: ${result}`;
  }

  /** Asks SUMIT about this order on the server. */
  async checkPayment(o: AdminOrder) {
    try {
      const r = await this.api.checkOrderPayment(o.id);
      this.sumitStatus.set(`הזמנה ${o.number}: ${this.checkLabel(r.result)}`);
      this.orders.set(await this.api.orders(this.f()));
    } catch (e: any) { this.fail(e); }
  }

  /** Switches a game code off or on. Nothing else changes and no one is emailed: whoever enters sees that the code is not active. */
  async toggleGameDisabled(code: string, disable: boolean) {
    const msg = disable
      ? `להשבית את קוד המשחק ${code}? מי שינסה להיכנס יראה שהקוד אינו פעיל, ומי שנמצא בו עכשיו לא יוכל להמשיך. לא נשלח מייל, ואפשר להפעיל אותו שוב בכל רגע.`
      : `להפעיל מחדש את קוד המשחק ${code}?`;
    if (!confirm(msg)) return;
    try {
      if (disable) await this.api.disableGame(code); else await this.api.enableGame(code);
      this.game.set(await this.api.game(code));
      this.games.set(await this.api.games(this.f()));
    } catch (e: any) { this.fail(e); }
  }

  /** Records a refund already made at SUMIT. The order and its game stay in the history. */
  async markRefunded(o: AdminOrder) {
    if (!confirm(`לסמן את הזמנה ${o.number} כהוחזרה? הסימון לא מחזיר כסף: את ההחזר עצמו מבצעים ב-SUMIT. אחרי הסימון אי אפשר לפתוח משחק עם ההזמנה, והיא לא נספרת בהגרלה.`)) return;
    try {
      await this.api.markOrderRefunded(o.id);
      this.orders.set(await this.api.orders(this.f()));
    } catch (e: any) { this.fail(e); }
  }

  async showCouponOrders(c: CouponRow) {
    try { this.couponUses.set({ code: c.code, rows: await this.api.couponOrders(c.id) }); } catch (e: any) { this.fail(e); }
  }

  async logout() {
    try { await this.api.logout(); } catch {}
    await this.router.navigate(['/']);
  }
}
