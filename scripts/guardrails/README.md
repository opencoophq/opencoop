# Guardrails

Static checks that fail on mistakes this repo has made before. Node built-ins only, no install.

Run from the repo root (takes about a second; CI runs the same command in the `test` job):

```bash
node --test scripts/guardrails/*.test.mjs
```

The migration check lives in `packages/database/scripts/check-migration-drift.sh` (needs a
throwaway Postgres; CI runs it in the `e2e` job).

| Check                            | Prevents                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| `env-wiring.test.mjs`            | API reads an env var that `deploy/docker-compose.yml` does not pass to `api` (#182, #183) |
| `locale-parity.test.mjs`         | A key missing, or a different type, in one of `apps/web/messages/{en,nl,fr,de}.json`      |
| `t-keys.test.mjs`                | `t('literal.key')` that does not exist in `en.json` under the translator's namespace      |
| `no-bearer-outside-api.test.mjs` | Hand-built `Authorization: Bearer` headers in `apps/web/src` outside `src/lib/api.ts`     |
| `declared-deps.test.mjs`         | Importing a package the app does not declare (hidden by `shamefully-hoist`); zod majors   |
| `changelog.test.mjs`             | `[Unreleased]` not first, a duplicated version heading, versions not newest first         |

## Allowlists

Each test has an `ALLOWLIST` of violations that already existed when it was added, each with
a reason. It is a ratchet: a new violation fails, and so does an entry that no longer occurs
(or a count that dropped). When you fix one, delete its entry or lower its `count`. Do not
add entries for new code; fix the code instead.
