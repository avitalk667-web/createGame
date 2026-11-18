import { AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import { AudioService } from '../core/audio.service';
import { TUTORIAL_VIDEO } from '../core/tutorial-video';

/**
 * "Want to see how to play?" on the home page, right after how it works: the gameplay tutorial in a gold frame.
 * Never plays by itself: preload="none", no autoplay, no loop. The preview picture is asked for only when the section
 * comes near the screen, and the video file only when the viewer presses play.
 */
@Component({
  selector: 'px-tutorial-video',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section id="tutorial" class="tutorial" aria-labelledby="tutorial-title">
      <div class="tutorial-head">
        <h2 id="tutorial-title">רוצים לראות איך זה נראה באמת?</h2>
        <p>הצצה קטנה לעולם של PORTAL X – כך חוקרים, אוספים רמזים, מפעילים מנגנונים ופותרים חידות יחד.</p>
      </div>
      <div class="frame">
        <video #player controls preload="none" playsinline controlslist="nodownload noremoteplayback" disablepictureinpicture
          [attr.poster]="near() ? video.poster : null" [width]="video.width" [height]="video.height"
          [attr.aria-label]="video.title" [attr.title]="video.title" aria-describedby="tutorial-poster-alt"
          (play)="onPlay()" (pause)="onStop()" (ended)="onStop()" (error)="onError()">
          <!-- the external copy first (if configured); the browser moves on to the site's own copy when it fails -->
          @if (video.remoteSrc) { <source [src]="video.remoteSrc" type="video/mp4" /> }
          <source [src]="video.src" type="video/mp4" />
          הדפדפן שלכם אינו תומך בהצגת סרטונים. <a [href]="video.src">לצפייה בסרטון ההדרכה</a>
        </video>
        <span id="tutorial-poster-alt" class="sr-only">{{ video.posterAlt }}</span>
      </div>
    </section>
  `,
  styles: [`
    :host { display:block; }
    .tutorial { scroll-margin-top:84px; padding-block:1.4rem 2.6rem; text-align:center; }
    .tutorial-head { max-width:62ch; margin:0 auto 1.4rem; }
    .tutorial-head h2 { margin:0; font-family:var(--font-title); font-weight:900; font-size:clamp(1.6rem, 3.4vw, 2.4rem); line-height:1.15; text-wrap:balance;
      background: linear-gradient(180deg, #fff1bf, #f2c45a 55%, #c58d2f); -webkit-background-clip:text; background-clip:text; color:transparent;
      filter: drop-shadow(0 0 12px rgba(255,205,110,.3)); }
    .tutorial-head p { margin:.5rem 0 0; color:#e8e1d2; font-size:clamp(.95rem, 1.4vw, 1.1rem); line-height:1.6; text-wrap:balance; }
    /* the same gold frame and soft shadow as the hero picture and how it works */
    .frame { position:relative; max-width:900px; margin-inline:auto; aspect-ratio:16 / 9; border-radius:20px; overflow:hidden; background:#060b20;
      border:1px solid rgba(240,200,110,.6); box-shadow: 0 0 0 4px rgba(240,200,110,.06), 0 0 22px rgba(240,200,110,.18), 0 20px 46px rgba(0,0,0,.45); }
    video { display:block; width:100%; height:100%; object-fit:contain; background:#060b20; }
    video:focus-visible { outline:3px solid #fff3c4; outline-offset:-3px; }
    @media (max-width: 640px) {
      .tutorial { padding-block:1rem 2rem; }
      .tutorial-head { margin-bottom:1rem; }
      .frame { border-radius:14px; }
    }
  `],
})
export class TutorialVideoComponent implements AfterViewInit {
  private audio = inject(AudioService);
  private host = inject(ElementRef<HTMLElement>);
  private destroyRef = inject(DestroyRef);
  readonly video = TUTORIAL_VIDEO;
  private player = viewChild.required<ElementRef<HTMLVideoElement>>('player');
  /** True once the section is close to the screen: only then the preview picture is requested. */
  near = signal(false);

  ngAfterViewInit() {
    if (typeof IntersectionObserver === 'undefined') return this.near.set(true);
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { this.near.set(true); io.disconnect(); }
    }, { rootMargin: '600px 0px' });
    io.observe(this.host.nativeElement);
    this.destroyRef.onDestroy(() => { io.disconnect(); this.player().nativeElement.pause(); });
  }

  /** The site's background music steps aside while the video speaks, and comes back when it stops. */
  onPlay() { this.audio.setMusic('none'); }
  onStop() { this.audio.setMusic('home'); }

  /**
   * The external copy stopped answering in the middle of playing (a failing <source> before playback is skipped by
   * the browser itself): continue from the same second with the site's own copy.
   */
  onError() {
    const el = this.player().nativeElement;
    const remote = this.video.remoteSrc;
    if (!remote || this.switchedToLocal || !el.currentSrc || !el.currentSrc.startsWith(new URL(remote, location.href).href)) return;
    this.switchedToLocal = true;
    const at = el.currentTime;
    const wasPlaying = !el.paused;
    el.src = this.video.src;
    el.addEventListener('loadedmetadata', () => {
      el.currentTime = at;
      if (wasPlaying) el.play().catch(() => undefined);
    }, { once: true });
    el.load();
  }
  private switchedToLocal = false;
}
