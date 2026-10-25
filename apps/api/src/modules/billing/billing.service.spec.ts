import { BillingService } from './billing.service';

function subscriptionEvent(status: string) {
  return {
    id: 'sub_1',
    status,
    cancel_at_period_end: false,
    canceled_at: null,
    items: {
      data: [
        {
          price: { id: 'price_1' },
          current_period_start: 1_700_000_000,
          current_period_end: 1_700_086_400,
        },
      ],
    },
  };
}

describe('BillingService Stripe subscription state', () => {
  const prisma = {
    subscription: {
      update: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
    },
  };
  const stripe = {
    subscriptions: { retrieve: jest.fn() },
  };
  const service = new BillingService(prisma as any, stripe as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('activates the coop subscription when checkout completes', async () => {
    stripe.subscriptions.retrieve.mockResolvedValue(subscriptionEvent('active'));

    await service.handleCheckoutCompleted({
      metadata: { coopId: 'coop-1' },
      subscription: 'sub_1',
    } as any);

    expect(prisma.subscription.update).toHaveBeenCalledWith({
      where: { coopId: 'coop-1' },
      data: expect.objectContaining({
        stripeSubscriptionId: 'sub_1',
        status: 'ACTIVE',
        stripePriceId: 'price_1',
      }),
    });
  });

  it('marks the subscription past due when an invoice payment fails', async () => {
    await service.handleInvoicePaymentFailed({
      parent: { subscription_details: { subscription: 'sub_1' } },
    } as any);

    expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
      where: { stripeSubscriptionId: 'sub_1' },
      data: { status: 'PAST_DUE' },
    });
  });

  it('does nothing when a failed invoice has no subscription', async () => {
    await service.handleInvoicePaymentFailed({ parent: null } as any);
    expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
  });

  it('marks the subscription canceled when Stripe deletes it', async () => {
    await service.handleSubscriptionDeleted({ id: 'sub_1' } as any);

    expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
      where: { stripeSubscriptionId: 'sub_1' },
      data: expect.objectContaining({ status: 'CANCELED' }),
    });
  });

  it.each([
    ['active', 'ACTIVE'],
    ['past_due', 'PAST_DUE'],
    ['canceled', 'CANCELED'],
    ['unpaid', 'UNPAID'],
    ['incomplete', 'INCOMPLETE'],
    ['incomplete_expired', 'INCOMPLETE'],
    ['trialing', 'TRIALING'],
    ['paused', 'PAST_DUE'],
    ['no_such_status', 'UNPAID'],
  ])('stores Stripe status %s as %s', async (stripeStatus, expected) => {
    prisma.subscription.findUnique.mockResolvedValue({ id: 'row-1' });

    await service.handleSubscriptionUpdated(subscriptionEvent(stripeStatus) as any);

    expect(prisma.subscription.update).toHaveBeenCalledWith({
      where: { id: 'row-1' },
      data: expect.objectContaining({ status: expected }),
    });
  });
});
