import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ApiKeysService {
  private lastUsedCache = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, coopId: string, name: string) {
    const rawKey = 'oc_' + randomBytes(20).toString('hex');
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    const prefix = rawKey.substring(0, 11);

    const apiKey = await this.prisma.apiKey.create({
      data: { keyHash, prefix, name, userId, coopId },
      select: { id: true, prefix: true, name: true, createdAt: true },
    });

    return { ...apiKey, rawKey };
  }

  async validate(rawKey: string): Promise<{ userId: string; coopId: string } | null> {
    const keyHash = createHash('sha256').update(rawKey).digest('hex');

    const apiKey = await this.prisma.apiKey.findUnique({
      where: { keyHash },
      include: { user: { select: { id: true, role: true } } },
    });

    if (!apiKey || apiKey.revokedAt) return null;

    const { user } = apiKey;
    if (user.role === 'SYSTEM_ADMIN') {
      this.touchLastUsed(apiKey.id);
      return { userId: apiKey.userId, coopId: apiKey.coopId };
    }

    if (user.role === 'COOP_ADMIN') {
      const membership = await this.prisma.coopAdmin.findFirst({
        where: { userId: apiKey.userId, coopId: apiKey.coopId },
      });
      if (!membership) return null;

      this.touchLastUsed(apiKey.id);
      return { userId: apiKey.userId, coopId: apiKey.coopId };
    }

    return null;
  }

  async findByUser(userId: string, coopId: string, isSystemAdmin = false) {
    return this.prisma.apiKey.findMany({
      where: {
        coopId,
        revokedAt: null,
        ...(!isSystemAdmin ? { userId } : {}),
      },
      select: { id: true, prefix: true, name: true, createdAt: true, lastUsedAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revoke(keyId: string, userId: string, isSystemAdmin = false) {
    const apiKey = await this.prisma.apiKey.findUnique({
      where: { id: keyId },
      select: { id: true, userId: true },
    });

    if (!apiKey) throw new NotFoundException('API key not found');
    if (!isSystemAdmin && apiKey.userId !== userId) {
      throw new ForbiddenException("Cannot revoke another user's key");
    }

    await this.prisma.apiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
    });
  }

  /** Debounced lastUsedAt update -- at most once per minute per key */
  private touchLastUsed(keyId: string) {
    const now = Date.now();
    const lastTouch = this.lastUsedCache.get(keyId) ?? 0;
    if (now - lastTouch < 60_000) return;

    this.lastUsedCache.set(keyId, now);
    this.prisma.apiKey
      .update({ where: { id: keyId }, data: { lastUsedAt: new Date() } })
      .catch(() => {}); // fire-and-forget
  }
}
