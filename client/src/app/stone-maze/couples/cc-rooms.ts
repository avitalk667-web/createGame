// "הצופן הזוגי": the six rooms inside the shared Stone Maze world. The world builds its usual shell (floor, walls,
// corridors, doors) and asks this module for each room's dressing, mechanisms and light mood; every frame and every
// state goes through here to the room parts. Nothing here changes the renderer or another game's rooms.
import * as THREE from 'three';
import { RoomSnapshot, ScenarioContent } from '../../core/models';
import { Quality } from '../../core/settings.service';
import { buildArchiveRoom } from './archive-room';
import { CcZone } from './cc-layout';
import { MOODS, Mood, RoomCtx, RoomPart, moodEnvironment } from './cc-kit';
import { buildHomeRoom } from './home-room';
import { LettersRoomPart, buildLettersRoom } from './letters-room';
import { buildPartnershipRoom } from './partnership-room';
import { buildSoundRoom } from './sound-room';

const BUILDERS: Record<CcZone, (ctx: RoomCtx) => RoomPart> = {
  'cc-sounds': buildSoundRoom, 'cc-partnership': buildPartnershipRoom, 'cc-trust': buildArchiveRoom,
  'cc-letters': buildLettersRoom, 'cc-home': buildHomeRoom,
};

export const isCouplesZone = (zone: string): zone is CcZone => zone in BUILDERS;

/** Door crests of the six rooms (the symbol of the room the door leads to). */
export const COUPLES_DOOR_SYMBOL: Record<CcZone, string> = {
  'cc-sounds': '🔔', 'cc-partnership': '⚙️', 'cc-trust': '🗝️', 'cc-letters': '✉️', 'cc-home': '🏠',
};

export class CouplesRooms {
  private parts = new Map<CcZone, RoomPart>();
  private groups = new Map<CcZone, THREE.Group>();
  private shown = new Set<CcZone>();
  private envs = new Map<string, THREE.Texture>();
  private letters?: LettersRoomPart;
  private letterState: [boolean, boolean] = [true, false];

  constructor(
    private scene: THREE.Scene,
    private quality: Quality,
    private scenario: ScenarioContent | null,
    private addLight: (x: number, y: number, z: number, color: string, intensity: number, distance: number, flicker: boolean) => void,
  ) {}

  build(zone: CcZone, center: number) {
    const group = new THREE.Group();
    group.position.set(0, 0, center);
    this.scene.add(group);
    this.groups.set(zone, group);
    this.shown.add(zone);
    const ctx: RoomCtx = {
      group, quality: this.quality, scenario: this.scenario,
      addLight: (x, y, z, color, intensity, distance, flicker = true) => this.addLight(x, y, center + z, color, intensity, distance, flicker),
    };
    const part = BUILDERS[zone](ctx);
    this.parts.set(zone, part);
    if (zone === 'cc-letters') {
      this.letters = part as LettersRoomPart;
      this.letters.setLetterState(...this.letterState);
    }
  }

  apply(s: RoomSnapshot, live: boolean) {
    for (const p of this.parts.values()) p.apply(s, live);
  }

  update(dt: number, t: number) {
    for (const [zone, p] of this.parts) if (this.shown.has(zone)) p.update(dt, t);
  }

  /**
   * Draws only the room the player is in and the rooms on either side of it (seen through the open doorways); the other
   * rooms are hidden and their animations rest. Outside these rooms everything is shown.
   */
  focus(zone: string) {
    const order = [...this.groups.keys()];
    const at = order.indexOf(zone as CcZone);
    this.shown.clear();
    order.forEach((z, i) => {
      const on = at < 0 || Math.abs(i - at) <= 1;
      this.groups.get(z)!.visible = on;
      if (on) this.shown.add(z);
    });
  }

  /** The writing desk's glow (this player has not written yet) and the mailbox flag (an unread letter) — local only. */
  setLetterState(deskGlow: boolean, unread: boolean) {
    this.letterState = [deskGlow, unread];
    this.letters?.setLetterState(deskGlow, unread);
  }

  mood(zone: string): Mood | undefined {
    return isCouplesZone(zone) ? MOODS[zone] : undefined;
  }

  /** The room's reflection environment, made once on first entry. */
  environment(renderer: THREE.WebGLRenderer, zone: string): THREE.Texture | null {
    const mood = this.mood(zone);
    if (!mood) return null;
    let env = this.envs.get(zone);
    if (!env) {
      env = moodEnvironment(renderer, mood.env);
      this.envs.set(zone, env);
    }
    return env;
  }

  dispose() {
    for (const e of this.envs.values()) e.dispose();
    this.envs.clear();
  }
}
