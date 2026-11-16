import { SetMetadata } from '@nestjs/common';
import { CoopPermissionKey } from '@opencoop/shared';

export const PERMISSIONS_KEY = 'permissions';
/** Every listed permission is required. */
export const RequirePermission = (...permissions: CoopPermissionKey[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const ANY_PERMISSIONS_KEY = 'anyPermissions';
/** At least one listed permission is required. Combines with RequirePermission. */
export const RequireAnyPermission = (...permissions: CoopPermissionKey[]) =>
  SetMetadata(ANY_PERMISSIONS_KEY, permissions);
