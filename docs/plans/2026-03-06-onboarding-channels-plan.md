# Onboarding Channels Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add branded "Channels" to coops so each coop can have multiple branded entry points for share registration (e.g., "Onze Energie" alongside the coop's own branding).

**Architecture:** Channel is a new Prisma model that replaces coop-level branding fields. Every coop has at least one default channel. Public pages gain a `/{channelSlug}/` URL segment. Channels filter which share classes and projects are visible.

**Tech Stack:** Prisma (schema + migration), NestJS (module/service/controller/DTOs), Next.js App Router (pages + components), next-intl (translations in 4 languages)

---

## Task 1: Database Schema — Add Channel Model

**Files:**
- Modify: `packages/database/prisma/schema.prisma`

**Step 1: Add Channel model and join tables after the Coop model (after line 176)**

```prisma
model Channel {
  id             String   @id @default(cuid())
  coopId         String
  slug           String   // unique per coop, e.g., "default", "onze-energie"
  name           String   // display name
  description    String?  // welcome text / custom copy
  logoUrl        String?
  primaryColor   String   @default("#1e40af")
  secondaryColor String   @default("#3b82f6")
  termsUrl       String?
  isDefault      Boolean  @default(false)
  active         Boolean  @default(true)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  coop         Coop                @relation(fields: [coopId], references: [id], onDelete: Cascade)
  shareClasses ChannelShareClass[]
  projects     ChannelProject[]
  transactions Transaction[]
  shareholders Shareholder[]

  @@unique([coopId, slug])
  @@map("channels")
}

model ChannelShareClass {
  channelId    String
  shareClassId String

  channel    Channel    @relation(fields: [channelId], references: [id], onDelete: Cascade)
  shareClass ShareClass @relation(fields: [shareClassId], references: [id], onDelete: Cascade)

  @@id([channelId, shareClassId])
  @@map("channel_share_classes")
}

model ChannelProject {
  channelId String
  projectId String

  channel Channel @relation(fields: [channelId], references: [id], onDelete: Cascade)
  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@id([channelId, projectId])
  @@map("channel_projects")
}
```

**Step 2: Add relations to existing models**

Add to `Coop` model (around line 158, in relations section):
```prisma
  channels         Channel[]
```

Add to `ShareClass` model (around line 424, after `shares` relation):
```prisma
  channels ChannelShareClass[]
```

Add to `Project` model (around line 451, after `shares` relation):
```prisma
  channels ChannelProject[]
```

Add to `Transaction` model (after line 507, in the fields section):
```prisma
  channelId         String?
```
And in relations (after `processedBy` relation):
```prisma
  channel         Channel? @relation(fields: [channelId], references: [id], onDelete: SetNull)
```

Add to `Shareholder` model (after line 338, near `registeredByUserId`):
```prisma
  channelId          String?
```
And in relations (after `registeredBy` relation):
```prisma
  channel         Channel? @relation(fields: [channelId], references: [id], onDelete: SetNull)
```

**Step 3: Remove branding fields from Coop model**

Remove these lines from the Coop model (lines 124-127, 156):
```prisma
  // Branding          ← remove this comment
  logoUrl        String?         ← remove
  primaryColor   String  @default("#1e40af")  ← remove
  secondaryColor String  @default("#3b82f6")  ← remove
  ...
  termsUrl    String?  // URL to terms and conditions page  ← remove
```

**Step 4: Generate Prisma client and create migration**

```bash
cd packages/database
npx prisma migrate dev --name add_channels --create-only
```

**Step 5: Edit the generated migration SQL to include data migration**

Add this SQL AFTER the CREATE TABLE statements but BEFORE the ALTER TABLE that drops columns from `coops`:

```sql
-- Migrate existing coop branding into default channels
INSERT INTO "channels" ("id", "coopId", "slug", "name", "description", "logoUrl", "primaryColor", "secondaryColor", "termsUrl", "isDefault", "active", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  "id",
  'default',
  "name",
  NULL,
  "logoUrl",
  "primaryColor",
  "secondaryColor",
  "termsUrl",
  true,
  true,
  NOW(),
  NOW()
FROM "coops";

-- Link all active share classes to their coop's default channel
INSERT INTO "channel_share_classes" ("channelId", "shareClassId")
SELECT c."id", sc."id"
FROM "channels" c
JOIN "share_classes" sc ON sc."coopId" = c."coopId"
WHERE c."isDefault" = true;

-- Link all active projects to their coop's default channel
INSERT INTO "channel_projects" ("channelId", "projectId")
SELECT c."id", p."id"
FROM "channels" c
JOIN "projects" p ON p."coopId" = c."coopId"
WHERE c."isDefault" = true;
```

Note: Prisma uses `cuid()` for IDs but `gen_random_uuid()::text` works fine as a unique string. Alternatively use `concat('ch_', gen_random_uuid())`.

**Step 6: Run the migration**

```bash
npx prisma migrate dev
```

**Step 7: Regenerate Prisma client**

```bash
pnpm db:generate
```

**Step 8: Commit**

```bash
git add packages/database/
git commit -m "feat: add Channel model with data migration from coop branding"
```

---

## Task 2: Channels Service — Backend CRUD

**Files:**
- Create: `apps/api/src/modules/channels/channels.service.ts`
- Create: `apps/api/src/modules/channels/channels.module.ts`
- Create: `apps/api/src/modules/channels/dto/create-channel.dto.ts`
- Create: `apps/api/src/modules/channels/dto/update-channel.dto.ts`

**Step 1: Create DTOs**

`create-channel.dto.ts`:
```typescript
import { IsString, IsOptional, IsBoolean, Matches, MinLength, MaxLength, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateChannelDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  primaryColor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  secondaryColor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  termsUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  shareClassIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  projectIds?: string[];
}
```

`update-channel.dto.ts`:
```typescript
import { PartialType } from '@nestjs/swagger';
import { IsOptional, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CreateChannelDto } from './create-channel.dto';

export class UpdateChannelDto extends PartialType(CreateChannelDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
```

**Step 2: Create ChannelsService**

`channels.service.ts` — full CRUD with:
- `findAll(coopId)` — list all channels for a coop
- `findById(id, coopId)` — get single channel
- `getPublicInfo(coopSlug, channelSlug)` — public endpoint: channel branding + filtered share classes/projects (mirrors existing `CoopsService.getPublicInfo` but channel-scoped)
- `create(coopId, dto)` — create channel, link share classes/projects
- `update(id, coopId, dto)` — update channel (cannot change isDefault)
- `delete(id, coopId)` — delete channel (cannot delete default)
- `uploadLogo(id, coopId, file)` — same pattern as `CoopsService.uploadLogo` but stores as `{channelId}.webp`
- `removeLogo(id, coopId)` — remove logo file and set null
- `publicRegister(coopSlug, channelSlug, dto)` — register with channelId tracking

Key pattern for `getPublicInfo`:
```typescript
async getPublicInfo(coopSlug: string, channelSlug: string) {
  const coop = await this.prisma.coop.findUnique({
    where: { slug: coopSlug },
    select: { id: true, slug: true, bankName: true, bankIban: true, bankBic: true },
  });
  if (!coop) throw new NotFoundException('Cooperative not found');

  const channel = await this.prisma.channel.findUnique({
    where: { coopId_slug: { coopId: coop.id, slug: channelSlug } },
    include: {
      shareClasses: {
        include: {
          shareClass: {
            select: { id: true, name: true, code: true, pricePerShare: true, minShares: true, maxShares: true, hasVotingRights: true, isActive: true },
          },
        },
      },
      projects: {
        include: {
          project: {
            select: { id: true, name: true, description: true, targetShares: true, isActive: true },
          },
        },
      },
    },
  });
  if (!channel || !channel.active) throw new NotFoundException('Channel not found');

  return {
    id: coop.id,
    slug: coop.slug,
    name: channel.name,
    description: channel.description,
    logoUrl: channel.logoUrl,
    primaryColor: channel.primaryColor,
    secondaryColor: channel.secondaryColor,
    termsUrl: channel.termsUrl,
    bankName: coop.bankName,
    bankIban: coop.bankIban,
    bankBic: coop.bankBic,
    channelId: channel.id,
    channelSlug: channel.slug,
    shareClasses: channel.shareClasses
      .map((cs) => cs.shareClass)
      .filter((sc) => sc.isActive)
      .sort((a, b) => a.code.localeCompare(b.code)),
    projects: channel.projects
      .map((cp) => cp.project)
      .filter((p) => p.isActive)
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}
```

**Step 3: Create ChannelsModule**

```typescript
import { Module } from '@nestjs/common';
import { ChannelsService } from './channels.service';

@Module({
  providers: [ChannelsService],
  exports: [ChannelsService],
})
export class ChannelsModule {}
```

**Step 4: Commit**

```bash
git add apps/api/src/modules/channels/
git commit -m "feat: add ChannelsService with CRUD, logo upload, and public info"
```

---

## Task 3: Channels Controller — Public + Admin Endpoints

**Files:**
- Create: `apps/api/src/modules/channels/channels.controller.ts`
- Modify: `apps/api/src/modules/coops/coops.controller.ts` — update public register route
- Modify: `apps/api/src/modules/admin/admin.controller.ts` — add channel admin endpoints
- Modify: `apps/api/src/modules/admin/admin.module.ts` — import ChannelsModule
- Modify: `apps/api/src/modules/coops/coops.module.ts` — import ChannelsModule

**Step 1: Create public channels controller**

`channels.controller.ts`:
```typescript
@ApiTags('channels')
@Controller('coops/:slug/channels')
export class ChannelsController {
  constructor(private readonly channelsService: ChannelsService) {}

  @Public()
  @Get(':channelSlug/public-info')
  async getPublicInfo(@Param('slug') slug: string, @Param('channelSlug') channelSlug: string) {
    return this.channelsService.getPublicInfo(slug, channelSlug);
  }

  @Public()
  @Post(':channelSlug/register')
  async register(
    @Param('slug') slug: string,
    @Param('channelSlug') channelSlug: string,
    @Body() dto: PublicRegisterDto,
  ) {
    return this.channelsService.publicRegister(slug, channelSlug, dto);
  }
}
```

**Step 2: Add admin channel endpoints to AdminController**

Add after the branding section (around line 133) in `admin.controller.ts`:
```typescript
// ==================== CHANNELS ====================

@Get('channels')
@RequirePermission('canManageSettings')
@ApiOperation({ summary: 'List all channels' })
async getChannels(@Param('coopId') coopId: string) {
  return this.channelsService.findAll(coopId);
}

@Post('channels')
@RequirePermission('canManageSettings')
@ApiOperation({ summary: 'Create a channel' })
async createChannel(
  @Param('coopId') coopId: string,
  @CurrentUser() user: CurrentUserData,
  @Body() dto: CreateChannelDto,
) {
  return this.channelsService.create(coopId, dto, user.id);
}

@Put('channels/:channelId')
@RequirePermission('canManageSettings')
@ApiOperation({ summary: 'Update a channel' })
async updateChannel(
  @Param('coopId') coopId: string,
  @Param('channelId') channelId: string,
  @CurrentUser() user: CurrentUserData,
  @Body() dto: UpdateChannelDto,
) {
  return this.channelsService.update(channelId, coopId, dto, user.id);
}

@Delete('channels/:channelId')
@RequirePermission('canManageSettings')
@ApiOperation({ summary: 'Delete a channel (not the default)' })
async deleteChannel(
  @Param('coopId') coopId: string,
  @Param('channelId') channelId: string,
) {
  return this.channelsService.delete(channelId, coopId);
}

@Post('channels/:channelId/logo')
@RequirePermission('canManageSettings')
@ApiOperation({ summary: 'Upload channel logo' })
@ApiConsumes('multipart/form-data')
@UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
async uploadChannelLogo(
  @Param('coopId') coopId: string,
  @Param('channelId') channelId: string,
  @UploadedFile() file: Express.Multer.File,
) {
  return this.channelsService.uploadLogo(channelId, coopId, file);
}

@Delete('channels/:channelId/logo')
@RequirePermission('canManageSettings')
@ApiOperation({ summary: 'Remove channel logo' })
async removeChannelLogo(
  @Param('coopId') coopId: string,
  @Param('channelId') channelId: string,
) {
  await this.channelsService.removeLogo(channelId, coopId);
  return { success: true };
}
```

**Step 3: Update modules**

Add `ChannelsModule` to imports in `admin.module.ts` and `coops.module.ts`. Add `ChannelsController` to `ChannelsModule`.

**Step 4: Keep old `CoopsController` public-info endpoint working** (backward compat)

The existing `GET /coops/:slug/public-info` should still work — it can delegate to the default channel. Update `CoopsService.getPublicInfo` to query the default channel instead of coop fields.

**Step 5: Remove old branding endpoints from AdminController**

Remove or redirect `PUT branding`, `POST logo`, `DELETE logo` to the default channel. Simplest approach: keep them working by delegating to the default channel internally.

**Step 6: Update onboarding to create default channel**

Modify `apps/api/src/modules/auth/auth.service.ts` around line 192 (inside the `$transaction`). After creating the coop, create its default channel:

```typescript
await tx.channel.create({
  data: {
    coopId: coop.id,
    slug: 'default',
    name: onboardingDto.coopName,
    isDefault: true,
  },
});
```

**Step 7: Commit**

```bash
git add apps/api/
git commit -m "feat: add channel endpoints (public + admin) and update onboarding"
```

---

## Task 4: Update CoopsService — Delegate Branding to Default Channel

**Files:**
- Modify: `apps/api/src/modules/coops/coops.service.ts`

**Step 1: Update `getPublicInfo` to query default channel**

Replace the current `getPublicInfo` (lines 109-154) to query the default channel for branding while keeping the same response shape for backward compatibility:

```typescript
async getPublicInfo(slug: string) {
  const coop = await this.prisma.coop.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true, bankName: true, bankIban: true, bankBic: true },
  });
  if (!coop) throw new NotFoundException('Cooperative not found');

  const channel = await this.prisma.channel.findFirst({
    where: { coopId: coop.id, isDefault: true },
  });

  // Return same shape as before for backward compat
  return {
    id: coop.id,
    slug: coop.slug,
    name: coop.name,
    logoUrl: channel?.logoUrl ?? null,
    primaryColor: channel?.primaryColor ?? '#1e40af',
    secondaryColor: channel?.secondaryColor ?? '#3b82f6',
    bankName: coop.bankName,
    bankIban: coop.bankIban,
    bankBic: coop.bankBic,
    termsUrl: channel?.termsUrl ?? null,
    shareClasses: /* query active share classes for this coop */,
    projects: /* query active projects for this coop */,
  };
}
```

**Step 2: Update `updateBranding` to update default channel**

**Step 3: Update `uploadLogo` / `removeLogo` to target default channel**

**Step 4: Update `findAll` (system admin coop list) to read branding from default channel**

**Step 5: Commit**

```bash
git add apps/api/src/modules/coops/
git commit -m "refactor: delegate coop branding reads/writes to default channel"
```

---

## Task 5: Frontend — Channel-Aware Public Pages

**Files:**
- Create: `apps/web/src/app/[locale]/[coopSlug]/[channelSlug]/page.tsx`
- Create: `apps/web/src/app/[locale]/[coopSlug]/[channelSlug]/register/page.tsx`
- Create: `apps/web/src/app/[locale]/[coopSlug]/[channelSlug]/login/page.tsx`
- Create: `apps/web/src/app/[locale]/[coopSlug]/[channelSlug]/claim/page.tsx`
- Modify: `apps/web/src/app/[locale]/[coopSlug]/page.tsx` — redirect to default channel
- Modify: `apps/web/src/app/[locale]/[coopSlug]/register/page.tsx` — redirect
- Modify: `apps/web/src/app/[locale]/[coopSlug]/login/page.tsx` — redirect
- Modify: `apps/web/src/app/[locale]/[coopSlug]/claim/page.tsx` — redirect
- Modify: `apps/web/src/components/coop-register-content.tsx` — accept channelSlug prop, fetch from channel endpoint

**Step 1: Create channelSlug-aware pages**

Each new `[channelSlug]/` page is essentially the current `[coopSlug]/` page but:
- Reads `channelSlug` from `useParams()`
- Fetches from `/coops/${coopSlug}/channels/${channelSlug}/public-info` instead of `/coops/${coopSlug}/public-info`
- Links within the page include the channelSlug segment

**Step 2: Convert existing pages to redirects**

Each old page becomes a simple redirect:
```typescript
import { redirect } from 'next/navigation';

export default function CoopPage({ params }: { params: { locale: string; coopSlug: string } }) {
  redirect(`/${params.locale}/${params.coopSlug}/default`);
}
```

Same for `/register`, `/login`, `/claim`.

**Step 3: Update `coop-register-content.tsx`**

- Add `channelSlug` prop alongside existing `coopSlug`
- Change API call from `/coops/${coopSlug}/public-info` to `/coops/${coopSlug}/channels/${channelSlug}/public-info`
- Pass `channelId` (from public-info response) in the register POST body
- Update form submit URL to `/coops/${coopSlug}/channels/${channelSlug}/register`

**Step 4: Commit**

```bash
git add apps/web/
git commit -m "feat: add channel-aware public pages with backward-compat redirects"
```

---

## Task 6: Frontend — Channel Management UI in Dashboard Settings

**Files:**
- Create: `apps/web/src/app/[locale]/dashboard/admin/settings/channels/page.tsx`
- Modify: `apps/web/src/app/[locale]/dashboard/admin/settings/page.tsx` — move branding to channel management
- Modify: `apps/web/src/app/[locale]/dashboard/layout.tsx` — add channels sub-nav under settings

**Step 1: Create channel management page**

`channels/page.tsx` — a full CRUD page:
- List channels as cards (name, slug, color preview, logo thumbnail, active badge, default badge)
- "Add Channel" button opens create form
- Edit channel: name, slug, description, colors, logo (with crop dialog), terms URL
- Multi-select for share classes and projects (checkboxes)
- Delete button (disabled for default channel)
- Copy-to-clipboard for public registration URL per channel

Reuse the existing logo upload + crop dialog pattern from admin settings page.

**Step 2: Update settings page**

Remove the branding section (logo + colors cards) from the main settings page — it now lives in the channel management page. Keep general settings (name, approval, bank, email) on the main settings page.

Update the shareholder links section to show links per channel (or just the default channel).

**Step 3: Add navigation**

In `dashboard/layout.tsx`, the admin nav (around line 146-160) — add a "Channels" link under settings or as a sub-item. Since channels are in settings, could be a dedicated nav item:
```typescript
{ href: `/dashboard/admin/settings/channels`, icon: Layers, label: t('admin.channels.title'), permission: 'canManageSettings' },
```

Or keep it as a tab/link within the settings page. Given the user said "in settings", a sub-page approach works best.

**Step 4: Commit**

```bash
git add apps/web/
git commit -m "feat: add channel management UI in dashboard settings"
```

---

## Task 7: Translations — All 4 Languages

**Files:**
- Modify: `apps/web/messages/en.json`
- Modify: `apps/web/messages/nl.json`
- Modify: `apps/web/messages/fr.json`
- Modify: `apps/web/messages/de.json`

**Step 1: Add translation keys**

Add under `admin`:
```json
{
  "admin": {
    "channels": {
      "title": "Channels",
      "description": "Manage branded entry points for share registration",
      "addChannel": "Add Channel",
      "editChannel": "Edit Channel",
      "name": "Channel Name",
      "slug": "URL Slug",
      "slugHelp": "Lowercase letters, numbers, and dashes only",
      "welcomeText": "Welcome Text",
      "welcomeTextHelp": "Custom description shown on the registration page",
      "termsUrl": "Terms & Conditions URL",
      "shareClasses": "Share Classes",
      "shareClassesHelp": "Select which share classes are available through this channel",
      "projects": "Projects",
      "projectsHelp": "Select which projects are available through this channel",
      "default": "Default",
      "active": "Active",
      "inactive": "Inactive",
      "registrationUrl": "Registration URL",
      "copied": "Copied!",
      "cannotDeleteDefault": "The default channel cannot be deleted",
      "deleteConfirm": "Are you sure you want to delete this channel?",
      "created": "Channel created successfully",
      "updated": "Channel updated successfully",
      "deleted": "Channel deleted successfully"
    }
  }
}
```

Translate for nl, fr, de.

**Step 2: Commit**

```bash
git add apps/web/messages/
git commit -m "feat: add channel management translations (en, nl, fr, de)"
```

---

## Task 8: Auto-Link New Share Classes / Projects to Default Channel

**Files:**
- Modify: `apps/api/src/modules/shares/share-classes.service.ts` — after creating a share class, link it to all channels (or at least the default)
- Modify: `apps/api/src/modules/projects/projects.service.ts` — same for projects

**Step 1: When a new share class is created, auto-link to default channel**

In `ShareClassesService.create()`, after the share class is created:
```typescript
const defaultChannel = await this.prisma.channel.findFirst({
  where: { coopId, isDefault: true },
});
if (defaultChannel) {
  await this.prisma.channelShareClass.create({
    data: { channelId: defaultChannel.id, shareClassId: newShareClass.id },
  });
}
```

**Step 2: Same for ProjectsService.create()**

**Step 3: Commit**

```bash
git add apps/api/src/modules/shares/ apps/api/src/modules/projects/
git commit -m "feat: auto-link new share classes and projects to default channel"
```

---

## Task 9: Build + Test + Fix

**Step 1: Run full build**
```bash
pnpm build
```

**Step 2: Fix any TypeScript errors** (likely from removed coop branding fields)

Common places that may reference removed coop fields:
- `apps/api/src/modules/coops/coops.service.ts` (findAll, getSettings)
- `apps/api/src/modules/admin/admin.controller.ts` (branding endpoints)
- `apps/web/src/app/[locale]/dashboard/admin/settings/page.tsx`
- `apps/web/src/app/[locale]/[coopSlug]/page.tsx`
- `apps/web/src/components/coop-register-content.tsx`
- `apps/api/src/modules/mcp/mcp.service.ts` (if it reads coop branding)
- `packages/database/prisma/seed-demo.ts`

**Step 3: Run API tests**
```bash
cd apps/api && pnpm test
```

**Step 4: Commit fixes**
```bash
git add -A
git commit -m "fix: resolve build errors from branding migration to channels"
```

---

## Task 10: Update Demo Seed

**Files:**
- Modify: `packages/database/prisma/seed-demo.ts`

**Step 1: Update seed to create default channel for demo coop**

After creating the demo coop, create its default channel with the coop's branding, and link all share classes/projects.

**Step 2: Commit**

```bash
git add packages/database/
git commit -m "fix: update demo seed to create default channel"
```

---

## Deployment Sequence

After all tasks are implemented and building cleanly:

1. Push branch, create PR, review
2. Merge to main → auto-deploys to acc.opencoop.be
3. Verify on acc: onboarding creates default channel, existing coops have channels, public pages work
4. Tag for prod: `git tag -a v0.1.75 -m "feat: onboarding channels"` (check current version first)
5. Push tag → deploys to prod
6. Verify on prod: migration ran, existing coops have default channels, public URLs work
