import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { ApiService, Campaign, myLinkStore } from '../core/api.service';

/** Pages where the popup never appears: a game in progress, joining one, paying, the admin and the personal-link page itself. */
const QUIET = [/^\/room\//, /^\/join/, /^\/checkout\//, /^\/sandbox-pay\//, /^\/admin/, /^\/share/, /^\/unsubscribe/];
/** Set once the popup has been shown in this browser: it never comes back (closing, "not now" and "create" alike). */
const SEEN_KEY = 'px_campaign_seen';

/**
 * The "friend brings a friend" popup: shown only once in a browser, a few seconds into a visit to the site's own pages,
 * never during a game.
 * A visitor who already created a link in this browser sees it with a copy button instead of the invitation.
 */
@Component({
  selector: 'px-campaign-popup',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open() && c(); as c) {
      <div class="veil" (click)="later()"></div>
      <section class="pop" role="dialog" aria-modal="true" aria-labelledby="cp-title">
        <button class="x" (click)="later()" aria-label="סגירה">✕</button>
        <span class="mark" aria-hidden="true">◉ PORTAL X ◉</span>
        <h2 id="cp-title">{{ c.popupTitle }}</h2>
        <b class="prize">{{ c.prize }}</b>
        <p>{{ c.popupBody }}</p>
        <p class="draw">{{ c.drawLabel }}: <b>{{ c.drawDate }}</b></p>
        @if (myLink(); as url) {
          <p class="lead">הקישור האישי שלך:</p>
          <div class="link-box">
            <input #box class="link" dir="ltr" readonly [value]="url" aria-label="הקישור האישי שלך" (focus)="box.select()" />
            <button type="button" class="btn primary" (click)="copy(box)">{{ copied() ? 'הועתק ✓' : 'העתקת הקישור' }}</button>
          </div>
          <div class="row"><button type="button" class="btn" (click)="later()">{{ c.popupLaterLabel }}</button></div>
        } @else {
          <div class="row">
            <button type="button" class="btn primary" (click)="create()">{{ c.popupCreateLabel }}</button>
            <button type="button" class="btn" (click)="later()">{{ c.popupLaterLabel }}</button>
          </div>
        }
      </section>
    }
  `,
  styles: [`
    .veil { position:fixed; inset:0; z-index:90; background: rgba(3,5,12,.6); }
    .pop { position:fixed; z-index:91; left:50%; top:50%; transform:translate(-50%, -50%); width:min(460px, calc(100% - 32px)); max-height:calc(100dvh - 32px); overflow:auto;
      box-sizing:border-box; text-align:center; background: radial-gradient(26rem 10rem at 50% 0%, rgba(122,170,255,.2), transparent 70%), #0a1230;
      border:2px solid var(--gold); border-radius:18px; padding:1.2rem 1.1rem 1.1rem; box-shadow: 0 0 40px rgba(224,185,92,.3); animation: in .35s ease both; }
    @keyframes in { from { opacity:0; transform:translate(-50%, -46%) } }
    .x { position:absolute; top:.5rem; inset-inline-end:.5rem; background:none; border:none; color: var(--muted); font-size:1.1rem; cursor:pointer; padding:.4rem; }
    .mark { display:block; direction:ltr; letter-spacing:.25em; font-size:.72rem; color: var(--gold); font-weight:700; }
    h2 { margin:.4rem 0 .2rem; font-family: var(--font-title); color:#fff; font-size:1.4rem; line-height:1.35; }
    .prize { display:block; font-size:3rem; line-height:1.1; color: var(--gold-2); text-shadow: 0 0 18px rgba(224,185,92,.45); }
    p { margin:.4rem 0; line-height:1.7; color:#e8ecfb; } .lead { font-weight:700; color: var(--gold-2); } .draw { color:#c9d2ee; font-size:.92rem; } .draw b { color:#fff; }
    .row { display:flex; gap:.5rem; justify-content:center; flex-wrap:wrap; margin-top:.7rem; }
    .link-box { display:flex; gap:.4rem; } .link { flex:1; min-width:0; font-family:monospace; background:#fff6dc; color:#0a1230; border:1px dashed var(--gold); border-radius:10px; padding:.6rem; }
    @media (max-width: 420px) { .link-box { flex-direction:column; } }
  `],
})
export class CampaignPopupComponent {
  private api = inject(ApiService);
  private router = inject(Router);
  c = signal<Campaign | null>(null);
  open = signal(false);
  myLink = signal<string | null>(null);
  copied = signal(false);
  private timer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd), takeUntilDestroyed()).subscribe(() => this.consider());
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  private quiet(url = this.router.url) {
    return QUIET.some((r) => r.test(url));
  }

  /** Once in this browser, ever. */
  private consider() {
    clearTimeout(this.timer);
    if (this.quiet()) {
      this.open.set(false);
      return;
    }
    if (this.open() || this.wasSeen()) return;
    this.timer = setTimeout(async () => {
      if (this.quiet() || this.wasSeen()) return;
      try {
        const c = await this.api.campaign();
        if (!c.enabled || this.quiet()) return;
        this.c.set(c);
        this.myLink.set(myLinkStore.get());
        this.open.set(true);
        this.remember();
      } catch { /* no campaign today */ }
    }, 6000);
  }

  private wasSeen() {
    try {
      return !!sessionStorage.getItem(SEEN_KEY) || !!localStorage.getItem(SEEN_KEY);
    } catch {
      return false;
    }
  }

  private remember() {
    try {
      sessionStorage.setItem(SEEN_KEY, '1');
      localStorage.setItem(SEEN_KEY, String(Date.now()));
    } catch { /* storage blocked: it may show again on a later visit */ }
  }

  later() {
    this.open.set(false);
    this.remember();
  }

  create() {
    this.open.set(false);
    this.remember();
    this.router.navigate(['/share']);
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
