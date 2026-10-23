import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, effect, inject, input } from '@angular/core';
import { Location } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { sessionStore } from '../core/api.service';
import { AudioService } from '../core/audio.service';
import { GameService } from '../core/game.service';
import { LobbyComponent } from './lobby.component';
import { PlayComponent } from './play.component';
import { HPlayComponent } from '../hanukkah/h-play.component';

/** Connects to the room with this tab's player token and shows the screen for the current phase. */
@Component({
  selector: 'px-room',
  imports: [RouterLink, LobbyComponent, PlayComponent, HPlayComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (game.connection()) {
      @case ('connecting') { <div class="center"><p>מתחברים לחדר...</p></div> }
      @case ('failed') {
        <div class="center card">
          <h2>לא הצלחנו להתחבר</h2>
          <p class="error">{{ game.connectionError() }}</p>
          <div class="row">
            <button class="btn primary" (click)="game.retry()">ניסיון נוסף</button>
            <a class="btn" [routerLink]="['/join', code()]">הצטרפות מחדש</a>
            <a class="btn ghost" routerLink="/">דף הבית</a>
          </div>
        </div>
      }
    }
    @if (game.snapshot(); as s) {
      @if (s.phase === 'lobby') { <px-lobby (leave)="leave(true)" /> }
      @else if (s.scenarioId === 'hanukkah-oil' || s.scenarioId === 'gate-of-secrets') { <px-h-play (leave)="leave(false)" (leaveForGood)="leave(true)" /> }
      @else { <px-play (leave)="leave(false)" (leaveForGood)="leave(true)" /> }
    }
    @if (game.connection() === 'reconnecting' || game.connection() === 'disconnected') {
      <div class="banner" role="alert">
        @if (game.connection() === 'reconnecting') { החיבור נותק — מתחברים מחדש... ההתקדמות שמורה בשרת. }
        @else { החיבור לשרת נסגר. <button class="btn small" (click)="game.retry()">התחברות מחדש</button> }
      </div>
    }
  `,
  styles: [`
    .center { max-width: 520px; margin: 20vh auto; text-align:center; padding: 1.5rem; }
    .row { display:flex; gap:.5rem; justify-content:center; flex-wrap:wrap; }
    .banner { position:fixed; top: 0; inset-inline: 0; z-index: 100; background: #7a3a12; color:#fff; text-align:center; padding:.5rem; font-weight:700; }
  `],
})
export class RoomPage implements OnInit, OnDestroy {
  code = input.required<string>();
  game = inject(GameService);
  private router = inject(Router);
  private location = inject(Location);
  private audio = inject(AudioService);

  constructor() {
    // Keep the URL in sync when the host replaces the invite code.
    effect(() => {
      const s = this.game.snapshot();
      if (s && s.code !== this.code().toUpperCase()) this.location.replaceState(`/room/${s.code}`);
      if (s?.phase === 'lobby') this.audio.setMusic('home');
    });
  }

  ngOnInit() {
    const session = sessionStore.get();
    const code = this.code().toUpperCase();
    if (!session || (session.code !== code && session.roomId === undefined)) {
      this.router.navigate(['/join', code]);
      return;
    }
    if (session.code !== code) {
      // A different room is stored in this tab — join the requested one instead.
      sessionStore.clear();
      this.router.navigate(['/join', code]);
      return;
    }
    this.game.connect(session);
  }

  /** For good: the seat is freed (after confirming). Otherwise only this tab disconnects and the seat is kept. */
  async leave(forGood: boolean) {
    if (forGood) await this.game.leave();
    else await this.game.disconnect();
    this.audio.setMusic('home');
    this.router.navigate(['/']);
  }

  ngOnDestroy() {
    this.game.disconnect();
  }
}
