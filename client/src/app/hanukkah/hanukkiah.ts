import * as THREE from 'three';
import { glowSpriteTexture } from '../world/textures';

/**
 * The one hanukkiah model used everywhere in the game (spec Part B §3):
 * exactly nine branches — eight regular ones, four on each side, and the shamash in the middle, clearly higher.
 * Never a seven-branched menorah.
 */
export class Hanukkiah {
  readonly root = new THREE.Group();
  /** index 0..7 = the eight regular candles from right to left (the first night is the rightmost) */
  private flames: THREE.Sprite[] = [];
  private shamashFlame: THREE.Sprite;
  private light?: THREE.PointLight;
  private lit = 0;
  private shamashOn = false;

  static readonly BRANCHES = 9;

  constructor(scale = 1, withLight = true) {
    const gold = new THREE.MeshStandardMaterial({ color: '#d4a640', metalness: 0.9, roughness: 0.28, emissive: '#2a1a04' });
    const wax = new THREE.MeshStandardMaterial({ color: '#f3ead2', roughness: 0.7 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 0.08, 24), gold);
    base.position.y = 0.04;
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.22, 0.14, 20), gold);
    foot.position.y = 0.15;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.62, 12), gold);
    stem.position.y = 0.53;
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), gold);
    knot.position.y = 0.5;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.05, 0.06), gold);
    bar.position.y = 0.84;
    this.root.add(base, foot, stem, knot, bar);

    const flameMat = () => new THREE.SpriteMaterial({ map: glowSpriteTexture('#ffb84d'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    const cup = (x: number, y: number) => {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.04, 0.07, 14), gold);
      c.position.set(x, y, 0);
      const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.16, 8), wax);
      candle.position.set(x, y + 0.11, 0);
      const flame = new THREE.Sprite(flameMat());
      flame.scale.set(0.14, 0.22, 1);
      flame.position.set(x, y + 0.27, 0);
      flame.visible = false;
      this.root.add(c, candle, flame);
      return flame;
    };
    // four regular branches on each side, all at the same height
    const xs = [0.84, 0.63, 0.42, 0.21, -0.21, -0.42, -0.63, -0.84];
    for (const x of xs) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.16, 8), gold);
      post.position.set(x, 0.92, 0);
      this.root.add(post);
      this.flames.push(cup(x, 1.02));
    }
    // the shamash: in the middle and clearly higher than the eight
    const shamashPost = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 10), gold);
    shamashPost.position.set(0, 1.09, 0);
    this.root.add(shamashPost);
    this.shamashFlame = cup(0, 1.36);

    if (withLight) {
      this.light = new THREE.PointLight('#ffb469', 0, 6 * scale, 1.6);
      this.light.position.set(0, 1.5, 0.3);
      this.root.add(this.light);
    }
    this.root.scale.setScalar(scale);
  }

  /** Lights the shamash and `count` of the eight candles (from the right), matching the stage of the game. */
  setLit(count: number, shamash: boolean) {
    this.lit = Math.max(0, Math.min(8, count));
    this.shamashOn = shamash;
    this.flames.forEach((f, i) => (f.visible = i < this.lit));
    this.shamashFlame.visible = shamash;
    if (this.light) this.light.intensity = (this.lit + (shamash ? 1 : 0)) * 0.9;
  }

  get litCount() {
    return this.lit;
  }

  update(t: number) {
    const all = [...this.flames, this.shamashFlame];
    all.forEach((f, i) => {
      if (!f.visible) return;
      f.scale.set(0.13 + Math.sin(t * 13 + i) * 0.015, 0.21 + Math.sin(t * 17 + i * 2) * 0.03, 1);
    });
  }
}
