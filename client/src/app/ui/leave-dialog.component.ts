import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { GameService } from '../core/game.service';

/**
 * Leaving a game in progress (spec 4ג): stepping out keeps the seat (like closing the tab), leaving for good frees it.
 * Leaving for good is asked separately, with what it means, before anything happens.
 */
@Component({
  selector: 'px-leave-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="overlay" (click)="cancel.emit()">
      <section class="panel-modal" role="dialog" aria-modal="true" aria-labelledby="leave-title" (click)="$event.stopPropagation()">
        <h2 id="leave-title">יציאה מהמשחק</h2>
        <div class="opt">
          <button class="btn primary" (click)="later.emit()">יציאה זמנית</button>
          <p>המקום, הדמות והניקוד שלך נשמרים {{ hold }} דקות. אפשר לחזור עם אותו קוד משחק — גם אחרי סגירת הדפדפן.</p>
        </div>
        <div class="opt">
          <button class="btn danger" (click)="confirmForGood()">עזיבה ושחרור המקום</button>
          <p>המקום שלך יתפנה ומשתתף אחר יוכל לתפוס אותו. הניקוד שלך נשמר בתוצאות.</p>
        </div>
        <button class="btn small ghost" (click)="cancel.emit()">חזרה למשחק</button>
      </section>
    </div>
  `,
  styles: [`
    .panel-modal { width:min(480px, calc(100% - 24px)); display:flex; flex-direction:column; gap:.8rem; }
    h2 { margin:0; font-family: var(--font-title); color: var(--gold-2); }
    .opt { display:flex; flex-direction:column; gap:.3rem; align-items:flex-start; }
    .opt p { margin:0; color: var(--muted); line-height:1.6; font-size:.95rem; }
  `],
})
export class LeaveDialogComponent {
  private game = inject(GameService);
  later = output<void>();
  forGood = output<void>();
  cancel = output<void>();
  hold = this.game.snapshot()?.seatHoldMinutes || 30;

  confirmForGood() {
    if (confirm('לעזוב לצמיתות ולפנות את המקום? אם המשחק יתמלא, ייתכן שלא תוכלו לחזור אליו.')) this.forGood.emit();
  }
}
