import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { StepArtComponent } from './step-art.component';

/**
 * "How it works" on the home page: the five steps of joining a game, read right to left (1 to 5), and the perks under them
 * — playing in the browser, no camera or microphone, and the free trial game (its box links to that game's page).
 */
@Component({
  selector: 'px-how-it-works',
  imports: [RouterLink, StepArtComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section id="how" class="how" aria-labelledby="how-title">
      <div class="how-head">
        <h2 id="how-title">איך זה עובד?</h2>
        <p>חמישה צעדים פשוטים ועד להרפתקה קבוצתית מלאה <span aria-hidden="true">✨</span> — בוחרים משחק, מצטרפים ויוצאים לפתור חידות יחד.</p>
      </div>
      <!-- the steps, 1 to 5, read right to left -->
      <ol class="steps">
        <li class="step">
          <span class="step-n" aria-hidden="true">1</span>
          <div class="step-art"><px-step-art kind="books" /></div>
          <h3>בוחרים משחק</h3>
          <i class="step-rule" aria-hidden="true"></i>
          <p>כל משחק הוא עולם משל עצמו, עם חידות, מנגנונים וסודות משלו.</p>
        </li>
        <li class="step">
          <span class="step-n" aria-hidden="true">2</span>
          <div class="step-art"><px-step-art kind="coins" /></div>
          <h3>רכישה אחת לקבוצה</h3>
          <i class="step-rule" aria-hidden="true"></i>
          <p>משלמים פעם אחת עבור כל חברי הקבוצה. אין צורך לשלם על כל משתתף בנפרד.</p>
        </li>
        <li class="step">
          <span class="step-n" aria-hidden="true">3</span>
          <div class="step-art"><px-step-art kind="scroll" /></div>
          <h3>מקבלים קוד משחק</h3>
          <i class="step-rule" aria-hidden="true"></i>
          <p>לאחר אישור התשלום נוצר קוד משחק שאפשר לשתף עם המשתתפים.</p>
        </li>
        <li class="step">
          <span class="step-n" aria-hidden="true">4</span>
          <div class="step-art photo"><img src="img/hanukkah/kids.jpg" width="560" height="236" loading="lazy" alt="" /></div>
          <h3>משחקים עם 1–4 משתתפים</h3>
          <i class="step-rule" aria-hidden="true"></i>
          <p>אפשר לשחק לבד או להזמין חברים. כל משתתף מצטרף באמצעות הקוד שקיבלתם. <small>(„הפורטל האחרון” — מ־2 משתתפים)</small></p>
        </li>
        <li class="step">
          <span class="step-n" aria-hidden="true">5</span>
          <div class="step-art"><px-step-art kind="chest" /></div>
          <h3>משחקים יחד</h3>
          <i class="step-rule" aria-hidden="true"></i>
          <p>הישארו מרותקים, גלו רמזים, פענחו צפנים, שתפו פעולה והצליחו לפתוח את האוצרות.</p>
        </li>
      </ol>
      <ul class="perks">
        <li class="perk trial">
          <a [routerLink]="['/games', freeGameId()]">
            <svg class="perk-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M20 7h-2.2A3 3 0 0 0 12 3.8 3 3 0 0 0 6.2 7H4a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h7V7h2v5h7a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1Zm-11-.1a1.1 1.1 0 1 1 2-.6V7H9.5a1 1 0 0 1-.5-.1ZM15 7h-2v-.7A1.1 1.1 0 1 1 15 7ZM4 13.5V20a1 1 0 0 0 1 1h6v-7.5H4Zm9 7.5h6a1 1 0 0 0 1-1v-6.5h-7V21Z"/></svg>
            <span><b>רוצים לנסות קודם?</b><small>„שער הסודות” חינמי לגמרי</small></span>
            <span class="perk-go" aria-hidden="true">‹</span>
          </a>
        </li>
        <li class="perk">
          <svg class="perk-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M15.5 9.5 21 6.5v11l-5.5-3M3.5 6.5h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-10a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2ZM3 3l18 18"/></svg>
          <span><b>לא צריך מצלמה או מיקרופון</b><small>רק חיבור לאינטרנט, בלי הרשמה</small></span>
        </li>
        <li class="perk">
          <svg class="perk-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M5 5.5h14a1 1 0 0 1 1 1V16H4V6.5a1 1 0 0 1 1-1ZM2 16h20l-1.2 2.2a1.5 1.5 0 0 1-1.3.8h-15a1.5 1.5 0 0 1-1.3-.8Z"/></svg>
          <span><b>משחקים ישירות בדפדפן</b><small>במחשב ובטלפון, ללא הורדות והתקנות</small></span>
        </li>
      </ul>
    </section>
  `,
  styles: [`
    :host { display:block; }
    /* how it works: a piece of the game's world — navy depth, gold frames, five steps read right to left, then the perks */
    .how { position:relative; scroll-margin-top:84px; margin-block:1.6rem; padding:2.2rem clamp(.9rem, 2.4vw, 2rem) 1.8rem; border-radius:24px; isolation:isolate; overflow:hidden;
      background: radial-gradient(circle at 50% 0%, rgba(244,190,90,.12), transparent 45%), radial-gradient(circle at 8% 90%, rgba(70,110,210,.16), transparent 40%),
        radial-gradient(circle at 95% 85%, rgba(70,110,210,.12), transparent 40%), linear-gradient(180deg, #0d1638, #080f2a);
      border:1px solid rgba(240,200,110,.35); box-shadow: 0 0 0 4px rgba(240,200,110,.05), 0 18px 40px rgba(0,0,0,.35); }
    /* a few small lights in the dark, and thin gold corners */
    .how::before { content:""; position:absolute; inset:0; z-index:-1; pointer-events:none; opacity:.55;
      background-image: radial-gradient(1.5px 1.5px at 12% 18%, #ffe6a6, transparent), radial-gradient(1px 1px at 28% 8%, #fff, transparent), radial-gradient(1.5px 1.5px at 72% 12%, #ffe6a6, transparent),
        radial-gradient(1px 1px at 88% 26%, #fff, transparent), radial-gradient(1.5px 1.5px at 6% 62%, #ffe6a6, transparent), radial-gradient(1px 1px at 94% 58%, #fff, transparent),
        radial-gradient(1px 1px at 52% 4%, #fff, transparent), radial-gradient(1.5px 1.5px at 40% 96%, #ffe6a6, transparent); }
    .how::after { content:""; position:absolute; inset:10px; z-index:-1; pointer-events:none; border-radius:18px; opacity:.7;
      background:
        linear-gradient(#e3b354, #e3b354) top right / 46px 1.5px no-repeat, linear-gradient(#e3b354, #e3b354) top right / 1.5px 46px no-repeat,
        linear-gradient(#e3b354, #e3b354) top left / 46px 1.5px no-repeat, linear-gradient(#e3b354, #e3b354) top left / 1.5px 46px no-repeat,
        linear-gradient(#e3b354, #e3b354) bottom right / 46px 1.5px no-repeat, linear-gradient(#e3b354, #e3b354) bottom right / 1.5px 46px no-repeat,
        linear-gradient(#e3b354, #e3b354) bottom left / 46px 1.5px no-repeat, linear-gradient(#e3b354, #e3b354) bottom left / 1.5px 46px no-repeat; }
    .how-head { text-align:center; margin-bottom:2.1rem; }
    .how-head h2 { margin:0; font-family:var(--font-title); font-weight:900; font-size:clamp(2rem, 4.4vw, 3.2rem); line-height:1.1;
      background: linear-gradient(180deg, #fff1bf, #f2c45a 55%, #c58d2f); -webkit-background-clip:text; background-clip:text; color:transparent;
      filter: drop-shadow(0 0 14px rgba(255,205,110,.35)); }
    .how-head p { margin:.5rem auto 0; max-width:62ch; color:#e8e1d2; font-size:clamp(.95rem, 1.4vw, 1.1rem); line-height:1.55; }
    .steps { list-style:none; padding:0; margin:0; display:grid; grid-template-columns:repeat(5, minmax(0, 1fr)); gap:clamp(.7rem, 1.4vw, 1.1rem); }
    .step { position:relative; display:flex; flex-direction:column; align-items:center; text-align:center; gap:.45rem; min-width:0;
      padding:1.7rem .9rem 1.1rem; border-radius:16px; border:1px solid rgba(240,200,110,.6);
      background: radial-gradient(circle at 50% 30%, rgba(244,190,90,.12), transparent 60%), linear-gradient(180deg, #16234f, #0b1432);
      box-shadow: 0 0 12px rgba(240,200,110,.12), inset 0 1px 0 rgba(255,230,160,.15), 0 10px 22px rgba(0,0,0,.3);
      transition: transform .25s ease, box-shadow .25s ease, border-color .25s ease; }
    .step-n { position:absolute; top:0; left:50%; transform:translate(-50%, -50%); width:40px; height:40px; border-radius:50%; display:grid; place-items:center;
      font-family:var(--font-title); font-weight:900; font-size:1.25rem; color:#14193a; border:2px solid #fff0c0;
      background: radial-gradient(circle at 35% 30%, #fff3c8, #f0c158 55%, #b98328); box-shadow: 0 0 14px rgba(240,200,110,.55), 0 3px 8px rgba(0,0,0,.4); }
    .step-art { width:100%; height:112px; display:grid; place-items:center; transition: transform .3s ease; }
    .step-art px-step-art { width:min(100%, 170px); }
    .step-art.photo { overflow:hidden; border-radius:12px; border:1px solid rgba(240,200,110,.45); box-shadow: 0 8px 16px rgba(0,0,0,.4); }
    .step-art.photo img { width:100%; height:100%; object-fit:cover; object-position:50% 30%; display:block; }
    .step h3 { margin:.3rem 0 0; font-family:var(--font-title); font-weight:900; color:var(--gold-2); font-size:clamp(1.02rem, 1.4vw, 1.2rem); line-height:1.25; }
    .step-rule { width:64px; height:8px; display:block; background:
      linear-gradient(90deg, transparent, #e3b354 30%, #e3b354 70%, transparent) center / 100% 1px no-repeat,
      radial-gradient(circle, #ffe6a6 0 2.5px, transparent 3px) center / 8px 8px no-repeat; }
    .step p { margin:0; color:#ddd6c6; font-size:.9rem; line-height:1.55; }
    .step p small { display:block; color:#b9b3a6; font-size:.8rem; margin-top:.2rem; }
    .step:hover { transform:translateY(-5px); border-color:#f5d080; box-shadow: 0 0 22px rgba(240,200,110,.35), inset 0 1px 0 rgba(255,230,160,.2), 0 16px 28px rgba(0,0,0,.4); }
    .step:hover .step-art { transform: scale(1.05); }
    .perks { list-style:none; padding:0; margin:1.7rem 0 0; display:grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr) minmax(0, 1fr); gap:clamp(.6rem, 1.4vw, 1rem); }
    .perk, .perk.trial a { display:flex; align-items:center; gap:.75rem; padding:.8rem 1rem; border-radius:14px; min-width:0; }
    .perk { border:1px solid rgba(240,200,110,.3); background: linear-gradient(180deg, rgba(22,34,78,.85), rgba(10,18,46,.9)); }
    .perk span { display:flex; flex-direction:column; min-width:0; }
    .perk b { color:#f6ecd8; font-size:.98rem; } .perk small { color:#bfb8a8; font-size:.85rem; }
    .perk-ico { width:30px; height:30px; flex-shrink:0; color:var(--gold-2); filter: drop-shadow(0 0 4px rgba(255,210,120,.4)); }
    .perk.trial { padding:0; border:1.5px solid #e9bf5f; background: radial-gradient(circle at 85% 50%, rgba(244,190,90,.2), transparent 60%), linear-gradient(180deg, #1a2858, #0c1636);
      box-shadow: 0 0 18px rgba(240,200,110,.3), inset 0 1px 0 rgba(255,230,160,.2); transition: box-shadow .2s ease, transform .2s ease; }
    .perk.trial a { width:100%; color:inherit; text-decoration:none; }
    .perk.trial b { color:var(--gold-2); font-family:var(--font-title); font-size:1.12rem; }
    .perk.trial .perk-ico { width:38px; height:38px; }
    .perk .perk-go { margin-inline-start:auto; width:34px; height:34px; flex-shrink:0; border-radius:50%; display:grid; place-items:center; color:var(--gold-2); font-size:1.5rem; line-height:1;
      border:1px solid rgba(240,200,110,.6); }
    .perk.trial:hover { transform:translateY(-2px); box-shadow: 0 0 26px rgba(240,200,110,.45), inset 0 1px 0 rgba(255,230,160,.2); }
    .perk.trial a:focus-visible { outline:3px solid #fff3c4; outline-offset:2px; border-radius:14px; }
    @media (prefers-reduced-motion: reduce) { .step, .step-art, .perk.trial { transition:none; } .step:hover, .perk.trial:hover, .step:hover .step-art { transform:none; } }
    /* tablet: three steps a row (still 1–5 in order), and the perks under each other when tight */
    @media (max-width: 1100px) { .steps { grid-template-columns:repeat(3, minmax(0, 1fr)); row-gap:1.7rem; } }
    @media (max-width: 900px) { .perks { grid-template-columns: minmax(0, 1fr); } }
    /* phone: two steps a row, the fifth across the whole row */
    @media (max-width: 640px) {
      .how { padding:1.7rem .8rem 1.2rem; border-radius:18px; }
      .steps { grid-template-columns:repeat(2, minmax(0, 1fr)); gap:.6rem; row-gap:1.6rem; }
      .step { padding:1.5rem .55rem .9rem; } .step-art { height:88px; } .step p { font-size:.84rem; }
      .step:last-child { grid-column: 1 / -1; }
    }
    @media (max-width: 360px) { .steps { grid-template-columns: minmax(0, 1fr); } }
  `],
})
export class HowItWorksComponent {
  /** The free trial game's id, for the "want to try first?" box. */
  freeGameId = input('gate-of-secrets');
}
