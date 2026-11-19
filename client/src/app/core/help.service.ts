import { Injectable, signal } from '@angular/core';

/** The "הדרכה" menu's contact window: one open/closed state for the whole site, shown by the app root. */
@Injectable({ providedIn: 'root' })
export class HelpService {
  readonly contactOpen = signal(false);

  openContact() {
    this.contactOpen.set(true);
  }

  closeContact() {
    this.contactOpen.set(false);
  }
}
