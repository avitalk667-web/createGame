import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { SiteService } from '../core/site.service';

/** The official treasure-chest wording (approved by the owner): shown exactly as is, never rephrased. */
export const TREASURE_PROMO = {
  title: 'תיבת האוצר של PORTAL X',
  line: 'בכל רכישה מחכה לכם אולי הפתעה!',
  fine: 'הזכייה אינה מובטחת. כל רכישה מקבלת הזדמנות אחת.',
} as const;

let uid = 0;

/**
 * The treasure chest's promotion on the site: a section on the home page, a small mark on each purchasable game card, and a
 * compact box next to the price on a game's page. One component, so all three look the same.
 *
 * It shows only while the chest is switched on in the admin "תיבת האוצר" tab: the same setting the server draws by, read
 * from the public /api/site details (SiteService). Off, or not known yet, it renders nothing.
 *
 * The chest is the same SVG artwork as the order page's chest (light, no WebGL, no images); the light and the sparkles are
 * CSS, and stop for reduced motion.
 */
@Component({
  selector: 'px-treasure-promo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (on()) {
      @switch (variant()) {
        @case ('section') {
          <section class="promo section" aria-labelledby="tp-title">
            <div class="art" aria-hidden="true">
              <div class="halo"></div>
              <div class="chest"><ng-container *ngTemplateOutlet="chest" /></div>
              @for (s of sparks; track $index) { <i class="spark" [style]="s"></i> }
            </div>
            <div class="text">
              <h2 id="tp-title" class="title">{{ T.title }}</h2>
              <p class="line">{{ T.line }}</p>
              <p class="fine">{{ T.fine }}</p>
            </div>
          </section>
        }
        @case ('badge') {
          <p class="promo badge" [attr.title]="T.title + ' · ' + T.line + ' ' + T.fine">
            <span class="icon" aria-hidden="true"><ng-container *ngTemplateOutlet="chest" /></span>
            <span class="words"><b>{{ T.line }}</b><small>{{ T.fine }}</small></span>
          </p>
        }
        @default {
          <div class="promo compact" role="note" [attr.aria-label]="T.title">
            <span class="icon" aria-hidden="true"><ng-container *ngTemplateOutlet="chest" /></span>
            <div class="words">
              <b class="title">{{ T.title }}</b>
              <span class="line">{{ T.line }}</span>
              <small class="fine">{{ T.fine }}</small>
            </div>
          </div>
        }
      }
    }

    <!-- a closed chest: the lid and the body of the order page's chest, in one picture -->
    <ng-template #chest><svg viewBox="0 0 220 196" focusable="false"><defs>
        <linearGradient [attr.id]="id + 'w'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a2a6e"/><stop offset="1" stop-color="#191338"/></linearGradient>
        <linearGradient [attr.id]="id + 'l'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a3f9e"/><stop offset="1" stop-color="#2b1f5e"/></linearGradient>
        <linearGradient [attr.id]="id + 'g'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff1bf"/><stop offset=".5" stop-color="#f2c45a"/><stop offset="1" stop-color="#a8741f"/></linearGradient></defs>
        <g transform="translate(0 76)">
          <rect x="8" y="4" width="204" height="112" rx="10" [attr.fill]="url('w')" [attr.stroke]="url('g')" stroke-width="5"/>
          <rect x="34" y="4" width="16" height="112" [attr.fill]="url('g')"/><rect x="170" y="4" width="16" height="112" [attr.fill]="url('g')"/>
          <rect x="90" y="10" width="40" height="44" rx="7" [attr.fill]="url('g')"/><circle cx="110" cy="28" r="6" fill="#2a1d55"/><rect x="107" y="30" width="6" height="14" rx="2" fill="#2a1d55"/>
          <path d="M14 98 H206" stroke="#f6d78d" stroke-opacity=".25" stroke-width="2"/>
        </g>
        <g>
          <path d="M8 82 V40 Q8 4 110 4 Q212 4 212 40 V82 Z" [attr.fill]="url('l')" [attr.stroke]="url('g')" stroke-width="5"/>
          <path d="M34 82 V14 Q40 9 50 8 V82 Z" [attr.fill]="url('g')"/><path d="M186 82 V14 Q180 9 170 8 V82 Z" [attr.fill]="url('g')"/>
          <rect x="96" y="58" width="28" height="24" rx="5" [attr.fill]="url('g')"/>
          <path d="M30 30 Q110 10 190 30" stroke="#f6d78d" stroke-opacity=".35" stroke-width="3" fill="none"/>
        </g></svg></ng-template>
  `,
  imports: [NgTemplateOutlet],
  styles: [`
    :host { display:contents; }
    .promo { direction:rtl; }
    .icon svg, .chest svg { width:100%; height:auto; display:block; overflow:visible; }

    /* the home page section */
    .section { position:relative; overflow:hidden; display:grid; grid-template-columns:minmax(0, 4fr) minmax(0, 7fr); align-items:center;
      gap:clamp(1rem, 3vw, 2.5rem); margin-block:.5rem 2.5rem; padding:clamp(1.2rem, 3vw, 2.2rem) clamp(1rem, 3vw, 2.6rem);
      border-radius:22px; border:1px solid rgba(240,200,110,.55);
      background: radial-gradient(26rem 16rem at 78% 50%, rgba(242,196,90,.20), transparent 65%),
                  radial-gradient(30rem 20rem at 10% 0%, rgba(106,80,200,.22), transparent 60%),
                  linear-gradient(90deg, #0b1435, #151040 55%, #0b1435);
      box-shadow: 0 0 0 3px rgba(240,200,110,.06), 0 0 24px rgba(240,200,110,.16), 0 14px 34px rgba(0,0,0,.4); }
    .art { position:relative; width:min(100%, 300px); margin-inline:auto; aspect-ratio:1; display:grid; place-items:center; }
    .halo { position:absolute; inset:6%; border-radius:50%;
      background: radial-gradient(circle, rgba(255,226,150,.55) 0%, rgba(242,196,90,.22) 38%, transparent 68%);
      animation: breathe 3.2s ease-in-out infinite; }
    .chest { position:relative; width:78%; filter: drop-shadow(0 14px 18px rgba(0,0,0,.55)) drop-shadow(0 0 14px rgba(242,196,90,.35));
      animation: bob 3.2s ease-in-out infinite; }
    .spark { position:absolute; width:6px; height:6px; border-radius:50%; background:#fff3cf;
      box-shadow: 0 0 8px 2px rgba(255,214,120,.8); opacity:0; animation: twinkle 2.6s ease-in-out infinite; }
    .text { display:flex; flex-direction:column; align-items:flex-start; gap:.25rem; }
    .section .title { margin:0 0 .25em; font-family:var(--font-title); font-weight:900; font-size:clamp(1.8rem, 3.4vw, 2.7rem); line-height:1.15;
      background:linear-gradient(180deg, #fff1c4 0%, #f6d78d 40%, #e0b95c 75%, #b98a34 100%); -webkit-background-clip:text; background-clip:text; color:transparent; }
    .section .line { margin:0 0 1rem; color:#fff6e0; font-weight:700; font-size:clamp(1.15rem, 1.8vw, 1.45rem); line-height:1.5; }
    .section .fine { margin:0; color:#c9c3d9; font-size:.92rem; }
    @media (max-width: 760px) {
      .section { grid-template-columns:1fr; text-align:center; }
      .art { width:min(70%, 230px); }
      .text { align-items:center; }
    }

    /* the mark on a game card */
    .badge { display:flex; align-items:center; gap:.55rem; margin:0; padding:.4rem .65rem; border-radius:12px;
      border:1px solid rgba(240,200,110,.4); background:linear-gradient(90deg, rgba(242,196,90,.12), rgba(90,63,158,.18)); }
    .badge .icon { flex:0 0 auto; width:34px; filter: drop-shadow(0 0 6px rgba(242,196,90,.45)); }
    .badge .words { display:flex; flex-direction:column; line-height:1.3; min-width:0; }
    .badge b { color:#f6d78d; font-size:.9rem; font-weight:700; }
    .badge small { color:#b9b3c9; font-size:.74rem; }

    /* the box next to the price on a game's page */
    .compact { display:flex; align-items:center; gap:.8rem; padding:.75rem .85rem; border-radius:14px;
      border:1px solid rgba(240,200,110,.55);
      background: radial-gradient(14rem 7rem at 85% 50%, rgba(242,196,90,.18), transparent 70%), linear-gradient(90deg, #0f1840, #171045);
      box-shadow: 0 0 18px rgba(240,200,110,.14); }
    .compact .icon { flex:0 0 auto; width:56px; filter: drop-shadow(0 0 8px rgba(242,196,90,.5)); animation: bob 3.2s ease-in-out infinite; }
    .compact .words { display:flex; flex-direction:column; gap:.1rem; line-height:1.35; min-width:0; }
    .compact .title { color:#f6d78d; font-family:var(--font-title); font-size:1.08rem; }
    .compact .line { color:#fff6e0; font-weight:700; font-size:.98rem; }
    .compact .fine { color:#b9b3c9; font-size:.78rem; }

    @keyframes bob { 0%, 100% { transform:translateY(0); } 50% { transform:translateY(-6px); } }
    @keyframes breathe { 0%, 100% { opacity:.75; transform:scale(.96); } 50% { opacity:1; transform:scale(1.04); } }
    @keyframes twinkle { 0%, 100% { opacity:0; transform:scale(.4); } 50% { opacity:1; transform:scale(1); } }
    @media (prefers-reduced-motion: reduce) { .halo, .chest, .spark, .compact .icon { animation:none; } .spark { opacity:.7; } }
  `],
})
export class TreasurePromoComponent {
  private site = inject(SiteService);
  /** section: the home page · badge: a game card · compact: next to the price on a game's page. */
  variant = input<'section' | 'badge' | 'compact'>('compact');
  readonly T = TREASURE_PROMO;
  /** The admin's on/off switch, as the server reports it (off until the site details have arrived). */
  on = computed(() => this.site.info().treasureChest === true);
  /** Each instance has its own gradient ids (several marks share a page). */
  readonly id = `tp${++uid}-`;
  url = (k: string) => `url(#${this.id}${k})`;
  /** Fixed places around the chest (no randomness). */
  readonly sparks = [[14, 22, 0], [82, 18, 0.6], [90, 58, 1.2], [8, 64, 1.8], [50, 6, 0.9], [70, 86, 2.1], [26, 88, 1.5]]
    .map(([x, y, d]) => ({ left: x + '%', top: y + '%', 'animation-delay': d + 's' }));

  constructor() { this.site.load(); }
}
