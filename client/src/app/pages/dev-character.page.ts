import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, NgZone, OnDestroy, inject, signal, viewChild } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CharacterAvatar } from '../world/character/character-factory';
import { CHARACTER_CONFIG } from '../world/character/character-config';
import { characterLoader } from '../world/character/character-loader';
import { CHARACTER_STATES, CharacterState, CharacterTemplate } from '../world/character/character.types';

type View = 'front' | 'back' | 'left' | 'right' | 'free';

/**
 * Development only (route exists in dev builds only): the shared player character on a floor, to check the model,
 * its proportions and every animation state from all sides before it goes into the games.
 * WASD / arrows move (Shift runs) with the same speeds and turning as the games; the mouse orbits the camera.
 */
@Component({
  selector: 'px-dev-character',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <canvas #c aria-label="בדיקת דמות"></canvas>
    <aside class="panel card" dir="rtl">
      <b>בדיקת דמות השחקן</b>
      <div class="row">
        <button class="btn small" [class.primary]="forced() === null" (click)="force(null)">אוטומטי (תנועה)</button>
        @for (s of states; track s) {
          <button class="btn small" [class.primary]="forced() === s" (click)="force(s)">{{ s }}</button>
        }
      </div>
      <div class="row">
        @for (v of views; track v.id) {
          <button class="btn small" [class.primary]="view() === v.id" (click)="setView(v.id)">{{ v.name }}</button>
        }
      </div>
      <div class="row">
        <button class="btn small" (click)="spin(-1)">⟲ סיבוב</button>
        <button class="btn small" (click)="spin(1)">סיבוב ⟳</button>
        <button class="btn small" (click)="autoWalk()">הליכה במעגל</button>
        <button class="btn small" (click)="setCrowd(crowd() ? 0 : 3)">{{ crowd() ? 'דמות אחת' : '4 דמויות' }}</button>
        <button class="btn small" (click)="toggleSkeleton()">שלד</button>
      </div>
      <pre>{{ info() }}</pre>
      <small>WASD / חיצים — תנועה, Shift — ריצה. עכבר — סיבוב מצלמה.</small>
    </aside>
  `,
  styles: [`
    :host { display:block; position:fixed; inset:0; background:#1b2030; }
    canvas { width:100%; height:100%; display:block; }
    .panel { position:fixed; bottom:10px; inset-inline-start:10px; max-height:45vh; overflow:auto; font-size:.8rem; max-width:min(440px, calc(100vw - 20px)); padding:.6rem .8rem; display:flex; flex-direction:column; gap:.4rem; z-index:2; }
    .row { display:flex; flex-wrap:wrap; gap:.3rem; }
    pre { margin:0; font-size:.7rem; max-height:4.5rem; overflow:auto; white-space:pre-wrap; direction:ltr; text-align:left; }
  `],
})
export class DevCharacterPage implements AfterViewInit, OnDestroy {
  private canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('c');
  private zone = inject(NgZone);
  states = CHARACTER_STATES;
  views: { id: View; name: string }[] = [
    { id: 'front', name: 'חזית' }, { id: 'back', name: 'גב' }, { id: 'right', name: 'צד ימין' }, { id: 'left', name: 'צד שמאל' }, { id: 'free', name: 'חופשי' },
  ];
  forced = signal<CharacterState | null>(null);
  view = signal<View>('front');
  crowd = signal(0);
  info = signal('טוען…');

  private renderer?: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
  private controls?: OrbitControls;
  private avatar?: CharacterAvatar;
  private extras: CharacterAvatar[] = [];
  private helper?: THREE.SkeletonHelper;
  private keys = new Set<string>();
  private pos = new THREE.Vector3();
  private yaw = 0;
  private circle = false;
  private raf = 0;
  private frames = 0;
  private fps = 0;
  private fpsAt = 0;

  ngAfterViewInit() {
    const c = this.canvas().nativeElement;
    this.renderer = new THREE.WebGLRenderer({ canvas: c, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.scene.background = new THREE.Color('#1b2030');
    this.scene.add(new THREE.HemisphereLight('#dfe6ff', '#3a2c1c', 1.3));
    const sun = new THREE.DirectionalLight('#fff1d6', 2.4);
    sun.position.set(4, 8, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8 });
    this.scene.add(sun, sun.target);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: '#59606e', roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    const grid = new THREE.GridHelper(40, 40, '#8a93a6', '#6b7282');
    grid.position.y = 0.002;
    // reference: a 2.2-unit post (game height) next to the character
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, CHARACTER_CONFIG.targetHeight, 0.06), new THREE.MeshBasicMaterial({ color: '#e8c36a' }));
    post.position.set(1.2, CHARACTER_CONFIG.targetHeight / 2, 0);
    this.scene.add(floor, grid, post);
    this.controls = new OrbitControls(this.camera, c);
    this.controls.target.set(0, 1.1, 0);
    this.setView('front');

    this.avatar = new CharacterAvatar('detective', null, 'בדיקה');
    this.scene.add(this.avatar.root);
    characterLoader.load().then((t) => this.describe(t), (e) => this.info.set(`שגיאה בטעינה — מוצגת הדמות הקודמת\n${e}`));

    addEventListener('keydown', this.onKey);
    addEventListener('keyup', this.onKey);
    const clock = new THREE.Clock();
    this.zone.runOutsideAngular(() => {
      const loop = () => {
        this.raf = requestAnimationFrame(loop);
        this.tick(Math.min(0.05, clock.getDelta()), clock.elapsedTime);
      };
      loop();
    });
  }

  private describe(t: CharacterTemplate) {
    const s = t.size;
    this.info.set([
      `model: ${t.url}`,
      `size (file units): ${s.x.toFixed(3)} × ${s.y.toFixed(3)} × ${s.z.toFixed(3)}`,
      `scale → ${t.scale.toFixed(3)}  (height ${CHARACTER_CONFIG.targetHeight})  ground lift ${t.groundOffset.toFixed(3)}`,
      `bones (${t.boneNames.length}): ${t.boneNames.join(', ')}`,
      `clips in file: ${t.fileClips.map((c) => c.name).join(', ') || '—'}`,
      `game clips: ${[...t.clips.keys()].join(', ')}`,
    ].join('\n'));
  }

  force(s: CharacterState | null) {
    this.forced.set(s);
    this.circle = false;
    for (const a of [this.avatar, ...this.extras]) a?.animation?.force(s);
  }

  setView(v: View) {
    this.view.set(v);
    if (v === 'free') return;
    const d = 6;
    const a = { front: 0, back: Math.PI, right: -Math.PI / 2, left: Math.PI / 2 }[v] + this.yaw;
    // the character faces +Z at yaw 0; its right side is -X
    this.camera.position.set(this.pos.x + Math.sin(a) * d, 1.5, this.pos.z + Math.cos(a) * d);
    this.controls?.target.set(this.pos.x, 1.1, this.pos.z);
    this.controls?.update();
  }

  spin(dir: number) {
    this.yaw += dir * Math.PI / 4;
  }

  autoWalk() {
    this.circle = !this.circle;
    this.force(null);
    this.circle = true;
  }

  setCrowd(n: number) {
    this.crowd.set(n);
    for (const a of this.extras) {
      this.scene.remove(a.root);
      a.dispose();
    }
    this.extras = [];
    for (let i = 0; i < n; i++) {
      const a = new CharacterAvatar('detective', null, `שחקן ${i + 2}`);
      a.root.position.set(-1.4 * (i + 1), 0, -1);
      this.scene.add(a.root);
      this.extras.push(a);
    }
  }

  toggleSkeleton() {
    if (this.helper) {
      this.scene.remove(this.helper);
      this.helper.dispose();
      this.helper = undefined;
    } else if (this.avatar?.modelObject) {
      this.helper = new THREE.SkeletonHelper(this.avatar.modelObject);
      this.scene.add(this.helper);
    }
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.type === 'keydown') this.keys.add(e.code);
    else this.keys.delete(e.code);
  };

  /** Dev hook (console / automated checks): stop the clock so poses can be stepped and captured frame by frame. */
  freeze = false;

  private tick(dt: number, t: number) {
    const r = this.renderer!;
    if (this.freeze) {
      r.render(this.scene, this.camera);
      return;
    }
    const c = r.domElement;
    if (c.width !== Math.floor(c.clientWidth * r.getPixelRatio()) || c.height !== Math.floor(c.clientHeight * r.getPixelRatio())) {
      r.setSize(c.clientWidth, c.clientHeight, false);
      this.camera.aspect = c.clientWidth / Math.max(1, c.clientHeight);
      this.camera.updateProjectionMatrix();
    }
    // the same movement rules as the games: camera-relative input, 3.4 / 5.5 units/s, smooth turn toward travel
    let fx = 0, fz = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) fz += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) fz -= 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) fx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) fx += 1;
    const run = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    let speed = 0;
    let targetYaw = this.yaw;
    if (Math.hypot(fx, fz) > 0.05) {
      this.circle = false;
      const camYaw = Math.atan2(this.camera.position.x - this.pos.x, this.camera.position.z - this.pos.z);
      const n = Math.hypot(fx, fz);
      const sin = Math.sin(camYaw), cos = Math.cos(camYaw);
      const dx = (fx / n) * cos - (fz / n) * sin;
      const dz = -(fx / n) * sin - (fz / n) * cos;
      speed = run ? CHARACTER_CONFIG.runSpeed : CHARACTER_CONFIG.walkSpeed;
      this.pos.x += dx * speed * dt;
      this.pos.z += dz * speed * dt;
      targetYaw = Math.atan2(dx, dz);
    } else if (this.circle) {
      speed = CHARACTER_CONFIG.walkSpeed;
      const w = speed / 4;
      this.pos.set(Math.sin(t * w) * 4, 0, Math.cos(t * w) * 4);
      targetYaw = t * w + Math.PI / 2;
    }
    let diff = targetYaw - this.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.yaw += diff * Math.min(1, dt * 12);
    if (this.avatar) {
      this.avatar.root.position.copy(this.pos);
      this.avatar.root.rotation.y = this.yaw;
      if (this.forced() === 'cheer') this.avatar.cheer(t);
      else this.avatar.update(dt, speed, t);
      if (this.view() !== 'free' && (speed > 0 || this.circle)) this.setView(this.view());
    }
    for (const a of this.extras) {
      a.root.rotation.y = this.yaw;
      if (this.forced() === 'cheer') a.cheer(t);
      else a.update(dt, speed, t);
    }
    this.controls?.update();
    r.render(this.scene, this.camera);
    this.frames++;
    if (t - this.fpsAt > 1) {
      this.fps = this.frames / (t - this.fpsAt);
      this.frames = 0;
      this.fpsAt = t;
      const st = this.avatar?.animation?.state ?? this.avatar?.kind;
      (window as unknown as Record<string, unknown>)['pxCharacter'] = { kind: this.avatar?.kind, state: st, fps: Math.round(this.fps), calls: r.info.render.calls, triangles: r.info.render.triangles };
    }
  }

  ngOnDestroy() {
    cancelAnimationFrame(this.raf);
    removeEventListener('keydown', this.onKey);
    removeEventListener('keyup', this.onKey);
    this.setCrowd(0);
    this.avatar?.dispose();
    this.controls?.dispose();
    this.renderer?.dispose();
  }
}
