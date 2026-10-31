#!/usr/bin/env bash
# Exercises .github/scripts/ci-changes.sh with fixed path lists.
set -euo pipefail

SCRIPT="$(cd "$(dirname "$0")" && pwd)/ci-changes.sh"
CODE=0

expect() {
  local want="$1" name="$2" got
  got=$(printf '%s' "$3" | bash "$SCRIPT")
  if [ "$got" = "app=$want" ]; then
    echo "ok   $name"
  else
    echo "FAIL $name: want app=$want, got $got" >&2
    CODE=1
  fi
}

expect false "docs only" $'docs/OPERATIONS.md\napps/docs/content/index.mdx\nREADME.md'
expect false "deploy script only" $'deploy/remote-deploy.sh\ndeploy/remote-deploy.test.sh'
expect false "agent scratch" $'.claude/settings.json\ntasks/todo.md'
expect true "api source" 'apps/api/src/main.ts'
expect true "web source among docs" $'docs/x.md\napps/web/src/app/page.tsx'
expect true "prisma schema" 'packages/database/prisma/schema.prisma'
expect true "lockfile" 'pnpm-lock.yaml'
expect true "e2e spec" 'e2e/tests/admin/login.spec.ts'
expect true "this workflow" '.github/workflows/build-deploy.yml'
expect true "ci scripts" '.github/scripts/ci-changes.sh'
expect true "changelog is served at runtime" 'CHANGELOG.md'
expect true "migrate image" 'deploy/migrate.Dockerfile'
expect true "unknown new dir" 'something-new/file.txt'
expect true "empty list" ''

exit "$CODE"
