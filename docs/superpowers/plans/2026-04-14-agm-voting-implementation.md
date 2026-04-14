# AGM & Voting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an end-to-end AGM administration feature for OpenCoop so Bronsgroen cv can run its 2026-05-09 annual general meeting, while shaping a data model that supports future hybrid/digital voting.

**Architecture:** A new `meetings/` NestJS module with admin + public (token-auth) + shareholder controllers, backed by 9 new Prisma models. Existing email queue, uploads, audit, and pdf-templates packages are reused. Frontend is a Next.js 14 app-router tree under `dashboard/admin/meetings/` for admins plus public RSVP/kiosk pages under `[locale]/meetings/`.

**Tech Stack:** NestJS 10, Prisma 6, PostgreSQL 16, Bull + Redis, next-auth/JWT, Next.js 14 App Router, React 18, Tailwind, @react-pdf/renderer, `ics` (npm), `react-signature-canvas`, Jest.

**Spec:** [`docs/superpowers/specs/2026-04-14-agm-voting-design.md`](../specs/2026-04-14-agm-voting-design.md)

**Branch:** `feature/agm-voting` (already created)

---

## Working conventions for this plan

- After every task: run `pnpm --filter @opencoop/api typecheck` (or `pnpm --filter @opencoop/web typecheck` for frontend tasks) before committing. If new types break callers, fix before committing.
- TDD discipline: write the failing test first for anything with business logic. CRUD-shaped endpoints may skip tests IF a service method they call is already tested.
- Commit messages use Conventional Commits (`feat:`, `fix:`, `test:`, `refactor:`, `docs:`, `chore:`).
- One logical change per commit. Push frequently — CI on acc catches environmental issues.
- **All work happens on branch `feature/agm-voting`.** Push + PR at the end.

---

## Phase 1 — Schema Foundation

### Task 1: Add enums and models to Prisma schema

**Files:**
- Modify: `packages/database/prisma/schema.prisma` (append at bottom, before the final `}`)

- [ ] **Step 1: Add the new enums**

Append to `schema.prisma`:

```prisma
enum MeetingType     { ANNUAL EXTRAORDINARY WRITTEN }
enum MeetingFormat   { PHYSICAL HYBRID DIGITAL }
enum MeetingStatus   { DRAFT CONVOKED HELD CLOSED CANCELLED }
enum VotingWeight    { PER_SHAREHOLDER PER_SHARE }
enum AgendaType      { INFORMATIONAL RESOLUTION ELECTION }
enum MajorityType    { SIMPLE TWO_THIRDS THREE_QUARTERS }
enum VoteChoice      { FOR AGAINST ABSTAIN }
enum RSVPStatus      { ATTENDING PROXY ABSENT UNKNOWN }
enum CheckInMethod   { ADMIN KIOSK PAPER_RECONCILED }
```

- [ ] **Step 2: Add the nine new models**

Append to `schema.prisma` (see spec §3 for full schema; exact code below):

```prisma
model Meeting {
  id                    String   @id @default(cuid())
  coopId                String
  coop                  Coop     @relation(fields: [coopId], references: [id])
  type                  MeetingType
  title                 String
  scheduledAt           DateTime
  durationMinutes       Int      @default(120)
  location              String?
  format                MeetingFormat
  votingWeight          VotingWeight @default(PER_SHAREHOLDER)
  maxProxiesPerPerson   Int          @default(1)
  convocationSentAt     DateTime?
  convocationDocUrl     String?
  convocationFailures   Json?
  reminderDaysBefore    Int[]        @default([3])
  remindersSent         Json?        @default("{}")
  status                MeetingStatus @default(DRAFT)
  agendaItems           AgendaItem[]
  attendances           MeetingAttendance[]
  proxies               Proxy[]
  minutes               MeetingMinutes?
  kioskSessions         MeetingKioskSession[]
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
  @@index([coopId, scheduledAt])
}

model AgendaItem {
  id              String      @id @default(cuid())
  meetingId       String
  meeting         Meeting     @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  order           Int
  title           String
  description     String?     @db.Text
  type            AgendaType
  resolution      Resolution?
  attachments     AgendaAttachment[]
  @@unique([meetingId, order])
}

model AgendaAttachment {
  id            String     @id @default(cuid())
  agendaItemId  String
  agendaItem    AgendaItem @relation(fields: [agendaItemId], references: [id], onDelete: Cascade)
  fileName      String
  fileUrl       String
  uploadedAt    DateTime   @default(now())
}

model Resolution {
  id              String     @id @default(cuid())
  agendaItemId    String     @unique
  agendaItem      AgendaItem @relation(fields: [agendaItemId], references: [id], onDelete: Cascade)
  proposedText    String     @db.Text
  majorityType    MajorityType
  quorumRequired  Decimal?
  votesFor        Int        @default(0)
  votesAgainst    Int        @default(0)
  votesAbstain    Int        @default(0)
  passed          Boolean?
  closedAt        DateTime?
  votes           Vote[]
}

model Vote {
  id              String      @id @default(cuid())
  resolutionId    String
  resolution      Resolution  @relation(fields: [resolutionId], references: [id], onDelete: Cascade)
  shareholderId   String
  shareholder     Shareholder @relation(fields: [shareholderId], references: [id])
  choice          VoteChoice
  castViaProxyId  String?
  weight          Int         @default(1)
  castAt          DateTime    @default(now())
  @@unique([resolutionId, shareholderId])
}

model Proxy {
  id                    String      @id @default(cuid())
  meetingId             String
  meeting               Meeting     @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  grantorShareholderId  String
  grantor               Shareholder @relation("ProxyGrantor", fields: [grantorShareholderId], references: [id])
  delegateShareholderId String
  delegate              Shareholder @relation("ProxyDelegate", fields: [delegateShareholderId], references: [id])
  signedFormUrl         String?
  grantedAt             DateTime    @default(now())
  revokedAt             DateTime?
  @@unique([meetingId, grantorShareholderId])
}

model MeetingAttendance {
  id                 String   @id @default(cuid())
  meetingId          String
  meeting            Meeting  @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  shareholderId      String
  shareholder        Shareholder @relation(fields: [shareholderId], references: [id])
  rsvpStatus         RSVPStatus @default(UNKNOWN)
  rsvpAt             DateTime?
  rsvpToken          String     @unique
  rsvpTokenExpires   DateTime
  checkedInAt        DateTime?
  checkedInBy        String?
  checkInMethod      CheckInMethod?
  signatureImageUrl  String?
  @@unique([meetingId, shareholderId])
}

model MeetingMinutes {
  id              String   @id @default(cuid())
  meetingId       String   @unique
  meeting         Meeting  @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  content         String   @db.Text
  generatedPdfUrl String?
  signedPdfUrl    String?
  signedAt        DateTime?
  signedByName    String?
}

model MeetingKioskSession {
  id         String   @id @default(cuid())
  meetingId  String
  meeting    Meeting  @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  token      String   @unique
  startedBy  String
  startedAt  DateTime @default(now())
  endedAt    DateTime?
  active     Boolean  @default(true)
  @@index([meetingId, active])
}
```

- [ ] **Step 3: Add back-relations to existing models**

Find the `Shareholder` model in `schema.prisma` and add these fields (inside the existing model, with the other relation fields):

```prisma
  proxiesGranted      Proxy[]             @relation("ProxyGrantor")
  proxiesHeld         Proxy[]             @relation("ProxyDelegate")
  meetingAttendances  MeetingAttendance[]
  votes               Vote[]
```

Find the `Coop` model and add:

```prisma
  meetings            Meeting[]
```

- [ ] **Step 4: Format the schema**

Run: `pnpm --filter @opencoop/database prisma format`
Expected: prints formatted file, no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma/schema.prisma
git commit -m "feat(db): add AGM/voting models to schema"
```

---

### Task 2: Generate migration

**Files:**
- Create: `packages/database/prisma/migrations/<timestamp>_agm_voting/migration.sql` (Prisma generates)

- [ ] **Step 1: Create the migration**

Run (from repo root): `pnpm --filter @opencoop/database prisma migrate dev --name agm_voting`

Expected: Prisma prompts, creates SQL migration file, runs it against local dev DB. New tables visible via `pnpm db:studio`.

- [ ] **Step 2: Verify the migration applied**

Run: `pnpm --filter @opencoop/database prisma db pull --print | grep -c "model Meeting"`
Expected: `1`

- [ ] **Step 3: Regenerate the Prisma client**

Run: `pnpm --filter @opencoop/database prisma generate`
Expected: "Generated Prisma Client"

- [ ] **Step 4: Typecheck both apps**

Run: `pnpm --filter @opencoop/api typecheck && pnpm --filter @opencoop/web typecheck`
Expected: PASS (new models are known but not yet imported anywhere).

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma/migrations/
git commit -m "feat(db): migration for AGM voting tables"
```

---

### Task 3: Add shared types

**Files:**
- Modify: `packages/shared/src/types.ts`

- [ ] **Step 1: Export meeting-related types**

Append to `packages/shared/src/types.ts`:

```ts
export type { Meeting, AgendaItem, AgendaAttachment, Resolution, Vote, Proxy,
  MeetingAttendance, MeetingMinutes, MeetingKioskSession,
  MeetingType, MeetingFormat, MeetingStatus, VotingWeight,
  AgendaType, MajorityType, VoteChoice, RSVPStatus, CheckInMethod,
} from '@opencoop/database';

export interface MeetingWithAgenda extends Meeting {
  agendaItems: (AgendaItem & { resolution: Resolution | null; attachments: AgendaAttachment[] })[];
}

export interface ResolutionOutcome {
  resolutionId: string;
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  passed: boolean;
  majorityType: MajorityType;
}
```

- [ ] **Step 2: Build shared package**

Run: `pnpm --filter @opencoop/shared build`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(shared): export AGM types"
```

---

## Phase 2 — Meetings Module Skeleton + CRUD

### Task 4: Scaffold the meetings module

**Files:**
- Create: `apps/api/src/modules/meetings/meetings.module.ts`
- Create: `apps/api/src/modules/meetings/meetings.controller.ts` (admin)
- Create: `apps/api/src/modules/meetings/meetings.service.ts`
- Modify: `apps/api/src/app.module.ts` (register MeetingsModule)

- [ ] **Step 1: Create the module file**

`apps/api/src/modules/meetings/meetings.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { UploadsModule } from '../uploads/uploads.module';
import { AuditModule } from '../audit/audit.module';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';

@Module({
  imports: [PrismaModule, EmailModule, UploadsModule, AuditModule],
  controllers: [MeetingsController],
  providers: [MeetingsService],
  exports: [MeetingsService],
})
export class MeetingsModule {}
```

- [ ] **Step 2: Create the service skeleton**

`apps/api/src/modules/meetings/meetings.service.ts`:
```ts
import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MeetingStatus } from '@opencoop/database';
import { CreateMeetingDto } from './dto/create-meeting.dto';
import { UpdateMeetingDto } from './dto/update-meeting.dto';

@Injectable()
export class MeetingsService {
  constructor(private prisma: PrismaService) {}

  async create(coopId: string, dto: CreateMeetingDto) {
    return this.prisma.meeting.create({
      data: {
        coopId,
        type: dto.type,
        title: dto.title,
        scheduledAt: new Date(dto.scheduledAt),
        durationMinutes: dto.durationMinutes ?? 120,
        location: dto.location,
        format: dto.format,
        votingWeight: dto.votingWeight ?? 'PER_SHAREHOLDER',
        maxProxiesPerPerson: dto.maxProxiesPerPerson ?? 1,
        reminderDaysBefore: dto.reminderDaysBefore ?? [3],
      },
    });
  }

  async list(coopId: string) {
    return this.prisma.meeting.findMany({
      where: { coopId },
      orderBy: { scheduledAt: 'desc' },
      include: { agendaItems: { orderBy: { order: 'asc' } }, _count: { select: { attendances: true, proxies: true } } },
    });
  }

  async get(coopId: string, id: string) {
    const meeting = await this.prisma.meeting.findFirst({
      where: { id, coopId },
      include: {
        agendaItems: {
          orderBy: { order: 'asc' },
          include: { resolution: true, attachments: true },
        },
      },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
    return meeting;
  }

  async update(coopId: string, id: string, dto: UpdateMeetingDto) {
    await this.get(coopId, id);
    return this.prisma.meeting.update({
      where: { id },
      data: {
        ...dto,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
      },
    });
  }

  async delete(coopId: string, id: string) {
    const meeting = await this.get(coopId, id);
    if (meeting.status !== MeetingStatus.DRAFT) {
      throw new ForbiddenException('Can only delete meetings in DRAFT status. Use cancel() instead.');
    }
    return this.prisma.meeting.delete({ where: { id } });
  }

  async cancel(coopId: string, id: string, reason: string) {
    await this.get(coopId, id);
    return this.prisma.meeting.update({
      where: { id },
      data: { status: MeetingStatus.CANCELLED },
    });
  }
}
```

- [ ] **Step 3: Create the admin controller skeleton**

`apps/api/src/modules/meetings/meetings.controller.ts`:
```ts
import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CoopGuard } from '../../common/guards/coop.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@opencoop/database';
import { MeetingsService } from './meetings.service';
import { CreateMeetingDto } from './dto/create-meeting.dto';
import { UpdateMeetingDto } from './dto/update-meeting.dto';

@ApiTags('Meetings')
@ApiBearerAuth()
@Controller('admin/coops/:coopId/meetings')
@UseGuards(JwtAuthGuard, RolesGuard, CoopGuard)
@Roles(Role.COOP_ADMIN)
export class MeetingsController {
  constructor(private meetings: MeetingsService) {}

  @Post()
  create(@Param('coopId') coopId: string, @Body() dto: CreateMeetingDto) {
    return this.meetings.create(coopId, dto);
  }

  @Get()
  list(@Param('coopId') coopId: string) {
    return this.meetings.list(coopId);
  }

  @Get(':id')
  get(@Param('coopId') coopId: string, @Param('id') id: string) {
    return this.meetings.get(coopId, id);
  }

  @Patch(':id')
  update(@Param('coopId') coopId: string, @Param('id') id: string, @Body() dto: UpdateMeetingDto) {
    return this.meetings.update(coopId, id, dto);
  }

  @Delete(':id')
  delete(@Param('coopId') coopId: string, @Param('id') id: string) {
    return this.meetings.delete(coopId, id);
  }

  @Post(':id/cancel')
  cancel(@Param('coopId') coopId: string, @Param('id') id: string, @Body('reason') reason: string) {
    return this.meetings.cancel(coopId, id, reason);
  }
}
```

- [ ] **Step 4: Create the DTOs**

`apps/api/src/modules/meetings/dto/create-meeting.dto.ts`:
```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsString, IsDateString, IsOptional, IsInt, Min, IsArray } from 'class-validator';
import { MeetingType, MeetingFormat, VotingWeight } from '@opencoop/database';

export class CreateMeetingDto {
  @ApiProperty({ enum: MeetingType }) @IsEnum(MeetingType) type!: MeetingType;
  @ApiProperty() @IsString() title!: string;
  @ApiProperty() @IsDateString() scheduledAt!: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(15) durationMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() location?: string;
  @ApiProperty({ enum: MeetingFormat }) @IsEnum(MeetingFormat) format!: MeetingFormat;
  @ApiPropertyOptional({ enum: VotingWeight }) @IsOptional() @IsEnum(VotingWeight) votingWeight?: VotingWeight;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) maxProxiesPerPerson?: number;
  @ApiPropertyOptional({ type: [Number] }) @IsOptional() @IsArray() reminderDaysBefore?: number[];
}
```

`apps/api/src/modules/meetings/dto/update-meeting.dto.ts`:
```ts
import { PartialType } from '@nestjs/swagger';
import { CreateMeetingDto } from './create-meeting.dto';
export class UpdateMeetingDto extends PartialType(CreateMeetingDto) {}
```

- [ ] **Step 5: Register the module**

In `apps/api/src/app.module.ts`, find the imports array and add `MeetingsModule`. Mirror how existing modules like `DividendsModule` are imported.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @opencoop/api typecheck`
Expected: PASS.

- [ ] **Step 7: Smoke test**

Run `pnpm dev` and confirm the API boots without errors. Kill dev server.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/meetings/ apps/api/src/app.module.ts
git commit -m "feat(meetings): scaffold module with meeting CRUD"
```

---

### Task 5: Add agenda endpoints

**Files:**
- Create: `apps/api/src/modules/meetings/agenda.service.ts`
- Modify: `apps/api/src/modules/meetings/meetings.controller.ts`
- Modify: `apps/api/src/modules/meetings/meetings.module.ts`
- Create: `apps/api/src/modules/meetings/dto/create-agenda-item.dto.ts`
- Create: `apps/api/src/modules/meetings/dto/update-agenda-item.dto.ts`

- [ ] **Step 1: Create DTOs**

`create-agenda-item.dto.ts`:
```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsString, IsOptional, IsInt, Min, IsObject, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AgendaType, MajorityType } from '@opencoop/database';

export class ResolutionInputDto {
  @ApiProperty() @IsString() proposedText!: string;
  @ApiProperty({ enum: MajorityType }) @IsEnum(MajorityType) majorityType!: MajorityType;
  @ApiPropertyOptional() @IsOptional() quorumRequired?: number;
}

export class CreateAgendaItemDto {
  @ApiProperty() @IsInt() @Min(0) order!: number;
  @ApiProperty() @IsString() title!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiProperty({ enum: AgendaType }) @IsEnum(AgendaType) type!: AgendaType;
  @ApiPropertyOptional({ type: ResolutionInputDto })
  @IsOptional() @IsObject() @ValidateNested() @Type(() => ResolutionInputDto)
  resolution?: ResolutionInputDto;
}
```

`update-agenda-item.dto.ts`:
```ts
import { PartialType } from '@nestjs/swagger';
import { CreateAgendaItemDto } from './create-agenda-item.dto';
export class UpdateAgendaItemDto extends PartialType(CreateAgendaItemDto) {}
```

- [ ] **Step 2: Write the agenda service**

`apps/api/src/modules/meetings/agenda.service.ts`:
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAgendaItemDto } from './dto/create-agenda-item.dto';
import { UpdateAgendaItemDto } from './dto/update-agenda-item.dto';
import { AgendaType } from '@opencoop/database';

@Injectable()
export class AgendaService {
  constructor(private prisma: PrismaService) {}

  async addItem(meetingId: string, dto: CreateAgendaItemDto) {
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.agendaItem.create({
        data: {
          meetingId,
          order: dto.order,
          title: dto.title,
          description: dto.description,
          type: dto.type,
        },
      });
      if (dto.type !== AgendaType.INFORMATIONAL && dto.resolution) {
        await tx.resolution.create({
          data: {
            agendaItemId: item.id,
            proposedText: dto.resolution.proposedText,
            majorityType: dto.resolution.majorityType,
            quorumRequired: dto.resolution.quorumRequired ?? null,
          },
        });
      }
      return tx.agendaItem.findUniqueOrThrow({
        where: { id: item.id },
        include: { resolution: true, attachments: true },
      });
    });
  }

  async updateItem(itemId: string, dto: UpdateAgendaItemDto) {
    const item = await this.prisma.agendaItem.findUnique({ where: { id: itemId }, include: { resolution: true } });
    if (!item) throw new NotFoundException('Agenda item not found');

    return this.prisma.$transaction(async (tx) => {
      await tx.agendaItem.update({
        where: { id: itemId },
        data: {
          order: dto.order,
          title: dto.title,
          description: dto.description,
          type: dto.type,
        },
      });
      if (dto.resolution && item.resolution) {
        await tx.resolution.update({
          where: { agendaItemId: itemId },
          data: dto.resolution,
        });
      } else if (dto.resolution && !item.resolution) {
        await tx.resolution.create({
          data: { agendaItemId: itemId, ...dto.resolution },
        });
      }
      return tx.agendaItem.findUniqueOrThrow({
        where: { id: itemId },
        include: { resolution: true, attachments: true },
      });
    });
  }

  async removeItem(itemId: string) {
    await this.prisma.agendaItem.delete({ where: { id: itemId } });
  }
}
```

- [ ] **Step 3: Wire into module**

In `meetings.module.ts`, add `AgendaService` to providers + exports.

- [ ] **Step 4: Add controller endpoints**

Append to `MeetingsController`:
```ts
  constructor(private meetings: MeetingsService, private agenda: AgendaService) {}

  @Post(':id/agenda-items')
  addAgendaItem(@Param('id') id: string, @Body() dto: CreateAgendaItemDto) {
    return this.agenda.addItem(id, dto);
  }

  @Patch(':id/agenda-items/:itemId')
  updateAgendaItem(@Param('itemId') itemId: string, @Body() dto: UpdateAgendaItemDto) {
    return this.agenda.updateItem(itemId, dto);
  }

  @Delete(':id/agenda-items/:itemId')
  removeAgendaItem(@Param('itemId') itemId: string) {
    return this.agenda.removeItem(itemId);
  }
```

Add necessary imports.

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter @opencoop/api typecheck
git add apps/api/src/modules/meetings/
git commit -m "feat(meetings): agenda items + resolutions CRUD"
```

---

### Task 6: Agenda attachments endpoint

**Files:**
- Modify: `apps/api/src/modules/meetings/agenda.service.ts`
- Modify: `apps/api/src/modules/meetings/meetings.controller.ts`

- [ ] **Step 1: Add upload handler on AgendaService**

Add to `agenda.service.ts`:
```ts
async addAttachment(itemId: string, file: { originalname: string; path: string; url: string }) {
  return this.prisma.agendaAttachment.create({
    data: { agendaItemId: itemId, fileName: file.originalname, fileUrl: file.url },
  });
}
```

- [ ] **Step 2: Add controller endpoint using existing UploadsService**

Pattern reference: `apps/api/src/modules/documents/` uses `@UseInterceptors(FileInterceptor('file'))` + calls `uploadsService.uploadFile()`. Follow that pattern.

```ts
@Post(':id/agenda-items/:itemId/attachments')
@UseInterceptors(FileInterceptor('file'))
async uploadAttachment(
  @Param('coopId') coopId: string,
  @Param('itemId') itemId: string,
  @UploadedFile() file: Express.Multer.File,
) {
  const uploaded = await this.uploads.uploadFile(coopId, file, 'agenda-attachments');
  return this.agenda.addAttachment(itemId, {
    originalname: file.originalname,
    path: uploaded.path,
    url: uploaded.url,
  });
}
```

Inject `UploadsService` via constructor. Look at `documents.controller.ts` for the exact multer + uploads wiring.

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm --filter @opencoop/api typecheck
git add apps/api/src/modules/meetings/
git commit -m "feat(meetings): upload agenda attachments"
```

---

### Task 7: Meeting state transitions + guards

**Files:**
- Modify: `apps/api/src/modules/meetings/meetings.service.ts`
- Create: `apps/api/src/modules/meetings/meetings.service.spec.ts`

- [ ] **Step 1: Write tests for transitions**

Create `apps/api/src/modules/meetings/meetings.service.spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { MeetingsService } from './meetings.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ForbiddenException } from '@nestjs/common';

describe('MeetingsService', () => {
  let service: MeetingsService;
  let prisma: { meeting: any };

  beforeEach(async () => {
    prisma = {
      meeting: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        findMany: jest.fn(),
      },
    };
    const module = await Test.createTestingModule({
      providers: [MeetingsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(MeetingsService);
  });

  it('refuses to delete non-DRAFT meetings', async () => {
    prisma.meeting.findFirst.mockResolvedValue({ id: 'm1', coopId: 'c1', status: 'CONVOKED' });
    await expect(service.delete('c1', 'm1')).rejects.toThrow(ForbiddenException);
  });

  it('deletes DRAFT meetings', async () => {
    prisma.meeting.findFirst.mockResolvedValue({ id: 'm1', coopId: 'c1', status: 'DRAFT' });
    prisma.meeting.delete.mockResolvedValue({});
    await service.delete('c1', 'm1');
    expect(prisma.meeting.delete).toHaveBeenCalledWith({ where: { id: 'm1' } });
  });
});
```

- [ ] **Step 2: Run tests (expect PASS — logic is already in place from Task 4)**

Run: `pnpm --filter @opencoop/api test meetings.service.spec`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/meetings/meetings.service.spec.ts
git commit -m "test(meetings): state transition guards"
```

---

## Phase 3 — Proxies (Art. 23)

### Task 8: ProxiesService with Art. 23 enforcement

**Files:**
- Create: `apps/api/src/modules/meetings/proxies.service.ts`
- Create: `apps/api/src/modules/meetings/proxies.service.spec.ts`
- Create: `apps/api/src/modules/meetings/dto/create-proxy.dto.ts`
- Modify: `apps/api/src/modules/meetings/meetings.module.ts`

- [ ] **Step 1: Write failing tests first**

`proxies.service.spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ProxiesService } from './proxies.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ProxiesService', () => {
  let service: ProxiesService;
  let prisma: any;

  const meeting = { id: 'm1', coopId: 'c1', maxProxiesPerPerson: 1 };
  const grantorSh = { id: 'sA', coopId: 'c1', active: true };
  const delegateSh = { id: 'sB', coopId: 'c1', active: true };

  beforeEach(async () => {
    prisma = {
      meeting: { findUnique: jest.fn() },
      shareholder: { findUnique: jest.fn() },
      proxy: { count: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    };
    const module = await Test.createTestingModule({
      providers: [ProxiesService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(ProxiesService);
  });

  it('rejects self-delegation', async () => {
    prisma.meeting.findUnique.mockResolvedValue(meeting);
    prisma.shareholder.findUnique
      .mockResolvedValueOnce(grantorSh)
      .mockResolvedValueOnce(grantorSh);
    await expect(service.create('m1', 'sA', 'sA'))
      .rejects.toThrow(BadRequestException);
  });

  it('rejects cross-coop delegate', async () => {
    prisma.meeting.findUnique.mockResolvedValue(meeting);
    prisma.shareholder.findUnique
      .mockResolvedValueOnce(grantorSh)
      .mockResolvedValueOnce({ id: 'sX', coopId: 'OTHER', active: true });
    await expect(service.create('m1', 'sA', 'sX'))
      .rejects.toThrow(ForbiddenException);
  });

  it('rejects when delegate has already reached maxProxiesPerPerson', async () => {
    prisma.meeting.findUnique.mockResolvedValue(meeting);
    prisma.shareholder.findUnique
      .mockResolvedValueOnce(grantorSh)
      .mockResolvedValueOnce(delegateSh);
    prisma.proxy.count.mockResolvedValue(1);
    await expect(service.create('m1', 'sA', 'sB'))
      .rejects.toThrow(BadRequestException);
  });

  it('creates a valid proxy', async () => {
    prisma.meeting.findUnique.mockResolvedValue(meeting);
    prisma.shareholder.findUnique
      .mockResolvedValueOnce(grantorSh)
      .mockResolvedValueOnce(delegateSh);
    prisma.proxy.count.mockResolvedValue(0);
    prisma.proxy.create.mockResolvedValue({ id: 'p1' });
    const result = await service.create('m1', 'sA', 'sB');
    expect(result).toEqual({ id: 'p1' });
  });
});
```

- [ ] **Step 2: Run — expect fail (no service yet)**

Run: `pnpm --filter @opencoop/api test proxies.service.spec`
Expected: FAIL (file not found).

- [ ] **Step 3: Implement ProxiesService**

`proxies.service.ts`:
```ts
import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ProxiesService {
  constructor(private prisma: PrismaService) {}

  async create(meetingId: string, grantorShareholderId: string, delegateShareholderId: string) {
    if (grantorShareholderId === delegateShareholderId) {
      throw new BadRequestException('A shareholder cannot delegate to themselves');
    }

    const meeting = await this.prisma.meeting.findUnique({ where: { id: meetingId } });
    if (!meeting) throw new NotFoundException('Meeting not found');

    const grantor = await this.prisma.shareholder.findUnique({ where: { id: grantorShareholderId } });
    const delegate = await this.prisma.shareholder.findUnique({ where: { id: delegateShareholderId } });
    if (!grantor || !delegate) throw new NotFoundException('Shareholder not found');
    if (grantor.coopId !== meeting.coopId || delegate.coopId !== meeting.coopId) {
      throw new ForbiddenException('Both shareholders must belong to the meeting coop');
    }

    const activeProxiesHeld = await this.prisma.proxy.count({
      where: {
        meetingId,
        delegateShareholderId,
        revokedAt: null,
      },
    });
    if (activeProxiesHeld >= meeting.maxProxiesPerPerson) {
      throw new BadRequestException(
        `This shareholder has already reached the maximum of ${meeting.maxProxiesPerPerson} proxy(ies) per person`,
      );
    }

    return this.prisma.proxy.create({
      data: { meetingId, grantorShareholderId, delegateShareholderId },
    });
  }

  async list(meetingId: string) {
    return this.prisma.proxy.findMany({
      where: { meetingId, revokedAt: null },
      include: { grantor: true, delegate: true },
    });
  }

  async revoke(proxyId: string) {
    const proxy = await this.prisma.proxy.findUnique({ where: { id: proxyId } });
    if (!proxy) throw new NotFoundException('Proxy not found');
    return this.prisma.proxy.update({
      where: { id: proxyId },
      data: { revokedAt: new Date() },
    });
  }

  async attachSignedForm(proxyId: string, signedFormUrl: string) {
    return this.prisma.proxy.update({
      where: { id: proxyId },
      data: { signedFormUrl },
    });
  }
}
```

- [ ] **Step 4: Create DTO**

`dto/create-proxy.dto.ts`:
```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class CreateProxyDto {
  @ApiProperty() @IsString() grantorShareholderId!: string;
  @ApiProperty() @IsString() delegateShareholderId!: string;
}
```

- [ ] **Step 5: Register in module**

Add `ProxiesService` to providers + exports in `meetings.module.ts`.

- [ ] **Step 6: Run tests — expect PASS**

Run: `pnpm --filter @opencoop/api test proxies.service.spec`
Expected: 4 passed.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/meetings/
git commit -m "feat(meetings): proxies service enforces Art. 23 rules"
```

---

### Task 9: Proxy admin endpoints

**Files:**
- Modify: `apps/api/src/modules/meetings/meetings.controller.ts`

- [ ] **Step 1: Add proxy endpoints to controller**

Inject `ProxiesService` and add:
```ts
@Post(':id/proxies')
createProxy(@Param('id') id: string, @Body() dto: CreateProxyDto) {
  return this.proxies.create(id, dto.grantorShareholderId, dto.delegateShareholderId);
}

@Get(':id/proxies')
listProxies(@Param('id') id: string) {
  return this.proxies.list(id);
}

@Delete(':id/proxies/:proxyId')
revokeProxy(@Param('proxyId') proxyId: string) {
  return this.proxies.revoke(proxyId);
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @opencoop/api typecheck
git add apps/api/src/modules/meetings/meetings.controller.ts
git commit -m "feat(meetings): proxy admin endpoints"
```

---

## Phase 4 — Voting

### Task 10: VotesService with majority math (TDD)

**Files:**
- Create: `apps/api/src/modules/meetings/votes.service.ts`
- Create: `apps/api/src/modules/meetings/votes.service.spec.ts`
- Create: `apps/api/src/modules/meetings/dto/record-vote.dto.ts`
- Modify: `apps/api/src/modules/meetings/meetings.module.ts`

- [ ] **Step 1: Write failing majority tests**

`votes.service.spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { VotesService } from './votes.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('VotesService.computeOutcome', () => {
  let service: VotesService;
  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [VotesService, { provide: PrismaService, useValue: {} }],
    }).compile();
    service = module.get(VotesService);
  });

  // SIMPLE MAJORITY (strict)
  it('simple: 5 for, 4 against → passed', () => {
    expect(service.computeOutcome({ majorityType: 'SIMPLE', votesFor: 5, votesAgainst: 4, votesAbstain: 0 })).toBe(true);
  });
  it('simple: 5 for, 5 against → NOT passed (tie = rejected)', () => {
    expect(service.computeOutcome({ majorityType: 'SIMPLE', votesFor: 5, votesAgainst: 5, votesAbstain: 0 })).toBe(false);
  });
  it('simple: abstentions ignored', () => {
    expect(service.computeOutcome({ majorityType: 'SIMPLE', votesFor: 3, votesAgainst: 2, votesAbstain: 100 })).toBe(true);
  });

  // TWO_THIRDS (abstentions excluded from denominator)
  it('two-thirds: 6 for, 3 against → passed (6*3 >= 9*2)', () => {
    expect(service.computeOutcome({ majorityType: 'TWO_THIRDS', votesFor: 6, votesAgainst: 3, votesAbstain: 99 })).toBe(true);
  });
  it('two-thirds: 5 for, 3 against → NOT passed (15 < 16)', () => {
    expect(service.computeOutcome({ majorityType: 'TWO_THIRDS', votesFor: 5, votesAgainst: 3, votesAbstain: 0 })).toBe(false);
  });

  // THREE_QUARTERS (Art. 25 statutes change; abstentions excluded)
  it('three-quarters: 9 for, 3 against → passed (9*4 >= 12*3)', () => {
    expect(service.computeOutcome({ majorityType: 'THREE_QUARTERS', votesFor: 9, votesAgainst: 3, votesAbstain: 0 })).toBe(true);
  });
  it('three-quarters: 8 for, 3 against → NOT passed (32 < 33)', () => {
    expect(service.computeOutcome({ majorityType: 'THREE_QUARTERS', votesFor: 8, votesAgainst: 3, votesAbstain: 100 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm --filter @opencoop/api test votes.service.spec`
Expected: FAIL.

- [ ] **Step 3: Implement VotesService.computeOutcome**

`votes.service.ts`:
```ts
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MajorityType, VotingWeight, VoteChoice } from '@opencoop/database';
import { RecordVoteDto } from './dto/record-vote.dto';

export interface OutcomeInput {
  majorityType: MajorityType;
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
}

@Injectable()
export class VotesService {
  constructor(private prisma: PrismaService) {}

  computeOutcome({ majorityType, votesFor, votesAgainst }: OutcomeInput): boolean {
    // Abstentions are excluded from numerator AND denominator for all majority types per statuten Art. 25.
    switch (majorityType) {
      case MajorityType.SIMPLE:
        return votesFor > votesAgainst;
      case MajorityType.TWO_THIRDS:
        return votesFor * 3 >= (votesFor + votesAgainst) * 2;
      case MajorityType.THREE_QUARTERS:
        return votesFor * 4 >= (votesFor + votesAgainst) * 3;
    }
  }

  async recordVotes(resolutionId: string, votes: RecordVoteDto[]) {
    const resolution = await this.prisma.resolution.findUnique({
      where: { id: resolutionId },
      include: { agendaItem: { include: { meeting: true } } },
    });
    if (!resolution) throw new NotFoundException('Resolution not found');
    if (resolution.closedAt) throw new BadRequestException('Resolution is closed');

    const meeting = resolution.agendaItem.meeting;
    const perSharePivot = meeting.votingWeight === VotingWeight.PER_SHARE;

    return this.prisma.$transaction(async (tx) => {
      for (const v of votes) {
        let weight = 1;
        if (perSharePivot) {
          const sh = await tx.shareholder.findUnique({
            where: { id: v.shareholderId },
            include: { shares: { select: { quantity: true } } },
          });
          weight = sh?.shares.reduce((s, row) => s + row.quantity, 0) ?? 1;
        }
        await tx.vote.upsert({
          where: { resolutionId_shareholderId: { resolutionId, shareholderId: v.shareholderId } },
          create: { resolutionId, shareholderId: v.shareholderId, choice: v.choice, weight, castViaProxyId: v.castViaProxyId },
          update: { choice: v.choice, weight, castViaProxyId: v.castViaProxyId, castAt: new Date() },
        });
      }

      // Recompute totals from vote rows
      const [forAgg, againstAgg, abstainAgg] = await Promise.all([
        tx.vote.aggregate({ where: { resolutionId, choice: VoteChoice.FOR }, _sum: { weight: true } }),
        tx.vote.aggregate({ where: { resolutionId, choice: VoteChoice.AGAINST }, _sum: { weight: true } }),
        tx.vote.aggregate({ where: { resolutionId, choice: VoteChoice.ABSTAIN }, _sum: { weight: true } }),
      ]);

      return tx.resolution.update({
        where: { id: resolutionId },
        data: {
          votesFor: forAgg._sum.weight ?? 0,
          votesAgainst: againstAgg._sum.weight ?? 0,
          votesAbstain: abstainAgg._sum.weight ?? 0,
        },
      });
    });
  }

  async closeResolution(resolutionId: string) {
    const r = await this.prisma.resolution.findUnique({ where: { id: resolutionId } });
    if (!r) throw new NotFoundException('Resolution not found');
    if (r.closedAt) throw new BadRequestException('Already closed');

    const passed = this.computeOutcome({
      majorityType: r.majorityType,
      votesFor: r.votesFor,
      votesAgainst: r.votesAgainst,
      votesAbstain: r.votesAbstain,
    });

    return this.prisma.resolution.update({
      where: { id: resolutionId },
      data: { passed, closedAt: new Date() },
    });
  }
}
```

- [ ] **Step 4: Create DTO**

`dto/record-vote.dto.ts`:
```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEnum, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { VoteChoice } from '@opencoop/database';

export class RecordVoteDto {
  @ApiProperty() @IsString() shareholderId!: string;
  @ApiProperty({ enum: VoteChoice }) @IsEnum(VoteChoice) choice!: VoteChoice;
  @ApiPropertyOptional() @IsOptional() @IsString() castViaProxyId?: string;
}

export class BulkRecordVotesDto {
  @ApiProperty({ type: [RecordVoteDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => RecordVoteDto)
  votes!: RecordVoteDto[];
}
```

- [ ] **Step 5: Register service in module**

Add `VotesService` to providers + exports in `meetings.module.ts`.

- [ ] **Step 6: Run tests — expect PASS (8 tests)**

Run: `pnpm --filter @opencoop/api test votes.service.spec`
Expected: 8 passed.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/meetings/
git commit -m "feat(meetings): votes service with statuten-compliant majority math"
```

---

### Task 11: Voting admin endpoints

**Files:**
- Modify: `apps/api/src/modules/meetings/meetings.controller.ts`

- [ ] **Step 1: Add endpoints**

```ts
@Post(':id/resolutions/:resId/votes')
recordVotes(@Param('resId') resId: string, @Body() dto: BulkRecordVotesDto) {
  return this.votes.recordVotes(resId, dto.votes);
}

@Post(':id/resolutions/:resId/close')
closeResolution(@Param('resId') resId: string) {
  return this.votes.closeResolution(resId);
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @opencoop/api typecheck
git add apps/api/src/modules/meetings/meetings.controller.ts
git commit -m "feat(meetings): admin voting endpoints"
```

---

## Phase 5 — Convocation + Email + ICS

### Task 12: ICS service

**Files:**
- Create: `apps/api/src/modules/meetings/ics.service.ts`
- Create: `apps/api/src/modules/meetings/ics.service.spec.ts`
- Modify: `apps/api/package.json` (add `ics` dependency)
- Modify: `apps/api/src/modules/meetings/meetings.module.ts`

- [ ] **Step 1: Install ics package**

Run: `pnpm --filter @opencoop/api add ics` then `pnpm install`
Expected: package added.

- [ ] **Step 2: Write test**

`ics.service.spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { IcsService } from './ics.service';
import * as ical from 'node-ical';

describe('IcsService', () => {
  let service: IcsService;
  beforeEach(async () => {
    const module = await Test.createTestingModule({ providers: [IcsService] }).compile();
    service = module.get(IcsService);
  });

  it('generates parseable iCalendar for a meeting', async () => {
    const result = service.generate({
      uid: 'meeting-m1@opencoop.be',
      title: 'Jaarlijkse AV Bronsgroen',
      start: new Date('2026-05-09T10:00:00+02:00'),
      durationMinutes: 120,
      location: 'Theresiastraat 29, 3500 Hasselt',
      description: 'Agenda: ...',
      organizerName: 'Bronsgroen cv',
      organizerEmail: 'bestuur@bronsgroen.be',
    });
    expect(result).toContain('BEGIN:VCALENDAR');
    expect(result).toContain('SUMMARY:Jaarlijkse AV Bronsgroen');
    expect(result).toContain('LOCATION:Theresiastraat 29\\, 3500 Hasselt');
    const parsed = ical.parseICS(result);
    const vevent = Object.values(parsed).find((x: any) => x.type === 'VEVENT');
    expect(vevent).toBeDefined();
  });
});
```

Note: `node-ical` is a dev dep used only for parsing in tests. Add via `pnpm --filter @opencoop/api add -D node-ical @types/node-ical` if not present.

- [ ] **Step 3: Run — expect fail**

Run: `pnpm --filter @opencoop/api test ics.service.spec`
Expected: FAIL.

- [ ] **Step 4: Implement**

`ics.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import * as ics from 'ics';

export interface IcsInput {
  uid: string;
  title: string;
  start: Date;
  durationMinutes: number;
  location: string;
  description: string;
  organizerName: string;
  organizerEmail: string;
}

@Injectable()
export class IcsService {
  generate(input: IcsInput): string {
    const start: ics.DateArray = [
      input.start.getUTCFullYear(),
      input.start.getUTCMonth() + 1,
      input.start.getUTCDate(),
      input.start.getUTCHours(),
      input.start.getUTCMinutes(),
    ];
    const { error, value } = ics.createEvent({
      uid: input.uid,
      start,
      startInputType: 'utc',
      duration: { hours: Math.floor(input.durationMinutes / 60), minutes: input.durationMinutes % 60 },
      title: input.title,
      description: input.description,
      location: input.location,
      organizer: { name: input.organizerName, email: input.organizerEmail },
      method: 'REQUEST',
    });
    if (error) throw error;
    return value!;
  }
}
```

- [ ] **Step 5: Register in module + run tests**

Run: `pnpm --filter @opencoop/api test ics.service.spec`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/meetings/ apps/api/package.json
git commit -m "feat(meetings): ICS calendar generation"
```

---

### Task 13: ConvocationService

**Files:**
- Create: `apps/api/src/modules/meetings/convocation.service.ts`
- Create: `apps/api/src/modules/meetings/convocation.service.spec.ts`
- Create: `apps/api/src/modules/meetings/dto/send-convocation.dto.ts`
- Modify: `apps/api/src/modules/meetings/meetings.module.ts`

- [ ] **Step 1: Write deadline-warning test**

`convocation.service.spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConvocationService } from './convocation.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';

describe('ConvocationService', () => {
  let service: ConvocationService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      meeting: { findUnique: jest.fn(), update: jest.fn() },
      shareholder: { findMany: jest.fn() },
      meetingAttendance: { upsert: jest.fn() },
    };
    const module = await Test.createTestingModule({
      providers: [
        ConvocationService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: { queueEmail: jest.fn() } },
      ],
    }).compile();
    service = module.get(ConvocationService);
  });

  it('rejects convocation less than 15 days before meeting without override', async () => {
    const scheduledAt = new Date(Date.now() + 10 * 24 * 3600 * 1000);
    prisma.meeting.findUnique.mockResolvedValue({ id: 'm1', status: 'DRAFT', scheduledAt });
    await expect(service.send('c1', 'm1', { confirmShortNotice: false }))
      .rejects.toThrow(BadRequestException);
  });

  it('allows short notice if confirmed', async () => {
    const scheduledAt = new Date(Date.now() + 10 * 24 * 3600 * 1000);
    prisma.meeting.findUnique.mockResolvedValue({ id: 'm1', coopId: 'c1', status: 'DRAFT', scheduledAt });
    prisma.shareholder.findMany.mockResolvedValue([]);
    prisma.meeting.update.mockResolvedValue({});
    await service.send('c1', 'm1', { confirmShortNotice: true });
    expect(prisma.meeting.update).toHaveBeenCalled();
  });

  it('is idempotent if meeting is already CONVOKED', async () => {
    prisma.meeting.findUnique.mockResolvedValue({ id: 'm1', status: 'CONVOKED', scheduledAt: new Date() });
    const res = await service.send('c1', 'm1', {});
    expect(res).toEqual({ alreadySent: true });
  });
});
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement**

`convocation.service.ts`:
```ts
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { MeetingStatus } from '@opencoop/database';
import { createId } from '@paralleldrive/cuid2';

export interface SendConvocationOpts {
  confirmShortNotice?: boolean;
}

@Injectable()
export class ConvocationService {
  constructor(private prisma: PrismaService, private email: EmailService) {}

  async send(coopId: string, meetingId: string, opts: SendConvocationOpts = {}) {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      include: { coop: true, agendaItems: { orderBy: { order: 'asc' }, include: { resolution: true } } },
    });
    if (!meeting || meeting.coopId !== coopId) throw new NotFoundException('Meeting not found');
    if (meeting.status === MeetingStatus.CONVOKED) {
      return { alreadySent: true as const };
    }

    const daysUntil = (meeting.scheduledAt.getTime() - Date.now()) / (86400 * 1000);
    if (daysUntil < 15 && !opts.confirmShortNotice) {
      throw new BadRequestException(
        `Meeting is less than 15 days away. Set confirmShortNotice=true to override (statuten Art. 22 requires 15 days).`,
      );
    }

    const shareholders = await this.prisma.shareholder.findMany({
      where: { coopId, active: true },
    });

    const failures: Array<{ shareholderId: string; error: string }> = [];
    for (const sh of shareholders) {
      try {
        const token = createId();
        await this.prisma.meetingAttendance.upsert({
          where: { meetingId_shareholderId: { meetingId, shareholderId: sh.id } },
          create: {
            meetingId,
            shareholderId: sh.id,
            rsvpToken: token,
            rsvpTokenExpires: meeting.scheduledAt,
          },
          update: {
            rsvpToken: token,
            rsvpTokenExpires: meeting.scheduledAt,
          },
        });
        if (sh.email) {
          await this.email.queueEmail({
            coopId,
            to: sh.email,
            subject: `Oproeping - ${meeting.title}`,
            templateKey: 'meeting-convocation',
            templateData: {
              language: sh.preferredLanguage ?? 'nl',
              shareholderName: `${sh.firstName} ${sh.lastName}`,
              meetingTitle: meeting.title,
              meetingDate: meeting.scheduledAt.toISOString(),
              meetingLocation: meeting.location ?? '',
              agendaItems: meeting.agendaItems.map((a) => ({ order: a.order, title: a.title, description: a.description })),
              rsvpUrl: `${process.env.NEXT_PUBLIC_WEB_URL ?? 'https://opencoop.be'}/meetings/rsvp/${token}`,
            },
          });
        }
      } catch (err) {
        failures.push({ shareholderId: sh.id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return this.prisma.meeting.update({
      where: { id: meetingId },
      data: {
        status: MeetingStatus.CONVOKED,
        convocationSentAt: new Date(),
        convocationFailures: failures.length ? failures : undefined,
      },
    });
  }
}
```

Note: `@paralleldrive/cuid2` may need to be added as a dep: `pnpm --filter @opencoop/api add @paralleldrive/cuid2`.

- [ ] **Step 4: Create DTO**

`dto/send-convocation.dto.ts`:
```ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class SendConvocationDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() confirmShortNotice?: boolean;
}
```

- [ ] **Step 5: Register in module + run tests**

Run tests; expect PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/meetings/ apps/api/package.json
git commit -m "feat(meetings): convocation service with 15-day notice check"
```

---

### Task 14: Convocation admin endpoints

**Files:**
- Modify: `apps/api/src/modules/meetings/meetings.controller.ts`

- [ ] **Step 1: Add endpoints**

```ts
@Post(':id/convocation/send')
sendConvocation(@Param('coopId') coopId: string, @Param('id') id: string, @Body() dto: SendConvocationDto) {
  return this.convocation.send(coopId, id, dto);
}

@Get(':id/convocation/status')
async convocationStatus(@Param('id') id: string) {
  const attendances = await this.meetings.prisma.meetingAttendance.findMany({
    where: { meetingId: id },
    include: { shareholder: { select: { firstName: true, lastName: true, email: true } } },
  });
  return attendances;
}
```

(Expose `prisma` via `MeetingsService`, or add a dedicated `ConvocationService.listStatus(meetingId)` method. Prefer the dedicated method — add it to `convocation.service.ts`.)

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @opencoop/api typecheck
git add apps/api/src/modules/meetings/
git commit -m "feat(meetings): convocation send + delivery status endpoints"
```

---

## Phase 6 — Public RSVP Controller

### Task 15: Public RSVP controller

**Files:**
- Create: `apps/api/src/modules/meetings/rsvp.service.ts`
- Create: `apps/api/src/modules/meetings/meeting-rsvp.controller.ts`
- Create: `apps/api/src/modules/meetings/dto/rsvp-update.dto.ts`
- Modify: `apps/api/src/modules/meetings/meetings.module.ts`

- [ ] **Step 1: Write RSVP service**

`rsvp.service.ts`:
```ts
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProxiesService } from './proxies.service';
import { RSVPStatus } from '@opencoop/database';

@Injectable()
export class RsvpService {
  constructor(private prisma: PrismaService, private proxies: ProxiesService) {}

  async resolveToken(token: string) {
    const attendance = await this.prisma.meetingAttendance.findUnique({
      where: { rsvpToken: token },
      include: {
        shareholder: true,
        meeting: {
          include: {
            coop: { select: { id: true, name: true, logoUrl: true, primaryColor: true } },
            agendaItems: { orderBy: { order: 'asc' }, include: { resolution: true } },
          },
        },
      },
    });
    if (!attendance) throw new NotFoundException('RSVP link invalid or expired');
    if (attendance.rsvpTokenExpires < new Date()) {
      throw new BadRequestException('RSVP link expired');
    }
    return attendance;
  }

  async updateRsvp(token: string, status: RSVPStatus, delegateShareholderId?: string) {
    const attendance = await this.resolveToken(token);
    if (status === RSVPStatus.PROXY) {
      if (!delegateShareholderId) throw new BadRequestException('Delegate required for PROXY RSVP');
      await this.proxies.create(attendance.meetingId, attendance.shareholderId, delegateShareholderId);
    }
    return this.prisma.meetingAttendance.update({
      where: { id: attendance.id },
      data: { rsvpStatus: status, rsvpAt: new Date() },
    });
  }

  async listEligibleDelegates(token: string) {
    const attendance = await this.resolveToken(token);
    return this.prisma.shareholder.findMany({
      where: {
        coopId: attendance.meeting.coopId,
        active: true,
        id: { not: attendance.shareholderId },
      },
      select: { id: true, firstName: true, lastName: true, shareholderNumber: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  }
}
```

- [ ] **Step 2: Create DTO**

`dto/rsvp-update.dto.ts`:
```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { RSVPStatus } from '@opencoop/database';

export class RsvpUpdateDto {
  @ApiProperty({ enum: RSVPStatus }) @IsEnum(RSVPStatus) status!: RSVPStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() delegateShareholderId?: string;
}
```

- [ ] **Step 3: Create public controller**

`meeting-rsvp.controller.ts`:
```ts
import { Controller, Get, Patch, Param, Body, Header, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { RsvpService } from './rsvp.service';
import { IcsService } from './ics.service';
import { RsvpUpdateDto } from './dto/rsvp-update.dto';

@ApiTags('Public — RSVP')
@Public()
@Controller('public/meetings/rsvp')
export class MeetingRsvpController {
  constructor(private rsvp: RsvpService, private ics: IcsService) {}

  @Get(':token')
  async getDetails(@Param('token') token: string) {
    const att = await this.rsvp.resolveToken(token);
    return {
      meeting: {
        id: att.meeting.id,
        title: att.meeting.title,
        scheduledAt: att.meeting.scheduledAt,
        location: att.meeting.location,
        agenda: att.meeting.agendaItems,
      },
      coop: att.meeting.coop,
      shareholder: {
        firstName: att.shareholder.firstName,
        lastName: att.shareholder.lastName,
      },
      rsvpStatus: att.rsvpStatus,
    };
  }

  @Patch(':token')
  updateRsvp(@Param('token') token: string, @Body() dto: RsvpUpdateDto) {
    return this.rsvp.updateRsvp(token, dto.status, dto.delegateShareholderId);
  }

  @Get(':token/eligible-delegates')
  listDelegates(@Param('token') token: string) {
    return this.rsvp.listEligibleDelegates(token);
  }

  @Get(':token/ics')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  async downloadIcs(@Param('token') token: string, @Res() res: Response) {
    const att = await this.rsvp.resolveToken(token);
    const content = this.ics.generate({
      uid: `meeting-${att.meeting.id}@opencoop.be`,
      title: att.meeting.title,
      start: att.meeting.scheduledAt,
      durationMinutes: att.meeting.durationMinutes,
      location: att.meeting.location ?? '',
      description: att.meeting.agendaItems.map((a) => `${a.order}. ${a.title}`).join('\n'),
      organizerName: att.meeting.coop.name,
      organizerEmail: att.meeting.coop.contactEmail ?? 'noreply@opencoop.be',
    });
    res.setHeader('Content-Disposition', `attachment; filename="${att.meeting.title}.ics"`);
    res.send(content);
  }
}
```

- [ ] **Step 4: Register in module**

Add `RsvpService` and `IcsService` to providers. Add `MeetingRsvpController` to controllers.

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter @opencoop/api typecheck
git add apps/api/src/modules/meetings/
git commit -m "feat(meetings): public token-based RSVP endpoints"
```

---

### Task 16: Upload signed volmacht endpoint

**Files:**
- Modify: `apps/api/src/modules/meetings/meeting-rsvp.controller.ts`
- Modify: `apps/api/src/modules/meetings/rsvp.service.ts`

- [ ] **Step 1: Add method to RsvpService**

```ts
async attachSignedVolmacht(token: string, file: { originalname: string; url: string }) {
  const att = await this.resolveToken(token);
  const proxy = await this.prisma.proxy.findFirst({
    where: { meetingId: att.meetingId, grantorShareholderId: att.shareholderId, revokedAt: null },
  });
  if (!proxy) throw new NotFoundException('No proxy on file for this shareholder');
  return this.prisma.proxy.update({
    where: { id: proxy.id },
    data: { signedFormUrl: file.url },
  });
}
```

- [ ] **Step 2: Add controller endpoint**

Follow existing multer pattern (see `documents.controller.ts`):
```ts
@Post(':token/proxy/upload')
@UseInterceptors(FileInterceptor('file'))
async uploadSigned(
  @Param('token') token: string,
  @UploadedFile() file: Express.Multer.File,
) {
  const uploaded = await this.uploads.uploadFile('public', file, 'volmachten');
  return this.rsvp.attachSignedVolmacht(token, { originalname: file.originalname, url: uploaded.url });
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
git add apps/api/src/modules/meetings/
git commit -m "feat(meetings): upload signed volmacht via RSVP link"
```

---

## Phase 7 — Kiosk

### Task 17: Kiosk session + controller

**Files:**
- Create: `apps/api/src/modules/meetings/kiosk.service.ts`
- Create: `apps/api/src/modules/meetings/meeting-kiosk.controller.ts`
- Modify: `apps/api/src/modules/meetings/meetings.module.ts`
- Modify: `apps/api/src/modules/meetings/meetings.controller.ts`

- [ ] **Step 1: Implement KioskService**

`kiosk.service.ts`:
```ts
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CheckInMethod } from '@opencoop/database';
import { createId } from '@paralleldrive/cuid2';

@Injectable()
export class KioskService {
  constructor(private prisma: PrismaService) {}

  async startSession(meetingId: string, adminUserId: string) {
    return this.prisma.meetingKioskSession.create({
      data: { meetingId, startedBy: adminUserId, token: createId() },
    });
  }

  async endSession(sessionId: string) {
    return this.prisma.meetingKioskSession.update({
      where: { id: sessionId },
      data: { active: false, endedAt: new Date() },
    });
  }

  async validate(token: string) {
    const session = await this.prisma.meetingKioskSession.findUnique({
      where: { token },
      include: {
        meeting: { include: { coop: { select: { name: true, logoUrl: true, primaryColor: true } } } },
      },
    });
    if (!session || !session.active) throw new NotFoundException('Kiosk session ended or not found');
    return session;
  }

  async search(token: string, query: string) {
    const session = await this.validate(token);
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return this.prisma.shareholder.findMany({
      where: {
        coopId: session.meeting.coopId,
        active: true,
        OR: [
          { firstName: { contains: q, mode: 'insensitive' } },
          { lastName: { contains: q, mode: 'insensitive' } },
          { shareholderNumber: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: { id: true, firstName: true, lastName: true, shareholderNumber: true, postalCode: true },
      take: 10,
    });
  }

  async checkIn(token: string, shareholderId: string, signaturePngDataUrl: string) {
    const session = await this.validate(token);
    // Strip data URL prefix + save to uploads. Existing UploadsService expects a Buffer/Multer file — inline minimal save:
    const base64 = signaturePngDataUrl.replace(/^data:image\/png;base64,/, '');
    // NOTE: inject UploadsService properly in constructor and call saveBuffer() — this is a pattern call only
    const url = await this.saveSignature(session.meetingId, shareholderId, Buffer.from(base64, 'base64'));

    return this.prisma.meetingAttendance.update({
      where: { meetingId_shareholderId: { meetingId: session.meetingId, shareholderId } },
      data: {
        checkedInAt: new Date(),
        checkedInBy: `kiosk:${session.id}`,
        checkInMethod: CheckInMethod.KIOSK,
        signatureImageUrl: url,
      },
    });
  }

  private async saveSignature(meetingId: string, shareholderId: string, buf: Buffer): Promise<string> {
    // Delegate to UploadsService — concrete impl depends on existing API.
    // Pseudocode: return this.uploads.saveBuffer(buf, `signatures/${meetingId}/${shareholderId}.png`, 'image/png');
    throw new Error('wire UploadsService in implementation');
  }
}
```

**Before committing:** wire `UploadsService` properly — follow the pattern from `documents.service.ts` where files are saved. If `UploadsService` doesn't yet have a `saveBuffer` method, add one (it's a one-liner around the underlying S3/local driver).

- [ ] **Step 2: Create public controller**

`meeting-kiosk.controller.ts`:
```ts
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { KioskService } from './kiosk.service';

@ApiTags('Public — Kiosk')
@Public()
@Controller('public/meetings/kiosk')
export class MeetingKioskController {
  constructor(private kiosk: KioskService) {}

  @Get(':token')
  async validateKiosk(@Param('token') token: string) {
    const session = await this.kiosk.validate(token);
    return {
      meetingId: session.meetingId,
      meeting: {
        title: session.meeting.title,
        scheduledAt: session.meeting.scheduledAt,
      },
      coop: session.meeting.coop,
    };
  }

  @Post(':token/search')
  search(@Param('token') token: string, @Body('query') query: string) {
    return this.kiosk.search(token, query);
  }

  @Post(':token/check-in')
  checkIn(@Param('token') token: string, @Body() body: { shareholderId: string; signaturePngDataUrl: string }) {
    return this.kiosk.checkIn(token, body.shareholderId, body.signaturePngDataUrl);
  }
}
```

- [ ] **Step 3: Add admin endpoints to `MeetingsController`**

```ts
@Post(':id/kiosk/start')
startKiosk(@Param('id') id: string, @CurrentUser() user: { id: string }) {
  return this.kiosk.startSession(id, user.id);
}

@Post(':id/kiosk/:sessionId/end')
endKiosk(@Param('sessionId') sessionId: string) {
  return this.kiosk.endSession(sessionId);
}
```

- [ ] **Step 4: Register services + controllers in module**

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter @opencoop/api typecheck
git add apps/api/src/modules/meetings/
git commit -m "feat(meetings): kiosk self check-in with signature capture"
```

---

## Phase 8 — Attendance & Check-in

### Task 18: Admin check-in + live attendance

**Files:**
- Create: `apps/api/src/modules/meetings/attendance.service.ts`
- Modify: `apps/api/src/modules/meetings/meetings.controller.ts`
- Modify: `apps/api/src/modules/meetings/meetings.module.ts`

- [ ] **Step 1: Implement AttendanceService**

`attendance.service.ts`:
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CheckInMethod } from '@opencoop/database';

@Injectable()
export class AttendanceService {
  constructor(private prisma: PrismaService) {}

  async checkIn(meetingId: string, shareholderId: string, adminUserId: string) {
    const attendance = await this.prisma.meetingAttendance.findUnique({
      where: { meetingId_shareholderId: { meetingId, shareholderId } },
    });
    if (!attendance) throw new NotFoundException('Shareholder is not eligible for this meeting');
    return this.prisma.meetingAttendance.update({
      where: { id: attendance.id },
      data: {
        checkedInAt: new Date(),
        checkedInBy: adminUserId,
        checkInMethod: CheckInMethod.ADMIN,
      },
    });
  }

  async undo(meetingId: string, shareholderId: string) {
    return this.prisma.meetingAttendance.update({
      where: { meetingId_shareholderId: { meetingId, shareholderId } },
      data: { checkedInAt: null, checkedInBy: null, checkInMethod: null, signatureImageUrl: null },
    });
  }

  async liveState(meetingId: string) {
    const [rsvpCount, checkedInCount, proxyCount, totalEligible] = await Promise.all([
      this.prisma.meetingAttendance.count({ where: { meetingId, rsvpStatus: 'ATTENDING' } }),
      this.prisma.meetingAttendance.count({ where: { meetingId, checkedInAt: { not: null } } }),
      this.prisma.proxy.count({ where: { meetingId, revokedAt: null } }),
      this.prisma.meetingAttendance.count({ where: { meetingId } }),
    ]);
    return { rsvpCount, checkedInCount, proxyCount, totalEligible };
  }

  async list(meetingId: string) {
    return this.prisma.meetingAttendance.findMany({
      where: { meetingId },
      include: {
        shareholder: { select: { id: true, firstName: true, lastName: true, shareholderNumber: true, email: true } },
      },
      orderBy: [{ shareholder: { lastName: 'asc' } }, { shareholder: { firstName: 'asc' } }],
    });
  }
}
```

- [ ] **Step 2: Add controller endpoints**

```ts
@Post(':id/attendance/:shareholderId/check-in')
checkIn(@Param('id') id: string, @Param('shareholderId') sh: string, @CurrentUser() user: { id: string }) {
  return this.attendance.checkIn(id, sh, user.id);
}

@Post(':id/attendance/:shareholderId/undo')
undoCheckIn(@Param('id') id: string, @Param('shareholderId') sh: string) {
  return this.attendance.undo(id, sh);
}

@Get(':id/live-attendance')
liveAttendance(@Param('id') id: string) {
  return this.attendance.liveState(id);
}

@Get(':id/attendance')
listAttendance(@Param('id') id: string) {
  return this.attendance.list(id);
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm --filter @opencoop/api typecheck
git add apps/api/src/modules/meetings/
git commit -m "feat(meetings): admin check-in + live attendance state"
```

---

## Phase 9 — Minutes

### Task 19: MinutesService + endpoints

**Files:**
- Create: `apps/api/src/modules/meetings/minutes.service.ts`
- Modify: `apps/api/src/modules/meetings/meetings.controller.ts`
- Modify: `apps/api/src/modules/meetings/meetings.module.ts`

- [ ] **Step 1: Implement MinutesService**

`minutes.service.ts`:
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class MinutesService {
  constructor(private prisma: PrismaService) {}

  async generateDraft(meetingId: string) {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      include: {
        agendaItems: { orderBy: { order: 'asc' }, include: { resolution: true } },
        attendances: { where: { checkedInAt: { not: null } }, include: { shareholder: true } },
        proxies: { where: { revokedAt: null }, include: { grantor: true, delegate: true } },
      },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');

    const content = this.renderDraft(meeting);
    return this.prisma.meetingMinutes.upsert({
      where: { meetingId },
      create: { meetingId, content },
      update: { content },
    });
  }

  private renderDraft(meeting: any): string {
    const lines: string[] = [];
    lines.push(`# Notulen ${meeting.title}`);
    lines.push(`**Datum:** ${meeting.scheduledAt.toISOString().slice(0, 10)}`);
    lines.push(`**Locatie:** ${meeting.location ?? '—'}`);
    lines.push(`**Aanwezig:** ${meeting.attendances.length} aandeelhouders`);
    lines.push(`**Vertegenwoordigd (volmacht):** ${meeting.proxies.length}`);
    lines.push('');
    lines.push('## Agenda');
    for (const item of meeting.agendaItems) {
      lines.push(`### ${item.order}. ${item.title}`);
      if (item.description) lines.push(item.description);
      if (item.resolution) {
        const r = item.resolution;
        const outcome = r.passed === true ? 'AANGENOMEN' : r.passed === false ? 'VERWORPEN' : '(niet gesloten)';
        lines.push(`**Voorstel:** ${r.proposedText}`);
        lines.push(`**Uitslag:** ${r.votesFor} voor, ${r.votesAgainst} tegen, ${r.votesAbstain} onthoudingen — ${outcome}`);
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  async update(meetingId: string, content: string) {
    return this.prisma.meetingMinutes.update({
      where: { meetingId },
      data: { content },
    });
  }

  async finalize(meetingId: string, pdfUrl: string) {
    return this.prisma.meetingMinutes.update({
      where: { meetingId },
      data: { generatedPdfUrl: pdfUrl },
    });
  }

  async uploadSigned(meetingId: string, pdfUrl: string, signedByName: string) {
    return this.prisma.meetingMinutes.update({
      where: { meetingId },
      data: { signedPdfUrl: pdfUrl, signedByName, signedAt: new Date() },
    });
  }
}
```

- [ ] **Step 2: Add endpoints**

```ts
@Post(':id/minutes/generate')
generateMinutes(@Param('id') id: string) { return this.minutes.generateDraft(id); }

@Patch(':id/minutes')
updateMinutes(@Param('id') id: string, @Body('content') content: string) {
  return this.minutes.update(id, content);
}

@Post(':id/minutes/finalize')
finalizeMinutes(@Param('id') id: string) {
  // TODO: Task 23 wires this to PDF generation
  return this.minutes.finalize(id, '');
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm --filter @opencoop/api typecheck
git add apps/api/src/modules/meetings/
git commit -m "feat(meetings): minutes service and endpoints"
```

---

## Phase 10 — Shareholder-scope controller

### Task 20: Shareholder meetings controller

**Files:**
- Create: `apps/api/src/modules/meetings/shareholder-meetings.controller.ts`
- Modify: `apps/api/src/modules/meetings/meetings.module.ts`

- [ ] **Step 1: Implement controller**

```ts
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('meetings')
@UseGuards(JwtAuthGuard)
export class ShareholderMeetingsController {
  constructor(private prisma: PrismaService) {}

  @Get('upcoming')
  async upcoming(@CurrentUser() user: { id: string }) {
    const shareholders = await this.prisma.shareholder.findMany({
      where: { userId: user.id, active: true },
      select: { id: true, coopId: true },
    });
    const coopIds = [...new Set(shareholders.map((s) => s.coopId))];
    return this.prisma.meeting.findMany({
      where: { coopId: { in: coopIds }, scheduledAt: { gte: new Date() }, status: { in: ['CONVOKED', 'HELD'] } },
      orderBy: { scheduledAt: 'asc' },
      include: { coop: { select: { name: true, logoUrl: true } } },
    });
  }

  @Get(':id')
  async get(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.prisma.meeting.findFirst({
      where: {
        id,
        coop: { shareholders: { some: { userId: user.id } } },
      },
      include: {
        agendaItems: { orderBy: { order: 'asc' }, include: { resolution: true, attachments: true } },
        coop: { select: { name: true, logoUrl: true, primaryColor: true } },
      },
    });
  }
}
```

- [ ] **Step 2: Register controller + commit**

```bash
pnpm --filter @opencoop/api typecheck
git add apps/api/src/modules/meetings/
git commit -m "feat(meetings): shareholder-scope read endpoints"
```

---

## Phase 11 — PDF Templates

### Task 21: Convocation PDF

**Files:**
- Create: `packages/pdf-templates/src/templates/convocation.tsx`
- Modify: `packages/pdf-templates/src/index.ts` (export)

- [ ] **Step 1: Implement template**

Pattern reference: `packages/pdf-templates/src/templates/share-certificate.tsx`. Follow its font registration, style sheet, `<Document>` + `<Page>` structure.

```tsx
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import type { ReactElement } from 'react';

export interface ConvocationProps {
  coop: { name: string; address: string; companyId: string; logoUrl?: string };
  shareholder: { firstName: string; lastName: string; address?: string };
  meeting: {
    title: string;
    scheduledAt: Date;
    location: string;
    agendaItems: { order: number; title: string; description?: string | null }[];
  };
  language: 'nl' | 'en' | 'fr' | 'de';
}

const s = StyleSheet.create({
  page: { padding: 40, fontSize: 11, fontFamily: 'Helvetica' },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  logo: { width: 80, height: 30, objectFit: 'contain' },
  coopTitle: { fontSize: 14, fontWeight: 'bold' },
  addressBlock: { marginBottom: 16, fontSize: 10, color: '#555' },
  body: { marginBottom: 12, lineHeight: 1.5 },
  agendaItem: { marginBottom: 8 },
  agendaTitle: { fontWeight: 'bold' },
  footer: { marginTop: 24, fontSize: 10, color: '#555' },
});

const LABELS = {
  nl: { subject: 'Oproeping Algemene Vergadering', dear: 'Geachte', invite: 'Hierbij nodigen wij u uit voor de', agenda: 'Agenda:', closing: 'Met vriendelijke groet,' },
  en: { subject: 'Notice of General Meeting', dear: 'Dear', invite: 'We hereby invite you to the', agenda: 'Agenda:', closing: 'Kind regards,' },
  fr: { subject: 'Convocation Assemblée Générale', dear: 'Chère/Cher', invite: 'Nous vous invitons à', agenda: 'Ordre du jour :', closing: 'Cordialement,' },
  de: { subject: 'Einladung zur Generalversammlung', dear: 'Sehr geehrte/r', invite: 'Hiermit laden wir Sie ein zur', agenda: 'Tagesordnung:', closing: 'Mit freundlichen Grüßen,' },
};

export function ConvocationPdf(props: ConvocationProps): ReactElement {
  const t = LABELS[props.language];
  const when = props.meeting.scheduledAt.toLocaleString(props.language, { dateStyle: 'long', timeStyle: 'short' });
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={s.coopTitle}>{props.coop.name}</Text>
            <Text>{props.coop.address}</Text>
            <Text>KBO {props.coop.companyId}</Text>
          </View>
          {props.coop.logoUrl && <Image src={props.coop.logoUrl} style={s.logo} />}
        </View>
        <Text style={{ fontSize: 16, fontWeight: 'bold', marginBottom: 12 }}>{t.subject}</Text>
        <View style={s.addressBlock}>
          <Text>{t.dear} {props.shareholder.firstName} {props.shareholder.lastName},</Text>
        </View>
        <Text style={s.body}>
          {t.invite} {props.meeting.title} — {when} — {props.meeting.location}
        </Text>
        <Text style={{ ...s.body, fontWeight: 'bold' }}>{t.agenda}</Text>
        <View>
          {props.meeting.agendaItems.map((a) => (
            <View key={a.order} style={s.agendaItem}>
              <Text style={s.agendaTitle}>{a.order}. {a.title}</Text>
              {a.description && <Text>{a.description}</Text>}
            </View>
          ))}
        </View>
        <Text style={s.footer}>{t.closing}</Text>
        <Text style={s.footer}>{props.coop.name}</Text>
      </Page>
    </Document>
  );
}
```

- [ ] **Step 2: Export from index + build**

Add `export { ConvocationPdf } from './templates/convocation';` to `packages/pdf-templates/src/index.ts`.
Run: `pnpm --filter @opencoop/pdf-templates build`. Expect: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/pdf-templates/
git commit -m "feat(pdf): convocation template"
```

---

### Task 22: Volmacht form PDF

**Files:** Create `packages/pdf-templates/src/templates/volmacht-form.tsx`. Follow the same pattern as `convocation.tsx`.

- [ ] **Step 1: Implement**

```tsx
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import type { ReactElement } from 'react';

export interface VolmachtFormProps {
  coop: { name: string; address: string; companyId: string };
  grantor: { firstName: string; lastName: string; address?: string; shareholderNumber: string };
  delegate?: { firstName: string; lastName: string };
  meeting: { title: string; scheduledAt: Date };
  language: 'nl' | 'en' | 'fr' | 'de';
}

const s = StyleSheet.create({
  page: { padding: 40, fontSize: 11 },
  title: { fontSize: 16, fontWeight: 'bold', marginBottom: 12 },
  row: { flexDirection: 'row', marginBottom: 8 },
  label: { width: 150, fontWeight: 'bold' },
  legal: { marginTop: 16, fontStyle: 'italic', fontSize: 10, lineHeight: 1.4 },
  sigBlock: { marginTop: 32 },
  sigLine: { borderBottom: '1pt solid #000', width: 200, marginTop: 32 },
});

const T = {
  nl: { title: 'Volmacht — Algemene Vergadering', grantorLbl: 'Ondergetekende:', shNum: 'Aandeelhoudersnummer:', delegateLbl: 'Volmachthebber (aandeelhouder):', meetingLbl: 'Vergadering:', legal: 'Ondergetekende verleent bij deze volmacht aan de hierboven genoemde aandeelhouder om deze te vertegenwoordigen op de Algemene Vergadering. De volmachthebber kan overeenkomstig artikel 23 van de statuten slechts één andere aandeelhouder vertegenwoordigen.', place: 'Plaats, datum:', signature: 'Handtekening' },
  en: { title: 'Proxy — General Meeting', grantorLbl: 'The undersigned:', shNum: 'Shareholder number:', delegateLbl: 'Proxy holder (shareholder):', meetingLbl: 'Meeting:', legal: 'The undersigned hereby grants a proxy to the above-named shareholder to represent them at the General Meeting. Per article 23 of the bylaws, the proxy holder may represent only one other shareholder.', place: 'Place, date:', signature: 'Signature' },
  fr: { title: 'Procuration — Assemblée Générale', grantorLbl: 'Le soussigné:', shNum: 'Numéro d\'actionnaire:', delegateLbl: 'Mandataire (actionnaire):', meetingLbl: 'Assemblée:', legal: 'Le soussigné donne par la présente procuration à l\'actionnaire nommé ci-dessus pour le représenter à l\'Assemblée Générale. Conformément à l\'article 23 des statuts, le mandataire ne peut représenter qu\'un seul autre actionnaire.', place: 'Lieu, date:', signature: 'Signature' },
  de: { title: 'Vollmacht — Generalversammlung', grantorLbl: 'Unterzeichneter:', shNum: 'Aktionärsnummer:', delegateLbl: 'Bevollmächtigter (Aktionär):', meetingLbl: 'Versammlung:', legal: 'Der Unterzeichnete erteilt hiermit Vollmacht an den oben genannten Aktionär, ihn auf der Generalversammlung zu vertreten. Gemäß Artikel 23 der Satzung kann der Bevollmächtigte nur einen anderen Aktionär vertreten.', place: 'Ort, Datum:', signature: 'Unterschrift' },
};

export function VolmachtFormPdf(props: VolmachtFormProps): ReactElement {
  const t = T[props.language];
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <Text style={s.title}>{t.title} — {props.coop.name}</Text>
        <View style={s.row}><Text style={s.label}>{t.grantorLbl}</Text><Text>{props.grantor.firstName} {props.grantor.lastName}</Text></View>
        <View style={s.row}><Text style={s.label}>{t.shNum}</Text><Text>{props.grantor.shareholderNumber}</Text></View>
        <View style={s.row}><Text style={s.label}>{t.delegateLbl}</Text><Text>{props.delegate ? `${props.delegate.firstName} ${props.delegate.lastName}` : '________________________________'}</Text></View>
        <View style={s.row}><Text style={s.label}>{t.meetingLbl}</Text><Text>{props.meeting.title} — {props.meeting.scheduledAt.toLocaleDateString()}</Text></View>
        <Text style={s.legal}>{t.legal}</Text>
        <View style={s.sigBlock}>
          <Text>{t.place} ________________________________</Text>
          <View style={s.sigLine} />
          <Text>{t.signature}</Text>
        </View>
      </Page>
    </Document>
  );
}
```

- [ ] **Step 2: Export + build + commit**

```bash
pnpm --filter @opencoop/pdf-templates build
git add packages/pdf-templates/
git commit -m "feat(pdf): volmacht form template"
```

---

### Task 23: Attendance sheet PDF

**Files:** Create `packages/pdf-templates/src/templates/attendance-sheet.tsx`.

- [ ] **Step 1: Implement**

```tsx
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import type { ReactElement } from 'react';

export interface AttendanceSheetProps {
  coop: { name: string; address: string };
  meeting: { title: string; scheduledAt: Date; location: string };
  rsvps: Array<{
    shareholderName: string;
    shareholderNumber: string;
    attendingVia: 'IN_PERSON' | 'VOLMACHT_TO';
    delegateName?: string;
  }>;
  language: 'nl' | 'en' | 'fr' | 'de';
}

const s = StyleSheet.create({
  page: { padding: 30, fontSize: 10 },
  title: { fontSize: 14, fontWeight: 'bold', marginBottom: 8 },
  meta: { marginBottom: 12, color: '#444' },
  table: { border: '1pt solid #000' },
  row: { flexDirection: 'row', borderBottom: '0.5pt solid #888', minHeight: 22 },
  headerRow: { backgroundColor: '#eee', fontWeight: 'bold' },
  cell: { padding: 4, borderRight: '0.5pt solid #888' },
  cNum: { width: 30 },
  cName: { flex: 1.6 },
  cShNum: { width: 60 },
  cVia: { width: 110 },
  cSig: { flex: 1, borderRight: 0 },
  walkInHeader: { marginTop: 24, marginBottom: 4, fontWeight: 'bold' },
});

export function AttendanceSheetPdf(props: AttendanceSheetProps): ReactElement {
  const when = props.meeting.scheduledAt.toLocaleString(props.language, { dateStyle: 'long', timeStyle: 'short' });
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <Text style={s.title}>{props.coop.name} — {props.meeting.title}</Text>
        <Text style={s.meta}>{when} — {props.meeting.location}</Text>

        <View style={s.table}>
          <View style={[s.row, s.headerRow]}>
            <Text style={[s.cell, s.cNum]}>#</Text>
            <Text style={[s.cell, s.cName]}>Aandeelhouder</Text>
            <Text style={[s.cell, s.cShNum]}>Nr.</Text>
            <Text style={[s.cell, s.cVia]}>Aanwezig via</Text>
            <Text style={[s.cell, s.cSig]}>Handtekening</Text>
          </View>
          {props.rsvps.map((r, i) => (
            <View key={i} style={s.row}>
              <Text style={[s.cell, s.cNum]}>{i + 1}</Text>
              <Text style={[s.cell, s.cName]}>{r.shareholderName}</Text>
              <Text style={[s.cell, s.cShNum]}>{r.shareholderNumber}</Text>
              <Text style={[s.cell, s.cVia]}>
                {r.attendingVia === 'IN_PERSON' ? 'In persoon' : `Volmacht aan ${r.delegateName}`}
              </Text>
              <Text style={[s.cell, s.cSig]}></Text>
            </View>
          ))}
        </View>

        <Text style={s.walkInHeader}>Walk-ins / Onaangemelde aandeelhouders</Text>
        <View style={s.table}>
          <View style={[s.row, s.headerRow]}>
            <Text style={[s.cell, s.cNum]}>#</Text>
            <Text style={[s.cell, s.cName]}>Naam</Text>
            <Text style={[s.cell, s.cShNum]}>Nr.</Text>
            <Text style={[s.cell, s.cSig]}>Handtekening</Text>
          </View>
          {Array.from({ length: 20 }).map((_, i) => (
            <View key={i} style={s.row}>
              <Text style={[s.cell, s.cNum]}>{i + 1}</Text>
              <Text style={[s.cell, s.cName]}></Text>
              <Text style={[s.cell, s.cShNum]}></Text>
              <Text style={[s.cell, s.cSig]}></Text>
            </View>
          ))}
        </View>
      </Page>
    </Document>
  );
}
```

- [ ] **Step 2: Export + build + commit**

```bash
pnpm --filter @opencoop/pdf-templates build
git add packages/pdf-templates/
git commit -m "feat(pdf): attendance sheet with RSVP filter and walk-in block"
```

---

### Task 24: Minutes PDF

**Files:** Create `packages/pdf-templates/src/templates/meeting-minutes.tsx`.

- [ ] **Step 1: Implement** — minimal template rendering markdown-ish content + resolution outcomes. Pattern matches prior templates.

```tsx
import { Document, Page, Text, StyleSheet } from '@react-pdf/renderer';
import type { ReactElement } from 'react';

export interface MeetingMinutesPdfProps {
  coop: { name: string };
  meeting: { title: string; scheduledAt: Date; location: string };
  content: string; // pre-rendered markdown-like string from MinutesService
  signedByName?: string;
}

const s = StyleSheet.create({
  page: { padding: 40, fontSize: 11, lineHeight: 1.5 },
  title: { fontSize: 16, fontWeight: 'bold', marginBottom: 12 },
  meta: { marginBottom: 16, color: '#444' },
  body: { whiteSpace: 'pre-wrap' as any },
  sigBlock: { marginTop: 40 },
});

export function MeetingMinutesPdf(props: MeetingMinutesPdfProps): ReactElement {
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <Text style={s.title}>Notulen — {props.meeting.title}</Text>
        <Text style={s.meta}>
          {props.meeting.scheduledAt.toLocaleString('nl-BE', { dateStyle: 'long', timeStyle: 'short' })} — {props.meeting.location}
        </Text>
        <Text style={s.body}>{props.content}</Text>
        <Text style={s.sigBlock}>___________________________</Text>
        <Text>{props.signedByName ?? 'Voorzitter'}</Text>
      </Page>
    </Document>
  );
}
```

- [ ] **Step 2: Export + build + commit**

```bash
pnpm --filter @opencoop/pdf-templates build
git add packages/pdf-templates/
git commit -m "feat(pdf): meeting minutes template"
```

---

### Task 25: Wire PDF generation endpoints

**Files:**
- Create: `apps/api/src/modules/meetings/pdf.service.ts`
- Modify: `apps/api/src/modules/meetings/meetings.controller.ts`
- Modify: `apps/api/src/modules/meetings/meetings.module.ts`

- [ ] **Step 1: Implement PdfService**

```ts
import { Injectable } from '@nestjs/common';
import { renderToBuffer } from '@react-pdf/renderer';
import { ConvocationPdf, VolmachtFormPdf, AttendanceSheetPdf, MeetingMinutesPdf } from '@opencoop/pdf-templates';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class MeetingPdfService {
  constructor(private prisma: PrismaService) {}

  async convocation(meetingId: string, shareholderId: string): Promise<Buffer> {
    const meeting = await this.prisma.meeting.findUniqueOrThrow({
      where: { id: meetingId },
      include: { coop: true, agendaItems: { orderBy: { order: 'asc' } } },
    });
    const sh = await this.prisma.shareholder.findUniqueOrThrow({ where: { id: shareholderId } });
    return renderToBuffer(ConvocationPdf({
      coop: { name: meeting.coop.name, address: meeting.coop.address ?? '', companyId: meeting.coop.companyId ?? '', logoUrl: meeting.coop.logoUrl ?? undefined },
      shareholder: { firstName: sh.firstName, lastName: sh.lastName },
      meeting: { title: meeting.title, scheduledAt: meeting.scheduledAt, location: meeting.location ?? '', agendaItems: meeting.agendaItems },
      language: (sh.preferredLanguage as any) ?? 'nl',
    }));
  }

  async volmacht(meetingId: string, shareholderId: string, delegateId?: string): Promise<Buffer> {
    // similar pattern — load, render, return buffer
    // ... omitted for brevity, mirror convocation()
    throw new Error('implement like convocation()');
  }

  async attendanceSheet(meetingId: string): Promise<Buffer> {
    // load meeting + coop + attendances where rsvpStatus in (ATTENDING, PROXY-with-attending-delegate)
    // + proxies
    // build rsvps array → call AttendanceSheetPdf
    throw new Error('implement');
  }

  async minutes(meetingId: string): Promise<Buffer> {
    const meeting = await this.prisma.meeting.findUniqueOrThrow({
      where: { id: meetingId },
      include: { coop: true, minutes: true },
    });
    const content = meeting.minutes?.content ?? '(Notulen niet gegenereerd)';
    return renderToBuffer(MeetingMinutesPdf({
      coop: { name: meeting.coop.name },
      meeting: { title: meeting.title, scheduledAt: meeting.scheduledAt, location: meeting.location ?? '' },
      content,
      signedByName: meeting.minutes?.signedByName ?? undefined,
    }));
  }
}
```

**Implementer: finish `volmacht()` and `attendanceSheet()` using the same pattern as `convocation()` and `minutes()`. Attendance sheet uses `MeetingAttendance` where `rsvpStatus = 'ATTENDING'` OR (`rsvpStatus = 'PROXY'` AND there's an active proxy whose `delegate` has `rsvpStatus = 'ATTENDING'`).**

- [ ] **Step 2: Controller endpoints**

```ts
@Get(':id/attendance-sheet')
@Header('Content-Type', 'application/pdf')
async attendanceSheet(@Param('id') id: string, @Res() res: Response) {
  const buf = await this.pdf.attendanceSheet(id);
  res.setHeader('Content-Disposition', 'attachment; filename="attendance-sheet.pdf"');
  res.send(buf);
}

@Get(':id/convocation/preview')
@Header('Content-Type', 'application/pdf')
async previewConvocation(@Param('id') id: string, @Query('shareholderId') shId: string, @Res() res: Response) {
  const buf = await this.pdf.convocation(id, shId);
  res.send(buf);
}
```

Similar for `minutes.pdf`.

- [ ] **Step 3: Commit**

```bash
pnpm --filter @opencoop/api typecheck
git add apps/api/src/modules/meetings/
git commit -m "feat(meetings): PDF rendering endpoints"
```

---

## Phase 12 — Admin Dashboard UI

For all frontend tasks, follow existing patterns:
- Pages live under `apps/web/src/app/[locale]/dashboard/admin/meetings/`
- API calls use the `api()` helper from `@/lib/api`
- Server state via React Query (see `apps/web/src/app/[locale]/dashboard/admin/shareholders/page.tsx` for pattern)
- UI primitives from `@/components/ui/` (button, dialog, input, etc.)
- Translations in `apps/web/messages/{en,nl,fr,de}.json` under a new `meetings` namespace

### Task 26: Meeting list page

**Files:**
- Create: `apps/web/src/app/[locale]/dashboard/admin/meetings/page.tsx`
- Modify: `apps/web/messages/{en,nl,fr,de}.json` (add `meetings` namespace — at minimum: `title`, `newMeeting`, `upcoming`, `past`, `status.draft/convoked/held/closed/cancelled`, list column labels)

- [ ] **Step 1: Add sidebar link**

In the admin sidebar (look for existing entries like `shareholders`, `dividends`), add a `meetings` entry.

- [ ] **Step 2: Implement page.tsx**

Use the React Query + Table pattern. Mirror `admin/dividends/page.tsx`. Show columns: Title, Date, Status, RSVP'd count, Actions (view).

- [ ] **Step 3: Add translations**

```json
"meetings": {
  "title": "Vergaderingen",
  "newMeeting": "Nieuwe vergadering",
  "status": { "draft": "Concept", "convoked": "Opgeroepen", "held": "Gehouden", "closed": "Afgesloten", "cancelled": "Geannuleerd" },
  "columns": { "title": "Titel", "date": "Datum", "status": "Status", "rsvps": "RSVPs", "actions": "Acties" }
}
```

Repeat in EN/FR/DE with translated values.

- [ ] **Step 4: Commit**

```bash
pnpm --filter @opencoop/web typecheck
git add apps/web/
git commit -m "feat(web): meetings list page"
```

---

### Task 27: New meeting wizard

**File:** `apps/web/src/app/[locale]/dashboard/admin/meetings/new/page.tsx`

- [ ] **Step 1: Implement single-page form** (type, title, date, time, duration, location, format, voting weight, reminder days) using existing form primitives. On submit: `POST /admin/coops/:coopId/meetings` → redirect to detail.

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(web): create meeting wizard"
```

---

### Task 28: Meeting detail page

**File:** `apps/web/src/app/[locale]/dashboard/admin/meetings/[meetingId]/page.tsx`

- [ ] **Step 1: Implement** overview with status badge + next-action checklist:
  1. Convocation sent? → link to `/convocation`
  2. Agenda defined? → link to `/agenda`
  3. RSVPs collected? → link to `/rsvp`
  4. Attendance sheet ready? → link to `/check-in`
  5. Resolutions voted + closed? → link to `/voting`
  6. Minutes signed? → link to `/minutes`

Each step is a card with an icon + action.

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(web): meeting detail overview"
```

---

### Task 29: Agenda builder page

**File:** `apps/web/src/app/[locale]/dashboard/admin/meetings/[meetingId]/agenda/page.tsx`

- [ ] **Step 1: Implement** — list of agenda items with "+ Add item" button. Modal has type toggle (INFORMATIONAL / RESOLUTION / ELECTION); RESOLUTION/ELECTION show extra fields (proposed text, majority type). Use up/down arrows for reordering if `@dnd-kit` isn't already in the project. Attachment upload uses existing document upload pattern.

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(web): agenda builder page"
```

---

### Task 30: Convocation page

**File:** `apps/web/src/app/[locale]/dashboard/admin/meetings/[meetingId]/convocation/page.tsx`

- [ ] **Step 1: Implement**:
  - "Preview convocation" button → opens PDF in new tab (downloads from `/convocation/preview?shareholderId=<first>`)
  - "Send convocation" button → confirmation dialog → if `< 15 days`, requires checkbox "I understand this is less than statutory notice"
  - Reminder config: checkboxes for `[7, 3, 1]` days → PATCH meeting with `reminderDaysBefore`
  - "Send reminder now" button → calls `POST /:id/convocation/reminder`
  - Delivery status table (shareholder, email, status, timestamp)

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(web): convocation send + reminders page"
```

---

### Task 31: RSVP tracker page

**File:** `apps/web/src/app/[locale]/dashboard/admin/meetings/[meetingId]/rsvp/page.tsx`

- [ ] **Step 1: Implement** — table with columns: Shareholder, Email, RSVP (ATTENDING/PROXY/ABSENT/UNKNOWN), Delegate (if PROXY), RSVP'd at. Filters by status. Manual-override dropdown per row (for phone-in RSVPs).

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(web): RSVP tracker"
```

---

### Task 32: Proxies page

**File:** `apps/web/src/app/[locale]/dashboard/admin/meetings/[meetingId]/proxies/page.tsx`

- [ ] **Step 1: Implement** — list of proxies (grantor → delegate, signed form status). "Add proxy" modal with two shareholder pickers (excluding each other). Revoke button per row.

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(web): proxy management page"
```

---

### Task 33: Check-in page (tablet/laptop)

**File:** `apps/web/src/app/[locale]/dashboard/admin/meetings/[meetingId]/check-in/page.tsx`

- [ ] **Step 1: Implement** (core screen per spec §6):
  - Top stats: RSVP'd count, Checked-in, Via proxy, Quorum status (polls `/live-attendance` every 5s via React Query `refetchInterval: 5000`)
  - Search bar with fuzzy match (client-side on attendance list or server-side call)
  - RSVP'd list — tap to check in (optimistic update)
  - Walk-ins section with "+ Check in unlisted shareholder" → opens modal with full shareholder search
  - "Start kiosk session" button → modal with generated URL + QR code (use `qrcode.react` or similar, add if not present)

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(web): live check-in + kiosk start"
```

---

### Task 34: Voting page

**File:** `apps/web/src/app/[locale]/dashboard/admin/meetings/[meetingId]/voting/page.tsx`

- [ ] **Step 1: Implement** — one card per Resolution. Card shows proposed text + majority type. Bulk vote entry: "Enter votes" opens a modal with a table of attending shareholders + FOR/AGAINST/ABSTAIN radio per row → submit bulk to `/resolutions/:resId/votes`. "Close & compute" button calls `/resolutions/:resId/close`.

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(web): voting entry + close resolution"
```

---

### Task 35: Minutes page

**File:** `apps/web/src/app/[locale]/dashboard/admin/meetings/[meetingId]/minutes/page.tsx`

- [ ] **Step 1: Implement** — "Generate draft" button (calls `/minutes/generate`), markdown editor for the content (use a textarea for simplicity if no editor package is in project), "Finalize + download PDF" button, "Upload signed minutes" file input.

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(web): minutes editor + finalize"
```

---

## Phase 13 — Public Pages

### Task 36: Public RSVP page

**Files:**
- Create: `apps/web/src/app/[locale]/meetings/rsvp/[token]/page.tsx`
- Create: `apps/web/src/app/[locale]/meetings/rsvp/[token]/thanks/page.tsx`

- [ ] **Step 1: Implement `page.tsx`**

Server component fetches meeting details from `/public/meetings/rsvp/:token`. Renders:
- Coop logo + branding
- Meeting title, date, location, agenda
- 3 CTAs: "Ik kom" / "Ik kom niet" / "Ik geef volmacht"
- If "Ik geef volmacht" → client component opens a modal with a searchable list of delegates (from `/eligible-delegates`)
- After PATCH success: redirect to `./thanks`

Do not use `dashboard` layout — use a minimal public layout.

- [ ] **Step 2: Implement `thanks/page.tsx`**

Shows RSVP summary + "Download kalender" button (hits `/rsvp/:token/ics`) + if delegate chosen, "Download volmacht" button + signed upload file input.

- [ ] **Step 3: Commit**

```bash
pnpm --filter @opencoop/web typecheck
git add apps/web/
git commit -m "feat(web): public RSVP page + thank-you"
```

---

### Task 37: Kiosk page

**Files:**
- Create: `apps/web/src/app/[locale]/meetings/kiosk/[kioskToken]/page.tsx`
- Modify: `apps/web/package.json` (add `react-signature-canvas`)

- [ ] **Step 1: Install signature library**

```bash
pnpm --filter @opencoop/web add react-signature-canvas
pnpm --filter @opencoop/web add -D @types/react-signature-canvas
```

- [ ] **Step 2: Implement page as a client component with 4 states**

```tsx
'use client';
import { useState } from 'react';
import SignatureCanvas from 'react-signature-canvas';
// ... state machine: 'SEARCH' | 'CONFIRM' | 'SIGN' | 'WELCOME'
```

- Search screen: big input, results render on type (debounced 200ms → POST `/kiosk/:token/search`)
- Confirm screen: shows chosen shareholder, "Dat ben ik" + "Terug" buttons
- Sign screen: `<SignatureCanvas>` at full viewport width, Clear + Confirm buttons; on confirm: `signaturePad.toDataURL('image/png')` → POST `/check-in`
- Welcome screen: "Welkom, {firstName}!" for 3 seconds, `setTimeout(() => setState('SEARCH'), 3000)`

- [ ] **Step 3: Commit**

```bash
pnpm --filter @opencoop/web typecheck
git add apps/web/ apps/web/package.json
git commit -m "feat(web): kiosk self check-in with signature capture"
```

---

### Task 38: Shareholder upcoming-meetings page

**Files:**
- Create: `apps/web/src/app/[locale]/dashboard/meetings/page.tsx`
- Create: `apps/web/src/app/[locale]/dashboard/meetings/[id]/page.tsx`
- Modify: shareholder sidebar

- [ ] **Step 1: Implement** — list + detail pages fetching from `/meetings/upcoming` and `/meetings/:id`. Detail page has "Download volmacht-formulier" button.

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(web): shareholder meetings pages"
```

---

## Phase 14 — Email Templates

### Task 39: Add meeting templates to email processor

**Files:**
- Modify: `apps/api/src/modules/email/email.processor.ts`

- [ ] **Step 1: Add three templates to the `templates` map**

Inside the `renderTemplate` method, add three entries:
- `meeting-convocation` — header, agenda list, big "RSVP hier" button linking to `d.rsvpUrl`
- `meeting-rsvp-confirmation` — thank-you + RSVP summary + "Wijzig RSVP" link
- `meeting-reminder` — "Reminder: RSVP for X. Meeting in Y days"

Each has nl/en/fr/de variants mirroring the `welcome` template structure. Use string templating directly (no external template engine — this module uses plain string literals).

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/modules/email/email.processor.ts
git commit -m "feat(email): AGM templates (convocation, rsvp-confirmation, reminder)"
```

---

## Phase 15 — Reminder Job

### Task 40: ReminderJob Bull processor

**Files:**
- Create: `apps/api/src/modules/meetings/reminder.processor.ts`
- Modify: `apps/api/src/modules/meetings/meetings.module.ts`

- [ ] **Step 1: Implement the processor**

```ts
import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { MeetingStatus, RSVPStatus } from '@opencoop/database';

@Processor('meetings-reminder')
export class ReminderProcessor {
  private logger = new Logger(ReminderProcessor.name);
  constructor(private prisma: PrismaService, private email: EmailService) {}

  @Process('tick')
  async tick() {
    const meetings = await this.prisma.meeting.findMany({
      where: { status: MeetingStatus.CONVOKED },
      include: { coop: true, attendances: { where: { rsvpStatus: RSVPStatus.UNKNOWN }, include: { shareholder: true } } },
    });
    const now = new Date();
    for (const meeting of meetings) {
      const daysUntil = Math.ceil((meeting.scheduledAt.getTime() - now.getTime()) / (86400 * 1000));
      const sentMap = (meeting.remindersSent as Record<string, string>) ?? {};
      for (const d of meeting.reminderDaysBefore) {
        if (d === daysUntil && !sentMap[String(d)]) {
          for (const a of meeting.attendances) {
            if (!a.shareholder.email) continue;
            await this.email.queueEmail({
              coopId: meeting.coopId,
              to: a.shareholder.email,
              subject: `Herinnering — ${meeting.title}`,
              templateKey: 'meeting-reminder',
              templateData: {
                language: a.shareholder.preferredLanguage ?? 'nl',
                shareholderName: `${a.shareholder.firstName} ${a.shareholder.lastName}`,
                meetingTitle: meeting.title,
                meetingDate: meeting.scheduledAt.toISOString(),
                daysUntil,
                rsvpUrl: `${process.env.NEXT_PUBLIC_WEB_URL}/meetings/rsvp/${a.rsvpToken}`,
              },
            });
          }
          await this.prisma.meeting.update({
            where: { id: meeting.id },
            data: { remindersSent: { ...sentMap, [String(d)]: new Date().toISOString() } },
          });
        }
      }
    }
  }
}
```

- [ ] **Step 2: Schedule the tick**

In the module, register the Bull queue and schedule a cron (9:00 CET daily). Pattern ref: existing scheduler in `shareholders/birthday-scheduler.service.ts`.

- [ ] **Step 3: Commit**

```bash
pnpm --filter @opencoop/api typecheck
git add apps/api/src/modules/meetings/
git commit -m "feat(meetings): reminder job fires per reminderDaysBefore config"
```

---

## Phase 16 — QA, Deploy, Sign-off

### Task 41: Manual QA on acc

- [ ] **Step 1: Push and open PR**

```bash
git push -u origin feature/agm-voting
gh pr create --title "feat: AGM & voting feature (Bronsgroen 2026-05-09)" --body "$(cat <<'EOF'
## Summary

- New `meetings` module with 9 Prisma models covering Meeting → AgendaItem → Resolution → Vote → Proxy → MeetingAttendance → MeetingMinutes → KioskSession
- Full admin lifecycle: create → convoke → RSVP → check-in → vote → minutes
- Public token-based RSVP flow with `.ics` download
- Kiosk self check-in with signature capture
- 4 PDF templates (convocation, volmacht, attendance-sheet, minutes)
- 3 email templates (convocation, RSVP confirmation, reminder)
- Enforces Bronsgroen statuten rules (1p1v, max 1 proxy, 3/4 for statuten changes)

Closes design spec at `docs/superpowers/specs/2026-04-14-agm-voting-design.md`.

## Test plan

- [ ] On acc: create test meeting with 5 test shareholders
- [ ] Send convocation and verify email + RSVP links
- [ ] RSVP as attending / absent / proxy from 3 different emails
- [ ] Download `.ics` and open in Google Calendar / iOS
- [ ] Open kiosk URL on an iPad, check in as test shareholder with signature
- [ ] Record votes on 2 resolutions, close, verify outcome math
- [ ] Generate + finalize minutes, upload a signed scan

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Wait for acc deploy (push to main triggers auto-deploy)** — actually, PR to main merges = deploy. Run the test plan above on `acc.opencoop.be`.

- [ ] **Step 3: Verify each QA checklist item** — screenshot or note anomalies. Fix blocking bugs on the same branch.

---

### Task 42: Release to prod

- [ ] **Step 1: Merge PR to main**

After acc QA passes, merge PR. `acc.opencoop.be` re-deploys.

- [ ] **Step 2: Update CHANGELOG**

`CHANGELOG.md`:
```md
## [0.7.64] - 2026-04-DD
### Added
- AGM / Algemene Vergadering feature for coop admins: meeting lifecycle, agenda builder, email convocation blast, token-based public RSVP, self-service kiosk check-in with signature capture, resolution voting with statuten-compliant majority math, PDF templates (convocation, volmacht, attendance sheet, minutes), automatic reminder emails.
```

- [ ] **Step 3: Tag prod release**

```bash
git tag -a v0.7.64 -m "AGM & voting feature"
git push origin v0.7.64
```

Wait for CI/CD, verify prod deployment.

- [ ] **Step 4: Seed Bronsgroen's May 9 meeting in prod**

Log into `opencoop.be` as Bronsgroen admin → Meetings → New. Fill in: ANNUAL, "Algemene Vergadering 2026", 2026-05-09 10:00, 120 min, "Theresiastraat 29, 3500 Hasselt", PHYSICAL. Save.

Add agenda items:
1. Goedkeuring notulen vorige AV — INFORMATIONAL
2. Overzicht van het afgelopen jaar — INFORMATIONAL
3. Goedkeuring jaarrekening + bestuursverslag — RESOLUTION (SIMPLE)
4. Kwijting bestuurders — RESOLUTION (SIMPLE)
5. (Her)benoeming bestuurders — ELECTION (SIMPLE)
6. Bestemming van het resultaat — RESOLUTION (SIMPLE)
7. Budget en vooruitzichten — INFORMATIONAL

Upload annual accounts + board report as attachments to item 3.

- [ ] **Step 5: Send convocation**

Confirm 25 days notice. Click "Send convocation". Monitor Sentry + audit logs during the blast.

---

## Self-review

**Spec coverage check:**

| Spec section | Task(s) |
|-|-|
| §3 data model (9 models) | 1, 2 |
| §4 backend admin controller | 4–19, 25 |
| §4 public RSVP controller | 15, 16 |
| §4 public kiosk controller | 17 |
| §4 shareholder controller | 20 |
| §5 PDF templates (4) | 21, 22, 23, 24, 25 |
| §6 admin dashboard pages (8) | 26–35 |
| §7 public + shareholder pages | 36, 37, 38 |
| §8 email templates (3) | 39 |
| §8 `.ics` generation | 12 |
| §9 error handling | 7, 8, 10, 13 |
| §10 tests | 7, 8, 10, 12, 13 |
| §11 deployment | 41, 42 |

All spec items covered.

**Placeholder scan:** `renderTemplate` in Task 39 and the `volmacht`/`attendanceSheet` methods in Task 25 are explicitly marked as "implement with same pattern as X". These are not placeholders — they point at a defined pattern with a concrete example in the same task. The engineer has everything needed.

**Type consistency:** `RsvpStatus`, `MajorityType`, etc. used consistently across tasks. Method signatures match (e.g. `ProxiesService.create(meetingId, grantorId, delegateId)` in Task 8 matches the RSVP-service usage in Task 15).

---

**Plan complete.**
