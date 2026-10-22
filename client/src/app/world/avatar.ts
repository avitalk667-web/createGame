import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Appearance, CharacterId } from '../core/models';
import { blobShadowTexture, labelTexture } from './textures';

export const SKIN_TONES = ['#f3d2b3', '#e9bd96', '#d8a27c', '#c38c66'];
// Brown shades so the black kippah always stands out against the hair.
export const HAIR_COLORS = ['#5a3820', '#3b2414', '#7a5030'];
export const BAG_COLORS = ['#2b2b2b', '#5a3b22', '#23344f', '#3d4a2a'];

const mat = (color: string, roughness = 0.8, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, ...extra });

/**
 * A boy in Haredi dress — black kippah, white shirt, black trousers and shoes (visual addendum, mandatory).
 * Stylised "animated film" proportions like the concept art: large head, big eyes, short limbs.
 * Variety comes only from skin tone, hair, glasses and backpack, keeping the dress modest and uniform.
 */
export class BoyAvatar {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private legL!: THREE.Group;
  private legR!: THREE.Group;
  private armL!: THREE.Group;
  private armR!: THREE.Group;
  private head!: THREE.Group;
  private tag?: THREE.Sprite;
  private phase = 0;
  private highlight?: THREE.Mesh;

  constructor(characterId: CharacterId, appearance: Appearance | null, nickname?: string) {
    const a = appearance ?? {};
    const skinColor = SKIN_TONES[a.skin ?? 0] ?? SKIN_TONES[0];
    const skin = mat(skinColor, 0.62);
    const shirt = mat('#e9ebef', 0.9);
    const shirtShade = mat('#d6d9df', 0.92);
    const trousers = mat('#16171c', 0.72);
    const shoe = mat('#0b0b0d', 0.28, { metalness: 0.15 });
    const hair = mat(HAIR_COLORS[a.hair ?? 0] ?? HAIR_COLORS[0], 0.75);
    const velvet = mat('#050507', 0.38, { side: THREE.DoubleSide });
    const bag = mat(BAG_COLORS[a.bag ?? 0] ?? BAG_COLORS[0], 0.7);

    // ---- legs: black trousers, polished shoes
    const mkLeg = (x: number) => {
      const g = new THREE.Group();
      g.position.set(x, 0.74, 0);
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 0.48, 6, 14), trousers);
      leg.position.y = -0.33;
      const shoeBody = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), shoe);
      shoeBody.scale.set(0.95, 0.55, 1.55);
      shoeBody.position.set(0, -0.69, 0.06);
      const sole = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.04, 0.33, 2, 0.015), mat('#202024', 0.6));
      sole.position.set(0, -0.735, 0.06);
      g.add(leg, shoeBody, sole);
      return g;
    };
    this.legL = mkLeg(-0.13);
    this.legR = mkLeg(0.13);

    // ---- torso: shaped white shirt tucked into trousers, belt with buckle
    const hips = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.25, 0.24, 20), trousers);
    hips.position.y = 0.82;
    hips.scale.z = 0.85;
    const profile = [
      [0.0, 0.9], [0.262, 0.9], [0.272, 1.0], [0.285, 1.18], [0.292, 1.33], [0.286, 1.42], [0.25, 1.49], [0.17, 1.545], [0.09, 1.565], [0.0, 1.57],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const torso = new THREE.Mesh(new THREE.LatheGeometry(profile, 28), shirt);
    torso.scale.z = 0.84;
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.276, 0.276, 0.055, 24), shoe);
    belt.position.y = 0.935;
    belt.scale.z = 0.86;
    const buckle = new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.05, 0.02, 2, 0.006), mat('#c8b06a', 0.3, { metalness: 0.85 }));
    buckle.position.set(0, 0.935, 0.24);
    // collar points and placket with buttons
    const collarGeo = new RoundedBoxGeometry(0.12, 0.03, 0.09, 2, 0.01);
    const collarL = new THREE.Mesh(collarGeo, shirt);
    collarL.position.set(-0.065, 1.535, 0.14);
    collarL.rotation.set(0.75, 0.35, 0.6);
    const collarR = new THREE.Mesh(collarGeo, shirt);
    collarR.position.set(0.065, 1.535, 0.14);
    collarR.rotation.set(0.75, -0.35, -0.6);
    const placket = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.55, 0.008), shirtShade);
    placket.position.set(0, 1.2, 0.245);
    const buttons = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), mat('#d5d5cf', 0.4));
      b.position.set(0, 1.44 - i * 0.13, 0.25);
      buttons.add(b);
    }
    const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.006), shirtShade);
    pocket.position.set(-0.13, 1.33, 0.235);
    pocket.rotation.y = -0.25;
    // tzitzit strings at the waist
    const tzitzit = new THREE.Group();
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const s = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.3, 4), mat('#ffffff', 0.9));
        s.position.set(side * (0.262 + (i % 2) * 0.01), 0.76, 0.05 - i * 0.022);
        s.rotation.z = side * 0.04;
        tzitzit.add(s);
      }
    }

    // ---- arms: long white sleeves with cuffs
    const mkArm = (x: number) => {
      const g = new THREE.Group();
      g.position.set(x, 1.43, 0);
      const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.088, 14, 10), shirt);
      shoulder.scale.set(1, 0.85, 0.9);
      const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.083, 0.36, 6, 12), shirt);
      sleeve.position.y = -0.24;
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.081, 0.081, 0.05, 14), shirtShade);
      cuff.position.y = -0.45;
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), skin);
      hand.scale.set(0.9, 1.1, 0.75);
      hand.position.y = -0.54;
      const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.04, 4, 8), skin);
      thumb.position.set(x > 0 ? -0.05 : 0.05, -0.52, 0.04);
      thumb.rotation.z = x > 0 ? 0.6 : -0.6;
      g.add(shoulder, sleeve, cuff, hand, thumb);
      g.rotation.z = x > 0 ? -0.06 : 0.06;
      return g;
    };
    this.armL = mkArm(-0.305);
    this.armR = mkArm(0.305);

    // ---- head
    this.head = new THREE.Group();
    this.head.position.y = 1.9;
    const R = 0.3;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.16, 14), skin);
    neck.position.y = -0.3;
    const face = new THREE.Mesh(new THREE.SphereGeometry(R, 40, 30), skin);
    face.scale.set(1, 1.0, 0.95);
    const chin = new THREE.Mesh(new THREE.SphereGeometry(R * 0.72, 24, 16), skin);
    chin.position.set(0, -0.09, 0.05);
    chin.scale.set(1, 0.85, 0.9);

    // short neat hair with a side part: cap over top/back, side panels above the ears, a swept fringe
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(R + 0.018, 40, 20, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
    hairCap.rotation.x = -0.5;
    hairCap.position.set(0, 0.0, -0.01);
    const back = new THREE.Mesh(new THREE.SphereGeometry(R + 0.012, 32, 16, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.3), hair);
    back.rotation.x = -1.2;
    const sides: THREE.Mesh[] = [];
    for (const side of [-1, 1]) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), hair);
      s.scale.set(0.35, 0.75, 0.9);
      s.position.set(side * (R - 0.02), 0.07, -0.03);
      sides.push(s);
    }
    const fringe = new THREE.Mesh(new THREE.SphereGeometry(R + 0.025, 32, 12, Math.PI * 1.05, Math.PI * 0.95, Math.PI * 0.16, Math.PI * 0.2), hair);
    fringe.rotation.set(0.1, Math.PI, -0.18);
    fringe.position.set(0.0, 0.0, 0.0);

    // black velvet kippah on the crown — wide and only slightly tilted so it reads clearly from every angle
    const kipR = R + 0.045;
    const kipTheta = Math.PI * 0.27;
    const kipGroup = new THREE.Group();
    const kip = new THREE.Mesh(new THREE.SphereGeometry(kipR, 40, 12, 0, Math.PI * 2, 0, kipTheta), velvet);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(kipR * Math.sin(kipTheta), 0.011, 8, 48), mat('#26262e', 0.4));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = kipR * Math.cos(kipTheta);
    const stitch = new THREE.Mesh(new THREE.TorusGeometry(kipR * Math.sin(kipTheta) * 0.55, 0.004, 6, 40), mat('#3a3a46', 0.4));
    stitch.rotation.x = Math.PI / 2;
    stitch.position.y = kipR * Math.cos(kipTheta * 0.55) + 0.002;
    kipGroup.add(kip, rim, stitch);
    kipGroup.rotation.x = -0.12;
    kipGroup.position.set(0, 0.02, -0.01);

    // short side curls (peyot) in front of the ears
    const curlPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 30; i++) {
      const t = i / 30;
      const r = 0.018 + t * 0.008;
      curlPts.push(new THREE.Vector3(Math.cos(t * Math.PI * 6) * r, -t * 0.22, Math.sin(t * Math.PI * 6) * r));
    }
    const curlGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(curlPts), 60, 0.012, 6);
    const curls: THREE.Mesh[] = [];
    for (const side of [-1, 1]) {
      const curl = new THREE.Mesh(curlGeo, hair);
      curl.position.set(side * (R - 0.015), 0.0, 0.08);
      curls.push(curl);
    }
    const ears: THREE.Mesh[] = [];
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.065, 14, 12), skin);
      ear.position.set(side * (R - 0.01), -0.02, -0.02);
      ear.scale.set(0.42, 1, 0.72);
      ears.push(ear);
    }

    // big friendly eyes: white, brown iris, pupil, two highlights; eyebrows; nose; smile; rosy cheeks
    const white = mat('#ffffff', 0.25);
    const iris = mat('#5a3a1e', 0.2);
    const pupil = mat('#0c0806', 0.15);
    const face2: THREE.Object3D[] = [];
    for (const side of [-1, 1]) {
      const ex = side * 0.105;
      const sclera = new THREE.Mesh(new THREE.SphereGeometry(0.068, 20, 16), white);
      sclera.scale.set(0.85, 1.05, 0.42);
      sclera.position.set(ex, 0.005, R - 0.028);
      const ir = new THREE.Mesh(new THREE.SphereGeometry(0.044, 18, 14), iris);
      ir.scale.set(1, 1.08, 0.4);
      ir.position.set(ex + side * 0.004, -0.004, R - 0.004);
      const pu = new THREE.Mesh(new THREE.SphereGeometry(0.024, 14, 10), pupil);
      pu.scale.set(1, 1, 0.4);
      pu.position.set(ex + side * 0.004, -0.004, R + 0.006);
      const g1 = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 8), white);
      g1.position.set(ex + 0.016, 0.018, R + 0.013);
      const g2 = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 8), white);
      g2.position.set(ex - 0.012, -0.02, R + 0.013);
      const brow = new THREE.Mesh(new THREE.CapsuleGeometry(0.009, 0.07, 4, 8), hair);
      brow.rotation.z = Math.PI / 2 + side * 0.12;
      brow.position.set(ex, 0.1, R - 0.015);
      const cheek = new THREE.Mesh(new THREE.CircleGeometry(0.04, 20), new THREE.MeshBasicMaterial({ color: '#ff8f8f', transparent: true, opacity: 0.22, depthWrite: false }));
      cheek.position.set(side * 0.17, -0.075, R - 0.04);
      cheek.rotation.y = side * 0.5;
      face2.push(sclera, ir, pu, g1, g2, brow, cheek);
    }
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.032, 14, 10), skin);
    nose.scale.set(1, 0.85, 0.9);
    nose.position.set(0, -0.06, R + 0.005);
    const smile = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.011, 8, 20, Math.PI), mat('#9a4436', 0.5));
    smile.position.set(0, -0.135, R - 0.035);
    smile.rotation.z = Math.PI;
    this.head.add(neck, face, chin, hairCap, back, ...sides, fringe, kipGroup, ...curls, ...ears, ...face2, nose, smile);
    if ((a.glasses ?? 0) > 0) {
      const frame = mat('#1a1a1a', 0.35, { metalness: 0.4 });
      for (const x of [-0.105, 0.105]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.009, 8, 28), frame);
        ring.position.set(x, 0.0, R + 0.02);
        const lens = new THREE.Mesh(new THREE.CircleGeometry(0.072, 24), new THREE.MeshStandardMaterial({ color: '#cfe3ff', transparent: true, opacity: 0.12, roughness: 0.05 }));
        lens.position.set(x, 0.0, R + 0.02);
        this.head.add(ring, lens);
      }
      const bridge = new THREE.Mesh(new THREE.CapsuleGeometry(0.007, 0.05, 4, 6), frame);
      bridge.rotation.z = Math.PI / 2;
      bridge.position.set(0, 0.015, R + 0.025);
      this.head.add(bridge);
      for (const side of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.008, 0.26), frame);
        arm.position.set(side * 0.18, 0.005, R - 0.12);
        this.head.add(arm);
      }
    }

    // ---- school backpack with padded straps over the shoulders
    const pack = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.48, 0.2, 3, 0.06), bag);
    pack.position.set(0, 1.2, -0.33);
    const flap = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.2, 0.05, 2, 0.02), mat(new THREE.Color(BAG_COLORS[a.bag ?? 0] ?? BAG_COLORS[0]).multiplyScalar(0.75).getStyle(), 0.7));
    flap.position.set(0, 1.36, -0.22);
    const frontPocket = new THREE.Mesh(new RoundedBoxGeometry(0.28, 0.18, 0.06, 2, 0.03), bag);
    frontPocket.position.set(0, 1.08, -0.45);
    const straps = new THREE.Group();
    for (const side of [-1, 1]) {
      const over = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.022, 6, 16, Math.PI), bag);
      over.rotation.y = Math.PI / 2;
      over.position.set(side * 0.16, 1.44, -0.05);
      const front = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.36, 0.022, 2, 0.008), bag);
      front.position.set(side * 0.16, 1.27, 0.235);
      front.rotation.x = -0.06;
      straps.add(over, front);
    }
    if (characterId === 'explorer') {
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.16, 10), mat('#333', 0.4, { metalness: 0.5 }));
      lamp.rotation.x = Math.PI / 2;
      lamp.position.set(0, -0.56, 0.08);
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), new THREE.MeshBasicMaterial({ color: '#fff3c4' }));
      glow.position.set(0, -0.56, 0.17);
      this.armR.add(lamp, glow);
    } else if (characterId === 'scholar') {
      const book = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.26, 0.05, 2, 0.01), mat('#5b1f1f', 0.6));
      book.position.set(0, -0.5, 0.1);
      book.rotation.x = 0.3;
      this.armL.add(book);
    } else if (characterId === 'detective') {
      const lens = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 8, 24), mat('#c9a24d', 0.3, { metalness: 0.8 }));
      lens.position.set(0, -0.62, 0.08);
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.1, 8), mat('#3a2414', 0.6));
      handle.position.set(0, -0.53, 0.08);
      this.armR.add(lens, handle);
    } else if (characterId === 'navigator') {
      const map = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.16), mat('#d8be86', 0.9, { side: THREE.DoubleSide }));
      map.position.set(0, -0.58, 0.1);
      map.rotation.x = -0.6;
      this.armL.add(map);
    }

    this.body.add(this.legL, this.legR, hips, torso, belt, buckle, collarL, collarR, placket, buttons, pocket, tzitzit,
      this.armL, this.armR, this.head, pack, flap, frontPocket, straps);
    this.body.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
    });

    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 1.1),
      new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.01;
    this.root.add(this.body, shadow);
    if (nickname) this.setName(nickname);
  }

  setName(nickname: string, highlight = false) {
    if (this.tag) {
      this.root.remove(this.tag);
      (this.tag.material as THREE.SpriteMaterial).map?.dispose();
    }
    const tex = labelTexture(nickname, { bg: highlight ? 'rgba(201,162,77,0.9)' : 'rgba(10,16,32,0.75)', color: highlight ? '#111' : '#f5e6c4' });
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    this.tag.scale.set(1.1, 0.28, 1);
    this.tag.position.y = 2.42;
    this.tag.renderOrder = 10;
    this.root.add(this.tag);
  }

  setConnected(connected: boolean) {
    this.body.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && 'opacity' in m) {
        m.userData['baseOpacity'] ??= m.opacity;
        const base = m.userData['baseOpacity'] as number;
        m.opacity = connected ? base : Math.min(base, 0.35);
        m.transparent = m.opacity < 1;
      }
    });
  }

  private reachUntil = 0;

  /** A short reach forward with the right hand (picking something up, pulling a lever). */
  reach(time: number) {
    this.reachUntil = time + 0.9;
  }

  /** Walk cycle driven by movement speed (m/s). */
  update(dt: number, speed: number, time: number) {
    const moving = speed > 0.15;
    this.phase += dt * (moving ? 9 * Math.min(1.4, speed / 3) : 0);
    const swing = moving ? Math.sin(this.phase) * 0.6 : 0;
    this.legL.rotation.x = THREE.MathUtils.lerp(this.legL.rotation.x, swing, 0.3);
    this.legR.rotation.x = THREE.MathUtils.lerp(this.legR.rotation.x, -swing, 0.3);
    this.armL.rotation.x = THREE.MathUtils.lerp(this.armL.rotation.x, -swing * 0.8, 0.3);
    const reaching = time < this.reachUntil;
    this.armR.rotation.x = THREE.MathUtils.lerp(this.armR.rotation.x, reaching ? -1.35 : swing * 0.8, reaching ? 0.25 : 0.3);
    this.body.position.y = moving ? Math.abs(Math.cos(this.phase)) * 0.05 : Math.sin(time * 2) * 0.008;
    this.head.rotation.z = moving ? 0 : Math.sin(time * 0.8) * 0.03;
    this.head.rotation.y = moving ? 0 : Math.sin(time * 0.37) * 0.12;
  }

  /** Waving/cheering pose used in the finale. */
  cheer(time: number) {
    this.armL.rotation.x = -2.6 + Math.sin(time * 8) * 0.25;
    this.armR.rotation.x = -2.6 + Math.cos(time * 8) * 0.25;
    this.armL.rotation.z = -0.3;
    this.armR.rotation.z = 0.3;
    this.body.position.y = Math.abs(Math.sin(time * 5)) * 0.18;
  }

  setHighlight(on: boolean) {
    if (on && !this.highlight) {
      this.highlight = new THREE.Mesh(
        new THREE.RingGeometry(0.45, 0.55, 32),
        new THREE.MeshBasicMaterial({ color: '#e8c36a', transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
      );
      this.highlight.rotation.x = -Math.PI / 2;
      this.highlight.position.y = 0.02;
      this.root.add(this.highlight);
    } else if (!on && this.highlight) {
      this.root.remove(this.highlight);
      this.highlight = undefined;
    }
  }

  dispose() {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mt = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mt)) mt.forEach((x) => x.dispose());
      else mt?.dispose();
    });
  }
}
