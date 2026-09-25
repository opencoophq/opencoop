import { ShareholderStatus } from '@opencoop/database';
import { deriveShareholderStatus } from './shareholder-status';

describe('deriveShareholderStatus', () => {
  it('returns PENDING for no registrations', () => {
    expect(deriveShareholderStatus([])).toBe(ShareholderStatus.PENDING);
  });

  it('returns PENDING for only pending or cancelled BUY registrations', () => {
    expect(
      deriveShareholderStatus([
        { type: 'BUY', status: 'PENDING_PAYMENT', quantity: 10 },
        { type: 'BUY', status: 'PENDING', quantity: 5 },
        { type: 'BUY', status: 'CANCELLED', quantity: 3 },
      ]),
    ).toBe(ShareholderStatus.PENDING);
  });

  it('returns ACTIVE for a COMPLETED BUY', () => {
    expect(deriveShareholderStatus([{ type: 'BUY', status: 'COMPLETED', quantity: 10 }])).toBe(
      ShareholderStatus.ACTIVE,
    );
  });

  it('returns ACTIVE for an ACTIVE BUY', () => {
    expect(deriveShareholderStatus([{ type: 'BUY', status: 'ACTIVE', quantity: 10 }])).toBe(
      ShareholderStatus.ACTIVE,
    );
  });

  it('returns INACTIVE when completed sells equal completed buys', () => {
    expect(
      deriveShareholderStatus([
        { type: 'BUY', status: 'COMPLETED', quantity: 10 },
        { type: 'SELL', status: 'COMPLETED', quantity: 10 },
      ]),
    ).toBe(ShareholderStatus.INACTIVE);
  });

  it('ignores a SELL that is not completed', () => {
    expect(
      deriveShareholderStatus([
        { type: 'BUY', status: 'COMPLETED', quantity: 10 },
        { type: 'SELL', status: 'PENDING_PAYMENT', quantity: 10 },
      ]),
    ).toBe(ShareholderStatus.ACTIVE);
  });

  it('returns INACTIVE when sells exceed buys', () => {
    expect(
      deriveShareholderStatus([
        { type: 'BUY', status: 'COMPLETED', quantity: 10 },
        { type: 'SELL', status: 'COMPLETED', quantity: 12 },
      ]),
    ).toBe(ShareholderStatus.INACTIVE);
  });

  it('derives the status from mixed registrations', () => {
    expect(
      deriveShareholderStatus([
        { type: 'BUY', status: 'PENDING', quantity: 100 },
        { type: 'BUY', status: 'ACTIVE', quantity: 8 },
        { type: 'BUY', status: 'COMPLETED', quantity: 7 },
        { type: 'SELL', status: 'PENDING_PAYMENT', quantity: 5 },
        { type: 'SELL', status: 'COMPLETED', quantity: 10 },
        { type: 'BUY', status: 'CANCELLED', quantity: 50 },
      ]),
    ).toBe(ShareholderStatus.ACTIVE);
  });
});
