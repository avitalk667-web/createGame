import { Injectable, effect, signal } from '@angular/core';

export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  voice: number;
  music: number;
  effects: number;
  /** Background music on or off, apart from its volume. */
  musicOn: boolean;
  /** Sound effects on or off, apart from their volume. */
  effectsOn: boolean;
  muted: boolean;
  captions: boolean;
  /** "Play without sound": everything audible also has a visual cue (spec §21). */
  silentMode: boolean;
  quality: Quality;
  lookSensitivity: number;
}

const KEY = 'portalx.settings';
/**
 * Raised when a default changes in a way saved settings must follow. Every visit saved all the settings, defaults
 * included, so an older saved value cannot tell a choice from the old default. Version 2: background music starts off.
 */
const VERSION = 2;

function detectQuality(): Quality {
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  const cores = navigator.hardwareConcurrency ?? 4;
  if (mobile || cores <= 2) return 'low';
  if (cores <= 4) return 'medium';
  return 'high';
}

@Injectable({ providedIn: 'root' })
export class SettingsService {
  readonly settings = signal<Settings>(this.load());

  constructor() {
    effect(() => {
      const s = this.settings();
      try {
        localStorage.setItem(KEY, JSON.stringify({ ...s, v: VERSION }));
      } catch {}
    });
  }

  update(patch: Partial<Settings>) {
    this.settings.update((s) => ({ ...s, ...patch }));
  }

  private load(): Settings {
    const defaults: Settings = {
      voice: 0.9,
      // quiet music and moderate effects by default
      music: 0.35,
      effects: 0.6,
      // background music starts off; the player turns it on with 🎵 or in the settings
      musicOn: false,
      effectsOn: true,
      muted: false,
      captions: true,
      silentMode: false,
      quality: detectQuality(),
      lookSensitivity: 1,
    };
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaults;
      const { v, ...saved } = JSON.parse(raw);
      // settings saved before version 2 hold the old "music on" default, not a choice: music starts off once
      if (!(v >= 2)) delete saved.musicOn;
      return { ...defaults, ...saved };
    } catch {
      return defaults;
    }
  }
}
