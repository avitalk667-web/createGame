import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { SiteService } from '../core/site.service';

/**
 * Unsubscribe from marketing email without an account. The signed token sits in the link's #fragment (it never reaches
 * server logs); nothing changes until the person confirms, so mail scanners that open links cannot unsubscribe anyone.
 */
@Component({
  selector: 'px-unsubscribe',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="card">
      <a routerLink="/">‹ חזרה לדף הבית</a>
      <h1>הסרה מרשימת הדיוור</h1>
      @if (done()) {
        <p class="ok" role="status">{{ done() }}</p>
        <p class="muted">מיילים של תוצאות משחק שתבקשו בעתיד יישלחו רק אם תבקשו אותם במפורש.</p>
      } @else if (!token) {
        <p class="error">הקישור חסר או שאינו שלם. פתחו אותו שוב מתוך המייל, או כתבו לנו ל־<a [href]="'mailto:' + site.info().contactEmail" dir="ltr">{{ site.info().contactEmail }}</a>.</p>
      } @else {
        <p>לחיצה על הכפתור תסיר את הכתובת שלכם מרשימת הדיוור השיווקי של PORTAL X. לא יישלחו אליכם עוד עדכונים, הטבות או קופונים.</p>
        <button class="btn primary" (click)="confirm()" [disabled]="busy()">{{ busy() ? 'מסירים...' : 'אישור ההסרה מרשימת הדיוור' }}</button>
        @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
      }
    </main>
  `,
  styles: [`main { max-width: 640px; margin: 2rem auto; line-height: 1.8; } h1 { margin-top: 1rem; } .ok { color:#bff0cf; font-weight:700; }`],
})
export class UnsubscribePage {
  private api = inject(ApiService);
  site = inject(SiteService);
  readonly token = new URLSearchParams(location.hash.replace(/^#/, '')).get('t');
  busy = signal(false);
  done = signal<string | null>(null);
  error = signal<string | null>(null);

  constructor() {
    this.site.load();
  }

  async confirm() {
    this.busy.set(true);
    this.error.set(null);
    try {
      const r = await this.api.unsubscribe(this.token!);
      this.done.set(r.message);
      // the link is no longer needed in the address bar or the history
      history.replaceState(null, '', location.pathname);
    } catch (e: any) {
      this.error.set(e.message);
    } finally {
      this.busy.set(false);
    }
  }
}
