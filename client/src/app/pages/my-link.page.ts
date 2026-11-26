import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService, Campaign, myLinkStore } from '../core/api.service';

/** The raffle line of the page, or null when there is none or the draw has passed. "20:00" is the hour as written in the file. */
export function raffleLine(c: Campaign): { prize: string; when: string } | null {
  if (!c.enabled || !c.prize) return null;
  if (c.drawAt) {
    const now = c.serverNow ? Date.parse(c.serverNow) : Date.now();
    if (!(Date.parse(c.drawAt) > now)) return null;
  }
  const hour = c.drawAt?.match(/T(\d\d:\d\d)/)?.[1];
  return { prize: c.prize, when: hour ? `${c.drawDate} בשעה ${hour}` : c.drawDate };
}

/**
 * "/my-link/{token}": the page the "📋 העתקת הקישור האישי" button of the "סודות הפורטל" mailing opens (an email cannot copy
 * to the clipboard). It shows the visitor's existing personal link — never a new one — with a copy button (the only
 * action on the page). Opening it is not a visit through the link, and it shows nothing but the link's address.
 */
@Component({
  selector: 'px-my-link',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bg" aria-hidden="true"></div>
    <header class="top"><a routerLink="/" class="brand gold-title">PORTAL X</a><a routerLink="/" class="back">‹ לאתר המשחקים</a></header>
    <main class="card">
      @if (url(); as u) {
        <h1>🔗 הקישור האישי שלכם</h1>
        <p class="lead">נהניתם מהחוויה? שתפו את החברים והמשפחה!</p>
        @if (raffle(); as r) {
          <div class="raffle">
            <p class="line">🎁 כל רכישה דרך הקישור האישי = כרטיס להגרלה על <b>{{ r.prize }}</b>!</p>
            <p class="when">ההגרלה: {{ r.when }}</p>
          </div>
        }
        <div class="link-box">
          <input #box class="link" dir="ltr" readonly [value]="u" aria-label="הקישור האישי שלכם" (focus)="box.select()" />
          <button type="button" class="btn primary" (click)="copy(box)">{{ copied() ? 'הועתק ✓' : '📋 העתקת הקישור' }}</button>
        </div>
        <p class="muted">שתפו והזמינו גם אותם לגלות את עולם PORTAL-X</p>
      } @else if (missing()) {
        <h1>הקישור לא נמצא</h1>
        <p class="lead">הקישור האישי הזה אינו פעיל. אפשר ליצור קישור אישי חדש בדקה.</p>
        <a class="btn primary" routerLink="/share">יצירת קישור אישי</a>
      } @else {
        <p class="loading" aria-live="polite">טוענים את הקישור...</p>
      }
    </main>
  `,
  styles: [`
    :host { display:block; min-height:100dvh; position:relative; padding:0 16px 2rem; }
    .bg { position:fixed; inset:0; z-index:0; pointer-events:none;
      background: radial-gradient(60rem 30rem at 85% -10%, rgba(73,192,255,.16), transparent 60%), linear-gradient(180deg, #0a1638 0%, var(--bg) 60%); }
    .top { position:relative; z-index:1; max-width:640px; margin:0 auto; padding:14px 0; display:flex; align-items:center; justify-content:space-between; gap:1rem; }
    .brand { font-weight:900; letter-spacing:.06em; font-size:1.45rem; text-decoration:none; direction:ltr; white-space:nowrap; }
    .back { color:var(--muted); white-space:nowrap; }
    main { position:relative; z-index:1; max-width:640px; margin:0 auto; padding:1.6rem 1.3rem; text-align:center;
      background:#0f1d48; border:1px solid #2b4c95; }
    h1 { margin:0 0 .5rem; color:#fff; font-size:1.7rem; }
    .lead { margin:0 0 1.1rem; color:#dce8ff; font-size:1.1rem; line-height:1.6; }
    .link-box { display:flex; gap:.5rem; margin:1rem 0; }
    .link { flex:1; min-width:0; font-family:monospace; font-size:1rem; background:#eef9ff; color:#0a2552; border:1px solid #9fd6ff; border-radius:999px; padding:.75rem 1rem; text-align:left; }
    .link-box .btn { border-radius:999px; white-space:nowrap; }
    .muted { color:#b9cbef; margin:0; }
    .raffle { margin:0 auto 1rem; max-width:30rem; background:#1a2a66; border:1px solid var(--gold); border-radius:12px; padding:.65rem .8rem; }
    .raffle p { margin:0; line-height:1.5; }
    .raffle .line { color:#fff; font-weight:700; } .raffle .line b { color:var(--gold-2); white-space:nowrap; }
    .raffle .when { color:#dce8ff; font-size:.92rem; margin-top:.2rem; }
    @media (max-width: 560px) { .link-box { flex-direction:column; } h1 { font-size:1.45rem; } }
  `],
})
export class MyLinkPage {
  private route = inject(ActivatedRoute);
  private api = inject(ApiService);
  url = signal<string | null>(null);
  missing = signal(false);
  copied = signal(false);

  /** The site's raffle, the same wording as the mailing, while the draw is still ahead (by the server's clock). */
  raffle = signal<{ prize: string; when: string } | null>(null);

  constructor() {
    this.load();
    this.api.campaign().then((c) => this.raffle.set(raffleLine(c))).catch(() => {});
  }

  private async load() {
    const token = this.route.snapshot.paramMap.get('token') ?? '';
    try {
      const res = await fetch(`/api/referrals/link/${encodeURIComponent(token)}`, { headers: { Accept: 'application/json' } });
      if (!res.ok) { this.missing.set(true); return; }
      const data = (await res.json()) as { url: string };
      this.url.set(data.url);
      // the same as after creating a link: this browser can offer it again later
      myLinkStore.set(data.url);
    } catch {
      this.missing.set(true);
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
