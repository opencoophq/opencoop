# Admin MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the public MCP endpoint with an authenticated admin MCP server using per-user API keys, exposing 13 read-only tools for querying coop data.

**Architecture:** NestJS middleware validates API keys on `POST /mcp`, stores auth context in `AsyncLocalStorage`, and 13 MCP tools (split across 4 tool classes) read the coopId from that context. A new `ApiKey` Prisma model stores hashed keys per-user. Key management is exposed via REST endpoints + dashboard UI.

**Tech Stack:** NestJS, @rekog/mcp-nest, Prisma, SHA-256 hashing, AsyncLocalStorage, Next.js (dashboard UI)

**Spec:** `docs/superpowers/specs/2026-04-13-admin-mcp-server-design.md`

---

## File Structure

### New files
```
apps/api/src/modules/api-keys/
├── api-keys.module.ts          # Module — exports ApiKeysService
├── api-keys.service.ts         # Create, list, revoke, validate keys
├── api-keys.service.spec.ts    # Unit tests
├── api-keys.controller.ts      # REST endpoints for key management
└── dto/
    └── create-api-key.dto.ts   # { name: string }

apps/api/src/modules/mcp/
├── mcp-auth.store.ts           # AsyncLocalStorage wrapper (McpAuthStore)
├── mcp-auth.middleware.ts      # Validates API key, sets auth context
├── mcp-auth.middleware.spec.ts # Unit tests
├── tools/
│   ├── mcp-coop.tools.ts       # get_coop_info, get_coop_stats, list_share_classes, list_projects
│   ├── mcp-shareholder.tools.ts # list_shareholders, get_shareholder
│   ├── mcp-transaction.tools.ts # list_registrations, get_registration
│   └── mcp-analytics.tools.ts  # get_capital_timeline, get_capital_by_project,
│                                # get_shareholder_growth, get_transaction_summary,
│                                # get_annual_overview
```

### Modified files
```
packages/database/prisma/schema.prisma  — Add ApiKey model + relations on User and Coop
apps/api/src/app.module.ts              — Remove old modules, add new ones, configure middleware
apps/api/src/modules/mcp/mcp.module.ts  — Register new tool classes + McpAuthStore
apps/api/src/modules/admin/analytics.service.ts — Add from/to date params
apps/api/src/modules/registrations/registrations.service.ts — Add fromDate/toDate/channelId
apps/api/src/modules/shareholders/shareholders.service.ts — Add channelId
apps/web/src/app/[locale]/dashboard/admin/settings/page.tsx — Add API keys UI section
apps/web/messages/{en,nl,fr,de}.json — Add API key translations
```

### Deleted files
```
apps/api/src/modules/mcp/mcp.tools.ts        — Old public MCP tools
apps/api/src/modules/llms/llms.controller.ts  — llms.txt endpoints
apps/api/src/modules/llms/llms.module.ts      — LlmsModule
```

---

## Task 1: Database — Add ApiKey Model

**Files:**
- Modify: `packages/database/prisma/schema.prisma`

- [ ] **Step 1: Add ApiKey model to Prisma schema**

Add after the `RefreshToken` model (near end of schema):

```prisma
model ApiKey {
  id         String    @id @default(cuid())
  prefix     String    // first 11 chars of raw key for display ("oc_a1b2c3d4...")
  keyHash    String    @unique // SHA-256 hash of full key
  name       String    // user-chosen label
  userId     String
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  coopId     String
  coop       Coop      @relation(fields: [coopId], references: [id], onDelete: Cascade)
  lastUsedAt DateTime?
  createdAt  DateTime  @default(now())
  revokedAt  DateTime?

  @@index([keyHash])
  @@map("api_keys")
}
```

Add relation field to the `User` model (alongside existing relation fields):

```prisma
apiKeys ApiKey[]
```

Add relation field to the `Coop` model (alongside existing relation fields like `channels`, `admins`, etc.):

```prisma
apiKeys ApiKey[]
```

- [ ] **Step 2: Generate Prisma client**

Run: `cd /Users/wouterhermans/Developer/opencoop && pnpm db:generate`
Expected: "Generated Prisma Client" success message

- [ ] **Step 3: Push schema to dev database**

Run: `pnpm db:push`
Expected: "Your database is now in sync with your Prisma schema" or similar success

- [ ] **Step 4: Commit**

```bash
git add packages/database/prisma/schema.prisma
git commit -m "feat: add ApiKey model for per-user MCP authentication"
```

---

## Task 2: Cleanup — Remove Public MCP + LLMs Endpoints

**Files:**
- Delete: `apps/api/src/modules/mcp/mcp.tools.ts`
- Delete: `apps/api/src/modules/llms/llms.controller.ts`
- Delete: `apps/api/src/modules/llms/llms.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/modules/mcp/mcp.module.ts`

- [ ] **Step 1: Delete old MCP tools file**

Delete `apps/api/src/modules/mcp/mcp.tools.ts`.

- [ ] **Step 2: Delete LLMs module files**

Delete `apps/api/src/modules/llms/llms.controller.ts` and `apps/api/src/modules/llms/llms.module.ts`.

- [ ] **Step 3: Remove LlmsModule from AppModule imports**

In `apps/api/src/app.module.ts`, remove the `LlmsModule` import statement and its entry in the `imports` array.

- [ ] **Step 4: Clean up McpToolsModule**

In `apps/api/src/modules/mcp/mcp.module.ts`, remove the `McpTools` import and provider. Leave the module shell — we'll add new providers in Task 6:

```typescript
import { Module } from '@nestjs/common';

@Module({
  providers: [],
})
export class McpToolsModule {}
```

- [ ] **Step 5: Verify build**

Run: `cd /Users/wouterhermans/Developer/opencoop && pnpm build --filter=api`
Expected: Build succeeds with no errors

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove public MCP tools and llms.txt endpoints"
```

---

## Task 3: API Key Service

**Files:**
- Create: `apps/api/src/modules/api-keys/api-keys.service.ts`
- Create: `apps/api/src/modules/api-keys/api-keys.service.spec.ts`
- Create: `apps/api/src/modules/api-keys/api-keys.module.ts`
- Create: `apps/api/src/modules/api-keys/dto/create-api-key.dto.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Create the DTO**

Create `apps/api/src/modules/api-keys/dto/create-api-key.dto.ts`:

```typescript
import { IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateApiKeyDto {
  @ApiProperty({ example: 'Claude Code - laptop' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;
}
```

- [ ] **Step 2: Write failing tests for ApiKeysService**

Create `apps/api/src/modules/api-keys/api-keys.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { ApiKeysService } from './api-keys.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UnauthorizedException } from '@nestjs/common';

describe('ApiKeysService', () => {
  let service: ApiKeysService;
  let prisma: {
    apiKey: {
      create: jest.fn;
      findMany: jest.fn;
      findUnique: jest.fn;
      update: jest.fn;
    };
    coopAdmin: {
      findFirst: jest.fn;
    };
    user: {
      findUnique: jest.fn;
    };
  };

  beforeEach(async () => {
    prisma = {
      apiKey: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      coopAdmin: {
        findFirst: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        ApiKeysService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(ApiKeysService);
  });

  describe('create', () => {
    it('returns a raw key starting with oc_ and stores its SHA-256 hash', async () => {
      prisma.apiKey.create.mockResolvedValue({
        id: 'key1',
        prefix: 'oc_abcde',
        name: 'Test Key',
        createdAt: new Date(),
      });

      const result = await service.create('user1', 'coop1', 'Test Key');

      expect(result.rawKey).toMatch(/^oc_[a-f0-9]{40}$/);
      expect(result.id).toBe('key1');

      const createCall = prisma.apiKey.create.mock.calls[0][0];
      expect(createCall.data.keyHash).not.toBe(result.rawKey);
      expect(createCall.data.keyHash).toHaveLength(64); // SHA-256 hex
      expect(createCall.data.prefix).toBe(result.rawKey.substring(0, 11));
      expect(createCall.data.userId).toBe('user1');
      expect(createCall.data.coopId).toBe('coop1');
    });
  });

  describe('validate', () => {
    it('returns userId and coopId for a valid key with active admin role', async () => {
      const rawKey = 'oc_' + 'a'.repeat(40);
      const crypto = await import('crypto');
      const hash = crypto.createHash('sha256').update(rawKey).digest('hex');

      prisma.apiKey.findUnique.mockResolvedValue({
        id: 'key1',
        keyHash: hash,
        userId: 'user1',
        coopId: 'coop1',
        revokedAt: null,
        user: { id: 'user1', role: 'COOP_ADMIN' },
      });

      prisma.coopAdmin.findFirst.mockResolvedValue({
        userId: 'user1',
        coopId: 'coop1',
      });

      const result = await service.validate(rawKey);

      expect(result).toEqual({ userId: 'user1', coopId: 'coop1' });
    });

    it('returns null for a revoked key', async () => {
      const rawKey = 'oc_' + 'a'.repeat(40);
      const crypto = await import('crypto');
      const hash = crypto.createHash('sha256').update(rawKey).digest('hex');

      prisma.apiKey.findUnique.mockResolvedValue({
        id: 'key1',
        keyHash: hash,
        userId: 'user1',
        coopId: 'coop1',
        revokedAt: new Date(),
        user: { id: 'user1', role: 'COOP_ADMIN' },
      });

      const result = await service.validate(rawKey);
      expect(result).toBeNull();
    });

    it('returns null for a non-existent key', async () => {
      prisma.apiKey.findUnique.mockResolvedValue(null);

      const result = await service.validate('oc_' + 'b'.repeat(40));
      expect(result).toBeNull();
    });

    it('returns null when user no longer has admin role', async () => {
      const rawKey = 'oc_' + 'a'.repeat(40);
      const crypto = await import('crypto');
      const hash = crypto.createHash('sha256').update(rawKey).digest('hex');

      prisma.apiKey.findUnique.mockResolvedValue({
        id: 'key1',
        keyHash: hash,
        userId: 'user1',
        coopId: 'coop1',
        revokedAt: null,
        user: { id: 'user1', role: 'SHAREHOLDER' },
      });

      const result = await service.validate(rawKey);
      expect(result).toBeNull();
    });
  });

  describe('findByUser', () => {
    it('returns keys for the given user and coop', async () => {
      prisma.apiKey.findMany.mockResolvedValue([
        { id: 'key1', prefix: 'oc_abcde12', name: 'Key 1', createdAt: new Date(), lastUsedAt: null, revokedAt: null },
      ]);

      const result = await service.findByUser('user1', 'coop1');

      expect(result).toHaveLength(1);
      expect(result[0].prefix).toBe('oc_abcde12');
      expect(prisma.apiKey.findMany).toHaveBeenCalledWith({
        where: { coopId: 'coop1', revokedAt: null, userId: 'user1' },
        select: { id: true, prefix: true, name: true, createdAt: true, lastUsedAt: true },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('revoke', () => {
    it('sets revokedAt on the key', async () => {
      prisma.apiKey.findUnique.mockResolvedValue({
        id: 'key1',
        userId: 'user1',
        coopId: 'coop1',
        revokedAt: null,
      });
      prisma.apiKey.update.mockResolvedValue({});

      await service.revoke('key1', 'user1');

      expect(prisma.apiKey.update).toHaveBeenCalledWith({
        where: { id: 'key1' },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('throws if key belongs to another user', async () => {
      prisma.apiKey.findUnique.mockResolvedValue({
        id: 'key1',
        userId: 'other-user',
        coopId: 'coop1',
        revokedAt: null,
      });

      await expect(service.revoke('key1', 'user1')).rejects.toThrow();
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Users/wouterhermans/Developer/opencoop/apps/api && npx jest --testPathPattern=api-keys.service.spec --no-coverage`
Expected: FAIL — module `./api-keys.service` not found

- [ ] **Step 4: Implement ApiKeysService**

Create `apps/api/src/modules/api-keys/api-keys.service.ts`:

```typescript
import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ApiKeysService {
  private lastUsedCache = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, coopId: string, name: string) {
    const rawKey = 'oc_' + randomBytes(20).toString('hex');
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    const prefix = rawKey.substring(0, 11);

    const apiKey = await this.prisma.apiKey.create({
      data: { keyHash, prefix, name, userId, coopId },
      select: { id: true, prefix: true, name: true, createdAt: true },
    });

    return { ...apiKey, rawKey };
  }

  async validate(rawKey: string): Promise<{ userId: string; coopId: string } | null> {
    const keyHash = createHash('sha256').update(rawKey).digest('hex');

    const apiKey = await this.prisma.apiKey.findUnique({
      where: { keyHash },
      include: { user: { select: { id: true, role: true } } },
    });

    if (!apiKey || apiKey.revokedAt) return null;

    // Verify user still has admin role
    const { user } = apiKey;
    if (user.role === 'SYSTEM_ADMIN') {
      this.touchLastUsed(apiKey.id);
      return { userId: apiKey.userId, coopId: apiKey.coopId };
    }

    if (user.role === 'COOP_ADMIN') {
      const membership = await this.prisma.coopAdmin.findFirst({
        where: { userId: apiKey.userId, coopId: apiKey.coopId },
      });
      if (!membership) return null;

      this.touchLastUsed(apiKey.id);
      return { userId: apiKey.userId, coopId: apiKey.coopId };
    }

    return null;
  }

  async findByUser(userId: string, coopId: string, isSystemAdmin = false) {
    return this.prisma.apiKey.findMany({
      where: {
        coopId,
        revokedAt: null,
        // System admins see all keys for the coop; regular admins see only their own
        ...(!isSystemAdmin ? { userId } : {}),
      },
      select: { id: true, prefix: true, name: true, createdAt: true, lastUsedAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revoke(keyId: string, userId: string, isSystemAdmin = false) {
    const apiKey = await this.prisma.apiKey.findUnique({
      where: { id: keyId },
      select: { id: true, userId: true },
    });

    if (!apiKey) throw new NotFoundException('API key not found');
    if (!isSystemAdmin && apiKey.userId !== userId) {
      throw new ForbiddenException('Cannot revoke another user\'s key');
    }

    await this.prisma.apiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
    });
  }

  /** Debounced lastUsedAt update — at most once per minute per key */
  private touchLastUsed(keyId: string) {
    const now = Date.now();
    const lastTouch = this.lastUsedCache.get(keyId) ?? 0;
    if (now - lastTouch < 60_000) return;

    this.lastUsedCache.set(keyId, now);
    this.prisma.apiKey
      .update({ where: { id: keyId }, data: { lastUsedAt: new Date() } })
      .catch(() => {}); // fire-and-forget
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/wouterhermans/Developer/opencoop/apps/api && npx jest --testPathPattern=api-keys.service.spec --no-coverage`
Expected: All tests PASS

- [ ] **Step 6: Create ApiKeysModule**

Create `apps/api/src/modules/api-keys/api-keys.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import { ApiKeysController } from './api-keys.controller';

@Module({
  providers: [ApiKeysService],
  controllers: [ApiKeysController],
  exports: [ApiKeysService],
})
export class ApiKeysModule {}
```

Note: `ApiKeysController` will be created in Task 7. For now, create a placeholder:

Create `apps/api/src/modules/api-keys/api-keys.controller.ts`:

```typescript
import { Controller } from '@nestjs/common';

@Controller('admin/coops/:coopId/api-keys')
export class ApiKeysController {}
```

- [ ] **Step 7: Add ApiKeysModule to AppModule**

In `apps/api/src/app.module.ts`, add import:

```typescript
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
```

Add `ApiKeysModule` to the `imports` array.

- [ ] **Step 8: Verify build**

Run: `pnpm build --filter=api`
Expected: Build succeeds

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/api-keys/
git commit -m "feat: add ApiKeysService with create, validate, list, revoke"
```

---

## Task 4: MCP Auth Middleware + Context Store

**Files:**
- Create: `apps/api/src/modules/mcp/mcp-auth.store.ts`
- Create: `apps/api/src/modules/mcp/mcp-auth.middleware.ts`
- Create: `apps/api/src/modules/mcp/mcp-auth.middleware.spec.ts`
- Modify: `apps/api/src/modules/mcp/mcp.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Create McpAuthStore**

Create `apps/api/src/modules/mcp/mcp-auth.store.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

interface McpAuthContext {
  userId: string;
  coopId: string;
}

@Injectable()
export class McpAuthStore {
  private readonly storage = new AsyncLocalStorage<McpAuthContext>();

  run<T>(context: McpAuthContext, fn: () => T): T {
    return this.storage.run(context, fn);
  }

  getCoopId(): string {
    const ctx = this.storage.getStore();
    if (!ctx) throw new Error('No MCP auth context — is the request authenticated?');
    return ctx.coopId;
  }

  getUserId(): string {
    const ctx = this.storage.getStore();
    if (!ctx) throw new Error('No MCP auth context — is the request authenticated?');
    return ctx.userId;
  }
}
```

- [ ] **Step 2: Write failing test for middleware**

Create `apps/api/src/modules/mcp/mcp-auth.middleware.spec.ts`:

```typescript
import { McpAuthMiddleware } from './mcp-auth.middleware';
import { McpAuthStore } from './mcp-auth.store';
import { UnauthorizedException } from '@nestjs/common';

describe('McpAuthMiddleware', () => {
  let middleware: McpAuthMiddleware;
  let apiKeysService: { validate: jest.Mock };
  let store: McpAuthStore;

  beforeEach(() => {
    apiKeysService = { validate: jest.fn() };
    store = new McpAuthStore();
    middleware = new McpAuthMiddleware(apiKeysService as any, store);
  });

  it('throws 401 when no Authorization header', async () => {
    const req = { headers: {} } as any;
    const res = {} as any;
    const next = jest.fn();

    await expect(middleware.use(req, res, next)).rejects.toThrow(UnauthorizedException);
    expect(next).not.toHaveBeenCalled();
  });

  it('throws 401 when key is invalid', async () => {
    apiKeysService.validate.mockResolvedValue(null);

    const req = { headers: { authorization: 'Bearer oc_invalid' } } as any;
    const res = {} as any;
    const next = jest.fn();

    await expect(middleware.use(req, res, next)).rejects.toThrow(UnauthorizedException);
  });

  it('sets auth context and calls next for valid key', async () => {
    apiKeysService.validate.mockResolvedValue({ userId: 'u1', coopId: 'c1' });

    const req = { headers: { authorization: 'Bearer oc_' + 'a'.repeat(40) } } as any;
    const res = {} as any;

    let capturedCoopId: string | undefined;
    const next = jest.fn(() => {
      capturedCoopId = store.getCoopId();
    });

    await middleware.use(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(capturedCoopId).toBe('c1');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Users/wouterhermans/Developer/opencoop/apps/api && npx jest --testPathPattern=mcp-auth.middleware.spec --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 4: Implement McpAuthMiddleware**

Create `apps/api/src/modules/mcp/mcp-auth.middleware.ts`:

```typescript
import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { McpAuthStore } from './mcp-auth.store';

@Injectable()
export class McpAuthMiddleware implements NestMiddleware {
  constructor(
    private readonly apiKeysService: ApiKeysService,
    private readonly mcpAuthStore: McpAuthStore,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid API key');
    }

    const rawKey = authHeader.substring(7);
    const result = await this.apiKeysService.validate(rawKey);
    if (!result) {
      throw new UnauthorizedException('Invalid or revoked API key');
    }

    this.mcpAuthStore.run(result, () => {
      next();
    });
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/wouterhermans/Developer/opencoop/apps/api && npx jest --testPathPattern=mcp-auth.middleware.spec --no-coverage`
Expected: All tests PASS

- [ ] **Step 6: Update McpToolsModule to provide McpAuthStore**

Update `apps/api/src/modules/mcp/mcp.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { McpAuthStore } from './mcp-auth.store';

@Module({
  providers: [McpAuthStore],
  exports: [McpAuthStore],
})
export class McpToolsModule {}
```

- [ ] **Step 7: Configure middleware in AppModule**

In `apps/api/src/app.module.ts`, make `AppModule` implement `NestModule` and add middleware configuration:

```typescript
import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { McpAuthMiddleware } from './modules/mcp/mcp-auth.middleware';

// ... existing imports ...

@Module({ /* existing config */ })
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(McpAuthMiddleware).forRoutes('mcp');
  }
}
```

Ensure `McpToolsModule` and `ApiKeysModule` are both in the `imports` array (McpToolsModule should already be there, ApiKeysModule was added in Task 3).

- [ ] **Step 8: Verify build**

Run: `pnpm build --filter=api`
Expected: Build succeeds

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/mcp/ apps/api/src/app.module.ts
git commit -m "feat: add MCP auth middleware with AsyncLocalStorage context"
```

---

## Task 5: Service Updates — Date Range + Channel Filtering

**Files:**
- Modify: `apps/api/src/modules/admin/analytics.service.ts`
- Modify: `apps/api/src/modules/registrations/registrations.service.ts`
- Modify: `apps/api/src/modules/shareholders/shareholders.service.ts`

- [ ] **Step 1: Add from/to params to getCapitalTimeline**

In `apps/api/src/modules/admin/analytics.service.ts`, update the `getCapitalTimeline` method signature:

```typescript
async getCapitalTimeline(
  coopId: string,
  period: 'day' | 'month' | 'quarter' | 'year' | 'all',
  from?: string,
  to?: string,
): Promise<CapitalTimelinePoint[]>
```

Add date filtering to the Prisma query inside the method. In the `where` clause for the registrations/payments query, add:

```typescript
...(from || to ? {
  payments: {
    some: {
      bankDate: {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to) } : {}),
      },
    },
  },
} : {}),
```

Also filter the timeline output to only include points within the date range. The exact implementation depends on the current query structure — read the method body carefully and add the date filter where the payments are queried.

- [ ] **Step 2: Add from/to params to getCapitalByProject**

Update signature:

```typescript
async getCapitalByProject(coopId: string, from?: string, to?: string): Promise<CapitalByProject[]>
```

Add the same date filter to the payments query inside this method.

- [ ] **Step 3: Add from/to params to getShareholderGrowth**

Update signature:

```typescript
async getShareholderGrowth(
  coopId: string,
  period: 'day' | 'month' | 'quarter' | 'year' | 'all',
  from?: string,
  to?: string,
): Promise<ShareholderGrowthPoint[]>
```

Filter the registration date query (`registerDate` or `createdAt`) by the date range.

- [ ] **Step 4: Add from/to params to getTransactionSummary**

Update signature:

```typescript
async getTransactionSummary(
  coopId: string,
  period: 'day' | 'month' | 'quarter' | 'year' | 'all',
  from?: string,
  to?: string,
): Promise<TransactionSummaryResult>
```

Filter registrations by `createdAt` within the date range.

- [ ] **Step 5: Verify existing admin endpoints still work**

The admin controller calls these methods without from/to params. Since the new params are optional, existing callers are unaffected. Verify:

Run: `pnpm build --filter=api`
Expected: Build succeeds with no type errors

- [ ] **Step 6: Add fromDate/toDate/channelId to registrations findAll**

In `apps/api/src/modules/registrations/registrations.service.ts`, update the `findAll` params type:

```typescript
async findAll(
  coopId: string,
  params: {
    page?: number;
    pageSize?: number;
    status?: string;
    type?: string;
    shareholderId?: string;
    fromDate?: string;
    toDate?: string;
    channelId?: string;
  } = {},
)
```

Add to the Prisma `where` clause:

```typescript
...(params.fromDate ? { createdAt: { gte: new Date(params.fromDate) } } : {}),
...(params.toDate ? { createdAt: { ...( where.createdAt || {}), lte: new Date(params.toDate) } } : {}),
...(params.channelId ? { channelId: params.channelId } : {}),
```

Note: Handle `createdAt` carefully — if both `fromDate` and `toDate` are set, combine them:

```typescript
...(params.fromDate || params.toDate ? {
  createdAt: {
    ...(params.fromDate ? { gte: new Date(params.fromDate) } : {}),
    ...(params.toDate ? { lte: new Date(params.toDate) } : {}),
  },
} : {}),
```

- [ ] **Step 7: Add channelId to shareholders findAll**

In `apps/api/src/modules/shareholders/shareholders.service.ts`, update the `findAll` params:

```typescript
async findAll(
  coopId: string,
  params: {
    page?: number;
    pageSize?: number;
    search?: string;
    status?: string;
    type?: string;
    ecoPowerClient?: string;
    channelId?: string;
  } = {},
)
```

Add to the Prisma `where` clause:

```typescript
...(params.channelId ? { channelId: params.channelId } : {}),
```

- [ ] **Step 8: Verify build**

Run: `pnpm build --filter=api`
Expected: Build succeeds

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/admin/analytics.service.ts apps/api/src/modules/registrations/registrations.service.ts apps/api/src/modules/shareholders/shareholders.service.ts
git commit -m "feat: add date range and channel filtering to analytics and list services"
```

---

## Task 6: MCP Admin Tools

**Files:**
- Create: `apps/api/src/modules/mcp/tools/mcp-coop.tools.ts`
- Create: `apps/api/src/modules/mcp/tools/mcp-shareholder.tools.ts`
- Create: `apps/api/src/modules/mcp/tools/mcp-transaction.tools.ts`
- Create: `apps/api/src/modules/mcp/tools/mcp-analytics.tools.ts`
- Modify: `apps/api/src/modules/mcp/mcp.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Create coop tools (get_coop_info, get_coop_stats, list_share_classes, list_projects)**

Create `apps/api/src/modules/mcp/tools/mcp-coop.tools.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { PrismaService } from '../../../prisma/prisma.service';
import { McpAuthStore } from '../mcp-auth.store';

@Injectable()
export class McpCoopTools {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: McpAuthStore,
  ) {}

  @Tool({
    name: 'get_coop_info',
    description: 'Get your cooperative\'s information: name, slug, branding, bank details, and terms URL.',
    parameters: z.object({}),
  })
  async getCoopInfo() {
    const coopId = this.auth.getCoopId();
    const coop = await this.prisma.coop.findUnique({
      where: { id: coopId },
      select: {
        slug: true,
        name: true,
        bankName: true,
        bankIban: true,
        bankBic: true,
        logoUrl: true,
        coopAddress: true,
        coopPhone: true,
        coopEmail: true,
        coopWebsite: true,
        vatNumber: true,
        legalForm: true,
        foundedDate: true,
        channels: {
          where: { isDefault: true },
          select: {
            logoUrl: true,
            primaryColor: true,
            secondaryColor: true,
            termsUrl: true,
          },
          take: 1,
        },
      },
    });
    if (!coop) return JSON.stringify({ error: 'Cooperative not found' });

    const { channels, ...rest } = coop;
    const ch = channels[0];
    return JSON.stringify({
      ...rest,
      logoUrl: ch?.logoUrl ?? coop.logoUrl ?? null,
      primaryColor: ch?.primaryColor ?? null,
      secondaryColor: ch?.secondaryColor ?? null,
      termsUrl: ch?.termsUrl ?? null,
    }, null, 2);
  }

  @Tool({
    name: 'get_coop_stats',
    description: 'Get dashboard stats: total/active shareholders, total capital, pending registrations, pending shareholders, unmatched bank transactions.',
    parameters: z.object({}),
  })
  async getCoopStats() {
    const coopId = this.auth.getCoopId();

    const [
      totalShareholders,
      activeShareholders,
      pendingShareholders,
      pendingRegistrations,
      unmatchedBankTransactions,
    ] = await Promise.all([
      this.prisma.shareholder.count({ where: { coopId } }),
      this.prisma.shareholder.count({ where: { coopId, status: 'ACTIVE' } }),
      this.prisma.shareholder.count({ where: { coopId, status: 'PENDING' } }),
      this.prisma.registration.count({ where: { coopId, status: { in: ['PENDING', 'PENDING_PAYMENT'] } } }),
      this.prisma.bankTransaction.count({ where: { coopId, matchedRegistrationId: null } }),
    ]);

    // Calculate total capital from payments
    const capitalResult = await this.prisma.$queryRaw<[{ total: number }]>`
      SELECT COALESCE(SUM(
        CASE WHEN r."type" = 'BUY' THEN p."amount" ELSE -p."amount" END
      ), 0) as total
      FROM payments p
      JOIN registrations r ON r.id = p."registrationId"
      WHERE r."coopId" = ${coopId}
      AND r."status" IN ('ACTIVE', 'COMPLETED')
    `;

    return JSON.stringify({
      totalShareholders,
      activeShareholders,
      pendingShareholders,
      pendingRegistrations,
      unmatchedBankTransactions,
      totalCapital: Number(capitalResult[0]?.total ?? 0),
    }, null, 2);
  }

  @Tool({
    name: 'list_share_classes',
    description: 'List all share classes with pricing, limits, voting rights, and dividend rate overrides.',
    parameters: z.object({}),
  })
  async listShareClasses() {
    const coopId = this.auth.getCoopId();
    const classes = await this.prisma.shareClass.findMany({
      where: { coopId },
      select: {
        id: true,
        name: true,
        code: true,
        pricePerShare: true,
        minShares: true,
        maxShares: true,
        hasVotingRights: true,
        dividendRateOverride: true,
        isActive: true,
      },
      orderBy: { code: 'asc' },
    });

    return JSON.stringify(classes.map(sc => ({
      ...sc,
      pricePerShare: sc.pricePerShare.toNumber(),
      dividendRateOverride: sc.dividendRateOverride?.toNumber() ?? null,
    })), null, 2);
  }

  @Tool({
    name: 'list_projects',
    description: 'List projects with type, capacity, investment stats (shares sold, capital raised).',
    parameters: z.object({}),
  })
  async listProjects() {
    const coopId = this.auth.getCoopId();
    const coop = await this.prisma.coop.findUnique({
      where: { id: coopId },
      select: {
        projects: {
          select: {
            id: true,
            name: true,
            description: true,
            type: true,
            capacityKw: true,
            targetShares: true,
            isActive: true,
          },
          orderBy: { name: 'asc' },
        },
      },
    });
    if (!coop) return JSON.stringify([]);

    const projectIds = coop.projects.map(p => p.id);

    const regStats = await this.prisma.registration.groupBy({
      by: ['projectId'],
      where: {
        projectId: { in: projectIds },
        type: 'BUY',
        status: { in: ['PENDING_PAYMENT', 'ACTIVE', 'COMPLETED'] },
      },
      _sum: { quantity: true },
    });

    const statsMap = new Map(regStats.map(s => [s.projectId, s._sum.quantity ?? 0]));

    return JSON.stringify(coop.projects.map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      type: p.type,
      capacityKw: p.capacityKw?.toNumber() ?? null,
      targetShares: p.targetShares,
      isActive: p.isActive,
      sharesSold: statsMap.get(p.id) ?? 0,
    })), null, 2);
  }
}
```

- [ ] **Step 2: Create shareholder tools (list_shareholders, get_shareholder)**

Create `apps/api/src/modules/mcp/tools/mcp-shareholder.tools.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { McpAuthStore } from '../mcp-auth.store';
import { ShareholdersService } from '../../shareholders/shareholders.service';

@Injectable()
export class McpShareholderTools {
  constructor(
    private readonly auth: McpAuthStore,
    private readonly shareholdersService: ShareholdersService,
  ) {}

  @Tool({
    name: 'list_shareholders',
    description: 'Search and filter shareholders. Returns paginated list with name, email, type, status, and share count.',
    parameters: z.object({
      search: z.string().optional().describe('Search by name, company name, or email'),
      status: z.enum(['PENDING', 'ACTIVE', 'INACTIVE']).optional().describe('Filter by status'),
      type: z.enum(['INDIVIDUAL', 'COMPANY', 'MINOR']).optional().describe('Filter by type'),
      channelId: z.string().optional().describe('Filter by sales channel ID'),
      page: z.number().default(1).describe('Page number (default: 1)'),
      pageSize: z.number().default(25).describe('Items per page (default: 25, max: 100)'),
    }),
  })
  async listShareholders(params: {
    search?: string;
    status?: 'PENDING' | 'ACTIVE' | 'INACTIVE';
    type?: 'INDIVIDUAL' | 'COMPANY' | 'MINOR';
    channelId?: string;
    page?: number;
    pageSize?: number;
  }) {
    const coopId = this.auth.getCoopId();
    const pageSize = Math.min(params.pageSize ?? 25, 100);
    const result = await this.shareholdersService.findAll(coopId, {
      ...params,
      pageSize,
    });

    // Strip sensitive fields
    const items = result.items.map((sh: any) => ({
      id: sh.id,
      type: sh.type,
      status: sh.status,
      firstName: sh.firstName,
      lastName: sh.lastName,
      companyName: sh.companyName,
      email: sh.email,
      phone: sh.phone,
      memberNumber: sh.memberNumber,
      createdAt: sh.createdAt,
      // Include computed share data if available
      ...(sh.sharesOwned !== undefined ? { sharesOwned: sh.sharesOwned } : {}),
    }));

    return JSON.stringify({
      items,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
    }, null, 2);
  }

  @Tool({
    name: 'get_shareholder',
    description: 'Get full details for a shareholder: contact info, address, banking, registrations with payments, documents, and dividend payouts. Excludes national ID (encrypted PII).',
    parameters: z.object({
      shareholderId: z.string().describe('The shareholder ID'),
    }),
  })
  async getShareholder({ shareholderId }: { shareholderId: string }) {
    const coopId = this.auth.getCoopId();
    const sh = await this.shareholdersService.findById(shareholderId, coopId) as any;

    if (!sh) return JSON.stringify({ error: 'Shareholder not found' });

    // Strip nationalId from shareholder and beneficial owners
    const { nationalId, beneficialOwners, ...rest } = sh;
    const safeBeneficialOwners = beneficialOwners?.map((bo: any) => {
      const { nationalId: _nid, ...boRest } = bo;
      return boRest;
    });

    return JSON.stringify({
      ...rest,
      beneficialOwners: safeBeneficialOwners,
    }, null, 2);
  }
}
```

- [ ] **Step 3: Create transaction tools (list_registrations, get_registration)**

Create `apps/api/src/modules/mcp/tools/mcp-transaction.tools.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { McpAuthStore } from '../mcp-auth.store';
import { RegistrationsService } from '../../registrations/registrations.service';

@Injectable()
export class McpTransactionTools {
  constructor(
    private readonly auth: McpAuthStore,
    private readonly registrationsService: RegistrationsService,
  ) {}

  @Tool({
    name: 'list_registrations',
    description: 'List share registrations (transactions). Filter by status, type, shareholder, date range, or channel. Returns paginated list with shareholder name, share class, amount, and status.',
    parameters: z.object({
      status: z.enum(['PENDING', 'PENDING_PAYMENT', 'ACTIVE', 'COMPLETED', 'CANCELLED']).optional().describe('Filter by status'),
      type: z.enum(['BUY', 'SELL']).optional().describe('Filter by transaction type'),
      shareholderId: z.string().optional().describe('Filter by shareholder ID'),
      channelId: z.string().optional().describe('Filter by sales channel ID'),
      fromDate: z.string().optional().describe('Start date (ISO format, e.g. "2026-01-01")'),
      toDate: z.string().optional().describe('End date (ISO format, e.g. "2026-03-31")'),
      page: z.number().default(1).describe('Page number (default: 1)'),
      pageSize: z.number().default(25).describe('Items per page (default: 25, max: 100)'),
    }),
  })
  async listRegistrations(params: {
    status?: string;
    type?: string;
    shareholderId?: string;
    channelId?: string;
    fromDate?: string;
    toDate?: string;
    page?: number;
    pageSize?: number;
  }) {
    const coopId = this.auth.getCoopId();
    const pageSize = Math.min(params.pageSize ?? 25, 100);
    const result = await this.registrationsService.findAll(coopId, {
      ...params,
      pageSize,
    });

    return JSON.stringify({
      items: result.items,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
    }, null, 2);
  }

  @Tool({
    name: 'get_registration',
    description: 'Get full details for a registration (transaction): payments, OGM code, certificate number, processing info, shareholder, share class, and project.',
    parameters: z.object({
      registrationId: z.string().describe('The registration ID'),
    }),
  })
  async getRegistration({ registrationId }: { registrationId: string }) {
    const coopId = this.auth.getCoopId();
    const reg = await this.registrationsService.findById(registrationId, coopId);

    if (!reg) return JSON.stringify({ error: 'Registration not found' });

    return JSON.stringify(reg, null, 2);
  }
}
```

- [ ] **Step 4: Create analytics tools (5 tools)**

Create `apps/api/src/modules/mcp/tools/mcp-analytics.tools.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { McpAuthStore } from '../mcp-auth.store';
import { AnalyticsService } from '../../admin/analytics.service';
import { ReportsService } from '../../admin/reports.service';

const periodEnum = z.enum(['day', 'month', 'quarter', 'year']).default('month');
const dateRange = {
  from: z.string().optional().describe('Start date (ISO format, e.g. "2026-01-01")'),
  to: z.string().optional().describe('End date (ISO format, e.g. "2026-12-31")'),
};

@Injectable()
export class McpAnalyticsTools {
  constructor(
    private readonly auth: McpAuthStore,
    private readonly analyticsService: AnalyticsService,
    private readonly reportsService: ReportsService,
  ) {}

  @Tool({
    name: 'get_capital_timeline',
    description: 'Capital raised over time as a time series. Returns date, cumulative total capital, and net change per period.',
    parameters: z.object({
      bucket: periodEnum.describe('Time bucket size (default: month)'),
      ...dateRange,
    }),
  })
  async getCapitalTimeline({ bucket, from, to }: { bucket: string; from?: string; to?: string }) {
    const coopId = this.auth.getCoopId();
    const result = await this.analyticsService.getCapitalTimeline(
      coopId,
      bucket as 'day' | 'month' | 'quarter' | 'year',
      from,
      to,
    );
    return JSON.stringify(result, null, 2);
  }

  @Tool({
    name: 'get_capital_by_project',
    description: 'Capital breakdown by project. Returns project name, total capital, share count, and percentage of total.',
    parameters: z.object({ ...dateRange }),
  })
  async getCapitalByProject({ from, to }: { from?: string; to?: string }) {
    const coopId = this.auth.getCoopId();
    const result = await this.analyticsService.getCapitalByProject(coopId, from, to);
    return JSON.stringify(result, null, 2);
  }

  @Tool({
    name: 'get_shareholder_growth',
    description: 'Shareholder joins and exits over time. Returns counts by type (individual, company, minor), exits, and cumulative total.',
    parameters: z.object({
      bucket: periodEnum.describe('Time bucket size (default: month)'),
      ...dateRange,
    }),
  })
  async getShareholderGrowth({ bucket, from, to }: { bucket: string; from?: string; to?: string }) {
    const coopId = this.auth.getCoopId();
    const result = await this.analyticsService.getShareholderGrowth(
      coopId,
      bucket as 'day' | 'month' | 'quarter' | 'year',
      from,
      to,
    );
    return JSON.stringify(result, null, 2);
  }

  @Tool({
    name: 'get_transaction_summary',
    description: 'Buy/sell transaction counts and volume over time. Returns timeline of buys, sells, and volume per period, plus totals.',
    parameters: z.object({
      bucket: periodEnum.describe('Time bucket size (default: month)'),
      ...dateRange,
    }),
  })
  async getTransactionSummary({ bucket, from, to }: { bucket: string; from?: string; to?: string }) {
    const coopId = this.auth.getCoopId();
    const result = await this.analyticsService.getTransactionSummary(
      coopId,
      bucket as 'day' | 'month' | 'quarter' | 'year',
      from,
      to,
    );
    return JSON.stringify(result, null, 2);
  }

  @Tool({
    name: 'get_annual_overview',
    description: 'Year-end report: capital start/end, shareholders start/end, purchases, sales, dividends (gross/net), per-share-class breakdown, and monthly capital by project.',
    parameters: z.object({
      year: z.number().describe('The year to report on (e.g. 2025)'),
    }),
  })
  async getAnnualOverview({ year }: { year: number }) {
    const coopId = this.auth.getCoopId();
    const result = await this.reportsService.getAnnualOverview(coopId, year);
    return JSON.stringify(result, null, 2);
  }
}
```

- [ ] **Step 5: Register all tool classes in McpToolsModule**

Update `apps/api/src/modules/mcp/mcp.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { McpAuthStore } from './mcp-auth.store';
import { McpCoopTools } from './tools/mcp-coop.tools';
import { McpShareholderTools } from './tools/mcp-shareholder.tools';
import { McpTransactionTools } from './tools/mcp-transaction.tools';
import { McpAnalyticsTools } from './tools/mcp-analytics.tools';
import { ShareholdersModule } from '../shareholders/shareholders.module';
import { RegistrationsModule } from '../registrations/registrations.module';

@Module({
  imports: [ShareholdersModule, RegistrationsModule],
  providers: [
    McpAuthStore,
    McpCoopTools,
    McpShareholderTools,
    McpTransactionTools,
    McpAnalyticsTools,
  ],
  exports: [McpAuthStore],
})
export class McpToolsModule {}
```

Note: `AnalyticsService` and `ReportsService` may need to be imported too. Check if they're provided by a module that's already globally available. If not, import the admin module or provide the services. Look at where the admin controller imports them from and follow the same pattern. You may need to create a shared `AdminServicesModule` or simply add `AnalyticsService` and `ReportsService` as direct providers in `McpToolsModule` (with `PrismaService` they depend on).

- [ ] **Step 6: Update McpModule.forRoot instructions in AppModule**

In `apps/api/src/app.module.ts`, update the `McpModule.forRoot()` config:

```typescript
McpModule.forRoot({
  name: 'opencoop',
  version: '1.0.0',
  instructions:
    'OpenCoop admin API — query your cooperative\'s shareholders, transactions, analytics, and more. Authenticated via API key.',
  transport: McpTransportType.STREAMABLE_HTTP,
  capabilities: {
    tools: {},
  },
  streamableHttp: {
    sessionIdGenerator: () => randomUUID(),
  },
}),
```

- [ ] **Step 7: Verify build**

Run: `pnpm build --filter=api`
Expected: Build succeeds. Fix any import issues (services not exported from their modules, etc.)

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/mcp/
git commit -m "feat: add 13 admin MCP tools for coop data querying"
```

---

## Task 7: Key Management REST Endpoints

**Files:**
- Modify: `apps/api/src/modules/api-keys/api-keys.controller.ts`

- [ ] **Step 1: Implement the API keys controller**

Replace the placeholder in `apps/api/src/modules/api-keys/api-keys.controller.ts`:

```typescript
import { Controller, Get, Post, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CoopGuard } from '../../common/guards/coop.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserData } from '../../common/decorators/current-user.decorator';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';

@ApiTags('API Keys')
@Controller('admin/coops/:coopId/api-keys')
@UseGuards(JwtAuthGuard, RolesGuard, CoopGuard)
@Roles('SYSTEM_ADMIN', 'COOP_ADMIN')
@ApiBearerAuth()
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Get()
  @ApiOperation({ summary: 'List your API keys for this coop (system admins see all)' })
  async list(
    @Param('coopId') coopId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.apiKeysService.findByUser(user.id, coopId, user.role === 'SYSTEM_ADMIN');
  }

  @Post()
  @ApiOperation({ summary: 'Create a new API key — the raw key is returned once' })
  async create(
    @Param('coopId') coopId: string,
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateApiKeyDto,
  ) {
    return this.apiKeysService.create(user.id, coopId, dto.name);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Revoke an API key (system admins can revoke any)' })
  async revoke(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    await this.apiKeysService.revoke(id, user.id, user.role === 'SYSTEM_ADMIN');
    return { success: true };
  }
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm build --filter=api`
Expected: Build succeeds

- [ ] **Step 3: Verify endpoints via Swagger**

Start the API: `cd /Users/wouterhermans/Developer/opencoop && pnpm dev --filter=api`
Open: `http://localhost:3001/api/docs`
Expected: "API Keys" section appears with 3 endpoints

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/api-keys/api-keys.controller.ts
git commit -m "feat: add REST endpoints for API key management"
```

---

## Task 8: Dashboard UI + i18n

**Files:**
- Modify: `apps/web/src/app/[locale]/dashboard/admin/settings/page.tsx`
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/nl.json`
- Modify: `apps/web/messages/fr.json`
- Modify: `apps/web/messages/de.json`

- [ ] **Step 1: Add i18n translations (English)**

In `apps/web/messages/en.json`, add to the `admin.settings` section:

```json
"apiKeys": {
  "title": "AI API Keys",
  "description": "Create API keys to connect Claude or other AI assistants to your cooperative's data via MCP.",
  "create": "Create API Key",
  "name": "Key Name",
  "namePlaceholder": "e.g. Claude Code - laptop",
  "prefix": "Key",
  "createdAt": "Created",
  "lastUsed": "Last Used",
  "never": "Never",
  "revoke": "Revoke",
  "revokeConfirm": "Are you sure you want to revoke this API key? Any tools using it will stop working.",
  "noKeys": "No API keys yet. Create one to connect AI assistants to your cooperative's data.",
  "created": "API key created",
  "createdWarning": "Copy this key now — it won't be shown again.",
  "copied": "Copied!",
  "copyKey": "Copy Key",
  "copyConfig": "Copy Claude Config",
  "claudeConfig": "Claude MCP Configuration",
  "revoked": "API key revoked"
}
```

- [ ] **Step 2: Add i18n translations (Dutch)**

In `apps/web/messages/nl.json`, add to the `admin.settings` section:

```json
"apiKeys": {
  "title": "AI API-sleutels",
  "description": "Maak API-sleutels aan om Claude of andere AI-assistenten te verbinden met de gegevens van uw coöperatie via MCP.",
  "create": "API-sleutel aanmaken",
  "name": "Naam sleutel",
  "namePlaceholder": "bijv. Claude Code - laptop",
  "prefix": "Sleutel",
  "createdAt": "Aangemaakt",
  "lastUsed": "Laatst gebruikt",
  "never": "Nooit",
  "revoke": "Intrekken",
  "revokeConfirm": "Weet u zeker dat u deze API-sleutel wilt intrekken? Tools die deze sleutel gebruiken, werken niet meer.",
  "noKeys": "Nog geen API-sleutels. Maak er een aan om AI-assistenten te verbinden met de gegevens van uw coöperatie.",
  "created": "API-sleutel aangemaakt",
  "createdWarning": "Kopieer deze sleutel nu — hij wordt niet opnieuw getoond.",
  "copied": "Gekopieerd!",
  "copyKey": "Sleutel kopiëren",
  "copyConfig": "Claude-configuratie kopiëren",
  "claudeConfig": "Claude MCP-configuratie",
  "revoked": "API-sleutel ingetrokken"
}
```

- [ ] **Step 3: Add i18n translations (French)**

In `apps/web/messages/fr.json`, add to the `admin.settings` section:

```json
"apiKeys": {
  "title": "Clés API IA",
  "description": "Créez des clés API pour connecter Claude ou d'autres assistants IA aux données de votre coopérative via MCP.",
  "create": "Créer une clé API",
  "name": "Nom de la clé",
  "namePlaceholder": "ex. Claude Code - laptop",
  "prefix": "Clé",
  "createdAt": "Créée le",
  "lastUsed": "Dernière utilisation",
  "never": "Jamais",
  "revoke": "Révoquer",
  "revokeConfirm": "Êtes-vous sûr de vouloir révoquer cette clé API ? Les outils qui l'utilisent cesseront de fonctionner.",
  "noKeys": "Aucune clé API pour le moment. Créez-en une pour connecter des assistants IA aux données de votre coopérative.",
  "created": "Clé API créée",
  "createdWarning": "Copiez cette clé maintenant — elle ne sera plus affichée.",
  "copied": "Copié !",
  "copyKey": "Copier la clé",
  "copyConfig": "Copier la config Claude",
  "claudeConfig": "Configuration MCP Claude",
  "revoked": "Clé API révoquée"
}
```

- [ ] **Step 4: Add i18n translations (German)**

In `apps/web/messages/de.json`, add to the `admin.settings` section:

```json
"apiKeys": {
  "title": "KI-API-Schlüssel",
  "description": "Erstellen Sie API-Schlüssel, um Claude oder andere KI-Assistenten über MCP mit den Daten Ihrer Genossenschaft zu verbinden.",
  "create": "API-Schlüssel erstellen",
  "name": "Schlüsselname",
  "namePlaceholder": "z.B. Claude Code - Laptop",
  "prefix": "Schlüssel",
  "createdAt": "Erstellt",
  "lastUsed": "Zuletzt verwendet",
  "never": "Nie",
  "revoke": "Widerrufen",
  "revokeConfirm": "Sind Sie sicher, dass Sie diesen API-Schlüssel widerrufen möchten? Tools, die ihn verwenden, funktionieren nicht mehr.",
  "noKeys": "Noch keine API-Schlüssel. Erstellen Sie einen, um KI-Assistenten mit den Daten Ihrer Genossenschaft zu verbinden.",
  "created": "API-Schlüssel erstellt",
  "createdWarning": "Kopieren Sie diesen Schlüssel jetzt — er wird nicht erneut angezeigt.",
  "copied": "Kopiert!",
  "copyKey": "Schlüssel kopieren",
  "copyConfig": "Claude-Konfiguration kopieren",
  "claudeConfig": "Claude MCP-Konfiguration",
  "revoked": "API-Schlüssel widerrufen"
}
```

- [ ] **Step 5: Add API keys UI section to settings page**

In `apps/web/src/app/[locale]/dashboard/admin/settings/page.tsx`, add the API keys section. This should be added as a new section in the settings page, after the existing sections. The section needs:

**State variables** (add near other state declarations):

```typescript
const [apiKeysList, setApiKeysList] = useState<Array<{
  id: string;
  prefix: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}>>([]);
const [showCreateKeyDialog, setShowCreateKeyDialog] = useState(false);
const [newKeyName, setNewKeyName] = useState('');
const [newlyCreatedKey, setNewlyCreatedKey] = useState('');
const [keyCopied, setKeyCopied] = useState(false);
const [configCopied, setConfigCopied] = useState(false);
const [keyToRevoke, setKeyToRevoke] = useState<string | null>(null);
```

**Load keys** (add to the existing useEffect that loads settings):

```typescript
api<Array<{ id: string; prefix: string; name: string; createdAt: string; lastUsedAt: string | null }>>(
  `/admin/coops/${selectedCoop.id}/api-keys`
).then(setApiKeysList).catch(() => {});
```

**Handlers:**

```typescript
const handleCreateApiKey = async () => {
  if (!selectedCoop || !newKeyName.trim()) return;
  try {
    const result = await api<{ rawKey: string; id: string; prefix: string; name: string; createdAt: string }>(
      `/admin/coops/${selectedCoop.id}/api-keys`,
      { method: 'POST', body: { name: newKeyName.trim() } },
    );
    setNewlyCreatedKey(result.rawKey);
    setApiKeysList(prev => [{ id: result.id, prefix: result.prefix, name: result.name, createdAt: result.createdAt, lastUsedAt: null }, ...prev]);
    setNewKeyName('');
  } catch {
    setError(t('admin.settings.error'));
  }
};

const handleRevokeApiKey = async (keyId: string) => {
  if (!selectedCoop) return;
  setKeyToRevoke(null);
  try {
    await api(`/admin/coops/${selectedCoop.id}/api-keys/${keyId}`, { method: 'DELETE' });
    setApiKeysList(prev => prev.filter(k => k.id !== keyId));
  } catch {
    setError(t('admin.settings.error'));
  }
};

const getMcpConfigSnippet = (key: string) => JSON.stringify({
  mcpServers: {
    opencoop: {
      type: 'streamablehttp',
      url: `https://${window.location.hostname === 'localhost' ? 'localhost:3001' : window.location.hostname.replace('acc.', 'acc.').replace(/^/, '') + '/api'}/mcp`,
      headers: { Authorization: `Bearer ${key}` },
    },
  },
}, null, 2);
```

**UI section** (add as a new card/section in the page JSX):

Build a section with:
1. Title + description from i18n
2. "Create API Key" button
3. Table of existing keys (prefix, name, created, last used, revoke button)
4. Create dialog: name input → submit → show raw key + copy button + Claude config snippet
5. Revoke confirmation dialog

Follow the exact same UI component patterns used elsewhere in this settings page (Card, Dialog, Button, Input from `components/ui/`). Look at the existing EcoPower API key dialog (`showApiKeyDialog` / `handleRegenerateApiKey`) as a reference for the copy-key-once dialog pattern.

- [ ] **Step 6: Verify the UI**

Run: `pnpm dev`
Navigate to dashboard → admin settings
Expected: "AI API Keys" section appears, can create/copy/revoke keys

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/[locale]/dashboard/admin/settings/page.tsx apps/web/messages/
git commit -m "feat: add API key management UI and i18n translations"
```

---

## Task 9: End-to-End Verification

- [ ] **Step 1: Start the dev environment**

Run: `pnpm dev`
Ensure both API (port 3001) and web (port 3002) are running.

- [ ] **Step 2: Create an API key via the dashboard**

1. Log in as a coop admin
2. Go to Settings
3. Create a new API key, copy the raw key

- [ ] **Step 3: Test MCP endpoint with curl**

```bash
curl -X POST http://localhost:3001/mcp \
  -H "Authorization: Bearer oc_YOUR_KEY_HERE" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Expected: JSON response listing all 13 tools

- [ ] **Step 4: Test a tool call**

```bash
curl -X POST http://localhost:3001/mcp \
  -H "Authorization: Bearer oc_YOUR_KEY_HERE" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_coop_stats","arguments":{}}}'
```

Expected: JSON response with coop stats

- [ ] **Step 5: Test auth rejection**

```bash
curl -X POST http://localhost:3001/mcp \
  -H "Authorization: Bearer oc_invalid_key" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Expected: 401 Unauthorized

- [ ] **Step 6: Test with Claude**

Add the MCP server to your Claude config using the snippet from the dashboard. Verify Claude can list tools and query data.

- [ ] **Step 7: Final commit**

If any fixes were needed during verification, commit them:

```bash
git add -A
git commit -m "fix: adjustments from end-to-end MCP verification"
```
