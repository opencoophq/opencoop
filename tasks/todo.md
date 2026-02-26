# Stripe Billing Integration — Remaining TODOs

Code is implemented but the following steps are needed before this feature is live.

## Database Migration

- [ ] Start local PostgreSQL (or connect to a running instance)
- [ ] Run `pnpm db:migrate --name add_billing_subscription` to create the migration file
- [ ] Verify migration applies cleanly (adds `plan`, `trialEndsAt` to `coops`, creates `subscriptions` table, adds 3 enums)
- [ ] Existing coops get `plan=FREE`, `trialEndsAt=null` via defaults — no backfill needed

## Stripe Setup

- [ ] Create a Stripe account (or use existing) at https://dashboard.stripe.com
- [ ] Create 4 prices in Stripe:
  - Essentials Monthly (€39/mo)
  - Essentials Yearly (€390/yr)
  - Professional Monthly (€89/mo)
  - Professional Yearly (€890/yr)
- [ ] Note down the `price_xxx` IDs for each
- [ ] Set up Stripe Customer Portal (Settings → Billing → Customer Portal) — enable invoice history, payment method updates, subscription cancellation
- [ ] Create a webhook endpoint in Stripe pointing to `https://<your-domain>/billing/webhook`
- [ ] Subscribe to these webhook events:
  - `checkout.session.completed`
  - `invoice.paid`
  - `invoice.payment_failed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
- [ ] Note down the webhook signing secret (`whsec_xxx`)

## Environment Variables

Add these to `.env` (and production env):

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_ESSENTIALS_MONTHLY_PRICE_ID=price_...
STRIPE_ESSENTIALS_YEARLY_PRICE_ID=price_...
STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID=price_...
STRIPE_PROFESSIONAL_YEARLY_PRICE_ID=price_...
```

- [ ] Add to local `.env`
- [ ] Add to acc environment
- [ ] Add to prod environment (use live keys, not test keys)

## Testing Checklist

- [ ] **Onboard with free plan** → coop has `plan=FREE`, `trialEndsAt=null`, `active=true`, full access
- [ ] **Onboard with paid plan** → coop has `plan=ESSENTIALS`, `trialEndsAt=now+30d`, `active=true`
- [ ] **Dashboard during trial** → full write access, blue trial countdown banner visible
- [ ] **Expire trial** (manually set `trialEndsAt` to past date in DB) → write endpoints return 403 with `SUBSCRIPTION_REQUIRED`, red read-only banner shows, GET endpoints still work
- [ ] **Subscribe** → click Subscribe on billing page, complete Stripe Checkout (use test card `4242 4242 4242 4242`), verify webhook fires, subscription status becomes `ACTIVE`, read-only mode lifts
- [ ] **Manage billing** → click "Open Billing Portal", verify Stripe Customer Portal opens
- [ ] **Cancel subscription** → cancel via portal, verify `cancelAtPeriodEnd=true`, access continues until period end
- [ ] **Payment failure** → simulate failed invoice (Stripe test mode), verify `PAST_DUE` status
- [ ] **System admin** → can see billing columns on coops page, can extend trial via `PUT /system/coops/:id/billing`
- [ ] **Free plan** → completely unaffected by all billing logic

## Optional / Future

- [ ] Apply `<BillingGate>` wrapper to action buttons on key pages (shareholders, transactions, share-classes, projects, dividends, bank-import) for nicer UX when read-only
- [ ] Listen for `subscription-required` custom event in dashboard layout to show a toast notification
- [ ] Add email notifications for trial expiring (7 days before, 1 day before)
- [ ] Consider removing `LAUNCH_MODE=waitlist` env var once billing is live
- [ ] Feature limits for Free plan (1 share class, 1 dividend run) — currently marketing-only, not enforced in code
