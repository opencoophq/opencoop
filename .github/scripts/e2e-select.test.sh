#!/usr/bin/env bash
# Exercises .github/scripts/e2e-select.sh against the real map and specs,
# and against small fixture trees for the fail-open cases.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$DIR/e2e-select.sh"
CODE=0

SMOKE='e2e/tests/admin/dashboard.spec.ts
e2e/tests/auth/login.spec.ts
e2e/tests/public/registration-individual.spec.ts
e2e/tests/shareholder/purchase-shares.spec.ts'

run() { printf '%s' "$1" | bash "$SCRIPT" 2>/dev/null; }

expect_full() {
  local name="$1" got
  got=$(run "$2")
  if [ "$got" = "mode=full" ]; then
    echo "ok   $name"
  else
    echo "FAIL $name: want mode=full, got:" >&2
    echo "$got" >&2
    CODE=1
  fi
}

# expect_select <name> <changed paths> [extra specs, one per line]
# The smoke files are always part of the expected set.
expect_select() {
  local name="$1" want got
  want=$(printf '%s\n%s\n' "$SMOKE" "${3:-}" | sed '/^$/d' | LC_ALL=C sort -u)
  want=$(printf 'mode=select\n%s' "$want")
  got=$(run "$2")
  if [ "$got" = "$want" ]; then
    echo "ok   $name"
  else
    echo "FAIL $name: want / got:" >&2
    diff <(echo "$want") <(echo "$got") >&2 || true
    CODE=1
  fi
}

# --- Real map, real specs ----------------------------------------------------
expect_full "empty list" ''
expect_full "prisma schema" 'packages/database/prisma/schema.prisma'
expect_full "migration" 'packages/database/prisma/migrations/20261031_x/migration.sql'
expect_full "shared package" 'packages/shared/src/types.ts'
expect_full "lockfile" 'pnpm-lock.yaml'
expect_full "root package.json" 'package.json'
expect_full "playwright config" 'e2e/playwright.config.ts'
expect_full "global setup" 'e2e/global-setup.ts'
expect_full "e2e helper" 'e2e/helpers/dashboard.ts'
expect_full "e2e lockfile" 'e2e/package-lock.json'
expect_full "this workflow" '.github/workflows/build-deploy.yml'
expect_full "the map" '.github/scripts/e2e-path-map.txt'
expect_full "setup action" '.github/actions/setup-workspace/action.yml'
expect_full "unknown new dir" 'something-new/file.txt'
expect_full "unmapped api code" 'apps/api/src/common/guards/coop.guard.ts'
expect_full "shared ui component" 'apps/web/src/components/ui/button.tsx'
expect_full "translations" 'apps/web/messages/nl.json'
expect_full "mapped plus unmapped" $'apps/api/src/modules/auth/auth.service.ts\napps/web/src/lib/api.ts'

expect_select "docs among e2e changes are smoke only" $'docs/x.md\nREADME.md'
expect_select "jest unit spec is smoke only" 'apps/web/src/lib/zod-error-map.spec.ts'
# Every matching rule adds its specs: a unit spec inside a mapped module also
# runs that module's specs.
expect_select "unit spec in a mapped module" 'apps/api/src/modules/auth/auth.service.spec.ts' \
  'e2e/tests/public/charge-cards-login-redirect.spec.ts
e2e/tests/public/registration-existing-user.spec.ts'
expect_select "module with no spec is smoke only" 'apps/api/src/modules/meetings/meetings.service.ts'
expect_select "deleted spec is skipped" 'e2e/tests/admin/no-longer-here.spec.ts'
expect_select "changed spec runs" 'e2e/tests/admin/settings.spec.ts' \
  'e2e/tests/admin/settings.spec.ts'
expect_select "web auth route" 'apps/web/src/app/[locale]/(auth)/login/page.tsx' \
  'e2e/tests/public/charge-cards-login-redirect.spec.ts'
expect_select "api auth module" 'apps/api/src/modules/auth/auth.service.ts' \
  'e2e/tests/public/charge-cards-login-redirect.spec.ts
e2e/tests/public/registration-existing-user.spec.ts'
expect_select "public register route" 'apps/web/src/app/[locale]/[coopSlug]/register/page.tsx' \
  'e2e/tests/public/registration-company.spec.ts
e2e/tests/public/registration-existing-user.spec.ts
e2e/tests/public/charge-card-entry.spec.ts'
expect_select "admin shareholders page" 'apps/web/src/app/[locale]/dashboard/admin/shareholders/[id]/page.tsx' \
  'e2e/tests/admin/mobile-layout.spec.ts
e2e/tests/admin/shareholder-audit-history.spec.ts
e2e/tests/admin/shareholder-buy-shares.spec.ts
e2e/tests/admin/shareholder-create.spec.ts
e2e/tests/admin/shareholder-detail-view.spec.ts
e2e/tests/admin/shareholder-edit-company.spec.ts
e2e/tests/admin/shareholder-edit-individual.spec.ts
e2e/tests/admin/shareholder-list.spec.ts
e2e/tests/admin/shareholder-sell-shares.spec.ts
e2e/tests/admin/shareholder-status-readonly.spec.ts'
expect_select "charge cards api" 'apps/api/src/modules/charge-cards/charge-cards.service.ts' \
  'e2e/tests/admin/charge-cards.spec.ts
e2e/tests/public/charge-card-entry.spec.ts
e2e/tests/public/charge-cards-login-redirect.spec.ts
e2e/tests/shareholder/charge-card-entry.spec.ts
e2e/tests/shareholder/charge-cards.spec.ts'
expect_select "shareholder settings page" 'apps/web/src/app/[locale]/dashboard/settings/page.tsx' \
  'e2e/tests/shareholder/settings.spec.ts
e2e/tests/shareholder/mobile-layout.spec.ts'
expect_select "transactions page plus docs" $'docs/a.md\napps/web/src/app/[locale]/dashboard/transactions/page.tsx' \
  'e2e/tests/shareholder/transactions.spec.ts
e2e/tests/shareholder/mobile-layout.spec.ts'
expect_select "renamed spec: old path gone, new path runs" \
  $'e2e/tests/admin/old-name.spec.ts\ne2e/tests/admin/transactions.spec.ts' \
  'e2e/tests/admin/transactions.spec.ts'

# Every selected path must be a plain spec path: the workflow passes the list
# to Playwright through word splitting.
got=$(run 'apps/api/src/modules/admin/admin.controller.ts')
if echo "$got" | tail -n +2 | grep -qvE '^e2e/tests/[A-Za-z0-9/._-]+\.spec\.ts$'; then
  echo "FAIL output holds a path that is not a plain spec path" >&2
  CODE=1
else
  echo "ok   output is plain spec paths"
fi

# --- Fixture trees for the fail-open cases ----------------------------------
FIX=$(mktemp -d)
trap 'rm -rf "$FIX"' EXIT

# fixture <name> <map body>: a tree with two specs, one of them @smoke.
fixture() {
  local root="$FIX/$1"
  mkdir -p "$root/.github/scripts" "$root/e2e/tests/a"
  printf "test('x', { tag: '@smoke' }, async () => {});\n" > "$root/e2e/tests/a/smoke.spec.ts"
  printf "test('y', async () => {});\n" > "$root/e2e/tests/a/other.spec.ts"
  printf '%s\n' "$2" > "$root/.github/scripts/e2e-path-map.txt"
  echo "$root"
}

expect_fixture() {
  local name="$1" root="$2" want="$3" got
  got=$(printf '%s' "$4" | E2E_SELECT_ROOT="$root" bash "$SCRIPT" 2>/dev/null)
  if [ "$got" = "$want" ]; then
    echo "ok   $name"
  else
    echo "FAIL $name: want [$want], got [$got]" >&2
    CODE=1
  fi
}

root=$(fixture ok 'src/a/* e2e/tests/a/other.spec.ts
src/b/* -')
expect_fixture "fixture: mapped path selects" "$root" \
  $'mode=select\ne2e/tests/a/smoke.spec.ts' 'src/b/x.ts'
expect_fixture "fixture: map selecting every spec runs full" "$root" 'mode=full' 'src/a/x.ts'

root=$(fixture stale 'src/a/* e2e/tests/a/renamed-away.spec.ts')
expect_fixture "fixture: stale map pattern runs full" "$root" 'mode=full' 'src/b/x.ts'

root=$(fixture norules '# only a comment')
expect_fixture "fixture: empty map runs full" "$root" 'mode=full' 'src/a/x.ts'

root=$(fixture nospecs 'src/a/*')
expect_fixture "fixture: rule without specs runs full" "$root" 'mode=full' 'src/a/x.ts'

root=$(fixture nosmoke 'src/* -')
rm "$root/e2e/tests/a/smoke.spec.ts"
expect_fixture "fixture: no @smoke test runs full" "$root" 'mode=full' 'src/a/x.ts'

root=$(fixture big 'src/* -')
expect_fixture "fixture: 3000 changed files runs full" "$root" 'mode=full' \
  "$(for i in $(seq 1 3000); do echo "src/f$i.ts"; done)"

exit "$CODE"
