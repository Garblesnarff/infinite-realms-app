#!/usr/bin/env bash
set -uo pipefail

REPO_ROOT="${INFINITE_REALMS_REPO_ROOT:-/var/www/infiniterealms}"
APP_DIR="${INFINITE_REALMS_APP_DIR:-${REPO_ROOT}/ai-adventure-scribe-main}"
LOG_DIR="${INFINITE_REALMS_LOG_DIR:-/var/log/infiniterealms}"
BUN_BIN="${BUN_BIN:-/usr/local/bin/bun}"
PM2_PROCESS="${PM2_PROCESS:-infiniterealms-bun}"
SMOKE_ENV="${API_SMOKE_ENV_FILE:-/etc/infiniterealms/llm-smoke.env}"
MARKER_FILE="${LOG_DIR}/DEPLOY_FAILED_SMOKE"

mkdir -p "$LOG_DIR"
exec > >(tee -a "${LOG_DIR}/auto-deploy.log") 2>&1

cd "$REPO_ROOT" || exit 1
previous_sha="$(git rev-parse HEAD)"
git fetch origin main || exit 1
git reset --hard origin/main || exit 1
deployed_sha="$(git rev-parse HEAD)"

pm2 restart "$PM2_PROCESS" --update-env || exit 1

if [[ -r "$SMOKE_ENV" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$SMOKE_ENV"
  set +a
fi

# Give PM2 up to 30 seconds to bind the HTTP port before running the journey once.
base_url="${API_SMOKE_BASE_URL:-${LLM_SMOKE_BASE_URL:-http://localhost:8888}}"
for _attempt in {1..15}; do
  if curl --silent --show-error --fail --max-time 2 "${base_url%/}/health" >/dev/null; then
    break
  fi
  sleep 2
done

smoke_output="$(mktemp)"
trap 'rm -f "$smoke_output"' EXIT

if (
  cd "$APP_DIR" &&
    API_SMOKE_REQUIRE_AUTH=1 API_SMOKE_ALLOW_INFRA_SKIPS=0 "$BUN_BIN" run scripts/api-smoke.ts
) 2>&1 | tee "$smoke_output"; then
  rm -f "$MARKER_FILE"
  echo "DEPLOY SMOKE PASSED sha=${deployed_sha}"
  exit 0
fi

failed_checks="$(sed -n 's/^FAIL \([^ ]*\).*/\1/p' "$smoke_output" | paste -sd, -)"
failed_checks="${failed_checks:-api-smoke-process}"
rollback_command="cd ${REPO_ROOT} && git reset --hard ${previous_sha} && pm2 restart ${PM2_PROCESS} --update-env"
alert="DEPLOY FAILED SMOKE | sha=${deployed_sha} | checks=${failed_checks} | no automatic rollback performed | rollback: ${rollback_command}"

echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
echo "$alert"
echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"

if [[ -n "${SLACK_ALERT_WEBHOOK_URL:-}" ]]; then
  payload="$($BUN_BIN -e 'console.log(JSON.stringify({text: process.argv[1]}))' "$alert")"
  if ! curl --silent --show-error --fail \
    --header 'Content-Type: application/json' \
    --data "$payload" \
    "$SLACK_ALERT_WEBHOOK_URL"; then
    printf '%s\n' "$alert" >"$MARKER_FILE"
    echo "Slack alert failed; wrote ${MARKER_FILE} for cron mail/operator inspection"
  fi
else
  printf '%s\n' "$alert" >"$MARKER_FILE"
  echo "SLACK_ALERT_WEBHOOK_URL unset; wrote ${MARKER_FILE} for cron mail/operator inspection"
fi

exit 1
