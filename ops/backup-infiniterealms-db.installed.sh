#!/bin/bash
#
# Infinite Realms database backup — single source of truth.
#
# Supersedes the two jobs that both fired at 02:00: the previous version of this
# script (writing to /var/backups/infiniterealms/postgres) and
# /var/www/infiniterealms/scripts/backup-db.sh (writing to
# /var/www/infiniterealms/backups). They dumped the same database at the same
# minute, doubling load for no redundancy.
#
# Why it was rewritten: on 2026-08-14 the old version produced a 20-byte backup
# and logged "Backup completed". Three defects made that possible:
#
#   1. The shebang was literally "#\!/bin/bash" — a broken interpreter line, so
#      the script ran under whatever fallback shell cron chose.
#   2. `pg_dump | gzip > file` without `pipefail` reports gzip's exit status,
#      not pg_dump's, and gzip succeeds happily on empty input.
#   3. Nothing inspected the result. "Backup completed" was an unconditional
#      echo, printed whether or not anything had been written.
#
# A backup that reports success and cannot be restored is worse than no backup,
# because it removes the pressure to notice. This version refuses to publish a
# dump it has not actually restored.
#
# Every check must pass before the file is kept:
#   - pg_dump's own exit status (set -o pipefail)
#   - gzip integrity (gzip -t)
#   - an absolute size floor
#   - a relative size check against the previous good backup, to catch a dump
#     that is plausible-looking but truncated
#   - a real RESTORE into a throwaway database, then asserting the expected
#     tables came back
#
# Any failure alerts to Slack through the same path monitor-infiniterealms.sh
# uses, and exits non-zero. No secrets appear in this file.

set -euo pipefail

BACKUP_DIR=${BACKUP_DIR:-/var/backups/infiniterealms/postgres}
LOG_DIR=/var/log/infiniterealms
RETENTION_DAYS=${RETENTION_DAYS:-30}
MIN_BYTES=${MIN_BYTES:-1000000}          # 1MB floor; real dumps run ~8MB
SHRINK_PCT=${SHRINK_PCT:-50}             # alert if under 50% of the previous backup
MIN_TABLES=${MIN_TABLES:-20}             # restored-table floor; IR's public schema has ~94
CONTAINER=${CONTAINER:-supabase-db}
DB=${DB:-postgres}
PREFIX=${PREFIX:-infiniterealms}   # filename prefix; override for other databases
LABEL=${LABEL:-Infinite Realms}    # human name used in the Slack alert text
VERIFY_DB="backup_verify_$$"

ALERTS_ENV=${BACKUP_ALERTS_ENV:-/etc/infiniterealms/alerts.env}
ALERT_FILE=${BACKUP_ALERT_FILE:-$LOG_DIR/alerts.log}
NOTIFY=${BACKUP_NOTIFY:-1}

STAMP=$(date +"%Y-%m-%d %H:%M:%S")
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
mkdir -p "$BACKUP_DIR" "$LOG_DIR"

TMP_FILE="$BACKUP_DIR/.in-progress_${TIMESTAMP}.sql.gz"
FINAL_FILE="$BACKUP_DIR/${PREFIX}_${TIMESTAMP}.sql.gz"

log() { echo "[$STAMP] $*"; }

post_slack() {
  [ "$NOTIFY" = "1" ] || { echo "[dry-run] slack: $1"; return 0; }
  [ -r "$ALERTS_ENV" ] || return 0
  # Subshell so the webhook never leaks into the environment of anything below.
  (
    # shellcheck disable=SC1090
    . "$ALERTS_ENV"
    [ -n "${SLACK_ALERT_WEBHOOK_URL:-}" ] || exit 0
    curl -s -m 10 -X POST -H 'Content-type: application/json' \
      --data "$(jq -n --arg t "$1" '{text: $t}')" \
      "$SLACK_ALERT_WEBHOOK_URL" > /dev/null 2>&1
  )
}

cleanup_verify_db() {
  docker exec "$CONTAINER" psql -U postgres -d postgres \
    -c "DROP DATABASE IF EXISTS \"$VERIFY_DB\";" >/dev/null 2>&1 || true
}

fail() {
  log "BACKUP FAILED: $*"
  echo "[$STAMP] backup: $*" >> "$ALERT_FILE"
  post_slack ":rotating_light: ${LABEL} DB backup FAILED — $*"
  rm -f "$TMP_FILE"
  cleanup_verify_db
  exit 1
}

trap 'fail "unexpected error near line $LINENO"' ERR

log "Starting backup of $DB from $CONTAINER"

# 1. Dump. pipefail is what makes a pg_dump failure actually fail the pipeline.
docker exec "$CONTAINER" pg_dump -U postgres "$DB" | gzip > "$TMP_FILE" \
  || fail "pg_dump/gzip pipeline returned non-zero"

# 2. Integrity of the archive itself.
gzip -t "$TMP_FILE" 2>/dev/null || fail "gzip integrity check failed"

# 3. Absolute size floor — what the 20-byte backup would have tripped.
SIZE=$(stat -c %s "$TMP_FILE")
[ "$SIZE" -ge "$MIN_BYTES" ] || fail "dump is ${SIZE} bytes, below the ${MIN_BYTES}-byte floor"

# 4. Relative size — catches a truncated but non-trivial dump.
PREV=$(find "$BACKUP_DIR" -name "${PREFIX}_*.sql.gz" -type f -printf '%s\n' 2>/dev/null \
       | sort -n | tail -1 || true)
if [ -n "${PREV:-}" ] && [ "$PREV" -gt 0 ]; then
  if [ $(( SIZE * 100 / PREV )) -lt "$SHRINK_PCT" ]; then
    fail "dump is ${SIZE} bytes, under ${SHRINK_PCT}% of the previous ${PREV} bytes"
  fi
fi

# --- structurally unrestorable objects (the allowlist) -----------------
# pg_dump omits the DEFINITION of extension-member objects but still dumps
# their ACLs, so every dump of this database emits at least one error on a
# fresh target no matter how healthy it is. This step used to run psql with
# stderr discarded and no ON_ERROR_STOP, which swallowed that error class AND
# every other one -- a dump could lose functions, ACLs or whole schemas and
# still be published as "verified". Errors are now classified: allowlisted
# ones are tolerated and counted, anything else fails the backup.
#
# Established by drill (2026-09-13, infiniterealms_20260912_020001.sql.gz):
# exactly 3 errors, all the signature below, 0 warnings, 141 tables restored.
# See issue #2004; option 3 there (pg_dump -Fc + pg_restore --exit-on-error
# --use-list) removes the need for this list.
ALLOWED_ERRORS=(
  'function graphql_public.graphql(text, text, jsonb, jsonb) does not exist'
)

classify_errors() {
  local errlog="$1" total allowed=0 unexpected=0 line ok a fatals
  total=$(grep -ac '^ERROR:' "$errlog" 2>/dev/null || true); total=${total:-0}
  while IFS= read -r line; do
    ok=0
    for a in "${ALLOWED_ERRORS[@]}"; do
      case "$line" in *"$a"*) ok=1; break;; esac
    done
    if [ "$ok" = "1" ]; then allowed=$((allowed + 1)); else
      unexpected=$((unexpected + 1)); echo "  UNEXPECTED ERROR: $line" >&2
    fi
  done < <(grep -a '^ERROR:' "$errlog" 2>/dev/null || true)
  fatals=$(grep -ac '^FATAL:' "$errlog" 2>/dev/null || true); fatals=${fatals:-0}
  [ "$fatals" = "0" ] || unexpected=$((unexpected + fatals))
  echo "errors=$total allowed=$allowed unexpected=$unexpected fatal=$fatals"
  [ "$unexpected" = "0" ]
}

# 5. The real test: restore it and look inside.
cleanup_verify_db
docker exec "$CONTAINER" psql -U postgres -d postgres \
  -c "CREATE DATABASE \"$VERIFY_DB\";" >/dev/null 2>&1 \
  || fail "could not create verification database"

VERIFY_ERRLOG="$(mktemp)"
set +e
gunzip -c "$TMP_FILE" | docker exec -i "$CONTAINER" \
      psql -v ON_ERROR_STOP=0 -U postgres -d "$VERIFY_DB" -q >/dev/null 2>"$VERIFY_ERRLOG"
verify_rc=$?
set -e
if [ "$verify_rc" != "0" ]; then
  sed -n '1,20p' "$VERIFY_ERRLOG" >&2
  rm -f "$VERIFY_ERRLOG"
  cleanup_verify_db
  fail "psql exited $verify_rc restoring into the verification database"
fi
if ! VERIFY_CLASS="$(classify_errors "$VERIFY_ERRLOG")"; then
  log "  $VERIFY_CLASS"
  rm -f "$VERIFY_ERRLOG"
  cleanup_verify_db
  fail "restore into the verification database produced errors outside the allowlist"
fi
log "Restore diagnostics: $VERIFY_CLASS (allowlisted only)"
rm -f "$VERIFY_ERRLOG"

RESTORED_TABLES=$(docker exec "$CONTAINER" psql -U postgres -d "$VERIFY_DB" -t -A \
  -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null || echo 0)

cleanup_verify_db

[ "${RESTORED_TABLES:-0}" -ge "$MIN_TABLES" ] \
  || fail "restored dump exposed only ${RESTORED_TABLES} public tables — expected at least ${MIN_TABLES}"

log "Verified by restore: ${RESTORED_TABLES} public tables came back"

# 6. Publish only after every check passed.
mv "$TMP_FILE" "$FINAL_FILE"
trap - ERR

log "Backup completed: $FINAL_FILE"
log "Backup size: $(du -h "$FINAL_FILE" | cut -f1)"

# 7. Retention, plus cleanup of any abandoned in-progress files.
find "$BACKUP_DIR" -name "${PREFIX}_*.sql.gz" -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name '.in-progress_*' -mmin +180 -delete 2>/dev/null || true

log "Total backups retained: $(find "$BACKUP_DIR" -name "${PREFIX}_*.sql.gz" | wc -l)"
