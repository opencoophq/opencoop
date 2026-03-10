# Ecopower Integration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow coops to track Ecopower client status on shareholders, block share sales that would drop Ecopower clients below a configurable threshold, and expose an external API for batch querying/updating.

**Architecture:** Ecopower settings live on the Coop model, client status on Shareholder. A new `ExternalApiModule` handles API-key-authenticated batch endpoints. Exit guards are added to `createSell` and `createTransfer` in the existing RegistrationsService.

**Tech Stack:** NestJS, Prisma, bcrypt, @nestjs/throttler, Next.js App Router, React Hook Form, Zod, next-intl

**Spec:** `docs/superpowers/specs/2026-03-10-ecopower-integration-design.md`

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `apps/api/src/modules/external-api/external-api.module.ts` | Module for external API endpoints |
| `apps/api/src/modules/external-api/external-api.controller.ts` | Controller: batch query + batch update |
| `apps/api/src/modules/external-api/external-api.service.ts` | Service: shareholder lookup, ecopower update logic |
| `apps/api/src/modules/external-api/dto/query-shareholders.dto.ts` | DTO for batch query |
| `apps/api/src/modules/external-api/dto/update-ecopower.dto.ts` | DTO for batch ecopower update |
| `apps/api/src/common/guards/api-key.guard.ts` | Guard: resolves coop from hashed API key |
| `apps/api/src/modules/external-api/api-key-throttle.guard.ts` | Custom throttle guard keyed by coop ID instead of IP |
| `apps/api/src/modules/external-api/external-api.service.spec.ts` | Tests for external API service |

### Modified files
| File | Changes |
|------|---------|
| `packages/database/prisma/schema.prisma` | Add `EcoPowerThresholdType` enum, Coop fields, Shareholder fields |
| `apps/api/src/modules/coops/dto/update-coop.dto.ts` | Add ecopower setting fields |
| `apps/api/src/modules/coops/coops.service.ts` | Add `getSettings` select fields, `generateApiKey`, `regenerateApiKey` methods |
| `apps/api/src/modules/shareholders/dto/update-shareholder.dto.ts` | Add `isEcoPowerClient`, `ecoPowerId` |
| `apps/api/src/modules/registrations/registrations.service.ts` | Add ecopower exit guard to `createSell` and `createTransfer` |
| `apps/api/src/modules/admin/admin.controller.ts` | Add `regenerateApiKey` endpoint |
| `apps/api/src/app.module.ts` | Import `ExternalApiModule` |
| `apps/web/src/app/[locale]/dashboard/admin/settings/page.tsx` | Add Ecopower settings section |
| `apps/web/src/app/[locale]/dashboard/admin/shareholders/[id]/page.tsx` | Add Ecopower fields |
| `apps/web/src/app/[locale]/dashboard/admin/shareholders/page.tsx` | Add Ecopower column/filter |
| `apps/web/messages/en.json` | Add Ecopower translation keys |
| `apps/web/messages/nl.json` | Add Ecopower translation keys |
| `apps/web/messages/fr.json` | Add Ecopower translation keys |
| `apps/web/messages/de.json` | Add Ecopower translation keys |

---

## Chunk 1: Database & Backend Core

### Task 1: Prisma Schema Changes

**Files:**
- Modify: `packages/database/prisma/schema.prisma`

- [ ] **Step 1: Add EcoPowerThresholdType enum**

After the existing enums (find `enum CoopPlan`), add:

```prisma
enum EcoPowerThresholdType {
  EURO
  SHARES
}
```

- [ ] **Step 2: Add Ecopower fields to Coop model**

In the `model Coop` block, after the `autoMatchPayments` line (~line 117), add:

```prisma
  // Ecopower integration
  ecoPowerEnabled          Boolean               @default(false)
  ecoPowerMinThresholdType EcoPowerThresholdType?
  ecoPowerMinThreshold     Decimal?              @db.Decimal(10, 2)
  apiKeyHash               String?               @unique
  apiKeyPrefix             String?
```

- [ ] **Step 3: Add Ecopower fields to Shareholder model**

In the `model Shareholder` block, after the `emailReminderSentAt` line (~line 379), add:

```prisma
  // Ecopower client tracking
  isEcoPowerClient Boolean @default(false)
  ecoPowerId       String?
```

- [ ] **Step 4: Generate Prisma client and push schema**

Run:
```bash
cd /Users/wouterhermans/Developer/opencoop/.claude/worktrees/ecopower-shareholder
pnpm db:generate && pnpm db:push
```

Expected: Prisma client regenerated, schema pushed successfully.

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma/schema.prisma
git commit -m "feat(db): add Ecopower integration fields to Coop and Shareholder models"
```

---

### Task 2: Update Coop Settings DTOs and Service

**Files:**
- Modify: `apps/api/src/modules/coops/dto/update-coop.dto.ts`
- Modify: `apps/api/src/modules/coops/coops.service.ts`

- [ ] **Step 1: Add Ecopower fields to UpdateCoopDto**

In `apps/api/src/modules/coops/dto/update-coop.dto.ts`, add these imports to the existing import from `class-validator`:

```typescript
IsNumber, IsEnum
```

Add imports:

```typescript
import { EcoPowerThresholdType } from '@opencoop/database';
import { ValidateIf } from 'class-validator';
```

(Add `IsNumber, IsEnum` to the existing `class-validator` import, and `ValidateIf` if not already present.)

Add these fields at the end of the class (before the closing `}`):

```typescript
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  ecoPowerEnabled?: boolean;

  @ApiProperty({ required: false, enum: EcoPowerThresholdType })
  @IsOptional()
  @IsEnum(EcoPowerThresholdType)
  ecoPowerMinThresholdType?: EcoPowerThresholdType | null;

  @ApiProperty({ required: false, description: 'Minimum threshold value (euro amount or share count)' })
  @IsOptional()
  @ValidateIf((o) => o.ecoPowerMinThreshold !== null)
  @IsNumber()
  ecoPowerMinThreshold?: number | null;
```

**Note:** `@ValidateIf` is needed because `@IsNumber()` rejects `null`. When disabling Ecopower, the frontend sends `null` to clear the threshold.

- [ ] **Step 2: Add Ecopower fields to getSettings select**

In `apps/api/src/modules/coops/coops.service.ts`, in the `getSettings` method (~line 318), add to the `select` object after `autoMatchPayments: true`:

```typescript
        ecoPowerEnabled: true,
        ecoPowerMinThresholdType: true,
        ecoPowerMinThreshold: true,
        apiKeyPrefix: true,
```

- [ ] **Step 3: Add generateApiKey method to CoopsService**

In `apps/api/src/modules/coops/coops.service.ts`, add import at top:

```typescript
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
```

Add method at the end of the class:

```typescript
  async regenerateApiKey(coopId: string, actorId?: string, ip?: string, userAgent?: string) {
    const coop = await this.prisma.coop.findUnique({ where: { id: coopId } });
    if (!coop) throw new NotFoundException('Cooperative not found');

    const rawKey = randomBytes(32).toString('hex');
    const prefix = rawKey.substring(0, 8);
    const hash = await bcrypt.hash(rawKey, 10);

    await this.prisma.coop.update({
      where: { id: coopId },
      data: { apiKeyHash: hash, apiKeyPrefix: prefix },
    });

    await this.auditService.log({
      coopId,
      entity: 'Coop',
      entityId: coopId,
      action: 'UPDATE',
      changes: [{ field: 'apiKey', from: coop.apiKeyHash ? '(regenerated)' : '(none)', to: '(new key)' }],
      actorId,
      ipAddress: ip,
      userAgent,
    });

    return { apiKey: rawKey, prefix };
  }

  async findByApiKey(rawKey: string) {
    // Use the key prefix (first 8 chars) to narrow down candidates before bcrypt compare
    const prefix = rawKey.substring(0, 8);
    const candidates = await this.prisma.coop.findMany({
      where: { apiKeyPrefix: prefix },
      select: { id: true, apiKeyHash: true, ecoPowerEnabled: true, ecoPowerMinThresholdType: true, ecoPowerMinThreshold: true },
    });

    for (const coop of candidates) {
      if (coop.apiKeyHash && await bcrypt.compare(rawKey, coop.apiKeyHash)) {
        return coop;
      }
    }
    return null;
  }
```

- [ ] **Step 4: Add regenerateApiKey endpoint to AdminController**

In `apps/api/src/modules/admin/admin.controller.ts`, add after the `updateSettings` method (~line 106):

```typescript
  @Post('api-key/regenerate')
  @RequirePermission('canManageSettings')
  @ApiOperation({ summary: 'Generate or regenerate API key for external integrations' })
  async regenerateApiKey(
    @Param('coopId') coopId: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.coopsService.regenerateApiKey(coopId, user.id, req.ip, req.headers['user-agent']);
  }
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/coops/dto/update-coop.dto.ts apps/api/src/modules/coops/coops.service.ts apps/api/src/modules/admin/admin.controller.ts
git commit -m "feat(api): add Ecopower coop settings and API key management"
```

---

### Task 3: Update Shareholder DTOs

**Files:**
- Modify: `apps/api/src/modules/shareholders/dto/update-shareholder.dto.ts`

- [ ] **Step 1: Add Ecopower fields to UpdateShareholderDto**

In `apps/api/src/modules/shareholders/dto/update-shareholder.dto.ts`, add `IsBoolean, IsString` to the imports from `class-validator` and add these fields:

```typescript
export class UpdateShareholderDto extends PartialType(CreateShareholderDto) {
  @IsOptional()
  @IsEnum(ShareholderStatus)
  status?: ShareholderStatus;

  @IsOptional()
  @IsBoolean()
  isEcoPowerClient?: boolean;

  @IsOptional()
  @IsString()
  ecoPowerId?: string | null;
}
```

- [ ] **Step 2: Add validation in shareholders.service.ts update method**

In `apps/api/src/modules/shareholders/shareholders.service.ts`, in the `update` method (~line 171), add a check before the Prisma update. After the email uniqueness check (~line 185):

```typescript
    // Reject Ecopower fields if the feature is disabled for this coop
    if (dto.isEcoPowerClient !== undefined || dto.ecoPowerId !== undefined) {
      const coop = await this.prisma.coop.findUnique({ where: { id: coopId }, select: { ecoPowerEnabled: true } });
      if (!coop?.ecoPowerEnabled) {
        throw new BadRequestException('Ecopower integration is not enabled for this cooperative');
      }
    }
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/shareholders/dto/update-shareholder.dto.ts
git commit -m "feat(api): add Ecopower fields to UpdateShareholderDto"
```

---

### Task 4: API Key Guard

**Files:**
- Create: `apps/api/src/common/guards/api-key.guard.ts`

- [ ] **Step 1: Create the API key guard**

```typescript
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { CoopsService } from '../../modules/coops/coops.service';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private coopsService: CoopsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid API key');
    }

    const rawKey = authHeader.substring(7);
    const coop = await this.coopsService.findByApiKey(rawKey);

    if (!coop) {
      throw new UnauthorizedException('Invalid API key');
    }

    // Attach coop to request for downstream use
    request.coop = coop;
    return true;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/common/guards/api-key.guard.ts
git commit -m "feat(api): add API key authentication guard"
```

---

### Task 5: External API Module — Batch Query

**Files:**
- Create: `apps/api/src/modules/external-api/dto/query-shareholders.dto.ts`
- Create: `apps/api/src/modules/external-api/external-api.service.ts`
- Create: `apps/api/src/modules/external-api/external-api.controller.ts`
- Create: `apps/api/src/modules/external-api/external-api.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Create query DTO**

Create `apps/api/src/modules/external-api/dto/query-shareholders.dto.ts`:

```typescript
import { IsArray, IsEmail, ValidateNested, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

class ShareholderQueryItem {
  @ApiProperty()
  @IsEmail()
  email: string;
}

export class QueryShareholdersDto {
  @ApiProperty({ type: [ShareholderQueryItem] })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ShareholderQueryItem)
  shareholders: ShareholderQueryItem[];
}
```

- [ ] **Step 2: Create external API service**

Create `apps/api/src/modules/external-api/external-api.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { computeTotalPaid, computeVestedShares } from '@opencoop/shared';

@Injectable()
export class ExternalApiService {
  constructor(private prisma: PrismaService) {}

  async queryShareholders(coopId: string, emails: string[]) {
    const shareholders = await this.prisma.shareholder.findMany({
      where: {
        coopId,
        email: { in: emails },
      },
      select: {
        email: true,
        firstName: true,
        lastName: true,
        companyName: true,
        type: true,
        isEcoPowerClient: true,
        ecoPowerId: true,
        registrations: {
          where: {
            status: { in: ['ACTIVE', 'COMPLETED', 'PENDING_PAYMENT'] },
          },
          select: {
            type: true,
            quantity: true,
            pricePerShare: true,
            status: true,
            payments: { select: { amount: true } },
          },
        },
      },
    });

    const shareholderMap = new Map(shareholders.map((s) => [s.email, s]));

    return emails.map((email) => {
      const sh = shareholderMap.get(email);
      if (!sh) return { email, found: false };

      let totalShares = 0;
      let totalShareValue = 0;

      for (const reg of sh.registrations) {
        const pricePerShare = Number(reg.pricePerShare);
        if (reg.type === 'BUY') {
          const paid = computeTotalPaid(reg.payments);
          const vested = computeVestedShares(paid, pricePerShare, reg.quantity);
          totalShares += vested;
          totalShareValue += vested * pricePerShare;
        } else if (reg.type === 'SELL') {
          totalShares -= reg.quantity;
          totalShareValue -= reg.quantity * pricePerShare;
        }
      }

      return {
        email,
        found: true,
        firstName: sh.firstName,
        lastName: sh.lastName,
        companyName: sh.companyName,
        type: sh.type,
        totalShares: Math.max(0, totalShares),
        totalShareValue: Math.max(0, totalShareValue),
        isEcoPowerClient: sh.isEcoPowerClient,
        ecoPowerId: sh.ecoPowerId,
      };
    });
  }

  async updateEcoPowerStatus(coopId: string, updates: { email: string; isEcoPowerClient: boolean; ecoPowerId?: string }[]) {
    const results = [];

    for (const update of updates) {
      const shareholder = await this.prisma.shareholder.findFirst({
        where: { coopId, email: update.email },
      });

      if (!shareholder) {
        results.push({ email: update.email, success: false, error: 'not found' });
        continue;
      }

      await this.prisma.shareholder.update({
        where: { id: shareholder.id },
        data: {
          isEcoPowerClient: update.isEcoPowerClient,
          ...(update.ecoPowerId !== undefined && { ecoPowerId: update.ecoPowerId }),
        },
      });

      results.push({ email: update.email, success: true });
    }

    return results;
  }
}
```

- [ ] **Step 3: Create update DTO**

Create `apps/api/src/modules/external-api/dto/update-ecopower.dto.ts`:

```typescript
import { IsArray, IsBoolean, IsEmail, IsOptional, IsString, ValidateNested, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

class EcoPowerUpdateItem {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsBoolean()
  isEcoPowerClient: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  ecoPowerId?: string;
}

export class UpdateEcoPowerDto {
  @ApiProperty({ type: [EcoPowerUpdateItem] })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => EcoPowerUpdateItem)
  updates: EcoPowerUpdateItem[];
}
```

- [ ] **Step 4: Create per-API-key throttle guard**

Create `apps/api/src/modules/external-api/api-key-throttle.guard.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Custom throttle guard that uses the coop ID (from API key) as the throttle key
 * instead of the request IP. This ensures rate limiting is per-API-key, not per-IP.
 * Limit: 60 requests per minute per API key.
 */
@Injectable()
export class ApiKeyThrottleGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.coop?.id || req.ip;
  }

  protected getThrottlerToken(): string {
    return 'api-key';
  }
}
```

- [ ] **Step 5: Create external API controller**

Create `apps/api/src/modules/external-api/external-api.controller.ts` (uses `ApiKeyThrottleGuard` from step 4):

```typescript
import { Controller, Post, Patch, Body, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { ApiKeyThrottleGuard } from './api-key-throttle.guard';
import { ExternalApiService } from './external-api.service';
import { QueryShareholdersDto } from './dto/query-shareholders.dto';
import { UpdateEcoPowerDto } from './dto/update-ecopower.dto';

@ApiTags('external')
@Controller('api/external')
@UseGuards(ApiKeyGuard, ApiKeyThrottleGuard)
@ApiBearerAuth()
@SkipThrottle() // Skip the global IP-based throttle; ApiKeyThrottleGuard handles per-key throttling
export class ExternalApiController {
  constructor(private externalApiService: ExternalApiService) {}

  @Post('shareholders/query')
  @ApiOperation({ summary: 'Batch query shareholders by email' })
  async queryShareholders(@Req() req: any, @Body() dto: QueryShareholdersDto) {
    const coopId = req.coop.id;
    const results = await this.externalApiService.queryShareholders(
      coopId,
      dto.shareholders.map((s) => s.email),
    );
    return { results };
  }

  @Patch('shareholders/ecopower')
  @ApiOperation({ summary: 'Batch update Ecopower client status' })
  async updateEcoPower(@Req() req: any, @Body() dto: UpdateEcoPowerDto) {
    const coopId = req.coop.id;
    const results = await this.externalApiService.updateEcoPowerStatus(coopId, dto.updates);
    return { results };
  }
}
```

- [ ] **Step 5: Create external API module**

Create `apps/api/src/modules/external-api/external-api.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ExternalApiController } from './external-api.controller';
import { ExternalApiService } from './external-api.service';
import { ApiKeyThrottleGuard } from './api-key-throttle.guard';
import { PrismaModule } from '../../prisma/prisma.module';
import { CoopsModule } from '../coops/coops.module';

@Module({
  imports: [PrismaModule, CoopsModule],
  controllers: [ExternalApiController],
  providers: [ExternalApiService, ApiKeyThrottleGuard],
})
export class ExternalApiModule {}
```

- [ ] **Step 6: Register ExternalApiModule in AppModule**

In `apps/api/src/app.module.ts`, add import:

```typescript
import { ExternalApiModule } from './modules/external-api/external-api.module';
```

Add `ExternalApiModule` to the imports array (after `LlmsModule`).

- [ ] **Step 7: Ensure CoopsService is exported from CoopsModule**

Check that `apps/api/src/modules/coops/coops.module.ts` exports `CoopsService`. If not, add it to `exports: [CoopsService]`.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/external-api/ apps/api/src/app.module.ts apps/api/src/modules/coops/coops.module.ts
git commit -m "feat(api): add external API module with batch query, Ecopower update, and per-key throttling"
```

---

### Task 6: Exit Guard in RegistrationsService

**Files:**
- Modify: `apps/api/src/modules/registrations/registrations.service.ts`

- [ ] **Step 1: Add private helper method for Ecopower exit check**

In `apps/api/src/modules/registrations/registrations.service.ts`, add this private method after the existing `getAvailableShares` method:

```typescript
  /**
   * Check if a share sale would drop an Ecopower client below the minimum threshold.
   * Throws BadRequestException if the sale would violate the Ecopower minimum.
   */
  private async checkEcoPowerThreshold(
    coopId: string,
    shareholderId: string,
    saleQuantity: number,
    salePricePerShare: number,
  ) {
    const shareholder = await this.prisma.shareholder.findUnique({
      where: { id: shareholderId },
      select: { isEcoPowerClient: true },
    });

    if (!shareholder?.isEcoPowerClient) return;

    const coop = await this.prisma.coop.findUnique({
      where: { id: coopId },
      select: { ecoPowerEnabled: true, ecoPowerMinThresholdType: true, ecoPowerMinThreshold: true },
    });

    if (!coop?.ecoPowerEnabled || !coop.ecoPowerMinThreshold) return;

    const threshold = Number(coop.ecoPowerMinThreshold);

    // Calculate current portfolio
    // BUY registrations: ACTIVE, COMPLETED, PENDING_PAYMENT (shares the shareholder owns)
    // SELL registrations: PENDING, ACTIVE, COMPLETED (shares already committed to selling)
    const registrations = await this.prisma.registration.findMany({
      where: {
        coopId,
        shareholderId,
        OR: [
          { type: 'BUY', status: { in: ['ACTIVE', 'COMPLETED', 'PENDING_PAYMENT'] } },
          { type: 'SELL', status: { in: ['PENDING', 'ACTIVE', 'COMPLETED'] } },
        ],
      },
      select: {
        type: true,
        quantity: true,
        pricePerShare: true,
        payments: { select: { amount: true } },
      },
    });

    let currentShares = 0;
    let currentValue = 0;

    for (const reg of registrations) {
      const price = Number(reg.pricePerShare);
      if (reg.type === 'BUY') {
        const paid = computeTotalPaid(reg.payments);
        const vested = computeVestedShares(paid, price, reg.quantity);
        currentShares += vested;
        currentValue += vested * price;
      } else if (reg.type === 'SELL') {
        currentShares -= reg.quantity;
        currentValue -= reg.quantity * price;
      }
    }

    const saleValue = saleQuantity * salePricePerShare;
    const projectedShares = currentShares - saleQuantity;
    const projectedValue = currentValue - saleValue;

    if (coop.ecoPowerMinThresholdType === 'EURO' && projectedValue < threshold) {
      throw new BadRequestException(
        `Cannot sell: shareholder is an Ecopower client and must maintain at least €${threshold}. ` +
        `Current: €${currentValue.toFixed(2)}, after sale: €${projectedValue.toFixed(2)}.`,
      );
    }

    if (coop.ecoPowerMinThresholdType === 'SHARES' && projectedShares < threshold) {
      throw new BadRequestException(
        `Cannot sell: shareholder is an Ecopower client and must maintain at least ${threshold} shares. ` +
        `Current: ${currentShares}, after sale: ${projectedShares}.`,
      );
    }
  }
```

- [ ] **Step 2: Add exit check to createSell**

In the `createSell` method (~line 289, after the `if (data.quantity > available)` check), add:

```typescript
    // Ecopower exit guard
    await this.checkEcoPowerThreshold(data.coopId, data.shareholderId, data.quantity, pricePerShare);
```

- [ ] **Step 3: Add exit check to createTransfer**

In the `createTransfer` method (~line 491, after the `if (data.quantity > available)` check), add:

```typescript
    // Ecopower exit guard (applies to from-shareholder only)
    await this.checkEcoPowerThreshold(data.coopId, data.fromShareholderId, data.quantity, pricePerShare);
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/registrations/registrations.service.ts
git commit -m "feat(api): add Ecopower exit guard to share sales and transfers"
```

---

### Task 7: External API Service Tests

**Files:**
- Create: `apps/api/src/modules/external-api/external-api.service.spec.ts`

- [ ] **Step 1: Write tests for queryShareholders**

Create `apps/api/src/modules/external-api/external-api.service.spec.ts`:

```typescript
jest.mock('@react-pdf/renderer', () => ({
  Document: 'Document',
  Page: 'Page',
  View: 'View',
  Text: 'Text',
  StyleSheet: { create: (s: any) => s },
  renderToBuffer: jest.fn(),
}));

import { Test } from '@nestjs/testing';
import { ExternalApiService } from './external-api.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ExternalApiService', () => {
  let service: ExternalApiService;

  const mockPrisma = {
    shareholder: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ExternalApiService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ExternalApiService>(ExternalApiService);
    jest.clearAllMocks();
  });

  describe('queryShareholders', () => {
    it('should return found:false for unknown emails', async () => {
      mockPrisma.shareholder.findMany.mockResolvedValue([]);

      const results = await service.queryShareholders('coop1', ['unknown@test.com']);

      expect(results).toEqual([{ email: 'unknown@test.com', found: false }]);
    });

    it('should return shareholder data with calculated share totals', async () => {
      mockPrisma.shareholder.findMany.mockResolvedValue([
        {
          email: 'jan@test.com',
          firstName: 'Jan',
          lastName: 'Peeters',
          companyName: null,
          type: 'INDIVIDUAL',
          isEcoPowerClient: true,
          ecoPowerId: '2079183',
          registrations: [
            {
              type: 'BUY',
              quantity: 10,
              pricePerShare: 25,
              status: 'COMPLETED',
              payments: [{ amount: 250 }],
            },
          ],
        },
      ]);

      const results = await service.queryShareholders('coop1', ['jan@test.com']);

      expect(results).toEqual([
        {
          email: 'jan@test.com',
          found: true,
          firstName: 'Jan',
          lastName: 'Peeters',
          companyName: null,
          type: 'INDIVIDUAL',
          totalShares: 10,
          totalShareValue: 250,
          isEcoPowerClient: true,
          ecoPowerId: '2079183',
        },
      ]);
    });

    it('should subtract sells from totals', async () => {
      mockPrisma.shareholder.findMany.mockResolvedValue([
        {
          email: 'jan@test.com',
          firstName: 'Jan',
          lastName: 'Peeters',
          companyName: null,
          type: 'INDIVIDUAL',
          isEcoPowerClient: false,
          ecoPowerId: null,
          registrations: [
            {
              type: 'BUY',
              quantity: 10,
              pricePerShare: 25,
              status: 'COMPLETED',
              payments: [{ amount: 250 }],
            },
            {
              type: 'SELL',
              quantity: 3,
              pricePerShare: 25,
              status: 'COMPLETED',
              payments: [],
            },
          ],
        },
      ]);

      const results = await service.queryShareholders('coop1', ['jan@test.com']);

      expect(results[0].totalShares).toBe(7);
      expect(results[0].totalShareValue).toBe(175);
    });
  });

  describe('updateEcoPowerStatus', () => {
    it('should return not found for unknown emails', async () => {
      mockPrisma.shareholder.findFirst.mockResolvedValue(null);

      const results = await service.updateEcoPowerStatus('coop1', [
        { email: 'unknown@test.com', isEcoPowerClient: true },
      ]);

      expect(results).toEqual([{ email: 'unknown@test.com', success: false, error: 'not found' }]);
    });

    it('should update Ecopower status and id', async () => {
      mockPrisma.shareholder.findFirst.mockResolvedValue({ id: 'sh1' });
      mockPrisma.shareholder.update.mockResolvedValue({});

      const results = await service.updateEcoPowerStatus('coop1', [
        { email: 'jan@test.com', isEcoPowerClient: true, ecoPowerId: '2079183' },
      ]);

      expect(results).toEqual([{ email: 'jan@test.com', success: true }]);
      expect(mockPrisma.shareholder.update).toHaveBeenCalledWith({
        where: { id: 'sh1' },
        data: { isEcoPowerClient: true, ecoPowerId: '2079183' },
      });
    });
  });
});
```

- [ ] **Step 2: Run tests**

Run:
```bash
cd /Users/wouterhermans/Developer/opencoop/.claude/worktrees/ecopower-shareholder/apps/api
pnpm test -- --testPathPattern=external-api
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/external-api/external-api.service.spec.ts
git commit -m "test(api): add tests for external API service"
```

---

## Chunk 2: Frontend

### Task 8: Translations

**Files:**
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/nl.json`
- Modify: `apps/web/messages/fr.json`
- Modify: `apps/web/messages/de.json`

- [ ] **Step 1: Add Ecopower keys to all 4 locale files**

Add the following keys under a new `"ecopower"` top-level key in each locale file.

**en.json:**
```json
"ecopower": {
  "title": "Ecopower Integration",
  "description": "Track shareholders with Ecopower energy contracts and enforce minimum shareholding requirements.",
  "enabled": "Enable Ecopower integration",
  "thresholdType": "Threshold type",
  "thresholdTypeEuro": "Euro amount",
  "thresholdTypeShares": "Number of shares",
  "thresholdValue": "Minimum threshold",
  "thresholdValueHintEuro": "Minimum shareholding in euros (e.g. 250)",
  "thresholdValueHintShares": "Minimum number of shares",
  "apiKey": "API Key",
  "apiKeyDescription": "Use this key to authenticate external scripts. The key is shown once — store it securely.",
  "regenerateApiKey": "Generate new API key",
  "regenerateConfirm": "This will invalidate the current API key. Any scripts using it will stop working. Continue?",
  "apiKeyCopied": "API key copied to clipboard. Store it securely — it won't be shown again.",
  "noApiKey": "No API key generated yet",
  "client": "Ecopower client",
  "ecoPowerId": "Ecopower ID",
  "ecoPowerIdPlaceholder": "e.g. 2079183",
  "filterEcoPowerClient": "Ecopower clients"
}
```

**nl.json:**
```json
"ecopower": {
  "title": "Ecopower-integratie",
  "description": "Volg aandeelhouders met een Ecopower-energiecontract op en handhaaf de minimale aandeelhoudervereisten.",
  "enabled": "Ecopower-integratie inschakelen",
  "thresholdType": "Drempeltype",
  "thresholdTypeEuro": "Eurobedrag",
  "thresholdTypeShares": "Aantal aandelen",
  "thresholdValue": "Minimumdrempel",
  "thresholdValueHintEuro": "Minimaal aandeelhouderschap in euro (bv. 250)",
  "thresholdValueHintShares": "Minimum aantal aandelen",
  "apiKey": "API-sleutel",
  "apiKeyDescription": "Gebruik deze sleutel om externe scripts te authenticeren. De sleutel wordt eenmalig getoond — bewaar hem veilig.",
  "regenerateApiKey": "Nieuwe API-sleutel genereren",
  "regenerateConfirm": "Dit maakt de huidige API-sleutel ongeldig. Scripts die deze gebruiken zullen stoppen met werken. Doorgaan?",
  "apiKeyCopied": "API-sleutel gekopieerd naar klembord. Bewaar hem veilig — hij wordt niet opnieuw getoond.",
  "noApiKey": "Nog geen API-sleutel gegenereerd",
  "client": "Ecopower-klant",
  "ecoPowerId": "Ecopower-ID",
  "ecoPowerIdPlaceholder": "bv. 2079183",
  "filterEcoPowerClient": "Ecopower-klanten"
}
```

**fr.json:**
```json
"ecopower": {
  "title": "Intégration Ecopower",
  "description": "Suivez les actionnaires ayant un contrat énergétique Ecopower et appliquez les exigences minimales de participation.",
  "enabled": "Activer l'intégration Ecopower",
  "thresholdType": "Type de seuil",
  "thresholdTypeEuro": "Montant en euros",
  "thresholdTypeShares": "Nombre d'actions",
  "thresholdValue": "Seuil minimum",
  "thresholdValueHintEuro": "Participation minimale en euros (ex. 250)",
  "thresholdValueHintShares": "Nombre minimum d'actions",
  "apiKey": "Clé API",
  "apiKeyDescription": "Utilisez cette clé pour authentifier les scripts externes. La clé n'est affichée qu'une seule fois — conservez-la en lieu sûr.",
  "regenerateApiKey": "Générer une nouvelle clé API",
  "regenerateConfirm": "Cela invalidera la clé API actuelle. Les scripts qui l'utilisent cesseront de fonctionner. Continuer ?",
  "apiKeyCopied": "Clé API copiée dans le presse-papiers. Conservez-la en lieu sûr — elle ne sera plus affichée.",
  "noApiKey": "Aucune clé API générée",
  "client": "Client Ecopower",
  "ecoPowerId": "ID Ecopower",
  "ecoPowerIdPlaceholder": "ex. 2079183",
  "filterEcoPowerClient": "Clients Ecopower"
}
```

**de.json:**
```json
"ecopower": {
  "title": "Ecopower-Integration",
  "description": "Verfolgen Sie Aktionäre mit Ecopower-Energieverträgen und setzen Sie Mindestbeteiligungsanforderungen durch.",
  "enabled": "Ecopower-Integration aktivieren",
  "thresholdType": "Schwellenwerttyp",
  "thresholdTypeEuro": "Eurobetrag",
  "thresholdTypeShares": "Anzahl der Aktien",
  "thresholdValue": "Mindestschwellenwert",
  "thresholdValueHintEuro": "Mindestbeteiligung in Euro (z.B. 250)",
  "thresholdValueHintShares": "Mindestanzahl an Aktien",
  "apiKey": "API-Schlüssel",
  "apiKeyDescription": "Verwenden Sie diesen Schlüssel zur Authentifizierung externer Skripte. Der Schlüssel wird nur einmal angezeigt — bewahren Sie ihn sicher auf.",
  "regenerateApiKey": "Neuen API-Schlüssel generieren",
  "regenerateConfirm": "Dadurch wird der aktuelle API-Schlüssel ungültig. Skripte, die ihn verwenden, funktionieren nicht mehr. Fortfahren?",
  "apiKeyCopied": "API-Schlüssel in die Zwischenablage kopiert. Bewahren Sie ihn sicher auf — er wird nicht erneut angezeigt.",
  "noApiKey": "Noch kein API-Schlüssel generiert",
  "client": "Ecopower-Kunde",
  "ecoPowerId": "Ecopower-ID",
  "ecoPowerIdPlaceholder": "z.B. 2079183",
  "filterEcoPowerClient": "Ecopower-Kunden"
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/messages/
git commit -m "feat(i18n): add Ecopower integration translations for all 4 locales"
```

---

### Task 9: Coop Settings Page — Ecopower Section

**Files:**
- Modify: `apps/web/src/app/[locale]/dashboard/admin/settings/page.tsx`

- [ ] **Step 1: Read the current settings page to understand its structure**

Read the full file first to understand form state, submit handler, and section layout.

- [ ] **Step 2: Add Ecopower fields to SettingsResponse and FormState interfaces**

Add to the `SettingsResponse` interface (lines 65-82):
```typescript
ecoPowerEnabled: boolean;
ecoPowerMinThresholdType: string | null;
ecoPowerMinThreshold: number | null;
apiKeyPrefix: string | null;
```

Add the same fields to the `FormState` interface (or equivalent form state type).

- [ ] **Step 3: Add Ecopower section to the form**

After the last settings Card, add a new Card for Ecopower. The section should contain:
- Toggle switch for `ecoPowerEnabled`
- When enabled: dropdown for threshold type (Euro / Shares), number input for threshold value
- API key section: display prefix with masked remainder if set, "Generate new API key" button
- The regenerate button should call `POST /admin/coops/:coopId/api-key/regenerate` and display the returned key once in a dialog with copy button

Implementation notes:
- Follow the same Card/CardHeader/CardContent pattern used by other sections
- Use `t('ecopower.title')` etc. for all labels
- The API key regeneration is a separate API call (not part of the settings save)
- Show a confirmation dialog before regenerating (invalidates existing key)
- After regeneration, show the new key in a dialog with copy-to-clipboard. Once dismissed, the key is gone.

- [ ] **Step 4: Include new settings in the save handler**

Ensure `ecoPowerEnabled`, `ecoPowerMinThresholdType`, and `ecoPowerMinThreshold` are included when submitting the settings form to `PUT /admin/coops/:coopId/settings`.

**Important:** When `ecoPowerEnabled` is false, set `ecoPowerMinThresholdType: null` and `ecoPowerMinThreshold: null` in the save body to clear these fields. The backend treats `null` as "clear the value" and omission as "preserve existing value".

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/[locale]/dashboard/admin/settings/page.tsx
git commit -m "feat(web): add Ecopower integration section to coop settings page"
```

---

### Task 10: Shareholder Detail Page — Ecopower Fields

**Files:**
- Modify: `apps/web/src/app/[locale]/dashboard/admin/shareholders/[id]/page.tsx`

- [ ] **Step 1: Read the current shareholder detail page**

Read the full file to understand form layout and how conditional fields work.

- [ ] **Step 2: Fetch coop settings to check ecoPowerEnabled**

The `AdminContext` does **not** include `ecoPowerEnabled`. Fetch it explicitly by calling `GET /admin/coops/:coopId/settings` at page mount (using `api()` helper) and store it in local component state. If the page already fetches data in a `useEffect` or `Promise.all`, add the settings fetch there to avoid an extra round trip.

- [ ] **Step 3: Add Ecopower fields section**

When `ecoPowerEnabled` is true, add a new section (Card) to the shareholder detail page:
- Checkbox: "Ecopower client" → `isEcoPowerClient`
- Text input: "Ecopower ID" → `ecoPowerId` (disabled when `isEcoPowerClient` is false)
- Labels from `t('ecopower.client')` and `t('ecopower.ecoPowerId')`

- [ ] **Step 4: Include Ecopower fields in the update handler**

Ensure `isEcoPowerClient` and `ecoPowerId` are included in the existing `PUT /admin/coops/:coopId/shareholders/:id` save call (the backend uses `PUT`, not `PATCH` — see `admin.controller.ts` line 324).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/[locale]/dashboard/admin/shareholders/[id]/page.tsx
git commit -m "feat(web): add Ecopower fields to shareholder detail page"
```

---

### Task 11: Shareholder List Page — Ecopower Column & Filter

**Files:**
- Modify: `apps/web/src/app/[locale]/dashboard/admin/shareholders/page.tsx`

- [ ] **Step 1: Read the current shareholder list page**

Read the full file to understand column definitions, filter logic, and the `ShareholderRow` interface.

- [ ] **Step 2: Fetch ecoPowerEnabled**

Same as Task 10: the `AdminContext` does not include `ecoPowerEnabled`. Fetch it from `GET /admin/coops/:coopId/settings` at page mount and store in local state.

- [ ] **Step 3: Add isEcoPowerClient to ShareholderRow interface**

Add `isEcoPowerClient?: boolean` to the `ShareholderRow` interface (lines 44-54 of the shareholders list page). Without this, the column cell renderer will always see `undefined`.

- [ ] **Step 4: Add Ecopower column**

When `ecoPowerEnabled` is true, add a column to the shareholder table:
- Header: `t('ecopower.client')`
- Cell: Show a badge/icon when `isEcoPowerClient` is true, empty when false

- [ ] **Step 5: Add Ecopower filter**

When `ecoPowerEnabled` is true, add a filter dropdown:
- Options: All / Ecopower clients only
- Filter key: `ecoPowerClient` (pass as query param to API)

- [ ] **Step 6: Add backend filter support**

In `apps/api/src/modules/shareholders/shareholders.service.ts`, in the `findAll` method, add support for the `ecoPowerClient` query param. After the existing `where` clause construction:

```typescript
if (ecoPowerClient === 'true') where.isEcoPowerClient = true;
```

Also add `isEcoPowerClient: true` to the `select` object so the field is returned in list responses.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/[locale]/dashboard/admin/shareholders/page.tsx apps/api/src/modules/shareholders/shareholders.service.ts
git commit -m "feat: add Ecopower column and filter to shareholder list"
```

---

### Task 12: Build Verification

- [ ] **Step 1: Run full build**

```bash
cd /Users/wouterhermans/Developer/opencoop/.claude/worktrees/ecopower-shareholder
pnpm build
```

Expected: Build succeeds with no errors.

- [ ] **Step 2: Run all API tests**

```bash
cd apps/api
pnpm test
```

Expected: All tests pass.

- [ ] **Step 3: Fix any issues and commit**

If there are build or test errors, fix them and commit the fixes.
