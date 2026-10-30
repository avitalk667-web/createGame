import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, Campaign } from '../core/api.service';

/** The "friend brings a friend" banner: navy, a gold frame and the prize large — the same message as in the emails. */
@Component({
  selector: 'px-campaign-banner',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (c(); as c) {
      @if (c.enabled) {
        <aside class="campaign" aria-labelledby="campaign-title">
          <span class="mark" aria-hidden="true">◉ PORTAL X ◉</span>
          <h2 id="campaign-title">{{ c.title }}</h2>
          <b class="prize">{{ c.prize }}</b>
          <p class="lead">{{ c.lead }}</p>
          <p>{{ c.body }}</p>
          <p class="draw">{{ c.drawLabel }}: <b>{{ c.drawDate }}</b></p>
          @if (showButton()) { <a class="btn primary" routerLink="/share">{{ c.buttonLabel }}</a> }
        </aside>
      }
    }
  `,
  styles: [`
    .campaign { position:relative; text-align:center; background: radial-gradient(30rem 12rem at 50% 0%, rgba(122,170,255,.18), transparent 70%), #0a1230;
      border:2px solid var(--gold); border-radius:16px; padding:1.1rem 1rem 1.2rem; margin:0 0 1.2rem; box-shadow: 0 0 24px rgba(224,185,92,.18); }
    .mark { display:block; direction:ltr; letter-spacing:.25em; font-size:.75rem; color: var(--gold); font-weight:700; }
    h2 { margin:.35rem 0 .2rem; font-family: var(--font-title); color:#fff; font-size: clamp(1.25rem, 4.5vw, 1.7rem); line-height:1.35; }
    .prize { display:block; font-size: clamp(2.4rem, 10vw, 3.4rem); line-height:1.1; color: var(--gold-2); text-shadow: 0 0 18px rgba(224,185,92,.45); }
    p { margin:.35rem auto; max-width:46ch; line-height:1.7; color:#e8ecfb; }
    .lead { font-weight:700; color: var(--gold-2); }
    .draw { color:#c9d2ee; font-size:.95rem; } .draw b { color:#fff; }
    .btn { margin-top:.5rem; }
  `],
})
export class CampaignBannerComponent {
  private api = inject(ApiService);
  /** On the personal-link page itself the form is right there, so the button is not needed. */
  showButton = input(true);
  c = signal<Campaign | null>(null);

  constructor() {
    this.api.campaign().then((c) => this.c.set(c)).catch(() => {});
  }
}
