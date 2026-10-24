import { Injectable, inject, signal } from '@angular/core';
import { ApiService, SiteInfo } from './api.service';

/** Public site details from the server — the one contact address and the end-of-game options it offers. */
@Injectable({ providedIn: 'root' })
export class SiteService {
  private api = inject(ApiService);
  private loaded?: Promise<void>;
  /** Shown until the server answers; the server's setting is the single source. */
  readonly info = signal<SiteInfo>({ contactEmail: 'info.portalx@gmail.com', resultsEmail: false, communityGroup: false, consentText: '', consentVersion: '' });
  readonly ready = signal(false);

  load() {
    this.loaded ??= this.api.site().then((i) => {
      this.info.set(i);
      this.ready.set(true);
    }).catch(() => {});
    return this.loaded;
  }
}
