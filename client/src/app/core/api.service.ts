import { Injectable } from '@angular/core';
import { CouponQuote, FaqEntryView, OrderView, Product, ScenarioContent, ScenarioSummary } from './models';

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

  private async request<T>(method: string, url: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
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

  products() {
    return this.request<Product[]>('GET', '/api/products');
  }

  product(id: string) {
    return this.request<Product>('GET', `/api/products/${encodeURIComponent(id)}`);
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

  /** Guest checkout: the server reads the price from the catalog; the browser only names the product. */
  createOrder(productId: string, email: string | null, couponCode?: string | null) {
    return this.request<{ orderId: string; number: number; accessKey: string; checkoutUrl: string; isTest: boolean; price: number; discount: number }>(
      'POST', '/api/orders', { productId, email: email || undefined, couponCode: couponCode || undefined });
  }

  /** Prices a coupon for a product on the server (nothing is reserved until the order is created). */
  checkCoupon(productId: string, code: string) {
    return this.request<CouponQuote>('POST', '/api/coupons/check', { productId, code });
  }

  /** Opens the free trial game: no payment and no account (spec 1.5). */
  freeGame(productId: string) {
    return this.request<{ code: string; hostClaim: string }>('POST', `/api/products/${encodeURIComponent(productId)}/free-game`);
  }

  /** Demo mode only: the server opens the game without payment, or refuses when demo mode is off. */
  testGame(productId: string) {
    return this.request<{ code: string; hostClaim: string; message: string }>('POST', `/api/products/${encodeURIComponent(productId)}/test-game`);
  }

  site() {
    return this.request<SiteInfo>('GET', '/api/site');
  }

  /** End-of-game choices; the seat token goes in the body (or the game's seat cookie), never in the URL. */
  resultsEmail(code: string, body: { token: string | null; sendResults: boolean; email: string | null; marketingConsent: boolean; communityLink: boolean }) {
    return this.request<EndOfGameReply>('POST', `/api/rooms/${encodeURIComponent(code)}/results-email`, body);
  }

  unsubscribe(token: string) {
    return this.request<{ ok: boolean; message: string }>('POST', '/api/unsubscribe', { token });
  }

  faq() {
    return this.request<FaqEntryView[]>('GET', '/api/faq');
  }

  order(id: string, key: string) {
    return this.request<OrderView>('GET', `/api/orders/${encodeURIComponent(id)}`, undefined, { 'X-Order-Key': key });
  }

  openGame(id: string, key: string) {
    return this.request<{ code: string; hostClaim?: string | null; existing: boolean }>(
      'POST', `/api/orders/${encodeURIComponent(id)}/game`, undefined, { 'X-Order-Key': key });
  }

  sandboxCheckout(session: string) {
    return this.request<{ number: number; productName: string; amount: number; currency: string; status: string; orderId: string }>(
      'GET', `/api/sandbox/checkout/${encodeURIComponent(session)}`);
  }

  sandboxPay(session: string, outcome: 'approve' | 'decline' | 'cancel') {
    return this.request<{ result: string; returnUrl: string }>('POST', `/api/sandbox/checkout/${encodeURIComponent(session)}`, { outcome });
  }

  /** A seat this browser already holds in the game (from its HttpOnly cookie) — to come back as the same participant. */
  seat(code: string) {
    return this.request<{ seat?: { roomId: string; playerId: string; nickname: string; characterId: string; status: string; canReturn: boolean; isHost: boolean } | null }>(
      'GET', `/api/rooms/${encodeURIComponent(code)}/seat`);
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
/** Public site details (GET /api/site): the one contact address and the end-of-game options this server offers. */
export interface SiteInfo {
  contactEmail: string;
  resultsEmail: boolean;
  communityGroup: boolean;
  consentText: string;
  consentVersion: string;
}

export interface EndOfGameReply {
  ok: boolean;
  code: string;
  message: string;
  resultsStatus?: 'sent' | 'pending' | 'failed' | null;
  consentRecorded: boolean;
  communityGroupUrl?: string | null;
}

export interface StoredSession {
  code: string;
  roomId: string;
  playerId: string;
  /** The token this tab received when it joined; absent when the tab returned through the seat cookie. */
  token?: string;
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

/** The buyer's orders on this device (localStorage, so they survive closing the tab). The key is the only proof of purchase. */
export interface StoredOrder {
  orderId: string;
  key: string;
  productId: string;
  productName: string;
  createdAt: string;
}

const ORDERS_KEY = 'portalx.orders';

export const orderStore = {
  all(): StoredOrder[] {
    try {
      const raw = localStorage.getItem(ORDERS_KEY);
      return raw ? (JSON.parse(raw) as StoredOrder[]) : [];
    } catch {
      return [];
    }
  },
  get(orderId: string): StoredOrder | null {
    return this.all().find((o) => o.orderId === orderId) ?? null;
  },
  save(o: StoredOrder) {
    try {
      const rest = this.all().filter((x) => x.orderId !== o.orderId);
      localStorage.setItem(ORDERS_KEY, JSON.stringify([o, ...rest].slice(0, 20)));
    } catch {}
  },
  remove(orderId: string) {
    try {
      localStorage.setItem(ORDERS_KEY, JSON.stringify(this.all().filter((x) => x.orderId !== orderId)));
    } catch {}
  },
};
