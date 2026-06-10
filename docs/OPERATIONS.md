# OpenCoop — Operations Runbook

The deploy/rollback/restore procedures for OpenCoop. This is the in-repo bus-factor doc:
enough for a second operator to deploy, roll back, and recover.

> **Sensitive details** (server hostnames, Tailscale names, SSH keys, backup server IPs,
> Telegram tokens) are **not** in this repo — they live in the private infra notes and
> 1Password. This file documents the *process*; connection specifics are referenced, not duplicated.

---

## Environments

| Env | Trigger | Domain | Server dir |
|-----|---------|--------|-----------|
| **acc** | push to `main` | acc.opencoop.be | `~/opencoop/acc` |
| **prod** | push a `v*` tag | opencoop.be | `~/opencoop/prod` |

Both run on **fsn1** (Hetzner), reached over **Tailscale SSH** as user `wouter` (host + key in the
private infra notes). **Caddy** is the reverse proxy (in the `proxy` Docker network); it terminates
TLS and routes by container name. App containers join `proxy`; `postgres`/`redis` stay on an internal
network with **no host ports exposed**.

---

## Deploy flow (automated)

`.github/workflows/build-deploy.yml`:

1. **test** — lint + api unit tests (+ workspace dep build) + `pnpm audit --prod` report. Gates merge.
2. **e2e** — Playwright against a seeded Postgres+Redis. Gates merge + deploy.
3. **build** — builds & pushes 3 GHCR images (`opencoop-{api,web,migrate}:<sha>`), immutable, SHA-tagged.
   On PRs the images build but are **not** pushed and **no deploy runs** (`github.event_name == 'push'` guard).
4. **deploy-acc** / **deploy-prod** (`needs: [build, e2e, test]`) — SSH to fsn1, set `TAG=<sha>` in `.env`,
   `docker compose pull && docker compose up -d`, then **poll `/api/health` for up to 60s**; a deploy that
   never becomes healthy **fails the workflow** (it used to report green regardless).

A one-shot **migrate** container runs `prisma migrate deploy` before the API starts
(`api.depends_on.migrate: service_completed_successfully`). If a migration fails, the new API never
starts — see Rollback.

---

## Rollback (manual, ~2 min)

Images are immutable and SHA-tagged, so rollback = repoint `TAG` to the last good SHA.

```bash
# SSH to fsn1 (Tailscale) as wouter, then:
cd ~/opencoop/prod                 # or ~/opencoop/acc
grep TAG= .env                     # note the current (bad) TAG
# find the previous good sha: `git log --oneline` on main, or the prior successful deploy run
sed -i 's/^TAG=.*/TAG=<previous-good-sha>/' .env
docker compose pull
docker compose up -d --force-recreate
curl -fsS https://opencoop.be/api/health   # confirm healthy (acc.opencoop.be for acc)
```

> ⚠️ **NEVER run `docker compose down` on prod.** The prod project name is `opencoop-prod`
> (volumes `opencoop-prod_postgres_data`); a `down && up` can create a *new empty* volume and you
> lose the database. Always use `docker compose up -d --force-recreate`. To replace a single stuck
> container, `docker rm -f <name>` it, never `down`.

### If a migration failed mid-deploy
The new API won't have started. Either fix-forward (push a corrected migration) or roll the `TAG`
back to the prior image **and** assess whether the partial migration left the DB in a bad state
(check `_prisma_migrations`). If unsure, restore from backup (below) before retrying.

---

## Backups (3-2-1) & restore

- **fra1** (OVH) pulls fsn1 **nightly ~03:00 UTC**: DB dumps + volume/config rsync → **BorgBackup**.
  Full runbook on the box: `fra1:~/backup/README.md`.
- **stanford** (on-prem QNAP) pulls the Borg repo replica from fra1 **daily ~06:30 CEST** (read-only).
- Both send a **daily Telegram status — read it**: a ✅ can still contain `⚠️ Failed dumps`.
- **When adding a new service/DB on fsn1, add its dump + config dir to `fra1:~/backup/backup-fsn1.sh`** —
  nothing is auto-discovered.

### Restore (outline — rehearse before relying on it)
1. On fra1, list archives: `borg list <repo>` and pick the target date.
2. Extract the Postgres dump for the env from that archive (`borg extract` the dump path).
3. Copy the dump to fsn1, then restore into the running Postgres container:
   `cat dump.sql | docker compose exec -T postgres psql -U <user> <db>` (creds in the env's `.env`).
4. `docker compose up -d --force-recreate` and verify `/api/health` + a known record.

> **Restore has not been routinely rehearsed** (`docs/TECHNICAL_DEBT.md`). Do one drill on **acc**
> before each AGM season and record the timing/steps here.

---

## Monitoring

- `/api/health` does real **Postgres `SELECT 1` + Redis ping** (Terminus). Used by the Docker
  healthcheck and the post-deploy gate.
- **External uptime monitor** (e.g. UptimeRobot / Better Stack) should watch
  `https://opencoop.be/api/health` and alert (Telegram/email). *(Set this up — it is the one piece
  not enforceable from the repo; without it, the first signal of a dead box is a user email.)*
- **Sentry**: API errors are captured (`apps/api/src/instrument.ts`, global filter). Web error
  tracking is being added separately.

---

## Quick reference

```bash
# tail logs (last ~30MB retained per container)
cd ~/opencoop/prod && docker compose logs -f --tail=200 api

# restart one service without touching volumes
docker compose up -d --force-recreate api

# what's deployed
grep TAG= ~/opencoop/prod/.env
```
