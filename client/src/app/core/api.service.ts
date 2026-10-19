import { Injectable } from '@angular/core';
import { ScenarioContent, ScenarioSummary } from './models';

export class ApiError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export interface RoomInfo {
  code: string;
  scenarioId: string;
  scenarioName: string;
  phase: string;
  playerCount: number;
  maxPlayers: number;
  canJoin: boolean;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private scenarioCache = new Map<string, Promise<ScenarioContent>>();

  private async request<T>(method: string, url: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError('network', 'אין חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב.');
    }
    if (res.status === 429) throw new ApiError('rate', 'יותר מדי ניסיונות. המתינו דקה ונסו שוב.');
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(data?.code ?? 'error', data?.message ?? 'אירעה שגיאה. נסו שוב.');
    return data as T;
  }

  scenarios() {
    return this.request<ScenarioSummary[]>('GET', '/api/scenarios');
  }

  scenario(id: string) {
    if (!this.scenarioCache.has(id)) {
      const p = this.request<ScenarioContent>('GET', `/api/scenarios/${encodeURIComponent(id)}`);
      p.catch(() => this.scenarioCache.delete(id));
      this.scenarioCache.set(id, p);
    }
    return this.scenarioCache.get(id)!;
  }

  createRoom(scenarioId: string) {
    return this.request<{ code: string; hostClaim: string }>('POST', '/api/rooms', { scenarioId });
  }

  room(code: string) {
    return this.request<RoomInfo>('GET', `/api/rooms/${encodeURIComponent(code)}`);
  }

  join(code: string, nickname: string, characterId: string, appearance: object, hostClaim?: string | null) {
    return this.request<{ playerId: string; token: string; roomId: string }>('POST', `/api/rooms/${encodeURIComponent(code)}/players`, {
      nickname,
      characterId,
      appearance: JSON.stringify(appearance),
      hostClaim: hostClaim ?? undefined,
    });
  }
}

/** Per-tab session (sessionStorage) so several tabs can be different players and a refresh reconnects. */
export interface StoredSession {
  code: string;
  roomId: string;
  playerId: string;
  token: string;
}

const SESSION_KEY = 'portalx.session';

export const sessionStore = {
  get(): StoredSession | null {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? (JSON.parse(raw) as StoredSession) : null;
    } catch {
      return null;
    }
  },
  set(s: StoredSession) {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    } catch {}
  },
  clear() {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {}
  },
  hostClaim(code: string): string | null {
    try {
      return sessionStorage.getItem('portalx.host.' + code);
    } catch {
      return null;
    }
  },
  setHostClaim(code: string, claim: string) {
    try {
      sessionStorage.setItem('portalx.host.' + code, claim);
    } catch {}
  },
};
