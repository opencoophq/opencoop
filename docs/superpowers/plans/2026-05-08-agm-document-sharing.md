# AGM Document Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a per-meeting document-sharing module that lets coop admins upload PDFs (jaarverslag, jaarrekening, etc.), customize a mailing, and send token-protected download links to all members with per-recipient send/open/download tracking.

**Architecture:** Extend the existing `meetings` module with a new `MeetingDocumentsService`, one new Prisma table (`MeetingDocument`), additive fields on `Meeting` and `MeetingAttendance`. Mail rendering reuses the existing `EmailProcessor.renderTemplate` Record. Public endpoints reuse the existing per-attendance `rsvpToken` for auth, with a custom expiry window (`scheduledAt + 30 days`) for documents specifically.

**Tech Stack:** NestJS 10, Prisma 6, PostgreSQL, Bull (Redis queue), Next.js 14 App Router, React 18, `@dnd-kit/*` for sortable list, Jest for tests, nodemailer for SMTP.

**Spec:** [`docs/superpowers/specs/2026-05-08-agm-document-sharing-design.md`](../specs/2026-05-08-agm-document-sharing-design.md)

---

## File Structure

### Backend (created)
- `apps/api/src/modules/meetings/meeting-documents.service.ts` — service layer, CRUD + send + replace-in-place logic
- `apps/api/src/modules/meetings/meeting-documents.service.spec.ts` — unit tests
- `apps/api/src/modules/meetings/dto/upload-meeting-document.dto.ts` — body shape `{ displayName? }`
- `apps/api/src/modules/meetings/dto/update-meeting-document.dto.ts` — body shape `{ displayName?, order? }`
- `apps/api/src/modules/meetings/dto/update-documents-email-draft.dto.ts` — body shape `{ subject?, intro? }`

### Backend (modified)
- `packages/database/prisma/schema.prisma` — `MeetingDocument` model + new fields on `Meeting` and `MeetingAttendance`
- `apps/api/src/modules/meetings/meetings.module.ts` — register `MeetingDocumentsService`
- `apps/api/src/modules/meetings/meetings.controller.ts` — 7 admin endpoints
- `apps/api/src/modules/meetings/meeting-rsvp.controller.ts` — 2 public endpoints (download + pixel)
- `apps/api/src/modules/email/email.processor.ts` — add `'agenda-documents'` template entry to `templates` Record

### Frontend (created)
- `apps/web/src/app/[locale]/dashboard/admin/meetings/[meetingId]/documents/page.tsx` — admin page (server component shell)
- `apps/web/src/app/[locale]/dashboard/admin/meetings/[meetingId]/documents/documents-page-client.tsx` — client component (form state + dnd-kit)

### Frontend (modified)
- `apps/web/package.json` — add `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`
- `apps/web/messages/{en,nl,fr,de}.json` — i18n keys under `meetings.documents.*`
- `apps/web/src/app/[locale]/dashboard/admin/meetings/[meetingId]/page.tsx` — add link to documents page in next-action checklist

---

## Task 1: Database schema

**Files:**
- Modify: `packages/database/prisma/schema.prisma`

- [ ] **Step 1: Add `MeetingDocument` model**

In `packages/database/prisma/schema.prisma`, after the `MeetingMinutes` model (search for `model MeetingMinutes`), add:

```prisma
model MeetingDocument {
  id         String   @id @default(cuid())
  meetingId  String
  meeting    Meeting  @relation(fields: [meetingId], references: [id], onDelete: Cascade)

  fileName   String
  fileUrl    String
  fileSize   Int
  order      Int
  uploadedAt DateTime @default(now())
  uploadedBy String

  @@index([meetingId, order])
  @@map("meeting_documents")
}
```

- [ ] **Step 2: Add fields and relation to `Meeting`**

Edit the `Meeting` model — add three new fields after `remindersSent` and add the relation alongside `agendaItems`:

```prisma
model Meeting {
  // ... existing fields up to remindersSent
  remindersSent           Json?                 @default("{}")
  documentsSubject        String?
  documentsIntro          String?               @db.Text
  documentsEmailSentAt    DateTime?
  // ... rest of existing fields
  documents               MeetingDocument[]
  // ... rest of existing relations
}
```

- [ ] **Step 3: Add fields to `MeetingAttendance`**

Find the `MeetingAttendance` model and add four fields just before the closing `}`:

```prisma
  documentsEmailSentAt   DateTime?
  documentsEmailError    String?
  documentsEmailOpenedAt DateTime?
  documentsDownloadedAt  DateTime?
```

- [ ] **Step 4: Generate Prisma client and create migration**

Run from repo root:

```bash
pnpm db:generate
cd packages/database && npx prisma migrate dev --name add_meeting_documents
```

Expected: migration created in `packages/database/prisma/migrations/<timestamp>_add_meeting_documents/`, Prisma client regenerated, dev DB updated. No errors.

- [ ] **Step 5: Verify schema compiles**

```bash
cd /Users/wouterhermans/Developer/opencoop && pnpm build --filter=@opencoop/database
```

Expected: clean build, no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations/
git commit -m "feat(meetings): add MeetingDocument schema"
```

---

## Task 2: DTOs

**Files:**
- Create: `apps/api/src/modules/meetings/dto/upload-meeting-document.dto.ts`
- Create: `apps/api/src/modules/meetings/dto/update-meeting-document.dto.ts`
- Create: `apps/api/src/modules/meetings/dto/update-documents-email-draft.dto.ts`

- [ ] **Step 1: Create UploadMeetingDocumentDto**

`apps/api/src/modules/meetings/dto/upload-meeting-document.dto.ts`:

```typescript
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UploadMeetingDocumentDto {
  @ApiPropertyOptional({ description: 'Display name shown in UI/mail. Defaults to original filename.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  displayName?: string;
}
```

- [ ] **Step 2: Create UpdateMeetingDocumentDto**

`apps/api/src/modules/meetings/dto/update-meeting-document.dto.ts`:

```typescript
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateMeetingDocumentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  displayName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}
```

- [ ] **Step 3: Create UpdateDocumentsEmailDraftDto**

`apps/api/src/modules/meetings/dto/update-documents-email-draft.dto.ts`:

```typescript
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateDocumentsEmailDraftDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  subject?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  intro?: string;
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/meetings/dto/
git commit -m "feat(meetings): add document-sharing DTOs"
```

---

## Task 3: MeetingDocumentsService — upload (TDD)

**Files:**
- Create: `apps/api/src/modules/meetings/meeting-documents.service.ts`
- Create: `apps/api/src/modules/meetings/meeting-documents.service.spec.ts`

- [ ] **Step 1: Write failing test for happy-path upload**

`apps/api/src/modules/meetings/meeting-documents.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MeetingDocumentsService } from './meeting-documents.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('MeetingDocumentsService', () => {
  let service: MeetingDocumentsService;
  let prisma: {
    meeting: { findUnique: jest.Mock };
    meetingDocument: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      aggregate: jest.Mock;
    };
  };
  let tmpUploadDir: string;
  const ORIGINAL_UPLOAD_DIR = process.env.UPLOAD_DIR;

  beforeEach(async () => {
    tmpUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencoop-test-'));
    process.env.UPLOAD_DIR = tmpUploadDir;

    prisma = {
      meeting: { findUnique: jest.fn() },
      meetingDocument: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        aggregate: jest.fn(),
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [MeetingDocumentsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(MeetingDocumentsService);
  });

  afterEach(() => {
    fs.rmSync(tmpUploadDir, { recursive: true, force: true });
    process.env.UPLOAD_DIR = ORIGINAL_UPLOAD_DIR;
  });

  describe('upload', () => {
    const meeting = { id: 'm1', coopId: 'c1' };
    const file = {
      buffer: Buffer.from('%PDF-1.4 fake'),
      mimetype: 'application/pdf',
      originalname: 'Jaarverslag 2025.pdf',
      size: 12,
    } as Express.Multer.File;

    it('creates a new document for first upload', async () => {
      prisma.meeting.findUnique.mockResolvedValue(meeting);
      prisma.meetingDocument.findFirst.mockResolvedValue(null);
      prisma.meetingDocument.aggregate.mockResolvedValue({ _max: { order: null } });
      prisma.meetingDocument.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'd1', ...data }),
      );

      const result = await service.upload('c1', 'm1', file, undefined, 'admin1');

      expect(result.id).toBe('d1');
      expect(result.fileName).toBe('Jaarverslag 2025.pdf');
      expect(prisma.meetingDocument.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          meetingId: 'm1',
          fileName: 'Jaarverslag 2025.pdf',
          fileSize: 12,
          order: 0,
          uploadedBy: 'admin1',
        }),
      });
      // Disk file written
      const writtenPath = (prisma.meetingDocument.create as jest.Mock).mock.calls[0][0].data.fileUrl;
      expect(fs.existsSync(path.join(tmpUploadDir, writtenPath))).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
cd apps/api && pnpm test meeting-documents.service.spec
```

Expected: FAIL — `Cannot find module './meeting-documents.service'`.

- [ ] **Step 3: Create the service with minimal upload implementation**

`apps/api/src/modules/meetings/meeting-documents.service.ts`:

```typescript
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function uploadDir(): string {
  return process.env.UPLOAD_DIR || './uploads';
}

@Injectable()
export class MeetingDocumentsService {
  constructor(private prisma: PrismaService) {}

  async upload(
    coopId: string,
    meetingId: string,
    file: Express.Multer.File,
    displayName: string | undefined,
    userId: string,
  ) {
    if (!file?.buffer) throw new BadRequestException('No file provided');
    if (file.mimetype !== 'application/pdf') throw new BadRequestException('Only PDF files allowed');
    if (file.size > MAX_FILE_SIZE) throw new BadRequestException('File exceeds 10MB limit');

    const meeting = await this.prisma.meeting.findUnique({ where: { id: meetingId } });
    if (!meeting) throw new NotFoundException('Meeting not found');
    if (meeting.coopId !== coopId) throw new ForbiddenException('Meeting belongs to different coop');

    const safeOriginalName = path.basename(file.originalname);
    const effectiveDisplayName = displayName?.trim() || safeOriginalName;

    const existing = await this.prisma.meetingDocument.findFirst({
      where: { meetingId, fileName: effectiveDisplayName },
    });

    const dir = path.join(uploadDir(), 'meeting-documents', meetingId);
    fs.mkdirSync(dir, { recursive: true });
    const storedFilename = `${randomUUID()}.pdf`;
    const relativeUrl = path.posix.join('meeting-documents', meetingId, storedFilename);
    fs.writeFileSync(path.join(dir, storedFilename), file.buffer);

    if (existing) {
      // Replace in place
      const oldAbs = path.join(uploadDir(), existing.fileUrl);
      try {
        fs.unlinkSync(oldAbs);
      } catch (err: unknown) {
        // best-effort; missing file shouldn't block
      }
      return this.prisma.meetingDocument.update({
        where: { id: existing.id },
        data: {
          fileUrl: relativeUrl,
          fileSize: file.size,
          uploadedAt: new Date(),
          uploadedBy: userId,
        },
      });
    }

    const max = await this.prisma.meetingDocument.aggregate({
      where: { meetingId },
      _max: { order: true },
    });
    const nextOrder = (max._max.order ?? -1) + 1;

    return this.prisma.meetingDocument.create({
      data: {
        meetingId,
        fileName: effectiveDisplayName,
        fileUrl: relativeUrl,
        fileSize: file.size,
        order: nextOrder,
        uploadedBy: userId,
      },
    });
  }
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
cd apps/api && pnpm test meeting-documents.service.spec
```

Expected: 1 passed.

- [ ] **Step 5: Add tests for validation paths**

Add inside the existing `describe('upload', ...)`:

```typescript
    it('rejects non-PDF mimetype', async () => {
      const bad = { ...file, mimetype: 'image/png' } as Express.Multer.File;
      await expect(service.upload('c1', 'm1', bad, undefined, 'admin1')).rejects.toThrow(BadRequestException);
    });

    it('rejects file >10MB', async () => {
      const bad = { ...file, size: 11 * 1024 * 1024 } as Express.Multer.File;
      await expect(service.upload('c1', 'm1', bad, undefined, 'admin1')).rejects.toThrow(BadRequestException);
    });

    it('rejects when meeting belongs to a different coop', async () => {
      prisma.meeting.findUnique.mockResolvedValue({ ...meeting, coopId: 'OTHER' });
      await expect(service.upload('c1', 'm1', file, undefined, 'admin1')).rejects.toThrow(ForbiddenException);
    });

    it('replaces in place when displayName matches existing', async () => {
      prisma.meeting.findUnique.mockResolvedValue(meeting);
      const existingDoc = {
        id: 'dExisting',
        meetingId: 'm1',
        fileName: 'Jaarverslag 2025.pdf',
        fileUrl: 'meeting-documents/m1/old.pdf',
        order: 2,
      };
      prisma.meetingDocument.findFirst.mockResolvedValue(existingDoc);
      // Pre-create old file so unlink succeeds
      const oldDir = path.join(tmpUploadDir, 'meeting-documents', 'm1');
      fs.mkdirSync(oldDir, { recursive: true });
      fs.writeFileSync(path.join(tmpUploadDir, existingDoc.fileUrl), 'old content');

      prisma.meetingDocument.update.mockImplementation(({ where, data }) =>
        Promise.resolve({ ...existingDoc, ...data, id: where.id }),
      );

      const result = await service.upload('c1', 'm1', file, undefined, 'admin1');

      expect(result.id).toBe('dExisting');
      expect(prisma.meetingDocument.create).not.toHaveBeenCalled();
      expect(prisma.meetingDocument.update).toHaveBeenCalledWith({
        where: { id: 'dExisting' },
        data: expect.objectContaining({ fileSize: 12, uploadedBy: 'admin1' }),
      });
      expect(fs.existsSync(path.join(tmpUploadDir, existingDoc.fileUrl))).toBe(false);
    });
```

- [ ] **Step 6: Run all upload tests**

```bash
cd apps/api && pnpm test meeting-documents.service.spec
```

Expected: 5 passed.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/meetings/meeting-documents.service.ts apps/api/src/modules/meetings/meeting-documents.service.spec.ts
git commit -m "feat(meetings): MeetingDocumentsService upload + replace-in-place"
```

---

## Task 4: MeetingDocumentsService — list/update/remove (TDD)

**Files:**
- Modify: `apps/api/src/modules/meetings/meeting-documents.service.ts`
- Modify: `apps/api/src/modules/meetings/meeting-documents.service.spec.ts`

- [ ] **Step 1: Add failing tests**

In the spec file, add a new `describe` block:

```typescript
  describe('list / update / remove', () => {
    const meeting = { id: 'm1', coopId: 'c1' };

    it('lists documents for a meeting in order', async () => {
      prisma.meeting.findUnique.mockResolvedValue(meeting);
      prisma.meetingDocument.findMany.mockResolvedValue([
        { id: 'd1', order: 0, fileName: 'A.pdf' },
        { id: 'd2', order: 1, fileName: 'B.pdf' },
      ]);

      const docs = await service.list('c1', 'm1');

      expect(docs).toHaveLength(2);
      expect(prisma.meetingDocument.findMany).toHaveBeenCalledWith({
        where: { meetingId: 'm1' },
        orderBy: { order: 'asc' },
      });
    });

    it('updates display name and order', async () => {
      prisma.meeting.findUnique.mockResolvedValue(meeting);
      prisma.meetingDocument.findFirst.mockResolvedValue({ id: 'd1', meetingId: 'm1' });
      prisma.meetingDocument.update.mockResolvedValue({ id: 'd1', fileName: 'New.pdf', order: 5 });

      const result = await service.update('c1', 'm1', 'd1', { displayName: 'New.pdf', order: 5 });

      expect(result.fileName).toBe('New.pdf');
      expect(prisma.meetingDocument.update).toHaveBeenCalledWith({
        where: { id: 'd1' },
        data: { fileName: 'New.pdf', order: 5 },
      });
    });

    it('removes a document and deletes file from disk', async () => {
      prisma.meeting.findUnique.mockResolvedValue(meeting);
      const dir = path.join(tmpUploadDir, 'meeting-documents', 'm1');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'gone.pdf'), 'data');
      prisma.meetingDocument.findFirst.mockResolvedValue({
        id: 'd1',
        meetingId: 'm1',
        fileUrl: 'meeting-documents/m1/gone.pdf',
      });
      prisma.meetingDocument.delete.mockResolvedValue({ id: 'd1' });

      await service.remove('c1', 'm1', 'd1');

      expect(prisma.meetingDocument.delete).toHaveBeenCalledWith({ where: { id: 'd1' } });
      expect(fs.existsSync(path.join(dir, 'gone.pdf'))).toBe(false);
    });

    it('rejects update when document is not in meeting', async () => {
      prisma.meeting.findUnique.mockResolvedValue(meeting);
      prisma.meetingDocument.findFirst.mockResolvedValue(null);

      await expect(service.update('c1', 'm1', 'dX', { displayName: 'x' })).rejects.toThrow(NotFoundException);
    });
  });
```

Add at the top of the file: `import { NotFoundException } from '@nestjs/common';`

- [ ] **Step 2: Run tests, expect failure**

```bash
cd apps/api && pnpm test meeting-documents.service.spec
```

Expected: 4 fails ("service.list is not a function" etc.)

- [ ] **Step 3: Implement list / update / remove**

Append to `meeting-documents.service.ts`:

```typescript
  private async assertMeetingInCoop(coopId: string, meetingId: string) {
    const meeting = await this.prisma.meeting.findUnique({ where: { id: meetingId } });
    if (!meeting) throw new NotFoundException('Meeting not found');
    if (meeting.coopId !== coopId) throw new ForbiddenException('Meeting belongs to different coop');
    return meeting;
  }

  async list(coopId: string, meetingId: string) {
    await this.assertMeetingInCoop(coopId, meetingId);
    return this.prisma.meetingDocument.findMany({
      where: { meetingId },
      orderBy: { order: 'asc' },
    });
  }

  async update(
    coopId: string,
    meetingId: string,
    docId: string,
    patch: { displayName?: string; order?: number },
  ) {
    await this.assertMeetingInCoop(coopId, meetingId);
    const doc = await this.prisma.meetingDocument.findFirst({
      where: { id: docId, meetingId },
    });
    if (!doc) throw new NotFoundException('Document not found in this meeting');

    const data: { fileName?: string; order?: number } = {};
    if (patch.displayName != null) data.fileName = patch.displayName;
    if (patch.order != null) data.order = patch.order;

    return this.prisma.meetingDocument.update({ where: { id: docId }, data });
  }

  async remove(coopId: string, meetingId: string, docId: string) {
    await this.assertMeetingInCoop(coopId, meetingId);
    const doc = await this.prisma.meetingDocument.findFirst({
      where: { id: docId, meetingId },
    });
    if (!doc) throw new NotFoundException('Document not found in this meeting');

    try {
      fs.unlinkSync(path.join(uploadDir(), doc.fileUrl));
    } catch {
      // best-effort; orphan ENOENT is harmless
    }
    await this.prisma.meetingDocument.delete({ where: { id: docId } });
  }
```

Refactor `upload` to use `assertMeetingInCoop` (replace its inline meeting-lookup block):

```typescript
    if (!file?.buffer) throw new BadRequestException('No file provided');
    if (file.mimetype !== 'application/pdf') throw new BadRequestException('Only PDF files allowed');
    if (file.size > MAX_FILE_SIZE) throw new BadRequestException('File exceeds 10MB limit');

    await this.assertMeetingInCoop(coopId, meetingId);
```

Also add `NotFoundException` to the existing import in the service.

- [ ] **Step 4: Run tests, expect pass**

```bash
cd apps/api && pnpm test meeting-documents.service.spec
```

Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/meetings/meeting-documents.service.ts apps/api/src/modules/meetings/meeting-documents.service.spec.ts
git commit -m "feat(meetings): MeetingDocumentsService list/update/remove"
```

---

## Task 5: MeetingDocumentsService — email draft + send (TDD)

**Files:**
- Modify: `apps/api/src/modules/meetings/meeting-documents.service.ts`
- Modify: `apps/api/src/modules/meetings/meeting-documents.service.spec.ts`

- [ ] **Step 1: Add failing tests for email draft**

```typescript
  describe('email draft', () => {
    it('returns current draft with computed counts', async () => {
      prisma.meeting.findUnique.mockResolvedValue({
        id: 'm1',
        coopId: 'c1',
        documentsSubject: 'Custom subj',
        documentsIntro: 'Custom intro',
        documentsEmailSentAt: null,
      });
      prisma.meetingAttendance = {
        count: jest.fn().mockResolvedValueOnce(47).mockResolvedValueOnce(0).mockResolvedValueOnce(0),
      } as any;

      const draft = await service.getEmailDraft('c1', 'm1');

      expect(draft.subject).toBe('Custom subj');
      expect(draft.recipientCount).toBe(47);
      expect(draft.sentCount).toBe(0);
      expect(draft.failedCount).toBe(0);
    });

    it('updates subject and intro', async () => {
      prisma.meeting.findUnique.mockResolvedValue({ id: 'm1', coopId: 'c1' });
      prisma.meeting.update = jest.fn().mockResolvedValue({});

      await service.updateEmailDraft('c1', 'm1', { subject: 'New', intro: 'Body' });

      expect(prisma.meeting.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { documentsSubject: 'New', documentsIntro: 'Body' },
      });
    });
  });
```

Add to the `prisma` mock declaration: `meetingAttendance: { count: jest.Mock; findMany: jest.Mock; updateMany: jest.Mock };` and initialize in `beforeEach`:

```typescript
      meetingAttendance: { count: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
```

Also add to the mock: `meeting: { findUnique: jest.fn(), update: jest.fn() }`.

- [ ] **Step 2: Run tests, expect failure**

```bash
cd apps/api && pnpm test meeting-documents.service.spec
```

Expected: 2 fails.

- [ ] **Step 3: Implement getEmailDraft / updateEmailDraft**

Append to `meeting-documents.service.ts`:

```typescript
  async getEmailDraft(coopId: string, meetingId: string) {
    const meeting = await this.assertMeetingInCoop(coopId, meetingId);
    const [recipientCount, sentCount, failedCount] = await Promise.all([
      this.prisma.meetingAttendance.count({ where: { meetingId } }),
      this.prisma.meetingAttendance.count({
        where: { meetingId, documentsEmailSentAt: { not: null } },
      }),
      this.prisma.meetingAttendance.count({
        where: { meetingId, documentsEmailError: { not: null } },
      }),
    ]);
    return {
      subject: meeting.documentsSubject,
      intro: meeting.documentsIntro,
      sentAt: meeting.documentsEmailSentAt,
      recipientCount,
      sentCount,
      failedCount,
    };
  }

  async updateEmailDraft(
    coopId: string,
    meetingId: string,
    patch: { subject?: string; intro?: string },
  ) {
    await this.assertMeetingInCoop(coopId, meetingId);
    const data: { documentsSubject?: string; documentsIntro?: string } = {};
    if (patch.subject !== undefined) data.documentsSubject = patch.subject;
    if (patch.intro !== undefined) data.documentsIntro = patch.intro;
    await this.prisma.meeting.update({ where: { id: meetingId }, data });
  }
```

- [ ] **Step 4: Run tests, expect pass**

Expected: 11 passed.

- [ ] **Step 5: Add failing tests for send**

```typescript
  describe('send', () => {
    const baseMeeting = {
      id: 'm1',
      coopId: 'c1',
      status: 'CONVOKED',
      scheduledAt: new Date('2026-05-09T10:00:00Z'),
      documentsEmailSentAt: null,
      documentsSubject: null,
      documentsIntro: null,
    };

    beforeEach(() => {
      prisma.meeting.update = jest.fn().mockResolvedValue({});
    });

    it('rejects when meeting not CONVOKED', async () => {
      prisma.meeting.findUnique.mockResolvedValue({ ...baseMeeting, status: 'DRAFT' });
      prisma.meetingDocument.findMany.mockResolvedValue([{ id: 'd1' }]);
      await expect(service.sendEmail('c1', 'm1', 'admin1')).rejects.toThrow(BadRequestException);
    });

    it('rejects when no documents', async () => {
      prisma.meeting.findUnique.mockResolvedValue(baseMeeting);
      prisma.meetingDocument.findMany.mockResolvedValue([]);
      await expect(service.sendEmail('c1', 'm1', 'admin1')).rejects.toThrow(BadRequestException);
    });

    it('rejects retry when nothing failed', async () => {
      prisma.meeting.findUnique.mockResolvedValue({
        ...baseMeeting,
        documentsEmailSentAt: new Date(),
      });
      prisma.meetingDocument.findMany.mockResolvedValue([{ id: 'd1' }]);
      prisma.meetingAttendance.count.mockResolvedValue(0); // no failures
      await expect(service.sendEmail('c1', 'm1', 'admin1')).rejects.toThrow(BadRequestException);
    });

    it('first send: enqueues to all attendances', async () => {
      const enqueue = jest.fn().mockResolvedValue(undefined);
      (service as any).enqueueDocumentsEmailJob = enqueue;

      prisma.meeting.findUnique.mockResolvedValue(baseMeeting);
      prisma.meetingDocument.findMany.mockResolvedValue([{ id: 'd1', fileName: 'A.pdf' }]);
      prisma.meetingAttendance.findMany.mockResolvedValue([
        { id: 'a1', shareholderId: 's1', rsvpToken: 't1' },
        { id: 'a2', shareholderId: 's2', rsvpToken: 't2' },
      ]);

      const result = await service.sendEmail('c1', 'm1', 'admin1');

      expect(result.enqueued).toBe(2);
      expect(enqueue).toHaveBeenCalledTimes(2);
      expect(prisma.meeting.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { documentsEmailSentAt: expect.any(Date) },
      });
    });

    it('retry: enqueues only failed attendances and clears their error', async () => {
      const enqueue = jest.fn().mockResolvedValue(undefined);
      (service as any).enqueueDocumentsEmailJob = enqueue;

      prisma.meeting.findUnique.mockResolvedValue({
        ...baseMeeting,
        documentsEmailSentAt: new Date('2026-05-06T14:00:00Z'),
      });
      prisma.meetingDocument.findMany.mockResolvedValue([{ id: 'd1', fileName: 'A.pdf' }]);
      prisma.meetingAttendance.count.mockResolvedValue(1);
      prisma.meetingAttendance.findMany.mockResolvedValue([
        { id: 'a3', shareholderId: 's3', rsvpToken: 't3', documentsEmailError: 'bounce' },
      ]);

      const result = await service.sendEmail('c1', 'm1', 'admin1');

      expect(result.enqueued).toBe(1);
      expect(prisma.meetingAttendance.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['a3'] } },
        data: { documentsEmailError: null },
      });
    });
  });
```

- [ ] **Step 6: Run tests, expect failure**

Expected: 5 fails.

- [ ] **Step 7: Implement sendEmail**

Add to `meeting-documents.service.ts` (after `updateEmailDraft`):

```typescript
  async sendEmail(coopId: string, meetingId: string, adminUserId: string) {
    const meeting = await this.assertMeetingInCoop(coopId, meetingId);
    if (meeting.status !== 'CONVOKED') {
      throw new BadRequestException('Meeting must be CONVOKED to send documents');
    }
    const docs = await this.prisma.meetingDocument.findMany({ where: { meetingId } });
    if (docs.length === 0) throw new BadRequestException('No documents to send');

    // Concurrency lock
    if (meeting.documentsEmailSentAt) {
      const ageMs = Date.now() - new Date(meeting.documentsEmailSentAt).getTime();
      if (ageMs < 60_000) {
        throw new BadRequestException('Send already in progress; try again in a minute');
      }
    }

    const isRetry = meeting.documentsEmailSentAt != null;

    if (isRetry) {
      const failedCount = await this.prisma.meetingAttendance.count({
        where: { meetingId, documentsEmailError: { not: null } },
      });
      if (failedCount === 0) throw new BadRequestException('No failed sends to retry');
    }

    const recipients = await this.prisma.meetingAttendance.findMany({
      where: isRetry
        ? { meetingId, documentsEmailError: { not: null } }
        : { meetingId },
    });

    if (isRetry) {
      await this.prisma.meetingAttendance.updateMany({
        where: { id: { in: recipients.map((r) => r.id) } },
        data: { documentsEmailError: null },
      });
    }

    for (const recipient of recipients) {
      await this.enqueueDocumentsEmailJob(meeting, recipient, docs);
    }

    await this.prisma.meeting.update({
      where: { id: meetingId },
      data: { documentsEmailSentAt: new Date() },
    });

    return { enqueued: recipients.length };
  }

  protected async enqueueDocumentsEmailJob(
    meeting: { id: string; coopId: string },
    recipient: { id: string; shareholderId: string; rsvpToken: string },
    docs: Array<{ id: string; fileName: string }>,
  ): Promise<void> {
    // Wired to EmailService.queueDocumentsEmail in Task 6 (next).
    // Left abstract here so the service unit-tests can stub it.
    throw new Error('enqueueDocumentsEmailJob must be injected via EmailService');
  }
```

- [ ] **Step 8: Run tests, expect pass**

Expected: 16 passed.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/meetings/meeting-documents.service.ts apps/api/src/modules/meetings/meeting-documents.service.spec.ts
git commit -m "feat(meetings): MeetingDocumentsService email draft + send"
```

---

## Task 6: Email template + queue glue

**Files:**
- Modify: `apps/api/src/modules/email/email.processor.ts`
- Modify: `apps/api/src/modules/email/email.service.ts`
- Modify: `apps/api/src/modules/meetings/meeting-documents.service.ts`

- [ ] **Step 1: Read existing templates Record**

Open `apps/api/src/modules/email/email.processor.ts` and locate `templates: Record<string, ...>` (around line 257). Note an existing entry like `convocation` to mimic its structure.

- [ ] **Step 2: Add 'agenda-documents' template entry**

Inside the `templates` Record, add a new key:

```typescript
'agenda-documents': (data, coopName) => {
  const subject = data.subject as string;
  const introHtml = data.introHtml as string;
  const documents = data.documents as Array<{ fileName: string; downloadUrl: string }>;
  const meetingTitle = data.meetingTitle as string;
  const meetingScheduledAt = data.meetingScheduledAt as string;
  const rsvpUrl = data.rsvpUrl as string;
  const pixelUrl = data.pixelUrl as string;

  const docsList = documents
    .map(
      (d) => `
        <p style="margin: 8px 0;">
          <a href="${d.downloadUrl}" style="background:#0E7C66;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block;">
            ${d.fileName}
          </a>
        </p>`,
    )
    .join('\n');

  return `
    <h2>${meetingTitle}</h2>
    <p>${meetingScheduledAt}</p>
    ${introHtml}
    <h3>Documenten</h3>
    ${docsList}
    <hr style="margin:24px 0;border:none;border-top:1px solid #e5e5e5;" />
    <p style="font-size:14px;color:#666;">
      Heb je je aanwezigheid nog niet bevestigd? <a href="${rsvpUrl}">Bevestig hier</a>.
    </p>
    <img src="${pixelUrl}" width="1" height="1" alt="" style="display:block" />
  `;
},
```

- [ ] **Step 3: Add a queue method on EmailService**

Open `apps/api/src/modules/email/email.service.ts`. Find the existing `enqueueEmail` or similar pattern; add a new method (mirror existing convocation-style methods):

```typescript
async queueDocumentsEmail(params: {
  coopId: string;
  to: string;
  subject: string;
  templateData: {
    introHtml: string;
    documents: Array<{ fileName: string; downloadUrl: string }>;
    meetingTitle: string;
    meetingScheduledAt: string;
    rsvpUrl: string;
    pixelUrl: string;
  };
  attendanceId: string; // for the processor to update tracking on success/failure
}): Promise<void> {
  await this.emailQueue.add('send-email', {
    coopId: params.coopId,
    to: params.to,
    subject: params.subject,
    templateKey: 'agenda-documents',
    templateData: { subject: params.subject, ...params.templateData },
    meta: { kind: 'documents-email', attendanceId: params.attendanceId },
  });
}
```

> **Note on tracking:** the existing `EmailProcessor` already updates `EmailLog` on success/failure. Add a side-effect in the processor: if `meta.kind === 'documents-email'`, update `meetingAttendance.documentsEmailSentAt` (success) or `documentsEmailError` (failure). Locate the processor's success/failure path and patch:

In `email.processor.ts`, find where `emailLog.status` is updated on success and add (after it):

```typescript
if (job.data.meta?.kind === 'documents-email' && job.data.meta?.attendanceId) {
  await this.prisma.meetingAttendance.update({
    where: { id: job.data.meta.attendanceId },
    data: { documentsEmailSentAt: new Date(), documentsEmailError: null },
  }).catch(() => undefined);
}
```

And on the failure path:

```typescript
if (job.data.meta?.kind === 'documents-email' && job.data.meta?.attendanceId) {
  await this.prisma.meetingAttendance.update({
    where: { id: job.data.meta.attendanceId },
    data: { documentsEmailError: String(err.message ?? err).slice(0, 500) },
  }).catch(() => undefined);
}
```

- [ ] **Step 4: Wire `enqueueDocumentsEmailJob` in MeetingDocumentsService**

In `meeting-documents.service.ts`, replace the placeholder `enqueueDocumentsEmailJob` with a real implementation that pulls config and calls `EmailService.queueDocumentsEmail`:

```typescript
import { EmailService } from '../email/email.service';
import { ConfigService } from '@nestjs/config';

constructor(
  private prisma: PrismaService,
  private emails: EmailService,
  private config: ConfigService,
) {}

protected async enqueueDocumentsEmailJob(
  meeting: { id: string; coopId: string; scheduledAt: Date; documentsSubject: string | null; documentsIntro: string | null; title: string },
  recipient: { id: string; shareholderId: string; rsvpToken: string },
  docs: Array<{ id: string; fileName: string }>,
) {
  const shareholder = await this.prisma.shareholder.findUnique({
    where: { id: recipient.shareholderId },
    select: { email: true, firstName: true, preferredLanguage: true },
  });
  if (!shareholder?.email) {
    await this.prisma.meetingAttendance.update({
      where: { id: recipient.id },
      data: { documentsEmailError: 'no email address' },
    });
    return;
  }

  const baseUrl = this.config.get<string>('PUBLIC_URL') || 'https://opencoop.be';
  const apiBase = this.config.get<string>('API_PUBLIC_URL') || `${baseUrl}/api`;

  const downloadBase = `${apiBase}/public/meetings/rsvp/${recipient.rsvpToken}/documents`;
  const documents = docs.map((d) => ({
    fileName: d.fileName,
    downloadUrl: `${downloadBase}/${d.id}`,
  }));

  const subject = meeting.documentsSubject || `Documenten voor ${meeting.title}`;
  const introHtml = (meeting.documentsIntro || 'Beste coöperant,\n\nIn aanloop naar onze algemene vergadering vind je hieronder de documenten ter inzage.')
    .split('\n')
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join('');

  await this.emails.queueDocumentsEmail({
    coopId: meeting.coopId,
    to: shareholder.email,
    subject,
    templateData: {
      introHtml,
      documents,
      meetingTitle: meeting.title,
      meetingScheduledAt: meeting.scheduledAt.toLocaleString('nl-BE', {
        dateStyle: 'long',
        timeStyle: 'short',
      }),
      rsvpUrl: `${baseUrl}/meetings/rsvp/${recipient.rsvpToken}`,
      pixelUrl: `${apiBase}/public/meetings/rsvp/${recipient.rsvpToken}/pixel.gif`,
    },
    attendanceId: recipient.id,
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
```

Adjust `assertMeetingInCoop` callers: `sendEmail` now needs the `title` and `scheduledAt` — make sure the meeting `findUnique` selects those (default returns full row, so fine).

- [ ] **Step 5: Update spec mocks for the constructor change**

In `meeting-documents.service.spec.ts`, the `Test.createTestingModule` providers list must include the new deps. Replace:

```typescript
providers: [MeetingDocumentsService, { provide: PrismaService, useValue: prisma }],
```

with:

```typescript
const emailService = { queueDocumentsEmail: jest.fn() };
const configService = { get: jest.fn().mockImplementation((k) => {
  if (k === 'PUBLIC_URL') return 'https://opencoop.be';
  if (k === 'API_PUBLIC_URL') return 'https://opencoop.be/api';
  return null;
})};
// ...
providers: [
  MeetingDocumentsService,
  { provide: PrismaService, useValue: prisma },
  { provide: EmailService, useValue: emailService },
  { provide: ConfigService, useValue: configService },
],
```

Add imports at top of spec file:
```typescript
import { EmailService } from '../email/email.service';
import { ConfigService } from '@nestjs/config';
```

Remove the `(service as any).enqueueDocumentsEmailJob = enqueue;` test stubs and instead assert against `emailService.queueDocumentsEmail`. Update the existing send tests:

```typescript
    it('first send: enqueues to all attendances', async () => {
      prisma.meeting.findUnique.mockResolvedValue({ ...baseMeeting, title: 'AV', documentsSubject: null, documentsIntro: null });
      prisma.meetingDocument.findMany.mockResolvedValue([{ id: 'd1', fileName: 'A.pdf' }]);
      prisma.meetingAttendance.findMany.mockResolvedValue([
        { id: 'a1', shareholderId: 's1', rsvpToken: 't1' },
        { id: 'a2', shareholderId: 's2', rsvpToken: 't2' },
      ]);
      // shareholder lookup mock
      prisma.shareholder = { findUnique: jest.fn().mockResolvedValue({ email: 'x@y.be', firstName: 'Jan', preferredLanguage: 'nl' }) } as any;

      const result = await service.sendEmail('c1', 'm1', 'admin1');

      expect(result.enqueued).toBe(2);
      expect(emailService.queueDocumentsEmail).toHaveBeenCalledTimes(2);
    });
```

Add `prisma.shareholder` to the mock declaration too.

- [ ] **Step 6: Run all service tests**

```bash
cd apps/api && pnpm test meeting-documents.service.spec
```

Expected: 16 passed.

- [ ] **Step 7: Register service in MeetingsModule**

In `apps/api/src/modules/meetings/meetings.module.ts`, add `MeetingDocumentsService` to the providers and exports arrays. Import `EmailModule` if not already imported (check existing imports — `ConvocationService` likely already pulls it in, so EmailService is available).

```typescript
import { MeetingDocumentsService } from './meeting-documents.service';
// ... in providers array:
MeetingDocumentsService,
```

- [ ] **Step 8: Verify whole API still builds**

```bash
cd apps/api && pnpm build
```

Expected: clean build.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/email apps/api/src/modules/meetings/
git commit -m "feat(meetings): wire documents email through EmailProcessor"
```

---

## Task 7: Admin controller endpoints

**Files:**
- Modify: `apps/api/src/modules/meetings/meetings.controller.ts`

- [ ] **Step 1: Inject MeetingDocumentsService**

In the controller constructor, add `private documents: MeetingDocumentsService`. Add to imports at top.

- [ ] **Step 2: Add document CRUD endpoints**

Append to the existing controller (matching the pattern of `uploadAgendaAttachment` already present at `meetings.controller.ts:134`):

```typescript
  @Post(':id/documents')
  @ApiOperation({ summary: 'Upload a meeting document (PDF)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        displayName: { type: 'string' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  uploadDocument(
    @Param('coopId') coopId: string,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadMeetingDocumentDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.documents.upload(coopId, id, file, body.displayName, user.userId);
  }

  @Get(':id/documents')
  listDocuments(@Param('coopId') coopId: string, @Param('id') id: string) {
    return this.documents.list(coopId, id);
  }

  @Patch(':id/documents/:docId')
  updateDocument(
    @Param('coopId') coopId: string,
    @Param('id') id: string,
    @Param('docId') docId: string,
    @Body() body: UpdateMeetingDocumentDto,
  ) {
    return this.documents.update(coopId, id, docId, body);
  }

  @Delete(':id/documents/:docId')
  removeDocument(
    @Param('coopId') coopId: string,
    @Param('id') id: string,
    @Param('docId') docId: string,
  ) {
    return this.documents.remove(coopId, id, docId);
  }

  @Get(':id/documents-email')
  getDocumentsEmailDraft(@Param('coopId') coopId: string, @Param('id') id: string) {
    return this.documents.getEmailDraft(coopId, id);
  }

  @Patch(':id/documents-email')
  updateDocumentsEmailDraft(
    @Param('coopId') coopId: string,
    @Param('id') id: string,
    @Body() body: UpdateDocumentsEmailDraftDto,
  ) {
    return this.documents.updateEmailDraft(coopId, id, body);
  }

  @Post(':id/documents-email/send')
  sendDocumentsEmail(
    @Param('coopId') coopId: string,
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.documents.sendEmail(coopId, id, user.userId);
  }
```

Add imports for the three DTOs and `Patch`/`Delete` from `@nestjs/common` if not already.

- [ ] **Step 3: Verify build**

```bash
cd apps/api && pnpm build
```

Expected: clean.

- [ ] **Step 4: Smoke-test endpoints via Swagger**

```bash
cd apps/api && pnpm dev
```

Open `http://localhost:3001/api/docs`. Verify the 7 new endpoints appear under the meetings tag with the correct request/response shapes. Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/meetings/meetings.controller.ts
git commit -m "feat(meetings): admin endpoints for document sharing"
```

---

## Task 8: Public download endpoint (TDD)

**Files:**
- Modify: `apps/api/src/modules/meetings/meeting-rsvp.controller.ts`
- Modify: `apps/api/src/modules/meetings/meeting-documents.service.ts`
- Modify: `apps/api/src/modules/meetings/meeting-documents.service.spec.ts`

- [ ] **Step 1: Add failing tests for download access logic**

Add a new describe block to the spec file:

```typescript
  describe('downloadByToken', () => {
    const meetingFuture = {
      id: 'm1',
      coopId: 'c1',
      scheduledAt: new Date(Date.now() + 86_400_000), // tomorrow
    };

    beforeEach(() => {
      prisma.meetingAttendance = {
        ...prisma.meetingAttendance,
        findUnique: jest.fn(),
        update: jest.fn(),
      } as any;
      prisma.meetingDocument.findUnique = jest.fn();
    });

    it('rejects unknown token', async () => {
      prisma.meetingAttendance.findUnique.mockResolvedValue(null);
      await expect(service.downloadByToken('badtoken', 'd1')).rejects.toThrow(NotFoundException);
    });

    it('rejects when document is not part of token meeting', async () => {
      prisma.meetingAttendance.findUnique.mockResolvedValue({
        id: 'a1', meetingId: 'm1', shareholderId: 's1', meeting: meetingFuture,
      });
      prisma.meetingDocument.findUnique.mockResolvedValue({ id: 'd1', meetingId: 'mOTHER', fileUrl: 'x.pdf', fileName: 'x.pdf' });
      await expect(service.downloadByToken('t1', 'd1')).rejects.toThrow(ForbiddenException);
    });

    it('rejects when past 30-day window', async () => {
      const longAgo = { ...meetingFuture, scheduledAt: new Date(Date.now() - 31 * 86_400_000) };
      prisma.meetingAttendance.findUnique.mockResolvedValue({
        id: 'a1', meetingId: 'm1', shareholderId: 's1', meeting: longAgo,
      });
      prisma.meetingDocument.findUnique.mockResolvedValue({ id: 'd1', meetingId: 'm1', fileUrl: 'x.pdf', fileName: 'x.pdf' });
      await expect(service.downloadByToken('t1', 'd1')).rejects.toThrow(ForbiddenException);
    });

    it('returns file metadata and sets downloadedAt on first download', async () => {
      const dir = path.join(tmpUploadDir, 'meeting-documents', 'm1');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'x.pdf'), 'PDF');

      prisma.meetingAttendance.findUnique.mockResolvedValue({
        id: 'a1', meetingId: 'm1', shareholderId: 's1', documentsDownloadedAt: null, meeting: meetingFuture,
      });
      prisma.meetingDocument.findUnique.mockResolvedValue({
        id: 'd1', meetingId: 'm1', fileUrl: 'meeting-documents/m1/x.pdf', fileName: 'Jaarverslag 2025.pdf',
      });

      const result = await service.downloadByToken('t1', 'd1');

      expect(result.absolutePath).toBe(path.join(tmpUploadDir, 'meeting-documents/m1/x.pdf'));
      expect(result.fileName).toBe('Jaarverslag 2025.pdf');
      expect(prisma.meetingAttendance.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: { documentsDownloadedAt: expect.any(Date) },
      });
    });

    it('does not overwrite downloadedAt on second download', async () => {
      fs.mkdirSync(path.join(tmpUploadDir, 'meeting-documents/m1'), { recursive: true });
      fs.writeFileSync(path.join(tmpUploadDir, 'meeting-documents/m1/x.pdf'), 'PDF');

      const earlier = new Date('2026-05-06T08:00:00Z');
      prisma.meetingAttendance.findUnique.mockResolvedValue({
        id: 'a1', meetingId: 'm1', shareholderId: 's1', documentsDownloadedAt: earlier, meeting: meetingFuture,
      });
      prisma.meetingDocument.findUnique.mockResolvedValue({
        id: 'd1', meetingId: 'm1', fileUrl: 'meeting-documents/m1/x.pdf', fileName: 'x.pdf',
      });

      await service.downloadByToken('t1', 'd1');

      expect(prisma.meetingAttendance.update).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run, expect failures**

Expected: 5 fails.

- [ ] **Step 3: Implement downloadByToken**

Append to `meeting-documents.service.ts`:

```typescript
  async downloadByToken(token: string, docId: string) {
    const attendance = await this.prisma.meetingAttendance.findUnique({
      where: { rsvpToken: token },
      include: { meeting: true },
    });
    if (!attendance) throw new NotFoundException('Token not found');

    const doc = await this.prisma.meetingDocument.findUnique({ where: { id: docId } });
    if (!doc) throw new NotFoundException('Document not found');
    if (doc.meetingId !== attendance.meetingId) {
      throw new ForbiddenException('Document not part of this meeting');
    }

    const expiry = new Date(attendance.meeting.scheduledAt.getTime() + 30 * 86_400_000);
    if (Date.now() > expiry.getTime()) {
      throw new ForbiddenException('Download window expired');
    }

    if (!attendance.documentsDownloadedAt) {
      await this.prisma.meetingAttendance.update({
        where: { id: attendance.id },
        data: { documentsDownloadedAt: new Date() },
      });
    }

    return {
      absolutePath: path.join(uploadDir(), doc.fileUrl),
      fileName: doc.fileName,
      shareholderId: attendance.shareholderId,
      meetingId: attendance.meetingId,
    };
  }

  async pixelHit(token: string) {
    const attendance = await this.prisma.meetingAttendance.findUnique({
      where: { rsvpToken: token },
    });
    // Always succeed silently for the GIF response; only update DB if valid + first hit.
    if (attendance && !attendance.documentsEmailOpenedAt) {
      await this.prisma.meetingAttendance.update({
        where: { id: attendance.id },
        data: { documentsEmailOpenedAt: new Date() },
      }).catch(() => undefined);
    }
  }
```

- [ ] **Step 4: Run tests, expect pass**

```bash
cd apps/api && pnpm test meeting-documents.service.spec
```

Expected: 21 passed.

- [ ] **Step 5: Add public controller endpoints**

In `apps/api/src/modules/meetings/meeting-rsvp.controller.ts`, add two endpoints (use existing rate-limit guard pattern from sibling endpoints):

```typescript
  @Get(':token/documents/:docId')
  async downloadDocument(
    @Param('token') token: string,
    @Param('docId') docId: string,
    @Res() res: Response,
    @Req() req: Request,
  ) {
    const result = await this.documents.downloadByToken(token, docId);
    if (!fs.existsSync(result.absolutePath)) {
      throw new NotFoundException('File missing on disk');
    }
    await this.audit.log({
      action: 'meeting.document.downloaded',
      shareholderId: result.shareholderId,
      coopId: result.coopId,
      meetingId: result.meetingId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { documentId: docId },
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(result.fileName)}"`,
    );
    fs.createReadStream(result.absolutePath).pipe(res);
  }

  @Get(':token/pixel.gif')
  async pixel(@Param('token') token: string, @Res() res: Response) {
    await this.documents.pixelHit(token);
    // 1×1 transparent GIF
    const gif = Buffer.from(
      'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      'base64',
    );
    res.setHeader('Content-Type', 'image/gif');
    res.setHeader('Cache-Control', 'no-store');
    res.send(gif);
  }
```

Inject `MeetingDocumentsService` and the existing audit module/service into the controller. The `downloadByToken` return value also needs to include `coopId` — patch the service accordingly:

```typescript
    return {
      absolutePath: path.join(uploadDir(), doc.fileUrl),
      fileName: doc.fileName,
      shareholderId: attendance.shareholderId,
      meetingId: attendance.meetingId,
      coopId: attendance.meeting.coopId,
    };
```

- [ ] **Step 6: Verify build**

```bash
cd apps/api && pnpm build
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/meetings/
git commit -m "feat(meetings): public document download + pixel tracking"
```

---

## Task 9: Frontend deps + i18n

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/nl.json`
- Modify: `apps/web/messages/fr.json`
- Modify: `apps/web/messages/de.json`

- [ ] **Step 1: Install dnd-kit**

```bash
cd apps/web && pnpm add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

- [ ] **Step 2: Add i18n keys (NL — primary)**

In `apps/web/messages/nl.json`, find the `"meetings"` block and add a sibling `"documents"` key:

```json
"documents": {
  "title": "Documenten delen",
  "description": "Stuur jaarverslag, jaarrekening en andere bijlagen naar coöperanten in aanloop naar de algemene vergadering.",
  "uploadCta": "PDF uploaden",
  "dragDropHint": "Sleep een PDF hier of klik om te uploaden",
  "rename": "Hernoemen",
  "delete": "Verwijderen",
  "confirmDelete": "Document verwijderen? Reeds verstuurde links worden ongeldig.",
  "subjectLabel": "Onderwerp",
  "subjectPlaceholder": "Documenten voor onze AV",
  "introLabel": "Intro",
  "introPlaceholder": "Beste coöperant,\n\nIn aanloop naar onze algemene vergadering...",
  "recipientCount": "Naar {count} coöperanten",
  "previewCta": "Preview (testmail naar mij)",
  "sendCta": "Versturen",
  "sendConfirm": "Je staat op het punt {count} mails te versturen. Doorgaan?",
  "sentSummary": "Verstuurd op {date} — {sent} van {total} succesvol",
  "resendFailed": "Opnieuw verzenden naar {count} falende",
  "statusTitle": "Status per coöperant",
  "status.sent": "Verstuurd",
  "status.opened": "Geopend",
  "status.downloaded": "Gedownload",
  "status.failed": "Gefaald",
  "notReady": "Verstuur eerst de convocatie voor je documenten kunt delen.",
  "defaultSubject": "Documenten voor de algemene vergadering van {coopName} op {date}",
  "defaultIntro": "Beste coöperant,\n\nIn aanloop naar onze algemene vergadering vind je hieronder de relevante documenten ter inzage. Gelieve deze door te nemen voor de vergadering.\n\nMet vriendelijke groeten,\nHet bestuur"
}
```

- [ ] **Step 3: Add EN translations**

In `apps/web/messages/en.json`, mirror the structure with English copy:

```json
"documents": {
  "title": "Share documents",
  "description": "Send the annual report, financial statements and other attachments to members ahead of the AGM.",
  "uploadCta": "Upload PDF",
  "dragDropHint": "Drop a PDF here or click to upload",
  "rename": "Rename",
  "delete": "Delete",
  "confirmDelete": "Delete document? Already-sent links will stop working.",
  "subjectLabel": "Subject",
  "subjectPlaceholder": "Documents for our AGM",
  "introLabel": "Intro",
  "introPlaceholder": "Dear member,\n\nAhead of our annual general meeting...",
  "recipientCount": "To {count} members",
  "previewCta": "Preview (test mail to me)",
  "sendCta": "Send",
  "sendConfirm": "You're about to send {count} emails. Continue?",
  "sentSummary": "Sent on {date} — {sent} of {total} successful",
  "resendFailed": "Resend to {count} failed",
  "statusTitle": "Status per member",
  "status.sent": "Sent",
  "status.opened": "Opened",
  "status.downloaded": "Downloaded",
  "status.failed": "Failed",
  "notReady": "Send the convocation first before sharing documents.",
  "defaultSubject": "Documents for the {coopName} general meeting on {date}",
  "defaultIntro": "Dear member,\n\nAhead of our general meeting, please find the relevant documents below for your review.\n\nKind regards,\nThe board"
}
```

- [ ] **Step 4: Add FR + DE stub translations**

In `fr.json` and `de.json`, mirror the keys with NL copy as fallback (Wouter copy-edits). Keep keys identical.

- [ ] **Step 5: Verify web build**

```bash
cd apps/web && pnpm build
```

Expected: clean (next-intl will fail loudly on missing keys, so this confirms parity).

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json apps/web/pnpm-lock.yaml apps/web/messages/
git commit -m "feat(web): add dnd-kit deps + meetings.documents i18n"
```

---

## Task 10: Frontend page — scaffolding + upload list

**Files:**
- Create: `apps/web/src/app/[locale]/dashboard/admin/meetings/[meetingId]/documents/page.tsx`
- Create: `apps/web/src/app/[locale]/dashboard/admin/meetings/[meetingId]/documents/documents-page-client.tsx`

- [ ] **Step 1: Create the server component shell**

`apps/web/src/app/[locale]/dashboard/admin/meetings/[meetingId]/documents/page.tsx`:

```typescript
import { DocumentsPageClient } from './documents-page-client';

export default function MeetingDocumentsPage({
  params,
}: {
  params: { locale: string; meetingId: string };
}) {
  return <DocumentsPageClient meetingId={params.meetingId} locale={params.locale} />;
}
```

- [ ] **Step 2: Create the client component skeleton**

`apps/web/src/app/[locale]/dashboard/admin/meetings/[meetingId]/documents/documents-page-client.tsx`:

```typescript
'use client';

import { useTranslations } from 'next-intl';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

type MeetingDoc = {
  id: string;
  fileName: string;
  fileSize: number;
  order: number;
};

export function DocumentsPageClient({ meetingId, locale }: { meetingId: string; locale: string }) {
  const t = useTranslations('meetings.documents');
  const qc = useQueryClient();
  // Note: coopId is available via the parent admin scope; admin uses :coopId in URL
  // For now, derive from window — replace with proper scope hook used by sibling pages.
  // (Match the pattern used in apps/web/src/app/[locale]/dashboard/admin/meetings/[meetingId]/page.tsx)

  // Replace this with the real coopId hook used by sibling admin pages:
  const coopId = useAdminCoopId(); // import from existing helper

  const { data: docs = [], refetch } = useQuery<MeetingDoc[]>({
    queryKey: ['meeting-documents', meetingId],
    queryFn: () => api(`/admin/coops/${coopId}/meetings/${meetingId}/documents`),
  });

  return (
    <div className="space-y-8 p-6">
      <header>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('description')}</p>
      </header>

      <DocumentList docs={docs} coopId={coopId} meetingId={meetingId} onChange={refetch} />
      {/* MailDraftSection + SendSection + StatusTable added in Tasks 11–12 */}
    </div>
  );
}

function DocumentList({
  docs,
  coopId,
  meetingId,
  onChange,
}: {
  docs: MeetingDoc[];
  coopId: string;
  meetingId: string;
  onChange: () => void;
}) {
  const t = useTranslations('meetings.documents');
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api(`/admin/coops/${coopId}/meetings/${meetingId}/documents`, {
        method: 'POST',
        body: fd,
      });
    },
    onSuccess: () => onChange(),
  });

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium">📎 {t('title')}</h2>
      <ul className="divide-y rounded border">
        {docs.map((d) => (
          <li key={d.id} className="flex items-center justify-between p-3">
            <span>{d.fileName}</span>
            <span className="text-sm text-muted-foreground">{formatSize(d.fileSize)}</span>
          </li>
        ))}
      </ul>
      <input
        type="file"
        accept="application/pdf"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload.mutate(f);
          e.target.value = '';
        }}
      />
    </section>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
```

- [ ] **Step 3: Wire `useAdminCoopId`**

Find the existing helper used by sibling admin pages (e.g. `apps/web/src/app/[locale]/dashboard/admin/meetings/[meetingId]/page.tsx`). Replace the placeholder import with the actual hook or context call. If the pattern is `params.coopId` from a parent layout, follow that pattern instead.

- [ ] **Step 4: Smoke test in browser**

```bash
pnpm dev
```

Visit `http://localhost:3002/nl/dashboard/admin/meetings/<existing-meeting-id>/documents`. Verify:
- Page renders with header
- Empty document list
- File picker visible
- Upload a small PDF → list shows the doc

Stop dev server.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/[locale]/dashboard/admin/meetings/[meetingId]/documents/
git commit -m "feat(web): documents page scaffold + upload"
```

---

## Task 11: Frontend — sortable list + rename + delete

**Files:**
- Modify: `apps/web/src/app/[locale]/dashboard/admin/meetings/[meetingId]/documents/documents-page-client.tsx`

- [ ] **Step 1: Replace DocumentList with dnd-kit sortable**

In the client component file, replace the `DocumentList` body:

```typescript
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useState } from 'react';

function SortableRow({
  doc,
  onRename,
  onDelete,
}: {
  doc: MeetingDoc;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const t = useTranslations('meetings.documents');
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: doc.id });
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(doc.fileName);

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="flex items-center gap-3 border-b p-3 last:border-b-0"
    >
      <button {...attributes} {...listeners} className="cursor-grab text-muted-foreground" aria-label="reorder">⋮⋮</button>
      {editing ? (
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (name !== doc.fileName) onRename(doc.id, name);
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="flex-1 rounded border px-2 py-1"
        />
      ) : (
        <button className="flex-1 text-left" onClick={() => setEditing(true)}>
          {doc.fileName}
        </button>
      )}
      <span className="text-sm text-muted-foreground">{formatSize(doc.fileSize)}</span>
      <button
        onClick={() => {
          if (confirm(t('confirmDelete'))) onDelete(doc.id);
        }}
        className="text-red-600"
      >
        {t('delete')}
      </button>
    </li>
  );
}

function DocumentList({
  docs,
  coopId,
  meetingId,
  onChange,
}: {
  docs: MeetingDoc[];
  coopId: string;
  meetingId: string;
  onChange: () => void;
}) {
  const t = useTranslations('meetings.documents');

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api(`/admin/coops/${coopId}/meetings/${meetingId}/documents`, {
        method: 'POST',
        body: fd,
      });
    },
    onSuccess: () => onChange(),
  });

  const updateDoc = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api(`/admin/coops/${coopId}/meetings/${meetingId}/documents/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: () => onChange(),
  });

  const removeDoc = useMutation({
    mutationFn: async (id: string) =>
      api(`/admin/coops/${coopId}/meetings/${meetingId}/documents/${id}`, { method: 'DELETE' }),
    onSuccess: () => onChange(),
  });

  function handleDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const oldIdx = docs.findIndex((d) => d.id === e.active.id);
    const newIdx = docs.findIndex((d) => d.id === e.over!.id);
    const reordered = arrayMove(docs, oldIdx, newIdx);
    // Persist new order: PATCH each affected row
    reordered.forEach((d, idx) => {
      if (d.order !== idx) updateDoc.mutate({ id: d.id, body: { order: idx } });
    });
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium">📎 {t('title')}</h2>
      <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={docs.map((d) => d.id)} strategy={verticalListSortingStrategy}>
          <ul className="rounded border">
            {docs.map((d) => (
              <SortableRow
                key={d.id}
                doc={d}
                onRename={(id, displayName) => updateDoc.mutate({ id, body: { displayName } })}
                onDelete={(id) => removeDoc.mutate(id)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <label className="block">
        <span className="block text-sm font-medium">{t('uploadCta')}</span>
        <input
          type="file"
          accept="application/pdf"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload.mutate(f);
            e.target.value = '';
          }}
        />
      </label>
    </section>
  );
}
```

- [ ] **Step 2: Smoke test**

`pnpm dev` → visit page → upload 3 PDFs → drag to reorder → click filename to rename → click delete. All three should round-trip to the API.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/[locale]/dashboard/admin/meetings/[meetingId]/documents/documents-page-client.tsx
git commit -m "feat(web): sortable + renameable + deletable document list"
```

---

## Task 12: Frontend — mail draft + send + status table

**Files:**
- Modify: `apps/web/src/app/[locale]/dashboard/admin/meetings/[meetingId]/documents/documents-page-client.tsx`

- [ ] **Step 1: Add MailDraftSection**

Append to the file (export not needed; co-located component):

```typescript
function MailDraftSection({
  coopId,
  meetingId,
  hasDocuments,
}: {
  coopId: string;
  meetingId: string;
  hasDocuments: boolean;
}) {
  const t = useTranslations('meetings.documents');
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['meeting-documents-email', meetingId],
    queryFn: () => api(`/admin/coops/${coopId}/meetings/${meetingId}/documents-email`),
  });
  const [subject, setSubject] = useState('');
  const [intro, setIntro] = useState('');

  // Sync once when query loads
  useEffect(() => {
    if (data) {
      setSubject(data.subject ?? '');
      setIntro(data.intro ?? '');
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      api(`/admin/coops/${coopId}/meetings/${meetingId}/documents-email`, {
        method: 'PATCH',
        body: JSON.stringify({ subject, intro }),
        headers: { 'Content-Type': 'application/json' },
      }),
  });

  const send = useMutation({
    mutationFn: () =>
      api(`/admin/coops/${coopId}/meetings/${meetingId}/documents-email/send`, {
        method: 'POST',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meeting-documents-email', meetingId] }),
  });

  if (!data) return null;

  const recipientCount = data.recipientCount ?? 0;
  const failedCount = data.failedCount ?? 0;
  const alreadySent = data.sentAt != null;

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium">✉️ {t('subjectLabel')}</h2>
      <input
        className="w-full rounded border px-3 py-2"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        onBlur={() => save.mutate()}
        placeholder={t('subjectPlaceholder')}
      />
      <textarea
        className="w-full rounded border px-3 py-2"
        rows={6}
        value={intro}
        onChange={(e) => setIntro(e.target.value)}
        onBlur={() => save.mutate()}
        placeholder={t('introPlaceholder')}
      />

      <div className="flex items-center gap-3 pt-4">
        <span>{t('recipientCount', { count: recipientCount })}</span>
        {!alreadySent && (
          <button
            disabled={!hasDocuments || recipientCount === 0}
            onClick={() => {
              if (confirm(t('sendConfirm', { count: recipientCount }))) send.mutate();
            }}
            className="rounded bg-primary px-4 py-2 text-white disabled:opacity-50"
          >
            {t('sendCta')}
          </button>
        )}
        {alreadySent && failedCount > 0 && (
          <button
            onClick={() => {
              if (confirm(t('sendConfirm', { count: failedCount }))) send.mutate();
            }}
            className="rounded bg-amber-600 px-4 py-2 text-white"
          >
            {t('resendFailed', { count: failedCount })}
          </button>
        )}
      </div>

      {alreadySent && (
        <p className="text-sm text-muted-foreground">
          {t('sentSummary', {
            date: new Date(data.sentAt).toLocaleString(),
            sent: data.sentCount,
            total: recipientCount,
          })}
        </p>
      )}
    </section>
  );
}
```

Add `useEffect` to imports.

- [ ] **Step 2: Add StatusTable**

```typescript
type AttendanceStatus = {
  shareholderName: string;
  documentsEmailSentAt: string | null;
  documentsEmailError: string | null;
  documentsEmailOpenedAt: string | null;
  documentsDownloadedAt: string | null;
};

function StatusTable({ coopId, meetingId }: { coopId: string; meetingId: string }) {
  const t = useTranslations('meetings.documents');
  const { data = [] } = useQuery<AttendanceStatus[]>({
    queryKey: ['meeting-documents-status', meetingId],
    queryFn: () =>
      api(`/admin/coops/${coopId}/meetings/${meetingId}/rsvp/attendance-statuses`).catch(() => []),
    refetchInterval: 10_000,
  });

  if (data.length === 0) return null;

  return (
    <section>
      <h2 className="text-lg font-medium">📊 {t('statusTitle')}</h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left">
            <th>Coöperant</th>
            <th>{t('status.sent')}</th>
            <th>{t('status.opened')}</th>
            <th>{t('status.downloaded')}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i} className="border-t">
              <td>{row.shareholderName}</td>
              <td>{row.documentsEmailError ? `✗ ${row.documentsEmailError}` : row.documentsEmailSentAt ? '✓' : '—'}</td>
              <td>{row.documentsEmailOpenedAt ? '✓' : '—'}</td>
              <td>{row.documentsDownloadedAt ? '✓' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
```

> **Status endpoint**: this requires a backend GET endpoint that returns per-attendance status. Add `GET /admin/coops/:coopId/meetings/:id/rsvp/attendance-statuses` to the meetings controller, returning attendance rows with shareholder name + the four tracking fields. Implementation: simple Prisma query with include shareholder. (Add this endpoint as a small commit alongside Task 7's controller work, or here in this task.)

- [ ] **Step 3: Render the new sections in DocumentsPageClient**

```typescript
return (
  <div className="space-y-8 p-6">
    <header>
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <p className="text-muted-foreground">{t('description')}</p>
    </header>
    <DocumentList docs={docs} coopId={coopId} meetingId={meetingId} onChange={refetch} />
    <MailDraftSection coopId={coopId} meetingId={meetingId} hasDocuments={docs.length > 0} />
    <StatusTable coopId={coopId} meetingId={meetingId} />
  </div>
);
```

- [ ] **Step 4: Add backend status endpoint**

In `meetings.controller.ts`:

```typescript
@Get(':id/rsvp/attendance-statuses')
listAttendanceStatuses(@Param('coopId') coopId: string, @Param('id') id: string) {
  return this.documents.listAttendanceStatuses(coopId, id);
}
```

In `meeting-documents.service.ts`:

```typescript
async listAttendanceStatuses(coopId: string, meetingId: string) {
  await this.assertMeetingInCoop(coopId, meetingId);
  const rows = await this.prisma.meetingAttendance.findMany({
    where: { meetingId },
    include: {
      shareholder: { select: { firstName: true, lastName: true, companyName: true } },
    },
    orderBy: { id: 'asc' },
  });
  return rows.map((r) => ({
    shareholderName: r.shareholder.companyName ?? `${r.shareholder.firstName ?? ''} ${r.shareholder.lastName ?? ''}`.trim(),
    documentsEmailSentAt: r.documentsEmailSentAt,
    documentsEmailError: r.documentsEmailError,
    documentsEmailOpenedAt: r.documentsEmailOpenedAt,
    documentsDownloadedAt: r.documentsDownloadedAt,
  }));
}
```

- [ ] **Step 5: Smoke test**

`pnpm dev` (both api + web) → visit page → write subject + intro → click Send → check that the status table populates over the next 10s.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/[locale]/dashboard/admin/meetings/[meetingId]/documents/ apps/api/src/modules/meetings/
git commit -m "feat(web): mail draft + send + status table for documents"
```

---

## Task 13: Add link from meeting overview

**Files:**
- Modify: `apps/web/src/app/[locale]/dashboard/admin/meetings/[meetingId]/page.tsx`

- [ ] **Step 1: Add a checklist entry**

Find the existing next-action checklist (or actions section) on the meeting overview page. Add a new entry that's visible when `meeting.status === 'CONVOKED'`:

```typescript
{meeting.status === 'CONVOKED' && (
  <Link
    href={`/${locale}/dashboard/admin/meetings/${meeting.id}/documents`}
    className="block rounded border p-4 hover:bg-muted"
  >
    📎 {t('documents.title')}
    <p className="text-sm text-muted-foreground">{t('documents.description')}</p>
  </Link>
)}
```

- [ ] **Step 2: Smoke test navigation**

Click through from meetings list → meeting overview → documents page. Verify back-button works.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/[locale]/dashboard/admin/meetings/[meetingId]/page.tsx
git commit -m "feat(web): link to documents page from meeting overview"
```

---

## Task 14: Manual QA on local dev

**Files:** none (verification step)

- [ ] **Step 1: Set up a test meeting**

Open Prisma Studio (`pnpm db:studio`) → find an existing test coop → create a test `Meeting` with `status='CONVOKED'`, `scheduledAt` 2 weeks in the future. Create 2-3 `MeetingAttendance` rows with valid `rsvpToken`s and your own email addresses (use mailcatcher or your real inbox).

- [ ] **Step 2: Walk the full flow**

1. Visit documents page for the test meeting.
2. Upload `Jaarverslag.pdf` (any PDF).
3. Upload another PDF.
4. Drag-reorder.
5. Rename one inline.
6. Edit subject + intro, blur to save.
7. Click Send → confirm.
8. Open the email in your inbox.
9. Click the document link → verify download works, original filename used.
10. Reload the documents page → verify status table shows ✓ for sent/opened/downloaded.
11. Pause 30s, reload → confirm `documentsEmailSentAt` is set per attendance.

- [ ] **Step 3: Verify edge cases**

- Try uploading a non-PDF → expect 400.
- Try uploading >10MB PDF → expect 413.
- Click Send a second time without any failures → expect button to be hidden (no failures to retry).
- Manually set one attendance's `documentsEmailError = 'test-error'` in Prisma Studio → reload → verify retry button appears with count 1 → click → verify error cleared and resend triggered.

- [ ] **Step 4: Document any bugs found**

If issues found, file as TODO comments at the call sites and continue OR fix and amend the relevant task commit. Do not stop the plan unless a bug is critical.

---

## Task 15: Deploy to acc + production

**Files:** none (deployment)

- [ ] **Step 1: Push branch + open PR**

```bash
git push -u origin feature/agm-document-sharing
gh pr create --title "feat(meetings): AGM document sharing" --body "$(cat <<'EOF'
## Summary
- New module to share AGM agenda documents (jaarverslag, etc.) with members.
- Editable per-meeting mailing with token-protected PDF download links.
- Per-recipient send/open/download tracking.

Implements [`docs/superpowers/specs/2026-05-08-agm-document-sharing-design.md`](docs/superpowers/specs/2026-05-08-agm-document-sharing-design.md).

## Test plan
- [ ] Schema migration runs cleanly on acc
- [ ] Upload + reorder + rename + delete PDF works
- [ ] Send mail to test address; verify pixel and download tracking trigger
- [ ] Retry-failed flow works after seeding a fake error
- [ ] Replace-in-place: re-upload with same displayName updates the existing row

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Monitor CI**

Wait for CI to pass on the PR. If it fails, fix and re-push.

- [ ] **Step 3: Merge to main → deploys to acc**

After review and CI green, merge.

- [ ] **Step 4: Manual QA on acc.opencoop.be**

Repeat Task 14 walkthrough on the acc environment with a Bronsgroen test meeting (or `demo` coop's test meeting). Verify SMTP delivery to your real inbox; verify pixel fires across Apple Mail, Gmail, Outlook (open the same email in three clients if possible).

- [ ] **Step 5: Bump version + tag prod + update CHANGELOG**

```bash
# In CHANGELOG.md, add:
# ## v0.8.29 (or next sequential)
# - feat(meetings): share AGM documents with members via editable mailing

git add CHANGELOG.md && git commit -m "chore: CHANGELOG for v0.8.29"
git push origin main
git tag -a v0.8.29 -m "AGM document sharing"
git push origin v0.8.29
```

Monitor the prod CI run to completion.

- [ ] **Step 6: Wouter — production setup**

1. On `bronsgroen.be/privacy`: add notice about open-tracking pixel in AGM emails.
2. In Bronsgroen prod admin: navigate to AGM 2026-05-09 → upload jaarverslag, jaarrekening, begroting → set subject/intro → send mailing **on or before 2026-05-02**.
3. Watch the status table over the following days for failures; retry as needed.

---

## Self-Review

**Spec coverage check:**
- §2 data model → Task 1 ✓
- §3 backend service + endpoints → Tasks 3, 4, 5, 7, 8 ✓
- §4 frontend admin page → Tasks 10, 11, 12, 13 ✓
- §5 email flow → Task 6 ✓
- §6 edge cases — file size/mimetype (Task 3), replace-in-place (Task 3), concurrency (Task 5), no-docs/non-CONVOKED (Task 5), expired token (Task 8), pixel idempotency (Task 8) ✓
- §7 testing — unit tests in Tasks 3-5, 8; integration via Task 14 manual QA ✓
- §8 deployment → Task 15 ✓
- §9 deps → Task 9 ✓

**Known compromises (intentional, called out in spec or here):**
- Status endpoint added in Task 12 instead of Task 7 (logical group with the UI consumer).
- `escapeHtml` helper inlined in service (small enough; if it grows, extract).
- The `enqueueDocumentsEmailJob` placeholder pattern in Task 5 is replaced in Task 6 — clear order dependency.
- Task 14 manual QA is gating; not automated.

**Outstanding before ship (not blockers, but tracked):**
- Wouter copy-edits FR + DE i18n during Task 9 (left as NL fallback).
- Wouter updates `bronsgroen.be/privacy` (Task 15 step 6).
