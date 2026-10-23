import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { AudioService } from '../core/audio.service';
import { GameService } from '../core/game.service';
import { characterInfo } from '../core/models';
import { ChatComponent } from '../ui/chat.component';
import { IconComponent } from '../ui/icon.component';

/** Step 3 — waiting room: who joined, which character, who is ready; the host starts (spec §4). */
@Component({
  selector: 'px-lobby',
  imports: [ChatComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let s = game.snapshot()!;
    <main>
      <header>
        <div>
          <span class="chip">{{ game.scenario()?.name ?? 'הפורטל האחרון' }}</span>
          <h1>החדר שלנו</h1>
        </div>
        <div class="code card">
          <span class="lbl">קוד חדר</span>
          <strong dir="ltr">{{ s.code }}</strong>
          <div class="code-actions">
            <button class="btn small" (click)="copy(s.code, 'הקוד הועתק')">העתקת קוד</button>
            <button class="btn small" (click)="copy(inviteLink(), 'קישור ההזמנה הועתק')">העתקת קישור</button>
            @if (canShare) { <button class="btn small" (click)="share()">שיתוף</button> }
          </div>
          @if (copied()) { <span class="copied" role="status">{{ copied() }}</span> }
          @if (manualCopy(); as t) {
            <input id="manual-copy" class="manual" readonly dir="ltr" [value]="t" (focus)="$any($event.target).select()" aria-label="טקסט להעתקה" />
          }
        </div>
      </header>

      @if (game.hostAway()) {
        <div class="host-away card" role="alert">
          <span>המארח{{ game.hostName() ? ' ' + game.hostName() : '' }} אינו מחובר כרגע. משתתף מחובר יכול לקבל את תפקיד המארח ולהתחיל את המשחק.</span>
          @if (game.me()?.isConnected) { <button class="btn primary small" (click)="claimHost()">אני אהיה המארח</button> }
        </div>
      }

      <section class="players" aria-label="המשתתפים בחדר">
        @for (p of s.players; track p.id) {
          <article class="pl" [class.off]="!p.isConnected" [class.released]="p.seatStatus === 'released'" [class.me]="p.id === game.playerId()">
            @if (p.isHost) { <span class="crown" title="המארח"><px-icon name="crownSmall" [size]="22" /></span> }
            <img [src]="char(p.characterId).image" [alt]="char(p.characterId).name" />
            <b>{{ p.nickname }}</b>
            <span class="role">{{ char(p.characterId).name }}</span>
            <span class="state" [class.ready]="p.isReady || p.isHost">
              @if (p.seatStatus === 'released') { המקום שוחרר }
              @else if (!p.isConnected) { {{ p.isHost ? 'המארח ' : '' }}מנותק{{ p.seatHeldUntil ? ' · המקום שמור עד ' + time(p.seatHeldUntil) : '' }} }
              @else if (p.isHost) { מארח } @else if (p.isReady) { <px-icon name="check" [size]="16" /> מוכן } @else { ממתין }
            </span>
            @if (game.isHost() && p.id !== game.playerId()) {
              <div class="host-tools">
                @if (p.isConnected) { <button class="btn small ghost" (click)="transfer(p.id, p.nickname)">העברת תפקיד המארח</button> }
                @else if (p.seatStatus === 'away') { <button class="btn small ghost danger" (click)="release(p.id, p.nickname)">פינוי המקום</button> }
              </div>
            }
          </article>
        }
        @for (e of emptySlots(); track $index) {
          <article class="pl empty"><span>מקום פנוי</span></article>
        }
      </section>

      <div class="bottom">
        <section class="card controls">
          <p class="muted">אפשר לשחק עם {{ s.minPlayers }}–{{ s.maxPlayers }} משתתפים, כולל המארח. מקומות תפוסים: <b>{{ s.seatsTaken ?? s.players.length }}</b> מתוך {{ s.maxPlayers }}.</p>
          @if (game.isHost()) {
            <button class="btn primary big" (click)="start()" [disabled]="!!s.startBlocker || busy()">מתחילים! ‹</button>
            @if (s.startBlocker) { <p class="muted small">{{ s.startBlocker }}</p> }
            <button class="btn small ghost danger" (click)="regen()">ביטול הקישור ויצירת קוד חדש</button>
          } @else {
            <button class="btn big" [class.primary]="!game.me()?.isReady" (click)="toggleReady()">
              {{ game.me()?.isReady ? 'ביטול „מוכן”' : 'אני מוכן!' }}
            </button>
            <p class="muted small">המארח יתחיל את המשחק כשכולם מוכנים.</p>
          }
          @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
          <button class="btn small ghost" (click)="confirmLeave()">יציאה מהחדר</button>
        </section>
        <section class="card chatbox" aria-label="צ׳אט">
          <h2>צ׳אט הקבוצה</h2>
          <px-chat [compact]="true" />
        </section>
      </div>
    </main>
  `,
  styles: [`
    main { max-width: 1100px; margin: 0 auto; padding: 16px; min-height: 100dvh;
      background: radial-gradient(ellipse at top, rgba(255,190,90,.12), transparent 60%), url('/img/concept-hunt.jpg') center/cover fixed; background-blend-mode: normal, soft-light; }
    header { display:flex; justify-content:space-between; align-items:flex-end; flex-wrap:wrap; gap: 1rem; }
    h1 { font-size: 2.6rem; margin:.3rem 0 0; }
    .code { display:flex; flex-direction:column; align-items:center; gap:.3rem; padding: .8rem 1.2rem; position:relative; }
    .code .lbl { color: var(--muted); font-size: .85rem; }
    .code strong { font-size: 2.2rem; letter-spacing: .25em; color: #fff; font-family: 'Heebo', monospace; }
    .code-actions { display:flex; gap:.4rem; flex-wrap:wrap; justify-content:center; }
.copied { color: var(--ok); font-size: .85rem; max-width: 280px; text-align: center; }
    .manual { width: 100%; font-size: .9rem; text-align: center; }
    .code strong { user-select: all; }
    .players { display:grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: .8rem; margin: 1.4rem 0; }
    .pl { position:relative; background: linear-gradient(180deg, #1a2550, #0d1430); border: 2px solid rgba(201,162,77,.45); border-radius: 14px;
      padding: .6rem; display:flex; flex-direction:column; align-items:center; gap:.2rem; min-height: 200px; }
    .pl img { width: 100%; aspect-ratio: 158/195; object-fit: cover; border-radius: 10px; }
    .pl b { font-size: 1.1rem; } .pl .role { color: var(--muted); font-size: .85rem; }
    .pl.me { border-color: var(--gold-2); box-shadow: 0 0 18px rgba(224,185,92,.3); }
    .pl.off { opacity: .55; } .pl.released { opacity: .35; filter: grayscale(.6); }
    .host-tools { display:flex; flex-direction:column; gap:.2rem; margin-top:.2rem; }
    .host-away { display:flex; gap:1rem; align-items:center; justify-content:space-between; flex-wrap:wrap; border-color: var(--bad); margin-top:1rem; }
    .pl.empty { justify-content:center; border-style: dashed; color: var(--muted); background: rgba(13,20,48,.5); }
    .crown { position:absolute; top: -12px; color: var(--gold-2); filter: drop-shadow(0 0 6px rgba(224,185,92,.8)); }
    .state { font-size:.85rem; color: var(--muted); display:flex; align-items:center; gap:.2rem; }
    .state.ready { color: var(--ok); font-weight:700; }
    .bottom { display:grid; grid-template-columns: minmax(0,1fr) minmax(0,1.2fr); gap: 1rem; } .bottom > * { min-width: 0; }
    .controls { display:flex; flex-direction:column; gap:.7rem; align-items:flex-start; }
    .big { font-size: 1.2rem; padding: .8em 2em; } .small { font-size:.88rem; }
    .chatbox h2 { font-size: 1.2rem; } .chatbox { min-height: 300px; display:flex; flex-direction:column; }
    @media (max-width: 760px) { .bottom { grid-template-columns: 1fr; } header { align-items: stretch; } }
  `],
})
export class LobbyComponent {
  game = inject(GameService);
  private audio = inject(AudioService);
  leave = output<void>();
  busy = signal(false);
  error = signal<string | null>(null);
  copied = signal<string | null>(null);
  manualCopy = signal<string | null>(null);
  canShare = typeof navigator.share === 'function';
  char = characterInfo;
  emptySlots = computed(() => {
    const s = this.game.snapshot();
    if (!s) return [];
    return Array.from({ length: Math.max(0, s.minPlayers - s.players.length) });
  });

  inviteLink() {
    return `${location.origin}/join/${this.game.snapshot()?.code}`;
  }

  async copy(text: string, msg: string) {
    this.manualCopy.set(null);
    if (await this.writeClipboard(text)) {
      this.copied.set(msg);
      setTimeout(() => this.copied.set(null), 2500);
      return;
    }
    // Clipboard blocked (in-app browsers, strict settings): show the text selected, ready for Ctrl+C / long-press.
    this.copied.set('הדפדפן חסם העתקה אוטומטית — הטקסט מסומן, העתיקו אותו (Ctrl+C או לחיצה ארוכה).');
    this.manualCopy.set(text);
    setTimeout(() => {
      const el = document.getElementById('manual-copy') as HTMLInputElement | null;
      el?.focus();
      el?.select();
    });
  }

  private async writeClipboard(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // older fallback that still works where the async clipboard API is blocked
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      ta.remove();
      return ok;
    }
  }

  share() {
    navigator.share?.({ title: 'PORTAL X — הצטרפו להרפתקה', text: `קוד החדר: ${this.game.snapshot()?.code}`, url: this.inviteLink() }).catch(() => {});
  }

  time(iso: string) {
    return new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  }

  async claimHost() {
    const r = await this.game.claimHost();
    this.error.set(r.ok ? null : r.message);
  }

  async transfer(id: string, name: string) {
    if (!confirm(`להעביר את תפקיד המארח ל־${name}?`)) return;
    const r = await this.game.transferHost(id);
    this.error.set(r.ok ? null : r.message);
  }

  async release(id: string, name: string) {
    if (!confirm(`לפנות את המקום של ${name}? ${name} לא מחובר כרגע. אם יחזור והמשחק יהיה מלא, הוא לא יוכל להיכנס. הניקוד וההיסטוריה שלו יישמרו.`)) return;
    const r = await this.game.releaseSeat(id);
    this.error.set(r.ok ? null : r.message);
  }

  confirmLeave() {
    if (confirm('לצאת מהחדר? המקום שלך יתפנה למשתתף אחר. (אם רק סוגרים את הלשונית, המקום נשמר.)')) this.leave.emit();
  }

  async toggleReady() {
    this.audio.sfx('click');
    const r = await this.game.setReady(!this.game.me()?.isReady);
    this.error.set(r.ok ? null : r.message);
  }

  async start() {
    this.busy.set(true);
    const r = await this.game.startGame();
    this.busy.set(false);
    this.error.set(r.ok ? null : r.message);
  }

  async regen() {
    if (!confirm('לבטל את קישור ההזמנה הנוכחי? מי שעוד לא הצטרף יצטרך את הקוד החדש.')) return;
    const r = await this.game.regenerateCode();
    this.error.set(r.ok ? null : r.message);
  }
}
