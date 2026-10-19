import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiService, RoomInfo, sessionStore } from '../core/api.service';
import { AudioService } from '../core/audio.service';
import { Appearance, CHARACTERS, CharacterId, characterInfo } from '../core/models';
import { AvatarPreviewComponent } from '../ui/avatar-preview.component';
import { IconComponent } from '../ui/icon.component';
import { SKIN_TONES, HAIR_COLORS, BAG_COLORS } from '../world/avatar';

/** Steps 2–3: joining a room with a nickname and a character (boys only, Haredi dress). */
@Component({
  selector: 'px-join',
  imports: [RouterLink, AvatarPreviewComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main>
      <a routerLink="/" class="back">‹ חזרה לדף הבית</a>
      @if (loading()) {
        <p class="muted">טוענים את פרטי החדר...</p>
      } @else if (!room()) {
        <section class="card center">
          <h1>החדר לא נמצא</h1>
          <p class="error">{{ error() }}</p>
          <a class="btn primary" routerLink="/">חזרה לדף הבית</a>
        </section>
      } @else {
        <header>
          <span class="chip">חדר {{ room()!.code }} · {{ room()!.scenarioName }}</span>
          <h1>בחרו דמות</h1>
          <p class="muted">כל הדמויות לובשות כיפה, חולצה לבנה ומכנסיים שחורים. אפשר לגוון בגוון הפנים, בשיער, במשקפיים ובתיק.</p>
        </header>
        @if (!room()!.canJoin) {
          <p class="error">{{ room()!.phase !== 'lobby' ? 'המשחק בחדר הזה כבר התחיל. בקשו מהמארח לפתוח משחק חוזר או צרו חדר חדש.' : 'החדר מלא.' }}</p>
        }
        <div class="layout">
          <section class="chars" role="radiogroup" aria-label="בחירת דמות">
            @for (c of characters; track c.id) {
              <button class="char" role="radio" [attr.aria-label]="c.name + ' — ' + c.tagline" [attr.aria-checked]="characterId() === c.id" [class.sel]="characterId() === c.id" (click)="pick(c.id)">
                <img [src]="c.image" [alt]="'דמות ' + c.name" />
                <b>{{ c.name }}</b>
                <span>{{ c.tagline }}</span>
                <px-icon [name]="c.icon" [size]="22" />
              </button>
            }
          </section>
          <section class="card custom">
            <px-avatar-preview class="preview" [characterId]="characterId()" [appearance]="appearance()" />
            <div class="opts">
              <div class="opt"><span>גוון פנים</span>
                <div class="swatches">@for (c of skins; track $index) {
                  <button [style.background]="c" [class.sel]="appearance().skin === $index" (click)="setA('skin', $index)" [attr.aria-label]="'גוון ' + ($index + 1)"></button> }</div></div>
              <div class="opt"><span>שיער</span>
                <div class="swatches">@for (c of hairs; track $index) {
                  <button [style.background]="c" [class.sel]="appearance().hair === $index" (click)="setA('hair', $index)" [attr.aria-label]="'שיער ' + ($index + 1)"></button> }</div></div>
              <div class="opt"><span>תיק</span>
                <div class="swatches">@for (c of bags; track $index) {
                  <button [style.background]="c" [class.sel]="appearance().bag === $index" (click)="setA('bag', $index)" [attr.aria-label]="'תיק ' + ($index + 1)"></button> }</div></div>
              <label class="opt check"><input type="checkbox" [checked]="!!appearance().glasses" (change)="setA('glasses', $any($event.target).checked ? 1 : 0)" /> משקפיים</label>
            </div>
            <form (submit)="$event.preventDefault(); join()">
              <div class="field">
                <label for="nick">הכינוי שלכם במשחק</label>
                <input id="nick" [value]="nickname()" (input)="nickname.set($any($event.target).value)" maxlength="16" placeholder="לדוגמה: יוסי" autocomplete="nickname" />
                <small class="muted">לא צריך שם מלא — רק כינוי. עד 16 תווים.</small>
              </div>
              @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
              <button class="btn primary" type="submit" [disabled]="busy() || !room()!.canJoin || nickname().trim().length < 2">
                {{ busy() ? 'מצטרפים...' : 'כניסה לחדר ההמתנה' }}
              </button>
            </form>
          </section>
        </div>
      }
    </main>
  `,
  styles: [`
    main { max-width: 1100px; margin: 0 auto; padding: 16px; background: radial-gradient(ellipse at top, #1a2550, transparent 70%); min-height: 100dvh; }
    .back { display:inline-block; margin-bottom: 1rem; text-decoration:none; }
    header h1 { font-size: 2.4rem; margin: .4rem 0; }
    .layout { display:grid; grid-template-columns: 1.3fr 1fr; gap: 1.2rem; margin-top: 1rem; }
    .chars { display:grid; grid-template-columns: repeat(2, 1fr); gap: .9rem; align-content: start; }
    .char { display:flex; flex-direction:column; align-items:center; gap:.25rem; padding: .8rem; border-radius: 16px; cursor:pointer; color: var(--text);
      background: linear-gradient(180deg, #17224a, #0c1330); border: 2px solid rgba(201,162,77,.3); font-family: inherit; transition: transform .15s, border-color .15s; }
    .char img { width: 100%; max-width: 170px; aspect-ratio: 158/195; object-fit: cover; border-radius: 12px; }
    .char b { font-family: var(--font-title); font-size: 1.4rem; color: var(--gold-2); }
    .char span { font-size: .9rem; color: var(--muted); }
    .char px-icon { color: var(--gold); }
    .char:hover { transform: translateY(-2px); }
    .char.sel { border-color: var(--gold-2); box-shadow: 0 0 24px rgba(224,185,92,.35); }
    .custom { display:flex; flex-direction:column; gap: 1rem; }
    .preview { height: 260px; background: radial-gradient(circle at 50% 60%, #263472, #0c1330 70%); border-radius: 12px; }
    .opts { display:grid; gap:.6rem; } .opt { display:flex; align-items:center; justify-content:space-between; gap:.6rem; }
    .swatches { display:flex; gap:.4rem; } .swatches button { width: 32px; height: 32px; border-radius: 50%; border: 2px solid rgba(255,255,255,.25); cursor:pointer; }
    .swatches button.sel { border-color: var(--gold-2); box-shadow: 0 0 0 3px rgba(224,185,92,.4); }
    .check { justify-content:flex-start; } .check input { width:20px; height:20px; accent-color: var(--gold); }
    form { display:flex; flex-direction:column; gap: .8rem; }
    .center { max-width: 520px; margin: 3rem auto; text-align:center; }
    @media (max-width: 820px) { .layout { grid-template-columns: 1fr; } .chars { grid-template-columns: repeat(2, 1fr); } }
  `],
})
export class JoinPage implements OnInit {
  code = input.required<string>();
  private api = inject(ApiService);
  private router = inject(Router);
  private audio = inject(AudioService);
  characters = CHARACTERS;
  skins = SKIN_TONES;
  hairs = HAIR_COLORS;
  bags = BAG_COLORS;
  room = signal<RoomInfo | null>(null);
  loading = signal(true);
  busy = signal(false);
  error = signal<string | null>(null);
  nickname = signal('');
  characterId = signal<CharacterId>('explorer');
  appearance = signal<Appearance>({ ...characterInfo('explorer').defaults });
  isHostCreator = computed(() => !!sessionStore.hostClaim(this.code().toUpperCase()));

  async ngOnInit() {
    const code = this.code().toUpperCase();
    const existing = sessionStore.get();
    if (existing && existing.code === code) {
      this.router.navigate(['/room', code]);
      return;
    }
    try {
      this.room.set(await this.api.room(code));
    } catch (e: any) {
      this.error.set(e.message);
    } finally {
      this.loading.set(false);
    }
  }

  pick(id: CharacterId) {
    this.audio.sfx('click');
    this.characterId.set(id);
    this.appearance.set({ ...characterInfo(id).defaults });
  }

  setA(key: keyof Appearance, v: number) {
    this.appearance.update((a) => ({ ...a, [key]: v }));
  }

  async join() {
    const room = this.room();
    if (!room) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const r = await this.api.join(room.code, this.nickname().trim(), this.characterId(), this.appearance(), sessionStore.hostClaim(room.code));
      sessionStore.set({ code: room.code, roomId: r.roomId, playerId: r.playerId, token: r.token });
      this.audio.sfx('success');
      this.router.navigate(['/room', room.code]);
    } catch (e: any) {
      this.error.set(e.message);
    } finally {
      this.busy.set(false);
    }
  }
}
