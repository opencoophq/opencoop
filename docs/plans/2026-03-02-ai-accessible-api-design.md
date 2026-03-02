# AI-Accessible API Design

**Date:** 2026-03-02
**Status:** Implemented

## Problem

Cooperatives using OpenCoop have their own websites (WordPress, Hugo, etc.) that need to link to OpenCoop for share purchases. Currently, building these links requires manual knowledge of the URL structure and project/share class IDs. AI agents building or maintaining coop websites have no structured way to discover this information.

## Solution

Two complementary features:

1. **MCP Server** — Expose read-only tools via Model Context Protocol (Streamable HTTP transport) so AI agents can natively query coop data and generate share purchase URLs.
2. **llms.txt** — Plain text endpoints following the [llms.txt convention](https://llmstxt.org/) for broad AI compatibility without MCP support.

## MCP Server Design

### Transport & Endpoint

- **Protocol:** MCP over Streamable HTTP (SSE)
- **Endpoint:** `POST /mcp` (public, no auth required)
- **SDK:** `@modelcontextprotocol/sdk`

### Tools

All tools are read-only and require no authentication.

| Tool | Input | Output |
|------|-------|--------|
| `list_coops` | — | Array of `{ slug, name, logoUrl }` for all active coops |
| `get_coop_info` | `slug: string` | Full public info: name, logo, colors, bank details, terms URL |
| `list_projects` | `slug: string` | Projects: name, description, type, capacityKw, estimatedAnnualMwh, startDate, endDate |
| `list_share_classes` | `slug: string` | Share classes: name, code, pricePerShare, minShares, maxShares, hasVotingRights |
| `get_share_purchase_url` | `slug: string, classCode?: string, projectId?: string` | Full URL like `https://opencoop.be/nl/{slug}/register?class=A&project=xyz` |

### Architecture

- New NestJS module: `apps/api/src/modules/mcp/`
- Tools delegate to existing `CoopsService` and `PrismaService` — no new database queries
- The MCP module registers a single controller that handles the Streamable HTTP transport
- Marked as `@Public()` — no JWT required

## llms.txt Design

### Endpoints

Both endpoints are public, plain text (`text/plain`), and require no authentication.

#### `GET /llms.txt` — Overview (mostly static)

```
# OpenCoop
> Cooperative shareholding management platform

OpenCoop helps cooperatives manage shareholders, share classes, projects, and transactions.

## API
- Public info: GET /coops/{slug}/public-info
- MCP server: POST /mcp (Streamable HTTP transport)

## Coops
Each cooperative has a public page at /{slug} and a share purchase flow at /{slug}/register.
Deep link parameters: ?class={code}&project={id}

## Full Data
See /llms-full.txt for a complete listing of all cooperatives, projects, and share purchase URLs.
```

#### `GET /llms-full.txt` — Dynamic full data dump

Dynamically generated, cached for 5 minutes. Contains all active coops with their share classes, projects, and pre-built purchase URLs.

```
# OpenCoop - Full Public Data

## Zonnecoöperatie Vlaanderen (slug: zonnecooperatie)

### Share Classes
- Class A: €250.00/share (min 1, max 20, voting rights: yes)

### Projects
- Zonnepark Antwerpen: 500 kW solar installation

### Purchase URLs
- Buy Class A shares: https://opencoop.be/nl/zonnecooperatie/register?class=A
- Buy Class A for Zonnepark Antwerpen: https://opencoop.be/nl/zonnecooperatie/register?class=A&project=clxyz123
```

### Architecture

- Implemented in the same MCP module or a lightweight `llms` module
- `llms.txt` is a static string (updates only on code changes)
- `llms-full.txt` queries active coops with their share classes and projects, renders as plain text
- Response cached in-memory (5 min TTL) to avoid hitting the database on every request

## Data Flow

```
AI Agent (Claude, Cursor, etc.)
  │
  ├─── MCP Client ──→ POST /mcp ──→ MCP Module ──→ CoopsService ──→ Prisma/DB
  │
  └─── HTTP GET ──→ /llms.txt or /llms-full.txt ──→ LlmsController ──→ Prisma/DB
```

## What This Enables

1. **AI website builders**: Connect to `https://api.opencoop.be/mcp`, call `list_projects("zonnecooperatie")`, get back structured data, generate correct share purchase links on the coop's website.
2. **Any LLM**: Fetch `/llms-full.txt`, get a complete plain-text overview of all coops and their purchase URLs — no special tooling needed.
3. **CMS integrations**: The MCP tools provide a clean API for syncing project data to any CMS.

## Out of Scope

- Write operations (share purchases, registrations) — keep it read-only for safety
- Authentication — all data exposed is already publicly available via `/coops/:slug/public-info`
- Per-coop MCP servers — single server covers all coops, filtered by slug

## Dependencies

- `@modelcontextprotocol/sdk` — npm package for MCP server implementation
- Existing `CoopsService` and Prisma models — no schema changes needed

## Configuration

The base URL for generated purchase links needs to be configurable:
- Use `NEXT_PUBLIC_APP_URL` or a new `PUBLIC_APP_URL` env var
- Default: `https://opencoop.be`
