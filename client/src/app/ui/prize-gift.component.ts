import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The prize of the "friend brings a friend" draw: an open navy gift box with gold ribbons, a prize card (the amount, in cash) rising out of
 * it, light rays and a few sparks. Drawn in SVG (sharp at any size, no image to load); the light breathes gently, and
 * stands still with reduced motion. Decorative: the amount is also written in the text beside it.
 */
@Component({
  selector: 'px-prize-gift',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 360 300" role="img" [attr.aria-label]="'פרס של ' + amount() + ' במזומן'" focusable="false">
      <defs>
        <radialGradient id="pg-glow" cx="50%" cy="58%" r="50%">
          <stop offset="0" stop-color="#ffe7a3" stop-opacity=".95" />
          <stop offset=".35" stop-color="#f4b84a" stop-opacity=".45" />
          <stop offset="1" stop-color="#f4b84a" stop-opacity="0" />
        </radialGradient>
        <linearGradient id="pg-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fff1bf" />
          <stop offset=".45" stop-color="#f2c45a" />
          <stop offset="1" stop-color="#b9822a" />
        </linearGradient>
        <linearGradient id="pg-gold-h" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#b9822a" />
          <stop offset=".5" stop-color="#ffe9a8" />
          <stop offset="1" stop-color="#b9822a" />
        </linearGradient>
        <linearGradient id="pg-navy" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#22336a" />
          <stop offset="1" stop-color="#0c1430" />
        </linearGradient>
        <linearGradient id="pg-side" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#0e1838" />
          <stop offset="1" stop-color="#1a2856" />
        </linearGradient>
        <linearGradient id="pg-ray" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stop-color="#ffd77a" stop-opacity=".55" />
          <stop offset="1" stop-color="#ffd77a" stop-opacity="0" />
        </linearGradient>
      </defs>

      <!-- light behind the box -->
      <ellipse class="glow" cx="180" cy="170" rx="175" ry="140" fill="url(#pg-glow)" />
      <g class="rays" fill="url(#pg-ray)">
        <path d="M180 175 L120 0 L150 0 Z" /><path d="M180 175 L205 0 L240 0 Z" /><path d="M180 175 L270 10 L300 30 Z" />
        <path d="M180 175 L60 30 L85 15 Z" /><path d="M180 175 L330 80 L340 110 Z" /><path d="M180 175 L20 95 L30 70 Z" />
      </g>

      <!-- golden swirls around the base -->
      <ellipse cx="182" cy="262" rx="150" ry="26" fill="none" stroke="url(#pg-gold-h)" stroke-width="2.5" opacity=".75" />
      <ellipse cx="182" cy="266" rx="122" ry="18" fill="none" stroke="#ffd77a" stroke-width="1.2" opacity=".5" />

      <!-- the lid, open behind on the left, with its bow -->
      <g transform="rotate(-24 120 120)">
        <rect x="52" y="98" width="150" height="34" rx="5" fill="url(#pg-navy)" stroke="#e7b552" stroke-width="2" />
        <rect x="116" y="98" width="22" height="34" fill="url(#pg-gold)" />
        <path d="M127 98 C 95 60, 62 70, 82 96 Z" fill="url(#pg-gold)" stroke="#a8741f" stroke-width="1.5" />
        <path d="M127 98 C 150 52, 190 66, 168 96 Z" fill="url(#pg-gold)" stroke="#a8741f" stroke-width="1.5" />
        <path d="M120 98 C 108 120, 98 128, 86 140 M134 98 C 146 120, 158 128, 170 138" stroke="url(#pg-gold)" stroke-width="7" fill="none" stroke-linecap="round" />
        <circle cx="127" cy="97" r="8" fill="url(#pg-gold)" stroke="#a8741f" stroke-width="1.5" />
      </g>

      <!-- inside of the box (its light) -->
      <path d="M92 182 L250 182 L282 168 L124 168 Z" fill="#ffdf8a" opacity=".9" />

      <!-- the voucher rising out of the box -->
      <g class="voucher" transform="rotate(-11 190 130)">
        <path d="M112 72 h156 a6 6 0 0 1 6 6 v22 a9 9 0 0 0 0 18 v22 a6 6 0 0 1 -6 6 h-156 a6 6 0 0 1 -6 -6 v-22 a9 9 0 0 0 0 -18 v-22 a6 6 0 0 1 6 -6 Z"
          fill="#0e1736" stroke="url(#pg-gold-h)" stroke-width="3" />
        <path d="M118 80 h144 v58 h-144 Z" fill="none" stroke="#e7b552" stroke-width="1" stroke-dasharray="3 3" opacity=".6" />
        <text x="190" y="112" text-anchor="middle" direction="rtl" class="amount" fill="url(#pg-gold)">{{ amount() }}</text>
        <text x="190" y="132" text-anchor="middle" direction="rtl" class="label" fill="#f6dfa0">במזומן!</text>
        <!-- laurel sprigs -->
        <g stroke="#e7b552" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".9">
          <path d="M128 132 C 124 116, 126 100, 134 88" /><path d="M252 132 C 256 116, 254 100, 246 88" />
        </g>
        <g fill="#e7b552" opacity=".9">
          <ellipse cx="126" cy="122" rx="2.6" ry="5" transform="rotate(-30 126 122)" /><ellipse cx="126" cy="108" rx="2.6" ry="5" transform="rotate(-15 126 108)" />
          <ellipse cx="130" cy="95" rx="2.6" ry="5" transform="rotate(10 130 95)" />
          <ellipse cx="254" cy="122" rx="2.6" ry="5" transform="rotate(30 254 122)" /><ellipse cx="254" cy="108" rx="2.6" ry="5" transform="rotate(15 254 108)" />
          <ellipse cx="250" cy="95" rx="2.6" ry="5" transform="rotate(-10 250 95)" />
        </g>
      </g>

      <!-- the box: front and side, with gold ribbons -->
      <path d="M250 182 L282 168 L282 262 L250 280 Z" fill="url(#pg-side)" stroke="#e7b552" stroke-width="1.5" />
      <rect x="92" y="182" width="158" height="98" rx="3" fill="url(#pg-navy)" stroke="#e7b552" stroke-width="2" />
      <rect x="159" y="182" width="24" height="98" fill="url(#pg-gold)" />
      <path d="M262 177 L270 173 L270 268 L262 272 Z" fill="url(#pg-gold)" />
      <rect x="92" y="182" width="158" height="9" fill="url(#pg-gold-h)" opacity=".85" />

      <!-- sparks -->
      <g class="sparks" fill="#fff3c4">
        <circle cx="70" cy="70" r="2.2" /><circle cx="300" cy="58" r="2.6" /><circle cx="318" cy="150" r="1.8" /><circle cx="44" cy="160" r="2" />
        <circle cx="236" cy="30" r="1.6" /><circle cx="150" cy="28" r="1.4" /><circle cx="292" cy="220" r="1.6" /><circle cx="60" cy="226" r="1.8" />
        <path d="M262 92 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3 Z" /><path d="M96 46 l2 6 6 2 -6 2 -2 6 -2 -6 -6 -2 6 -2 Z" />
      </g>
    </svg>
  `,
  styles: [`
    :host { display:block; }
    svg { display:block; width:100%; height:auto; overflow:visible; filter: drop-shadow(0 18px 28px rgba(0,0,0,.45)); }
    .amount { font: 900 40px var(--font-title); letter-spacing:.5px; }
    .label { font: 700 15px 'Heebo', sans-serif; }
    @media (prefers-reduced-motion: no-preference) {
      .glow { animation: pg-breathe 4.5s ease-in-out infinite; transform-origin: 180px 170px; }
      .rays { animation: pg-rays 6s ease-in-out infinite; }
      .sparks { animation: pg-twinkle 3.2s ease-in-out infinite; }
    }
    @keyframes pg-breathe { 0%,100% { opacity:.85; transform: scale(1) } 50% { opacity:1; transform: scale(1.04) } }
    @keyframes pg-rays { 0%,100% { opacity:.65 } 50% { opacity:1 } }
    @keyframes pg-twinkle { 0%,100% { opacity:.55 } 50% { opacity:1 } }
  `],
})
export class PrizeGiftComponent {
  /** The prize as the campaign states it (e.g. "888 ₪"). */
  amount = input('888 ₪');
}
