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

/** The personal coupon of a finished taste, as the server issued it (the percent and the dates are never set here). */
export interface TasteCoupon {
  code: string;
  discountPercent: number;
  issuedAt: string;
  expiresAt: string;
  expiresAtText: string;
  validityDays: number;
  status: string;
  serverNow: string;
  productIds: string[];
}

/**
 * What the finish screen may show about the coupon. The code (coupon) comes only in state "sent", after the mail provider
 * accepted the email; never before.
 */
export interface TasteCouponReply {
  state: 'no-session' | 'not-completed' | 'inactive' | 'limit' | 'form' | 'sending' | 'sent' | 'failed';
  coupon?: TasteCoupon | null;
  email?: string | null;
  message?: string | null;
  discountPercent?: number | null;
}

export type DemoDevice = 'desktop' | 'mobile' | 'tablet';

/** What kind of device this is, for the numbers only (the room adapts by its own quality setting). */
export function demoDevice(): DemoDevice {
  if (typeof matchMedia !== 'function' || !matchMedia('(pointer: coarse)').matches) return 'desktop';
  return Math.min(screen.width, screen.height) < 600 ? 'mobile' : 'tablet';
}

export type DemoReportedEvent = 'demo_impression' | 'demo_click' | 'demo_offer_viewed' | 'demo_product_clicked' | 'demo_abandoned'
  | 'demo_coupon_copied';

/**
 * Reports one step that only the browser sees. Sent with sendBeacon (it survives the page closing or navigating), never
 * waited for and never failing the page. The impression and the click count once per browser session.
 */
export function demoTrack(type: DemoReportedEvent, productId?: string) {
  if (type === 'demo_impression' || type === 'demo_click') {
    const key = 'px_demo_' + type;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {
      /* no storage (a private window): it may count again, which is fine */
    }
  }
  const body = JSON.stringify({ type, productId, device: demoDevice() });
  try {
    if (navigator.sendBeacon?.('/api/taste/event', new Blob([body], { type: 'application/json' }))) return;
  } catch {
    /* fall back to fetch */
  }
  fetch('/api/taste/event', { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'Content-Type': 'application/json' }, body }).catch(() => {});
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

  /** "/demo?ref=CODE": the server checks the personal link and keeps it for this visit (nothing is kept here). */
  async ref(code: string) {
    await this.request<unknown>('POST', '/api/taste/ref', { ref: code }).catch(() => {});
  }

  /** What the finish screen may show now (never issues or sends anything). */
  couponStatus() {
    return this.request<TasteCouponReply>('POST', '/api/taste/coupon/status');
  }

  /** "שלחו לי את הקופון": the address and the explicit consent (or a retry to the same address); the server emails the coupon. */
  sendCoupon(body: { email?: string; marketingConsent?: boolean; retry?: boolean }) {
    return this.request<TasteCouponReply>('POST', '/api/taste/coupon', body);
  }

  code(code: string) {
    return this.request<DemoCodeReply>('POST', '/api/taste/code', { code });
  }
}
