import { DatePipe, DecimalPipe, JsonPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { sessionStore } from '../core/api.service';
import {
  AdminApiService, AdminFilters, AdminGame, AdminOrder, AdminProduct, AuditEntry, CouponRow, CouponUse, Dashboard, FaqRow, EmailSetup, MailingFilters, MailingList,
  MoneyTotals, ReferralDetails, ReferralFilters, ReferralList } from '../core/admin-api.service';

type Tab = 'dashboard' | 'orders' | 'games' | 'products' | 'faq' | 'coupons' | 'mailing' | 'referrals' | 'email-setup' | 'audit';

/** The coupon form as typed (spec 4.3). Dates are local date-time strings from the inputs. */
interface CouponForm {
  id?: string; code: string; name: string; note: string; kind: 'percent' | 'fixed'; value: string; productIds: string[];
  startsAt: string; endsAt: string; maxRedemptions: string; active: boolean;
}
const EMPTY_COUPON: CouponForm = { code: '', name: '', note: '', kind: 'percent', value: '', productIds: [], startsAt: '', endsAt: '', maxRedemptions: '', active: true };

/** Unsaved edits of one product, as typed in the form. */
interface ProductEdit { name?: string; tagline?: string; description?: string; coverImage?: string; priceIls?: string; maxPlayers?: string; status?: string }

const STATUS: Record<string, string> = {
  pending: 'ממתין', paid: 'שולם', failed: 'נכשל', cancelled: 'בוטל', refunded: 'הוחזר',
  'not-opened': 'טרם נפתח', 'not-started': 'טרם התחיל', 'in-progress': 'בתהליך', completed: 'הושלם',
  purchase: 'רכישה', 'admin-free': 'חינמי (מנהל)', 'free-sample': 'משחק התנסות חינמי', legacy: 'ישן (לפני רכישות)',
  active: 'פעיל', scheduled: 'ממתין לתחילת תוקף', expired: 'פג תוקף', disabled: 'מושבת',
  reserved: 'שמור לתשלום', redeemed: 'מומש', released: 'שוחרר', percent: 'אחוזים', fixed: 'סכום קבוע',
  published: 'מפורסם', hidden: 'מוסתר', draft: 'טיוטה',
  lobby: 'חדר המתנה', intro: 'פתיחה', playing: 'במשחק',
};

const ACTIONS: Record<string, string> = {
  login: 'כניסה', 'login-failed': 'כניסה שנכשלה', 'free-game-opened': 'פתיחת משחק חינמי',
  'product-updated': 'עדכון מוצר', 'product-price-changed': 'שינוי מחיר', 'sales-exported': 'ייצוא מכירות',
  'faq-added': 'הוספת שאלה', 'faq-updated': 'עדכון שאלה', 'faq-deleted': 'מחיקת שאלה',
  'coupon-created': 'יצירת קופון', 'coupon-updated': 'עדכון קופון', 'coupon-enabled': 'הפעלת קופון', 'coupon-disabled': 'השבתת קופון',
  'referral-enabled': 'הפעלת קישור אישי', 'referral-disabled': 'השבתת קישור אישי', 'referrals-exported': 'ייצוא קישורים שיווקיים',
  'mailing-exported': 'ייצוא רשימת מיילים',
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

        @if (tab() === 'dashboard' || tab() === 'orders' || tab() === 'games') {
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
                  <option value="">הכול</option><option value="purchase">רכישה</option><option value="admin-free">חינמי (מנהל)</option><option value="free-sample">משחק התנסות חינמי</option><option value="test-checkout">מצב הדגמה (ללא חיוב)</option><option value="legacy">ישן</option>
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
                <div class="stat card demo"><span>פתיחות במצב הדגמה</span><b>{{ d.games.demo }}</b><small>{{ d.games.demoStarted }} התחילו · {{ d.games.demoCompleted }} הושלמו · ללא חיוב, לא נספר בהכנסות ובמכירות · מצב הדגמה {{ d.demoCheckoutEnabled ? 'פעיל באתר' : 'כבוי' }}</small></div>
                <div class="stat card"><span>משחקים חינמיים של המנהל</span><b>{{ d.games.adminFree }}</b><small>{{ d.games.adminFreeStarted }} התחילו</small></div>
                <div class="stat card"><span>משתתפים</span><b>{{ d.participants }}</b><small>ללא ספירה כפולה בתוך אותו משחק</small></div>
                <div class="stat card"><span>רוכשים (דוא״ל ייחודי)</span><b>{{ d.buyersWithEmail }}</b><small>אין חשבונות לקוח — נספרים רק מי שהשאירו דוא״ל</small></div>
              </div>
              <p class="muted small">
                הזמנות שלא הושלמו: {{ d.orders.pending }} ממתינות · {{ d.orders.failed }} נכשלו · {{ d.orders.cancelled }} בוטלו.
                @if (d.testPaidOrders) { רכישות בדיקה ({{ d.testPaidOrders }}) אינן נכללות בהכנסות. }
              </p>
              @if (d.freeGame; as g) {
                <section class="free-report card" aria-labelledby="free-report-title">
                  <div class="bar">
                    <h2 id="free-report-title">„{{ g.name }}” — משחק חינמי</h2>
                    <button class="btn small" type="button" (click)="freeGameHistory(g.productId)">להיסטוריית המשחקים ‹</button>
                  </div>
                  <div class="cards">
                    <div class="stat card"><span>משחקים שנוצרו</span><b>{{ g.created }}</b><small>{{ g.notStarted }} נוצרו ולא התחילו</small></div>
                    <div class="stat card"><span>משחקים שהתחילו בפועל</span><b>{{ g.started }}</b><small>היום: {{ g.today.started }}</small></div>
                    <div class="stat card"><span>משחקים שהושלמו</span><b>{{ g.completed }}</b><small>היום: {{ g.today.completed }}</small></div>
                    <div class="stat card"><span>משתתפים שהצטרפו</span><b>{{ g.participants }}</b><small>היום: {{ g.today.joined }} · חיבור מחדש לא נספר שוב</small></div>
                    <div class="stat card"><span>משתתפים במשחקים שהתחילו</span><b>{{ g.participantsInStarted }}</b><small>סך ההשתתפויות בכל ההרצות שהתחילו</small></div>
                    <div class="stat card"><span>הפעלה אחרונה</span><b class="date">{{ g.lastStartedAt ? (g.lastStartedAt | date: 'd.M.yy HH:mm') : '—' }}</b><small>חינמי · לא נספר בהכנסות</small></div>
                  </div>
                  <p class="muted small">משחק נספר פעם אחת לפי קוד המשחק, גם אם רעננו את הדף או נכנסו שוב. משתתף נספר פעם אחת בכל משחק, כי חיבור מחדש מחזיר אותו למקום שלו. אין חשבונות משתמש, ולכן אותו אדם בשני משחקים שונים נספר פעמיים. סינון התאריכים חל על מועד יצירת המשחק; נתוני „היום” לפי שעון ישראל.</p>
                </section>
              }
              <h2>לפי משחק</h2>
              <div class="table-wrap">
                <table>
                  <thead><tr><th>משחק</th><th>ברוטו</th><th>החזרים</th><th>לאחר החזרים</th><th>עסקאות</th><th>משחקים שנפתחו</th></tr></thead>
                  <tbody>
                    @for (p of d.byProduct; track p.productId) {
                      @if (p.isFree) {
                        <tr><td>{{ p.name }} <span class="st" data-s="free">חינמי</span></td><td colspan="4" class="muted">משחק חינמי — אין מכירות ואין הכנסות</td><td>{{ p.games }}</td></tr>
                      } @else {
                      <tr><td>{{ p.name }}</td><td>{{ p.money.gross | number: '1.0-2' }} ₪</td><td>{{ p.money.refunds | number: '1.0-2' }} ₪</td>
                        <td>{{ p.money.afterRefunds | number: '1.0-2' }} ₪</td><td>{{ p.money.paidCount }}</td><td>{{ p.games }}</td></tr>
                      }
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
                <thead><tr><th>מס׳</th><th>תאריך</th><th>דוא״ל</th><th>משחק</th><th>מחיר מקורי</th><th>הנחה</th><th>קופון</th><th>לתשלום</th><th>תשלום</th><th>מזהה עסקה</th><th>קוד משחק</th><th>משתתפים</th><th>משחק</th></tr></thead>
                <tbody>
                  @for (o of orders(); track o.id) {
                    <tr [class.test]="o.isTest">
                      <td>{{ o.number }}{{ o.isTest ? ' (בדיקה)' : '' }}</td><td>{{ o.createdAt | date: 'd.M.yy HH:mm' }}</td><td dir="ltr">{{ o.email ?? '—' }}</td>
                      <td>{{ o.productName }}</td><td>{{ o.originalPrice | number: '1.0-2' }} ₪</td>
                      <td>{{ o.discount ? '−' + (o.discount | number: '1.0-2') + ' ₪' : '—' }}</td><td dir="ltr">{{ o.couponCode ?? '—' }}</td>
                      <td><b>{{ o.amount | number: '1.0-2' }} {{ o.currency === 'ILS' ? '₪' : o.currency }}</b></td>
                      <td><span class="st" [attr.data-s]="o.status">{{ label(o.status) }}</span></td><td dir="ltr" class="small">{{ o.transactionId ?? '—' }}</td>
                      <td dir="ltr">{{ o.gameCode ?? '—' }}</td><td>{{ o.players }}</td><td>{{ o.gameStatus ? label(o.gameStatus) : '—' }}</td>
                    </tr>
                  } @empty { <tr><td colspan="13" class="muted">אין הזמנות בסינון הזה.</td></tr> }
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
                  <div class="bar"><h2>{{ p.name }}</h2><span class="st" [attr.data-s]="p.status">{{ label(p.status) }}</span>@if (p.isFree) { <span class="st">משחק התנסות חינמי</span> }</div>
                  @for (w of p.warnings; track w) { <p class="warn">{{ w }}</p> }
                  <label>שם <input [value]="edit(p.id).name ?? p.name" (input)="patch(p.id, 'name', $any($event.target).value)" /></label>
                  <label>תקציר <input [value]="edit(p.id).tagline ?? p.tagline" (input)="patch(p.id, 'tagline', $any($event.target).value)" /></label>
                  <label>תיאור <textarea rows="4" [value]="edit(p.id).description ?? p.description" (input)="patch(p.id, 'description', $any($event.target).value)"></textarea></label>
                  <label>תמונת כיסוי <input dir="ltr" [value]="edit(p.id).coverImage ?? p.coverImage" (input)="patch(p.id, 'coverImage', $any($event.target).value)" /></label>
                  <div class="row3">
                    <label>מחיר (₪) <input type="number" min="1" step="0.01" dir="ltr" [value]="edit(p.id).priceIls ?? p.price ?? ''" (input)="patch(p.id, 'priceIls', $any($event.target).value)" /></label>
                    <label>משתתפים מרבי (עד {{ p.maxPlayersLimit }}) <input type="number" min="1" [max]="p.maxPlayersLimit" dir="ltr" [value]="edit(p.id).maxPlayers ?? p.maxPlayers" (input)="patch(p.id, 'maxPlayers', $any($event.target).value)" /></label>
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
          @case ('faq') {
            <section class="card faq-form">
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
            <h2>שאלות שהוספתם</h2>
            <div class="table-wrap">
              <table>
                <thead><tr><th>סדר</th><th>שאלה</th><th>תשובה</th><th>מצב</th><th>פעולות</th></tr></thead>
                <tbody>
                  @for (q of faqRows(); track q.id; let i = $index) {
                    <tr>
                      <td>{{ i + 1 }}</td><td class="wrap">{{ q.question }}</td><td class="wrap small">{{ q.answer }}</td>
                      <td>{{ q.published ? 'מוצגת' : 'מוסתרת' }}</td>
                      <td class="row">
                        <button class="btn small" (click)="moveFaq(i, -1)" [disabled]="i === 0" aria-label="העברה למעלה">↑</button>
                        <button class="btn small" (click)="moveFaq(i, 1)" [disabled]="i === faqRows().length - 1" aria-label="העברה למטה">↓</button>
                        <button class="btn small" (click)="faqEdit.set({ id: q.id, question: q.question, answer: q.answer, published: q.published })">עריכה</button>
                        <button class="btn small" (click)="toggleFaq(q)">{{ q.published ? 'הסתרה' : 'הצגה' }}</button>
                        <button class="btn small ghost" (click)="deleteFaq(q)">מחיקה</button>
                      </td>
                    </tr>
                  } @empty { <tr><td colspan="5" class="muted">עדיין לא הוספתם שאלות. השאלות הקבועות מוצגות תמיד.</td></tr> }
                </tbody>
              </table>
            </div>
            <h2>שאלות קבועות (מגיעות עם האתר)</h2>
            <ol class="fixed-faq">@for (q of faqBuiltIn(); track q.question) { <li><b>{{ q.question }}</b> {{ q.answer }}</li> }</ol>
          }
          @case ('email-setup') {
            @if (gmailResult(); as g) {
              <p class="msg-box" [class.ok]="GMAIL_RESULT[g]?.ok" role="status">{{ GMAIL_RESULT[g]?.text ?? ('תוצאת החיבור: ' + g) }}</p>
            }
            @if (emailSetup(); as es) {
              <section class="card setup">
                <h2>הגדרת שליחת מיילים — Gmail API</h2>
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
                <h3>מדיניות הטופס בסיום המשחק</h3>
                <ul class="status-list">
                  <li>שליחת תוצאות במייל: <b>{{ es.resultsPolicy.requireMarketingConsent ? 'רק עם הסכמה שיווקית מפורשת באותו טופס' : 'גם בלי הסכמה שיווקית' }}</b>
                    (הגדרה <code dir="ltr">PORTALX_RESULTS_REQUIRE_MARKETING_CONSENT</code>)</li>
                  <li>נוסח ההסכמה (גרסה <span dir="ltr">{{ es.resultsPolicy.consentVersion }}</span>): „{{ es.resultsPolicy.consentText }}”</li>
                  @if (es.resultsPolicy.requireMarketingConsent) { <li>הודעה למי שלא סימן הסכמה: „{{ es.resultsPolicy.refusedMessage }}”</li> }
                  <li>ההסכמה ובקשת התוצאות נשמרות בנפרד. אין לסמן מראש. ביטול הסכמה עוצר דיוור, ואינו מתחדש בלי סימון חדש.</li>
                </ul>
                <p class="muted small">התניית מייל שירות בהסכמה שיווקית עשויה לעורר קושי משפטי — יש לבדוק עם עורך דין לפני הפעלה מסחרית.</p>
                <p class="muted small">בחיבור תועברו לעמוד של Google. יש להתחבר בחשבון {{ es.sender }} ולאשר שליחת מיילים. הטוקנים נשמרים בשרת מוצפנים ואינם מוצגים כאן.</p>
              </section>
            }
          }
          @case ('mailing') {
            <form class="filters card" (submit)="$event.preventDefault(); reload()">
              <label>חיפוש כתובת <input dir="ltr" [value]="mf().search ?? ''" (input)="setM('search', $any($event.target).value)" placeholder="name@" /></label>
              <label>הסכמה שיווקית
                <select [value]="mf().consent ?? ''" (change)="setM('consent', $any($event.target).value)">
                  <option value="">הכול</option><option value="active">פעילה</option><option value="revoked">בוטלה</option><option value="none">אין הסכמה</option>
                </select>
              </label>
              <label>מקור הרשמה
                <select [value]="mf().source ?? ''" (change)="setM('source', $any($event.target).value)">
                  <option value="">הכול</option><option value="results">בקשת תוצאות משחק</option><option value="referral">יצירת קישור אישי</option><option value="group">קישור לקבוצה</option>
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
            </form>
            @if (mailing(); as m) {
              <div class="cards">
                <div class="stat card"><span>כתובות שביקשו תוצאות</span><b>{{ m.totals.resultsAddresses }}</b><small>{{ m.totals.resultsSent }} מיילי תוצאות נשלחו · אינם מנויים שיווקיים</small></div>
                <div class="stat card"><span>מנויים שיווקיים פעילים</span><b>{{ m.totals.activeSubscribers }}</b><small>{{ m.totals.revokedSubscribers }} ביטלו הסכמה · רק הפעילים ברשימת הדיוור</small></div>
                <div class="stat card"><span>בקשות קישור לקבוצה</span><b>{{ m.totals.groupLinkRequests }}</b><small>בקשת קישור בלבד — לא אישור הצטרפות</small></div>
                <div class="stat card"><span>יוצרי קישור אישי</span><b>{{ m.totals.referralCreators }}</b><small>כל אחד אישר דיוור בטופס; ביטול נשמר</small></div>
              </div>
              <div class="bar"><span class="muted">{{ m.rows.length }} כתובות</span><a class="btn small" [href]="mailingCsvUrl()" download>ייצוא CSV</a></div>
              <div class="table-wrap">
                <table>
                  <thead><tr><th>כתובת מייל</th><th>שם</th><th>מקור הרשמה</th><th>קישור אישי</th><th>בקשת תוצאות</th><th>שליחה אחרונה</th><th>משחק אחרון</th><th>שליחת תוצאות</th><th>הסכמה שיווקית</th><th>תאריך הסכמה</th><th>תאריך ביטול</th><th>קישור לקבוצה</th><th>מקור</th></tr></thead>
                  <tbody>
                    @for (r of m.rows; track r.email) {
                      <tr>
                        <td dir="ltr">{{ r.email }}</td>
                        <td>{{ r.firstName ? r.firstName + ' ' + r.lastName : '—' }}</td>
                        <td>{{ sourcesLabel(r.sources) }}</td>
                        <td>@if (r.referralUrl) { <a dir="ltr" [href]="r.referralUrl" target="_blank" rel="noopener">{{ shortUrl(r.referralUrl) }}</a> } @else { — }</td>
                        <td>{{ r.lastResultsRequestAt ? (r.lastResultsRequestAt | date: 'd.M.yy HH:mm') : '—' }}</td>
                        <td>{{ r.lastSentAt ? (r.lastSentAt | date: 'd.M.yy HH:mm') : '—' }}</td>
                        <td>{{ r.lastGameName ?? '—' }}</td>
                        <td>@if (r.resultsStatus) { <span class="st" [attr.data-s]="r.resultsStatus === 'sent' ? 'paid' : r.resultsStatus === 'failed' ? 'failed' : ''">{{ mailLabel(r.resultsStatus) }}</span> } @else { — }</td>
                        <td><span class="st" [attr.data-s]="r.consent === 'active' ? 'paid' : r.consent === 'revoked' ? 'failed' : ''">{{ consentLabel(r.consent) }}</span></td>
                        <td>{{ r.consentedAt ? (r.consentedAt | date: 'd.M.yy HH:mm') : '—' }}</td>
                        <td>{{ r.revokedAt ? (r.revokedAt | date: 'd.M.yy HH:mm') : '—' }}</td>
                        <td>{{ r.groupLinkRequested ? 'ביקש קישור' : '—' }}</td>
                        <td>{{ gameName(r.source) }}</td>
                      </tr>
                    } @empty { <tr><td colspan="13" class="muted">אין כתובות בסינון הזה.</td></tr> }
                  </tbody>
                </table>
              </div>
              <p class="muted small">רשימת הדיוור השיווקי היא רק הכתובות שהסכמתן „פעילה”. כתובת שביקשה תוצאות בלבד אינה מנויה. הייצוא כולל קישור הסרה אישי לכל מנוי פעיל.</p>
            }
          }
          @case ('referrals') {
            <form class="filters card" (submit)="$event.preventDefault(); reload()">
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
                <div class="stat card"><span>קישורים אישיים</span><b>{{ rl.summary.links }}</b><small>{{ rl.summary.activeLinks }} פעילים</small></div>
                <div class="stat card"><span>סך רכישות ששולמו</span><b>{{ rl.summary.purchases }}</b><small>{{ rl.summary.refunded }} מהן הוחזרו · ללא רכישות בדיקה ורכישה עצמית</small></div>
                <div class="stat card"><span>סך מכירות ברוטו</span><b>{{ money(rl.summary.money, 'gross') }}</b><small>סך החזרים: {{ money(rl.summary.money, 'refunds') }}</small></div>
                <div class="stat card"><span>הכנסה נטו מיוחסת</span><b>{{ money(rl.summary.money, 'net') }}</b><small>ברוטו פחות החזרים בפועל</small></div>
              </div>
              <div class="bar"><span class="muted">{{ rl.rows.length }} קישורים · תאריכי „קישור נוצר” מסננים קישורים; תאריכי „רכישות שולמו” מסננים את הרכישות שנספרות</span>
                <a class="btn small" [href]="referralsCsvUrl()" download>ייצוא CSV</a></div>
              <div class="table-wrap">
                <table>
                  <thead><tr><th>שם פרטי</th><th>שם משפחה</th><th>מייל</th><th>קישור אישי</th><th>תאריך יצירה</th><th>מספר רכישות</th><th>מכירות ברוטו</th><th>החזרים</th><th>הכנסה נטו</th><th>משחקים שנרכשו</th><th>סטטוס</th><th></th></tr></thead>
                  <tbody>
                    @for (r of rl.rows; track r.id) {
                      <tr class="click" (click)="showReferral(r.id)">
                        <td>{{ r.firstName }}</td><td>{{ r.lastName }}</td><td dir="ltr">{{ r.email }}</td>
                        <td><span dir="ltr">{{ shortUrl(r.url) }}</span> <button type="button" class="btn small ghost" (click)="$event.stopPropagation(); copyUrl(r.url)">{{ copied() === r.url ? 'הועתק ✓' : 'העתקה' }}</button></td>
                        <td>{{ r.createdAt | date: 'd.M.yy HH:mm' }}</td>
                        <td>{{ r.purchases }}</td>
                        <td>{{ money(r.money, 'gross') }}</td><td>{{ money(r.money, 'refunds') }}</td><td><b>{{ money(r.money, 'net') }}</b></td>
                        <td class="wrap">@for (g of r.games; track g.productId) { <span>{{ g.name }} ({{ g.purchases }})</span>@if (!$last) {<span> · </span>} } @empty { — }</td>
                        <td><span class="st" [attr.data-s]="r.status === 'active' ? 'paid' : 'failed'">{{ r.status === 'active' ? 'פעיל' : 'מושבת' }}</span></td>
                        <td><button type="button" class="btn small" (click)="$event.stopPropagation(); showReferral(r.id)">פרטים</button></td>
                      </tr>
                    } @empty { <tr><td colspan="12" class="muted">אין קישורים בסינון הזה.</td></tr> }
                  </tbody>
                </table>
              </div>
              @if (refDetail(); as d) {
                <section class="card details" aria-label="פרטי קישור">
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
              <p class="muted small">רכישה נספרת לקישור רק אם התחילה באותו ביקור שבו נפתח הקישור, אושרה בתשלום אמיתי, אינה רכישת בדיקה ואינה רכישה של בעל הקישור עצמו. אין תגמול כספי ואין הנחה לרוכשים.</p>
            }
          }
          @case ('coupons') {
            <section class="card coupon-form">
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
            <h2>הקופונים</h2>
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
                      <td class="row">
                        <button class="btn small" (click)="editCoupon(c)">עריכה</button>
                        <button class="btn small" (click)="toggleCoupon(c)">{{ c.active ? 'השבתה' : 'הפעלה' }}</button>
                        <button class="btn small ghost" (click)="showCouponOrders(c)">רכישות</button>
                      </td>
                    </tr>
                  } @empty { <tr><td colspan="11" class="muted">עדיין אין קופונים.</td></tr> }
                </tbody>
              </table>
            </div>
            @if (couponUses(); as u) {
              <section class="card details" aria-label="רכישות עם הקופון">
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
    .setup { padding:1.1rem; } .setup h2 { margin:0 0 .4rem; font-size:1.2rem; }
    .status-list { margin:.6rem 0; padding-inline-start:1.2rem; line-height:1.9; } .status-list code { background:rgba(255,255,255,.06); padding:.1rem .4rem; border-radius:6px; word-break:break-all; }
    .good { color:#9be3b4; } .bad { color:#ffb4a6; }
    .actions-row { display:flex; gap:.6rem; flex-wrap:wrap; margin:.6rem 0; }
    .msg-box { padding:.6rem .9rem; border-radius:10px; background:rgba(255,120,100,.12); color:#ffd2c8; } .msg-box.ok { background:rgba(120,220,160,.12); color:#bff0cf; }
    .free-report { padding:1rem; margin:1.2rem 0; border-color:var(--gold); }
    .free-report h2 { margin:0; font-size:1.2rem; } .free-report .cards { grid-template-columns:repeat(3, minmax(0,1fr)); margin:.8rem 0 .4rem; }
    .stat b.date { font-size:1.15rem; }
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
    .faq-form, .coupon-form { display:flex; flex-direction:column; gap:.5rem; margin-bottom:1rem; }
    .faq-form label, .coupon-form label { display:flex; flex-direction:column; gap:.2rem; font-size:.85rem; color:var(--muted); }
    .faq-form label.check, .coupon-form label.check { flex-direction:row; align-items:center; gap:.4rem; color:var(--text); }
    .faq-form textarea { background:rgba(255,255,255,.06); color:var(--text); border:1px solid var(--line); border-radius:10px; padding:.5rem; font:inherit; }
    .grid3 { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:.5rem .8rem; align-items:end; }
    fieldset { border:1px solid var(--line); border-radius:10px; padding:.5rem .8rem; display:flex; flex-wrap:wrap; gap:.4rem 1.2rem; }
    legend { color:var(--gold-2); font-size:.85rem; padding:0 .3rem; }
    td.wrap { white-space:normal; min-width:180px; max-width:420px; }
    .fixed-faq { line-height:1.7; color:var(--muted); } .fixed-faq b { color:var(--text); margin-inline-end:.4em; }
    @media (max-width: 900px) { .grid3 { grid-template-columns:repeat(2, minmax(0,1fr)); } }
    @media (max-width: 560px) { .grid3 { grid-template-columns:1fr; } }
    .ok { color:#9be3b4; } .small { font-size:.8rem; }
    select { background:var(--panel-solid); color:var(--text); border:1px solid var(--line); border-radius:10px; padding:.45rem .6rem; min-height:40px; }
    @media (max-width: 900px) { .cards, .free-report .cards { grid-template-columns:repeat(2, minmax(0,1fr)); } .products { grid-template-columns:1fr; } }
    @media (max-width: 560px) { .cards, .free-report .cards { grid-template-columns:1fr; } .row3 { grid-template-columns:1fr; } }
  `],
})
export class AdminPage {
  private api = inject(AdminApiService);
  private router = inject(Router);
  tabs: { id: Tab; label: string }[] = [
    { id: 'dashboard', label: 'לוח בקרה' }, { id: 'orders', label: 'רכישות' }, { id: 'games', label: 'משחקים' },
    { id: 'products', label: 'מוצרים ומחירים' }, { id: 'faq', label: 'שאלות ותשובות' }, { id: 'coupons', label: 'קופונים והנחות' }, { id: 'mailing', label: 'מיילים ותוצאות' }, { id: 'referrals', label: 'קישורים שיווקיים' }, { id: 'email-setup', label: 'הגדרת שליחת מיילים' },
    { id: 'audit', label: 'יומן פעולות' },
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
  sourcesLabel = (s: string[]) => s.map((x) => ({ results: 'בקשת תוצאות', referral: 'יצירת קישור אישי', group: 'קישור לקבוצה' } as Record<string, string>)[x] ?? x).join(' · ') || '—';
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
  faqBuiltIn = signal<{ question: string; answer: string }[]>([]);
  emptyFaq = () => ({ id: '' as string, question: '', answer: '', published: true });
  faqEdit = signal(this.emptyFaq());
  // coupons (spec 4.2–4.9)
  coupons = signal<CouponRow[]>([]);
  blankCoupon = (): CouponForm => ({ ...EMPTY_COUPON, productIds: [] });
  couponForm = signal<CouponForm>(this.blankCoupon());
  couponUses = signal<{ code: string; rows: CouponUse[] } | null>(null);
  paidProducts = computed(() => this.products().filter((p) => !p.isFree));

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
      // back from Google's consent page: open the email setup and show the result (a short code, never a token)
      const q = new URLSearchParams(location.search);
      if (q.get('tab') === 'email-setup') {
        this.tab.set('email-setup');
        this.gmailResult.set(q.get('gmail'));
        history.replaceState(null, '', location.pathname);
      }
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

  /** The games table filtered to the free trial: every run with its dates, players and status. */
  freeGameHistory(productId: string) {
    this.tab.set('games');
    this.f.update((f) => ({ ...f, productId, status: undefined, access: 'free-sample', search: undefined }));
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
        case 'faq': {
          const f = await this.api.faq();
          this.faqRows.set(f.custom);
          this.faqBuiltIn.set(f.builtIn);
          break;
        }
        case 'coupons': this.coupons.set(await this.api.coupons()); break;
        case 'email-setup': this.emailSetup.set(await this.api.emailSetup()); break;
        case 'referrals':
          if (!this.products().length) this.products.set(await this.api.products());
          this.referrals.set(await this.api.referrals(this.rf()));
          break;
        case 'mailing':
          if (!this.products().length) this.products.set(await this.api.products());
          this.mailing.set(await this.api.mailing(this.mf()));

          break;
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
    if (!confirm(`למחוק את השאלה „${q.question}”? השאלות הקבועות לא יושפעו.`)) return;
    try { await this.api.deleteFaq(q.id); await this.reload(); } catch (e: any) { this.fail(e); }
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
    window.scrollTo({ top: 0, behavior: 'smooth' });
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

  async showCouponOrders(c: CouponRow) {
    try { this.couponUses.set({ code: c.code, rows: await this.api.couponOrders(c.id) }); } catch (e: any) { this.fail(e); }
  }

  async logout() {
    try { await this.api.logout(); } catch {}
    await this.router.navigate(['/']);
  }
}
