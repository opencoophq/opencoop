#!/usr/bin/env bash
# Remote deploy for acc, prod, and docs.
#
# Invoked over SSH by appleboy/ssh-action (see .github/actions/remote-deploy).
# The action's login shell may be dash, which has no pipefail; wrap-remote-deploy.sh
# re-execs this file under bash. The flags below are the actual guard.
#
# .env on the server holds secrets. This script may rewrite TAG or DOCS_TAG only.
# It must not print the file, enable xtrace, or render the interpolated compose file.

set -euo pipefail

tag_written=0
release_activated=0
prev_tag=""
ENV_TMP=""
IMAGE_OWNER=""

die() {
  echo "::error::$*"
  exit 1
}

require_shell_flags() {
  case $- in
    *e*) ;;
    *) die "remote shell is missing errexit (set -e)" ;;
  esac
  case $- in
    *u*) ;;
    *) die "remote shell is missing nounset (set -u)" ;;
  esac
  local pipefail_on=0 line
  while IFS= read -r line; do
    case "$line" in
      pipefail*on) pipefail_on=1 ;;
    esac
  done <<< "$(set -o)"
  if [ "$pipefail_on" -ne 1 ]; then
    die "remote shell is missing pipefail (set -o pipefail)"
  fi
}

require_uint() {
  local name="$1"
  local value="$2"
  case "$value" in
    ''|*[!0-9]*) die "${name} must be a positive integer" ;;
  esac
  if [ "$value" -lt 1 ]; then
    die "${name} must be >= 1"
  fi
}

require_nonneg_int() {
  local name="$1"
  local value="$2"
  case "$value" in
    ''|*[!0-9]*) die "${name} must be an integer" ;;
  esac
}

cleanup() {
  local status=$?
  trap - EXIT
  rm_env_tmp
  # Pull failed: .env was never updated. Up/verify failed after the write:
  # put the previous tag back so a later `compose up` cannot target a release
  # whose images were not activated. This rewrites .env only — it does not
  # recreate containers or roll back a migration. Healthcheck failures leave
  # the new tag in place — those containers were already verified.
  if [ "$tag_written" -eq 1 ] && [ "$release_activated" -ne 1 ]; then
    echo "Restoring ${DEPLOY_ENV_KEY} in .env after a failed deploy"
    if ! write_env_key "$prev_tag"; then
      echo "::error::failed to restore ${DEPLOY_ENV_KEY} in .env"
    fi
  fi
  rm_env_tmp
  exit "$status"
}

read_env_value() {
  local key="$1"
  awk -v key="$key" '
    index($0, key "=") == 1 {
      value = substr($0, length(key) + 2)
      sub(/\r$/, "", value)
      print value
      exit
    }
  ' .env
}

rm_env_tmp() {
  if [ -n "${ENV_TMP}" ] && [ -f "${ENV_TMP}" ]; then
    rm -f "${ENV_TMP}" || true
  fi
  ENV_TMP=""
}

write_env_key() {
  local value="$1"
  # Not `.env.*`: envvault treats that pattern as an env file and could commit a leftover.
  ENV_TMP=$(mktemp "./.deploy-envtmp.XXXXXX")
  chmod --reference .env "$ENV_TMP" 2>/dev/null || chmod 600 "$ENV_TMP"
  if ! awk -v key="$DEPLOY_ENV_KEY" -v value="$value" '
    BEGIN { replaced = 0 }
    index($0, key "=") == 1 && replaced == 0 {
      print key "=" value
      replaced = 1
      next
    }
    { print }
    END { if (replaced != 1) exit 1 }
  ' .env > "$ENV_TMP"; then
    rm_env_tmp
    return 1
  fi
  # Called as `write_env_key || exit`, which disables errexit for this function.
  mv "$ENV_TMP" .env || return 1
  ENV_TMP=""
}

compose_with_tag() {
  # Shell env wins over the project .env file. Override only the key this
  # deploy owns so `docker compose pull` can fetch the candidate tag before
  # that tag is persisted. stdin is /dev/null because bash -s is reading this
  # script from stdin; `env` would otherwise hand that stream to docker.
  env "${DEPLOY_ENV_KEY}=${DEPLOY_TAG}" "$@" </dev/null
}

pull_images() {
  local attempt=1
  local delay="$PULL_RETRY_DELAY_SECONDS"
  local -a services=()
  read -r -a services <<< "$DEPLOY_PULL_SERVICES"
  while [ "$attempt" -le "$PULL_MAX_ATTEMPTS" ]; do
    if compose_with_tag docker compose pull "${services[@]}" </dev/null; then
      echo "docker compose pull succeeded on attempt ${attempt}"
      return 0
    fi
    if [ "$attempt" -eq "$PULL_MAX_ATTEMPTS" ]; then
      die "docker compose pull failed after ${PULL_MAX_ATTEMPTS} attempts"
    fi
    echo "docker compose pull failed (attempt ${attempt}/${PULL_MAX_ATTEMPTS}); retrying in ${delay}s"
    sleep "$delay"
    attempt=$((attempt + 1))
    delay=$((delay * 2))
  done
}

require_local_images() {
  local svc expected digest
  local -a services=()
  case "$DEPLOY_ENV_KEY" in
    TAG) services=(api web migrate) ;;
    DOCS_TAG) services=(docs) ;;
  esac
  for svc in "${services[@]}"; do
    expected="ghcr.io/${IMAGE_OWNER}/opencoop-${svc}:${DEPLOY_TAG}"
    if ! digest=$(docker image inspect --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}' "$expected" </dev/null); then
      die "image ${expected} is not present locally after pull"
    fi
    case "$digest" in
      *"@sha256:"*) ;;
      *) die "image ${expected} has no registry digest after pull" ;;
    esac
    echo "pulled ${expected} (${digest})"
  done
}

compose_up() {
  local -a services=()
  read -r -a services <<< "$DEPLOY_UP_SERVICES"
  # --no-deps: only the named services. Postgres, redis, and anything else
  # in the compose file are not started and not recreated. --no-deps also
  # drops depends_on, so an app deploy brings migrate to a successful exit
  # before api and web are recreated.
  if [ "$DEPLOY_UP_SERVICES" = "migrate api web" ]; then
    compose_with_tag docker compose up -d --no-deps migrate </dev/null || return 1
    verify_service migrate exited0 || return 1
    compose_with_tag docker compose up -d --no-deps api web </dev/null || return 1
    return 0
  fi
  compose_with_tag docker compose up -d --no-deps "${services[@]}" </dev/null || return 1
}

newest_container() {
  local svc="$1"
  local cids cid created newest="" newest_created=""
  cids=$(docker compose ps -aq "$svc" </dev/null) || return 1
  if [ -z "$cids" ]; then
    echo "::error::no container for service ${svc}" >&2
    return 1
  fi
  while IFS= read -r cid; do
    [ -n "$cid" ] || continue
    created=$(docker inspect --format '{{.Created}}' "$cid" </dev/null) || return 1
    if [ -z "$newest_created" ] || [ "$created" \> "$newest_created" ]; then
      newest=$cid
      newest_created=$created
    fi
  done <<< "$cids"
  if [ -z "$newest" ]; then
    echo "::error::no container for service ${svc}" >&2
    return 1
  fi
  printf '%s\n' "$newest"
}

verify_service() {
  local svc="$1"
  local mode="$2"
  local cid config_image expected_ref expected_id actual_id digest status exit_code
  local attempts=1
  cid=$(newest_container "$svc") || return 1
  expected_ref="ghcr.io/${IMAGE_OWNER}/opencoop-${svc}:${DEPLOY_TAG}"
  config_image=$(docker inspect --format '{{.Config.Image}}' "$cid" </dev/null) || return 1
  case "$config_image" in
    "$expected_ref"|"${expected_ref}@sha256:"*) ;;
    *)
      echo "::error::${svc} is running ${config_image}, expected ${expected_ref}"
      return 1
      ;;
  esac
  expected_id=$(docker image inspect --format '{{.Id}}' "$expected_ref" </dev/null) || return 1
  actual_id=$(docker inspect --format '{{.Image}}' "$cid" </dev/null) || return 1
  if [ -z "$expected_id" ] || [ "$actual_id" != "$expected_id" ]; then
    echo "::error::${svc} container image ${actual_id} does not match ${expected_ref} (${expected_id})"
    return 1
  fi
  digest=$(docker image inspect --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}' "$expected_ref" </dev/null) || return 1
  case "$digest" in
    *"@sha256:"*) ;;
    *)
      echo "::error::${svc} image ${expected_ref} has no registry digest"
      return 1
      ;;
  esac
  if [ "$mode" = running ]; then
    status=$(docker inspect --format '{{.State.Status}}' "$cid" </dev/null) || return 1
    if [ "$status" != running ]; then
      echo "::error::${svc} status is ${status}, expected running"
      return 1
    fi
  elif [ "$mode" = exited0 ]; then
    while [ "$attempts" -le "$MIGRATE_WAIT_ATTEMPTS" ]; do
      status=$(docker inspect --format '{{.State.Status}}' "$cid" </dev/null) || return 1
      case "$status" in
        running|restarting|created)
          if [ "$attempts" -eq "$MIGRATE_WAIT_ATTEMPTS" ]; then
            break
          fi
          sleep "$MIGRATE_WAIT_DELAY_SECONDS"
          ;;
        *) break ;;
      esac
      attempts=$((attempts + 1))
    done
    exit_code=$(docker inspect --format '{{.State.ExitCode}}' "$cid" </dev/null) || return 1
    if [ "$status" != exited ] || [ "$exit_code" != 0 ]; then
      echo "::error::${svc} status is ${status} exit ${exit_code}, expected exited 0"
      return 1
    fi
  else
    echo "::error::unsupported verify mode ${mode}"
    return 1
  fi
  echo "${svc} verified image=${config_image} digest=${digest} id=${actual_id}"
}

verify_release() {
  local spec svc mode
  local -a specs=()
  read -r -a specs <<< "$DEPLOY_VERIFY"
  for spec in "${specs[@]}"; do
    svc=${spec%%:*}
    mode=${spec#*:}
    if [ -z "$svc" ] || [ "$svc" = "$spec" ] || [ -z "$mode" ]; then
      echo "::error::bad verify spec ${spec}"
      return 1
    fi
    # set -e is off inside this function when the caller uses `||`, so a failed
    # service check must be returned explicitly or later services and the
    # healthcheck would still run.
    verify_service "$svc" "$mode" || return 1
  done
}

wait_healthy() {
  local attempt=1
  if [ -z "${DEPLOY_HEALTH_URL}" ]; then
    echo "No HTTP healthcheck configured"
    return 0
  fi
  echo "Waiting for ${DEPLOY_HEALTH_URL}"
  while [ "$attempt" -le "$HEALTH_ATTEMPTS" ]; do
    if curl -fsS --max-time 5 "$DEPLOY_HEALTH_URL" </dev/null >/dev/null 2>&1; then
      echo "healthcheck passed"
      return 0
    fi
    if [ "$attempt" -eq "$HEALTH_ATTEMPTS" ]; then
      break
    fi
    sleep "$HEALTH_DELAY_SECONDS"
    attempt=$((attempt + 1))
  done
  die "service did not become healthy after deploy"
}

PULL_MAX_ATTEMPTS="${PULL_MAX_ATTEMPTS:-5}"
PULL_RETRY_DELAY_SECONDS="${PULL_RETRY_DELAY_SECONDS:-10}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-30}"
HEALTH_DELAY_SECONDS="${HEALTH_DELAY_SECONDS:-2}"
MIGRATE_WAIT_ATTEMPTS="${MIGRATE_WAIT_ATTEMPTS:-300}"
MIGRATE_WAIT_DELAY_SECONDS="${MIGRATE_WAIT_DELAY_SECONDS:-2}"

require_shell_flags
require_uint PULL_MAX_ATTEMPTS "$PULL_MAX_ATTEMPTS"
require_nonneg_int PULL_RETRY_DELAY_SECONDS "$PULL_RETRY_DELAY_SECONDS"
require_uint HEALTH_ATTEMPTS "$HEALTH_ATTEMPTS"
require_nonneg_int HEALTH_DELAY_SECONDS "$HEALTH_DELAY_SECONDS"
require_uint MIGRATE_WAIT_ATTEMPTS "$MIGRATE_WAIT_ATTEMPTS"
require_nonneg_int MIGRATE_WAIT_DELAY_SECONDS "$MIGRATE_WAIT_DELAY_SECONDS"

if [ -z "${DEPLOY_DIR:-}" ]; then
  die "DEPLOY_DIR is required"
fi
case "$DEPLOY_DIR" in
  acc|prod) ;;
  *) die "DEPLOY_DIR must be acc or prod" ;;
esac
if [ -z "${DEPLOY_ENV_KEY:-}" ]; then
  die "DEPLOY_ENV_KEY is required"
fi
case "$DEPLOY_ENV_KEY" in
  TAG|DOCS_TAG) ;;
  *) die "DEPLOY_ENV_KEY must be TAG or DOCS_TAG" ;;
esac
if [ -z "${DEPLOY_TAG:-}" ]; then
  die "DEPLOY_TAG is required"
fi
case "$DEPLOY_TAG" in
  *[!0-9a-f]*) die "DEPLOY_TAG must be a 40-character git sha" ;;
esac
if [ "${#DEPLOY_TAG}" -ne 40 ]; then
  die "DEPLOY_TAG must be a 40-character git sha"
fi
case "${DEPLOY_PULL_SERVICES:-}" in
  "migrate api web"|docs) ;;
  *) die "DEPLOY_PULL_SERVICES must be 'migrate api web' or docs" ;;
esac
case "${DEPLOY_UP_SERVICES:-}" in
  "migrate api web"|docs) ;;
  *) die "DEPLOY_UP_SERVICES must be 'migrate api web' or docs" ;;
esac
if [ "$DEPLOY_PULL_SERVICES" != "$DEPLOY_UP_SERVICES" ]; then
  die "DEPLOY_PULL_SERVICES and DEPLOY_UP_SERVICES must match"
fi
case "${DEPLOY_VERIFY:-}" in
  "api:running web:running migrate:exited0"|"docs:running") ;;
  *) die "DEPLOY_VERIFY is not a known service list" ;;
esac
case "${DEPLOY_HEALTH_URL:-}" in
  ""|https://acc.opencoop.be/api/health|https://opencoop.be/api/health) ;;
  *) die "DEPLOY_HEALTH_URL is not allowed" ;;
esac
DEPLOY_PULL_SERVICES="${DEPLOY_PULL_SERVICES:-}"
DEPLOY_UP_SERVICES="${DEPLOY_UP_SERVICES:-}"
DEPLOY_HEALTH_URL="${DEPLOY_HEALTH_URL:-}"

# Cross-check the key against the service list so a docs run cannot rewrite TAG.
case "${DEPLOY_ENV_KEY}:${DEPLOY_VERIFY}" in
  TAG:"api:running web:running migrate:exited0"|DOCS_TAG:docs:running) ;;
  *) die "DEPLOY_ENV_KEY does not match DEPLOY_VERIFY" ;;
esac
case "${DEPLOY_ENV_KEY}:${DEPLOY_PULL_SERVICES}" in
  "TAG:migrate api web"|DOCS_TAG:docs) ;;
  *) die "DEPLOY_ENV_KEY does not match the compose services" ;;
esac

export COMPOSE_ANSI=never

cd "${HOME}/opencoop/${DEPLOY_DIR}"
if [ ! -f .env ]; then
  die ".env not found in ${HOME}/opencoop/${DEPLOY_DIR}"
fi

# ~/opencoop/<env> sits inside the envvault git repo in ~. A lock file there shows up as untracked.
exec 9>"/tmp/opencoop-deploy-${DEPLOY_DIR}.lock"
if ! flock -w 600 9; then
  die "timed out waiting for the deploy lock"
fi

prev_tag=$(read_env_value "$DEPLOY_ENV_KEY")
case "$prev_tag" in
  ""|*[!A-Za-z0-9._-]*) die "refusing to deploy; previous ${DEPLOY_ENV_KEY} is missing or unsafe" ;;
esac
IMAGE_OWNER=$(read_env_value GHCR_OWNER)
case "$IMAGE_OWNER" in
  ""|*[!A-Za-z0-9._-]*|[-.]*) die "GHCR_OWNER is missing or unsafe" ;;
esac

trap cleanup EXIT

# Fetch first. .env still names the running release, so a failed pull cannot
# be picked up by a later `docker compose up`. `|| exit` keeps a failing
# function from falling through when errexit is suppressed inside a function.
pull_images || exit 1
require_local_images || exit 1

write_env_key "$DEPLOY_TAG" || exit 1
tag_written=1

compose_up || exit 1
verify_release || exit 1
release_activated=1
wait_healthy || exit 1
