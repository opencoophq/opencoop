import { Injectable } from '@nestjs/common';
import { CoopPermissionKey } from '@opencoop/shared';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * OR-merge permissions across all roles assigned to a CoopAdmin, then apply
 * the per-admin overrides on top. An admin with N roles has the union of
 * their permissions: as soon as ANY role grants `canX`, the admin has `canX`.
 * Overrides win unconditionally — a `false` override switches a granted
 * permission off, a `true` override grants something no role provided.
 */
export function mergeAdminPermissions(
  rolePermissionsList: unknown[],
  overrides: unknown,
): Record<string, boolean> {
  const merged: Record<string, boolean> = {};
  for (const perms of rolePermissionsList) {
    const obj = (perms ?? {}) as Record<string, boolean>;
    for (const [key, value] of Object.entries(obj)) {
      merged[key] = merged[key] || value === true;
    }
  }
  const overrideObj = (overrides ?? {}) as Record<string, boolean>;
  return { ...merged, ...overrideObj };
}

/** Live permission check for callers that have no JWT, such as API-key (MCP) requests. */
@Injectable()
export class CoopPermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async has(userId: string, coopId: string, key: CoopPermissionKey): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user) return false;
    if (user.role === 'SYSTEM_ADMIN') return true;
    const admin = await this.prisma.coopAdmin.findFirst({
      where: { userId, coopId },
      include: { roles: { include: { role: true } } },
    });
    if (!admin) return false;
    const merged = mergeAdminPermissions(admin.roles.map((r) => r.role.permissions), admin.permissionOverrides);
    return merged[key] === true;
  }
}
