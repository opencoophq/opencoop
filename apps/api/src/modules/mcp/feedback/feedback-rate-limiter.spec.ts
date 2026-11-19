import { Logger } from '@nestjs/common';
import { FeedbackCounterStore, FeedbackRateLimiter } from './feedback-rate-limiter';

class FakeCounterStore implements FeedbackCounterStore {
  readonly counts = new Map<string, number>();
  readonly ttls = new Map<string, number>();

  async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const next = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, next);
    if (!this.ttls.has(key)) this.ttls.set(key, ttlSeconds);
    return next;
  }
}

describe('FeedbackRateLimiter', () => {
  let store: FakeCounterStore;
  let limiter: FeedbackRateLimiter;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-18T23:30:00Z'));
    store = new FakeCounterStore();
    limiter = new FeedbackRateLimiter(store);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('allows 5 reports per user, then refuses the 6th', async () => {
    for (let i = 0; i < 5; i++) {
      await expect(limiter.check('u1')).resolves.toEqual({ allowed: true });
    }
    await expect(limiter.check('u1')).resolves.toEqual({ allowed: false });
    await expect(limiter.check('u2')).resolves.toEqual({ allowed: true });
  });

  it('uses an hour TTL for the user key and a day TTL for the UTC-dated global key', async () => {
    await limiter.check('u1');
    expect(store.ttls.get('mcp-feedback:user:u1')).toBe(3600);
    expect(store.ttls.get('mcp-feedback:global:2026-11-18')).toBe(86400);
  });

  it('does not count a refused user in the global counter', async () => {
    for (let i = 0; i < 8; i++) await limiter.check('u1');
    expect(store.counts.get('mcp-feedback:user:u1')).toBe(8);
    expect(store.counts.get('mcp-feedback:global:2026-11-18')).toBe(5);
  });

  it('allows 30 reports a day across users, then refuses', async () => {
    for (let i = 0; i < 30; i++) {
      await expect(limiter.check(`user-${i}`)).resolves.toEqual({ allowed: true });
    }
    await expect(limiter.check('user-30')).resolves.toEqual({ allowed: false });
  });

  it('fails closed with a short warning when Redis throws', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const broken: FeedbackCounterStore = {
      incrWithTtl: jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED redis:6379 u1')),
    };

    await expect(new FeedbackRateLimiter(broken).check('u1')).resolves.toEqual({ allowed: false });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toContain('u1');
    expect(String(warn.mock.calls[0][0])).not.toContain('ECONNREFUSED');
  });
});
