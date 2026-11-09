import {
  AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, NgZone, OnDestroy, computed, effect, inject, output, signal, untracked, viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { AudioService, Sfx, ThemeId } from '../core/audio.service';
import { GameService } from '../core/game.service';
import { GameNotice, RoomSnapshot } from '../core/models';
import { SettingsService } from '../core/settings.service';
import { ChatComponent } from '../ui/chat.component';
import { JoystickComponent } from '../ui/joystick.component';
import { SettingsPanelComponent } from '../ui/settings-panel.component';
import { LeaveDialogComponent } from '../ui/leave-dialog.component';
import { RoomOverlaysComponent } from '../ui/room-overlays.component';
import { H_INTERACTABLES, H_ZONES, HInteractable, HPanel, HZone, useLayout } from './sm-layout';
import { SmPanelComponent, ITEM_EMOJI } from './sm-panel.component';
import { MazePadComponent } from '../hanukkah/maze-pad.component';
import { SmResultComponent } from './sm-result.component';
import { StoneMazeWorld } from './sm-world';
import { mapPieceImages } from './stone-hall';
import { runeSchedule } from './rune-disc';

interface Toast { id: number; text: string; kind: string }

const PUZZLE_PANEL: Record<string, HPanel> = {
  'h1-board': 'board', 'h1-book': 'book', 'h2-wicks': 'wicks', 'h2-test': 'lamptest', 'h2-blueprint': 'blueprint', 'h4-sequence': 'sequence', 'h4-mirror': 'mirror', 'h5-spin': 'spin', 'h5-memory': 'memory', 'h5-corners': 'corners', 'h6-shelf': 'shelf', 'h6-scales': 'oilscale',
  'h1-riddle': 'riddle', 'h2-lamp': 'lamp', 'h3-maze': 'maze', 'h3-box': 'box', 'h4-wheel': 'wheel', 'h5-stand': 'stand',
  'g1-cabinet': 'cabinet',
  'h5-lock': 'lock', 'h6-jugs': 'jugs', 'h7-mosaic': 'mosaic', 'h8-pedestals': 'pedestals', 'h8-final': 'final',
};

/** The mood of each room of the Hanukkah journey. */
const HANUKKAH_MUSIC: Partial<Record<HZone, ThemeId>> = {
  library: 'mystery', workshop: 'mechanism', maze: 'dungeon', cipher: 'riddle', dreidels: 'hanukkah', lab: 'riddle', mosaic: 'magic', hall: 'ascent',
};

/** Tables used in the room itself (drag and drop), by puzzle — the object a task's guide arrow points at. */
const BENCH_PANEL: Record<string, HPanel> = {
  'h2-lamp': 'lamp', 'h5-stand': 'stand', 'h3-maze': 'maze', 'g1-map': 'assembly', 'g1-pendulum': 'pendulum', 'g1-runes': 'runes', 'g2-levers': 'levers', 'g2-rails': 'rails', 'g2-gravity': 'gravity', 'g2-gate': 'gate', 'g1-symbols': 'symbols', 'g2-gears': 'gears', 'h7-scales': 'scales', 'g2-scales': 'scales',
};

/** The Stone Hall's mechanisms worked from the bar while the camera watches them (not the drag-and-drop tables). */
const WATCH = new Set(['g1-pendulum', 'g1-map', 'g1-runes', 'g1-cabinet', 'g2-levers', 'g2-rails', 'g2-gravity', 'g2-gate']);

/** The Hanukkah game: opening scene, eight rooms, puzzles, scores, chat, finale and results. */
/** The sound of each solved puzzle, heard once by every player with its celebration (spec 3, 4). */
const SOLVE_SOUND: Record<string, Sfx> = {
  'g1-map': 'decode', 'g1-pendulum': 'success', 'g1-runes': 'success', 'g1-door': 'door', 'g1-chest': 'cabinet', 'g2-levers': 'mechanism', 'g2-rails': 'beam', 'g2-gravity': 'cabinet', 'g2-gate': 'gate', 'g1-symbols': 'success', 'g1-cabinet': 'cabinet', 'g2-gears': 'mechanism', 'h7-scales': 'gate', 'g2-scales': 'gate', 'g2-chest': 'cabinet',
  'h1-riddle': 'decode', 'h2-lamp': 'beam', 'h3-maze': 'success', 'h3-box': 'drawer', 'h4-wheel': 'decode',
  'h5-stand': 'success', 'h5-lock': 'codeOk', 'h6-jugs': 'oil', 'h7-mosaic': 'beam', 'h8-pedestals': 'success',
};

/** Laying a part in its place on a table: map paper, a gear on its axle, a dreidel on its stand. */
const PLACE_SOUND: Record<string, Sfx> = { 'g1-map': 'paper', 'g2-gears': 'gear', 'h7-scales': 'scale', 'g2-scales': 'scale', 'g1-symbols': 'place', 'h5-stand': 'place', 'h2-lamp': 'place' };

function pickupSound(item: string): Sfx {
  if (item.startsWith('map-')) return 'find';
  if (item.startsWith('gear-')) return 'metal';
  if (item.startsWith('dreidel-')) return 'spin';
  return 'pickup';
}

@Component({
  selector: 'px-sm-play',
  imports: [RouterLink, ChatComponent, JoystickComponent, SettingsPanelComponent, SmPanelComponent, SmResultComponent, RoomOverlaysComponent, LeaveDialogComponent, MazePadComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stage">
      <canvas #c tabindex="0" aria-label="עולם המשחק התלת־ממדי. השתמשו במקשי החיצים לתנועה ובעכבר לסיבוב."></canvas>
      @if (loading()) { <div class="loading">מכינים את האחוזה...</div> }
    </div>

    @if (phase() === 'intro') {
      <div class="letterbox top"></div><div class="letterbox bottom"></div>
      @if (introT() < 9) {
        <div class="title-card"><h1 class="gold-title">PORTAL X</h1><p>{{ texts().title }}</p></div>
      } @else {
        <div class="mission card">
          <span class="chip">המשימה שלכם</span>
          <h2>{{ texts().mission }}</h2>
          <ul>
            <li>{{ texts().rooms }}</li>
            <li>חקרו, אספו חפצים, פענחו רמזים והפעילו מנגנונים — יחד</li>
            <li>כל הקבוצה מתקדמת יחד, ולכל אחד ניקוד אישי משלו</li>
          </ul>
        </div>
      }
      <div class="cine-actions">
        @if (game.isHost()) { <button class="btn small" (click)="skipIntro()">דילוג על הפתיחה ›</button> }
        @else { <span class="muted small">רק המארח יכול לדלג על הפתיחה</span> }
      </div>
    }

    @if (phase() === 'playing') {
      <div class="hud-col">
      <header class="hud-top">
        <div class="zone card">
          <b>{{ zoneName(zone()) }}</b>
          <span class="muted small">חדר {{ zoneIndex(zone()) }} מתוך {{ zoneCount() }}</span>
          <span class="timer" aria-label="זמן משחק">{{ elapsed() }}</span>
        </div>
        <div class="tools">
          @if (testimonyReady()) { <button class="btn small testimony-btn" (click)="openTestimony()">📜 העדות שלי</button> }
          <button class="btn small" (click)="showHelp.set(!showHelp())">עזרה</button>
          <button class="btn small snd" (click)="toggleSound('musicOn')" [class.off]="!settings.settings().musicOn" [attr.aria-pressed]="settings.settings().musicOn"
            [attr.aria-label]="settings.settings().musicOn ? 'השתקת מוזיקת הרקע' : 'הפעלת מוזיקת הרקע'" [title]="settings.settings().musicOn ? 'מוזיקה פועלת' : 'מוזיקה מושתקת'">🎵</button>
          <button class="btn small snd" (click)="toggleSound('effectsOn')" [class.off]="!settings.settings().effectsOn" [attr.aria-pressed]="settings.settings().effectsOn"
            [attr.aria-label]="settings.settings().effectsOn ? 'השתקת האפקטים הקוליים' : 'הפעלת האפקטים הקוליים'" [title]="settings.settings().effectsOn ? 'אפקטים פועלים' : 'אפקטים מושתקים'">🔔</button>
          <button class="btn small" (click)="showSettings.set(true)">הגדרות</button>
          <button class="btn small ghost" (click)="confirmLeave()">יציאה</button>
        </div>
      </header>

      <aside class="score card" aria-label="לוח ניקוד">
        <div class="score-head"><span>ניקוד קבוצתי</span><b>{{ game.snapshot()!.score?.group ?? 0 }}</b></div>
        <ol>
          @for (p of game.snapshot()!.score?.players ?? []; track p.playerId) {
            <li [class.me]="p.playerId === game.playerId()">
              <span class="rank">{{ p.rank }}</span><span class="nm">{{ p.nickname }}</span><b>{{ p.points }}</b>
              @for (f of floatsFor(p.playerId); track f.id) { <span class="float">{{ f.text }}</span> }
            </li>
          }
        </ol>
      </aside>

      <aside class="objectives card" [class.collapsed]="!showObjectives()" [class.glow]="objFlash()" [style.display]="focus() ? 'none' : null">
        <button class="obj-head" (click)="showObjectives.set(!showObjectives())" [attr.aria-expanded]="showObjectives()">
          <b>המשימות בחדר</b><span>{{ showObjectives() ? '−' : '+' }}</span></button>
        @if (showObjectives()) {
          <ul>
            @for (p of objectives(); track p.id) {
              <li [class.done]="p.status === 'solved'" [class.locked]="p.status === 'locked'" [class.current]="p.id === activeObjective()" [class.flash]="objFlash() && p.id === activeObjective()"
                [attr.aria-current]="p.id === activeObjective() ? 'step' : null">
                <span class="box">{{ p.status === 'solved' ? '✓' : p.status === 'locked' ? '🔒' : p.id === activeObjective() ? '➤' : '' }}</span>{{ p.objective }}@if (p.bonus) { <small class="bonus-tag">בונוס</small> }
              </li>
            }
          </ul>
          @if (myTask(); as t) {
            <div class="mytask" [class.done]="t.done" aria-label="המשימה האישית הסודית שלכם">
              <b>🎯 משימה אישית סודית</b>
              <span>{{ t.done ? (t.found || 'הושלמה') : t.text }}</span>
              <small>{{ t.done ? '✓ הושלמה — 20 נקודות אישיות' : 'רק אתם רואים אותה · 20 נקודות אישיות' }}</small>
            </div>
          }
          <p class="players-line">
            @for (pl of game.snapshot()!.players; track pl.id) { <span [class.off]="!pl.isConnected">● {{ pl.nickname }}</span> }
          </p>
        }
      </aside>
      </div>

      @if (focus(); as f) {
        @if (benchClosed()) {
          <div class="bench-closed">
            <button class="btn small primary" (click)="benchClosed.set(false)" aria-label="פתיחת חלונית ההוראות">📋 הוראות</button>
            <button class="btn small" (click)="exitBench()">↩ חזרה לחדר</button>
          </div>
        } @else {
        <section #benchEl class="bench card" role="region" [attr.aria-label]="focusPuzzle()?.title" [class.maze]="f === 'h3-maze'" [class.min]="benchMin()" [class.moved]="!!benchPos()"
          [style.left.px]="benchPos()?.x" [style.top.px]="benchPos()?.y"
          (pointerdown)="$event.stopPropagation()" (pointermove)="$event.stopPropagation()" (pointerup)="$event.stopPropagation()" (wheel)="$event.stopPropagation()">
          <header class="b-drag" (pointerdown)="benchDragStart($event, benchEl)" title="גררו כדי להזיז את החלונית">
            <span class="grip" aria-hidden="true">⠿</span>
            <b>{{ focusPuzzle()?.title }}</b>
            <span class="b-win">
              @if (benchPos()) { <button class="btn small ghost" (click)="benchPos.set(null)" aria-label="החזרת החלונית למקומה" title="החזרה למקום">↺</button> }
              <button class="btn small ghost" (click)="benchMin.set(!benchMin())" [attr.aria-label]="benchMin() ? 'הרחבת החלונית' : 'מזעור החלונית'" [attr.aria-expanded]="!benchMin()"
                [title]="benchMin() ? 'הרחבה' : 'מזעור'">{{ benchMin() ? '▢' : '—' }}</button>
              <button class="btn small ghost" (click)="benchClosed.set(true)" aria-label="סגירת חלונית ההוראות" title="סגירה">✕</button>
            </span>
          </header>
          @if (!benchMin()) {
          <div class="b-body">
          <button class="btn small ghost b-exit" (click)="exitBench()">↩ חזרה לחדר</button>
          @if (focusState()?.status === 'solved') {
            <p class="b-ok">{{ FOCUS_DONE[f] }}</p>
            @if (f === 'g2-gravity') {
              <!-- the cell is open: the exit code, and the rod still turns the room back -->
              @if (grav().code) { <p class="reveal">🔑 קוד היציאה בתא הסודי: <b dir="ltr" class="code-big">{{ grav().code }}</b></p> }
              @if (grav().flipped || grav().turning) {
                <button class="btn primary" (click)="opSimple('g2-gravity', { op: 'flip' })" [disabled]="benchBusy() || grav().turning">⟲ החזרת החדר למצבו הרגיל</button>
              }
            }
          } @else {
            @if (f === 'h3-maze') {
              <p class="muted small">סמלים שהמפתח עבר לפי הסדר: {{ game.snapshot()?.mechanisms?.['h3-maze']?.progress ?? 0 }} מתוך 3</p>
            }
            <p class="b-ins">{{ (f === 'g1-runes' && soloRunes() ? RUNES_SOLO_HELP : FOCUS_HELP[f]) || focusPuzzle()?.instructions }}</p>
            @if (f !== 'h3-maze' && !isWatch(f) && !benchHasParts()) { <p class="muted small">{{ EMPTY_LABEL[f] }}</p> }
            @if (f === 'g1-pendulum') {
              <!-- the pendulum: the press is timed on the finger going down (not on release), on the server's clock -->
              <div class="pend">
                <div class="pend-rounds" role="group" [attr.aria-label]="'סבב ' + pend().round + ' מתוך 3'">
                  @for (k of [0, 1, 2]; track k) { <span class="dot" [class.done]="k < pend().progress" [class.now]="k === pend().progress">{{ k + 1 }}</span> }
                  <small class="muted">סבב {{ pend().round }} מתוך 3</small>
                </div>
                @if (pend().running) {
                  <button class="btn primary freeze" (pointerdown)="freezePendulum($event)" (keydown.enter)="freezePendulum($event)" (keydown.space)="freezePendulum($event)">❄ הקפאה!</button>
                } @else {
                  <button class="btn primary big" (click)="startPendulum()" [disabled]="benchBusy()">▶ הפעלה</button>
                }
                @if (pend().widened) { <p class="muted small">האזור המסומן התרחב — עכשיו קל יותר.</p> }
              </div>
            }
            @if (f === 'g1-map') {
              <div class="map-tiles" dir="ltr" role="group" aria-label="שלושת חלקי המפה, משמאל לימין">
                @for (p of mapPieces(); track p.id) {
                  <div class="tile" [class.picked]="mapPick() === p.id">
                    <button class="tile-img" (click)="pickPiece(p.id)" [disabled]="benchBusy()" [attr.aria-pressed]="mapPick() === p.id" [attr.aria-label]="p.label + ' — בחירה להחלפה'">
                      <img [src]="p.img" alt="" [style.transform]="'rotate(' + p.turns * 90 + 'deg)'" />
                    </button>
                    <button class="btn small" (click)="rotatePiece(p.id)" [disabled]="benchBusy()" [attr.aria-label]="'סיבוב ' + p.label">⟳ סיבוב</button>
                  </div>
                }
              </div>
              @if (mapPick()) { <p class="muted small">עכשיו געו בחלק אחר כדי להחליף ביניהם.</p> }
            }
            @if (f === 'g1-cabinet') {
              <div class="wheels-bar" dir="ltr" role="group" aria-label="ארבעת גלגלי הארון, משמאל לימין">
                @for (w of cabWheels(); track $index) {
                  <button class="stone" (click)="turnWheel($index)" [disabled]="benchBusy()" [attr.aria-label]="'גלגל ' + ($index + 1) + ': ' + w.label + ' — סיבוב'">
                    <span class="glyph">{{ w.emoji }}</span><small>{{ w.label }}</small>
                  </button>
                }
              </div>
              @if (cab().ready) {
                <p class="reveal">בגב הגלגלים חרוטות אותיות עתיקות:
                  @for (l of cab().letters; track $index) { <b class="back-cell">גלגל {{ $index + 1 }}: {{ l }}</b> }
                </p>
                <div class="code-row">
                  <input class="code" inputmode="numeric" maxlength="4" placeholder="– – – –" [value]="codeText()" (input)="setCode($event)" aria-label="קוד בן ארבע ספרות" />
                  <button class="btn primary" (click)="submitCode('g1-cabinet')" [disabled]="benchBusy() || codeText().length !== 4">🔓 פתיחה</button>
                </div>
              } @else {
                <p class="muted small">לוחית המספרים מכוסה באבן. כוונו את ארבעת הגלגלים.</p>
              }
            }
            @if (f === 'g2-levers') {
              <p class="target-line" dir="ltr">🎯 A = 2 · B = 2 · C = 2</p>
              <div class="wheels-bar" dir="ltr" role="group" aria-label="שלושת המנופים">
                @for (l of leverRows(); track l.name) {
                  <button class="stone lever" (click)="pullLever(l.name)" [disabled]="benchBusy()" [class.ok]="l.value === 2" [attr.aria-label]="'מנוף ' + l.name + ', המד מראה ' + l.value + ' — משיכה'">
                    <span class="glyph">{{ l.value }}</span><small>מנוף {{ l.name }}</small>
                  </button>
                }
              </div>
              <button class="btn small" (click)="opSimple('g2-levers', { op: 'reset' })" [disabled]="benchBusy()">↺ החזרת השרשראות</button>
            }
            @if (f === 'g2-rails') {
              <p class="rail-where" aria-live="polite">{{ railWhere() }}</p>
              @if (railCanStart()) {
                <button class="btn primary big" (click)="opSimple('g2-rails', { op: 'start' })" [disabled]="benchBusy()">⚡ שיגור</button>
              } @else {
                <div class="wheels-bar three" role="group" aria-label="בחירת מסילה בצומת">
                  @for (rl of RAILS; track rl.id) {
                    <button class="stone" (click)="opSimple('g2-rails', { op: 'choose', rail: rl.id })" [disabled]="benchBusy() || railMoving()" [attr.aria-label]="'מסילת ה' + rl.label">
                      <span class="glyph">{{ rl.emoji }}</span><small>{{ rl.label }}</small>
                    </button>
                  }
                </div>
              }
              <p class="muted small">„הליבה מחכה תחת הכוכב.”</p>
            }
            @if (f === 'g2-gravity') {
              <p class="rune-clue">📜 „כאשר העולם מתהפך, האמת שהוסתרה מתגלה. תחילה הסימן שזוכר, אחריו הסימן שמאזן, ולבסוף הסימן שמוביל את הדרך.”</p>
              @if (grav().code) {
                <p class="reveal">🔑 קוד היציאה בתא הסודי: <b dir="ltr" class="code-big">{{ grav().code }}</b></p>
              }
              <button class="btn" [class.primary]="!grav().flipped || grav().solved" (click)="opSimple('g2-gravity', { op: 'flip' })" [disabled]="benchBusy() || grav().turning">
                {{ grav().flipped ? '⟲ החזרת החדר למצבו הרגיל' : '⟳ הפעלת מוט הכבידה' }}
              </button>
              @if (grav().flipped && !grav().solved && !grav().turning) {
                <div class="wheels-bar three" role="group" aria-label="שלושת הסימנים שנחשפו — געו בהם לפי הסדר">
                  @for (sg of gravSigns(); track sg.id) {
                    <button class="stone" (click)="pickSign(sg.id)" [disabled]="benchBusy() || signOrder().includes(sg.id)">
                      <span class="glyph">{{ sg.emoji }}</span><small>{{ sg.label }}</small>
                    </button>
                  }
                </div>
                <div class="rune-input">@for (k of [0, 1, 2]; track k) { <span class="slot" [class.full]="!!signOrder()[k]">{{ signEmoji(signOrder()[k]) }}</span> }</div>
              }
            }
            @if (f === 'g2-gate') {
              @if (grav().flipped) {
                <p class="b-msg bad">החדר עדיין הפוך — אי אפשר להגיע לשער. החזירו אותו בעזרת מוט הכבידה.</p>
              } @else {
                <div class="code-row">
                  <input class="code" inputmode="numeric" maxlength="4" placeholder="– – – –" [value]="codeText()" (input)="setCode($event)" aria-label="קוד היציאה" />
                  <button class="btn primary" (click)="submitCode('g2-gate')" [disabled]="benchBusy() || codeText().length !== 4">🚪 פתיחת השער</button>
                </div>
              }
            }
            @if (f === 'g1-runes') {
              <div class="runes">
                <div class="pend-rounds" role="group" [attr.aria-label]="'שלב ' + runes().stage + ' מתוך 3'">
                  @for (k of [0, 1, 2]; track k) { <span class="dot" [class.done]="k < runes().progress" [class.now]="k === runes().progress">{{ k + 1 }}</span> }
                  <small class="muted">שלב {{ runes().stage }} מתוך 3 · {{ runes().length }} סמלים</small>
                </div>
                @if (runes().progress >= 1) {
                  @for (c of runeClues(); track c.index) {
                    <p class="rune-clue">🔒 @if (c.away) { <small>(של {{ c.from }}, שאינו במשחק כרגע)</small> } @else if (soloRunes()) { <small>זכרו את הסמל שהאיר בחושך:</small> } @else { <small>רק את/ה רואה את זה — ספרו לשאר!</small> } {{ c.text }}</p>
                  }
                }
                @if (runes().showing) {
                  <p class="rune-watch" [class.dark]="!!runeLightLabel()" aria-live="polite">👀 צפו בלוח… {{ runeLightLabel() }}</p>
                } @else {
                  <button class="btn" (click)="showRunes()" [disabled]="benchBusy()">▶ {{ runes().started ? 'הצגה חוזרת' : 'הצגת הרצף' }}</button>
                }
                <div class="rune-stones" dir="ltr" role="group" aria-label="אבני הרון, משמאל לימין">
                  @for (st of runeStones(); track st.id) {
                    <button class="stone" (click)="pressRune(st.id)" [disabled]="benchBusy() || runes().showing || !runes().started" [attr.aria-label]="'אבן ה' + st.label">
                      <span class="glyph">{{ st.emoji }}</span><small>{{ st.label }}</small>
                    </button>
                  }
                </div>
                <div class="rune-input" aria-label="מה נלחץ עד עכשיו">
                  @for (k of runeSlots(); track $index) { <span class="slot" [class.full]="!!k">{{ k }}</span> }
                </div>
              </div>
            }
            @if (f === 'g1-symbols' && testimonies().length) {
              <ul class="b-notes" aria-label="העדויות שלכם">
                @for (t of testimonies(); track t.index) { <li>📜 <b>{{ t.title }}</b>@if (t.away) { <small class="muted"> (של {{ t.from }}, שאינו במשחק כרגע)</small> }: {{ t.text }}</li> }
              </ul>
            }
            @if (f === scalesId() && scaleNotes().length) {
              <ul class="b-notes" aria-label="החריטות שמצאתם">@for (n of scaleNotes(); track n) { <li>📜 {{ n }}</li> }</ul>
            }
            @if (benchMsg(); as m) { <p class="b-msg" [class.bad]="!m.ok" role="status">{{ m.text }}</p> }
            @for (h of focusState()?.hints ?? []; track $index) { <p class="b-hint">💡 {{ h }}</p> }
            <div class="b-actions">
              @if (f !== 'h3-maze' && !isWatch(f)) {
                <button class="btn primary" (click)="checkBench()" [disabled]="benchBusy()">{{ CHECK_LABEL[f] ?? 'בדוק סידור' }}</button>
                <button class="btn" (click)="resetBench()" [disabled]="benchBusy()">{{ RESET_LABEL[f] ?? 'החזר חלקים' }}</button>
              }
              @if (benchMsg() && !benchMsg()!.ok) { <button class="btn" (click)="benchMsg.set(null)">נסה שוב</button> }
              @if ((focusState()?.hintsRevealed ?? 0) < (focusPuzzle()?.hintCount ?? 0)) {
                <button class="btn small ghost" (click)="benchHint()" [disabled]="benchBusy()">💡 רמז (−{{ game.scenario()?.scoring?.hintPenalty ?? 10 }})</button>
              }
            </div>
          }
          </div>
          }
        </section>
        }
        @if (f === 'h3-maze' && focusState()?.status !== 'solved') {
          <!-- the arrows live in their own small dock, apart from the instructions: closing or folding the instructions never
               hides them, and folded arrows leave a button that always brings them back -->
          @if (padHidden()) {
            <button class="btn primary pad-show" (click)="padHidden.set(false)" aria-label="הצגת לוח החיצים">🎮 חיצים</button>
          } @else {
            <aside class="maze-dock card" aria-label="לוח החיצים להזזת המפתח"
              (pointerdown)="$event.stopPropagation()" (pointermove)="$event.stopPropagation()" (pointerup)="$event.stopPropagation()" (wheel)="$event.stopPropagation()">
              <button class="btn small ghost dock-hide" (click)="padHidden.set(true)" aria-label="הסתרת לוח החיצים">▾ הסתרה</button>
              <px-maze-pad compact (blocked)="world?.shakeMazeKey()" />
            </aside>
          }
        }
      }

      @if (hover(); as h) { <div class="hover-label">@if (h.kind !== 'decor') { <span aria-hidden="true">👆 </span> }{{ h.label }} <small>· {{ h.verb }}</small></div> }

      <footer class="hud-bottom">
        <div class="inventory card" aria-label="תיק החפצים של הקבוצה">
          <span class="muted small">תיק הקבוצה</span>
          @for (id of game.snapshot()!.inventory; track id) {
            <button class="inv-item" (click)="inspectItem(id)" [attr.aria-label]="itemName(id)"><span class="em">{{ emoji(id) }}</span><small>{{ itemName(id) }}</small></button>
          } @empty { <span class="muted small">ריק — חפשו וחקרו בחדר</span> }
        </div>
        <div class="right-tools">
          <button class="btn" (click)="openHint()">💡 רמז</button>
          <button class="btn" (click)="showChat.set(!showChat())">צ׳אט @if (unread()) { <span class="badge">{{ unread() }}</span> }</button>
        </div>
      </footer>

      @if (showChat() && !panel()) {
        <section class="chat-pop card" [class.pulse]="chatPulse()" aria-label="צ׳אט הקבוצה">
          <header><b>צ׳אט הקבוצה</b><button class="btn small ghost" (click)="showChat.set(false)" aria-label="סגירת הצ׳אט">✕</button></header>
          <px-chat [system]="system()" />
        </section>
      }

      @if (showHelp()) {
        <section class="help card" aria-label="איך משחקים">
          <header><b>איך משחקים</b><button class="btn small ghost" (click)="showHelp.set(false)" aria-label="סגירה">✕</button></header>
          <ul>
            <li>תנועה: החיצים או W A S D · סיבוב המצלמה: גרירה עם העכבר או האצבע</li>
            <li>לחצו על חפצים בחדר: בדיקה, הרמה, פתיחה, סיבוב, הנחה, הפעלה או קריאה</li>
            <li>גילוי רמז, הפעלת מנגנון והנחת פריט במקום מזכים בניקוד אישי. רמז רשמי מוריד 10 נקודות מהניקוד הקבוצתי של החדר</li>
            <li>כשחדר נפתר, כל הקבוצה עוברת יחד לחדר הבא</li>
          </ul>
          <button class="btn small primary" (click)="showHelp.set(false)">הבנתי</button>
        </section>
      }

      @if (touch && !focus()) {
        <px-joystick class="joy" (changed)="world?.setJoystick($event.x, $event.y)" />
      }
    }

    @if (note(); as n) {
      <div class="overlay" (click)="note.set(null)">
        <section class="panel-modal note" role="dialog" aria-modal="true" (click)="$event.stopPropagation()">
          <header><h2>{{ n.title }}</h2><button class="btn small ghost" (click)="note.set(null)" aria-label="סגירה">✕</button></header>
          <p class="note-text">{{ n.text }}</p>
          @if (n.by) { <p class="muted small">{{ n.by }}</p> }
        </section>
      </div>
    }

    @if (celebration(); as c) {
      <div class="celebrate" role="alert" aria-live="assertive">
        <div class="card-c">
          <span class="emoji" aria-hidden="true">{{ isSample() ? '✨' : '🕎' }}</span>
          <h2>{{ c.name }} {{ c.verb }}!</h2>
          <p class="what">{{ c.what }}</p>
          @if (c.points) { <p class="pts">+{{ c.points }} נקודות אישיות על החידה</p> }
          @if (c.next) { <small>המטרה הבאה: {{ c.next }}</small> }
          <button class="btn small" (click)="celebration.set(null)">המשך</button>
        </div>
      </div>
    }
    @if (transfer(); as t) { <div class="transfer" role="status"><span>{{ t }}</span></div> }
    <px-room-overlays [holdSeconds]="game.snapshot()?.pendingZone === 'maze' ? 15 : 7" />
    @if (phase() === 'playing' && game.hostAway()) {
      <div class="host-away" role="status">המארח אינו מחובר כרגע.
        <button class="btn small" (click)="claimHost()">אני אהיה המארח</button></div>
    }
    @if (showLeave()) { <px-leave-dialog (later)="leave.emit()" (forGood)="leaveForGood.emit()" (cancel)="showLeave.set(false)" /> }

    @if (testimonyOpen() && testimonyReady()) {
      <section class="testimony card" role="dialog" aria-labelledby="testimony-title" (pointerdown)="$event.stopPropagation()">
        <h2 id="testimony-title" class="gold-title">{{ testimonies().length > 1 ? 'העדויות הסודיות שלכם' : 'העדות הסודית שלכם' }}</h2>
        <p class="muted small">{{ game.snapshot()!.players.length > 1 ? 'רק אתם רואים את זה. ספרו לשאר הקבוצה מה כתוב כאן — בצ׳אט או בקול — ויחד תגלו את הסדר.' : 'אתם משחקים לבד, ולכן כל ארבע העדויות אצלכם. חברו ביניהן כדי לגלות את הסדר.' }}</p>
        <ul>
          @for (t of testimonies(); track t.index) {
            <li><b>{{ t.title }}</b>@if (t.away) { <small class="muted"> (של {{ t.from }}, שאינו במשחק כרגע)</small> }<span>{{ t.text }}</span></li>
          }
        </ul>
        <button class="btn primary" (click)="testimonyOpen.set(false)">הבנתי</button>
      </section>
    }
    <div class="toasts" aria-live="polite">
      @for (t of toasts(); track t.id) { <div class="toast" [class]="t.kind">{{ t.text }}</div> }
    </div>

    @if (panel(); as p) { <px-sm-panel [panel]="p.id" [ref]="p.ref" (close)="closePanel()" (wheelChange)="world?.setWheel($event)" (testLamp)="world?.setTestLamp($event)" /> }
    @if (showSettings()) { <px-settings (close)="showSettings.set(false)" /> }

    @if (phase() === 'completed') {
      @if (!showResult()) {
        <div class="letterbox top"></div><div class="letterbox bottom"></div>
        @if (outroT() > 6) {
          <div class="success">
            <h1 class="gold-title">כל הכבוד!</h1>
            <p>{{ texts().done }}</p>
            <button class="btn primary" (click)="showResult.set(true)">לתוצאות ‹</button>
          </div>
        }
      } @else {
        <px-sm-result (home)="leave.emit()" />
      }
    }
  `,
  styles: [`
    :host { display:block; position:fixed; inset:0; overflow:hidden; }
    .stage { position:absolute; inset:0; } canvas { width:100%; height:100%; display:block; outline:none; touch-action:none; cursor:grab; }
    .loading { position:absolute; inset:0; display:grid; place-items:center; font-size:1.4rem; color: var(--gold-2); background: var(--bg); }
    .pend { display:flex; flex-direction:column; align-items:center; gap:.45rem; margin:.3rem 0; }
    .pend-rounds { display:flex; align-items:center; gap:.4rem; }
    .pend-rounds .dot { width:1.7rem; height:1.7rem; border-radius:50%; display:grid; place-items:center; border:2px solid var(--line); font-weight:700; }
    .pend-rounds .dot.done { background:#2a6ab0; border-color:#7cc4ff; color:#fff; }
    .pend-rounds .dot.now { border-color:#7cc4ff; box-shadow:0 0 10px rgba(124,196,255,.6); }
    .freeze { font-size:1.35rem; min-height:3.4rem; min-width:min(16rem, 80%); touch-action:manipulation; user-select:none; }
    .wheels-bar { display:grid; grid-template-columns:repeat(4, 1fr); gap:.4rem; width:100%; margin:.3rem 0; }
    .wheels-bar.three { grid-template-columns:repeat(3, 1fr); }
    .wheels-bar:has(.lever) { grid-template-columns:repeat(3, 1fr); }
    .stone.lever .glyph { font-size:1.9rem; font-weight:800; } .stone.ok { border-color:#3dff9a; }
    .code-row { display:flex; gap:.5rem; align-items:center; justify-content:center; }
    .code { width:8.5rem; font-size:1.6rem; letter-spacing:.35em; text-align:center; direction:ltr; padding:.35rem .5rem; border-radius:10px; border:2px solid var(--line); background:#10161f; color:#fff; }
    .code-big { font-size:1.5rem; letter-spacing:.3em; } .target-line { margin:.1rem 0; font-weight:700; color:#ffe2b0; } .rail-where { margin:.1rem 0; font-weight:700; color:#8ff5ea; }
    .back-cell { display:inline-block; margin:.15rem .3rem; padding:.1rem .5rem; border-radius:8px; background:rgba(255,211,107,.12); }
    .runes { display:flex; flex-direction:column; align-items:center; gap:.45rem; margin:.3rem 0; }
    .rune-stones { display:grid; grid-template-columns:repeat(4, 1fr); gap:.4rem; width:100%; }
    .stone { display:flex; flex-direction:column; align-items:center; gap:.1rem; min-height:4.2rem; border-radius:12px; border:2px solid #3a5a7a;
      background:linear-gradient(#2a3442, #18202b); color:#e8f2ff; cursor:pointer; touch-action:manipulation; }
    .stone .glyph { font-size:1.7rem; line-height:1.1; } .stone:disabled { opacity:.55; cursor:default; }
    .stone:not(:disabled):active { border-color:#7cc4ff; box-shadow:0 0 14px rgba(124,196,255,.7); }
    .rune-input { display:flex; gap:.3rem; } .rune-input .slot { width:2rem; height:2rem; border-radius:8px; border:1px dashed var(--line); display:grid; place-items:center; }
    .rune-input .slot.full { border-style:solid; border-color:#7cc4ff; background:rgba(56,200,255,.15); }
    .rune-watch { margin:0; color:#9fd8ff; font-weight:700; }
    .rune-watch.dark { color:#e2c8ff; padding:.3rem .6rem; border-radius:8px; background:rgba(154,77,255,.28); border:1px solid rgba(190,140,255,.8); box-shadow:0 0 14px rgba(154,77,255,.55); }
    .rune-clue { margin:0; padding:.35rem .5rem; border-radius:8px; background:rgba(154,77,255,.15); border:1px solid rgba(154,77,255,.5); }
    .map-tiles { display:flex; gap:.45rem; justify-content:center; margin:.3rem 0; }
    .map-tiles .tile { display:flex; flex-direction:column; align-items:center; gap:.3rem; }
    .tile-img { width:min(28vw, 7.5rem); aspect-ratio:1; padding:0; border:2px solid var(--line); border-radius:10px; background:#1a1a22; overflow:hidden; cursor:pointer; }
    .tile-img img { width:100%; height:100%; display:block; }
    .tile.picked .tile-img { border-color:#7cc4ff; box-shadow:0 0 12px rgba(124,196,255,.7); }
    .bench { position:fixed; z-index:20; inset-inline:0; margin-inline:auto; bottom:12px; width:min(560px, calc(100% - 24px)); display:flex; flex-direction:column; gap:.4rem;
      background: linear-gradient(180deg, rgba(40,30,8,.92), rgba(14,20,44,.94)); border:1px solid var(--gold); padding:.55rem .8rem; box-sizing:border-box; }
    /* moved by the player: placed by its top-left corner, always kept inside the screen */
    .bench.moved { inset:auto; margin:0; }
    .bench header { display:flex; justify-content:space-between; align-items:center; gap:.5rem; } .bench header b { font-family: var(--font-title); color: var(--gold-2); font-size:1.1rem; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .b-drag { cursor:grab; touch-action:none; user-select:none; -webkit-user-select:none; min-height:36px; } .b-drag:active { cursor:grabbing; }
    .grip { color: var(--gold); font-size:1.1rem; line-height:1; }
    .b-win { display:flex; gap:.2rem; flex-shrink:0; } .b-win .btn { min-width:2.2rem; padding:.3em .55em; }
    .b-body { display:flex; flex-direction:column; gap:.4rem; max-height:min(40vh, 340px); overflow:auto; overscroll-behavior:contain; touch-action:pan-y; }
    .b-exit { align-self:flex-start; }
    .bench-closed { position:fixed; z-index:20; bottom:84px; left:50%; transform:translateX(-50%); display:flex; gap:.4rem; }
    @media (max-height: 560px) { .b-body { max-height:30vh; } .bench { bottom:6px; } }
    /* the maze on a phone held sideways: the panel stands at the side, tall enough for the whole control pad, beside the board */
    @media (max-height: 560px) and (orientation: landscape) {
      .bench.maze:not(.moved) { inset-inline-start:auto; inset-inline-end:8px; margin:0; top:48px; bottom:6px; width:min(320px, 42vw); padding:.45rem .6rem; }
      .bench.maze .b-body { gap:.2rem; }
      .bench.maze .b-body { max-height:none; flex:1; }
    }
    /* the maze: its instructions stand at the top, the arrows in their own dock at a lower corner, away from the key */
    .bench.maze:not(.moved) { top:56px; bottom:auto; }
    .maze-dock { position:fixed; z-index:21; bottom:12px; inset-inline-end:12px; padding:.4rem .5rem .55rem; display:flex; flex-direction:column; gap:.15rem;
      touch-action:none; overscroll-behavior:contain; user-select:none; -webkit-user-select:none; max-width:calc(100% - 24px); }
    .dock-hide { align-self:flex-end; min-height:32px; }
    .pad-show { position:fixed; z-index:21; bottom:16px; inset-inline-end:16px; border-radius:999px; min-height:48px; padding-inline:1.1rem; box-shadow:0 6px 20px rgba(0,0,0,.45); }
    @media (max-height: 560px) and (orientation: landscape) { .maze-dock, .pad-show { inset-inline-end:auto; inset-inline-start:8px; bottom:6px; } }
    .b-ins { margin:0; line-height:1.6; } .b-msg { margin:0; color:#9be3b4; } .b-msg.bad { color:#ffb4a3; } .b-ok { margin:0; color:#9be3b4; font-size:1.1rem; }
    .b-hint { margin:0; color:#cfe2ff; }
    .testimony { position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); z-index:40; width:min(440px, calc(100% - 32px)); max-height:calc(100% - 32px); overflow:auto; display:grid; gap:.6rem; text-align:center; }
    .testimony h2 { margin:0; font-size:1.3rem; }
    .testimony ul { list-style:none; margin:0; padding:0; display:grid; gap:.5rem; text-align:start; }
    .testimony li { display:grid; gap:.15rem; padding:.55rem .7rem; border-radius:10px; background:rgba(242,210,122,.08); border:1px solid rgba(242,210,122,.3); }
    .testimony li span { font-size:1.05rem; color:#f3e2b8; }
    .testimony .btn { justify-self:center; min-width:140px; }
    .b-notes { margin:0; padding:0; list-style:none; display:grid; gap:.2rem; color:#f3e2b8; font-size:.92rem; } .b-actions { display:flex; flex-wrap:wrap; gap:.4rem; align-items:center; }
    @media (max-width: 760px) {
      .bench { bottom:8px; padding:.6rem .7rem; gap:.3rem; }
      .bench .b-ins { font-size:.84rem; line-height:1.45; max-height:4.4em; overflow:auto; }
      .bench .b-actions .btn { padding:.45em .8em; font-size:.88rem; }
    }
    .letterbox { position:fixed; inset-inline:0; height:9vh; background:#000; z-index:5; } .letterbox.top { top:0 } .letterbox.bottom { bottom:0 }
    .title-card { position:fixed; inset:0; display:grid; place-content:center; text-align:center; z-index:6; pointer-events:none; animation: fadein 2s ease; }
    .title-card h1 { font-size: clamp(3rem, 12vw, 7rem); font-weight:900; } .title-card p { font-family: var(--font-title); font-size: clamp(1.2rem, 4vw, 2rem); color: var(--gold-2); text-shadow: 0 2px 10px #000; }
    @keyframes fadein { from { opacity:0; transform: scale(1.05) } }
    .mission { position:fixed; top:14vh; left:0; right:0; margin-inline:auto; z-index:7; max-width:540px; width:calc(100% - 32px); animation: fadein .8s ease both; }
    .mission ul { line-height:1.9; padding-inline-start:1.2rem; }
    .cine-actions { position:fixed; bottom: calc(9vh + 12px); inset-inline-end:16px; z-index:8; }
    /* on a computer the column is only a wrapper: its parts keep their own places */
    .hud-col { display:contents; }
    .hud-top { position:fixed; top:10px; inset-inline:10px; display:flex; gap:.6rem; align-items:flex-start; z-index:10; pointer-events:none; flex-wrap:wrap; }
    .hud-top > * { pointer-events:auto; }
    .zone { display:flex; align-items:center; gap:.6rem; padding:.5rem .9rem; color: var(--gold-2); }
    .timer { color: var(--text); font-variant-numeric: tabular-nums; direction:ltr; }
    .tools { margin-inline-start:auto; display:flex; gap:.4rem; }
    .score { position:fixed; top:66px; inset-inline-end:10px; width:230px; z-index:9; padding:.5rem .7rem; }
    .score-head { display:flex; justify-content:space-between; align-items:center; color: var(--gold-2); } .score-head b { font-size:1.3rem; }
    .score ol { list-style:none; padding:0; margin:.4rem 0 0; display:flex; flex-direction:column; gap:.2rem; }
    .score li { display:flex; gap:.4rem; align-items:center; position:relative; font-size:.92rem; } .score li.me { color: var(--gold-2); }
    .snd { min-width:2.4rem; } .snd.off { opacity:.45; text-decoration:line-through; }
    .score .rank { width:18px; color: var(--muted); } .score .nm { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .float { position:absolute; inset-inline-end:-6px; top:-4px; transform: translateX(-100%); white-space:nowrap; background: rgba(63,191,106,.9); color:#06240f; font-weight:700;
      border-radius:999px; padding:0 .5rem; font-size:.78rem; animation: floatUp 2.6s ease forwards; pointer-events:none; }
    @keyframes floatUp { 0% { opacity:0; transform: translate(-100%, 6px) } 15% { opacity:1 } 80% { opacity:1 } 100% { opacity:0; transform: translate(-100%, -18px) } }
    .objectives { position:fixed; top:66px; inset-inline-start:10px; width:300px; z-index:9; padding:.6rem .9rem; }
    .obj-head { all: unset; cursor:pointer; display:flex; justify-content:space-between; width:100%; color: var(--gold-2); }
    .objectives ul { list-style:none; padding:0; margin:.5rem 0; display:flex; flex-direction:column; gap:.35rem; font-size:.92rem; }
    .objectives li { display:flex; gap:.45rem; align-items:center; } .objectives li.done { color: var(--muted); text-decoration: line-through; } .objectives li.locked { opacity:.55; }
    .mytask { display:flex; flex-direction:column; gap:.15rem; margin:.3rem 0 .4rem; padding:.45rem .6rem; border-radius:10px; font-size:.86rem;
      background: rgba(224,185,92,.1); border:1px dashed var(--gold); }
    .mytask b { color: var(--gold-2); } .mytask small { color: var(--muted); } .mytask.done { border-style:solid; border-color: var(--ok); background: rgba(63,191,106,.1); }
    .box { width:18px; height:18px; border:1px solid var(--gold); border-radius:4px; display:grid; place-items:center; flex-shrink:0; color: var(--ok); font-size:.75rem; }
    /* the task to do now: a soft gold-and-blue frame; right after a task is done the box glows and the next task blinks gently three times */
    .objectives li.current { border:1px solid rgba(246,215,141,.8); border-radius:8px; padding:.2rem .4rem; background: rgba(224,185,92,.1); box-shadow: 0 0 10px rgba(110,160,255,.35); }
    .objectives li.current .box { color: var(--gold-2); }
    .bonus-tag { margin-inline-start:auto; flex-shrink:0; font-size:.72rem; color:#0a1230; background: var(--gold-2); border-radius:999px; padding:0 .45rem; }
    .objectives.glow { animation: objGlow 1.1s ease-in-out 3; }
    .objectives li.flash { animation: objPulse 1.1s ease-in-out 3; }
    @keyframes objGlow { 0%, 100% { box-shadow: var(--shadow); } 50% { box-shadow: 0 0 0 2px var(--gold-2), 0 0 26px rgba(110,160,255,.7); } }
    @keyframes objPulse { 0%, 100% { background: rgba(224,185,92,.1); } 50% { background: rgba(246,215,141,.32); box-shadow: 0 0 16px rgba(246,215,141,.6); } }
    @media (prefers-reduced-motion: reduce) { .objectives.glow, .objectives li.flash { animation:none; } }
    .players-line { display:flex; flex-wrap:wrap; gap:.5rem; font-size:.82rem; margin:0; } .players-line span { color: var(--ok); } .players-line .off { color: var(--muted); }
    .hover-label { position:fixed; top:46%; left:50%; transform: translate(-50%, -140%); background: rgba(0,0,0,.75); padding:.35rem .8rem; border-radius:999px; border:1px solid var(--line); pointer-events:none; z-index:8; white-space:nowrap; }
    .hover-label small { color: var(--gold-2); }
    .hud-bottom { position:fixed; bottom:10px; inset-inline:10px; display:flex; gap:.6rem; align-items:flex-end; z-index:10; pointer-events:none; }
    .hud-bottom > * { pointer-events:auto; }
    .inventory { display:flex; align-items:center; gap:.4rem; padding:.45rem .8rem; flex-wrap:wrap; max-width: calc(100% - 220px); }
    .inv-item { display:flex; flex-direction:column; align-items:center; background: rgba(255,255,255,.07); border:1px solid var(--line); border-radius:10px; color: var(--gold-2); padding:.2rem .45rem; cursor:pointer; font-family:inherit; }
    .inv-item .em { font-size:1.3rem; line-height:1.2; } .inv-item small { color: var(--text); font-size:.7rem; }
    .right-tools { margin-inline-start:auto; display:flex; gap:.4rem; }
    .badge { background: var(--bad); color:#fff; border-radius:999px; font-size:.75rem; padding:0 .45em; }
    .chat-pop { position:fixed; bottom:80px; inset-inline-end:10px; width:min(360px, calc(100% - 20px)); height:400px; z-index:12; display:flex; flex-direction:column; padding:.6rem; animation: fadein .25s ease both; }
    .chat-pop header { display:flex; justify-content:space-between; align-items:center; }
    .chat-pop px-chat { flex:1; min-height:0; } .chat-pop.pulse { box-shadow: 0 0 0 2px var(--gold-2), var(--shadow); }
    .help { position:fixed; bottom:90px; left:0; right:0; margin-inline:auto; z-index:11; width:min(560px, calc(100% - 24px)); padding:.7rem 1rem; }
    .help header { display:flex; justify-content:space-between; align-items:center; color: var(--gold-2); }
    .help ul { margin:.4rem 0 .6rem; padding-inline-start:1.1rem; line-height:1.7; font-size:.95rem; }
    .note { width:min(520px, calc(100% - 24px)); } .note header { display:flex; justify-content:space-between; align-items:center; }
    .note h2 { font-family: var(--font-title); color: var(--gold-2); margin:0; } .note-text { font-size:1.2rem; line-height:1.8; }
    .toasts { position:fixed; top:66px; left:50%; transform:translateX(-50%); display:flex; flex-direction:column; gap:.4rem; align-items:center; z-index:30; pointer-events:none; width:min(520px, calc(100% - 32px)); }
    .toast { background: rgba(10,16,36,.92); border:1px solid var(--line); padding:.5rem 1rem; border-radius:12px; box-shadow: var(--shadow); animation: fadein .3s ease; text-align:center; }
    .toast.zone-unlocked, .toast.clue, .toast.mechanism { border-color: var(--gold-2); color: var(--gold-2); } .toast.wrong-answer { border-color: rgba(226,113,91,.6); }
    .toast.hint { border-color: var(--blue); } .toast.score-group { border-color: var(--ok); color:#9be3b4; }
    .joy { position:fixed; bottom:90px; left:20px; z-index:11; }
    .celebrate { position:fixed; inset:0; z-index:70; pointer-events:none; display:flex; justify-content:center; align-items:flex-start; padding-top:15vh; }
    .card-c { pointer-events:auto; text-align:center; background: linear-gradient(180deg, rgba(40,30,8,.95), rgba(14,20,44,.95)); border:2px solid var(--gold-2);
      border-radius:20px; padding:1rem 2rem 1.2rem; box-shadow: 0 0 60px rgba(224,185,92,.45); animation: popIn .5s cubic-bezier(.2,1.4,.4,1) both; max-width:calc(100% - 32px); }
    .card-c .emoji { font-size:2.6rem; display:block; } .card-c h2 { font-size: clamp(1.5rem, 4.5vw, 2.4rem); margin:.2rem 0; color: var(--gold-2); }
    .card-c .what { margin:.2rem 0; font-size:1.05rem; } .card-c .pts { color:#9be3b4; font-weight:900; font-size:1.3rem; margin:.2rem 0; } .card-c small { color: var(--muted); }
    @keyframes popIn { from { opacity:0; transform: scale(.6) } to { opacity:1; transform: scale(1) } }
    .transfer { position:fixed; inset:0; z-index:65; background: radial-gradient(circle, rgba(10,16,40,.75), #03050c); display:grid; place-items:center; color: var(--gold-2); font-size:1.4rem; font-family: var(--font-title); animation: fadeInOut 1.1s ease both; }
    @keyframes fadeInOut { 0% { opacity:0 } 25%, 70% { opacity:1 } 100% { opacity:0 } }
    .success { position:fixed; inset:0; display:grid; place-content:center; text-align:center; z-index:20; animation: fadein 1.2s ease; gap:.6rem; }
    .success h1 { font-size: clamp(3rem, 11vw, 6rem); font-weight:900; } .success p { font-size:1.4rem; text-shadow: 0 2px 10px #000; }
    .small { font-size:.85rem; }
    .host-away { position:fixed; top:58px; left:0; right:0; margin-inline:auto; width:fit-content; z-index:12; background: rgba(122,58,18,.92); color:#fff;
      border-radius:999px; padding:.3rem .5rem .3rem 1rem; display:flex; gap:.6rem; align-items:center; }
    @media (max-width: 760px) {
      /* one column at the top — the bar, then the tasks beside the score — laid out in flow, so they never overlap */
      .hud-col { display:flex; flex-direction:column; gap:.4rem; position:fixed; z-index:10; pointer-events:none;
        top:max(8px, env(safe-area-inset-top)); inset-inline:max(8px, env(safe-area-inset-left)); max-height:52vh; }
      .hud-col > * { pointer-events:auto; }
      .hud-col .hud-top { position:static; inset:auto; }
      .hud-col .objectives, .hud-col .score { position:static; inset:auto; margin:0; }
      .hud-col .objectives { order:2; width:auto; flex:1 1 auto; min-height:0; max-height:34vh; overflow:auto; overscroll-behavior:contain; touch-action:pan-y; padding:.5rem .7rem; }
      .hud-col .objectives.collapsed { flex:0 0 auto; align-self:flex-start; }
      .hud-col .score { order:3; width:auto; font-size:.82rem; max-height:16vh; overflow:auto; overscroll-behavior:contain; padding:.35rem .6rem; }
      .hover-label { display:none; }
      /* the bag: one row that scrolls sideways, at the bottom edge — it never grows over the tasks */
      .hud-bottom { bottom:max(8px, env(safe-area-inset-bottom)); }
      .inventory { flex-wrap:nowrap; overflow-x:auto; overscroll-behavior:contain; max-width: calc(100% - 150px); padding:.35rem .6rem; }
      .inventory > * { flex-shrink:0; }
      /* the bag keeps its name for screen readers (aria-label); on a narrow screen the room goes to the items */
      .inventory > .muted.small { display:none; }
      .joy { bottom:calc(84px + env(safe-area-inset-bottom)); }
    }
  `],
})
export class SmPlayComponent implements AfterViewInit, OnDestroy {
  game = inject(GameService);
  private audio = inject(AudioService);
  settings = inject(SettingsService);
  /** Where the scales leaned when last heard, so a swing sounds once for everyone who sees it. */
  private scaleTilt?: number;
  private ngZone = inject(NgZone);
  private destroyRef = inject(DestroyRef);
  leave = output<void>();
  leaveForGood = output<void>();
  showLeave = signal(false);

  private canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('c');
  world?: StoneMazeWorld;
  touch = matchMedia('(pointer: coarse)').matches;

  loading = signal(true);
  zone = signal<HZone>('library');
  /** This player's secret task in the current room (read from the server for them alone). */
  myTask = signal<{ id: string; text: string; done: boolean; found?: string | null } | null>(null);
  private taskZone: string | null = null;
  /** The Stone Maze's two rooms (this component plays only the Stone Maze; the name is kept from the code it was copied from). */
  isSample = computed(() => this.game.snapshot()?.scenarioId === 'stone-maze');
  zoneCount = computed(() => this.game.scenario()?.zones.length ?? 8);
  texts = computed(() => this.isSample()
    ? { title: 'מבוך האבן — אתגר לחדי מחשבה', mission: 'צאו ממבוך האבן', rooms: 'שני חדרים — הדלת של כל חדר נפתחת רק אחרי כל החידות שבו', done: 'יצאתם ממבוך האבן! ראו את התוצאות.' }
    : { title: 'סוד פך השמן — מסע בעקבות נס החנוכה', mission: 'גלו את סוד פך השמן', rooms: 'שמונה חדרים רציפים — כל חדר שנפתר פותח את הדלת לבא אחריו', done: 'גיליתם את סוד פך השמן והשלמתם את מסע החנוכה.' });
  readonly CHECK_LABEL: Record<string, string> = { 'h2-lamp': 'בדוק הרכבה', 'g1-map': 'חשיפת המפה', 'g2-gears': 'הפעלת הידית', 'h7-scales': 'בדיקת האיזון', 'g2-scales': 'בדיקת האיזון' };
  readonly RESET_LABEL: Record<string, string> = { 'h5-stand': 'החזר סביבונים', 'g1-symbols': 'החזר סמלים', 'g1-map': 'החזר חלקים', 'g2-gears': 'החזר גלגלים', 'h7-scales': 'הורדת החפצים', 'g2-scales': 'הורדת החפצים' };
  readonly EMPTY_LABEL: Record<string, string> = {
    'h2-lamp': 'אין חלקים על השולחן — חפשו את חלקי המנורה בחדר והרימו אותם.',
    'h5-stand': 'אין סביבונים בתיק — חפשו את ארבעת הסביבונים בחדר והרימו אותם.',
    'g1-map': 'אין חלקי מפה בתיק — חפשו אותם על השולחן, במגירה ובמדף.',
    'g1-symbols': 'אין סמלים בתיק — חפשו בחדר את המצפן, המפתח, הספר והמנורה.',
    'g2-gears': 'אין גלגלי שיניים בתיק — חפשו אותם בסדנה והרימו אותם.',
    'h7-scales': 'אין חפצים לשקילה בתיק — חפשו בחדר נוצה, מפתח עתיק, גביש קסום ושעון חול.',
    'g2-scales': 'אין חפצים לשקילה בתיק — הרימו את הנוצה, הירח, השמש והכתר שעל שולחן המאזניים.',
  };
  hover = signal<HInteractable | null>(null);
  panel = signal<{ id: HPanel; ref?: string } | null>(null);
  note = signal<{ title: string; text: string; by?: string } | null>(null);
  toasts = signal<Toast[]>([]);
  floats = signal<{ id: number; playerId: string; text: string }[]>([]);
  system = signal<{ id: string; text: string; at: number }[]>([]);
  showChat = signal(false);
  showSettings = signal(false);
  /** The free game's "four guardians": the testimonies this player holds (only theirs — the server decides). */
  testimonies = signal<{ index: number; title: string; text: string; away?: boolean; from?: string }[]>([]);
  testimonyOpen = signal(false);
  testimonyReady = computed(() => this.isSample() && this.game.snapshot()?.puzzles.find((p) => p.id === 'g1-symbols')?.status === 'active');
  showHelp = signal(false);
  showObjectives = signal(!matchMedia('(max-width: 760px)').matches);
  showResult = signal(false);
  chatPulse = signal(false);
  unread = signal(0);
  celebration = signal<{ name: string; verb: string; what: string; points: number; next?: string; puzzleId: string } | null>(null);
  transfer = signal<string | null>(null);
  /** The table the player is using: the lamp bench, the dreidel stand or the maze board (null in the room). */
  focus = signal<string | null>(null);
  benchBusy = signal(false);
  benchMsg = signal<{ ok: boolean; text: string } | null>(null);
  /** The instructions panel at a table — this player's own view only, never shared with the group. */
  benchPos = signal<{ x: number; y: number } | null>(null);
  benchMin = signal(false);
  /** The maze arrows folded into their round button (they come back with it, and whenever the maze is opened again). */
  padHidden = signal(false);
  benchClosed = signal(false);
  private benchRef = viewChild<ElementRef<HTMLElement>>('benchEl');
  focusPuzzle = computed(() => this.game.scenario()?.puzzles.find((p) => p.id === this.focus()));
  focusState = computed(() => this.game.snapshot()?.puzzles.find((p) => p.id === this.focus()));
  benchHasParts = computed(() => {
    const s = this.game.snapshot();
    const id = this.focus();
    const accepts: string[] = this.focusPuzzle()?.publicData?.accepts ?? [];
    return accepts.some((i) => s?.inventory.includes(i)) || Object.keys((id && s?.mechanisms?.[id]?.slots) || {}).length > 0;
  });
  /** The puzzle of the scales in the game being played: room 7 of the Hanukkah journey, or room 2 of the free game. */
  scalesId = computed(() => (this.isSample() ? 'g2-scales' : 'h7-scales'));
  /** The inscriptions of the scales the group has read so far, shown beside the scales. */
  scaleNotes = computed(() => {
    const read = this.game.snapshot()?.clues ?? {};
    const prefix = this.isSample() ? 'g2-inscription' : 'h7-scale-';
    return (this.game.scenario()?.clues ?? []).filter((c) => c.id.startsWith(prefix) && read[c.id]).map((c) => c.text);
  });
  readonly FOCUS_HELP: Record<string, string> = {
    'h2-lamp': '',
    'h5-stand': 'גררו כל סביבון אל אחת מארבע המשבצות במתקן, לפי ארבעת הרמזים. אפשר להרים סביבון ולהניח אותו מחדש. כשסיימתם — לחצו „בדוק סידור”.',
    'g1-pendulum': '„הפעלה”, ואז „הקפאה!” כשהקריסטל עובר באזור המואר שבמרכז הסרגל. שלוש עצירות — שלושה חלקי מפה.',
    'g1-cabinet': 'געו בגלגל כדי לסובב אותו לסמל הבא. כשארבעת הגלגלים עומדים לפי רצף הרונים, הכיסוי עולה ומתגלות אותיות — פענחו אותן והזינו את הקוד.',
    'g2-levers': 'כל משיכה מעלה את המד של המנוף באחד ומורידה את המד הבא אחריו (A→B, B→C, C→A). הביאו את שלושת המדים ל־2.',
    'g2-rails': '„שיגור”, ובכל צומת בחרו מסילה. עקבו על הלוח לאן כל מסילה מובילה — הליבה מחכה תחת הכוכב.',
    'g2-gravity': 'הפעילו את מוט הכבידה כדי להפוך את החדר. כשהסימנים נחשפים, געו בהם לפי הסדר שבכתובת שליד המוט.',
    'g2-gate': 'הזינו את קוד היציאה שחרוט בתא הסודי.',
    'g1-runes': '„הצגת הרצף”, צפו באורות שעל הלוח, ואז געו באבנים באותו סדר. בשלב השני אור אחד נדלק בחושך — מי שרואה אותו צריך לספר לכולם.',
    'g1-map': 'געו בחלק כדי לבחור בו, ואז בחלק אחר כדי להחליף ביניהם. „⟳” מסובב חלק ברבע סיבוב. כשהכותרת, קו החוף והמסגרת ממשיכים מחלק לחלק — המפה תידלק.',
    'g1-symbols': 'גררו את ארבעת הסמלים אל המקומות הממוספרים 1–4, לפי עדויות השומרים. כל אחד רואה רק את העדות שלו — שתפו זה את זה! כשסיימתם — לחצו „בדוק סידור”.',
    'g2-gears': 'גררו כל גלגל שיניים אל הציר שלו — הסימון החרוט סביב כל ציר מראה איזה גלגל מתאים לו. כשכל הגלגלים במקום, משכו את הידית האדומה (או לחצו „הפעלת הידית”).',
    'g2-scales': 'גררו כל חפץ אל אחת מכפות המאזניים — או הקישו על חפץ ואחר כך על מקום פנוי בכף. אפשר להעביר חפץ בין הכפות או להחזיר אותו לשולחן. קראו את החריטה שעל הקיר, וכשכל החפצים על המאזניים — לחצו „בדיקת האיזון”.',
    'h7-scales': 'גררו כל חפץ אל אחת מכפות המאזניים — או הקישו על חפץ ואחר כך על מקום פנוי בכף. אפשר להעביר חפץ בין הכפות או להחזיר אותו לשולחן. היעזרו בשלוש החריטות שעל הקיר, וכשכל החפצים על המאזניים — לחצו „בדיקת האיזון”.',
    'h3-maze': 'הזיזו את המפתח בעזרת לוח החיצים — הוא לא עובר דרך קירות. לחצו על ידית כדי להזיז אותה ולפתוח או לסגור שער. התיבה שבצד נפתחת בקוד שיתגלה ביציאה.',
  };
  readonly FOCUS_DONE: Record<string, string> = {
    'h2-lamp': 'המנורה הורכבה ונדלקה! מאחורי לוח הקיר נחשף המפתח.',
    'h5-stand': 'כל הסביבונים במקומם! קראו את הספרות שלפניהם משמאל לימין, שורה אחר שורה, והזינו את הקוד במנעול שבדלת.',
    'g1-pendulum': 'שלושת חלקי המפה השתחררו מהקרח! הם מרחפים מעל השולחן — עכשיו חברו אותם.',
    'g1-map': 'המפה הורכבה ונדלקה! ארבעה סמלים הופיעו עליה, והראשון שבהם מאיר — ועל הקיר, לוח הרונים התעורר.',
    'g1-cabinet': 'הארון נפתח! המפתח העתיק בתיק הקבוצה — עכשיו אפשר לפתוח את דלת האבן.',
    'g2-levers': 'השרשראות מאוזנות! גלגלי השיניים מסתובבים ולוח המסילות התעורר.',
    'g2-rails': 'הכדור הגיע לליבה! מוט הכבידה שבמרכז החדר זוהר.',
    'g2-gravity': 'התא הסודי נפתח! החזירו את החדר למצבו הרגיל וגשו לשער עם הקוד.',
    'g1-runes': 'ארבע האבנים נדלקו והלוח הסתובב! על הארון ארבעה סמלים זוהרים, והדלת לסדנת המנגנון נפתחה.',
    'g1-symbols': 'ארבע העדויות התחברו! בגב הסמלים חרוטות אותיות עתיקות — פענחו אותן לפי סדר המקומות והזינו את הקוד בארון.',
    'g2-gears': 'המנגנון הופעל! אבל השער עדיין נעול. נראה שנותר מנגנון אחד שצריך לפענח — המאזניים העתיקים.',
    'g2-scales': 'המאזניים התאזנו! המנגנון האחרון הופעל. השער נפתח!',
    'h7-scales': 'הצלחתם לאזן את המאזניים! המנגנון העתיק התעורר לחיים.',
    'h3-maze': 'המפתח הגיע ליציאה! הקוד שהתגלה מוצג ליד הלוח — לחצו על התיבה שבצד כדי להזין אותו.',
  };
  tick = signal(0);

  // ---- the Stone Hall's mechanisms, worked from the bar
  isWatch = (f: string) => WATCH.has(f);
  mapPick = signal<string | null>(null);
  pend = computed(() => {
    const m = this.game.snapshot()?.mechanisms?.['g1-pendulum'];
    const d = this.game.scenario()?.puzzles.find((p) => p.id === 'g1-pendulum')?.publicData;
    const progress = m?.progress ?? 0;
    return { progress, round: Math.min(3, progress + 1), running: !!m?.running, widened: (m?.misses ?? 0) >= (d?.widenAfter ?? 3) };
  });
  mapPieces = computed(() => {
    const data = this.game.scenario()?.puzzles.find((p) => p.id === 'g1-map')?.publicData;
    if (!data) return [];
    const m = this.game.snapshot()?.mechanisms?.['g1-map'];
    const pieces: { id: string; label: string }[] = data.pieces;
    const order: string[] = m?.slots && Object.keys(m.slots).length ? ['p1', 'p2', 'p3'].map((k) => m.slots[k]) : data.start.order;
    const images = mapPieceImages();
    return order.map((id) => {
      const i = pieces.findIndex((x) => x.id === id);
      return { id, label: pieces[i].label, img: images[i], turns: m?.rotations?.[i] ?? data.start.turns[i] };
    });
  });

  async startPendulum() {
    this.benchBusy.set(true);
    try {
      const r = await this.game.operate('g1-pendulum', { op: 'start' });
      this.benchMsg.set(r.ok ? null : { ok: false, text: r.message });
      if (r.ok) this.audio.sfx('lever');
    } finally {
      this.benchBusy.set(false);
    }
  }

  /** The moment of the press is read first, on the server's clock, and sent with the measured round trip. */
  async freezePendulum(ev: Event) {
    ev.preventDefault();
    const at = this.game.preciseServerNow();
    const rtt = this.game.roundTripMs();
    if (this.benchBusy()) return;
    this.benchBusy.set(true);
    try {
      const r = await this.game.operate('g1-pendulum', { op: 'freeze', at, rtt });
      const ok = r.ok && (r.code === 'hit' || r.code === 'solved');
      if (r.code !== 'solved') {
        this.benchMsg.set({ ok, text: r.message });
        this.audio.sfx(ok ? 'codeOk' : 'wrong');
      }
    } finally {
      this.benchBusy.set(false);
    }
  }

  async pickPiece(id: string) {
    const first = this.mapPick();
    if (!first) { this.mapPick.set(id); this.audio.sfx('select'); return; }
    this.mapPick.set(null);
    if (first !== id) await this.mapOp({ op: 'swap', a: first, b: id });
  }

  rotatePiece(id: string) {
    return this.mapOp({ op: 'rotate', piece: id });
  }

  private async mapOp(action: object) {
    this.benchBusy.set(true);
    try {
      const r = await this.game.operate('g1-map', action);
      if (!r.ok) this.benchMsg.set({ ok: false, text: r.message });
      else if (r.code !== 'solved') this.audio.sfx('paper');
    } finally {
      this.benchBusy.set(false);
    }
  }

  // ---- the rune chain
  runeNow = signal(0);
  runeClues = signal<{ index: number; text: string; visual?: string; away?: boolean; from?: string }[]>([]);
  readonly RUNES_SOLO_HELP = '„הצגת הרצף”, צפו באורות שעל הלוח, ואז געו באבנים באותו סדר. בשלב השני אור אחד נדלק בחושך בסגול — אתם משחקים לבד, ולכן אתם רואים אותו בעצמכם: זכרו את הסמל שהאיר.';
  /** Alone in the game: the light in the dark is the player's own, and there is nobody to tell. */
  soloRunes = computed(() => (this.game.snapshot()?.players.length ?? 1) <= 1);
  /** The symbol the light in the dark lit — known only to the one who holds its clue (from the clue the server sent them). */
  runeSecret = computed(() => {
    const d = this.runeData();
    const visual = this.runeClues()[0]?.visual;
    return (d?.symbols as { id: string; emoji: string }[] | undefined)?.find((x) => x.emoji === visual)?.id ?? null;
  });
  private runeTimer?: ReturnType<typeof setInterval>;
  private lastRuneLight: string | null = null;
  private runeData = computed(() => this.game.scenario()?.puzzles.find((p) => p.id === 'g1-runes')?.publicData);
  runes = computed(() => {
    this.runeNow();
    const m = this.game.snapshot()?.mechanisms?.['g1-runes'];
    const d = this.runeData();
    const progress = m?.progress ?? 0;
    const length = d?.stages?.[Math.min(progress, 2)]?.length ?? 2;
    let showing = false;
    if (m?.startedAt && m.shown?.length && d) {
      const end = Date.parse(m.startedAt) + runeSchedule(d, m.shown, m.misses ?? 0).end * 1000;
      showing = this.game.preciseServerNow() < end;
    }
    return { progress, stage: Math.min(3, progress + 1), length, showing, started: !!m?.startedAt, input: m?.input ?? [] };
  });
  runeStones = computed(() => {
    const d = this.runeData();
    if (!d) return [];
    const by = new Map<string, { id: string; label: string; emoji: string }>(d.symbols.map((x: { id: string; label: string; emoji: string }) => [x.id, x]));
    return (d.stones as string[]).map((id) => by.get(id)!);
  });
  runeSlots = computed(() => {
    const d = this.runeData();
    const emoji = new Map<string, string>((d?.symbols ?? []).map((x: { id: string; emoji: string }) => [x.id, x.emoji]));
    const r = this.runes();
    return Array.from({ length: r.length }, (_, k) => emoji.get(r.input[k]) ?? '');
  });
  runeLightLabel = computed(() => {
    this.runeNow();
    if (this.world?.runeLight !== '?') return '';
    const sym = this.runeSecret();
    const s = sym ? (this.runeData()?.symbols as { id: string; label: string; emoji: string }[]).find((x) => x.id === sym) : null;
    if (s && this.soloRunes()) return `· 🟣 אור נדלק בחושך: ${s.emoji} ${s.label} — זכרו את הסמל שהאיר בחושך`;
    if (s) return `· 🟣 🔒 רק את/ה רואה: האור שבחושך הוא ${s.emoji} ${s.label}`;
    return '· 🟣 אור נדלק בחושך — רק אחד מכם רואה איזה סמל. שאלו מי!';
  });

  private watchRunes(on: boolean) {
    clearInterval(this.runeTimer);
    if (!on) return;
    void this.loadRuneClues();
    this.runeTimer = setInterval(() => {
      this.runeNow.update((n) => n + 1);
      this.world?.setRuneSecret(this.runeSecret());
      // a soft sound for each light of the disc, a deep one for the light in the dark
      const l = this.world?.runeLight ?? null;
      if (l && l !== this.lastRuneLight) this.audio.sfx(l === '?' ? 'misplace' : 'select');
      this.lastRuneLight = l;
    }, 120);
  }

  private async loadRuneClues() {
    const r = await this.game.getPersonalClues('g1-runes');
    if (r.ok && r.data) this.runeClues.set(r.data.clues);
  }

  async showRunes() {
    this.benchBusy.set(true);
    try {
      const r = await this.game.operate('g1-runes', { op: 'show' });
      if (!r.ok) this.benchMsg.set({ ok: false, text: r.message });
      else this.benchMsg.set(null);
      void this.loadRuneClues();
    } finally {
      this.benchBusy.set(false);
    }
  }

  async pressRune(symbol: string) {
    this.benchBusy.set(true);
    try {
      const r = await this.game.operate('g1-runes', { op: 'press', symbol });
      if (!r.ok) { this.benchMsg.set({ ok: false, text: r.message }); return; }
      if (r.code === 'wrong') { this.world?.flashRunes('bad'); this.audio.sfx('wrong'); this.benchMsg.set({ ok: false, text: r.message }); }
      else if (r.code === 'stage') { this.world?.flashRunes('good'); this.audio.sfx('codeOk'); this.benchMsg.set({ ok: true, text: r.message }); void this.loadRuneClues(); }
      else if (r.code === 'pressed') { this.audio.sfx('place'); this.benchMsg.set(null); }
    } finally {
      this.benchBusy.set(false);
    }
  }

  /**
   * The stone door of the Stone Hall: the server opens it only when the whole room is done and the ancient key is in the
   * group's bag; otherwise it says what is missing. The key is not used up.
   */
  async openStoneDoor() {
    const r = await this.game.operate('g1-door', { op: 'unlock' });
    if (r.ok) { this.audio.sfx('key'); return; }
    this.audio.sfx('wrong');
    const text = r.code === 'locked' || r.code === 'room-not-done'
      ? 'דלת האבן נעולה היטב. קודם צריך לפענח את כל סודות האולם — והמפתח שפותח אותה מסתתר בארון.'
      : r.code === 'already-solved' ? 'הדלת כבר פתוחה.' : r.message;
    this.toast(text, 'info');
  }

  // ---- puzzle 3 and room 2
  codeText = signal('');
  signOrder = signal<string[]>([]);
  readonly RAILS = [{ id: 'moon', label: 'ירח', emoji: '🌙' }, { id: 'sun', label: 'שמש', emoji: '☀️' }, { id: 'star', label: 'כוכב', emoji: '⭐' }];
  private SYM: Record<string, { label: string; emoji: string }> = {
    compass: { label: 'מצפן', emoji: '🧭' }, key: { label: 'מפתח', emoji: '🗝️' }, book: { label: 'ספר', emoji: '📖' }, lamp: { label: 'מנורה', emoji: '🪔' },
  };
  cab = computed(() => {
    const m = this.game.snapshot()?.mechanisms?.['g1-cabinet'];
    const b = m?.backs ?? {};
    return { ready: !!m?.ready, letters: [1, 2, 3, 4].map((k) => b['w' + k]).filter(Boolean) as string[] };
  });
  cabWheels = computed(() => {
    const p = this.game.scenario()?.puzzles.find((x) => x.id === 'g1-cabinet')?.publicData;
    const rot: number[] = this.game.snapshot()?.mechanisms?.['g1-cabinet']?.rotations ?? p?.start ?? [0, 0, 0, 0];
    const syms: string[] = p?.symbols ?? ['compass', 'key', 'book', 'lamp'];
    return rot.map((r) => this.SYM[syms[r]] ?? { label: '?', emoji: '?' });
  });
  leverRows = computed(() => {
    const p = this.game.scenario()?.puzzles.find((x) => x.id === 'g2-levers')?.publicData;
    const v: number[] = this.game.snapshot()?.mechanisms?.['g2-levers']?.rotations ?? p?.start ?? [4, 0, 2];
    return ((p?.levers ?? ['A', 'B', 'C']) as string[]).map((name, k) => ({ name, value: v[k] }));
  });
  railMoving = computed(() => {
    this.runeNow();
    const m = this.game.snapshot()?.mechanisms?.['g2-rails'];
    return !!m?.startedAt && this.game.preciseServerNow() - Date.parse(m.startedAt) < 1200;
  });
  railCanStart = computed(() => {
    const at = this.game.snapshot()?.mechanisms?.['g2-rails']?.revealed ?? 'S';
    return at === 'S' || at === 'dead';
  });
  railWhere = computed(() => {
    const at = this.game.snapshot()?.mechanisms?.['g2-rails']?.revealed ?? 'S';
    return ({ S: 'הכדור בנקודת ההתחלה', dead: 'מבוי סתום — שגרו מחדש', J1: 'הכדור בצומת 1 — בחרו מסילה', J2: 'הכדור בצומת 2 — בחרו מסילה', J3: 'הכדור בצומת 3 — בחרו מסילה', core: 'הכדור בליבה!' } as Record<string, string>)[at] ?? '';
  });
  grav = computed(() => {
    this.runeNow();
    const m = this.game.snapshot()?.mechanisms?.['g2-gravity'];
    const turning = !!m?.startedAt && this.game.preciseServerNow() - Date.parse(m.startedAt) < 2000;
    const solved = this.game.snapshot()?.puzzles.find((x) => x.id === 'g2-gravity')?.status === 'solved';
    return { flipped: !!m?.running, turning, solved, code: m?.revealed ?? '' };
  });
  gravSigns = computed(() => (this.game.scenario()?.puzzles.find((x) => x.id === 'g2-gravity')?.publicData?.signs ?? []) as { id: string; label: string; emoji: string }[]);
  signEmoji = (id: string | undefined) => this.gravSigns().find((x) => x.id === id)?.emoji ?? '';

  /** Digits only, at most four (the code locks). */
  setCode(ev: Event) {
    const el = ev.target as HTMLInputElement;
    const v = el.value.replace(/\D/g, '').slice(0, 4);
    el.value = v;
    this.codeText.set(v);
  }

  async turnWheel(k: number) {
    await this.opSimple('g1-cabinet', { op: 'turn', wheel: k });
  }

  pullLever(name: string) {
    return this.opSimple('g2-levers', { op: 'pull', lever: name });
  }

  async pickSign(id: string) {
    const next = [...this.signOrder(), id];
    this.signOrder.set(next);
    this.audio.sfx('place');
    if (next.length < 3) return;
    const r = await this.opSimple('g2-gravity', { op: 'order', signs: next });
    this.signOrder.set([]);
    if (r?.code === 'wrong') this.audio.sfx('wrong');
  }

  async submitCode(puzzle: string) {
    const code = this.codeText();
    const r = await this.opSimple(puzzle, puzzle === 'g2-gate' ? { op: 'unlock', code } : { op: 'code', code });
    if (r && !r.ok) this.codeText.set('');
  }

  /** One action on a mechanism of the free game; the server's answer goes in the bar, with a sound. */
  async opSimple(puzzle: string, action: object) {
    this.benchBusy.set(true);
    try {
      const r = await this.game.operate(puzzle, action);
      const good = ['solved', 'aligned', 'junction', 'started', 'flipped', 'restored', 'reset'].includes(r.code);
      if (!r.ok || ['wrong', 'stuck', 'dead-end', 'back-to-start', 'hidden'].includes(r.code)) {
        this.audio.sfx(r.code === 'stuck' ? 'misplace' : 'wrong');
        this.benchMsg.set({ ok: false, text: r.message });
      } else if (r.message) {
        this.benchMsg.set({ ok: good, text: r.message });
        if (r.code !== 'solved') this.audio.sfx(r.code === 'aligned' ? 'cabinet' : r.code === 'flipped' || r.code === 'restored' ? 'transition' : 'lever');
      } else {
        this.benchMsg.set(null);
        this.audio.sfx(puzzle === 'g1-cabinet' ? 'gear' : 'lever');
      }
      return r;
    } finally {
      this.benchBusy.set(false);
    }
  }

  /** A mechanism of the free game that waits for an earlier one: say so instead of opening it. */
  openWatchOr(puzzle: string, lockedText: string) {
    if (this.game.snapshot()?.puzzles.find((p) => p.id === puzzle)?.status === 'locked') {
      this.audio.sfx('wrong');
      this.toast(lockedText, 'info');
      return;
    }
    this.codeText.set('');
    this.signOrder.set([]);
    this.openBench(puzzle);
  }

  /** The golden chest: the ancient key opens it (and stays in the bag). */
  async openGoldChest() {
    const r = await this.game.operate('g1-chest', { op: 'open' });
    if (r.ok) return;
    this.audio.sfx('wrong');
    this.toast(r.code === 'locked' || r.code === 'no-key' ? 'התיבה נעולה. על המכסה חרוט סמל קטן של מפתח.' : r.code === 'already-solved' ? 'התיבה כבר פתוחה.' : r.message, 'info');
  }

  /** The rune disc: dark until the map is whole. */
  openRunes() {
    if (this.game.snapshot()?.puzzles.find((p) => p.id === 'g1-runes')?.status === 'locked') {
      this.audio.sfx('wrong');
      this.toast('לוח הרונים עדיין חשוך. קודם הרכיבו את המפה שעל השולחן — היא תעיר אותו.', 'info');
      return;
    }
    this.openBench('g1-runes');
  }

  /** The map table: while the pieces are still frozen, say so instead of opening. */
  openMapTable() {
    if (this.game.snapshot()?.puzzles.find((p) => p.id === 'g1-map')?.status === 'locked') {
      this.audio.sfx('wrong');
      this.toast('חלקי המפה עדיין קפואים בתוך הקרח. קודם עצרו את מטוטלת הקריסטל — כל עצירה מוצלחת משחררת חלק.', 'info');
      return;
    }
    this.openBench('g1-map');
  }

  phase = computed(() => this.game.snapshot()?.phase ?? 'lobby');
  objectives = computed(() => {
    const sc = this.game.scenario();
    const s = this.game.snapshot();
    if (!sc || !s) return [];
    return sc.puzzles.filter((p) => p.zone === this.zone())
      .map((p) => ({ id: p.id, objective: p.objective, bonus: !!p.bonus, status: s.puzzles.find((x) => x.id === p.id)?.status ?? 'locked' }));
  });
  /** The task to do now in this room: the first one the server lists as open. */
  activeObjective = computed(() => {
    const open = this.objectives().filter((p) => p.status === 'active');
    return (open.find((p) => !p.bonus) ?? open[0])?.id ?? null;
  });
  /** True for a few seconds after the server confirmed a task and the next one became the active one. */
  objFlash = signal(false);
  private lastActiveObjective: string | null | undefined;
  private objFlashTimer?: ReturnType<typeof setTimeout>;
  introT = computed(() => {
    this.tick();
    const s = this.game.snapshot();
    return s?.introStartedAt ? (this.game.serverNow() - Date.parse(s.introStartedAt)) / 1000 : 0;
  });
  outroT = computed(() => {
    this.tick();
    const s = this.game.snapshot();
    return s?.endedAt ? (this.game.serverNow() - Date.parse(s.endedAt)) / 1000 : 0;
  });
  elapsed = computed(() => {
    this.tick();
    const s = this.game.snapshot();
    if (!s?.startedAt) return '00:00';
    const sec = Math.max(0, Math.floor((this.game.serverNow() - Date.parse(s.startedAt)) / 1000));
    return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  });

  private toastId = 0;
  private ticker?: ReturnType<typeof setInterval>;
  private lastPhase: string | null = null;
  private introFinishSent = false;
  private seenChatIds: Set<string> | null = null;
  private announced = new Set<string>();
  private activeZoneApplied: string | null = null;
  private pendingShown: string | null = null;
  private progressTimers: ReturnType<typeof setTimeout>[] = [];
  private pointsByPuzzle = new Map<string, number>();

  constructor() {
    this.ticker = setInterval(() => this.tick.update((t) => t + 1), 500);

    // the secret personal task: read again whenever the group enters another room (or the connection comes back)
    effect(() => {
      const s = this.game.snapshot();
      const key = s?.phase === 'playing' && this.game.connection() === 'connected' ? s.activeZone : null;
      untracked(() => {
        if (!key) return this.myTask.set(null);
        if (key !== this.taskZone) {
          this.taskZone = key;
          void this.refreshTask();
        }
      });
    });

    effect(() => {
      const s = this.game.snapshot();
      const sc = this.game.scenario();
      if (!s || !this.world) return;
      untracked(() => {
        if (this.loading() && sc) this.buildWorld();
        if (this.loading()) return;
        this.world!.applySnapshot(s, sc);
        this.world!.setPlayers(s.players, this.game.playerId(), this.game.positions);
        this.onPhase(s.phase);
        this.handleProgress(s);
        this.updateSound(s);
      });
    });

    effect(() => {
      const t = this.introT();
      if (this.phase() !== 'intro') return;
      untracked(() => {
        if (!this.introFinishSent && t >= (this.game.snapshot()?.introSeconds ?? 24)) {
          this.introFinishSent = true;
          this.game.finishIntro(false).then((r) => {
            if (!r.ok) setTimeout(() => (this.introFinishSent = false), 2000);
          });
        }
      });
    });

    effect(() => {
      const list = this.game.chat();
      untracked(() => {
        if (this.seenChatIds === null) {
          this.seenChatIds = new Set(list.map((m) => m.id));
          return;
        }
        const fresh = list.filter((m) => !this.seenChatIds!.has(m.id));
        fresh.forEach((m) => this.seenChatIds!.add(m.id));
        if (!fresh.length) return;
        // a new message opens the team chat (spec §9)
        this.showChat.set(true);
        this.unread.set(0);
        this.chatPulse.set(true);
        setTimeout(() => this.chatPulse.set(false), 900);
      });
    });
    effect(() => {
      if (this.showChat()) untracked(() => this.unread.set(0));
    });

    this.game.notices$.pipe(takeUntilDestroyed()).subscribe((n) => this.onNotice(n));
    effect(() => {
      const sens = this.settings.settings().lookSensitivity;
      if (this.world) this.world.sensitivity = sens;
    });
    this.destroyRef.onDestroy(() => this.progressTimers.forEach(clearTimeout));
    // the next task lights up when it changes — it follows the server's state, so every player sees the same task
    effect(() => {
      const id = this.activeObjective();
      const playing = this.phase() === 'playing';
      untracked(() => {
        if (playing && id && this.lastActiveObjective !== undefined && id !== this.lastActiveObjective) this.flashObjective(id);
        this.lastActiveObjective = playing ? id : undefined;
      });
    });
    addEventListener('resize', this.onResize);
    this.destroyRef.onDestroy(() => removeEventListener('resize', this.onResize));
    // a panel that grows back from its minimized bar stays on the screen
    effect(() => {
      this.benchMin();
      untracked(() => setTimeout(this.onResize));
    });
  }

  ngAfterViewInit() {
    try {
      this.world = this.ngZone.runOutsideAngular(() => new StoneMazeWorld(this.canvas().nativeElement, this.settings.settings().quality, {
        onHover: (d) => this.ngZone.run(() => this.hover.set(d)),
        onInteract: (d) => this.ngZone.run(() => this.interact(d)),
        onTooFar: (d) => this.ngZone.run(() => this.toast(`התקרבו אל ${d.label} כדי ל${d.verb === 'הרמה' ? 'הרים' : 'השתמש'}`, 'info')),
        onZoneChange: (z) => this.ngZone.run(() => {
          this.zone.set(z);
          // a new room starts with the instructions panel in its usual place
          this.resetBenchPanel();
          const s = this.game.snapshot();
          if (s) this.updateSound(s);
        }),
        onMove: (x, y, z, ry, zone) => this.game.move(x, y, z, ry, zone),
        onBenchDrop: (puzzle, item, slot, from) => this.ngZone.run(() => this.benchDrop(puzzle, item, slot, from)),
        onBenchExit: () => this.ngZone.run(() => this.exitBench()),
        onMazeStep: (dir) => this.ngZone.run(() => this.mazeStep(dir)),
        onMazeLever: (i) => this.ngZone.run(() => this.mazeLever(i)),
        onMazeBlocked: (text) => this.ngZone.run(() => this.benchMsg.set({ ok: false, text })),
        onMazeBox: () => this.ngZone.run(() => this.openBox('h3-box', 'box')),
        onBenchLever: () => this.ngZone.run(() => this.checkBench()),
      }));
      this.world.sensitivity = this.settings.settings().lookSensitivity;
      this.world.setServerClock(() => this.game.preciseServerNow());
      if (this.game.scenario()) this.buildWorld();
    } catch {
      this.loading.set(false);
      this.toast('הדפדפן אינו תומך בתלת־ממד (WebGL). נסו דפדפן מעודכן כמו Chrome, Edge או Firefox.', 'wrong-answer');
    }
  }

  private buildWorld() {
    if (!this.world || !this.loading()) return;
    // the rooms and objects of this game (the Hanukkah journey or the free trial)
    useLayout(this.game.scenario()?.id);
    this.zone.set(H_ZONES[0]);
    this.ngZone.runOutsideAngular(() => {
      this.world!.build(this.game.scenario());
      // the secret task may have arrived before the room was built
      this.world!.setMyTask(this.myTask()?.id ?? null, !!this.myTask()?.done);
      this.world!.start();
    });
    this.loading.set(false);
    const s = this.game.snapshot()!;
    this.world.applySnapshot(s, this.game.scenario());
    this.world.setPlayers(s.players, this.game.playerId(), this.game.positions);
    const mine = this.game.positions.get(this.game.playerId() ?? '');
    if (mine && s.phase === 'playing') this.world.placePlayer(mine);
    this.onPhase(s.phase);
    this.handleProgress(s);
    this.updateSound(s);
  }

  toggleSound(key: 'musicOn' | 'effectsOn') {
    this.audio.unlock();
    this.settings.update({ [key]: !this.settings.settings()[key] });
  }

  /** The music of the room the player is in, by the kind of room: investigation, machines, maze, decoding, light, the finale. */
  private musicFor(s: RoomSnapshot): ThemeId {
    const zone = this.zone();
    if (this.isSample()) return zone === 'gearworks' ? 'mechanism' : 'ancient';
    return HANUKKAH_MUSIC[zone] ?? 'hanukkah';
  }

  /** Room music and the swing of the scales — both follow the shared server state, so everyone hears the same. */
  private updateSound(s: RoomSnapshot) {
    if (s.phase === 'playing') this.audio.setMusic(this.musicFor(s));
    const tilt = s.mechanisms?.[this.scalesId()]?.tilt ?? 0;
    if (this.scaleTilt !== undefined && tilt !== this.scaleTilt && s.phase === 'playing') this.audio.sfx('scale');
    this.scaleTilt = tilt;
  }

  private onPhase(phase: string) {
    if (phase === this.lastPhase || !this.world) return;
    const prev = this.lastPhase;
    this.lastPhase = phase;
    if (phase === 'intro') {
      this.world.setMode('intro');
      this.world.setIntroTime(this.introT());
      this.audio.setMusic('intro');
      this.introFinishSent = false;
    } else if (phase === 'playing') {
      this.world.setMode('play');
      if (prev === 'intro' || prev === null) {
        this.world.resetPlayer();
        const mine = this.game.positions.get(this.game.playerId() ?? '');
        if (mine && prev === null) this.world.placePlayer(mine);
      }
      const snap = this.game.snapshot();
      if (snap) this.audio.setMusic(this.musicFor(snap));
      if (prev === 'intro') {
        this.toast('המסע התחיל! על שולחן העץ מונח מכתב מסתורי.', 'zone-unlocked');
        this.showHelp.set(true);
        setTimeout(() => this.showHelp.set(false), 18000);
      }
      this.canvas().nativeElement.focus();
    } else if (phase === 'completed') {
      this.exitBench();
      this.panel.set(null);
      this.note.set(null);
      this.world.setMode('outro');
      this.audio.setMusic('finale');
      this.audio.setAmbience(null);
      if (prev === 'playing') {
        // the light reaches the gate (its celebration), the gate opens, then the closing tune — for everyone
        if (this.isSample()) setTimeout(() => this.audio.sfx('gate'), 1400);
        else this.audio.cue('oil', 100);
        setTimeout(() => this.audio.sfx('complete'), this.isSample() ? 3800 : 2600);
      }
      this.showResult.set(prev === null);
    } else if (phase === 'lobby') {
      this.showResult.set(false);
    }
  }

  async skipIntro() {
    const r = await this.game.finishIntro(true);
    if (!r.ok) this.toast(r.message, 'info');
  }

  /** System lines go to the chat log (spec §20) and, while the chat is closed, also appear as toasts. */
  private systemLine(text: string, kind: string) {
    const id = String(++this.toastId);
    this.system.update((l) => [...l.slice(-60), { id, text, at: this.game.serverNow() }]);
    if (!this.showChat()) {
      this.unread.update((u) => u + 1);
      this.toast(text, kind);
    }
  }

  private onNotice(n: GameNotice) {
    const mine = n.playerId === this.game.playerId();
    switch (n.kind) {
      case 'clue':
      case 'mechanism':
      case 'team-solved':
        // finding a clue sounds for the finder; a solved puzzle sounds once, with its celebration
        if (n.kind === 'clue' && mine) this.audio.cue('find', 30);
        this.systemLine(n.message, n.kind);
        // the map is whole: each player receives their secret testimony, shown once by itself
        if (n.kind === 'team-solved' && n.puzzleId === 'g1-map' && this.isSample()) setTimeout(() => this.loadTestimonies(true), 1800);
        break;
      case 'zone-unlocked':
        // the door sounds when it opens on screen (handleProgress)
        this.systemLine(n.message, n.kind);
        break;
      case 'score':
        if (mine) setTimeout(() => this.audio.sfx('points'), 700);
        if (n.playerId) this.addFloat(n.playerId, n.message);
        if (n.puzzleId) this.addPoints(n.puzzleId, n.points ?? 0);
        break;
      case 'score-group':
        this.toast(n.message, n.kind);
        break;
      case 'hint':
        this.audio.sfx('hint');
        this.systemLine(n.message, n.kind);
        break;
      case 'wrong-answer':
        // only the player who tried hears the error; the others see it
        if (mine) this.audio.sfx('wrong');
        // a wrong arrangement on the dreidel stand blinks red for everyone
        if (n.puzzleId === 'h5-stand' || n.puzzleId === 'g1-symbols' || n.puzzleId === 'g1-map') this.world?.flashBench(n.puzzleId);
        if (!mine) this.toast(n.message, n.kind);
        break;
      case 'item-revealed':
        // a hidden drawer opens in the shared room
        this.audio.sfx('drawer');
        this.systemLine(n.message, 'clue');
        break;
      case 'item-picked':
      case 'item-placed':
      case 'item-collected':
        // the player who acted already heard it; items that join the bag with a solve sound with the celebration
        this.toast(n.message, n.kind);
        break;
      case 'symbol-found':
        // a hidden symbol joins the group's evidence
        if (mine) this.audio.cue('find', 30);
        this.systemLine(n.message, 'clue');
        break;
      case 'puzzle-action':
        // who changed a shared puzzle: the others see it at once; everyone finds it in the chat log
        if (mine) this.system.update((l) => [...l.slice(-60), { id: String(++this.toastId), text: n.message, at: this.game.serverNow() }]);
        else this.systemLine(n.message, 'info');
        break;
      case 'object-inspected':
        if (!mine) this.toast(n.message, 'info');
        break;
      case 'maze-symbol':
        this.audio.sfx('letter');
        this.toast(n.message, 'clue');
        break;
      case 'puzzle-solved':
      case 'game-completed':
      case 'game-started':
        break;
      case 'player-disconnected':
      case 'player-connected':
      case 'player-joined':
      case 'player-left':
        if (this.phase() === 'playing') this.toast(n.message, 'info');
        break;
      default:
        if (n.message) this.toast(n.message, n.kind);
    }
  }

  private addFloat(playerId: string, text: string) {
    const id = ++this.toastId;
    this.floats.update((f) => [...f, { id, playerId, text }]);
    setTimeout(() => this.floats.update((f) => f.filter((x) => x.id !== id)), 2700);
  }

  floatsFor(playerId: string) {
    return this.floats().filter((f) => f.playerId === playerId);
  }

  /** Personal points given for a puzzle (answer, mechanism, placements) — shown in its celebration (spec §9). */
  private addPoints(puzzleId: string, points: number) {
    this.pointsByPuzzle.set(puzzleId, (this.pointsByPuzzle.get(puzzleId) ?? 0) + points);
    const c = this.celebration();
    if (c?.puzzleId === puzzleId) this.celebration.set({ ...c, points: c.points + points });
  }

  /** Celebrations and the group's move to the next room, driven by the server state (once per puzzle and round). */
  private handleProgress(s: RoomSnapshot) {
    if (s.phase !== 'playing' && s.phase !== 'completed') {
      this.activeZoneApplied = null;
      this.clearProgressTimers();
      return;
    }
    const now = this.game.serverNow();
    for (const p of s.puzzles) {
      if (p.status !== 'solved') continue;
      const key = `${s.round}:${p.id}`;
      if (this.announced.has(key)) continue;
      this.announced.add(key);
      if (!p.solvedAt || now - Date.parse(p.solvedAt) >= 8000) continue;
      // the lamp first assembles and lights up on the bench; its message follows once the light reaches the wall
      if (p.id === 'h2-lamp') this.progressTimers.push(setTimeout(() => this.celebrate(this.game.snapshot() ?? s, p.id), 8000));
      else this.celebrate(s, p.id);
    }
    // a room just opened: the door opens and the camera shows it; the group moves on with "Continue"
    if (s.phase === 'playing' && s.pendingZone && s.pendingZone !== this.pendingShown && this.world) {
      this.pendingShown = s.pendingZone;
      this.panel.set(null);
      // after the lamp, the group first watches it light up on the bench, then the camera turns to the door
      const lamp = s.pendingZone === 'maze';
      this.progressTimers.push(setTimeout(() => this.exitBench(), lamp ? 9000 : 1500));
      this.progressTimers.push(setTimeout(() => {
        this.audio.sfx('door');
        this.world?.playDoorCutscene(s.pendingZone!);
      }, lamp ? 9200 : 1800));
    }
    if (s.phase !== 'playing' || !this.world || s.activeZone === this.activeZoneApplied) return;
    const first = this.activeZoneApplied === null;
    const target = s.activeZone as HZone;
    this.activeZoneApplied = target;
    this.clearProgressTimers();
    const moveAt = s.activeZoneSince ? Date.parse(s.activeZoneSince) + s.transitionDelayMs : 0;
    const wait = moveAt - now;
    if (first && (wait <= 0 || !s.activeZoneSince)) {
      if (this.world.localZone !== target) this.world.transferTo(target, this.mySlot(s));
      // back in a game already under way: the room shown (and its music) follow at once
      else this.zone.set(this.world.localZone);
      return;
    }
    if (wait > 1200) {
      this.panel.set(null);
      this.progressTimers.push(setTimeout(() => this.world?.playDoorCutscene(target), Math.max(0, wait - 3400)));
      this.progressTimers.push(setTimeout(() => this.moveGroup(target), wait));
    } else this.moveGroup(target);
  }

  private celebrate(s: RoomSnapshot, puzzleId: string) {
    const sc = this.game.scenario();
    const state = s.puzzles.find((p) => p.id === puzzleId);
    const content = sc?.puzzles.find((p) => p.id === puzzleId);
    if (!content) return;
    const nextPuzzle = sc!.puzzles.find((p) => p.requiresPuzzle === puzzleId);
    const next = nextPuzzle?.objective ?? (content.unlocksZone ? `עוברים יחד אל ${this.zoneName(content.unlocksZone)}` : undefined);
    const mechanism = ['slots', 'maze', 'mosaic', 'balance'].includes(content.type);
    this.audio.cue(SOLVE_SOUND[puzzleId] ?? 'success', 80);
    this.celebration.set({
      name: this.game.playerName(state?.solvedBy) || 'הקבוצה',
      verb: mechanism ? 'הפעיל את המנגנון' : 'פתר את החידה',
      what: content.success,
      points: this.pointsByPuzzle.get(puzzleId) ?? 0,
      next,
      puzzleId,
    });
    setTimeout(() => this.celebration()?.puzzleId === puzzleId && this.celebration.set(null), 8000);
  }

  private moveGroup(zone: HZone) {
    this.panel.set(null);
    this.audio.sfx('transition');
    this.transfer.set(`עוברים אל ${this.zoneName(zone)}...`);
    setTimeout(() => {
      const s = this.game.snapshot();
      if (s && this.world) this.world.transferTo(zone, this.mySlot(s));
    }, 320);
    setTimeout(() => this.transfer.set(null), 1100);
  }

  private mySlot(s: RoomSnapshot) {
    return Math.max(0, [...s.players].sort((a, b) => a.seat - b.seat).findIndex((p) => p.id === this.game.playerId()));
  }

  private clearProgressTimers() {
    this.progressTimers.forEach(clearTimeout);
    this.progressTimers = [];
  }

  toast(text: string, kind = 'info') {
    const id = ++this.toastId;
    this.toasts.update((t) => [...t.slice(-3), { id, text, kind }]);
    setTimeout(() => this.toasts.update((t) => t.filter((x) => x.id !== id)), 5200);
  }

  async interact(def: HInteractable) {
    this.game.ping(def.id);
    switch (def.kind) {
      case 'item': {
        const r = await this.game.pickUp(def.itemId!);
        if (!r.ok) this.toast(r.message, 'info');
        else this.audio.sfx(pickupSound(def.itemId!));
        return;
      }
      case 'clue': {
        const clue = this.game.scenario()?.clues?.find((c) => c.id === def.clueId);
        const r = await this.game.discoverClue(def.clueId!);
        if (def.panel) this.panel.set({ id: def.panel, ref: def.ref });
        else if (clue) {
          const by = this.game.snapshot()?.clues?.[clue.id];
          this.note.set({ title: clue.title, text: clue.text, by: r.ok && by ? `נמצא לראשונה על ידי ${this.game.playerName(by)}` : undefined });
        }
        return;
      }
      case 'task':
        await this.completeTask(def.ref!);
        return;
      case 'decor':
        this.audio.sfx(def.id === 'big-dreidel' ? 'spin' : 'select');
        this.note.set({ title: def.label, text: def.text ?? '' });
        return;
      case 'panel':
        if (def.panel === 'lamp') this.openBench('h2-lamp');
        else if (def.panel === 'stand') this.openBench('h5-stand');
        else if (def.panel === 'maze') this.openMaze();
        else if (def.panel === 'box') this.openBox('h3-box', 'box');
        else if (def.panel === 'lock') this.openBox('h5-lock', 'lock');
        else if (def.panel === 'map') this.openBench('g1-map');
        else if (def.panel === 'pendulum') this.openBench('g1-pendulum');
        else if (def.panel === 'assembly') this.openMapTable();
        else if (def.panel === 'runes') this.openRunes();
        else if (def.panel === 'door') void this.openStoneDoor();
        else if (def.panel === 'goldchest') void this.openGoldChest();
        else if (def.panel === 'levers') this.openWatchOr('g2-levers', '');
        else if (def.panel === 'rails') this.openWatchOr('g2-rails', 'לוח המסילות חשוך. קודם אזנו את השרשראות — הן מפעילות את מערכת האנרגיה.');
        else if (def.panel === 'gravity') this.openWatchOr('g2-gravity', 'מוט הכבידה עדיין כבוי. קודם הובילו את כדור האנרגיה אל הליבה.');
        else if (def.panel === 'gate') this.openWatchOr('g2-gate', 'השער נעול היטב. קודם צריך להפעיל את כל מנגנוני הסדנה ולגלות את קוד היציאה.');
        else if (def.panel === 'symbols') this.openBench('g1-symbols');
        else if (def.panel === 'gears') this.openBench('g2-gears');
        else if (def.panel === 'cabinet') this.openWatchOr('g1-cabinet', 'הארון נעול, והגלגלים שלו לא זזים. קודם פענחו את שרשרת הרונים — היא מגלה את הסדר שלהם.');
        else if (def.panel === 'chest') this.openBox('g2-chest', 'chest');
        else if (def.panel === 'scales') this.openScales();
        else if (def.panel === 'book') this.pullBook();
        else this.panel.set({ id: def.panel!, ref: def.ref });
        return;
    }
  }

  /** Reads this player's secret task for the current room; its hidden mark then shows in the room for them alone. */
  async refreshTask() {
    const r = await this.game.getPersonalTask();
    const d = r.ok ? r.data : null;
    const task = d?.id ? { id: d.id, text: d.text ?? '', done: !!d.done, found: d.found } : null;
    this.myTask.set(task);
    this.world?.setMyTask(task?.id ?? null, !!task?.done);
  }

  /** The player found their task's mark: the server checks it is their own task and gives the points once. */
  async completeTask(taskId: string) {
    const r = await this.game.completeTask(taskId);
    if (!r.ok) {
      this.toast(r.message, 'info');
      return;
    }
    // a private message: only this player learns what they found
    this.audio.cue('find', 30);
    this.toast(`🎯 ${r.message}`, 'clue');
    await this.refreshTask();
  }

  /** Pulling the glowing book (the server checks that the board is solved; the bookcase then swings open for everyone). */
  async pullBook() {
    const r = await this.game.operate('h1-book', { op: 'inspect', target: 'glow-book' });
    if (!r.ok) this.toast(r.message, 'info');
    else this.audio.sfx('drawer');
  }

  interactNearest() {
    if (!this.world?.interactNearest()) this.toast('אין כאן חפץ קרוב. התקרבו לחפץ בחדר.', 'info');
  }

  closePanel() {
    this.panel.set(null);
    this.canvas().nativeElement.focus();
  }

  /** The hint button opens the active puzzle of the room the player is in. */
  openHint() {
    const s = this.game.snapshot();
    const p = this.game.scenario()?.puzzles
      .filter((x) => x.zone === this.zone())
      .sort((a, b) => a.order - b.order)
      .find((x) => s?.puzzles.find((y) => y.id === x.id)?.status === 'active');
    if (p && ['h2-lamp', 'h5-stand', 'g1-map', 'g1-symbols', 'g2-gears', 'h7-scales', 'g2-scales'].includes(p.id)) this.openBench(p.id);
    else if (p?.id === 'h3-maze') this.openMaze();
    else if (p?.id === 'h1-evidence') {
      // the first object whose symbol is still hidden
      const ev = s?.mechanisms?.['h1-evidence'];
      const t = (p.publicData?.targets ?? []).find((x: { id: string }) => !ev?.symbols?.includes(x.id));
      this.panel.set({ id: 'evidence', ref: t?.id ?? 'book' });
    }
    else if (p && PUZZLE_PANEL[p.id]) this.panel.set({ id: PUZZLE_PANEL[p.id] });
    else this.toast('אין בחדר הזה חידה פתוחה.', 'info');
  }

  inspectItem(id: string) {
    const item = this.game.scenario()?.items.find((i) => i.id === id);
    if (item) this.note.set({ title: `${this.emoji(id)} ${item.name}`, text: item.description });
  }

  emoji = (id: string) => ITEM_EMOJI[id] ?? '◆';
  zoneName(id: string) {
    return this.game.scenario()?.zones.find((z) => z.id === id)?.name ?? '';
  }
  zoneIndex(id: string) {
    return H_ZONES.indexOf(id as HZone) + 1;
  }
  itemName(id: string) {
    return this.game.scenario()?.items.find((i) => i.id === id)?.name ?? id;
  }

  // ---- tables used directly in the 3D room: lamp bench, dreidel stand (drag and drop) and the maze board

  /** Asks the server for this player's testimonies (and those of players who are away), and shows them if asked to. */
  async loadTestimonies(show = false) {
    const r = await this.game.getPersonalClues('g1-symbols');
    if (!r.ok || !r.data) return;
    this.testimonies.set(r.data.clues);
    if (show && r.data.clues.length) this.testimonyOpen.set(true);
  }

  openTestimony() {
    this.testimonyOpen.set(true);
    void this.loadTestimonies(true);
  }

  openBench(puzzle: string) {
    if (!this.world || this.world.isCutscene) return;
    if (puzzle === 'g1-symbols') void this.loadTestimonies();
    this.panel.set(null);
    this.note.set(null);
    this.benchMsg.set(null);
    this.benchClosed.set(false);
    this.benchMin.set(false);
    if (WATCH.has(puzzle)) {
      this.world.enterWatch(puzzle);
      this.mapPick.set(null);
      if (puzzle === 'g1-pendulum' || puzzle === 'g1-runes') void this.game.syncClock(4);
      this.watchRunes(puzzle === 'g1-runes' || puzzle === 'g2-rails' || puzzle === 'g2-gravity');
      this.focus.set(this.world.isWatch ? puzzle : null);
      return;
    }
    this.world.enterBench(puzzle);
    this.focus.set(this.world.isBench ? puzzle : null);
  }

  private flashObjective(puzzleId: string) {
    clearTimeout(this.objFlashTimer);
    this.objFlash.set(false);
    // restart the animation a moment later, then leave only the steady frame around the task
    setTimeout(() => this.objFlash.set(true), 40);
    this.objFlashTimer = setTimeout(() => this.objFlash.set(false), 3640);
    this.world?.showGuide(this.guideFor(puzzleId));
  }

  /** The one object of the room that belongs to a task, or null when there are several (or none). */
  private guideFor(puzzleId: string): string | null {
    const panel = BENCH_PANEL[puzzleId] ?? PUZZLE_PANEL[puzzleId];
    const zone = this.game.scenario()?.puzzles.find((p) => p.id === puzzleId)?.zone;
    const found = H_INTERACTABLES.filter((d) => d.zone === zone && d.kind === 'panel' && d.panel === panel);
    return found.length === 1 ? found[0].id : null;
  }

  resetBenchPanel() {
    this.benchPos.set(null);
    this.benchMin.set(false);
    this.benchClosed.set(false);
  }

  /** Drags the instructions panel by its title bar (mouse or touch); it can never leave the screen. */
  benchDragStart(e: PointerEvent, el: HTMLElement) {
    if ((e.target as HTMLElement).closest('button') || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture?.(e.pointerId);
    const move = (ev: PointerEvent) => this.benchPos.set(this.clampBench(ev.clientX - dx, ev.clientY - dy));
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }

  private clampBench(x: number, y: number) {
    const w = this.benchRef()?.nativeElement.offsetWidth ?? 320;
    const h = this.benchRef()?.nativeElement.offsetHeight ?? 60;
    return {
      x: Math.round(Math.min(Math.max(0, x), Math.max(0, innerWidth - w))),
      y: Math.round(Math.min(Math.max(0, y), Math.max(0, innerHeight - h))),
    };
  }

  /** After the window changes size (or the phone turns), a moved panel is pulled back inside the screen. */
  private onResize = () => {
    const p = this.benchPos();
    if (p) this.ngZone.run(() => this.benchPos.set(this.clampBench(p.x, p.y)));
  };

  /**
   * The scales: the bonus of the Hanukkah mosaic room, or the free game's last mechanism (open once the gears turn).
   * Balancing them again after a solve only shows the result.
   */
  openScales() {
    if (this.game.snapshot()?.puzzles.find((p) => p.id === this.scalesId())?.status === 'locked') {
      this.audio.sfx('wrong');
      this.toast(this.isSample() ? 'המאזניים עדיין נעולים — קודם הפעילו את גלגלי השיניים.' : 'המאזניים עדיין נעולים.', 'info');
      return;
    }
    this.openBench(this.scalesId());
  }

  openMaze() {
    if (!this.world || this.world.isCutscene) return;
    this.panel.set(null);
    this.note.set(null);
    this.benchMsg.set(null);
    this.benchClosed.set(false);
    // on a phone the maze opens with its instructions folded at the top, so the board and the arrows have the screen; the
    // arrows always come back when the maze is opened again
    this.benchMin.set(window.innerWidth < 760);
    this.padHidden.set(false);
    this.world.enterMaze();
    this.focus.set(this.world.isMaze ? 'h3-maze' : null);
  }

  exitBench() {
    if (!this.focus()) return;
    this.world?.exitBench();
    this.world?.exitMaze();
    this.world?.exitWatch();
    this.watchRunes(false);
    this.focus.set(null);
    this.canvas().nativeElement.focus();
  }

  /**
   * A code lock (the metal box in the maze room, the lock in the dreidel room's door): while its puzzle is still locked,
   * say what is missing instead of opening it; once it can be opened, show the small code panel.
   */
  openBox(puzzleId: string, panel: HPanel) {
    const s = this.game.snapshot();
    const state = s?.puzzles.find((p) => p.id === puzzleId);
    if (state?.status === 'locked') {
      this.audio.sfx('wrong');
      const text = ({
        'h3-box': 'התיבה נעולה. קודם הובילו את המפתח במבוך עד היציאה — שם יתגלה הקוד שפותח אותה.',
        'h5-lock': 'הדלת נעולה במנעול קוד. קודם סדרו את ארבעת הסביבונים במתקן — הקוד כתוב בגבם.',
        'g1-cabinet': 'הארון נעול במנעול בן ארבע ספרות. קודם סדרו את ארבעת הסמלים בלוח — בגבם מסתתר הקוד.',
      } as Record<string, string>)[puzzleId] ?? 'המנעול עדיין נעול.';
      if (this.focus()) this.benchMsg.set({ ok: false, text });
      else this.toast(text, 'info');
      return;
    }
    this.exitBench();
    this.panel.set({ id: panel });
  }

  private async benchOp(puzzle: string, action: object) {
    this.benchBusy.set(true);
    try {
      // changes to the shared table carry the version this player sees (see the puzzle panels)
      const op = (action as { op?: string }).op ?? '';
      const rev = this.game.snapshot()?.mechanisms?.[puzzle]?.rev ?? 0;
      return await this.game.operate(puzzle, ['place', 'remove', 'reset'].includes(op) ? { ...action, rev } : action);
    } finally {
      this.benchBusy.set(false);
    }
  }

  async benchDrop(puzzle: string, item: string, slot: string | null, from: string | null) {
    const mech = this.game.snapshot()?.mechanisms?.[puzzle];
    if (slot && mech?.slots?.[slot] && mech.slots[slot] !== item) {
      this.audio.sfx('wrong');
      this.benchMsg.set({ ok: false, text: 'המקום הזה כבר תפוס. הרימו קודם את מה שמונח בו.' });
      return;
    }
    if (from) {
      const r = await this.benchOp(puzzle, { op: 'remove', slot: from });
      if (!r.ok) {
        this.world?.benchRejected(item);
        this.benchMsg.set({ ok: false, text: r.message });
        return;
      }
    }
    if (!slot) {
      this.audio.sfx('click');
      this.benchMsg.set(null);
      return;
    }
    const r = await this.benchOp(puzzle, { op: 'place', slot, item });
    if (r.ok) {
      this.audio.sfx(r.code === 'placed-wrong' ? 'misplace' : PLACE_SOUND[puzzle] ?? 'place');
      // a full but wrong arrangement is accepted as a move and reported, the zones blink red
      if (r.code === 'placed-wrong') {
        this.world?.flashBench(puzzle);
        this.benchMsg.set({ ok: false, text: r.message });
      } else this.benchMsg.set(r.message ? { ok: true, text: r.message } : null);
    } else {
      this.audio.sfx('misplace');
      this.world?.benchRejected(item);
      this.benchMsg.set({ ok: false, text: r.message });
    }
  }

  async checkBench() {
    const puzzle = this.focus();
    if (!puzzle) return;
    // the workshop's lever is pulled by hand, whatever the result
    if (puzzle === 'g2-gears') this.audio.sfx('lever');
    const r = await this.benchOp(puzzle, { op: 'activate' });
    if (r.ok) {
      this.benchMsg.set({ ok: true, text: puzzle === 'h2-lamp' ? 'המנורה מורכבת נכון!' : puzzle === this.scalesId() ? 'המאזניים מאוזנים!' : 'הסידור נכון!' });
      return;
    }
    this.benchMsg.set({ ok: false, text: r.message });
    this.audio.sfx('wrong');
    this.world?.flashBench(puzzle);
  }

  async resetBench() {
    const puzzle = this.focus();
    if (!puzzle) return;
    const r = await this.benchOp(puzzle, { op: 'reset' });
    this.benchMsg.set({ ok: r.ok, text: r.message });
    if (r.ok) this.audio.sfx('click');
  }

  async benchHint() {
    const puzzle = this.focus();
    if (!puzzle) return;
    this.benchBusy.set(true);
    try {
      const r = await this.game.requestHint(puzzle);
      if (!r.ok) this.benchMsg.set({ ok: false, text: r.message });
    } finally {
      this.benchBusy.set(false);
    }
  }

  /** One step of the dragged maze key; the server checks walls, gates and the order of the symbols. */
  async mazeStep(dir: string) {
    const r = await this.game.operate('h3-maze', { op: 'move', dir });
    if (r.ok) {
      if (this.benchMsg()?.ok === false) this.benchMsg.set(null);
      return true;
    }
    this.benchMsg.set({ ok: false, text: r.message });
    if (r.code !== 'blocked') this.audio.sfx('wrong');
    return false;
  }

  async mazeLever(index: number) {
    const r = await this.game.operate('h3-maze', { op: 'lever', index });
    this.audio.sfx(r.ok ? 'lever' : 'wrong');
    this.benchMsg.set({ ok: r.ok, text: r.message });
  }

  confirmLeave() {
    this.showLeave.set(true);
  }

  async claimHost() {
    const r = await this.game.claimHost();
    if (!r.ok) this.toast(r.message, 'info');
  }

  ngOnDestroy() {
    this.audio.setAmbience(null);
    clearInterval(this.ticker);
    this.clearProgressTimers();
    this.world?.dispose();
  }
}
