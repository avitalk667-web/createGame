import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

/** /join — "I have a game code": sends the player on to the existing join flow for that code. */
@Component({
  selector: 'px-join-code',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main>
      <a routerLink="/" class="back">‹ חזרה לדף הבית</a>
      <section class="card">
        <h1>יש לי קוד משחק</h1>
        <p class="muted">הזינו את הקוד שקיבלתם מהמארח. אין צורך להירשם או לשלם — המארח כבר רכש את המשחק לכל הקבוצה.</p>
        <form (submit)="$event.preventDefault(); go()">
          <label for="code">קוד המשחק</label>
          <div class="row">
            <input id="code" [value]="code()" (input)="code.set($any($event.target).value.toUpperCase())" maxlength="10"
              placeholder="7G3KQ2" autocomplete="off" autocapitalize="characters" dir="ltr" />
            <button class="btn primary" type="submit" [disabled]="clean().length < 4">הצטרפות</button>
          </div>
        </form>
      </section>
    </main>
  `,
  styles: [`
    :host { display:block; min-height:100dvh; background: radial-gradient(50rem 30rem at 0% 0%, rgba(106,168,255,.12), transparent 60%), var(--bg); }
    main { max-width:560px; margin:0 auto; padding:16px; }
    .back { display:inline-block; margin-bottom:1.5rem; }
    h1 { font-family:var(--font-title); margin-top:0; color:var(--gold-2); }
    label { font-weight:700; display:block; margin-bottom:.35rem; }
    .row { display:flex; gap:.5rem; }
    input { flex:1; min-width:0; letter-spacing:.15em; font-weight:700; text-align:center; font-size:1.2rem; }
  `],
})
export class JoinCodePage {
  private router = inject(Router);
  code = signal('');
  clean = () => this.code().trim().replace(/[\s-]/g, '');

  go() {
    const c = this.clean();
    if (c.length >= 4) this.router.navigate(['/join', c]);
  }
}
