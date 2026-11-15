import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Appearance, CharacterId } from '../../core/models';
import { BoyAvatar } from '../avatar';
import { blobShadowTexture, labelTexture } from '../textures';
import { CharacterAnimator } from './character-animation';
import { CHARACTER_CONFIG } from './character-config';
import { CharacterLoader, characterLoader } from './character-loader';
import { CharacterTemplate, PlayerAvatar } from './character.types';

/**
 * One player figure built from the shared character model.
 *
 *   root  (world position + facing — owned by the game world)
 *   ├─ body   (facing correction, uniform scale to the game height, lift onto the floor)
 *   │   └─ model clone (own skeleton, own materials, shares geometry + textures with every other player)
 *   ├─ blob shadow, name tag, highlight ring
 *
 * Until the model has loaded the figure shows only its shadow and name; if loading fails (or takes longer than
 * CHARACTER_CONFIG.fallbackAfterMs) it shows the previous procedural avatar, and switches to the model when it arrives.
 */
export class CharacterAvatar implements PlayerAvatar {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private model?: THREE.Object3D;
  private materials: THREE.Material[] = [];
  private animator?: CharacterAnimator;
  private fallback?: BoyAvatar;
  private tag?: THREE.Sprite;
  private shadow: THREE.Mesh;
  private highlight?: THREE.Mesh;
  private nickname?: string;
  private nameHighlight = false;
  private connected = true;
  private highlighted = false;
  private disposed = false;
  private fallbackTimer?: ReturnType<typeof setTimeout>;
  private lastCheer = -1;
  private seen = true;
  private hiddenDt = 0;
  /** Animate at ~10 fps while hidden or off-screen (nobody sees it). Tests without a renderer turn this off. */
  throttleWhenUnseen = true;

  constructor(
    private characterId: CharacterId,
    private appearance: Appearance | null,
    nickname?: string,
    loader: CharacterLoader = characterLoader,
    private url: string = CHARACTER_CONFIG.defaultModel,
  ) {
    this.root.name = 'PlayerCharacter';
    this.body.name = 'CharacterBody';
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 1.1),
      new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.01;
    this.root.add(this.body, this.shadow);
    if (nickname) this.setName(nickname);

    const ready = loader.get(url);
    if (ready) this.useModel(ready);
    else if (loader.hasFailed(url)) this.useFallback();
    else {
      this.fallbackTimer = setTimeout(() => this.useFallback(), CHARACTER_CONFIG.fallbackAfterMs);
      loader.load(url).then(
        (t) => this.useModel(t),
        () => this.useFallback(),
      );
    }
  }

  /** 'model' once the GLB character is shown, 'fallback' while the previous avatar stands in, else 'loading'. */
  get kind(): 'model' | 'fallback' | 'loading' {
    return this.model ? 'model' : this.fallback ? 'fallback' : 'loading';
  }

  /** The animation state machine (undefined until the model is shown). */
  get animation() {
    return this.animator;
  }

  get modelObject() {
    return this.model;
  }

  private useModel(t: CharacterTemplate) {
    if (this.disposed || this.model) return;
    clearTimeout(this.fallbackTimer);
    if (this.fallback) {
      this.root.remove(this.fallback.root);
      this.fallback.dispose();
      this.fallback = undefined;
      this.shadow.visible = true;
      this.applyName();
      this.applyHighlight();
    }
    const model = cloneSkinned(t.scene);
    model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      // own material per player (connection fading must not affect the others); textures stay shared
      m.material = Array.isArray(m.material) ? m.material.map((x) => this.ownMaterial(x)) : this.ownMaterial(m.material);
      m.castShadow = true;
      // remember whether the figure was drawn, so hidden / off-screen players can skip most animation work
      m.onBeforeRender = () => {
        this.seen = true;
      };
    });
    this.body.rotation.y = CHARACTER_CONFIG.facingOffset;
    this.body.scale.setScalar(t.scale);
    this.body.position.y = t.groundOffset * t.scale;
    this.body.add(model);
    this.model = model;
    this.animator = new CharacterAnimator(model, t.clips);
    this.animator.update(0, 0, this.root.rotation.y);
    this.applyConnected();
  }

  private ownMaterial(m: THREE.Material) {
    const c = m.clone();
    this.materials.push(c);
    return c;
  }

  private useFallback() {
    if (this.disposed || this.model || this.fallback) return;
    clearTimeout(this.fallbackTimer);
    this.fallback = new BoyAvatar(this.characterId, this.appearance, this.nickname);
    if (this.nickname) this.fallback.setName(this.nickname, this.nameHighlight);
    this.fallback.setConnected(this.connected);
    this.fallback.setHighlight(this.highlighted);
    // the previous avatar brings its own shadow, tag and ring
    this.shadow.visible = false;
    this.removeTag();
    this.removeHighlight();
    this.root.add(this.fallback.root);
  }

  setName(nickname: string, highlight = false) {
    this.nickname = nickname;
    this.nameHighlight = highlight;
    if (this.fallback) this.fallback.setName(nickname, highlight);
    else this.applyName();
  }

  private applyName() {
    this.removeTag();
    if (!this.nickname) return;
    const h = this.nameHighlight;
    const tex = labelTexture(this.nickname, { bg: h ? 'rgba(201,162,77,0.9)' : 'rgba(10,16,32,0.75)', color: h ? '#111' : '#f5e6c4' });
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    this.tag.scale.set(1.1, 0.28, 1);
    this.tag.position.y = CHARACTER_CONFIG.nameTagHeight;
    this.tag.renderOrder = 10;
    this.root.add(this.tag);
  }

  private removeTag() {
    if (!this.tag) return;
    this.root.remove(this.tag);
    const m = this.tag.material as THREE.SpriteMaterial;
    m.map?.dispose();
    m.dispose();
    this.tag = undefined;
  }

  setConnected(connected: boolean) {
    this.connected = connected;
    if (this.fallback) this.fallback.setConnected(connected);
    else this.applyConnected();
  }

  private applyConnected() {
    for (const m of this.materials) {
      m.opacity = this.connected ? 1 : 0.35;
      m.transparent = !this.connected;
      m.depthWrite = this.connected;
      m.needsUpdate = true;
    }
  }

  reach(time: number) {
    if (this.fallback) this.fallback.reach(time);
    else this.animator?.interact();
  }

  update(dt: number, speed: number, time: number) {
    if (this.fallback) return this.fallback.update(dt, speed, time);
    if (!this.animator) return;
    // hidden or off-screen (not drawn last frame): animate at ~10 fps only, nobody sees it
    if (this.throttleWhenUnseen && (!this.root.visible || !this.seen)) {
      this.hiddenDt += dt;
      if (this.hiddenDt < 0.1) return;
      dt = this.hiddenDt;
    }
    this.hiddenDt = 0;
    this.seen = false;
    this.animator.update(dt, speed, this.root.rotation.y);
  }

  cheer(time: number) {
    if (this.fallback) return this.fallback.cheer(time);
    if (!this.animator) return;
    const dt = this.lastCheer < 0 ? 0.016 : THREE.MathUtils.clamp(time - this.lastCheer, 0, 0.1);
    this.lastCheer = time;
    this.animator.cheer();
    this.animator.update(dt, 0, this.root.rotation.y);
  }

  setHighlight(on: boolean) {
    this.highlighted = on;
    if (this.fallback) this.fallback.setHighlight(on);
    else this.applyHighlight();
  }

  private applyHighlight() {
    if (this.highlighted && !this.highlight) {
      this.highlight = new THREE.Mesh(
        new THREE.RingGeometry(0.45, 0.55, 32),
        new THREE.MeshBasicMaterial({ color: '#e8c36a', transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
      );
      this.highlight.rotation.x = -Math.PI / 2;
      this.highlight.position.y = 0.02;
      this.root.add(this.highlight);
    } else if (!this.highlighted) this.removeHighlight();
  }

  private removeHighlight() {
    if (!this.highlight) return;
    this.root.remove(this.highlight);
    this.highlight.geometry.dispose();
    (this.highlight.material as THREE.Material).dispose();
    this.highlight = undefined;
  }

  /** Frees this player's own resources. The shared geometry and textures stay cached for the next figure. */
  dispose() {
    this.disposed = true;
    clearTimeout(this.fallbackTimer);
    this.animator?.dispose();
    this.animator = undefined;
    for (const m of this.materials) m.dispose();
    this.materials = [];
    if (this.model) this.body.remove(this.model);
    this.model = undefined;
    this.fallback?.dispose();
    this.fallback = undefined;
    this.removeTag();
    this.removeHighlight();
    this.shadow.geometry.dispose();
    (this.shadow.material as THREE.Material).dispose();
  }
}

/** The single entry point every game uses to create a player figure (local and remote players alike). */
export function createPlayerAvatar(characterId: CharacterId, appearance: Appearance | null, nickname?: string): PlayerAvatar {
  return new CharacterAvatar(characterId, appearance, nickname);
}
