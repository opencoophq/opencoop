# OpenCoop — Repo Audit & Improvement Plan

**Date:** 2026-06-10 · **Commit:** d9542df (`fix/kiosk-body-size-limit`) · **Method:** 6 parallel read-only audit passes (architecture, code quality, security, testing, performance/dependencies, DevEx/ops/docs), findings verified against source with file:line citations. No code was modified.

---

## Executive Summary

**Overall health: B−.** The foundations are genuinely strong for a solo-built production SaaS — a disciplined guard stack (`JwtAuthGuard → RolesGuard → CoopGuard → SubscriptionGuard → PermissionGuard`), a shared domain package that eliminates FE/BE duplication of money math, 233 fast green unit tests, a real 26-spec Playwright suite, excellent CHANGELOG discipline, and a clean migration architecture. The grade is dragged down by three things: **none of those tests gate anything** (no `pull_request` CI trigger, deploys don't `need` the e2e job, Jest never runs in CI), **two confirmed cross-tenant authorization bugs** (dividends module and manual payments accept bare ids without `coopId` scoping), and **the statutory dividend tax calculation is untested unrounded floating point**. Top 3 risks: (1) a bad change can merge, deploy to prod, and corrupt money records with zero automated checks in its path; (2) a coop admin can read/mutate another cooperative's dividend payouts and registrations; (3) 739 rows of real member PII are committed to git history. Top 3 opportunities: (1) ~5 lines of workflow YAML turns the existing test investment into an actual safety net; (2) two surgical `coopId` fixes close the tenant-isolation holes, then guard tests lock them; (3) a small test suite over `packages/shared` + the dividends service protects every euro the platform touches.

---

## Repo Map

**Purpose:** Multi-tenant SaaS for Belgian cooperative shareholding management — shareholders, share classes, registrations/payments with OGM matching, dividends (30% roerende voorheffing), AGM/meetings with voting/proxies/kiosk check-in, document generation. In production at opencoop.be with real customer data (Bronsgroen).

**Stack:** pnpm workspaces + Turbo. API: NestJS 10, Prisma 6, PostgreSQL 16, Bull/Redis, Passport JWT (+ MFA/TOTP, WebAuthn, Google/Apple OAuth, magic links). Web: Next.js 14 App Router, React 18, next-intl (4 locales), Radix/Tailwind. Extras: MCP server (`@rekog/mcp-nest`), external API with API keys, Ponto open banking, Sentry (API only), Fumadocs site (`apps/docs`).

```
Cloudflare → Caddy (fsn1) → [web :3002] ──fetch──> [api :3001]
  Request → helmet/CORS/Throttler(global) → JwtAuthGuard → RolesGuard
  → CoopGuard(:coopId) → SubscriptionGuard → PermissionGuard
  → Controller → Service → Prisma → Postgres
                    └→ Bull (email, reminders) → Redis → SMTP/MS Graph
```

| Path | Role |
|---|---|
| `apps/api/src/modules/` | 31 feature modules, 23 controllers, 43 services |
| `apps/api/src/common/guards/` | api-key, coop, jwt-auth, permission, roles, subscription |
| `apps/web/src/app/[locale]/` | 88 page routes (67 client components); public coop pages, auth, dashboard |
| `apps/web/src/lib/api.ts` | central fetch wrapper: localStorage JWT, single-flight refresh, multi-session |
| `packages/database/prisma/schema.prisma` | 1,302 lines, **48 models**, 27 enums |
| `packages/shared/src/` | OGM, IBAN/VAT/national-ID validation, dividend & vesting math, EPC QR |
| `packages/pdf-templates/` | React-PDF templates (certificates, statements, convocations) |
| `.github/workflows/build-deploy.yml` | lint(web) → build → Playwright e2e → Docker → GHCR → SSH deploy (main→acc, v*→prod) |
| `e2e/` | 26 Playwright specs (separate npm sub-project) |

**Scale:** ~68k LOC tracked TS/TSX. 233 unit tests in 24 suites (apps/api, run green in 11.6s on 2026-06-10).

**Conventions that hold:** controller-level guard stacks; class-validator DTOs (69/78 `@Body()` usages); manual tenant scoping via `findFirst({ where: { id, coopId } })`; `formatCurrency` from shared (99 call sites, zero hardcoded locale formatting); `api()` helper for authenticated fetches (94 call sites); Nest `Logger` over `console` (only 17 strays).

**Surprises:**
- The **meetings module is the architectural north star** — 12 focused services, densest test coverage. Older modules (auth, admin) show the earlier "one giant file" style; refactors should converge toward the meetings style.
- **Docs describe a phantom stack:** CLAUDE.md claims React Query and next-auth — neither is a dependency of `apps/web`. It claims the MCP endpoint is "public, no auth" — the code actually gates it behind `McpAuthMiddleware` with per-key tenant scoping (`apps/api/src/app.module.ts:112`). It claims 27 Prisma models; there are 48.
- In-place `tsc` runs have littered hundreds of untracked `.js`/`.d.ts` siblings through `src/` dirs (gitignored, but noisy and one careless `git add -A` from disaster — which project memory says has happened once already).

---

## Audit Report

Severity: **C**ritical / **H**igh / **M**edium / **L**ow. Each finding labeled FACT (verified in code) or JUDGMENT (assessment).

### Security & tenant isolation

| # | Sev | Finding |
|---|---|---|
| S1 | **H** | **Cross-tenant IDOR in dividends.** `admin.controller.ts:830,849,860,872` pass only the bare `:id` to `dividends.service.ts` `findById`/`calculate`/`markAsPaid`/`exportToCsv`, which use `findUnique({ where: { id } })` with no `coopId`. A Coop A admin with a Coop B period id can read names/emails/amounts, recalculate, mark paid, and export Coop B's bank-transfer CSV. The registrations module was hardened in an earlier pass (`// C4: Added coopId for tenant isolation`); dividends was missed. FACT. |
| S2 | **H** | **Cross-tenant write in manual payments.** `payments.service.ts:46` `addPayment` looks up the registration by bare id and never asserts `registration.coopId === data.coopId` — a foreign registration can be paid and its status flipped to ACTIVE/COMPLETED. Called from `admin.controller.ts:723`. FACT. |
| S3 | **H** | **All three production images run as root** — no `USER` directive in `apps/api/Dockerfile`, `apps/web/Dockerfile`, `deploy/migrate.Dockerfile`. Any RCE gets root in-container. FACT. |
| S4 | **H** | **JWTs (access + 30-day refresh) in localStorage** (`apps/web/src/lib/api.ts:22,59-61`). Mitigated: 15-min access tokens, refresh tokens hashed at rest + rotated + revocable. Residual: XSS steals 30 days of access. Known, accepted tradeoff — documented here for the record. FACT (storage) / JUDGMENT (severity). |
| S5 | **M** | **92 prod dependency vulnerabilities (35 high)** — `pnpm audit --prod`. Concentrated: **next@14.2.35** (SSRF, middleware bypass, smuggling, cache poisoning), **hono** via `@modelcontextprotocol/sdk@1.27.1` (public-facing MCP route), **multer 1.x** (deprecated line, DoS), **nodemailer 6** (SMTP command injection), **undici** (smuggling). FACT. |
| S6 | **M** | **Public feature-request endpoint creates GitHub issues at up to 100/min/IP** — `feature-requests.controller.ts:12` is `@Public()` with no per-route `@Throttle` (auth routes all have 3–5/min). Spam floods the repo and the autonomous feedback-to-PR pipeline. FACT. |
| S7 | **M** | **Kiosk search exposes member directory incl. home addresses** to anyone holding the kiosk session token — `meeting-kiosk.controller.ts:25` + `kiosk.service.ts:69-102` return `address`/`memberNumber` on 2-char queries, no tight throttle. A photographed iPad URL = enumerable member list during the session. JUDGMENT (design tradeoff). |
| S8 | **M** | Root `docker-compose.yml:12-13,22-23` publishes Postgres 5432 / Redis 6379 to the host. Prod uses `deploy/docker-compose.yml` (internal networks, verified safe) — risk only if root compose runs on an open-firewall host. FACT. |
| S9 | **L** | Logout revokes refresh tokens but no access-token denylist (15-min window). Acceptable. FACT. |

**Passed (evidence-checked):** no hardcoded secrets in frontend; auth endpoints tightly throttled (3–5/min); zero `$queryRaw*Unsafe` (one legit `$queryRaw` aggregate); CORS pinned to `FRONTEND_URL`; no JWT secret fallback in code; every admin/system controller carries the full guard stack; no `.env` ever committed; Sentry filter + helmet + prod-disabled Swagger; upload validation solid (MIME allowlist, size caps, `path.basename()` traversal guard, randomized names); bcrypt cost 12 everywhere; 15-min/30-day token model with rotation; MCP requires API key with per-key tenant scoping; shareholders/registrations/messages/documents/kiosk all correctly coop-scoped (S1/S2 are the exceptions); no open redirects.

### Testing

| # | Sev | Finding |
|---|---|---|
| T1 | **C** | **No test gates anything.** No `pull_request` trigger in any workflow → PRs merge with zero checks. `deploy-acc`/`deploy-prod` need only `[build]` — the `e2e` job (which also contains the only lint step) runs in parallel and **a red e2e suite does not block a prod deploy**. The 233 Jest tests are never executed in CI at all. `auto-merge.yml` auto-merges labeled PRs on one approval with no required checks. Combined with the autonomous feedback-to-PR pipeline: Claude-generated code can reach prod having never run a test. FACT. |
| T2 | **C** | **Dividend calculation untested + unrounded.** `dividends.service.ts:266-267` computes payout tax as raw float (`sumGross * rate`, no rounding) and discards the rounded values from `calculateDividend()` (`packages/shared/src/utils.ts:30-43`); unrounded values persist via `createMany` (:280) and surface in the bank CSV (:448) and PDF statements. Vesting (`Math.floor(totalPaid/pricePerShare)`, :234-240) and rate overrides equally untested. Statutory tax math with no safety net. FACT (untested, unrounded) / JUDGMENT (cent-error materialization). |
| T3 | **H** | **OGM generation/validation has zero tests** — `packages/shared` has no test runner at all. The mod-97 `checkDigit === 0 → 97` branch (`utils.ts:59-60`) silently breaks payment matching for 1-in-97 codes if ever touched. FACT. |
| T4 | **H** | **Registration lifecycle and bank-import matching untested**: `approve`/`complete`/`cancel` (`registrations.service.ts:509-569`, creates residual Payment rows inside `$transaction`), `bank-import.service.ts:86-180` (OGM extraction + matching + partials), `payments.service.ts` — all zero specs. 20 of 31 API modules have no unit tests, including payments, dividends, transactions, billing, bank-import, shares, documents. FACT. |
| T5 | **H** | **All guards and strategies untested** — `CoopGuard` (29 lines, the entire tenant-isolation mechanism), RolesGuard, PermissionGuard, jwt.strategy: no specs. One-line regressions here leak tenant data. FACT. |
| T6 | **H** | **apps/web: 0 tests** for 168 source files. Project memory documents a shipped runtime crash (React-18 `use(params)`) that types+build both passed — the exact class a smoke test catches. FACT. |
| T7 | **M** | E2E asserts UI surface, not outcomes — purchase spec asserts a success toast, never the created registration/amount/OGM (`e2e/tests/shareholder/purchase-shares.spec.ts:40`). Suite is serial, order-dependent on shared seeded state, with `waitForTimeout` sleeps and CI `retries: 1` masking flakes (`playwright.config.ts:8-11`). FACT/JUDGMENT. |
| T8 | **L** | No `coverageThreshold`; the `@react-pdf` ESM `jest.mock` workaround is copy-pasted per spec file and structurally excludes PDF generation (legal documents) from all testing. FACT. |

**Strengths:** the tests that exist are good — `votes.service.spec.ts` exhaustively covers AGM majority math incl. ties/abstentions; auth specs cover household/orphan edge cases; no "should be defined" filler. Meetings (newest module) is best-tested: discipline is improving. Suite is fast (11.6s) — making it gate CI costs nothing.

### Performance & dependencies

| # | Sev | Finding |
|---|---|---|
| P1 | **H** | **Admin pages bypass their own server pagination**: shareholders and transactions pages request `pageSize: '10000'` and paginate client-side (`admin/shareholders/page.tsx:229`, `admin/transactions/page.tsx:176`), pulling heavy includes + per-row decryption. With Bronsgroen's thousands of imported registrations this is already a multi-MB payload per page load; backend pagination exists and is correct (`shareholders.service.ts:29-89`). FACT. |
| P2 | **H** | **Convocation send renders N PDFs inline in one HTTP request** (`convocation.service.ts:170-333`): per-shareholder upsert + `renderToBuffer` on the event loop; only the final email is queued. Hundreds of shareholders = minutes-long request stalling all tenants. Idempotency (`convocationSentAt`) is well done; the execution model belongs in a Bull job before the next AGM cycle. FACT. |
| P3 | **M** | Bank CSV import does per-row sequential creates/lookups in the request path (`bank-import.service.ts:77-130`); shareholder bulk import does row-by-row creates inside one interactive `$transaction` with the default 5s timeout (`shareholder-import.service.ts:384-448`) — a large import will abort wholesale. FACT. |
| P4 | **M** | Missing indexes: `BankTransaction` has zero `@@index` (queried by `{coopId, matchStatus}`); `DividendPayout.shareholderId` and `EmailLog.coopId` unindexed. (OGM is `@unique` — the hot lookup is O(1). AuditLog is the best-indexed model.) FACT. |
| P5 | **M** | Email Bull queue never cleans up: no `defaultJobOptions`, no `removeOnComplete` (`app.module.ts:50-55`, `email.service.ts:85,444`) — every email ever sent stays in Redis. The reminders queue does it right. Also no `attempts`/`backoff`: one SMTP blip permanently fails an AGM invite (Sentry + `EmailLog.FAILED` record it, nothing retries or alerts). FACT. |
| P6 | **L** | No retention anywhere: EmailLog, AuditLog, BankTransaction, expired token rows, generated convocation PDFs all grow unbounded. Fine today; monthly cron before 10x. FACT. |
| P7 | **L** | Cron-path N+1s (admin digest does a count per registration, `admin-notifications.service.ts:116-138`); unbounded `findMany` on bank-transaction endpoints. Off the hot path. FACT. |
| D1 | **M** | Major-version lag: Next 14→16, NestJS 10→11, Prisma 6→7, next-intl 3→4, Tailwind 3→4. Only **Next** has security pressure (past active support; several advisories patched only in 15+). Honest call: bump multer/nodemailer/MCP-SDK now, plan Next 14→15 (React 18 stays), batch the rest later — working-in-prod beats churn. FACT (versions) / JUDGMENT (priority). |
| D2 | **L** | Bull v4 is maintenance-mode (successor BullMQ) — someday-task. Dep set is otherwise clean: one date lib, no axios/moment/lodash directs, heavy packages all earn their keep. `e2e/package-lock.json` is a second package manager in the repo (intentional but inconsistent). FACT. |

### Code quality & architecture

| # | Sev | Finding |
|---|---|---|
| Q1 | **H** | **Tenant isolation is convention-only** — no Prisma middleware/extension or RLS enforces `coopId` scoping; 43 services rely on every author remembering `where: { id, coopId }`. S1/S2 prove the failure mode is real. JUDGMENT (mechanism FACT). |
| Q2 | **H** | **`auth.service.ts` is a 1,764-line god object**: login/register/onboarding, MFA, OAuth, magic links, emancipation tokens, refresh lifecycle, plus ~370 lines of inline HTML email (:1384, :1733). The most security-critical file is the hardest to review. FACT. |
| Q3 | **H** | **`admin.controller.ts`: 1,184 lines, 78 endpoints, injects PrismaService directly** (:35,75) — e.g. `getStats` (:295-330) runs a raw SQL capital aggregation (:312) in the HTTP layer, duplicating reports.service's definition by hand. There is no `admin.service.ts`. FACT. |
| Q4 | **H** | **Silent `.catch(() => {})` on initial data loads across 20+ dashboard pages** (e.g. `admin/billing/page.tsx:46`, `admin/page.tsx:62`, `admin/shareholders/page.tsx:255`) — an API outage renders admin pages as empty tables indistinguishable from "no data". FACT / JUDGMENT (severity). |
| Q5 | **M** | **Email templating scattered**: `email.processor.ts` is 1,209 lines with a 939-line `renderTemplate` holding ~15 templates × 4 hardcoded languages (its own comment: "in production, use a proper template engine" — :275); auth.service builds separate inline HTML with its own ad-hoc i18n. Branding/translation drift guaranteed. FACT. |
| Q6 | **M** | `api()` and `apiFetch()` near-verbatim duplicates of the security-sensitive refresh flow, already diverging (`apps/web/src/lib/api.ts:89-138` vs :140-184) — the known "login state lost" bug likely needs fixing twice. FACT. |
| Q7 | **M** | 9 endpoints accept inline-typed `@Body()` bypassing ValidationPipe — including **payment mutations** (`admin.controller.ts:703,715,730` — `amount` arrives unvalidated), kiosk check-in (:36), system plan/trial (:184), 4 webauthn routes. FACT. |
| Q8 | **M** | 8 of 16 exports in `packages/shared/src/utils.ts:71-173` are dead — including **all** IBAN/VAT/national-ID validators: the Belgian validation the platform advertises exists but nothing calls it. Wire in or delete (product decision). FACT (zero call sites). |
| Q9 | **M** | Frontend monoliths: top files 1,695 / 1,677 / 1,442 / 1,144 lines (`admin/shareholders/[id]/page.tsx`, `coop-register-content.tsx` — the revenue funnel, `admin/settings/page.tsx`, `admin/shareholders/page.tsx`), each hand-rolling fetch/state/dialogs; shareholder form fields duplicated across 4 components (13–19 fields, already drifting); 19 local `formatDate` copies; `alert()`/`confirm()` in the paid registration flow (`coop-register-content.tsx:717`). FACT. |
| Q10 | **M** | Circular module deps patched with `forwardRef` in 4 clusters (shareholders⇄auth, coops⇄shareholders, channels⇄shareholders, registrations⇄documents) — the Coop/Shareholder/Registration core is one entangled domain split across folders. FACT. |
| Q11 | **L** | Dual vocabulary: `Registration` (BUY/SELL types) vs a separate `transactions` module forces every financial aggregation to re-derive sign logic (e.g. the raw SQL in admin.controller:312). JUDGMENT. |
| Q12 | **L** | `any` is rare (37 API / 21 web) but clusters in auth; one risky pattern: `process.env.PONTO_CLIENT_ID!` (`ponto.client.ts:86`) crashes at request time, and `as unknown as T` (:274) makes the Ponto client unchecked. FACT. |

### DevEx, operations & documentation

| # | Sev | Finding |
|---|---|---|
| O1 | **C** | (= T1) Deploys don't need e2e; no PR CI; Jest never runs; auto-merge has no required checks. `.github/workflows/build-deploy.yml:153-154,178-179`. FACT. |
| O2 | **H** | **Migration failure mid-deploy = outage with no runbook**: `up -d` recreates the api container before `migrate` proves success; if `prisma migrate deploy` fails the old API is gone, the new one never starts, and the CI job still reports green (SSH script exits 0). No post-deploy health probe, no ROLLBACK.md (rollback = manually editing `TAG=` on fsn1 — possible thanks to SHA-tagged images, just undocumented). `deploy/docker-compose.yml:32-41`. FACT. |
| O3 | **H** | **No uptime monitoring** — `/health` does real Postgres+Redis checks but nothing external watches it; your own `docs/TECHNICAL_DEBT.md:50-52` flagged this on 2026-03-02, still open. First alert for a dead box is a user email. FACT. |
| O4 | **H** | **739 rows of real member PII committed to git**: `agents/cmo/campaigns/brevo-segments/S1_actieve_cooperanten.csv` (+S2, S3) — emails, names, shareholdings, in permanent history, in a repo with a LICENSE suggesting open-source intent. FACT. |
| O5 | **M** | **Web app has zero Sentry** (`@sentry/nextjs` absent) — the kiosk signature crash fixed in v0.8.33 was found by a user at an AGM, not by monitoring. API side is wired correctly (`instrument.ts` first-line, global filter). FACT. |
| O6 | **M** | API lint never runs anywhere (CI lints web only, `build-deploy.yml:60`); `react-hooks/exhaustive-deps` downgraded to warn; Prettier config-only. eslint-disable sprawl is minimal (5 repo-wide). FACT. |
| O7 | **M** | **CLAUDE.md drift directly degrades the autonomous PR pipeline**: 27→48 models, phantom React Query/next-auth, stale "MCP public no auth" (code requires API key — code is *safer* than docs), wrong Swagger path (`/docs` locally, not `/api/docs`; disabled in prod entirely), "Nginx" → actually Caddy, deployment section doesn't match the GHCR/migrate-container reality. FACT. |
| O8 | **M** | **Bus factor 1, fully**: no CONTRIBUTING, no in-repo ops runbook; the entire backup story lives in a private global CLAUDE.md and on servers; TECHNICAL_DEBT.md:31 admits a restore has never been rehearsed. FACT. |
| O9 | **L** | `.env.example` documents ~half the env surface (all 7 `PONTO_*`, Google/Apple OAuth, `SENTRY_DSN`, `GITHUB_TOKEN` missing); `PONTO_*` also absent from `deploy/docker-compose.yml` env passthrough. Optional features fail soft. FACT. |
| O10 | **L** | Working-tree/repo hygiene: tracked `apps/web/tsconfig.tsbuildinfo` (predates ignore rule); one-off customer-named prod scripts in `packages/database/prisma/` with compiled twins (ignore rules don't cover `prisma/`); PDFs/lockfiles/tmp in root; 61 dirty paths drowning real signal. FACT. |

### Strengths (what to preserve)

1. **Guard-stack defense in depth** + strict global ValidationPipe (`whitelist`+`forbidNonWhitelisted`), helmet, pinned CORS, throttling, prod-disabled Swagger, reasoned `trust proxy 2`.
2. **`packages/shared` domain layer** — money math written once, consumed by API/web/PDFs (the convention held: 99 `formatCurrency` call sites, zero hardcoded formatting).
3. **Real E2E investment**: 26 Playwright specs against seeded Postgres+Redis in CI with role-scoped auth states — rare at this stage. It just needs to gate.
4. **Meetings module** as the template for new code: 12 focused services, 8 spec files, best patterns in the repo.
5. **Ops fundamentals**: dedicated migrate container gating API start, SHA-tagged immutable images, ~5-min pipeline, real health checks, Sentry properly wired on the API, idempotent convocation sends.
6. **Hygiene above solo-dev average**: zero `@ts-ignore`, no TODO/commented-out-code rot, intentional fire-and-forget patterns with comments, excellent CHANGELOG (same-day entries per tag with migration/security notes), candid self-audit in `docs/TECHNICAL_DEBT.md`.

---

## Improvement Strategy

### Theme 1 — Wire in the safety nets you already built
Most alarming findings (T1/O1) aren't missing infrastructure — the tests, lint configs, and e2e suite all exist; nothing executes them at decision points. **Target state:** every PR runs lint + typecheck + Jest; deploys require green e2e; auto-merge requires passing checks. **Principle:** a test that doesn't gate is documentation, not protection. This is the highest leverage-per-line in the entire plan (~5 lines of YAML).

### Theme 2 — Make tenant isolation structural, not conventional
S1/S2 happened because scoping is a per-query convention across 43 services. **Target state:** the two live IDORs fixed; guard + isolation regression tests; then a `coopScoped(prisma, coopId)` helper or Prisma client extension so unscoped lookups on tenant models become the exception that stands out in review. **Principle:** in a multi-tenant system, isolation must be enforced where queries are made, not remembered where they're written. (Full RLS is overkill at this maturity — explicitly deferred.)

### Theme 3 — Put the money math under test, then fix what the tests reveal
Dividend tax (statutory), OGM check digits, payment-completion arithmetic, and registration state transitions are the product's reason to exist and have zero coverage; one rounding fix (T2) is already known-needed. **Target state:** `packages/shared` gets a test runner and exhaustive tests for OGM/dividend/vesting math; dividends + payments + bank-import services get behavioral specs; payout tax is rounded per payout. **Principle:** code that moves other people's money gets tests before it gets features.

### Theme 4 — Close the operational blind spots
No uptime monitor, no web error tracking, no email retries, no rollback runbook, untested restore — all cheap, all flagged in your own TECHNICAL_DEBT.md months ago. **Target state:** external monitor on `/health`, `@sentry/nextjs` on web, `attempts: 3` + `removeOnComplete` on the email queue, post-deploy health probe in the workflow, a one-page `docs/OPERATIONS.md`, one rehearsed restore. **Principle:** for a solo operator, the system must page you — you can't be the monitoring.

### Theme 5 — Stop the drift that poisons the autonomous pipeline
CLAUDE.md is the operating manual for the Claude feedback-to-PR pipeline; it currently teaches agents a phantom stack (React Query, next-auth, public MCP, 27 models). PII CSVs and customer-named scripts in/around the repo compound the risk. **Target state:** CLAUDE.md matches reality; PII purged from history; gitignore hardened; one-offs quarantined. **Principle:** automation amplifies whatever the docs say — keep them true.

### Explicitly NOT fixing (and why)
- **NestJS 11 / Prisma 7 / Tailwind 4 / next-intl 4 upgrades** — no security driver; churn risk exceeds payoff right now. Batch in a quiet quarter.
- **Bull → BullMQ** — maintenance-mode is fine for 3 small queues; fix job options instead.
- **React Query retrofit / RSC rewrite of dashboard pages** — the `useEffect` pattern is suboptimal but working; fix P1 (pagination) and Q4 (error states) surgically instead of a framework migration.
- **localStorage → httpOnly-cookie auth overhaul** — known accepted tradeoff with real mitigations (15-min tokens, hashed+rotated refresh). Revisit if/when a security review for enterprise customers demands it.
- **Local-disk uploads → object storage** — blocks horizontal scaling you don't need yet; acceptable with the existing backup regime.
- **Registration/Transaction vocabulary consolidation** — real debt (Q11) but XL effort touching the financial core; do it only with the test safety net from Theme 3 in place, as a deliberate project.

### Definition of done (measurable)
- A PR with a failing unit test or failing e2e **cannot** merge; a red e2e **cannot** deploy.
- `dividends.service` and `payments.service` have zero unscoped-by-`coopId` lookups; CoopGuard + IDOR regression tests exist and run in CI.
- `packages/shared` has a test suite; OGM mod-97 (incl. 0→97) and dividend rounding are covered; payout `tax`/`net` are rounded to cents.
- `pnpm audit --prod` high-severity count < 5, and the audit runs in CI (non-blocking report at first).
- An external uptime monitor alerts on `/health`; web errors reach Sentry; email jobs retry 3×.
- The brevo PII CSVs are gone from git history; `git status` on a fresh clone + build is clean.
- CLAUDE.md passes a spot-check: model count, MCP auth, state management, Swagger path all correct.

---

## Task Plan

### Milestone 0 — Safety net (do before any refactoring)

| ID | Task | Files/areas | Acceptance criteria | Effort | Risk | Deps |
|---|---|---|---|---|---|---|
| **M0.1** | **Gate CI**: add `pull_request` trigger running lint (web **and** api) + Jest; add `needs: [build, e2e]` to both deploy jobs; make auto-merge require checks (branch protection) | `.github/workflows/build-deploy.yml`, `auto-merge.yml`, repo settings | PR shows checks; red Jest/e2e blocks merge & deploy; verified with a deliberately broken test on a draft PR | **S** | Low (CI-only) — note: per your own rules, CI changes are human-only, not for the feedback pipeline | — |
| M0.2 | Guard unit tests: CoopGuard (admin-owns-coop, SYSTEM_ADMIN bypass, SHAREHOLDER fall-through), RolesGuard, PermissionGuard | `apps/api/src/common/guards/*.spec.ts` | All branches asserted; runs in CI | S | None (test-only) | M0.1 |
| M0.3 | Money-math test suite: add test runner to `packages/shared`; tests for OGM (mod-97 incl. 0→97 branch, format/parse roundtrip), `calculateDividend` rounding, vesting | `packages/shared` (jest/vitest config + specs) | OGM + dividend math fully covered; runs in CI | M | None | M0.1 |
| M0.4 | IDOR regression tests for dividends + addPayment (failing first — they document S1/S2) | `apps/api/src/modules/dividends/`, `payments/` specs | Tests fail on current code, pass after M1.1/M1.2 | S | None | M0.1 |

### Milestone 1 — Critical fixes (security & correctness)

| ID | Task | Files/areas | Acceptance criteria | Effort | Risk | Deps |
|---|---|---|---|---|---|---|
| **M1.1** | **Fix dividends IDOR**: thread `coopId` through `findById`/`calculate`/`markAsPaid`/`exportToCsv`; `findFirst({ where: { id, coopId } })` + NotFound on miss (mirror registrations' C4 pattern) | `dividends.service.ts:47,152,171+`, `admin.controller.ts:830-872` | M0.4 tests green; cross-coop id returns 404 | **S** | Low | M0.4 |
| **M1.2** | **Fix addPayment cross-tenant write**: assert `registration.coopId === data.coopId`, 404 otherwise | `payments.service.ts:46-93` | M0.4 test green | **S** | Low | M0.4 |
| M1.3 | Fix dividend payout rounding: round `tax`/`net` per payout to cents (half-up); reconcile period totals; decide remainder allocation | `dividends.service.ts:266-280` | M0.3 tests green incl. a sum-reconciliation case; CSV/PDF amounts are exact cents | S | Medium (changes persisted financial values — verify against an existing period before/after) | M0.3 |
| M1.4 | Dependency burn-down round 1: multer→2, nodemailer→8, `@modelcontextprotocol/sdk`→≥1.29 (pulls patched hono), undici bump, latest Next 14.2.x patch; add `pnpm audit --prod` report step to CI | `package.json`s, lockfile, CI | `pnpm audit --prod` high count materially down; e2e green | M | Medium (mail + upload paths — covered by e2e after M0.1) | M0.1 |
| M1.5 | **Purge PII from git history**: remove brevo-segment CSVs via `git filter-repo`, force-push, rotate any clones; gitignore `agents/`, `memory/`, `*.tmp`, `.~lock*`, `packages/database/prisma/*.{js,d.ts}`; `git rm --cached` tsbuildinfo; move one-off scripts to gitignored `scripts/one-off/` | repo root, `.gitignore`, history | CSVs absent from `git log --all`; fresh clone + build leaves `git status` clean | M | **High-ish process risk** (history rewrite — coordinate with any open branches/PRs and the feedback pipeline; do it in a quiet window) | — |
| M1.6 | Non-root containers: add `USER` (+ uploads chown) to all three Dockerfiles; build locally first (per your own rule) | `apps/*/Dockerfile`, `deploy/migrate.Dockerfile` | Containers run as non-root; uploads still writable; acc deploy verified | S | Medium (volume permissions on fsn1 — test on acc) | — |

### Milestone 2 — High-leverage improvements

| ID | Task | Files/areas | Acceptance criteria | Effort | Risk | Deps |
|---|---|---|---|---|---|---|
| M2.1 | Ops hardening: external uptime monitor on `/api/health`; post-deploy `curl --fail` retry loop in deploy script; write `docs/OPERATIONS.md` (deploy, rollback-by-TAG, backup locations, restore steps); rehearse one restore | workflow, fsn1, docs | Monitor alerts on simulated downtime; rollback executed once on acc; restore drill documented | M | Low | — |
| M2.2 | Web Sentry: `@sentry/nextjs` with client+server config | `apps/web` | A thrown test error appears in Sentry | S | Low | — |
| M2.3 | Email queue resilience: `defaultJobOptions: { attempts: 3, backoff: exponential, removeOnComplete: true, removeOnFail: 500 }` | `app.module.ts:50`, `email.service.ts` | Transient SMTP failure retries; Redis job count bounded | S | Low | — |
| M2.4 | Move convocation send to a Bull job (per-shareholder or batched), progress via existing `convocationSentAt` | `convocation.service.ts`, new processor | Send for 500-shareholder coop returns immediately; PDFs render off the request path; idempotency preserved | M | Medium (touches AGM-critical flow — after M0 tests) | M0.1 |
| M2.5 | Kill `pageSize=10000`: use existing server pagination + search on admin shareholders/transactions pages | `admin/shareholders/page.tsx`, `admin/transactions/page.tsx` | Pages request ≤50 rows; filters become server-side params; e2e green | L | Medium (most-used admin pages) | M0.1 |
| M2.6 | Throttle + slim public surfaces: `@Throttle(3/min)` on feature-requests + migration-requests; tight throttle on kiosk `:token/search`; drop `address` from kiosk projection | `feature-requests.controller.ts`, `meeting-kiosk.controller.ts`, `kiosk.service.ts` | 4th request/min returns 429; kiosk response has no address | S | Low | — |
| M2.7 | Truth-up docs: CLAUDE.md (48 models, no React Query/next-auth, MCP auth model, Swagger `/docs`, Caddy, real deploy flow), README quick-start check, complete `.env.example` (+ `PONTO_*` passthrough decision in deploy compose) | `.claude/CLAUDE.md`, `README.md`, `.env.example` | Spot-check passes; a fresh agent following CLAUDE.md hits no 404s/phantom deps | S | None | — |
| M2.8 | DTOs for the 9 inline-typed `@Body()` endpoints (payment mutations first: amount positive, bankDate valid date) | `admin.controller.ts:703-730`, kiosk, system, webauthn | Invalid payloads 400 with field errors; e2e green | S | Low | M0.1 |
| M2.9 | Behavioral specs for registration lifecycle (`approve`/`complete`/`cancel` arithmetic) and bank-import matching (full/partial/no-match) | registrations + bank-import specs | Decimal arithmetic + state transitions asserted incl. edge cases | M | None | M0.1 |

### Milestone 3 — Quality & polish

| ID | Task | Effort | Notes |
|---|---|---|---|
| M3.1 | Centralize email templating: one module, locale files instead of hardcoded 4-language strings, escaping for user-interpolated values; move auth.service's inline HTML there | L | Q5; unblocks consistent branding |
| M3.2 | Split `auth.service.ts` (core auth / MFA / OAuth / magic-link / emails) and extract `admin.service.ts` from the 78-endpoint controller (move `getStats` capital query to reports.service — single source of truth) | XL → break down | Q2/Q3; only after M0 coverage exists |
| M3.3 | Shared `formatDate`/`useFormatters()` (kills 19 copies); shared shareholder form component (kills 4 drifting copies); toast instead of `alert()`/`confirm()` in the registration funnel | M | Q9 |
| M3.4 | Error/empty/retry states for dashboard data loads (replace `.catch(() => {})` with a tiny `useApiData` hook) | M | Q4 |
| M3.5 | Merge `api()`/`apiFetch()` into one implementation | S | Q6 — do before touching the login-state bug |
| M3.6 | Indexes: `BankTransaction @@index([coopId, matchStatus])`, `DividendPayout @@index([shareholderId])`, `EmailLog @@index([coopId])`; retention cron for EmailLog/AuditLog/expired tokens/convocation PDFs | S–M | P4/P6; plain additive migration |
| M3.7 | Decide Q8: wire IBAN/VAT/national-ID validators into DTOs or delete them | S | Product decision first (see Open Questions) |
| M3.8 | Batch bank-import (`createMany` + single `findMany` for OGM lookups); chunk shareholder bulk import or raise transaction timeout | M | P3 |
| M3.9 | E2E hardening: assert DB-visible outcomes on the purchase path; remove `waitForTimeout`s; per-test data isolation | M | T7 |
| M3.10 | Plan + execute Next 14→15 migration (React 18 retained) | L | D1; after M0.1 so e2e gates it |

### Quick wins (high impact, S effort — doable immediately)
1. **M0.1** CI gating (~5 lines of YAML + branch protection) — converts the entire existing test investment into protection.
2. **M1.1 + M1.2** the two `coopId` fixes — surgical, pattern already exists in registrations.
3. **M2.3** email retries + Redis cleanup (two config objects).
4. **M2.6** throttles + kiosk projection trim.
5. **M2.7** CLAUDE.md truth-up — immediate quality boost for every autonomous PR.
6. **M1.6** Dockerfile `USER` directives.
7. **M2.2** web Sentry.

### Implementation sketches — top 3

**M0.1 — CI gating.** Add a `test` job to `build-deploy.yml` (or a new `ci.yml`) with `on: pull_request` + `on: push: [main]`: pnpm install (the setup steps already exist in the e2e job to copy), then `pnpm --filter @opencoop/api lint`, `pnpm --filter @opencoop/web exec next lint`, `pnpm --filter @opencoop/api test`. Change `deploy-acc`/`deploy-prod` to `needs: [build, e2e]`. In GitHub settings, protect `main` requiring the new checks (this is what makes `auto-merge.yml` safe — `gh pr merge --auto` waits for required checks). Gotchas: e2e currently triggers only on push, so PR runs need either the e2e job on PRs too (slower) or just lint+unit on PRs and e2e as the deploy gate; Jest needs no DB (all-mocked) so the PR job is fast (~12s test step). Per your own scope rules, workflow edits are yours to make, not the feedback pipeline's.

**M1.1/M1.2 — tenant scoping.** Copy the registrations C4 pattern. Dividends: change signatures to `findById(id, coopId)` etc.; replace `findUnique({ where: { id } })` with `findFirst({ where: { id, coopId } })`; update the four `admin.controller.ts` call sites which already have `@Param('coopId')` available; throw `NotFoundException` (not Forbidden — don't confirm the resource exists). Payments: in `addPayment`, the registration lookup already happens — add `if (!registration || registration.coopId !== data.coopId) throw new NotFoundException(...)`. Write the M0.4 regression tests first (two coops, period/registration of B requested via A's route → expect 404; same-coop path still works). Gotcha: check `exportToCsv` and `markAsPaid` for downstream queries that assume the period was already validated — scope at the entry lookup and the rest inherits safety.

**M1.3 — dividend rounding.** In `calculatePayouts`, after summing per-class gross: `const gross = roundToCents(sumGross); const tax = roundToCents(gross * rate); const net = gross - tax;` (net by subtraction keeps gross = tax + net exactly). Add a reconciliation test: sum of payout taxes vs `roundToCents(totalGross * rate)` can differ by cents across many payouts — decide policy (per-payout rounding is the defensible one for individual statements; document it). Gotcha: existing persisted payouts may carry float dust — write a one-time check query (not an auto-fix) listing payouts where `tax != round(gross*rate, 2)` and review before any backfill; Bronsgroen's periods were created via ad-hoc scripts, so verify against what was actually paid.

---

## Open Questions (need a human decision)

1. **Open-sourcing intent?** LICENSE/NOTICE exist. If yes, M1.5 (PII history purge) is urgent and must complete first; if the repo stays private it's still worth doing, but calmly.
2. **Dividend rounding policy**: per-payout rounding (statements exact, period total may drift by cents) vs period-level (total exact, payouts adjusted)? Has Bronsgroen's accountant expressed a preference for the roerende voorheffing declaration?
3. **Dead validators (Q8)**: should IBAN/VAT/national-ID validation actually run on registration input (could reject real users on edge cases), or be deleted?
4. **Kiosk address field**: is `address` needed on the check-in screen to disambiguate same-name members, or can it be dropped (M2.6)?
5. **localStorage auth**: reconfirm this stays accepted-as-is, so nobody "fixes" it ad hoc in a feedback-pipeline PR.
6. **Registration vs Transaction consolidation (Q11)**: appetite for an XL ledger refactor this year, or park it formally?
7. **Next 15 timing**: pick a quiet window (post-AGM-season worked once; the next one is spring 2027).

---

*Areas receiving lighter review (per the 80/20 rule): `apps/docs` (Fumadocs site), `packages/pdf-templates` internals, the Ponto client beyond type-safety spot checks, billing/Stripe webhook signature verification (flagged for a follow-up check), and the channels/gift-code module.*
