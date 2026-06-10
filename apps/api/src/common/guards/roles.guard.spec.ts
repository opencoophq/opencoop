import { RolesGuard } from './roles.guard';
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';

function ctx(user: any): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function guardWithRoles(requiredRoles: string[] | undefined): RolesGuard {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(requiredRoles) } as unknown as Reflector;
  return new RolesGuard(reflector);
}

describe('RolesGuard', () => {
  it('allows the request when no roles are required', () => {
    expect(guardWithRoles(undefined).canActivate(ctx({ role: 'SHAREHOLDER' }))).toBe(true);
  });

  it('denies when roles are required but no user is present', () => {
    expect(guardWithRoles(['COOP_ADMIN']).canActivate(ctx(undefined))).toBe(false);
  });

  it('allows a user whose role is in the required set', () => {
    expect(guardWithRoles(['COOP_ADMIN', 'SYSTEM_ADMIN']).canActivate(ctx({ role: 'COOP_ADMIN' }))).toBe(true);
  });

  it('denies a user whose role is not in the required set', () => {
    expect(guardWithRoles(['SYSTEM_ADMIN']).canActivate(ctx({ role: 'COOP_ADMIN' }))).toBe(false);
  });
});
