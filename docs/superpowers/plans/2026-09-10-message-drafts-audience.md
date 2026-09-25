# Message Drafts, Audiences, Rich Text and Scheduling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a coop admin, or an agent through the MCP server, prepare a message to a chosen group of shareholders as a draft, review it, and send it now or at a set time, with the full text in each recipient's e-mail.

**Architecture:** `Conversation` gains a status (`DRAFT → SCHEDULED → SENT`) and an audience (`ALL | PROJECT | SELECTED`). Participants are created only by one guarded `send()` path, which the "send now" button, the minute cron and nothing else call. Admin message bodies become sanitised HTML; the e-mail template renders that HTML in full. Three MCP tools create and edit drafts and can never send.

**Tech Stack:** NestJS 10 + Prisma 6 + PostgreSQL 16 (`apps/api`, `packages/database`), Next.js App Router + next-intl + shadcn-style components (`apps/web`), Jest (`apps/api`), Playwright (`e2e`). New deps: `sanitize-html`, `marked` (api); `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-link` (web).

**Spec:** `docs/superpowers/specs/2026-09-10-message-drafts-audience-design.md`

## Global Constraints

- Package manager is `pnpm` (workspaces + Turborepo). Run commands from the repo root with `pnpm --filter <pkg>`; API package name is `@opencoop/api`, web is `@opencoop/web`, database is `@opencoop/database`.
- Node ≥ 20. TypeScript everywhere. Existing style: 2-space indent, single quotes, trailing commas, `class-validator` decorators on DTOs, `@ApiProperty` on DTO fields.
- Every user-facing string in the web app goes through `next-intl` with fully-qualified keys (`t('messages.xxx')`) and must be added to all four files `apps/web/messages/{nl,fr,de,en}.json`. Dutch is the source text.
- Every e-mail string goes through `apps/api/src/modules/email/i18n/{nl,fr,de,en}.json`.
- Commits: conventional prefix (`feat(messages): …`, `fix(...)`, `docs:`), one commit per task, all with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Sanitiser allowlist (verbatim from spec §5): tags `p, br, strong, em, u, s, h2, h3, ul, ol, li, a, blockquote`; `a` only `href` with schemes `http`, `https`, `mailto`, and `rel="noopener noreferrer"` added.
- Body limit after sanitising: 100 000 characters → `400`.
- Scheduling: `scheduledAt` must be at least 60 seconds in the future → otherwise `400`.
- Never mention a financial regulator anywhere in shipped copy (Bronsgroen constraint, Prospectuswet art. 24 §5). Not relevant to code, relevant to any sample text.
- Run `pnpm --filter @opencoop/api test` before every commit that touches `apps/api`; run `pnpm --filter @opencoop/web lint` and `pnpm --filter @opencoop/web build` before every commit that touches `apps/web`.
- Branch: `feat/message-drafts-audience` (already exists, spec committed on it). PR to `main`.

---

## File map

**packages/database**
- Modify `prisma/schema.prisma` — enums `ConversationStatus`, `AudienceType`, `MessageFormat`; new columns on `Conversation` and `Message`; relations on `Project`, `ApiKey`.
- Create `prisma/migrations/<timestamp>_message_drafts_audience/migration.sql` — generated, then edited for the backfill.

**apps/api/src/modules/messages**
- Create `message-body.ts` — `sanitizeMessageHtml`, `markdownToMessageHtml`, `textToMessageHtml`, `MESSAGE_BODY_MAX_CHARS`. Pure functions.
- Create `message-body.spec.ts`.
- Create `audience.service.ts` — `AudienceService.resolve(coopId, audience)`; the only place that turns an audience into shareholder ids.
- Create `audience.service.spec.ts`.
- Modify `messages.service.ts` — draft creation, `updateDraft`, `deleteDraft`, `send`, `schedule`, `cancelSchedule`, `recipientCount` in list, full-body notifications.
- Create `messages.service.spec.ts`.
- Create `messages.scheduler.ts` + `messages.scheduler.spec.ts` — minute cron.
- Modify `messages.module.ts` — providers.
- Modify `dto/create-conversation.dto.ts`; create `dto/audience.dto.ts`, `dto/update-draft.dto.ts`, `dto/schedule-conversation.dto.ts`.

**apps/api/src/modules/admin**
- Modify `admin.controller.ts:1141-1200` — new routes.

**apps/api/src/modules/email**
- Modify `email.processor.ts:510-531` — `message-notification` renders `messageBody`.
- Modify `i18n/{nl,fr,de,en}.json` — `message-notification.replyHint`, drop `body`.
- Modify `email.processor.render.spec.ts` snapshots.

**apps/api/src/common/utils**
- Create `coop-permissions.ts` — `mergeAdminPermissions` (moved from `token.service.ts`) + `CoopPermissionsService.has(userId, coopId, key)`.
- Create `coop-permissions.spec.ts`.
- Modify `apps/api/src/modules/auth/token.service.ts:14-27` — import instead of local function.

**apps/api/src/modules/mcp**
- Modify `mcp-auth.store.ts`, `mcp-auth.middleware.ts` — carry `apiKeyId`.
- Create `tools/mcp-message.tools.ts` + `tools/mcp-message.tools.spec.ts`.
- Modify `mcp.module.ts` — register.

**apps/web/src**
- Create `components/admin/rich-text-editor.tsx` — TipTap wrapper, `value`/`onChange` HTML.
- Create `components/admin/audience-picker.tsx` — ALL / PROJECT / SELECTED with live count.
- Create `components/admin/schedule-dialog.tsx` — date + time → ISO string.
- Create `components/message-body.tsx` — renders `HTML` or `TEXT` bodies; used by inbox and admin detail.
- Modify `app/globals.css` — `.message-html` styles.
- Modify `app/[locale]/dashboard/admin/messages/new/page.tsx` — rewrite around the three components.
- Modify `app/[locale]/dashboard/admin/messages/page.tsx` — status badge, ordering.
- Modify `app/[locale]/dashboard/admin/messages/[conversationId]/page.tsx` — draft edit / scheduled / sent modes.
- Modify `app/[locale]/dashboard/inbox/[conversationId]/page.tsx` — use `MessageBody`.
- Modify `messages/{nl,fr,de,en}.json`.

**e2e**
- Create `e2e/tests/admin/messages-draft.spec.ts`.

**docs**
- Modify `CHANGELOG.md`.

---

### Task 1: Schema and migration

**Files:**
- Modify: `packages/database/prisma/schema.prisma:887-955` (Conversation, Message), `:338-353` (ApiKey), `:641-661` (Project)
- Create: `packages/database/prisma/migrations/<timestamp>_message_drafts_audience/migration.sql`

**Interfaces:**
- Produces: Prisma types `ConversationStatus` (`DRAFT | SCHEDULED | SENT`), `AudienceType` (`ALL | PROJECT | SELECTED`), `MessageFormat` (`TEXT | HTML`); `Conversation.{status, scheduledAt, sentAt, sendAttempts, audienceType, audienceProjectId, audienceShareholderIds, createdByApiKeyId}`; `Message.format`.

- [ ] **Step 1: Edit the schema**

In `packages/database/prisma/schema.prisma`, above `model Conversation` add:

```prisma
enum ConversationStatus {
  DRAFT
  SCHEDULED
  SENT
}

enum AudienceType {
  ALL
  PROJECT
  SELECTED
}

enum MessageFormat {
  TEXT
  HTML
}
```

Replace `model Conversation` with:

```prisma
model Conversation {
  id        String           @id @default(cuid())
  coopId    String
  subject   String
  type      ConversationType
  createdAt DateTime         @default(now())
  updatedAt DateTime         @updatedAt

  createdById String

  status                 ConversationStatus @default(SENT)
  scheduledAt            DateTime?
  sentAt                 DateTime?
  sendAttempts           Int                @default(0)
  audienceType           AudienceType       @default(ALL)
  audienceProjectId      String?
  audienceShareholderIds String[]           @default([])
  createdByApiKeyId      String?

  coop            Coop                      @relation(fields: [coopId], references: [id], onDelete: Cascade)
  createdBy       User                      @relation("ConversationCreatedBy", fields: [createdById], references: [id])
  audienceProject Project?                  @relation("ConversationAudienceProject", fields: [audienceProjectId], references: [id], onDelete: SetNull)
  createdByApiKey ApiKey?                   @relation("ConversationCreatedByApiKey", fields: [createdByApiKeyId], references: [id], onDelete: SetNull)
  messages        Message[]
  participants    ConversationParticipant[]

  @@index([coopId])
  @@index([createdById])
  @@index([coopId, status])
  @@index([status, scheduledAt])
  @@map("conversations")
}
```

In `model Message` add after `body`:

```prisma
  format         MessageFormat @default(TEXT)
```

In `model Project` add to the relations block:

```prisma
  audienceConversations Conversation[] @relation("ConversationAudienceProject")
```

In `model ApiKey` add before `@@index`:

```prisma
  draftConversations Conversation[] @relation("ConversationCreatedByApiKey")
```

- [ ] **Step 2: Generate the migration without applying it**

Run from repo root (needs a local Postgres per `docker-compose.dev.yml`; `DATABASE_URL` from `.env`):

```bash
pnpm --filter @opencoop/database exec prisma migrate dev --name message_drafts_audience --create-only
```

Expected: a new folder under `packages/database/prisma/migrations/` ending in `_message_drafts_audience` containing `migration.sql` with `CREATE TYPE`, `ALTER TABLE "conversations" ADD COLUMN …`, `ALTER TABLE "messages" ADD COLUMN …`, foreign keys and indexes.

- [ ] **Step 3: Append the backfill to the generated SQL**

At the end of that `migration.sql` add:

```sql
-- Backfill: everything that exists today was sent the moment it was created.
UPDATE "conversations"
SET "status" = 'SENT', "sentAt" = "createdAt"
WHERE "status" = 'SENT' AND "sentAt" IS NULL;

-- Broadcasts addressed everyone; direct conversations addressed their single participant.
UPDATE "conversations" SET "audienceType" = 'ALL' WHERE "type" = 'BROADCAST';

UPDATE "conversations" c
SET "audienceType" = 'SELECTED',
    "audienceShareholderIds" = ARRAY(
      SELECT p."shareholderId" FROM "conversation_participants" p WHERE p."conversationId" = c."id"
    )
WHERE c."type" = 'DIRECT';
```

- [ ] **Step 4: Apply and regenerate the client**

```bash
pnpm --filter @opencoop/database exec prisma migrate dev
pnpm --filter @opencoop/database generate
pnpm --filter @opencoop/api exec tsc --noEmit
```

Expected: migration applied, client generated, `tsc` reports no errors (nothing uses the new fields yet).

- [ ] **Step 5: Verify the backfill on the dev database**

```bash
pnpm --filter @opencoop/database exec prisma db execute --stdin <<'SQL'
SELECT "type", "status", "audienceType", count(*) FROM "conversations" GROUP BY 1,2,3;
SQL
```

Expected: every row has `status = SENT`; `BROADCAST` rows show `ALL`, `DIRECT` rows show `SELECTED`. If the dev DB is empty, seed with `pnpm --filter @opencoop/database seed` first and re-run.

- [ ] **Step 6: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations
git commit -m "feat(messages): conversation status, audience and message format columns

Adds DRAFT/SCHEDULED/SENT status, scheduledAt/sentAt/sendAttempts, an
audience (ALL, PROJECT, SELECTED) and createdByApiKeyId on conversations,
and a TEXT/HTML format on messages. Existing rows are backfilled as SENT
with the audience they had.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Message body sanitiser and converters

**Files:**
- Create: `apps/api/src/modules/messages/message-body.ts`
- Test: `apps/api/src/modules/messages/message-body.spec.ts`
- Modify: `apps/api/package.json` (deps)

**Interfaces:**
- Produces:
  - `sanitizeMessageHtml(html: string): string` — allowlisted HTML, throws `BadRequestException('Message body too long')` above `MESSAGE_BODY_MAX_CHARS`.
  - `markdownToMessageHtml(markdown: string): string` — Markdown → sanitised HTML.
  - `textToMessageHtml(text: string): string` — escapes and wraps plain text in `<p>`, `\n` → `<br>`.
  - `MESSAGE_BODY_MAX_CHARS = 100_000`.

- [ ] **Step 1: Add dependencies**

```bash
pnpm --filter @opencoop/api add sanitize-html marked
pnpm --filter @opencoop/api add -D @types/sanitize-html
```

- [ ] **Step 2: Write the failing tests**

`apps/api/src/modules/messages/message-body.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import {
  sanitizeMessageHtml,
  markdownToMessageHtml,
  textToMessageHtml,
  MESSAGE_BODY_MAX_CHARS,
} from './message-body';

describe('sanitizeMessageHtml', () => {
  it('keeps the allowlisted tags', () => {
    const html =
      '<h2>Titel</h2><p>Een <strong>vet</strong>, <em>schuin</em>, <u>onderlijnd</u>, <s>door</s> woord.</p><ul><li>a</li></ul><ol><li>b</li></ol><blockquote>q</blockquote><p>x<br>y</p>';
    expect(sanitizeMessageHtml(html)).toBe(
      '<h2>Titel</h2><p>Een <strong>vet</strong>, <em>schuin</em>, <u>onderlijnd</u>, <s>door</s> woord.</p><ul><li>a</li></ul><ol><li>b</li></ol><blockquote>q</blockquote><p>x<br />y</p>',
    );
  });

  it('strips script, style, event handlers and unknown tags but keeps their text', () => {
    const html = '<p onclick="x()">hi<script>alert(1)</script><style>p{}</style><div>inner</div></p>';
    expect(sanitizeMessageHtml(html)).toBe('<p>hiinner</p>');
  });

  it('keeps http, https and mailto links and adds rel', () => {
    expect(sanitizeMessageHtml('<a href="https://bronsgroen.be">site</a>')).toBe(
      '<a href="https://bronsgroen.be" rel="noopener noreferrer">site</a>',
    );
    expect(sanitizeMessageHtml('<a href="mailto:info@bronsgroen.be">mail</a>')).toBe(
      '<a href="mailto:info@bronsgroen.be" rel="noopener noreferrer">mail</a>',
    );
  });

  it('drops javascript: links but keeps the text', () => {
    expect(sanitizeMessageHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a rel="noopener noreferrer">x</a>');
  });

  it('drops h1 and images', () => {
    expect(sanitizeMessageHtml('<h1>big</h1><img src="x.png">')).toBe('big');
  });

  it('rejects bodies over the limit', () => {
    const big = '<p>' + 'a'.repeat(MESSAGE_BODY_MAX_CHARS) + '</p>';
    expect(() => sanitizeMessageHtml(big)).toThrow(BadRequestException);
  });
});

describe('markdownToMessageHtml', () => {
  it('converts headings, emphasis, lists and links', () => {
    const md = '## Wat er is beslist\n\nEen **vet** woord en een [link](https://bronsgroen.be).\n\n- een\n- twee\n';
    expect(markdownToMessageHtml(md)).toBe(
      '<h2>Wat er is beslist</h2>\n<p>Een <strong>vet</strong> woord en een <a href="https://bronsgroen.be" rel="noopener noreferrer">link</a>.</p>\n<ul>\n<li>een</li>\n<li>twee</li>\n</ul>\n',
    );
  });

  it('downgrades h1 to plain text because h1 is not allowed', () => {
    expect(markdownToMessageHtml('# Titel')).toBe('Titel\n');
  });

  it('does not let raw html through', () => {
    expect(markdownToMessageHtml('<script>x</script>tekst')).toBe('<p>tekst</p>\n');
  });
});

describe('textToMessageHtml', () => {
  it('escapes and wraps paragraphs', () => {
    expect(textToMessageHtml('a < b\n\nc & d\ne')).toBe('<p>a &lt; b</p><p>c &amp; d<br />e</p>');
  });

  it('returns an empty string for empty input', () => {
    expect(textToMessageHtml('')).toBe('');
  });
});
```

- [ ] **Step 3: Run the tests to see them fail**

```bash
pnpm --filter @opencoop/api test -- message-body
```

Expected: FAIL, cannot find module `./message-body`.

- [ ] **Step 4: Implement**

`apps/api/src/modules/messages/message-body.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import sanitizeHtml from 'sanitize-html';
import { marked } from 'marked';

export const MESSAGE_BODY_MAX_CHARS = 100_000;

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'em', 'u', 's', 'h2', 'h3', 'ul', 'ol', 'li', 'a', 'blockquote'],
  allowedAttributes: { a: ['href', 'rel'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
    b: 'strong',
    i: 'em',
    h1: (tagName, attribs) => ({ tagName: '', attribs }),
  },
  // Text of dropped tags stays; script/style content is removed by the defaults.
  nonTextTags: ['script', 'style', 'textarea', 'option'],
};

/** Allowlist-sanitise an HTML message body. Throws 400 when the result is too long. */
export function sanitizeMessageHtml(html: string): string {
  const clean = sanitizeHtml(html ?? '', SANITIZE_OPTIONS).trim();
  if (clean.length > MESSAGE_BODY_MAX_CHARS) {
    throw new BadRequestException('Message body too long');
  }
  return clean;
}

/** Markdown (what agents write) → the same sanitised HTML the editor produces. */
export function markdownToMessageHtml(markdown: string): string {
  const html = marked.parse(markdown ?? '', { async: false, gfm: true, breaks: false }) as string;
  return sanitizeMessageHtml(html);
}

/** Plain text (legacy TEXT messages, shareholder replies) → escaped paragraphs. */
export function textToMessageHtml(text: string): string {
  if (!text) return '';
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${escape(para).replace(/\n/g, '<br />')}</p>`)
    .join('');
}
```

Note: `sanitize-html` serialises `<br>` as `<br />`; the tests expect that. If a test shows `<h1>` text kept with a stray newline different from the expectation, adjust the expectation to the actual `marked` output once, not the code: the requirement is "no h1 tag, text kept".

- [ ] **Step 5: Run the tests to see them pass**

```bash
pnpm --filter @opencoop/api test -- message-body
```

Expected: PASS (11 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/modules/messages/message-body.ts apps/api/src/modules/messages/message-body.spec.ts
git commit -m "feat(messages): sanitised HTML message bodies with markdown input

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Audience resolution

**Files:**
- Create: `apps/api/src/modules/messages/audience.service.ts`
- Test: `apps/api/src/modules/messages/audience.service.spec.ts`
- Modify: `apps/api/src/modules/messages/messages.module.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Audience { type: 'ALL' | 'PROJECT' | 'SELECTED'; projectId?: string | null; shareholderIds?: string[] }
  class AudienceService { resolve(coopId: string, audience: Audience): Promise<{ shareholderIds: string[] }> }
  ```
  Throws `NotFoundException('Project not found')` for a project outside the coop; `BadRequestException` when `PROJECT` has no `projectId`.

- [ ] **Step 1: Write the failing tests**

`apps/api/src/modules/messages/audience.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AudienceService } from './audience.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('AudienceService', () => {
  let service: AudienceService;
  const prisma = {
    shareholder: { findMany: jest.fn() },
    project: { findFirst: jest.fn() },
    registration: { findMany: jest.fn() },
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [AudienceService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(AudienceService);
    jest.clearAllMocks();
  });

  it('ALL returns every active shareholder of the coop', async () => {
    prisma.shareholder.findMany.mockResolvedValue([{ id: 's1' }, { id: 's2' }]);
    const r = await service.resolve('coop1', { type: 'ALL' });
    expect(r.shareholderIds).toEqual(['s1', 's2']);
    expect(prisma.shareholder.findMany).toHaveBeenCalledWith({
      where: { coopId: 'coop1', status: 'ACTIVE' },
      select: { id: true },
    });
  });

  it('PROJECT returns distinct active shareholders with a BUY registration on the project', async () => {
    prisma.project.findFirst.mockResolvedValue({ id: 'p1' });
    prisma.registration.findMany.mockResolvedValue([
      { shareholderId: 's1' },
      { shareholderId: 's1' },
      { shareholderId: 's2' },
    ]);
    const r = await service.resolve('coop1', { type: 'PROJECT', projectId: 'p1' });
    expect(r.shareholderIds).toEqual(['s1', 's2']);
    expect(prisma.registration.findMany).toHaveBeenCalledWith({
      where: {
        coopId: 'coop1',
        projectId: 'p1',
        type: 'BUY',
        status: { in: ['ACTIVE', 'COMPLETED'] },
        shareholder: { status: 'ACTIVE' },
      },
      select: { shareholderId: true },
    });
  });

  it('PROJECT rejects a project of another coop', async () => {
    prisma.project.findFirst.mockResolvedValue(null);
    await expect(service.resolve('coop1', { type: 'PROJECT', projectId: 'px' })).rejects.toThrow(NotFoundException);
  });

  it('PROJECT without projectId is a bad request', async () => {
    await expect(service.resolve('coop1', { type: 'PROJECT' })).rejects.toThrow(BadRequestException);
  });

  it('SELECTED keeps only active shareholders of this coop and drops unknown ids', async () => {
    prisma.shareholder.findMany.mockResolvedValue([{ id: 's2' }]);
    const r = await service.resolve('coop1', { type: 'SELECTED', shareholderIds: ['s2', 'ghost'] });
    expect(r.shareholderIds).toEqual(['s2']);
    expect(prisma.shareholder.findMany).toHaveBeenCalledWith({
      where: { coopId: 'coop1', status: 'ACTIVE', id: { in: ['s2', 'ghost'] } },
      select: { id: true },
    });
  });

  it('SELECTED with no ids resolves to nobody without querying', async () => {
    const r = await service.resolve('coop1', { type: 'SELECTED', shareholderIds: [] });
    expect(r.shareholderIds).toEqual([]);
    expect(prisma.shareholder.findMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to see it fail**

```bash
pnpm --filter @opencoop/api test -- audience.service
```

Expected: FAIL, cannot find module `./audience.service`.

- [ ] **Step 3: Implement**

`apps/api/src/modules/messages/audience.service.ts`:

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface Audience {
  type: 'ALL' | 'PROJECT' | 'SELECTED';
  projectId?: string | null;
  shareholderIds?: string[];
}

/**
 * The single place that turns an audience into shareholder ids.
 * Used for the live count, the send path and the scheduler. Never sends anything.
 */
@Injectable()
export class AudienceService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(coopId: string, audience: Audience): Promise<{ shareholderIds: string[] }> {
    switch (audience.type) {
      case 'ALL': {
        const rows = await this.prisma.shareholder.findMany({
          where: { coopId, status: 'ACTIVE' },
          select: { id: true },
        });
        return { shareholderIds: rows.map((r) => r.id) };
      }
      case 'PROJECT': {
        if (!audience.projectId) throw new BadRequestException('projectId is required for a PROJECT audience');
        const project = await this.prisma.project.findFirst({
          where: { id: audience.projectId, coopId },
          select: { id: true },
        });
        if (!project) throw new NotFoundException('Project not found');
        const regs = await this.prisma.registration.findMany({
          where: {
            coopId,
            projectId: project.id,
            type: 'BUY',
            status: { in: ['ACTIVE', 'COMPLETED'] },
            shareholder: { status: 'ACTIVE' },
          },
          select: { shareholderId: true },
        });
        return { shareholderIds: [...new Set(regs.map((r) => r.shareholderId))] };
      }
      case 'SELECTED': {
        const ids = audience.shareholderIds ?? [];
        if (ids.length === 0) return { shareholderIds: [] };
        const rows = await this.prisma.shareholder.findMany({
          where: { coopId, status: 'ACTIVE', id: { in: ids } },
          select: { id: true },
        });
        return { shareholderIds: rows.map((r) => r.id) };
      }
      default:
        throw new BadRequestException('Unknown audience type');
    }
  }
}
```

Register it in `apps/api/src/modules/messages/messages.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { AudienceService } from './audience.service';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [EmailModule],
  providers: [MessagesService, AudienceService],
  exports: [MessagesService, AudienceService],
})
export class MessagesModule {}
```

- [ ] **Step 4: Run to see it pass**

```bash
pnpm --filter @opencoop/api test -- audience.service
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/messages/audience.service.ts apps/api/src/modules/messages/audience.service.spec.ts apps/api/src/modules/messages/messages.module.ts
git commit -m "feat(messages): audience resolution (all, project, selected)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: DTOs

**Files:**
- Create: `apps/api/src/modules/messages/dto/audience.dto.ts`, `dto/update-draft.dto.ts`, `dto/schedule-conversation.dto.ts`
- Modify: `apps/api/src/modules/messages/dto/create-conversation.dto.ts`

**Interfaces:**
- Produces:
  ```ts
  class AudienceDto { type: 'ALL'|'PROJECT'|'SELECTED'; projectId?: string; shareholderIds?: string[] }
  class CreateConversationDto { subject; type; body; format?: 'TEXT'|'HTML'; status?: 'DRAFT'|'SENT'; audience?: AudienceDto; shareholderId?; existingDocumentIds? }
  class UpdateDraftDto { subject?: string; body?: string; format?: 'TEXT'|'HTML'; audience?: AudienceDto }
  class ScheduleConversationDto { scheduledAt: string }  // ISO 8601
  ```

- [ ] **Step 1: Check `class-transformer` is available**

```bash
grep -c '"class-transformer"' apps/api/package.json || pnpm --filter @opencoop/api add class-transformer
```

Nested validation needs it. `ValidationPipe` in `apps/api/src/main.ts` must have `transform: true`; confirm with `grep -n "ValidationPipe" apps/api/src/main.ts`. If `transform` is not set, add `transform: true` there (it only affects DTO instantiation, which is what nested validation needs).

- [ ] **Step 2: Write the DTOs**

`apps/api/src/modules/messages/dto/audience.dto.ts`:

```ts
import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AudienceDto {
  @ApiProperty({ enum: ['ALL', 'PROJECT', 'SELECTED'], example: 'PROJECT' })
  @IsIn(['ALL', 'PROJECT', 'SELECTED'])
  type: 'ALL' | 'PROJECT' | 'SELECTED';

  @ApiProperty({ required: false, description: 'Required when type is PROJECT' })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiProperty({ required: false, description: 'Used when type is SELECTED', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  shareholderIds?: string[];
}
```

`apps/api/src/modules/messages/dto/create-conversation.dto.ts` (full replacement):

```ts
import { IsString, IsOptional, IsArray, MinLength, IsIn, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { AudienceDto } from './audience.dto';

export class CreateConversationDto {
  @ApiProperty({ example: 'Uitnodiging Algemene Vergadering 2026' })
  @IsString()
  @MinLength(1)
  subject: string;

  @ApiProperty({ enum: ['BROADCAST', 'DIRECT'], example: 'BROADCAST' })
  @IsIn(['BROADCAST', 'DIRECT'])
  type: 'BROADCAST' | 'DIRECT';

  @ApiProperty({ example: '<p>Beste leden, ...</p>' })
  @IsString()
  @MinLength(1)
  body: string;

  @ApiProperty({ required: false, enum: ['TEXT', 'HTML'], description: 'Default HTML for admin messages' })
  @IsOptional()
  @IsIn(['TEXT', 'HTML'])
  format?: 'TEXT' | 'HTML';

  @ApiProperty({ required: false, enum: ['DRAFT', 'SENT'], description: 'Default SENT (send immediately)' })
  @IsOptional()
  @IsIn(['DRAFT', 'SENT'])
  status?: 'DRAFT' | 'SENT';

  @ApiProperty({ required: false, type: AudienceDto, description: 'BROADCAST only. Default ALL.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => AudienceDto)
  audience?: AudienceDto;

  @ApiProperty({ required: false, description: 'Required for DIRECT type' })
  @IsOptional()
  @IsString()
  shareholderId?: string;

  @ApiProperty({ required: false, description: 'IDs of existing ShareholderDocuments to attach' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  existingDocumentIds?: string[];
}
```

`apps/api/src/modules/messages/dto/update-draft.dto.ts`:

```ts
import { IsString, IsOptional, MinLength, IsIn, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { AudienceDto } from './audience.dto';

export class UpdateDraftDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  subject?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  body?: string;

  @ApiProperty({ required: false, enum: ['TEXT', 'HTML'] })
  @IsOptional()
  @IsIn(['TEXT', 'HTML'])
  format?: 'TEXT' | 'HTML';

  @ApiProperty({ required: false, type: AudienceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AudienceDto)
  audience?: AudienceDto;
}
```

`apps/api/src/modules/messages/dto/schedule-conversation.dto.ts`:

```ts
import { IsISO8601 } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ScheduleConversationDto {
  @ApiProperty({ example: '2026-09-15T08:00:00.000Z', description: 'UTC instant, at least 60 s in the future' })
  @IsISO8601({ strict: true })
  scheduledAt: string;
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @opencoop/api exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/messages/dto apps/api/package.json pnpm-lock.yaml apps/api/src/main.ts
git commit -m "feat(messages): DTOs for audience, drafts and scheduling

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

(Leave `main.ts` / `package.json` out of the `git add` if Step 1 changed nothing.)

---

### Task 5: MessagesService — drafts, send, schedule

**Files:**
- Modify: `apps/api/src/modules/messages/messages.service.ts` (`createConversation` at `:82-163`, `findAllForCoop` at `:21-49`, `notifyParticipants` at `:432-480`; new methods)
- Test: `apps/api/src/modules/messages/messages.service.spec.ts` (new)

**Interfaces:**
- Consumes: `AudienceService.resolve`, `sanitizeMessageHtml`, `textToMessageHtml` (Tasks 2, 3), Prisma fields (Task 1).
- Produces (all `coopId`-scoped, throw `NotFoundException` when the conversation is not in the coop):
  ```ts
  createConversation(coopId, dto: CreateConversationDto, userId, ip?, userAgent?, origin?: { apiKeyId?: string })
  updateDraft(conversationId, coopId, dto: UpdateDraftDto, userId)
  deleteDraft(conversationId, coopId, userId)
  send(conversationId, coopId, actor: { userId: string; ip?: string; userAgent?: string })
  schedule(conversationId, coopId, scheduledAt: Date, userId)
  cancelSchedule(conversationId, coopId, userId)
  countRecipients(conversationId, coopId): Promise<number>
  findAllForCoop(coopId, page) // items gain status, scheduledAt, sentAt, audienceType, recipientCount
  ```
  Error codes: draft-only operations on a non-draft → `ConflictException('Conversation is not a draft')`; `send` on `SENT` → `ConflictException('Conversation already sent')`; empty audience → `BadRequestException({ code: 'EMPTY_AUDIENCE', message: 'No recipients' })`; schedule < 60 s ahead → `BadRequestException('scheduledAt must be at least one minute in the future')`.

- [ ] **Step 1: Write the failing tests**

`apps/api/src/modules/messages/messages.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { AudienceService } from './audience.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';

describe('MessagesService drafts and sending', () => {
  let service: MessagesService;

  const tx = {
    conversation: { create: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
    message: { create: jest.fn() },
    messageAttachment: { createMany: jest.fn() },
    conversationParticipant: { createMany: jest.fn(), create: jest.fn() },
    shareholder: { findMany: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    conversation: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), update: jest.fn(), delete: jest.fn() },
    coop: { findUnique: jest.fn() },
    message: { findFirst: jest.fn(), update: jest.fn() },
  };
  const audience = { resolve: jest.fn() };
  const audit = { log: jest.fn() };
  const email = { send: jest.fn() };

  const actor = { userId: 'u1', ip: '127.0.0.1', userAgent: 'jest' };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        MessagesService,
        { provide: PrismaService, useValue: prisma },
        { provide: AudienceService, useValue: audience },
        { provide: AuditService, useValue: audit },
        { provide: EmailService, useValue: email },
      ],
    }).compile();
    service = module.get(MessagesService);
    jest.clearAllMocks();
    tx.conversation.create.mockImplementation(async ({ data }) => ({ id: 'c1', ...data }));
    tx.message.create.mockResolvedValue({ id: 'm1' });
    tx.conversation.updateMany.mockResolvedValue({ count: 1 });
    prisma.coop.findUnique.mockResolvedValue({ name: 'Coop', slug: 'coop', emailEnabled: true });
  });

  describe('createConversation', () => {
    it('creates a DRAFT broadcast with a project audience and no participants', async () => {
      const conv = await service.createConversation(
        'coop1',
        { type: 'BROADCAST', subject: 'S', body: '<p>hi</p><script>x</script>', status: 'DRAFT', audience: { type: 'PROJECT', projectId: 'p1' } },
        'u1',
      );
      expect(conv.id).toBe('c1');
      expect(tx.conversation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: 'DRAFT', audienceType: 'PROJECT', audienceProjectId: 'p1', audienceShareholderIds: [] }),
      });
      expect(tx.message.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ body: '<p>hi</p>', format: 'HTML', senderType: 'ADMIN' }),
      });
      expect(tx.conversationParticipant.createMany).not.toHaveBeenCalled();
      expect(email.send).not.toHaveBeenCalled();
    });

    it('defaults to SENT + ALL for a plain broadcast and sends immediately', async () => {
      audience.resolve.mockResolvedValue({ shareholderIds: ['s1', 's2'] });
      prisma.conversation.findUnique
        .mockResolvedValueOnce({ id: 'c1', coopId: 'coop1', status: 'DRAFT', audienceType: 'ALL', audienceProjectId: null, audienceShareholderIds: [] })
        .mockResolvedValueOnce({ id: 'c1', subject: 'S', participants: [], messages: [{ body: '<p>hi</p>', format: 'HTML' }] });
      await service.createConversation('coop1', { type: 'BROADCAST', subject: 'S', body: '<p>hi</p>' }, 'u1');
      expect(tx.conversationParticipant.createMany).toHaveBeenCalledWith({
        data: [{ conversationId: 'c1', shareholderId: 's1' }, { conversationId: 'c1', shareholderId: 's2' }],
        skipDuplicates: true,
      });
      expect(tx.conversation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'c1', status: { in: ['DRAFT', 'SCHEDULED'] } } }),
      );
    });

    it('maps a DIRECT conversation to a SELECTED audience of one', async () => {
      audience.resolve.mockResolvedValue({ shareholderIds: ['s9'] });
      prisma.conversation.findUnique
        .mockResolvedValueOnce({ id: 'c1', coopId: 'coop1', status: 'DRAFT', audienceType: 'SELECTED', audienceProjectId: null, audienceShareholderIds: ['s9'] })
        .mockResolvedValueOnce({ id: 'c1', subject: 'S', participants: [], messages: [] });
      await service.createConversation('coop1', { type: 'DIRECT', subject: 'S', body: 'hi', shareholderId: 's9', format: 'TEXT' }, 'u1');
      expect(tx.conversation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ type: 'DIRECT', audienceType: 'SELECTED', audienceShareholderIds: ['s9'] }),
      });
    });

    it('records the api key that created a draft', async () => {
      await service.createConversation('coop1', { type: 'BROADCAST', subject: 'S', body: 'x', status: 'DRAFT' }, 'u1', undefined, undefined, { apiKeyId: 'k1' });
      expect(tx.conversation.create).toHaveBeenCalledWith({ data: expect.objectContaining({ createdByApiKeyId: 'k1' }) });
    });
  });

  describe('send', () => {
    const draft = { id: 'c1', coopId: 'coop1', status: 'DRAFT', audienceType: 'ALL', audienceProjectId: null, audienceShareholderIds: [] };

    it('creates participants, marks SENT, queues one email per participant, logs audit', async () => {
      audience.resolve.mockResolvedValue({ shareholderIds: ['s1', 's2'] });
      prisma.conversation.findUnique
        .mockResolvedValueOnce(draft)
        .mockResolvedValueOnce({
          id: 'c1', subject: 'S',
          participants: [
            { shareholder: { email: 'a@x.be', firstName: 'A', user: null } },
            { shareholder: { email: 'b@x.be', firstName: 'B', user: { preferredLanguage: 'fr', email: 'b@x.be' } } },
          ],
          messages: [{ body: '<p>hi</p>', format: 'HTML', attachments: [] }],
        });
      await service.send('c1', 'coop1', actor);
      expect(tx.conversation.updateMany).toHaveBeenCalledWith({
        where: { id: 'c1', status: { in: ['DRAFT', 'SCHEDULED'] } },
        data: expect.objectContaining({ status: 'SENT', scheduledAt: null }),
      });
      expect(tx.conversationParticipant.createMany).toHaveBeenCalledTimes(1);
      expect(email.send).toHaveBeenCalledTimes(2);
      expect(email.send).toHaveBeenLastCalledWith(
        expect.objectContaining({
          to: 'b@x.be',
          templateKey: 'message-notification',
          templateData: expect.objectContaining({ messageBody: '<p>hi</p>', language: 'fr', hasAttachments: false }),
        }),
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ entity: 'Conversation', entityId: 'c1', action: 'UPDATE', actorId: 'u1' }),
      );
    });

    it('refuses an already sent conversation', async () => {
      prisma.conversation.findUnique.mockResolvedValueOnce({ ...draft, status: 'SENT' });
      await expect(service.send('c1', 'coop1', actor)).rejects.toThrow(ConflictException);
    });

    it('refuses when the guarded update claims nothing (concurrent send)', async () => {
      audience.resolve.mockResolvedValue({ shareholderIds: ['s1'] });
      prisma.conversation.findUnique.mockResolvedValueOnce(draft);
      tx.conversation.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.send('c1', 'coop1', actor)).rejects.toThrow(ConflictException);
      expect(tx.conversationParticipant.createMany).not.toHaveBeenCalled();
      expect(email.send).not.toHaveBeenCalled();
    });

    it('refuses an empty audience', async () => {
      audience.resolve.mockResolvedValue({ shareholderIds: [] });
      prisma.conversation.findUnique.mockResolvedValueOnce(draft);
      await expect(service.send('c1', 'coop1', actor)).rejects.toThrow(BadRequestException);
    });

    it('is a 404 for another coop', async () => {
      prisma.conversation.findUnique.mockResolvedValueOnce({ ...draft, coopId: 'other' });
      await expect(service.send('c1', 'coop1', actor)).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateDraft / deleteDraft', () => {
    it('sanitises the body and updates the audience of a draft', async () => {
      prisma.conversation.findUnique.mockResolvedValueOnce({ id: 'c1', coopId: 'coop1', status: 'DRAFT' });
      prisma.message.findFirst.mockResolvedValueOnce({ id: 'm1' });
      await service.updateDraft('c1', 'coop1', { body: '<p>a</p><img src=x>', audience: { type: 'SELECTED', shareholderIds: ['s1'] } }, 'u1');
      expect(prisma.message.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { body: '<p>a</p>', format: 'HTML' } });
      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: expect.objectContaining({ audienceType: 'SELECTED', audienceShareholderIds: ['s1'], audienceProjectId: null }),
      });
    });

    it('refuses to update or delete a sent conversation', async () => {
      prisma.conversation.findUnique.mockResolvedValue({ id: 'c1', coopId: 'coop1', status: 'SENT' });
      await expect(service.updateDraft('c1', 'coop1', { subject: 'x' }, 'u1')).rejects.toThrow(ConflictException);
      await expect(service.deleteDraft('c1', 'coop1', 'u1')).rejects.toThrow(ConflictException);
    });

    it('deletes a draft', async () => {
      prisma.conversation.findUnique.mockResolvedValueOnce({ id: 'c1', coopId: 'coop1', status: 'DRAFT' });
      await service.deleteDraft('c1', 'coop1', 'u1');
      expect(prisma.conversation.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
    });
  });

  describe('schedule / cancelSchedule', () => {
    it('schedules a draft in the future', async () => {
      prisma.conversation.findUnique.mockResolvedValueOnce({ id: 'c1', coopId: 'coop1', status: 'DRAFT' });
      const at = new Date(Date.now() + 10 * 60_000);
      await service.schedule('c1', 'coop1', at, 'u1');
      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { status: 'SCHEDULED', scheduledAt: at, sendAttempts: 0 },
      });
    });

    it('rejects a time less than a minute ahead', async () => {
      prisma.conversation.findUnique.mockResolvedValueOnce({ id: 'c1', coopId: 'coop1', status: 'DRAFT' });
      await expect(service.schedule('c1', 'coop1', new Date(Date.now() + 10_000), 'u1')).rejects.toThrow(BadRequestException);
    });

    it('cancels back to draft', async () => {
      prisma.conversation.findUnique.mockResolvedValueOnce({ id: 'c1', coopId: 'coop1', status: 'SCHEDULED' });
      await service.cancelSchedule('c1', 'coop1', 'u1');
      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { status: 'DRAFT', scheduledAt: null },
      });
    });

    it('cannot cancel a draft or a sent conversation', async () => {
      prisma.conversation.findUnique.mockResolvedValueOnce({ id: 'c1', coopId: 'coop1', status: 'SENT' });
      await expect(service.cancelSchedule('c1', 'coop1', 'u1')).rejects.toThrow(ConflictException);
    });
  });

  describe('findAllForCoop', () => {
    it('adds recipientCount: participants for sent, resolved audience for drafts', async () => {
      prisma.conversation.findMany.mockResolvedValue([
        { id: 'a', status: 'SENT', _count: { participants: 5, messages: 1 }, audienceType: 'ALL', audienceProjectId: null, audienceShareholderIds: [] },
        { id: 'b', status: 'DRAFT', _count: { participants: 0, messages: 1 }, audienceType: 'SELECTED', audienceProjectId: null, audienceShareholderIds: ['s1', 's2'] },
      ]);
      prisma.conversation.count.mockResolvedValue(2);
      audience.resolve.mockResolvedValue({ shareholderIds: ['s1', 's2'] });
      const r = await service.findAllForCoop('coop1', 1);
      expect(r.conversations.map((c) => c.recipientCount)).toEqual([5, 2]);
      expect(audience.resolve).toHaveBeenCalledTimes(1);
    });
  });
});
```

- [ ] **Step 2: Run to see it fail**

```bash
pnpm --filter @opencoop/api test -- messages.service
```

Expected: FAIL (methods missing, `AudienceService` not injected).

- [ ] **Step 3: Implement**

In `apps/api/src/modules/messages/messages.service.ts`:

Imports and constructor:

```ts
import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { AudienceService, Audience } from './audience.service';
import { sanitizeMessageHtml, textToMessageHtml } from './message-body';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { UpdateDraftDto } from './dto/update-draft.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import * as path from 'path';
import * as fs from 'fs';
import { resolveShareholderEmail } from '../shareholders/shareholder-email.resolver';

const MIN_SCHEDULE_LEAD_MS = 60_000;

export interface SendActor { userId: string; ip?: string; userAgent?: string }

@Injectable()
export class MessagesService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private emailService: EmailService,
    private audienceService: AudienceService,
  ) {}
```

Replace `findAllForCoop` with:

```ts
  async findAllForCoop(coopId: string, page: number = 1) {
    const take = 20;
    const skip = (page - 1) * take;
    const [conversations, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where: { coopId },
        // Drafts and scheduled first, then most recently updated.
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
        skip,
        take,
        include: {
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { body: true, format: true, createdAt: true, senderType: true },
          },
          participants: {
            take: 3,
            include: {
              shareholder: {
                select: { firstName: true, lastName: true, companyName: true, type: true },
              },
            },
          },
          _count: { select: { participants: true, messages: true } },
        },
      }),
      this.prisma.conversation.count({ where: { coopId } }),
    ]);
    const withCounts = await Promise.all(
      conversations.map(async (c) => ({
        ...c,
        recipientCount:
          c.status === 'SENT'
            ? c._count.participants
            : (await this.audienceService.resolve(coopId, this.audienceOf(c))).shareholderIds.length,
      })),
    );
    return { conversations: withCounts, total, page, totalPages: Math.ceil(total / take) };
  }

  private audienceOf(c: {
    audienceType: 'ALL' | 'PROJECT' | 'SELECTED';
    audienceProjectId: string | null;
    audienceShareholderIds: string[];
  }): Audience {
    return { type: c.audienceType, projectId: c.audienceProjectId, shareholderIds: c.audienceShareholderIds };
  }
```

(`ConversationStatus` enum order is `DRAFT, SCHEDULED, SENT`, so `orderBy status asc` puts drafts first.)

Replace `createConversation` with:

```ts
  async createConversation(
    coopId: string,
    dto: CreateConversationDto,
    userId: string,
    ip?: string,
    userAgent?: string,
    origin?: { apiKeyId?: string },
  ) {
    if (dto.type === 'DIRECT' && !dto.shareholderId) {
      throw new BadRequestException('shareholderId is required for DIRECT conversations');
    }
    const format = dto.format ?? 'HTML';
    const body = format === 'HTML' ? sanitizeMessageHtml(dto.body) : dto.body;
    if (!body) throw new BadRequestException('Message body is empty');

    const audience: Audience =
      dto.type === 'DIRECT'
        ? { type: 'SELECTED', shareholderIds: [dto.shareholderId!] }
        : (dto.audience ?? { type: 'ALL' });
    if (audience.type === 'PROJECT' && !audience.projectId) {
      throw new BadRequestException('projectId is required for a PROJECT audience');
    }

    const conversation = await this.prisma.$transaction(async (tx) => {
      const conv = await tx.conversation.create({
        data: {
          coopId,
          subject: dto.subject,
          type: dto.type,
          createdById: userId,
          status: 'DRAFT',
          audienceType: audience.type,
          audienceProjectId: audience.type === 'PROJECT' ? audience.projectId! : null,
          audienceShareholderIds: audience.type === 'SELECTED' ? (audience.shareholderIds ?? []) : [],
          createdByApiKeyId: origin?.apiKeyId ?? null,
        },
      });

      const message = await tx.message.create({
        data: { conversationId: conv.id, senderType: 'ADMIN', senderId: userId, body, format },
      });

      if (dto.existingDocumentIds?.length) {
        await tx.messageAttachment.createMany({
          data: dto.existingDocumentIds.map((docId) => ({
            messageId: message.id,
            type: 'EXISTING_DOCUMENT',
            shareholderDocumentId: docId,
            fileName: '',
          })),
        });
      }
      return conv;
    });

    await this.auditService.log({
      coopId,
      entity: 'Conversation',
      entityId: conversation.id,
      action: 'CREATE',
      changes: [
        { field: 'type', oldValue: null, newValue: dto.type },
        { field: 'status', oldValue: null, newValue: dto.status ?? 'SENT' },
        ...(origin?.apiKeyId ? [{ field: 'apiKeyId', oldValue: null, newValue: origin.apiKeyId }] : []),
      ],
      actorId: userId,
      ipAddress: ip,
      userAgent,
    });

    if ((dto.status ?? 'SENT') === 'SENT') {
      await this.send(conversation.id, coopId, { userId, ip, userAgent });
    }
    return conversation;
  }
```

Add the new methods after `createConversation`:

```ts
  private async loadForAdmin(conversationId: string, coopId: string) {
    const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conv || conv.coopId !== coopId) throw new NotFoundException('Conversation not found');
    return conv;
  }

  async countRecipients(conversationId: string, coopId: string): Promise<number> {
    const conv = await this.loadForAdmin(conversationId, coopId);
    if (conv.status === 'SENT') {
      return this.prisma.conversationParticipant.count({ where: { conversationId } });
    }
    return (await this.audienceService.resolve(coopId, this.audienceOf(conv))).shareholderIds.length;
  }

  async updateDraft(conversationId: string, coopId: string, dto: UpdateDraftDto, userId: string) {
    const conv = await this.loadForAdmin(conversationId, coopId);
    if (conv.status !== 'DRAFT') throw new ConflictException('Conversation is not a draft');

    if (dto.body !== undefined || dto.format !== undefined) {
      const first = await this.prisma.message.findFirst({
        where: { conversationId, senderType: 'ADMIN' },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (!first) throw new NotFoundException('Draft message not found');
      const format = dto.format ?? 'HTML';
      const body = format === 'HTML' ? sanitizeMessageHtml(dto.body ?? '') : (dto.body ?? '');
      if (!body) throw new BadRequestException('Message body is empty');
      await this.prisma.message.update({ where: { id: first.id }, data: { body, format } });
    }

    const data: Record<string, unknown> = {};
    if (dto.subject !== undefined) data.subject = dto.subject;
    if (dto.audience) {
      if (dto.audience.type === 'PROJECT' && !dto.audience.projectId) {
        throw new BadRequestException('projectId is required for a PROJECT audience');
      }
      data.audienceType = dto.audience.type;
      data.audienceProjectId = dto.audience.type === 'PROJECT' ? dto.audience.projectId : null;
      data.audienceShareholderIds = dto.audience.type === 'SELECTED' ? (dto.audience.shareholderIds ?? []) : [];
    }
    data.updatedAt = new Date();
    await this.prisma.conversation.update({ where: { id: conversationId }, data });

    await this.auditService.log({
      coopId, entity: 'Conversation', entityId: conversationId, action: 'UPDATE',
      changes: [{ field: 'draft', oldValue: null, newValue: 'edited' }], actorId: userId,
    });
    return this.findByIdForAdmin(conversationId, coopId);
  }

  async deleteDraft(conversationId: string, coopId: string, userId: string) {
    const conv = await this.loadForAdmin(conversationId, coopId);
    if (conv.status !== 'DRAFT') throw new ConflictException('Conversation is not a draft');
    await this.prisma.conversation.delete({ where: { id: conversationId } });
    await this.auditService.log({
      coopId, entity: 'Conversation', entityId: conversationId, action: 'DELETE',
      changes: [{ field: 'status', oldValue: 'DRAFT', newValue: null }], actorId: userId,
    });
  }

  /**
   * The only path that creates participants and queues shareholder e-mail.
   * Guarded by an updateMany on status so two concurrent calls cannot both send.
   */
  async send(conversationId: string, coopId: string, actor: SendActor) {
    const conv = await this.loadForAdmin(conversationId, coopId);
    if (conv.status === 'SENT') throw new ConflictException('Conversation already sent');

    const { shareholderIds } = await this.audienceService.resolve(coopId, this.audienceOf(conv));
    if (shareholderIds.length === 0) {
      throw new BadRequestException({ code: 'EMPTY_AUDIENCE', message: 'No recipients' });
    }

    const now = new Date();
    const claimed = await this.prisma.$transaction(async (tx) => {
      const r = await tx.conversation.updateMany({
        where: { id: conversationId, status: { in: ['DRAFT', 'SCHEDULED'] } },
        data: { status: 'SENT', sentAt: now, scheduledAt: null, updatedAt: now },
      });
      if (r.count === 0) return false;
      await tx.conversationParticipant.createMany({
        data: shareholderIds.map((shareholderId) => ({ conversationId, shareholderId })),
        skipDuplicates: true,
      });
      return true;
    });
    if (!claimed) throw new ConflictException('Conversation already sent');

    await this.notifyParticipants(conversationId, coopId);

    await this.auditService.log({
      coopId, entity: 'Conversation', entityId: conversationId, action: 'UPDATE',
      changes: [
        { field: 'status', oldValue: conv.status, newValue: 'SENT' },
        { field: 'recipients', oldValue: null, newValue: shareholderIds.length },
      ],
      actorId: actor.userId, ipAddress: actor.ip, userAgent: actor.userAgent,
    });
    return { id: conversationId, status: 'SENT' as const, sentAt: now, recipientCount: shareholderIds.length };
  }

  async schedule(conversationId: string, coopId: string, scheduledAt: Date, userId: string) {
    const conv = await this.loadForAdmin(conversationId, coopId);
    if (conv.status !== 'DRAFT') throw new ConflictException('Conversation is not a draft');
    if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() - Date.now() < MIN_SCHEDULE_LEAD_MS) {
      throw new BadRequestException('scheduledAt must be at least one minute in the future');
    }
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { status: 'SCHEDULED', scheduledAt, sendAttempts: 0 },
    });
    await this.auditService.log({
      coopId, entity: 'Conversation', entityId: conversationId, action: 'UPDATE',
      changes: [{ field: 'status', oldValue: 'DRAFT', newValue: 'SCHEDULED' }, { field: 'scheduledAt', oldValue: null, newValue: scheduledAt.toISOString() }],
      actorId: userId,
    });
    return this.findByIdForAdmin(conversationId, coopId);
  }

  async cancelSchedule(conversationId: string, coopId: string, userId: string) {
    const conv = await this.loadForAdmin(conversationId, coopId);
    if (conv.status !== 'SCHEDULED') throw new ConflictException('Conversation is not scheduled');
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { status: 'DRAFT', scheduledAt: null },
    });
    await this.auditService.log({
      coopId, entity: 'Conversation', entityId: conversationId, action: 'UPDATE',
      changes: [{ field: 'status', oldValue: 'SCHEDULED', newValue: 'DRAFT' }], actorId: userId,
    });
    return this.findByIdForAdmin(conversationId, coopId);
  }
```

Replace `notifyParticipants` with the full-body version:

```ts
  private async notifyParticipants(conversationId: string, coopId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        participants: {
          include: {
            shareholder: {
              select: {
                email: true,
                firstName: true,
                user: { select: { preferredLanguage: true, email: true } },
              },
            },
          },
        },
        messages: { orderBy: { createdAt: 'desc' }, take: 1, include: { attachments: { select: { id: true } } } },
      },
    });
    if (!conversation) return;

    const coop = await this.prisma.coop.findUnique({
      where: { id: coopId },
      select: { name: true, slug: true, emailEnabled: true },
    });
    if (!coop?.emailEnabled) return;

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://opencoop.be';
    const last = conversation.messages[0];
    const messageBody = !last ? '' : last.format === 'HTML' ? last.body : textToMessageHtml(last.body);
    const hasAttachments = (last?.attachments?.length ?? 0) > 0;

    for (const participant of conversation.participants) {
      const resolvedEmail = resolveShareholderEmail(participant.shareholder);
      if (!resolvedEmail) continue;
      const language = participant.shareholder.user?.preferredLanguage || 'nl';
      await this.emailService.send({
        coopId,
        to: resolvedEmail,
        subject: `${coop.name}: ${conversation.subject}`,
        templateKey: 'message-notification',
        templateData: {
          coopName: coop.name,
          shareholderName: participant.shareholder.firstName || '',
          messageSubject: conversation.subject,
          messageBody,
          hasAttachments,
          inboxUrl: `${appUrl}/${language}/dashboard/inbox/${conversationId}`,
          language,
        },
      });
    }
  }
```

In `addAdminReply`, add `format: 'HTML'` and sanitise: change `body: dto.body` to `body: sanitizeMessageHtml(dto.body), format: 'HTML'`. In `createShareholderConversation` and `addShareholderReply`, add `format: 'TEXT'` to the `message.create` data (explicit, matches the default).

- [ ] **Step 4: Run to see it pass**

```bash
pnpm --filter @opencoop/api test -- messages.service
pnpm --filter @opencoop/api exec tsc --noEmit
```

Expected: PASS (17 tests), no type errors. If the `AuditService.log` parameter type rejects `action: 'DELETE'` or the `changes` shape, read `apps/api/src/modules/audit/audit.service.ts:25-34` and use the exact `action` union it declares; the requirement is one audit row per transition.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/messages/messages.service.ts apps/api/src/modules/messages/messages.service.spec.ts
git commit -m "feat(messages): draft lifecycle with a single guarded send path

createConversation can save a DRAFT; send() resolves the audience, claims
the row with a status-guarded updateMany, creates participants and queues
one e-mail per recipient with the full body. schedule/cancelSchedule and
updateDraft/deleteDraft complete the DRAFT → SCHEDULED → SENT machine.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Admin API routes

**Files:**
- Modify: `apps/api/src/modules/admin/admin.controller.ts:1141-1200` (messages block), imports at `:65-67`

**Interfaces:**
- Consumes: Task 5 methods, Task 4 DTOs, `AudienceService.resolve`.
- Produces routes under `admin/coops/:coopId`:
  `PATCH conversations/:id`, `DELETE conversations/:id`, `POST conversations/:id/send`, `POST conversations/:id/schedule`, `POST conversations/:id/cancel-schedule`, `POST conversations/audience-preview` → `{ count }`, `GET conversations/:id/recipient-count` → `{ count }`.

- [ ] **Step 1: Add imports**

Next to the existing message imports at `admin.controller.ts:65-67`:

```ts
import { UpdateDraftDto } from '../messages/dto/update-draft.dto';
import { ScheduleConversationDto } from '../messages/dto/schedule-conversation.dto';
import { AudienceDto } from '../messages/dto/audience.dto';
import { AudienceService } from '../messages/audience.service';
```

Add `private readonly audienceService: AudienceService,` to the controller constructor (find the constructor with `grep -n "private readonly messagesService" apps/api/src/modules/admin/admin.controller.ts` and add the line next to it). `AdminModule` already imports `MessagesModule`, which exports `AudienceService` since Task 3; verify with `grep -n MessagesModule apps/api/src/modules/admin/admin.module.ts`.

- [ ] **Step 2: Add the routes**

Insert after `createConversation` (before `getConversation`) in the `MESSAGES` block. The static `audience-preview` route must come before `conversations/:conversationId` routes so Nest matches it first:

```ts
  @Post('conversations/audience-preview')
  @RequirePermission('canManageMessages')
  @ApiOperation({ summary: 'Count the recipients an audience resolves to' })
  async previewAudience(@Param('coopId') coopId: string, @Body() audience: AudienceDto) {
    const { shareholderIds } = await this.audienceService.resolve(coopId, audience);
    return { count: shareholderIds.length };
  }

  @Get('conversations/:conversationId/recipient-count')
  @RequirePermission('canManageMessages')
  @ApiOperation({ summary: 'Recipient count of a conversation (resolved for drafts)' })
  async recipientCount(
    @Param('coopId') coopId: string,
    @Param('conversationId') conversationId: string,
  ) {
    return { count: await this.messagesService.countRecipients(conversationId, coopId) };
  }

  @Patch('conversations/:conversationId')
  @RequirePermission('canManageMessages')
  @ApiOperation({ summary: 'Edit a draft conversation' })
  async updateDraft(
    @Param('coopId') coopId: string,
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: CurrentUserData,
    @Body() dto: UpdateDraftDto,
  ) {
    return this.messagesService.updateDraft(conversationId, coopId, dto, user.id);
  }

  @Delete('conversations/:conversationId')
  @RequirePermission('canManageMessages')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a draft conversation' })
  async deleteDraft(
    @Param('coopId') coopId: string,
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    await this.messagesService.deleteDraft(conversationId, coopId, user.id);
  }

  @Post('conversations/:conversationId/send')
  @RequirePermission('canManageMessages')
  @ApiOperation({ summary: 'Send a draft now' })
  async sendConversation(
    @Param('coopId') coopId: string,
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
  ) {
    return this.messagesService.send(conversationId, coopId, {
      userId: user.id, ip: req.ip, userAgent: req.headers['user-agent'] as string,
    });
  }

  @Post('conversations/:conversationId/schedule')
  @RequirePermission('canManageMessages')
  @ApiOperation({ summary: 'Schedule a draft' })
  async scheduleConversation(
    @Param('coopId') coopId: string,
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: CurrentUserData,
    @Body() dto: ScheduleConversationDto,
  ) {
    return this.messagesService.schedule(conversationId, coopId, new Date(dto.scheduledAt), user.id);
  }

  @Post('conversations/:conversationId/cancel-schedule')
  @RequirePermission('canManageMessages')
  @ApiOperation({ summary: 'Cancel a scheduled send, back to draft' })
  async cancelSchedule(
    @Param('coopId') coopId: string,
    @Param('conversationId') conversationId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.messagesService.cancelSchedule(conversationId, coopId, user.id);
  }
```

Make sure `Patch`, `Delete`, `HttpCode` are in the `@nestjs/common` import at the top of the file (`grep -n "from '@nestjs/common'" apps/api/src/modules/admin/admin.controller.ts` and extend that import).

- [ ] **Step 3: Boot the API against the dev database and exercise the routes**

```bash
pnpm --filter @opencoop/api exec tsc --noEmit
pnpm --filter @opencoop/api test
```

Then start the API (`pnpm --filter @opencoop/api dev`), log in as the seeded admin (see `packages/database/prisma/seed.ts` for credentials) and run, with `$TOKEN` and `$COOP` filled in:

```bash
curl -s -X POST localhost:3001/admin/coops/$COOP/conversations/audience-preview \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"type":"ALL"}'
curl -s -X POST localhost:3001/admin/coops/$COOP/conversations \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"type":"BROADCAST","subject":"Test","body":"<p>Hallo</p>","status":"DRAFT","audience":{"type":"ALL"}}'
```

Expected: `{"count":N}` with N > 0, then a conversation JSON with `"status":"DRAFT"`. Then `POST …/send` on that id returns `{"status":"SENT","recipientCount":N}` and a second `POST …/send` returns HTTP 409.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/admin/admin.controller.ts
git commit -m "feat(messages): admin routes for drafts, send, schedule and audience preview

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: E-mail template with the full body

**Files:**
- Modify: `apps/api/src/modules/email/email.processor.ts:510-531`
- Modify: `apps/api/src/modules/email/i18n/{nl,fr,de,en}.json` (`message-notification` block at line 68 in each)
- Test: `apps/api/src/modules/email/email.processor.render.spec.ts` (+ `__snapshots__`)

**Interfaces:**
- Consumes: `templateData.{messageBody, hasAttachments, shareholderName, messageSubject, inboxUrl, language}` from Task 5.

- [ ] **Step 1: Update the copy files**

In each of the four `i18n/*.json`, replace the `message-notification` block:

nl:
```json
  "message-notification": {
    "title": "Bericht van {coopName}",
    "dear": "Beste {shareholderName},",
    "subject": "Onderwerp",
    "replyHint": "Antwoorden kan via uw postvak op het platform.",
    "attachmentsHint": "Dit bericht bevat bijlagen. U vindt ze in uw postvak.",
    "viewMessage": "Bekijk het bericht"
  },
```
fr:
```json
  "message-notification": {
    "title": "Message de {coopName}",
    "dear": "Bonjour {shareholderName},",
    "subject": "Objet",
    "replyHint": "Vous pouvez répondre via votre boîte de réception sur la plateforme.",
    "attachmentsHint": "Ce message contient des pièces jointes. Vous les trouverez dans votre boîte de réception.",
    "viewMessage": "Voir le message"
  },
```
de:
```json
  "message-notification": {
    "title": "Nachricht von {coopName}",
    "dear": "Liebe(r) {shareholderName},",
    "subject": "Betreff",
    "replyHint": "Antworten können Sie über Ihren Posteingang auf der Plattform.",
    "attachmentsHint": "Diese Nachricht enthält Anhänge. Sie finden sie in Ihrem Posteingang.",
    "viewMessage": "Nachricht ansehen"
  },
```
en:
```json
  "message-notification": {
    "title": "Message from {coopName}",
    "dear": "Dear {shareholderName},",
    "subject": "Subject",
    "replyHint": "You can reply through your inbox on the platform.",
    "attachmentsHint": "This message has attachments. You will find them in your inbox.",
    "viewMessage": "View the message"
  },
```

- [ ] **Step 2: Add a render test for the new template**

In `email.processor.render.spec.ts`, find the existing `message-notification` case (`grep -n "message-notification" apps/api/src/modules/email/email.processor.render.spec.ts`). Replace its `templateData` with:

```ts
{
  coopName: 'Bronsgroen',
  shareholderName: 'Christiane',
  messageSubject: 'Uw aandelen',
  messageBody: '<h2>Wat er is beslist</h2><p>Een <strong>vet</strong> woord.</p>',
  hasAttachments: true,
  inboxUrl: 'https://opencoop.be/nl/dashboard/inbox/c1',
  language: 'nl',
}
```

and add, next to the snapshot assertion, explicit checks:

```ts
expect(html).toContain('<h2>Wat er is beslist</h2><p>Een <strong>vet</strong> woord.</p>');
expect(html).toContain('Beste Christiane,');
expect(html).toContain('Dit bericht bevat bijlagen.');
expect(html).not.toContain('&lt;h2&gt;');
```

If there is no existing case for this template, add a new `it('renders message-notification with the full body', …)` following the shape of the neighbouring cases in that file (they call the processor's render function with `templateKey`, `templateData` and the coop name, then `expect(html).toMatchSnapshot()`).

- [ ] **Step 3: Run to see it fail**

```bash
pnpm --filter @opencoop/api test -- email.processor.render
```

Expected: FAIL on the `toContain` checks (body is still escaped / preview-based).

- [ ] **Step 4: Update the template**

Replace the `'message-notification'` entry in `email.processor.ts` with:

```ts
      'message-notification': (d, cn) => {
        const lang = (d.language as string) || 'nl';
        const sn = escapeHtml(d.shareholderName);
        const ecn = escapeHtml(cn);
        const s = buildCopy('message-notification', lang, { coopName: ecn, shareholderName: sn });
        // messageBody is allowlist-sanitised HTML produced by message-body.ts; it is not escaped here on purpose.
        const body = (d.messageBody as string) || '';
        return `
          <h1>${s.title}</h1>
          <p>${s.dear}</p>
          <p><strong>${s.subject}:</strong> ${escapeHtml(d.messageSubject)}</p>
          <div style="margin: 16px 0; line-height: 1.5;">${body}</div>
          ${d.hasAttachments ? `<p>${s.attachmentsHint}</p>` : ''}
          <p style="color:#555;">${s.replyHint}</p>
          <p style="text-align: center; margin: 30px 0;">
            <a href="${d.inboxUrl}"
               style="background-color: #1e40af; color: white; padding: 12px 24px;
                      text-decoration: none; border-radius: 6px; display: inline-block;">
              ${s.viewMessage}
            </a>
          </p>
        `;
      },
```

- [ ] **Step 5: Run, update snapshots, run everything**

```bash
pnpm --filter @opencoop/api test -- email.processor.render -u
pnpm --filter @opencoop/api test
```

Expected: PASS. Open the updated snapshot and confirm it contains the raw `<h2>` and no escaped preview.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/email
git commit -m "feat(email): message notification carries the full message body

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Scheduler

**Files:**
- Create: `apps/api/src/modules/messages/messages.scheduler.ts`
- Test: `apps/api/src/modules/messages/messages.scheduler.spec.ts`
- Modify: `apps/api/src/modules/messages/messages.module.ts`

**Interfaces:**
- Consumes: `MessagesService.send`, `EmailService.send` (template `admin-message-notification` with `{ adminName, messageSubject, messagePreview }`), Prisma `conversation.findMany/update`, `coopAdmin.findMany`.
- Produces: `MessagesScheduler.tick()` (public, called by the cron and by tests).

- [ ] **Step 1: Write the failing tests**

`apps/api/src/modules/messages/messages.scheduler.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { MessagesScheduler } from './messages.scheduler';
import { MessagesService } from './messages.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';

describe('MessagesScheduler', () => {
  let scheduler: MessagesScheduler;
  const prisma = {
    conversation: { findMany: jest.fn(), update: jest.fn() },
    coopAdmin: { findMany: jest.fn() },
    coop: { findUnique: jest.fn() },
  };
  const messages = { send: jest.fn() };
  const email = { send: jest.fn() };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        MessagesScheduler,
        { provide: PrismaService, useValue: prisma },
        { provide: MessagesService, useValue: messages },
        { provide: EmailService, useValue: email },
      ],
    }).compile();
    scheduler = module.get(MessagesScheduler);
    jest.clearAllMocks();
  });

  it('sends every due scheduled conversation with the scheduling user as actor', async () => {
    prisma.conversation.findMany.mockResolvedValue([
      { id: 'a', coopId: 'c', createdById: 'u1', subject: 'A', sendAttempts: 0 },
      { id: 'b', coopId: 'c', createdById: 'u2', subject: 'B', sendAttempts: 0 },
    ]);
    await scheduler.tick();
    expect(prisma.conversation.findMany).toHaveBeenCalledWith({
      where: { status: 'SCHEDULED', scheduledAt: { lte: expect.any(Date) } },
      orderBy: { scheduledAt: 'asc' },
      select: { id: true, coopId: true, createdById: true, subject: true, sendAttempts: true },
    });
    expect(messages.send).toHaveBeenCalledWith('a', 'c', { userId: 'u1' });
    expect(messages.send).toHaveBeenCalledWith('b', 'c', { userId: 'u2' });
  });

  it('counts a failure and leaves the row scheduled', async () => {
    prisma.conversation.findMany.mockResolvedValue([{ id: 'a', coopId: 'c', createdById: 'u1', subject: 'A', sendAttempts: 0 }]);
    messages.send.mockRejectedValueOnce(new Error('smtp down'));
    await scheduler.tick();
    expect(prisma.conversation.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: { sendAttempts: 1 } });
    expect(email.send).not.toHaveBeenCalled();
  });

  it('flips back to draft after the third failure and mails the admins', async () => {
    prisma.conversation.findMany.mockResolvedValue([{ id: 'a', coopId: 'c', createdById: 'u1', subject: 'A', sendAttempts: 2 }]);
    messages.send.mockRejectedValueOnce(new Error('smtp down'));
    prisma.coop.findUnique.mockResolvedValue({ name: 'Coop', emailEnabled: true });
    prisma.coopAdmin.findMany.mockResolvedValue([{ user: { email: 'admin@x.be', name: 'Admin' } }]);
    await scheduler.tick();
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'a' },
      data: { status: 'DRAFT', scheduledAt: null, sendAttempts: 3 },
    });
    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'admin@x.be',
        templateKey: 'admin-message-notification',
        templateData: expect.objectContaining({ adminName: 'Admin', messageSubject: 'A' }),
      }),
    );
  });

  it('keeps going when one conversation fails', async () => {
    prisma.conversation.findMany.mockResolvedValue([
      { id: 'a', coopId: 'c', createdById: 'u1', subject: 'A', sendAttempts: 0 },
      { id: 'b', coopId: 'c', createdById: 'u1', subject: 'B', sendAttempts: 0 },
    ]);
    messages.send.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({});
    await scheduler.tick();
    expect(messages.send).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run to see it fail**

```bash
pnpm --filter @opencoop/api test -- messages.scheduler
```

Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`apps/api/src/modules/messages/messages.scheduler.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { MessagesService } from './messages.service';
import { EmailService } from '../email/email.service';

const MAX_ATTEMPTS = 3;

/**
 * Every minute: send scheduled conversations whose time has come.
 * MessagesService.send is idempotent (status-guarded), so an overlapping tick
 * or a restart mid-batch cannot send twice.
 */
@Injectable()
export class MessagesScheduler {
  private readonly logger = new Logger(MessagesScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messages: MessagesService,
    private readonly email: EmailService,
  ) {}

  @Cron('* * * * *')
  async tick() {
    const due = await this.prisma.conversation.findMany({
      where: { status: 'SCHEDULED', scheduledAt: { lte: new Date() } },
      orderBy: { scheduledAt: 'asc' },
      select: { id: true, coopId: true, createdById: true, subject: true, sendAttempts: true },
    });
    for (const conv of due) {
      try {
        await this.messages.send(conv.id, conv.coopId, { userId: conv.createdById });
        this.logger.log(`Sent scheduled conversation ${conv.id}`);
      } catch (error) {
        Sentry.captureException(error);
        const attempts = conv.sendAttempts + 1;
        this.logger.error(`Scheduled send failed for ${conv.id} (attempt ${attempts}): ${error.message}`);
        if (attempts >= MAX_ATTEMPTS) {
          await this.prisma.conversation.update({
            where: { id: conv.id },
            data: { status: 'DRAFT', scheduledAt: null, sendAttempts: attempts },
          });
          await this.notifyAdminsOfFailure(conv.coopId, conv.subject, error.message);
        } else {
          await this.prisma.conversation.update({ where: { id: conv.id }, data: { sendAttempts: attempts } });
        }
      }
    }
  }

  private async notifyAdminsOfFailure(coopId: string, subject: string, reason: string) {
    const coop = await this.prisma.coop.findUnique({ where: { id: coopId }, select: { name: true, emailEnabled: true } });
    if (!coop?.emailEnabled) return;
    const admins = await this.prisma.coopAdmin.findMany({
      where: { coopId },
      include: { user: { select: { email: true, name: true } } },
    });
    for (const admin of admins) {
      await this.email.send({
        coopId,
        to: admin.user.email,
        subject: `${coop.name}: Gepland bericht niet verzonden - ${subject}`,
        templateKey: 'admin-message-notification',
        templateData: {
          adminName: admin.user.name || '',
          messageSubject: subject,
          messagePreview: `Het geplande bericht kon niet worden verzonden en staat opnieuw als concept. Reden: ${reason}`,
        },
      });
    }
  }
}
```

Register in `messages.module.ts`: add `MessagesScheduler` to `providers` (not exports). `ScheduleModule.forRoot()` is already in `app.module.ts:3`.

- [ ] **Step 4: Run to see it pass**

```bash
pnpm --filter @opencoop/api test -- messages.scheduler
pnpm --filter @opencoop/api exec tsc --noEmit
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/messages/messages.scheduler.ts apps/api/src/modules/messages/messages.scheduler.spec.ts apps/api/src/modules/messages/messages.module.ts
git commit -m "feat(messages): minute cron sends scheduled conversations

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Coop permission lookup for API keys

**Files:**
- Create: `apps/api/src/common/utils/coop-permissions.ts`
- Test: `apps/api/src/common/utils/coop-permissions.spec.ts`
- Modify: `apps/api/src/modules/auth/token.service.ts:14-27` (remove local function, import)

**Interfaces:**
- Produces:
  ```ts
  export function mergeAdminPermissions(rolePermissionsList: unknown[], overrides: unknown): Record<string, boolean>
  @Injectable() class CoopPermissionsService { has(userId: string, coopId: string, key: CoopPermissionKey): Promise<boolean> }
  ```
  `has` returns `true` for `User.role === 'SYSTEM_ADMIN'`, otherwise the merged role permissions of the user's `CoopAdmin` row for that coop; `false` when the user is not an admin of the coop.

- [ ] **Step 1: Write the failing tests**

`apps/api/src/common/utils/coop-permissions.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { CoopPermissionsService, mergeAdminPermissions } from './coop-permissions';
import { PrismaService } from '../../prisma/prisma.service';

describe('mergeAdminPermissions', () => {
  it('ORs roles and lets overrides win', () => {
    expect(mergeAdminPermissions([{ canManageMessages: false }, { canManageMessages: true }], { canViewPII: false })).toEqual({
      canManageMessages: true,
      canViewPII: false,
    });
    expect(mergeAdminPermissions([{ canManageMessages: true }], { canManageMessages: false })).toEqual({ canManageMessages: false });
  });
});

describe('CoopPermissionsService.has', () => {
  let service: CoopPermissionsService;
  const prisma = { user: { findUnique: jest.fn() }, coopAdmin: { findFirst: jest.fn() } };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [CoopPermissionsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(CoopPermissionsService);
    jest.clearAllMocks();
  });

  it('is true for a system admin without looking at coop roles', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'SYSTEM_ADMIN' });
    expect(await service.has('u1', 'c1', 'canManageMessages')).toBe(true);
    expect(prisma.coopAdmin.findFirst).not.toHaveBeenCalled();
  });

  it('merges the roles of the coop admin row', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'USER' });
    prisma.coopAdmin.findFirst.mockResolvedValue({
      permissionOverrides: null,
      roles: [{ role: { permissions: { canManageMessages: true } } }],
    });
    expect(await service.has('u1', 'c1', 'canManageMessages')).toBe(true);
    expect(prisma.coopAdmin.findFirst).toHaveBeenCalledWith({
      where: { userId: 'u1', coopId: 'c1' },
      include: { roles: { include: { role: true } } },
    });
  });

  it('is false when the user is not an admin of the coop', async () => {
    prisma.user.findUnique.mockResolvedValue({ role: 'USER' });
    prisma.coopAdmin.findFirst.mockResolvedValue(null);
    expect(await service.has('u1', 'c1', 'canManageMessages')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to see it fail**

```bash
pnpm --filter @opencoop/api test -- coop-permissions
```

Expected: FAIL, module not found.

- [ ] **Step 3: Implement and move the helper**

`apps/api/src/common/utils/coop-permissions.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { CoopPermissionKey } from '@opencoop/shared';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * OR-merge permissions across all roles assigned to a CoopAdmin, then apply
 * the per-admin overrides on top. An admin with N roles has the union of
 * their permissions: as soon as ANY role grants `canX`, the admin has `canX`.
 * Overrides win unconditionally — a `false` override switches a granted
 * permission off, a `true` override grants something no role provided.
 */
export function mergeAdminPermissions(
  rolePermissionsList: unknown[],
  overrides: unknown,
): Record<string, boolean> {
  const merged: Record<string, boolean> = {};
  for (const perms of rolePermissionsList) {
    const obj = (perms ?? {}) as Record<string, boolean>;
    for (const [key, value] of Object.entries(obj)) {
      merged[key] = merged[key] || value === true;
    }
  }
  const overrideObj = (overrides ?? {}) as Record<string, boolean>;
  return { ...merged, ...overrideObj };
}

/** Live permission check for callers that have no JWT, such as API-key (MCP) requests. */
@Injectable()
export class CoopPermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async has(userId: string, coopId: string, key: CoopPermissionKey): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user) return false;
    if (user.role === 'SYSTEM_ADMIN') return true;
    const admin = await this.prisma.coopAdmin.findFirst({
      where: { userId, coopId },
      include: { roles: { include: { role: true } } },
    });
    if (!admin) return false;
    const merged = mergeAdminPermissions(admin.roles.map((r) => r.role.permissions), admin.permissionOverrides);
    return merged[key] === true;
  }
}
```

In `apps/api/src/modules/auth/token.service.ts`, delete the local `mergeAdminPermissions` function (lines 7–27 including its doc comment) and add:

```ts
import { mergeAdminPermissions } from '../../common/utils/coop-permissions';
```

- [ ] **Step 4: Run all API tests**

```bash
pnpm --filter @opencoop/api test
```

Expected: PASS, including the existing `token.service` / auth specs.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/utils/coop-permissions.ts apps/api/src/common/utils/coop-permissions.spec.ts apps/api/src/modules/auth/token.service.ts
git commit -m "refactor(auth): shared coop permission merge and a live lookup service

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: MCP draft tools

**Files:**
- Modify: `apps/api/src/modules/mcp/mcp-auth.store.ts`, `mcp-auth.middleware.ts`
- Create: `apps/api/src/modules/mcp/tools/mcp-message.tools.ts`
- Test: `apps/api/src/modules/mcp/tools/mcp-message.tools.spec.ts`
- Modify: `apps/api/src/modules/mcp/mcp.module.ts`

**Interfaces:**
- Consumes: `MessagesService.createConversation/updateDraft/findByIdForAdmin/countRecipients`, `markdownToMessageHtml`, `CoopPermissionsService.has`, `McpAuthStore.getUserId/getCoopId/getApiKeyId`.
- Produces MCP tools `create_message_draft`, `update_message_draft`, `get_message_draft` (all return a JSON string).

- [ ] **Step 1: Carry the API key id in the auth context**

`mcp-auth.store.ts`: extend the context and add a getter:

```ts
interface McpAuthContext {
  userId: string;
  coopId: string;
  apiKeyId?: string;
}
// …
  getApiKeyId(): string | undefined {
    return this.storage.getStore()?.apiKeyId;
  }
```

`mcp-auth.middleware.ts`: `ApiKeysService.validate(rawKey)` returns the matched key's `userId` and `coopId`; check with `grep -n "async validate" -A25 apps/api/src/modules/api-keys/api-keys.service.ts` whether it also returns the key `id`. If not, add `apiKeyId: key.id` to its return value (the function has the `ApiKey` row in hand). Then pass it through:

```ts
    this.mcpAuthStore.run({ userId: result.userId, coopId: result.coopId, apiKeyId: result.apiKeyId }, () => {
      next();
    });
```

Run `pnpm --filter @opencoop/api test -- mcp-auth` to confirm the existing middleware spec still passes (update its mock return to include `apiKeyId` if it asserts on the exact context).

- [ ] **Step 2: Write the failing tests**

`apps/api/src/modules/mcp/tools/mcp-message.tools.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { McpMessageTools } from './mcp-message.tools';
import { McpAuthStore } from '../mcp-auth.store';
import { MessagesService } from '../../messages/messages.service';
import { CoopPermissionsService } from '../../../common/utils/coop-permissions';
import { PrismaService } from '../../../prisma/prisma.service';

describe('McpMessageTools', () => {
  let tools: McpMessageTools;
  const auth = { getUserId: () => 'u1', getCoopId: () => 'c1', getApiKeyId: () => 'k1' };
  const messages = {
    createConversation: jest.fn(),
    updateDraft: jest.fn(),
    findByIdForAdmin: jest.fn(),
    countRecipients: jest.fn(),
  };
  const perms = { has: jest.fn() };
  const prisma = { project: { findFirst: jest.fn() } };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        McpMessageTools,
        { provide: McpAuthStore, useValue: auth },
        { provide: MessagesService, useValue: messages },
        { provide: CoopPermissionsService, useValue: perms },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    tools = module.get(McpMessageTools);
    jest.clearAllMocks();
    perms.has.mockResolvedValue(true);
    messages.createConversation.mockResolvedValue({ id: 'conv1' });
    messages.countRecipients.mockResolvedValue(62);
    messages.findByIdForAdmin.mockResolvedValue({
      id: 'conv1', subject: 'S', status: 'DRAFT', audienceType: 'PROJECT', audienceProjectId: 'p1', audienceShareholderIds: [],
      messages: [{ body: '<p>hi</p>', format: 'HTML' }],
    });
  });

  it('creates a DRAFT from markdown for a project audience by name', async () => {
    prisma.project.findFirst.mockResolvedValue({ id: 'p1', name: 'Onze Energie: Northwind' });
    const out = JSON.parse(await tools.createMessageDraft({
      subject: 'S', bodyMarkdown: '## Kop\n\nTekst **vet**.', audience: { type: 'PROJECT', projectName: 'Onze Energie: Northwind' },
    }));
    expect(messages.createConversation).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ type: 'BROADCAST', status: 'DRAFT', format: 'HTML', subject: 'S', body: '<h2>Kop</h2>\n<p>Tekst <strong>vet</strong>.</p>\n', audience: { type: 'PROJECT', projectId: 'p1' } }),
      'u1', undefined, 'mcp', { apiKeyId: 'k1' },
    );
    expect(out).toEqual(expect.objectContaining({ id: 'conv1', status: 'DRAFT', recipientCount: 62 }));
    expect(out.adminUrl).toMatch(/\/dashboard\/admin\/messages\/conv1$/);
  });

  it('refuses without canManageMessages', async () => {
    perms.has.mockResolvedValue(false);
    await expect(tools.createMessageDraft({ subject: 'S', bodyMarkdown: 'x', audience: { type: 'ALL' } })).rejects.toThrow(ForbiddenException);
    expect(messages.createConversation).not.toHaveBeenCalled();
  });

  it('never passes a status other than DRAFT', async () => {
    await tools.createMessageDraft({ subject: 'S', bodyMarkdown: 'x', audience: { type: 'ALL' } });
    const dto = messages.createConversation.mock.calls[0][1];
    expect(dto.status).toBe('DRAFT');
  });

  it('updates a draft body from markdown', async () => {
    messages.updateDraft.mockResolvedValue({});
    await tools.updateMessageDraft({ conversationId: 'conv1', bodyMarkdown: 'nieuw' });
    expect(messages.updateDraft).toHaveBeenCalledWith('conv1', 'c1', { body: '<p>nieuw</p>\n', format: 'HTML' }, 'u1');
  });

  it('get returns status, html, audience, count and admin url', async () => {
    const out = JSON.parse(await tools.getMessageDraft({ conversationId: 'conv1' }));
    expect(out).toEqual(expect.objectContaining({ id: 'conv1', status: 'DRAFT', bodyHtml: '<p>hi</p>', recipientCount: 62, audience: { type: 'PROJECT', projectId: 'p1', shareholderIds: [] } }));
  });
});
```

- [ ] **Step 3: Run to see it fail**

```bash
pnpm --filter @opencoop/api test -- mcp-message
```

Expected: FAIL, module not found.

- [ ] **Step 4: Implement**

`apps/api/src/modules/mcp/tools/mcp-message.tools.ts`:

```ts
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { McpAuthStore } from '../mcp-auth.store';
import { MessagesService } from '../../messages/messages.service';
import { markdownToMessageHtml } from '../../messages/message-body';
import { CoopPermissionsService } from '../../../common/utils/coop-permissions';
import { PrismaService } from '../../../prisma/prisma.service';

const audienceSchema = z.object({
  type: z.enum(['ALL', 'PROJECT', 'SELECTED']),
  projectId: z.string().optional().describe('Project id, for type PROJECT'),
  projectName: z.string().optional().describe('Exact project name, alternative to projectId, for type PROJECT'),
  shareholderIds: z.array(z.string()).optional().describe('Shareholder ids, for type SELECTED'),
});
type AudienceInput = z.infer<typeof audienceSchema>;

/**
 * Draft-only messaging tools for API keys. These can create and edit DRAFT
 * conversations and nothing else: no send, no schedule, no participants.
 * Sending is an admin-UI action by a logged-in user.
 */
@Injectable()
export class McpMessageTools {
  constructor(
    private readonly auth: McpAuthStore,
    private readonly messages: MessagesService,
    private readonly permissions: CoopPermissionsService,
    private readonly prisma: PrismaService,
  ) {}

  private async requirePermission(): Promise<{ userId: string; coopId: string; apiKeyId?: string }> {
    const userId = this.auth.getUserId();
    const coopId = this.auth.getCoopId();
    if (!(await this.permissions.has(userId, coopId, 'canManageMessages'))) {
      throw new ForbiddenException('This API key\'s user may not manage messages for this coop');
    }
    return { userId, coopId, apiKeyId: this.auth.getApiKeyId() };
  }

  private async resolveAudience(coopId: string, a: AudienceInput) {
    if (a.type === 'PROJECT' && !a.projectId && a.projectName) {
      const project = await this.prisma.project.findFirst({ where: { coopId, name: a.projectName }, select: { id: true } });
      if (!project) throw new NotFoundException(`Project "${a.projectName}" not found`);
      return { type: 'PROJECT' as const, projectId: project.id };
    }
    if (a.type === 'PROJECT') return { type: 'PROJECT' as const, projectId: a.projectId };
    if (a.type === 'SELECTED') return { type: 'SELECTED' as const, shareholderIds: a.shareholderIds ?? [] };
    return { type: 'ALL' as const };
  }

  private adminUrl(conversationId: string) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://opencoop.be';
    return `${appUrl}/nl/dashboard/admin/messages/${conversationId}`;
  }

  private async describe(conversationId: string, coopId: string) {
    const conv = await this.messages.findByIdForAdmin(conversationId, coopId);
    const first = conv.messages[0];
    return {
      id: conv.id,
      status: conv.status,
      subject: conv.subject,
      bodyHtml: first?.body ?? '',
      audience: { type: conv.audienceType, projectId: conv.audienceProjectId, shareholderIds: conv.audienceShareholderIds },
      recipientCount: await this.messages.countRecipients(conversationId, coopId),
      adminUrl: this.adminUrl(conv.id),
    };
  }

  @Tool({
    name: 'create_message_draft',
    description:
      'Create a DRAFT message to shareholders. It is not sent: an admin reviews it in the dashboard and sends or schedules it. Body is Markdown (headings, bold, lists, links). Audience: ALL shareholders, one PROJECT (by id or exact name), or SELECTED shareholder ids. Returns the draft id, recipient count and the admin URL.',
    parameters: z.object({
      subject: z.string().min(1),
      bodyMarkdown: z.string().min(1),
      audience: audienceSchema,
    }),
  })
  async createMessageDraft(params: { subject: string; bodyMarkdown: string; audience: AudienceInput }) {
    const { userId, coopId, apiKeyId } = await this.requirePermission();
    const audience = await this.resolveAudience(coopId, params.audience);
    const conv = await this.messages.createConversation(
      coopId,
      { type: 'BROADCAST', status: 'DRAFT', format: 'HTML', subject: params.subject, body: markdownToMessageHtml(params.bodyMarkdown), audience },
      userId,
      undefined,
      'mcp',
      { apiKeyId },
    );
    return JSON.stringify(await this.describe(conv.id, coopId), null, 2);
  }

  @Tool({
    name: 'update_message_draft',
    description: 'Edit the subject, Markdown body or audience of a DRAFT message. Fails on sent or scheduled messages.',
    parameters: z.object({
      conversationId: z.string(),
      subject: z.string().min(1).optional(),
      bodyMarkdown: z.string().min(1).optional(),
      audience: audienceSchema.optional(),
    }),
  })
  async updateMessageDraft(params: { conversationId: string; subject?: string; bodyMarkdown?: string; audience?: AudienceInput }) {
    const { userId, coopId } = await this.requirePermission();
    const dto: Record<string, unknown> = {};
    if (params.subject !== undefined) dto.subject = params.subject;
    if (params.bodyMarkdown !== undefined) {
      dto.body = markdownToMessageHtml(params.bodyMarkdown);
      dto.format = 'HTML';
    }
    if (params.audience) dto.audience = await this.resolveAudience(coopId, params.audience);
    await this.messages.updateDraft(params.conversationId, coopId, dto, userId);
    return JSON.stringify(await this.describe(params.conversationId, coopId), null, 2);
  }

  @Tool({
    name: 'get_message_draft',
    description: 'Read a message (draft, scheduled or sent): status, subject, HTML body, audience, recipient count and the admin URL.',
    parameters: z.object({ conversationId: z.string() }),
  })
  async getMessageDraft(params: { conversationId: string }) {
    const { coopId } = await this.requirePermission();
    return JSON.stringify(await this.describe(params.conversationId, coopId), null, 2);
  }
}
```

Register in `mcp.module.ts`: import `McpMessageTools`, `MessagesModule`, `CoopPermissionsService`; add `McpMessageTools` to the `McpModule.forFeature([...])` array and to `providers`; add `MessagesModule` to `imports`; add `CoopPermissionsService` to `providers` (it only needs `PrismaService`, which is global; confirm with `grep -n "@Global" apps/api/src/prisma/prisma.module.ts`).

The `'mcp'` value passed as `userAgent` is deliberate: it lands in the audit row so a key-created draft is recognisable.

- [ ] **Step 5: Run to see it pass**

```bash
pnpm --filter @opencoop/api test -- mcp
pnpm --filter @opencoop/api exec tsc --noEmit
```

Expected: PASS (5 new tests plus the existing mcp specs).

- [ ] **Step 6: Try it against the dev API with a real key**

Start the API, create an API key in the admin UI (Instellingen → API-sleutels) or with `POST admin/coops/:coopId/api-keys`, then with any MCP client (or `curl` to the MCP endpoint used by the existing tools, see `apps/api/src/modules/mcp/mcp-auth.middleware.spec.ts` for the path) call `create_message_draft` with `audience: { type: 'ALL' }`. Expected: a JSON with `status: "DRAFT"` and a `recipientCount` > 0; the draft shows in the admin messages list after Task 12.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/mcp apps/api/src/modules/api-keys
git commit -m "feat(mcp): draft-only message tools for API keys

create_message_draft, update_message_draft and get_message_draft can only
produce DRAFT conversations. No tool sends or schedules; the key's user
must hold canManageMessages, checked live.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Web building blocks — editor, audience picker, schedule dialog, message body

**Files:**
- Create: `apps/web/src/components/admin/rich-text-editor.tsx`
- Create: `apps/web/src/components/admin/audience-picker.tsx`
- Create: `apps/web/src/components/admin/schedule-dialog.tsx`
- Create: `apps/web/src/components/message-body.tsx`
- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/messages/{nl,fr,de,en}.json`
- Modify: `apps/web/package.json`

**Interfaces:**
- Produces:
  ```ts
  <RichTextEditor value={html} onChange={(html) => …} placeholder? />
  type Audience = { type: 'ALL'|'PROJECT'|'SELECTED'; projectId?: string; shareholderIds?: string[] }
  <AudiencePicker coopId value={audience} onChange={(a) => …} onCountChange?={(n|null) => …} />
  <ScheduleDialog open onOpenChange onConfirm={(isoUtc: string) => …} />
  <MessageBody body={string} format={'TEXT'|'HTML'} />
  ```

- [ ] **Step 1: Add dependencies**

```bash
pnpm --filter @opencoop/web add @tiptap/react @tiptap/starter-kit @tiptap/extension-link @tiptap/pm
```

- [ ] **Step 2: i18n keys**

Add to the `messages` object in `apps/web/messages/nl.json` (keep the existing keys):

```json
    "audience": "Ontvangers",
    "audienceAll": "Alle actieve aandeelhouders",
    "audienceProject": "Aandeelhouders van een project",
    "audienceSelected": "Geselecteerde aandeelhouders",
    "selectProject": "Kies een project",
    "searchShareholders": "Zoek op naam of e-mail",
    "recipientCount": "{count, plural, =0 {Geen ontvangers} =1 {1 ontvanger} other {# ontvangers}}",
    "recipientCountLoading": "Ontvangers tellen…",
    "saveDraft": "Bewaar als concept",
    "sendNow": "Verstuur nu",
    "schedule": "Plan verzending",
    "scheduleTitle": "Verzending plannen",
    "scheduleDate": "Datum",
    "scheduleTime": "Tijd",
    "scheduleConfirm": "Plannen",
    "scheduledFor": "Gepland voor {date}",
    "cancelSchedule": "Annuleer planning",
    "deleteDraft": "Verwijder concept",
    "deleteDraftConfirm": "Dit concept verwijderen? Dit kan niet ongedaan worden gemaakt.",
    "confirmSendTitle": "Bericht versturen?",
    "confirmSendBody": "Dit bericht gaat naar {count} ontvangers. Elke ontvanger krijgt een eigen e-mail met de volledige tekst.",
    "emailDisabledWarning": "E-mail staat uit voor deze coöperatie. Het bericht verschijnt enkel in het postvak op het platform.",
    "emptyAudience": "Er zijn geen ontvangers voor deze selectie.",
    "status": {
      "draft": "Concept",
      "scheduled": "Gepland",
      "sent": "Verzonden"
    },
    "editor": {
      "bold": "Vet",
      "italic": "Cursief",
      "heading": "Kop",
      "bulletList": "Opsomming",
      "orderedList": "Genummerde lijst",
      "link": "Link",
      "linkPrompt": "Adres van de link (https://…)"
    }
```

Same keys in `en.json`:

```json
    "audience": "Recipients",
    "audienceAll": "All active shareholders",
    "audienceProject": "Shareholders of a project",
    "audienceSelected": "Selected shareholders",
    "selectProject": "Choose a project",
    "searchShareholders": "Search by name or e-mail",
    "recipientCount": "{count, plural, =0 {No recipients} =1 {1 recipient} other {# recipients}}",
    "recipientCountLoading": "Counting recipients…",
    "saveDraft": "Save as draft",
    "sendNow": "Send now",
    "schedule": "Schedule",
    "scheduleTitle": "Schedule sending",
    "scheduleDate": "Date",
    "scheduleTime": "Time",
    "scheduleConfirm": "Schedule",
    "scheduledFor": "Scheduled for {date}",
    "cancelSchedule": "Cancel schedule",
    "deleteDraft": "Delete draft",
    "deleteDraftConfirm": "Delete this draft? This cannot be undone.",
    "confirmSendTitle": "Send message?",
    "confirmSendBody": "This message goes to {count} recipients. Each recipient gets their own e-mail with the full text.",
    "emailDisabledWarning": "E-mail is disabled for this cooperative. The message will only appear in the platform inbox.",
    "emptyAudience": "There are no recipients for this selection.",
    "status": { "draft": "Draft", "scheduled": "Scheduled", "sent": "Sent" },
    "editor": { "bold": "Bold", "italic": "Italic", "heading": "Heading", "bulletList": "Bullet list", "orderedList": "Numbered list", "link": "Link", "linkPrompt": "Link address (https://…)" }
```

`fr.json`:

```json
    "audience": "Destinataires",
    "audienceAll": "Tous les actionnaires actifs",
    "audienceProject": "Actionnaires d'un projet",
    "audienceSelected": "Actionnaires sélectionnés",
    "selectProject": "Choisissez un projet",
    "searchShareholders": "Rechercher par nom ou e-mail",
    "recipientCount": "{count, plural, =0 {Aucun destinataire} =1 {1 destinataire} other {# destinataires}}",
    "recipientCountLoading": "Comptage des destinataires…",
    "saveDraft": "Enregistrer comme brouillon",
    "sendNow": "Envoyer maintenant",
    "schedule": "Planifier l'envoi",
    "scheduleTitle": "Planifier l'envoi",
    "scheduleDate": "Date",
    "scheduleTime": "Heure",
    "scheduleConfirm": "Planifier",
    "scheduledFor": "Planifié pour le {date}",
    "cancelSchedule": "Annuler la planification",
    "deleteDraft": "Supprimer le brouillon",
    "deleteDraftConfirm": "Supprimer ce brouillon ? Cette action est irréversible.",
    "confirmSendTitle": "Envoyer le message ?",
    "confirmSendBody": "Ce message sera envoyé à {count} destinataires. Chacun reçoit son propre e-mail avec le texte complet.",
    "emailDisabledWarning": "L'e-mail est désactivé pour cette coopérative. Le message n'apparaîtra que dans la boîte de réception de la plateforme.",
    "emptyAudience": "Aucun destinataire pour cette sélection.",
    "status": { "draft": "Brouillon", "scheduled": "Planifié", "sent": "Envoyé" },
    "editor": { "bold": "Gras", "italic": "Italique", "heading": "Titre", "bulletList": "Liste à puces", "orderedList": "Liste numérotée", "link": "Lien", "linkPrompt": "Adresse du lien (https://…)" }
```

`de.json`:

```json
    "audience": "Empfänger",
    "audienceAll": "Alle aktiven Anteilseigner",
    "audienceProject": "Anteilseigner eines Projekts",
    "audienceSelected": "Ausgewählte Anteilseigner",
    "selectProject": "Projekt wählen",
    "searchShareholders": "Nach Name oder E-Mail suchen",
    "recipientCount": "{count, plural, =0 {Keine Empfänger} =1 {1 Empfänger} other {# Empfänger}}",
    "recipientCountLoading": "Empfänger werden gezählt…",
    "saveDraft": "Als Entwurf speichern",
    "sendNow": "Jetzt senden",
    "schedule": "Versand planen",
    "scheduleTitle": "Versand planen",
    "scheduleDate": "Datum",
    "scheduleTime": "Uhrzeit",
    "scheduleConfirm": "Planen",
    "scheduledFor": "Geplant für {date}",
    "cancelSchedule": "Planung abbrechen",
    "deleteDraft": "Entwurf löschen",
    "deleteDraftConfirm": "Diesen Entwurf löschen? Das kann nicht rückgängig gemacht werden.",
    "confirmSendTitle": "Nachricht senden?",
    "confirmSendBody": "Diese Nachricht geht an {count} Empfänger. Jeder Empfänger erhält eine eigene E-Mail mit dem vollständigen Text.",
    "emailDisabledWarning": "E-Mail ist für diese Genossenschaft deaktiviert. Die Nachricht erscheint nur im Posteingang der Plattform.",
    "emptyAudience": "Für diese Auswahl gibt es keine Empfänger.",
    "status": { "draft": "Entwurf", "scheduled": "Geplant", "sent": "Gesendet" },
    "editor": { "bold": "Fett", "italic": "Kursiv", "heading": "Überschrift", "bulletList": "Aufzählung", "orderedList": "Nummerierte Liste", "link": "Link", "linkPrompt": "Adresse des Links (https://…)" }
```

- [ ] **Step 3: Editor**

`apps/web/src/components/admin/rich-text-editor.tsx`:

```tsx
'use client';

import { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { useTranslations } from 'next-intl';
import { Bold, Italic, Heading2, List, ListOrdered, Link as LinkIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
}

/** Bold, italic, h2/h3, lists, links. Output HTML is re-sanitised by the API on save. */
export function RichTextEditor({ value, onChange, className }: Props) {
  const t = useTranslations();
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, codeBlock: false, code: false, horizontalRule: false }),
      Link.configure({ openOnClick: false, autolink: true, protocols: ['http', 'https', 'mailto'] }),
    ],
    content: value,
    immediatelyRender: false,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: { attributes: { class: 'message-html min-h-[240px] p-3 focus:outline-none' } },
  });

  // Keep the editor in sync when the parent loads a draft after mount.
  useEffect(() => {
    if (editor && value !== editor.getHTML() && !editor.isFocused) editor.commands.setContent(value, false);
  }, [editor, value]);

  if (!editor) return null;

  const setLink = () => {
    const previous = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt(t('messages.editor.linkPrompt'), previous ?? 'https://');
    if (url === null) return;
    if (url === '') return void editor.chain().focus().extendMarkRange('link').unsetLink().run();
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  const tool = (label: string, active: boolean, onClick: () => void, Icon: typeof Bold) => (
    <Button type="button" variant={active ? 'secondary' : 'ghost'} size="sm" aria-label={label} title={label} onClick={onClick}>
      <Icon className="h-4 w-4" />
    </Button>
  );

  return (
    <div className={cn('rounded-md border', className)}>
      <div className="flex flex-wrap gap-1 border-b p-1">
        {tool(t('messages.editor.bold'), editor.isActive('bold'), () => editor.chain().focus().toggleBold().run(), Bold)}
        {tool(t('messages.editor.italic'), editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), Italic)}
        {tool(t('messages.editor.heading'), editor.isActive('heading', { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), Heading2)}
        {tool(t('messages.editor.bulletList'), editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run(), List)}
        {tool(t('messages.editor.orderedList'), editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run(), ListOrdered)}
        {tool(t('messages.editor.link'), editor.isActive('link'), setLink, LinkIcon)}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
```

- [ ] **Step 4: Message body renderer and styles**

`apps/web/src/components/message-body.tsx`:

```tsx
interface Props {
  body: string;
  format: 'TEXT' | 'HTML';
  className?: string;
}

/** Renders a message body. HTML bodies are allowlist-sanitised by the API before they are stored. */
export function MessageBody({ body, format, className }: Props) {
  if (format === 'HTML') {
    return <div className={`message-html text-sm ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: body }} />;
  }
  return <p className={`text-sm whitespace-pre-wrap ${className ?? ''}`}>{body}</p>;
}
```

Append to `apps/web/src/app/globals.css`:

```css
/* Sanitised message HTML: p, br, strong, em, u, s, h2, h3, ul, ol, li, a, blockquote */
.message-html p { margin: 0 0 0.75em; }
.message-html h2 { font-size: 1.125rem; font-weight: 600; margin: 1em 0 0.5em; }
.message-html h3 { font-size: 1rem; font-weight: 600; margin: 1em 0 0.5em; }
.message-html ul { list-style: disc; padding-left: 1.5em; margin: 0 0 0.75em; }
.message-html ol { list-style: decimal; padding-left: 1.5em; margin: 0 0 0.75em; }
.message-html a { text-decoration: underline; color: #1e40af; }
.message-html blockquote { border-left: 3px solid #cbd5e1; padding-left: 0.75em; color: #475569; margin: 0 0 0.75em; }
```

- [ ] **Step 5: Audience picker**

`apps/web/src/components/admin/audience-picker.tsx`:

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';

export interface Audience {
  type: 'ALL' | 'PROJECT' | 'SELECTED';
  projectId?: string;
  shareholderIds?: string[];
}

interface ProjectOption { id: string; name: string }
interface ShareholderOption { id: string; firstName?: string | null; lastName?: string | null; companyName?: string | null; email?: string | null; type: string }

interface Props {
  coopId: string;
  value: Audience;
  onChange: (audience: Audience) => void;
  onCountChange?: (count: number | null) => void;
  disabled?: boolean;
}

function shareholderLabel(s: ShareholderOption) {
  const name = s.type === 'COMPANY' ? s.companyName : `${s.lastName ?? ''} ${s.firstName ?? ''}`.trim();
  return s.email ? `${name} (${s.email})` : name || s.id;
}

export function AudiencePicker({ coopId, value, onChange, onCountChange, disabled }: Props) {
  const t = useTranslations();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [shareholders, setShareholders] = useState<ShareholderOption[]>([]);
  const [search, setSearch] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);

  useEffect(() => {
    api<ProjectOption[] | { items: ProjectOption[] }>(`/admin/coops/${coopId}/projects`).then((r) =>
      setProjects(Array.isArray(r) ? r : r.items ?? []),
    );
  }, [coopId]);

  useEffect(() => {
    if (value.type !== 'SELECTED' || shareholders.length) return;
    api<{ items: ShareholderOption[] }>(`/admin/coops/${coopId}/shareholders?page=1&pageSize=10000&status=ACTIVE`).then((r) =>
      setShareholders(r.items ?? []),
    );
  }, [coopId, value.type, shareholders.length]);

  // Live recipient count, debounced.
  useEffect(() => {
    if (value.type === 'PROJECT' && !value.projectId) { setCount(null); onCountChange?.(null); return; }
    setCounting(true);
    const handle = setTimeout(async () => {
      try {
        const r = await api<{ count: number }>(`/admin/coops/${coopId}/conversations/audience-preview`, { method: 'POST', body: value });
        setCount(r.count); onCountChange?.(r.count);
      } catch { setCount(null); onCountChange?.(null); }
      finally { setCounting(false); }
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coopId, value.type, value.projectId, (value.shareholderIds ?? []).join(',')]);

  const selected = useMemo(() => new Set(value.shareholderIds ?? []), [value.shareholderIds]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? shareholders.filter((s) => shareholderLabel(s).toLowerCase().includes(q)) : shareholders;
    return list.slice(0, 50);
  }, [shareholders, search]);

  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    onChange({ type: 'SELECTED', shareholderIds: [...next] });
  };

  return (
    <div className="space-y-3">
      <Label>{t('messages.audience')}</Label>
      <RadioGroup value={value.type} disabled={disabled} onValueChange={(type) => onChange({ type: type as Audience['type'], projectId: undefined, shareholderIds: value.shareholderIds })}>
        <div className="flex items-center gap-2"><RadioGroupItem value="ALL" id="aud-all" /><Label htmlFor="aud-all">{t('messages.audienceAll')}</Label></div>
        <div className="flex items-center gap-2"><RadioGroupItem value="PROJECT" id="aud-project" /><Label htmlFor="aud-project">{t('messages.audienceProject')}</Label></div>
        <div className="flex items-center gap-2"><RadioGroupItem value="SELECTED" id="aud-selected" /><Label htmlFor="aud-selected">{t('messages.audienceSelected')}</Label></div>
      </RadioGroup>

      {value.type === 'PROJECT' && (
        <Select value={value.projectId ?? ''} disabled={disabled} onValueChange={(projectId) => onChange({ type: 'PROJECT', projectId })}>
          <SelectTrigger><SelectValue placeholder={t('messages.selectProject')} /></SelectTrigger>
          <SelectContent>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
        </Select>
      )}

      {value.type === 'SELECTED' && (
        <div className="space-y-2">
          <Input value={search} disabled={disabled} onChange={(e) => setSearch(e.target.value)} placeholder={t('messages.searchShareholders')} />
          <div className="flex flex-wrap gap-1">
            {[...selected].map((id) => {
              const s = shareholders.find((x) => x.id === id);
              return <Badge key={id} variant="secondary" className="cursor-pointer" onClick={() => !disabled && toggle(id)}>{s ? shareholderLabel(s) : id} ×</Badge>;
            })}
          </div>
          <div className="max-h-64 overflow-y-auto rounded-md border p-2 space-y-1">
            {filtered.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm">
                <Checkbox checked={selected.has(s.id)} disabled={disabled} onCheckedChange={() => toggle(s.id)} />
                <span>{shareholderLabel(s)}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <p className="text-sm text-muted-foreground" data-testid="recipient-count">
        {counting ? t('messages.recipientCountLoading') : count === null ? '' : t('messages.recipientCount', { count })}
      </p>
    </div>
  );
}
```

Check the projects endpoint shape first: `grep -n "@Get('projects')" -A8 apps/api/src/modules/admin/admin.controller.ts`. The component accepts both an array and `{ items }`; if the real shape is `{ projects: [...] }`, adjust the one line that reads it.

- [ ] **Step 6: Schedule dialog**

`apps/web/src/components/admin/schedule-dialog.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DatePicker } from '@/components/ui/date-picker';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (scheduledAtIsoUtc: string) => void;
}

/** Date (yyyy-MM-dd, from DatePicker) + local time → UTC ISO instant. */
export function ScheduleDialog({ open, onOpenChange, onConfirm }: Props) {
  const t = useTranslations();
  const [date, setDate] = useState<string>('');
  const [time, setTime] = useState<string>('09:00');

  const local = date && time ? new Date(`${date}T${time}:00`) : null;
  const valid = !!local && !Number.isNaN(local.getTime()) && local.getTime() - Date.now() >= 5 * 60_000;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t('messages.scheduleTitle')}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>{t('messages.scheduleDate')}</Label>
            <DatePicker value={date} onChange={setDate} />
          </div>
          <div>
            <Label htmlFor="schedule-time">{t('messages.scheduleTime')}</Label>
            <Input id="schedule-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button disabled={!valid} onClick={() => local && onConfirm(local.toISOString())}>{t('messages.scheduleConfirm')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Confirm `DatePicker`'s prop names with `sed -n 1,40p apps/web/src/components/ui/date-picker.tsx`; the exploration says `value`/`onChange` with `yyyy-MM-dd` strings. Confirm `common.cancel` exists in `nl.json` (`grep -n '"cancel"' apps/web/messages/nl.json`); if the key is different, use that one.

- [ ] **Step 7: Lint and build**

```bash
pnpm --filter @opencoop/web lint
pnpm --filter @opencoop/web build
```

Expected: clean (the components are not yet used; the build must still compile them).

- [ ] **Step 8: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/components apps/web/src/app/globals.css apps/web/messages
git commit -m "feat(web): rich-text editor, audience picker, schedule dialog, message body renderer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Admin pages — new, list, detail; shareholder inbox

**Files:**
- Modify: `apps/web/src/app/[locale]/dashboard/admin/messages/new/page.tsx` (full rewrite)
- Modify: `apps/web/src/app/[locale]/dashboard/admin/messages/page.tsx` (types, badge, ordering)
- Modify: `apps/web/src/app/[locale]/dashboard/admin/messages/[conversationId]/page.tsx` (draft/scheduled/sent modes)
- Modify: `apps/web/src/app/[locale]/dashboard/inbox/[conversationId]/page.tsx:159` (use `MessageBody`)

**Interfaces:**
- Consumes: Task 11 components, Task 6 routes. `useAdmin()` from `@/contexts/admin-context` (confirm path with `grep -rn "export function useAdmin" apps/web/src`), `api` from `@/lib/api`, `useRouter` from `@/i18n/routing`.

- [ ] **Step 1: Rewrite `new/page.tsx`**

Keep the file's existing imports for `Card`, `CardContent`, `Input`, `Label`, `Button`, `Alert`, `Link`, `useAdmin`, `useRouter`, `useTranslations`, `api` (read the current file first: `sed -n 1,40p …/new/page.tsx`) and replace the component body with:

```tsx
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/routing';
import { api } from '@/lib/api';
import { useAdmin } from '@/contexts/admin-context';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RichTextEditor } from '@/components/admin/rich-text-editor';
import { AudiencePicker, type Audience } from '@/components/admin/audience-picker';
import { ScheduleDialog } from '@/components/admin/schedule-dialog';
import { MessageBody } from '@/components/message-body';

export default function NewMessagePage() {
  const t = useTranslations();
  const router = useRouter();
  const { selectedCoop } = useAdmin();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<Audience>({ type: 'ALL' });
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  if (!selectedCoop) return null;
  const coopId = selectedCoop.id;
  const textOnly = body.replace(/<[^>]+>/g, '').trim();
  const canSubmit = subject.trim().length > 0 && textOnly.length > 0 && !busy;
  const canSend = canSubmit && (count ?? 0) > 0;

  const createDraft = async () => {
    const conv = await api<{ id: string }>(`/admin/coops/${coopId}/conversations`, {
      method: 'POST',
      body: { type: 'BROADCAST', subject, body, format: 'HTML', status: 'DRAFT', audience },
    });
    return conv.id;
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : t('common.error')); setBusy(false); }
  };

  const onSaveDraft = () => run(async () => { const id = await createDraft(); router.push(`/dashboard/admin/messages/${id}`); });
  const onSendNow = () => run(async () => {
    const id = await createDraft();
    await api(`/admin/coops/${coopId}/conversations/${id}/send`, { method: 'POST' });
    router.push(`/dashboard/admin/messages/${id}`);
  });
  const onSchedule = (scheduledAt: string) => run(async () => {
    const id = await createDraft();
    await api(`/admin/coops/${coopId}/conversations/${id}/schedule`, { method: 'POST', body: { scheduledAt } });
    router.push(`/dashboard/admin/messages/${id}`);
  });

  return (
    <div className="space-y-4">
      <Link href="/dashboard/admin/messages" className="text-sm text-muted-foreground">← {t('messages.backToInbox')}</Link>
      <Card>
        <CardContent className="space-y-6 pt-6">
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          {selectedCoop.emailEnabled === false && <Alert><AlertDescription>{t('messages.emailDisabledWarning')}</AlertDescription></Alert>}

          <AudiencePicker coopId={coopId} value={audience} onChange={setAudience} onCountChange={setCount} />

          <div>
            <Label htmlFor="subject">{t('messages.subject')}</Label>
            <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t('messages.subjectPlaceholder')} />
          </div>

          <div>
            <Label>{t('messages.body')}</Label>
            <RichTextEditor value={body} onChange={setBody} />
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" asChild><Link href="/dashboard/admin/messages">{t('common.cancel')}</Link></Button>
            <Button variant="secondary" disabled={!canSubmit} onClick={onSaveDraft}>{t('messages.saveDraft')}</Button>
            <Button variant="secondary" disabled={!canSend} onClick={() => setScheduleOpen(true)}>{t('messages.schedule')}</Button>
            <Button disabled={!canSend} onClick={() => setConfirmOpen(true)}>{t('messages.sendNow')}</Button>
          </div>
          {count === 0 && <p className="text-sm text-destructive">{t('messages.emptyAudience')}</p>}
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{t('messages.confirmSendTitle')}</DialogTitle></DialogHeader>
          <p className="text-sm">{t('messages.confirmSendBody', { count: count ?? 0 })}</p>
          <div className="rounded-md border p-4 max-h-96 overflow-y-auto">
            <p className="font-semibold mb-2">{subject}</p>
            <MessageBody body={body} format="HTML" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>{t('common.cancel')}</Button>
            <Button disabled={busy} onClick={() => { setConfirmOpen(false); onSendNow(); }}>{t('messages.sendNow')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ScheduleDialog open={scheduleOpen} onOpenChange={setScheduleOpen} onConfirm={(at) => { setScheduleOpen(false); onSchedule(at); }} />
    </div>
  );
}
```

`selectedCoop.emailEnabled` may not be on the admin context's coop type; check with `grep -n "emailEnabled" apps/web/src/contexts/admin-context.tsx`. If absent, drop that `Alert` line (the API still behaves correctly); do not add a new fetch for it.

- [ ] **Step 2: List page**

In `messages/page.tsx`:

1. Extend `ConversationListItem` with `status: 'DRAFT' | 'SCHEDULED' | 'SENT'; scheduledAt: string | null; sentAt: string | null; recipientCount: number;`.
2. Where the type `Badge` is rendered for each row, render the status badge next to it:

```tsx
<Badge variant={conv.status === 'SENT' ? 'secondary' : conv.status === 'SCHEDULED' ? 'outline' : 'default'}>
  {t(`messages.status.${conv.status.toLowerCase()}`)}
  {conv.status === 'SCHEDULED' && conv.scheduledAt ? ` · ${new Date(conv.scheduledAt).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })}` : ''}
</Badge>
```

3. In the participants column, show `conv.recipientCount` instead of `conv._count.participants`.
4. In the client-side sort, before applying the column sort, stable-sort so that `DRAFT` and `SCHEDULED` rows come first:

```ts
const rank = (s: string) => (s === 'DRAFT' ? 0 : s === 'SCHEDULED' ? 1 : 2);
sorted = [...sorted].sort((a, b) => rank(a.status) - rank(b.status));
```

(`sorted` is whatever the local variable is called after `applyColumnFiltersAndSort`; read the file.)

- [ ] **Step 3: Detail page**

In `messages/[conversationId]/page.tsx`:

1. Extend `ConversationDetail` with `status`, `scheduledAt`, `sentAt`, `audienceType`, `audienceProjectId`, `audienceShareholderIds`, and `Message` with `format: 'TEXT' | 'HTML'`.
2. Replace `<p className="text-sm whitespace-pre-wrap">{msg.body}</p>` with `<MessageBody body={msg.body} format={msg.format ?? 'TEXT'} />`.
3. Add three modes above the message thread:

```tsx
{conversation.status === 'DRAFT' && (
  <DraftEditor conversation={conversation} coopId={selectedCoop.id} onChanged={loadConversation} />
)}
{conversation.status === 'SCHEDULED' && (
  <Alert>
    <AlertDescription className="flex items-center justify-between gap-4">
      <span>{t('messages.scheduledFor', { date: new Date(conversation.scheduledAt!).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) })}</span>
      <Button variant="outline" size="sm" onClick={async () => { await api(`/admin/coops/${selectedCoop.id}/conversations/${conversation.id}/cancel-schedule`, { method: 'POST' }); await loadConversation(); }}>
        {t('messages.cancelSchedule')}
      </Button>
    </AlertDescription>
  </Alert>
)}
```

Hide the reply form and the attachment upload unless `conversation.status === 'SENT'`.

4. Add `DraftEditor` in the same file (below the page component):

```tsx
function DraftEditor({ conversation, coopId, onChanged }: { conversation: ConversationDetail; coopId: string; onChanged: () => Promise<void> }) {
  const t = useTranslations();
  const router = useRouter();
  const first = conversation.messages[0];
  const [subject, setSubject] = useState(conversation.subject);
  const [body, setBody] = useState(first?.format === 'HTML' ? first.body : '');
  const [audience, setAudience] = useState<Audience>({
    type: conversation.audienceType,
    projectId: conversation.audienceProjectId ?? undefined,
    shareholderIds: conversation.audienceShareholderIds,
  });
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const base = `/admin/coops/${coopId}/conversations/${conversation.id}`;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : t('common.error')); } finally { setBusy(false); }
  };
  const save = () => api(base, { method: 'PATCH', body: { subject, body, format: 'HTML', audience } });
  const dirty = subject !== conversation.subject || body !== (first?.body ?? '');

  return (
    <Card>
      <CardContent className="space-y-6 pt-6">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <AudiencePicker coopId={coopId} value={audience} onChange={setAudience} onCountChange={setCount} />
        <div><Label htmlFor="subject">{t('messages.subject')}</Label><Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
        <div><Label>{t('messages.body')}</Label><RichTextEditor value={body} onChange={setBody} /></div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="destructive" disabled={busy} onClick={() => run(async () => { if (!window.confirm(t('messages.deleteDraftConfirm'))) return; await api(base, { method: 'DELETE' }); router.push('/dashboard/admin/messages'); })}>{t('messages.deleteDraft')}</Button>
          <Button variant="secondary" disabled={busy || !dirty} onClick={() => run(async () => { await save(); await onChanged(); })}>{t('messages.saveDraft')}</Button>
          <Button variant="secondary" disabled={busy || !(count ?? 0)} onClick={() => setScheduleOpen(true)}>{t('messages.schedule')}</Button>
          <Button disabled={busy || !(count ?? 0)} onClick={() => setConfirmOpen(true)}>{t('messages.sendNow')}</Button>
        </div>
        {count === 0 && <p className="text-sm text-destructive">{t('messages.emptyAudience')}</p>}
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{t('messages.confirmSendTitle')}</DialogTitle></DialogHeader>
          <p className="text-sm">{t('messages.confirmSendBody', { count: count ?? 0 })}</p>
          <div className="rounded-md border p-4 max-h-96 overflow-y-auto"><p className="font-semibold mb-2">{subject}</p><MessageBody body={body} format="HTML" /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>{t('common.cancel')}</Button>
            <Button disabled={busy} onClick={() => { setConfirmOpen(false); run(async () => { await save(); await api(`${base}/send`, { method: 'POST' }); await onChanged(); }); }}>{t('messages.sendNow')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ScheduleDialog open={scheduleOpen} onOpenChange={setScheduleOpen} onConfirm={(at) => { setScheduleOpen(false); run(async () => { await save(); await api(`${base}/schedule`, { method: 'POST', body: { scheduledAt: at } }); await onChanged(); }); }} />
    </Card>
  );
}
```

Add the imports this needs (`RichTextEditor`, `AudiencePicker`, `Audience`, `ScheduleDialog`, `MessageBody`, `Dialog*`, `Alert*`, `Label`, `Input`, `useRouter`).

- [ ] **Step 4: Shareholder inbox**

In `inbox/[conversationId]/page.tsx`: add `format: 'TEXT' | 'HTML'` to the local `Message` interface, import `MessageBody`, and replace line 159 with `<MessageBody body={msg.body} format={msg.format ?? 'TEXT'} />`.

- [ ] **Step 5: Lint, build, click through**

```bash
pnpm --filter @opencoop/web lint
pnpm --filter @opencoop/web build
```

Then run API + web locally (`pnpm dev` at the root or the two `dev` scripts), log in as admin, and verify by hand:

1. New message → audience "Project" → pick a project → the count line shows a number.
2. "Bewaar als concept" → detail page shows the draft editor with the same content.
3. "Verstuur nu" → confirm dialog shows the count and the rendered HTML → after confirm the badge in the list reads "Verzonden" and the shareholder inbox shows the formatted body.
4. New message → "Plan verzending" → pick tomorrow → list shows "Gepland · date"; "Annuleer planning" returns it to "Concept".

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app
git commit -m "feat(web): compose messages with audience, rich text, drafts and scheduling

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: End-to-end test

**Files:**
- Create: `e2e/tests/admin/messages-draft.spec.ts`

**Interfaces:**
- Consumes: the admin login helper the existing admin specs use (`ls e2e/tests/admin/` and open the shortest one; it imports a fixture from `e2e/fixtures/` or logs in inline with the seeded admin credentials from `e2e/README.md` or `packages/database/prisma/seed.ts`).

- [ ] **Step 1: Write the test**

`e2e/tests/admin/messages-draft.spec.ts` (replace the `loginAsAdmin` import with whatever the neighbouring spec uses; the rest is exact):

```ts
import { test, expect } from '@playwright/test';
import { loginAsAdmin } from '../../fixtures/auth';

test.describe('admin messages: draft → send', () => {
  test('saves a draft, shows it on top, sends it after confirmation', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/nl/dashboard/admin/messages/new');

    await page.getByLabel('Alle actieve aandeelhouders').check();
    await expect(page.getByTestId('recipient-count')).not.toHaveText('', { timeout: 10_000 });
    await expect(page.getByTestId('recipient-count')).not.toContainText('Geen ontvangers');

    const subject = `E2E concept ${Date.now()}`;
    await page.getByLabel('Onderwerp').fill(subject);
    await page.locator('.message-html[contenteditable="true"]').fill('Dit is een testbericht.');

    await page.getByRole('button', { name: 'Bewaar als concept' }).click();
    await expect(page).toHaveURL(/\/dashboard\/admin\/messages\/[a-z0-9]+$/);
    await expect(page.getByRole('button', { name: 'Verstuur nu' })).toBeVisible();

    await page.goto('/nl/dashboard/admin/messages');
    const firstRow = page.locator('table tbody tr').first();
    await expect(firstRow).toContainText(subject);
    await expect(firstRow).toContainText('Concept');

    await firstRow.getByRole('link', { name: subject }).click();
    await page.getByRole('button', { name: 'Verstuur nu' }).click();
    await expect(page.getByRole('dialog')).toContainText('Bericht versturen?');
    await page.getByRole('dialog').getByRole('button', { name: 'Verstuur nu' }).click();

    await expect(page.getByRole('button', { name: 'Verstuur nu' })).toHaveCount(0);
    await page.goto('/nl/dashboard/admin/messages');
    await expect(page.locator('table tbody tr', { hasText: subject })).toContainText('Verzonden');
  });
});
```

- [ ] **Step 2: Run it**

```bash
pnpm test:e2e -- tests/admin/messages-draft.spec.ts
```

Expected: PASS against the local stack (`pnpm test:e2e:setup` first if the e2e README requires seeding). If the seeded coop has `emailEnabled = false`, the test still passes: sending marks the conversation SENT without queueing e-mail.

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/admin/messages-draft.spec.ts
git commit -m "test(e2e): admin saves a message draft and sends it

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Changelog, migration check on acc, PR

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Changelog entry**

Read the first dated entry in `CHANGELOG.md` (`sed -n 12,40p CHANGELOG.md`) and add a new entry above it in the same format, dated today, under the next tag per the file's scheme (`date +v%G.%V.` plus the next micro number), with:

```markdown
### Added
- Messages: save as draft, edit and delete drafts, schedule sending (minute cron), audience of all shareholders / one project / selected shareholders, rich-text body (TipTap) sanitised on the server, full message text in the notification e-mail.
- MCP: `create_message_draft`, `update_message_draft`, `get_message_draft` — draft-only tools for API keys; sending stays in the admin UI.

### Changed
- Message notification e-mail carries the full body instead of a 150-character preview.
- Admin "Direct" messages are now a "Geselecteerde aandeelhouders" audience of one.
```

- [ ] **Step 2: Migration dry run against a copy of acc**

Per `docs/OPERATIONS.md`, restore the latest acc dump locally (the doc has the `pg_restore` line) and run:

```bash
DATABASE_URL=<local copy url> pnpm --filter @opencoop/database exec prisma migrate deploy
DATABASE_URL=<local copy url> pnpm --filter @opencoop/database exec prisma db execute --stdin <<'SQL'
SELECT "status", "audienceType", count(*) FROM "conversations" GROUP BY 1,2;
SELECT count(*) FROM "conversations" c WHERE c."type"='DIRECT' AND cardinality(c."audienceShareholderIds") <> (SELECT count(*) FROM "conversation_participants" p WHERE p."conversationId"=c."id");
SQL
```

Expected: all rows `SENT`; the second query returns `0`.

- [ ] **Step 3: Full test run, push, PR**

```bash
pnpm --filter @opencoop/api test
pnpm --filter @opencoop/web lint && pnpm --filter @opencoop/web build
git add CHANGELOG.md
git commit -m "docs: changelog for message drafts, audiences, rich text and scheduling

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push -u origin feat/message-drafts-audience
gh pr create --base main --title "Messages: drafts, audiences, rich text, scheduling, MCP draft tools" --body-file docs/superpowers/specs/2026-09-10-message-drafts-audience-design.md
```

Append to the PR body:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Merging to `main` deploys acc. Rollout per spec §12: create the Northwind draft on acc with `create_message_draft`, review in the admin UI, send to a test coop; then tag for prod.
