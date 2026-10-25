import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, sessionStore } from '../core/api.service';
import { GameService } from '../core/game.service';
import { SiteService } from '../core/site.service';

const EMAIL = /^[^\s@<>()[\],;:"\\]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;

/**
 * End of game: three separate, unticked choices — the results by email, marketing consent, the updates group link.
 * Nothing here blocks the end of the game; the results stay on the screen whatever is chosen.
 */
@Component({
  selector: 'px-results-email',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="mail" aria-labelledby="mail-title">
      <h2 id="mail-title"><span aria-hidden="true">✉</span> התוצאות שלך — גם למייל!</h2>
      <p class="intro">כל הכבוד! השלמתם את ההרפתקה. רוצים לשמור את התוצאות ולחזור אליהן בהמשך?</p>

      <form (submit)="$event.preventDefault(); submit()" novalidate>
        @if (site.info().resultsEmail) {
          <label class="opt">
            <input type="checkbox" [checked]="sendResults()" [disabled]="sent()" (change)="sendResults.set($any($event.target).checked); reply.set(null)" />
            <span>שלחו לי את תוצאות המשחק למייל.</span>
          </label>
        }
        <label class="opt">
          <input type="checkbox" [checked]="marketing()" [disabled]="consentSaved()" (change)="marketing.set($any($event.target).checked); reply.set(null)" />
          <span>אני מסכים/ה לקבל מיילים שיווקיים ועדכונים מ-PORTAL X על משחקים חדשים, הטבות, קופונים ותכנים נוספים. ניתן לבטל את ההסכמה בכל עת.</span>
        </label>
        @if (needsConsent()) { <p class="req" role="note">{{ site.info().resultsConsentMessage }}</p> }
        @if (site.info().communityGroup) {
          <label class="opt">
            <input type="checkbox" [checked]="group()" [disabled]="!!groupUrl()" (change)="group.set($any($event.target).checked); reply.set(null)" />
            <span>אני מעוניין/ת לקבל קישור להצטרפות לקבוצת העדכונים של PORTAL X.</span>
          </label>
        }

        @if (needsEmail()) {
          <label class="field">
            <span>כתובת מייל</span>
            <input type="email" dir="ltr" autocomplete="email" inputmode="email" maxlength="254" placeholder="name@example.com"
              [value]="email()" (input)="email.set($any($event.target).value); reply.set(null)" (blur)="touched.set(true)"
              [attr.aria-invalid]="touched() && !emailOk()" aria-describedby="mail-err" />
          </label>
          @if (touched() && email() && !emailOk()) { <p id="mail-err" class="err" role="alert">כתובת המייל אינה תקינה. בדקו אותה ונסו שוב.</p> }
        }

        @if (anyChosen() && !allDone()) {
          <button class="btn primary" type="submit" [disabled]="busy() || (needsEmail() && !emailOk())">
            {{ busy() ? 'שולחים...' : sendResults() ? (failed() ? 'נסו שוב לשלוח' : 'שלחו לי את התוצאות') : 'שמירת הבחירות' }}
          </button>
        }

        @if (reply(); as r) {
          <p class="msg" [class.ok]="r.ok" [attr.role]="r.ok ? 'status' : 'alert'">{{ r.message }}</p>
        }
        @if (groupUrl(); as g) {
          <a class="btn group" [href]="g" target="_blank" rel="noopener noreferrer">להצטרפות לקבוצת העדכונים ‹</a>
          <p class="note">הקישור נפתח בחלון חדש. ההצטרפות עצמה נעשית אצלכם, בקבוצה.</p>
        }
      </form>

      <p class="privacy">
        הכתובת משמשת רק למה שבחרתם: שליחת התוצאות, ו/או דיוור שיווקי אם הסכמתם לו. השירות מופעל על ידי PORTAL X,
        ובכל מייל שיווקי יש קישור להסרה. פרטים ב<a routerLink="/info/privacy">מדיניות הפרטיות</a>.
      </p>
    </section>
  `,
  styles: [`
    .mail { text-align:start; margin:1rem 0 .4rem; padding:1rem 1.1rem; border-radius:14px; border:1px solid rgba(224,185,92,.45);
      background:linear-gradient(180deg, rgba(20,32,74,.9), rgba(10,18,48,.9)); }
    h2 { margin:0 0 .3rem; font-size:1.3rem; color:var(--gold-2); font-family:var(--font-title); }
    .intro { margin:0 0 .8rem; color:#e6e0cf; }
    form { display:flex; flex-direction:column; gap:.55rem; }
    .opt { display:flex; gap:.6rem; align-items:flex-start; cursor:pointer; line-height:1.5; }
    .opt input { width:20px; height:20px; margin-top:.15rem; flex-shrink:0; accent-color:var(--gold); }
    .field { display:flex; flex-direction:column; gap:.25rem; } .field span { font-weight:700; font-size:.92rem; }
    .field input { min-height:44px; }
    .err { margin:0; color:#ffb4a6; font-size:.9rem; }
    .req { margin:0; padding:.45rem .7rem; border-radius:10px; background:rgba(224,185,92,.12); color:#f6d78d; font-size:.9rem; line-height:1.5; }
    .msg { margin:.2rem 0 0; padding:.5rem .7rem; border-radius:10px; background:rgba(255,120,100,.12); color:#ffd2c8; }
    .msg.ok { background:rgba(120,220,160,.12); color:#bff0cf; }
    .btn.primary { align-self:flex-start; }
    .group { align-self:flex-start; border-color:#5fd38d; }
    .note { margin:0; color:var(--muted); font-size:.85rem; }
    .privacy { margin:.8rem 0 0; color:var(--muted); font-size:.82rem; line-height:1.6; }
    @media (max-width: 560px) { .btn.primary, .group { align-self:stretch; text-align:center; } }
  `],
})
export class ResultsEmailComponent {
  private api = inject(ApiService);
  private game = inject(GameService);
  site = inject(SiteService);

  sendResults = signal(false);
  marketing = signal(false);
  group = signal(false);
  email = signal('');
  touched = signal(false);
  busy = signal(false);
  sent = signal(false);
  failed = signal(false);
  consentSaved = signal(false);
  groupUrl = signal<string | null>(null);
  reply = signal<{ ok: boolean; message: string } | null>(null);

  /** The results box is ticked but the required marketing consent is not (policy from the server). */
  needsConsent = computed(() => !!this.site.info().resultsRequireConsent && this.sendResults() && !this.sent() && !this.marketing() && !this.consentSaved());
  needsEmail = computed(() => (this.sendResults() && !this.sent()) || (this.marketing() && !this.consentSaved()));
  emailOk = computed(() => EMAIL.test(this.email().trim()) && this.email().trim().length <= 254);
  anyChosen = computed(() => this.sendResults() || this.marketing() || this.group());
  allDone = computed(() => (!this.sendResults() || this.sent()) && (!this.marketing() || this.consentSaved()) && (!this.group() || !!this.groupUrl()));

  constructor() {
    this.site.load();
  }

  async submit() {
    this.touched.set(true);
    if (this.needsConsent()) {
      this.reply.set({ ok: false, message: this.site.info().resultsConsentMessage ?? '' });
      return;
    }
    if (this.needsEmail() && !this.emailOk()) return;
    const code = this.game.snapshot()?.code;
    if (!code) return;
    const s = sessionStore.get();
    this.busy.set(true);
    this.reply.set(null);
    try {
      const r = await this.api.resultsEmail(code, {
        token: s?.code === code ? s.token ?? null : null,
        sendResults: this.sendResults() && !this.sent(),
        email: this.needsEmail() ? this.email().trim() : null,
        marketingConsent: this.marketing() && !this.consentSaved(),
        communityLink: this.group() && !this.groupUrl(),
      });
      if (r.resultsStatus === 'sent') this.sent.set(true);
      // a failed send keeps the other choices (already saved) and offers to try again — never a second email after success
      this.failed.set(!r.ok && (r.code === 'send-failed' || r.code === 'send-uncertain'));
      if (r.consentRecorded) this.consentSaved.set(true);
      if (r.communityGroupUrl) this.groupUrl.set(r.communityGroupUrl);
      this.reply.set({ ok: r.ok, message: r.message });
    } catch (e: any) {
      this.failed.set(e.code === 'send-failed');
      this.reply.set({ ok: false, message: e.message });
    } finally {
      this.busy.set(false);
    }
  }
}
