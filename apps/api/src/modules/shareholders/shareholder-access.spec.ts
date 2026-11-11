import { ForbiddenException } from '@nestjs/common';
import { assertCanBuyForShareholder, canActForShareholder } from './shareholder-access';

describe('canActForShareholder', () => {
  it('allows the linked user', () => {
    expect(canActForShareholder({ userId: 'u1', type: 'INDIVIDUAL', registeredByUserId: null }, 'u1')).toBe(true);
  });

  it('allows the parent who registered a minor', () => {
    expect(canActForShareholder({ userId: null, type: 'MINOR', registeredByUserId: 'u2' }, 'u2')).toBe(true);
  });

  it('refuses the registering user of a shareholder who is not a minor', () => {
    expect(canActForShareholder({ userId: null, type: 'COMPANY', registeredByUserId: 'u2' }, 'u2')).toBe(false);
  });

  it('refuses anyone else', () => {
    expect(canActForShareholder({ userId: 'u1', type: 'INDIVIDUAL', registeredByUserId: null }, 'u3')).toBe(false);
  });
});

describe('assertCanBuyForShareholder', () => {
  const shareholder = { userId: 'u1', type: 'INDIVIDUAL', registeredByUserId: null };

  it('rejects an anonymous caller who names a shareholder id', () => {
    expect(() => assertCanBuyForShareholder(shareholder, undefined)).toThrow(ForbiddenException);
  });

  it('rejects a signed-in user who names someone else', () => {
    expect(() => assertCanBuyForShareholder(shareholder, 'u2')).toThrow(ForbiddenException);
  });

  it('allows the owner and a parent buying for their minor', () => {
    expect(() => assertCanBuyForShareholder(shareholder, 'u1')).not.toThrow();
    expect(() =>
      assertCanBuyForShareholder(
        { userId: null, type: 'MINOR', registeredByUserId: 'parent' },
        'parent',
      ),
    ).not.toThrow();
  });
});
