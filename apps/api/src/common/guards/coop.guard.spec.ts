import { CoopGuard } from './coop.guard';
import { ForbiddenException, ExecutionContext } from '@nestjs/common';

function ctx(user: any, coopId: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user, params: { coopId } }) }),
  } as unknown as ExecutionContext;
}

describe('CoopGuard', () => {
  const guard = new CoopGuard();

  it('denies when no user is present', () => {
    expect(guard.canActivate(ctx(undefined, 'coop-a'))).toBe(false);
  });

  it('allows SYSTEM_ADMIN to access any coop', () => {
    expect(guard.canActivate(ctx({ role: 'SYSTEM_ADMIN' }, 'coop-a'))).toBe(true);
  });

  it('allows a COOP_ADMIN to access an assigned coop', () => {
    expect(
      guard.canActivate(ctx({ role: 'COOP_ADMIN', coopIds: ['coop-a', 'coop-b'] }, 'coop-a')),
    ).toBe(true);
  });

  it('forbids a COOP_ADMIN from a non-assigned coop', () => {
    expect(() =>
      guard.canActivate(ctx({ role: 'COOP_ADMIN', coopIds: ['coop-a'] }, 'coop-b')),
    ).toThrow(ForbiddenException);
  });

  it('forbids a COOP_ADMIN with undefined coopIds', () => {
    expect(() =>
      guard.canActivate(ctx({ role: 'COOP_ADMIN' }, 'coop-a')),
    ).toThrow(ForbiddenException);
  });

  it('denies a SHAREHOLDER role (falls through to false)', () => {
    expect(guard.canActivate(ctx({ role: 'SHAREHOLDER', coopIds: ['coop-a'] }, 'coop-a'))).toBe(false);
  });
});
