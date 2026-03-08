# Ponto Connect Integration — Design Document

**Date:** 2026-03-08
**Status:** Approved

## Overview

Integrate Ponto Connect (Isabel Group) for automatic payment reconciliation. Ponto monitors coop bank accounts via PSD2 and sends webhooks when new transactions arrive. We match incoming payments by OGM code against pending registrations, auto-creating Payment records and transitioning registration status.

## Key Decisions

- **Webhook-driven** (not polling) — Ponto webhooks trigger processing, with a daily health-check job as safety net
- **Self-service bank connection** — Coop admins connect their own bank via OAuth in dashboard settings
- **Feature-gated** — System admin enables Ponto per coop via `pontoEnabled` toggle (included in €89/month plan)
- **Configurable auto-match** — Per-coop `autoMatchPayments` setting: auto-complete or require admin confirmation
- **Unmatched payments surfaced** — Incoming transactions without OGM match shown in admin dashboard with notifications
- **Coexists with CSV import** — Ponto is additive, existing bank import flow unchanged
- **Graceful expiry handling** — Email reminder 7 days before PSD2 90-day expiry, banner in dashboard, falls back to manual mode
- **Partner billing model** — OpenCoop pays Ibanity (€4/account/month), coops never interact with Ponto directly

## Database Schema Changes

### New model: PontoConnection

```prisma
model PontoConnection {
  id                  String                @id @default(uuid())
  coopId              String                @unique
  coop                Coop                  @relation(fields: [coopId], references: [id])

  // OAuth tokens (encrypted at rest via AES-256-GCM)
  accessToken         String
  refreshToken        String
  tokenExpiresAt      DateTime

  // Bank account info from Ponto
  pontoAccountId      String?
  pontoOrganizationId String?
  iban                String?
  bankName            String?

  // Connection health
  status              PontoConnectionStatus @default(PENDING)
  lastSyncAt          DateTime?
  authExpiresAt       DateTime?
  expiryNotifiedAt    DateTime?

  createdAt           DateTime              @default(now())
  updatedAt           DateTime              @updatedAt
}

enum PontoConnectionStatus {
  PENDING
  ACTIVE
  EXPIRED
  REVOKED
}
```

### Coop model additions

```prisma
pontoEnabled        Boolean @default(false)   // System admin toggle
autoMatchPayments   Boolean @default(true)    // Auto-complete or admin confirmation
pontoConnection     PontoConnection?
```

### BankTransaction addition

```prisma
pontoTransactionId  String? @unique           // Deduplication key
```

## OAuth Flow

1. Admin clicks "Connect bank account" in coop settings
2. Backend generates Ponto OAuth URL with PKCE
3. Admin redirected to Ponto → selects bank → authenticates → selects account
4. Ponto redirects to `/ponto/callback?code=...`
5. Backend exchanges code for tokens, stores encrypted in PontoConnection
6. Backend fetches account details (IBAN, bank name)
7. Admin sees connected status in settings

### API Endpoints

```
GET  /admin/coops/:coopId/ponto/connect     → OAuth redirect URL
GET  /ponto/callback                         → OAuth callback (public)
GET  /admin/coops/:coopId/ponto/status       → Connection status
POST /admin/coops/:coopId/ponto/disconnect   → Revoke connection
POST /admin/coops/:coopId/ponto/reauthorize  → New OAuth URL for re-auth
PATCH /system-admin/coops/:coopId            → { pontoEnabled: true/false }
```

## Webhook Processing Pipeline

### Endpoint

```
POST /ponto/webhooks  → Public, verified by signature
```

### Flow for `pontoConnect.account.transactionsCreated`

1. Receive webhook → verify signature → enqueue Bull job → return 200
2. Job: look up PontoConnection by accountId → get coopId
3. Fetch new transactions from `/synchronizations/{id}/updated-transactions`
4. For each incoming transaction (positive amount):
   - Skip if `pontoTransactionId` already exists (dedup)
   - Check `remittanceInformationType === "structured"`
   - Match OGM against `Registration.ogmCode` (status: PENDING_PAYMENT or ACTIVE)
5. **Matched + autoMatchPayments=true**: Create BankTransaction (AUTO_MATCHED) → Create Payment → transition registration → send confirmation email
6. **Matched + autoMatchPayments=false**: Create BankTransaction (AUTO_MATCHED) → flag pending confirmation → notify admin
7. **Unmatched**: Create BankTransaction (UNMATCHED) → notify admin (in-app + email)

### Daily Health Check Job

- Bull repeat job, runs once per day
- Check `lastSyncAt` for each ACTIVE connection — warn if >24h
- Check `authExpiresAt` — send reminder email if <7 days and not yet notified
- Transition status to EXPIRED if past expiry date

## Ponto API Client

Thin custom implementation in NestJS:

- mTLS: client certificate on every request
- OAuth token lifecycle: auto-refresh, rotate refresh token
- HTTP request signing: RSASSA-PSS with SHA-256 (production only)
- JSON:API deserialization

### Environment Variables

```
PONTO_CLIENT_ID
PONTO_CLIENT_SECRET
PONTO_CERT_PATH=/certs/certificate.pem
PONTO_KEY_PATH=/certs/private_key.pem
PONTO_KEY_PASSPHRASE
PONTO_SANDBOX=true
PONTO_WEBHOOK_SIGNING_KEY
```

### Module Structure

```
apps/api/src/modules/ponto/
├── ponto.module.ts
├── ponto.client.ts              # API client
├── ponto.service.ts             # Business logic (matching, payments)
├── ponto.controller.ts          # OAuth callback + webhook endpoint
├── ponto.admin.controller.ts    # Admin endpoints
├── ponto.processor.ts           # Bull queue job processor
└── dto/
    ├── ponto-webhook.dto.ts
    └── ponto-connect.dto.ts
```

## Frontend Changes

### System Admin — Coop detail page
- "Ponto" toggle to enable/disable per coop

### Coop Admin — Settings page
- "Bank Connection" card (visible when pontoEnabled=true)
- Shows: status, IBAN, bank name, last sync, auth expiry
- Actions: Connect / Disconnect / Re-authorize
- Toggle: "Automatically register matched payments"

### Coop Admin — Transactions page
- "Unmatched payments" tab: incoming transactions without OGM match
- Manual match action: select a PENDING_PAYMENT/ACTIVE registration
- "Pending confirmation" tab (when autoMatchPayments=false): approve/reject matched transactions

### Coop Admin — Dashboard
- Expiry warning banner (<7 days) and expired banner

### Shareholder-facing
- No changes — same registration form with QR code and OGM

## Security

- Tokens encrypted at rest (AES-256-GCM, key derived from JWT_SECRET)
- Webhook signature verification on all incoming webhooks
- Certificate files mounted as Docker secrets
- pontoTransactionId uniqueness prevents duplicate payments
- All Ponto API calls through PontoClient service

## Cost

- €4/month per connected bank account (billed to OpenCoop by Ibanity)
- Absorbed in €89/month premium plan
- Manual toggle controls which coops have access

## What We're NOT Building

- Payment initiation (read-only, never move money)
- Plan-based billing gating (manual toggle for now)
- Ponto-branded UI (fully white-labeled)
