import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AdminApiService, DrawList } from '../core/admin-api.service';

/**
 * The "draw" tab (admin only): how many tickets each person has. One ticket for every purchase through their personal
 * link that was really paid and is still paid — not a test, not their own purchase, not a free game. Each ticket shows
 * the order it came from. Nothing here is shown on the public site.
 */
@Component({
  selector: 'px-admin-draw',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error()) { <p class="msg-box">{{ error() }}</p> }
    @if (draw(); as d) {
      <div class="cards">
        <div class="stat card"><span>כרטיסי הגרלה</span><b>{{ d.totalTickets }}</b><small>כרטיס אחד לכל רכישה ששולמה דרך קישור אישי</small></div>
        <div class="stat card"><span>משתתפים בהגרלה</span><b>{{ d.participants }}</b><small>בעלי קישור עם כרטיס אחד לפחות</small></div>
        <div class="stat card"><span>{{ d.campaign.title || 'ההגרלה' }}</span><b class="date">{{ d.campaign.prize }}</b><small>{{ d.campaign.drawDate }}</small></div>
      </div>
      <div class="bar"><span class="muted small">הכרטיסים מחושבים מההזמנות עצמן בכל טעינה, ולכן רכישה שהוחזרה מאבדת את הכרטיס שלה.</span>
        <button class="btn small" type="button" (click)="load()">רענון</button></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>שם</th><th>מייל</th><th>כרטיסים</th><th>סטטוס הקישור</th><th>הרכישות שמהן נוצרו הכרטיסים</th></tr></thead>
          <tbody>
            @for (e of d.entries; track e.linkId) {
              <tr>
                <td>{{ e.firstName }} {{ e.lastName }}</td><td dir="ltr">{{ e.email }}</td><td><b>{{ e.tickets }}</b></td>
                <td>{{ e.status === 'active' ? 'פעיל' : 'מושבת' }}</td>
                <td class="wrap">
                  @for (t of e.ticketList; track t.orderNumber) {
                    <span class="ticket">#{{ t.orderNumber }} · {{ t.productName }} · {{ t.paidAt | date: 'd.M.yy' }}</span>
                  }
                </td>
              </tr>
            } @empty { <tr><td colspan="5" class="muted">עדיין אין כרטיסי הגרלה. כרטיס נוצר רק אחרי רכישה ששולמה בפועל דרך קישור אישי.</td></tr> }
          </tbody>
        </table>
      </div>
      <p class="muted small">לא מזכים בכרטיס: רכישת בדיקה, תשלום שנכשל או בוטל, רכישה שהוחזרה, רכישה של בעל הקישור עצמו, ופתיחת משחק חינמי.
        התראת תשלום שמגיעה פעמיים אינה יוצרת כרטיס נוסף, כי כל כרטיס קשור להזמנה אחת.</p>
    } @else if (!error()) {
      <p class="muted">טוענים...</p>
    }
  `,
  styles: [`
    .cards { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:.8rem; margin-bottom:1rem; }
    .stat { display:flex; flex-direction:column; gap:.2rem; padding:1rem; }
    .stat span { color:var(--muted); font-size:.9rem; } .stat b { font-size:1.7rem; color:var(--gold-2); } .stat b.date { font-size:1.3rem; } .stat small { color:var(--muted); }
    .bar { display:flex; justify-content:space-between; align-items:center; gap:1rem; margin-bottom:.5rem; flex-wrap:wrap; }
    .table-wrap { overflow-x:auto; border:1px solid var(--line); border-radius:var(--radius); }
    table { width:100%; border-collapse:collapse; font-size:.9rem; }
    th, td { padding:.5rem .6rem; text-align:start; border-bottom:1px solid rgba(201,162,77,.15); white-space:nowrap; }
    th { background:var(--panel-solid); color:var(--gold-2); }
    td.wrap { white-space:normal; min-width:220px; }
    .ticket { display:inline-block; margin:.1rem .25rem; padding:.05rem .5rem; border:1px solid var(--line); border-radius:999px; font-size:.8rem; }
    .msg-box { padding:.6rem .9rem; border-radius:10px; background:rgba(255,120,100,.12); color:#ffd2c8; }
    .small { font-size:.8rem; }
    @media (max-width: 760px) { .cards { grid-template-columns:1fr; } }
  `],
})
export class AdminDrawComponent {
  private api = inject(AdminApiService);
  draw = signal<DrawList | null>(null);
  error = signal<string | null>(null);

  constructor() {
    this.load();
  }

  async load() {
    this.error.set(null);
    try {
      this.draw.set(await this.api.draw());
    } catch (e: any) {
      this.error.set(e.message);
    }
  }
}
