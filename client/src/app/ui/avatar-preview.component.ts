import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, effect, input, viewChild } from '@angular/core';
import * as THREE from 'three';
import { Appearance, CharacterId } from '../core/models';
import { BoyAvatar } from '../world/avatar';

/** Small rotating 3D preview of the chosen character. */
@Component({
  selector: 'px-avatar-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<canvas #c aria-label="תצוגה מקדימה של הדמות" role="img"></canvas>`,
  styles: [':host{display:block} canvas{width:100%;height:100%;display:block}'],
})
export class AvatarPreviewComponent implements AfterViewInit, OnDestroy {
  characterId = input<CharacterId>('explorer');
  appearance = input<Appearance>({});
  private canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('c');
  private renderer?: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  private avatar?: BoyAvatar;
  private raf = 0;

  constructor() {
    effect(() => {
      const id = this.characterId();
      const a = this.appearance();
      if (this.renderer) this.rebuild(id, a);
    });
  }

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
    this.scene.add(new THREE.HemisphereLight('#c9d4ff', '#2a1d10', 1.4));
    const key = new THREE.DirectionalLight('#ffe2b0', 2.2);
    key.position.set(2, 3, 3);
    const rim = new THREE.DirectionalLight('#6aa8ff', 1.4);
    rim.position.set(-3, 2, -3);
    this.scene.add(key, rim);
    this.camera.position.set(0, 1.35, 4.1);
    this.camera.lookAt(0, 1.12, 0);
    this.rebuild(this.characterId(), this.appearance());
    const clock = new THREE.Clock();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      const w = c.clientWidth, h = c.clientHeight;
      const pr = this.renderer!.getPixelRatio();
      if (c.width !== Math.floor(w * pr) || c.height !== Math.floor(h * pr)) {
        this.renderer!.setSize(w, h, false);
        this.camera.aspect = w / Math.max(1, h);
        this.camera.updateProjectionMatrix();
      }
      const t = clock.getElapsedTime();
      if (this.avatar) {
        this.avatar.root.rotation.y = Math.sin(t * 0.6) * 0.7;
        this.avatar.update(0.016, 0, t);
      }
      this.renderer!.render(this.scene, this.camera);
    };
    loop();
  }

  private rebuild(id: CharacterId, a: Appearance) {
    if (this.avatar) {
      this.scene.remove(this.avatar.root);
      this.avatar.dispose();
    }
    this.avatar = new BoyAvatar(id, a);
    this.scene.add(this.avatar.root);
  }

  ngOnDestroy() {
    cancelAnimationFrame(this.raf);
    this.avatar?.dispose();
    this.renderer?.dispose();
  }
}
