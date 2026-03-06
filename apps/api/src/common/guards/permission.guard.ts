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

    // Backwards compat: old JWTs without coopPermissions default to full access
    if (!user.coopPermissions) {
      return true;
    }

    if (!permissions) {
      throw new ForbiddenException('No permissions for this cooperative');
    }

    const hasAll = requiredPermissions.every((p) => permissions[p] === true);
    if (!hasAll) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
