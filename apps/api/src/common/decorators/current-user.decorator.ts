import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { CoopPermissions } from '@opencoop/shared';

export interface CurrentUserData {
  id: string;
  email: string;
  role: string;
  coopIds?: string[];
  coopPermissions?: Record<string, CoopPermissions>;
}

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): CurrentUserData => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
