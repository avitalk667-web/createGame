import { Injectable } from '@angular/core';
import { ApiError } from './api.service';

export interface AdminFilters {
  from?: string;
  to?: string;
  productId?: string;
  status?: string;
  access?: string;
  search?: string;
  includeTest?: boolean;
}

export interface Money { gross: number; refunds: number; afterRefunds: number; paidCount: number; refundCount: number }

export interface Dashboard {
  currency: string;
  includesTest: boolean;
  revenue: Money;
  byProduct: { productId: string; name: string; isFree: boolean; money: Money; games: number }[];
  freeGame?: FreeGameReport | null;
  buyersWithEmail: number;
  orders: { pending: number; failed: number; cancelled: number };
  games: {
    opened: number; started: number; completed: number; paidStarted: number; adminFree: number; adminFreeStarted: number; purchasedNotStarted: number;
    freeSample: number; freeSampleStarted: number; freeSampleCompleted: number; freeSamplePlayers: number;
    demo: number; demoStarted: number; demoCompleted: number;
  };
  participants: number;
  demoCheckoutEnabled: boolean;
  testPaidOrders?: number | null;
}

export interface FreeGameReport {
  productId: string; name: string; kind: 'free'; created: number; started: number; notStarted: number; completed: number;
  participants: number; participantsInStarted: number; lastStartedAt?: string | null;
  today: { started: number; completed: number; joined: number };
}

export interface AdminOrder {
  id: string; number: number; createdAt: string; email?: string | null; productId: string; productName: string;
  amount: number; originalPrice: number; discount: number; couponCode?: string | null;
  currency: string; status: string; provider: string; transactionId?: string | null; isTest: boolean;
  refundedAmount?: number | null; gameCode?: string | null; players: number; gameStatus?: string | null;
}

export interface AdminGame {
  code: string; productId?: string | null; productName?: string | null; access: string; isTest: boolean; orderNumber?: number | null;
  owner?: string | null; createdAt: string; startedAt?: string | null; endedAt?: string | null; players: number; phase: string; status: string;
  result?: { durationSeconds: number; hintsUsed: number; puzzlesSolved: number; puzzlesTotal: number; completionType: string } | null;
  groupScore?: number | null;
}

export interface AdminProduct {
  id: string; name: string; tagline: string; description: string; coverImage: string; price?: number | null; currency: string;
  status: string; minPlayers: number; maxPlayers: number; scenarioId?: string | null; updatedAt: string; playable: boolean; warnings: string[];
  isFree: boolean; maxPlayersLimit: number;
}

export interface MailingFilters { search?: string; consent?: string; status?: string; game?: string; from?: string; to?: string }

export interface MailingRow {
  email: string; lastResultsRequestAt?: string | null; lastGame?: string | null; lastGameName?: string | null; resultsStatus?: string | null;
  resultsRequests: number; consent: 'active' | 'revoked' | 'pending' | 'none'; consentedAt?: string | null; revokedAt?: string | null;
  consentSource?: string | null; groupLinkRequested: boolean; source?: string | null;
}

export interface MailingList {
  totals: { resultsAddresses: number; resultsSent: number; activeSubscribers: number; revokedSubscribers: number; groupLinkRequests: number };
  rows: MailingRow[];
}

function mailingQuery(f: MailingFilters) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) q.set(k, String(v));
  const s = q.toString();
  return s ? '?' + s : '';
}

export interface FaqRow { id: string; question: string; answer: string; sortOrder: number; published: boolean; createdBy: string; createdAt: string; updatedAt: string }

export interface CouponRow {
  id: string; code: string; name: string; note?: string | null; kind: 'percent' | 'fixed'; value: number;
  products: { id: string; name: string }[]; startsAt?: string | null; endsAt?: string | null; maxRedemptions?: number | null;
  active: boolean; createdAt: string; updatedAt: string; state: 'active' | 'scheduled' | 'expired' | 'disabled';
  redeemed: number; reserved: number; refunded: number; discountGiven: number; paidTotal: number;
}

export interface CouponUse {
  orderNumber?: number | null; productName?: string | null; productId: string; originalPrice: number; discount: number; finalPrice: number;
  redemption: string; orderStatus?: string | null; isTest?: boolean | null; createdAt: string;
}

export interface AuditEntry { id: number; adminName: string; action: string; targetType?: string | null; targetId?: string | null; details: unknown; createdAt: string }

export function filterQuery(f: AdminFilters): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? '?' + s : '';
}

/** Admin API. The session is an HttpOnly cookie; every call also sends the admin header the server requires. */
@Injectable({ providedIn: 'root' })
export class AdminApiService {
  private async request<T>(method: string, url: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        credentials: 'same-origin',
        headers: { 'X-PortalX-Admin': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError('network', 'אין חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב.');
    }
    if (res.status === 401) throw new ApiError('unauthorized', 'אין הרשאה. יש להתחבר כמנהל.');
    if (res.status === 403) throw new ApiError('forbidden', 'אין הרשאה.');
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(data?.code ?? 'error', data?.message ?? 'אירעה שגיאה. נסו שוב.');
    return data as T;
  }

  session() { return this.request<{ admin: boolean; name?: string | null }>('GET', '/api/admin/session'); }
  login(username: string, password: string) { return this.request<{ name: string }>('POST', '/api/admin/login', { username, password }); }
  logout() { return this.request<void>('POST', '/api/admin/logout'); }
  dashboard(f: AdminFilters) { return this.request<Dashboard>('GET', '/api/admin/dashboard' + filterQuery(f)); }
  orders(f: AdminFilters) { return this.request<AdminOrder[]>('GET', '/api/admin/orders' + filterQuery(f)); }
  csvUrl(f: AdminFilters) { return '/api/admin/orders.csv' + filterQuery(f); }
  games(f: AdminFilters) { return this.request<AdminGame[]>('GET', '/api/admin/games' + filterQuery(f)); }
  game(code: string) { return this.request<any>('GET', `/api/admin/games/${encodeURIComponent(code)}`); }
  products() { return this.request<AdminProduct[]>('GET', '/api/admin/products'); }
  updateProduct(id: string, body: object) { return this.request<AdminProduct>('PUT', `/api/admin/products/${encodeURIComponent(id)}`, body); }
  freeGame(productId: string) { return this.request<{ code: string; hostClaim: string }>('POST', '/api/admin/free-game', { productId }); }
  reclaim(code: string) { return this.request<{ code: string; hostClaim?: string | null }>('POST', `/api/admin/games/${encodeURIComponent(code)}/host-claim`); }
  audit() { return this.request<AuditEntry[]>('GET', '/api/admin/audit'); }
  mailing(f: MailingFilters) { return this.request<MailingList>('GET', '/api/admin/mailing' + mailingQuery(f)); }
  mailingCsvUrl(f: MailingFilters) { return '/api/admin/mailing.csv' + mailingQuery(f); }
  faq() { return this.request<{ builtIn: { question: string; answer: string }[]; custom: FaqRow[] }>('GET', '/api/admin/faq'); }
  addFaq(body: object) { return this.request<FaqRow>('POST', '/api/admin/faq', body); }
  updateFaq(id: string, body: object) { return this.request<FaqRow>('PUT', `/api/admin/faq/${id}`, body); }
  deleteFaq(id: string) { return this.request<void>('DELETE', `/api/admin/faq/${id}`); }
  coupons() { return this.request<CouponRow[]>('GET', '/api/admin/coupons'); }
  createCoupon(body: object) { return this.request<{ id: string; code: string }>('POST', '/api/admin/coupons', body); }
  updateCoupon(id: string, body: object) { return this.request<{ id: string; code: string }>('PUT', `/api/admin/coupons/${id}`, body); }
  setCouponActive(id: string, active: boolean) { return this.request<void>('POST', `/api/admin/coupons/${id}/status`, { active }); }
  couponOrders(id: string) { return this.request<CouponUse[]>('GET', `/api/admin/coupons/${id}/orders`); }
}
