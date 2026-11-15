import type * as THREE from 'three';

/**
 * What a game world needs from a player figure. Both the GLB character and the previous procedural avatar
 * (kept as the fallback) implement it, so the worlds never care which one they got.
 *
 * The world owns `root.position` and `root.rotation.y` (movement, collision, network sync); the figure only animates
 * inside it from the movement state it is given.
 */
export interface PlayerAvatar {
  readonly root: THREE.Group;
  setName(nickname: string, highlight?: boolean): void;
  setConnected(connected: boolean): void;
  /** A short reach forward (picking something up, pulling a lever). `time` is the world clock in seconds. */
  reach(time: number): void;
  /** Called every frame with the current ground speed (units/s). */
  update(dt: number, speed: number, time: number): void;
  /** Cheering pose for the finale; called every frame instead of update(). */
  cheer(time: number): void;
  setHighlight(on: boolean): void;
  dispose(): void;
}

/** Animation states of the shared character. Jump is not used: no PORTAL X game has jumping. */
export type CharacterState = 'idle' | 'walk' | 'run' | 'turn' | 'stop' | 'interact' | 'cheer';

export const CHARACTER_STATES: CharacterState[] = ['idle', 'walk', 'run', 'turn', 'stop', 'interact', 'cheer'];

/** A loaded, validated character model, shared by every instance (geometry, textures, material template). */
export interface CharacterTemplate {
  url: string;
  scene: THREE.Group;
  /** Uniform scale that brings the model to CHARACTER_CONFIG.targetHeight. */
  scale: number;
  /** Lift that puts the lowest point of the feet on y = 0 (model units, before scale). */
  groundOffset: number;
  /** Measured model size before scaling. */
  size: THREE.Vector3;
  boneNames: string[];
  /** Clips stored in the file (the delivered file has TEST_* clips only; the game uses generated clips). */
  fileClips: THREE.AnimationClip[];
  /** Clips generated for the game, one per CharacterState. */
  clips: Map<CharacterState, THREE.AnimationClip>;
}
