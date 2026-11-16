import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CoopPermissionKey } from '@opencoop/shared';
import { PermissionGuard } from './permission.guard';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../decorators/permissions.decorator';

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

  it('denies canViewVolunteers when the permission is missing or false', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(['canViewVolunteers']);
    expect(() => guard.canActivate(context({ coopPermissions: { 'coop-1': {} } }))).toThrow(
      'Insufficient permissions',
    );
    expect(() =>
      guard.canActivate(context({ coopPermissions: { 'coop-1': { canViewVolunteers: false } } })),
    ).toThrow('Insufficient permissions');
    expect(
      guard.canActivate(context({ coopPermissions: { 'coop-1': { canViewVolunteers: true } } })),
    ).toBe(true);
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
  describe('any-of permissions (charge cards)', () => {
    const LIST = { all: undefined, any: ['canViewChargeCards', 'canManageShareholders'] };
    const WRITE = { all: ['canManageShareholders'], any: undefined };

    function route(meta: { all?: string[]; any?: string[] }) {
      (reflector.getAllAndOverride as jest.Mock).mockImplementation((key: string) =>
        key === PERMISSIONS_KEY ? meta.all : key === ANY_PERMISSIONS_KEY ? meta.any : undefined,
      );
    }
    const admin = (perms: Record<string, boolean>) =>
      context({ role: 'COOP_ADMIN', coopPermissions: { 'coop-1': perms } });

    it('lets canViewChargeCards alone read the list but not write', () => {
      route(LIST);
      expect(guard.canActivate(admin({ canViewChargeCards: true }))).toBe(true);
      route(WRITE);
      expect(() => guard.canActivate(admin({ canViewChargeCards: true }))).toThrow(
        'Insufficient permissions',
      );
    });

    it('denies an admin with neither permission, missing or false', () => {
      route(LIST);
      expect(() => guard.canActivate(admin({}))).toThrow('Insufficient permissions');
      expect(() =>
        guard.canActivate(admin({ canViewChargeCards: false, canManageShareholders: false })),
      ).toThrow('Insufficient permissions');
      route(WRITE);
      expect(() => guard.canActivate(admin({}))).toThrow('Insufficient permissions');
    });

    it('lets canManageShareholders alone read and write', () => {
      route(LIST);
      expect(guard.canActivate(admin({ canManageShareholders: true }))).toBe(true);
      route(WRITE);
      expect(guard.canActivate(admin({ canManageShareholders: true }))).toBe(true);
    });

    it('requires both the all-of and the any-of part when a route has both', () => {
      route({ all: ['canViewPII'], any: ['canViewChargeCards', 'canManageShareholders'] });
      expect(() => guard.canActivate(admin({ canViewChargeCards: true }))).toThrow(
        'Insufficient permissions',
      );
      expect(guard.canActivate(admin({ canViewChargeCards: true, canViewPII: true }))).toBe(true);
    });

    it('lets SYSTEM_ADMIN through both', () => {
      route(LIST);
      expect(guard.canActivate(context({ role: 'SYSTEM_ADMIN' }))).toBe(true);
      route(WRITE);
      expect(guard.canActivate(context({ role: 'SYSTEM_ADMIN' }))).toBe(true);
    });

    it('keeps the session and coop errors for any-of routes', () => {
      route(LIST);
      expect(() => guard.canActivate(context({ role: 'COOP_ADMIN' }))).toThrow('Session expired');
      expect(() =>
        guard.canActivate(context({ role: 'COOP_ADMIN', coopPermissions: { other: {} } })),
      ).toThrow('No permissions for this cooperative');
    });
  });
});
