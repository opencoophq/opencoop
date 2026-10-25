import { computeIsReadOnly } from './compute-readonly';

describe('computeIsReadOnly', () => {
  const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const past = new Date(Date.now() - 24 * 60 * 60 * 1000);

  it('never locks a FREE coop', () => {
    expect(
      computeIsReadOnly({ plan: 'FREE', trialEndsAt: past, subscription: { status: 'CANCELED' } }),
    ).toBe(false);
  });

  it('keeps an ACTIVE subscription writable', () => {
    expect(
      computeIsReadOnly({ plan: 'ESSENTIALS', trialEndsAt: past, subscription: { status: 'ACTIVE' } }),
    ).toBe(false);
  });

  it('keeps an open trial writable', () => {
    expect(
      computeIsReadOnly({ plan: 'PROFESSIONAL', trialEndsAt: future, subscription: { status: 'PAST_DUE' } }),
    ).toBe(false);
  });

  it('locks a lapsed trial whose subscription is not ACTIVE', () => {
    expect(
      computeIsReadOnly({ plan: 'ESSENTIALS', trialEndsAt: past, subscription: { status: 'PAST_DUE' } }),
    ).toBe(true);
    expect(
      computeIsReadOnly({ plan: 'ESSENTIALS', trialEndsAt: past, subscription: { status: 'CANCELED' } }),
    ).toBe(true);
    expect(
      computeIsReadOnly({ plan: 'ESSENTIALS', trialEndsAt: null, subscription: null }),
    ).toBe(true);
  });
});
