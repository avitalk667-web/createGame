import { Injectable, effect, signal } from '@angular/core';

export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  voice: number;
  music: number;
  effects: number;
  muted: boolean;
  captions: boolean;
  /** "Play without sound": everything audible also has a visual cue (spec §21). */
  silentMode: boolean;
  quality: Quality;
  lookSensitivity: number;
}

const KEY = 'portalx.settings';

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
        localStorage.setItem(KEY, JSON.stringify(s));
      } catch {}
    });
  }

  update(patch: Partial<Settings>) {
    this.settings.update((s) => ({ ...s, ...patch }));
  }

  private load(): Settings {
    const defaults: Settings = {
      voice: 0.9,
      music: 0.45,
      effects: 0.7,
      muted: false,
      captions: true,
      silentMode: false,
      quality: detectQuality(),
      lookSensitivity: 1,
    };
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
    } catch {
      return defaults;
    }
  }
}
