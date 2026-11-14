import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ApiError, sessionStore } from '../core/api.service';
import { GameService } from '../core/game.service';
import { ChallengeService, ChallengeStatus } from './challenge.service';
import { CouponEmailFormComponent } from './coupon-email-form.component';
import { CouponResultComponent } from './coupon-result.component';

/**
 * At the end of the free game: asks the server whether this player is eligible (the server reads the score it stored —
 * nothing is taken from the browser). Eligible → the coupon window with the email form; issued → the coupon, also after
 * a refresh or in another tab. Not eligible → no coupon window. Loads in the background, never holds up the results.
 */
@Component({
  selector: 'px-coupon-eligibility',
  imports: [CouponEmailFormComponent, CouponResultComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (status(); as s) {
      @switch (s.state) {
        @case ('eligible') {
          @if (open()) {
            <div class="veil" (click)="open.set(false)"></div>
            <section class="pop" role="dialog" aria-modal="true" aria-labelledby="ce-title">
              <button class="x" type="button" (click)="open.set(false)" aria-label="סגירה">✕</button>
              <span class="mark" aria-hidden="true">PORTAL X</span>
              <h2 id="ce-title">כל הכבוד! הצלחתם באתגר!</h2>
              <p class="big-score"><b>{{ s.score }}</b> נקודות</p>
              <p>הצלחתם לצבור יותר מ-{{ s.minimumScore - 1 }} נקודות!</p>
              <p>מגיע לכם קופון אישי של <strong>{{ s.discountPercent }}% הנחה</strong> על רכישת אחד ממשחקי PORTAL X.</p>
              <p>הזינו את כתובת המייל שלכם וקבלו את ההטבה.</p>
              <px-coupon-email-form [code]="code" [token]="token" [consentText]="consentText()" (issued)="onIssued($event)" />
            </section>
          } @else {
            <section class="card strip" aria-label="הטבת האתגר">
              <b>הצלחתם באתגר!</b> מחכה לכם קופון של {{ s.discountPercent }}% הנחה.
              <button class="btn primary small" type="button" (click)="open.set(true)">קבלת הקופון שלי</button>
            </section>
          }
        }
        @case ('issued') {
          <section class="card coupon" aria-labelledby="cr-title">
            <h2 id="cr-title">הקופון שלכם מוכן!</h2>
            <px-coupon-result [coupon]="s.coupon!" [resending]="resending()" [resendMessage]="resendMessage()" [resendFailed]="resendFailed()" (resend)="resend()" />
          </section>
        }
        @case ('already') {
          <section class="card coupon" aria-labelledby="cr-title">
            <h2 id="cr-title">הקופון שלכם</h2>
            <p class="muted small">{{ s.message }}</p>
            <px-coupon-result [coupon]="s.coupon!" [resending]="resending()" [resendMessage]="resendMessage()" [resendFailed]="resendFailed()" (resend)="resend()" />
          </section>
        }
        @case ('not-eligible') { <p class="note" role="status">{{ s.message }}</p> }
        @case ('quota-full') { <p class="note" role="status">{{ s.message }}</p> }
        @case ('paused') { <p class="note" role="status">{{ s.message }}</p> }
      }
    }
  `,
  styles: [`
    :host { display:block; margin: .4rem 0 1rem; }
    .veil { position:fixed; inset:0; z-index:300; background: rgba(3,5,12,.62); }
    .pop { position:fixed; z-index:301; left:50%; top:50%; transform:translate(-50%, -50%); width:min(460px, calc(100% - 32px)); max-height:calc(100dvh - 32px); overflow:auto;
      box-sizing:border-box; text-align:center; background: radial-gradient(24rem 9rem at 50% 0%, rgba(224,185,92,.2), transparent 70%), #0a1230;
      border:2px solid var(--gold); border-radius:18px; padding:1.3rem 1.1rem 1.2rem; box-shadow: 0 0 40px rgba(224,185,92,.3); }
    .x { position:absolute; top:.45rem; inset-inline-end:.45rem; background:none; border:none; color: var(--muted); font-size:1.1rem; cursor:pointer; padding:.5rem; min-width:44px; min-height:44px; }
    .mark { display:block; direction:ltr; letter-spacing:.3em; font-size:.72rem; color: var(--gold); font-weight:700; }
    h2 { margin:.35rem 0 .5rem; font-family: var(--font-title); color:#fff; font-size:1.45rem; line-height:1.3; }
    .pop p { margin:.3rem 0; line-height:1.65; color:#e8ecfb; } strong { color: var(--gold-2); }
    .big-score b { font-size:2.4rem; color: var(--gold-2); line-height:1; }
    .strip { display:flex; gap:.6rem; align-items:center; justify-content:center; flex-wrap:wrap; border:1px solid var(--gold); }
    .coupon { border:2px solid var(--gold); background: radial-gradient(22rem 8rem at 50% 0%, rgba(224,185,92,.16), transparent 70%), var(--card, rgba(10,18,48,.9)); }
    .coupon h2 { color: var(--gold-2); }
    .note { margin:0; color: var(--muted); font-size:.92rem; }
    .small { font-size:.86rem; }
  `],
})
export class CouponEligibilityComponent implements OnInit {
  private game = inject(GameService);
  private svc = inject(ChallengeService);
  status = signal<ChallengeStatus | null>(null);
  open = signal(true);
  resending = signal(false);
  resendMessage = signal<string | null>(null);
  resendFailed = signal(false);
  consentText = signal('');
  code = '';
  token: string | null = null;

  async ngOnInit() {
    this.code = this.game.snapshot()?.code ?? '';
    const s = sessionStore.get();
    this.token = s?.code === this.code ? s.token ?? null : null;
    if (!this.code) return;
    const c = await this.svc.load();
    this.consentText.set(c.consentText ?? '');
    try {
      this.status.set(await this.svc.status(this.code, this.token));
    } catch {
      // the challenge is an extra: if the check fails, the results stay exactly as they are
    }
  }

  onIssued(s: ChallengeStatus) {
    this.status.set(s);
  }

  async resend() {
    this.resending.set(true);
    this.resendMessage.set(null);
    try {
      const s = await this.svc.resend(this.code, this.token);
      this.status.set(s);
      this.resendFailed.set(s.coupon?.emailStatus !== 'sent');
      this.resendMessage.set(s.coupon?.emailStatus === 'sent' ? 'המייל נשלח שוב.' : 'גם הפעם לא הצלחנו לשלוח. הקופון שמור כאן על המסך.');
    } catch (e) {
      this.resendFailed.set(true);
      this.resendMessage.set(e instanceof ApiError ? e.message : 'לא הצלחנו לשלוח שוב. נסו בעוד רגע.');
    } finally {
      this.resending.set(false);
    }
  }
}
