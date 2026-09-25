import { Injectable } from '@nestjs/common';
import { CoopPermissionKey, CoopPermissions, DEFAULT_ROLES } from '@opencoop/shared';
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

// Permissions added after this list went live default to `true` when missing
// from a JWT. A `false` entry still denies access.
export const LEGACY_DEFAULT_TRUE: ReadonlySet<CoopPermissionKey> = new Set<CoopPermissionKey>([
  'canManageMeetings',
]);

export function isPermitted(
  permissions: Partial<CoopPermissions>,
  key: CoopPermissionKey,
): boolean {
  const value = permissions[key];
  if (value === true) return true;
  if (value === undefined && LEGACY_DEFAULT_TRUE.has(key)) return true;
  return false;
}

export interface CoopPermissionsContext {
  permissions: Partial<CoopPermissions>;
  role?: string;
}

/** Live permission check for callers that have no JWT, such as API-key (MCP) requests. */
@Injectable()
export class CoopPermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async permissionsWithRole(userId: string, coopId: string): Promise<CoopPermissionsContext> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        coopAdminOf: {
          where: { coopId },
          take: 1,
          select: {
            permissionOverrides: true,
            roles: {
              select: {
                role: { select: { permissions: true } },
              },
            },
          },
        },
      },
    });
    if (!user) return { permissions: {} };
    if (user.role === 'SYSTEM_ADMIN') {
      return { permissions: { ...DEFAULT_ROLES.Admin }, role: user.role };
    }
    const admin = user.coopAdminOf[0];
    if (!admin) return { permissions: {}, role: user.role };
    return {
      permissions: mergeAdminPermissions(
        admin.roles.map((role) => role.role.permissions),
        admin.permissionOverrides,
      ),
      role: user.role,
    };
  }
}
