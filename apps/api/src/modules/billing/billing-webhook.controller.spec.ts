import { BadRequestException } from '@nestjs/common';
import { BillingWebhookController } from './billing-webhook.controller';

describe('BillingWebhookController', () => {
  const billing = {
    handleCheckoutCompleted: jest.fn(),
    handleInvoicePaid: jest.fn(),
    handleInvoicePaymentFailed: jest.fn(),
    handleSubscriptionUpdated: jest.fn(),
    handleSubscriptionDeleted: jest.fn(),
  };
  const stripe = {
    webhooks: { constructEvent: jest.fn() },
  };
  const controller = new BillingWebhookController(billing as any, stripe as any);
  const originalSecret = process.env.STRIPE_WEBHOOK_SECRET;

  beforeAll(() => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  });

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = originalSecret;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects a bad signature without echoing the Stripe error', async () => {
    stripe.webhooks.constructEvent.mockImplementation(() => {
      throw new Error(
        'No signatures found matching the expected signature for payload. Are you passing the raw request body?',
      );
    });
    const req = { rawBody: Buffer.from('{}') } as any;

    await expect(controller.handleWebhook(req, 'bad')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.handleWebhook(req, 'bad')).rejects.toThrow(
      'Webhook signature verification failed',
    );
    await expect(controller.handleWebhook(req, 'bad')).rejects.not.toThrow(/raw request body/);
  });

  it('dispatches invoice.payment_failed to the billing service', async () => {
    const invoice = { id: 'in_1' };
    stripe.webhooks.constructEvent.mockReturnValue({
      type: 'invoice.payment_failed',
      data: { object: invoice },
    });

    await expect(
      controller.handleWebhook({ rawBody: Buffer.from('{}') } as any, 'sig'),
    ).resolves.toEqual({ received: true });
    expect(billing.handleInvoicePaymentFailed).toHaveBeenCalledWith(invoice);
  });
});