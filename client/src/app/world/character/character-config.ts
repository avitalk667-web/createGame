/**
 * The one place that decides which 3D model every PORTAL X player uses (all games, the gallery and the join preview).
 * To swap the character later: put the new .glb in public/models/characters/, point `defaultModel` at it and bump
 * `modelVersion` (cache busting). Bone names and the rest pose are read from the file; see character-animation.ts
 * for the bones the generated clips expect.
 */
export const CHARACTER_CONFIG = {
  /** Web copy built by tools/character/optimize-glb.mjs from PORTAL-X_detective_LOCAL_RIG_V2.glb. */
  defaultModel: 'models/characters/portal-x-detective.glb',
  modelVersion: 1,
  /** World height of the character, matching the previous in-game avatar (≈2.2–2.25 units incl. kippah). */
  targetHeight: 2.2,
  /** Extra yaw for models that do not face +Z (glTF forward). The detective faces +Z. */
  facingOffset: 0,
  /** Height of the floating name tag above the feet. */
  nameTagHeight: 2.42,
  /** If the model is still loading after this long, show the previous avatar until it arrives. */
  fallbackAfterMs: 4000,
  /** Movement speeds of the games (units/s): walking and running with Shift. Used to blend walk ↔ run. */
  walkSpeed: 3.4,
  runSpeed: 5.5,
} as const;

export const characterModelUrl = (url: string = CHARACTER_CONFIG.defaultModel) => `${url}?v=${CHARACTER_CONFIG.modelVersion}`;
