import * as THREE from 'three';
import { CHARACTER_CONFIG } from './character-config';
import { CHARACTER_STATES, CharacterState } from './character.types';

/**
 * Game animations for the shared character, generated as regular THREE.AnimationClips.
 *
 * The delivered GLB only has four TEST_* clips (head, arms, knees, blink) — there is no idle, walk or run, so the
 * clips below are built from the skeleton. Its bones are a standard humanoid chain whose rest rotations are identity
 * (local axes = model axes: +X the character's left, +Y up, +Z forward), so every pose is a small Euler rotation on
 * top of the rest pose.
 *
 * Known limits of the prototype rig (from the delivery notes), respected here on purpose:
 * - the right hand is a separate piece at the wrist: the hand bones are never rotated relative to the forearm,
 *   so the seam cannot open;
 * - no finger joints, so the hands keep their modelled grip (magnifying glass stays in the right hand);
 * - the rest pose is not A/T-pose (elbows bent, hands in front of the chest): arm motion stays close to it, and the
 *   cheer pose raises the arms only part way;
 * - facial morphs are approximate: they are removed from the web copy, nothing animates the face.
 */

type Euler3 = [number, number, number];
type Pose = { rot: Record<string, Euler3>; hips?: [number, number, number] };

const TAU = Math.PI * 2;
/**
 * Measured on the dev page: past ~0.15 rad forward the magnifier (left hand) reaches the face, and raising either
 * upper arm sideways (Z) by more than ~0.5 rad tears the separate magnifier from the hand and bulges the shirt —
 * so no clip uses large arm abduction.
 */
export const LEFT_ARM_FORWARD_LIMIT = 0.12;
const pos = (x: number) => Math.max(0, x);

/** Distance (world units) covered by one full walk / run cycle (two steps); keeps the feet from sliding. */
export const WALK_CYCLE_LENGTH = 3.0;
export const RUN_CYCLE_LENGTH = 4.2;

/** Bones every generated clip drives. A model missing one of them still works; that bone just stays at rest. */
export const ANIMATED_BONES = [
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'RightShoulder', 'RightArm', 'RightForeArm',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
] as const;

// ------------------------------------------------------------------------------------------- poses (phase 0..1)

function gait(p: number, run: boolean): Pose {
  const s = Math.sin(p * TAU);
  const c = Math.cos(p * TAU);
  const A = run ? 0.62 : 0.4; // thigh swing
  const K = run ? 1.15 : 0.85; // knee lift during swing
  const B = run ? 0.42 : 0.2; // arm swing
  const thighL = -A * s;
  const thighR = A * s;
  // the knee bends while the leg travels forward (left: c > 0); the stance knee stays slightly soft
  const kneeL = 0.08 + K * Math.pow(pos(c), 1.6) + (run ? 0.25 : 0) * pos(-c);
  const kneeR = 0.08 + K * Math.pow(pos(-c), 1.6) + (run ? 0.25 : 0) * pos(c);
  // feet stay nearly level with the floor: undo most of thigh + knee, a little toe-off behind
  const footL = -(thighL + kneeL) * 0.82 + (thighL > 0 ? 0.12 * thighL : 0);
  const footR = -(thighR + kneeR) * 0.82 + (thighR > 0 ? 0.12 * thighR : 0);
  // hips drop as the legs spread (keeps the front heel on the ground), run adds a lift at mid-stride
  const legLen = 0.6;
  const drop = legLen * (1 - Math.cos(A * s)) * (run ? 0.55 : 0.95);
  const bounce = run ? 0.03 * Math.abs(c) - 0.035 : -0.006;
  const lean = run ? 0.16 : 0.045;
  return {
    hips: [0, bounce - drop, 0],
    rot: {
      Hips: [0, -0.07 * s, 0.025 * c],
      Spine: [lean * 0.4, 0.04 * s, 0],
      Spine1: [lean * 0.35, 0.035 * s, -0.012 * c],
      Spine2: [lean * 0.25, 0.04 * s, 0],
      Neck: [-lean * 0.45, -0.03 * s, 0],
      Head: [-lean * 0.35 + 0.015 * Math.abs(c), -0.02 * s, -0.01 * c],
      LeftUpLeg: [thighL, 0, 0],
      RightUpLeg: [thighR, 0, 0],
      LeftLeg: [kneeL, 0, 0],
      RightLeg: [kneeR, 0, 0],
      LeftFoot: [footL, 0, 0],
      RightFoot: [footR, 0, 0],
      LeftToeBase: [thighL > 0.1 ? -0.25 * thighL : 0, 0, 0],
      RightToeBase: [thighR > 0.1 ? -0.25 * thighR : 0, 0, 0],
      // arms swing opposite to the legs, close to the modelled (bent) rest pose. The left hand holds the magnifier
      // in front of the face: its forward swing is capped so the glass never passes through the head.
      LeftArm: [Math.max(B * s, -LEFT_ARM_FORWARD_LIMIT), 0, 0.04],
      RightArm: [Math.max(-B * s, -0.3), 0, -0.04],
      LeftForeArm: [run ? -0.15 + 0.12 * s : 0.05 * s, 0, 0],
      RightForeArm: [run ? -0.15 - 0.12 * s : -0.05 * s, 0, 0],
      LeftShoulder: [0, 0, 0.015 * s],
      RightShoulder: [0, 0, 0.015 * s],
    },
  };
}

function idle(p: number): Pose {
  const b = Math.sin(p * TAU * 2); // breathing, two breaths per loop
  const look = Math.sin(p * TAU); // slow look around
  return {
    hips: [0, -0.004 + 0.002 * b, 0],
    rot: {
      Hips: [0, 0.02 * look, 0.006 * look],
      Spine: [0.006 * b, 0, 0],
      Spine1: [-0.012 * b, 0, -0.004 * look],
      Spine2: [-0.01 * b, 0, 0],
      Neck: [0.01 * b, 0.05 * look, 0],
      Head: [0.008 * Math.sin(p * TAU * 3), 0.09 * look, 0.02 * Math.sin(p * TAU + 1)],
      LeftShoulder: [0, 0, -0.012 * b],
      RightShoulder: [0, 0, 0.012 * b],
      LeftArm: [0.02 * b, 0, 0.03],
      RightArm: [0.02 * b, 0, -0.03],
      LeftUpLeg: [0, 0, 0.01],
      RightUpLeg: [0, 0, -0.01],
      LeftLeg: [0.05, 0, 0],
      RightLeg: [0.05, 0, 0],
      LeftFoot: [-0.05, 0, 0],
      RightFoot: [-0.05, 0, 0],
    },
  };
}

/** Turning on the spot: small alternating steps, the upper body leads the turn. */
function turn(p: number): Pose {
  const s = Math.sin(p * TAU);
  const c = Math.cos(p * TAU);
  const liftL = 0.35 * pos(c);
  const liftR = 0.35 * pos(-c);
  return {
    hips: [0, -0.01, 0],
    rot: {
      Hips: [0, 0.03 * s, 0.015 * c],
      Spine1: [0.02, 0.05, 0],
      Neck: [0, 0.06, 0],
      Head: [0, 0.08, 0],
      LeftUpLeg: [-0.12 * s - liftL * 0.5, 0, 0.03],
      RightUpLeg: [0.12 * s - liftR * 0.5, 0, -0.03],
      LeftLeg: [0.06 + liftL, 0, 0],
      RightLeg: [0.06 + liftR, 0, 0],
      LeftFoot: [-(0.06 + liftL * 0.5), 0, 0],
      RightFoot: [-(0.06 + liftR * 0.5), 0, 0],
      LeftArm: [0.06 * s, 0, 0.04],
      RightArm: [-0.06 * s, 0, -0.04],
    },
  };
}

/** Coming to a halt (plays once): the body settles back over the feet and ends in the idle stance. */
function stop(p: number): Pose {
  const k = Math.sin(Math.min(1, p) * Math.PI) * (1 - p * 0.3); // 0 → peak → 0
  return {
    hips: [0, -0.004 - 0.022 * k, 0],
    rot: {
      Spine: [-0.05 * k, 0, 0],
      Spine1: [-0.04 * k, 0, 0],
      Neck: [0.04 * k, 0, 0],
      Head: [0.03 * k, 0, 0],
      LeftUpLeg: [-0.12 * k, 0, 0.01],
      RightUpLeg: [0.08 * k, 0, -0.01],
      LeftLeg: [0.05 + 0.18 * k, 0, 0],
      RightLeg: [0.05 + 0.1 * k, 0, 0],
      LeftFoot: [-0.05 - 0.06 * k, 0, 0],
      RightFoot: [-0.05 - 0.18 * k, 0, 0],
      LeftArm: [-0.12 * k, 0, 0.03],
      RightArm: [-0.08 * k, 0, -0.03],
    },
  };
}

/** Reaching forward with the free right hand (plays once); the left hand keeps the magnifier. */
function interact(p: number): Pose {
  const k = THREE.MathUtils.smoothstep(p, 0, 0.35) * (1 - THREE.MathUtils.smoothstep(p, 0.62, 1));
  return {
    hips: [0, -0.004 - 0.012 * k, 0],
    rot: {
      Spine: [0.03 * k, 0, 0],
      Spine1: [0.06 * k, -0.05 * k, 0],
      Spine2: [0.03 * k, -0.04 * k, 0],
      Head: [0.1 * k, -0.05 * k, 0],
      RightArm: [-0.45 * k, 0, -0.04 - 0.11 * k],
      RightForeArm: [1.25 * k, 0, 0],
      LeftArm: [0.06 * k, 0, 0.03],
      LeftLeg: [0.05 + 0.06 * k, 0, 0],
      RightLeg: [0.05 + 0.06 * k, 0, 0],
      LeftFoot: [-0.05 - 0.04 * k, 0, 0],
      RightFoot: [-0.05 - 0.04 * k, 0, 0],
    },
  };
}

/**
 * Celebrating at the finale (loops): little hops while the free right hand waves; the head lifts. The arms stay
 * near the rest pose on purpose (see LEFT_ARM_FORWARD_LIMIT).
 */
function cheer(p: number): Pose {
  const s = Math.sin(p * TAU);
  const hop = Math.abs(Math.sin(p * TAU));
  const land = 1 - hop;
  return {
    hips: [0, 0.07 * hop - 0.03 * land, 0],
    rot: {
      Spine: [-0.05, 0, 0],
      Spine1: [-0.04, 0.04 * s, 0.02 * s],
      Neck: [-0.06, 0, 0],
      Head: [-0.12, 0.06 * s, 0.03 * s],
      RightArm: [-0.3, 0, -0.55 - 0.15 * s],
      RightForeArm: [0.35 + 0.15 * s, 0, 0.25 + 0.2 * s],
      LeftArm: [-0.06, 0, 0.04],
      LeftUpLeg: [-0.12 * land, 0, 0.03],
      RightUpLeg: [-0.12 * land, 0, -0.03],
      LeftLeg: [0.06 + 0.3 * land, 0, 0],
      RightLeg: [0.06 + 0.3 * land, 0, 0],
      LeftFoot: [-0.06 - 0.18 * land + 0.25 * hop, 0, 0],
      RightFoot: [-0.06 - 0.18 * land + 0.25 * hop, 0, 0],
    },
  };
}

const CLIP_DEFS: Record<CharacterState, { duration: number; frames: number; pose: (p: number) => Pose; loop: boolean }> = {
  idle: { duration: 6.4, frames: 64, pose: idle, loop: true },
  walk: { duration: 1, frames: 32, pose: (p) => gait(p, false), loop: true },
  run: { duration: 1, frames: 32, pose: (p) => gait(p, true), loop: true },
  turn: { duration: 0.7, frames: 20, pose: turn, loop: true },
  stop: { duration: 0.45, frames: 14, pose: stop, loop: false },
  interact: { duration: 0.9, frames: 24, pose: interact, loop: false },
  cheer: { duration: 0.8, frames: 24, pose: cheer, loop: true },
};

/**
 * Builds one AnimationClip per CharacterState for a skeleton. `rest` holds each bone's rest quaternion and the hips
 * rest position (model units) so the clips are relative to this particular model.
 */
export function buildCharacterClips(rest: Map<string, { quaternion: THREE.Quaternion; position: THREE.Vector3 }>): Map<CharacterState, THREE.AnimationClip> {
  const clips = new Map<CharacterState, THREE.AnimationClip>();
  const e = new THREE.Euler();
  const q = new THREE.Quaternion();
  for (const state of CHARACTER_STATES) {
    const def = CLIP_DEFS[state];
    const n = def.frames;
    const times = new Float32Array(n + 1);
    const quats = new Map<string, Float32Array>();
    const hipsPos = new Float32Array((n + 1) * 3);
    const bones = ANIMATED_BONES.filter((b) => rest.has(b));
    for (const b of bones) quats.set(b, new Float32Array((n + 1) * 4));
    for (let i = 0; i <= n; i++) {
      // looping clips end exactly where they start; one-shots end on their last pose
      const p = i / n;
      times[i] = p * def.duration;
      const pose = def.pose(def.loop ? p % 1 : p);
      for (const b of bones) {
        const r = pose.rot[b] ?? [0, 0, 0];
        q.setFromEuler(e.set(r[0], r[1], r[2], 'XYZ'));
        q.premultiply(rest.get(b)!.quaternion);
        q.toArray(quats.get(b)!, i * 4);
      }
      const hr = rest.get('Hips')?.position;
      const h = pose.hips ?? [0, 0, 0];
      if (hr) hipsPos.set([hr.x + h[0], hr.y + h[1], hr.z + h[2]], i * 3);
    }
    const tracks: THREE.KeyframeTrack[] = bones.map((b) => new THREE.QuaternionKeyframeTrack(`${b}.quaternion`, times, quats.get(b)!));
    if (rest.has('Hips')) tracks.push(new THREE.VectorKeyframeTrack('Hips.position', times, hipsPos));
    clips.set(state, new THREE.AnimationClip(state, def.duration, tracks));
  }
  return clips;
}

// ------------------------------------------------------------------------------------------------- the animator

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Per-instance animation state machine: one AnimationMixer per player (never shared). Reads only what the game
 * already has — ground speed and facing — so remote players animate from the positions SignalR already syncs.
 *
 * Walk and run are phase-locked and driven by distance travelled, so the feet do not slide at any speed; the other
 * states blend in and out with short cross-fades.
 */
export class CharacterAnimator {
  readonly mixer: THREE.AnimationMixer;
  private actions = new Map<CharacterState, THREE.AnimationAction>();
  private weights = new Map<CharacterState, number>();
  private phase = 0;
  private turnPhase = 0;
  private speed = 0;
  private yawRate = 0;
  private lastYaw: number | null = null;
  private wasMoving = false;
  private cheerHold = 0;
  private forced: CharacterState | null = null;
  /** The state with the largest weight after the last update (for tests and the dev page). */
  state: CharacterState = 'idle';

  constructor(root: THREE.Object3D, clips: Map<CharacterState, THREE.AnimationClip>) {
    this.mixer = new THREE.AnimationMixer(root);
    for (const [state, clip] of clips) {
      const a = this.mixer.clipAction(clip);
      const once = state === 'stop' || state === 'interact';
      a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
      a.clampWhenFinished = once;
      // walk / run / turn are positioned by hand (phase), the rest play in real time
      if (state === 'walk' || state === 'run' || state === 'turn') a.timeScale = 0;
      a.setEffectiveWeight(state === 'idle' ? 1 : 0);
      a.play();
      if (once) a.paused = true;
      this.actions.set(state, a);
      this.weights.set(state, state === 'idle' ? 1 : 0);
    }
  }

  /** Short reach with the right hand. */
  interact() {
    this.trigger('interact');
  }

  /** Keep the cheer pose for the next frames (call every frame while celebrating). */
  cheer() {
    this.cheerHold = 0.25;
  }

  /** Dev page: hold one state regardless of movement (null = back to automatic). */
  force(state: CharacterState | null) {
    this.forced = state;
    if (state === 'stop' || state === 'interact') this.trigger(state);
  }

  private trigger(state: 'stop' | 'interact') {
    const a = this.actions.get(state);
    if (!a) return;
    a.reset();
    a.paused = false;
    a.play();
  }

  private running(state: 'stop' | 'interact') {
    const a = this.actions.get(state);
    return !!a && !a.paused && a.isRunning() && a.time < a.getClip().duration;
  }

  /**
   * @param speed ground speed in units/s (as the games already compute it)
   * @param yaw   current facing (root.rotation.y), used to detect turning on the spot
   */
  update(dt: number, speed: number, yaw: number) {
    dt = Math.min(dt, 0.1);
    this.speed += (speed - this.speed) * Math.min(1, dt * 10);
    if (this.lastYaw !== null && dt > 0) {
      const r = wrap(yaw - this.lastYaw) / dt;
      this.yawRate += (r - this.yawRate) * Math.min(1, dt * 10);
    }
    this.lastYaw = yaw;
    this.cheerHold = Math.max(0, this.cheerHold - dt);

    const { walkSpeed, runSpeed } = CHARACTER_CONFIG;
    let s = this.forced === 'walk' ? walkSpeed : this.forced === 'run' ? runSpeed : this.speed;
    if (this.forced && this.forced !== 'walk' && this.forced !== 'run') s = 0;
    const moving = s > 0.25;
    if (this.wasMoving && !moving && this.speed < 0.6 && !this.forced) this.trigger('stop');
    this.wasMoving = moving ? s > 1.2 || this.wasMoving : false;

    const target = new Map<CharacterState, number>(CHARACTER_STATES.map((st) => [st, 0]));
    const cheering = this.cheerHold > 0 || this.forced === 'cheer';
    const turning = !moving && (Math.abs(this.yawRate) > 1.6 || this.forced === 'turn');
    if (cheering) target.set('cheer', 1);
    else if (moving) {
      const k = THREE.MathUtils.clamp((s - walkSpeed) / (runSpeed - walkSpeed), 0, 1);
      const amount = THREE.MathUtils.clamp(s / 0.9, 0, 1);
      target.set('walk', amount * (1 - k));
      target.set('run', amount * k);
      target.set('idle', 1 - amount);
      this.phase = (this.phase + (s * dt) / THREE.MathUtils.lerp(WALK_CYCLE_LENGTH, RUN_CYCLE_LENGTH, k)) % 1;
    } else if (turning) {
      target.set('turn', 1);
      this.turnPhase = (this.turnPhase + dt * THREE.MathUtils.clamp(Math.abs(this.yawRate) * 0.35, 0.9, 1.8)) % 1;
    } else target.set('idle', 1);
    // one-shots sit on top of the base layer while they play
    if (this.running('stop') && !cheering && !moving) {
      target.set('stop', 1);
      target.set('idle', 0.35);
      target.set('turn', 0);
    }
    if (this.running('interact')) {
      // standing: the reach replaces the base pose (a 50/50 average would half-cancel arm and forearm);
      // walking: the legs keep walking and the reach shares the upper body
      target.set('interact', 1);
      if (!moving) for (const st of ['idle', 'turn', 'stop'] as const) target.set(st, target.get(st)! * 0.1);
    }

    // cross-fade: every weight eases to its target (~0.15 s); fast in, slightly slower out
    for (const st of CHARACTER_STATES) {
      const a = this.actions.get(st);
      if (!a) continue;
      const w = this.weights.get(st)!;
      const t = target.get(st)!;
      const rate = t > w ? 12 : 8;
      const nw = Math.abs(t - w) < 0.002 ? t : w + (t - w) * Math.min(1, dt * rate);
      this.weights.set(st, nw);
      a.setEffectiveWeight(nw);
    }
    const walk = this.actions.get('walk');
    const run = this.actions.get('run');
    const tr = this.actions.get('turn');
    if (walk) walk.time = this.phase * walk.getClip().duration;
    if (run) run.time = this.phase * run.getClip().duration;
    if (tr) tr.time = this.turnPhase * tr.getClip().duration;

    let best: CharacterState = 'idle';
    for (const st of CHARACTER_STATES) if ((this.weights.get(st) ?? 0) > (this.weights.get(best) ?? 0)) best = st;
    this.state = best;
    this.mixer.update(dt);
  }

  weight(state: CharacterState) {
    return this.weights.get(state) ?? 0;
  }

  dispose() {
    this.mixer.stopAllAction();
    for (const a of this.actions.values()) this.mixer.uncacheAction(a.getClip());
    this.mixer.uncacheRoot(this.mixer.getRoot());
    this.actions.clear();
  }
}
