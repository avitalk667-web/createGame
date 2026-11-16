import { Injectable } from '@angular/core';
import { ApiError } from '../core/api.service';

/** The browser's own taste session as the server keeps it (the cookie holds only a random token). */
export interface DemoState {
  inspected: string[];
  hints: string[];
  attempts: number;
  completed: boolean;
  cooldownSeconds: number;
  variant: string;
  seconds?: number | null;
}

export interface DemoCodeReply {
  ok: boolean;
  message: string;
  state: DemoState;
  alreadyCompleted: boolean;
}

export type DemoDevice = 'desktop' | 'mobile' | 'tablet';

/** What kind of device this is, for the numbers only (the room adapts by its own quality setting). */
export function demoDevice(): DemoDevice {
  if (typeof matchMedia !== 'function' || !matchMedia('(pointer: coarse)').matches) return 'desktop';
  return Math.min(screen.width, screen.height) < 600 ? 'mobile' : 'tablet';
}

/** Calls of "טעימה מהפורטל" (/api/taste). The answer of the riddle is never here: the server checks the code. */
@Injectable({ providedIn: 'root' })
export class DemoApi {
  private async request<T>(method: string, url: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError('network', 'אין חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב.');
    }
    const data = await res.json().catch(() => null);
    if (res.status === 429) throw new ApiError('rate', data?.message ?? 'יותר מדי ניסיונות בזמן קצר. נסו שוב בעוד רגע.');
    if (!res.ok) throw new ApiError(data?.code ?? 'error', data?.message ?? 'אירעה שגיאה. נסו שוב.');
    return data as T;
  }

  /** This browser's live session, or null (never creates one). */
  async state() {
    return (await this.request<{ state?: DemoState | null }>('GET', '/api/taste/state')).state ?? null;
  }

  /** Entering the room: continues this browser's session, or starts one. */
  async start(device: DemoDevice) {
    return (await this.request<{ state: DemoState }>('POST', '/api/taste/start', { device })).state;
  }

  async inspect(item: string) {
    return (await this.request<{ state: DemoState }>('POST', '/api/taste/inspect', { item })).state;
  }

  async hint() {
    return (await this.request<{ state: DemoState }>('POST', '/api/taste/hint')).state;
  }

  code(code: string) {
    return this.request<DemoCodeReply>('POST', '/api/taste/code', { code });
  }
}
