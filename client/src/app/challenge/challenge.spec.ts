import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ChallengeCoupon, ChallengeService, progressText } from './challenge.service';
import { CouponEmailFormComponent } from './coupon-email-form.component';
import { CouponEntryPopupComponent } from './coupon-entry-popup.component';
import { CouponInputComponent } from './coupon-input.component';
import { CouponProgressComponent } from './coupon-progress.component';
import { CouponResultComponent } from './coupon-result.component';

const ACTIVE = {
  active: true, name: 'אתגר 240', minimumScore: 241, scoreAbove: 240, discountPercent: 10, validityDays: 8,
  showEntryPopup: true, showProgress: true, issuing: true, consentText: 'אני מסכים/ה לקבל דיוור', consentVersion: 'v1',
};

const COUPON: ChallengeCoupon = {
  code: 'PX-AB23CD45', discountPercent: 10, issuedAt: '2026-03-01T08:00:00Z', expiresAt: '2026-03-09T08:00:00Z',
  expiresAtText: '09.03.2026 בשעה 10:00', status: 'active', email: 'd***@gmail.com', emailStatus: 'sent', canResend: true, games: ['המבוך'],
};

/** A ChallengeService whose campaign is already loaded (no network). */
function withCampaign(c: object) {
  const svc = TestBed.inject(ChallengeService);
  svc.campaign.set(c as never);
  spyOn(svc, 'load').and.resolveTo(c as never);
  return svc;
}

describe('Challenge 240 — progress text', () => {
  it('follows the examples of the spec', () => {
    expect(progressText(100, 241, 10)).toBe('100 מתוך 241 נקודות – ממשיכים בדרך להטבה!');
    expect(progressText(200, 241, 10)).toBe('עוד 41 נקודות ואתם זכאים לקופון של 10% הנחה!');
    expect(progressText(241, 241, 10)).toBe('כל הכבוד! הגעתם ליעד – ההטבה שלכם מחכה לכם!');
    expect(progressText(240, 241, 10)).toBe('עוד 1 נקודות ואתם זכאים לקופון של 10% הנחה!');
  });
});

describe('Challenge 240 — components', () => {
  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  it('shows the progress only while the campaign is on', () => {
    withCampaign(ACTIVE);
    const f = TestBed.createComponent(CouponProgressComponent);
    f.componentRef.setInput('score', 200);
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('עוד 41 נקודות');

    TestBed.inject(ChallengeService).campaign.set({ active: false });
    f.detectChanges();
    expect(f.nativeElement.textContent.trim()).toBe('');
  });

  it('hides the progress when the admin turned it off', () => {
    withCampaign({ ...ACTIVE, showProgress: false });
    const f = TestBed.createComponent(CouponProgressComponent);
    f.componentRef.setInput('score', 260);
    f.detectChanges();
    expect(f.nativeElement.textContent.trim()).toBe('');
  });

  it('shows the entry popup once per game and highlights 240 points and 10%', async () => {
    withCampaign(ACTIVE);
    const f = TestBed.createComponent(CouponEntryPopupComponent);
    f.componentRef.setInput('code', 'ABC123');
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    const text: string = f.nativeElement.textContent;
    expect(text).toContain('יש לכם אתגר חדש!');
    expect(text).toContain('יותר מ-240 נקודות');
    expect(text).toContain('10% הנחה');
    expect(text).toContain('ההטבה מוגבלת בזמן ובכמות.');
    expect(text).not.toContain('חנוכה');
    (f.nativeElement.querySelector('button.big') as HTMLButtonElement).click();
    f.detectChanges();
    expect(f.nativeElement.textContent.trim()).toBe('');

    // the same game again in this tab: not shown again
    const again = TestBed.createComponent(CouponEntryPopupComponent);
    again.componentRef.setInput('code', 'ABC123');
    again.detectChanges();
    await again.whenStable();
    again.detectChanges();
    expect(again.nativeElement.textContent.trim()).toBe('');
  });

  it('does not show the entry popup when the campaign is off', async () => {
    withCampaign({ active: false });
    const f = TestBed.createComponent(CouponEntryPopupComponent);
    f.componentRef.setInput('code', 'XYZ999');
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    expect(f.nativeElement.textContent.trim()).toBe('');
  });

  it('keeps the marketing box unticked and checks the address before sending', async () => {
    const svc = withCampaign(ACTIVE);
    const issue = spyOn(svc, 'issue');
    const f = TestBed.createComponent(CouponEmailFormComponent);
    f.componentRef.setInput('code', 'ABC123');
    f.componentRef.setInput('consentText', ACTIVE.consentText);
    f.detectChanges();
    const box = f.nativeElement.querySelector('input[type=checkbox]') as HTMLInputElement;
    expect(box.checked).toBeFalse();
    expect(f.nativeElement.textContent).toContain(ACTIVE.consentText);
    expect(f.nativeElement.textContent).toContain('קבלת הקופון שלי');

    f.componentInstance.email.set('not-an-address');
    await f.componentInstance.submit();
    f.detectChanges();
    expect(issue).not.toHaveBeenCalled();
    expect(f.nativeElement.textContent).toContain('כתובת המייל אינה תקינה');
  });

  it('sends the address and the separate consent to the server', async () => {
    const svc = withCampaign(ACTIVE);
    const issue = spyOn(svc, 'issue').and.resolveTo({ state: 'issued', message: '', minimumScore: 241, discountPercent: 10, coupon: COUPON });
    const f = TestBed.createComponent(CouponEmailFormComponent);
    f.componentRef.setInput('code', 'ABC123');
    f.componentRef.setInput('token', 'seat-token');
    f.componentRef.setInput('consentText', ACTIVE.consentText);
    f.detectChanges();
    f.componentInstance.email.set(' dana@gmail.com ');
    f.componentInstance.consent.set(true);
    await f.componentInstance.submit();
    expect(issue).toHaveBeenCalledWith('ABC123', 'seat-token', 'dana@gmail.com', true);
  });

  it('shows the coupon code and its expiry prominently', () => {
    const f = TestBed.createComponent(CouponResultComponent);
    f.componentRef.setInput('coupon', COUPON);
    f.detectChanges();
    const text: string = f.nativeElement.textContent;
    expect(text).toContain('PX-AB23CD45');
    expect(text).toContain('תוקף עד:');
    expect(text).toContain('09.03.2026 בשעה 10:00');
    expect(text).toContain('העתקת קוד הקופון');
    expect(text).toContain('מעבר למשחקים');
    expect(f.nativeElement.querySelector('.expiry b').textContent).toContain('09.03.2026');
  });

  it('asks "have a coupon code?" on the purchase page and shows the server\'s discount', () => {
    const f = TestBed.createComponent(CouponInputComponent);
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('יש לכם קוד קופון?');
    f.componentRef.setInput('quote', { code: 'PX-AB23CD45', kind: 'percent', value: 10, originalPrice: 88, discount: 8.8, finalPrice: 79.2, currency: 'ILS' });
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('8.80 ₪');
  });
});
