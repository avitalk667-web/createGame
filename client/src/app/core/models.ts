// Shapes shared with the ASP.NET Core server (camelCase JSON).

export type Phase = 'lobby' | 'intro' | 'playing' | 'completed';
export type PuzzleStatus = 'locked' | 'active' | 'solved';

export interface Appearance {
  skin?: number;
  hair?: number;
  glasses?: number;
  bag?: number;
}

export interface PlayerDto {
  id: string;
  nickname: string;
  characterId: CharacterId;
  appearance: Appearance | null;
  seat: number;
  isReady: boolean;
  isConnected: boolean;
  isHost: boolean;
}

export interface PuzzleStateDto {
  id: string;
  status: PuzzleStatus;
  attempts: number;
  hintsRevealed: number;
  hints: string[];
  cooldownUntil?: string;
  solvedBy?: string;
  solvedAt?: string;
}

export interface GoldenLetter {
  letter: string;
  zone: string;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
}

export interface ResultDto {
  durationSeconds: number;
  playersCount: number;
  hintsUsed: number;
  wrongAttempts: number;
  puzzlesSolved: number;
  puzzlesTotal: number;
  achievements: Achievement[];
}

export interface RoomSnapshot {
  roomId: string;
  code: string;
  scenarioId: string;
  phase: Phase;
  round: number;
  hostPlayerId?: string;
  players: PlayerDto[];
  minPlayers: number;
  maxPlayers: number;
  startBlocker?: string;
  introStartedAt?: string;
  startedAt?: string;
  endedAt?: string;
  serverNow: string;
  introSeconds: number;
  unlockedZones: string[];
  puzzles: PuzzleStateDto[];
  inventory: string[];
  worldItems: string[];
  placedItems: string[];
  letters: GoldenLetter[];
  result?: ResultDto;
  /** Room the whole group belongs in — decided by the server. */
  activeZone: string;
  /** When the server unlocked it; clients move the group at activeZoneSince + transitionDelayMs. */
  activeZoneSince?: string;
  transitionDelayMs: number;
}

export interface HubResult<T = any> {
  ok: boolean;
  code: string;
  message: string;
  data?: T;
  snapshot?: RoomSnapshot;
}

export interface GameNotice {
  kind: string;
  message: string;
  playerId?: string;
  puzzleId?: string;
  voiceLine?: string;
  itemId?: string;
  zone?: string;
}

export interface ChatMessage {
  id: string;
  playerId: string;
  nickname: string;
  text?: string;
  emote?: string;
  at: string;
}

export interface RemotePosition {
  x: number;
  y: number;
  z: number;
  ry: number;
  zone: string;
}

// ---- scenario content (public, no solutions) ----

export interface ZoneContent {
  id: string;
  name: string;
  order: number;
  icon: string;
  entryLine: string;
}

export interface ItemContent {
  id: string;
  name: string;
  description: string;
  zone: string;
  spawnedAtStart: boolean;
}

export interface PuzzleContent {
  id: string;
  order: number;
  type: 'cipher' | 'sequence' | 'sound' | 'split' | 'items' | 'final';
  zone: string;
  title: string;
  objective: string;
  instructions: string;
  publicData: any;
  success: string;
  failure: string;
  rewardLetter?: string;
  rewardItem?: string;
  unlocksZone?: string;
}

export interface ScenarioContent {
  id: string;
  name: string;
  tagline: string;
  description: string;
  durationMinutes: string;
  difficulty: string;
  minPlayers: number;
  maxPlayers: number;
  zones: ZoneContent[];
  items: ItemContent[];
  recipes: { inputs: string[]; output: string; message: string }[];
  puzzles: PuzzleContent[];
  achievements: Achievement[];
}

export interface ScenarioSummary {
  id: string;
  name: string;
  tagline: string;
  description: string;
  durationMinutes: string;
  difficulty: string;
  minPlayers: number;
  maxPlayers: number;
}

export type CharacterId = 'explorer' | 'scholar' | 'navigator' | 'detective';

export interface CharacterInfo {
  id: CharacterId;
  name: string;
  tagline: string;
  image: string;
  icon: string;
  defaults: Required<Appearance>;
}

/** Character roster from the visual addendum: boys only, kippah, white shirt, black trousers. */
export const CHARACTERS: CharacterInfo[] = [
  { id: 'explorer', name: 'החוקר', tagline: 'מגלה רמזים חבויים', image: 'img/char-explorer.jpg', icon: 'compass', defaults: { skin: 0, hair: 0, glasses: 0, bag: 0 } },
  { id: 'scholar', name: 'המלומד', tagline: 'מפענח כתבי סתרים', image: 'img/char-scholar.jpg', icon: 'book', defaults: { skin: 1, hair: 1, glasses: 1, bag: 1 } },
  { id: 'navigator', name: 'הנווט', tagline: 'מוצא את הדרך הנכונה', image: 'img/char-navigator.jpg', icon: 'map', defaults: { skin: 2, hair: 0, glasses: 0, bag: 2 } },
  { id: 'detective', name: 'הבלש', tagline: 'שם לב לפרטים הקטנים', image: 'img/char-detective.jpg', icon: 'magnifier', defaults: { skin: 0, hair: 2, glasses: 1, bag: 3 } },
];

export const characterInfo = (id: string | undefined) => CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];

/** A purchasable game from the shared catalog (/api/products). The price always comes from the server. */
export interface Product {
  id: string;
  name: string;
  tagline: string;
  description: string;
  price?: number | null;
  currency: string;
  coverImage: string;
  gallery: { src: string; caption: string }[];
  features: string[];
  included: string[];
  minPlayers: number;
  maxPlayers: number;
  scenarioId?: string | null;
  playable: boolean;
  priceSet: boolean;
}

export function formatPrice(p: Product): string | null {
  if (p.price == null) return null;
  const n = Number.isInteger(p.price) ? String(p.price) : p.price.toFixed(2);
  return p.currency === 'ILS' ? `${n} ₪` : `${n} ${p.currency}`;
}

export function playersLabel(p: Product): string {
  return p.minPlayers > 1 ? `${p.minPlayers}–${p.maxPlayers} משתתפים` : `עד ${p.maxPlayers} משתתפים`;
}
