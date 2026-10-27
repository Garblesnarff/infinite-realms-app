#!/usr/bin/env bash
# backup-infiniterealms-db.sh — InfiniteRealms database backup, drop-in
# replacement for the script previously installed on the VPS (#1003).
#
# THE MERGE: this file is the #1003 script (pg_dump -Fc + a verify that
# can fail) with the installed script's deployment shape, so Hetzner can
# replace the installed file with this one and the cron behaves the same:
#   from the installed script (ops/backup-infiniterealms-db.installed.sh,
#   tracked via #1149): the `docker exec` connection, 30-day pruning, and
#     the Slack alert (same env var NAMES — BACKUP_NOTIFY,
#     BACKUP_ALERTS_ENV, BACKUP_ALERT_FILE, SLACK_ALERT_WEBHOOK_URL — and
#     no values; secret values never appear in this file);
#   from #1003: pg_dump -Fc, pg_restore --exit-on-error verify with the
#     one-entry graphql ACL exclusion, --verify-only, exit codes, and the
#     plain .sql.gz copy for one retention cycle.
#
# THE PROBLEM THE VERIFY FIXES (#38): the old verification loaded the
# dump with plain psql and no ON_ERROR_STOP, so every restore error was
# swallowed and the run still reported success — "95 tables restored"
# never meant a clean restore. One error class is structural: every dump
# carries GRANTs on graphql_public.graphql, a function owned by the
# pg_graphql *extension* (pg_depend deptype 'e'). pg_dump omits extension
# members' definitions but DOES dump their ACLs, so loading a dump into a
# fresh database under error-checking fails on exactly that entry:
#
#     function graphql_public.graphql(text, text, jsonb, jsonb) does not exist
#
# (The 2026-09-13 drill quoted on #38 proved it is the ONLY unrestorable
# entry: excluding it, a full dump restores with zero errors.)
#
# THE SHAPE NOW: pg_dump -Fc inside the container (docker exec), streamed
# to infiniterealms_<stamp>.dump on the host. Verification copies the
# archive into the container and restores it there with pg_restore
# --exit-on-error and a --use-list that excludes exactly that one ACL
# entry. The entry stays in the .dump itself — it is skipped only for
# the verify restore, where the function legitimately cannot exist until
# the extension is installed. The exclusion is anchored on the TOC field
# shape
#     ACL graphql_public FUNCTION graphql(
# pg_restore renders argument NAMES in TOC lines
# (graphql("operationName" text, ...)), which is why the pattern stops at
# the open paren and never matches on names or types; a definition line
# renders schema and name in the opposite order (FUNCTION graphql_public
# graphql(...)), so the filter can never eat a definition. If MORE than
# one entry ever matches, the script refuses rather than silently
# widening the exclusion past what #38 proved.
#
# A plain-SQL copy is still written next to the .dump (same base name,
# .sql.gz) for one retention cycle, per #38 — rendered from the same
# archive, so both files are the same snapshot. Keep BACKUP_KEEP_PLAIN=1
# for at least that cycle; the restore procedure in ops/README.md
# consumes the .sql.gz today.
#
# WHAT THE DROP-IN DOES NOT CARRY OVER from the installed script: its
# absolute size floor and relative-size check. The #1003 verify subsumes
# them — a truncated or empty archive fails pg_restore --list, a corrupt
# archive fails the restore, and the restored-table count must match the
# archive exactly. The installed script's restored-table floor IS carried
# over as MIN_TABLES (default 20): without it a dump of an empty database
# would count-match at 0 == 0 and publish as verified.
#
# Usage:
#   backup-infiniterealms-db.sh                    dump + verify + prune
#   backup-infiniterealms-db.sh --verify-only <dump-file>
#                                                  verify an existing dump
#                                                  (no pruning, no publish)
# Exit codes: 0 ok · 1 dump or verify failed · 2 usage error
#
# Connection: everything database-side runs inside the container via
# `docker exec` (the installed script's connection). The host needs only
# docker, gzip, awk, find, mktemp and date — no host postgres client
# tools. The archive crosses into the container with `docker cp` for
# the verify restore and the plain-SQL render; both container copies
# are removed on every exit path this script controls.
# Overrides:
#   CONTAINER       container holding postgres (default supabase-db)
#   PGDATABASE      source database (default postgres)
#   BACKUP_DIR      default /var/backups/infiniterealms/postgres (the
#                   installed script's default; #1003's default was
#                   /var/backups/infiniterealms — the installed default
#                   wins so a drop-in replacement lands backups where
#                   the cron already looks)
#   BACKUP_KEEP_PLAIN 1 (default) also write the .sql.gz copy; 0 skips it
#   BACKUP_VERIFY     1 (default) verify after dumping; 0 skips (announced)
#   BACKUP_ADMIN_DB   maintenance database for the verify scratch
#                     database (default postgres — the database that
#                     always exists)
#   RETENTION_DAYS    prune backups older than this many days (default
#                     30, the installed script's retention); must be a
#                     non-negative integer
#   MIN_TABLES        restored-table floor (default 20, the installed
#                     script's floor); a dump restoring fewer tables
#                     fails verify — this closes the empty-database
#                     0 == 0 count-match case; must be a non-negative
#                     integer
#   BACKUP_NOTIFY     1 (default) attempt the Slack alert on failure;
#                     anything else prints a dry-run line instead
#   BACKUP_ALERTS_ENV file holding SLACK_ALERT_WEBHOOK_URL (default
#                     /etc/infiniterealms/alerts.env); unreadable means
#                     no Slack alert, silently
#   BACKUP_ALERT_FILE failure log (default
#                     /var/log/infiniterealms/alerts.log)
# BACKUP_KEEP_PLAIN and BACKUP_VERIFY accept only the literals 0 and 1;
# anything else is a usage error, never a silent downgrade.
#
# Pruning runs only after a verified backup (the installed script's
# invariant). It deletes infiniterealms_*.dump and
# infiniterealms_*.sql.gz older than RETENTION_DAYS, stale
# infiniterealms_*.partial.* files, abandoned .in-progress_* files from
# the pre-drop-in script, and stale container temp files — all
# best-effort, never a gate: a pruning failure only warns. A run with
# BACKUP_VERIFY=0 does NOT prune: an unverified backup must never be
# the reason the last good backups disappear. Failed runs
# rename their artifacts to .unverified and pruning never touches
# .unverified files, so failure evidence is kept. --verify-only never
# prunes: it is a drill, not a backup run.
#
# NOTE: the verify restores a second full copy of the database inside
# the container, and the archive is copied in first — so the container
# needs roughly twice the database's size free during the run
# (see the install notes in ops/README.md).
#
# Merging this installs nothing (the repo convention for ops scripts,
# per ops/README.md). Hetzner installs on Rob's line.

# -E (errtrace) is what lets the ERR trap below fire for failures inside
# functions (log/err): without it a failing printf inside log() would
# kill the run silently under set -e. Handled paths stay exempt — a
# failure inside a function called in a || list, an if condition, or
# under ! never reaches the trap — so handled failures alert exactly
# once through their own alert call.
set -Eeuo pipefail
umask 077

PROG=backup-infiniterealms-db
usage() { printf 'usage: %s [--verify-only <dump-file>]\n' "$PROG" >&2; }

VERIFY_ONLY=""
case "${1:-}" in
  "") ;;
  --verify-only)
    [ $# -eq 2 ] || { usage; exit 2; }
    VERIFY_ONLY=$2
    ;;
  *) usage; exit 2 ;;
esac

need() {
  command -v "$1" >/dev/null 2>&1 || {
    printf '%s: ERROR: required tool not found: %s\n' "$PROG" "$1" >&2
    exit 2
  }
}
need docker
need gzip
need awk
need find
need mktemp
need date

log() { printf '%s: %s\n' "$PROG" "$*"; }
err() { printf '%s: ERROR: %s\n' "$PROG" "$*" >&2; }
die() { err "$*"; exit 1; }

# Slack alert, kept from the installed script: same env var names, no
# values. Alerting is best-effort and never fails a run by itself — the
# alert file is the durable record, Slack is attempted only when the
# env file is readable, the webhook is set, and curl + jq exist.
LABEL=${LABEL:-Infinite Realms}
NOTIFY=${BACKUP_NOTIFY:-1}
ALERTS_ENV=${BACKUP_ALERTS_ENV:-/etc/infiniterealms/alerts.env}
ALERT_FILE=${BACKUP_ALERT_FILE:-/var/log/infiniterealms/alerts.log}

post_slack() {
  [ "$NOTIFY" = "1" ] || { echo "[dry-run] slack: $1" || true; return 0; }
  [ -r "$ALERTS_ENV" ] || return 0
  command -v curl >/dev/null 2>&1 || return 0
  command -v jq >/dev/null 2>&1 || return 0
  # Subshell so the webhook never leaks into the environment of anything below.
  (
    # shellcheck disable=SC1090
    . "$ALERTS_ENV"
    [ -n "${SLACK_ALERT_WEBHOOK_URL:-}" ] || exit 0
    curl -s -m 10 -X POST -H 'Content-type: application/json' \
      --data "$(jq -n --arg t "$1" '{text: $t}')" \
      "$SLACK_ALERT_WEBHOOK_URL" > /dev/null 2>&1
  ) || true
  return 0
}

alert() {
  # The alert file's parent may not exist on a host that never alerted;
  # create it best-effort, and never let alerting fail the run.
  # The timestamp is computed fresh here, not from the frozen startup
  # stamp, so a run spanning midnight still logs the failure time.
  mkdir -p "$(dirname "$ALERT_FILE")" 2>/dev/null || true
  echo "[$(date +"%Y-%m-%d %H:%M:%S")] backup: $*" >> "$ALERT_FILE" 2>/dev/null || true
  post_slack ":rotating_light: ${LABEL} DB backup FAILED — $*"
  return 0
}

# Unexpected-exit alert, kept from the installed script (its trap at
# ~92): a command failing outside an explicitly handled path alerts
# before the run dies, so a failure nobody wrote a branch for is still
# reported. Guarded commands (|| lists, if/while conditions, ! tests)
# never reach this trap — the exemption propagates into functions
# called in those contexts — so the handled paths alert exactly once
# through their own alert call. (This needs the set -E above: without
# errtrace the trap would not fire inside functions at all.)
# The trap is removed in cleanup (so teardown cannot re-alert),
# before prune (best-effort tail work — a published, verified backup
# must not re-alert on a tail-step failure, the installed ordering),
# and before the final OK log.
# Line numbers: $LINENO inside the trap is the failing builtin's line
# inside log() (the same line for every log failure);
# ${BASH_LINENO[0]} is the log call site. At top level
# BASH_LINENO[0] is 0-or-unset, so fall back to $LINENO there (at top
# level $LINENO IS the failing line). Both shapes verified empirically.
trap 'trap - ERR; l=${BASH_LINENO[0]:-0}; [ "$l" = "0" ] && l=$LINENO; alert "unexpected error near line $l"; exit 1' ERR

# Rename $1 to $1.unverified for failure evidence; logs success or
# failure and returns non-zero when the rename itself fails, so callers
# never claim evidence was kept when it was not.
rename_evidence() {
  if mv "$1" "$1.unverified"; then
    log "evidence: $1 renamed to $1.unverified"
    return 0
  else
    err "could not rename $1 to $1.unverified — the UNVERIFIED artifact is still at its original name"
    return 1
  fi
}

SRC_DB=${PGDATABASE:-postgres}
CONTAINER=${CONTAINER:-supabase-db}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/infiniterealms/postgres}
KEEP_PLAIN=${BACKUP_KEEP_PLAIN:-1}
DO_VERIFY=${BACKUP_VERIFY:-1}
ADMIN_DB=${BACKUP_ADMIN_DB:-postgres}
RETENTION_DAYS=${RETENTION_DAYS:-30}
case "$KEEP_PLAIN" in
  0|1) ;;
  *) err "BACKUP_KEEP_PLAIN must be 0 or 1 (got: $KEEP_PLAIN)"; exit 2 ;;
esac
case "$DO_VERIFY" in
  0|1) ;;
  *) err "BACKUP_VERIFY must be 0 or 1 (got: $DO_VERIFY)"; exit 2 ;;
esac
case "$RETENTION_DAYS" in
  *[!0-9]*) err "RETENTION_DAYS must be a non-negative integer (got: $RETENTION_DAYS)"; exit 2 ;;
esac
MIN_TABLES=${MIN_TABLES:-20}
case "$MIN_TABLES" in
  *[!0-9]*) err "MIN_TABLES must be a non-negative integer (got: $MIN_TABLES)"; exit 2 ;;
esac

# The one unrestorable TOC entry class (#38): ACLs on the pg_graphql
# extension-member function. Anchored at the open paren — see the header.
readonly EXCLUDED_TOC_PATTERN=' ACL graphql_public FUNCTION graphql\('

# Verify scratch state. VERIFY_CREATED is the guard that keeps the EXIT
# trap from ever dropping a database this run did not create.
# Container temp files are removed by the trap on every exit path.
VERIFY_DB=""
VERIFY_CREATED=0
TOC_TMP=""
LIST_TMP=""
COUNT_TMP=""
DUMP_PARTIAL=""
PLAIN_PARTIAL=""
STAMP=$(date +%Y%m%d_%H%M%S)
CTR_BASE="/tmp/ir_backup_${STAMP}_$$"
CTR_DUMP="$CTR_BASE.dump"
CTR_LIST="$CTR_BASE.list"

cleanup() {
  # Teardown must never re-alert: the ERR trap is off from here on.
  trap - ERR
  if [ "$VERIFY_CREATED" = "1" ] && [ -n "$VERIFY_DB" ]; then
    docker exec "$CONTAINER" psql -U postgres -w -X -q -d "$ADMIN_DB" \
      -c "DROP DATABASE IF EXISTS \"$VERIFY_DB\";" >/dev/null 2>&1 || true
  fi
  docker exec "$CONTAINER" rm -f "$CTR_DUMP" "$CTR_LIST" >/dev/null 2>&1 || true
  [ -n "$TOC_TMP" ] && rm -f "$TOC_TMP"
  [ -n "$LIST_TMP" ] && rm -f "$LIST_TMP"
  [ -n "$COUNT_TMP" ] && rm -f "$COUNT_TMP"
  # Partials are renamed away on success, so these only fire for a run
  # killed mid-dump — exactly the case that must not leave them behind.
  [ -n "$DUMP_PARTIAL" ] && rm -f "$DUMP_PARTIAL"
  [ -n "$PLAIN_PARTIAL" ] && rm -f "$PLAIN_PARTIAL"
  return 0
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Print the archive's table of contents on stdout with the excluded
# entries removed; print the number of excluded entries on stderr.
# The pattern travels through ENVIRON, never awk -v: -v values undergo
# escape processing, which on gawk turns the pattern's \( into a bare
# paren — an unmatched-paren regex that fails the filter outright.
filter_toc() {
  env EXCLUDED_TOC_PATTERN="$EXCLUDED_TOC_PATTERN" awk '
    BEGIN { pat = ENVIRON["EXCLUDED_TOC_PATTERN"] }
    $0 ~ pat { n++; next }
    { print }
    END { print n + 0 > "/dev/stderr" }
  '
}

# Scratch databases leaked by a killed run (SIGKILL, reboot — no trap
# runs) are swept at the start of the next verify. The sweep drops ANY
# database under the ir_backup_verify_ prefix whose embedded stamp is
# more than 24 hours old — that namespace is this script's alone, so
# anything parked under it with an old stamp is treated as a leaked
# scratch database (and the drop is logged). 24 hours is far longer
# than any live verify runs, so a concurrent run is never swept.
sweep_stale_verify_dbs() {
  local now names db rest d t epoch
  now=$(date +%s)
  names=$(docker exec "$CONTAINER" psql -U postgres -w -X -q -t -A -d "$ADMIN_DB" \
    -c "SELECT datname FROM pg_database WHERE datname LIKE 'ir_backup_verify_%'" 2>/dev/null) || return 0
  for db in $names; do
    rest=${db#ir_backup_verify_}
    d=${rest%%_*}
    rest=${rest#*_}
    t=${rest%%_*}
    epoch=$(date -d "${d:0:4}-${d:4:2}-${d:6:2} ${t:0:2}:${t:2:2}:${t:4:2}" +%s 2>/dev/null) || continue
    if [ $((now - epoch)) -gt 86400 ]; then
      log "verify: dropping stale scratch database $db (left behind by an earlier run)"
      docker exec "$CONTAINER" psql -U postgres -w -X -q -d "$ADMIN_DB" \
        -c "DROP DATABASE IF EXISTS \"$db\";" >/dev/null 2>&1 || true
    fi
  done
}

# Restore $1 into a throwaway database and require a clean restore.
# Returns non-zero (with the error on stderr) when the dump does not
# restore cleanly; on failure paths the scratch database and the
# container copies are dropped by the EXIT trap, on success they are
# dropped explicitly below.
verify_dump() {
  local dump=$1
  [ -f "$dump" ] || { err "verify: no such file: $dump"; return 1; }

  TOC_TMP=$(mktemp) || { err "verify: mktemp failed"; return 1; }
  LIST_TMP=$(mktemp) || { err "verify: mktemp failed"; return 1; }
  COUNT_TMP=$(mktemp) || { err "verify: mktemp failed"; return 1; }

  # pg_restore needs the archive inside the container.
  docker cp "$dump" "$CONTAINER:$CTR_DUMP" \
    || { err "verify: docker cp $dump into $CONTAINER failed"; return 1; }
  docker exec "$CONTAINER" pg_restore --list "$CTR_DUMP" > "$TOC_TMP" 2>/dev/null \
    || { err "verify: pg_restore --list failed on $dump — not a readable custom-format archive"; return 1; }

  # filter_toc writes the filtered list to stdout and the excluded
  # count to stderr; route them to separate files and read the count.
  filter_toc < "$TOC_TMP" > "$LIST_TMP" 2> "$COUNT_TMP" \
    || { err "verify: TOC filter failed on $dump"; return 1; }
  local excluded
  excluded=$(cat "$COUNT_TMP") \
    || { err "verify: could not read the TOC filter count for $dump"; return 1; }
  log "verify: excluded $excluded extension-member TOC entr(ies) (graphql_public.graphql, #38)"
  if [ "$excluded" -gt 1 ]; then
    err "verify: $excluded TOC entries match the graphql_public.graphql exclusion, but #38 proved exactly one unrestorable entry — refusing to widen the exclusion silently"
    return 1
  fi

  docker cp "$LIST_TMP" "$CONTAINER:$CTR_LIST" \
    || { err "verify: docker cp use-list into $CONTAINER failed"; return 1; }

  sweep_stale_verify_dbs

  VERIFY_DB="ir_backup_verify_$(date +%Y%m%d_%H%M%S)_$$"
  [ "$VERIFY_DB" != "$SRC_DB" ] \
    || { err "verify: scratch database name would collide with the source database"; return 1; }
  docker exec "$CONTAINER" psql -U postgres -w -X -q -d "$ADMIN_DB" \
    -c "CREATE DATABASE \"$VERIFY_DB\"" \
    || { err "verify: could not create verification database $VERIFY_DB"; return 1; }
  VERIFY_CREATED=1

  docker exec "$CONTAINER" pg_restore -w -U postgres --exit-on-error --use-list "$CTR_LIST" -d "$VERIFY_DB" "$CTR_DUMP" \
    || { err "verify: pg_restore into $VERIFY_DB failed — the dump does NOT restore cleanly"; return 1; }

  # Count check BEFORE the scratch database is dropped, so a mismatch is
  # reported while the restored database still exists in the log trail.
  # Expected: TOC lines for table DEFINITIONS. In pg_restore --list
  # output a definition line carries its catalog id in field 2 (1259 for
  # tables), while every glue line — TABLE DATA, TABLE ATTACH, ACL,
  # COMMENT — carries 0 there; the type field alone cannot be used,
  # because a definition's fifth field is the schema name, which could
  # itself be DATA or ATTACH. Actual: base tables and partitioned
  # parents from pg_class, MINUS extension-owned relations: those are
  # recreated by CREATE EXTENSION during the restore, and pg_dump emits
  # no definition for them — plain member tables are absent from the
  # archive entirely, and pg_extension_config_dump tables appear only
  # as a TABLE DATA entry, which the expected side does not count.
  # Excluding them on the actual side compares the same set.
  local expected actual
  expected=$(awk '$4 == "TABLE" && $2 != "0" { n++ } END { print n + 0 }' "$LIST_TMP") \
    || { err "verify: table-count parse failed on $dump"; return 1; }
  actual=$(docker exec "$CONTAINER" psql -U postgres -w -X -q -t -A -d "$VERIFY_DB" -c \
    "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND NOT EXISTS (SELECT 1 FROM pg_depend d
                         WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid
                           AND d.deptype = 'e')") \
    || { err "verify: restored-table count query failed"; return 1; }
  [ "$actual" = "$expected" ] \
    || { err "verify: restored table count $actual does not match the archive's $expected"; return 1; }

  # Restored-table floor, carried over from the installed script
  # (MIN_TABLES, default 20): without it an empty or wrong-database
  # dump count-matches at 0 == 0 and publishes as verified. Checked
  # against the restored count, like the installed script's check.
  [ "$actual" -ge "$MIN_TABLES" ] \
    || { err "verify: restored $actual tables, below the MIN_TABLES floor of $MIN_TABLES"; return 1; }

  local size
  size=$(docker exec "$CONTAINER" psql -U postgres -w -X -q -t -A -d "$VERIFY_DB" -c "SELECT pg_database_size('$VERIFY_DB')") || size="?"
  docker exec "$CONTAINER" psql -U postgres -w -X -q -d "$ADMIN_DB" \
    -c "DROP DATABASE \"$VERIFY_DB\"" \
    || { err "verify: drop of $VERIFY_DB failed"; return 1; }
  VERIFY_CREATED=0
  VERIFY_DB=""
  docker exec "$CONTAINER" rm -f "$CTR_DUMP" "$CTR_LIST" >/dev/null 2>&1 || true
  rm -f "$TOC_TMP" "$LIST_TMP" "$COUNT_TMP"
  TOC_TMP=""
  LIST_TMP=""
  COUNT_TMP=""
  log "verify: OK — $dump restores cleanly ($actual tables, scratch restore used $size bytes)"
}

# Render the plain-SQL copy of $1 into $2 from the same archive.
# Runs inside the container (no host postgres tools needed); the
# container copy is removed here and again by the EXIT trap.
render_plain() {
  local dump=$1 plain_partial=$2
  docker cp "$dump" "$CONTAINER:$CTR_DUMP" \
    || { err "plain: docker cp $dump into $CONTAINER failed"; return 1; }
  docker exec "$CONTAINER" pg_restore -f - "$CTR_DUMP" | gzip > "$plain_partial" \
    || { rm -f "$plain_partial"; err "plain: pg_restore render failed; the .dump is intact: $dump"; return 1; }
  gzip -t "$plain_partial" \
    || { rm -f "$plain_partial"; err "plain: gzip integrity check failed for the rendered copy"; return 1; }
  docker exec "$CONTAINER" rm -f "$CTR_DUMP" >/dev/null 2>&1 || true
  return 0
}

# Prune old backups. Best-effort only — never a gate: a pruning failure
# warns and the run still succeeds. Called only after a successful
# backup, never on --verify-only and never on a failed run. Failed runs
# rename their artifacts to .unverified, and the patterns below do not
# match that suffix, so failure evidence is kept.
prune_backups() {
  find "$BACKUP_DIR" -type f -name 'infiniterealms_*.sql.gz' -mtime +"$RETENTION_DAYS" -delete 2>/dev/null \
    || log "prune: warning: could not prune old .sql.gz files"
  find "$BACKUP_DIR" -type f -name 'infiniterealms_*.dump' -mtime +"$RETENTION_DAYS" -delete 2>/dev/null \
    || log "prune: warning: could not prune old .dump files"
  find "$BACKUP_DIR" -type f -name 'infiniterealms_*.partial.*' -mmin +180 -delete 2>/dev/null || true
  find "$BACKUP_DIR" -type f -name '.in-progress_*' -mmin +180 -delete 2>/dev/null || true
  docker exec "$CONTAINER" find /tmp -maxdepth 1 -name 'ir_backup_*.dump' -mmin +180 -delete >/dev/null 2>&1 || true
  docker exec "$CONTAINER" find /tmp -maxdepth 1 -name 'ir_backup_*.list' -mmin +180 -delete >/dev/null 2>&1 || true
  log "pruned backups older than $RETENTION_DAYS days; retained: $(find "$BACKUP_DIR" -type f -name 'infiniterealms_*.dump' -o -type f -name 'infiniterealms_*.sql.gz' 2>/dev/null | wc -l)" || true
}

if [ -n "$VERIFY_ONLY" ]; then
  if ! verify_dump "$VERIFY_ONLY"; then
    alert "verify FAILED for $VERIFY_ONLY"
    die "verify failed for $VERIFY_ONLY"
  fi
  exit 0
fi

mkdir -p "$BACKUP_DIR" || { alert "cannot create BACKUP_DIR: $BACKUP_DIR"; die "cannot create BACKUP_DIR: $BACKUP_DIR"; }
DUMP="$BACKUP_DIR/infiniterealms_$STAMP.dump"
PLAIN="$BACKUP_DIR/infiniterealms_$STAMP.sql.gz"
DUMP_PARTIAL="$DUMP.partial.$$"
PLAIN_PARTIAL="$PLAIN.partial.$$"

[ -e "$DUMP" ] && { alert "refusing to overwrite existing backup: $DUMP"; die "refusing to overwrite existing backup: $DUMP"; }
[ "$KEEP_PLAIN" != "1" ] || [ ! -e "$PLAIN" ] || { alert "refusing to overwrite existing backup: $PLAIN"; die "refusing to overwrite existing backup: $PLAIN"; }

log "dumping $SRC_DB -> $DUMP (pg_dump -Fc via docker exec)"
docker exec "$CONTAINER" pg_dump -w -U postgres -Fc -d "$SRC_DB" > "$DUMP_PARTIAL" \
  || { rm -f "$DUMP_PARTIAL"; alert "pg_dump FAILED for $SRC_DB"; die "pg_dump failed; no backup written"; }
mv "$DUMP_PARTIAL" "$DUMP" || { alert "could not move the finished dump into place: $DUMP"; die "could not move the finished dump into place: $DUMP"; }
sync >/dev/null 2>&1 || true
log "dump written: $DUMP"

if [ "$KEEP_PLAIN" = "1" ]; then
  # Plain-SQL copy for one retention cycle (#38), rendered from the same
  # archive so both files are the same snapshot. pipefail makes a
  # pg_restore failure fail this step even though gzip exits 0.
  if ! render_plain "$DUMP" "$PLAIN_PARTIAL"; then
    # A render failure must not leave a final-named .dump that was
    # never verified: rename it to .unverified first, like the
    # verify-failure path below, so the prune invariant (only
    # verified artifacts exist under final names) holds.
    if rename_evidence "$DUMP"; then
      alert "plain-SQL render FAILED for $DUMP"
      die "plain-SQL render failed; the .dump is kept as evidence under the .unverified suffix"
    else
      alert "plain-SQL render FAILED for $DUMP (WARNING: evidence rename failed — unverified dump still at final name)"
      die "plain-SQL render failed; WARNING: evidence rename failed, unverified dump still at final name"
    fi
  fi
  if ! mv "$PLAIN_PARTIAL" "$PLAIN"; then
    # Same invariant as the render failure above: the .dump is
    # unverified at this point, so it must not stay under its final
    # name. (PLAIN_PARTIAL is removed by the EXIT trap.)
    if rename_evidence "$DUMP"; then
      alert "could not move the plain copy into place: $PLAIN; the .dump is kept as evidence under the .unverified suffix"
      die "could not move the plain copy into place: $PLAIN; the .dump is kept as evidence under the .unverified suffix"
    else
      alert "could not move the plain copy into place: $PLAIN (WARNING: evidence rename failed — unverified dump still at final name)"
      die "could not move the plain copy into place: $PLAIN; WARNING: evidence rename failed, unverified dump still at final name"
    fi
  fi
  log "plain copy written: $PLAIN"
fi

if [ "$DO_VERIFY" = "1" ]; then
  if ! verify_dump "$DUMP"; then
    # A failed verify must not leave final-named artifacts that look
    # verified to anything globbing infiniterealms_*.dump downstream.
    rename_ok=1
    rename_evidence "$DUMP" || rename_ok=0
    if [ -f "$PLAIN" ]; then rename_evidence "$PLAIN" || rename_ok=0; fi
    if [ "$rename_ok" = "1" ]; then
      alert "verify FAILED for $DUMP"
      die "verify failed — artifacts kept as evidence under the .unverified suffix"
    else
      alert "verify FAILED for $DUMP (WARNING: evidence rename failed — unverified artifact still at final name)"
      die "verify failed — WARNING: evidence rename failed, unverified artifact still at final name"
    fi
  fi
  # Prune only after a verified publish (the installed script's
  # invariant): an unverified backup must never be the reason the last
  # good backups disappear. The ERR trap is off from here on: prune
  # is best-effort tail work, and a published, verified backup must
  # not re-alert on a tail-step failure (the installed ordering).
  trap - ERR
  prune_backups
else
  log "verify SKIPPED (BACKUP_VERIFY=0) — this backup is UNVERIFIED; prune SKIPPED (pruning runs only after verified backups)"
fi

trap - ERR
log "OK $DUMP" || true
