import {
  AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, NgZone, OnDestroy, computed, effect, inject, output, signal, untracked, viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AudioService, ThemeId } from '../core/audio.service';
import { GameService } from '../core/game.service';
import { ChatMessage, GameNotice, RoomSnapshot } from '../core/models';
import { SettingsService } from '../core/settings.service';
import { ChatComponent } from '../ui/chat.component';
import { IconComponent } from '../ui/icon.component';
import { JoystickComponent } from '../ui/joystick.component';
import { SettingsPanelComponent } from '../ui/settings-panel.component';
import { LeaveDialogComponent } from '../ui/leave-dialog.component';
import { RoomOverlaysComponent } from '../ui/room-overlays.component';
import { InteractableDef, PanelId, ZONE_ORDER, ZoneId } from '../world/layout';
import { GameWorld } from '../world/world';
import { PuzzlePanelComponent } from './puzzle-panel.component';
import { ResultComponent } from './result.component';

interface Toast { id: number; text: string; kind: string }

/** Intro timeline (seconds from the start of the cinematic) — narration by the portal guardian. */
const INTRO_LINES: [number, string][] = [
  [2, 'intro_01'], [11, 'intro_02'], [21, 'intro_03'], [32, 'intro_04'], [41.5, 'intro_05'],
];

/** The mood of each room of the manor: the library, two decoding rooms, the echo room kept quiet for the bells, the machine room and the portal. */
const ROOM_MUSIC: Record<ZoneId, ThemeId> = {
  library: 'mystery', symbols: 'riddle', echo: 'mystery', mirrors: 'riddle', items: 'mechanism', portal: 'ascent',
};

/** Steps 4–7: opening scene, exploration, finale and result (spec §4). */
@Component({
  selector: 'px-play',
  imports: [IconComponent, ChatComponent, JoystickComponent, SettingsPanelComponent, PuzzlePanelComponent, ResultComponent, RoomOverlaysComponent, LeaveDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stage" [class.cine]="phase() !== 'playing'">
      <canvas #c tabindex="0" aria-label="עולם המשחק התלת־ממדי. השתמשו במקשי החיצים לתנועה ובעכבר לסיבוב."></canvas>
      @if (loading()) { <div class="loading">בונים את האחוזה...</div> }
      @if (flash()) { <div class="flash"></div> }
    </div>

    <!-- opening cinematic -->
    @if (phase() === 'intro') {
      <div class="letterbox top"></div><div class="letterbox bottom"></div>
      @if (introT() < 6) { <div class="title-card"><h1 class="gold-title">PORTAL X</h1><p>הפורטל האחרון</p></div> }
      @if (introT() > game.snapshot()!.introSeconds - 8) {
        <div class="mission card">
          <span class="chip">המשימה שלכם</span>
          <h2>פתחו את הפורטל לפני שייסגר</h2>
          <ul>
            <li>עברו בחמשת חדרי האחוזה ופתרו את החידות</li>
            <li>אספו את הידית, הגביש וגלגל השיניים</li>
            <li>אספו חמש אותיות זהב — הן מילת הסוד של הפורטל</li>
          </ul>
        </div>
      }
      <div class="cine-actions">
        @if (game.isHost()) { <button class="btn small" (click)="skipIntro()">דילוג על הפתיחה ›</button> }
        @else { <span class="muted small">רק המארח יכול לדלג על הפתיחה</span> }
      </div>
    }

    <!-- gameplay HUD -->
    @if (phase() === 'playing') {
      <header class="hud-top">
        <div class="zone card">
          <px-icon [name]="zoneIcon(zone())" [size]="22" />
          <b>{{ zoneName(zone()) }}</b>
          <span class="timer" aria-label="זמן משחק">{{ elapsed() }}</span>
        </div>
        <div class="letters card" aria-label="אותיות זהב">
          <span class="muted small">אותיות זהב</span>
          @for (l of game.snapshot()!.letters; track $index) {
            <span class="gl" [title]="zoneName(l.zone)">{{ l.letter }}<small><px-icon [name]="zoneIcon(l.zone)" [size]="12" /></small></span>
          }
          @for (e of emptyLetters(); track $index) { <span class="gl empty">?</span> }
        </div>
        <div class="tools">
          <button class="btn small" (click)="panel.set({ id: 'map' })" aria-label="מפת האחוזה"><px-icon name="map" [size]="18" /> מפה</button>
          <button class="btn small" (click)="showHelp.set(!showHelp())">עזרה</button>
          <button class="btn small" (click)="showSettings.set(true)">הגדרות</button>
          <button class="btn small ghost" (click)="confirmLeave()">יציאה</button>
        </div>
      </header>

      <aside class="objectives card" [class.collapsed]="!showObjectives()" [class.glow]="objFlash()">
        <button class="obj-head" (click)="showObjectives.set(!showObjectives())" [attr.aria-expanded]="showObjectives()">
          <b>המשימות שלנו</b><span>{{ showObjectives() ? '−' : '+' }}</span></button>
        @if (showObjectives()) {
          <ul>
            @for (p of objectives(); track p.id) {
              <li [class.done]="p.status === 'solved'" [class.locked]="p.status === 'locked'" [class.current]="p.id === activeObjective()" [class.flash]="objFlash() && p.id === activeObjective()"
                [attr.aria-current]="p.id === activeObjective() ? 'step' : null">
                <span class="box">@if (p.status === 'solved') { <px-icon name="check" [size]="14" /> } @else if (p.status === 'locked') { <px-icon name="lock" [size]="12" /> }</span>
                {{ p.objective }}
              </li>
            }
          </ul>
          <p class="players-line">
            @for (pl of game.snapshot()!.players; track pl.id) {
              <span [class.off]="!pl.isConnected" [title]="pl.isConnected ? 'מחובר' : 'מנותק'">● {{ pl.nickname }}</span>
            }
          </p>
        }
      </aside>

      @if (showMap()) {
        <div class="map card" aria-label="מפת האחוזה">
          @for (z of zones(); track z.id) {
            <div class="mz" [class.here]="z.id === zone()" [class.locked]="!game.snapshot()!.unlockedZones.includes(z.id)">
              <px-icon [name]="game.snapshot()!.unlockedZones.includes(z.id) ? z.icon : 'lock'" [size]="18" />{{ z.name }}
            </div>
          }
        </div>
      }

      @if (hover(); as h) { <div class="hover-label">{{ h.label }} <small>· לחצו לבדיקה</small></div> }
      @if (pingText()) { <div class="ping">{{ pingText() }}</div> }

      <footer class="hud-bottom">
        <div class="inventory card" aria-label="התיק המשותף">
          <span class="muted small">התיק המשותף</span>
          @for (id of game.snapshot()!.inventory; track id) {
            <button class="inv-item" (click)="inspectItem(id)" [attr.aria-label]="itemName(id)"><px-icon [name]="id" [size]="26" /><small>{{ itemName(id) }}</small></button>
          } @empty { <span class="muted small">ריק — חפשו חפצים בחדרים</span> }
        </div>
        <div class="right-tools">
          <button class="btn" (click)="openHintFor()"><px-icon name="hint" [size]="20" /> רמזים</button>
          <button class="btn" (click)="showChat.set(!showChat())">צ׳אט @if (unread()) { <span class="badge">{{ unread() }}</span> }</button>
        </div>
      </footer>

      @if (showChat() && !(panel() && narrow())) {
        <section class="chat-pop card" [class.dock]="!!panel()" [class.pulse]="chatPulse()" aria-label="צ׳אט הקבוצה">
          <header><b>צ׳אט הקבוצה</b><button class="btn small ghost" (click)="showChat.set(false)" aria-label="סגירת הצ׳אט">✕</button></header>
          <px-chat />
        </section>
      }

      @if (chatStrip(); as m) {
        <button class="chat-strip" (click)="panel.set(null); showChat.set(true)" aria-live="polite">
          <b>{{ m.nickname }}:</b> {{ m.emote ?? m.text }} <small>· לחצו לפתיחת הצ׳אט</small>
        </button>
      }

      @if (showHelp()) {
        <section class="help card" aria-label="איך משחקים">
          <header><b>איך משחקים</b><button class="btn small ghost" (click)="showHelp.set(false)" aria-label="סגירת העזרה">✕</button></header>
          <ul>
            <li>תנועה: החיצים או W A S D · סיבוב המצלמה: גרירה עם העכבר או האצבע</li>
            <li>לחצו על חפצים מסומנים כדי לבדוק אותם: הקלף על הקיר, הספר שעל הדוכן, הדלת הנעולה</li>
            <li>חלק מהרמזים מופיעים רק לחלק מהשחקנים — שתפו בצ׳אט מה אתם רואים</li>
            <li>נתקעתם? כפתור „רמזים”. כשחידה נפתרת, כל הקבוצה עוברת יחד לחדר הבא</li>
          </ul>
          <button class="btn small primary" (click)="showHelp.set(false)">הבנתי</button>
        </section>
      }

      @if (touch) {
        <px-joystick class="joy" (changed)="world?.setJoystick($event.x, $event.y)" />
        <button class="btn primary act" (click)="interactNearest()">בדיקה</button>
      }
    }

    @if (cutscene(); as c) {
      <div class="letterbox top"></div><div class="letterbox bottom"></div>
      <div class="cut-banner" role="status" aria-live="assertive">
        @if (c.puzzle) { <p class="by">{{ c.puzzle }}</p> }
        <h2 class="gold-title">{{ c.title }}</h2>
        @if (c.letter) { <div class="new-letter"><span>אות זהב חדשה</span><b>{{ c.letter }}</b></div> }
      </div>
    }

    @if (celebration(); as c) {
      <div class="celebrate" role="alert" aria-live="assertive">
        <div class="confetti" aria-hidden="true">@for (i of confetti; track i) { <i [style.--i]="i"></i> }</div>
        <div class="card-c">
          <span class="emoji" aria-hidden="true">🎉</span>
          <h2>{{ c.name }} פתר את החידה!</h2>
          <p>„{{ c.title }}”@if (c.letter) { · אות זהב: <b class="gold-letter">{{ c.letter }}</b> }</p>
          @if (c.next) { <small>עוד רגע עוברים יחד אל {{ c.next }}...</small> }
        </div>
      </div>
    }
    @if (transfer(); as t) {
      <div class="transfer" role="status"><span>{{ t }}</span></div>
    }
    <px-room-overlays [holdSeconds]="7" />
    @if (phase() === 'playing' && game.hostAway()) {
      <div class="host-away" role="status">המארח אינו מחובר כרגע.
        <button class="btn small" (click)="claimHost()">אני אהיה המארח</button></div>
    }
    @if (showLeave()) { <px-leave-dialog (later)="leave.emit()" (forGood)="leaveForGood.emit()" (cancel)="showLeave.set(false)" /> }

    <div class="toasts" aria-live="polite">
      @for (t of toasts(); track t.id) { <div class="toast" [class]="t.kind">{{ t.text }}</div> }
    </div>

    @if (panel(); as p) {
      <px-puzzle-panel [panel]="p.id" [ref]="p.ref" [here]="zone()" [ringBell]="ringBell" (close)="closePanel()" />
    }
    @if (showSettings()) { <px-settings (close)="showSettings.set(false)" /> }

    <!-- finale -->
    @if (phase() === 'completed') {
      @if (!showResult()) {
        <div class="letterbox top"></div><div class="letterbox bottom"></div>
        @if (outroT() > 5) {
          <div class="success">
            <h1 class="gold-title">הצלחנו!</h1>
            <p>הפורטל נפתח בזכות שיתוף הפעולה שלכם</p>
            <button class="btn primary" (click)="showResult.set(true)">לתוצאות המשחק ‹</button>
          </div>
        }
      } @else {
        <px-result (home)="leave.emit()" />
      }
    }
  `,
  styles: [`
    :host { display:block; position:fixed; inset:0; overflow:hidden; }
    .stage { position:absolute; inset:0; } canvas { width:100%; height:100%; display:block; outline:none; touch-action:none; cursor: grab; }
    .loading { position:absolute; inset:0; display:grid; place-items:center; font-size:1.4rem; color: var(--gold-2); background: var(--bg); }
    .flash { position:absolute; inset:0; background:#fff; animation: flash 1.6s ease-out forwards; pointer-events:none; }
    @keyframes flash { 0% { opacity:0 } 15% { opacity: .95 } 100% { opacity:0 } }
    .letterbox { position:fixed; inset-inline:0; height: 9vh; background:#000; z-index: 5; } .letterbox.top { top:0 } .letterbox.bottom { bottom:0 }
    .title-card { position:fixed; inset:0; display:grid; place-content:center; text-align:center; z-index: 6; pointer-events:none; animation: fadein 2s ease; }
    .title-card h1 { font-size: clamp(3rem, 12vw, 7rem); font-weight:900; } .title-card p { font-family: var(--font-title); font-size: 1.8rem; color: var(--gold-2); }
    @keyframes fadein { from { opacity:0; transform: scale(1.05) } }
    .mission { position:fixed; top: 14vh; inset-inline-start: 50%; transform: translateX(50%); z-index: 7; max-width: 520px; width: calc(100% - 32px); animation: missionIn .8s ease both; }
    @keyframes missionIn { from { opacity:0; transform: translate(50%, 12px) } to { opacity:1; transform: translate(50%, 0) } }
    .mission ul { line-height: 1.9; padding-inline-start: 1.2rem; }
    .cine-actions { position:fixed; bottom: calc(9vh + 12px); inset-inline-end: 16px; z-index: 8; }
    .hud-top { position:fixed; top: 10px; inset-inline: 10px; display:flex; gap:.6rem; align-items:flex-start; z-index: 10; pointer-events:none; flex-wrap: wrap; }
    .hud-top > * { pointer-events:auto; }
    .zone { display:flex; align-items:center; gap:.5rem; padding:.5rem .9rem; color: var(--gold-2); }
    .timer { color: var(--text); font-variant-numeric: tabular-nums; margin-inline-start: .4rem; direction:ltr; }
    .letters { display:flex; align-items:center; gap:.3rem; padding:.4rem .7rem; }
    .gl { display:inline-flex; flex-direction:column; align-items:center; font-family: var(--font-title); font-size: 1.4rem; color: #1d1405; background: linear-gradient(180deg,#ffe39a,#e0a93f); width: 34px; border-radius: 6px; line-height:1.1; padding-bottom:2px; }
    .gl small { line-height:0; } .gl.empty { background: rgba(255,255,255,.08); color: var(--muted); }
    .tools { margin-inline-start: auto; display:flex; gap:.4rem; }
    .objectives { position:fixed; top: 70px; inset-inline-start: 10px; width: 290px; z-index: 9; padding: .6rem .9rem; }
    .obj-head { all: unset; cursor:pointer; display:flex; justify-content:space-between; width:100%; color: var(--gold-2); }
    .objectives ul { list-style:none; padding:0; margin:.5rem 0; display:flex; flex-direction:column; gap:.35rem; font-size:.92rem; }
    .objectives li { display:flex; gap:.45rem; align-items:center; } .objectives li.done { color: var(--muted); text-decoration: line-through; } .objectives li.locked { opacity:.5; }
    .box { width: 18px; height: 18px; border:1px solid var(--gold); border-radius: 4px; display:grid; place-items:center; flex-shrink:0; color: var(--ok); }
    /* the task to do now: a soft gold-and-blue frame; right after a task is done the box glows and the next task blinks gently three times */
    .objectives li.current { border:1px solid rgba(246,215,141,.8); border-radius:8px; padding:.2rem .4rem; background: rgba(224,185,92,.1); box-shadow: 0 0 10px rgba(110,160,255,.35); }
    .objectives.glow { animation: objGlow 1.1s ease-in-out 3; }
    .objectives li.flash { animation: objPulse 1.1s ease-in-out 3; }
    @keyframes objGlow { 0%, 100% { box-shadow: var(--shadow); } 50% { box-shadow: 0 0 0 2px var(--gold-2), 0 0 26px rgba(110,160,255,.7); } }
    @keyframes objPulse { 0%, 100% { background: rgba(224,185,92,.1); } 50% { background: rgba(246,215,141,.32); box-shadow: 0 0 16px rgba(246,215,141,.6); } }
    @media (prefers-reduced-motion: reduce) { .objectives.glow, .objectives li.flash { animation:none; } }
    .players-line { display:flex; flex-wrap:wrap; gap:.5rem; font-size:.82rem; margin:0; } .players-line span { color: var(--ok); } .players-line .off { color: var(--muted); }
    .map { position:fixed; top: 70px; inset-inline-end: 10px; z-index: 9; display:flex; flex-direction:column; gap:.3rem; padding:.6rem; }
    .mz { display:flex; gap:.4rem; align-items:center; padding:.3rem .6rem; border-radius: 8px; } .mz.here { background: rgba(224,185,92,.25); color: var(--gold-2); } .mz.locked { opacity:.45; }
    .hover-label { position:fixed; top: 46%; left: 50%; transform: translate(-50%, -140%); background: rgba(0,0,0,.75); padding:.35rem .8rem; border-radius: 999px; border:1px solid var(--line); pointer-events:none; z-index: 8; white-space:nowrap; }
    .hover-label small { color: var(--gold-2); }
    .ping { position:fixed; top: 76px; left: 50%; transform: translateX(-50%); background: rgba(106,168,255,.2); border: 1px solid var(--blue); padding:.4rem .9rem; border-radius: 999px; z-index: 11; }
    .hud-bottom { position:fixed; bottom: 10px; inset-inline: 10px; display:flex; gap:.6rem; align-items:flex-end; z-index: 10; pointer-events:none; }
    .hud-bottom > * { pointer-events:auto; }
    .inventory { display:flex; align-items:center; gap:.5rem; padding:.45rem .8rem; flex-wrap: wrap; }
    .inv-item { display:flex; flex-direction:column; align-items:center; background: rgba(255,255,255,.07); border:1px solid var(--line); border-radius: 10px; color: var(--gold-2); padding: .25rem .5rem; cursor:pointer; font-family: inherit; }
    .inv-item small { color: var(--text); font-size: .72rem; }
    .right-tools { margin-inline-start: auto; display:flex; gap:.4rem; }
    .badge { background: var(--bad); color:#fff; border-radius: 999px; font-size:.75rem; padding: 0 .45em; }
    .chat-pop { position:fixed; bottom: 80px; inset-inline-end: 10px; width: min(360px, calc(100% - 20px)); height: 380px; z-index: 12; display:flex; flex-direction:column; padding:.6rem; }
    .chat-pop header { display:flex; justify-content:space-between; align-items:center; }
    .toasts { position:fixed; top: 70px; left: 50%; transform: translateX(-50%); display:flex; flex-direction:column; gap:.4rem; align-items:center; z-index: 30; pointer-events:none; width: min(560px, calc(100% - 32px)); }
    .toast { background: rgba(10,16,36,.92); border: 1px solid var(--line); padding:.55rem 1rem; border-radius: 12px; box-shadow: var(--shadow); animation: fadein .3s ease; text-align:center; }
    .toast.puzzle-solved, .toast.zone-unlocked, .toast.letter { border-color: var(--gold-2); color: var(--gold-2); }
    .toast.wrong-answer { border-color: rgba(226,113,91,.6); }
    .toast.hint { border-color: var(--blue); }
    .joy { position:fixed; bottom: 90px; left: 20px; z-index: 11; }
    .act { position:fixed; bottom: 110px; right: 20px; z-index: 11; width: 86px; height: 86px; border-radius: 50%; }
    .celebrate { position:fixed; inset:0; z-index: 70; pointer-events:none; display:flex; justify-content:center; align-items:flex-start; padding-top: 16vh; }
    .celebrate .card-c { pointer-events:auto; text-align:center; background: linear-gradient(180deg, rgba(40,30,8,.95), rgba(14,20,44,.95)); border: 2px solid var(--gold-2);
      border-radius: 20px; padding: 1rem 2rem 1.2rem; box-shadow: 0 0 60px rgba(224,185,92,.45); animation: popIn .5s cubic-bezier(.2,1.4,.4,1) both; max-width: calc(100% - 32px); }
    .celebrate .emoji { font-size: 3rem; display:block; animation: wiggle 1s ease .4s 2; }
    .celebrate h2 { font-size: clamp(1.6rem, 4.5vw, 2.6rem); margin: .2rem 0; color: var(--gold-2); }
    .celebrate p { margin: .2rem 0; font-size: 1.1rem; } .celebrate small { color: var(--muted); }
    .gold-letter { font-family: var(--font-title); color:#1d1405; background: linear-gradient(180deg,#ffe39a,#e0a93f); border-radius: 6px; padding: 0 .4rem; }
    .confetti { position:absolute; inset:0; overflow:hidden; }
    .confetti i { position:absolute; top:-12px; left: calc(var(--i) * 4.1%); width: 9px; height: 14px; border-radius: 2px;
      background: hsl(calc(var(--i) * 37), 85%, 62%); animation: fall 2.6s linear calc(var(--i) * 45ms) both; }
    @keyframes fall { to { transform: translateY(105vh) rotate(calc(var(--i) * 70deg)); opacity: .2 } }
    @keyframes popIn { from { opacity:0; transform: scale(.6) } to { opacity:1; transform: scale(1) } }
    @keyframes wiggle { 50% { transform: rotate(-14deg) scale(1.2) } }
    .transfer { position:fixed; inset:0; z-index: 65; background: radial-gradient(circle, rgba(10,16,40,.75), #03050c); display:grid; place-items:center;
      color: var(--gold-2); font-size: 1.4rem; font-family: var(--font-title); animation: fadeInOut 1.1s ease both; }
    @keyframes fadeInOut { 0% { opacity:0 } 25%, 70% { opacity:1 } 100% { opacity:0 } }
    .chat-pop { animation: chatIn .28s ease both; }
    @keyframes chatIn { from { opacity:0; transform: translateY(14px) scale(.97) } to { opacity:1; transform:none } }
    .chat-pop.pulse { box-shadow: 0 0 0 2px var(--gold-2), var(--shadow); }
    .chat-pop.dock { z-index: 60; top: 72px; bottom: auto; height: min(52vh, 380px); width: min(320px, calc((100vw - 790px) / 2 - 12px)); }
    .chat-strip { position:fixed; top: 6px; left: 0; right: 0; margin-inline: auto; width: fit-content; z-index: 61; max-width: min(620px, calc(100% - 24px)); white-space: nowrap; overflow:hidden; text-overflow: ellipsis;
      background: rgba(14,20,44,.96); color: var(--text); border: 1px solid var(--gold); border-radius: 999px; padding: .4rem 1rem; font-family: inherit; cursor:pointer; animation: chatIn .25s ease both; }
    .chat-strip b { color: var(--gold-2); } .chat-strip small { color: var(--muted); }
    .help { position:fixed; bottom: 90px; left: 0; right: 0; margin-inline: auto; z-index: 11; width: min(520px, calc(100% - 24px)); padding: .7rem 1rem; animation: chatIn .3s ease both; }
    .help header { display:flex; justify-content:space-between; align-items:center; color: var(--gold-2); }
    .help ul { margin: .4rem 0 .6rem; padding-inline-start: 1.1rem; line-height: 1.7; font-size: .95rem; }
    .cut-banner { position:fixed; top: calc(9vh + 14px); left: 50%; transform: translateX(-50%); z-index: 15; text-align:center; animation: bannerIn .6s ease both; width: min(640px, calc(100% - 32px)); }
    @keyframes bannerIn { from { opacity:0; transform: translate(-50%, -12px) } to { opacity:1; transform: translate(-50%, 0) } }
    .cut-banner h2 { font-size: clamp(1.8rem, 5vw, 3rem); font-weight: 900; margin: .2rem 0; }
    .cut-banner .by { margin:0; font-size: 1.1rem; text-shadow: 0 2px 8px #000; }
    .new-letter { display:inline-flex; align-items:center; gap:.6rem; background: rgba(0,0,0,.6); border:1px solid var(--gold); border-radius: 999px; padding:.3rem .9rem; }
    .new-letter b { font-family: var(--font-title); font-size: 2.2rem; color: #1d1405; background: linear-gradient(180deg,#ffe39a,#e0a93f); border-radius: 8px; padding: 0 .5rem; animation: pop 1s ease .8s both; }
    @keyframes pop { from { transform: scale(0) rotate(-30deg) } 70% { transform: scale(1.3) } to { transform: scale(1) } }
    .success { position:fixed; inset:0; display:grid; place-content:center; text-align:center; z-index: 20; animation: fadein 1.2s ease; gap: .6rem; }
    .success h1 { font-size: clamp(3.5rem, 12vw, 7rem); font-weight: 900; } .success p { font-size: 1.4rem; text-shadow: 0 2px 10px #000; }
    .small { font-size: .85rem; }
    .host-away { position:fixed; top: 58px; left:0; right:0; margin-inline:auto; width:fit-content; z-index:12; background: rgba(122,58,18,.92); color:#fff;
      border-radius:999px; padding:.3rem .5rem .3rem 1rem; display:flex; gap:.6rem; align-items:center; }
    @media (max-width: 760px) {
      .objectives { top: auto; bottom: 150px; width: calc(100% - 20px); max-height: 32vh; overflow:auto; }
      .objectives.collapsed { width: auto; }
      .tools .btn { padding: .4em .7em; }
      .hover-label { display:none; }
    }
  `],
})
export class PlayComponent implements AfterViewInit, OnDestroy {
  game = inject(GameService);
  private audio = inject(AudioService);
  private settings = inject(SettingsService);
  private ngZone = inject(NgZone);
  private destroyRef = inject(DestroyRef);
  leave = output<void>();
  leaveForGood = output<void>();
  showLeave = signal(false);

  private canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('c');
  world?: GameWorld;
  touch = matchMedia('(pointer: coarse)').matches;

  loading = signal(true);
  flash = signal(false);
  zone$ = signal<ZoneId>('library');
  hover = signal<InteractableDef | null>(null);
  panel = signal<{ id: PanelId; ref?: string } | null>(null);
  toasts = signal<Toast[]>([]);
  showChat = signal(false);
  showMap = signal(false);
  showSettings = signal(false);
  showObjectives = signal(!matchMedia('(max-width: 760px)').matches);
  showResult = signal(false);
  pingText = signal<string | null>(null);
  cutscene = signal<{ title: string; letter?: string; puzzle?: string } | null>(null);
  celebration = signal<{ name: string; title: string; letter?: string; next?: string } | null>(null);
  transfer = signal<string | null>(null);
  showHelp = signal(false);
  chatPulse = signal(false);
  chatStrip = signal<ChatMessage | null>(null);
  narrow = signal(matchMedia('(max-width: 1279px)').matches);
  confetti = Array.from({ length: 24 }, (_, i) => i);
  unread = signal(0);
  tick = signal(0);

  phase = computed(() => this.game.snapshot()?.phase ?? 'lobby');
  zone = this.zone$.asReadonly();
  zones = computed(() => [...(this.game.scenario()?.zones ?? [])].sort((a, b) => a.order - b.order));
  objectives = computed(() => {
    const sc = this.game.scenario();
    const s = this.game.snapshot();
    if (!sc || !s) return [];
    return sc.puzzles.map((p) => ({ id: p.id, objective: p.objective, status: s.puzzles.find((x) => x.id === p.id)?.status ?? 'locked' }));
  });
  /** The task to do now: the first one the server lists as open. */
  activeObjective = computed(() => this.objectives().find((p) => p.status === 'active')?.id ?? null);
  /** True for a few seconds after the server confirmed a task and the next one became the active one. */
  objFlash = signal(false);
  private lastActiveObjective: string | null | undefined;
  private objFlashTimer?: ReturnType<typeof setTimeout>;
  emptyLetters = computed(() => Array.from({ length: Math.max(0, 5 - (this.game.snapshot()?.letters.length ?? 0)) }));
  introT = computed(() => {
    this.tick();
    const s = this.game.snapshot();
    return s?.introStartedAt ? (this.game.serverNow() - new Date(s.introStartedAt).getTime()) / 1000 : 0;
  });
  outroT = computed(() => {
    this.tick();
    const s = this.game.snapshot();
    return s?.endedAt ? (this.game.serverNow() - new Date(s.endedAt).getTime()) / 1000 : 0;
  });
  elapsed = computed(() => {
    this.tick();
    const s = this.game.snapshot();
    if (!s?.startedAt) return '00:00';
    const sec = Math.max(0, Math.floor((this.game.serverNow() - new Date(s.startedAt).getTime()) / 1000));
    return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  });

  private toastId = 0;
  private ticker?: ReturnType<typeof setInterval>;
  private introTimers: ReturnType<typeof setTimeout>[] = [];
  private lastPhase: string | null = null;
  private introFinishSent = false;
  private seenChat = 0;
  private seenChatIds: Set<string> | null = null;
  private announced = new Set<string>();
  private activeZoneApplied: string | null = null;
  private pendingShown: string | null = null;
  private progressTimers: ReturnType<typeof setTimeout>[] = [];

  ringBell = (id: string) => this.world?.ringBell(id);

  constructor() {
    this.ticker = setInterval(() => this.tick.update((t) => t + 1), 500);

    effect(() => {
      const s = this.game.snapshot();
      const sc = this.game.scenario();
      if (!s || !this.world) return;
      untracked(() => {
        if (this.loading() && sc) this.buildWorld();
        if (this.loading()) return;
        this.world!.applySnapshot(s);
        this.world!.setPlayers(s.players, this.game.playerId(), this.game.positions);
        this.onPhase(s.phase);
        this.handleProgress(s);
      });
    });

    effect(() => {
      const t = this.introT();
      if (this.phase() !== 'intro') return;
      untracked(() => {
        if (!this.introFinishSent && t >= (this.game.snapshot()?.introSeconds ?? 52)) {
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
          this.seenChat = list.length;
          return;
        }
        const fresh = list.filter((m) => !this.seenChatIds!.has(m.id));
        fresh.forEach((m) => this.seenChatIds!.add(m.id));
        this.seenChat = list.length;
        if (!fresh.length) return;
        // every new message opens the team chat for everyone (one panel, no duplicates)
        this.showChat.set(true);
        this.unread.set(0);
        this.chatPulse.set(true);
        setTimeout(() => this.chatPulse.set(false), 900);
        if (this.panel() && this.narrow()) {
          const last = fresh[fresh.length - 1];
          this.chatStrip.set(last);
          setTimeout(() => this.chatStrip() === last && this.chatStrip.set(null), 6000);
        }
      });
    });
    const mq = matchMedia('(max-width: 1279px)');
    const onMq = () => this.narrow.set(mq.matches);
    mq.addEventListener('change', onMq);
    this.destroyRef.onDestroy(() => mq.removeEventListener('change', onMq));
    effect(() => {
      if (this.showChat()) untracked(() => this.unread.set(0));
    });

    // the room's own music, changed gradually when the player walks into another room
    effect(() => {
      const zone = this.zone();
      if (this.phase() === 'playing') untracked(() => this.audio.setMusic(ROOM_MUSIC[zone] ?? 'explore'));
    });

    // the next task lights up when it changes — it follows the server's state, so every player sees the same task
    effect(() => {
      const id = this.activeObjective();
      const playing = this.phase() === 'playing';
      untracked(() => {
        if (playing && id && this.lastActiveObjective !== undefined && id !== this.lastActiveObjective) {
          clearTimeout(this.objFlashTimer);
          this.objFlash.set(false);
          setTimeout(() => this.objFlash.set(true), 40);
          this.objFlashTimer = setTimeout(() => this.objFlash.set(false), 3640);
        }
        this.lastActiveObjective = playing ? id : undefined;
      });
    });

    this.game.notices$.pipe(takeUntilDestroyed()).subscribe((n) => this.onNotice(n));
    this.game.pings$.pipe(takeUntilDestroyed()).subscribe((p) => {
      const def = this.world?.focusOn(p.objectId);
      if (!def) return;
      this.pingText.set(`${this.game.playerName(p.playerId)} מצביע על חפץ`);
      setTimeout(() => this.pingText.set(null), 3000);
    });
    effect(() => {
      const sens = this.settings.settings().lookSensitivity;
      if (this.world) this.world.sensitivity = sens;
    });
  }

  ngAfterViewInit() {
    try {
      this.world = this.ngZone.runOutsideAngular(
        () =>
          new GameWorld(this.canvas().nativeElement, this.settings.settings().quality, {
            onHover: (d) => this.ngZone.run(() => this.hover.set(d)),
            onInteract: (d) => this.ngZone.run(() => this.interact(d)),
            onTooFar: (d) => this.ngZone.run(() => this.toast(`התקרבו אל ${d.label} כדי לבדוק`, 'info')),
            onZoneChange: (z) => this.ngZone.run(() => this.zone$.set(z)),
            onMove: (x, y, z, ry, zone) => this.game.move(x, y, z, ry, zone),
          }),
      );
      this.world.sensitivity = this.settings.settings().lookSensitivity;
      if (this.game.scenario()) this.buildWorld();
    } catch {
      this.loading.set(false);
      this.toast('הדפדפן אינו תומך בתלת־ממד (WebGL). נסו דפדפן מעודכן כמו Chrome, Edge או Firefox.', 'wrong-answer');
    }
  }

  private buildWorld() {
    if (!this.world || !this.loading()) return;
    this.ngZone.runOutsideAngular(() => {
      this.world!.build(this.game.scenario());
      this.world!.start();
    });
    this.loading.set(false);
    const s = this.game.snapshot()!;
    this.world.applySnapshot(s);
    this.world.setPlayers(s.players, this.game.playerId(), this.game.positions);
    const mine = this.game.positions.get(this.game.playerId() ?? '');
    if (mine && s.phase === 'playing') this.world.placePlayer(mine);
    this.onPhase(s.phase);
    // the first state arrived before the world existed — apply the server's active room now (reload / reconnect)
    this.handleProgress(s);
  }

  private onPhase(phase: string) {
    if (phase === this.lastPhase || !this.world) return;
    const prev = this.lastPhase;
    this.lastPhase = phase;
    if (phase === 'intro') {
      this.world.setMode('intro');
      this.world.setIntroTime(this.introT());
      this.audio.setMusic('intro');
      this.audio.sfx('whoosh');
      this.scheduleIntroLines();
      this.introFinishSent = false;
    } else if (phase === 'playing') {
      this.clearIntro();
      this.world.setMode('play');
      if (prev === 'intro' || prev === null) {
        this.world.resetPlayer();
        const mine = this.game.positions.get(this.game.playerId() ?? '');
        if (mine && prev === null) this.world.placePlayer(mine);
      }
      this.audio.setMusic(ROOM_MUSIC[this.zone()] ?? 'explore');
      if (prev === 'intro') {
        this.audio.speak('mission', undefined, undefined, true);
        this.toast('המשימה התחילה! חפשו בספרייה את הקלף ואת ספר המפתח.', 'zone-unlocked');
        this.showHelp.set(true);
        setTimeout(() => this.showHelp.set(false), 20000);
      }
      this.canvas().nativeElement.focus();
    } else if (phase === 'completed') {
      this.panel.set(null);
      this.world.setMode('outro');
      this.audio.setMusic('victory');
      this.audio.sfx('whoosh');
      this.showResult.set(prev === null);
      if (prev === 'playing') {
        setTimeout(() => this.flashOnce(), 3500);
        this.audio.speak('outro_success', undefined, undefined, true);
        this.audio.speak('outro_02');
      }
    }
  }

  private scheduleIntroLines() {
    this.clearIntro();
    const t = this.introT();
    for (const [at, id] of INTRO_LINES) {
      if (at + 3 < t) continue;
      this.introTimers.push(setTimeout(() => this.audio.speak(id), Math.max(0, (at - t) * 1000)));
    }
  }

  private clearIntro() {
    this.introTimers.forEach(clearTimeout);
    this.introTimers = [];
  }

  async skipIntro() {
    this.audio.stopVoice();
    const r = await this.game.finishIntro(true);
    if (!r.ok) this.toast(r.message, 'info');
  }

  private flashOnce() {
    this.flash.set(true);
    setTimeout(() => this.flash.set(false), 1700);
  }

  private onNotice(n: GameNotice) {
    const mine = n.playerId === this.game.playerId();
    switch (n.kind) {
      case 'puzzle-solved':
        // the "X solved the puzzle!" announcement is driven by the server state (handleProgress), once per puzzle
        this.audio.speak(n.voiceLine, n.message.split('! ').slice(1).join('! ') || n.message, 'שומר הפורטל');
        break;
      case 'zone-unlocked':
        this.audio.sfx('door');
        this.audio.speak(n.voiceLine, undefined, 'שומר הפורטל');
        break;
      case 'item-collected':
        this.audio.sfx('pickup');
        this.toast(n.message, n.kind);
        break;
      case 'letter':
        this.audio.sfx('letter'); // shown in the HUD and in the transition banner
        break;
      case 'wrong-answer':
        this.audio.sfx('wrong');
        if (!mine) this.toast(n.message, n.kind);
        else this.audio.speak(n.voiceLine, undefined, 'שומר הפורטל');
        break;
      case 'hint':
        this.audio.sfx('hint');
        this.toast(n.message, n.kind);
        this.audio.speak(n.voiceLine, n.message.split(': ').slice(1).join(': '), 'שומר הפורטל');
        break;
      case 'item-picked':
      case 'item-combined':
      case 'item-placed':
        this.audio.sfx('pickup');
        this.toast(n.message, n.kind);
        break;
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

  /**
   * Progress driven by the server state, so every player sees the same thing exactly once:
   *  - a "X solved the puzzle!" celebration for each newly solved puzzle (keyed by round + puzzle),
   *  - the move of the whole group into the server's active room at activeZoneSince + transitionDelayMs.
   * Reconnecting players skip old celebrations and are placed straight into the active room.
   */
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
      if (p.solvedAt && now - Date.parse(p.solvedAt) < 8000) this.celebrate(s, p.id);
    }
    // a room just opened: the door opens and the camera shows it; the group moves on with "Continue"
    if (s.phase === 'playing' && s.pendingZone && s.pendingZone !== this.pendingShown && this.world) {
      this.pendingShown = s.pendingZone;
      this.panel.set(null);
      this.progressTimers.push(setTimeout(() => this.world?.playDoorCutscene(s.pendingZone!), 1800));
    }
    if (s.phase !== 'playing' || !this.world || s.activeZone === this.activeZoneApplied) return;

    const first = this.activeZoneApplied === null;
    const target = s.activeZone as ZoneId;
    this.activeZoneApplied = target;
    this.clearProgressTimers();
    const moveAt = s.activeZoneSince ? Date.parse(s.activeZoneSince) + s.transitionDelayMs : 0;
    const wait = moveAt - now;
    if (first && (wait <= 0 || !s.activeZoneSince)) {
      // fresh page or reconnect: be in the right room immediately
      if (this.world.localZone !== target) this.world.transferTo(target, this.mySlot(s));
      return;
    }
    if (wait > 1200) {
      this.panel.set(null);
      this.progressTimers.push(setTimeout(() => this.world?.playDoorCutscene(target), Math.max(0, wait - 3400)));
      this.progressTimers.push(setTimeout(() => this.moveGroup(target), wait));
    } else this.moveGroup(target);
  }

  private celebrate(s: RoomSnapshot, puzzleId: string) {
    const state = s.puzzles.find((p) => p.id === puzzleId);
    const content = this.game.scenario()?.puzzles.find((p) => p.id === puzzleId);
    const next = content?.unlocksZone ? this.zoneName(content.unlocksZone) : undefined;
    this.audio.sfx('success');
    setTimeout(() => this.audio.sfx('letter'), 600);
    this.celebration.set({
      name: this.game.playerName(state?.solvedBy) || 'הקבוצה',
      title: content?.title ?? '',
      letter: content?.rewardLetter,
      next,
    });
    setTimeout(() => this.celebration.set(null), 3600);
  }

  private moveGroup(zone: ZoneId) {
    this.panel.set(null);
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

  async interact(def: InteractableDef) {
    if (def.itemId) {
      const r = await this.game.pickUp(def.itemId);
      if (!r.ok) this.toast(r.message, 'info');
      return;
    }
    if (def.panel) {
      this.panel.set({ id: def.panel, ref: def.ref });
      this.game.ping(def.id);
    }
  }

  interactNearest() {
    const d = this.world?.interactNearest();
    if (!d) this.toast('אין כאן חפץ קרוב לבדיקה. התקרבו לחפץ מסומן.', 'info');
  }

  closePanel() {
    this.panel.set(null);
    this.canvas().nativeElement.focus();
  }

  openHintFor() {
    // Open the lock panel of the puzzle in the current room so its hints can be requested.
    const map: Record<ZoneId, PanelId> = {
      library: 'cipher-lock', symbols: 'sequence-lock', echo: 'sound-lock', mirrors: 'split-lock', items: 'pedestal', portal: 'portal-lock',
    };
    this.panel.set({ id: map[this.zone()] });
  }

  inspectItem(id: string) {
    const item = this.game.scenario()?.items.find((i) => i.id === id);
    if (item) this.toast(`${item.name}: ${item.description}`, 'info');
  }

  zoneName(id: string) {
    return this.game.scenario()?.zones.find((z) => z.id === id)?.name ?? '';
  }
  zoneIcon(id: string) {
    return this.game.scenario()?.zones.find((z) => z.id === id)?.icon ?? 'lock';
  }
  itemName(id: string) {
    return this.game.scenario()?.items.find((i) => i.id === id)?.name ?? id;
  }

  confirmLeave() {
    this.showLeave.set(true);
  }

  async claimHost() {
    const r = await this.game.claimHost();
    if (!r.ok) this.toast(r.message, 'info');
  }

  ngOnDestroy() {
    clearInterval(this.ticker);
    this.clearProgressTimers();
    this.clearIntro();
    this.audio.stopVoice();
    this.world?.dispose();
  }
}
