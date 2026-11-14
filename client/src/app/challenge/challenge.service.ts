import { Injectable, signal } from '@angular/core';
import { ApiError, waitMessage } from '../core/api.service';

/** The active challenge as the site may show it (never its counts). */
export interface ChallengeCampaign {
  active: boolean;
  name?: string;
  minimumScore?: number;
  /** "More than X points": minimumScore − 1 (240 for a minimum of 241). */
  scoreAbove?: number;
  discountPercent?: number;
  validityDays?: number;
  sourceProductId?: string;
  showEntryPopup?: boolean;
  showProgress?: boolean;
  issuing?: boolean;
  consentText?: string;
  consentVersion?: string;
}

export interface ChallengeCoupon {
  code: string;
  discountPercent: number;
  issuedAt: string;
  expiresAt: string;
  /** "09.03.2026 בשעה 10:00" — Israel time, written by the server. */
  expiresAtText: string;
  status: 'active' | 'redeemed' | 'expired' | 'cancelled';
  /** Masked, e.g. "d***@gmail.com". */
  email: string;
  emailStatus?: 'pending' | 'sending' | 'sent' | 'failed' | 'uncertain' | null;
  canResend: boolean;
  games: string[];
}

export type ChallengeState =
  | 'inactive' | 'not-participating' | 'not-finished' | 'not-completed' | 'not-eligible'
  | 'eligible' | 'issued' | 'already' | 'paused' | 'quota-full';

export interface ChallengeStatus {
  state: ChallengeState;
  message: string;
  score?: number | null;
  minimumScore: number;
  discountPercent: number;
  coupon?: ChallengeCoupon | null;
}

/** A code that came in a coupon email's link ("?coupon=PX-..."), kept for this visit and filled in on the game page. */
export const pendingCoupon = {
  key: 'px_pending_coupon',
  capture() {
    try {
      const code = new URLSearchParams(location.search).get('coupon');
      if (code && /^[A-Za-z0-9_-]{3,32}$/.test(code)) sessionStorage.setItem(this.key, code.toUpperCase());
    } catch { /* storage blocked: the code can still be typed */ }
  },
  get(): string | null {
    try { return sessionStorage.getItem(this.key); } catch { return null; }
  },
};

/** "Challenge 240" on the player's side: the campaign, the player's status, issuing and resending their coupon. */
@Injectable({ providedIn: 'root' })
export class ChallengeService {
  /** The campaign, loaded once per visit (null until loaded; { active:false } when there is none). */
  readonly campaign = signal<ChallengeCampaign | null>(null);
  private loading?: Promise<ChallengeCampaign>;

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
    if (res.status === 429) throw new ApiError(data?.code ?? 'rate', data?.message ?? waitMessage(res.headers.get('Retry-After')));
    if (!res.ok) throw new ApiError(data?.code ?? 'error', data?.message ?? 'אירעה שגיאה. נסו שוב.');
    return data as T;
  }

  /** Never blocks the game: a failure just means no challenge is shown. */
  load(): Promise<ChallengeCampaign> {
    this.loading ??= this.request<ChallengeCampaign>('GET', '/api/challenge')
      .catch(() => ({ active: false }) as ChallengeCampaign)
      .then((c) => { this.campaign.set(c); return c; });
    return this.loading;
  }

  status(code: string, token: string | null) {
    return this.request<ChallengeStatus>('POST', `/api/challenge/rooms/${encodeURIComponent(code)}/status`, { token });
  }

  issue(code: string, token: string | null, email: string, marketingConsent: boolean) {
    return this.request<ChallengeStatus>('POST', `/api/challenge/rooms/${encodeURIComponent(code)}/coupon`, { token, email, marketingConsent });
  }

  resend(code: string, token: string | null) {
    return this.request<ChallengeStatus>('POST', `/api/challenge/rooms/${encodeURIComponent(code)}/resend`, { token });
  }
}

/** The line under the score while playing (spec 4). */
export function progressText(score: number, minimum: number, discount: number): string {
  if (score >= minimum) return 'כל הכבוד! הגעתם ליעד – ההטבה שלכם מחכה לכם!';
  const left = minimum - score;
  if (score >= minimum * 0.75) return `עוד ${left} נקודות ואתם זכאים לקופון של ${discount}% הנחה!`;
  return `${score} מתוך ${minimum} נקודות – ממשיכים בדרך להטבה!`;
}
