# AGM Document Sharing — Design Spec

**Date:** 2026-05-08
**Owner:** Wouter
**Builds on:** [2026-04-14-agm-voting-design.md](./2026-04-14-agm-voting-design.md) (the broader AGM/voting feature)
**Target use:** Bronsgroen AGM 2026-05-09 — agenda documents must reach members ≥1 week beforehand (per Art. 22 of statuten).

---

## 1. Context & Motivation

The AGM module ships convocation (≥15 days before) and RSVP/voting flows. It does **not** yet ship a way to share agenda documents (jaarverslag, jaarrekening, begroting, etc.) with members in the days leading up to the meeting.

Bronsgroen's statuten Art. 22 requires agenda documents to be available ≥1 week before the AGM. The convocation goes out earlier (≥15 days), so this is a separate mailing — admins want to send the docs once they're finalized, typically 1 week before the meeting.

This spec adds:
- A document-management surface (upload PDFs, name them, reorder, delete) per meeting.
- An editable mailing (subject + intro) with auto-rendered list of download links.
- Per-cooperant token-protected downloads.
- Send + open + download tracking per recipient for governance visibility.

### Out of scope (this spec)
- Versioning / replacing documents while preserving old links.
- Per-document permissions (e.g. some docs only for class B holders).
- Reminder mailing for cooperanten who didn't open.
- File formats other than PDF.
- Automatic cleanup of orphan files on meeting/document delete (orphans are harmless on disk; cleanup deferred).

---

## 2. Data Model (Prisma)

### New model

```prisma
model MeetingDocument {
  id          String   @id @default(cuid())
  meetingId   String
  meeting     Meeting  @relation(fields: [meetingId], references: [id], onDelete: Cascade)

  fileName    String           // original name, shown in UI/mail
  fileUrl     String           // path under /uploads/meeting-documents/<meetingId>/
  fileSize    Int              // bytes
  order       Int              // ordering in mail/UI
  uploadedAt  DateTime @default(now())
  uploadedBy  String            // userId of admin who uploaded

  @@index([meetingId, order])
  @@map("meeting_documents")
}
```

### Additions to existing `Meeting` model

```prisma
model Meeting {
  // ... existing fields
  documents               MeetingDocument[]

  documentsSubject        String?           // overrides default email subject
  documentsIntro          String?  @db.Text // overrides default intro paragraph
  documentsEmailSentAt    DateTime?         // aggregate "sent?" flag (latest send)
}
```

> Naming: `documentsSubject` / `documentsIntro` (NOT `customSubject`/`customBody` — those already exist for the convocation email).

### Additions to existing `MeetingAttendance` model

```prisma
model MeetingAttendance {
  // ... existing fields
  documentsEmailSentAt    DateTime?
  documentsEmailError     String?    // SMTP/bounce reason if send failed
  documentsEmailOpenedAt  DateTime?  // first pixel hit
  documentsDownloadedAt   DateTime?  // first PDF download (any document)
}
```

### Migration notes
- 1 new table, 3 new fields on `Meeting`, 4 new fields on `MeetingAttendance`.
- All additive, all nullable or with defaults → safe rollback.
- No backfill needed.
- Single Prisma migration.

---

## 3. Backend (NestJS)

Extension of existing `apps/api/src/modules/meetings/`. **No new module.**

### New file

```
apps/api/src/modules/meetings/
├── meeting-documents.service.ts
└── dto/
    ├── upload-meeting-document.dto.ts
    ├── update-meeting-document.dto.ts
    └── update-documents-email-draft.dto.ts
```

### Endpoints (added to `meetings.controller.ts`)

All under `Base: /admin/coops/:coopId/meetings/:id`
Guards: `JwtAuthGuard + CoopGuard + RolesGuard + PermissionGuard`
Decorators: `@Roles('COOP_ADMIN', 'SYSTEM_ADMIN') + @RequirePermission('canManageMeetings')`

```
Documents:
  POST   /documents                   uploadDocument
                                        - multipart/form-data
                                        - file field: "file" (PDF only, 10MB max — existing FileInterceptor pattern)
                                        - optional form field: "displayName" (overrides file name shown in UI/mail)
  GET    /documents                   listDocuments
  PATCH  /documents/:docId            updateDocument
                                        - body: { fileName?, order? }
  DELETE /documents/:docId            removeDocument

Mailing draft + send:
  GET    /documents-email             getEmailDraft
                                        - returns: { subject, intro, defaultSubject, defaultIntro,
                                                     recipientCount, sentAt, sentCount, failedCount }
  PATCH  /documents-email             updateEmailDraft
                                        - body: { subject?, intro? }
  POST   /documents-email/preview     previewEmail
                                        - returns rendered HTML for preview pane
                                        - optional body: { sendTestTo?: 'self' }
                                          → if 'self', also sends to admin's own email
  POST   /documents-email/send        sendDocumentsEmail
                                        - first send: enqueues to all attendances
                                        - if already sent: enqueues only to attendances with
                                          documentsEmailError != null (retry failed)
                                        - returns 202
                                        - reject 400 if meeting.status !== CONVOKED
                                        - reject 400 if no documents
                                        - reject 400 if all attendances already have sentAt and no errors
                                          (nothing to do)
```

### Public endpoints (token-auth, NO JWT)

Added to `meeting-rsvp.controller.ts`:

```
GET /public/meetings/rsvp/:token/documents/:docId     downloadDocument
GET /public/meetings/rsvp/:token/pixel.gif            trackOpen
```

**Token validation for documents:**
- Token must exist on a `MeetingAttendance` record.
- Document expiry: `now <= meeting.scheduledAt + 30 days` (NOT `rsvpTokenExpires`, which is for RSVP).
- Verify `attendance.meetingId === document.meetingId`.
- Rate limit: 30 req/min per IP (reuse existing rate-limit guard).
- Streams PDF from disk with `Content-Disposition: attachment; filename="<original>.pdf"`.
- Sets `attendance.documentsDownloadedAt = now()` only if currently `null`.
- Audits: `audit.create({ action: 'meeting.document.downloaded', shareholderId, meetingId, documentId, ip, userAgent })`.

**Pixel endpoint:**
- Always returns a 43-byte transparent GIF (`Cache-Control: no-store`), even on invalid token (no leak; failing silently keeps the rendered email looking clean).
- If token valid: sets `attendance.documentsEmailOpenedAt = now()` only if currently `null`.
- No rate limit (some clients pre-fetch).

### Service-layer logic (`MeetingDocumentsService`)

**`uploadDocument(coopId, meetingId, file, displayName?, userId)`**
- Validate: `file.mimetype === 'application/pdf'`, `file.size <= 10MB`.
- Sanitize filename via `path.basename`; replace bad chars.
- Resolve effective `displayName`: explicit param OR `file.originalname`.
- **Replace-in-place check**: if a `MeetingDocument` exists for this meeting with the same `displayName`:
  - Delete its old file from disk (best-effort; log warning on ENOENT).
  - Persist new file to `<UPLOAD_DIR>/meeting-documents/<meetingId>/<randomUUID>.pdf`.
  - Update existing row: new `fileUrl`, `fileSize`, `uploadedAt`, `uploadedBy`. Keep `id`, `order`.
  - Return updated record.
- Otherwise (new document):
  - Persist to `<UPLOAD_DIR>/meeting-documents/<meetingId>/<randomUUID>.pdf`.
  - Insert `MeetingDocument` with `order = max(order) + 1`.
  - Return created record.

**`sendDocumentsEmail(coopId, meetingId, adminUserId)`**
- Validate: `meeting.status === CONVOKED`. Reject otherwise (no RSVP tokens yet).
- Validate: at least 1 document exists. Reject otherwise.
- Concurrency lock: reject if `documentsEmailSentAt > now - 1 minute` (in-flight protection).
- Determine recipient set:
  - **First send** (`meeting.documentsEmailSentAt == null`): every `MeetingAttendance` for the meeting.
  - **Retry** (`meeting.documentsEmailSentAt != null`): only attendances where `documentsEmailError IS NOT NULL`. If none, reject 400 ("nothing to retry").
- Tracking fields are NEVER reset. Already-sent recipients keep their `sentAt/openedAt/downloadedAt`.
- For each retry recipient: clear `documentsEmailError = null` before enqueueing.
- For each recipient in the set, render HTML via `EmailProcessor.renderTemplate('agenda-documents', ...)` and enqueue Bull job.
- On Bull job success: `attendance.documentsEmailSentAt = now()`.
- On Bull job final failure: `attendance.documentsEmailError = err.message`.
- Set `meeting.documentsEmailSentAt = now()` after enqueue.
- Return: `{ enqueued: N }`.

### Email template

**No new `.hbs` file.** Add a function entry to the `templates` Record in `apps/api/src/modules/email/email.processor.ts:257`. Key: `'agenda-documents'`.

Template inputs:
```typescript
{
  language: 'nl' | 'en' | 'fr' | 'de',
  subject: string,
  introHtml: string,                      // admin's intro paragraph (plain text → wrapped in <p>)
  documents: Array<{
    fileName: string,
    downloadUrl: string,                  // absolute URL with token
  }>,
  meetingTitle: string,
  meetingScheduledAt: string,             // formatted in language locale
  rsvpUrl: string,                        // for "RSVP if you haven't yet" footer note
  pixelUrl: string,                       // tracking pixel (absolute)
}
```

Renders:
1. Coop branding header (reuse styling from `convocation` template)
2. Greeting: `Beste {shareholderFirstName}` — if available, else `Beste lid`
3. Intro paragraph (admin-supplied, falls back to default per language)
4. List of documents, each as a button-styled link
5. Footer: AV date reminder + RSVP link
6. Tracking pixel `<img>` (1×1, alt="")

### Default subject / intro (i18n)

Stored in `apps/web/messages/{en,nl,fr,de}.json` AND mirrored in API for backend rendering (or backend imports from shared package).

Suggested NL defaults (Wouter to refine before ship):

```json
{
  "meetings": {
    "documents": {
      "defaultSubject": "Documenten voor de algemene vergadering van {coopName} op {date}",
      "defaultIntro": "Beste coöperant,\n\nIn aanloop naar onze algemene vergadering vind je hieronder de relevante documenten ter inzage. Gelieve deze door te nemen voor de vergadering.\n\nMet vriendelijke groeten,\nHet bestuur"
    }
  }
}
```

EN/FR/DE: similar, translated. Wouter copy-edits.

### Multi-tenancy & authorization
- Admin endpoints scoped via existing `CoopGuard`.
- Public endpoints: token → derives meeting + coop scope → no cross-coop leakage.
- Every state-changing action audited via existing `audit` module.

---

## 4. Frontend (Admin UI)

### New route

`apps/web/src/app/[locale]/dashboard/admin/meetings/[meetingId]/documents/page.tsx`

Linked from the meeting overview "next-action checklist" as `"Documenten naar coöperanten sturen"` once `status === CONVOKED`.

### Page layout (vertical)

```
┌─────────────────────────────────────────────────────────┐
│ ← Terug   AV Bronsgroen 9 mei 2026                      │
│           Documenten delen                              │
├─────────────────────────────────────────────────────────┤
│  📎 Documenten                                          │
│  [drag-reorder list, dnd-kit]                           │
│  ⋮⋮ Jaarverslag 2025.pdf      2.4 MB    [✏️ rename] [🗑]│
│  ⋮⋮ Jaarrekening 2025.pdf     1.1 MB    [✏️ rename] [🗑]│
│  ⋮⋮ Begroting 2026.pdf        0.8 MB    [✏️ rename] [🗑]│
│  [ + PDF uploaden ]   (drag-drop zone or click)         │
├─────────────────────────────────────────────────────────┤
│  ✉️ Mailing tekst                                       │
│  Onderwerp:  [_________________________________________] │
│  Intro:      [_________________________________________] │
│              [_________________________________________] │
│              ↳ rendered above the documents list        │
├─────────────────────────────────────────────────────────┤
│  📤 Versturen                                           │
│  Naar 47 coöperanten                                    │
│  [ 👁 Preview (test mail naar mij) ]                    │
│  [ Versturen → ]                                        │
│                                                         │
│  ℹ️ Verstuurd op 6 mei 2026 om 14:23 — 45/47 succesvol  │
│  [ Opnieuw verzenden naar 2 falende ]                   │
├─────────────────────────────────────────────────────────┤
│  📊 Status                                              │
│  Coöperant      | Verstuurd | Geopend | Gedownload      │
│  Jan Peeters    | 14:23 ✓   | 14:31   | 14:32           │
│  Marie Janssen  | 14:23 ✓   | —       | —               │
│  Piet Bossuyt   | ✗ bounce  | —       | —               │
└─────────────────────────────────────────────────────────┘
```

### Components

- **Reorder**: `@dnd-kit/core` + `@dnd-kit/sortable`. New deps to add to `apps/web`.
- **Upload zone**: drag-drop fallback to file picker; client-side filter for `application/pdf`; progress bar via XHR (so we can cancel large uploads).
- **Inline rename**: click filename → input → blur saves.
- **Preview**: opens dialog with rendered HTML mail in an iframe; "Verstuur testmail naar mijzelf" button uses `@CurrentUser()` email.
- **Send button**: disabled if `documents.length === 0` OR `meeting.status !== CONVOKED`. Confirmation dialog: "Je gaat 47 mails versturen — weet je het zeker?".
- **Re-send button**: appears after first send only if there are failures. Single button "Opnieuw verzenden naar N falende". Opens confirm dialog. Hidden when all sent successfully (no remaining work).
- **Status table**: client-side polling via React Query (10s interval) until all statuses settled, then stops.

### i18n keys (new, under `meetings.documents.*` in all 4 locale files)

```
documents.title
documents.uploadCta
documents.dragDropHint
documents.rename
documents.delete
documents.confirmDelete
documents.subjectLabel
documents.subjectPlaceholder
documents.introLabel
documents.introPlaceholder
documents.recipientCount
documents.previewCta
documents.sendCta
documents.sendConfirm
documents.sentSummary
documents.resendFailed
documents.statusTitle
documents.status.sent
documents.status.opened
documents.status.downloaded
documents.status.failed
documents.notReady
documents.defaultSubject
documents.defaultIntro
```

### Public download UX (cooperant side)

- Mail link → `/api/public/meetings/rsvp/:token/documents/:docId`
- Backend serves PDF directly with `Content-Disposition: attachment` — browser downloads without intermediate page.
- If token expired (>30d post-meeting): redirect to existing "link verlopen" page from RSVP flow.

---

## 5. Email Flow

### Render flow (per recipient)

```
admin clicks "Versturen"
  → POST /documents-email/send { mode: 'all' }
  → MeetingDocumentsService.sendDocumentsEmail()
  → for each MeetingAttendance:
      - reset documentsEmailSentAt/Error/OpenedAt/DownloadedAt
      - render HTML via EmailProcessor.renderTemplate('agenda-documents', { ... })
      - enqueue Bull job in 'email' queue
  → respond 202 { enqueued: N }
  → frontend polls status table until all rows settled
```

### Bull job behavior

Existing `EmailProcessor` handles the actual SMTP/Graph/Platform-SMTP send (3 paths depending on coop config — already implemented for convocation). Same retry logic (3x).

On success → `attendance.documentsEmailSentAt = now()`, `documentsEmailError = null`.
On final failure → `attendance.documentsEmailError = err.message` (truncated to 500 chars).

### Pixel injection

Templates render `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:block" />` at the bottom of the email body.

---

## 6. Edge Cases

| Scenario | Handling |
|----------|----------|
| Admin uploads non-PDF | Server rejects 400, UI toast "alleen PDF" |
| File >10MB | Server rejects 413, UI shows max-size error |
| Filename with `/` or `..` | `path.basename()` sanitization |
| Admin sends with no documents | Send button disabled in UI; backend rejects 400 |
| Admin sends for `status=DRAFT` | Backend rejects 400 — no RSVP tokens exist |
| Cooperant downloads after AV date | Works until `scheduledAt + 30 days`; after that → "link verlopen" page |
| Admin deletes document after send | Document gone, links in already-sent mails return 404. UI shows warning before delete: "Documentlinks in al verzonden mails worden ongeldig." |
| Admin re-uploads with same `displayName` | Replace-in-place: same `MeetingDocument.id`, file overwritten on disk, `fileSize`/`uploadedAt` updated. Already-sent download links continue working but serve the new content. |
| 2 admins send simultaneously | Concurrency lock: reject if `documentsEmailSentAt > now - 1min`. Frontend shows "iemand anders is bezig met versturen". Lock is conservative for Bronsgroen-scale (~50 jobs flush in seconds); larger coops may need queue-introspection later. |
| SMTP down during send | Bull retries 3x → on exhaustion: `documentsEmailError` set. Failure visible in UI status table. |
| Cooperant has no email | `attendance.email == null` → mark as `documentsEmailError = 'no email address'`. Shown in failure rows. |
| Pixel hit with invalid token | Returns valid GIF, no DB write, no log spam (silent). |
| Pixel pre-fetched by Apple Mail Privacy Protection | Logs as opened even though user didn't open. Documented as known limitation. |
| Meeting deleted | Cascade deletes `MeetingDocument` rows. **Files on disk become orphans** (not cleaned up in v1 — harmless). |

---

## 7. Testing

### Unit tests
1. `MeetingDocumentsService.uploadDocument` — PDF mimetype, size limit, filename sanitization, disk write to correct path.
2. `MeetingDocumentsService.sendDocumentsEmail` — happy path, partial SMTP failure, reject on `status !== CONVOKED`, reject on no documents, concurrency lock.
3. `MeetingDocumentsService.sendDocumentsEmail` — first send enqueues all; retry enqueues only failed; tracking fields never reset; reject when no failures to retry.
3b. `MeetingDocumentsService.uploadDocument` — re-upload with matching `displayName` replaces in-place (same `id`, file overwritten on disk, no orphan).
4. Public download endpoint — valid token streams file; expiry checked against `scheduledAt + 30d`; cross-meeting token returns 403.
5. Pixel endpoint — first hit sets `openedAt`, second hit no-op (idempotent), invalid token still returns valid GIF without DB write.

### Integration test
6. End-to-end: create meeting → convoke → upload 2 PDFs → edit subject/intro → preview → send → fetch token → download document → assert `downloadedAt` set → load pixel → assert `openedAt` set.

### Manual QA on acc (not automated)
- Real SMTP delivery test: send to own mailbox; verify pixel fires in Apple Mail, Gmail, Outlook.
- Visual inspection of mail rendering across clients.
- dnd-kit reorder UX on laptop (admins don't use mobile for this, but quick check).

---

## 8. Deployment

1. Feature branch → PR → merge `main` → auto-deploys to `acc.opencoop.be`.
2. Manual QA on acc (1-2 days):
   - Upload 3 mock PDFs to a test coop's test meeting.
   - Edit subject + intro.
   - Preview test-send to self.
   - Verify pixel triggers; verify download triggers.
   - Verify status table updates correctly.
3. Tag `v0.8.x` for prod, update `CHANGELOG.md`.
4. **Bronsgroen-specific (Wouter, manual)**: update `bronsgroen.be/privacy` with pixel-tracking notice.
5. On prod: Bronsgroen admin uploads jaarverslag/jaarrekening/begroting for AV 2026-05-09 and sends mailing **on or before 2026-05-02** (1 week notice per Art. 22).

### Rollback
- Frontend regression: revert frontend-only commit, schema stays.
- Mailing-flow bug post-send: already-sent mails persist; download endpoint stays up; admin can re-send after hotfix.
- Schema: additive only → safe revert.

---

## 9. New Dependencies

Add to `apps/web/package.json`:
- `@dnd-kit/core`
- `@dnd-kit/sortable`
- `@dnd-kit/utilities`

No new backend deps (FileInterceptor + multer already used; nodemailer already installed).

---

## 10. Open Questions for Implementation

These are deliberately left to implementation-time decisions; flagging here so they're not forgotten:

1. **Default i18n copy** for subject/intro: NL/EN/FR/DE wording — Wouter copy-edits during build.
2. **Status table polling cadence**: 10s feels right; tighten to 3s if Bull queue is fast in practice.
3. **Truncation of `documentsEmailError`**: 500 chars proposed — adjust if SMTP error messages turn out longer/shorter in practice.
4. **Filename re-display**: show `displayName` if set, else `fileName`. Decide if rename should change `displayName` (preserves original on disk) or `fileName` (re-renames original) — proposed: `displayName` only, never touch `fileName` on disk.

---

## 11. Summary

| Artifact | Count |
|----------|-------|
| New Prisma models | 1 |
| Altered existing tables | 2 (additive only) |
| Backend services | 1 (new) |
| Backend controllers | 0 (extends existing) |
| Backend endpoints | 9 (7 admin + 2 public) |
| DTOs | 3 |
| Email templates | 1 (added to existing Record) |
| Admin pages | 1 |
| Public pages | 0 (downloads stream directly) |
| Frontend deps | 3 (`@dnd-kit/*`) |
| i18n keys | ~22 per locale × 4 locales |
| Unit tests | 5 |
| Integration tests | 1 |
| Estimated build time | 2-3 days |

**Hard constraint:** Bronsgroen send-by date is **2026-05-02** (1 week before AV).
