# Household Linking When Neither Shareholder Has a User — Design

**Date:** 2026-04-17
**Status:** Approved for planning
**Related plans:** `docs/plans/2026-04-14-shared-email-households.md` (v0.8.0, shipped)

## Problem

The shared-email households feature (v0.8.0) lets an admin link a Shareholder to another household member. The dialog searches for the target by email and lists the matches.

The search is implemented in `HouseholdService.searchUsersInCoop` (`apps/api/src/modules/shareholders/household.service.ts:85`) and matches on `Shareholder.user.email`, i.e. shareholders whose **linked `User` account** has an email containing the query. Shareholders with no `User` (imported, never logged in) never appear.

In practice, many cooperatives' existing shareholders are pure imports: `Shareholder.email` is populated, `Shareholder.userId` is `NULL`. If both members of a household are in that state, the admin cannot create the household through the UI — the dropdown is empty for both directions.

**Concrete trigger case (prod, 2026-04-17):** Shareholders `Laurette Beusen` (`jeanstevens2-3@telenet.be`) and `Jan Stevens` (`jeanstevens2@telenet.be`). Neither has a `User`. No `User` row exists with either email. The feature is unusable for them without engineering intervention.

## Goal

Make the admin linking flow work when the target shareholder has no `User` account — without surfacing the User/Shareholder distinction in the UI or API. From the admin's perspective, they pick a shareholder; the system handles the rest.

## Non-goals

- No changes to the emancipation flow, comms resolver, CSV import, or schema.
- No new UI surface. The existing dialog stays, only its data shape changes.
- No self-service "promote my own shareholder to head" flow. Admin-triggered only, matching the rest of the household feature.
- No bulk household creation flow.

## Design decisions

### 1. The API is keyed on `shareholderId`, not `userId`

The current contract is user-centric: search returns `{ userId, email, shareholderCount }`, link accepts `{ targetUserId }`. This leaks a distinction the admin doesn't care about — in the intended model a User and a Shareholder are 1-to-1 except as a migration artifact.

New contract:

- **Search response:** `[{ shareholderId, email, fullName, shareholderCount }]`. One entry per "household anchor" — either an existing User (shareholders in the same coop sharing a `userId` collapse into one entry) or a userless shareholder as its own entry.
- **Link request:** `{ targetShareholderId }`. Backend resolves or creates the `User` internally.

The search endpoint URL stays `GET …/household/search-users` (keeps the existing route; only the response shape changes). The link endpoint stays `POST …/household/link` (only the DTO field renames from `targetUserId` to `targetShareholderId`).

### 2. Auto-create the `User` when the target has none — silently

When the admin picks a userless target, the backend creates a `User` inside the same transaction as the link. No extra dialog, no extra click, no email notification.

The new `User` has:

- `email` = the target shareholder's current email
- `passwordHash` = `null` (passwordless; magic-link-only access via existing Task 7 flow from the shipped plan)
- `role` = `SHAREHOLDER` (the enum default)
- `preferredLanguage` = unset, falls back to `@default("nl")` (`schema.prisma:258`)

Rationale: `User.passwordHash` is already nullable (`schema.prisma:251`). A password-less User exists purely as a mail-routing and identity anchor. Nobody needs to log in as them; if anyone wants to, magic link at their email works.

### 3. Clear `Shareholder.email` for both shareholders after linking

The original plan's Decision (i) (Task 3) states: "any shareholder in a household has `email = NULL`; the User is the sole comms anchor." This fix follows the same rule — after linking, both the source and the (newly promoted) target shareholder get `email = NULL`. The email lives on the created `User` only.

### 4. Audit every side-effect

In the link transaction, three audit log rows:

- `LINK_SHAREHOLDER_TO_HOUSEHOLD` for the source shareholder (existing action)
- `LINK_SHAREHOLDER_TO_HOUSEHOLD` for the target shareholder (new — applies only when we mutate target.userId/email as part of the auto-create path; no audit for the already-linked target)
- `CREATE_USER_FROM_SHAREHOLDER` for the newly created User (new action string; actor = admin user id; records the source shareholder id for traceability)

## Data flow

Walk-through for the trigger case: admin on Laurette's detail page, wants to link her to Jan.

1. Admin types `jeanstev` into the dialog's search box.
2. Frontend: `GET /admin/coops/:coopId/shareholders/<laurette.id>/household/search-users?search=jeanstev`
3. Backend `searchHouseholdCandidates`:
   - Query: `shareholders WHERE coopId = :coopId AND id != :sourceId AND (email ILIKE %search% OR user.email ILIKE %search%) AND (email IS NOT NULL OR user.email IS NOT NULL)`
   - Include `user: { select: { id, email } }`
   - Order by `createdAt ASC`, take 20 pre-grouping for headroom
   - Group: for rows with non-null `userId`, collapse by `userId` (one candidate per distinct User, `shareholderCount = group size`, `shareholderId =` the earliest-created shareholder in the group as the anchor). For rows with null `userId`, each is its own candidate with `shareholderCount = 1`.
   - Trim to first 10 candidates (preserving `createdAt ASC` order).
   - Response: `[{ shareholderId: jan.id, email: "jeanstevens2@telenet.be", fullName: "Jan Stevens", shareholderCount: 1 }]`
4. Admin picks the row, hits Confirm.
5. Frontend: `POST /admin/coops/:coopId/shareholders/<laurette.id>/household/link` with `{ targetShareholderId: jan.id }`.
6. Backend `linkShareholders` inside one `prisma.$transaction`:
   - Load source (Laurette) and target (Jan). Both must exist in `coopId`. 404 if not.
   - Reject if `targetShareholderId === sourceShareholderId` (self-link).
   - Reject if `source.userId !== null` and `source.userId !== target.userId` (source already in a different household; emancipate first). Preserves existing idempotent re-link behavior.
   - Branch:
     - **Target has `userId`**: link source → target.userId. (Existing behavior; this branch is the current `linkShareholderToUser` logic.)
     - **Target has no `userId`**:
       1. Defensive: check if `User` with `email = target.email` exists; if so, reuse it (skip create).
       2. Otherwise create `User { email: target.email, passwordHash: null, role: SHAREHOLDER, preferredLanguage: "nl" }`.
       3. Update target shareholder: `userId = newUser.id, email = null`.
       4. Audit: `LINK_SHAREHOLDER_TO_HOUSEHOLD` for target, `CREATE_USER_FROM_SHAREHOLDER` for the new user.
   - Update source shareholder: `userId = <resolved userId>, email = null`.
   - Audit: `LINK_SHAREHOLDER_TO_HOUSEHOLD` for source (existing behavior).
   - Return the updated source shareholder (existing return shape).
7. Frontend closes dialog, refetches, personal-data page shows "managed by jeanstevens2@telenet.be".

## Edge cases

| Case | Handling |
| --- | --- |
| Source is the self-selected target | `BadRequestException('Cannot link a shareholder to itself')`. Also excluded by the search's `id != :sourceId` filter, but defensive. |
| Source already in a different household | `BadRequestException('Shareholder is already linked to a different user. Emancipate first before re-linking.')`. Existing message, preserved. |
| Source already in the *same* household as target | No-op, return existing shareholder. Existing idempotent branch, preserved. |
| Target has no email at all (`shareholder.email IS NULL` and `shareholder.user IS NULL`) | Excluded by the search query, cannot be selected. |
| Target shareholder is in a different coop | Impossible by query (scoped to `coopId`), but defensive 404 in link. |
| A `User` with target's email already exists but isn't linked to target (stale data) | Link reuses that User instead of creating a new one. Logged via audit. |
| Search returns a user-backed shareholder whose primary email contains the query on the *User* side only (e.g. `Shareholder.email = NULL, User.email = "jan@x.com"`) | Works; the grouping keys on `userId`, and the anchor shareholder's `id` is what the API returns. |

## Not touched

- `schema.prisma` — no schema changes.
- `apps/api/src/modules/auth/emancipation.service.ts` — emancipation remains the path OUT of a household, not in. User-creation logic is duplicated here (small, ~5 lines), not extracted; see "Alternatives considered."
- `apps/api/src/modules/shareholders/shareholder-import.service.ts` — CSV import already has the `linkedTo` column flow from the shipped plan.
- `apps/api/src/modules/shareholders/shareholder-email.resolver.ts` — comms resolver already handles the `user.email ?? shareholder.email ?? null` chain.
- Translations — the dialog's existing strings remain accurate (the UX is unchanged).

## Alternatives considered

### A. Extract `UserCreationService.createFromShareholder(shareholderId)` and share with `EmancipationService`
Rejected for v1. The logic is ~5 lines, shared between exactly two call sites, and the semantics differ enough (emancipation creates a User *with* a password via user-provided input; household link creates a User *without* one via admin action) that premature abstraction would obscure more than it clarifies. If a third caller ever needs it, extract then.

### B. Separate `POST /shareholders/:id/ensure-user` endpoint, then `POST …/link`
Rejected. Splits an atomic operation into two network calls with race conditions in between, and bloats the API surface to avoid a single transaction branch.

### C. Broader "build a household from N shareholders" multi-select flow
Rejected for v1 as out of scope. Useful future work, but solves a problem the admin doesn't have today.

## Testing

### Unit (`household.service.spec.ts`)

- `searchHouseholdCandidates`:
  - returns userless shareholders matched on `shareholder.email`
  - returns user-backed shareholders matched on `user.email`
  - collapses multiple shareholders sharing a `userId` into one entry with `shareholderCount = N`
  - excludes the source shareholder from results
  - excludes shareholders with neither `email` nor `user.email`
  - scoped to `coopId` (cross-coop candidates not returned)
  - trims to 10 results post-grouping
- `linkShareholders`:
  - target has User → link source, no User creation, one audit row
  - target has no User → creates User (email from target, null password), updates both shareholders, three audit rows
  - target has no User but a User with that email already exists → reuses it, no create, two audit rows
  - self-link rejected
  - source already linked to a different User rejected
  - source already linked to the target's User is a no-op (returns existing)
  - cross-coop target rejected (404)
  - target-has-no-email edge case rejected (impossible via search, defensive `BadRequestException`)

### Integration / smoke

- Manual: on acc, create two shareholders with emails but no User, link via admin UI, verify DB state (`shareholders` rows have correct `userId`/`email`, `users` row created with `passwordHash IS NULL`, audit rows present).
- Manual: on prod post-deploy, run the link action for Laurette → Jan. Verify via Prisma Studio or direct SQL.

No new Playwright E2E (the shipped plan already covers the happy path; this change only expands candidate sources).

## Files touched

| File | Change |
| --- | --- |
| `apps/api/src/modules/shareholders/household.service.ts` | rewrite `searchUsersInCoop` → `searchHouseholdCandidates`; rewrite `linkShareholderToUser` → `linkShareholders` with auto-create branch |
| `apps/api/src/modules/shareholders/household.service.spec.ts` | add cases per the "Unit" list above; update existing cases for new names/shapes |
| `apps/api/src/modules/shareholders/household.controller.ts` | update the two route handlers to call renamed methods and use renamed DTO field |
| `apps/api/src/modules/shareholders/dto/link-shareholder.dto.ts` | rename `targetUserId` → `targetShareholderId` |
| `apps/web/src/components/admin/link-shareholder-dialog.tsx` | rename `HouseholdUser` interface → `HouseholdCandidate` (`{ shareholderId, email, fullName, shareholderCount }`); send `targetShareholderId` in the POST body; optionally show `fullName` next to email in the result list for clarity |

## Open questions

None at time of writing.

## Rollout

1. Ship via standard CI/CD (push to `main` → acc, tag `v*` → prod).
2. After prod deploy: run the one-off link action for Laurette Beusen → Jan Stevens through the admin UI. No SQL needed.
3. No data migration, no backfill.

## CHANGELOG entry (draft for when this ships)

```markdown
### Fixed
- Household linking now works when neither shareholder has a login yet. The admin can pick any shareholder in the coop as the household anchor; the system creates the backing account transparently.
```
