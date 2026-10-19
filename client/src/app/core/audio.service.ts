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

export type MusicMode = 'none' | 'home' | 'intro' | 'explore' | 'tension' | 'victory';

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

  readonly caption = signal<Caption | null>(null);
  readonly unlocked = signal(false);

  constructor() {
    effect(() => {
      const s = this.settings.settings();
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.master!.gain.setTargetAtTime(s.muted || s.silentMode ? 0 : 1, t, 0.05);
      this.voiceBus!.gain.setTargetAtTime(s.voice, t, 0.05);
      this.musicBus!.gain.setTargetAtTime(s.music * 0.55, t, 0.05);
      this.sfxBus!.gain.setTargetAtTime(s.effects, t, 0.05);
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
      this.musicBus = this.gain(s.music * 0.55, this.master);
      this.sfxBus = this.gain(s.effects, this.master);
      this.reverb = this.ctx.createConvolver();
      this.reverb.buffer = this.impulse(3.2);
      const wet = this.gain(0.35, this.master);
      this.reverb.connect(wet);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    this.unlocked.set(true);
    if (this.musicMode !== 'none' && !this.musicTimer) this.startMusicLoop();
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

  sfx(name: 'click' | 'pickup' | 'wrong' | 'success' | 'door' | 'whoosh' | 'hint' | 'chat' | 'letter' | 'open' | 'step') {
    if (!this.ctx) return;
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
    }
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

  private scheduleMusic() {
    const ctx = this.ctx!;
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
