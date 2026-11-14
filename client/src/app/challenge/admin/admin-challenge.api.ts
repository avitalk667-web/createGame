import { Injectable } from '@angular/core';
import { ApiError } from '../../core/api.service';

export interface ChallengeCampaignSettings {
  id: string; name: string; description: string; isActive: boolean; issuingPaused: boolean;
  minimumScore: number; discountPercentage: number; validityDays: number; maxCoupons: number; issuedCouponsCount: number;
  sourceProductId: string; productIds: string[]; showEntryPopup: boolean; showProgress: boolean;
  startedAt?: string | null; createdAt: string; updatedAt: string;
}

export interface ChallengeStatistics {
  since: string; gamesOpened: number; gamesStarted: number; gamesCompleted: number;
  uniqueParticipants: number; checkedPlayers: number; eligiblePlayers: number; eligibleRate: number;
  emailsCollected: number; marketingConsents: number;
  issued: number; remaining: number; maxCoupons: number; redeemed: number; redemptionRate: number; cancelled: number; expired: number; active: number;
  revenue: number; discounts: number; testRedemptions: number;
  byGame: { productId: string; name: string; count: number; revenue: number; discounts: number }[];
}

export interface ChallengeAdminView {
  campaign: ChallengeCampaignSettings;
  products: { id: string; name: string; isFree: boolean; priceIls?: number | null; status: string }[];
  statistics: ChallengeStatistics;
  consentText: string;
  consentVersion: string;
}

export type ChallengeCouponStatus = 'active' | 'redeemed' | 'expired' | 'cancelled';

export interface ChallengeCouponRow {
  id: string; code: string; email?: string | null; score?: number | null; issuedAt: string; expiresAt?: string | null; status: ChallengeCouponStatus;
  emailStatus?: string | null; orderNumber?: number | null; purchasedGame?: string | null; redeemedAt?: string | null;
  discount?: number | null; paid?: number | null; cancelledAt?: string | null; marketingConsent: boolean;
}

export interface ChallengeCouponDetail {
  id: string; code: string; email?: string | null; score?: number | null; discountPercent: number; issuedAt: string; expiresAt?: string | null;
  expiresAtText?: string | null; status: ChallengeCouponStatus; games: string[]; emailStatus?: string | null; emailSentAt?: string | null;
  emailAttempts: number; emailLastError?: string | null; cancelledAt?: string | null; cancelledBy?: string | null; roomCode?: string | null;
  consent?: { marketingConsent: boolean; consentAt?: string | null; consentVersion?: string | null; consentSource?: string | null } | null;
  uses: { number: number; productName: string; status: string; orderStatus: string; isTest: boolean; originalPrice: number; discount: number; finalPrice: number; createdAt: string; updatedAt: string }[];
  events: { action: string; actor: string; at: string; details: Record<string, unknown> }[];
}

export interface ChallengeCouponFilters { search?: string; status?: string; from?: string; to?: string }

export type CampaignUpdate = Partial<Pick<ChallengeCampaignSettings,
  'name' | 'description' | 'minimumScore' | 'discountPercentage' | 'validityDays' | 'maxCoupons' | 'sourceProductId' | 'productIds' | 'showEntryPopup' | 'showProgress'>>;

function query(f: ChallengeCouponFilters): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) q.set(k, String(v));
  const s = q.toString();
  return s ? '?' + s : '';
}

/** The admin's "Challenge 240" calls (admin session cookie; changes carry the admin header, as everywhere in the admin). */
@Injectable({ providedIn: 'root' })
export class AdminChallengeApi {
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
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(data?.code ?? 'error', data?.message ?? 'אירעה שגיאה. נסו שוב.');
    return data as T;
  }

  view() { return this.request<ChallengeAdminView>('GET', '/api/admin/challenge'); }
  update(u: CampaignUpdate) { return this.request<ChallengeAdminView>('PUT', '/api/admin/challenge', u); }
  setActive(active: boolean) { return this.request<ChallengeAdminView>('POST', '/api/admin/challenge/active', { active }); }
  setPaused(paused: boolean) { return this.request<ChallengeAdminView>('POST', '/api/admin/challenge/issuing', { paused }); }
  coupons(f: ChallengeCouponFilters) { return this.request<ChallengeCouponRow[]>('GET', '/api/admin/challenge/coupons' + query(f)); }
  csvUrl(f: ChallengeCouponFilters) { return '/api/admin/challenge/coupons.csv' + query(f); }
  coupon(id: string) { return this.request<ChallengeCouponDetail>('GET', `/api/admin/challenge/coupons/${id}`); }
  cancel(id: string) { return this.request<ChallengeCouponDetail>('POST', `/api/admin/challenge/coupons/${id}/cancel`); }
  resend(id: string) { return this.request<ChallengeCouponDetail>('POST', `/api/admin/challenge/coupons/${id}/resend`); }
}

/** Styles shared by the three admin parts (the admin page's own look). */
export const ADMIN_CHALLENGE_STYLES = `
  h2 { font-family:var(--font-title); font-size:1.3rem; margin:1.2rem 0 .6rem; }
  h3 { margin:.4rem 0; color:var(--gold-2); }
  .cards { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:.8rem; }
  .stat { display:flex; flex-direction:column; gap:.2rem; padding:1rem; }
  .stat span { color:var(--muted); font-size:.9rem; } .stat b { font-size:1.6rem; color:var(--gold-2); } .stat small { color:var(--muted); }
  .table-wrap { overflow-x:auto; border:1px solid var(--line); border-radius:var(--radius); }
  table { width:100%; border-collapse:collapse; font-size:.9rem; }
  th, td { padding:.5rem .6rem; text-align:start; border-bottom:1px solid rgba(201,162,77,.15); white-space:nowrap; }
  th { background:var(--panel-solid); color:var(--gold-2); }
  label { display:flex; flex-direction:column; gap:.2rem; font-size:.88rem; color:var(--muted); }
  label.check { flex-direction:row; align-items:center; gap:.45rem; color:var(--text); }
  input, select { min-height:40px; }
  select { background:var(--panel-solid); color:var(--text); border:1px solid var(--line); border-radius:10px; padding:.45rem .6rem; }
  .row { display:flex; gap:.5rem; flex-wrap:wrap; align-items:center; }
  .st { padding:.1em .55em; border-radius:999px; border:1px solid var(--line); font-size:.8rem; white-space:nowrap; }
  .st[data-s=active], .st[data-s=on], .st[data-s=sent] { border-color:var(--ok); color:#9be3b4; }
  .st[data-s=redeemed] { border-color:var(--gold); color:var(--gold-2); }
  .st[data-s=expired], .st[data-s=cancelled], .st[data-s=off], .st[data-s=failed] { border-color:var(--bad); color:#ffc2b5; }
  .error { color:#ffc2b5; } .ok { color:#9be3b4; } .small { font-size:.82rem; }
  @media (max-width: 900px) { .cards { grid-template-columns:repeat(2, minmax(0,1fr)); } }
  @media (max-width: 560px) { .cards { grid-template-columns:1fr; } }
`;

export const COUPON_STATUS_LABEL: Record<string, string | undefined> = { active: 'פעיל', redeemed: 'מומש', expired: 'פג תוקף', cancelled: 'בוטל' };
export const EMAIL_STATUS_LABEL: Record<string, string | undefined> = { pending: 'ממתין', sending: 'בשליחה', sent: 'נשלח', failed: 'נכשל', uncertain: 'לא ודאי' };
