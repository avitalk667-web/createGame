import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AudioService } from './core/audio.service';
import { CaptionsComponent } from './ui/captions.component';
import { CampaignPopupComponent } from './ui/campaign-popup.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, CaptionsComponent, CampaignPopupComponent],
  template: `<router-outlet /><px-captions /><px-campaign-popup />`,
  host: { '(pointerdown)': 'audio.unlock()', '(keydown)': 'audio.unlock()' },
})
export class App {
  audio = inject(AudioService);
  constructor() {
    this.audio.loadManifest();
  }
}
