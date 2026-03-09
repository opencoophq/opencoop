# Messaging / Inbox Feature Design

**Date:** 2026-03-09

## Problem

Coops need to communicate with shareholders (e.g. Algemene Vergadering invites, AV reports) without relying on external tools like Brevo. Shareholders need a place to find official communications and documents, and the ability to reach the coop with questions. Similar to how a bank handles customer communications.

## Design

### Conversation model

Every message exchange lives in a **Conversation** containing **Messages**. Two conversation types:

- **BROADCAST**: admin sends to all active shareholders. Each shareholder gets their own `ConversationParticipant` with independent read tracking.
- **DIRECT**: admin to one shareholder, or shareholder to coop.

### Data model

```
Conversation
  id, coopId, subject, type (BROADCAST | DIRECT)
  createdById (userId), createdAt, updatedAt

ConversationParticipant
  id, conversationId, shareholderId
  readAt (nullable — null means unread)
  createdAt

Message
  id, conversationId
  senderType (ADMIN | SHAREHOLDER)
  senderId (userId or shareholderId)
  body (text)
  createdAt

MessageAttachment
  id, messageId
  type (UPLOADED_FILE | EXISTING_DOCUMENT)
  filePath (for uploads)
  shareholderDocumentId (for linking existing docs)
  fileName, mimeType
```

**Unread detection**: a conversation is unread for a participant when `readAt IS NULL` or `readAt < conversation.updatedAt` (new replies since last read).

### Document integration

Admin-sent attachments also create `ShareholderDocument` records so they appear in `/dashboard/documents`. For broadcasts, one `ShareholderDocument` per shareholder pointing to the same file on disk. New `DocumentType`: `CORRESPONDENCE`. Shareholder-uploaded attachments do NOT go to Documents (keeps it as "official docs from the coop").

### API endpoints

**Admin:**
- `GET /admin/coops/:coopId/conversations` — list all (paginated)
- `POST /admin/coops/:coopId/conversations` — create (broadcast or direct)
- `GET /admin/coops/:coopId/conversations/:id` — detail with messages
- `POST /admin/coops/:coopId/conversations/:id/messages` — reply
- `POST /admin/coops/:coopId/conversations/:id/messages/:messageId/attachments` — upload

**Shareholder:**
- `GET /shareholders/:shareholderId/conversations` — my conversations
- `POST /shareholders/:shareholderId/conversations` — start conversation to coop
- `GET /shareholders/:shareholderId/conversations/:id` — read (marks as read)
- `POST /shareholders/:shareholderId/conversations/:id/messages` — reply
- `GET /shareholders/:shareholderId/unread-count` — badge count

### Frontend pages

**Shareholder dashboard:**
- `/dashboard/inbox` — conversation list, unread bolded, subject + preview + date
- `/dashboard/inbox/:id` — messages in chronological order, reply box, attachment downloads
- Sidebar badge with unread count

**Admin dashboard:**
- `/dashboard/admin/messages` — all conversations, filterable by type
- `/dashboard/admin/messages/new` — compose (choose broadcast or specific shareholder, subject, body, attachments)
- `/dashboard/admin/messages/:id` — detail with participant read status, reply box

### Email notifications

- **To shareholders**: new `message-notification` email template via existing Bull queue. Contains coop name, subject, body preview, "View in inbox" link.
- **To admins** (on shareholder message/reply): email all COOP_ADMIN users for that coop.
- **Broadcasts**: one Bull job per shareholder.
- Coops with `emailEnabled: false` skip emails (message still in-app).

### Permissions

- New permission: `canManageMessages` for admin roles.
- Shareholders can only see their own conversations.
- CoopGuard ensures tenant isolation.

### Out of scope (for now)

- Rich text / markdown in messages
- Shareholder-to-shareholder messaging
- Filtering broadcasts by share class or other criteria
- Message search
- Push notifications
