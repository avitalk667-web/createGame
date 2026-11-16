import { ChangeDetectionStrategy, Component, HostListener, input, output, signal } from '@angular/core';

export type KeypadStatus = 'idle' | 'busy' | 'wrong' | 'right';

/**
 * The four-digit lock beside the door. Digits by tap or keyboard, ⌫ to erase, ✓ (or Enter) to try. The page sends the
 * code to the server and reports back through `status` and `message`.
 */
@Component({
  selector: 'px-demo-keypad',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="overlay" (click)="closed.emit()">
      <section class="panel-modal pad" role="dialog" aria-modal="true" aria-labelledby="pad-title" (click)="$event.stopPropagation()">
        <header>
          <h2 id="pad-title" class="gold-title">המנעול של הדלת</h2>
          <button class="btn small ghost" (click)="closed.emit()" aria-label="סגירה וחזרה לחדר">✕</button>
        </header>
        <p class="muted small sub">הזינו ארבע ספרות כדי לפתוח את השער.</p>

        <div class="screen" [class.wrong]="status() === 'wrong'" [class.right]="status() === 'right'" dir="ltr"
          role="status" [attr.aria-label]="'הקוד שהוזן: ' + (digits().join(' ') || 'ריק')">
          @for (i of slots; track i) { <span class="slot" [class.filled]="digits()[i]">{{ digits()[i] ?? '' }}</span> }
        </div>
        <p class="msg" [class.bad]="status() === 'wrong'" [class.good]="status() === 'right'" aria-live="assertive">{{ message() }}</p>

        <div class="keys" dir="ltr">
          @for (k of keys; track k) {
            <button class="key" [class.fn]="k === '⌫' || k === '✓'" [class.ok]="k === '✓'" [disabled]="locked()"
              (click)="press(k)" [attr.aria-label]="k === '⌫' ? 'מחיקת ספרה' : k === '✓' ? 'בדיקת הקוד' : k">{{ k }}</button>
          }
        </div>
        <div class="row">
          <button class="btn small" (click)="hint.emit()" [disabled]="locked()">💡 רמז</button>
          <button class="btn small ghost" (click)="closed.emit()">חזרה לחקירה</button>
        </div>
      </section>
    </div>
  `,
  styles: [`
    .pad { max-width: 380px; width: calc(100vw - 32px); text-align:center; }
    header { display:flex; justify-content:space-between; align-items:center; }
    h2 { margin:0; font-size:1.45rem; }
    .sub { margin:.2rem 0 .8rem; }
    .screen { display:flex; gap:.5rem; justify-content:center; padding:.7rem; border-radius:12px; background:#0b1410; border:1px solid #2c4a34;
      box-shadow: inset 0 0 18px rgba(0,0,0,.7); transition: border-color .2s, box-shadow .2s; }
    .slot { width:48px; height:58px; display:grid; place-items:center; border-radius:8px; background: rgba(159,224,160,.06); border:1px solid rgba(159,224,160,.25);
      font: 700 2rem/1 ui-monospace, monospace; color:#9fe0a0; text-shadow: 0 0 8px rgba(159,224,160,.6); }
    .slot.filled { background: rgba(159,224,160,.12); }
    .screen.wrong { border-color: var(--bad); animation: shake .35s; }
    .screen.wrong .slot { color:#ffb3a6; border-color: rgba(226,113,91,.5); text-shadow: 0 0 8px rgba(226,113,91,.6); }
    .screen.right { border-color:#7dffb0; box-shadow: 0 0 24px rgba(125,255,176,.55), inset 0 0 18px rgba(0,0,0,.5); }
    @keyframes shake { 25% { transform: translateX(-6px); } 50% { transform: translateX(6px); } 75% { transform: translateX(-3px); } }
    .msg { min-height:2.6em; margin:.55rem 0; font-weight:700; display:grid; place-items:center; }
    .msg.bad { color:#ffc2b5; } .msg.good { color:#9dffc4; }
    .keys { display:grid; grid-template-columns: repeat(3, 1fr); gap:.5rem; }
    .key { min-height:56px; border-radius:12px; border:1px solid #b8913f; background: linear-gradient(180deg, #d8b465, #a8823a); color:#1f1405;
      font-size:1.5rem; font-weight:800; cursor:pointer; box-shadow: 0 3px 0 #6a4e1a; touch-action: manipulation; }
    .key:active:not(:disabled) { transform: translateY(2px); box-shadow: 0 1px 0 #6a4e1a; }
    .key.fn { background: linear-gradient(180deg, #4a3a22, #2e2414); color: var(--gold-2); }
    .key.ok { background: linear-gradient(180deg, #ffe39a, #e0a93f); color:#1d1405; }
    .key:disabled { opacity:.5; cursor:default; }
    .row { display:flex; justify-content:space-between; margin-top:.8rem; gap:.5rem; }
  `],
})
export class DemoKeypadComponent {
  status = input<KeypadStatus>('idle');
  message = input('');
  /** Waiting for the server or resting after several wrong codes. */
  locked = input(false);
  submitted = output<string>();
  /** Any change of the digits (clears the last message). */
  edited = output<void>();
  hint = output<void>();
  closed = output<void>();

  readonly slots = [0, 1, 2, 3];
  readonly keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓'];
  digits = signal<string[]>([]);

  press(k: string) {
    if (this.locked()) return;
    if (k === '✓') return this.submit();
    if (k === '⌫') this.digits.update((d) => d.slice(0, -1));
    else if (this.digits().length >= 4 || this.status() === 'wrong') this.digits.set([k]);
    else this.digits.update((d) => [...d, k]);
    this.edited.emit();
  }

  private submit() {
    if (this.digits().length === 4) this.submitted.emit(this.digits().join(''));
  }

  /** After a wrong code the next digit starts a fresh entry (the page clears it). */
  clear() {
    this.digits.set([]);
  }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent) {
    if (/^[0-9]$/.test(e.key)) this.press(e.key);
    else if (e.key === 'Backspace') this.press('⌫');
    else if (e.key === 'Enter') this.press('✓');
    else if (e.key === 'Escape') this.closed.emit();
    else return;
    e.preventDefault();
  }
}
