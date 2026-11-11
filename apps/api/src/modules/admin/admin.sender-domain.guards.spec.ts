jest.mock('../documents/documents.service', () => ({
  DocumentsService: class DocumentsServiceMock {},
}));
jest.mock('./reports.service', () => ({
  ReportsService: class ReportsServiceMock {},
}));

import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminController } from './admin.controller';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CoopGuard } from '../../common/guards/coop.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';

/**
 * Runs the guards that AdminController really declares (read from its
 * metadata) against the three sender-domain routes. JwtAuthGuard and
 * SubscriptionGuard are outside this question and are skipped.
 */
const HANDLERS = ['registerSenderDomain', 'checkSenderDomain', 'clearSenderDomain'] as const;

type Handler = (typeof HANDLERS)[number];

function context(handler: Handler, user: Record<string, unknown>, coopId: string) {
  return {
    getHandler: () => AdminController.prototype[handler],
    getClass: () => AdminController,
    switchToHttp: () => ({ getRequest: () => ({ user, params: { coopId }, method: 'POST' }) }),
  } as unknown as ExecutionContext;
}

function declaredGuards(): Array<{ new (...args: never[]): { canActivate: Function } }> {
  return Reflect.getMetadata('__guards__', AdminController) ?? [];
}

function runDeclaredGuards(handler: Handler, user: Record<string, unknown>, coopId: string) {
  const reflector = new Reflector();
  const ctx = context(handler, user, coopId);
  const names = declaredGuards().map((guard) => guard.name);
  expect(names).toEqual(expect.arrayContaining(['RolesGuard', 'CoopGuard', 'PermissionGuard']));
  const rolesOk = new RolesGuard(reflector).canActivate(ctx);
  if (!rolesOk) return false;
  return new CoopGuard().canActivate(ctx) && new PermissionGuard(reflector).canActivate(ctx);
}

const admin = (coopPermissions: Record<string, Record<string, boolean>>, coopIds: string[]) => ({
  id: 'user-1',
  role: 'COOP_ADMIN',
  coopIds,
  coopPermissions,
});

describe('sender-domain routes: authorization', () => {
  it.each(HANDLERS)('%s requires canManageSettings', (handler) => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, AdminController.prototype[handler])).toEqual([
      'canManageSettings',
    ]);
  });

  it.each(HANDLERS)('%s lets an admin with canManageSettings through', (handler) => {
    const user = admin({ 'coop-1': { canManageSettings: true } }, ['coop-1']);
    expect(runDeclaredGuards(handler, user, 'coop-1')).toBe(true);
  });

  it.each(HANDLERS)('%s refuses an admin without canManageSettings', (handler) => {
    const user = admin({ 'coop-1': { canManageSettings: false, canViewShareholders: true } }, [
      'coop-1',
    ]);
    expect(() => runDeclaredGuards(handler, user, 'coop-1')).toThrow(ForbiddenException);
  });

  it.each(HANDLERS)('%s refuses an admin of another coop (cross-tenant)', (handler) => {
    const user = admin({ 'coop-2': { canManageSettings: true } }, ['coop-2']);
    expect(() => runDeclaredGuards(handler, user, 'coop-1')).toThrow(ForbiddenException);
  });

  it.each(HANDLERS)('%s refuses a shareholder', (handler) => {
    const user = { id: 'u', role: 'SHAREHOLDER', coopIds: ['coop-1'] };
    expect(runDeclaredGuards(handler, user, 'coop-1')).toBe(false);
  });

  it.each(HANDLERS)('%s refuses a session without permissions loaded', (handler) => {
    const user = { id: 'u', role: 'COOP_ADMIN', coopIds: ['coop-1'] };
    expect(() => runDeclaredGuards(handler, user, 'coop-1')).toThrow(ForbiddenException);
  });
});

describe('sender-domain routes: tenant comes from the path only', () => {
  const view = { senderDomain: null };
  const senderDomains = {
    register: jest.fn().mockResolvedValue(view),
    check: jest.fn().mockResolvedValue(view),
    clear: jest.fn().mockResolvedValue(view),
  };
  const controller = Object.create(AdminController.prototype) as AdminController;
  Object.assign(controller, { senderDomains });
  const user = { id: 'user-1' } as never;
  const req = { ip: '203.0.113.9', headers: { 'user-agent': 'jest' } } as never;

  it('passes the route coopId, never a body field', async () => {
    await controller.registerSenderDomain('coop-1', user, req, {
      domain: 'a.be',
      fromAddress: 'x@a.be',
      coopId: 'coop-2',
    } as never);
    await controller.checkSenderDomain('coop-1', user, req);
    await controller.clearSenderDomain('coop-1', user, req);
    expect(senderDomains.register.mock.calls[0][0]).toBe('coop-1');
    expect(senderDomains.check.mock.calls[0][0]).toBe('coop-1');
    expect(senderDomains.clear.mock.calls[0][0]).toBe('coop-1');
  });
});
