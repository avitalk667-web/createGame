import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AudioService } from '../core/audio.service';
import { SettingsService } from '../core/settings.service';

/** Hebrew subtitles for every spoken line (spec §16: every dubbed segment has Hebrew captions). */
@Component({
  selector: 'px-captions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (settings.settings().captions && audio.caption(); as c) {
      <div class="cap" role="status" aria-live="polite">
        @if (c.speaker) { <span class="who">{{ c.speaker }}:</span> }
        <span>{{ c.text }}</span>
      </div>
    }
  `,
  styles: [`
    :host { position: fixed; inset-inline: 0; bottom: 118px; display: flex; justify-content: center; pointer-events: none; z-index: 40; padding: 0 16px; }
    .cap { max-width: 860px; background: rgba(0,0,0,.78); border: 1px solid rgba(224,185,92,.35); border-radius: 12px;
      padding: .6em 1.1em; font-size: clamp(1rem, 2.2vw, 1.3rem); line-height: 1.5; text-align: center; animation: fade .25s ease; }
    .who { color: var(--gold-2); font-weight: 800; margin-inline-end: .35em; }
    @keyframes fade { from { opacity: 0; transform: translateY(6px) } to { opacity: 1 } }
  `],
})
export class CaptionsComponent {
  audio = inject(AudioService);
  settings = inject(SettingsService);
}
