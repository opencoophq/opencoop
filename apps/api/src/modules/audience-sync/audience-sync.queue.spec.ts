import { enqueueReconcileAll } from './audience-sync.queue';

function queueWith(job: { getState: () => Promise<string>; remove?: () => Promise<void> } | null) {
  return {
    getJob: jest.fn().mockResolvedValue(job),
    add: jest.fn().mockResolvedValue(undefined),
  };
}

describe('enqueueReconcileAll', () => {
  it('adds a deterministic job id when nothing is queued', async () => {
    const queue = queueWith(null);
    await expect(enqueueReconcileAll(queue as never, 'c1', 'cron')).resolves.toEqual({
      queued: true,
      skipped: false,
    });
    expect(queue.add).toHaveBeenCalledWith(
      'reconcile-all',
      { coopId: 'c1', trigger: 'cron' },
      { jobId: 'reconcile-all:c1', removeOnComplete: true, removeOnFail: true },
    );
  });

  it('skips when a job for the coop is already active', async () => {
    const queue = queueWith({ getState: async () => 'active' });
    await expect(enqueueReconcileAll(queue as never, 'c1', 'manual')).resolves.toEqual({
      queued: false,
      skipped: true,
    });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('removes a finished job and enqueues a new one with the same id', async () => {
    const remove = jest.fn().mockResolvedValue(undefined);
    const queue = queueWith({ getState: async () => 'completed', remove });
    await expect(enqueueReconcileAll(queue as never, 'c1', 'cron')).resolves.toEqual({
      queued: true,
      skipped: false,
    });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      'reconcile-all',
      { coopId: 'c1', trigger: 'cron' },
      expect.objectContaining({ jobId: 'reconcile-all:c1' }),
    );
  });
});
