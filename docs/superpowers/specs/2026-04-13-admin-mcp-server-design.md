# Admin MCP Server for OpenCoop

**Date:** 2026-04-13
**Status:** Draft
**Author:** Wouter + Claude

## Summary

Replace the existing public MCP endpoint with an authenticated MCP server that lets coop admins query their tenant's shareholder, transaction, and analytics data through Claude. API keys are per-user, scoped to one coop, and managed via the admin dashboard.

## Motivation

- Coop admins want to use Claude to generate reports, correlate with external data (e.g., Brevo campaigns), and answer ad-hoc questions about their cooperative's data
- The existing public MCP endpoint exposes sensitive data (bank IBANs, investment stats) without authentication — it should be removed
- Write operations (create shareholders, register transactions) are deferred to a future iteration

## Scope

### In scope
- Remove public MCP endpoint (`POST /mcp`) and `llms.txt` / `llms-full.txt` endpoints
- New `ApiKey` Prisma model with hashed keys, per-user, per-coop
- Auth middleware for MCP endpoint (Bearer token)
- 13 read-only MCP tools covering coop info, shareholders, transactions, analytics, share classes, and projects
- Date range and channel filtering on analytics and list tools
- Key management REST API (create, list, revoke)
- Dashboard UI for key management

### Out of scope (future iteration)
- Write operations (create shareholders, register transactions)
- IP allowlisting
- Rate limiting (can be added later at middleware level)

## Design

### 1. API Key Model

```prisma
model ApiKey {
  id         String    @id @default(cuid())
  prefix     String    // first 8 chars of raw key for display
  keyHash    String    @unique // SHA-256 hash of full key
  name       String    // user-chosen label, e.g. "Claude Code - laptop"
  userId     String
  user       User      @relation(fields: [userId], references: [id])
  coopId     String
  coop       Coop      @relation(fields: [coopId], references: [id])
  lastUsedAt DateTime?
  createdAt  DateTime  @default(now())
  revokedAt  DateTime?

  @@index([keyHash])
}
```

**Key format:** `oc_` prefix + 40 random hex chars → `oc_a1b2c3d4e5f6...` (43 chars total).

**Storage:** Only the SHA-256 hash is stored. The raw key is shown once at creation, never again.

### 2. Authentication Flow

1. Request hits `POST /mcp` with `Authorization: Bearer oc_a1b2c3d4...`
2. Middleware hashes the key with SHA-256
3. Looks up `ApiKey` where `keyHash` matches AND `revokedAt IS NULL`
4. If found:
   - Verify the associated user still has COOP_ADMIN or SYSTEM_ADMIN role for the coop
   - Attach `user` and `coop` to request context
   - Update `lastUsedAt` (debounced — at most once per minute to avoid write pressure)
5. If not found or role check fails → 401

### 3. MCP Tools

All tools are automatically scoped to the authenticated coop. No `coopId` parameter is needed.

#### Coop Info (2 tools)

**`get_coop_info`**
- Parameters: none
- Returns: name, slug, branding colors, bank details, terms URL, logo URL

**`get_coop_stats`**
- Parameters: none
- Returns: total shareholders, active shareholders, total capital, pending registrations, pending shareholders, unmatched bank transactions

#### Shareholders (2 tools)

**`list_shareholders`**
- Parameters: `search?` (string), `status?` (PENDING/ACTIVE/INACTIVE), `type?` (INDIVIDUAL/COMPANY/MINOR), `channelId?` (string), `page?` (number, default 1), `pageSize?` (number, default 25)
- Returns: paginated list with id, name, email, type, status, share count, total value, join date
- Search matches on firstName, lastName, companyName, email (case-insensitive)

**`get_shareholder`**
- Parameters: `shareholderId` (string)
- Returns: full details including contact info, address, banking, registrations with payments, documents, dividend payouts
- Excludes: `nationalId`, beneficial owner national IDs (sensitive encrypted data)

#### Transactions (2 tools)

**`list_registrations`**
- Parameters: `status?` (PENDING/PENDING_PAYMENT/ACTIVE/COMPLETED/CANCELLED), `type?` (BUY/SELL), `shareholderId?` (string), `channelId?` (string), `fromDate?` (ISO date), `toDate?` (ISO date), `page?` (number, default 1), `pageSize?` (number, default 25)
- Returns: paginated list with id, shareholder name, share class, project, quantity, amount, status, dates, payments

**`get_registration`**
- Parameters: `registrationId` (string)
- Returns: full details including payments, OGM code, certificate number, processing info

#### Analytics (4 tools)

All analytics tools accept optional `from?` and `to?` ISO date strings. When omitted, they return all history.

**`get_capital_timeline`**
- Parameters: `bucket?` (day/month/quarter/year, default month), `from?`, `to?`
- Returns: time series of `{ date, totalCapital, netChange }`

**`get_capital_by_project`**
- Parameters: `from?`, `to?`
- Returns: `{ projectId, projectName, totalCapital, shareCount, percentage }[]`

**`get_shareholder_growth`**
- Parameters: `bucket?` (day/month/quarter/year, default month), `from?`, `to?`
- Returns: time series of `{ date, individual, company, minor, exits, cumulative }`

**`get_transaction_summary`**
- Parameters: `bucket?` (day/month/quarter/year, default month), `from?`, `to?`
- Returns: `{ timeline: [{ date, buys, sells, volume }], totals: { buys, sells, volume } }`

#### Share Classes & Projects (3 tools)

**`list_share_classes`**
- Parameters: none
- Returns: all share classes with id, name, code, price per share, min/max shares, voting rights, dividend rate override, active status

**`list_projects`**
- Parameters: none
- Returns: projects with id, name, description, type, capacity, target shares, shares sold, capital raised

**`get_annual_overview`**
- Parameters: `year` (number, required)
- Returns: capital start/end, active shareholders start/end, total purchases/sales, dividends (gross/net), per-share-class breakdown, monthly capital by project

### 4. Key Management API

New admin endpoints under existing auth (JWT + COOP_ADMIN role):

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/admin/coops/:coopId/api-keys` | List current user's keys (prefix, name, lastUsedAt, createdAt). System admins see all keys. |
| `POST` | `/admin/coops/:coopId/api-keys` | Create key. Body: `{ name: string }`. Returns the raw key once. |
| `DELETE` | `/admin/coops/:coopId/api-keys/:id` | Revoke key (sets `revokedAt`). Users can only revoke their own keys. System admins can revoke any. |

### 5. Dashboard UI

New "API Keys" section in the coop admin settings page:

- Table: name, prefix (`oc_a1b2c3d4...`), created date, last used date ("Never" if null)
- "Create API Key" button → dialog:
  1. Text input for key name
  2. On submit: shows raw key with copy button + warning "This key won't be shown again"
  3. Shows pre-filled Claude MCP config snippet:
     ```json
     {
       "mcpServers": {
         "opencoop": {
           "type": "streamablehttp",
           "url": "https://opencoop.be/api/mcp",
           "headers": {
             "Authorization": "Bearer oc_..."
           }
         }
       }
     }
     ```
- "Revoke" button per key with confirmation dialog

### 6. Removal of Public Endpoints

The following will be removed:
- `POST /mcp` — public MCP endpoint (replaced by authenticated version)
- `GET /llms.txt` — plain text API overview
- `GET /llms-full.txt` — full public data dump
- `McpTools` class (current public tools)
- `LlmsController` class
- `LlmsModule`

### 7. Sensitive Data Policy

MCP tools will NOT return:
- `nationalId` (shareholder) — encrypted PII
- `nationalId` (beneficial owners) — encrypted PII
- Raw API key values — only prefix shown

All other shareholder data (name, email, address, banking, phone) is returned since the admin already has access to this via the dashboard.

## Example Workflows

### Campaign effectiveness analysis
> "How many shares were bought in the 2 weeks after our March 15 Brevo campaign?"
>
> Claude calls `get_transaction_summary(bucket=day, from=2026-03-15, to=2026-03-29)` and reports the spike.

### Shareholder lookup
> "Find all company shareholders with 'energie' in the name"
>
> Claude calls `list_shareholders(search=energie, type=COMPANY)` and presents the results.

### Year-end reporting
> "Give me the 2025 annual overview"
>
> Claude calls `get_annual_overview(year=2025)` and formats the data.

### Cross-platform correlation
> "Compare our Q1 shareholder growth with our Brevo email open rates"
>
> Claude calls `get_shareholder_growth(bucket=month, from=2026-01-01, to=2026-03-31)` from OpenCoop MCP and queries Brevo for campaign stats, then correlates the two.
