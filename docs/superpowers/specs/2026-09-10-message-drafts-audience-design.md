# Messages: drafts, audiences, rich text, scheduling — design

**Date:** 2026-09-10
**Status:** approved in chat, awaiting spec review
**Scope:** `apps/api` (messages, email, mcp), `apps/web` (admin messages, inbox), `packages/database`

## Goal

Let a coop admin (or an agent on the admin's behalf) prepare a message to a chosen
group of shareholders, review it, and send it now or at a set time. Every recipient
gets their own e-mail with the full text. No recipient sees who else received it.

Trigger: Bronsgroen must write to the 62 shareholders who chose the Northwind project.
Today the messaging module can only address everyone or one person, cannot hold a
draft, and the e-mail carries a 150-character preview plus a login link.

## Non-goals

- A filter builder (share class, register date, city, ...). Audience is all, one
  project, or a hand-picked set.
- Merge fields inside the body beyond the greeting.
- Rich text for shareholder replies. Replies stay plain text.
- Scheduling from the MCP tools. An agent prepares; a human sends or schedules.
- Attachments through the MCP tools. Attachments keep working through the admin UI.

## 1. Data model (`packages/database/prisma/schema.prisma`)

```prisma
enum ConversationStatus { DRAFT  SCHEDULED  SENT }
enum AudienceType       { ALL  PROJECT  SELECTED }
enum MessageFormat      { TEXT  HTML }

model Conversation {
  // existing fields unchanged: id, coopId, subject, type, createdAt, updatedAt, createdById
  status                 ConversationStatus @default(SENT)
  scheduledAt            DateTime?
  sentAt                 DateTime?
  audienceType           AudienceType       @default(ALL)
  audienceProjectId      String?
  audienceShareholderIds String[]           @default([])
  createdByApiKeyId      String?            // set when an MCP tool created the draft

  audienceProject Project? @relation(fields: [audienceProjectId], references: [id], onDelete: SetNull)
  createdByApiKey ApiKey?  @relation(fields: [createdByApiKeyId], references: [id], onDelete: SetNull)

  @@index([coopId, status])
  @@index([status, scheduledAt])
}

model Message {
  // existing fields unchanged
  format MessageFormat @default(TEXT)
}
```

Rules:

- `ConversationType` stays. `DIRECT` conversations (shareholder-initiated or one-to-one)
  keep working unchanged and are always `SENT`. Audience fields apply to `BROADCAST`.
- Participants (`ConversationParticipant`) are created **only at send time**. A draft or
  scheduled conversation has no participants, so `findAllForShareholder` never returns
  it. This is the existing invariant; the design leans on it instead of adding a filter.
- Migration: every existing conversation gets `status = SENT`, `sentAt = createdAt`,
  `audienceType = ALL` for `BROADCAST` and `SELECTED` (with the single participant id)
  for `DIRECT`. Every existing message gets `format = TEXT`.

## 2. State machine

```
DRAFT ──send──▶ SENT
DRAFT ──schedule(at)──▶ SCHEDULED ──cron, at ≤ now──▶ SENT
SCHEDULED ──cancel──▶ DRAFT
```

- Edit (subject, body, audience) and delete are allowed in `DRAFT` only.
- `SCHEDULED` is read-only except `cancel`. `scheduledAt` must be in the future at the
  moment of scheduling.
- `SENT` is immutable. Send on a non-draft, or a second send, returns `409 Conflict`.
- Send with a resolved audience of zero recipients returns `400` with
  `{ code: 'EMPTY_AUDIENCE' }`. The UI disables the button in that case.

## 3. Audience resolution (`apps/api/src/modules/messages/audience.service.ts`)

One pure function `resolveAudience(coopId, audience) → { shareholderIds: string[] }`,
used by the preview count, the send path and the scheduler. Rules:

| type | recipients |
|---|---|
| `ALL` | shareholders of the coop with `status = ACTIVE` |
| `PROJECT` | distinct shareholders with a `Registration` on `audienceProjectId` where `type = BUY` and `status in (ACTIVE, COMPLETED)`, and shareholder `status = ACTIVE`. Same rule as `ReportsService.getShareholdersPerProject`. |
| `SELECTED` | the given ids, filtered to shareholders of this coop with `status = ACTIVE`; unknown ids are dropped silently |

A project outside the coop is a `404`. The function never sends anything.

Endpoint for the live count: `POST admin/coops/:coopId/conversations/audience-preview`
with the audience body, returns `{ count }`.

## 4. API (`apps/api/src/modules/admin/admin.controller.ts`, base `admin/coops/:coopId`)

All routes keep `@RequirePermission('canManageMessages')`.

| method | path | notes |
|---|---|---|
| `POST` | `conversations` | body gains `status?: 'DRAFT' \| 'SENT'` (default `SENT`, backward compatible), `audience: { type, projectId?, shareholderIds? }` for `BROADCAST`, `format?: 'TEXT' \| 'HTML'` (default `HTML` for admin messages). `SENT` runs the send path immediately, as today. |
| `PATCH` | `conversations/:id` | draft only: subject, body, audience |
| `DELETE` | `conversations/:id` | draft only |
| `POST` | `conversations/:id/send` | draft only. Runs the send path. |
| `POST` | `conversations/:id/schedule` | draft only, body `{ scheduledAt }` in the future |
| `POST` | `conversations/:id/cancel-schedule` | scheduled only, back to draft |
| `POST` | `conversations/audience-preview` | returns `{ count }` |
| `GET` | `conversations` | gains `status`, `scheduledAt`, `sentAt`, `audienceType`, `recipientCount` (participants for sent, resolved count for draft/scheduled) |

The send path (`MessagesService.send(conversationId, actor)`) in one transaction:
resolve audience → create participants → `status = SENT`, `sentAt = now()` → commit.
Then queue notifications and write the audit log. The transaction guards on
`status in (DRAFT, SCHEDULED)` with `updateMany` and checks the affected row count, so
two concurrent sends cannot both succeed.

`DTO` changes live in `apps/api/src/modules/messages/dto/`. `class-validator` on every
new field, as the existing DTOs do.

## 5. Rich text

- Admin messages are stored as sanitised HTML, `format = HTML`.
- Sanitiser: `sanitize-html` in the API, allowlist `p, br, strong, em, u, s, h2, h3,
  ul, ol, li, a[href], blockquote`. `a` gets `rel="noopener noreferrer"` and only
  `http`, `https`, `mailto` schemes. Applied on every write (create, patch, MCP).
  Nothing else in the body survives, so the inbox and the e-mail can render it as-is.
- Editor: TipTap (`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-link`) in
  the admin new-message and draft pages. Toolbar: bold, italic, heading, bullet list,
  numbered list, link.
- Inbox (`apps/web/src/app/[locale]/dashboard/inbox/[conversationId]/page.tsx`): render
  `format = HTML` with a small `prose` container; `TEXT` keeps `whitespace-pre-wrap`.
- MCP tools accept Markdown. The API converts with `marked` and then sanitises with the
  same allowlist. Markdown is the input format, HTML is the stored format.

## 6. E-mail (`apps/api/src/modules/email/email.processor.ts`, template `message-notification`)

- `templateData` gains `messageBody` (sanitised HTML, or escaped text wrapped in `<p>`
  for `TEXT`) and drops `messagePreview`.
- Layout: greeting `Beste {firstName},` (existing copy per language in `email-copy.ts`),
  then the body, then a short line with the inbox link ("Antwoorden kan via uw inbox")
  and the attachment hint when the message has attachments.
- One e-mail per participant, as today. That is what keeps recipients hidden from each
  other. Shareholders without a resolvable e-mail are skipped, as today, and counted in
  the audit log.
- Update the render snapshot test in `email.processor.render.spec.ts`.

## 7. Scheduling (`apps/api/src/modules/messages/messages.scheduler.ts`)

- `@Cron('* * * * *')` (every minute, `Europe/Brussels` irrelevant, `scheduledAt` is UTC).
- Query `status = SCHEDULED AND scheduledAt <= now()`, ordered by `scheduledAt`, then
  call `MessagesService.send` for each. `send` is idempotent through the guarded
  `updateMany`, so an overlapping run or a restart mid-batch cannot double-send.
- Failures log with the conversation id and leave the row `SCHEDULED`; the next minute
  retries. After three failures on the same row, it flips back to `DRAFT` and the
  admins get the existing `admin-message-notification` e-mail with the error.
- Actor in the audit log: the user who scheduled it.

## 8. Admin UI (`apps/web/src/app/[locale]/dashboard/admin/messages/`)

- `new/page.tsx`: audience picker replaces the BROADCAST/DIRECT radio: **Iedereen**,
  **Project** (dropdown of the coop's projects), **Geselecteerde aandeelhouders**
  (searchable multi-select, reuse the shareholder search endpoint the DIRECT select
  uses). Live count from `audience-preview`, debounced. Editor from §5. Buttons:
  **Bewaar als concept**, **Plan verzending** (datetime picker, min = now + 5 min),
  **Verstuur nu** (confirm dialog: count, subject, rendered preview).
- `page.tsx` (list): status badge (Concept, Gepland `dd/MM HH:mm`, Verzonden),
  drafts and scheduled on top, then sent by date.
- `[conversationId]/page.tsx`: for `DRAFT` the same form in edit mode plus delete;
  for `SCHEDULED` a read-only view with **Annuleer planning**; for `SENT` as today.
- i18n keys in `apps/web/messages/{nl,fr,de,en}.json`. Dutch is the source; the other
  three get translations in the same PR (existing `translate` tooling if present).
- "Direct" one-to-one messages from the admin become `SELECTED` with one shareholder.
  The separate DIRECT radio disappears from the UI; the enum stays for data.

## 9. MCP tools (`apps/api/src/modules/mcp/tools/`)

Three new tools, authenticated with the existing `oc_…` API key:

| tool | input | effect |
|---|---|---|
| `create_message_draft` | `coopSlug, subject, bodyMarkdown, audience` | creates `BROADCAST` conversation with `status = DRAFT`, `createdById = key.userId`, `createdByApiKeyId = key.id`; returns id, recipient count, rendered HTML |
| `update_message_draft` | `conversationId, subject?, bodyMarkdown?, audience?` | draft only |
| `get_message_draft` | `conversationId` | status, subject, HTML, audience, recipient count, `adminUrl` |

Guarantees enforced server-side:

- The tools can only create or modify rows whose status is `DRAFT`. No tool can set
  `SENT` or `SCHEDULED`, create participants, or queue e-mail.
- The key's user must hold `canManageMessages` on the coop at call time. Checked with
  the same permission JSON the guard uses; a system admin key passes.
- Audit log entry with `actorId = key.userId` and `metadata.apiKeyId`.

## 10. Errors and edge cases

- Coop with `emailEnabled = false`: send still creates participants and marks `SENT`
  (in-app delivery), queues nothing, and the confirm dialog warns beforehand.
- Shareholder deleted between draft and send: dropped by resolution.
- Project deleted: `audienceProjectId` becomes null, resolution returns `EMPTY_AUDIENCE`.
- Body over 100 kB after sanitising: `400`.
- Scheduling in the past or less than 1 minute ahead: `400`.

## 11. Testing

- `apps/api` (Jest, existing setup):
  - `audience.service.spec.ts`: the three audience types, inactive shareholder excluded,
    registration status filter, project of another coop → 404.
  - `messages.service.spec.ts`: state machine transitions, 409 on double send,
    concurrency guard (two sends, one wins), `EMPTY_AUDIENCE`, participants created only
    on send, e-mail queued once per participant, sanitiser applied on create/patch.
  - `messages.scheduler.spec.ts`: due rows sent, future rows untouched, failure retry
    and flip to draft after three.
  - `sanitize.spec.ts`: script, style, on* attributes, javascript: links stripped;
    allowlist kept.
  - `mcp` tool specs: draft created, cannot send, permission denied without
    `canManageMessages`, audit entry.
  - Update `email.processor.render.spec.ts` snapshots for the new template.
- `apps/web`: follow whatever component test setup exists; at minimum the audience
  picker's count call and the button enable/disable logic.
- Migration tested against a copy of the acc database before merge, per
  `docs/OPERATIONS.md`.

## 12. Rollout

1. Merge to `main` → acc. Create a draft for the Northwind project with the MCP tool,
   review it in the admin UI on acc, send to a test coop.
2. Tag `v*` → prod. Same draft on prod, reviewed and sent by Wouter.

## Dependencies added

- API: `sanitize-html`, `marked` (+ types).
- Web: `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-link`.
