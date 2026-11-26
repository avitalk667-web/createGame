import { Campaign } from '../core/api.service';
import { raffleLine } from './my-link.page';

describe('MyLinkPage raffle line', () => {
  const base = {
    enabled: true, title: '', prize: '888 ₪', lead: '', body: '', drawLabel: '', drawDate: 'יום ראשון, ג׳ בטבת תשפ״ז — 13/12/2026',
    buttonLabel: '', popupTitle: '', popupBody: '', popupCreateLabel: '', popupLaterLabel: '', drawAt: '2026-12-13T20:00:00+02:00',
  } as Campaign;

  it('shows the prize and the draw date with its hour while the draw is ahead', () => {
    expect(raffleLine({ ...base, serverNow: '2026-11-26T10:00:00Z' })).toEqual({ prize: '888 ₪', when: 'יום ראשון, ג׳ בטבת תשפ״ז — 13/12/2026 בשעה 20:00' });
  });

  it('disappears once the draw has passed or when the campaign is off', () => {
    expect(raffleLine({ ...base, serverNow: '2026-12-13T18:00:01Z' })).toBeNull();
    expect(raffleLine({ ...base, enabled: false, serverNow: '2026-11-26T10:00:00Z' })).toBeNull();
  });
});
