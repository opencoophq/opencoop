import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma/prisma.service';
import { STRIPE_CLIENT } from './stripe.provider';

const PRICE_MAP: Record<string, string | undefined> = {
  ESSENTIALS_MONTHLY: process.env.STRIPE_ESSENTIALS_MONTHLY_PRICE_ID,
  ESSENTIALS_YEARLY: process.env.STRIPE_ESSENTIALS_YEARLY_PRICE_ID,
  PROFESSIONAL_MONTHLY: process.env.STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID,
  PROFESSIONAL_YEARLY: process.env.STRIPE_PROFESSIONAL_YEARLY_PRICE_ID,
};

/** Extract subscription ID from an invoice's parent (Stripe clover API). */
function getSubscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const subDetails = invoice.parent?.subscription_details;
  if (!subDetails) return null;
  const sub = subDetails.subscription;
  if (typeof sub === 'string') return sub;
  if (sub && typeof sub === 'object' && 'id' in sub) return sub.id;
  return null;
}

/** Get current period timestamps from subscription items (clover API). */
function getItemPeriod(sub: Stripe.Subscription): { start: Date | null; end: Date | null } {
  const item = sub.items?.data?.[0];
  if (!item) return { start: null, end: null };
  return {
    start: item.current_period_start ? new Date(item.current_period_start * 1000) : null,
    end: item.current_period_end ? new Date(item.current_period_end * 1000) : null,
  };
}

@Injectable()
export class BillingService {
  constructor(
    private prisma: PrismaService,
    @Inject(STRIPE_CLIENT) private stripe: Stripe,
  ) {}

  async createCheckoutSession(
    coopId: string,
    plan: 'ESSENTIALS' | 'PROFESSIONAL',
    billingPeriod: 'MONTHLY' | 'YEARLY',
  ): Promise<{ url: string }> {
    const coop = await this.prisma.coop.findUnique({
      where: { id: coopId },
      include: { subscription: true },
    });
    if (!coop) throw new NotFoundException('Cooperative not found');

    const priceKey = `${plan}_${billingPeriod}`;
    const priceId = PRICE_MAP[priceKey];
    if (!priceId) {
      throw new BadRequestException(`Price not configured for ${priceKey}`);
    }

    // Get or create Stripe customer
    let stripeCustomerId: string;
    if (coop.subscription?.stripeCustomerId) {
      stripeCustomerId = coop.subscription.stripeCustomerId;
    } else {
      const customer = await this.stripe.customers.create({
        metadata: { coopId: coop.id },
        name: coop.name,
      });
      stripeCustomerId = customer.id;

      await this.prisma.subscription.upsert({
        where: { coopId },
        create: {
          coopId,
          stripeCustomerId,
          status: 'TRIALING',
          billingPeriod,
        },
        update: {
          stripeCustomerId,
        },
      });
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3002';

    const session = await this.stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${frontendUrl}/dashboard/admin/billing?success=true`,
      cancel_url: `${frontendUrl}/dashboard/admin/billing?canceled=true`,
      metadata: { coopId, plan, billingPeriod },
      subscription_data: {
        metadata: { coopId, plan, billingPeriod },
      },
    });

    if (!session.url) {
      throw new BadRequestException('Failed to create checkout session');
    }

    return { url: session.url };
  }

  async createPortalSession(coopId: string): Promise<{ url: string }> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { coopId },
    });
    if (!subscription) {
      throw new NotFoundException('No subscription found for this cooperative');
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3002';

    const session = await this.stripe.billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: `${frontendUrl}/dashboard/admin/billing`,
    });

    return { url: session.url };
  }

  async getBillingInfo(coopId: string) {
    const coop = await this.prisma.coop.findUnique({
      where: { id: coopId },
      include: { subscription: true },
    });
    if (!coop) throw new NotFoundException('Cooperative not found');

    return {
      plan: coop.plan,
      trialEndsAt: coop.trialEndsAt?.toISOString() ?? undefined,
      isReadOnly: this.computeIsReadOnly(coop),
      subscription: coop.subscription
        ? {
            id: coop.subscription.id,
            coopId: coop.subscription.coopId,
            status: coop.subscription.status,
            billingPeriod: coop.subscription.billingPeriod,
            currentPeriodStart: coop.subscription.currentPeriodStart?.toISOString(),
            currentPeriodEnd: coop.subscription.currentPeriodEnd?.toISOString(),
            cancelAtPeriodEnd: coop.subscription.cancelAtPeriodEnd,
            canceledAt: coop.subscription.canceledAt?.toISOString(),
          }
        : undefined,
    };
  }

  async isReadOnly(coopId: string): Promise<boolean> {
    const coop = await this.prisma.coop.findUnique({
      where: { id: coopId },
      include: { subscription: true },
    });
    if (!coop) return false;
    return this.computeIsReadOnly(coop);
  }

  private computeIsReadOnly(coop: {
    plan: string;
    trialEndsAt: Date | null;
    subscription: { status: string } | null;
  }): boolean {
    if (coop.plan === 'FREE') return false;
    if (coop.subscription?.status === 'ACTIVE') return false;
    if (coop.trialEndsAt && coop.trialEndsAt > new Date()) return false;
    return true;
  }

  // ============================================================================
  // WEBHOOK HANDLERS
  // ============================================================================

  async handleCheckoutCompleted(session: Stripe.Checkout.Session) {
    const coopId = session.metadata?.coopId;
    if (!coopId) return;

    const subscriptionId = typeof session.subscription === 'string'
      ? session.subscription
      : (session.subscription as Stripe.Subscription | null)?.id;
    if (!subscriptionId) return;

    const stripeSub = await this.stripe.subscriptions.retrieve(subscriptionId);
    const period = getItemPeriod(stripeSub);

    await this.prisma.subscription.update({
      where: { coopId },
      data: {
        stripeSubscriptionId: subscriptionId,
        status: 'ACTIVE',
        stripePriceId: stripeSub.items.data[0]?.price.id,
        currentPeriodStart: period.start,
        currentPeriodEnd: period.end,
      },
    });
  }

  async handleInvoicePaid(invoice: Stripe.Invoice) {
    const subscriptionId = getSubscriptionIdFromInvoice(invoice);
    if (!subscriptionId) return;

    const subscription = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId: subscriptionId },
    });
    if (!subscription) return;

    const stripeSub = await this.stripe.subscriptions.retrieve(subscriptionId);
    const period = getItemPeriod(stripeSub);

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: 'ACTIVE',
        currentPeriodStart: period.start,
        currentPeriodEnd: period.end,
      },
    });
  }

  async handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
    const subscriptionId = getSubscriptionIdFromInvoice(invoice);
    if (!subscriptionId) return;

    await this.prisma.subscription.updateMany({
      where: { stripeSubscriptionId: subscriptionId },
      data: { status: 'PAST_DUE' },
    });
  }

  async handleSubscriptionUpdated(subscription: Stripe.Subscription) {
    const existing = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId: subscription.id },
    });
    if (!existing) return;

    const statusMap: Record<string, string> = {
      active: 'ACTIVE',
      past_due: 'PAST_DUE',
      canceled: 'CANCELED',
      unpaid: 'UNPAID',
      incomplete: 'INCOMPLETE',
      trialing: 'TRIALING',
    };

    const period = getItemPeriod(subscription);

    await this.prisma.subscription.update({
      where: { id: existing.id },
      data: {
        status: (statusMap[subscription.status] ?? 'ACTIVE') as any,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
        currentPeriodStart: period.start,
        currentPeriodEnd: period.end,
        stripePriceId: subscription.items.data[0]?.price.id,
      },
    });
  }

  async handleSubscriptionDeleted(subscription: Stripe.Subscription) {
    await this.prisma.subscription.updateMany({
      where: { stripeSubscriptionId: subscription.id },
      data: {
        status: 'CANCELED',
        canceledAt: new Date(),
      },
    });
  }

  // ============================================================================
  // SYSTEM ADMIN OVERRIDES
  // ============================================================================

  async adminUpdateBilling(
    coopId: string,
    data: { plan?: string; trialEndsAt?: string; extendTrialDays?: number },
  ) {
    const coop = await this.prisma.coop.findUnique({ where: { id: coopId } });
    if (!coop) throw new NotFoundException('Cooperative not found');

    const updateData: Record<string, unknown> = {};

    if (data.plan) {
      updateData.plan = data.plan;
    }

    if (data.trialEndsAt) {
      updateData.trialEndsAt = new Date(data.trialEndsAt);
    } else if (data.extendTrialDays) {
      const base = coop.trialEndsAt && coop.trialEndsAt > new Date() ? coop.trialEndsAt : new Date();
      updateData.trialEndsAt = new Date(base.getTime() + data.extendTrialDays * 24 * 60 * 60 * 1000);
    }

    return this.prisma.coop.update({
      where: { id: coopId },
      data: updateData,
      select: {
        id: true,
        plan: true,
        trialEndsAt: true,
      },
    });
  }
}
