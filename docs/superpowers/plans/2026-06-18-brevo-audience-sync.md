# Brevo Audience Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep a coop's external email-marketing audience (Brevo) in sync with its shareholders — active members in the existing members list, resigned members removed/moved — driven by per-change pushes plus a nightly full reconcile.

**Architecture:** A provider-agnostic `EmailAudienceProvider` interface with a `BrevoProvider` (native `fetch`) implementation; an `AudienceSyncService` reconcile engine with two entry points (`reconcileOne`, `reconcileAll`) that share one mapping; a Bull `audience-sync` queue + processor; a nightly `@Cron` scheduler; shareholder-service emit points (best-effort, non-blocking); per-coop config on `Coop`; and an admin settings panel. One-way only (OpenCoop → Brevo).

**Tech Stack:** NestJS (Node 20), Prisma 7 + PostgreSQL, Bull (Redis), `@nestjs/schedule`, native `fetch`, Jest (`*.spec.ts`), Next.js 15 (web), `@nestjs/swagger`, class-validator.

## Global Constraints

- **Identity anchor:** every synced Brevo contact carries `EXT_ID = Shareholder.id` (immutable). Email is a mutable attribute. No `Shareholder` schema change.
- **Marketing only:** this feature touches only the Brevo marketing list. Statutory comms (AV convocations, results, dividends) stay on OpenCoop's transactional path (`meetings`/`EmailService`) — NEVER route them through Brevo.
- **Never force-resubscribe:** provider payloads MUST NOT set `emailBlacklisted: false`. Brevo's existing unsubscribe/blacklist state is preserved on every upsert.
- **Per-change is best-effort:** emit points only ENQUEUE after the DB commit; they MUST be wrapped so a queue error can never fail the shareholder mutation. The nightly `reconcile-all` is the backstop.
- **Secrets:** `brevoApiKey` is AES-256-GCM encrypted at rest via `encryptField()` (env `FIELD_ENCRYPTION_KEY`), excluded from every GET response, and masked in audit logs.
- **Tenancy:** every query is scoped `where: { coopId }`. One job per coop.
- **Encryption key env:** `FIELD_ENCRYPTION_KEY` must be set (already required by Ponto). Provider base URL: `https://api.brevo.com/v3`, auth header `api-key: <key>`.
- **Migrations:** use `pnpm --filter @opencoop/database exec prisma migrate dev --name <name>` and commit the migration (no search-index DROP-stripping needed in this repo).
- **Test command:** `cd apps/api && pnpm test -- <file.spec.ts>`.

---

### Task 1: Prisma schema — Coop config fields + `BrevoSyncRun` model + migration

**Files:**
- Modify: `packages/database/prisma/schema.prisma` (Coop model; add BrevoSyncRun model)
- Create (generated): `packages/database/prisma/migrations/<ts>_brevo_audience_sync/migration.sql`

**Interfaces:**
- Produces: `Coop.emailAudienceProvider/brevoApiKey/brevoMembersListId/brevoResignedListId/brevoLastSyncAt/brevoLastSyncStatus`; `BrevoSyncRun` model with relation `Coop.brevoSyncRuns`.

- [ ] **Step 1: Add fields to the `Coop` model.** In `schema.prisma`, inside `model Coop { ... }`, next to the existing `pontoEnabled` / `smtpPass` integration fields, add:

```prisma
  // --- Email audience sync (Brevo) ---
  emailAudienceProvider String?   // "brevo" | null (off). Drives cron + provider factory.
  brevoApiKey           String?   // AES-256-GCM encrypted at rest; never returned to client
  brevoMembersListId    String?   // existing list reused (Bronsgroen = "3" Coöperanten)
  brevoResignedListId   String?   // optional; if null, resigned contacts are just unlisted
  brevoLastSyncAt       DateTime?
  brevoLastSyncStatus   String?   // "OK" | "PARTIAL" | "ERROR" | "RUNNING"
  brevoSyncRuns         BrevoSyncRun[]
```

- [ ] **Step 2: Add the `BrevoSyncRun` model.** At the end of `schema.prisma` add:

```prisma
model BrevoSyncRun {
  id         String    @id @default(cuid())
  coopId     String
  coop       Coop      @relation(fields: [coopId], references: [id], onDelete: Cascade)
  startedAt  DateTime  @default(now())
  finishedAt DateTime?
  status     String    // "OK" | "PARTIAL" | "ERROR"
  trigger    String    // "cron" | "manual"
  added      Int       @default(0)
  updated    Int       @default(0)
  moved      Int       @default(0)
  skipped    Int       @default(0)
  failed     Int       @default(0)
  errors     Json?     // [{ shareholderId, email, message }]

  @@index([coopId, startedAt])
}
```

- [ ] **Step 3: Generate the migration.**

Run: `cd /Users/wouterhermans/Developer/opencoop && pnpm --filter @opencoop/database exec prisma migrate dev --name brevo_audience_sync`
Expected: a new `migrations/<ts>_brevo_audience_sync/migration.sql` is created and applied; `prisma generate` runs. Confirm the SQL only `ALTER TABLE "Coop" ADD COLUMN ...` and `CREATE TABLE "BrevoSyncRun"` — no unexpected DROPs.

- [ ] **Step 4: Commit.**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations
git commit -m "feat(db): Brevo audience-sync coop fields + BrevoSyncRun model"
```

---

### Task 2: `EmailAudienceProvider` interface + shared types

**Files:**
- Create: `apps/api/src/modules/audience-sync/audience-provider.interface.ts`

**Interfaces:**
- Produces: `EmailAudienceProvider`, `UpsertContactInput`, `UpsertResult`, `BrevoList` — consumed by Tasks 3, 4, 5.

- [ ] **Step 1: Write the interface file.**

```typescript
// apps/api/src/modules/audience-sync/audience-provider.interface.ts

export interface BrevoList {
  id: string;
  name: string;
}

export interface UpsertContactInput {
  /** OpenCoop shareholder id — stored as Brevo EXT_ID, the stable identity. */
  extId: string;
  /** Resolved email; null is allowed only when createIfMissing is false. */
  email: string | null;
  attributes: { FIRSTNAME?: string; LASTNAME?: string };
  addListIds: number[];
  removeListIds: number[];
  /** Active members may be created if absent; resigned contacts must not be. */
  createIfMissing: boolean;
}

export type UpsertResult = 'created' | 'updated' | 'noop';

/** Provider-agnostic seam. Knows nothing about shareholders or coops. */
export interface EmailAudienceProvider {
  verifyConnection(): Promise<{ ok: boolean; detail?: string }>;
  listLists(): Promise<BrevoList[]>;
  /** Idempotent upsert addressed by EXT_ID; never sets emailBlacklisted. */
  upsertContact(input: UpsertContactInput): Promise<UpsertResult>;
}
```

- [ ] **Step 2: Commit.**

```bash
git add apps/api/src/modules/audience-sync/audience-provider.interface.ts
git commit -m "feat(audience-sync): provider interface + types"
```

---

### Task 3: `BrevoProvider` (native fetch)

**Files:**
- Create: `apps/api/src/modules/audience-sync/brevo.provider.ts`
- Test: `apps/api/src/modules/audience-sync/brevo.provider.spec.ts`

**Interfaces:**
- Consumes: `EmailAudienceProvider`, `UpsertContactInput`, `UpsertResult`, `BrevoList` (Task 2).
- Produces: `class BrevoProvider implements EmailAudienceProvider` with `constructor(apiKey: string)`.

- [ ] **Step 1: Write failing tests.**

```typescript
// apps/api/src/modules/audience-sync/brevo.provider.spec.ts
import { BrevoProvider } from './brevo.provider';

function mockFetchOnce(status: number, body: unknown) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

describe('BrevoProvider', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it('verifyConnection returns ok on 200', async () => {
    mockFetchOnce(200, { email: 'x@y.z' });
    const p = new BrevoProvider('key');
    expect(await p.verifyConnection()).toEqual({ ok: true });
    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/account');
    expect(opts.headers['api-key']).toBe('key');
  });

  it('verifyConnection surfaces the 401 IP message', async () => {
    mockFetchOnce(401, { message: 'unrecognised IP address', code: 'unauthorized' });
    const p = new BrevoProvider('key');
    const r = await p.verifyConnection();
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('unrecognised IP');
  });

  it('listLists maps id+name', async () => {
    mockFetchOnce(200, { lists: [{ id: 3, name: 'Coöperanten' }], count: 1 });
    const p = new BrevoProvider('key');
    expect(await p.listLists()).toEqual([{ id: '3', name: 'Coöperanten' }]);
  });

  it('upsertContact updates existing contact by ext_id (PUT 204) → "updated"', async () => {
    mockFetchOnce(204, {});
    const p = new BrevoProvider('key');
    const res = await p.upsertContact({
      extId: 'sh_1', email: 'a@b.c', attributes: { FIRSTNAME: 'A', LASTNAME: 'B' },
      addListIds: [3], removeListIds: [], createIfMissing: true,
    });
    expect(res).toBe('updated');
    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/contacts/sh_1?identifierType=ext_id');
    expect(opts.method).toBe('PUT');
    expect(JSON.parse(opts.body)).not.toHaveProperty('emailBlacklisted');
  });

  it('upsertContact falls back to POST create when ext_id missing (PUT 404) → "created"', async () => {
    mockFetchOnce(404, { code: 'document_not_found' }); // PUT
    mockFetchOnce(201, { id: 99 }); // POST
    const p = new BrevoProvider('key');
    const res = await p.upsertContact({
      extId: 'sh_2', email: 'n@b.c', attributes: { FIRSTNAME: 'N', LASTNAME: 'B' },
      addListIds: [3], removeListIds: [], createIfMissing: true,
    });
    expect(res).toBe('created');
    const [, postOpts] = (global.fetch as jest.Mock).mock.calls[1];
    const body = JSON.parse(postOpts.body);
    expect(body.ext_id).toBe('sh_2');
    expect(body.updateEnabled).toBe(true);
    expect(body).not.toHaveProperty('emailBlacklisted');
  });

  it('upsertContact returns "noop" for resigned contact not found (PUT 404, createIfMissing false)', async () => {
    mockFetchOnce(404, { code: 'document_not_found' });
    const p = new BrevoProvider('key');
    const res = await p.upsertContact({
      extId: 'sh_3', email: null, attributes: {},
      addListIds: [], removeListIds: [3], createIfMissing: false,
    });
    expect(res).toBe('noop');
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(1); // no POST
  });

  it('upsertContact throws on unexpected error (400)', async () => {
    mockFetchOnce(400, { message: 'duplicate_parameter' });
    const p = new BrevoProvider('key');
    await expect(p.upsertContact({
      extId: 'sh_4', email: 'dup@b.c', attributes: {},
      addListIds: [3], removeListIds: [], createIfMissing: true,
    })).rejects.toThrow(/duplicate_parameter/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail.**

Run: `cd apps/api && pnpm test -- src/modules/audience-sync/brevo.provider.spec.ts`
Expected: FAIL — cannot find module `./brevo.provider`.

- [ ] **Step 3: Implement `BrevoProvider`.**

```typescript
// apps/api/src/modules/audience-sync/brevo.provider.ts
import { Logger } from '@nestjs/common';
import {
  BrevoList,
  EmailAudienceProvider,
  UpsertContactInput,
  UpsertResult,
} from './audience-provider.interface';

const BASE = 'https://api.brevo.com/v3';

export class BrevoProvider implements EmailAudienceProvider {
  private readonly logger = new Logger(BrevoProvider.name);

  constructor(private readonly apiKey: string) {}

  private headers(): Record<string, string> {
    return {
      'api-key': this.apiKey,
      accept: 'application/json',
      'content-type': 'application/json',
    };
  }

  async verifyConnection(): Promise<{ ok: boolean; detail?: string }> {
    const res = await fetch(`${BASE}/account`, { method: 'GET', headers: this.headers() });
    if (res.ok) return { ok: true };
    const body = await res.text();
    return { ok: false, detail: `${res.status}: ${body}` };
  }

  async listLists(): Promise<BrevoList[]> {
    const res = await fetch(`${BASE}/contacts/lists?limit=50&offset=0`, {
      method: 'GET',
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Brevo listLists failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { lists?: Array<{ id: number; name: string }> };
    return (json.lists ?? []).map((l) => ({ id: String(l.id), name: l.name }));
  }

  async upsertContact(input: UpsertContactInput): Promise<UpsertResult> {
    // 1) Address the existing contact by EXT_ID (handles email changes, no duplicates).
    const putBody: Record<string, unknown> = {
      attributes: input.attributes,
      listIds: input.addListIds,
      unlinkListIds: input.removeListIds,
    };
    if (input.email) putBody.email = input.email;
    // NOTE: never set emailBlacklisted — preserve Brevo's unsubscribe state.

    const putRes = await fetch(
      `${BASE}/contacts/${encodeURIComponent(input.extId)}?identifierType=ext_id`,
      { method: 'PUT', headers: this.headers(), body: JSON.stringify(putBody) },
    );
    if (putRes.ok) return 'updated';

    if (putRes.status === 404) {
      if (!input.createIfMissing) return 'noop';
      if (!input.email) {
        throw new Error(`Cannot create Brevo contact ext_id=${input.extId}: no email`);
      }
      // 2) Create (or match-by-email and set ext_id) for active members.
      const postBody = {
        email: input.email,
        ext_id: input.extId,
        attributes: input.attributes,
        listIds: input.addListIds,
        updateEnabled: true,
      };
      const postRes = await fetch(`${BASE}/contacts`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(postBody),
      });
      if (postRes.ok) return 'created';
      throw new Error(`Brevo create failed ext_id=${input.extId}: ${postRes.status} ${await postRes.text()}`);
    }

    throw new Error(`Brevo upsert failed ext_id=${input.extId}: ${putRes.status} ${await putRes.text()}`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass.**

Run: `cd apps/api && pnpm test -- src/modules/audience-sync/brevo.provider.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/modules/audience-sync/brevo.provider.ts apps/api/src/modules/audience-sync/brevo.provider.spec.ts
git commit -m "feat(audience-sync): BrevoProvider (ext_id upsert, never resubscribe)"
```

---

### Task 4: Provider factory

**Files:**
- Create: `apps/api/src/modules/audience-sync/audience-provider.factory.ts`
- Test: `apps/api/src/modules/audience-sync/audience-provider.factory.spec.ts`

**Interfaces:**
- Consumes: `BrevoProvider` (Task 3), `decryptField` from `../../common/crypto/field-encryption`.
- Produces: `getAudienceProvider(coop: { emailAudienceProvider: string | null; brevoApiKey: string | null }): EmailAudienceProvider` (throws for unconfigured/unknown).

- [ ] **Step 1: Write failing tests.**

```typescript
// apps/api/src/modules/audience-sync/audience-provider.factory.spec.ts
import { getAudienceProvider } from './audience-provider.factory';
import { BrevoProvider } from './brevo.provider';

jest.mock('../../common/crypto/field-encryption', () => ({
  decryptField: (c: string) => `plain:${c}`,
}));

describe('getAudienceProvider', () => {
  it('returns a BrevoProvider for "brevo" with decrypted key', () => {
    const p = getAudienceProvider({ emailAudienceProvider: 'brevo', brevoApiKey: 'enc' });
    expect(p).toBeInstanceOf(BrevoProvider);
  });

  it('throws when provider is null', () => {
    expect(() => getAudienceProvider({ emailAudienceProvider: null, brevoApiKey: null }))
      .toThrow(/not configured/i);
  });

  it('throws for an unimplemented provider', () => {
    expect(() => getAudienceProvider({ emailAudienceProvider: 'mailchimp', brevoApiKey: 'enc' }))
      .toThrow(/mailchimp/i);
  });

  it('throws when brevo has no api key', () => {
    expect(() => getAudienceProvider({ emailAudienceProvider: 'brevo', brevoApiKey: null }))
      .toThrow(/api key/i);
  });
});
```

- [ ] **Step 2: Run to verify fail.** `cd apps/api && pnpm test -- src/modules/audience-sync/audience-provider.factory.spec.ts` → FAIL (module missing).

- [ ] **Step 3: Implement the factory.**

```typescript
// apps/api/src/modules/audience-sync/audience-provider.factory.ts
import { decryptField } from '../../common/crypto/field-encryption';
import { EmailAudienceProvider } from './audience-provider.interface';
import { BrevoProvider } from './brevo.provider';

export interface AudienceProviderConfig {
  emailAudienceProvider: string | null;
  brevoApiKey: string | null;
}

export function getAudienceProvider(coop: AudienceProviderConfig): EmailAudienceProvider {
  if (!coop.emailAudienceProvider) {
    throw new Error('Audience sync is not configured for this coop');
  }
  switch (coop.emailAudienceProvider) {
    case 'brevo': {
      if (!coop.brevoApiKey) throw new Error('Brevo API key is missing');
      return new BrevoProvider(decryptField(coop.brevoApiKey));
    }
    default:
      throw new Error(`Unsupported audience provider: ${coop.emailAudienceProvider}`);
  }
}
```

- [ ] **Step 4: Run to verify pass.** Expected: PASS (4 tests).

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/modules/audience-sync/audience-provider.factory.*
git commit -m "feat(audience-sync): provider factory (brevo; mailchimp future)"
```

---

### Task 5: `AudienceSyncService` — the reconcile engine

**Files:**
- Create: `apps/api/src/modules/audience-sync/audience-sync.service.ts`
- Test: `apps/api/src/modules/audience-sync/audience-sync.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (`../../prisma/prisma.service`); `getAudienceProvider` (Task 4); `resolveShareholderEmail` (`../shareholders/shareholder-email.resolver`); `EmailAudienceProvider`, `UpsertContactInput` (Task 2). Provider is injected via an overridable protected method `providerFor(coop)` so tests can stub it.
- Produces: `AudienceSyncService` with `reconcileOne(coopId, shareholderId): Promise<ReconcileSummary>` and `reconcileAll(coopId, trigger): Promise<ReconcileSummary>`; `interface ReconcileSummary { added; updated; moved; skipped; failed; errors }`.

- [ ] **Step 1: Write failing tests.**

```typescript
// apps/api/src/modules/audience-sync/audience-sync.service.spec.ts
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { AudienceSyncService } from './audience-sync.service';
import * as factory from './audience-provider.factory';

const COOP = {
  id: 'c1', emailAudienceProvider: 'brevo', brevoApiKey: 'enc',
  brevoMembersListId: '3', brevoResignedListId: null,
};

function makeShareholder(over: Record<string, unknown> = {}) {
  return {
    id: 'sh1', coopId: 'c1', status: 'ACTIVE',
    firstName: 'Ann', lastName: 'De Vries', companyName: null,
    email: 'ann@x.be', user: null, ...over,
  };
}

describe('AudienceSyncService', () => {
  let service: AudienceSyncService;
  let prisma: any;
  let upsert: jest.Mock;

  beforeEach(async () => {
    upsert = jest.fn().mockResolvedValue('updated');
    jest.spyOn(factory, 'getAudienceProvider').mockReturnValue({
      verifyConnection: jest.fn(), listLists: jest.fn(), upsertContact: upsert,
    } as any);

    prisma = {
      coop: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      shareholder: { findUnique: jest.fn(), findMany: jest.fn() },
      brevoSyncRun: { create: jest.fn().mockResolvedValue({}) },
    };

    const mod = await Test.createTestingModule({
      providers: [AudienceSyncService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(AudienceSyncService);
  });

  it('reconcileOne upserts an ACTIVE member into the members list', async () => {
    prisma.coop.findUnique.mockResolvedValue(COOP);
    prisma.shareholder.findUnique.mockResolvedValue(makeShareholder());
    const s = await service.reconcileOne('c1', 'sh1');
    expect(s.updated).toBe(1);
    const input = upsert.mock.calls[0][0];
    expect(input).toMatchObject({
      extId: 'sh1', email: 'ann@x.be',
      attributes: { FIRSTNAME: 'Ann', LASTNAME: 'De Vries' },
      addListIds: [3], removeListIds: [], createIfMissing: true,
    });
  });

  it('reconcileOne moves an INACTIVE member off the members list, no create', async () => {
    prisma.coop.findUnique.mockResolvedValue(COOP);
    prisma.shareholder.findUnique.mockResolvedValue(makeShareholder({ status: 'INACTIVE' }));
    upsert.mockResolvedValue('noop');
    const s = await service.reconcileOne('c1', 'sh1');
    expect(s.moved).toBe(1);
    expect(upsert.mock.calls[0][0]).toMatchObject({
      addListIds: [], removeListIds: [3], createIfMissing: false,
    });
  });

  it('reconcileOne skips when no email can be resolved', async () => {
    prisma.coop.findUnique.mockResolvedValue(COOP);
    prisma.shareholder.findUnique.mockResolvedValue(makeShareholder({ email: null, user: null }));
    const s = await service.reconcileOne('c1', 'sh1');
    expect(s.skipped).toBe(1);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('reconcileOne is a no-op when the coop has no provider', async () => {
    prisma.coop.findUnique.mockResolvedValue({ ...COOP, emailAudienceProvider: null });
    prisma.shareholder.findUnique.mockResolvedValue(makeShareholder());
    const s = await service.reconcileOne('c1', 'sh1');
    expect(s.skipped).toBe(1);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('reconcileOne prefers User.email over Shareholder.email', async () => {
    prisma.coop.findUnique.mockResolvedValue(COOP);
    prisma.shareholder.findUnique.mockResolvedValue(
      makeShareholder({ email: 'old@x.be', user: { email: 'new@x.be' } }),
    );
    await service.reconcileOne('c1', 'sh1');
    expect(upsert.mock.calls[0][0].email).toBe('new@x.be');
  });

  it('reconcileAll tallies a failure without aborting and writes a PARTIAL run', async () => {
    prisma.coop.findUnique.mockResolvedValue(COOP);
    prisma.shareholder.findMany.mockResolvedValue([
      makeShareholder({ id: 'a' }),
      makeShareholder({ id: 'b' }),
    ]);
    upsert.mockResolvedValueOnce('updated').mockRejectedValueOnce(new Error('boom'));
    const s = await service.reconcileAll('c1', 'cron');
    expect(s.updated).toBe(1);
    expect(s.failed).toBe(1);
    expect(prisma.brevoSyncRun.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PARTIAL', trigger: 'cron' }) }),
    );
  });
});
```

- [ ] **Step 2: Run to verify fail.** `cd apps/api && pnpm test -- src/modules/audience-sync/audience-sync.service.spec.ts` → FAIL (module missing).

- [ ] **Step 3: Implement the engine.**

```typescript
// apps/api/src/modules/audience-sync/audience-sync.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveShareholderEmail } from '../shareholders/shareholder-email.resolver';
import { EmailAudienceProvider, UpsertContactInput } from './audience-provider.interface';
import { getAudienceProvider } from './audience-provider.factory';

export interface ReconcileSummary {
  added: number; updated: number; moved: number; skipped: number; failed: number;
  errors: Array<{ shareholderId: string; email: string | null; message: string }>;
}

const EMPTY = (): ReconcileSummary => ({ added: 0, updated: 0, moved: 0, skipped: 0, failed: 0, errors: [] });

// Selection shared by reconcileOne/reconcileAll so the mapping is identical.
const SHAREHOLDER_SELECT = {
  id: true, status: true, firstName: true, lastName: true, companyName: true,
  email: true, user: { select: { email: true } },
} as const;

@Injectable()
export class AudienceSyncService {
  private readonly logger = new Logger(AudienceSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Overridable seam so tests can stub the provider. */
  protected providerFor(coop: { emailAudienceProvider: string | null; brevoApiKey: string | null }): EmailAudienceProvider {
    return getAudienceProvider(coop);
  }

  async reconcileOne(coopId: string, shareholderId: string): Promise<ReconcileSummary> {
    const summary = EMPTY();
    const coop = await this.prisma.coop.findUnique({ where: { id: coopId } });
    if (!coop?.emailAudienceProvider) { summary.skipped++; return summary; }

    const sh = await this.prisma.shareholder.findUnique({
      where: { id: shareholderId }, select: SHAREHOLDER_SELECT,
    });
    if (!sh) { summary.skipped++; return summary; }

    const provider = this.providerFor(coop);
    await this.applyOne(provider, coop, sh, summary);
    return summary;
  }

  async reconcileAll(coopId: string, trigger: 'cron' | 'manual'): Promise<ReconcileSummary> {
    const summary = EMPTY();
    const coop = await this.prisma.coop.findUnique({ where: { id: coopId } });
    if (!coop?.emailAudienceProvider) { summary.skipped++; return summary; }

    await this.prisma.coop.update({ where: { id: coopId }, data: { brevoLastSyncStatus: 'RUNNING' } });
    const provider = this.providerFor(coop);

    const shareholders = await this.prisma.shareholder.findMany({
      where: { coopId, status: { in: ['ACTIVE', 'INACTIVE'] } },
      select: SHAREHOLDER_SELECT,
    });
    for (const sh of shareholders) {
      await this.applyOne(provider, coop, sh, summary);
    }

    const status = summary.failed > 0 ? 'PARTIAL' : 'OK';
    await this.prisma.brevoSyncRun.create({
      data: {
        coopId, trigger, status, finishedAt: new Date(),
        added: summary.added, updated: summary.updated, moved: summary.moved,
        skipped: summary.skipped, failed: summary.failed,
        errors: summary.errors.length ? summary.errors : undefined,
      },
    });
    await this.prisma.coop.update({
      where: { id: coopId },
      data: { brevoLastSyncAt: new Date(), brevoLastSyncStatus: status },
    });
    return summary;
  }

  private async applyOne(
    provider: EmailAudienceProvider,
    coop: { brevoMembersListId: string | null; brevoResignedListId: string | null },
    sh: {
      id: string; status: string; firstName: string | null; lastName: string | null;
      companyName: string | null; email: string | null; user: { email: string | null } | null;
    },
    summary: ReconcileSummary,
  ): Promise<void> {
    const email = resolveShareholderEmail(sh as any);
    const membersList = coop.brevoMembersListId ? Number(coop.brevoMembersListId) : null;
    const resignedList = coop.brevoResignedListId ? Number(coop.brevoResignedListId) : null;

    if (sh.status === 'PENDING' || !membersList) { summary.skipped++; return; }
    if (sh.status === 'ACTIVE' && !email) { summary.skipped++; return; }

    const attributes = {
      FIRSTNAME: sh.firstName ?? undefined,
      LASTNAME: sh.lastName ?? sh.companyName ?? undefined,
    };

    let input: UpsertContactInput;
    if (sh.status === 'ACTIVE') {
      input = {
        extId: sh.id, email, attributes,
        addListIds: [membersList],
        removeListIds: resignedList ? [resignedList] : [],
        createIfMissing: true,
      };
    } else {
      // INACTIVE: remove from members, move to resigned iff configured; never create.
      input = {
        extId: sh.id, email, attributes,
        addListIds: resignedList ? [resignedList] : [],
        removeListIds: [membersList],
        createIfMissing: false,
      };
    }

    try {
      const result = await provider.upsertContact(input);
      if (sh.status === 'INACTIVE') {
        if (result === 'noop') summary.skipped++;
        else summary.moved++;
      } else if (result === 'created') summary.added++;
      else summary.updated++;
    } catch (err) {
      summary.failed++;
      summary.errors.push({ shareholderId: sh.id, email, message: (err as Error).message });
      this.logger.warn(`audience-sync failed for ${sh.id}: ${(err as Error).message}`);
    }
  }
}
```

- [ ] **Step 4: Run to verify pass.** Expected: PASS (6 tests).

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/modules/audience-sync/audience-sync.service.*
git commit -m "feat(audience-sync): reconcile engine (reconcileOne/reconcileAll)"
```

---

### Task 6: Bull queue + processor

**Files:**
- Create: `apps/api/src/modules/audience-sync/audience-sync.processor.ts`
- Test: `apps/api/src/modules/audience-sync/audience-sync.processor.spec.ts`

**Interfaces:**
- Consumes: `AudienceSyncService` (Task 5). Queue name `'audience-sync'`; jobs `'reconcile-one'` (`{ coopId, shareholderId }`) and `'reconcile-all'` (`{ coopId, trigger }`).
- Produces: `AudienceSyncProcessor`.

- [ ] **Step 1: Write failing tests.**

```typescript
// apps/api/src/modules/audience-sync/audience-sync.processor.spec.ts
import { Test } from '@nestjs/testing';
import { AudienceSyncProcessor } from './audience-sync.processor';
import { AudienceSyncService } from './audience-sync.service';

describe('AudienceSyncProcessor', () => {
  let processor: AudienceSyncProcessor;
  let service: { reconcileOne: jest.Mock; reconcileAll: jest.Mock };

  beforeEach(async () => {
    service = { reconcileOne: jest.fn().mockResolvedValue({}), reconcileAll: jest.fn().mockResolvedValue({}) };
    const mod = await Test.createTestingModule({
      providers: [AudienceSyncProcessor, { provide: AudienceSyncService, useValue: service }],
    }).compile();
    processor = mod.get(AudienceSyncProcessor);
  });

  it('reconcile-one delegates to the service', async () => {
    await processor.handleReconcileOne({ data: { coopId: 'c1', shareholderId: 's1' } } as any);
    expect(service.reconcileOne).toHaveBeenCalledWith('c1', 's1');
  });

  it('reconcile-all delegates with trigger', async () => {
    await processor.handleReconcileAll({ data: { coopId: 'c1', trigger: 'cron' } } as any);
    expect(service.reconcileAll).toHaveBeenCalledWith('c1', 'cron');
  });
});
```

- [ ] **Step 2: Run to verify fail.** → FAIL (module missing).

- [ ] **Step 3: Implement the processor.**

```typescript
// apps/api/src/modules/audience-sync/audience-sync.processor.ts
import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import * as Sentry from '@sentry/node';
import { AudienceSyncService } from './audience-sync.service';

@Processor('audience-sync')
export class AudienceSyncProcessor {
  private readonly logger = new Logger(AudienceSyncProcessor.name);

  constructor(private readonly service: AudienceSyncService) {}

  @Process('reconcile-one')
  async handleReconcileOne(job: Job<{ coopId: string; shareholderId: string }>) {
    return Sentry.withIsolationScope(async (scope) => {
      scope.setTag('queue', 'audience-sync');
      scope.setTag('job', 'reconcile-one');
      try {
        await this.service.reconcileOne(job.data.coopId, job.data.shareholderId);
      } catch (error) {
        Sentry.captureException(error);
        this.logger.error(`reconcile-one failed: ${(error as Error).message}`);
        throw error; // let Bull retry; nightly reconcile is the backstop
      }
    });
  }

  @Process('reconcile-all')
  async handleReconcileAll(job: Job<{ coopId: string; trigger: 'cron' | 'manual' }>) {
    return Sentry.withIsolationScope(async (scope) => {
      scope.setTag('queue', 'audience-sync');
      scope.setTag('job', 'reconcile-all');
      try {
        await this.service.reconcileAll(job.data.coopId, job.data.trigger);
      } catch (error) {
        Sentry.captureException(error);
        this.logger.error(`reconcile-all failed for ${job.data.coopId}: ${(error as Error).message}`);
        throw error;
      }
    });
  }
}
```

- [ ] **Step 4: Run to verify pass.** Expected: PASS (2 tests).

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/modules/audience-sync/audience-sync.processor.*
git commit -m "feat(audience-sync): Bull processor (reconcile-one/all)"
```

---

### Task 7: Nightly cron scheduler

**Files:**
- Create: `apps/api/src/modules/audience-sync/audience-sync.scheduler.ts`
- Test: `apps/api/src/modules/audience-sync/audience-sync.scheduler.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`; injected Bull queue `'audience-sync'`.
- Produces: `AudienceSyncScheduler.nightlyTick()`.

- [ ] **Step 1: Write failing tests.**

```typescript
// apps/api/src/modules/audience-sync/audience-sync.scheduler.spec.ts
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { PrismaService } from '../../prisma/prisma.service';
import { AudienceSyncScheduler } from './audience-sync.scheduler';

describe('AudienceSyncScheduler', () => {
  it('enqueues one reconcile-all per enabled coop', async () => {
    const prisma = { coop: { findMany: jest.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]) } };
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const mod = await Test.createTestingModule({
      providers: [
        AudienceSyncScheduler,
        { provide: PrismaService, useValue: prisma },
        { provide: getQueueToken('audience-sync'), useValue: queue },
      ],
    }).compile();

    await mod.get(AudienceSyncScheduler).nightlyTick();

    expect(prisma.coop.findMany).toHaveBeenCalledWith({
      where: { emailAudienceProvider: { not: null } }, select: { id: true },
    });
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenCalledWith('reconcile-all', { coopId: 'a', trigger: 'cron' });
  });
});
```

- [ ] **Step 2: Run to verify fail.** → FAIL.

- [ ] **Step 3: Implement the scheduler.**

```typescript
// apps/api/src/modules/audience-sync/audience-sync.scheduler.ts
import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Queue } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AudienceSyncScheduler {
  private readonly logger = new Logger(AudienceSyncScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('audience-sync') private readonly queue: Queue,
  ) {}

  @Cron('0 3 * * *', { timeZone: 'Europe/Brussels' })
  async nightlyTick() {
    const coops = await this.prisma.coop.findMany({
      where: { emailAudienceProvider: { not: null } },
      select: { id: true },
    });
    this.logger.log(`Enqueuing nightly audience reconcile for ${coops.length} coop(s)`);
    for (const coop of coops) {
      await this.queue.add('reconcile-all', { coopId: coop.id, trigger: 'cron' });
    }
  }
}
```

- [ ] **Step 4: Run to verify pass.** Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/modules/audience-sync/audience-sync.scheduler.*
git commit -m "feat(audience-sync): nightly cron (03:00 Europe/Brussels)"
```

---

### Task 8: Module wiring

**Files:**
- Create: `apps/api/src/modules/audience-sync/audience-sync.module.ts`
- Modify: `apps/api/src/app.module.ts` (import + imports array)

**Interfaces:**
- Produces: `AudienceSyncModule` exporting `AudienceSyncService` and registering the `audience-sync` queue (so other modules can inject it).

- [ ] **Step 1: Create the module.**

```typescript
// apps/api/src/modules/audience-sync/audience-sync.module.ts
import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { AudienceSyncService } from './audience-sync.service';
import { AudienceSyncProcessor } from './audience-sync.processor';
import { AudienceSyncScheduler } from './audience-sync.scheduler';

@Module({
  imports: [BullModule.registerQueue({ name: 'audience-sync' })],
  providers: [AudienceSyncService, AudienceSyncProcessor, AudienceSyncScheduler],
  exports: [AudienceSyncService, BullModule],
})
export class AudienceSyncModule {}
```

- [ ] **Step 2: Register in `AppModule`.** In `apps/api/src/app.module.ts`, add the import near the other module imports (around line 34) and add `AudienceSyncModule,` to the `imports` array (near `PontoModule,` ~line 76):

```typescript
import { AudienceSyncModule } from './modules/audience-sync/audience-sync.module';
// ... in @Module({ imports: [ ... ] })
AudienceSyncModule,
```

- [ ] **Step 3: Verify the app boots / compiles.**

Run: `cd apps/api && pnpm test -- src/modules/audience-sync` then `pnpm build`
Expected: existing audience-sync tests still PASS; `pnpm build` succeeds (no DI/compile errors).

- [ ] **Step 4: Commit.**

```bash
git add apps/api/src/modules/audience-sync/audience-sync.module.ts apps/api/src/app.module.ts
git commit -m "feat(audience-sync): module wiring + AppModule registration"
```

---

### Task 9: Coop config — DTO fields, encryption, secret masking, audit

**Files:**
- Modify: `apps/api/src/modules/coops/dto/update-coop.dto.ts`
- Modify: `apps/api/src/modules/coops/coops.service.ts` (`update`, `getSettings`)
- Modify: `apps/api/src/modules/audit/audit.service.ts` (`SENSITIVE_FIELDS`)
- Test: `apps/api/src/modules/coops/coops.service.spec.ts` (add cases; create file if absent)

**Interfaces:**
- Consumes: `encryptField` from `../../common/crypto/field-encryption`.
- Produces: persisted+encrypted `brevoApiKey`; `getSettings` returns the new non-secret fields.

- [ ] **Step 1: Add DTO fields.** In `update-coop.dto.ts`, after the ecoPower fields:

```typescript
  @ApiProperty({ required: false, description: 'Audience sync provider: null or "brevo"' })
  @IsOptional()
  @IsIn([null, 'brevo'])
  emailAudienceProvider?: string | null;

  @ApiProperty({ required: false, description: 'Brevo API key (write-only; encrypted at rest)' })
  @IsOptional()
  @IsString()
  brevoApiKey?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  brevoMembersListId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  brevoResignedListId?: string;
```

- [ ] **Step 2: Write failing service tests.** Add to `coops.service.spec.ts` (mirror the existing module-setup; if no spec exists, create one using the `Test.createTestingModule` + mocked `PrismaService`/`AuditService` pattern from `convocation.service.spec.ts`):

```typescript
it('encrypts brevoApiKey before persisting and preserves it when blank', async () => {
  prisma.coop.findUnique.mockResolvedValue({ id: 'c1' });
  prisma.coop.update.mockResolvedValue({ id: 'c1' });

  await service.update('c1', { brevoApiKey: 'xkeysib-secret' } as any);
  const persisted = prisma.coop.update.mock.calls[0][0].data;
  expect(persisted.brevoApiKey).toBeDefined();
  expect(persisted.brevoApiKey).not.toBe('xkeysib-secret'); // encrypted

  prisma.coop.update.mockClear();
  await service.update('c1', { brevoApiKey: '' } as any);
  expect(prisma.coop.update.mock.calls[0][0].data).not.toHaveProperty('brevoApiKey');
});

it('getSettings never returns brevoApiKey', async () => {
  prisma.coop.findUnique.mockResolvedValue({ id: 'c1', brevoMembersListId: '3' });
  const r = await service.getSettings('c1');
  expect(r).not.toHaveProperty('brevoApiKey');
});
```

- [ ] **Step 3: Run to verify fail.** `cd apps/api && pnpm test -- src/modules/coops/coops.service.spec.ts` → FAIL.

- [ ] **Step 4: Implement.** In `coops.service.ts`:

Add the import at the top:
```typescript
import { encryptField } from '../../common/crypto/field-encryption';
```

In `update()`, alongside the existing `if (!data.smtpPass) delete data.smtpPass;` block:
```typescript
    if (!data.brevoApiKey) delete data.brevoApiKey;
    else data.brevoApiKey = encryptField(data.brevoApiKey as string);
```

In `getSettings()` `select`, add the non-secret fields (NOT `brevoApiKey`):
```typescript
      emailAudienceProvider: true,
      brevoMembersListId: true,
      brevoResignedListId: true,
      brevoLastSyncAt: true,
      brevoLastSyncStatus: true,
```

In `audit.service.ts`, add `'brevoApiKey'` to the `SENSITIVE_FIELDS` set:
```typescript
  'smtpPass',
  'graphClientSecret',
  'brevoApiKey',
```

- [ ] **Step 5: Run to verify pass.** Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add apps/api/src/modules/coops apps/api/src/modules/audit/audit.service.ts
git commit -m "feat(coops): Brevo config fields (encrypted key, masked, audited)"
```

---

### Task 10: Admin endpoints — Sync now, Test connection, List lists

**Files:**
- Modify: `apps/api/src/modules/admin/admin.controller.ts`
- Modify: `apps/api/src/modules/coops/coops.service.ts` (add `triggerAudienceSync`, `testAudienceConnection`, `listAudienceLists`)
- Modify: `apps/api/src/modules/coops/coops.module.ts` (import `AudienceSyncModule` for the queue)
- Test: `apps/api/src/modules/coops/coops.service.spec.ts` (add cases)

**Interfaces:**
- Consumes: injected Bull queue `'audience-sync'`; `getAudienceProvider` (Task 4); `decryptField` indirectly via factory.
- Produces: `POST /admin/coops/:coopId/audience-sync/run`, `POST /admin/coops/:coopId/audience-sync/test`, `GET /admin/coops/:coopId/audience-sync/lists`.

- [ ] **Step 1: Write failing service tests.** Add to `coops.service.spec.ts`:

```typescript
it('triggerAudienceSync enqueues a manual reconcile-all', async () => {
  await service.triggerAudienceSync('c1');
  expect(audienceQueue.add).toHaveBeenCalledWith('reconcile-all', { coopId: 'c1', trigger: 'manual' });
});

it('testAudienceConnection returns the provider verify result', async () => {
  prisma.coop.findUnique.mockResolvedValue({ id: 'c1', emailAudienceProvider: 'brevo', brevoApiKey: 'enc' });
  jest.spyOn(factory, 'getAudienceProvider').mockReturnValue({
    verifyConnection: jest.fn().mockResolvedValue({ ok: true }), listLists: jest.fn(), upsertContact: jest.fn(),
  } as any);
  expect(await service.testAudienceConnection('c1')).toEqual({ ok: true });
});
```
(Provide `audienceQueue = { add: jest.fn() }` via `{ provide: getQueueToken('audience-sync'), useValue: audienceQueue }` in the test module, and `import * as factory from '../audience-sync/audience-provider.factory'`.)

- [ ] **Step 2: Run to verify fail.** → FAIL.

- [ ] **Step 3: Implement service methods.** In `coops.service.ts` inject the queue (constructor) and add:

```typescript
// constructor params: add
//   @InjectQueue('audience-sync') private readonly audienceQueue: Queue,
// imports: import { InjectQueue } from '@nestjs/bull'; import { Queue } from 'bull';
//          import { getAudienceProvider } from '../audience-sync/audience-provider.factory';

async triggerAudienceSync(coopId: string) {
  await this.audienceQueue.add('reconcile-all', { coopId, trigger: 'manual' });
  return { queued: true };
}

async testAudienceConnection(coopId: string) {
  const coop = await this.prisma.coop.findUnique({ where: { id: coopId } });
  if (!coop) throw new NotFoundException('Cooperative not found');
  return getAudienceProvider(coop).verifyConnection();
}

async listAudienceLists(coopId: string) {
  const coop = await this.prisma.coop.findUnique({ where: { id: coopId } });
  if (!coop) throw new NotFoundException('Cooperative not found');
  return getAudienceProvider(coop).listLists();
}
```

In `coops.module.ts`, add `AudienceSyncModule` to `imports` (it exports `BullModule`, exposing the queue token).

- [ ] **Step 4: Add controller endpoints.** In `admin.controller.ts`, alongside `regenerateApiKey`:

```typescript
@Post('audience-sync/run')
@RequirePermission('canManageSettings')
@ApiOperation({ summary: 'Trigger a Brevo audience reconcile now' })
async runAudienceSync(@Param('coopId') coopId: string) {
  return this.coopsService.triggerAudienceSync(coopId);
}

@Post('audience-sync/test')
@RequirePermission('canManageSettings')
@ApiOperation({ summary: 'Test the audience provider connection' })
async testAudienceSync(@Param('coopId') coopId: string) {
  return this.coopsService.testAudienceConnection(coopId);
}

@Get('audience-sync/lists')
@RequirePermission('canManageSettings')
@ApiOperation({ summary: 'List the provider contact lists (for the settings picker)' })
async listAudienceLists(@Param('coopId') coopId: string) {
  return this.coopsService.listAudienceLists(coopId);
}
```
(Ensure `Get` and `Post` are imported from `@nestjs/common` in this controller — `Post` already is.)

- [ ] **Step 5: Run to verify pass + build.**

Run: `cd apps/api && pnpm test -- src/modules/coops/coops.service.spec.ts && pnpm build`
Expected: PASS + build OK.

- [ ] **Step 6: Commit.**

```bash
git add apps/api/src/modules/admin/admin.controller.ts apps/api/src/modules/coops
git commit -m "feat(admin): audience-sync run/test/lists endpoints"
```

---

### Task 11: Shareholder emit points (best-effort, non-blocking)

**Files:**
- Modify: `apps/api/src/modules/shareholders/shareholders.service.ts` (create ~L261, update ~L406)
- Modify: `apps/api/src/modules/shareholders/shareholders.module.ts` (import `AudienceSyncModule`)
- Test: `apps/api/src/modules/shareholders/shareholders.service.spec.ts` (add cases)

**Interfaces:**
- Consumes: injected Bull queue `'audience-sync'`.
- Produces: enqueues `reconcile-one` after create and after status/email/name updates — wrapped so a queue failure never throws into the mutation.

- [ ] **Step 1: Write failing tests.** Add to `shareholders.service.spec.ts` (provide `{ provide: getQueueToken('audience-sync'), useValue: audienceQueue }` where `audienceQueue = { add: jest.fn().mockResolvedValue(undefined) }`):

```typescript
it('enqueues reconcile-one after creating a shareholder', async () => {
  // ...arrange create to resolve with { id: 'sh9', coopId: 'c1' }...
  await service.create('c1', validCreateDto);
  expect(audienceQueue.add).toHaveBeenCalledWith('reconcile-one', { coopId: 'c1', shareholderId: 'sh9' });
});

it('enqueues reconcile-one when email/status/name changes on update', async () => {
  await service.update('sh1', 'c1', { email: 'new@x.be' } as any);
  expect(audienceQueue.add).toHaveBeenCalledWith('reconcile-one', { coopId: 'c1', shareholderId: 'sh1' });
});

it('does NOT enqueue when an update changes only non-synced fields', async () => {
  await service.update('sh1', 'c1', { phone: '0499' } as any);
  expect(audienceQueue.add).not.toHaveBeenCalled();
});

it('still commits the mutation when the queue throws (best-effort)', async () => {
  audienceQueue.add.mockRejectedValueOnce(new Error('redis down'));
  await expect(service.create('c1', validCreateDto)).resolves.toBeDefined();
});
```

- [ ] **Step 2: Run to verify fail.** → FAIL.

- [ ] **Step 3: Implement.** In `shareholders.module.ts`, add `AudienceSyncModule` to `imports`. In `shareholders.service.ts`:

Constructor: add `@InjectQueue('audience-sync') private readonly audienceQueue: Queue,` (import `InjectQueue` from `@nestjs/bull`, `Queue` from `bull`). Add a private helper:

```typescript
/** Best-effort: a queue failure must never fail the shareholder mutation. */
private async enqueueAudienceSync(coopId: string, shareholderId: string): Promise<void> {
  try {
    await this.audienceQueue.add('reconcile-one', { coopId, shareholderId });
  } catch (err) {
    this.logger.warn(`audience-sync enqueue failed for ${shareholderId}: ${(err as Error).message}`);
  }
}
```
(If the service has no `logger`, add `private readonly logger = new Logger(ShareholdersService.name);`.)

After the `prisma.shareholder.create(...)` (~L261), using the created record's id:
```typescript
await this.enqueueAudienceSync(coopId, created.id);
```

After the `prisma.shareholder.update(...)` (~L406), gated on synced fields:
```typescript
if (dto.status !== undefined || dto.email !== undefined ||
    dto.firstName !== undefined || dto.lastName !== undefined) {
  await this.enqueueAudienceSync(coopId, id);
}
```

- [ ] **Step 4: Run to verify pass + build.** `cd apps/api && pnpm test -- src/modules/shareholders/shareholders.service.spec.ts && pnpm build` → PASS + OK.

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/modules/shareholders
git commit -m "feat(shareholders): best-effort audience-sync emit points"
```

---

### Task 12: Web settings UI — Brevo audience sync panel

**Files:**
- Modify: `apps/web/src/app/[locale]/dashboard/admin/settings/page.tsx`
- Modify: i18n message files (e.g. `apps/web/messages/nl.json`, `en.json`, `fr.json`, `de.json`) — add a `brevo.*` namespace.

**Interfaces:**
- Consumes: `api` from `@/lib/api`; endpoints from Task 10; `getSettings` fields from Task 9.

- [ ] **Step 1: Extend `FormState` + initial state.** Add to the `FormState` interface and the `useState<FormState>` initializer:

```typescript
  emailAudienceProvider: string; // '' = off, 'brevo'
  brevoApiKey: string;
  brevoMembersListId: string;
  brevoResignedListId: string;
```
Initialize each to `''`. When loading settings, hydrate `emailAudienceProvider/brevoMembersListId/brevoResignedListId` from the GET response (leave `brevoApiKey` blank — it is never returned).

- [ ] **Step 2: Add a status state + handlers** near the other handlers:

```typescript
const [audienceLists, setAudienceLists] = useState<{ id: string; name: string }[]>([]);
const [audienceMsg, setAudienceMsg] = useState('');

const handleTestAudience = async () => {
  if (!selectedCoop) return;
  try {
    const r = await api<{ ok: boolean; detail?: string }>(
      `/admin/coops/${selectedCoop.id}/audience-sync/test`, { method: 'POST' });
    setAudienceMsg(r.ok ? t('brevo.testOk') : `${t('brevo.testFail')}: ${r.detail ?? ''}`);
  } catch { setAudienceMsg(t('brevo.testFail')); }
};

const handleLoadLists = async () => {
  if (!selectedCoop) return;
  try {
    setAudienceLists(await api(`/admin/coops/${selectedCoop.id}/audience-sync/lists`));
  } catch { setAudienceMsg(t('brevo.testFail')); }
};

const handleSyncNow = async () => {
  if (!selectedCoop) return;
  try {
    await api(`/admin/coops/${selectedCoop.id}/audience-sync/run`, { method: 'POST' });
    setAudienceMsg(t('brevo.syncQueued'));
  } catch { setAudienceMsg(t('brevo.error')); }
};
```

- [ ] **Step 3: Include the fields in `handleSave`.** In the `body` object built by `handleSave`:

```typescript
  body.emailAudienceProvider = form.emailAudienceProvider || null;
  body.brevoMembersListId = form.brevoMembersListId || null;
  body.brevoResignedListId = form.brevoResignedListId || null;
  if (form.brevoApiKey) body.brevoApiKey = form.brevoApiKey; // write-only
```

- [ ] **Step 4: Render the Card section** after the ecoPower `Card`:

```tsx
<Card>
  <CardHeader><CardTitle>{t('brevo.title')}</CardTitle></CardHeader>
  <CardContent className="space-y-4">
    <p className="text-sm text-muted-foreground">{t('brevo.description')}</p>
    <div className="flex items-center gap-2">
      <Checkbox
        checked={form.emailAudienceProvider === 'brevo'}
        onCheckedChange={(c) => setForm({ ...form, emailAudienceProvider: c ? 'brevo' : '' })}
      />
      <Label>{t('brevo.enable')}</Label>
    </div>

    {form.emailAudienceProvider === 'brevo' && (
      <div className="space-y-4 pl-6 border-l-2 border-muted">
        <div>
          <Label>{t('brevo.apiKey')}</Label>
          <Input type="password" value={form.brevoApiKey} placeholder="xkeysib-…"
            onChange={(e) => setForm({ ...form, brevoApiKey: e.target.value })} />
          <p className="text-xs text-muted-foreground mt-1">{t('brevo.apiKeyNote')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" type="button" onClick={handleLoadLists}>{t('brevo.loadLists')}</Button>
          <Button variant="outline" type="button" onClick={handleTestAudience}>{t('brevo.testConnection')}</Button>
        </div>
        <div>
          <Label>{t('brevo.membersList')}</Label>
          <Select value={form.brevoMembersListId}
            onValueChange={(v) => setForm({ ...form, brevoMembersListId: v })}>
            <SelectTrigger><SelectValue placeholder={t('brevo.pickList')} /></SelectTrigger>
            <SelectContent>
              {audienceLists.map((l) => <SelectItem key={l.id} value={l.id}>{l.name} (#{l.id})</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{t('brevo.resignedList')}</Label>
          <Input value={form.brevoResignedListId} placeholder={t('brevo.optional')}
            onChange={(e) => setForm({ ...form, brevoResignedListId: e.target.value })} />
        </div>
        <div className="flex gap-2 pt-2">
          <Button type="button" onClick={handleSyncNow}>{t('brevo.syncNow')}</Button>
        </div>
        {audienceMsg && <Alert><AlertDescription>{audienceMsg}</AlertDescription></Alert>}
      </div>
    )}
  </CardContent>
</Card>
```

- [ ] **Step 5: Add i18n keys.** In each message file add a `brevo` block, e.g. `apps/web/messages/nl.json`:

```json
"brevo": {
  "title": "Brevo nieuwsbrief-synchronisatie",
  "description": "Houd je Brevo-lijst automatisch gelijk met je actieve coöperanten. Alleen marketing — statutaire communicatie (AV) verloopt via OpenCoop.",
  "enable": "Synchronisatie inschakelen",
  "apiKey": "Brevo API-sleutel",
  "apiKeyNote": "Wordt versleuteld opgeslagen en nooit getoond. Laat leeg om ongewijzigd te laten.",
  "loadLists": "Lijsten laden",
  "testConnection": "Verbinding testen",
  "membersList": "Ledenlijst",
  "resignedList": "Lijst voor uitgetreden leden (optioneel)",
  "pickList": "Kies een lijst",
  "optional": "Optioneel",
  "syncNow": "Nu synchroniseren",
  "syncQueued": "Synchronisatie gestart.",
  "testOk": "Verbinding OK.",
  "testFail": "Verbinding mislukt",
  "error": "Er ging iets mis."
}
```
(Add equivalent blocks to `en.json`, `fr.json`, `de.json`; copy English text if a translation isn't ready.)

- [ ] **Step 6: Verify the web build/typecheck.**

Run: `cd apps/web && pnpm build` (or the repo's `pnpm --filter @opencoop/web lint && tsc --noEmit` equivalent)
Expected: compiles; the new section renders under admin → settings.

- [ ] **Step 7: Commit.**

```bash
git add apps/web/src/app/[locale]/dashboard/admin/settings/page.tsx apps/web/messages
git commit -m "feat(web): Brevo audience sync settings panel"
```

---

## Self-Review

**Spec coverage:**
- Per-coop config (provider/key/lists/status) → Task 1, 9, 12. ✓
- Brevo provider behind interface + factory → Tasks 2, 3, 4. ✓
- Reconcile engine (reconcileOne/All), status→list state machine, optional resigned list → Task 5. ✓
- EXT_ID identity + email-change handling, never-resubscribe → Task 3 (`upsertContact`), Task 5 (mapping). ✓
- Per-change emit points (best-effort, non-blocking) → Task 11. ✓
- Nightly cron + manual "Sync now" + Bull queue → Tasks 6, 7, 10. ✓
- Test connection + list picker → Tasks 10, 12. ✓
- BrevoSyncRun observability → Tasks 1, 5. ✓
- Secret encryption + masking + audit → Task 9. ✓
- Channel boundary (statutory mail stays on transactional path) → no code change; enforced by NOT touching `meetings`/`EmailService`; documented in spec + i18n copy. ✓
- IP-allowlist deploy note → surfaced operationally via "Test connection" (Task 10/12); deployment action is on the operator (add fsn1 IP), not code.

**Placeholder scan:** All code steps contain full code; no TODO/TBD. ✓

**Type consistency:** `upsertContact(UpsertContactInput) → UpsertResult` used identically in Tasks 3 & 5; `reconcileOne(coopId, shareholderId)` / `reconcileAll(coopId, trigger)` used identically in Tasks 5, 6, 7, 10; queue jobs `'reconcile-one'`/`'reconcile-all'` consistent across Tasks 6, 7, 10, 11; `getAudienceProvider(coop)` signature consistent across Tasks 4, 5, 10. ✓

**Note for implementer:** Confirm the exact post-commit return variable name at `shareholders.service.ts` create (~L261) — the plan assumes the created record is bound to `created`; adjust the emit call to the actual variable. The `update` method already has `id` and `coopId` in scope.
