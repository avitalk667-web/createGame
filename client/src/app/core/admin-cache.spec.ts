import { TestBed } from '@angular/core/testing';
import { AdminChallengeApi } from '../challenge/admin/admin-challenge.api';
import { AdminTreasureApi } from '../pages/admin-treasure.component';
import { ADMIN_CACHE_TTL_MS, adminCache, adminDataAt } from './admin-cache';
import { AdminApiService } from './admin-api.service';

/** The admin area's one-minute memory: entering a tab may reuse an answer; nothing else ever does. */
describe('admin cache', () => {
  let calls: { method: string; url: string }[];
  let answer: () => Promise<Response>;
  let api: AdminApiService;

  const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

  beforeEach(() => {
    adminCache.clear();
    calls = [];
    let n = 0;
    answer = () => json({ n: ++n });
    spyOn(window, 'fetch').and.callFake(((url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', url });
      return answer();
    }) as typeof fetch);
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(2026, 10, 19, 12, 0, 0));
    api = TestBed.inject(AdminApiService);
  });

  afterEach(() => jasmine.clock().uninstall());

  const gets = () => calls.filter((c) => c.method === 'GET').length;

  it('shows the same answer when a tab is entered again within a minute, as a copy', async () => {
    const first = await api.cached().draw();
    jasmine.clock().tick(ADMIN_CACHE_TTL_MS - 1000);
    const again = await api.cached().draw();
    expect(gets()).toBe(1);
    expect(again).toEqual(first);
    expect(again).not.toBe(first);
    // the time shown is when the server answered, not when the tab was entered again
    expect(adminDataAt()).toBe(new Date(2026, 10, 19, 12, 0, 0).getTime());
  });

  it('asks the server again after a minute', async () => {
    await api.cached().draw();
    jasmine.clock().tick(ADMIN_CACHE_TTL_MS + 1);
    const fresh = await api.cached().draw();
    expect(gets()).toBe(2);
    expect(fresh).toEqual({ n: 2 } as any);
  });

  it('never answers the refresh button, the filters or any other call from memory', async () => {
    await api.cached().draw();
    const fresh = await api.draw();
    expect(gets()).toBe(2);
    expect(fresh).toEqual({ n: 2 } as any);
    // and that fresh answer is what the next entry shows
    expect(await api.cached().draw()).toEqual({ n: 2 } as any);
    expect(gets()).toBe(2);
  });

  it('keeps each address apart (another filter is another answer)', async () => {
    await api.cached().statistics('2026-11-01', '2026-11-19', 'day');
    await api.cached().statistics('2026-11-01', '2026-11-19', 'week');
    expect(gets()).toBe(2);
  });

  it('forgets everything after any change, also from another admin screen and also when the change failed', async () => {
    await api.cached().draw();
    await api.setCouponActive('c1', false);
    await api.cached().draw();
    expect(gets()).toBe(2);

    await TestBed.inject(AdminTreasureApi).setGift('g1', true);
    await api.cached().draw();
    expect(gets()).toBe(3);

    answer = () => json({ code: 'bad', message: 'נכשל' }, 400);
    await expectAsync(TestBed.inject(AdminChallengeApi).cancel('x')).toBeRejected();
    answer = () => json({ n: 99 });
    expect(await api.cached().draw()).toEqual({ n: 99 } as any);
  });

  it('does not keep an answer that was on its way while a change was made', async () => {
    let release!: () => void;
    answer = () => new Promise((resolve) => (release = () => resolve(new Response(JSON.stringify({ old: true }), { status: 200 }))));
    const slow = api.cached().draw();
    answer = () => json({ saved: true });
    await api.setCouponActive('c1', true);
    release();
    expect(await slow).toEqual({ old: true } as any);
    answer = () => json({ now: true });
    expect(await api.cached().draw()).toEqual({ now: true } as any);
  });

  it('never keeps an error', async () => {
    answer = () => json({ code: 'error', message: 'x' }, 500);
    await expectAsync(api.cached().draw()).toBeRejected();
    answer = () => json({ ok: true });
    expect(await api.cached().draw()).toEqual({ ok: true } as any);
    expect(gets()).toBe(2);
  });

  it('the refresh button forgets everything', async () => {
    await api.cached().draw();
    adminCache.clear();
    await api.cached().draw();
    expect(gets()).toBe(2);
  });
});
