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

1. **test** — remote deploy script, lint + api unit tests (+ workspace dep build) + `pnpm audit --prod` report. Gates merge.
2. **e2e** — Playwright against a seeded Postgres+Redis. Gates merge + deploy.
3. **build** — builds & pushes 3 GHCR images (`opencoop-{api,web,migrate}:<sha>`), immutable, SHA-tagged.
   On PRs the images build but are **not** pushed and **no deploy runs** (`github.event_name == 'push'` guard).
4. **deploy-acc** / **deploy-prod** (`needs: [build, e2e, test]`) — SSH to fsn1 and run
   `deploy/remote-deploy.sh` with `set -euo pipefail`. The script retries
   `docker compose pull migrate api web` (backoff 10s, 20s, 40s, 80s) while the candidate `TAG` is set
   only on that command, **not** in `.env`. It then runs `docker compose up -d --no-deps migrate`, waits
   up to 10 minutes (300 attempts, 2s apart) until that container has exited 0, and runs
   `docker compose up -d --no-deps api web`. Postgres, redis,
   and the docs container are not pulled and not recreated. It writes `TAG=<sha>` only after api, web,
   and migrate are present locally and each has a registry digest. If `up` or the image check fails, it
   restores the previous `TAG` **in `.env` only**. That restore does not stop or recreate containers and
   does not roll back a migration that already ran; use the manual rollback below for that. After the
   app containers are up it `docker inspect`s api (running), web (running), and migrate (exited 0) and
   fails unless the container image id matches that tag. **Only then** it polls `/api/health` (30
   attempts, 2s apart, 5s curl cap). A failed pull, a tag/digest mismatch, or an unhealthy API fails the
   workflow. The script never prints `.env`.

   **Docs** (`.github/workflows/docs-deploy.yml`) uses the same script for `DOCS_TAG` and only the `docs`
   service (`docker compose pull docs` / `up -d --no-deps docs`). There is no HTTP healthcheck; the image
   inspect is the gate. A failed pull leaves `DOCS_TAG` unchanged. A failed `up` or image check restores
   `DOCS_TAG` in `.env` only.

A one-shot **migrate** container runs `prisma migrate deploy` before the API starts
(`api.depends_on.migrate: service_completed_successfully`). The deploy script enforces that
order itself (`up --no-deps migrate`, then api and web) because `--no-deps` does not wait
on `depends_on`. If a migration fails, the new API is not started — see Rollback.

---

## Infra images (Postgres, Redis, nginx)

Infra images are pinned to an exact tag in every compose file in this repo
(`deploy/docker-compose.yml`, plus `docker-compose.yml`, `docker-compose.dev.yml`, and
`docker-compose.test.yml`). The e2e job in `.github/workflows/build-deploy.yml` uses the
same Postgres and Redis tags. Dependabot does not edit that workflow, so an infra PR
should bump those two lines with the compose files.

An app deploy never pulls or recreates `postgres` or `redis`. Merging a pin change,
including a Dependabot PR, only ships app images. The deploy job does not edit the compose
file on the server. Replacing `postgres:16-alpine` with `postgres:16.15-alpine` in git does
not restart the database.

**Host compose files are managed by hand and differ from this repo.** Each one sets
`name: opencoop-<env>` and local values such as `SENTRY_ENVIRONMENT`. Never copy
`deploy/docker-compose.yml` from the repo onto the host. Without `name:`, Compose takes
the directory name (`acc` or `prod`) as the project name and starts on **new empty
volumes**.

Known compose drift, not fixed in this PR: the host file is behind the repo on `PONTO_*`,
`WEBAUTHN_RP_NAME`, `COOP_SIGNUP_NOTIFY_EMAIL`, the web `SENTRY_DSN`, the api healthcheck,
and logging.

`.github/dependabot.yml` uses the `docker-compose` ecosystem (supported for Compose v2/v3)
on `/` and `/deploy`, weekly, at most 5 open pull requests, grouped as `infra-images`.
Major Postgres and Redis bumps are ignored (`version-update:semver-major`): a major
Postgres upgrade cannot reuse the existing data directory and needs an encrypted dump plus
a restore into a new volume. Minor and patch bumps are opened. Dockerfiles (`node` base
images, including `deploy/migrate.Dockerfile`) are the separate `docker` ecosystem, also
weekly.

To apply a newer pinned image, change **only the image line** on the host. Acc first, then
prod. Do this only when the new tag is not the image the container is already running. The
pins in this change match the images already running (`postgres:16.15-alpine`,
`redis:7.4.11-alpine`); do not recreate them just to adopt that tag string. A later
Dependabot bump is when the command below runs.

```bash
# SSH to fsn1 (Tailscale) as wouter. Acc first.
cd ~/opencoop/acc
cp docker-compose.yml "docker-compose.yml.pre-infra-$(date -u +%Y%m%dT%H%M%SZ)"
sed -i -E 's#^(\s*image:\s*)postgres:[0-9.]+-alpine#\1postgres:<NEW>-alpine#; s#^(\s*image:\s*)redis:[0-9.]+-alpine#\1redis:<NEW>-alpine#' docker-compose.yml
grep -nE '^name:|image: (postgres|redis)' docker-compose.yml   # name must be opencoop-acc
docker compose pull postgres redis
docker compose up -d --no-deps postgres redis
curl -fsS https://acc.opencoop.be/api/health

# Prod, only after acc is healthy. Encrypted dump first (same as ~/opencoop/backup/backup.sh):
set -o pipefail
cd ~/opencoop/prod
( umask 077; mkdir -p ~/backups/opencoop
  F=~/backups/opencoop/opencoop_prod-pre-infra-$(date -u +%Y%m%dT%H%MZ).dump.age
  docker exec opencoop-prod-postgres-1 pg_dump -U opencoop -Fc opencoop \
    | age -R ~/.age-recipients -o "$F.partial" && mv "$F.partial" "$F" && chmod 600 "$F" \
    && [ "$(stat -c %s "$F")" -gt 102400 ] && ls -l "$F" )   # stop if this fails
# then the same cp/sed/grep (name must be opencoop-prod), pull, up -d --no-deps postgres redis, health check.
```

Never write a plaintext dump, in `/tmp` or anywhere else. Restore with
`age -d -i <identity> F | docker exec -i … pg_restore`. The age identity is in 1Password.

> Never `docker compose down`. `up -d --no-deps postgres redis` recreates those containers
> when the image tag changes and leaves the named volumes in place. A **major** Postgres
> upgrade (for example 16 to 17) will not start on the old data directory. Take the
> encrypted dump above, restore into a new volume, and change the pin by hand. Dependabot
> will not open that PR.

`nginx:1.31.8-alpine` is only in the local `docker-compose.yml`. It is not on acc or prod
(Caddy terminates TLS there).

---

## Rollback (manual, ~2 min)

Images are immutable and SHA-tagged, so rollback = repoint `TAG` to the last good SHA and recreate
the app containers.

The deploy script's automatic failure path only writes the previous `TAG` or `DOCS_TAG` back into
`.env`. It does not recreate containers and does not undo a migration. If the new containers are
already running, or `migrate` already applied SQL, run the steps below (and check the database).

```bash
# SSH to fsn1 (Tailscale) as wouter, then:
cd ~/opencoop/prod                 # or ~/opencoop/acc
grep TAG= .env                     # note the current (bad) TAG
# find the previous good sha: `git log --oneline` on main, or the prior successful deploy run
sed -i 's/^TAG=.*/TAG=<previous-good-sha>/' .env
docker compose pull migrate api web
docker compose up --no-deps --force-recreate migrate   # foreground; wait for exit 0
docker compose up -d --no-deps --force-recreate api web
curl -fsS https://opencoop.be/api/health   # confirm healthy (acc.opencoop.be for acc)
```

> ⚠️ **NEVER run `docker compose down` on prod.** The prod project name is `opencoop-prod`
> (volumes `opencoop-prod_postgres_data`); a `down && up` can create a *new empty* volume and you
> lose the database. Recreate app containers with `docker compose up -d --no-deps --force-recreate`.
> To replace a single stuck container, `docker rm -f <name>` it, never `down`. Infra upgrades are
> the separate image-line edit above, and on prod only after the encrypted `age` dump.

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
4. `docker compose up -d --no-deps --force-recreate api web` and verify `/api/health` + a known record.
   Do not recreate `postgres` or `redis` as part of an app restore.

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

# restart one app service without touching volumes or infra
docker compose up -d --no-deps --force-recreate api

# what's deployed
grep TAG= ~/opencoop/prod/.env
```
