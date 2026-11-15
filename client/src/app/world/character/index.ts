// Shared player character: the only API the games, the gallery and the join preview use.
export { CHARACTER_CONFIG } from './character-config';
export { CharacterAvatar, createPlayerAvatar } from './character-factory';
export { characterLoader, preloadPlayerCharacter } from './character-loader';
export type { PlayerAvatar } from './character.types';
