import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { CoopPermissionKey, CoopPermissions } from '@opencoop/shared';
import { isPermitted } from '../utils/coop-permissions';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const requiredPermissions =
      this.reflector.getAllAndOverride<CoopPermissionKey[]>(PERMISSIONS_KEY, targets) ?? [];
    const anyPermissions =
      this.reflector.getAllAndOverride<CoopPermissionKey[]>(ANY_PERMISSIONS_KEY, targets) ?? [];

    if (requiredPermissions.length === 0 && anyPermissions.length === 0) {
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
    const hasAny =
      anyPermissions.length === 0 || anyPermissions.some((p) => isPermitted(permissions, p));
    if (!hasAll || !hasAny) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
