import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { GameService } from '../core/game.service';
import { IconComponent } from '../ui/icon.component';

/** Step 6–7: success scene result — time, achievements, group result; replay or back home (spec §4). */
@Component({
  selector: 'px-result',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let r = game.snapshot()?.result;
    <div class="wrap">
      <section class="result card">
        <h1 class="gold-title">תוצאת המשחק</h1>
        @if (r) {
          <div class="stats">
            <div class="stat"><px-icon name="dial" [size]="34" /><b dir="ltr">{{ time() }}</b><span>זמן המשחק</span></div>
            <div class="stat"><span class="stars">{{ stars() }}</span><b>{{ r.puzzlesSolved }}/{{ r.puzzlesTotal }}</b><span>משימות הושלמו</span></div>
            <div class="stat"><px-icon name="compass" [size]="34" /><b>{{ r.playersCount }}</b><span>שחקנים</span></div>
            <div class="stat"><px-icon name="hint" [size]="34" /><b>{{ r.hintsUsed }}</b><span>רמזים</span></div>
          </div>
          <div class="ach">
            @for (a of r.achievements; track a.id) {
              <div class="a"><span class="trophy">🏆</span><div><b>{{ a.title }}</b><p>{{ a.description }}</p></div></div>
            }
          </div>
        } @else {
          <p class="muted">מחשבים את התוצאה...</p>
        }
        <div class="actions">
          @if (game.isHost()) {
            <button class="btn primary" (click)="again()" [disabled]="busy()">משחק חוזר עם אותה קבוצה</button>
          } @else {
            <p class="muted">המארח יכול לפתוח משחק חוזר לכל הקבוצה.</p>
          }
          <button class="btn" (click)="home.emit()">חזרה לדף הבית</button>
        </div>
        @if (error()) { <p class="error">{{ error() }}</p> }
      </section>
      <figure class="photo">
        <img src="img/group-photo.jpg" alt="קבוצת בנים בכיפות וחולצות לבנות חוגגים מול הפורטל" />
        <figcaption>אלופי הפורטל!</figcaption>
      </figure>
    </div>
  `,
  styles: [`
    .wrap { position:fixed; inset:0; z-index: 25; display:flex; align-items:center; justify-content:center; gap: 2rem; padding: 16px; overflow:auto;
      background: radial-gradient(ellipse at center, rgba(14,21,48,.85), rgba(4,6,16,.97)); flex-wrap: wrap; }
    .result { width: min(560px, 100%); }
    h1 { font-size: 2.6rem; }
    .stats { display:grid; grid-template-columns: 1fr 1fr; gap: .8rem; }
    .stat { display:flex; flex-direction:column; align-items:center; gap:.2rem; background: rgba(255,255,255,.05); border:1px solid var(--line); border-radius: 12px; padding: .8rem; color: var(--gold); }
    .stat b { font-size: 2rem; color: var(--text); } .stat span { color: var(--muted); font-size:.9rem; }
    .stars { font-size: 1.4rem; letter-spacing: .1em; }
    .ach { display:flex; flex-direction:column; gap:.5rem; margin: 1rem 0; }
    .a { display:flex; gap:.7rem; align-items:center; background: rgba(224,185,92,.1); border:1px solid var(--line); border-radius: 12px; padding: .5rem .8rem; }
    .a b { color: var(--gold-2); font-size: 1.1rem; } .a p { margin:.15rem 0 0; color: #ddd; font-size: .92rem; }
    .trophy { font-size: 1.8rem; }
    .actions { display:flex; gap:.6rem; flex-wrap:wrap; align-items:center; }
    .photo { margin:0; background:#f4ecd8; padding: 12px 12px 6px; transform: rotate(-3deg); box-shadow: var(--shadow); max-width: 340px; }
    .photo img { width:100%; display:block; }
    .photo figcaption { text-align:center; color:#2a2a2a; font-family: var(--font-title); font-size: 1.6rem; padding: .3rem 0; }
  `],
})
export class ResultComponent {
  game = inject(GameService);
  home = output<void>();
  busy = signal(false);
  error = signal<string | null>(null);
  time = computed(() => {
    const s = this.game.snapshot()?.result?.durationSeconds ?? 0;
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  });
  stars = computed(() => {
    const r = this.game.snapshot()?.result;
    if (!r) return '';
    const n = r.hintsUsed === 0 ? 3 : r.hintsUsed <= 4 ? 2 : 1;
    return '★'.repeat(n) + '☆'.repeat(3 - n);
  });

  async again() {
    this.busy.set(true);
    const r = await this.game.playAgain();
    this.busy.set(false);
    this.error.set(r.ok ? null : r.message);
  }
}
