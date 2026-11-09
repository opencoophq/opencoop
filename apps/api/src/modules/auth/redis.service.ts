import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private client: Redis;

  constructor(private configService: ConfigService) {
    this.client = new Redis(this.configService.get<string>('REDIS_URL') || 'redis://localhost:6379');
  }

  async setChallenge(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.setex(key, ttlSeconds, value);
  }

  async getChallenge(key: string): Promise<string | null> {
    // GETDEL reads and deletes in one step, so a challenge cannot be replayed.
    return this.client.getdel(key);
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}
