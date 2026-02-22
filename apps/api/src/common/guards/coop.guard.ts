import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

@Injectable()
export class CoopGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const coopId = request.params.coopId;

    if (!user) {
      return false;
    }

    // System admins can access any coop
    if (user.role === 'SYSTEM_ADMIN') {
      return true;
    }

    // Coop admins can only access their assigned coops
    if (user.role === 'COOP_ADMIN') {
      if (!user.coopIds || !user.coopIds.includes(coopId)) {
        throw new ForbiddenException('You do not have access to this cooperative');
      }
      return true;
    }

    return false;
  }
}
