# OPE-74 — Bancontact/Wero integration research for mobile-friendly payments

Date: 2026-04-27  
Owner: CTO  
Issue: OPE-74

## Problem statement

Current shareholder payment flow is optimized for bank transfer via EPC QR.
That works well on desktop (scan with phone), but is awkward on mobile because users cannot scan a QR shown on the same device.

## Current product baseline (code reality)

- Payment QR is generated as EPC payload client-side in `EpcQrCode` (`apps/web/src/components/epc-qr-code.tsx`) using `generateEpcQrPayload` (`packages/shared/src/utils.ts`).
- Public registration flow returns `registrationId` + `ogmCode` and shows payment details in the confirmation step (`apps/api/src/modules/channels/channels.service.ts`, `apps/web/src/components/coop-register-content.tsx`).
- Settlement model is bank-transfer-first: payments are matched via OGM through CSV import and/or Ponto sync, then `PaymentsService.addPayment()` transitions registration status (`apps/api/src/modules/bank-import/bank-import.service.ts`, `apps/api/src/modules/ponto/ponto.service.ts`, `apps/api/src/modules/payments/payments.service.ts`).

Implication: today we do not run an online merchant payment-intent lifecycle in backend; we reconcile incoming transfers.

## Market and scheme status (as of 2026-04-27)

- Bancontact states Payconiq merchant solutions have evolved to Bancontact and that Wero support rolls out automatically on existing QR/payment rails from spring 2026.
  - Source: https://www.bancontact.com/en/payconiq-evolves
- Bancontact Payconiq provides merchant APIs (payment creation, callbacks, reconciliation) with preprod/prod onboarding and API keys.
  - Source: https://docs.payconiq.be/guides/general/gettingstarted052025v4
  - Source: https://docs.payconiq.be/apis/merchant-payment.openapi
- EPI announced Wero ecommerce launch in Belgium (March 2026), with merchant rollout through 2026.
  - Source: https://epicompany.eu/media-insights/wero-announces-launch-ecommerce-in-belgium

## Integration options

### Option A — Keep EPC-only, improve mobile UX copy/actions

Scope:
- Keep existing transfer rails.
- On mobile, de-emphasize QR and emphasize tappable IBAN/OGM copy actions and payment instructions.

Pros:
- Lowest effort and zero payment-rail risk.
- No new compliance/contracts.

Cons:
- Does not add Bancontact/Wero.
- Conversion gap on mobile likely remains material.

Effort: 1-2 days.

### Option B — Direct Bancontact integration (merchant API), keep EPC fallback

Scope:
- Add Bancontact payment-intent creation from registration confirmation.
- Mobile: show “Pay with Bancontact” deep-link/button instead of scan-first UX.
- Desktop: keep QR and optionally show Bancontact QR/button in parallel.
- Webhook on paid event calls existing `PaymentsService.addPayment()` so downstream status transitions remain unchanged.

Pros:
- Solves mobile self-scan pain directly.
- Preserves existing bank-transfer fallback and OGM reconciliation.
- Future path to Wero likely rides same merchant integration track.

Cons:
- New backend integration surface (intent lifecycle, webhook hardening, idempotency).
- Merchant onboarding + contractual setup required.

Effort: 2-3 weeks including QA.

### Option C — PSP-led path (Stripe/Adyen/Mollie/Worldline) for Bancontact now, Wero as provider roadmap

Scope:
- Integrate via one PSP abstraction instead of direct scheme integration.

Pros:
- Faster future payment-method expansion.
- Offloads some scheme-level complexity.

Cons:
- Additional provider dependency and fees.
- Requires checkout/payment reconciliation architecture shift beyond current transfer model.

Effort: 3-5 weeks depending on provider and desired scope.

### Option D — Replace EPC transfer entirely with Bancontact/Wero

Pros:
- Simpler user choice at checkout.

Cons:
- Breaks a proven fallback rail used in current accounting/reconciliation flows.
- Unnecessary risk during early rollout.

Effort: highest risk; not recommended.

## Recommendation

Choose **Option B (direct Bancontact integration) with EPC fallback retained**, delivered in phases.

Why:
- Addresses the exact user pain (mobile purchase completion).
- Preserves existing operational reliability (OGM + bank reconciliation) during transition.
- Aligns with market direction where Bancontact rails are evolving toward Wero compatibility.

## Proposed phased plan

1. Phase 0 (quick UX patch, optional but low-risk)
- Improve mobile confirmation UX immediately: hide scan-first emphasis on small screens, prioritize copy buttons and clear mobile payment steps.

2. Phase 1 (core integration)
- Backend:
  - Add `PaymentProviderIntent` table (registrationId, provider, providerPaymentId, status, amount, idempotencyKey, raw payload).
  - Add endpoint to create Bancontact payment intent for a registration.
  - Add webhook endpoint to consume provider payment status updates.
  - On successful payment webhook, call `PaymentsService.addPayment()` (single source for registration state transitions).
- Frontend:
  - In confirmation step, show `Pay with Bancontact` CTA on mobile and keep EPC block as fallback.
  - Preserve OGM/IBAN display for manual transfer.

3. Phase 2 (Wero activation + optimization)
- Enable Wero where provider/account supports it.
- Add telemetry: payment method selected, conversion by device, fallback usage.

## Technical design guardrails

- Idempotency: webhook handling must be idempotent by provider payment id.
- State model: do not bypass `PaymentsService.addPayment()` for status transitions.
- Reconciliation: keep bank import + Ponto paths active until conversion data supports deprecation.
- Failure mode: if provider flow fails, user can still complete via EPC transfer.

## Acceptance criteria for OPE-74

- A decision is made on integration path (recommended: Option B).
- A scoped implementation issue list exists (API, webhook, frontend CTA, QA).
- No regression to current EPC/OGM transfer flow.

## Suggested follow-up implementation tickets

- OPE-74A: Bancontact provider client + merchant onboarding config.
- OPE-74B: Payment intent and webhook backend.
- OPE-74C: Mobile-first payment CTA in registration confirmation.
- OPE-74D: E2E tests for payment success/failure/fallback transfer.
