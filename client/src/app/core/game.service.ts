import { Injectable, NgZone, computed, inject, signal } from '@angular/core';
import * as signalR from '@microsoft/signalr';
import { Subject } from 'rxjs';
import { ApiService, StoredSession, sessionStore } from './api.service';
import { ChatMessage, GameNotice, HubResult, PlayerDto, RemotePosition, RoomSnapshot, ScenarioContent } from './models';

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'failed';

/**
 * Real-time connection to the game server. The server is the single source of truth:
 * every change arrives as a full room snapshot, so reconnecting simply restores the latest state (spec §13).
 */
@Injectable({ providedIn: 'root' })
export class GameService {
  private zone = inject(NgZone);
  private api = inject(ApiService);
  private hub?: signalR.HubConnection;
  private session?: StoredSession;
  private serverOffsetMs = 0;
  private actionCounter = 0;

  readonly snapshot = signal<RoomSnapshot | null>(null);
  readonly scenario = signal<ScenarioContent | null>(null);
  readonly connection = signal<ConnectionState>('idle');
  readonly connectionError = signal<string | null>(null);
  readonly chat = signal<ChatMessage[]>([]);
  readonly playerId = signal<string | null>(null);

  /** Positions change many times per second; kept outside Angular change detection. */
  readonly positions = new Map<string, RemotePosition & { t: number }>();
  readonly notices$ = new Subject<GameNotice>();
  readonly pings$ = new Subject<{ playerId: string; objectId: string }>();

  readonly me = computed<PlayerDto | undefined>(() => this.snapshot()?.players.find((p) => p.id === this.playerId()));
  readonly isHost = computed(() => !!this.snapshot() && this.snapshot()!.hostPlayerId === this.playerId());
  readonly phase = computed(() => this.snapshot()?.phase ?? null);

  serverNow() {
    return Date.now() + this.serverOffsetMs;
  }

  playerName(id: string | undefined) {
    return this.snapshot()?.players.find((p) => p.id === id)?.nickname ?? '';
  }

  async connect(session: StoredSession): Promise<boolean> {
    if (this.hub && this.session?.token === session.token && this.connection() === 'connected') return true;
    await this.disconnect();
    this.session = session;
    this.connection.set('connecting');
    this.connectionError.set(null);

    const hub = new signalR.HubConnectionBuilder()
      .withUrl('/hubs/game')
      .withAutomaticReconnect([0, 1000, 2000, 4000, 8000, 15000, 30000])
      .configureLogging(signalR.LogLevel.Warning)
      .build();
    this.hub = hub;

    hub.on('state', (s: RoomSnapshot) => this.zone.run(() => this.applySnapshot(s)));
    hub.on('notice', (n: GameNotice) => this.zone.run(() => this.notices$.next(n)));
    hub.on('chat', (m: ChatMessage) => this.zone.run(() => this.chat.update((c) => [...c.slice(-39), m])));
    hub.on('moved', (id: string, x: number, y: number, z: number, ry: number, zoneId: string) => {
      this.positions.set(id, { x, y, z, ry, zone: zoneId, t: performance.now() });
    });
    hub.on('pinged', (playerId: string, objectId: string) => this.zone.run(() => this.pings$.next({ playerId, objectId })));
    hub.onreconnecting(() => this.zone.run(() => this.connection.set('reconnecting')));
    hub.onreconnected(() => this.zone.run(() => this.handshake()));
    hub.onclose(() => this.zone.run(() => this.connection.set(this.session ? 'disconnected' : 'idle')));

    try {
      await hub.start();
    } catch {
      this.connection.set('failed');
      this.connectionError.set('לא הצלחנו להתחבר לשרת המשחק. בדקו את החיבור ונסו שוב.');
      return false;
    }
    return this.handshake();
  }

  /** Identifies this connection to the server and receives the full current state. */
  private async handshake(): Promise<boolean> {
    if (!this.hub || !this.session) return false;
    try {
      const r = await this.hub.invoke<HubResult<{ playerId: string; chat: ChatMessage[]; positions: Record<string, RemotePosition> }>>(
        'Connect',
        this.session.token,
      );
      if (!r.ok) {
        this.connection.set('failed');
        this.connectionError.set(r.message);
        if (r.code === 'bad-token' || r.code === 'not-in-room') sessionStore.clear();
        return false;
      }
      this.playerId.set(r.data!.playerId);
      this.chat.set(r.data!.chat ?? []);
      for (const [id, p] of Object.entries(r.data!.positions ?? {})) this.positions.set(id, { ...p, t: performance.now() });
      if (r.snapshot) this.applySnapshot(r.snapshot);
      this.connection.set('connected');
      return true;
    } catch {
      this.connection.set('failed');
      this.connectionError.set('החיבור לחדר נכשל. נסו לרענן את הדף.');
      return false;
    }
  }

  async retry() {
    if (this.session) await this.connect(this.session);
  }

  async disconnect() {
    const hub = this.hub;
    this.hub = undefined;
    this.session = undefined;
    if (hub) await hub.stop().catch(() => {});
    this.snapshot.set(null);
    this.positions.clear();
    this.chat.set([]);
    this.connection.set('idle');
  }

  private applySnapshot(s: RoomSnapshot) {
    this.serverOffsetMs = new Date(s.serverNow).getTime() - Date.now();
    const prev = this.snapshot();
    this.snapshot.set(s);
    if (!this.scenario() || this.scenario()!.id !== s.scenarioId) {
      this.api.scenario(s.scenarioId).then((sc) => this.scenario.set(sc)).catch(() => {});
    }
    if (this.session && s.code !== this.session.code) {
      this.session = { ...this.session, code: s.code };
      sessionStore.set(this.session);
    }
    if (prev && prev.round !== s.round) this.positions.clear();
  }

  private actionId() {
    return `${this.playerId()?.slice(0, 8)}-${Date.now().toString(36)}-${++this.actionCounter}`;
  }

  async invoke<T = any>(method: string, ...args: unknown[]): Promise<HubResult<T>> {
    if (!this.hub || this.connection() !== 'connected') {
      return { ok: false, code: 'not-connected', message: 'אין חיבור לשרת כרגע. מתחברים מחדש...' };
    }
    try {
      const r = await this.hub.invoke<HubResult<T>>(method, ...args);
      if (r.snapshot) this.applySnapshot(r.snapshot);
      return r;
    } catch {
      return { ok: false, code: 'error', message: 'הפעולה לא הגיעה לשרת. נסו שוב.' };
    }
  }

  // ---- actions (intents only; the server validates everything)
  setReady = (ready: boolean) => this.invoke('SetReady', ready);
  updateProfile = (characterId: string, appearance: object) => this.invoke('UpdateProfile', characterId, JSON.stringify(appearance));
  startGame = () => this.invoke('StartGame');
  finishIntro = (skip: boolean) => this.invoke('FinishIntro', skip);
  playAgain = () => this.invoke('PlayAgain');
  regenerateCode = () => this.invoke('RegenerateCode');
  submitAnswer = (puzzleId: string, answer: unknown) => this.invoke('SubmitAnswer', puzzleId, answer, this.actionId());
  requestHint = (puzzleId: string) => this.invoke('RequestHint', puzzleId, this.actionId());
  pickUp = (itemId: string) => this.invoke('PickUp', itemId, this.actionId());
  combine = (a: string, b: string) => this.invoke('Combine', a, b, this.actionId());
  placeItem = (puzzleId: string, itemId: string) => this.invoke('PlaceItem', puzzleId, itemId, this.actionId());
  getTune = (puzzleId: string) => this.invoke<{ sequence: string[] }>('GetTune', puzzleId);
  getPersonalClues = (puzzleId: string) =>
    this.invoke<{ clues: { index: number; title: string; text: string; visual: string }[] }>('GetPersonalClues', puzzleId);
  sendChat = (text: string | null, emote: string | null) => this.invoke('SendChat', text, emote);

  async leave() {
    await this.invoke('Leave');
    sessionStore.clear();
    await this.disconnect();
  }

  move(x: number, y: number, z: number, ry: number, zoneId: string) {
    if (this.hub && this.connection() === 'connected') this.hub.send('Move', x, y, z, ry, zoneId).catch(() => {});
  }

  ping(objectId: string) {
    if (this.hub && this.connection() === 'connected') this.hub.send('Ping', objectId).catch(() => {});
  }
}
