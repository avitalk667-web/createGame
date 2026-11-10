import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { GameService } from '../core/game.service';
import { Product } from '../core/models';
import { ResultsEmailComponent } from '../ui/results-email.component';
import { ResultShareComponent } from '../ui/result-share.component';

/** Results of the Hanukkah journey (spec Part G §21): group score, personal ranking, contributions, time, hints, winner. */
@Component({
  selector: 'px-h-result',
  imports: [RouterLink, ResultsEmailComponent, ResultShareComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap">
      <div class="confetti" aria-hidden="true">@for (i of confetti; track i) { <i [style.--i]="i"></i> }</div>
      <section #card class="card result" aria-labelledby="res-title">
        <h1 id="res-title" class="gold-title">{{ freeGame() ? 'עברתם את שער הסודות!' : 'השלמתם את מסע החנוכה!' }}</h1>
        @if (freeGame()) {
          <p class="sub">פענחתם את הרמזים, הפעלתם את המנגנונים ופתחתם את השער במפתח המוזהב.</p>
        } @else {
          <p class="sub">מי גילה הכי הרבה, פתר הכי הרבה והוביל את הקבוצה לניצחון?</p>
        }

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

          <div class="stats" [class.four]="freeGame()">
            @if (freeGame() && game.snapshot()?.result; as r) {
              <div><span>חידות שנפתרו</span><b>{{ r.puzzlesSolved }} מתוך {{ r.puzzlesTotal }}</b></div>
            }
            <div><span>ניקוד קבוצתי</span><b>{{ sc.group }}</b></div>
            <div><span>זמן המשחק</span><b dir="ltr">{{ duration() }}</b></div>
            <div><span>רמזים שנוצלו</span><b>{{ sc.hintsUsed }}</b></div>
          </div>

          @if (freeGame() && achievements().length) {
            <h2 class="titles-head">הישגי הקבוצה</h2>
            <ul class="achievements" aria-label="הישגי הקבוצה">
              @for (a of achievements(); track a.id) {
                <li [class.earned]="a.earned">
                  <span class="ic" aria-hidden="true">{{ a.earned ? '🏅' : '🔒' }}</span>
                  <b>{{ a.title }}</b>
                  <small>{{ a.description }}</small>
                  @if (!a.earned) { <small class="later">לא הושג הפעם</small> }
                </li>
              }
            </ul>
          }

          @if (titles().length) {
            <h2 class="titles-head">תארי הכבוד</h2>
            <ul class="titles" aria-label="תארי הכבוד">
              @for (t of titles(); track t.id) {
                <li [class.mine]="t.mine" [class.none]="!t.names.length">
                  <span class="ic" aria-hidden="true">{{ t.icon }}</span>
                  <b class="tt">{{ t.title }}</b>
                  <span class="who">{{ t.names.length ? t.names.join(' · ') : 'לא הוענק הפעם' }}</span>
                  <small>{{ t.description }}@if (t.names.length) { ({{ t.count }})}</small>
                </li>
              }
            </ul>
          }

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

        <!-- a picture of this card as it is shown (without the buttons and the email form) to copy, share or save -->
        <px-result-share [target]="card" [ready]="!!score()" [fileName]="freeGame() ? 'PORTAL-X-שער-הסודות.png' : 'PORTAL-X-סוד-פך-השמן.png'" />

        <px-results-email class="no-capture" />

        @if (freeGame() && nextGames().length) {
          <section class="next no-capture" aria-labelledby="next-title">
            <h2 id="next-title">ההרפתקה הבאה מחכה לכם</h2>
            <p class="muted">במשחקים המלאים של PORTAL X מחכים יותר חדרים, מנגנונים מורכבים יותר וסודות עמוקים יותר.</p>
            <div class="next-cards">
              @for (p of nextGames(); track p.id) {
                <a class="next-card" [routerLink]="['/games', p.id]">
                  <img [src]="p.coverImage" [alt]="''" loading="lazy" />
                  <b>{{ p.name }}</b>
                  <span>{{ teaser(p) }}</span>
                </a>
              }
            </div>
          </section>
        }

        <div class="actions no-capture">
          @if (freeGame()) { <a class="btn primary" routerLink="/" fragment="games">גלו את שאר המשחקים</a> }
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
    .stats.four { grid-template-columns: repeat(4, 1fr); }
    .achievements { list-style:none; padding:0; margin:0 0 1rem; display:grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap:.5rem; }
    .achievements li { display:flex; flex-direction:column; align-items:center; gap:.15rem; border-radius:14px; padding:.55rem .4rem; background: rgba(255,255,255,.04); border:1px dashed rgba(201,162,77,.35); opacity:.6; }
    .achievements li.earned { opacity:1; border-style:solid; border-color: var(--gold-2); background: linear-gradient(180deg, rgba(255,227,154,.22), rgba(224,169,63,.08)); }
    .achievements .ic { font-size:1.6rem; line-height:1; } .achievements b { color: var(--gold-2); } .achievements small { color: var(--muted); font-size:.8rem; } .achievements .later { font-style:italic; }
    .next { margin-top:1.4rem; padding-top:1rem; border-top:1px solid rgba(201,162,77,.25); }
    .next h2 { font-size:1.35rem; color: var(--gold-2); margin:0 0 .2rem; } .next p { margin:0 0 .7rem; }
    .next-cards { display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:.6rem; }
    .next-card { display:flex; flex-direction:column; gap:.25rem; text-align:start; text-decoration:none; color:inherit; background: rgba(255,255,255,.04); border:1px solid rgba(201,162,77,.3); border-radius:12px; overflow:hidden; padding-bottom:.55rem; }
    .next-card:hover { border-color: var(--gold-2); }
    .next-card img { width:100%; aspect-ratio:16/9; object-fit:cover; display:block; background:#1a1208; }
    .next-card b, .next-card span { padding:0 .6rem; } .next-card b { color: var(--gold-2); } .next-card span { font-size:.85rem; color: var(--muted); line-height:1.45; }
    .stats div { background: rgba(255,255,255,.05); border-radius:12px; padding:.5rem; display:flex; flex-direction:column; } .stats span { color: var(--muted); font-size:.9rem; } .stats b { font-size:1.5rem; }
    table { width:100%; border-collapse:collapse; } th, td { padding:.45rem; border-bottom:1px solid rgba(201,162,77,.2); } th { color: var(--gold-2); }
    tr.me td { background: rgba(224,185,92,.1); } tr.first td b { color: var(--gold-2); }
    details { text-align:start; margin-top:.8rem; } .rooms { list-style:none; padding:0; display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:.3rem; }
    .rooms li { display:flex; gap:.5rem; justify-content:space-between; background: rgba(255,255,255,.04); border-radius:8px; padding:.3rem .6rem; }
    .actions { display:flex; gap:.6rem; justify-content:center; margin-top:1.2rem; flex-wrap:wrap; }
    .small { font-size:.85rem; }
    .titles-head { font-size:1.3rem; margin:.4rem 0 .5rem; color: var(--gold-2); }
    .titles { list-style:none; padding:0; margin:0 0 1rem; display:grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap:.5rem; }
    .titles li { display:flex; flex-direction:column; align-items:center; gap:.15rem; background: rgba(255,255,255,.05); border:1px solid rgba(201,162,77,.3); border-radius:14px; padding:.55rem .4rem; }
    .titles li.mine { background: linear-gradient(180deg, rgba(255,227,154,.22), rgba(224,169,63,.08)); border-color: var(--gold-2); }
    .titles li.none { opacity:.6; }
    .titles .ic { font-size:1.7rem; line-height:1; } .titles .tt { color: var(--gold-2); } .titles .who { font-weight:600; overflow-wrap:anywhere; } .titles small { color: var(--muted); font-size:.8rem; }
    .confetti { position:fixed; inset:0; overflow:hidden; pointer-events:none; }
    .confetti i { position:absolute; top:-12px; left: calc(var(--i) * 3.4%); width: 9px; height: 14px; border-radius: 2px;
      background: hsl(calc(40 + var(--i) * 9), 85%, 62%); animation: fall 3.2s linear calc(var(--i) * 70ms) both; }
    @keyframes fall { to { transform: translateY(105vh) rotate(calc(var(--i) * 70deg)); opacity:.2 } }
    @keyframes pop { from { opacity:0; transform: scale(.85) } to { opacity:1; transform:none } }
    @media (max-width: 560px) { .stats { grid-template-columns: 1fr; } .stats.four { grid-template-columns: 1fr 1fr; } .titles { grid-template-columns: 1fr 1fr; } th:nth-child(5), td:nth-child(5) { display:none; } }
  `],
})
export class HResultComponent {
  game = inject(GameService);
  home = output<void>();
  /** The free trial game ends with an invitation to the full games (spec 1.4). */
  freeGame = input(false);
  confetti = Array.from({ length: 30 }, (_, i) => i);
  private api = inject(ApiService);

  /** The group's achievements of this round: every one the game has, the earned ones lit (teamwork only in a group). */
  achievements = computed(() => {
    const s = this.game.snapshot();
    const earned = new Set((s?.result?.achievements ?? []).map((a) => a.id));
    const group = (s?.players.length ?? 0) > 1;
    return (this.game.scenario()?.achievements ?? [])
      .filter((a) => group || a.id !== 'everyone')
      .map((a) => ({ ...a, earned: earned.has(a.id) }));
  });

  /** The full games, for the free game's quiet invitation at the end (only games that can be bought). */
  private products = signal<Product[]>([]);
  nextGames = computed(() => this.products().filter((p) => !p.isFree && p.purchasable && p.saleState !== 'paused'));
  /** What each full game has that the free one does not. */
  private readonly TEASERS: Record<string, string> = {
    'stone-maze': 'מטוטלת קריסטל, שרשראות ומנופים, מסילת אנרגיה וחדר שמתהפך — מבוך של חידות לחדי מחשבה.',
    'hanukkah-oil': 'שמונה חדרים רציפים: מבוך מגנטי, פסיפס של אור, סביבונים ומאזניים עתיקים — מסע שלם בעקבות נס החנוכה.',
  };
  teaser = (p: Product) => this.TEASERS[p.id] ?? p.tagline;

  constructor() {
    effect(() => {
      if (!this.freeGame()) return;
      this.api.products().then((list) => this.products.set(list)).catch(() => {});
    });
  }

  score = computed(() => this.game.snapshot()?.score ?? null);
  zones = computed(() => [...(this.game.scenario()?.zones ?? [])].sort((a, b) => a.order - b.order));
  /** The end-of-game titles with their winners' names; a title of the player looking is highlighted. */
  titles = computed(() => {
    const sc = this.score();
    const name = new Map((sc?.players ?? []).map((p) => [p.playerId, p.nickname]));
    const me = this.game.playerId();
    return (sc?.titles ?? []).map((t) => ({ ...t, names: t.winners.map((w) => name.get(w) ?? '').filter((n) => n), mine: !!me && t.winners.includes(me) }));
  });
  leaders = computed(() => (this.score()?.players ?? []).filter((p) => p.rank === 1).map((p) => p.nickname).join(' · '));
  duration = computed(() => {
    const s = this.game.snapshot();
    const sec = s?.result?.durationSeconds ?? (s?.startedAt && s?.endedAt ? Math.round((Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 1000) : 0);
    return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  });
}
