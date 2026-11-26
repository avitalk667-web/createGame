import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ApiError } from '../core/api.service';

/** One mailing's editable content (the same shape as NewsletterContent on the server). */
export interface NlContent {
  subject: string; adPrefix: boolean; preheader: string; greeting: boolean;
  intro: { show: boolean; title: string; lead: string; text: string };
  sections: NlSection[];
  links: { show: boolean; title: string; note: string; gameId: string; gameLabel: string; siteLabel: string };
  offer: { show: boolean; title: string; subtitle: string; percent: number; gameName: string; code: string; imageUrl: string; note: string };
  cta: { show: boolean; label: string; url: string };
}
export interface NlSection {
  show: boolean; kind: 'text' | 'riddle'; icon: string; title: string; text: string;
  clues: { code: string; text: string }[]; question: string; replyNote: string;
}
export interface NlIssue {
  id: string; name: string; status: 'draft' | 'sending' | 'paused' | 'sent'; statusNote?: string | null; subject: string;
  createdAt: string; updatedAt: string; testedAt?: string | null; sendStartedAt?: string | null; sendFinishedAt?: string | null;
  sent: number; failed: number; uncertain: number;
}
interface NlList { issues: NlIssue[]; audience: number; senderReady: boolean; dailyLimit: number; sentLast24h: number }
interface NlDetail { issue: NlIssue; content: NlContent; pending: number; running: boolean; tested: boolean; locked: boolean }
interface NlPreview {
  subject: string; html: string; text: string; bytes: number; who: string; hasGameLink: boolean; hasSiteLink: boolean; hasUnsubscribe: boolean;
  warning?: string | null; problem?: string | null;
}
interface NlTestResult { ok: boolean; results: { email: string; ok: boolean; error?: string; personalLinks?: boolean; unsubscribe?: boolean }[] }

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method, credentials: 'same-origin',
      headers: { 'X-PortalX-Admin': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('network', 'אין חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב.');
  }
  if (res.status === 401) throw new ApiError('unauthorized', 'אין הרשאה. יש להתחבר כמנהל.');
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.code ?? 'error', data?.message ?? 'אירעה שגיאה. נסו שוב.');
  return data as T;
}

const STATUS: Record<string, string> = { draft: 'טיוטה', sending: 'בשליחה', paused: 'מושהה', sent: 'נשלח' };
const ERRORS: Record<string, string> = { 'not-configured': 'שליחת המיילים אינה מחוברת', 'google-error': 'שגיאה מ־Gmail', timeout: 'פסק זמן' };

/**
 * "סודות הפורטל" (admin only): write a mailing in fields — never in HTML — see it exactly as a chosen recipient will get it,
 * send a test, and only then send it to the list. The server builds every email for its own recipient (their own links
 * and unsubscribe link), mails only active consents, never mails an address twice and asks for the typed recipient count.
 */
@Component({
  selector: 'px-admin-newsletter',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error()) { <p class="msg-box" role="alert">{{ error() }}</p> }
    @if (list(); as l) {
      <div class="cards">
        <div class="stat card"><span>נמענים ברשימה</span><b>{{ l.audience }}</b><small>הסכמה פעילה לדיוור בלבד</small></div>
        <div class="stat card"><span>שליחת מיילים</span><b class="date">{{ l.senderReady ? 'מחוברת' : 'לא מחוברת' }}</b><small>דרך חשבון ה־Gmail של האתר</small></div>
        <div class="stat card"><span>נשלחו ב־24 השעות האחרונות</span><b>{{ l.sentLast24h }}</b><small>מכסה יומית: {{ l.dailyLimit }}</small></div>
      </div>
      <div class="bar">
        <span class="muted small">כל נמען מקבל מייל נפרד עם הקישורים האישיים שלו בלבד. אין שליחה קבוצתית.</span>
        <span class="actions">
          <button class="btn small" type="button" (click)="create('welcome')" [disabled]="busy()">+ מייל הפתיחה (דוגמה)</button>
          <button class="btn small primary" type="button" (click)="create('blank')" [disabled]="busy()">+ דיוור חדש</button>
        </span>
      </div>
      <div class="table-wrap list">
        <table>
          <thead><tr><th>שם</th><th>נושא</th><th>סטטוס</th><th>נשלחו</th><th>עודכן</th></tr></thead>
          <tbody>
            @for (i of l.issues; track i.id) {
              <tr [class.on]="selected()?.issue?.id === i.id" (click)="open(i.id)" tabindex="0" (keydown.enter)="open(i.id)">
                <td>{{ i.name }}</td><td class="wrap">{{ i.subject }}</td>
                <td><span class="st" [attr.data-s]="i.status === 'sent' ? 'paid' : i.status === 'paused' ? 'failed' : ''">{{ status(i.status) }}</span></td>
                <td>{{ i.sent }}@if (i.failed) { <small class="bad"> · {{ i.failed }} נכשלו</small> }</td>
                <td>{{ i.updatedAt | date: 'd.M.yy HH:mm' }}</td>
              </tr>
            } @empty { <tr><td colspan="5" class="muted">עדיין אין דיוורים. התחילו ממייל הפתיחה לדוגמה או מדיוור חדש.</td></tr> }
          </tbody>
        </table>
      </div>
    } @else if (!error()) { <p class="loading">טוענים...</p> }

    @if (selected(); as d) {
      @if (c(); as c) {
      <div class="work">
        <section class="editor card" [class.locked]="d.locked" aria-label="עריכת הדיוור">
          <div class="head">
            <input class="name" [value]="name()" (input)="name.set(val($event)); dirty.set(true)" [disabled]="d.locked" aria-label="שם הדיוור (פנימי)" />
            <span class="st" [attr.data-s]="d.issue.status === 'sent' ? 'paid' : ''">{{ status(d.issue.status) }}</span>
          </div>
          @if (d.locked) { <p class="note">הדיוור כבר יצא לשליחה ולכן נעול לעריכה. <button class="btn small" type="button" (click)="copy(d.issue.id)">יצירת עותק לעריכה</button></p> }
          <fieldset [disabled]="d.locked">
            <h3>נושא ושורת תצוגה</h3>
            <label class="field">נושא המייל<input [value]="c.subject" (input)="set(c, 'subject', val($event))" maxlength="150" /></label>
            <label class="check"><input type="checkbox" [checked]="c.adPrefix" (change)="set(c, 'adPrefix', chk($event))" /> להוסיף "פרסומת:" בתחילת הנושא (נדרש בחוק בדיוור שיווקי)</label>
            <label class="field">שורת תצוגה מקדימה (מופיעה ליד הנושא בתיבת הדואר)<input [value]="c.preheader" (input)="set(c, 'preheader', val($event))" maxlength="200" /></label>

            <h3><label class="check"><input type="checkbox" [checked]="c.intro.show" (change)="set(c.intro, 'show', chk($event))" /> פתיח</label></h3>
            @if (c.intro.show) {
              <label class="field">כותרת (בסרט הסגול)<input [value]="c.intro.title" (input)="set(c.intro, 'title', val($event))" /></label>
              <label class="check"><input type="checkbox" [checked]="c.greeting" (change)="set(c, 'greeting', chk($event))" /> "שלום {{ '{' }}שם{{ '}' }}," לנמענים ששמם ידוע</label>
              <label class="field">שורה מודגשת<input [value]="c.intro.lead" (input)="set(c.intro, 'lead', val($event))" /></label>
              <label class="field">טקסט פתיחה<textarea rows="3" [value]="c.intro.text" (input)="set(c.intro, 'text', val($event))"></textarea></label>
            }

            <h3>אזורי תוכן</h3>
            <p class="muted small">שורה ריקה = פסקה חדשה · שורה שמתחילה ב־"- " = נקודה ברשימה · **טקסט** = מודגש. אין צורך ב־HTML.</p>
            @for (s of c.sections; track $index; let i = $index) {
              <div class="block">
                <div class="block-head">
                  <label class="check"><input type="checkbox" [checked]="s.show" (change)="set(s, 'show', chk($event))" /> מוצג</label>
                  <select [value]="s.kind" (change)="set(s, 'kind', val($event))" aria-label="סוג האזור">
                    <option value="text">טקסט / עדכון / הכרזה</option><option value="riddle">חידה עם רמזים</option>
                  </select>
                  <span class="grow"></span>
                  <button class="btn small ghost" type="button" (click)="move(i, -1)" [disabled]="i === 0" aria-label="למעלה">▲</button>
                  <button class="btn small ghost" type="button" (click)="move(i, 1)" [disabled]="i === c.sections.length - 1" aria-label="למטה">▼</button>
                  <button class="btn small danger" type="button" (click)="removeSection(i)">הסרה</button>
                </div>
                <div class="row2">
                  <label class="field icon">סמל<input [value]="s.icon" (input)="set(s, 'icon', val($event))" maxlength="8" /></label>
                  <label class="field">כותרת<input [value]="s.title" (input)="set(s, 'title', val($event))" /></label>
                </div>
                <label class="field">טקסט<textarea rows="4" [value]="s.text" (input)="set(s, 'text', val($event))"></textarea></label>
                @if (s.kind === 'riddle') {
                  @for (k of s.clues; track $index; let j = $index) {
                    <div class="clue">
                      <input class="code" dir="ltr" [value]="k.code" (input)="set(k, 'code', val($event))" aria-label="קוד" maxlength="12" />
                      <input [value]="k.text" (input)="set(k, 'text', val($event))" aria-label="רמז" />
                      <button class="btn small ghost" type="button" (click)="removeClue(s, j)" aria-label="הסרת רמז">✕</button>
                    </div>
                  }
                  <button class="btn small" type="button" (click)="addClue(s)">+ רמז</button>
                  <label class="field">שאלה (בפס הסגול)<input [value]="s.question" (input)="set(s, 'question', val($event))" /></label>
                  <label class="field">שורת תשובה<input [value]="s.replyNote" (input)="set(s, 'replyNote', val($event))" /></label>
                }
              </div>
            }
            <button class="btn small" type="button" (click)="addSection()" [disabled]="c.sections.length >= 8">+ אזור תוכן</button>

            <h3><label class="check"><input type="checkbox" [checked]="c.links.show" (change)="set(c.links, 'show', chk($event))" /> הקישורים האישיים</label></h3>
            @if (c.links.show) {
              <p class="muted small">הקישורים נלקחים מהקישור האישי של כל נמען. למי שאין קישור — האזור לא מוצג.</p>
              <label class="field">כותרת<input [value]="c.links.title" (input)="set(c.links, 'title', val($event))" /></label>
              <label class="field">שורת הסבר<input [value]="c.links.note" (input)="set(c.links, 'note', val($event))" /></label>
              <div class="row2">
                <label class="field">כפתור המשחק<input [value]="c.links.gameLabel" (input)="set(c.links, 'gameLabel', val($event))" /></label>
                <label class="field icon wide">מזהה המשחק<input dir="ltr" [value]="c.links.gameId" (input)="set(c.links, 'gameId', val($event))" /></label>
              </div>
              <label class="field">כפתור האתר<input [value]="c.links.siteLabel" (input)="set(c.links, 'siteLabel', val($event))" /></label>
            }

            <h3><label class="check"><input type="checkbox" [checked]="c.offer.show" (change)="set(c.offer, 'show', chk($event))" /> הטבה וקופון</label></h3>
            @if (c.offer.show) {
              <div class="row2">
                <label class="field">כותרת<input [value]="c.offer.title" (input)="set(c.offer, 'title', val($event))" /></label>
                <label class="field">כותרת משנה<input [value]="c.offer.subtitle" (input)="set(c.offer, 'subtitle', val($event))" /></label>
              </div>
              <div class="row3">
                <label class="field">אחוז הנחה<input type="number" min="1" max="100" [value]="c.offer.percent" (input)="set(c.offer, 'percent', num($event))" /></label>
                <label class="field">קוד קופון<input dir="ltr" [value]="c.offer.code" (input)="set(c.offer, 'code', val($event))" /></label>
                <label class="field">שם המשחק<input [value]="c.offer.gameName" (input)="set(c.offer, 'gameName', val($event))" /></label>
              </div>
              <label class="field">תמונת קופון (כתובת https, לא חובה)<input dir="ltr" [value]="c.offer.imageUrl" (input)="set(c.offer, 'imageUrl', val($event))" /></label>
              <label class="field">הערה קטנה (תנאים, תוקף)<input [value]="c.offer.note" (input)="set(c.offer, 'note', val($event))" /></label>
              <p class="muted small">הקוד צריך להיות קיים בלשונית "קופונים והנחות" עם אותה הנחה ואותו משחק.</p>
            }

            <h3><label class="check"><input type="checkbox" [checked]="c.cta.show" (change)="set(c.cta, 'show', chk($event))" /> כפתור פעולה</label></h3>
            @if (c.cta.show) {
              <div class="row2">
                <label class="field">טקסט הכפתור<input [value]="c.cta.label" (input)="set(c.cta, 'label', val($event))" /></label>
                <label class="field">כתובת (/דף-באתר או https://...)<input dir="ltr" [value]="c.cta.url" (input)="set(c.cta, 'url', val($event))" /></label>
              </div>
            }
          </fieldset>
          @if (!d.locked) {
            <div class="save-row">
              <button class="btn primary" type="button" (click)="save()" [disabled]="busy() || !dirty()">שמירה</button>
              <span class="muted small">{{ dirty() ? 'יש שינויים שלא נשמרו' : 'נשמר' }}</span>
              @if (d.issue.status === 'draft' && !d.issue.sent) { <button class="btn small danger" type="button" (click)="remove(d.issue.id)">מחיקת הטיוטה</button> }
            </div>
          }
        </section>

        <section class="side">
          <div class="card preview-card">
            <div class="pv-bar">
              <b>תצוגה מקדימה</b>
              <span class="grow"></span>
              <button class="btn small" type="button" [class.on]="width() === 600" (click)="width.set(600)">מחשב</button>
              <button class="btn small" type="button" [class.on]="width() === 375" (click)="width.set(375)">נייד</button>
              <label class="check"><input type="checkbox" [checked]="noImages()" (change)="noImages.set(chk($event)); refresh()" /> בלי תמונות</label>
            </div>
            <div class="pv-as">
              <input dir="ltr" placeholder="כתובת נמען לתצוגה (ריק = נמען לדוגמה)" [value]="previewEmail()" (change)="previewEmail.set(val($event)); refresh()" aria-label="תצוגה עבור כתובת" />
            </div>
            @if (preview(); as p) {
              <p class="small"><b>נושא:</b> {{ p.subject }}</p>
              <p class="small muted">{{ p.who }} · קישור משחק: {{ p.hasGameLink ? '✓' : '—' }} · קישור אתר: {{ p.hasSiteLink ? '✓' : '—' }} · קישור הסרה: {{ p.hasUnsubscribe ? '✓' : 'לדוגמה' }} · {{ (p.bytes / 1024).toFixed(0) }}KB</p>
              @if (p.problem) { <p class="msg-box">{{ p.problem }}</p> }
              @if (p.warning) { <p class="msg-box">{{ p.warning }}</p> }
              <div class="frame-wrap"><iframe title="תצוגה מקדימה של המייל" sandbox="allow-same-origin"[style.width.px]="width()" [srcdoc]="safe()"></iframe></div>
            }
          </div>

          <div class="card">
            <h3>1. שליחת בדיקה</h3>
            <p class="muted small">עד שלוש כתובות, מופרדות בפסיק. כל כתובת מקבלת את הגרסה האישית שלה (הקישורים שלה), עם "[בדיקה]" בנושא. נשלחת הגרסה השמורה.</p>
            <div class="inline">
              <input dir="ltr" [value]="testEmails()" (input)="testEmails.set(val($event))" placeholder="me@example.com, other@example.com" aria-label="כתובות לבדיקה" />
              <button class="btn small" type="button" (click)="test()" [disabled]="busy() || dirty() || d.locked">שליחת בדיקה</button>
            </div>
            @if (dirty()) { <p class="muted small">יש לשמור לפני שליחת בדיקה.</p> }
            @if (testResult(); as t) {
              <ul class="small">
                @for (r of t.results; track r.email) {
                  <li dir="rtl"><span dir="ltr">{{ r.email }}</span> — {{ r.ok ? 'נשלח' : 'נכשל: ' + errorText(r.error) }}
                    @if (r.ok) { · קישורים אישיים: {{ r.personalLinks ? 'כן' : 'אין' }} · הסרה: {{ r.unsubscribe ? 'אישית' : 'אין הסכמה פעילה' }} }</li>
                }
              </ul>
            }
          </div>

          <div class="card send">
            <h3>2. שליחה לרשימת התפוצה</h3>
            @if (d.issue.status === 'sent') {
              <p>הדיוור נשלח ל־{{ d.issue.sent }} נמענים{{ d.issue.sendFinishedAt ? ' (' + (d.issue.sendFinishedAt | date: 'd.M.yy HH:mm') + ')' : '' }}.</p>
            } @else {
              <p class="small">ממתינים לשליחה: <b>{{ d.pending }}</b> · נשלחו: {{ d.issue.sent }}@if (d.issue.failed) { · נכשלו: {{ d.issue.failed }} }@if (d.issue.uncertain) { · לא ודאי: {{ d.issue.uncertain }} }</p>
              @if (d.issue.statusNote) { <p class="note">{{ d.issue.statusNote }}</p> }
              @if (d.running) {
                <p class="small">השליחה פועלת... (מייל אחד בכל שנייה וחצי בערך)</p>
                <button class="btn small danger" type="button" (click)="stop()">עצירת השליחה</button>
              } @else if (!d.tested) {
                <p class="muted small">השליחה לרשימה תיפתח אחרי שליחת בדיקה מוצלחת של הגרסה השמורה הנוכחית.</p>
              } @else {
                <p class="small">לאישור, הקלידו את מספר הנמענים ({{ d.pending }}):</p>
                <div class="inline">
                  <input type="number" [value]="confirmCount()" (input)="confirmCount.set(val($event))" aria-label="מספר הנמענים לאישור" />
                  <button class="btn small primary" type="button" (click)="send()" [disabled]="busy() || dirty() || +confirmCount() !== d.pending || d.pending === 0">
                    {{ d.issue.status === 'draft' ? 'שליחה לכל הרשימה' : 'המשך שליחה' }}</button>
                </div>
              }
            }
            <button class="btn small ghost" type="button" (click)="loadDeliveries()">מי קיבל?</button>
            @if (deliveries(); as ds) {
              <div class="table-wrap deliveries"><table>
                <thead><tr><th>כתובת</th><th>סטטוס</th><th>מתי</th></tr></thead>
                <tbody>
                  @for (x of ds; track x.email) { <tr><td dir="ltr">{{ x.email }}</td><td>{{ deliveryStatus(x.status) }}@if (x.error) { <small class="muted"> ({{ errorText(x.error) }})</small> }</td><td>{{ x.at | date: 'd.M HH:mm' }}</td></tr> }
                  @empty { <tr><td colspan="3" class="muted">עוד לא נשלח לאיש.</td></tr> }
                </tbody>
              </table></div>
            }
          </div>
        </section>
      </div>
      }
    }
  `,
  styles: [`
    .cards { margin-bottom:1rem; }
    .bar .actions { display:flex; gap:.5rem; flex-wrap:wrap; }
    .list { max-height:260px; }
    .list tr { cursor:pointer; }
    .list tr.on td { background:rgba(224,185,92,.12); }
    td.wrap { white-space:normal; min-width:200px; }
    .small { font-size:.82rem; }
    .bad { color:var(--bad); }
    .work { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.05fr); gap:1rem; margin-top:1rem; align-items:start; }
    @media (max-width: 1100px) { .work { grid-template-columns:1fr; } }
    .editor { padding:1rem; }
    .editor .head { display:flex; gap:.6rem; align-items:center; margin-bottom:.6rem; }
    .editor .name { flex:1; font-size:1.05rem; font-weight:bold; }
    fieldset { border:0; margin:0; padding:0; min-width:0; }
    h3 { margin:1.1rem 0 .4rem; font-size:1rem; color:var(--gold-2); }
    .field { display:flex; flex-direction:column; gap:.2rem; margin:.35rem 0; font-size:.85rem; color:var(--muted); }
    .field input, .field textarea, .field select, .clue input, .inline input, .pv-as input, select {
      background:var(--bg-2); color:var(--text); border:1px solid var(--line); border-radius:8px; padding:.45rem .6rem; font:inherit; font-size:.92rem;
    }
    textarea { resize:vertical; line-height:1.5; }
    .check { display:inline-flex; gap:.4rem; align-items:center; font-size:.85rem; margin:.2rem 0; cursor:pointer; }
    .row2 { display:grid; grid-template-columns:1fr 1fr; gap:.6rem; }
    .row2 .icon { max-width:90px; } .row2 .icon.wide { max-width:none; }
    .row2:has(.icon:not(.wide)) { grid-template-columns:90px 1fr; }
    .row3 { display:grid; grid-template-columns:110px 1fr 1fr; gap:.6rem; }
    .block { border:1px solid var(--line); border-radius:12px; padding:.6rem .7rem; margin:.5rem 0; background:rgba(255,255,255,.02); }
    .block-head { display:flex; gap:.4rem; align-items:center; flex-wrap:wrap; }
    .grow { flex:1; }
    .clue { display:grid; grid-template-columns:80px 1fr auto; gap:.4rem; margin:.3rem 0; }
    .clue .code { text-align:center; font-weight:bold; letter-spacing:2px; }
    .save-row { display:flex; gap:.8rem; align-items:center; margin-top:1rem; position:sticky; bottom:0; background:var(--panel-solid); padding:.6rem 0; border-top:1px solid var(--line); }
    .side { display:flex; flex-direction:column; gap:1rem; }
    .side .card { padding:1rem; }
    .pv-bar { display:flex; gap:.4rem; align-items:center; flex-wrap:wrap; margin-bottom:.5rem; }
    .pv-bar .btn.on { border-color:var(--gold); color:var(--gold-2); }
    .pv-as input { width:100%; box-sizing:border-box; margin-bottom:.4rem; }
    .frame-wrap { overflow:auto; background:#060b22; border-radius:10px; padding:8px 0; text-align:center; }
    iframe { height:1500px; border:0; background:#060b22; max-width:100%; }
    .inline { display:flex; gap:.5rem; align-items:center; }
    .inline input { flex:1; min-width:0; }
    .send .btn.ghost { margin-top:.6rem; }
    .deliveries { max-height:260px; margin-top:.5rem; }
    .note { background:rgba(224,185,92,.1); border-right:3px solid var(--gold); padding:.5rem .7rem; border-radius:8px; font-size:.85rem; }
  `],
})
export class AdminNewsletterComponent implements OnDestroy {
  private sanitizer = inject(DomSanitizer);
  list = signal<NlList | null>(null);
  selected = signal<NlDetail | null>(null);
  c = signal<NlContent | null>(null);
  name = signal('');
  dirty = signal(false);
  busy = signal(false);
  error = signal<string | null>(null);
  preview = signal<NlPreview | null>(null);
  previewEmail = signal('');
  width = signal(600);
  noImages = signal(false);
  testEmails = signal('');
  testResult = signal<NlTestResult | null>(null);
  confirmCount = signal('');
  deliveries = signal<{ email: string; status: string; error?: string | null; at: string }[] | null>(null);
  safe = computed<SafeHtml>(() => {
    let html = this.preview()?.html ?? '';
    // "without images": what a reader with blocked images sees (the alt texts)
    if (this.noImages()) html = html.replace(/<img ([^>]*?)src="[^"]*"/g, '<img $1src=""');
    return this.sanitizer.bypassSecurityTrustHtml(html);
  });
  private timer: ReturnType<typeof setTimeout> | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;

  constructor() { this.load(); }
  ngOnDestroy() { if (this.timer) clearTimeout(this.timer); if (this.poll) clearInterval(this.poll); }

  status(s: string) { return STATUS[s] ?? s; }
  errorText(e?: string | null) { return e ? ERRORS[e] ?? e : ''; }
  deliveryStatus(s: string) { return ({ sent: 'נשלח', failed: 'נכשל', uncertain: 'לא ודאי', sending: 'לא ודאי' } as Record<string, string>)[s] ?? s; }
  val(e: Event) { return (e.target as HTMLInputElement).value; }
  chk(e: Event) { return (e.target as HTMLInputElement).checked; }
  num(e: Event) { return Number((e.target as HTMLInputElement).value) || 0; }

  private fail(e: unknown) { this.error.set(e instanceof Error ? e.message : 'אירעה שגיאה.'); }

  async load() {
    this.error.set(null);
    try { this.list.set(await call<NlList>('GET', '/api/admin/newsletters')); } catch (e) { this.fail(e); }
  }

  async open(id: string) {
    if (this.dirty() && !confirm('יש שינויים שלא נשמרו. לעבור בכל זאת?')) return;
    this.error.set(null);
    try {
      const d = await call<NlDetail>('GET', `/api/admin/newsletters/${id}`);
      this.selected.set(d);
      this.c.set(d.content);
      this.name.set(d.issue.name);
      this.dirty.set(false);
      this.testResult.set(null);
      this.deliveries.set(null);
      this.confirmCount.set('');
      this.refresh(0);
      this.watch(d);
    } catch (e) { this.fail(e); }
  }

  /** While a send runs, the counts are read again every few seconds. */
  private watch(d: NlDetail) {
    if (this.poll) { clearInterval(this.poll); this.poll = null; }
    if (!d.running && d.issue.status !== 'sending') return;
    this.poll = setInterval(async () => {
      const id = this.selected()?.issue.id;
      if (!id) return;
      try {
        const now = await call<NlDetail>('GET', `/api/admin/newsletters/${id}`);
        this.selected.set(now);
        if (!now.running) { clearInterval(this.poll!); this.poll = null; this.load(); }
      } catch { /* the next tick tries again */ }
    }, 3000);
  }

  async create(from: 'welcome' | 'blank') {
    this.busy.set(true);
    try {
      const r = await call<{ id: string }>('POST', '/api/admin/newsletters', { from });
      await this.load();
      this.dirty.set(false);
      await this.open(r.id);
    } catch (e) { this.fail(e); } finally { this.busy.set(false); }
  }

  async copy(id: string) {
    this.busy.set(true);
    try {
      const r = await call<{ id: string }>('POST', '/api/admin/newsletters', { from: 'copy', copyOf: id });
      await this.load();
      await this.open(r.id);
    } catch (e) { this.fail(e); } finally { this.busy.set(false); }
  }

  /** Any field: the content is changed in place, the view is told, and the preview follows shortly. */
  set<T extends object>(target: T, key: keyof T, value: unknown) {
    (target as any)[key] = value;
    this.c.set({ ...this.c()! });
    this.dirty.set(true);
    this.refresh();
  }

  addSection() {
    const c = this.c()!;
    c.sections.push({ show: true, kind: 'text', icon: '✨', title: '', text: '', clues: [], question: '', replyNote: '' });
    this.set(c, 'sections', c.sections);
  }
  removeSection(i: number) {
    if (!confirm('להסיר את האזור?')) return;
    const c = this.c()!;
    c.sections.splice(i, 1);
    this.set(c, 'sections', c.sections);
  }
  move(i: number, by: number) {
    const c = this.c()!;
    const [s] = c.sections.splice(i, 1);
    c.sections.splice(i + by, 0, s);
    this.set(c, 'sections', c.sections);
  }
  addClue(s: NlSection) { s.clues.push({ code: '', text: '' }); this.set(s, 'clues', s.clues); }
  removeClue(s: NlSection, j: number) { s.clues.splice(j, 1); this.set(s, 'clues', s.clues); }

  refresh(delay = 450) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      const c = this.c();
      if (!c) return;
      try { this.preview.set(await call<NlPreview>('POST', '/api/admin/newsletters/preview', { content: c, email: this.previewEmail().trim() || null })); }
      catch (e) { this.fail(e); }
    }, delay);
  }

  async save() {
    const d = this.selected();
    if (!d) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await call('PUT', `/api/admin/newsletters/${d.issue.id}`, { name: this.name(), content: this.c() });
      this.dirty.set(false);
      await this.load();
      await this.open(d.issue.id);
    } catch (e) { this.fail(e); } finally { this.busy.set(false); }
  }

  async remove(id: string) {
    if (!confirm('למחוק את הטיוטה?')) return;
    try {
      await call('DELETE', `/api/admin/newsletters/${id}`);
      this.selected.set(null); this.c.set(null); this.dirty.set(false);
      await this.load();
    } catch (e) { this.fail(e); }
  }

  async test() {
    const d = this.selected();
    if (!d) return;
    const emails = this.testEmails().split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
    this.busy.set(true);
    this.error.set(null);
    try {
      this.testResult.set(await call<NlTestResult>('POST', `/api/admin/newsletters/${d.issue.id}/test`, { emails }));
      await this.open(d.issue.id);
    } catch (e) { this.fail(e); } finally { this.busy.set(false); }
  }

  async send() {
    const d = this.selected();
    if (!d) return;
    if (!confirm(`לשלוח את "${d.issue.name}" ל־${d.pending} נמענים? אי אפשר לבטל מייל שכבר יצא.`)) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await call('POST', `/api/admin/newsletters/${d.issue.id}/send`, { confirm: d.pending });
      await this.open(d.issue.id);
      await this.load();
    } catch (e) { this.fail(e); } finally { this.busy.set(false); }
  }

  async stop() {
    const d = this.selected();
    if (!d) return;
    try { await call('POST', `/api/admin/newsletters/${d.issue.id}/stop`); await this.open(d.issue.id); } catch (e) { this.fail(e); }
  }

  async loadDeliveries() {
    const d = this.selected();
    if (!d) return;
    try { this.deliveries.set(await call('GET', `/api/admin/newsletters/${d.issue.id}/deliveries`)); } catch (e) { this.fail(e); }
  }
}
