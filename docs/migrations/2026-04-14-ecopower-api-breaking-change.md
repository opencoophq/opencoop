# EcoPower API — Response Shape Change (2026-04-14, v0.8.0)

> **Note:** No live consumer existed at the time of this change (verified via `api_keys` — only internal/Claude test keys). This doc is preserved as reference for whoever eventually wires up the EcoPower integration.

## What changed

The `/shareholders/query` endpoint's response shape is now grouped by email.

### Before
```json
[
  {
    "email": "jan@example.com",
    "found": true,
    "firstName": "Jan",
    "lastName": "Janssens",
    "totalShares": 100,
    "totalShareValue": 25000
  },
  { "email": "nobody@example.com", "found": false }
]
```

### After
```json
[
  {
    "email": "jan@example.com",
    "shareholders": [
      { "firstName": "Jan", "lastName": "Janssens", "totalShares": 100, "totalShareValue": 25000 }
    ]
  },
  { "email": "marie-and-jan@example.com", "shareholders": [
      { "firstName": "Jan", "lastName": "Janssens", "totalShares": 100, "totalShareValue": 25000 },
      { "firstName": "Marie", "lastName": "Janssens", "totalShares": 50, "totalShareValue": 12500 }
    ]
  },
  { "email": "nobody@example.com", "shareholders": [] }
]
```

## Why

Some shareholders now share one email inbox (households: couples, minor+guardian). The old shape assumed email → at-most-one-shareholder. The new shape groups matches under each queried email.

## Upgrade path for consumers

Replace:
```typescript
const result = await api.queryShareholders(emails);
const byEmail = new Map(result.map(r => [r.email, r.found ? r : null]));
```

With:
```typescript
const result = await api.queryShareholders(emails);
const byEmail = new Map(result.map(r => [r.email, r.shareholders]));  // now an array
```

If your code assumed a single shareholder per email, iterate the `shareholders` array and aggregate as appropriate for your use case.

## `POST /shareholders/status` (updateEcoPowerStatus) — behavior change

When multiple shareholders match the supplied email (household case), the status update is applied to ALL matches. Previously it would match at most one shareholder. If your integration expects single-shareholder semantics, include a `shareholderId` in the payload to disambiguate (future v2 endpoint — not yet available).

## Handoff to EcoPower

When the EcoPower integration is activated, hand them this doc along with the Fumadocs API reference at `/docs/ecopower-api`. They will need to follow the upgrade path above — their side has never implemented the old shape, so "upgrade" here just means "follow the current docs."

## Timeline

- 2026-04-14: Shape change shipped to prod in v0.8.0. No external consumer was using the endpoint, so no breakage occurred.
