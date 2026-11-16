import { ChangeDetectionStrategy, Component } from '@angular/core';

/** A fixed pseudo-random number in [0, 1) for item i (the same on every render, so nothing jumps). */
function seeded(i: number, n: number) {
  const x = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Motes of light rising through the opening: gold, and every third one blue. Negative delays start them mid-flight. */
const MOTES = Array.from({ length: 22 }, (_, i) => ({
  blue: i % 3 === 0,
  style:
    `left:${(3 + seeded(i, 1) * 94).toFixed(1)}%;--s:${(2 + seeded(i, 2) * 3.5).toFixed(1)}px;` +
    `--t:${(11 + seeded(i, 3) * 9).toFixed(1)}s;--d:${(-seeded(i, 4) * 20).toFixed(1)}s;--dx:${((seeded(i, 5) - 0.5) * 90).toFixed(0)}px`,
}));

/** Small four-pointed stars that twinkle around the title. */
const STARS = Array.from({ length: 14 }, (_, i) => ({
  style:
    `left:${(8 + seeded(i, 6) * 84).toFixed(1)}%;top:${(6 + seeded(i, 7) * 62).toFixed(1)}%;` +
    `--s:${(7 + seeded(i, 8) * 12).toFixed(0)}px;--d:${(seeded(i, 9) * 6).toFixed(1)}s;--t:${(3 + seeded(i, 10) * 3).toFixed(1)}s`,
}));

/**
 * The scenery of the taste's opening screen: an old stone gate with pillars, lanterns, PORTAL X banners, a few objects
 * on the ledge, and the magic of the opening (a slow swirl, rays, rising motes, twinkling stars). Pure decoration, drawn
 * with CSS and inline SVG (no image files), hidden from screen readers, and still when the visitor prefers less motion.
 * Every moving part animates only transform and opacity, so a weak computer keeps up.
 */
@Component({
  selector: 'px-demo-gate-scene',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
  template: `
    <div class="opening">
      <div class="rays"></div>
      <div class="swirl"></div>
      <div class="swirl s2"></div>
      <div class="core"></div>
      @for (m of motes; track $index) { <i class="mote" [class.blue]="m.blue" [attr.style]="m.style"></i> }
      @for (s of stars; track $index) { <b class="star" [attr.style]="s.style"></b> }
    </div>

    <div class="arch">
      <i class="aw l"></i><i class="aw r"></i><i class="aw t"></i>
      <div class="ring-box"><i class="ring-wall"></i><i class="ring"></i></div>
    </div>
    <div class="pillar left"><span class="capital"></span></div>
    <div class="pillar right"><span class="capital"></span></div>

    <!-- banners on the outer wall (wide screens only) -->
    @for (side of sides; track side) {
      <svg class="banner" [class.right]="side === 'right'" viewBox="0 0 100 270" preserveAspectRatio="xMidYMin meet">
        <defs>
          <linearGradient [attr.id]="'bn-cloth-' + side" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#2c2a78" /><stop offset=".55" stop-color="#1c1a55" /><stop offset="1" stop-color="#3a1f66" />
          </linearGradient>
        </defs>
        <rect x="2" y="4" width="96" height="7" rx="3.5" fill="#b8892f" />
        <circle cx="4" cy="7.5" r="5" fill="#e6bf62" /><circle cx="96" cy="7.5" r="5" fill="#e6bf62" />
        <path d="M10 11 H90 V232 L50 266 L10 232 Z" [attr.fill]="'url(#bn-cloth-' + side + ')'" stroke="#d6aa4c" stroke-width="3" />
        <path d="M17 18 H83 V228 L50 256 L17 228 Z" fill="none" stroke="#d6aa4c" stroke-opacity=".55" stroke-width="1.2" />
        <!-- the compass star of PORTAL X -->
        <g transform="translate(50 108)" fill="#e9c46e">
          <path d="M0-46 L7-7 L46 0 L7 7 L0 46 L-7 7 L-46 0 L-7-7 Z" />
          <path d="M0-26 L4-4 L26 0 L4 4 L0 26 L-4 4 L-26 0 L-4-4 Z" transform="rotate(45)" fill="#b8892f" />
          <circle r="5" fill="#fff0c0" />
        </g>
        <text x="50" y="200" text-anchor="middle" font-family="serif" font-weight="700" font-size="22" fill="#e9c46e" letter-spacing="2">PX</text>
      </svg>
    }

    <!-- hanging lanterns and their warm, breathing light -->
    @for (side of sides; track side) {
      <div class="lamp" [class.right]="side === 'right'">
        <span class="lamp-glow"></span>
        <svg viewBox="0 0 80 150">
          <defs>
            <radialGradient [attr.id]="'lp-fire-' + side" cx=".5" cy=".6" r=".6">
              <stop offset="0" stop-color="#fff6cf" /><stop offset=".35" stop-color="#ffc864" /><stop offset="1" stop-color="#c0661c" />
            </radialGradient>
          </defs>
          <path d="M0 14 H40 V26" fill="none" stroke="#8a6524" stroke-width="5" stroke-linecap="round" />
          <circle cx="40" cy="30" r="5" fill="none" stroke="#c99a3e" stroke-width="3" />
          <path d="M22 50 L40 34 L58 50 Z" fill="#b8892f" stroke="#e6c06a" stroke-width="2" />
          <rect x="22" y="50" width="36" height="58" rx="3" [attr.fill]="'url(#lp-fire-' + side + ')'" class="lamp-fire" />
          <path d="M22 50 V108 M58 50 V108 M40 50 V108" stroke="#7a5518" stroke-width="3" />
          <rect x="18" y="106" width="44" height="7" rx="2" fill="#b8892f" stroke="#e6c06a" stroke-width="1.5" />
          <path d="M26 113 L40 128 L54 113 Z" fill="#8a6524" />
        </svg>
      </div>
    }

    <div class="ledge"></div>

    <!-- on the ledge, left: a stack of books, a glowing armillary globe and a sealed scroll -->
    <svg class="props left" viewBox="0 0 300 220">
      <defs>
        <radialGradient id="pr-globe" cx=".38" cy=".35" r=".7">
          <stop offset="0" stop-color="#9fd0ff" /><stop offset=".45" stop-color="#2f6be0" /><stop offset="1" stop-color="#0a1f63" />
        </radialGradient>
        <linearGradient id="pr-paper" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3e2b8" /><stop offset="1" stop-color="#c8a96c" /></linearGradient>
        <radialGradient id="pr-halo" r=".5"><stop offset="0" stop-color="#6fb0ff" stop-opacity=".55" /><stop offset="1" stop-color="#6fb0ff" stop-opacity="0" /></radialGradient>
      </defs>
      <ellipse cx="112" cy="84" rx="90" ry="80" fill="url(#pr-halo)" />
      <rect x="6" y="176" width="150" height="26" rx="5" fill="#5a1d2c" /><rect x="6" y="183" width="150" height="4" fill="#d1a24a" />
      <rect x="14" y="150" width="138" height="27" rx="5" fill="#3d2756" /><rect x="14" y="157" width="138" height="4" fill="#d1a24a" />
      <rect x="2" y="124" width="146" height="27" rx="5" fill="#6b2433" /><rect x="2" y="131" width="146" height="4" fill="#d1a24a" />
      <path d="M100 124 L104 108 H120 L124 124 Z" fill="#b8892f" />
      <rect x="109" y="96" width="6" height="14" fill="#d6aa4c" />
      <circle cx="112" cy="60" r="38" fill="url(#pr-globe)" />
      <path d="M92 44 q10-8 20-2 t14 10 q-6 8-16 4 t-18-12 Z M100 72 q8 2 12 10 q-8 6-14 0 Z" fill="#cfe6ff" fill-opacity=".55" />
      <ellipse cx="112" cy="60" rx="50" ry="17" fill="none" stroke="#e1b456" stroke-width="4" transform="rotate(-24 112 60)" />
      <ellipse cx="112" cy="60" rx="17" ry="50" fill="none" stroke="#c99a3e" stroke-width="3.5" transform="rotate(-24 112 60)" />
      <circle cx="112" cy="60" r="47" fill="none" stroke="#e1b456" stroke-width="3" />
      <g transform="rotate(-8 220 196)">
        <rect x="150" y="182" width="140" height="26" rx="13" fill="url(#pr-paper)" />
        <ellipse cx="150" cy="195" rx="9" ry="13" fill="#e8d3a2" /><ellipse cx="150" cy="195" rx="4" ry="7" fill="#b39058" />
        <circle cx="220" cy="198" r="14" fill="#a3202a" /><circle cx="220" cy="198" r="10" fill="#c63240" />
        <text x="220" y="202.5" text-anchor="middle" font-family="serif" font-weight="700" font-size="11" fill="#f3d58a">PX</text>
      </g>
    </svg>

    <!-- on the ledge, right: blue crystals, a burning lantern and a chest -->
    <svg class="props right" viewBox="0 0 300 220">
      <defs>
        <linearGradient id="pr-crystal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9f3ff" /><stop offset=".5" stop-color="#5cb8ff" /><stop offset="1" stop-color="#1d4fb8" /></linearGradient>
        <radialGradient id="pr-flame" cx=".5" cy=".55" r=".6"><stop offset="0" stop-color="#fff7d6" /><stop offset=".4" stop-color="#ffc45c" /><stop offset="1" stop-color="#b8561a" /></radialGradient>
        <radialGradient id="pr-warm" r=".5"><stop offset="0" stop-color="#ffb24a" stop-opacity=".6" /><stop offset="1" stop-color="#ffb24a" stop-opacity="0" /></radialGradient>
        <radialGradient id="pr-cold" r=".5"><stop offset="0" stop-color="#5cc2ff" stop-opacity=".5" /><stop offset="1" stop-color="#5cc2ff" stop-opacity="0" /></radialGradient>
        <linearGradient id="pr-wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6b3f22" /><stop offset="1" stop-color="#3b2010" /></linearGradient>
      </defs>
      <ellipse cx="60" cy="170" rx="70" ry="50" fill="url(#pr-cold)" />
      <circle class="warm" cx="150" cy="120" r="95" fill="url(#pr-warm)" />
      <path d="M190 120 h104 v84 h-104 Z" fill="url(#pr-wood)" />
      <path d="M186 92 q56-34 112 0 v30 h-112 Z" fill="#7a4a28" />
      <path d="M186 120 h112 M190 160 h104" stroke="#d1a24a" stroke-width="6" />
      <path d="M212 92 v112 M272 92 v112" stroke="#b8892f" stroke-width="7" />
      <rect x="233" y="128" width="18" height="22" rx="3" fill="#e1b456" />
      <path d="M30 206 L44 128 L60 206 Z M56 206 L70 150 L84 206 Z M16 206 L24 166 L36 206 Z" fill="url(#pr-crystal)" />
      <path d="M44 128 L48 206 M70 150 L72 206 M24 166 L28 206" stroke="#eafaff" stroke-opacity=".7" stroke-width="1.5" />
      <path d="M128 70 L150 52 L172 70 Z" fill="#b8892f" stroke="#e6c06a" stroke-width="2" />
      <circle cx="150" cy="46" r="6" fill="none" stroke="#c99a3e" stroke-width="3" />
      <rect x="128" y="70" width="44" height="90" rx="4" fill="url(#pr-flame)" class="lamp-fire" />
      <path d="M128 70 V160 M172 70 V160 M150 70 V160 M128 115 H172" stroke="#7a5518" stroke-width="3" />
      <rect x="122" y="158" width="56" height="10" rx="3" fill="#b8892f" stroke="#e6c06a" stroke-width="1.5" />
      <rect x="130" y="168" width="40" height="38" rx="3" fill="#8a6524" />
    </svg>
  `,
  styles: [`
    :host {
      --edge: clamp(0px, calc(50vw - 600px), 150px);
      --pw: clamp(22px, 8vw, 150px);
      --floor: clamp(56px, 12vh, 128px);
      --arch-h: clamp(110px, 25vh, 250px);
      --stone: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='112'%3E%3Crect width='120' height='112' fill='%23161a29'/%3E%3Crect x='2' y='2' width='116' height='52' rx='5' fill='%234a5068'/%3E%3Crect x='-59' y='58' width='116' height='52' rx='5' fill='%23434960'/%3E%3Crect x='61' y='58' width='116' height='52' rx='5' fill='%23515870'/%3E%3Cpath d='M7 4h106M-54 60h106M66 60h106' stroke='%23778099' stroke-opacity='.45' stroke-width='2'/%3E%3Cpath d='M7 53h106M-54 109h106M66 109h106' stroke='%23000' stroke-opacity='.35' stroke-width='3'/%3E%3Cg fill='%23000' fill-opacity='.13'%3E%3Ccircle cx='30' cy='20' r='6'/%3E%3Ccircle cx='88' cy='38' r='9'/%3E%3Ccircle cx='20' cy='86' r='7'/%3E%3Ccircle cx='95' cy='80' r='5'/%3E%3C/g%3E%3C/svg%3E");
      position:absolute; inset:0; display:block; overflow:hidden; pointer-events:none;
      /* the outer wall, deep in shadow */
      background: linear-gradient(rgba(5,8,22,.82), rgba(5,8,22,.9)), var(--stone);
    }

    /* the opening of the gate: the deep blue night where the magic happens */
    .opening { position:absolute; left: calc(var(--edge) + var(--pw)); right: calc(var(--edge) + var(--pw)); top:0; bottom: var(--floor); overflow:hidden;
      background: radial-gradient(ellipse 75% 65% at 50% 44%, #22408c 0%, #142a66 32%, #0a1640 62%, #050b24 100%); }
    .core { position:absolute; left:50%; top:44%; width:min(80vw, 760px); aspect-ratio: 1.7; transform: translate(-50%,-50%);
      background: radial-gradient(closest-side, rgba(140,190,255,.32), rgba(80,120,255,.12) 55%, transparent);
      animation: breathe 7s ease-in-out infinite; }
    @keyframes breathe { 50% { opacity:.6; transform: translate(-50%,-50%) scale(1.06); } }

    .rays { position:absolute; left:50%; top:44%; width:160vmax; aspect-ratio:1; transform: translate(-50%,-50%);
      background: repeating-conic-gradient(from 0deg, rgba(150,200,255,.11) 0deg 2.5deg, transparent 2.5deg 13deg);
      -webkit-mask: radial-gradient(circle, transparent 0 4%, #000 9%, rgba(0,0,0,.35) 22%, transparent 42%);
      mask: radial-gradient(circle, transparent 0 4%, #000 9%, rgba(0,0,0,.35) 22%, transparent 42%);
      animation: spin 140s linear infinite; }
    .swirl { position:absolute; left:50%; top:44%; width:min(78vw, 640px); aspect-ratio:1; transform: translate(-50%,-50%) scaleX(1.55);
      background: conic-gradient(from 0deg, transparent 0 8%, rgba(110,170,255,.6) 16%, transparent 27%, rgba(165,110,255,.42) 45%,
        transparent 57%, rgba(100,200,255,.5) 72%, transparent 84%, rgba(255,210,120,.26) 93%, transparent);
      -webkit-mask: radial-gradient(closest-side, transparent 58%, #000 70%, #000 78%, transparent 100%);
      mask: radial-gradient(closest-side, transparent 58%, #000 70%, #000 78%, transparent 100%);
      border-radius:50%; animation: swirl 46s linear infinite; }
    .swirl.s2 { width:min(64vw, 520px); opacity:.7; animation-duration: 31s; animation-direction: reverse; }
    @keyframes spin { to { transform: translate(-50%,-50%) rotate(360deg); } }
    @keyframes swirl { from { transform: translate(-50%,-50%) scaleX(1.55) rotate(0); } to { transform: translate(-50%,-50%) scaleX(1.55) rotate(360deg); } }

    .mote { position:absolute; bottom:-12px; width:var(--s); height:var(--s); border-radius:50%;
      background: radial-gradient(circle, #fff8dc 0 30%, rgba(255,205,110,.85) 45%, transparent 72%);
      animation: rise var(--t) linear var(--d) infinite; opacity:0; }
    .mote.blue { background: radial-gradient(circle, #f2fbff 0 30%, rgba(120,190,255,.85) 45%, transparent 72%); }
    @keyframes rise {
      0% { transform: translate3d(0,0,0); opacity:0; }
      12% { opacity:.95; }
      85% { opacity:.55; }
      100% { transform: translate3d(var(--dx), calc(-100vh - 20px), 0); opacity:0; }
    }
    .star { position:absolute; width:var(--s); height:var(--s); opacity:0;
      background: radial-gradient(circle, #fff 0 18%, #d6ebff 32%, rgba(180,215,255,.0) 70%);
      clip-path: polygon(50% 0, 58% 42%, 100% 50%, 58% 58%, 50% 100%, 42% 58%, 0 50%, 42% 42%);
      animation: twinkle var(--t) ease-in-out var(--d) infinite; }
    @keyframes twinkle { 0%, 100% { opacity:0; transform: scale(.3) rotate(0); } 50% { opacity:1; transform: scale(1) rotate(25deg); } }

    /* the stone arch: the wall above it, and the ring of wedge stones with a thin line of gold light inside */
    /* (gradient sizes stay pure percentages: a calc() size inside radial-gradient is dropped by some browsers. So the ring
       is its own box, sized so its inner edge (88% of the ellipse) meets the pillars and sits 50px under the top, and three
       strips of wall fill the rest. The stone is fixed to the screen, so its courses run on across the pieces.) */
    .arch { position:absolute; left: var(--edge); right: var(--edge); top:0; height: var(--arch-h); z-index:1;
      --open: calc(100% - 2 * var(--pw)); }
    .aw, .ring-wall { position:absolute; background: linear-gradient(180deg, rgba(4,7,20,.86), rgba(10,16,40,.5)), var(--stone);
      background-attachment: fixed; }
    .aw.l, .aw.r { top:0; bottom:0; width: calc((100% - var(--open) / .88) / 2 + 1px); }
    .aw.l { left:0; } .aw.r { right:0; }
    .aw.t { left:0; right:0; top:0; height: max(0px, calc(100% - (100% - 50px) / .88 + 1px)); }
    .ring-box { position:absolute; bottom:0; left:50%; width: calc(var(--open) / .88); height: calc((100% - 50px) / .88); transform: translateX(-50%); }
    .ring-wall, .ring { position:absolute; inset:0; }
    .ring-wall {
      -webkit-mask: radial-gradient(ellipse 50% 100% at 50% 100%, transparent 99.7%, #000 100%);
      mask: radial-gradient(ellipse 50% 100% at 50% 100%, transparent 99.7%, #000 100%); }
    .ring {
      background:
        radial-gradient(ellipse 50% 100% at 50% 100%, rgba(255,218,140,1) 88%, rgba(255,190,90,.4) 89.2%, transparent 90.6%),
        radial-gradient(ellipse 50% 100% at 50% 100%, rgba(120,170,255,.32) 88%, transparent 93%, rgba(0,0,0,.6) 100%),
        repeating-conic-gradient(from -90deg at 50% 100%, #5e6682 0deg 6.2deg, #11141e 6.2deg 6.75deg);
      -webkit-mask: radial-gradient(ellipse 50% 100% at 50% 100%, transparent 87.7%, #000 88%, #000 99.7%, transparent 100%);
      mask: radial-gradient(ellipse 50% 100% at 50% 100%, transparent 87.7%, #000 88%, #000 99.7%, transparent 100%);
      filter: drop-shadow(0 0 10px rgba(255,200,110,.25)); }

    .pillar { position:absolute; z-index:2; top: calc(var(--arch-h) - 14px); bottom: calc(var(--floor) - 4px); width: var(--pw);
      background:
        linear-gradient(90deg, rgba(0,0,0,.7), rgba(0,0,0,.08) 28%, rgba(0,0,0,.12) 70%, rgba(0,0,0,.72)),
        linear-gradient(180deg, rgba(6,10,26,.55), rgba(6,10,26,.1) 40%, rgba(6,10,26,.6)),
        var(--stone);
      box-shadow: 0 0 36px rgba(0,0,0,.7); }
    .pillar.left { left: var(--edge); } .pillar.right { right: var(--edge); }
    /* the lit inner face: blue from the portal, warm where the lantern hangs */
    .pillar::after { content:''; position:absolute; inset:0; }
    .pillar.left::after { background: linear-gradient(270deg, rgba(110,160,255,.28), transparent 45%), radial-gradient(70% 22% at 100% 30%, rgba(255,170,70,.4), transparent 70%); }
    .pillar.right::after { background: linear-gradient(90deg, rgba(110,160,255,.28), transparent 45%), radial-gradient(70% 22% at 0% 30%, rgba(255,170,70,.4), transparent 70%); }
    .capital { position:absolute; left:-8px; right:-8px; top:-6px; height:20px; border-radius:3px;
      background: linear-gradient(180deg, #7a82a0, #3f4560 60%, #262a3c); box-shadow: 0 6px 12px rgba(0,0,0,.55); }

    .banner { position:absolute; z-index:1; top:0; left: calc(var(--edge) * .12); width: calc(var(--edge) * .76); height: clamp(200px, 44vh, 400px);
      filter: drop-shadow(0 10px 14px rgba(0,0,0,.6)); }
    .banner.right { left:auto; right: calc(var(--edge) * .12); }

    .lamp { position:absolute; z-index:3; top: calc(var(--arch-h) + 6vh); left: calc(var(--edge) + var(--pw) - 6px); width: clamp(40px, 4.4vw, 70px); }
    .lamp.right { left:auto; right: calc(var(--edge) + var(--pw) - 6px); }
    .lamp.right svg { transform: scaleX(-1); }
    .lamp svg { position:relative; display:block; width:100%; height:auto; filter: drop-shadow(0 0 10px rgba(255,180,80,.6)); }
    .lamp-glow { position:absolute; left:50%; top:52%; width:520%; aspect-ratio:1; transform: translate(-50%,-50%);
      background: radial-gradient(closest-side, rgba(255,184,90,.42), rgba(255,140,50,.14) 45%, transparent); animation: flicker 3.8s infinite; }
    .lamp.right .lamp-glow { animation-delay: -1.7s; animation-duration: 4.4s; }
    @keyframes flicker {
      0%, 100% { opacity:.9; transform: translate(-50%,-50%) scale(1); }
      18% { opacity:.72; } 24% { opacity:.95; transform: translate(-50%,-50%) scale(1.04); }
      47% { opacity:.8; } 63% { opacity:1; transform: translate(-50%,-50%) scale(.97); } 80% { opacity:.76; }
    }
    .lamp-fire { animation: fire 2.6s ease-in-out infinite; }
    @keyframes fire { 0%, 100% { opacity:1; } 30% { opacity:.82; } 55% { opacity:.95; } 75% { opacity:.86; } }

    /* the stone ledge in front of the gate, catching the light of the portal */
    .ledge { position:absolute; z-index:2; left:0; right:0; bottom:0; height: var(--floor);
      background:
        radial-gradient(45% 70% at 50% 0, rgba(110,165,255,.4), transparent 70%),
        linear-gradient(180deg, rgba(190,215,255,.55) 0 2px, rgba(14,22,52,.55) 2px, rgba(5,8,20,.92) 85%),
        var(--stone);
      background-size: auto, auto, 160px 60px;
      box-shadow: 0 -8px 26px rgba(0,0,0,.5); }

    .props { position:absolute; z-index:3; bottom: calc(var(--floor) * .28); width: clamp(150px, 21vw, 320px); height:auto;
      filter: drop-shadow(0 12px 14px rgba(0,0,0,.6)); }
    .props.left { left: max(0px, calc(var(--edge) - 40px)); }
    .props.right { right: max(0px, calc(var(--edge) - 40px)); }
    .props .warm { animation: fire 3.4s ease-in-out infinite; }

    /* narrower screens: the outer wall and its banners go first, then the objects and the lanterns; the pillars slim down */
    @media (max-width: 1379px) { .banner { display:none; } }
    @media (max-width: 899px) { .props { width: clamp(110px, 20vw, 170px); opacity:.85; } }
    @media (max-width: 699px) {
      :host { --pw: clamp(16px, 6vw, 40px); --arch-h: clamp(90px, 18vh, 150px); --floor: clamp(36px, 7vh, 64px); }
      .props, .lamp { display:none; }
      .capital { left:-4px; right:-4px; height:12px; }
      .swirl { width: 92vw; } .swirl.s2 { width: 74vw; }
    }

    @media (prefers-reduced-motion: reduce) {
      .rays, .swirl, .core, .star, .lamp-glow, .lamp-fire, .props .warm { animation:none; }
      .mote { display:none; }
      .star { opacity:.7; transform: scale(.7); }
    }
  `],
})
export class DemoGateSceneComponent {
  readonly motes = MOTES;
  readonly stars = STARS;
  readonly sides = ['left', 'right'] as const;
}
