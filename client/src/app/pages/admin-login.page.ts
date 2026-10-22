import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AdminApiService } from '../core/admin-api.service';

/** /admin/login — the administrator's separate login. Customers never need an account. */
@Component({
  selector: 'px-admin-login',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main>
      <a routerLink="/" class="back">‹ חזרה לדף הבית</a>
      <section class="card">
        <h1>כניסת מנהל</h1>
        <form (submit)="$event.preventDefault(); submit()">
          <label for="u">שם משתמש</label>
          <input id="u" dir="ltr" autocomplete="username" [value]="username()" (input)="username.set($any($event.target).value)" />
          <label for="p">סיסמה</label>
          <input id="p" type="password" dir="ltr" autocomplete="current-password" [value]="password()" (input)="password.set($any($event.target).value)" />
          <button class="btn primary" type="submit" [disabled]="busy() || !username() || !password()">{{ busy() ? 'מתחברים...' : 'כניסה' }}</button>
          @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
        </form>
      </section>
    </main>
  `,
  styles: [`
    :host { display:block; min-height:100dvh; background:var(--bg); }
    main { max-width:420px; margin:0 auto; padding:16px; }
    .back { display:inline-block; margin-bottom:1.5rem; }
    h1 { margin-top:0; font-family:var(--font-title); color:var(--gold-2); }
    form { display:flex; flex-direction:column; gap:.5rem; }
    label { font-weight:700; margin-top:.4rem; }
    input { width:100%; }
    button { margin-top:.8rem; }
  `],
})
export class AdminLoginPage {
  private api = inject(AdminApiService);
  private router = inject(Router);
  username = signal('');
  password = signal('');
  busy = signal(false);
  error = signal<string | null>(null);

  async submit() {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.login(this.username().trim(), this.password());
      this.password.set('');
      await this.router.navigate(['/admin']);
    } catch (e: any) {
      this.error.set(e.code === 'unauthorized' ? 'שם המשתמש או הסיסמה שגויים.' : e.message);
    } finally {
      this.busy.set(false);
    }
  }
}
