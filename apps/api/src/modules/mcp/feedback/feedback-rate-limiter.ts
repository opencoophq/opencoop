import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

export const FEEDBACK_COUNTER_STORE = Symbol('FEEDBACK_COUNTER_STORE');

/** Increments a counter and starts its TTL on the first increment. Returns the new count. */
export interface FeedbackCounterStore {
  incrWithTtl(key: string, ttlSeconds: number): Promise<number>;
}

export const FEEDBACK_USER_LIMIT = 5;
export const FEEDBACK_USER_WINDOW_SECONDS = 3600;
export const FEEDBACK_GLOBAL_LIMIT = 30;
export const FEEDBACK_GLOBAL_WINDOW_SECONDS = 86400;

/** Own ioredis client, so acc and prod each count in their own Redis. */
@Injectable()
export class RedisFeedbackCounterStore implements FeedbackCounterStore, OnModuleDestroy {
  private readonly logger = new Logger(RedisFeedbackCounterStore.name);
  private readonly client: Redis;

  constructor() {
    this.client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    // Without a listener ioredis prints every connection error. The message can hold the
    // Redis host, so log a fixed line only, at most once a minute.
    let lastWarning = 0;
    this.client.on('error', () => {
      if (Date.now() - lastWarning < 60_000) return;
      lastWarning = Date.now();
      this.logger.warn('Redis connection error');
    });
  }

  async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    // EXPIRE NX sets the TTL once, in the same transaction, so a key never lives forever.
    const results = await this.client.multi().incr(key).expire(key, ttlSeconds, 'NX').exec();
    const [incrError, count] = results?.[0] ?? [new Error('empty transaction'), null];
    if (incrError || typeof count !== 'number') {
      throw new Error('Redis INCR failed');
    }
    return count;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.status === 'wait' || this.client.status === 'end') {
      this.client.disconnect();
      return;
    }
    await this.client.quit();
  }
}

@Injectable()
export class FeedbackRateLimiter {
  private readonly logger = new Logger(FeedbackRateLimiter.name);

  constructor(@Inject(FEEDBACK_COUNTER_STORE) private readonly store: FeedbackCounterStore) {}

  /** Checks the per-user limit first; the global day counter only counts allowed users. */
  async check(userId: string): Promise<{ allowed: boolean }> {
    try {
      const userCount = await this.store.incrWithTtl(
        `mcp-feedback:user:${userId}`,
        FEEDBACK_USER_WINDOW_SECONDS,
      );
      if (userCount > FEEDBACK_USER_LIMIT) return { allowed: false };

      const day = new Date().toISOString().slice(0, 10);
      const globalCount = await this.store.incrWithTtl(
        `mcp-feedback:global:${day}`,
        FEEDBACK_GLOBAL_WINDOW_SECONDS,
      );
      return { allowed: globalCount <= FEEDBACK_GLOBAL_LIMIT };
    } catch {
      // Fail closed: without a working counter, nobody can flood the issue tracker.
      this.logger.warn('Feedback rate limiter unavailable; refusing the report');
      return { allowed: false };
    }
  }
}
