import { ChangeDetectionStrategy, Component, ElementRef, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HelpService } from '../core/help.service';

/**
 * "הדרכה" in the site's top bar: the user guide and the contact window — nothing else for now.
 * On a computer it is a button with a small menu; inside the phone menu ("list") the two items are shown as rows.
 */
@Component({
  selector: 'px-help-menu',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:click)': 'outside($event)', '(document:keydown.escape)': 'open.set(false)', '[class.as-list]': "variant() === 'list'" },
  template: `
    @if (variant() === 'list') {
      <span class="list-title">הדרכה</span>
      <a routerLink="/guide" (click)="picked.emit()">
        <svg class="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v16H6.5a.5.5 0 0 0 0 1H20v3H6.5A2.5 2.5 0 0 1 4 19.5v-15ZM8 6v2h8V6H8Zm0 4v2h6v-2H8Z"/></svg>
        המדריך למשתמש</a>
      <button type="button" (click)="contact()">
        <svg class="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm1.4 2 7.6 5.6L19.6 7H4.4ZM20 8.8l-8 5.9-8-5.9V17h16V8.8Z"/></svg>
        צור קשר</button>
    } @else {
      <button type="button" class="trigger" (click)="open.set(!open())" [attr.aria-expanded]="open()" aria-haspopup="menu" aria-controls="help-menu">
        <svg class="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm0 13.8a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6ZM12 5.6c-2.1 0-3.7 1.3-3.9 3.3h2.2c.1-.8.8-1.3 1.7-1.3 1 0 1.6.6 1.6 1.4 0 .7-.3 1-1.2 1.6-1.1.7-1.6 1.4-1.5 2.7v.5h2.1v-.4c0-.8.3-1.1 1.2-1.7 1-.7 1.7-1.5 1.7-2.8 0-2-1.6-3.3-3.9-3.3Z"/></svg>
        <span>הדרכה</span>
        <svg class="chev" [class.up]="open()" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      @if (open()) {
        <div id="help-menu" class="menu" role="menu" aria-label="הדרכה">
          <a role="menuitem" routerLink="/guide" (click)="open.set(false)">
            <span class="badge"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v16H6.5a.5.5 0 0 0 0 1H20v3H6.5A2.5 2.5 0 0 1 4 19.5v-15ZM8 6v2h8V6H8Zm0 4v2h6v-2H8Z"/></svg></span>
            <span class="txt"><b>המדריך למשתמש</b><small>מבחירת משחק ועד השליטה בדמות, שלב אחר שלב</small></span>
          </a>
          <button type="button" role="menuitem" (click)="contact()">
            <span class="badge"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm1.4 2 7.6 5.6L19.6 7H4.4ZM20 8.8l-8 5.9-8-5.9V17h16V8.8Z"/></svg></span>
            <span class="txt"><b>צור קשר</b><small>כתבו לנו ונחזור אליכם במייל</small></span>
          </button>
        </div>
      }
    }
  `,
  styles: [`
    :host { position:relative; display:inline-block; }
    :host(.as-list) { display:contents; }
    .ico { width:1.2em; height:1.2em; flex-shrink:0; }
    /* the phone menu's rows (the same look as the menu's other rows) */
    :host(.as-list) a, :host(.as-list) button { display:flex; align-items:center; gap:.5rem; min-height:48px; padding:.2rem .4rem; color:var(--text);
      text-decoration:none; font:inherit; font-weight:700; font-size:1.05rem; background:none; border:0; border-bottom:1px solid var(--line); text-align:start; cursor:pointer; }
    :host(.as-list) a:hover, :host(.as-list) button:hover { color:var(--gold-2); }
    :host(.as-list) .ico { color:var(--gold-2); width:1.15em; height:1.15em; }
    .trigger { display:inline-flex; align-items:center; gap:.4rem; background:none; border:0; border-bottom:2px solid transparent; color:var(--text);
      font:inherit; font-weight:600; padding:.3rem 0; cursor:pointer; transition:color .2s, border-color .2s; }
    .trigger:hover, .trigger:focus-visible, .trigger[aria-expanded=true] { color:var(--gold-2); border-bottom-color:var(--gold); outline:none; }
    .trigger .ico { color:var(--gold); }
    .chev { width:1em; height:1em; transition:transform .2s; } .chev.up { transform:rotate(180deg); }
    .menu { position:absolute; top:calc(100% + 12px); inset-inline-start:-1rem; z-index:20; width:min(330px, calc(100vw - 32px));
      display:flex; flex-direction:column; gap:.3rem; padding:.5rem; border-radius:18px; border:1px solid var(--line);
      background:linear-gradient(180deg, #18224d, #0e1532); box-shadow:0 18px 50px rgba(0,0,0,.6); }
    .menu::before { content:""; position:absolute; top:-7px; inset-inline-start:1.6rem; width:12px; height:12px; transform:rotate(45deg);
      background:#18224d; border-top:1px solid var(--line); border-inline-start:1px solid var(--line); }
    .menu a, .menu button { display:flex; align-items:center; gap:.8rem; padding:.7rem .75rem; border-radius:12px; border:0; background:none;
      color:var(--text); text-decoration:none; font:inherit; text-align:start; cursor:pointer; }
    .menu a:hover, .menu button:hover, .menu a:focus-visible, .menu button:focus-visible { background:rgba(224,185,92,.12); outline:none; }
    .badge { width:42px; height:42px; flex-shrink:0; display:grid; place-items:center; border-radius:12px; color:#1d1405;
      background:linear-gradient(180deg, #ffe39a, #e0a93f); box-shadow:0 4px 14px rgba(224,169,63,.3); }
    .badge svg { width:22px; height:22px; }
    .txt { display:flex; flex-direction:column; gap:.1rem; } .txt b { font-size:1rem; } .txt small { color:var(--muted); font-size:.84rem; line-height:1.35; }
    .list-title { padding:.7rem .4rem .1rem; color:var(--gold-2); font-weight:800; font-size:.82rem; letter-spacing:.02em; }
    @media (prefers-reduced-motion: reduce) { .chev, .trigger { transition:none; } }
  `],
})
export class HelpMenuComponent {
  private help = inject(HelpService);
  private el = inject(ElementRef<HTMLElement>);
  variant = input<'dropdown' | 'list'>('dropdown');
  /** The phone menu closes itself when an item is chosen. */
  picked = output<void>();
  open = signal(false);

  contact() {
    this.open.set(false);
    this.picked.emit();
    this.help.openContact();
  }

  outside(e: Event) {
    if (this.open() && !this.el.nativeElement.contains(e.target as Node)) this.open.set(false);
  }
}
