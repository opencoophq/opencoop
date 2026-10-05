jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

import { ShareholderStatusScheduler } from './shareholder-status.scheduler';

describe('ShareholderStatusScheduler.nightlyTick', () => {
  it('reconciles statuses first, then syncs charge cards', async () => {
    const order: string[] = [];
    const statuses = {
      reconcileAll: jest.fn(async () => {
        order.push('reconcile');
        return 0;
      }),
    };
    const cards = {
      syncAll: jest.fn(async () => {
        order.push('cards');
        return { blocked: 0, unblocked: 0, cancelled: 0 };
      }),
    };

    await new ShareholderStatusScheduler(statuses as any, cards as any).nightlyTick();

    expect(order).toEqual(['reconcile', 'cards']);
  });

  it('still syncs charge cards when the reconcile fails', async () => {
    const statuses = { reconcileAll: jest.fn().mockRejectedValue(new Error('boom')) };
    const cards = { syncAll: jest.fn().mockResolvedValue({ blocked: 0, unblocked: 0, cancelled: 0 }) };

    await new ShareholderStatusScheduler(statuses as any, cards as any).nightlyTick();

    expect(cards.syncAll).toHaveBeenCalled();
  });
});
