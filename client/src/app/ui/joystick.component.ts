import { ChangeDetectionStrategy, Component, output, signal } from '@angular/core';

/** On-screen joystick for touch devices. Emits x (right +) and y (forward +) in [-1, 1]. */
@Component({
  selector: 'px-joystick',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="base" (pointerdown)="down($event)" (pointermove)="move($event)" (pointerup)="up()" (pointercancel)="up()" aria-label="ג׳ויסטיק תנועה" role="application">
      <div class="knob" [style.transform]="'translate(' + kx() + 'px,' + ky() + 'px)'"></div>
    </div>
  `,
  styles: [`
    .base { width: 120px; height: 120px; border-radius: 50%; background: rgba(255,255,255,.08); border: 2px solid rgba(224,185,92,.4); display:grid; place-items:center; touch-action:none; }
    .knob { width: 52px; height: 52px; border-radius: 50%; background: rgba(224,185,92,.75); box-shadow: 0 0 18px rgba(224,185,92,.5); pointer-events:none; }
  `],
})
export class JoystickComponent {
  changed = output<{ x: number; y: number }>();
  kx = signal(0);
  ky = signal(0);
  private origin?: { x: number; y: number; id: number };

  down(e: PointerEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    this.origin = { x: r.left + r.width / 2, y: r.top + r.height / 2, id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    this.move(e);
  }

  move(e: PointerEvent) {
    if (!this.origin || e.pointerId !== this.origin.id) return;
    let dx = e.clientX - this.origin.x;
    let dy = e.clientY - this.origin.y;
    const len = Math.hypot(dx, dy);
    const max = 40;
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    this.kx.set(dx);
    this.ky.set(dy);
    this.changed.emit({ x: dx / max, y: -dy / max });
  }

  up() {
    this.origin = undefined;
    this.kx.set(0);
    this.ky.set(0);
    this.changed.emit({ x: 0, y: 0 });
  }
}
