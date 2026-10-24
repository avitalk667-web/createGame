import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { Quality, SettingsService } from '../core/settings.service';
import { AudioService } from '../core/audio.service';

/** Sound, captions and graphics settings (spec §5 "מסך הגדרות שמע, כתוביות, איכות גרפית ונגישות"). */
@Component({
  selector: 'px-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="overlay" (click)="close.emit()">
      <section class="panel-modal" role="dialog" aria-modal="true" aria-labelledby="st" (click)="$event.stopPropagation()">
        <header>
          <h2 id="st">הגדרות</h2>
          <button class="btn small ghost" (click)="close.emit()" aria-label="סגירת ההגדרות">✕</button>
        </header>
        @let s = svc.settings();
        <h3>שמע</h3>
        <label class="row"><span>עוצמת דיבור</span>
          <input type="range" min="0" max="1" step="0.05" [value]="s.voice" (input)="set('voice', $event)" aria-label="עוצמת דיבור" /></label>
        <label class="row"><span>עוצמת מוזיקה</span>
          <input type="range" min="0" max="1" step="0.05" [value]="s.music" (input)="set('music', $event)" aria-label="עוצמת מוזיקה" /></label>
        <label class="row"><span>עוצמת אפקטים</span>
          <input type="range" min="0" max="1" step="0.05" [value]="s.effects" (input)="set('effects', $event)" aria-label="עוצמת אפקטים" /></label>
        <label class="row check"><input type="checkbox" [checked]="s.musicOn" (change)="toggle('musicOn', $event)" /><span>מוזיקת רקע</span></label>
        <label class="row check"><input type="checkbox" [checked]="s.effectsOn" (change)="toggle('effectsOn', $event)" /><span>אפקטים קוליים</span></label>
        <label class="row check"><input type="checkbox" [checked]="s.muted" (change)="toggle('muted', $event)" /><span>השתקת כל הצלילים</span></label>
        <p class="muted small">ההעדפות נשמרות בדפדפן הזה בלבד, גם לביקור הבא.</p>
        <label class="row check"><input type="checkbox" [checked]="s.silentMode" (change)="toggle('silentMode', $event)" />
          <span>משחק ללא קול — כל צליל מקבל גם סימון חזותי</span></label>
        <h3>כתוביות ונגישות</h3>
        <label class="row check"><input type="checkbox" [checked]="s.captions" (change)="toggle('captions', $event)" /><span>הצגת כתוביות בעברית</span></label>
        <label class="row"><span>רגישות סיבוב המצלמה</span>
          <input type="range" min="0.4" max="2" step="0.1" [value]="s.lookSensitivity" (input)="set('lookSensitivity', $event)" aria-label="רגישות סיבוב" /></label>
        <h3>איכות גרפית</h3>
        <div class="seg" role="radiogroup" aria-label="איכות גרפית">
          @for (q of qualities; track q.id) {
            <button class="btn small" role="radio" [attr.aria-checked]="s.quality === q.id" [class.primary]="s.quality === q.id" (click)="svc.update({ quality: q.id })">{{ q.name }}</button>
          }
        </div>
        <p class="muted small">איכות נמוכה מתאימה למחשבים חלשים ולטלפונים. שינוי האיכות ייכנס לתוקף בכניסה הבאה למסך המשחק.</p>
        <h3>שליטה</h3>
        <ul class="muted small keys">
          <li>תנועה: W A S D או החיצים · ריצה: Shift</li>
          <li>סיבוב המצלמה: גרירה עם העכבר או האצבע · זום: גלגלת</li>
          <li>בדיקת חפץ: לחיצה עליו, או מקש E כשהוא מסומן</li>
          <li>בטלפון: ג׳ויסטיק בפינה וכפתור „בדיקה”</li>
        </ul>
      </section>
    </div>
  `,
  styles: [`
    header { display:flex; justify-content:space-between; align-items:center; }
    h3 { font-size: 1.05rem; color: var(--gold-2); margin: 1rem 0 .4rem; }
    .row { display:flex; align-items:center; justify-content:space-between; gap:1rem; padding:.35rem 0; }
    .row input[type=range] { width: min(260px, 50%); accent-color: var(--gold); }
    .check { justify-content:flex-start; } .check input { width: 20px; height: 20px; accent-color: var(--gold); }
    .seg { display:flex; gap:.5rem; flex-wrap: wrap; }
    .small { font-size:.88rem; } .keys { padding-inline-start: 1.1rem; line-height:1.8; }
  `],
})
export class SettingsPanelComponent {
  svc = inject(SettingsService);
  private audio = inject(AudioService);
  close = output<void>();
  qualities: { id: Quality; name: string }[] = [
    { id: 'low', name: 'נמוכה' },
    { id: 'medium', name: 'בינונית' },
    { id: 'high', name: 'גבוהה' },
  ];

  set(key: 'voice' | 'music' | 'effects' | 'lookSensitivity', e: Event) {
    this.svc.update({ [key]: +(e.target as HTMLInputElement).value });
    if (key === 'effects') this.audio.sfx('click');
  }

  toggle(key: 'muted' | 'captions' | 'silentMode' | 'musicOn' | 'effectsOn', e: Event) {
    this.svc.update({ [key]: (e.target as HTMLInputElement).checked });
  }
}
