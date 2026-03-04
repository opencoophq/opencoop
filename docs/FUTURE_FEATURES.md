# Future Features

## Messaging / Announcements Platform

**Priority:** Medium
**Status:** Idea

Coop admins can send announcements to all shareholders (one-to-many, not chat).

### Use cases
- Algemene vergadering (general assembly) invitations
- Algemene vergadering reports / minutes
- Dividend notices
- General coop updates

### Design notes
- Admin creates announcement: title + rich text body + optional PDF attachment
- Shareholders see it in a dashboard inbox with read/unread status
- Per-shareholder email preference: "also receive by email" (default on)
- Email delivery via Brevo, with "open in OpenCoop" link
- Categories: `GENERAL_ASSEMBLY_INVITE`, `GENERAL_ASSEMBLY_REPORT`, `DIVIDEND_NOTICE`, `GENERAL`
- Keeps a paper trail — admins can prove shareholders were notified
