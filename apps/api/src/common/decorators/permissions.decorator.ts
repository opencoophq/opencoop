import { SetMetadata } from '@nestjs/common';
import { CoopPermissionKey } from '@opencoop/shared';

export const PERMISSIONS_KEY = 'permissions';
export const RequirePermission = (...permissions: CoopPermissionKey[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
