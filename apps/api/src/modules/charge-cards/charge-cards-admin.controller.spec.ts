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

  it('requires canManageShareholders on every POST route', () => {
    const posts = routeHandlers().filter(
      (name) => Reflect.getMetadata(METHOD_METADATA, proto[name] as object) === RequestMethod.POST,
    );
    expect(posts.sort()).toEqual(
      ['block', 'cancel', 'issue', 'markLost', 'markPaid', 'markProviderSyncDone', 'unblock'].sort(),
    );
    for (const name of posts) {
      expect({ name, all: Reflect.getMetadata(PERMISSIONS_KEY, proto[name] as object) }).toEqual({
        name,
        all: ['canManageShareholders'],
      });
      expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, proto[name] as object)).toBeUndefined();
    }
  });

  it('lets canViewChargeCards or canManageShareholders read the list', () => {
    const list = ChargeCardsAdminController.prototype.list;
    expect(Reflect.getMetadata(METHOD_METADATA, list)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, list)).toBeUndefined();
    expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, list)).toEqual([
      'canViewChargeCards',
      'canManageShareholders',
    ]);
  });
});

describe('ChargeCardsAdminController.markPaid through PermissionGuard', () => {
  const guard = new PermissionGuard(new Reflector());

  function context(perms: Record<string, boolean>): ExecutionContext {
    return {
      getHandler: () => ChargeCardsAdminController.prototype.markPaid,
      getClass: () => ChargeCardsAdminController,
      switchToHttp: () => ({
        getRequest: () => ({
          user: { id: 'u1', role: 'COOP_ADMIN', coopPermissions: { 'coop-1': perms } },
          params: { coopId: 'coop-1', id: 'card-1' },
        }),
      }),
    } as unknown as ExecutionContext;
  }

  it('answers 403 to a view-only admin (canViewChargeCards only)', () => {
    expect(() =>
      guard.canActivate(context({ canViewChargeCards: true, canManageShareholders: false })),
    ).toThrow(ForbiddenException);
  });

  it('lets an admin with canManageShareholders through', () => {
    expect(guard.canActivate(context({ canManageShareholders: true }))).toBe(true);
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
