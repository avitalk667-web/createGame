import { ChangeDetectionStrategy, Component, HostListener, input, output } from '@angular/core';
import { DEMO_INSPECT, DemoInspect, LETTER_FADED_NOTE } from './demo-content';

/** The close-up of one object of the locked room: a drawing of it, what it shows, and a way back to the room. */
@Component({
  selector: 'px-demo-inspect',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let v = view();
    <div class="overlay" (click)="closed.emit()">
      <section class="panel-modal inspect" role="dialog" aria-modal="true" [attr.aria-label]="v.title" (click)="$event.stopPropagation()">
        <header>
          <h2 class="gold-title">{{ v.title }}</h2>
          <button class="btn small ghost" (click)="closed.emit()" aria-label="סגירה וחזרה לחדר">✕</button>
        </header>
        <div class="art" aria-hidden="true">
          @switch (v.art) {
            @case ('compass') {
              <svg viewBox="0 0 200 200">
                <circle cx="100" cy="100" r="92" fill="#b8913f" /><circle cx="100" cy="100" r="80" fill="#efe2c0" stroke="#6a4a20" stroke-width="2" />
                @for (a of ticks; track a) { <line x1="100" y1="26" x2="100" [attr.y2]="a % 90 === 0 ? 40 : 33" stroke="#6a4a20" stroke-width="2" [attr.transform]="'rotate(' + a + ' 100 100)'" /> }
                <text x="100" y="54" text-anchor="middle" class="t" font-size="18">N</text>
                <text x="138" y="147" text-anchor="middle" class="t engr" font-size="26">2</text>
                <g transform="rotate(135 100 100)">
                  <polygon points="100,57 108,100 92,100" fill="#b8261f" /><polygon points="100,132 107,100 93,100" fill="#3a3a44" />
                </g>
                <circle cx="100" cy="100" r="6" fill="#8a6a2a" />
              </svg>
            }
            @case ('clock') {
              <svg viewBox="0 0 200 200">
                <circle cx="100" cy="100" r="92" fill="#4a2c18" /><circle cx="100" cy="100" r="80" fill="#efe6d0" stroke="#b8913f" stroke-width="5" />
                @for (r of roman; track $index) {
                  <text [attr.x]="100 + sin($index) * 62" [attr.y]="106 - cos($index) * 62" text-anchor="middle" class="t" font-size="14">{{ r }}</text>
                }
                <line x1="100" y1="100" [attr.x2]="100 + sin(7) * 40" [attr.y2]="100 - cos(7) * 40" stroke="#1a1208" stroke-width="7" stroke-linecap="round" />
                <line x1="100" y1="100" x2="100" y2="40" stroke="#1a1208" stroke-width="4" stroke-linecap="round" />
                <circle cx="100" cy="100" r="6" fill="#8a6a2a" />
              </svg>
            }
            @case ('key') {
              <svg viewBox="0 0 240 140">
                <circle cx="62" cy="70" r="40" fill="#d6b25e" stroke="#a8823a" stroke-width="4" />
                <circle cx="62" cy="70" r="29" fill="#c9a24e" stroke="#9a7430" stroke-width="2" />
                <rect x="94" y="62" width="120" height="16" rx="6" fill="#d6b25e" />
                <rect x="178" y="78" width="12" height="28" fill="#d6b25e" /><rect x="198" y="78" width="12" height="18" fill="#d6b25e" />
                <!-- a worn engraving: gold on gold, only a faint edge of light shows it -->
                <g transform="rotate(-16 62 70)">
                  <text x="62.8" y="79.8" text-anchor="middle" class="t worn-lit" font-size="25">4</text>
                  <text x="62" y="79" text-anchor="middle" class="t worn" font-size="25">4</text>
                </g>
                <path d="M44 58 l9 5 M70 88 l11 -4 M47 84 l5 -9 M74 54 l6 7 M56 92 l12 1" stroke="#a8823a" stroke-width="1.2" stroke-linecap="round" opacity=".8" />
              </svg>
            }
            @case ('letter') {
              <div class="paper">
                @for (l of v.lines; track $index) { <p>{{ l }}</p> }
                <p class="faded" aria-hidden="true">ושׁ ממ ררח ננ לל ששט… <b class="digit">1</b> …ממ עע חח</p>
              </div>
            }
          }
        </div>
        @if (v.art === 'letter') {
          <p class="note">{{ fadedNote }}</p>
        } @else {
          @for (l of v.lines; track $index) { <p class="line">{{ l }}</p> }
        }
        <button class="btn primary back" (click)="closed.emit()">חזרה לחקירה</button>
      </section>
    </div>
  `,
  styles: [`
    .inspect { max-width: 460px; width: calc(100vw - 32px); max-height: calc(100dvh - 32px); overflow:auto; text-align:center; }
    header { display:flex; justify-content:space-between; align-items:center; gap:.5rem; }
    h2 { margin:0; font-size:1.5rem; }
    .art { margin: .8rem auto; display:grid; place-items:center; }
    .art svg { width: min(220px, 60vw); height:auto; filter: drop-shadow(0 8px 24px rgba(0,0,0,.6)); }
    .t { font-family: var(--font-title); fill:#2a1a0a; font-weight:700; }
    .engr { fill:#5a3a10; }
    .worn { fill:#a8823a; opacity:.75; }
    .worn-lit { fill:#f0d488; opacity:.45; }
    .paper { background: linear-gradient(160deg, #efe0bc, #d9c091); color:#2a1a0a; border-radius:6px; padding:1.1rem 1.3rem; font-family: var(--font-title);
      font-size:1.12rem; line-height:1.55; box-shadow: inset 0 0 40px rgba(90,50,10,.35), 0 10px 30px rgba(0,0,0,.5); text-align:right; width:100%; }
    .paper p { margin:.1rem 0; }
    .faded { margin-top:.9rem !important; color: rgba(60,35,12,.22); letter-spacing:.06em; }
    .digit { color:#1a0e04; font-size:1.5rem; text-shadow: 0 0 1px #000; }
    .line, .note { margin:.35rem 0; font-size:1.08rem; }
    .note { color: var(--gold-2); }
    .back { margin-top:.8rem; width:100%; }
  `],
})
export class DemoInspectComponent {
  item = input.required<keyof typeof DEMO_INSPECT>();
  closed = output<void>();
  readonly fadedNote = LETTER_FADED_NOTE;
  readonly ticks = Array.from({ length: 16 }, (_, i) => i * 22.5);
  readonly roman = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];

  view(): DemoInspect {
    return DEMO_INSPECT[this.item()];
  }
  sin(h: number) {
    return Math.sin((h / 12) * Math.PI * 2);
  }
  cos(h: number) {
    return Math.cos((h / 12) * Math.PI * 2);
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    this.closed.emit();
  }
}
