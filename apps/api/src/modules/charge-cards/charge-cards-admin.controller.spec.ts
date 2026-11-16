import 'reflect-metadata';
import { ExecutionContext, ForbiddenException, RequestMethod } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import {
  ANY_PERMISSIONS_KEY,
  PERMISSIONS_KEY,
} from '../../common/decorators/permissions.decorator';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { ChargeCardsAdminController } from './charge-cards-admin.controller';
import { ChargeCardsAdminService } from './charge-cards-admin.service';

const proto = ChargeCardsAdminController.prototype as unknown as Record<string, unknown>;

function routeHandlers(): string[] {
  return Object.getOwnPropertyNames(proto).filter(
    (name) =>
      name !== 'constructor' &&
      typeof proto[name] === 'function' &&
      Reflect.getMetadata(PATH_METADATA, proto[name] as object) !== undefined,
  );
}

describe('ChargeCardsAdminController permissions', () => {
  it('has no class-level permission, so each handler must state its own', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, ChargeCardsAdminController)).toBeUndefined();
    expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, ChargeCardsAdminController)).toBeUndefined();
  });

  it('gives every route a permission (fail closed for new routes)', () => {
    const handlers = routeHandlers();
    expect(handlers.length).toBeGreaterThanOrEqual(7);
    for (const name of handlers) {
      const all = Reflect.getMetadata(PERMISSIONS_KEY, proto[name] as object);
      const any = Reflect.getMetadata(ANY_PERMISSIONS_KEY, proto[name] as object);
      expect({ name, guarded: (all?.length ?? 0) > 0 || (any?.length ?? 0) > 0 }).toEqual({
        name,
        guarded: true,
      });
    }
  });

  // Every route, with the exact permission metadata it must carry.
  // all: every listed permission is required. any: one of them is enough.
  const HAND_OUT = { all: undefined, any: ['canManageChargeCards', 'canManageShareholders'] };
  const MANAGE_ONLY = { all: ['canManageShareholders'], any: undefined };
  const ROUTES: Record<string, { method: RequestMethod; all?: string[]; any?: string[] }> = {
    list: {
      method: RequestMethod.GET,
      all: undefined,
      any: ['canViewChargeCards', 'canManageChargeCards', 'canManageShareholders'],
    },
    issue: { method: RequestMethod.POST, ...HAND_OUT },
    markPaid: { method: RequestMethod.POST, ...HAND_OUT },
    block: { method: RequestMethod.POST, ...MANAGE_ONLY },
    unblock: { method: RequestMethod.POST, ...MANAGE_ONLY },
    markLost: { method: RequestMethod.POST, ...MANAGE_ONLY },
    markProviderSyncDone: { method: RequestMethod.POST, ...MANAGE_ONLY },
    cancel: { method: RequestMethod.POST, ...MANAGE_ONLY },
  };

  it('lists every route in the permission table', () => {
    expect(routeHandlers().sort()).toEqual(Object.keys(ROUTES).sort());
  });

  it.each(Object.entries(ROUTES))('gives %s exactly its permissions', (name, expected) => {
    const handler = proto[name] as object;
    expect({
      method: Reflect.getMetadata(METHOD_METADATA, handler),
      all: Reflect.getMetadata(PERMISSIONS_KEY, handler),
      any: Reflect.getMetadata(ANY_PERMISSIONS_KEY, handler),
    }).toEqual(expected);
  });
});

describe('ChargeCardsAdminController through PermissionGuard', () => {
  const guard = new PermissionGuard(new Reflector());
  const ALL_ROUTES = [
    'list',
    'issue',
    'markPaid',
    'block',
    'unblock',
    'markLost',
    'markProviderSyncDone',
    'cancel',
  ];

  function context(handler: string, perms: Record<string, boolean>): ExecutionContext {
    return {
      getHandler: () => proto[handler],
      getClass: () => ChargeCardsAdminController,
      switchToHttp: () => ({
        getRequest: () => ({
          user: { id: 'u1', role: 'COOP_ADMIN', coopPermissions: { 'coop-1': perms } },
          params: { coopId: 'coop-1', id: 'card-1' },
        }),
      }),
    } as unknown as ExecutionContext;
  }

  function allowed(handler: string, perms: Record<string, boolean>): boolean {
    try {
      return guard.canActivate(context(handler, perms)) === true;
    } catch (error) {
      if (error instanceof ForbiddenException) return false;
      throw error;
    }
  }

  function outcomes(perms: Record<string, boolean>): Record<string, boolean> {
    return Object.fromEntries(ALL_ROUTES.map((name) => [name, allowed(name, perms)]));
  }

  it('lets canManageChargeCards alone list, issue and mark paid, and nothing else', () => {
    expect(outcomes({ canManageChargeCards: true, canManageShareholders: false })).toEqual({
      list: true,
      issue: true,
      markPaid: true,
      block: false,
      unblock: false,
      markLost: false,
      markProviderSyncDone: false,
      cancel: false,
    });
  });

  it('lets canViewChargeCards alone only list', () => {
    expect(outcomes({ canViewChargeCards: true, canManageShareholders: false })).toEqual({
      list: true,
      issue: false,
      markPaid: false,
      block: false,
      unblock: false,
      markLost: false,
      markProviderSyncDone: false,
      cancel: false,
    });
  });

  it('answers 403 everywhere to an admin without permissions', () => {
    const none: Record<string, boolean>[] = [
      {},
      { canViewChargeCards: false, canManageChargeCards: false },
    ];
    for (const perms of none) {
      expect(Object.values(outcomes(perms)).every((ok) => !ok)).toBe(true);
    }
  });

  it('lets canManageShareholders alone do everything', () => {
    expect(Object.values(outcomes({ canManageShareholders: true })).every(Boolean)).toBe(true);
  });
});

describe('ChargeCardsAdminController.list PII', () => {
  const row = {
    id: 'card-1',
    label: 'Auto Fien',
    shareholderId: 'sh-abcd1234',
    shareholderNumber: 7,
    shareholderName: 'Fien Vermeulen',
    shareholderEmail: 'fien@example.be',
  };
  const service = { list: jest.fn() };
  const controller = new ChargeCardsAdminController(service as unknown as ChargeCardsAdminService);

  beforeEach(() => {
    service.list.mockResolvedValue([row]);
  });

  function user(perms: Record<string, boolean>, role = 'COOP_ADMIN') {
    return {
      id: 'u1',
      email: 'admin@example.be',
      role,
      coopPermissions: { 'coop-1': perms },
    } as any;
  }

  it('returns names and emails to an admin with canViewPII', async () => {
    await expect(
      controller.list('coop-1', {}, user({ canViewChargeCards: true, canViewPII: true })),
    ).resolves.toEqual([row]);
  });

  it('masks names and emails without canViewPII and keeps the ids', async () => {
    const [masked] = await controller.list(
      'coop-1',
      { todo: 'true' },
      user({ canViewChargeCards: true, canViewPII: false }),
    );
    expect(masked).toEqual({
      ...row,
      shareholderName: 'Aandeelhouder #7',
      shareholderEmail: '***',
    });
    expect(service.list).toHaveBeenCalledWith('coop-1', { status: undefined, todo: true });
  });

  it('does not mask for SYSTEM_ADMIN', async () => {
    await expect(
      controller.list('coop-1', {}, user({ canViewPII: false }, 'SYSTEM_ADMIN')),
    ).resolves.toEqual([row]);
  });
});
