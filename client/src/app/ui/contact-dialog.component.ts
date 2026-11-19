import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { ApiService } from '../core/api.service';
import { HelpService } from '../core/help.service';
import { SiteService } from '../core/site.service';

/**
 * "צור קשר" from the "הדרכה" menu: name, reply address and message. The server checks them, sends them to the site's
 * contact address and says whether it worked; nothing about the sending is known to the browser.
 */
@Component({
  selector: 'px-contact-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'close()' },
  template: `
    <div class="overlay" (click)="close()">
      <section class="contact-modal" role="dialog" aria-modal="true" aria-labelledby="ct-title" aria-describedby="ct-lead" (click)="$event.stopPropagation()">
        <div class="head">
          <span class="eyebrow">צור קשר</span>
          <button type="button" class="x" (click)="close()" aria-label="סגירת החלון">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>
        <h2 id="ct-title" class="gold-title">נשמח לשמוע מכם</h2>
        <span class="rule" aria-hidden="true"></span>

        @if (sent()) {
          <div class="done" role="status">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="m7.5 12.5 3 3 6-6.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <p>{{ sent() }}</p>
          </div>
          <div class="foot">
            <button type="button" class="btn primary" (click)="close()">סגירה</button>
          </div>
        } @else {
          <p id="ct-lead" class="lead">כתבו לנו ונחזור אליכם במייל.</p>
          <form (submit)="send($event)" novalidate>
            <div class="field">
              <label for="ct-name">שם</label>
              <input #first id="ct-name" name="name" autocomplete="name" maxlength="80" [value]="name()" (input)="name.set(val($event))" />
            </div>
            <div class="field">
              <label for="ct-email">מייל לחזרה</label>
              <input id="ct-email" name="email" type="email" dir="ltr" autocomplete="email" maxlength="254" [value]="email()" (input)="email.set(val($event))" />
            </div>
            <div class="field">
              <label for="ct-msg">הודעה</label>
              <textarea id="ct-msg" name="message" rows="6" maxlength="4000" placeholder="שאלה, רעיון או תקלה - נשמח לשמוע." [value]="message()" (input)="message.set(val($event))"></textarea>
            </div>
            <!-- people never see this field; a bot that fills it is answered politely and nothing is sent -->
            <input class="trap" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" [value]="website()" (input)="website.set(val($event))" />
            @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
            <div class="foot">
              <button type="button" class="btn ghost" (click)="close()">ביטול</button>
              <button type="submit" class="btn primary" [disabled]="busy()">{{ busy() ? 'שולחים...' : 'שליחה' }}</button>
            </div>
          </form>
          <p class="alt">אפשר גם לכתוב ישירות: <a [href]="'mailto:' + site.info().contactEmail" dir="ltr">{{ site.info().contactEmail }}</a></p>
        }
      </section>
    </div>
  `,
  styles: [`
    .overlay { z-index: 60; }
    .contact-modal { position:relative; width:min(560px, 100%); max-height:calc(100dvh - 32px); overflow:auto;
      background:linear-gradient(180deg, #16204a, #0d1430); border:1px solid var(--line); border-radius:22px; box-shadow:var(--shadow);
      padding:1.1rem clamp(1.1rem, 4vw, 2rem) 1.4rem; }
    .head { display:flex; align-items:center; justify-content:space-between; }
    .eyebrow { color:var(--muted); font-weight:700; font-size:.92rem; }
    .x { width:42px; height:42px; display:grid; place-items:center; border-radius:12px; border:1px solid var(--line); background:rgba(255,255,255,.04); color:var(--text); cursor:pointer; }
    .x:hover { background:rgba(255,255,255,.1); } .x:focus-visible { outline:3px solid var(--gold-2); outline-offset:2px; }
    .x svg { width:20px; height:20px; }
    h2 { font-size:clamp(1.7rem, 5vw, 2.2rem); font-weight:900; margin:.7rem 0 .55rem; }
    .rule { display:block; width:46px; height:4px; border-radius:2px; background:var(--gold); margin-bottom:1rem; }
    .lead { margin:0 0 1.1rem; color:#e6dfcf; }
    form { display:flex; flex-direction:column; gap:1rem; }
    .field label { color:var(--text); }
    input, textarea { font-family:inherit; font-size:1.02rem; padding:.75em .9em; border-radius:12px; border:1px solid var(--line);
      background:rgba(0,0,0,.32); color:var(--text); min-height:48px; width:100%; }
    textarea { resize:vertical; min-height:140px; line-height:1.6; }
    input:focus, textarea:focus { outline:2px solid var(--gold); border-color:transparent; }
    textarea::placeholder { color:#8f8aa3; }
    .trap { position:absolute; inset-inline-start:-9999px; width:1px; height:1px; opacity:0; }
    .foot { display:flex; justify-content:flex-end; gap:.7rem; border-top:1px solid rgba(201,162,77,.22); padding-top:1.1rem; margin-top:.3rem; }
    .foot .btn { min-width:104px; }
    .error { margin:0; }
    .alt { margin:1rem 0 0; color:var(--muted); font-size:.86rem; text-align:center; } .alt a { color:var(--gold-2); }
    .done { display:flex; flex-direction:column; align-items:center; gap:.6rem; text-align:center; padding:1rem 0 1.4rem; color:var(--ok); }
    .done svg { width:56px; height:56px; } .done p { color:var(--text); font-size:1.1rem; font-weight:700; margin:0; }
    @media (max-width: 480px) { .foot .btn { flex:1; } }
  `],
})
export class ContactDialogComponent implements AfterViewInit {
  private api = inject(ApiService);
  private help = inject(HelpService);
  site = inject(SiteService);
  private first = viewChild<ElementRef<HTMLInputElement>>('first');

  name = signal('');
  email = signal('');
  message = signal('');
  website = signal('');
  busy = signal(false);
  error = signal<string | null>(null);
  sent = signal<string | null>(null);

  constructor() {
    this.site.load();
  }

  ngAfterViewInit() {
    this.first()?.nativeElement.focus();
  }

  val(e: Event) {
    return (e.target as HTMLInputElement | HTMLTextAreaElement).value;
  }

  close() {
    if (!this.busy()) this.help.closeContact();
  }

  async send(ev: Event) {
    ev.preventDefault();
    if (this.busy()) return;
    // the same checks as the server's, only to answer at once; the server decides
    const name = this.name().trim(), email = this.email().trim(), message = this.message().trim();
    if (name.length < 2) return this.error.set('נא לכתוב שם.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return this.error.set('כתובת המייל לחזרה אינה תקינה.');
    if (message.length < 5) return this.error.set('נא לכתוב הודעה.');
    this.error.set(null);
    this.busy.set(true);
    try {
      const r = await this.api.contact({ name, email, message, website: this.website() || undefined });
      this.sent.set(r.message);
    } catch (e: any) {
      this.error.set(e?.message ?? 'לא הצלחנו לשלוח. נסו שוב.');
    } finally {
      this.busy.set(false);
    }
  }
}
