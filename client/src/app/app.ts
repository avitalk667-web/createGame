import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AudioService } from './core/audio.service';
import { HelpService } from './core/help.service';
import { CaptionsComponent } from './ui/captions.component';
import { CampaignPopupComponent } from './ui/campaign-popup.component';
import { ContactDialogComponent } from './ui/contact-dialog.component';
import { pendingCoupon } from './challenge/challenge.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, CaptionsComponent, CampaignPopupComponent, ContactDialogComponent],
  // the contact window ("הדרכה" → "צור קשר") is loaded only when it is first opened
  template: `<router-outlet /><px-captions /><px-campaign-popup />
    @if (help.contactOpen()) { @defer { <px-contact-dialog /> } }`,
  host: { '(pointerdown)': 'audio.unlock()', '(keydown)': 'audio.unlock()' },
})
export class App {
  audio = inject(AudioService);
  help = inject(HelpService);
  constructor() {
    this.audio.loadManifest();
    pendingCoupon.capture();
  }
}
