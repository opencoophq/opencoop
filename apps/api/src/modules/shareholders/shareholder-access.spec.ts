import { canActForShareholder } from './shareholder-access';

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
