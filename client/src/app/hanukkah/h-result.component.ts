import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { GameService } from '../core/game.service';

/** Results of the Hanukkah journey (spec Part G §21): group score, personal ranking, contributions, time, hints, winner. */
@Component({
  selector: 'px-h-result',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap">
      <div class="confetti" aria-hidden="true">@for (i of confetti; track i) { <i [style.--i]="i"></i> }</div>
      <section class="card result" aria-labelledby="res-title">
        <h1 id="res-title" class="gold-title">השלמתם את מסע החנוכה!</h1>
        <p class="sub">מי גילה הכי הרבה, פתר הכי הרבה והוביל את הקבוצה לניצחון?</p>

        @if (score(); as sc) {
          <div class="winner" role="status">
            @if (sc.tie) {
              <span>תיקו במקום הראשון!</span>
              <b>{{ leaders() }}</b>
            } @else if (sc.players.length) {
              <span>המנצח האישי</span>
              <b>{{ sc.players[0].nickname }}</b>
            }
          </div>

          <div class="stats">
            <div><span>ניקוד קבוצתי</span><b>{{ sc.group }}</b></div>
            <div><span>זמן המשחק</span><b dir="ltr">{{ duration() }}</b></div>
            <div><span>רמזים שנוצלו</span><b>{{ sc.hintsUsed }}</b></div>
          </div>

          <table>
            <caption class="sr-only">טבלת ניקוד אישית</caption>
            <thead><tr><th>מקום</th><th>שחקן</th><th>נקודות</th><th>חידות ושלבים שפתר</th><th>פעולות בחידות</th></tr></thead>
            <tbody>
              @for (p of sc.players; track p.playerId) {
                <tr [class.me]="p.playerId === game.playerId()" [class.first]="p.rank === 1">
                  <td>{{ p.rank === 1 ? '🏆' : p.rank }}</td><td>{{ p.nickname }}</td><td><b>{{ p.points }}</b></td><td>{{ p.solved }}</td><td>{{ p.contributions }}</td>
                </tr>
              }
            </tbody>
          </table>
          <p class="muted small">במקרה של שוויון בנקודות, מי שפתר יותר חידות ושלבים מדורג גבוה יותר. שוויון גם בזה — תיקו.</p>

          <details>
            <summary>ניקוד הקבוצה לפי חדרים</summary>
            <ul class="rooms">
              @for (z of zones(); track z.id) {
                <li><span>{{ z.name }}</span><b>{{ sc.rooms[z.id] ?? 0 }}</b>@if (sc.hintsByZone[z.id]) { <small>({{ sc.hintsByZone[z.id] }} רמזים)</small> }</li>
              }
            </ul>
          </details>
        }

        <div class="actions">
          @if (game.isHost()) { <button class="btn primary" (click)="again()" [disabled]="busy()">משחק נוסף באותו חדר</button> }
          <button class="btn" (click)="home.emit()">לדף הבית</button>
        </div>
      </section>
    </div>
  `,
  styles: [`
    .wrap { position:fixed; inset:0; z-index:40; display:grid; place-items:center; padding:16px; background: radial-gradient(circle at 50% 20%, rgba(224,185,92,.18), rgba(3,5,12,.92)); overflow:auto; }
    .result { width:min(720px, 100%); text-align:center; animation: pop .6s cubic-bezier(.2,1.3,.4,1) both; }
    h1 { font-size: clamp(2rem, 6vw, 3.2rem); margin:.2rem 0; } .sub { font-size:1.15rem; color: var(--gold-2); margin:0 0 1rem; }
    .winner { display:inline-flex; flex-direction:column; gap:.2rem; background: linear-gradient(180deg, rgba(255,227,154,.2), rgba(224,169,63,.1)); border:1px solid var(--gold-2);
      border-radius:16px; padding:.6rem 1.6rem; margin-bottom:1rem; } .winner b { font-size:1.8rem; color: var(--gold-2); }
    .stats { display:grid; grid-template-columns: repeat(3, 1fr); gap:.6rem; margin-bottom:1rem; }
    .stats div { background: rgba(255,255,255,.05); border-radius:12px; padding:.5rem; display:flex; flex-direction:column; } .stats span { color: var(--muted); font-size:.9rem; } .stats b { font-size:1.5rem; }
    table { width:100%; border-collapse:collapse; } th, td { padding:.45rem; border-bottom:1px solid rgba(201,162,77,.2); } th { color: var(--gold-2); }
    tr.me td { background: rgba(224,185,92,.1); } tr.first td b { color: var(--gold-2); }
    details { text-align:start; margin-top:.8rem; } .rooms { list-style:none; padding:0; display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:.3rem; }
    .rooms li { display:flex; gap:.5rem; justify-content:space-between; background: rgba(255,255,255,.04); border-radius:8px; padding:.3rem .6rem; }
    .actions { display:flex; gap:.6rem; justify-content:center; margin-top:1.2rem; flex-wrap:wrap; }
    .small { font-size:.85rem; }
    .confetti { position:fixed; inset:0; overflow:hidden; pointer-events:none; }
    .confetti i { position:absolute; top:-12px; left: calc(var(--i) * 3.4%); width: 9px; height: 14px; border-radius: 2px;
      background: hsl(calc(40 + var(--i) * 9), 85%, 62%); animation: fall 3.2s linear calc(var(--i) * 70ms) both; }
    @keyframes fall { to { transform: translateY(105vh) rotate(calc(var(--i) * 70deg)); opacity:.2 } }
    @keyframes pop { from { opacity:0; transform: scale(.85) } to { opacity:1; transform:none } }
    @media (max-width: 560px) { .stats { grid-template-columns: 1fr; } th:nth-child(5), td:nth-child(5) { display:none; } }
  `],
})
export class HResultComponent {
  game = inject(GameService);
  home = output<void>();
  busy = signal(false);
  confetti = Array.from({ length: 30 }, (_, i) => i);

  score = computed(() => this.game.snapshot()?.score ?? null);
  zones = computed(() => [...(this.game.scenario()?.zones ?? [])].sort((a, b) => a.order - b.order));
  leaders = computed(() => (this.score()?.players ?? []).filter((p) => p.rank === 1).map((p) => p.nickname).join(' · '));
  duration = computed(() => {
    const s = this.game.snapshot();
    const sec = s?.result?.durationSeconds ?? (s?.startedAt && s?.endedAt ? Math.round((Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 1000) : 0);
    return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  });

  async again() {
    this.busy.set(true);
    try {
      await this.game.playAgain();
    } finally {
      this.busy.set(false);
    }
  }
}
