import { computeIsReadOnly } from '../auth/compute-readonly';
import { mapStripeSubscriptionStatus } from './billing.service';
import {
  LAPSED_SIGNUP_GRACE_MS,
  PUBLIC_SIGNUP_CLOSED_MESSAGE,
  PublicSignupClosedException,
  isLapsedSubscriptionStatus,
  nextLapsedAt,
  publicSignupClosed,
} from './signup-grace';

const lapsedAt = new Date('2026-03-01T12:00:00.000Z');
const graceEnds = new Date(lapsedAt.getTime() + LAPSED_SIGNUP_GRACE_MS);

describe('lapsed public signup grace', () => {
  it('is a single 14-day constant', () => {
    expect(LAPSED_SIGNUP_GRACE_MS).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it('refuses with a message a visitor can act on', () => {
    expect(new PublicSignupClosedException().getResponse()).toMatchObject({
      code: 'SIGNUP_CLOSED',
      message: PUBLIC_SIGNUP_CLOSED_MESSAGE,
    });
  });

  it.each(['PAST_DUE', 'CANCELED', 'UNPAID', 'INCOMPLETE'])(
    'accepts %s until the grace instant and refuses at that instant',
    (status) => {
      const base = { plan: 'PROFESSIONAL' as const, subscriptionStatus: status, lapsedAt };
      expect(publicSignupClosed({ ...base, now: new Date(graceEnds.getTime() - 1) })).toBe(false);
      expect(publicSignupClosed({ ...base, now: graceEnds })).toBe(true);
      expect(publicSignupClosed({ ...base, now: new Date(graceEnds.getTime() + 1) })).toBe(true);
    },
  );

  it('refuses a lapsed paid coop when the lapse timestamp was not recorded', () => {
    expect(
      publicSignupClosed({
        plan: 'ESSENTIALS',
        subscriptionStatus: 'UNPAID',
        lapsedAt: null,
        now: lapsedAt,
      }),
    ).toBe(true);
  });

  it('keeps signups open for FREE, active, trialing, and coops with no subscription', () => {
    expect(
      publicSignupClosed({ plan: 'FREE', subscriptionStatus: 'CANCELED', lapsedAt, now: graceEnds }),
    ).toBe(false);
    expect(
      publicSignupClosed({ plan: 'ESSENTIALS', subscriptionStatus: 'ACTIVE', lapsedAt, now: graceEnds }),
    ).toBe(false);
    expect(
      publicSignupClosed({ plan: 'ESSENTIALS', subscriptionStatus: 'TRIALING', lapsedAt: null, now: graceEnds }),
    ).toBe(false);
    expect(
      publicSignupClosed({ plan: 'ESSENTIALS', subscriptionStatus: null, lapsedAt: null, now: graceEnds }),
    ).toBe(false);
    expect(
      publicSignupClosed({ plan: null, subscriptionStatus: 'CANCELED', lapsedAt, now: graceEnds }),
    ).toBe(false);
  });

  it('does not reopen admin access during the signup grace window', () => {
    const justLapsed = new Date();
    expect(
      publicSignupClosed({
        plan: 'ESSENTIALS',
        subscriptionStatus: 'PAST_DUE',
        lapsedAt: justLapsed,
        now: new Date(justLapsed.getTime() + 1000),
      }),
    ).toBe(false);
    expect(
      computeIsReadOnly({
        plan: 'ESSENTIALS',
        trialEndsAt: new Date(Date.now() - 60_000),
        subscription: { status: 'PAST_DUE' },
      }),
    ).toBe(true);
  });

  it('starts the lapse clock once and clears it when the subscription recovers', () => {
    const now = new Date('2026-04-01T00:00:00.000Z');
    expect(nextLapsedAt('PAST_DUE', null, now)).toEqual(now);
    expect(nextLapsedAt('CANCELED', lapsedAt, now)).toEqual(lapsedAt);
    expect(nextLapsedAt('ACTIVE', lapsedAt, now)).toBeNull();
    expect(nextLapsedAt('TRIALING', lapsedAt, now)).toBeNull();
  });
});

describe('unknown Stripe statuses stay fail-closed', () => {
  it.each(['paused', 'incomplete_expired', 'no_such_status', 'canceled', 'unpaid', 'past_due', 'incomplete'])(
    'maps %s onto a lapsed signup status',
    (status) => {
      const mapped = mapStripeSubscriptionStatus(status);
      expect(mapped).not.toBe('ACTIVE');
      expect(isLapsedSubscriptionStatus(mapped)).toBe(true);
    },
  );

  it('does not treat active or trialing as lapsed', () => {
    expect(isLapsedSubscriptionStatus(mapStripeSubscriptionStatus('active'))).toBe(false);
    expect(isLapsedSubscriptionStatus(mapStripeSubscriptionStatus('trialing'))).toBe(false);
  });
});
