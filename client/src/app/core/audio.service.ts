import { Injectable, effect, inject, signal } from '@angular/core';
import { SettingsService } from './settings.service';

export interface VoiceLine {
  id: string;
  speaker: string;
  text: string;
  file: string;
  durationMs: number;
}

export interface Caption {
  speaker: string;
  text: string;
  key: number;
}

/**
 * 'home' … 'victory' are the original escape room's music (unchanged). The themed modes belong to the newer games:
 * 'ancient' — old rooms and investigation; 'mechanism' — machines and mazes; 'magic' — light and enchanted rooms;
 * 'hanukkah' — the Hanukkah journey; 'finale' — the end of a journey.
 */
export type MusicMode = 'none' | 'home' | 'intro' | 'explore' | 'tension' | 'victory' | ThemeId;
export type ThemeId = 'ancient' | 'mechanism' | 'magic' | 'hanukkah' | 'finale';

export type Sfx =
  // the original effects
  | 'click' | 'pickup' | 'wrong' | 'success' | 'door' | 'whoosh' | 'hint' | 'chat' | 'letter' | 'open' | 'step'
  // actions in the newer rooms
  | 'select' | 'drawer' | 'key' | 'lever' | 'gear' | 'place' | 'misplace' | 'spin' | 'codeOk' | 'points' | 'complete'
  | 'paper' | 'find' | 'metal' | 'mechanism' | 'scale' | 'beam' | 'gate' | 'cabinet' | 'glass' | 'oil' | 'decode' | 'transition';

type Voice = 'pluck' | 'piano' | 'bell' | 'glow';

/** An original, procedurally played piece: a soft drone, a melody on a scale and optional bass and ticks. */
interface Theme {
  root: number;
  /** Semitones above the root. */
  scale: number[];
  /** Seconds per step. */
  beat: number;
  /** Scale degrees per step; -1 is a rest. */
  melody: number[];
  voice: Voice;
  vol: number;
  /** Scale degrees per step for a low line (-1 rest), played an octave down. */
  bass?: number[];
  /** A soft mechanical tick on every step. */
  tick?: boolean;
  /** A bell on the first step of every bar of 8. */
  bell?: boolean;
  drone: { muls: number[]; level: number; cutoff: number };
}

const FREYGISH = [0, 1, 4, 5, 7, 8, 10, 12, 13, 16];
const MINOR = [0, 2, 3, 5, 7, 8, 10, 12, 14, 15];
const DORIAN = [0, 2, 3, 5, 7, 9, 10, 12, 14, 15];
const MAJOR = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16];
const LYDIAN = [0, 2, 4, 6, 7, 9, 11, 12, 14, 16];

const THEMES: Record<ThemeId, Theme> = {
  // quiet and curious: a plucked string line over a low drone, a bell now and then
  ancient: {
    root: 220, scale: DORIAN, beat: 0.62, voice: 'pluck', vol: 0.06, bell: true,
    melody: [0, -1, 2, 4, -1, 3, 2, -1, 4, -1, 5, 4, 2, -1, 1, -1, 0, -1, 4, 6, -1, 5, 4, -1, 3, -1, 2, 1, 0, -1, -1, -1],
    drone: { muls: [0.5, 0.75], level: 0.11, cutoff: 520 },
  },
  // light tension at a moderate pace: soft ticks, a pulsing bass and sparse piano — puzzles, not panic
  mechanism: {
    root: 196, scale: MINOR, beat: 0.4, voice: 'piano', vol: 0.05, tick: true,
    melody: [4, -1, -1, 3, -1, -1, 2, -1, 4, -1, -1, 5, -1, 4, -1, -1, 2, -1, -1, 1, -1, -1, 0, -1, 2, -1, 3, -1, 4, -1, -1, -1],
    bass: [0, -1, 0, -1, 4, -1, 0, -1, 0, -1, 0, -1, 3, -1, 4, -1],
    drone: { muls: [0.5, 0.75], level: 0.08, cutoff: 420 },
  },
  // glowing and hopeful: bell-like arpeggios floating over a warm pad
  magic: {
    root: 261.63, scale: LYDIAN, beat: 0.36, voice: 'bell', vol: 0.045,
    melody: [0, 2, 4, 7, 4, 2, 3, 5, 7, 9, 7, 5, 4, 6, 8, 6, 4, -1, 2, -1, 0, 4, 7, 4, -1, -1, 5, 7, 9, 7, -1, -1],
    drone: { muls: [0.5, 1, 1.5], level: 0.07, cutoff: 900 },
  },
  // warm and festive in the Ahava Rabbah (freygish) mode — an original melody, not an existing song
  hanukkah: {
    root: 293.66, scale: FREYGISH, beat: 0.34, voice: 'pluck', vol: 0.06,
    melody: [0, 1, 2, -1, 3, 2, 1, 0, 2, 3, 4, -1, 5, 4, 3, -1, 4, 5, 6, 5, 4, -1, 3, 2, 1, 2, 3, 1, 0, -1, -1, -1],
    bass: [0, -1, 4, -1, 0, -1, 4, -1, 3, -1, 4, -1, 0, -1, 4, -1],
    drone: { muls: [0.5, 0.75], level: 0.08, cutoff: 600 },
  },
  // the end of a journey: bright, rising arpeggios
  finale: {
    root: 261.63, scale: MAJOR, beat: 0.27, voice: 'bell', vol: 0.06,
    melody: [0, 2, 4, 7, 4, 7, 9, 7, 5, 7, 9, 11, 9, 7, 4, -1, 3, 5, 7, 9, 7, 5, 4, 2, 4, 7, 9, 12, -1, -1, -1, -1],
    bass: [0, -1, -1, -1, 3, -1, -1, -1, 4, -1, -1, -1, 0, -1, -1, -1],
    drone: { muls: [0.5, 1, 1.25], level: 0.08, cutoff: 1100 },
  },
};

const THEMED = new Set<MusicMode>(Object.keys(THEMES) as ThemeId[]);

/**
 * All sound in the game:
 *  - Voice: pre-recorded, approved Hebrew audio files listed in /audio/he/voice-script.json (spec §16).
 *    A missing file never blocks the game — the Hebrew caption is shown for the line's duration instead.
 *  - Music and effects: synthesized live with WebAudio, so they are original and license-free (spec §17).
 * Voice, music and effects have separate volume controls; everything can be muted (spec §16, §21).
 */
@Injectable({ providedIn: 'root' })
export class AudioService {
  private settings = inject(SettingsService);
  private ctx?: AudioContext;
  private master?: GainNode;
  private voiceBus?: GainNode;
  private musicBus?: GainNode;
  private sfxBus?: GainNode;
  private reverb?: ConvolverNode;
  private lines = new Map<string, VoiceLine>();
  private manifestLoaded?: Promise<void>;
  private bufferCache = new Map<string, Promise<AudioBuffer | null>>();
  private voiceSource?: AudioBufferSourceNode;
  private voiceQueue: Promise<void> = Promise.resolve();
  private voiceGeneration = 0;
  private musicMode: MusicMode = 'none';
  private musicTimer?: ReturnType<typeof setInterval>;
  private musicNodes: AudioNode[] = [];
  private nextNoteTime = 0;
  private step = 0;
  private captionKey = 0;
  /** When each effect last played: the same effect twice within a moment (a doubled sync event) plays once. */
  private lastSfx = new Map<Sfx, number>();
  private pendingCues: { name: Sfx; priority: number }[] = [];
  private cueTimer?: ReturnType<typeof setTimeout>;
  private ambience?: { name: string; nodes: AudioNode[]; gain: GainNode };
  /** The room sound asked for before the browser allowed sound; it starts with the first click. */
  private wantedAmbience: 'light' | null = null;

  readonly caption = signal<Caption | null>(null);
  readonly unlocked = signal(false);

  constructor() {
    effect(() => {
      const s = this.settings.settings();
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.master!.gain.setTargetAtTime(s.muted || s.silentMode ? 0 : 1, t, 0.05);
      this.voiceBus!.gain.setTargetAtTime(s.voice, t, 0.05);
      this.musicBus!.gain.setTargetAtTime(s.musicOn ? s.music * 0.55 : 0, t, 0.05);
      this.sfxBus!.gain.setTargetAtTime(s.effectsOn ? s.effects : 0, t, 0.05);
    });
  }

  /** Must be called from a user gesture (browser autoplay rules). */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      const s = this.settings.settings();
      this.master = this.gain(s.muted || s.silentMode ? 0 : 1, this.ctx.destination);
      this.voiceBus = this.gain(s.voice, this.master);
      this.musicBus = this.gain(s.musicOn ? s.music * 0.55 : 0, this.master);
      this.sfxBus = this.gain(s.effectsOn ? s.effects : 0, this.master);
      this.reverb = this.ctx.createConvolver();
      this.reverb.buffer = this.impulse(3.2);
      const wet = this.gain(0.35, this.master);
      this.reverb.connect(wet);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    this.unlocked.set(true);
    if (this.musicMode !== 'none' && !this.musicTimer) this.startMusicLoop();
    if (this.wantedAmbience && !this.ambience) this.setAmbience(this.wantedAmbience);
  }

  loadManifest(): Promise<void> {
    this.manifestLoaded ??= fetch('audio/he/voice-script.json')
      .then((r) => (r.ok ? r.json() : { lines: [] }))
      .then((m: { lines: VoiceLine[] }) => m.lines.forEach((l) => this.lines.set(l.id, l)))
      .catch(() => {});
    return this.manifestLoaded;
  }

  line(id: string) {
    return this.lines.get(id);
  }

  // ------------------------------------------------------------------ voice + captions

  /**
   * Queues a voice line. Captions always appear (when enabled); audio plays if the recorded file exists.
   * @param fallbackText caption text to use when the line is not in the script (e.g. server messages).
   */
  speak(id: string | undefined, fallbackText?: string, speaker?: string, interrupt = false): Promise<void> {
    if (interrupt) this.stopVoice();
    const gen = this.voiceGeneration;
    this.voiceQueue = this.voiceQueue.then(async () => {
      if (gen !== this.voiceGeneration) return;
      await this.loadManifest();
      const line = id ? this.lines.get(id) : undefined;
      const text = line?.text ?? fallbackText;
      if (!text) return;
      const who = line?.speaker ?? speaker ?? '';
      this.caption.set({ speaker: who, text, key: ++this.captionKey });
      const buffer = line ? await this.loadBuffer(line.file) : null;
      if (gen !== this.voiceGeneration) return;
      const ms = buffer ? buffer.duration * 1000 : line?.durationMs ?? Math.min(9000, 1400 + text.length * 65);
      if (buffer && this.ctx) {
        await new Promise<void>((resolve) => {
          const src = this.ctx!.createBufferSource();
          src.buffer = buffer;
          src.connect(this.voiceBus!);
          src.onended = () => resolve();
          this.voiceSource = src;
          src.start();
          setTimeout(resolve, ms + 500);
        });
      } else {
        await new Promise((r) => setTimeout(r, ms));
      }
      if (this.caption()?.key === this.captionKey) this.caption.set(null);
    });
    return this.voiceQueue;
  }

  stopVoice() {
    this.voiceGeneration++;
    this.voiceQueue = Promise.resolve();
    try {
      this.voiceSource?.stop();
    } catch {}
    this.caption.set(null);
  }

  private loadBuffer(file: string): Promise<AudioBuffer | null> {
    if (!this.bufferCache.has(file)) {
      const p = (async () => {
        if (!this.ctx) return null;
        try {
          const res = await fetch(file);
          // The SPA fallback answers missing files with index.html, so check the type.
          if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('audio')) return null;
          return await this.ctx.decodeAudioData(await res.arrayBuffer());
        } catch {
          return null;
        }
      })();
      this.bufferCache.set(file, p);
    }
    return this.bufferCache.get(file)!;
  }

  // ------------------------------------------------------------------ effects

  sfx(name: Sfx) {
    if (!this.ctx) return;
    const now = performance.now();
    if (now - (this.lastSfx.get(name) ?? -1e9) < 150) return;
    this.lastSfx.set(name, now);
    const t = this.ctx.currentTime;
    switch (name) {
      case 'click':
        this.tone(880, t, 0.06, 'triangle', 0.15);
        break;
      case 'chat':
        this.tone(1320, t, 0.08, 'sine', 0.12);
        this.tone(1760, t + 0.07, 0.1, 'sine', 0.1);
        break;
      case 'pickup':
        [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, t + i * 0.07, 0.35, 'sine', 0.22, true));
        break;
      case 'letter':
        [659, 880, 1319].forEach((f, i) => this.tone(f, t + i * 0.12, 0.8, 'sine', 0.22, true));
        break;
      case 'hint':
        this.tone(698, t, 0.4, 'sine', 0.18, true);
        this.tone(1047, t + 0.15, 0.6, 'sine', 0.14, true);
        break;
      case 'wrong':
        this.tone(220, t, 0.25, 'square', 0.07);
        this.tone(196, t + 0.18, 0.35, 'square', 0.07);
        break;
      case 'success':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, t + i * 0.1, 0.9, 'triangle', 0.18, true));
        break;
      case 'open':
        this.tone(440, t, 0.3, 'sine', 0.15, true);
        break;
      case 'door':
        this.noise(t, 1.6, 180, 0.5);
        this.tone(55, t, 1.5, 'sawtooth', 0.12);
        break;
      case 'whoosh':
        this.noise(t, 2.2, 900, 0.35, true);
        break;
      case 'step':
        this.noise(t, 0.08, 400, 0.08);
        break;
      // ---- the newer rooms: short and soft; success, failure and doors sound clearly different
      case 'select':
        this.tone(1175, t, 0.05, 'sine', 0.06);
        break;
      case 'find':
        this.tone(1047, t, 0.5, 'sine', 0.1, true);
        this.tone(1568, t + 0.09, 0.6, 'sine', 0.07, true);
        break;
      case 'paper':
        this.noise(t, 0.18, 2600, 0.12);
        this.noise(t + 0.16, 0.22, 1900, 0.1);
        break;
      case 'drawer':
        this.noise(t, 0.45, 320, 0.22);
        this.tone(140, t + 0.38, 0.12, 'triangle', 0.1);
        break;
      case 'key':
        this.tone(2093, t, 0.05, 'square', 0.04);
        this.tone(1661, t + 0.08, 0.05, 'square', 0.04);
        this.noise(t + 0.14, 0.08, 1500, 0.12);
        break;
      case 'lever':
        this.noise(t, 0.3, 500, 0.18, true);
        this.tone(180, t + 0.26, 0.15, 'triangle', 0.14);
        break;
      case 'gear':
        for (let i = 0; i < 4; i++) this.tone(1400 + i * 60, t + i * 0.05, 0.03, 'square', 0.035);
        break;
      case 'metal':
        this.tone(2637, t, 0.25, 'sine', 0.05, true);
        this.tone(3951, t, 0.18, 'sine', 0.03);
        break;
      case 'place':
        this.tone(330, t, 0.08, 'triangle', 0.14);
        this.tone(988, t + 0.05, 0.35, 'sine', 0.1, true);
        break;
      case 'misplace':
        this.tone(196, t, 0.18, 'triangle', 0.1);
        break;
      case 'spin':
        for (let i = 0; i < 9; i++) this.tone(600 + (i % 2) * 90, t + i * (0.04 + i * 0.008), 0.03, 'triangle', 0.05);
        this.noise(t, 0.7, 1200, 0.05);
        break;
      case 'codeOk':
        this.tone(1760, t, 0.04, 'square', 0.04);
        this.tone(1760, t + 0.1, 0.04, 'square', 0.04);
        this.noise(t + 0.2, 0.12, 900, 0.16);
        [784, 1175].forEach((f, i) => this.tone(f, t + 0.32 + i * 0.1, 0.6, 'sine', 0.12, true));
        break;
      case 'cabinet':
        this.noise(t, 0.9, 260, 0.2);
        this.tone(98, t + 0.1, 0.8, 'triangle', 0.08);
        [523, 659, 784].forEach((f, i) => this.tone(f, t + 0.5 + i * 0.09, 0.8, 'sine', 0.1, true));
        break;
      case 'mechanism':
        for (let i = 0; i < 10; i++) this.tone(110 + (i % 2) * 55, t + i * 0.12, 0.1, 'square', 0.03);
        this.noise(t, 1.3, 220, 0.18);
        [392, 523, 659].forEach((f, i) => this.tone(f, t + 1.0 + i * 0.1, 0.9, 'triangle', 0.1, true));
        break;
      case 'scale':
        // the brass beam swings: a soft creak and a small chime of the pans
        this.noise(t, 0.25, 500, 0.06);
        this.tone(988, t + 0.12, 0.5, 'sine', 0.05, true);
        this.tone(1480, t + 0.16, 0.4, 'sine', 0.03, true);
        break;
      case 'glass':
        [2093, 2637, 3136].forEach((f, i) => this.tone(f, t + i * 0.06, 0.5, 'sine', 0.05, true));
        break;
      case 'beam':
        [523, 659, 784, 988, 1319].forEach((f, i) => this.tone(f, t + i * 0.08, 1.4, 'sine', 0.11, true));
        this.noise(t, 1.4, 3000, 0.06, true);
        break;
      case 'decode':
        [587, 740, 880, 1175].forEach((f, i) => this.tone(f, t + i * 0.09, 0.7, 'triangle', 0.12, true));
        break;
      case 'oil':
        [440, 554, 659, 880, 1109].forEach((f, i) => this.tone(f, t + i * 0.13, 1.6, 'sine', 0.12, true));
        this.noise(t + 0.3, 1.2, 4000, 0.04, true);
        break;
      case 'points':
        this.tone(1568, t, 0.12, 'sine', 0.08);
        this.tone(2093, t + 0.08, 0.25, 'sine', 0.07, true);
        break;
      case 'transition':
        [392, 523, 659, 784].forEach((f, i) => this.tone(f, t + i * 0.11, 1.0, 'sine', 0.09, true));
        this.noise(t, 1.2, 700, 0.12, true);
        break;
      case 'gate':
        this.noise(t, 2.4, 160, 0.4);
        this.tone(49, t, 2.2, 'sawtooth', 0.09);
        [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, t + 1.2 + i * 0.12, 1.6, 'sine', 0.12, true));
        break;
      case 'complete':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, t + i * 0.14, 1.2, 'triangle', 0.15, true));
        [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, t + 0.7 + i * 0.14, 1.6, 'sine', 0.12, true));
        break;
    }
  }

  /**
   * One server event usually arrives as a burst of notices (solved, points, a door, the end of the game).
   * Cues gathered within a moment play once: only the most important of them, so sounds never pile up.
   */
  cue(name: Sfx, priority: number) {
    this.pendingCues.push({ name, priority });
    if (this.cueTimer) return;
    this.cueTimer = setTimeout(() => {
      this.cueTimer = undefined;
      const best = this.pendingCues.reduce((a, b) => (b.priority > a.priority ? b : a));
      this.pendingCues = [];
      this.sfx(best.name);
    }, 140);
  }

  /** A soft, continuous sound of the room (the light source of the workshop); null stops it. */
  setAmbience(name: 'light' | null) {
    this.wantedAmbience = name;
    if ((this.ambience?.name ?? null) === name || !this.ctx) return;
    const t = this.ctx.currentTime;
    if (this.ambience) {
      const old = this.ambience;
      old.gain.gain.setTargetAtTime(0, t, 0.4);
      old.nodes.forEach((n) => n instanceof OscillatorNode && n.stop(t + 2.5));
      this.ambience = undefined;
    }
    if (!name) return;
    const gain = this.gain(0, this.sfxBus!);
    gain.gain.setTargetAtTime(0.05, t, 0.8);
    const nodes: AudioNode[] = [];
    for (const [f, v] of [[220, 0.5], [330.5, 0.35], [661, 0.12]]) {
      const o = this.ctx.createOscillator();
      o.frequency.value = f;
      const g = this.gain(v, gain);
      o.connect(g);
      o.start();
      nodes.push(o);
    }
    // a slow shimmer, so the hum is alive but never annoying
    const lfo = this.ctx.createOscillator();
    const depth = this.gain(0.02, gain.gain);
    lfo.frequency.value = 0.35;
    lfo.connect(depth);
    lfo.start();
    nodes.push(lfo);
    this.ambience = { name, nodes, gain };
  }

  bell(freq: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(freq, t, 1.8, 'sine', 0.3, true);
    this.tone(freq * 2.01, t, 1.1, 'sine', 0.08, true);
    this.tone(freq * 3.02, t, 0.6, 'sine', 0.04, true);
  }

  // ------------------------------------------------------------------ music

  setMusic(mode: MusicMode) {
    if (mode === this.musicMode) return;
    this.musicMode = mode;
    this.stopMusicLoop();
    if (mode !== 'none' && this.ctx) this.startMusicLoop();
  }

  private startMusicLoop() {
    if (!this.ctx) return;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.step = 0;
    this.startDrone();
    this.musicTimer = setInterval(() => this.scheduleMusic(), 200);
  }

  private stopMusicLoop() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = undefined;
    const t = this.ctx?.currentTime ?? 0;
    for (const n of this.musicNodes) {
      if (n instanceof GainNode) n.gain.setTargetAtTime(0, t, 0.6);
      if (n instanceof OscillatorNode) n.stop(t + 3);
    }
    this.musicNodes = [];
  }

  private startDrone() {
    const ctx = this.ctx!;
    if (THEMED.has(this.musicMode)) return this.startThemeDrone(THEMES[this.musicMode as ThemeId]);
    const root = this.musicMode === 'victory' ? 130.81 : this.musicMode === 'tension' ? 98 : 110;
    const g = this.gain(0, this.musicBus!);
    g.gain.setTargetAtTime(this.musicMode === 'home' ? 0.12 : 0.16, ctx.currentTime, 2);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    lp.connect(g);
    const third = this.musicMode === 'victory' ? 1.26 : 1.19;
    for (const [mul, det] of [[1, -6], [1, 5], [1.5, 0], [third * 2, 3]] as [number, number][]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = root * mul;
      o.detune.value = det;
      o.connect(lp);
      o.start();
      this.musicNodes.push(o);
    }
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 250;
    lfo.frequency.value = 0.07;
    lfo.connect(lfoGain);
    lfoGain.connect(lp.frequency);
    lfo.start();
    this.musicNodes.push(g, lfo);
  }

  /** The theme's pad fades in slowly, while the previous piece fades out: one gradual change, never two pieces. */
  private startThemeDrone(th: Theme) {
    const ctx = this.ctx!;
    const g = this.gain(0, this.musicBus!);
    g.gain.setTargetAtTime(th.drone.level, ctx.currentTime, 2.2);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = th.drone.cutoff;
    lp.connect(g);
    for (const [i, mul] of th.drone.muls.entries()) {
      const o = ctx.createOscillator();
      o.type = i === 0 ? 'triangle' : 'sawtooth';
      o.frequency.value = th.root * mul;
      o.detune.value = i * 4 - 3;
      o.connect(lp);
      o.start();
      this.musicNodes.push(o);
    }
    this.musicNodes.push(g);
  }

  private scheduleTheme(th: Theme) {
    const ctx = this.ctx!;
    const freq = (deg: number, oct = 0) => th.root * Math.pow(2, (th.scale[deg % th.scale.length] + 12 * oct) / 12);
    while (this.nextNoteTime < ctx.currentTime + 0.6) {
      const s = this.step++;
      const t = this.nextNoteTime;
      const deg = th.melody[s % th.melody.length];
      // the first bars come in softly, so a new room's music never starts with a jump
      const fade = Math.min(1, 0.35 + s / 24);
      if (deg >= 0) this.musicNote(freq(deg), t, th.beat * 2.6, th.voice, th.vol * fade);
      const b = th.bass?.[s % th.bass.length] ?? -1;
      if (b >= 0) this.musicNote(freq(b, -1), t, th.beat * 1.8, 'piano', th.vol * 0.8 * fade);
      if (th.tick) this.tone(s % 2 ? 2400 : 3000, t, 0.025, 'square', 0.012 * fade, false, this.musicBus);
      if (th.bell && s % 16 === 8) this.musicNote(freq(4, 1), t, 2.2, 'bell', th.vol * 0.6 * fade);
      this.nextNoteTime += th.beat;
    }
  }

  private musicNote(f: number, t: number, dur: number, voice: Voice, vol: number) {
    const bus = this.musicBus;
    switch (voice) {
      case 'pluck':
        this.tone(f, t, dur * 0.6, 'triangle', vol, true, bus);
        this.tone(f * 2.003, t, dur * 0.25, 'sine', vol * 0.25, false, bus);
        break;
      case 'piano':
        this.tone(f, t, dur, 'sine', vol, true, bus);
        this.tone(f * 2, t, dur * 0.4, 'triangle', vol * 0.18, false, bus);
        break;
      case 'bell':
        this.tone(f, t, dur * 1.3, 'sine', vol, true, bus);
        this.tone(f * 2.76, t, dur * 0.5, 'sine', vol * 0.18, true, bus);
        break;
      case 'glow':
        this.tone(f, t, dur * 2, 'sine', vol, true, bus);
        break;
    }
  }

  private scheduleMusic() {
    const ctx = this.ctx!;
    if (THEMED.has(this.musicMode)) return this.scheduleTheme(THEMES[this.musicMode as ThemeId]);
    const minor = [220, 261.63, 293.66, 329.63, 392, 440, 523.25, 587.33];
    const major = [261.63, 329.63, 392, 440, 523.25, 659.25, 783.99, 1046.5];
    const scale = this.musicMode === 'victory' ? major : minor;
    const beat = this.musicMode === 'intro' ? 0.55 : this.musicMode === 'victory' ? 0.28 : 0.75;
    while (this.nextNoteTime < ctx.currentTime + 0.6) {
      const s = this.step++;
      const pattern = this.musicMode === 'victory' ? [0, 2, 4, 7, 4, 2, 5, 7] : [0, 4, 2, 5, 3, 6, 1, 4, 7, 5, 2, 0];
      const play = this.musicMode === 'victory' || this.musicMode === 'intro' ? true : (s * 7) % 5 < 3;
      if (play) {
        const f = scale[pattern[s % pattern.length]] * (this.musicMode === 'tension' ? 0.5 : 1);
        this.tone(f, this.nextNoteTime, beat * 3, 'sine', this.musicMode === 'home' ? 0.05 : 0.07, true, this.musicBus);
      }
      this.nextNoteTime += beat;
    }
  }

  // ------------------------------------------------------------------ synthesis helpers

  private gain(value: number, dest: AudioNode | AudioParam) {
    const g = this.ctx!.createGain();
    g.gain.value = value;
    g.connect(dest as AudioNode);
    return g;
  }

  private tone(freq: number, t: number, dur: number, type: OscillatorType, vol: number, reverb = false, bus?: GainNode) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(bus ?? this.sfxBus!);
    if (reverb) g.connect(this.reverb!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(t: number, dur: number, freq: number, vol: number, sweep = false) {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(freq * 4, t + dur * 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.sfxBus!);
    g.connect(this.reverb!);
    src.start(t);
  }

  private impulse(seconds: number) {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * seconds;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    return buf;
  }
}
