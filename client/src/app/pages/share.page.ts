import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiError, ApiService, ReferralReply } from '../core/api.service';

const EMAIL = /^[^\s@<>()[\],;:"\\]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;
const NAME = /^\p{L}[\p{L}\p{M} '\-׳״.]{0,39}$/u;

/**
 * "Create a personal link": a short form (names, email, two unticked consents). The link is shown at once and also
 * mailed by the server. It only shows the visitor's own link — never purchases or anyone else's details.
 */
@Component({
  selector: 'px-share',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bg" aria-hidden="true"></div>
    <header class="top"><a routerLink="/" class="brand gold-title">PORTAL X</a><a routerLink="/" class="back">‹ חזרה לדף הבית</a></header>
    <main class="card">
      @if (done(); as d) {
        <section aria-labelledby="ok-title">
          <h1 id="ok-title">הקישור האישי שלך מוכן!</h1>
          <p class="hello">שלום {{ d.firstName }},</p>
          <p>{{ d.message }}</p>
          <div class="link-box">
            <input #box class="link" dir="ltr" readonly [value]="d.url" aria-label="הקישור האישי שלך" (focus)="box.select()" />
            <button type="button" class="btn primary" (click)="copy(box)">{{ copied() ? 'הועתק ✓' : 'העתקת הקישור' }}</button>
          </div>
          @if (emailNote(); as n) { <p class="msg" [class.ok]="n.ok" [attr.role]="n.ok ? 'status' : 'alert'">{{ n.text }}</p> }
          <button type="button" class="btn" (click)="resend()" [disabled]="busy()">{{ busy() ? 'שולחים...' : 'שליחת הקישור שוב למייל' }}</button>
          <p class="muted note">הקישור מאפשר לעקוב אחר רכישות שבוצעו באמצעותו. מי שנכנס דרכו ורוכש משחק באותו ביקור — הרכישה נרשמת בנתוני הקישור.
            אין כרגע תגמול כספי על רכישות, והרוכשים אינם מקבלים הנחה.</p>
        </section>
      } @else {
        <h1>יצירת קישור אישי</h1>
        <p class="intro">אהבתם את PORTAL X? צרו קישור אישי ושתפו אותו עם חברים ומכרים. רכישות שיתבצעו דרך הקישור יירשמו בנתוני הקישור שלכם.</p>
        <form (submit)="$event.preventDefault(); submit()" novalidate>
          <div class="row">
            <label class="field"><span>שם פרטי</span>
              <input autocomplete="given-name" maxlength="40" [value]="first()" (input)="first.set($any($event.target).value)" (blur)="touched.set(true)"
                [attr.aria-invalid]="touched() && !firstOk()" required /></label>
            <label class="field"><span>שם משפחה</span>
              <input autocomplete="family-name" maxlength="40" [value]="last()" (input)="last.set($any($event.target).value)" (blur)="touched.set(true)"
                [attr.aria-invalid]="touched() && !lastOk()" required /></label>
          </div>
          <label class="field"><span>כתובת מייל</span>
            <input type="email" dir="ltr" autocomplete="email" inputmode="email" maxlength="254" placeholder="name@example.com"
              [value]="email()" (input)="email.set($any($event.target).value)" (blur)="touched.set(true)" [attr.aria-invalid]="touched() && !emailOk()" required /></label>
          <label class="opt">
            <input type="checkbox" [checked]="consent()" (change)="consent.set($any($event.target).checked)" />
            <span>{{ consentText }} פרטים ב<a routerLink="/info/privacy" target="_blank">מדיניות הפרטיות</a>.</span>
          </label>
          <label class="opt">
            <input type="checkbox" [checked]="terms()" (change)="terms.set($any($event.target).checked)" />
            <span>אני מסכים/ה ל<a routerLink="/info/terms" target="_blank">תנאי השימוש והתקנון</a> של האתר.</span>
          </label>
          @if (touched() && problem(); as p) { <p class="msg" role="alert">{{ p }}</p> }
          @if (error(); as e) { <p class="msg" role="alert">{{ e }}</p> }
          <button class="btn primary big" type="submit" [disabled]="busy()">{{ busy() ? 'יוצרים...' : 'צור לי קישור אישי' }}</button>
          <p class="muted small">אין צורך בחשבון. הקישור מוצג מיד ונשלח גם למייל. בכל מייל שיווקי יש קישור להסרה.</p>
        </form>
      }
    </main>
  `,
  styles: [`
    :host { display:block; min-height:100dvh; position:relative; padding:0 16px 2rem; }
    .bg { position:fixed; inset:0; z-index:0; pointer-events:none;
      background: radial-gradient(60rem 30rem at 85% -10%, rgba(224,185,92,.18), transparent 60%), linear-gradient(180deg, #0a1230 0%, var(--bg) 60%); }
    .top { position:relative; z-index:1; max-width:720px; margin:0 auto; padding:14px 0; display:flex; align-items:center; justify-content:space-between; gap:1rem; }
    .brand { font-weight:900; letter-spacing:.06em; font-size:1.45rem; text-decoration:none; direction:ltr; white-space:nowrap; }
    .back { color:var(--muted); white-space:nowrap; }
    main { position:relative; z-index:1; max-width:720px; margin:0 auto; padding:1.4rem 1.3rem; border:1px solid rgba(224,185,92,.4); }
    h1 { margin:0 0 .5rem; color:var(--gold-2); font-family:var(--font-title); font-size:1.8rem; }
    .intro { margin:0 0 1.1rem; line-height:1.7; }
    form { display:flex; flex-direction:column; gap:.8rem; }
    .row { display:grid; grid-template-columns:1fr 1fr; gap:.8rem; }
    .field { display:flex; flex-direction:column; gap:.3rem; } .field span { font-weight:700; }
    .field input { width:100%; box-sizing:border-box; }
    input[aria-invalid="true"] { border-color:#e66; }
    .opt { display:flex; gap:.6rem; align-items:flex-start; cursor:pointer; line-height:1.6; }
    .opt input { width:20px; height:20px; margin-top:.2rem; flex-shrink:0; accent-color:var(--gold); }
    .opt a { color:var(--gold-2); }
    .msg { margin:0; color:#ffb4a8; font-weight:600; } .msg.ok { color:#9be3b0; }
    .big { padding:.8rem 1.6rem; font-size:1.1rem; align-self:flex-start; }
    .hello { font-size:1.15rem; font-weight:700; margin:.2rem 0; }
    .link-box { display:flex; gap:.5rem; margin:1rem 0; }
    .link { flex:1; min-width:0; font-family:monospace; font-size:1rem; background:#fff6dc; color:#0a1230; border:1px dashed var(--gold); border-radius:10px; padding:.7rem .8rem; }
    .note { line-height:1.7; margin-top:1rem; }
    @media (max-width: 560px) {
      .row { grid-template-columns:1fr; }
      .link-box { flex-direction:column; }
      .big { align-self:stretch; }
      h1 { font-size:1.5rem; }
    }
  `],
})
export class SharePage {
  private api = inject(ApiService);
  readonly consentText = 'אני מסכים/ה לקבל מיילים שיווקיים ועדכונים מ-PORTAL X בנוגע למשחקים חדשים, מבצעים, הטבות, קופונים ותכנים נוספים. ידוע לי שניתן לבטל את ההסכמה בכל עת.';
  first = signal('');
  last = signal('');
  email = signal('');
  consent = signal(false);
  terms = signal(false);
  touched = signal(false);
  busy = signal(false);
  error = signal<string | null>(null);
  done = signal<{ firstName: string; url: string; token: string; message: string } | null>(null);
  emailNote = signal<{ ok: boolean; text: string } | null>(null);
  copied = signal(false);

  firstOk = computed(() => NAME.test(this.first().trim()));
  lastOk = computed(() => NAME.test(this.last().trim()));
  emailOk = computed(() => EMAIL.test(this.email().trim()));
  problem = computed(() => {
    if (!this.firstOk() || !this.lastOk()) return 'יש למלא שם פרטי ושם משפחה (אותיות בלבד).';
    if (!this.emailOk()) return 'כתובת המייל אינה תקינה.';
    if (!this.consent()) return 'כדי ליצור קישור אישי יש לאשר קבלת מיילים שיווקיים.';
    if (!this.terms()) return 'יש לאשר את תנאי השימוש והתקנון.';
    return null;
  });

  async submit() {
    this.touched.set(true);
    this.error.set(null);
    if (this.problem()) return;
    this.busy.set(true);
    try {
      const r = await this.api.createReferral({
        firstName: this.first().trim(), lastName: this.last().trim(), email: this.email().trim(), marketingConsent: this.consent(), acceptTerms: this.terms(),
      });
      this.show(r);
    } catch (e) {
      this.error.set(e instanceof ApiError ? e.message : 'אירעה שגיאה. נסו שוב.');
    } finally {
      this.busy.set(false);
    }
  }

  private show(r: ReferralReply) {
    this.done.set({ firstName: r.firstName ?? this.first().trim(), url: r.url!, token: r.token!, message: r.message });
    // "sent" is shown only when the server says Gmail confirmed it
    if (r.emailStatus === 'sent') this.emailNote.set({ ok: true, text: r.emailMessage! });
    else if (r.emailStatus) this.emailNote.set({ ok: false, text: r.emailMessage! });
    else this.emailNote.set(null);
  }

  async resend() {
    const d = this.done();
    if (!d) return;
    this.busy.set(true);
    try {
      const r = await this.api.resendReferral(d.token);
      this.emailNote.set({ ok: r.emailStatus === 'sent', text: r.emailMessage ?? r.message });
    } catch (e) {
      this.emailNote.set({ ok: false, text: e instanceof ApiError ? e.message : 'אירעה שגיאה. נסו שוב.' });
    } finally {
      this.busy.set(false);
    }
  }

  async copy(box: HTMLInputElement) {
    try {
      await navigator.clipboard.writeText(box.value);
    } catch {
      box.select();
      document.execCommand('copy');
    }
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 2500);
  }
}
