import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type StepArtKind = 'books' | 'coins' | 'scroll' | 'chest';

/**
 * The pictures of "how it works", drawn in SVG in the site's navy-and-gold style (sharp at any size, nothing to load):
 * a stack of old books, gold coins, a parchment with a game code and a gold key, and an open treasure chest full of light.
 * Decorative: each card says the same thing in words.
 */
@Component({
  selector: 'px-step-art',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 200 140" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient [attr.id]="id('glow')" cx="50%" cy="62%" r="55%">
          <stop offset="0" stop-color="#ffd884" stop-opacity=".55" /><stop offset="1" stop-color="#ffd884" stop-opacity="0" />
        </radialGradient>
        <linearGradient [attr.id]="id('gold')" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fff1bf" /><stop offset=".5" stop-color="#f0c158" /><stop offset="1" stop-color="#a8721f" />
        </linearGradient>
        <linearGradient [attr.id]="id('goldh')" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#a8721f" /><stop offset=".5" stop-color="#ffe7a2" /><stop offset="1" stop-color="#a8721f" />
        </linearGradient>
        <linearGradient [attr.id]="id('wood')" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#8a5326" /><stop offset="1" stop-color="#4a2a12" />
        </linearGradient>
        <linearGradient [attr.id]="id('paper')" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#f7e7c0" /><stop offset="1" stop-color="#d9bb83" />
        </linearGradient>
      </defs>
      <ellipse cx="100" cy="86" rx="92" ry="58" [attr.fill]="url('glow')" />
      <ellipse cx="100" cy="128" rx="70" ry="7" fill="#000" opacity=".35" />

      @switch (kind()) {
        @case ('books') {
          <!-- three old books, the top one a little turned -->
          <g>
            <rect x="34" y="96" width="132" height="26" rx="4" fill="#5a2a1c" stroke="#2c140c" stroke-width="1.5" />
            <rect x="38" y="99" width="124" height="5" fill="#ead7ab" opacity=".85" />
            <rect x="34" y="96" width="14" height="26" fill="#3d1c12" />
            <path d="M54 96v26M150 96v26" [attr.stroke]="url('goldh')" stroke-width="3" />
            <rect x="42" y="72" width="118" height="25" rx="4" fill="#1f3366" stroke="#0f1a38" stroke-width="1.5" />
            <rect x="46" y="75" width="110" height="5" fill="#ead7ab" opacity=".85" />
            <path d="M60 72v25M142 72v25" [attr.stroke]="url('goldh')" stroke-width="3" />
            <circle cx="101" cy="86" r="5" [attr.fill]="url('gold')" />
            <g transform="rotate(-7 100 60)">
              <rect x="40" y="46" width="118" height="26" rx="4" fill="#6b3a1a" stroke="#341a0a" stroke-width="1.5" />
              <rect x="44" y="49" width="110" height="5" fill="#ead7ab" opacity=".85" />
              <rect x="40" y="46" width="13" height="26" fill="#4a2810" />
              <path d="M62 46v26M138 46v26" [attr.stroke]="url('goldh')" stroke-width="3" />
              <path d="M92 52h18l-4 6 4 6H92l4-6Z" [attr.fill]="url('gold')" />
            </g>
          </g>
        }
        @case ('coins') {
          <!-- a pile of gold coins -->
          <g [attr.stroke]="'#7a5214'" stroke-width="1.2">
            @for (c of coinPile; track $index) {
              <ellipse [attr.cx]="c[0]" [attr.cy]="c[1] + 4" rx="20" ry="7" fill="#9a6a1c" />
              <ellipse [attr.cx]="c[0]" [attr.cy]="c[1]" rx="20" ry="7" [attr.fill]="url('gold')" />
            }
            <g transform="rotate(-14 112 62)">
              <circle cx="112" cy="62" r="30" fill="#a8721f" />
              <circle cx="112" cy="60" r="30" [attr.fill]="url('gold')" />
              <circle cx="112" cy="60" r="23" fill="none" stroke="#8a5d18" stroke-width="2" />
              <path d="M112 44l4.6 9.4 10.4 1.5-7.5 7.3 1.8 10.3-9.3-4.9-9.3 4.9 1.8-10.3-7.5-7.3 10.4-1.5Z" fill="#c48b2c" stroke="#8a5d18" stroke-width="1" />
            </g>
            <g transform="rotate(18 66 74)">
              <circle cx="66" cy="76" r="20" fill="#a8721f" />
              <circle cx="66" cy="74" r="20" [attr.fill]="url('gold')" />
              <circle cx="66" cy="74" r="14" fill="none" stroke="#8a5d18" stroke-width="1.6" />
            </g>
          </g>
          <g fill="#fff6d0"><circle cx="146" cy="36" r="2" /><path d="M84 30l2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" /></g>
        }
        @case ('scroll') {
          <!-- a parchment with the game's code, and a gold key -->
          <rect x="44" y="36" width="112" height="70" rx="3" [attr.fill]="url('paper')" stroke="#a07a40" stroke-width="1.2" />
          <rect x="34" y="28" width="16" height="86" rx="8" [attr.fill]="url('wood')" />
          <rect x="150" y="28" width="16" height="86" rx="8" [attr.fill]="url('wood')" />
          <rect x="36" y="24" width="12" height="8" rx="3" [attr.fill]="url('gold')" /><rect x="36" y="110" width="12" height="8" rx="3" [attr.fill]="url('gold')" />
          <rect x="152" y="24" width="12" height="8" rx="3" [attr.fill]="url('gold')" /><rect x="152" y="110" width="12" height="8" rx="3" [attr.fill]="url('gold')" />
          <g font-family="Frank Ruhl Libre, serif" font-weight="900" font-size="22" fill="#3a2410" text-anchor="middle">
            @for (d of code; track $index) {
              <rect [attr.x]="58 + $index * 22" y="56" width="18" height="26" rx="3" fill="#efdcae" stroke="#8a6630" stroke-width="1" />
              <text [attr.x]="67 + $index * 22" y="76">{{ d }}</text>
            }
          </g>
          <g transform="rotate(-28 150 104)">
            <circle cx="132" cy="104" r="10" fill="none" [attr.stroke]="url('gold')" stroke-width="5" />
            <rect x="141" y="101.5" width="40" height="5" rx="2" [attr.fill]="url('gold')" />
            <rect x="168" y="106" width="5" height="8" [attr.fill]="url('gold')" /><rect x="176" y="106" width="5" height="6" [attr.fill]="url('gold')" />
          </g>
        }
        @case ('chest') {
          <!-- an open treasure chest with light rising out of it -->
          <g fill="#ffdc85" opacity=".55">
            <path d="M100 74 L70 8 L84 6 Z" /><path d="M100 74 L106 2 L122 4 Z" /><path d="M100 74 L140 14 L152 22 Z" /><path d="M100 74 L52 24 L62 16 Z" />
          </g>
          <!-- the open lid -->
          <path d="M48 66 Q 50 30 100 28 Q 150 30 152 66 L146 70 Q 144 40 100 38 Q 56 40 54 70 Z" [attr.fill]="url('wood')" stroke="#2c180a" stroke-width="1.2" />
          <path d="M48 66 Q 50 30 100 28 Q 150 30 152 66" fill="none" [attr.stroke]="url('goldh')" stroke-width="4" />
          <!-- treasure -->
          <ellipse cx="100" cy="72" rx="50" ry="10" fill="#ffd36a" />
          <g [attr.fill]="url('gold')" stroke="#8a5d18" stroke-width=".8">
            <circle cx="78" cy="68" r="7" /><circle cx="92" cy="64" r="7" /><circle cx="110" cy="65" r="7" /><circle cx="124" cy="69" r="7" /><circle cx="100" cy="70" r="7" />
          </g>
          <path d="M84 60l6-8 6 8-6 6Z" fill="#7fd0ff" stroke="#2b6aa0" stroke-width="1" />
          <path d="M114 58l5-7 5 7-5 5Z" fill="#ff7a9a" stroke="#a03050" stroke-width="1" />
          <!-- the box -->
          <rect x="46" y="74" width="108" height="48" rx="4" [attr.fill]="url('wood')" stroke="#2c180a" stroke-width="1.2" />
          <path d="M46 84h108M46 112h108" [attr.stroke]="url('goldh')" stroke-width="4" />
          <path d="M60 74v48M140 74v48" [attr.stroke]="url('goldh')" stroke-width="4" />
          <rect x="91" y="84" width="18" height="20" rx="3" [attr.fill]="url('gold')" stroke="#8a5d18" stroke-width="1" />
          <circle cx="100" cy="92" r="3" fill="#4a2a12" /><rect x="99" y="93" width="2" height="6" fill="#4a2a12" />
          <g fill="#fff6d0"><circle cx="44" cy="50" r="1.8" /><circle cx="160" cy="44" r="2.2" /><path d="M158 82l2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" /></g>
        }
      }
    </svg>
  `,
  styles: [`
    :host { display:block; }
    svg { display:block; width:100%; height:auto; overflow:visible; filter: drop-shadow(0 10px 14px rgba(0,0,0,.45)); }
  `],
})
export class StepArtComponent {
  kind = input.required<StepArtKind>();
  readonly code = ['7', '2', '4', '9'];
  readonly coinPile: [number, number][] = [[62, 116], [100, 120], [138, 116], [80, 108], [120, 108], [100, 100]];
  private static seq = 0;
  /** Gradient ids are unique per picture, so several pictures on one page never share (or break) each other's paint. */
  private readonly uid = `sa${++StepArtComponent.seq}`;
  id(name: string) { return `${this.uid}-${name}`; }
  url(name: string) { return `url(#${this.uid}-${name})`; }
}
