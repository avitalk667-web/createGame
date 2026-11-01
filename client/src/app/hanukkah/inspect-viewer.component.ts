import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, input, output, viewChild } from '@angular/core';
import * as THREE from 'three';
import { EVIDENCE_EMOJI, sealTexture } from './h-world';

/** Where each object hides its symbol (in the object's own frame) and the side it shows first. */
const HIDDEN_SIDE: Record<string, THREE.Vector3> = {
  book: new THREE.Vector3(0, 0, -1),      // the back cover
  hourglass: new THREE.Vector3(0, -1, 0), // under the base
  lamp: new THREE.Vector3(0, -1, 0),      // under the lamp
  scroll: new THREE.Vector3(0, 0, -1),    // the wax seal at the back
};

/**
 * The library's evidence up close: the object turns by dragging (mouse or touch) or with the buttons, and once its
 * hidden side faces the player the symbol shows and `found` fires (the server then records it). Nothing here decides
 * the puzzle — the server checks that the object was examined and gives the symbol once.
 */
@Component({
  selector: 'px-inspect-viewer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <canvas #c role="img" [attr.aria-label]="'החפץ מקרוב — אפשר לסובב אותו'"></canvas>
    <div class="turns">
      <button type="button" class="btn small" (click)="turn('y', 1)" aria-label="סיבוב ימינה">↻ סיבוב</button>
      <button type="button" class="btn small" (click)="turn('x', 1)" aria-label="הפיכה">⤵ הפיכה</button>
      <button type="button" class="btn small ghost" (click)="reset()" aria-label="חזרה למבט הראשון">⟲</button>
    </div>
  `,
  styles: [`
    :host { display:block; }
    canvas { width:100%; height:260px; display:block; border-radius:12px; touch-action:none; cursor:grab;
      background: radial-gradient(circle at 50% 40%, #3a2c1c, #120c08 75%); }
    .turns { display:flex; gap:.4rem; justify-content:center; margin-top:.4rem; flex-wrap:wrap; }
  `],
})
export class InspectViewerComponent implements AfterViewInit, OnDestroy {
  kind = input.required<string>();
  revealed = input(false);
  found = output<void>();

  private canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('c');
  private renderer?: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 0.1, 20);
  private obj = new THREE.Group();
  private symbol?: THREE.Mesh;
  private goal = new THREE.Quaternion();
  private drag?: { id: number; x: number; y: number };
  private facingSince = 0;
  private sent = false;
  private raf = 0;

  ngAfterViewInit() {
    const c = this.canvas().nativeElement;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true });
    } catch {
      return;
    }
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene.add(new THREE.HemisphereLight('#ffe9c8', '#2a1d10', 1.6));
    const key = new THREE.DirectionalLight('#ffd9a0', 2.4);
    key.position.set(2, 3, 4);
    this.scene.add(key);
    this.camera.position.set(0, 0, 4.2);
    this.build(this.kind());
    this.scene.add(this.obj);
    c.addEventListener('pointerdown', this.down);
    c.addEventListener('pointermove', this.move);
    c.addEventListener('pointerup', this.up);
    c.addEventListener('pointercancel', this.up);
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      const w = c.clientWidth, h = c.clientHeight;
      if (c.width !== Math.floor(w * this.renderer!.getPixelRatio())) {
        this.renderer!.setSize(w, h, false);
        this.camera.aspect = w / Math.max(1, h);
        this.camera.updateProjectionMatrix();
      }
      if (!this.drag) this.obj.quaternion.slerp(this.goal, 0.18);
      this.check();
      this.renderer!.render(this.scene, this.camera);
    };
    loop();
  }

  /** Turns a quarter about the screen's vertical (y) or horizontal (x) axis. */
  turn(axis: 'x' | 'y', dir: number) {
    const q = new THREE.Quaternion().setFromAxisAngle(axis === 'y' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0), (dir * Math.PI) / 2);
    this.goal.premultiply(q).normalize();
  }

  reset() {
    this.goal.identity();
  }

  private down = (e: PointerEvent) => {
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    this.canvas().nativeElement.setPointerCapture(e.pointerId);
  };

  private move = (e: PointerEvent) => {
    if (!this.drag || this.drag.id !== e.pointerId) return;
    const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
    this.drag.x = e.clientX;
    this.drag.y = e.clientY;
    const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dx * 0.012);
    const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), dy * 0.012);
    this.obj.quaternion.premultiply(qy).premultiply(qx).normalize();
    this.goal.copy(this.obj.quaternion);
  };

  private up = (e: PointerEvent) => {
    if (this.drag?.id === e.pointerId) this.drag = undefined;
  };

  /** The hidden side counts as found once it has faced the player for a moment. */
  private check() {
    const side = HIDDEN_SIDE[this.kind()];
    if (!side || !this.symbol) return;
    const facing = side.clone().applyQuaternion(this.obj.quaternion).z > 0.8;
    const now = performance.now();
    if (!facing) this.facingSince = 0;
    else if (!this.facingSince) this.facingSince = now;
    const shown = this.revealed() || (facing && now - this.facingSince > 250);
    (this.symbol.material as THREE.MeshStandardMaterial).emissiveIntensity = shown ? 0.6 : 0;
    this.symbol.visible = shown || facing;
    if (shown && !this.revealed() && !this.sent) {
      this.sent = true;
      this.found.emit();
    }
  }

  private build(kind: string) {
    const m = (color: string, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...o });
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      this.obj.add(mesh);
      return mesh;
    };
    const item = { book: 'ev-book', hourglass: 'ev-hourglass', lamp: 'ev-lamp', scroll: 'ev-scroll' }[kind] ?? '';
    const seal = new THREE.MeshStandardMaterial({ map: sealTexture(EVIDENCE_EMOJI[item] ?? '◆'), transparent: true, emissive: '#ffcf70', emissiveIntensity: 0 });
    const brass = m('#b8873a', { metalness: 0.8, roughness: 0.35 });
    switch (kind) {
      case 'book': {
        add(new THREE.BoxGeometry(1.0, 1.35, 0.28), m('#5a2416', { roughness: 0.6 }));
        add(new THREE.BoxGeometry(0.94, 1.29, 0.24), m('#efe2bf'), 0.04, 0, 0);
        add(new THREE.BoxGeometry(0.6, 0.06, 0.29), brass, 0, 0.45, 0);
        add(new THREE.BoxGeometry(0.6, 0.06, 0.29), brass, 0, -0.45, 0);
        this.symbol = add(new THREE.PlaneGeometry(0.55, 0.55), seal, 0, 0, -0.145);
        this.symbol.rotation.y = Math.PI;
        break;
      }
      case 'hourglass': {
        for (const y of [-0.7, 0.7]) add(new THREE.CylinderGeometry(0.5, 0.5, 0.1, 28), m('#4a2c14'), 0, y, 0);
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2;
          add(new THREE.CylinderGeometry(0.04, 0.04, 1.4, 8), brass, Math.cos(a) * 0.42, 0, Math.sin(a) * 0.42);
        }
        const glass = new THREE.MeshStandardMaterial({ color: '#dfefff', transparent: true, opacity: 0.35, roughness: 0.05 });
        add(new THREE.ConeGeometry(0.32, 0.62, 24, 1, true), glass, 0, 0.33, 0).rotation.x = Math.PI;
        add(new THREE.ConeGeometry(0.32, 0.62, 24, 1, true), glass, 0, -0.33, 0);
        add(new THREE.ConeGeometry(0.24, 0.3, 20), m('#d9b36a'), 0, -0.48, 0);
        this.symbol = add(new THREE.PlaneGeometry(0.62, 0.62), seal, 0, -0.756, 0);
        this.symbol.rotation.x = Math.PI / 2;
        break;
      }
      case 'lamp': {
        const clay = m('#a5602e', { roughness: 0.6 });
        const body = add(new THREE.SphereGeometry(0.6, 28, 18), clay);
        body.scale.set(1, 0.45, 0.75);
        add(new THREE.CylinderGeometry(0.1, 0.16, 0.6, 14), clay, 0.72, 0.05, 0).rotation.z = Math.PI / 2;
        add(new THREE.TorusGeometry(0.17, 0.05, 8, 18), clay, -0.66, 0.1, 0);
        add(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 18), m('#3a2414'), 0, 0.27, 0);
        add(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffd27a' }), 1.02, 0.12, 0);
        this.symbol = add(new THREE.PlaneGeometry(0.62, 0.62), seal, 0, -0.275, 0);
        this.symbol.rotation.x = Math.PI / 2;
        break;
      }
      default: {
        // the sealed scroll: rolled parchment, a red ribbon, the wax seal on its back
        add(new THREE.CylinderGeometry(0.28, 0.28, 1.7, 28), m('#e8d6a8'), 0, 0, 0).rotation.z = Math.PI / 2;
        for (const x of [-0.92, 0.92]) add(new THREE.CylinderGeometry(0.09, 0.09, 0.2, 12), m('#4a2c14'), x, 0, 0).rotation.z = Math.PI / 2;
        add(new THREE.TorusGeometry(0.29, 0.03, 8, 28), m('#8a1c1c'), 0, 0, 0).rotation.y = Math.PI / 2;
        this.symbol = add(new THREE.CircleGeometry(0.26, 28), seal, 0, 0, -0.295);
        this.symbol.rotation.y = Math.PI;
      }
    }
    this.symbol.visible = false;
    // start at a slight angle so it reads as a solid object
    this.goal.setFromEuler(new THREE.Euler(0.25, -0.5, 0));
    this.obj.quaternion.copy(this.goal);
  }

  ngOnDestroy() {
    cancelAnimationFrame(this.raf);
    this.obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
      mat?.map?.dispose();
      mat?.dispose();
    });
    this.renderer?.dispose();
  }
}
