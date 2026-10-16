#!/usr/bin/env bash
# dev-session.sh — local Infinite Realms boot recipe without WorkOS.
#
# Usage:
#   scripts/dev-session.sh [--dry-run] [--help] [CLI args...]
#   DEV_PG_PORT=54330 DICE_SEED=7 scripts/dev-session.sh play --campaign the-eternal-feast --new --auto --turns 10
#
# What it does:
#   1. Start/reuse a throwaway pgvector Postgres container (ir-dev-session-pg).
#   2. Replay migrations via scripts/test-migrations.sh.
#   3. Start the Bun server (test auth, no WorkOS login needed for test-login).
#   4. Seed/smoke-check the test account via GET /v1/auth/test-login.
#   5. Run the playtest CLI in cli/, forwarding any extra args.
#
# Environment:
#   DEV_PG_PORT        container host port (default 54329)
#   DICE_SEED          server dice seed (default 42)
#   LLM_FIXTURE_DIR    fixture dir (default server-bun/test-fixtures/sessions)
#   DEV_SESSION_KEEP_DB=1  keep the container on exit
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/dev-session.sh [--dry-run] [--help] [CLI args...]

Local boot recipe with no WorkOS. Starts a throwaway pgvector Postgres container,
replays migrations, boots the Bun server with ENABLE_TEST_AUTH=1, smoke-checks the
test account via GET /v1/auth/test-login, then runs the playtest CLI in cli/.

Passed-through flags are forwarded to the CLI (e.g. play --campaign ... --auto).
EOF
}

DRY_RUN=0
PASSTHROUGH=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) PASSTHROUGH+=("$1"); shift ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

CONTAINER_NAME="ir-dev-session-pg"
DEV_PG_PORT="${DEV_PG_PORT:-54329}"
DEV_PG_PASSWORD="${DEV_PG_PASSWORD:-devsession}"
DEV_PG_USER="${DEV_PG_USER:-postgres}"
DEV_PG_DB="${DEV_PG_DB:-postgres}"
SERVER_PORT="${PORT:-${DEV_SERVER_PORT:-8888}}"
DICE_SEED="${DICE_SEED:-42}"
LLM_FIXTURE_DIR="${LLM_FIXTURE_DIR:-server-bun/test-fixtures/sessions}"
TEST_AUTH_SECRET_GENERATED="$(openssl rand -hex 16)"

# server runs with cwd=server-bun, so drop a leading "server-bun/" from the fixture path
SERVER_LLM_FIXTURE_DIR="$LLM_FIXTURE_DIR"
case "$SERVER_LLM_FIXTURE_DIR" in
  server-bun/*) SERVER_LLM_FIXTURE_DIR="${SERVER_LLM_FIXTURE_DIR#server-bun/}" ;;
esac

TEST_DATABASE_URL="postgres://${DEV_PG_USER}:${DEV_PG_PASSWORD}@localhost:${DEV_PG_PORT}/${DEV_PG_DB}"

if [[ "$DRY_RUN" == "1" ]]; then
  cat <<EOF
dev-session.sh [dry-run]

1. Start/reuse pgvector container '${CONTAINER_NAME}' (image pgvector/pgvector:pg15, host port ${DEV_PG_PORT})
   password is local-only; pg_isready wait
2. TEST_DATABASE_URL=${TEST_DATABASE_URL} bash scripts/test-migrations.sh
3. Start Bun server from server-bun/: PORT=${SERVER_PORT} NODE_ENV=development ENABLE_TEST_AUTH=1
   TEST_AUTH_SECRET=<openssl rand -hex 16> DICE_SEED=${DICE_SEED} LLM_FIXTURE_DIR=${LLM_FIXTURE_DIR}
   (server DATABASE_URL = the replayed test_migrations_* database, kept via KEEP_TEST_DB=1)
   command: bun run dev; health: http://localhost:${SERVER_PORT}/health
4. GET /v1/auth/test-login with header x-test-auth-secret (print success/fail only)
5. Run: bun run cli/src/index.ts ${PASSTHROUGH[*]:-play --campaign the-eternal-feast --new --auto --turns 20}
EOF
  exit 0
fi

CREATED_DB=0
SERVER_PID=""
cleanup() {
  if [[ -n "${SERVER_PID}" ]] && kill -0 "${SERVER_PID}" 2>/dev/null; then
    kill "${SERVER_PID}" 2>/dev/null || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
  if [[ "${CREATED_DB}" == "1" ]] && [[ "${DEV_SESSION_KEEP_DB:-0}" != "1" ]]; then
    docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# 1. Postgres container
if docker ps -q -f "name=^${CONTAINER_NAME}$" | grep -q .; then
  echo "Reusing running container ${CONTAINER_NAME}."
elif docker ps -aq -f "name=^${CONTAINER_NAME}$" | grep -q .; then
  echo "Starting existing container ${CONTAINER_NAME}."
  docker start "${CONTAINER_NAME}" >/dev/null
else
  echo "Starting new pgvector container ${CONTAINER_NAME} on port ${DEV_PG_PORT}."
  docker run -d --name "${CONTAINER_NAME}" \
    -e "POSTGRES_PASSWORD=${DEV_PG_PASSWORD}" \
    -p "${DEV_PG_PORT}:5432" \
    pgvector/pgvector:pg15 >/dev/null
  CREATED_DB=1
fi

echo "Waiting for Postgres (pg_isready)..."
until docker exec "${CONTAINER_NAME}" pg_isready -U "${DEV_PG_USER}" >/dev/null 2>&1; do
  sleep 1
done
echo "Postgres is ready."

# 2. Replay migrations
echo "Replaying migrations..."
# test-migrations.sh replays into a scratch database and drops it on exit;
# KEEP_TEST_DB=1 keeps it, and we point the server at that database.
MIGRATION_LOG="$(mktemp "${TMPDIR:-/tmp}/dev-session-migrations.XXXXXX")"
if ! KEEP_TEST_DB=1 TEST_DATABASE_URL="${TEST_DATABASE_URL}" \
  bash "${PROJECT_ROOT}/scripts/test-migrations.sh" 2>&1 | tee "${MIGRATION_LOG}"; then
  echo "Migration replay failed; see ${MIGRATION_LOG}"
  exit 1
fi
SESSION_DB="$(sed -n 's/.*left database \(test_migrations_[0-9_]*\) in place.*/\1/p' "${MIGRATION_LOG}" | tail -1)"
if [[ -z "${SESSION_DB}" ]]; then
  echo "Could not find the replayed database name in ${MIGRATION_LOG}"
  exit 1
fi
echo "Using replayed database ${SESSION_DB}."

# 3. Start Bun server
export DATABASE_URL="postgres://${DEV_PG_USER}:${DEV_PG_PASSWORD}@localhost:${DEV_PG_PORT}/${SESSION_DB}"
export NODE_ENV="development"
export ENABLE_TEST_AUTH="1"
export TEST_AUTH_SECRET="${TEST_AUTH_SECRET_GENERATED}"
export DICE_SEED="${DICE_SEED}"
export LLM_FIXTURE_DIR="${SERVER_LLM_FIXTURE_DIR}"
export PORT="${SERVER_PORT}"
export CORS_ORIGIN="${CORS_ORIGIN:-http://localhost:5173}"
export WORKOS_API_KEY="${WORKOS_API_KEY:-dev}"
export WORKOS_CLIENT_ID="${WORKOS_CLIENT_ID:-dev}"

SERVER_LOG="$(mktemp "${TMPDIR:-/tmp}/dev-session-server.XXXXXX")"
echo "Starting Bun server on port ${SERVER_PORT}..."
(
  cd "${PROJECT_ROOT}/server-bun"
  bun run dev
) >"${SERVER_LOG}" 2>&1 &
SERVER_PID=$!

echo "Waiting for health endpoint..."
for _ in $(seq 1 60); do
  if curl -fsS "http://localhost:${SERVER_PORT}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ! curl -fsS "http://localhost:${SERVER_PORT}/health" >/dev/null 2>&1; then
  echo "Server did not become healthy; see ${SERVER_LOG}"
  exit 1
fi
echo "Server healthy."

# 4. Seed/smoke-check smoke account
LOGIN_CODE="$(curl -sS -o /dev/null -w '%{http_code}' -H "x-test-auth-secret: ${TEST_AUTH_SECRET}" "http://localhost:${SERVER_PORT}/v1/auth/test-login" || true)"
if [[ "${LOGIN_CODE}" =~ ^[23][0-9][0-9]$ ]]; then
  echo "Smoke account test-login: success"
else
  echo "Smoke account test-login: FAILED (HTTP ${LOGIN_CODE})"
fi

# 5. Run CLI
cat <<'EOF'
Note: the playtest CLI authenticates via POST /v1/auth/password-login using
SMOKE_EMAIL/SMOKE_PASSWORD from cli/.env.cli, which GET /v1/auth/test-login
cannot provide. Keep cli/.env.cli populated; test-login is only a smoke check.
EOF

if [[ ! -f "${PROJECT_ROOT}/cli/.env.cli" ]]; then
  cat <<'EOF'
cli/.env.cli is missing. Copy from cli/.env.cli.example and set:
  SMOKE_EMAIL
  SMOKE_PASSWORD
  CLI_SUPABASE_URL
  CLI_SUPABASE_ANON_KEY
The playtest CLI authenticates via POST /v1/auth/password-login, which
test-login cannot satisfy, so create those credentials manually.
EOF
  exit 1
fi

CLI_ARGS=("${PASSTHROUGH[@]}")
if [[ ${#CLI_ARGS[@]} -eq 0 ]]; then
  CLI_ARGS=(play --campaign the-eternal-feast --new --auto --turns 20)
fi

export CLI_API_URL="http://localhost:${SERVER_PORT}"
echo "Running playtest CLI against ${CLI_API_URL}..."
cd "${PROJECT_ROOT}"
bun run cli/src/index.ts "${CLI_ARGS[@]}"
EOF