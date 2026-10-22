import { Queue } from 'bull';

/** Job states that still occupy the coop's reconcile-all slot. */
const IN_FLIGHT = new Set(['waiting', 'active', 'delayed', 'paused', 'stuck']);

export interface EnqueueReconcileAllResult {
  queued: boolean;
  skipped: boolean;
}

export function reconcileAllJobId(coopId: string): string {
  return `reconcile-all:${coopId}`;
}

/**
 * One reconcile-all job per coop. A waiting or active job is left alone.
 * A finished job is removed so the deterministic id can be reused.
 * A duplicate-id add (two replicas raced) is a skip, not an error, so Bull
 * does not retry it.
 */
export async function enqueueReconcileAll(
  queue: Pick<Queue, 'add' | 'getJob'>,
  coopId: string,
  trigger: 'cron' | 'manual',
): Promise<EnqueueReconcileAllResult> {
  const jobId = reconcileAllJobId(coopId);
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (IN_FLIGHT.has(state)) return { queued: false, skipped: true };
    try {
      await existing.remove();
    } catch {
      const current = await queue.getJob(jobId);
      if (current && IN_FLIGHT.has(await current.getState())) {
        return { queued: false, skipped: true };
      }
    }
  }

  try {
    await queue.add(
      'reconcile-all',
      { coopId, trigger },
      { jobId, removeOnComplete: true, removeOnFail: true },
    );
    return { queued: true, skipped: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/already exists/i.test(message)) return { queued: false, skipped: true };
    throw err;
  }
}
