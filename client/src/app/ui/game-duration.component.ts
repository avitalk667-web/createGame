import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Product, durationLabel } from '../core/models';

/**
 * The approximate play time of a game ("🕒 כ־60 דקות ומעלה"), from the product's server data.
 * Renders nothing when the game has no play time set. `chip` shows it in the site's chip style.
 */
@Component({
  selector: 'px-game-duration',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (label(); as l) {<span class="dur" [class.chip]="chip()"><span class="clock" aria-hidden="true">🕒</span><span class="sr-only">משך משחק משוער: </span>{{ l }}</span>}`,
  styles: [`
    :host { display: contents; }
    .dur { display: inline-flex; align-items: center; gap: .3em; white-space: nowrap; }
    .clock { font-size: .95em; line-height: 1; }
  `],
})
export class GameDurationComponent {
  product = input.required<Pick<Product, 'duration'>>();
  chip = input(false, { transform: (v: boolean | '') => v === '' || v });
  label = computed(() => durationLabel(this.product()));
}
