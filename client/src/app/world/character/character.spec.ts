import * as THREE from 'three';
import { CharacterAnimator, LEFT_ARM_FORWARD_LIMIT, buildCharacterClips } from './character-animation';
import { CHARACTER_CONFIG } from './character-config';
import { CharacterAvatar, createPlayerAvatar } from './character-factory';
import { CharacterLoader, CharacterLoadError, REQUIRED_BONES, makeCharacterTemplate } from './character-loader';
import { CHARACTER_STATES, CharacterTemplate } from './character.types';

/** The real delivered model, loaded once for the whole suite (served from public/ by the test builder). */
const loader = new CharacterLoader();
let template: CharacterTemplate;

const bonesOf = (a: CharacterAvatar) => {
  const out: Record<string, THREE.Bone> = {};
  a.modelObject!.traverse((o) => {
    if ((o as THREE.Bone).isBone) out[o.name] = o as THREE.Bone;
  });
  return out;
};
const skinnedOf = (a: CharacterAvatar) => {
  let m: THREE.SkinnedMesh | undefined;
  a.modelObject!.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) m = o as THREE.SkinnedMesh;
  });
  return m!;
};
/** Drives an avatar like the worlds do: speed and facing every frame for `seconds`. */
const run = (a: { update: (dt: number, s: number, t: number) => void; root: THREE.Group }, seconds: number, speed: number, yawRate = 0) => {
  for (let t = 0; t < seconds; t += 1 / 60) {
    a.root.rotation.y += yawRate / 60;
    a.update(1 / 60, speed, t);
  }
};

describe('Player character — model file', () => {
  beforeAll(async () => {
    template = await loader.load();
  }, 30000);

  it('loads the GLB with a skinned mesh, a skeleton and every bone the clips need', () => {
    const skinned: THREE.SkinnedMesh[] = [];
    template.scene.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && skinned.push(o as THREE.SkinnedMesh));
    expect(skinned.length).toBe(1);
    expect(skinned[0].skeleton.bones.length).toBe(26);
    for (const b of REQUIRED_BONES) expect(template.boneNames).toContain(b);
    const mat = skinned[0].material as THREE.MeshStandardMaterial;
    expect(mat.map).toBeTruthy();
    expect(mat.normalMap).toBeTruthy();
  });

  it('stands upright, on the floor, at the game height without stretching', () => {
    // 1.2 tall, ~0.46 wide, ~0.43 deep in file units: upright, not lying down
    expect(template.size.y).toBeCloseTo(1.2, 2);
    expect(template.size.x).toBeLessThan(template.size.y / 2);
    expect(template.size.z).toBeLessThan(template.size.y / 2);
    expect(template.groundOffset).toBeCloseTo(0, 3);
    expect(template.scale * template.size.y).toBeCloseTo(CHARACTER_CONFIG.targetHeight, 3);
    const a = new CharacterAvatar('detective', null, undefined, loader);
    const body = a.modelObject!.parent!;
    expect(body.scale.x).toBe(body.scale.y);
    expect(body.scale.y).toBe(body.scale.z);
    a.dispose();
  });

  it('is fetched only once however many players and games ask for it', async () => {
    const before = loader.loadsStarted;
    const [t1, t2] = await Promise.all([loader.load(), loader.load()]);
    expect(t1).toBe(t2);
    expect(t1).toBe(template);
    for (let i = 0; i < 4; i++) new CharacterAvatar('explorer', null, `p${i}`, loader).dispose();
    expect(loader.loadsStarted).toBe(before);
  });

  it('keeps the file clips (TEST_*) apart and generates one game clip per state', () => {
    expect(template.fileClips.every((c) => c.name.startsWith('TEST_'))).toBeTrue();
    expect([...template.clips.keys()].sort()).toEqual([...CHARACTER_STATES].sort());
    for (const clip of template.clips.values()) {
      expect(clip.validate()).toBeTrue();
      expect(clip.tracks.some((t) => t.name === 'Hips.position')).toBeTrue();
    }
  });
});

describe('Player character — instances', () => {
  beforeAll(async () => {
    template = await loader.load();
  }, 30000);

  it('creates the figure at once when the model is cached', () => {
    const a = new CharacterAvatar('scholar', null, 'דוד', loader);
    expect(a.kind).toBe('model');
    expect(a.animation).toBeTruthy();
    a.dispose();
  });

  it('gives every player its own skeleton, mixer and materials but shares geometry and textures', () => {
    const players = [0, 1, 2, 3].map((i) => new CharacterAvatar('explorer', null, `p${i}`, loader));
    const [a, b] = players;
    const ma = skinnedOf(a), mb = skinnedOf(b);
    expect(ma.skeleton).not.toBe(mb.skeleton);
    expect(bonesOf(a)['Hips']).not.toBe(bonesOf(b)['Hips']);
    expect(a.animation!.mixer).not.toBe(b.animation!.mixer);
    expect(ma.material).not.toBe(mb.material);
    expect(ma.geometry).toBe(mb.geometry);
    expect((ma.material as THREE.MeshStandardMaterial).map).toBe((mb.material as THREE.MeshStandardMaterial).map);
    players.forEach((p) => p.dispose());
  });

  it('animates each player independently (one walks, one stands)', () => {
    const a = new CharacterAvatar('explorer', null, 'a', loader);
    const b = new CharacterAvatar('explorer', null, 'b', loader);
    a.throttleWhenUnseen = b.throttleWhenUnseen = false;
    run(a, 1, CHARACTER_CONFIG.walkSpeed);
    run(b, 1, 0);
    expect(a.animation!.state).toBe('walk');
    expect(b.animation!.state).toBe('idle');
    expect(bonesOf(a)['LeftUpLeg'].quaternion.angleTo(bonesOf(b)['LeftUpLeg'].quaternion)).toBeGreaterThan(0.01);
    a.dispose();
    b.dispose();
  });

  it('fades one player when disconnected without touching the others', () => {
    const a = new CharacterAvatar('explorer', null, 'a', loader);
    const b = new CharacterAvatar('explorer', null, 'b', loader);
    a.setConnected(false);
    expect((skinnedOf(a).material as THREE.Material).opacity).toBeLessThan(1);
    expect((skinnedOf(b).material as THREE.Material).opacity).toBe(1);
    a.setConnected(true);
    expect((skinnedOf(a).material as THREE.Material).opacity).toBe(1);
    a.dispose();
    b.dispose();
  });

  it('throttles animation of players nobody sees', () => {
    const a = new CharacterAvatar('explorer', null, 'a', loader);
    const spy = spyOn(a.animation!, 'update').and.callThrough();
    a.root.visible = false;
    for (let i = 0; i < 60; i++) a.update(1 / 60, 3, i / 60);
    // ~10 updates per second instead of 60
    expect(spy.calls.count()).toBeLessThanOrEqual(11);
    expect(spy.calls.count()).toBeGreaterThanOrEqual(7);
    a.dispose();
  });

  it('releases its own resources on dispose and leaves the shared model usable', () => {
    const a = new CharacterAvatar('explorer', null, 'a', loader);
    a.setHighlight(true);
    const mat = skinnedOf(a).material as THREE.Material;
    const disposed = jasmine.createSpy('dispose');
    mat.addEventListener('dispose', disposed);
    const mixer = a.animation!.mixer;
    spyOn(mixer, 'uncacheRoot').and.callThrough();
    a.dispose();
    expect(disposed).toHaveBeenCalled();
    expect(mixer.uncacheRoot).toHaveBeenCalled();
    expect(a.animation).toBeUndefined();
    // a new player still gets the cached model
    const b = new CharacterAvatar('explorer', null, 'b', loader);
    expect(b.kind).toBe('model');
    b.dispose();
  });

  it('createPlayerAvatar is the shared entry point', () => {
    const a = createPlayerAvatar('navigator', null, 'x');
    expect(a instanceof CharacterAvatar).toBeTrue();
    a.dispose();
  });
});

describe('Player character — animation states', () => {
  beforeAll(async () => {
    template = await loader.load();
  }, 30000);

  const make = () => {
    const a = new CharacterAvatar('explorer', null, undefined, loader);
    a.throttleWhenUnseen = false; // nothing renders in these tests
    return a;
  };

  it('idle → walk → run follows the movement speed of the games', () => {
    const a = make();
    run(a, 0.6, 0);
    expect(a.animation!.state).toBe('idle');
    run(a, 0.8, CHARACTER_CONFIG.walkSpeed);
    expect(a.animation!.state).toBe('walk');
    run(a, 0.8, CHARACTER_CONFIG.runSpeed);
    expect(a.animation!.state).toBe('run');
    a.dispose();
  });

  it('blends walk and run smoothly (no weight jumps between frames)', () => {
    const a = make();
    let prevWalk = 0, prevRun = 0, maxJump = 0;
    for (let i = 0; i < 120; i++) {
      const speed = i < 30 ? 0 : i < 70 ? CHARACTER_CONFIG.walkSpeed : CHARACTER_CONFIG.runSpeed;
      a.update(1 / 60, speed, i / 60);
      const w = a.animation!.weight('walk'), r = a.animation!.weight('run');
      maxJump = Math.max(maxJump, Math.abs(w - prevWalk), Math.abs(r - prevRun));
      prevWalk = w;
      prevRun = r;
    }
    expect(maxJump).toBeLessThan(0.25);
    a.dispose();
  });

  it('plays a stop when the player halts, then settles into idle', () => {
    const a = make();
    run(a, 1, CHARACTER_CONFIG.walkSpeed);
    // the speed eases down for ~0.25 s (deceleration), then the stop plays
    run(a, 0.4, 0);
    expect(a.animation!.weight('stop')).toBeGreaterThan(0.3);
    run(a, 1.5, 0);
    expect(a.animation!.state).toBe('idle');
    a.dispose();
  });

  it('turns on the spot when the facing changes without moving', () => {
    const a = make();
    run(a, 0.6, 0, 4);
    expect(a.animation!.state).toBe('turn');
    a.dispose();
  });

  it('reaches with reach() and cheers with cheer()', () => {
    const a = make();
    run(a, 0.3, 0);
    a.reach(0);
    run(a, 0.35, 0);
    expect(a.animation!.state).toBe('interact');
    run(a, 1.5, 0);
    expect(a.animation!.state).toBe('idle');
    for (let t = 0; t < 0.8; t += 1 / 60) a.cheer(t);
    expect(a.animation!.state).toBe('cheer');
    a.dispose();
  });

  it('keeps the feet on the floor while walking and running', () => {
    const a = make();
    a.root.updateMatrixWorld(true);
    const bones = bonesOf(a);
    const p = new THREE.Vector3();
    for (const speed of [CHARACTER_CONFIG.walkSpeed, CHARACTER_CONFIG.runSpeed]) {
      let lowest = Infinity;
      for (let i = 0; i < 90; i++) {
        a.update(1 / 60, speed, i / 60);
        a.root.updateMatrixWorld(true);
        const y = Math.min(bones['LeftToeBase'].getWorldPosition(p).y, bones['RightToeBase'].getWorldPosition(p).y);
        lowest = Math.min(lowest, y);
      }
      // the toe joints sit ~0.06 above the sole (in game units); never dipping below that means no sinking
      expect(lowest).toBeGreaterThan(0.0);
    }
    a.dispose();
  });

  it('never swings the magnifier arm into the face', () => {
    const clips = template.clips;
    for (const state of ['walk', 'run', 'idle', 'turn', 'stop', 'interact', 'cheer'] as const) {
      const track = clips.get(state)!.tracks.find((t) => t.name === 'LeftArm.quaternion')!;
      const q = new THREE.Quaternion();
      const e = new THREE.Euler();
      for (let i = 0; i < track.values.length; i += 4) {
        e.setFromQuaternion(q.fromArray(track.values, i), 'XYZ');
        expect(e.x).toBeGreaterThanOrEqual(-LEFT_ARM_FORWARD_LIMIT - 1e-3);
        expect(Math.abs(e.z)).toBeLessThan(0.5);
      }
    }
  });

  it('animates remote players from synced positions only (no extra network data)', () => {
    // the worlds ease each remote toward the last SignalR position and derive speed from that motion
    const a = make();
    const pos = new THREE.Vector3();
    let target = new THREE.Vector3();
    for (let i = 0; i < 90; i++) {
      if (i % 6 === 0) target = new THREE.Vector3(0, 0, (i / 60) * CHARACTER_CONFIG.walkSpeed); // ~10 updates/s
      const before = pos.clone();
      pos.lerp(target, Math.min(1, (1 / 60) * 8));
      a.update(1 / 60, before.distanceTo(pos) * 60, i / 60);
    }
    expect(['walk', 'run']).toContain(a.animation!.state);
    for (let i = 0; i < 120; i++) a.update(1 / 60, 0, 2 + i / 60);
    expect(a.animation!.state).toBe('idle');
    a.dispose();
  });

  it('builds clips relative to any rest pose', () => {
    const rest = new Map([['Hips', { quaternion: new THREE.Quaternion(), position: new THREE.Vector3(0, 1, 0) }]]);
    const clips = buildCharacterClips(rest);
    expect(clips.get('walk')!.tracks.map((t) => t.name)).toEqual(['Hips.quaternion', 'Hips.position']);
  });

  it('animator alone: one mixer per root', async () => {
    const { clone } = await import('three/examples/jsm/utils/SkeletonUtils.js');
    const r1 = clone(template.scene), r2 = clone(template.scene);
    const a1 = new CharacterAnimator(r1, template.clips), a2 = new CharacterAnimator(r2, template.clips);
    expect(a1.mixer).not.toBe(a2.mixer);
    a1.dispose();
    a2.dispose();
  });
});

describe('Player character — failures', () => {
  it('rejects a file without a skinned mesh', () => {
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
    expect(() => makeCharacterTemplate('x.glb', scene, [])).toThrowError(CharacterLoadError);
  });

  it('falls back to the previous avatar when the model cannot be loaded, and never blocks the game', async () => {
    const broken = new CharacterLoader(() => Promise.reject(new Error('404')));
    spyOn(console, 'error');
    const a = new CharacterAvatar('explorer', null, 'אורי', broken, 'models/characters/missing.glb');
    expect(a.kind).toBe('loading');
    await broken.load('models/characters/missing.glb').catch(() => undefined);
    await Promise.resolve();
    expect(a.kind).toBe('fallback');
    expect(broken.hasFailed('models/characters/missing.glb')).toBeTrue();
    expect(console.error).toHaveBeenCalled();
    // still a working player figure
    expect(a.root.children.length).toBeGreaterThan(0);
    expect(() => {
      a.update(1 / 60, 3, 0);
      a.reach(0);
      a.cheer(0);
      a.setConnected(false);
      a.setName('אורי', true);
      a.setHighlight(true);
    }).not.toThrow();
    // later players in the same page go straight to the fallback
    const b = new CharacterAvatar('explorer', null, 'b', broken, 'models/characters/missing.glb');
    expect(b.kind).toBe('fallback');
    a.dispose();
    b.dispose();
  });

  it('shows the fallback while a slow model loads, then switches to the model', async () => {
    let resolve!: (v: { scene: THREE.Group; animations: THREE.AnimationClip[] }) => void;
    const real = await loader.load();
    const slow = new CharacterLoader(() => new Promise((r) => (resolve = r)));
    jasmine.clock().install();
    try {
      const a = new CharacterAvatar('explorer', null, 'x', slow, 'slow.glb');
      jasmine.clock().tick(CHARACTER_CONFIG.fallbackAfterMs + 10);
      expect(a.kind).toBe('fallback');
      jasmine.clock().uninstall();
      const { clone } = await import('three/examples/jsm/utils/SkeletonUtils.js');
      resolve({ scene: clone(real.scene) as THREE.Group, animations: [] });
      await slow.load('slow.glb');
      await Promise.resolve();
      expect(a.kind).toBe('model');
      a.dispose();
    } finally {
      jasmine.clock().uninstall();
    }
  });
});
