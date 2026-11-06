import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { toBlob } from 'html-to-image';

/** Marks a part of the results that is not part of the picture (these buttons, the email form, the page's own buttons). */
export const NO_CAPTURE = 'no-capture';

/**
 * Small buttons under the results: a picture of the results exactly as the page shows them — the same design, colors,
 * fonts, names and score — to copy (and paste straight into WhatsApp), to share through the device's own share sheet,
 * or to save. When the browser cannot copy or share images, saving is offered instead.
 */
@Component({
  selector: 'px-result-share',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: NO_CAPTURE },
  template: `
    <div class="share" role="group" aria-label="שיתוף התוצאות">
      <button type="button" class="btn small ghost" (click)="copy()" [disabled]="busy() || !ready()">העתקת תמונה</button>
      @if (canShare) {
        <button type="button" class="btn small ghost" (click)="share()" [disabled]="busy() || !ready()">שיתוף התוצאות</button>
      }
      <button type="button" class="btn small ghost" (click)="download()" [disabled]="busy() || !ready()">הורדת תמונה</button>
    </div>
    @if (note(); as n) { <p class="note" [class.bad]="!n.ok" role="status">{{ n.text }}</p> }
  `,
  styles: [`
    .share { display:flex; flex-wrap:wrap; gap:.4rem; justify-content:center; margin:.8rem 0 .2rem; }
    .share .btn { font-size:.82rem; padding:.3rem .75rem; min-height:32px; opacity:.85; }
    .note { margin:.3rem 0 0; font-size:.85rem; color:#bff0cf; } .note.bad { color:#ffd59a; }
  `],
})
export class ResultShareComponent {
  /** The results area to picture. */
  target = input.required<HTMLElement>();
  /** Whether every result is on the screen (the picture is taken only then). */
  ready = input(true);
  fileName = input('PORTAL-X-results.png');
  shareText = input('התוצאות שלנו ב-PORTAL X');

  busy = signal(false);
  note = signal<{ ok: boolean; text: string } | null>(null);
  /** Sharing files exists on most phones and some computers; elsewhere only copy and save are shown. */
  readonly canShare = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function'
    && navigator.canShare({ files: [new File([new Blob()], 'x.png', { type: 'image/png' })] });

  /** The picture: the results area at twice its size, after the fonts are ready, without the buttons and forms. */
  private async picture(): Promise<Blob> {
    await document.fonts?.ready;
    // two frames, so a number that just changed is painted before it is pictured
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const el = this.target();
    // the parts left out of the picture leave no empty band at its bottom
    const left = [...el.querySelectorAll<HTMLElement>('.' + NO_CAPTURE)].filter((n) => !n.parentElement?.closest('.' + NO_CAPTURE))
      .reduce((sum, n) => {
        const cs = getComputedStyle(n);
        return sum + n.offsetHeight + parseFloat(cs.marginTop || '0') + parseFloat(cs.marginBottom || '0');
      }, 0);
    const blob = await toBlob(el, {
      pixelRatio: Math.max(2, Math.min(3, window.devicePixelRatio || 1)),
      backgroundColor: '#0e1530',
      cacheBust: true,
      width: el.scrollWidth,
      height: Math.max(1, Math.ceil(el.scrollHeight - left)),
      // the card as it rests: no entrance animation, no shadow cut at the edges, nothing scrolled away
      style: { animation: 'none', transform: 'none', margin: '0', maxHeight: 'none', overflow: 'visible', boxShadow: 'none' },
      filter: (node) => !(node instanceof HTMLElement && node.classList.contains(NO_CAPTURE)),
    });
    if (!blob) throw new Error('no-image');
    return blob;
  }

  private async run(action: () => Promise<void>) {
    this.busy.set(true);
    this.note.set(null);
    try {
      await action();
    } catch (e: any) {
      // the person closed the share sheet: nothing went wrong
      if (e?.name !== 'AbortError') this.note.set({ ok: false, text: 'לא הצלחנו ליצור את התמונה. נסו שוב או השתמשו בהורדת התמונה.' });
    } finally {
      this.busy.set(false);
    }
  }

  copy() {
    const clip = navigator.clipboard as Clipboard | undefined;
    if (!clip?.write || typeof ClipboardItem === 'undefined') {
      this.note.set({ ok: false, text: 'הדפדפן הזה לא מאפשר להעתיק תמונות. אפשר להוריד את התמונה ולשתף אותה.' });
      return;
    }
    // the item gets the picture as a promise at once, inside the click, which Safari requires
    const pending = this.picture();
    this.run(async () => {
      try {
        await clip.write([new ClipboardItem({ 'image/png': pending })]);
      } catch (e: any) {
        await pending.catch(() => {});
        if (e?.name === 'NotAllowedError' || e?.name === 'TypeError') {
          this.note.set({ ok: false, text: 'הדפדפן לא אישר העתקת תמונה. אפשר להוריד את התמונה ולשתף אותה.' });
          return;
        }
        throw e;
      }
      this.note.set({ ok: true, text: 'התמונה הועתקה. אפשר להדביק אותה בוואטסאפ או בכל צ׳אט.' });
    });
  }

  share() {
    this.run(async () => {
      const file = new File([await this.picture()], this.fileName(), { type: 'image/png' });
      if (!navigator.canShare?.({ files: [file] })) {
        this.save(file);
        this.note.set({ ok: true, text: 'השיתוף לא זמין כאן, ולכן התמונה נשמרה במכשיר.' });
        return;
      }
      await navigator.share({ files: [file], title: 'PORTAL X', text: this.shareText() });
    });
  }

  download() {
    this.run(async () => {
      this.save(await this.picture());
      this.note.set({ ok: true, text: 'התמונה נשמרה.' });
    });
  }

  private save(blob: Blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.fileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
