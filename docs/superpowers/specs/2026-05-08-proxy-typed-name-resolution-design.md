# Proxy Assignment via Typed-Name Resolution — Design

**Date:** 2026-05-08
**Status:** Approved for planning
**Related plans:** `docs/superpowers/specs/2026-04-14-agm-voting-design.md` (proxy domain)

## Problem

The RSVP proxy assignment flow has two production-impacting issues, both rooted in the same endpoint.

### Issue 1 — GDPR leak

`GET /public/meetings/rsvp/:token/eligible-delegates`
(`apps/api/src/modules/meetings/rsvp.service.ts:228`) returns the full set of active shareholders in the coop — `firstName`, `lastName`, `memberNumber` — to anyone holding a valid RSVP token. The frontend renders this as a searchable list (`apps/web/src/app/[locale]/meetings/rsvp/[token]/page.tsx:404`). Each shareholder receives an RSVP token in their convocation email, so the entire member directory is reachable by every member of the coop. That's a Article 5 GDPR data-minimisation problem and a stated user concern.

The same endpoint is consumed by the logged-in shareholder dashboard (`apps/web/src/app/[locale]/dashboard/meetings/[id]/page.tsx:112`), so the leak exists in two surfaces.

### Issue 2 — iPad button "doesn't work"

Several Bronsgroen members report tapping **Ik geef volmacht** on iPad and seeing no result. The button itself fires (`openProxySection` runs synchronously, `setShowProxy(true)` flips the state), but two things conspire on iPad Safari:

1. **The list is huge.** Bronsgroen has ~1000+ active shareholders. The `Card` containing the list renders 1000 buttons inside an `overflow-y-auto` container. On iPad Safari this stalls visibly while parsing the JSON and laying out the DOM.
2. **The section appears below the fold.** The page does not scroll to the new section after `setShowProxy(true)`. On a long meeting page (agenda + CTA stack), the user may not realise the section appeared.

Combined: the button looks broken.

Fixing Issue 1 (no list at all) directly resolves Issue 2 (no list to render).

## Goal

Replace the leaky dropdown list with a typed-name resolver. The shareholder types the name of the person they want to grant proxy to, the server validates against active shareholders in the same coop, and on a unique match the system shows a confirmation card. Same flow on the public RSVP page and the logged-in dashboard.

## Non-goals

- No changes to the admin proxies UI (`apps/web/src/app/[locale]/dashboard/admin/meetings/[meetingId]/proxies/page.tsx`). Admins legitimately need member lists.
- No changes to `ProxiesService.create()` — its self-delegation block and `maxProxiesPerPerson` cap stay as the authoritative server-side rules.
- No changes to the volmacht-PDF upload flow on the thanks page.
- No member-number lookup or autocomplete. We accept that two-real-Jan-Peeters in the same coop is a contact-coop-admin dead-end.
- No fuzzy matching that auto-corrects without confirmation. The mandatory confirm step is what makes fuzzy match privacy-safe.

## Design decisions

### 1. Replace `GET /eligible-delegates` with `POST /proxy/resolve`

New endpoint:

```
POST /public/meetings/rsvp/:token/proxy/resolve
Body: { firstName: string, lastName: string }

200: { delegateShareholderId: string, displayName: string }
404: { code: 'not_found' }
409: { code: 'ambiguous' }
400: { code: 'cap_reached' }
429: { code: 'rate_limited' }
```

Why `POST`:
- It's a probe against private data (a yes/no oracle). `GET` would suggest cacheable / replayable semantics that don't fit.
- Body parameters keep the names out of URL access logs and Caddy logs.
- Lets us add a per-token request counter without surprising semantics.

The old `GET /eligible-delegates` endpoint is **deleted** along with its frontend consumers. No deprecation period — it's a leak.

### 2. Two-pass match algorithm — exact then fuzzy, both privacy-equivalent

The privacy property of fuzzy matching is identical to exact matching as long as the response shape is binary ("found this one name" / "not found"). We never disclose information about non-matches. The grantor already knows the person they're naming; confirming the match back to them isn't a new disclosure.

**Normalisation** (applied to both query and candidates):
- `String.prototype.normalize('NFD')` then strip combining marks → diacritic-insensitive
- `toLowerCase()`
- collapse whitespace, trim

**Pass 1 — exact match on normalized full name (`first` + ` ` + `last`):**
- 1 hit → return it.
- 2+ hits → `ambiguous`.
- 0 hits → fall through.

**Pass 2 — Levenshtein on normalized full name:**
- Threshold: `distance ≤ max(2, floor(query.length * 0.2))`. Scales with name length so "Jo" needs distance ≤ 2 (not stricter), but "Maximiliaan" tolerates distance ≤ 2 too at the floor.
- Find the candidate with the lowest distance within threshold.
- If best beats the runner-up by ≥ 2 (or there is no runner-up within threshold) → return best.
- If two candidates are tied, or runner-up is within 1 of the best → `ambiguous`.
- Nothing within threshold → `not_found`.

Why JS-side over Postgres `pg_trgm`:
- 1000 shareholders × ~30 characters = ~30 KB of names per coop, fits in one query and matches in microseconds.
- No Postgres extension migration to coordinate.
- Trivially unit-testable without a DB.

The matcher lives in a small pure module (`apps/api/src/modules/meetings/proxy-name-matcher.ts`) so the algorithm is testable in isolation from the service.

### 3. Mandatory confirm card

The frontend never auto-submits a fuzzy match. On a successful resolve, the proxy section replaces its input form with:

```
We found a match:
   ┌─────────────────────┐
   │   Jan Peeters       │
   └─────────────────────┘
[ Annuleer ]   [ Bevestig volmacht ]
```

The card shows **only the full name** — no member number, no postcode, no email. The grantor typed the name, so we're showing back what they already supplied. **Cancel** returns to the input form (same component state, fields preserved).

The actual proxy is only created when **Bevestig** is tapped — that fires the existing `PATCH /public/meetings/rsvp/:token` with `{ status: 'PROXY', delegateShareholderId }`. No backend change to the PATCH route.

### 4. Rate limiting on `/proxy/resolve`

Fuzzy matching shifts the threat model slightly: an attacker with a valid RSVP token can probe more permissively than with strict match. To bound enumeration:

- **Per-token cap:** 20 resolve attempts per RSVP token, lifetime. Stored as an integer counter on `MeetingAttendance` (new column, `proxyResolveAttempts`, default `0`).
- On the 21st attempt, return `429` with code `rate_limited`.
- The increment runs in a single round-trip via Prisma's `{ increment: 1 }` op (`prisma.meetingAttendance.update({ where: { id }, data: { proxyResolveAttempts: { increment: 1 } } })`); we then read the returned row's value and short-circuit if `> 20` before doing any matching. Success and failure both consume an attempt — an attacker can't probe for free.
- Honest users tap the form once or twice; 20 is generous headroom.

We deliberately don't do per-IP rate limiting — RSVP tokens are the unit of trust here, and IP rate limiting is brittle behind Caddy + corporate NATs.

### 5. Auto-scroll into the new proxy section

After `setShowProxy(true)`, the new component issues `ref.scrollIntoView({ behavior: 'smooth', block: 'start' })`. Belt-and-suspenders for the iPad case — even if some other future change re-introduces a long page, the section will be in view.

## Data flow

Walk-through: Bronsgroen shareholder Maria de Bruyn wants to give proxy to Jan Peeters.

1. Maria opens her RSVP link on iPad → page loads (`GET /public/meetings/rsvp/:token`) → unchanged.
2. Maria taps **Ik geef volmacht** → frontend mounts the proxy section (no network call yet) → page scrolls to it.
3. Maria types `Jan` / `Peeters` and taps **Zoek vennoot**.
4. Frontend: `POST /public/meetings/rsvp/:token/proxy/resolve` with `{"firstName":"Jan","lastName":"Peeters"}`.
5. Backend `resolveDelegate(token, firstName, lastName)`:
   - Resolves token → `attendance` (existing helper, throws on expiry).
   - Atomically increments `attendance.proxyResolveAttempts`. If new value > 20, return `429`.
   - Loads candidates: `shareholder WHERE coopId = :coopId AND status = 'ACTIVE' AND id != :grantorId`. Selects `id, firstName, lastName`.
   - Runs the matcher. Result is one of `{ kind: 'unique', candidate }`, `{ kind: 'ambiguous' }`, `{ kind: 'not_found' }`.
   - For `unique`: re-check the cap on `maxProxiesPerPerson` for that delegate (so the user gets `cap_reached` here, not on confirm).
   - Returns the appropriate response.
6. Frontend receives `{ delegateShareholderId, displayName: "Jan Peeters" }`. Replaces the input form with the confirm card.
7. Maria taps **Bevestig volmacht** → frontend `PATCH /public/meetings/rsvp/:token` with `{ status: 'PROXY', delegateShareholderId }`.
8. Existing PATCH path runs unchanged. `ProxiesService.create()` is the final authority — it re-checks the cap, blocks self-delegation, persists the proxy, and the confirmation email goes out.

## Schema change

```prisma
model MeetingAttendance {
  // … existing fields …
  proxyResolveAttempts Int @default(0)
}
```

A single migration adds the column with a default. Existing rows get `0`. Backfill is a no-op.

## Frontend changes

### `apps/web/src/app/[locale]/meetings/rsvp/[token]/page.tsx`

- Drop the `delegates`, `delegatesLoading`, `delegateQuery`, `filteredDelegates` state and the corresponding `Input`+list block.
- Add `proxyState: 'form' | 'resolved' | 'submitting'` and the resolved match `{ delegateShareholderId, displayName }`.
- Add the `firstName` / `lastName` controlled inputs and a "Zoek vennoot" submit handler that calls the resolve endpoint and maps response codes to translated error strings.
- Add the confirm card sub-component (name + Annuleer + Bevestig volmacht).
- Add `scrollIntoView` on a section ref after `setShowProxy(true)`.

### `apps/web/src/app/[locale]/dashboard/meetings/[id]/page.tsx`

Same shape change to the proxy section. Same hooks, same flow. The page already imports `Card`, `Input`, `Button` — no new dependencies.

## Backend changes

### Files touched

- `apps/api/src/modules/meetings/rsvp.service.ts`
  - Replace `listEligibleDelegates(token)` with `resolveDelegate(token, firstName, lastName)`.
  - Use the new pure matcher module.
- `apps/api/src/modules/meetings/proxy-name-matcher.ts` *(new)*
  - Pure functions: `normalize(s)`, `levenshtein(a, b)`, `match(query, candidates)`.
- `apps/api/src/modules/meetings/dto/proxy-resolve.dto.ts` *(new)*
  - `class ProxyResolveDto { @IsString() @MaxLength(80) firstName; @IsString() @MaxLength(80) lastName; }`.
- `apps/api/src/modules/meetings/meeting-rsvp.controller.ts`
  - Replace the `@Get(':token/eligible-delegates')` handler with `@Post(':token/proxy/resolve')` taking `ProxyResolveDto`.
- `apps/api/src/modules/meetings/rsvp.service.spec.ts`
  - Replace `listEligibleDelegates` tests with `resolveDelegate` tests.
- `apps/api/src/modules/meetings/proxy-name-matcher.spec.ts` *(new)*
  - Cover normalisation (diacritics, casing, whitespace), exact-match precedence, fuzzy threshold edges, ambiguity tie-break, runner-up gap.

### Error code → HTTP mapping

| Code | HTTP | When |
|---|---|---|
| `not_found` | 404 | Pass 1 = 0, Pass 2 within threshold = 0. Self-typed names also fall here — the candidate query filters out the grantor, so their own name returns nothing. |
| `ambiguous` | 409 | Pass 1 ≥ 2, OR Pass 2 ties / runner-up < 2 away |
| `cap_reached` | 400 | Match unique but delegate already at `maxProxiesPerPerson` |
| `rate_limited` | 429 | `proxyResolveAttempts > 20` |

## Translation keys

Per locale (`en`, `nl`, `fr`, `de`), under `meetings.publicRsvp`:

```
proxyFirstNameLabel
proxyLastNameLabel
proxyFindButton
proxyConfirmHeading        // "Klopt dit?"
proxyConfirmPrompt         // "Wij vonden {name}. Bevestig om volmacht te geven."
proxyConfirmCancel         // "Annuleer"
proxyConfirmSubmit         // "Bevestig volmacht"
proxyErrorNotFound         // "Geen vennoot gevonden met die naam. Controleer de spelling."
proxyErrorAmbiguous        // "Meerdere vennoten met die naam — neem contact op met uw coöperatie."
proxyErrorCapReached       // "Deze vennoot heeft het maximumaantal volmachten al bereikt."
proxyErrorRateLimit        // "Te veel pogingen. Neem contact op met uw coöperatie."
```

The existing `proxyHeading`, `proxyHelp` stay (with copy refresh in nl). The keys `proxySearchPlaceholder` and `proxyEmpty` are removed.

## Testing

### Unit
- `proxy-name-matcher.spec.ts` — pure function tests, no DB.
  - Normalisation: `Émile`/`emile`/`  Emile  ` → equivalent.
  - Pass 1 unique vs ambiguous (`Jan Peeters` matches one vs two).
  - Pass 2 within threshold with clear winner.
  - Pass 2 tie at the boundary → ambiguous.
  - Pass 2 best-vs-runner-up gap rule.
- `rsvp.service.spec.ts` — `resolveDelegate` cases:
  - Token expired/invalid → throws (existing behaviour, reused).
  - 0 attempts → success.
  - 21st attempt → rate_limited.
  - Match unique but cap reached → cap_reached.

### E2E (manual on acc before prod tag)
1. Open RSVP link on iPad Safari.
2. Tap **Ik geef volmacht** → section appears, page scrolls to it.
3. Type a known fellow shareholder's name (with a deliberate typo) → confirm card appears with the correct name.
4. Tap **Bevestig volmacht** → thanks page → confirmation email arrives with `.ics`.
5. Re-open the RSVP link → status reads `Volmacht`.

## Risk and timing

Bronsgroen's AGM is **2026-05-09** (tomorrow). This change is exposed prod surface for that meeting.

- Land on `main` → auto-deploys to `acc.opencoop.be`.
- Manual iPad smoke test on acc.
- Tag `v0.8.29` for prod by 2026-05-08 18:00 CET, leaving ≥ 12 h margin.
- If the tag misses that window, we hold and ship after the AGM — the leak has been live for the duration of the project, one more meeting won't move the needle.

## Out of scope / follow-ups

- Convert the admin "give proxy on behalf of a member" flow (still uses a list, but admins are the legitimate audience).
- Add a per-IP rate limit globally if abuse signals appear (current per-token cap is the first line).
- Logging dashboards for high-resolve-attempt tokens — punt until we have a signal.
