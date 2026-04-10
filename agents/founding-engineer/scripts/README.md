# Founding Engineer Scripts

## sync-brevo-contacts.ts

Syncs OpenCoop contact segments to Brevo contact lists via Brevo API v3.

### Segments

| List | Filter |
|------|--------|
| S1 Actieve cooperanten | Active members, 1–4 net shares |
| S2 Grote investeerders | Active members, 5+ net shares |
| S3 Niet-leden | Non-members / 0-share accounts, signed up 6+ months ago |

Note: OpenCoop does not maintain a separate newsletter subscriber database, so S3/S4 are combined into a single "non-member" list.

### Prerequisites

1. **Brevo API key**: Settings → API Keys → Create
2. **Database access**: For production, set up an SSH tunnel first:
   ```bash
   ssh -L 5434:localhost:5432 wouter@fsn1 -N &
   ```
   Then use `DATABASE_URL=postgresql://...@localhost:5434/opencoop?schema=public`

### Usage

```bash
# Dry run (prints segments without calling Brevo)
DRY_RUN=true DATABASE_URL=<url> npx tsx agents/founding-engineer/scripts/sync-brevo-contacts.ts

# Live run against production
DATABASE_URL=<prod-db-url> BREVO_API_KEY=<key> npx tsx agents/founding-engineer/scripts/sync-brevo-contacts.ts

# Different coop slug (default: bronsgroen)
DATABASE_URL=<url> BREVO_API_KEY=<key> COOP_SLUG=other-coop npx tsx agents/founding-engineer/scripts/sync-brevo-contacts.ts
```

### Brevo API behavior

- Lists are created automatically if they don't exist yet.
- Contacts are upserted (created or updated), existing contacts are not overwritten unless their attributes changed.
- Import runs asynchronously — check **Brevo → Contacts → Import History** for completion status.
