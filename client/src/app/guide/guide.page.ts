import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, inject, signal, viewChildren } from '@angular/core';
import { Location } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { HelpMenuComponent } from '../ui/help-menu.component';
import { HelpService } from '../core/help.service';
import { GUIDE } from './guide-content';
import { GuideShot } from './guide.model';

/**
 * "המדריך למשתמש": from the first visit to the end of a game, step by step, on real screenshots of the site and of
 * "שער הסודות" (the free game). Loaded only when opened (its own route); the pictures load as they come into view.
 */
@Component({
  selector: 'px-guide',
  imports: [RouterLink, HelpMenuComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:scroll)': 'onScroll()', '(document:keydown.escape)': 'zoom.set(null)' },
  template: `
    <div class="bg" aria-hidden="true"></div>
    <div class="progress" aria-hidden="true"><i [style.transform]="'scaleX(' + progress() + ')'"></i></div>
    <header class="top">
      <div class="bar">
        <a routerLink="/" class="brand gold-title">PORTAL X</a>
        <nav class="links" aria-label="ניווט">
          <button type="button" class="back" (click)="back()">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            חזרה</button>
          <a routerLink="/">דף הבית</a>
          <px-help-menu />
        </nav>
      </div>
    </header>

    <div class="wrap">
      <aside class="toc" aria-label="תוכן העניינים">
        <b class="toc-title">תוכן העניינים</b>
        <ol>
          @for (c of chapters; track c.id; let i = $index) {
            <li [class.active]="active() === c.id" [class.done]="i < activeIndex()">
              <a [href]="'#' + c.id" (click)="go($event, c.id)" [attr.aria-current]="active() === c.id ? 'step' : null">
                <span class="dot">{{ i < activeIndex() ? '✓' : c.letter }}</span><span>{{ c.title }}</span>
              </a>
            </li>
          }
        </ol>
        <button type="button" class="toc-contact" (click)="help.openContact()">לא מצאתם תשובה? צרו קשר</button>
      </aside>

      <!-- phones: the chapters as a row of chips under the bar -->
      <nav class="chips" aria-label="פרקי המדריך">
        @for (c of chapters; track c.id) {
          <a [href]="'#' + c.id" (click)="go($event, c.id)" [class.active]="active() === c.id">{{ c.letter }} · {{ c.title }}</a>
        }
      </nav>

      <main>
        <section class="intro">
          <span class="eyebrow">הדרכה</span>
          <h1 class="gold-title">המדריך למשתמש</h1>
          <span class="rule" aria-hidden="true"></span>
          <p>כל מה שצריך כדי להתחיל לשחק ב־PORTAL X: בוחרים משחק, רוכשים אותו, פותחים חדר משחק עם החברים ומזיזים את הדמות בעולם התלת־ממדי — שלב אחר שלב, עם צילומי מסך מהאתר ומהמשחק.
            המספרים על התמונות מתאימים להסברים שמתחתן. לחיצה על תמונה מגדילה אותה.</p>
          <p class="muted small">המדריך מתאים לכל משחקי PORTAL X: השליטה, הצ׳אט והתיק עובדים בכולם באותה דרך. הוא לא מגלה חידות, פתרונות או רמזים — את אלה תגלו בעצמכם במשחק. בצילומים מתוך המשחק טושטשו שמות החדרים, רשימת המשימות ושמות החפצים.</p>
        </section>

        @for (c of chapters; track c.id; let ci = $index) {
          <section class="chapter" [id]="c.id" #chapter [attr.aria-labelledby]="c.id + '-t'">
            <header class="ch-head">
              <span class="ch-letter">פרק {{ c.letter }}</span>
              <h2 [id]="c.id + '-t'">{{ c.title }}</h2>
              <p>{{ c.lead }}</p>
            </header>
            @for (s of c.steps; track $index; let si = $index) {
              <article class="step">
                <div class="step-head"><span class="num">{{ si + 1 }}</span><h3>{{ s.title }}</h3></div>
                <div class="step-body" [class.with-shot]="!!s.shot">
                  <div class="txt">
                    @for (p of s.text; track $index) { <p>{{ p }}</p> }
                    @if (s.keys?.length) {
                      <ul class="keys">
                        @for (k of s.keys; track $index) {
                          <li><span class="caps">@for (key of k.keys; track $index) { <kbd>{{ key }}</kbd> }</span><span>{{ k.label }}</span></li>
                        }
                      </ul>
                    }
                    @if (s.tip) { <p class="tip"><b>טיפ:</b> {{ s.tip }}</p> }
                  </div>
                  @if (s.shot; as sh) {
                    <figure>
                      <button type="button" class="pic" [class.portrait]="sh.portrait" (click)="zoom.set(sh)" [attr.aria-label]="'הגדלת התמונה: ' + sh.alt">
                        <img [src]="src(sh, 1440)" [attr.srcset]="srcset(sh)" sizes="(max-width: 900px) 100vw, 760px"
                          [width]="sh.width" [height]="sh.height" [alt]="sh.alt" loading="lazy" decoding="async" />
                        @for (m of sh.marks ?? []; track $index) {
                          @if (m.arrow) {
                            <span class="arrow" [class]="'arrow ' + m.arrow" [style.left.%]="m.x" [style.top.%]="m.y" aria-hidden="true">
                              <svg viewBox="0 0 40 40"><path d="M20 4v26M9 20l11 12 11-12" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                              <b>{{ m.n }}</b>
                            </span>
                          } @else if (m.w) {
                            <span class="frame" [style.left.%]="m.x" [style.top.%]="m.y" [style.width.%]="m.w" [style.height.%]="m.h" aria-hidden="true"><b>{{ m.n }}</b></span>
                          } @else {
                            <span class="pin" [style.left.%]="m.x" [style.top.%]="m.y" aria-hidden="true">{{ m.n }}</span>
                          }
                        }
                      </button>
                      @if (sh.legend?.length || sh.caption) {
                        <figcaption>
                          @if (sh.legend?.length) {
                            <ol class="legend">@for (l of sh.legend; track $index) { <li><span>{{ $index + 1 }}</span>{{ l }}</li> }</ol>
                          }
                          @if (sh.caption) { <p>{{ sh.caption }}</p> }
                        </figcaption>
                      }
                    </figure>
                  }
                </div>
              </article>
            }
            <div class="ch-nav">
              @if (ci > 0) { <a [href]="'#' + chapters[ci - 1].id" (click)="go($event, chapters[ci - 1].id)">‹ הפרק הקודם</a> } @else { <span></span> }
              @if (ci < chapters.length - 1) {
                <a class="next" [href]="'#' + chapters[ci + 1].id" (click)="go($event, chapters[ci + 1].id)">לפרק הבא: {{ chapters[ci + 1].title }} ›</a>
              } @else {
                <a class="next" routerLink="/" fragment="games">לבחירת משחק ›</a>
              }
            </div>
          </section>
        }

        <section class="outro card">
          <h2>נשארה שאלה?</h2>
          <p>כתבו לנו ונחזור אליכם במייל.</p>
          <div class="row">
            <button type="button" class="btn primary" (click)="help.openContact()">צור קשר</button>
            <a class="btn" routerLink="/">לדף הבית</a>
          </div>
        </section>
      </main>
    </div>

    @if (zoom(); as z) {
      <div class="overlay zoom" (click)="zoom.set(null)" role="dialog" aria-modal="true" [attr.aria-label]="z.alt">
        <button type="button" class="z-close" (click)="zoom.set(null)" aria-label="סגירת התמונה">✕</button>
        <img [src]="src(z, 1440)" [alt]="z.alt" />
      </div>
    }
  `,
  styles: [`
    :host { display:block; min-height:100dvh; position:relative; }
    .bg { position:fixed; inset:0; z-index:0; pointer-events:none;
      background: radial-gradient(60rem 30rem at 85% -10%, rgba(224,185,92,.14), transparent 60%), radial-gradient(50rem 30rem at 0% 30%, rgba(80,100,200,.12), transparent 60%); }
    .progress { position:fixed; top:0; inset-inline:0; height:3px; z-index:7; }
    .progress i { display:block; height:100%; background:linear-gradient(90deg, #f6d78d, #e0a93f); transform-origin:right; transition:transform .1s linear; }
    .top { position:sticky; top:0; z-index:6; background:rgba(8,13,34,.86); backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px); border-bottom:1px solid rgba(224,185,92,.18); }
    .bar { max-width:1200px; margin:0 auto; padding:10px 16px; display:flex; align-items:center; gap:1.5rem; }
    .brand { font-weight:900; letter-spacing:.06em; font-size:1.55rem; text-decoration:none; direction:ltr; white-space:nowrap; }
    .links { display:flex; align-items:center; gap:1.4rem; margin-inline-start:auto; }
    .links > a, .back { color:var(--text); text-decoration:none; font:inherit; font-weight:600; background:none; border:0; padding:.3rem 0; cursor:pointer;
      display:inline-flex; align-items:center; gap:.25rem; border-bottom:2px solid transparent; }
    .links > a:hover, .back:hover, .links > a:focus-visible, .back:focus-visible { color:var(--gold-2); border-bottom-color:var(--gold); outline:none; }
    .back svg { width:1.1em; height:1.1em; }

    .wrap { position:relative; z-index:1; max-width:1200px; margin:0 auto; padding:0 16px 4rem; display:grid; grid-template-columns:250px minmax(0, 1fr); gap:2.5rem; }
    .toc { position:sticky; top:84px; align-self:start; margin-top:2.2rem; padding:1rem; border-radius:18px; border:1px solid var(--line);
      background:linear-gradient(180deg, rgba(22,32,74,.85), rgba(13,20,48,.85)); }
    .toc-title { display:block; color:var(--gold-2); font-size:.85rem; margin-bottom:.6rem; }
    .toc ol { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:.15rem; }
    .toc a { display:flex; align-items:center; gap:.6rem; padding:.5rem .5rem; border-radius:10px; color:var(--muted); text-decoration:none; font-weight:600; font-size:.95rem; line-height:1.3; }
    .toc a:hover { color:var(--text); background:rgba(255,255,255,.05); }
    .toc .dot { width:28px; height:28px; flex-shrink:0; display:grid; place-items:center; border-radius:50%; border:1px solid var(--line); font-size:.85rem; color:var(--gold-2); }
    .toc li.done .dot { background:rgba(63,191,106,.15); border-color:rgba(63,191,106,.5); color:var(--ok); }
    .toc li.active a { color:var(--text); background:rgba(224,185,92,.12); }
    .toc li.active .dot { background:linear-gradient(180deg, #ffe39a, #e0a93f); color:#1d1405; border-color:transparent; font-weight:900; }
    .toc-contact { margin-top:.8rem; width:100%; background:none; border:1px dashed var(--line); color:var(--gold-2); border-radius:10px; padding:.55rem; font:inherit; font-size:.88rem; cursor:pointer; }
    .toc-contact:hover { background:rgba(224,185,92,.08); }
    .chips { display:none; }

    main { min-width:0; }
    .intro { padding:2.2rem 0 1rem; }
    .eyebrow { color:var(--muted); font-weight:700; font-size:.92rem; }
    .intro h1 { font-size:clamp(2rem, 5vw, 3rem); font-weight:900; margin:.4rem 0 .6rem; }
    .rule { display:block; width:56px; height:4px; border-radius:2px; background:var(--gold); margin-bottom:1.1rem; }
    .intro p { max-width:62ch; line-height:1.8; color:#e6dfcf; margin:0 0 .6rem; }
    .small { font-size:.9rem; }

    .chapter { scroll-margin-top:80px; padding-top:2.4rem; }
    .ch-head { border-top:1px solid rgba(224,185,92,.25); padding-top:1.6rem; margin-bottom:1rem; }
    .ch-letter { display:inline-block; padding:.2rem .7rem; border-radius:999px; background:rgba(224,185,92,.14); color:var(--gold-2); font-weight:800; font-size:.85rem; }
    .ch-head h2 { font-size:clamp(1.6rem, 3.6vw, 2.2rem); margin:.6rem 0 .4rem; color:var(--gold-2); }
    .ch-head p { margin:0; color:var(--muted); max-width:62ch; line-height:1.7; }

    .step { margin-top:1.6rem; padding:1.1rem 1.2rem 1.3rem; border-radius:18px; border:1px solid rgba(201,162,77,.22); background:rgba(13,20,44,.6); }
    .step-head { display:flex; align-items:center; gap:.7rem; margin-bottom:.6rem; }
    .num { width:34px; height:34px; flex-shrink:0; display:grid; place-items:center; border-radius:50%; font-weight:900; color:#1d1405;
      background:linear-gradient(180deg, #ffe39a, #e0a93f); box-shadow:0 4px 14px rgba(224,169,63,.3); }
    .step h3 { margin:0; font-family:var(--font); font-size:1.18rem; font-weight:800; }
    .txt p { margin:0 0 .55rem; line-height:1.75; color:#ece5d4; }
    .tip { background:rgba(106,168,255,.1); border:1px solid rgba(106,168,255,.35); border-radius:10px; padding:.55rem .8rem; }
    .tip b { color:var(--blue); }
    .keys { list-style:none; margin:.4rem 0 .6rem; padding:0; display:grid; gap:.45rem; }
    .keys li { display:flex; align-items:center; gap:.7rem; flex-wrap:wrap; }
    .caps { display:inline-flex; gap:.25rem; direction:ltr; }
    kbd { min-width:34px; height:34px; padding:0 .5rem; display:inline-grid; place-items:center; border-radius:8px; font:700 .9rem var(--font);
      color:var(--text); background:linear-gradient(180deg, #26305a, #161d3c); border:1px solid rgba(201,162,77,.45); box-shadow:0 2px 0 rgba(0,0,0,.5); }

    figure { margin:.8rem 0 0; }
    .pic { position:relative; display:block; width:100%; padding:0; border:1px solid rgba(201,162,77,.35); border-radius:14px; overflow:hidden; cursor:zoom-in; background:#05070f; }
    .pic img { display:block; width:100%; height:auto; }
    .pic.portrait { max-width:300px; margin-inline:auto; }
    .frame { position:absolute; border:3px solid #ffcf4d; border-radius:10px; box-shadow:0 0 0 2px rgba(0,0,0,.55), 0 0 18px rgba(255,207,77,.55); pointer-events:none; }
    .frame b, .pin, .arrow b { position:absolute; display:grid; place-items:center; width:28px; height:28px; border-radius:50%; font-size:.9rem; font-weight:900;
      color:#1d1405; background:#ffcf4d; box-shadow:0 2px 8px rgba(0,0,0,.6); }
    .frame b { top:-14px; inset-inline-start:-14px; }
    .pin { transform:translate(-50%, -50%); pointer-events:none; }
    .arrow { position:absolute; width:46px; height:46px; color:#ffcf4d; filter:drop-shadow(0 2px 4px rgba(0,0,0,.7)); pointer-events:none; }
    .arrow svg { width:100%; height:100%; }
    .arrow b { width:24px; height:24px; font-size:.8rem; }
    .arrow.down { transform:translate(-50%, -100%); } .arrow.down b { bottom:100%; left:50%; translate:-50% 0; }
    .arrow.up { transform:translate(-50%, 0) rotate(180deg); } .arrow.up b { bottom:100%; left:50%; translate:-50% 0; rotate:180deg; }
    .arrow.right { transform:translate(-100%, -50%) rotate(-90deg); } .arrow.right b { bottom:100%; left:50%; translate:-50% 0; rotate:90deg; }
    .arrow.left { transform:translate(0, -50%) rotate(90deg); } .arrow.left b { bottom:100%; left:50%; translate:-50% 0; rotate:-90deg; }
    @media (prefers-reduced-motion: no-preference) { .arrow svg { animation:nudge 1.4s ease-in-out infinite; } }
    @keyframes nudge { 50% { transform:translateY(5px); } }
    figcaption { margin-top:.7rem; }
    figcaption p { margin:.3rem 0 0; color:var(--muted); font-size:.92rem; line-height:1.6; }
    .legend { list-style:none; margin:0; padding:0; display:grid; gap:.4rem; }
    .legend li { display:flex; gap:.55rem; align-items:flex-start; line-height:1.55; color:#e6dfcf; font-size:.95rem; }
    .legend li span { width:24px; height:24px; flex-shrink:0; display:grid; place-items:center; border-radius:50%; background:#ffcf4d; color:#1d1405; font-weight:900; font-size:.8rem; margin-top:.1rem; }

    .ch-nav { display:flex; justify-content:space-between; gap:1rem; margin-top:1.4rem; flex-wrap:wrap; }
    .ch-nav a { color:var(--muted); text-decoration:none; font-weight:700; } .ch-nav a:hover { color:var(--gold-2); }
    .ch-nav .next { color:var(--gold-2); }
    .outro { margin-top:3rem; text-align:center; }
    .outro .row { display:flex; gap:.7rem; justify-content:center; flex-wrap:wrap; margin-top:1rem; }

    .zoom { z-index:70; cursor:zoom-out; padding:12px; }
    .zoom img { max-width:100%; max-height:calc(100dvh - 24px); border-radius:10px; box-shadow:var(--shadow); }
    .z-close { position:fixed; top:12px; inset-inline-end:12px; width:44px; height:44px; border-radius:50%; border:1px solid var(--line); background:rgba(13,20,44,.9); color:var(--text); font-size:1.1rem; cursor:pointer; }

    @media (max-width: 900px) {
      .wrap { grid-template-columns:minmax(0, 1fr); gap:0; }
      .toc { display:none; }
      .chips { display:flex; gap:.4rem; overflow-x:auto; position:sticky; top:61px; z-index:5; margin:0 -16px; padding:.55rem 16px;
        background:rgba(8,13,34,.92); border-bottom:1px solid rgba(224,185,92,.15); scrollbar-width:none; }
      .chips::-webkit-scrollbar { display:none; }
      .chips a { flex-shrink:0; padding:.35rem .8rem; border-radius:999px; border:1px solid var(--line); color:var(--muted); text-decoration:none; font-size:.85rem; font-weight:700; }
      .chips a.active { color:#1d1405; background:linear-gradient(180deg, #ffe39a, #e0a93f); border-color:transparent; }
      .chapter { scroll-margin-top:120px; }
      .step { padding:.9rem .85rem 1rem; }
      .frame b, .pin { width:22px; height:22px; font-size:.75rem; } .frame b { top:-11px; inset-inline-start:-11px; }
      .frame { border-width:2px; }
      .arrow { width:30px; height:30px; }
    }
    @media (max-width: 520px) {
      .bar { gap:.8rem; } .links { gap:.9rem; } .brand { font-size:1.2rem; }
      .links > a { display:none; }
    }
  `],
})
export class GuidePage implements AfterViewInit, OnDestroy {
  help = inject(HelpService);
  private location = inject(Location);
  private router = inject(Router);
  readonly chapters = GUIDE;
  active = signal(GUIDE[0].id);
  activeIndex = signal(0);
  progress = signal(0);
  zoom = signal<GuideShot | null>(null);
  private sections = viewChildren<ElementRef<HTMLElement>>('chapter');
  private spy?: IntersectionObserver;

  ngAfterViewInit() {
    if (typeof IntersectionObserver !== 'function') return;
    // the chapter whose top part is on the screen is the current one
    this.spy = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) this.setActive(e.target.id);
    }, { rootMargin: '-20% 0px -70% 0px' });
    for (const s of this.sections()) this.spy.observe(s.nativeElement);
    const hash = location.hash.slice(1);
    if (hash && GUIDE.some((c) => c.id === hash)) setTimeout(() => document.getElementById(hash)?.scrollIntoView(), 50);
  }

  ngOnDestroy() {
    this.spy?.disconnect();
  }

  private setActive(id: string) {
    this.active.set(id);
    this.activeIndex.set(Math.max(0, GUIDE.findIndex((c) => c.id === id)));
    // the phone chip row follows the current chapter
    document.querySelector(`.chips a[href="#${id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  onScroll() {
    const max = document.documentElement.scrollHeight - innerHeight;
    this.progress.set(max > 0 ? Math.min(1, scrollY / max) : 0);
  }

  go(ev: Event, id: string) {
    ev.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    history.replaceState(null, '', '#' + id);
  }

  back() {
    // a visitor who opened the guide from another page of the site goes back there; a direct visit goes home
    if (this.router.lastSuccessfulNavigation?.previousNavigation) this.location.back();
    else this.router.navigateByUrl('/');
  }

  src(s: GuideShot, w: 1440 | 720) {
    return `/img/guide/${s.src}-${w}.webp`;
  }

  srcset(s: GuideShot) {
    return `/img/guide/${s.src}-720.webp 720w, /img/guide/${s.src}-1440.webp 1440w`;
  }
}
