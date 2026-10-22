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
  byProduct: { productId: string; name: string; money: Money; games: number }[];
  buyersWithEmail: number;
  orders: { pending: number; failed: number; cancelled: number };
  games: { opened: number; started: number; completed: number; paidStarted: number; adminFree: number; adminFreeStarted: number; purchasedNotStarted: number };
  participants: number;
  testPaidOrders?: number | null;
}

export interface AdminOrder {
  id: string; number: number; createdAt: string; email?: string | null; productId: string; productName: string;
  amount: number; currency: string; status: string; provider: string; transactionId?: string | null; isTest: boolean;
  refundedAmount?: number | null; gameCode?: string | null; players: number; gameStatus?: string | null;
}

export interface AdminGame {
  code: string; productId?: string | null; productName?: string | null; access: string; isTest: boolean; orderNumber?: number | null;
  owner?: string | null; createdAt: string; startedAt?: string | null; endedAt?: string | null; players: number; phase: string; status: string;
  result?: { durationSeconds: number; hintsUsed: number; puzzlesSolved: number; puzzlesTotal: number; completionType: string } | null;
}

export interface AdminProduct {
  id: string; name: string; tagline: string; description: string; coverImage: string; price?: number | null; currency: string;
  status: string; minPlayers: number; maxPlayers: number; scenarioId?: string | null; updatedAt: string; playable: boolean; warnings: string[];
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
}
