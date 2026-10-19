import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, input, signal, viewChild } from '@angular/core';
import { GameService } from '../core/game.service';
import { AudioService } from '../core/audio.service';

const EMOTES: [string, string][] = [
  ['thumbs', '👍'], ['idea', '💡'], ['think', '🤔'], ['clap', '👏'], ['star', '⭐'], ['eyes', '👀'], ['key', '🗝️'], ['smile', '🙂'],
];
const PHRASES = ['מצאתי רמז!', 'בואו לכאן', 'מישהו ראה מפתח?', 'כל הכבוד!', 'אני חושב שהבנתי', 'צריך עזרה', 'מה אתם רואים במראה?', 'מוכן!'];

/** Text chat with preset emoticons and quick phrases (spec §5). Messages are filtered by the server. */
@Component({
  selector: 'px-chat',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="chat" [class.compact]="compact()">
      <div class="log" #log role="log" aria-live="polite" aria-label="הודעות הצ׳אט">
        @for (m of game.chat(); track m.id) {
          <div class="msg" [class.mine]="m.playerId === game.playerId()">
            <b>{{ m.nickname }}</b>
            @if (m.emote) { <span class="emote">{{ m.emote }}</span> } @else { <span>{{ m.text }}</span> }
          </div>
        } @empty {
          <div class="muted empty">כאן תוכלו לשתף רמזים עם חברי הקבוצה.</div>
        }
      </div>
      <div class="quick">
        @for (e of emotes; track e[0]) {
          <button class="emo" (click)="sendEmote(e[0])" [attr.aria-label]="'שליחת ' + e[1]">{{ e[1] }}</button>
        }
      </div>
      <div class="phrases">
        @for (p of phrases; track p) { <button class="phrase" (click)="send(p)">{{ p }}</button> }
      </div>
      <form (submit)="$event.preventDefault(); send(text())">
        <input [value]="text()" (input)="text.set($any($event.target).value)" maxlength="140" placeholder="כתבו הודעה לקבוצה..." aria-label="הודעה לקבוצה" />
        <button class="btn small primary" type="submit" [disabled]="!text().trim()">שלח</button>
      </form>
      @if (error()) { <div class="err" role="alert">{{ error() }}</div> }
    </div>
  `,
  styles: [`
    :host { display:block; min-width:0; }
    .chat { min-width:0; display:flex; flex-direction:column; gap:.4rem; height:100%; }
    .log { flex:1; min-height: 110px; overflow:auto; display:flex; flex-direction:column; gap:.3rem; padding:.3rem; }
    .compact .log { max-height: 180px; }
    .msg { background: rgba(255,255,255,.05); border-radius: 10px; padding: .3rem .6rem; font-size:.95rem; line-height:1.4; }
    .msg b { color: var(--gold-2); margin-inline-end: .4em; }
    .msg.mine { background: rgba(224,185,92,.12); }
    .emote { font-size: 1.4rem; }
    .empty { font-size: .9rem; padding: .4rem; }
    .quick { display:flex; gap:.2rem; flex-wrap:wrap; }
    .emo { background: rgba(255,255,255,.06); border:1px solid var(--line); border-radius: 8px; font-size:1.15rem; width: 36px; height: 34px; cursor:pointer; }
    .phrases { display:flex; gap:.25rem; overflow-x:auto; padding-bottom: 2px; }
    .phrase { white-space:nowrap; background: transparent; color: var(--muted); border:1px solid rgba(255,255,255,.15); border-radius:999px; padding:.2rem .6rem; cursor:pointer; font-family: inherit; font-size:.82rem; }
    .phrase:hover, .emo:hover { border-color: var(--gold); color: var(--text); }
    form { display:flex; gap:.4rem; } form input { flex:1; min-width:0; }
    .err { color:#ffb4a3; font-size:.85rem; }
  `],
})
export class ChatComponent {
  game = inject(GameService);
  private audio = inject(AudioService);
  compact = input(false);
  text = signal('');
  error = signal<string | null>(null);
  emotes = EMOTES;
  phrases = PHRASES;
  private log = viewChild<ElementRef<HTMLDivElement>>('log');
  private seen = 0;

  constructor() {
    effect(() => {
      const n = this.game.chat().length;
      const el = this.log()?.nativeElement;
      if (el) queueMicrotask(() => (el.scrollTop = el.scrollHeight));
      if (n > this.seen && this.seen > 0) this.audio.sfx('chat');
      this.seen = n;
    });
  }

  async send(t: string) {
    const v = t.trim();
    if (!v) return;
    const r = await this.game.sendChat(v, null);
    if (r.ok) {
      this.text.set('');
      this.error.set(null);
    } else this.error.set(r.message);
  }

  async sendEmote(id: string) {
    const r = await this.game.sendChat(null, id);
    this.error.set(r.ok ? null : r.message);
  }
}
