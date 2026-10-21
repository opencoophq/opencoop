#!/usr/bin/env bash
# Exercises deploy/remote-deploy.sh without a registry or a server.
# shellcheck disable=SC2016 # awk programs are single-quoted on purpose
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
OLD_TAG=$(python3 -c 'print("1"*40)')
NEW_TAG=$(python3 -c 'print("2"*40)')
OLD_DOCS=$(python3 -c 'print("3"*40)')
NEW_DOCS=$(python3 -c 'print("4"*40)')

LAST_TMP=""
CODE=0

fail() {
  echo "FAIL: $*" >&2
  if [ -n "$LAST_TMP" ] && [ -d "$LAST_TMP" ]; then
    echo "---- stdout ----" >&2
    cat "$LAST_TMP/stdout" >&2 || true
    echo "---- stderr ----" >&2
    cat "$LAST_TMP/stderr" >&2 || true
    echo "---- docker log ----" >&2
    cat "$LAST_TMP/fake.log" >&2 || true
  fi
  exit 1
}

assert() {
  if ! "$@"; then
    fail "assertion failed: $*"
  fi
}

cleanup_case() {
  if [ -n "$LAST_TMP" ] && [ -d "$LAST_TMP" ]; then
    rm -rf "$LAST_TMP"
  fi
  LAST_TMP=""
  unset DEPLOY_DIR DEPLOY_TAG DEPLOY_ENV_KEY DEPLOY_PULL_SERVICES DEPLOY_UP_SERVICES DEPLOY_VERIFY DEPLOY_HEALTH_URL || true
  unset FAKE_PULL_FAILURES FAKE_UP_FAIL FAKE_IMAGE_MISSING FAKE_DIGEST FAKE_IMAGE_TAG || true
  unset FAKE_BAD_CONTAINER_ID FAKE_API_STATUS FAKE_MIGRATE_STATUS FAKE_MIGRATE_CODE || true
  unset FAKE_MULTI_API FAKE_CONFIG_SUFFIX FAKE_CURL_FAIL FAKE_WEB_STATUS FAKE_DOCS_STATUS || true
}

prepare_case() {
  cleanup_case
  LAST_TMP=$(mktemp -d)
  mkdir -p "$LAST_TMP/bin" "$LAST_TMP/home/opencoop/acc" "$LAST_TMP/home/opencoop/prod" "$LAST_TMP/state"
  touch "$LAST_TMP/fake.log" "$LAST_TMP/stdout" "$LAST_TMP/stderr"
  for dir in acc prod; do
    cat > "$LAST_TMP/home/opencoop/${dir}/.env" <<EOF
TAG=${OLD_TAG}
DOCS_TAG=${OLD_DOCS}
GHCR_OWNER=opencoophq
SMTP_PASS=SUPERSECRETVALUE
POSTGRES_PASSWORD=SUPERSECRETVALUE
DATABASE_URL=postgresql://opencoop:SUPERSECRETVALUE@postgres:5432/opencoop
EOF
    chmod 600 "$LAST_TMP/home/opencoop/${dir}/.env"
  done

  cat > "$LAST_TMP/bin/docker" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail

file_val() {
  local key="$1"
  if [ ! -f .env ]; then
    return 0
  fi
  awk -v key="$key" 'index($0, key "=")==1 { print substr($0, length(key)+2); exit }' .env
}

log() {
  printf 'cmd=%s envTAG=%s envDOCS=%s fileTAG=%s fileDOCS=%s args=%s\n' \
    "$1" "${TAG:-}" "${DOCS_TAG:-}" "$(file_val TAG)" "$(file_val DOCS_TAG)" "${2:-}" \
    >> "${FAKE_LOG}"
}

id_for() {
  case "$1" in
    api) printf '%s\n' 'sha256:1111111111111111111111111111111111111111111111111111111111111111' ;;
    web) printf '%s\n' 'sha256:2222222222222222222222222222222222222222222222222222222222222222' ;;
    migrate) printf '%s\n' 'sha256:3333333333333333333333333333333333333333333333333333333333333333' ;;
    docs) printf '%s\n' 'sha256:4444444444444444444444444444444444444444444444444444444444444444' ;;
    *) echo "unknown service $1" >&2; exit 1 ;;
  esac
}

svc_from_cid() {
  local svc="${1#cid-}"
  svc="${svc%-old}"
  svc="${svc%-new}"
  printf '%s\n' "$svc"
}

svc_from_ref() {
  local base="${1%%@*}"
  local repo="${base%:*}"
  printf '%s\n' "${repo##*opencoop-}"
}

if [ "${1:-}" = compose ]; then
  sub="${2:-}"
  shift 2
  case "$sub" in
    pull)
      log pull "$*"
      state="${FAKE_STATE}/pull_remaining"
      if [ ! -f "$state" ]; then
        printf '%s\n' "${FAKE_PULL_FAILURES:-0}" > "$state"
      fi
      remaining=$(cat "$state")
      if [ "$remaining" -gt 0 ]; then
        printf '%s\n' "$((remaining - 1))" > "$state"
        echo "fake registry timeout" >&2
        exit 1
      fi
      exit 0
      ;;
    up)
      log up "$*"
      if [ "${FAKE_UP_FAIL:-0}" = 1 ]; then
        echo "fake up failure" >&2
        exit 1
      fi
      exit 0
      ;;
    ps)
      log ps "$*"
      svc=""
      for arg in "$@"; do
        case "$arg" in
          -*) ;;
          *) svc="$arg" ;;
        esac
      done
      if [ "$svc" = api ] && [ "${FAKE_MULTI_API:-0}" = 1 ]; then
        printf '%s\n' cid-api-old cid-api-new
      else
        printf '%s\n' "cid-${svc}"
      fi
      exit 0
      ;;
    *)
      echo "unexpected compose ${sub} $*" >&2
      exit 1
      ;;
  esac
fi

if [ "${1:-}" = inspect ]; then
  format="${3:-}"
  cid="${4:-}"
  log inspect "${format} ${cid}"
  svc=$(svc_from_cid "$cid")
  case "$format" in
    '{{.Created}}')
      if [ "$cid" = cid-api-old ]; then
        printf '%s\n' '2020-01-01T00:00:00.000000000Z'
      else
        printf '%s\n' '2026-10-21T12:00:00.000000000Z'
      fi
      ;;
    '{{.Config.Image}}')
      if [ "$cid" = cid-api-old ]; then
        printf '%s\n' "ghcr.io/opencoophq/opencoop-api:${FAKE_OLD_TAG}"
      else
        image="ghcr.io/opencoophq/opencoop-${svc}:${FAKE_IMAGE_TAG:-$DEPLOY_TAG}"
        printf '%s\n' "${image}${FAKE_CONFIG_SUFFIX:-}"
      fi
      ;;
    '{{.Image}}')
      if [ "$cid" = cid-api-old ]; then
        printf '%s\n' 'sha256:9999999999999999999999999999999999999999999999999999999999999999'
      elif [ -n "${FAKE_BAD_CONTAINER_ID:-}" ]; then
        printf '%s\n' "$FAKE_BAD_CONTAINER_ID"
      else
        id_for "$svc"
      fi
      ;;
    '{{.State.Status}}')
      case "$svc" in
        api) printf '%s\n' "${FAKE_API_STATUS:-running}" ;;
        web) printf '%s\n' "${FAKE_WEB_STATUS:-running}" ;;
        migrate) printf '%s\n' "${FAKE_MIGRATE_STATUS:-exited}" ;;
        docs) printf '%s\n' "${FAKE_DOCS_STATUS:-running}" ;;
        *) echo "no status for ${svc}" >&2; exit 1 ;;
      esac
      ;;
    '{{.State.ExitCode}}')
      if [ "$svc" = migrate ]; then
        printf '%s\n' "${FAKE_MIGRATE_CODE:-0}"
      else
        printf '%s\n' 0
      fi
      ;;
    *)
      echo "unexpected inspect format ${format}" >&2
      exit 1
      ;;
  esac
  exit 0
fi

if [ "${1:-}" = image ] && [ "${2:-}" = inspect ]; then
  format="${4:-}"
  ref="${5:-}"
  log image-inspect "${format} ${ref}"
  if [ "${FAKE_IMAGE_MISSING:-0}" = 1 ]; then
    echo "Error: No such image: ${ref}" >&2
    exit 1
  fi
  svc=$(svc_from_ref "$ref")
  case "$format" in
    '{{.Id}}')
      id_for "$svc"
      ;;
    '{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}')
      if [ "${FAKE_DIGEST:-}" = none ]; then
        exit 0
      fi
      base="${ref%%@*}"
      repo="${base%:*}"
      printf '%s\n' "${repo}@sha256:abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd"
      ;;
    *)
      echo "unexpected image inspect format ${format}" >&2
      exit 1
      ;;
  esac
  exit 0
fi

echo "unexpected docker invocation: $*" >&2
exit 1
STUB

  cat > "$LAST_TMP/bin/curl" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf 'cmd=curl args=%s\n' "$*" >> "${FAKE_LOG}"
if [ "${FAKE_CURL_FAIL:-0}" = 1 ]; then
  echo "fake health failure" >&2
  exit 22
fi
exit 0
STUB
  chmod 755 "$LAST_TMP/bin/docker" "$LAST_TMP/bin/curl"

  export PULL_MAX_ATTEMPTS=5
  export PULL_RETRY_DELAY_SECONDS=0
  export HEALTH_ATTEMPTS=30
  export HEALTH_DELAY_SECONDS=0
  export MIGRATE_WAIT_ATTEMPTS=30
  export MIGRATE_WAIT_DELAY_SECONDS=0
  export FAKE_LOG="$LAST_TMP/fake.log"
  export FAKE_STATE="$LAST_TMP/state"
  export FAKE_OLD_TAG="$OLD_TAG"
  export HOME="$LAST_TMP/home"
  export PATH="$LAST_TMP/bin:${PATH}"
}

invoke() {
  local mode="$1"
  local target="${ROOT}/deploy/remote-deploy.sh"
  if [ "$mode" = wrapper ]; then
    bash "${ROOT}/deploy/wrap-remote-deploy.sh" "$LAST_TMP/wrapped.sh"
    python3 -c 'import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_text(p.read_text().strip())' "$LAST_TMP/wrapped.sh"
    target="$LAST_TMP/wrapped.sh"
  fi
  set +e
  if [ "$mode" = wrapper ]; then
    sh "$target" >"$LAST_TMP/stdout" 2>"$LAST_TMP/stderr"
  else
    bash "$target" >"$LAST_TMP/stdout" 2>"$LAST_TMP/stderr"
  fi
  CODE=$?
  set -e
}

env_file() {
  printf '%s\n' "$LAST_TMP/home/opencoop/$1/.env"
}

read_key() {
  local key="$1"
  local file="$2"
  awk -v key="$key" 'index($0, key "=")==1 { print substr($0, length(key)+2); exit }' "$file"
}

count_log() {
  awk -v m="$1" 'index($0, m) { c++ } END { print c+0 }' "$LAST_TMP/fake.log"
}

first_line() {
  awk -v m="$1" 'index($0, m) { print NR; exit }' "$LAST_TMP/fake.log"
}

assert_no_secrets() {
  if grep -q SUPERSECRET "$LAST_TMP/stdout" "$LAST_TMP/stderr" "$LAST_TMP/fake.log"; then
    fail "secret from .env leaked into logs"
  fi
  local leftovers
  leftovers=$(find "$LAST_TMP/home" -name '.env.tmp.*' -print)
  if [ -n "$leftovers" ]; then
    fail "left .env temp files behind: ${leftovers}"
  fi
}

assert_mode_600() {
  local mode
  mode=$(stat -c '%a' "$(env_file "$1")")
  if [ "$mode" != 600 ]; then
    fail "$1 .env mode is ${mode}, expected 600"
  fi
}

app_env() {
  export DEPLOY_DIR="${1:-acc}"
  export DEPLOY_TAG="$NEW_TAG"
  export DEPLOY_ENV_KEY=TAG
  export DEPLOY_PULL_SERVICES=""
  export DEPLOY_UP_SERVICES=""
  export DEPLOY_VERIFY="api:running web:running migrate:exited0"
  export DEPLOY_HEALTH_URL="https://acc.opencoop.be/api/health"
  if [ "$DEPLOY_DIR" = prod ]; then
    export DEPLOY_HEALTH_URL="https://opencoop.be/api/health"
  fi
}

assert_app_success() {
  local dir="$1"
  assert [ "$CODE" -eq 0 ]
  assert_no_secrets
  assert_mode_600 "$dir"
  local file
  file=$(env_file "$dir")
  assert [ "$(read_key TAG "$file")" = "$NEW_TAG" ]
  assert [ "$(read_key DOCS_TAG "$file")" = "$OLD_DOCS" ]
  assert grep -q '^SMTP_PASS=SUPERSECRETVALUE$' "$file"
  assert grep -q 'SUPERSECRETVALUE@postgres' "$file"
  assert [ "$(count_log 'cmd=pull ')" -eq 3 ]
  assert [ "$(count_log 'cmd=up ')" -eq 1 ]
  assert [ "$(count_log 'cmd=curl ')" -eq 1 ]
  assert awk -v new="$NEW_TAG" -v old="$OLD_TAG" '
    index($0, "cmd=pull ") {
      if (index($0, "envTAG=" new) == 0 || index($0, "fileTAG=" old) == 0) exit 1
      if ($0 !~ /args=$/) exit 1
      n++
    }
    END { if (n < 1) exit 1 }
  ' "$LAST_TMP/fake.log"
  assert awk -v new="$NEW_TAG" '
    index($0, "cmd=up ") {
      if (index($0, "envTAG=" new) == 0 || index($0, "fileTAG=" new) == 0) exit 1
      if ($0 !~ /args=-d$/) exit 1
      found=1
    }
    END { if (!found) exit 1 }
  ' "$LAST_TMP/fake.log"
  local pull_line pre_line up_line ps_line curl_line
  pull_line=$(first_line 'cmd=pull ')
  pre_line=$(first_line 'cmd=image-inspect ')
  up_line=$(first_line 'cmd=up ')
  ps_line=$(first_line 'cmd=ps ')
  curl_line=$(first_line 'cmd=curl ')
  assert [ -n "$pull_line" ]
  assert [ -n "$pre_line" ]
  assert [ -n "$up_line" ]
  assert [ -n "$ps_line" ]
  assert [ -n "$curl_line" ]
  assert [ "$pull_line" -lt "$pre_line" ]
  assert [ "$pre_line" -lt "$up_line" ]
  assert [ "$up_line" -lt "$ps_line" ]
  assert [ "$ps_line" -lt "$curl_line" ]
  assert awk -v old="$OLD_TAG" -v new="$NEW_TAG" '
    index($0, "cmd=up ") { seen_up=1 }
    index($0, "cmd=image-inspect ") {
      if (!seen_up && index($0, "fileTAG=" old) == 0) exit 1
      if (seen_up && index($0, "fileTAG=" new) == 0) exit 1
    }
  ' "$LAST_TMP/fake.log"
  assert awk '
    /api verified/ { api=NR }
    /web verified/ { web=NR }
    /migrate verified/ { mig=NR }
    /healthcheck passed/ { health=NR }
    END {
      if (!(api && web && mig && health)) exit 1
      if (!(api < health && web < health && mig < health)) exit 1
    }
  ' "$LAST_TMP/stdout"
  if grep -q 'Restoring ' "$LAST_TMP/stdout"; then
    fail "successful deploy restored the tag"
  fi
  assert grep -q 'https://acc.opencoop.be/api/health' "$LAST_TMP/fake.log"
}

test_app_success() {
  prepare_case
  export FAKE_PULL_FAILURES=2
  export FAKE_MULTI_API=1
  app_env acc
  invoke bash
  assert_app_success acc
  cleanup_case
  echo "ok app success with pull retries"
}

test_app_success_via_dash_wrapper() {
  prepare_case
  export FAKE_PULL_FAILURES=2
  export FAKE_MULTI_API=1
  app_env acc
  invoke wrapper
  assert_app_success acc
  assert grep -q 'exec bash --noprofile --norc -euo pipefail -s' "$LAST_TMP/wrapped.sh"
  assert grep -q 'set -euo pipefail' "$LAST_TMP/wrapped.sh"
  cleanup_case
  echo "ok dash wrapper"
}

test_config_image_with_digest() {
  prepare_case
  export FAKE_CONFIG_SUFFIX='@sha256:deadbeef'
  app_env acc
  invoke bash
  assert [ "$CODE" -eq 0 ]
  assert_no_secrets
  assert grep -q 'opencoop-api:'"$NEW_TAG"'@sha256:deadbeef' "$LAST_TMP/stdout"
  assert [ "$(read_key TAG "$(env_file acc)")" = "$NEW_TAG" ]
  cleanup_case
  echo "ok config image digest form"
}

test_pull_gives_up() {
  prepare_case
  export FAKE_PULL_FAILURES=5
  app_env acc
  invoke bash
  assert [ "$CODE" -eq 1 ]
  assert_no_secrets
  assert_mode_600 acc
  assert [ "$(read_key TAG "$(env_file acc)")" = "$OLD_TAG" ]
  assert [ "$(count_log 'cmd=pull ')" -eq 5 ]
  assert [ "$(count_log 'cmd=up ')" -eq 0 ]
  assert [ "$(count_log 'cmd=curl ')" -eq 0 ]
  assert [ "$(count_log 'cmd=image-inspect ')" -eq 0 ]
  assert grep -q 'docker compose pull failed after 5 attempts' "$LAST_TMP/stdout"
  if grep -q 'Restoring ' "$LAST_TMP/stdout"; then
    fail "pull failure rewrote .env"
  fi
  cleanup_case
  echo "ok pull failure leaves TAG unchanged"
}

test_image_missing_after_pull() {
  prepare_case
  export FAKE_IMAGE_MISSING=1
  app_env acc
  invoke bash
  assert [ "$CODE" -eq 1 ]
  assert_no_secrets
  assert [ "$(read_key TAG "$(env_file acc)")" = "$OLD_TAG" ]
  assert [ "$(count_log 'cmd=up ')" -eq 0 ]
  assert [ "$(count_log 'cmd=curl ')" -eq 0 ]
  assert grep -q 'not present locally after pull' "$LAST_TMP/stdout"
  cleanup_case
  echo "ok missing image does not publish TAG"
}

test_missing_digest_after_pull() {
  prepare_case
  export FAKE_DIGEST=none
  app_env acc
  invoke bash
  assert [ "$CODE" -eq 1 ]
  assert_no_secrets
  assert [ "$(read_key TAG "$(env_file acc)")" = "$OLD_TAG" ]
  assert [ "$(count_log 'cmd=up ')" -eq 0 ]
  assert [ "$(count_log 'cmd=curl ')" -eq 0 ]
  assert grep -q 'no registry digest after pull' "$LAST_TMP/stdout"
  cleanup_case
  echo "ok missing digest does not publish TAG"
}

test_up_failure_restores_tag() {
  prepare_case
  awk -v old='latest' 'index($0, "TAG=")==1 { print "TAG=" old; next } { print }' \
    "$(env_file acc)" > "$LAST_TMP/env.new"
  mv "$LAST_TMP/env.new" "$(env_file acc)"
  chmod 600 "$(env_file acc)"
  export FAKE_UP_FAIL=1
  app_env acc
  invoke bash
  assert [ "$CODE" -eq 1 ]
  assert_no_secrets
  assert_mode_600 acc
  assert [ "$(read_key TAG "$(env_file acc)")" = latest ]
  assert [ "$(count_log 'cmd=up ')" -eq 1 ]
  assert [ "$(count_log 'cmd=curl ')" -eq 0 ]
  assert [ "$(count_log 'cmd=ps ')" -eq 0 ]
  assert awk -v new="$NEW_TAG" '
    index($0, "cmd=up ") {
      if (index($0, "fileTAG=" new) == 0) exit 1
      found=1
    }
    END { if (!found) exit 1 }
  ' "$LAST_TMP/fake.log"
  assert grep -q 'Restoring TAG' "$LAST_TMP/stdout"
  assert grep -q '^SMTP_PASS=SUPERSECRETVALUE$' "$(env_file acc)"
  cleanup_case
  echo "ok up failure restores TAG"
}

test_wrong_image_tag() {
  prepare_case
  export FAKE_IMAGE_TAG="$OLD_TAG"
  app_env acc
  invoke bash
  assert [ "$CODE" -eq 1 ]
  assert_no_secrets
  assert [ "$(read_key TAG "$(env_file acc)")" = "$OLD_TAG" ]
  assert [ "$(count_log 'cmd=curl ')" -eq 0 ]
  assert [ "$(count_log 'cmd=ps ')" -ge 1 ]
  assert grep -q 'Restoring TAG' "$LAST_TMP/stdout"
  assert grep -q "expected ghcr.io/opencoophq/opencoop-api:${NEW_TAG}" "$LAST_TMP/stdout"
  if grep -q 'healthcheck passed' "$LAST_TMP/stdout"; then
    fail "healthcheck ran after a bad image"
  fi
  cleanup_case
  echo "ok wrong image tag fails before healthcheck"
}

test_image_id_mismatch() {
  prepare_case
  export FAKE_BAD_CONTAINER_ID='sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
  app_env acc
  invoke bash
  assert [ "$CODE" -eq 1 ]
  assert_no_secrets
  assert [ "$(read_key TAG "$(env_file acc)")" = "$OLD_TAG" ]
  assert [ "$(count_log 'cmd=curl ')" -eq 0 ]
  assert grep -q 'does not match' "$LAST_TMP/stdout"
  cleanup_case
  echo "ok image id mismatch"
}

test_api_not_running() {
  prepare_case
  export FAKE_API_STATUS=exited
  app_env acc
  invoke bash
  assert [ "$CODE" -eq 1 ]
  assert_no_secrets
  assert [ "$(read_key TAG "$(env_file acc)")" = "$OLD_TAG" ]
  assert [ "$(count_log 'cmd=curl ')" -eq 0 ]
  assert grep -q 'expected running' "$LAST_TMP/stdout"
  cleanup_case
  echo "ok stopped api fails before healthcheck"
}

test_migrate_failed() {
  prepare_case
  export FAKE_MIGRATE_STATUS=exited
  export FAKE_MIGRATE_CODE=1
  export MIGRATE_WAIT_ATTEMPTS=1
  app_env acc
  invoke bash
  assert [ "$CODE" -eq 1 ]
  assert_no_secrets
  assert [ "$(read_key TAG "$(env_file acc)")" = "$OLD_TAG" ]
  assert [ "$(count_log 'cmd=curl ')" -eq 0 ]
  assert grep -q 'expected exited 0' "$LAST_TMP/stdout"
  cleanup_case
  echo "ok failed migrate fails before healthcheck"
}

test_health_failure_keeps_tag() {
  prepare_case
  export FAKE_CURL_FAIL=1
  export HEALTH_ATTEMPTS=2
  app_env prod
  invoke bash
  assert [ "$CODE" -eq 1 ]
  assert_no_secrets
  assert_mode_600 prod
  assert [ "$(read_key TAG "$(env_file prod)")" = "$NEW_TAG" ]
  assert [ "$(count_log 'cmd=curl ')" -eq 2 ]
  assert grep -q 'did not become healthy' "$LAST_TMP/stdout"
  assert grep -q 'api verified' "$LAST_TMP/stdout"
  if grep -q 'Restoring ' "$LAST_TMP/stdout"; then
    fail "health failure rolled the verified tag back"
  fi
  local ps_line curl_line
  ps_line=$(first_line 'cmd=ps ')
  curl_line=$(first_line 'cmd=curl ')
  assert [ "$ps_line" -lt "$curl_line" ]
  cleanup_case
  echo "ok health failure keeps the verified tag"
}

test_docs_success() {
  prepare_case
  export DEPLOY_DIR=prod
  export DEPLOY_TAG="$NEW_DOCS"
  export DEPLOY_ENV_KEY=DOCS_TAG
  export DEPLOY_PULL_SERVICES=docs
  export DEPLOY_UP_SERVICES=docs
  export DEPLOY_VERIFY=docs:running
  unset DEPLOY_HEALTH_URL
  invoke bash
  assert [ "$CODE" -eq 0 ]
  assert_no_secrets
  assert_mode_600 prod
  local file
  file=$(env_file prod)
  assert [ "$(read_key DOCS_TAG "$file")" = "$NEW_DOCS" ]
  assert [ "$(read_key TAG "$file")" = "$OLD_TAG" ]
  assert [ "$(count_log 'cmd=curl ')" -eq 0 ]
  assert [ "$(count_log 'cmd=pull ')" -eq 1 ]
  assert awk -v new="$NEW_DOCS" -v old="$OLD_DOCS" -v app="$OLD_TAG" '
    index($0, "cmd=pull ") {
      if (index($0, "envDOCS=" new) == 0 || index($0, "fileDOCS=" old) == 0) exit 1
      if (index($0, "fileTAG=" app) == 0) exit 1
      if ($0 !~ /args=docs$/) exit 1
      pulls++
    }
    index($0, "cmd=up ") {
      if (index($0, "fileDOCS=" new) == 0 || index($0, "envDOCS=" new) == 0) exit 1
      if (index($0, "fileTAG=" app) == 0) exit 1
      if ($0 !~ /args=-d docs$/) exit 1
      ups++
    }
    END { if (pulls != 1 || ups != 1) exit 1 }
  ' "$LAST_TMP/fake.log"
  assert grep -q 'docs verified' "$LAST_TMP/stdout"
  assert grep -q 'No HTTP healthcheck configured' "$LAST_TMP/stdout"
  if grep -q 'Restoring ' "$LAST_TMP/stdout"; then
    fail "docs success restored DOCS_TAG"
  fi
  cleanup_case
  echo "ok docs deploy"
}

test_rejects_bad_input_without_touching_env() {
  prepare_case
  app_env acc
  export DEPLOY_TAG='not-a-sha'
  invoke bash
  assert [ "$CODE" -eq 1 ]
  assert_no_secrets
  assert [ "$(read_key TAG "$(env_file acc)")" = "$OLD_TAG" ]
  assert [ "$(count_log 'cmd=pull ')" -eq 0 ]
  assert grep -q '40-character git sha' "$LAST_TMP/stdout"

  export DEPLOY_TAG="$NEW_TAG"
  export DEPLOY_HEALTH_URL='https://example.invalid/api/health'
  invoke bash
  assert [ "$CODE" -eq 1 ]
  assert [ "$(count_log 'cmd=pull ')" -eq 0 ]
  assert grep -q 'DEPLOY_HEALTH_URL is not allowed' "$LAST_TMP/stdout"

  export DEPLOY_HEALTH_URL='https://acc.opencoop.be/api/health'
  export DEPLOY_VERIFY='docs:running'
  invoke bash
  assert [ "$CODE" -eq 1 ]
  assert [ "$(count_log 'cmd=pull ')" -eq 0 ]
  assert grep -q 'does not match' "$LAST_TMP/stdout"

  awk 'index($0, "GHCR_OWNER=")==1 { next } { print }' "$(env_file acc)" > "$LAST_TMP/env.new"
  mv "$LAST_TMP/env.new" "$(env_file acc)"
  chmod 600 "$(env_file acc)"
  export DEPLOY_VERIFY='api:running web:running migrate:exited0'
  invoke bash
  assert [ "$CODE" -eq 1 ]
  assert [ "$(count_log 'cmd=pull ')" -eq 0 ]
  assert grep -q 'GHCR_OWNER is missing or unsafe' "$LAST_TMP/stdout"

  printf 'TAG=%s\nDOCS_TAG=%s\nGHCR_OWNER=opencoophq\nSMTP_PASS=SUPERSECRETVALUE\n' 'evil value' "$OLD_DOCS" > "$(env_file acc)"
  chmod 600 "$(env_file acc)"
  invoke bash
  assert [ "$CODE" -eq 1 ]
  assert [ "$(count_log 'cmd=pull ')" -eq 0 ]
  assert grep -q 'previous TAG is missing or unsafe' "$LAST_TMP/stdout"
  if grep -q 'evil value' "$LAST_TMP/stdout" "$LAST_TMP/stderr" "$LAST_TMP/fake.log"; then
    fail "unsafe previous tag was printed"
  fi
  cleanup_case
  echo "ok bad input is rejected"
}

test_static_contracts() {
  bash -n "${ROOT}/deploy/remote-deploy.sh"
  bash -n "${ROOT}/deploy/wrap-remote-deploy.sh"
  assert grep -q 'set -euo pipefail' "${ROOT}/deploy/remote-deploy.sh"
  if grep -nE 'set -x|docker compose config' "${ROOT}/deploy/remote-deploy.sh"; then
    fail "deploy script would trace or interpolate secrets"
  fi
  if grep -nE "s/\\^TAG=|s/\\^DOCS_TAG=" \
    "${ROOT}/.github/workflows/build-deploy.yml" \
    "${ROOT}/.github/workflows/docs-deploy.yml"; then
    fail "workflow still rewrites the tag before pull"
  fi
  if grep -nE '^[[:space:]]*debug:|^[[:space:]]*allenvs:' \
    "${ROOT}/.github/workflows/build-deploy.yml" \
    "${ROOT}/.github/workflows/docs-deploy.yml" \
    "${ROOT}/.github/actions/remote-deploy/action.yml"; then
    fail "ssh debug or allenvs would leak the environment"
  fi
  assert grep -q 'script_path:' "${ROOT}/.github/actions/remote-deploy/action.yml"
  assert grep -q 'command_timeout:' "${ROOT}/.github/actions/remote-deploy/action.yml"
  assert grep -q 'health_url: https://acc.opencoop.be/api/health' "${ROOT}/.github/workflows/build-deploy.yml"
  assert grep -q 'health_url: https://opencoop.be/api/health' "${ROOT}/.github/workflows/build-deploy.yml"
  assert grep -q 'pull_services: docs' "${ROOT}/.github/workflows/docs-deploy.yml"
  command -v flock >/dev/null
  echo "ok static contracts"
}

trap 'cleanup_case' EXIT

test_static_contracts
test_app_success
test_app_success_via_dash_wrapper
test_config_image_with_digest
test_pull_gives_up
test_image_missing_after_pull
test_missing_digest_after_pull
test_up_failure_restores_tag
test_wrong_image_tag
test_image_id_mismatch
test_api_not_running
test_migrate_failed
test_health_failure_keeps_tag
test_docs_success
test_rejects_bad_input_without_touching_env

echo "all remote deploy tests passed"
