# Email Audience Sync (Brevo) for OpenCoop

**Date:** 2026-06-18
**Status:** Draft
**Author:** Wouter + Claude

## Summary

Keep an external email-marketing audience (Brevo, later Mailchimp) in sync with a
coop's shareholders, automatically. A single idempotent **reconcile engine** makes
the provider's lists match OpenCoop's source of truth: active members are kept in the
coop's **existing** members list (reused, not created), and resigned members are removed
from it (optionally moved to a separate resigned list if one is configured). Contacts are
never deleted from the provider.

The engine has two entry points that share all their logic — `reconcileOne(shareholderId)`
(one contact) and `reconcileAll(coopId)` (the whole coop) — driven by a deliberate
two-layer trigger model:

- **Per-change push (latency).** When a shareholder is created or an email / status /
  synced attribute changes, OpenCoop enqueues `reconcileOne` for that shareholder so the
  change reaches the provider within seconds. Best-effort: it never blocks the OpenCoop
  write.
- **Nightly full reconcile (correctness).** A nightly `reconcileAll` per coop converges
  the two systems regardless of what per-change missed (failed call, provider down,
  un-wired mutation path). This is the self-healing safety net that makes any campaign —
  manual or automated — safe whenever it leaves.

A manual **"Sync now"** button calls `reconcileAll` on demand. All configuration is
**per-coop** and the provider sits behind a clean interface so a second provider can be
added without touching the engine.

Brevo offers no "before campaign send" webhook (its marketing webhooks are all
post-event), so the design does not hang the sync off the mailing. Instead the audience
is kept continuously fresh (per-change + nightly), so it is correct at every send time.

**Channel boundary (marketing only).** The Brevo-synced list carries **marketing**
communications only (newsletters, campaigns), where a member's unsubscribe must be
honored. **Statutory member communications** — AV/AGM convocations, annual results,
dividend notices — MUST continue to go through OpenCoop's own transactional email
(`EmailService`, e.g. `meetings/convocation.service.ts`), which already reaches **all
`ACTIVE` shareholders regardless of any Brevo opt-out** and has no marketing-suppression
filter. A Brevo unsubscribe is a single global blacklist — routing a convocation through
the Brevo list would silently fail to convene unsubscribed members, which can invalidate
AV decisions under Belgian cooperative law. The two channels are deliberately separate;
this sync never touches the statutory path.

## Motivation

- A coop's mailing audience drifts from its real membership. `brevo-analysis.html`
  (April 2026, Bronsgroen) measured ~33% of recently-registered shareholders missing
  from the Brevo list — the signature of relying on manual, ad-hoc list updates.
- Admins currently fix this by hand (e.g. editing one member's email in two places).
  That is exactly the kind of change a sync should absorb.
- The need is recurring, and mailings increasingly go out *automated* from Brevo — a
  manual "refresh before each send" ritual is impractical. Brevo cannot call OpenCoop
  before a send (no pre-send webhook), so OpenCoop must keep the audience continuously
  fresh on its own.
- OpenCoop already owns the source of truth (shareholder status + email) and already
  has the infrastructure (per-coop encrypted config, Bull queues, `@nestjs/schedule`
  cron, audit logging) to do this cleanly.

## Scope

### In scope (v1)
- Per-coop configuration: enable/disable, provider choice, encrypted API key, members
  list ID, resigned list ID — stored on `Coop`, managed in admin settings.
- **Brevo** provider implementation behind a provider-agnostic interface.
- **Reconcile engine** with two entry points sharing one mapping + provider:
  `reconcileOne(shareholderId)` and `reconcileAll(coopId)`. Status → list state machine.
- **Triggers** (all v1):
  - **Per-change push** — shareholder service emit points enqueue `reconcileOne` on
    create / email change / status flip / synced-attribute change. Best-effort,
    non-blocking.
  - **Nightly cron** — `reconcileAll` per enabled coop; the self-healing safety net.
  - **Manual "Sync now"** — `reconcileAll` on demand.
- **Email-change handling**: rename the existing provider contact instead of
  duplicating it (the case admins hit by hand today) — in both entry points.
- **Resignation handling**: move `INACTIVE` shareholders from the members list to the
  resigned list (do not delete).
- **Observability**: a `BrevoSyncRun` record per run (counts + errors) surfaced in the
  settings UI; audit log entry for config changes.
- **Test connection** action (validates the API key via the provider's account
  endpoint).

### Out of scope (future iterations)
- **OpenCoop owning the campaign send** (sync-then-send via Brevo's send-campaign API
  for exact moment-before-send freshness). Out of scope — campaigns are composed and
  triggered in Brevo's UI; continuous freshness (per-change + nightly) is sufficient.
- **Mailchimp provider** — the seam is built and a real Mailchimp account exists for
  later testing, but only `BrevoProvider` is implemented in v1.
- **Prospects / sympathisanten** (PENDING registrants who never became shareholders).
  v1 syncs shareholders only.
- Custom per-coop attribute mapping UI (v1 uses a fixed attribute set).
- Reading engagement data back from the provider (sync is strictly one-way:
  OpenCoop → provider).
- **Statutory member communications** (AV/AGM convocations, results, dividend notices).
  These are NOT marketing and must reach every member regardless of marketing opt-out —
  they stay on OpenCoop's existing transactional email path (`meetings` module /
  `EmailService`). The Brevo list is marketing-only; see the Channel boundary above.

## Design

### 1. Core principle — two-layer triggers over one engine

All paths funnel through one engine: **"make provider lists match the desired state."**
It is idempotent — a run with no changes performs no writes — and exposes two entry
points that share the same mapping + provider operations:

- `reconcileOne(coopId, shareholderId)` — derive one shareholder's desired destination
  and apply the minimal ops. The single-contact case.
- `reconcileAll(coopId)` — derive the desired state for every shareholder in the coop
  and apply it (bulk upsert of actives + per-contact renames/moves). Internally this is
  the same logic as `reconcileOne` applied across the set, plus the bulk-import fast path.

Two layers, each with a distinct job:

1. **Per-change push — latency.** Shareholder service emit points enqueue
   `reconcileOne` *after the DB commit* whenever a synced field changes (see §1a). The
   change reaches the provider within seconds. **Best-effort, non-blocking** — see §7.
2. **Nightly full reconcile — correctness.** A nightly `@Cron(..., { timeZone:
   'Europe/Brussels' })` enqueues `reconcileAll` per enabled coop. It converges the two
   systems regardless of what per-change missed (failed call, provider down, a mutation
   path with no emit point yet). This self-healing pass is what makes automated
   campaigns safe without a manual ritual.
3. **Manual "Sync now"** — admin button → `reconcileAll` on demand (force-refresh).

Per-change and nightly are **not redundant**: per-change buys low latency, nightly buys
correctness. Because both call the same idempotent engine, races between them are
harmless (the reconcile always converges to OpenCoop's truth).

### 1a. Per-change emit points

The shareholder service enqueues `reconcileOne(coopId, shareholderId)` after a
successful commit on:

- **Create** of (or transition to) an `ACTIVE` shareholder → add to members list.
- **Email change** (resolved email differs) → rename existing contact (§3).
- **Status flip** `ACTIVE` ↔ `INACTIVE` → move between members / resigned lists.
- **Synced attribute change** (name, language, share quantity) → update contact attrs.

Enqueue is skipped when the coop has `emailAudienceProvider = null`. Emit points live in
the service layer (not Prisma middleware) so the set of triggering fields is explicit and
testable.

### 2. Status → list state machine

Each shareholder with a resolvable email maps to exactly one destination:

| OpenCoop status         | Destination                                                        |
|-------------------------|-------------------------------------------------------------------|
| `ACTIVE`                | existing members list (reused)                                    |
| `INACTIVE`              | removed from members list; moved to resigned list **iff** one is configured |
| `PENDING` / no email    | skipped                                                           |

(No local "was synced" flag is needed — removing an `ext_id` that isn't on a list is an
idempotent no-op, so `INACTIVE` shareholders are reconciled the same whether or not they
were ever pushed.)

The members list is the coop's **pre-existing** list (e.g. the current "coöperanten"
list) — referenced by ID, never created by OpenCoop. A resigned list is **optional**:
if `brevoResignedListId` is set, resigned contacts are moved there; otherwise they are
simply unlisted from the members list. Either way the contact is retained in the provider
(GDPR-safe, reversible).

"Active" = `Shareholder.status === 'ACTIVE'`. Email is resolved via the existing
fallback chain (`resolveShareholderEmail`: `User.email ?? Shareholder.email ?? null`,
see `apps/api/src/modules/shareholders/shareholder-email.resolver.ts`). Contacts are
deduplicated by resolved email.

Reconcile = compute the desired mapping for the coop, then issue the minimal provider
operations to make it true:
- Bulk-upsert active members into the (existing) members list with attributes.
- For each newly-`INACTIVE` previously-synced contact: remove from the members list, and
  add to the resigned list only if `brevoResignedListId` is configured.

### 3. Identity & email-change handling (no duplicates) — via `EXT_ID`

Provider contacts are keyed by email, so a naive "upsert by email" would create a
**second** contact when a member's email changes, orphaning the old one.

Fix (confirmed against the live account): the Bronsgroen Brevo account already exposes
the built-in **`EXT_ID`** contact attribute, and Brevo can identify/update a contact by
it (`identifierType=ext_id`). We store the **OpenCoop shareholder ID** in `EXT_ID` on
every upsert, making the *immutable shareholder ID* — not the mutable email — the
identity anchor:

- **Normal upsert:** create/update the contact addressed by `ext_id = shareholder.id`,
  setting email + attributes + list membership. Idempotent.
- **Email change:** just push the new email on the `ext_id`-addressed update
  (`PUT /v3/contacts/{shareholderId}?identifierType=ext_id` with `{ email: newEmail }`).
  Brevo moves the existing contact to the new address — no orphan, and OpenCoop needs to
  remember nothing about the old email.
- **First sync of pre-existing contacts:** the ~732 contacts already in the Coöperanten
  list predate `EXT_ID`. The initial reconcile matches them by email (updateEnabled) and
  *sets* their `EXT_ID`; subsequent runs address them by `ext_id`. (If a contact's new
  email collides with a different existing contact, Brevo errors → logged as a
  per-contact failure, never aborts the batch.)

This removes the need for a `Shareholder.brevoSyncedEmail` shadow column — there is **no
schema change on `Shareholder`**. "Was this shareholder ever synced?" is answered
idempotently by the provider (removing a non-present contact from a list is a no-op), not
by local state.

### 4. Units (each independently testable)

- **`EmailAudienceProvider`** (interface — the seam). Methods, all provider-agnostic:
  - `verifyConnection(): Promise<{ ok: boolean; detail?: string }>`
  - `listLists(): Promise<{ id: string; name: string }[]>` (for the settings list picker)
  - `upsertContacts(contacts, listId): Promise<UpsertResult>` (bulk; each contact carries
    `extId`, `email`, `attributes` — provider identifies by `extId`, falling back to
    email on first touch)
  - `setContactLists(extId, { addListIds, removeListIds }): Promise<void>`
  Identity is `extId` (the OpenCoop shareholder ID); email is a mutable attribute. Knows
  nothing about shareholders or coops.
- **`BrevoProvider`** — implements the interface against the Brevo REST API. The only
  file that knows Brevo exists. Uses the bulk import endpoint for the members push and
  single calls for renames/moves. Handles Brevo rate limits and maps Brevo errors to a
  provider-neutral shape.
- **`AudienceSyncService`** — the reconcile engine, exposing `reconcileOne(coopId,
  shareholderId)` and `reconcileAll(coopId)`. Computes the desired mapping, derives the
  minimal operation set, calls the provider, returns a run summary. The pure,
  heavily-tested core; provider-agnostic.
- **`audience-sync` Bull queue + processor** — handles two job kinds against the same
  service: `reconcile-one` (per-change) and `reconcile-all` (cron / manual). Retryable
  (existing default: 3 attempts, exponential backoff). Resolves the provider via a small
  factory keyed on `Coop.emailAudienceProvider`. A coop-scoped dedup/lock prevents a
  `reconcile-all` and `reconcile-one` for the same coop from overlapping.
- **Shareholder service emit points** — after a committed mutation, enqueue a
  `reconcile-one` job (best-effort; failures fall through to the nightly pass). See §1a.
- **Cron scheduler** — nightly `@Cron(..., { timeZone: 'Europe/Brussels' })`; enqueues
  one `reconcile-all` job per coop where `emailAudienceProvider` is set.
- **Admin controller** — `POST /admin/coops/:coopId/brevo/sync` (manual trigger,
  enqueues a job) and `POST /admin/coops/:coopId/brevo/test` (test connection). Brevo
  config fields flow through the existing settings `PUT`. Guarded like other
  integration toggles (`canManageSettings`; provider/secret fields gated to
  `SYSTEM_ADMIN`).
- **Provider factory** — `getAudienceProvider(coop): EmailAudienceProvider` returns
  `BrevoProvider` for `'brevo'`; throws for unimplemented providers (`'mailchimp'`).
- **Settings UI section** — enable toggle, provider select, API key (write-only /
  masked like `smtpPass`), members list ID (required) + optional resigned list ID,
  "Test connection" + "Sync now" buttons, and last-run status (counts + errors from the
  latest `BrevoSyncRun`). A list picker can populate IDs from the provider's existing
  lists so admins select their current "coöperanten" list rather than typing an ID.

### 5. Data model additions

```prisma
// Coop — per-coop audience-sync config (follows the existing SMTP/Graph/Ponto pattern)
emailAudienceProvider String?   // "brevo" | "mailchimp" | null (off). Drives cron + factory.
brevoApiKey           String?   // AES-256-GCM encrypted at rest; never returned to client
brevoMembersListId    String?   // the coop's EXISTING list (reused). Bronsgroen = "3" (Coöperanten)
brevoResignedListId   String?   // OPTIONAL — if null, resigned contacts are just unlisted
brevoLastSyncAt       DateTime?
brevoLastSyncStatus   String?   // "OK" | "PARTIAL" | "ERROR" | "RUNNING"

// NOTE: no change to `Shareholder` — identity lives in Brevo's EXT_ID (= shareholder.id),
// so no brevoSyncedEmail shadow column is needed (see §3).

// New table — one row per reconcile run, for the settings UI + audit trail
model BrevoSyncRun {
  id        String   @id @default(cuid())
  coopId    String
  coop      Coop     @relation(fields: [coopId], references: [id], onDelete: Cascade)
  startedAt DateTime @default(now())
  finishedAt DateTime?
  status    String   // "OK" | "PARTIAL" | "ERROR"
  added     Int      @default(0)
  updated   Int      @default(0)
  moved     Int      @default(0)  // active → resigned
  skipped   Int      @default(0)  // no email / PENDING
  failed    Int      @default(0)
  errors    Json?    // [{ email, message }]
  trigger   String   // "per-change" | "cron" | "manual"
  scope     String   // "one" (reconcileOne) | "all" (reconcileAll)
  @@index([coopId, startedAt])
}
```

> **Migration note:** per repo convention use `prisma migrate dev --name ...` and
> commit the migration (db push alone does not reach acc/prod).

### 6. Synced contact fields (v1 fixed map) — confirmed against the live account

| Provider field | Source                                  | Role                       |
|----------------|-----------------------------------------|----------------------------|
| `EXT_ID`       | `Shareholder.id`                        | identity anchor (§3)       |
| email          | `resolveShareholderEmail(shareholder)`  | contact email (mutable)    |
| `FIRSTNAME`    | `Shareholder.firstName`                 | merge field                |
| `LASTNAME`     | `Shareholder.lastName` / `companyName`  | merge field                |

Verified live (`GET /v3/contacts/attributes`, Bronsgroen CV, 2026-06-18) — the account's
editable attributes are `FIRSTNAME`, `LASTNAME`, `SMS`, `EXT_ID`, `LANDLINE_NUMBER`,
`CONTACT_TIMEZONE`, `JOB_TITLE`, `LINKEDIN` (plus computed globals `BLACKLIST`,
`READERS`, `CLICKERS`). There is **no** `LANGUAGE` / `SHARES` / `MEMBER_SINCE` attribute,
so v1 maps only the fields that already exist.

Richer attributes are a future iteration, gated on first **creating** the matching custom
attributes in the coop's Brevo account (`POST /v3/contacts/attributes`).

### 7. Error handling & safety

- **Per-change is best-effort and MUST NOT block the OpenCoop write.** Emit points only
  *enqueue* a `reconcile-one` job after the DB commit — they never call the provider
  inline. If the provider is unreachable, the shareholder edit still succeeds; the job
  retries (Bull backoff) and, if it ultimately fails, the **nightly `reconcile-all` is
  the backstop** that repairs the drift. This safety net is what makes fire-and-forget
  per-change safe.
- **Per-contact failures do not fail the batch.** They are collected into
  `BrevoSyncRun.errors`; the run is marked `PARTIAL` and still counts as a success for
  the job (no infinite retry on one bad address). Whole-job/transport failures use the
  existing Bull retry (3× exponential backoff).
- **Never force-resubscribe.** Upserts set attributes and list membership but rely on
  the provider's own unsubscribe state — re-importing will not revive an unsubscribed
  contact. GDPR-safe. This is concrete, not theoretical: the Coöperanten list already
  holds **59 blacklisted (unsubscribed)** contacts that the first sync will touch and
  must preserve. Provider upserts MUST NOT set `emailBlacklisted: false`.
- **One-way only.** OpenCoop is the source of truth; the sync never reads audience data
  back into OpenCoop.
- **Secrets.** API key AES-256-GCM encrypted at rest (same helper as `smtpPass` /
  Ponto tokens), masked in API responses, write-only from the UI, provider/secret
  fields gated to `SYSTEM_ADMIN`.
- **Tenancy.** Every query is `where: { coopId }`; the cron fans out one isolated job
  per coop; there is no shared list, key, or contact path between coops.
- **Concurrency.** A coop's `brevoLastSyncStatus = "RUNNING"` (or a job-dedup key)
  prevents overlapping runs for the same coop (cron + button at once).
- **Brevo IP allowlisting (deploy prerequisite).** The Bronsgroen Brevo key has
  authorised-IP restriction enabled — calls from un-listed IPs get `401 unauthorized`
  ("unrecognised IP address"). **The fsn1 production/acc server IP must be added to
  Brevo's authorised IPs** (app.brevo.com → Security → Authorised IPs) before the sync
  works in deployed environments, or every call 401s. The "Test connection" action
  surfaces this clearly (it will report the 401 + offending IP). Document the server IP
  in the coop's onboarding checklist.

### 8. Testing

- **Engine unit tests (highest value).** Feed `AudienceSyncService` a set of
  shareholders + a fake current provider state and assert the exact operation list, for
  both `reconcileAll` and `reconcileOne`, including: active→members upsert, resign→move,
  email-rename, skip-no-email, and the idempotent no-op second run. Provider is mocked.
- **Per-change non-blocking test.** Assert a shareholder mutation still commits when the
  provider throws / the queue is unavailable (emit point only enqueues, never awaits the
  provider), and that a `reconcile-one` job is enqueued on the right field changes.
- **`BrevoProvider` tests** against recorded Brevo responses (success, partial,
  auth-failure, rate-limit).
- **Manual smoke** against a Brevo test list before the first production run.

## Per-coop summary

| Knob                       | Location                                   | Per-coop |
|----------------------------|--------------------------------------------|----------|
| On/off + provider choice   | `Coop.emailAudienceProvider`               | yes      |
| API key (encrypted)        | `Coop.brevoApiKey`                         | yes      |
| Members / resigned list IDs| `Coop.brevoMembersListId` / `...ResignedListId` | yes |
| Which shareholders sync    | `where: { coopId }`                        | yes (enforced) |
| Sync history               | `BrevoSyncRun.coopId`                       | yes      |

## Open questions / future

- Attribute mapping UI (v1 is fixed).
- Mailchimp provider (seam ready; account available for later testing).
- Optional prospects/sympathisanten list once OpenCoop models that audience cleanly.
- OpenCoop-owned campaign send (sync-then-send) if exact moment-before-send freshness is
  ever needed beyond what per-change + nightly provide.
