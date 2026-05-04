import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { CoopPermissionKey, CoopPermissions } from '@opencoop/shared';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<CoopPermissionKey[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const coopId = request.params.coopId;

    // System admins bypass permission checks
    if (user.role === 'SYSTEM_ADMIN') {
      return true;
    }

    const permissions: CoopPermissions | undefined = user.coopPermissions?.[coopId];

    if (!user.coopPermissions) {
      throw new ForbiddenException('Session expired — please log in again');
    }

    if (!permissions) {
      throw new ForbiddenException('No permissions for this cooperative');
    }

    const hasAll = requiredPermissions.every((p) => isPermitted(permissions, p));
    if (!hasAll) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}

// Permissions added after this list went live default to `true` when missing
// from a JWT — so an access token issued before the deploy doesn't lock the
// user out of a feature they previously had access to. A `false` entry still
// denies (an admin who actively unchecked the permission should stay denied).
// Drop entries here once the longest-lived refresh token has rotated past
// the rollout date.
const LEGACY_DEFAULT_TRUE: ReadonlySet<CoopPermissionKey> = new Set<CoopPermissionKey>([
  'canManageMeetings',
]);

function isPermitted(permissions: CoopPermissions, p: CoopPermissionKey): boolean {
  const value = permissions[p];
  if (value === true) return true;
  if (value === undefined && LEGACY_DEFAULT_TRUE.has(p)) return true;
  return false;
}
