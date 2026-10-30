import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { GameService } from '../core/game.service';
import { IconComponent } from '../ui/icon.component';
import { ResultsEmailComponent } from '../ui/results-email.component';

/** Step 6–7: success scene result — time, achievements, the personal ranking and the group result; back home (spec §4). */
@Component({
  selector: 'px-result',
  imports: [IconComponent, ResultsEmailComponent],
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
          @if (score(); as sc) {
            @if (sc.players.length) {
              <div class="winner" role="status">
                @if (sc.tie) { <span>תיקו במקום הראשון!</span><b>{{ leaders() }}</b> }
                @else { <span>המנצח האישי</span><b>{{ sc.players[0].nickname }}</b> }
              </div>
              <table class="rank">
                <caption class="sr-only">דירוג אישי</caption>
                <thead><tr><th>מקום</th><th>שחקן</th><th>ניקוד אישי</th></tr></thead>
                <tbody>
                  @for (p of sc.players; track p.playerId) {
                    <tr [class.me]="p.playerId === game.playerId()" [class.first]="p.rank === 1">
                      <td>{{ p.rank === 1 ? '🏆' : p.rank }}</td><td>{{ p.nickname }}</td><td><b>{{ p.points }}</b></td>
                    </tr>
                  }
                </tbody>
              </table>
              <p class="muted small">ניקוד קבוצתי: <b>{{ sc.group }}</b> · במקרה של שוויון בנקודות, מי שפתר יותר חידות מדורג גבוה יותר.</p>
            }
          }
          <div class="ach">
            @for (a of r.achievements; track a.id) {
              <div class="a"><span class="trophy">🏆</span><div><b>{{ a.title }}</b><p>{{ a.description }}</p></div></div>
            }
          </div>
          <px-results-email />
        } @else {
          <p class="muted">מחשבים את התוצאה...</p>
        }
        <div class="actions">
          <button class="btn" (click)="home.emit()">חזרה לדף הבית</button>
        </div>
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
    .winner { display:flex; flex-direction:column; align-items:center; gap:.15rem; margin:1rem 0 .6rem; background: linear-gradient(180deg, rgba(255,227,154,.2), rgba(224,169,63,.1));
      border:1px solid var(--gold-2); border-radius:14px; padding:.5rem 1rem; } .winner b { font-size:1.6rem; color: var(--gold-2); }
    .rank { width:100%; border-collapse:collapse; text-align:center; } .rank th, .rank td { padding:.4rem; border-bottom:1px solid rgba(201,162,77,.2); } .rank th { color: var(--gold-2); }
    .rank tr.me td { background: rgba(224,185,92,.1); } .rank tr.first td b { color: var(--gold-2); }
    .small { font-size:.85rem; }
    .actions { display:flex; gap:.6rem; flex-wrap:wrap; align-items:center; }
    .photo { margin:0; background:#f4ecd8; padding: 12px 12px 6px; transform: rotate(-3deg); box-shadow: var(--shadow); max-width: 340px; }
    .photo img { width:100%; display:block; }
    .photo figcaption { text-align:center; color:#2a2a2a; font-family: var(--font-title); font-size: 1.6rem; padding: .3rem 0; }
  `],
})
export class ResultComponent {
  game = inject(GameService);
  home = output<void>();
  score = computed(() => this.game.snapshot()?.score ?? null);
  leaders = computed(() => (this.score()?.players ?? []).filter((p) => p.rank === 1).map((p) => p.nickname).join(' · '));
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
}
