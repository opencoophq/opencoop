# Technical Debt & Infrastructure Improvements

Audit performed 2026-03-02 against [25 common anti-patterns](https://x.com). Results below.

## Status Legend

- **GREEN** — Not an issue
- **YELLOW** — Partially addressed, has a clear improvement path
- **RED** — Problem, needs fixing

## Current Scorecard

| # | Anti-Pattern | Status | Notes |
|---|---|---|---|
| 1 | API keys hardcoded | GREEN | `.env` gitignored, `.env.example` uses placeholders |
| 2 | No /health endpoint | GREEN | `GET /health` checks Postgres + Redis via @nestjs/terminus |
| 3 | Schema changes in your head | GREEN | 13 sequential Prisma migrations |
| 4 | SELECT * and vibes | YELLOW | Most queries use `select`/`include`; a few fetch full rows |
| 5 | Error handling = console.log | YELLOW | Sentry + NestJS exceptions on critical paths; `auth.service.ts` uses `console.error` |
| 6 | No rate limit on auth | GREEN | Global 100/min + per-endpoint auth limits (3-5/min) |
| 7 | Timezone mixing | GREEN | UTC backend, `toLocaleDateString(locale)` frontend |
| 8 | README empty or wrong | GREEN | Accurate setup, structure, scripts, deploy |
| 9 | No staging env | GREEN | Three-tier: dev, acc (auto-deploy main), prod (version tag) |
| 10 | God component | YELLOW | Shareholder detail page is 949 lines with 15+ useState |
| 11 | No analytics | RED | Zero product analytics integration |
| 12 | Tech debt culture | — | Subjective |
| 13 | Env vars undocumented | GREEN | Both `.env.example` files are thorough |
| 14 | Frontend bypasses API wrapper | GREEN | All dashboard pages use `api()`/`apiFetch()` |
| 15 | No monitoring or alerts | YELLOW | Sentry for errors; no uptime monitoring or infra metrics |
| 16 | Logs only exist locally | YELLOW | Docker log rotation in place; no aggregation service |
| 17 | DB backups untested | YELLOW | Backups exist (fsn1 → fra1); restore testing undocumented |
| 18 | Feature flags = commenting code | YELLOW | One clean env-var flag (`LAUNCH_MODE`); no system for more |
| 19 | Deploys from local machine | GREEN | Fully automated GitHub Actions CI/CD |
| 20 | No input validation | GREEN | Global ValidationPipe + 307 class-validator decorators |
| 21 | CORS set to * | GREEN | Restricted to `FRONTEND_URL` env var + Helmet |
| 22 | CI is just local testing | YELLOW | E2E + Docker builds; no unit tests, no lint step, no PR checks |
| 23 | Same token across envs | YELLOW | Env-var driven; `NEXTAUTH_SECRET` reuses `JWT_SECRET` |
| 24 | Only one person can deploy | YELLOW | CI/CD automated; server provisioning undocumented |

## Improvement Backlog

### High Priority

#### Add product analytics
**Status:** RED — No visibility into user behavior
**Recommendation:** Add Plausible (privacy-friendly, EU-hosted) or PostHog (self-hosted option).
**Scope:** Add script tag to `apps/web/src/app/layout.tsx`, optionally track key events (signup, coop creation, first shareholder added).
**Files:** `apps/web/src/app/layout.tsx`, `apps/web/package.json`

#### Add uptime monitoring
**Status:** YELLOW — Sentry captures errors but nobody knows when the site is down
**Recommendation:** Point a free uptime monitor (UptimeRobot, Betteruptime) at `https://opencoop.be/api/health` and `https://acc.opencoop.be/api/health`. Set up Slack/email alerts.
**Scope:** External service config, no code changes.

#### Add CI checks on pull requests
**Status:** YELLOW — CI only runs on push to main, broken code can be merged
**Recommendation:** Add a `pull_request` trigger to `.github/workflows/build-deploy.yml` (or a separate lightweight workflow) that runs lint + typecheck + E2E.
**Files:** `.github/workflows/build-deploy.yml`

### Medium Priority

#### Separate NEXTAUTH_SECRET from JWT_SECRET
**Status:** YELLOW — A compromise of one exposes the other
**Recommendation:** Generate independent secrets. Update `deploy/.env.example` and `deploy/docker-compose.yml` to use a separate `NEXTAUTH_SECRET` env var.
**Files:** `deploy/docker-compose.yml`, `deploy/.env.example`

#### Replace console.error in auth.service.ts with NestJS Logger
**Status:** YELLOW — 10 `console.error` calls in the most critical service
**Recommendation:** Replace with `this.logger.error()` for structured logging and Sentry integration.
**Files:** `apps/api/src/modules/auth/auth.service.ts`

#### Add global exception filter
**Status:** YELLOW — Non-HTTP exceptions (e.g. Prisma errors) return generic 500 without Sentry capture
**Recommendation:** Add `AllExceptionsFilter` that calls `Sentry.captureException` for unexpected errors.
**Files:** `apps/api/src/common/filters/all-exceptions.filter.ts`, `apps/api/src/app.module.ts`

#### Decompose shareholder detail page
**Status:** YELLOW — 949 lines, 15+ useState, 3 embedded dialogs
**Recommendation:** Extract `BuySharesDialog`, `SellSharesDialog`, `RejectTransactionDialog`, `ShareholdingsTable`, `TransactionHistoryTable` into separate components.
**Files:** `apps/web/src/app/[locale]/dashboard/admin/shareholders/[id]/page.tsx`

#### Add log aggregation
**Status:** YELLOW — Docker log rotation prevents unbounded growth but logs are still local-only
**Recommendation:** Add Loki + Grafana (self-hosted) or Betterstack (hosted) for searchable, persistent logs.
**Scope:** Infrastructure config, Docker compose logging driver change.

### Low Priority

#### Add unit tests
**Status:** YELLOW — Zero `*.spec.ts` files in the API
**Recommendation:** Start with critical business logic: transaction processing, dividend calculations, OGM code generation/validation.
**Files:** `apps/api/src/modules/transactions/*.spec.ts`, `apps/api/src/modules/dividends/*.spec.ts`

#### Document server provisioning
**Status:** YELLOW — CI/CD is automated but setting up fsn1 from scratch is undocumented
**Recommendation:** Add `docs/infrastructure.md` covering: Tailscale setup, directory structure, Caddy config, Docker network creation, env file setup.

#### Tighten Prisma select clauses
**Status:** YELLOW — A few queries fetch full rows unnecessarily
**Key files:**
- `apps/api/src/modules/coops/coops.service.ts` `findBySlug()` — bare `include` on shareClasses/projects
- `apps/api/src/modules/email/email.processor.ts` — fetches full coop row including secrets for email sending

#### Add feature flag system
**Status:** YELLOW — Single `LAUNCH_MODE` flag works but won't scale
**Recommendation:** When a second flag is needed, consider a simple `flags.ts` config file or an env-var-based registry before reaching for a full feature flag service.

## Completed Fixes (2026-03-02)

- [x] Added `GET /health` endpoint with Postgres + Redis checks
- [x] Added Docker healthcheck for API container
- [x] Added `apiFetch()` helper for raw Response (blob downloads)
- [x] Replaced 19 raw `fetch()` calls across 8 dashboard files with `api()`/`apiFetch()`
- [x] Added Docker log rotation (json-file, 10m x 3) for api and web services
