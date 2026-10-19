import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AudioService } from './core/audio.service';
import { CaptionsComponent } from './ui/captions.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, CaptionsComponent],
  template: `<router-outlet /><px-captions />`,
  host: { '(pointerdown)': 'audio.unlock()', '(keydown)': 'audio.unlock()' },
})
export class App {
  audio = inject(AudioService);
  constructor() {
    this.audio.loadManifest();
  }
}
