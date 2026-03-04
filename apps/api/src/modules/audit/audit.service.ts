import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const SENSITIVE_FIELDS = new Set([
  'passwordHash',
  'mfaSecret',
  'mfaRecoveryCodes',
  'nationalId',
  'smtpPass',
  'graphClientSecret',
]);

interface Change {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(params: {
    coopId?: string;
    entity: string;
    entityId: string;
    action: 'CREATE' | 'UPDATE' | 'DELETE';
    changes: Change[];
    actorId?: string;
    ipAddress?: string;
  }) {
    if (params.changes.length === 0 && params.action === 'UPDATE') return;

    const maskedChanges = params.changes.map((c) =>
      SENSITIVE_FIELDS.has(c.field)
        ? { field: c.field, oldValue: '***', newValue: '***' }
        : c,
    );

    await this.prisma.auditLog.create({
      data: {
        coopId: params.coopId ?? null,
        entity: params.entity,
        entityId: params.entityId,
        action: params.action,
        changes: maskedChanges as unknown as Prisma.InputJsonValue,
        actorId: params.actorId ?? null,
        ipAddress: params.ipAddress ?? null,
      },
    });
  }

  diff(oldObj: Record<string, unknown>, newObj: Record<string, unknown>): Change[] {
    const changes: Change[] = [];

    for (const key of Object.keys(newObj)) {
      if (newObj[key] === undefined) continue;

      const oldVal = oldObj[key];
      const newVal = newObj[key];

      // Handle JSON/object fields (e.g., address)
      if (
        typeof oldVal === 'object' &&
        typeof newVal === 'object' &&
        oldVal !== null &&
        newVal !== null
      ) {
        if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
          changes.push({ field: key, oldValue: oldVal, newValue: newVal });
        }
        continue;
      }

      // Handle Date comparisons
      if (oldVal instanceof Date) {
        const newDate = newVal instanceof Date ? newVal : new Date(newVal as string);
        if (oldVal.getTime() !== newDate.getTime()) {
          changes.push({
            field: key,
            oldValue: oldVal.toISOString(),
            newValue: newDate.toISOString(),
          });
        }
        continue;
      }

      // Simple equality
      if (String(oldVal ?? '') !== String(newVal ?? '')) {
        changes.push({ field: key, oldValue: oldVal ?? null, newValue: newVal ?? null });
      }
    }

    return changes;
  }

  async findByEntity(
    entity: string,
    entityId: string,
    params: { page?: number; limit?: number } = {},
  ) {
    const page = params.page || 1;
    const limit = params.limit || 50;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: { entity, entityId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          actor: { select: { id: true, email: true, name: true } },
        },
      }),
      this.prisma.auditLog.count({ where: { entity, entityId } }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findByCoop(
    coopId: string,
    params: { entity?: string; entityId?: string; page?: number; limit?: number } = {},
  ) {
    const page = params.page || 1;
    const limit = params.limit || 50;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { coopId };
    if (params.entity) where.entity = params.entity;
    if (params.entityId) where.entityId = params.entityId;

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          actor: { select: { id: true, email: true, name: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findAll(
    params: {
      coopId?: string;
      entity?: string;
      entityId?: string;
      actorId?: string;
      page?: number;
      limit?: number;
    } = {},
  ) {
    const page = params.page || 1;
    const limit = params.limit || 50;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (params.coopId) where.coopId = params.coopId;
    if (params.entity) where.entity = params.entity;
    if (params.entityId) where.entityId = params.entityId;
    if (params.actorId) where.actorId = params.actorId;

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          actor: { select: { id: true, email: true, name: true } },
          coop: { select: { id: true, name: true, slug: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}
