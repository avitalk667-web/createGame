import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../core/api.service';

/**
 * /sandbox-pay/:session — stands in for the payment provider's hosted page while payments run in test mode.
 * The choice made here reaches the server as a signed notification, exactly like a real provider's.
 * The server only exposes this API when the sandbox is active, never in production.
 */
@Component({
  selector: 'px-sandbox-pay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main>
      <div class="banner" role="note">סביבת בדיקה — זה אינו דף תשלום אמיתי ולא מתבצע שום חיוב</div>
      <section class="card">
        @if (loading()) {
          <p class="muted">טוענים את פרטי התשלום...</p>
        } @else if (!info()) {
          <h1>דף התשלום לא נמצא</h1>
          <p class="error" role="alert">{{ error() }}</p>
        } @else {
          <h1>תשלום בדיקה</h1>
          <dl>
            <dt>הזמנה</dt><dd>{{ info()!.number }}</dd>
            <dt>משחק</dt><dd>{{ info()!.productName }}</dd>
            <dt>סכום</dt><dd>{{ info()!.amount }} {{ info()!.currency === 'ILS' ? '₪' : info()!.currency }}</dd>
          </dl>
          @if (info()!.status !== 'pending') {
            <p class="muted">ההזמנה הזאת כבר טופלה ({{ info()!.status }}).</p>
          }
          <p class="muted">בחרו מה „ספק התשלום” ידווח לשרת:</p>
          <div class="actions">
            <button class="btn primary" (click)="send('approve')" [disabled]="busy()">אישור תשלום (בדיקה)</button>
            <button class="btn danger" (click)="send('decline')" [disabled]="busy()">דחיית התשלום</button>
            <button class="btn ghost" (click)="send('cancel')" [disabled]="busy()">ביטול וחזרה לאתר</button>
          </div>
          @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
        }
      </section>
    </main>
  `,
  styles: [`
    :host { display:block; min-height:100dvh; background:#0b1022; }
    main { max-width:520px; margin:0 auto; padding:16px; }
    .banner { background:repeating-linear-gradient(45deg, #3a2a00, #3a2a00 12px, #4a3600 12px, #4a3600 24px); color:#ffe39a;
      border:1px solid #9a7a32; border-radius:10px; padding:.6rem .8rem; font-weight:700; text-align:center; margin-bottom:1rem; }
    h1 { margin-top:0; }
    dl { display:grid; grid-template-columns:auto 1fr; gap:.3rem .8rem; }
    dt { color:var(--muted); } dd { margin:0; font-weight:700; }
    .actions { display:flex; flex-direction:column; gap:.6rem; }
  `],
})
export class SandboxPayPage {
  private api = inject(ApiService);
  private router = inject(Router);
  session = input.required<string>();
  info = signal<{ number: number; productName: string; amount: number; currency: string; status: string; orderId: string } | null>(null);
  loading = signal(true);
  busy = signal(false);
  error = signal<string | null>(null);

  constructor() {
    effect(() => this.load(this.session()));
  }

  private async load(session: string) {
    try {
      this.info.set(await this.api.sandboxCheckout(session));
    } catch (e: any) {
      this.error.set(e.message);
    } finally {
      this.loading.set(false);
    }
  }

  async send(outcome: 'approve' | 'decline' | 'cancel') {
    this.busy.set(true);
    this.error.set(null);
    try {
      const r = await this.api.sandboxPay(this.session(), outcome);
      await this.router.navigateByUrl(r.returnUrl);
    } catch (e: any) {
      this.error.set(e.message);
      this.busy.set(false);
    }
  }
}
