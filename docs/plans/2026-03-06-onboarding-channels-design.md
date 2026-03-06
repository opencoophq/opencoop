# Onboarding Channels Design

## Context

Coops like Seacoop (marketing name: Onze Energie) want to send people from partner websites to individual coops for share purchases, but with the partner's branding instead of the coop's own. Each coop keeps its own onboarding/registration flow, but needs an additional branded entry point.

## Concept

A **Channel** is a branded entry point for a coop's public-facing pages (registration, share purchase, landing). Every coop has at least one channel (the default). Additional channels enable partnerships where a third party's branding wraps the same underlying coop.

Channels are purely cosmetic — same coop, same share classes, same shareholder register, same admin dashboard underneath.

## Data Model

### New: `Channel`

| Field | Type | Notes |
|-------|------|-------|
| id | String (cuid) | PK |
| coopId | String | FK -> Coop |
| slug | String | Unique per coop (e.g., "onze-energie") |
| name | String | Display name (e.g., "Onze Energie") |
| description | String? | Welcome text / custom copy on registration page |
| logoUrl | String? | Channel-specific logo |
| primaryColor | String | Hex color, default "#1e40af" |
| secondaryColor | String | Hex color, default "#3b82f6" |
| termsUrl | String? | Channel-specific terms URL |
| isDefault | Boolean | Exactly one per coop |
| active | Boolean | Default true |
| createdAt | DateTime | |
| updatedAt | DateTime | |

### New: `ChannelShareClass` (many-to-many)

| Field | Type |
|-------|------|
| channelId | String (FK -> Channel) |
| shareClassId | String (FK -> ShareClass) |

### New: `ChannelProject` (many-to-many)

| Field | Type |
|-------|------|
| channelId | String (FK -> Channel) |
| projectId | String (FK -> Project) |

### Modified: `Coop`

Remove fields (migrated to default channel):
- `logoUrl`
- `primaryColor`
- `secondaryColor`
- `termsUrl`

### Modified: `Transaction`

Add field:
- `channelId` (String?, FK -> Channel) — tracks which channel a purchase came through

### Modified: `Shareholder`

Add field:
- `channelId` (String?, FK -> Channel) — acquisition channel (first registration)

## URL Structure

```
/{locale}/{coopSlug}/{channelSlug}/           -> channel-branded landing
/{locale}/{coopSlug}/{channelSlug}/register   -> channel-branded registration
/{locale}/{coopSlug}/{channelSlug}/login      -> channel-branded login
/{locale}/{coopSlug}/{channelSlug}/claim      -> channel-branded gift claim
```

Default channel slug is `"default"`.

Backward compatibility: redirect `/{coopSlug}/register` -> `/{coopSlug}/default/register` (and same for other pages).

## API Endpoints

### Public

| Method | Path | Description |
|--------|------|-------------|
| GET | `/coops/:slug/channels/:channelSlug/public-info` | Channel branding + filtered share classes/projects |
| POST | `/coops/:slug/channels/:channelSlug/register` | Public registration, records channelId |

### Admin (CoopGuard)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/coops/:coopId/channels` | List all channels |
| POST | `/admin/coops/:coopId/channels` | Create channel |
| PATCH | `/admin/coops/:coopId/channels/:id` | Update channel |
| DELETE | `/admin/coops/:coopId/channels/:id` | Delete (not the default) |
| POST | `/admin/coops/:coopId/channels/:id/logo` | Upload logo |
| DELETE | `/admin/coops/:coopId/channels/:id/logo` | Remove logo |

## Dashboard UI

Under **Settings -> Channels**:
- List of channels with name, slug, color preview, logo, active toggle
- Create/edit form: name, slug, description, colors, logo upload, terms URL, share class picker, project picker
- Default channel badge (cannot be deleted)
- Copy-to-clipboard button for the public registration URL

## Migration Strategy

1. Add `Channel` model + join tables to Prisma schema
2. Create migration that for each existing coop:
   - Creates a default channel (`isDefault: true`, slug: `"default"`)
   - Copies `primaryColor`, `secondaryColor`, `logoUrl`, `termsUrl` from coop -> default channel
   - Links all existing share classes and projects to the default channel
3. Remove branding fields from `Coop` model
4. Update all frontend/API code to read branding from channel instead of coop

## What Changes for Existing Users

- Dashboard admins see a new "Channels" section in Settings
- Public URLs gain a `/{channelSlug}/` segment (with redirects from old URLs)
- No data loss — everything migrates to the default channel

## Tracking / Future

- `channelId` on Transaction and Shareholder enables future marketing analytics (e.g., "how many shareholders came through Onze Energie?")
- Future: channel-level analytics dashboard, conversion funnels per channel
