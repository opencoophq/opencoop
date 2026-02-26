import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BillingService } from '../../modules/billing/billing.service';
import { SKIP_SUBSCRIPTION_CHECK_KEY } from '../decorators/skip-subscription-check.decorator';

@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private billingService: BillingService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check for @SkipSubscriptionCheck() on handler or class
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_SUBSCRIPTION_CHECK_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const request = context.switchToHttp().getRequest();

    // Only block write operations
    const method = request.method?.toUpperCase();
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return true;
    }

    // System admins bypass subscription check
    const user = request.user;
    if (user?.role === 'SYSTEM_ADMIN') {
      return true;
    }

    // Check if the coop is read-only
    const coopId = request.params?.coopId;
    if (!coopId) return true;

    const readOnly = await this.billingService.isReadOnly(coopId);
    if (readOnly) {
      throw new ForbiddenException({
        statusCode: 403,
        message: 'Your subscription has expired. Please subscribe to continue.',
        error: 'Forbidden',
        code: 'SUBSCRIPTION_REQUIRED',
      });
    }

    return true;
  }
}
