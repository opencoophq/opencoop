import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { CoopPermissions } from '@opencoop/shared';

export interface CurrentUserData {
  id: string;
  email: string;
  role: string;
  coopIds?: string[];
  coopPermissions?: Record<string, CoopPermissions>;
  /** Refresh-token row id. Absent on access tokens issued before session rotation. */
  sid?: string;
  /** Unix seconds when that session token was issued. */
  sst?: number;
}

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): CurrentUserData => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
