import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CoopPermissionKey } from '@opencoop/shared';
import { PermissionGuard } from './permission.guard';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

describe('PermissionGuard', () => {
  const reflector = { getAllAndOverride: jest.fn() } as unknown as Reflector;
  const guard = new PermissionGuard(reflector);

  function context(user: Record<string, unknown>, params = { coopId: 'coop-1' }) {
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => ({ user, params }) }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue([
      'canManageShareholders',
    ] as CoopPermissionKey[]);
  });

  it('allows a legacy permission when the JWT omits it', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(['canManageMeetings']);
    expect(guard.canActivate(context({ coopPermissions: { 'coop-1': {} } }))).toBe(true);
  });

  it('requires present permissions and denies absent or false values', () => {
    expect(
      guard.canActivate(
        context({ coopPermissions: { 'coop-1': { canManageShareholders: true } } }),
      ),
    ).toBe(true);
    expect(() => guard.canActivate(context({ coopPermissions: { 'coop-1': {} } }))).toThrow(
      'Insufficient permissions',
    );
    expect(() =>
      guard.canActivate(
        context({ coopPermissions: { 'coop-1': { canManageShareholders: false } } }),
      ),
    ).toThrow('Insufficient permissions');
  });

  it('allows routes without required permissions and bypasses checks for SYSTEM_ADMIN', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(undefined);
    expect(guard.canActivate(context({}))).toBe(true);

    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(['canManageShareholders']);
    expect(guard.canActivate(context({ role: 'SYSTEM_ADMIN' }))).toBe(true);
  });
});
