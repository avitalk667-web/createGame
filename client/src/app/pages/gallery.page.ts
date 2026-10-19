import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, NgZone, OnDestroy, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { CHARACTERS } from '../core/models';
import { SettingsService } from '../core/settings.service';
import { BoyAvatar } from '../world/avatar';
import { ZONE_ORDER, ZoneId } from '../world/layout';
import { GameWorld } from '../world/world';

/** Design review page: look at every room and at the characters without playing through the adventure. */
@Component({
  selector: 'px-gallery',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stage"><canvas #c aria-label="תצוגת החדרים בתלת־ממד"></canvas></div>
    <header class="bar card">
      <a routerLink="/">‹ דף הבית</a>
      <b>תצוגת עיצוב</b>
      <div class="views" role="group" aria-label="בחירת תצוגה">
        <button class="btn small" [class.primary]="view() === 'characters'" (click)="go('characters')">הדמויות</button>
        <button class="btn small" [class.primary]="view() === 'wallmap'" (click)="go('wallmap')">מפת הקיר</button>
        <button class="btn small" [class.primary]="view() === 'parchment'" (click)="go('parchment')">הקלף</button>
        @for (z of zones; track z.id) {
          <button class="btn small" [class.primary]="view() === z.id" (click)="go(z.id)">{{ z.name }}</button>
        }
      </div>
    </header>
  `,
  styles: [`
    :host { display:block; position:fixed; inset:0; }
    .stage { position:absolute; inset:0; } canvas { width:100%; height:100%; display:block; }
    .bar { position:fixed; top: 10px; inset-inline: 10px; display:flex; gap: .8rem; align-items:center; flex-wrap: wrap; padding: .5rem .8rem; z-index: 2; }
    .bar a { text-decoration: none; } .views { display:flex; gap:.35rem; flex-wrap: wrap; }
  `],
})
export class GalleryPage implements AfterViewInit, OnDestroy {
  private canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('c');
  private settings = inject(SettingsService);
  private api = inject(ApiService);
  private ngZone = inject(NgZone);
  private world?: GameWorld;
  view = signal<ZoneId | 'characters' | 'wallmap' | 'parchment'>('characters');
  zones: { id: ZoneId; name: string }[] = [
    { id: 'library', name: 'הספרייה' },
    { id: 'symbols', name: 'חדר הסמלים' },
    { id: 'echo', name: 'חדר ההדים' },
    { id: 'mirrors', name: 'חדר המראות' },
    { id: 'items', name: 'חדר החפצים' },
    { id: 'portal', name: 'הפורטל' },
  ];

  async ngAfterViewInit() {
    const scenario = await this.api.scenario('last-portal').catch(() => null);
    this.ngZone.runOutsideAngular(() => {
      this.world = new GameWorld(this.canvas().nativeElement, this.settings.settings().quality);
      this.world.build(scenario);
      this.world.applySnapshot({ unlockedZones: [...ZONE_ORDER], worldItems: ['handle', 'crystal', 'gear'], placedItems: [], puzzles: [], letters: [] } as any);
      const names = ['ישראל', 'דוד', 'אורי', 'משה'];
      this.world.showLineup(CHARACTERS.map((c, k) => new BoyAvatar(c.id, c.defaults, `${names[k]} · ${c.name}`)));
      this.world.setTour('characters');
      this.world.start();
    });
  }

  go(v: ZoneId | 'characters' | 'wallmap' | 'parchment') {
    this.view.set(v);
    this.world?.setTour(v);
  }

  ngOnDestroy() {
    this.world?.dispose();
  }
}
