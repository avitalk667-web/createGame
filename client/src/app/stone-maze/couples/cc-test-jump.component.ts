import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { GameService } from '../../core/game.service';

/**
 * TESTING ONLY: a small room picker for local previews of "הצופן הזוגי". It shows only with ?test=1 in the address, and
 * the server refuses the jump unless the preview runs with Game:TestJumps (never in Production).
 */
@Component({
  selector: 'px-cc-test-jump',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shown()) {
      <div class="tj" dir="rtl">
        <button type="button" class="tj-toggle" (click)="open.set(!open())" title="בדיקה: מעבר לחדר">🧪 חדרים</button>
        @if (open()) {
          <div class="tj-list">
            @for (z of zones(); track z.id) {
              <button type="button" [disabled]="busy() || z.order <= currentOrder()" [class.here]="z.id === current()" (click)="jump(z.id)">
                {{ z.order }}. {{ z.name }}
              </button>
            }
            @if (msg()) { <p>{{ msg() }}</p> }
          </div>
        }
      </div>
    }
  `,
  styles: [`
    .tj { position: fixed; top: 64px; left: 12px; z-index: 60; font: 13px/1.3 system-ui, sans-serif; }
    .tj-toggle { background: #3b2a12; color: #ffe7b0; border: 1px solid #c9a25a; border-radius: 8px; padding: 6px 10px; cursor: pointer; }
    .tj-list { margin-top: 6px; display: grid; gap: 4px; background: rgba(20,14,6,.92); border: 1px solid #c9a25a; border-radius: 10px; padding: 8px; min-width: 180px; }
    .tj-list button { background: #2a1e0c; color: #f5e6c8; border: 1px solid #6b5228; border-radius: 6px; padding: 6px 8px; text-align: right; cursor: pointer; }
    .tj-list button:disabled { opacity: .45; cursor: default; }
    .tj-list button.here { border-color: #ffd27a; color: #ffd27a; opacity: 1; }
    .tj-list p { margin: 4px 0 0; color: #ffd27a; max-width: 200px; }
  `],
})
export class CcTestJumpComponent {
  private game = inject(GameService);
  readonly open = signal(false);
  readonly busy = signal(false);
  readonly msg = signal('');
  readonly shown = computed(() => /[?&]test=1\b/.test(location.search) && this.game.snapshot()?.phase === 'playing');
  readonly zones = computed(() => [...(this.game.scenario()?.zones ?? [])].sort((a, b) => a.order - b.order));
  readonly current = computed(() => this.game.snapshot()?.activeZone ?? '');
  readonly currentOrder = computed(() => this.zones().find((z) => z.id === this.current())?.order ?? 0);

  async jump(zone: string) {
    this.busy.set(true);
    this.msg.set('');
    try {
      const r = await this.game.testJump(zone);
      this.msg.set(r.ok ? '' : r.message);
      if (r.ok) this.open.set(false);
    } finally {
      this.busy.set(false);
    }
  }
}
