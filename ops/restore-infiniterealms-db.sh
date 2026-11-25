#!/usr/bin/env bash
# restore-infiniterealms-db.sh — restore a pg_dump -Fc archive (.dump) (#38).
#
# Replaces the installed restore script, which read only the plain
# .sql.gz copy (gunzip | psql) and never completed a run. This script
# reads the .dump that ops/backup-infiniterealms-db.sh writes, through
# the same `docker exec` path and the same TOC rule, so a restore drill
# proves what the nightly verify proves.
#
# Modes:
#   --scratch <file.dump>
#       Restore into a disposable database (ir_restore_scratch_*) with
#       pg_restore --exit-on-error, check the restored table count against
#       the archive and against MIN_TABLES, then drop the database. The
#       live database is never touched. Exit 0 only when every check passes.
#   <file.dump>                       (needs I_ACCEPT_DOWNTIME=1)
#       LIVE restore into PGDATABASE with pg_restore --clean
#       --single-transaction --exit-on-error. A failure rolls the whole
#       restore back, so the live database keeps its previous state. A
#       live restore still needs downtime, so it refuses unless
#       I_ACCEPT_DOWNTIME=1 is set.
#
# TOC rule (the same as the backup verify, #38): exactly one TOC entry is
# dropped, the ACL on graphql_public.graphql. That object belongs to an
# extension, and pg_dump cannot recreate it. A second match is refused,
# never widened silently.
#
# Environment (names only; defaults in the code):
#   CONTAINER           container holding postgres (default supabase-db)
#   PGDATABASE          live database for LIVE mode (default postgres)
#   BACKUP_ADMIN_DB     maintenance database for scratch create/drop (default postgres)
#   MIN_TABLES          restored-table floor for --scratch (default 20)
#   I_ACCEPT_DOWNTIME   must be 1 for LIVE mode
#
# Exit: 0 restored or verified; 1 restore or check failed; 2 usage or refused.
# This script sends no alerts. ops/restore-drill-monthly.sh does that.

set -uo pipefail

PROG=$(basename "$0")
log() { printf '%s: %s\n' "$PROG" "$*"; }
err() { printf '%s: ERROR: %s\n' "$PROG" "$*" >&2; }

usage() {
  printf 'usage: %s --scratch <file.dump>\n' "$PROG" >&2
  printf '       I_ACCEPT_DOWNTIME=1 %s <file.dump>   (LIVE restore)\n' "$PROG" >&2
}

MODE=live
case "${1:-}" in
  --scratch) MODE=scratch; shift ;;
  -*) usage; exit 2 ;;
esac
[ $# -eq 1 ] || { usage; exit 2; }
DUMP=$1

SRC_DB=${PGDATABASE:-postgres}
CONTAINER=${CONTAINER:-supabase-db}
ADMIN_DB=${BACKUP_ADMIN_DB:-postgres}
MIN_TABLES=${MIN_TABLES:-20}
case "$MIN_TABLES" in
  *[!0-9]*) err "MIN_TABLES must be a non-negative integer (got: $MIN_TABLES)"; exit 2 ;;
esac

# The one unrestorable TOC entry class (#38). Same pattern as the backup
# verify; anchored at the open paren so it cannot eat a definition line.
readonly EXCLUDED_TOC_PATTERN=' ACL graphql_public FUNCTION graphql\('

for tool in docker awk mktemp date; do
  command -v "$tool" >/dev/null 2>&1 || { err "required tool not found: $tool"; exit 2; }
done

if [ "$MODE" = live ] && [ "${I_ACCEPT_DOWNTIME:-}" != "1" ]; then
  err "LIVE restore replaces objects in the live database '$SRC_DB' and needs downtime."
  err "Set I_ACCEPT_DOWNTIME=1 to proceed. To test a dump without touching live, use --scratch."
  exit 2
fi
[ -f "$DUMP" ] || { err "no such file: $DUMP"; exit 1; }

STAMP=$(date +%Y%m%d_%H%M%S)
CTR_BASE="/tmp/ir_restore_${STAMP}_$$"
CTR_DUMP="$CTR_BASE.dump"
CTR_LIST="$CTR_BASE.list"
TOC_TMP=""
LIST_TMP=""
COUNT_TMP=""
SCRATCH_DB=""
SCRATCH_CREATED=0

# Remove the scratch database (only one this run created), the container
# copies, and the local temp files on every exit path.
cleanup() {
  if [ "$SCRATCH_CREATED" = "1" ] && [ -n "$SCRATCH_DB" ]; then
    docker exec "$CONTAINER" psql -U postgres -w -X -q -d "$ADMIN_DB" \
      -c "DROP DATABASE IF EXISTS \"$SCRATCH_DB\";" >/dev/null 2>&1 || true
  fi
  docker exec "$CONTAINER" rm -f "$CTR_DUMP" "$CTR_LIST" >/dev/null 2>&1 || true
  [ -n "$TOC_TMP" ] && rm -f "$TOC_TMP"
  [ -n "$LIST_TMP" ] && rm -f "$LIST_TMP"
  [ -n "$COUNT_TMP" ] && rm -f "$COUNT_TMP"
  return 0
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Print the TOC on stdout without the excluded entries; print the number
# of excluded entries on stderr. The pattern travels through ENVIRON, not
# awk -v, because -v applies escape processing to the backslash.
filter_toc() {
  env EXCLUDED_TOC_PATTERN="$EXCLUDED_TOC_PATTERN" awk '
    BEGIN { pat = ENVIRON["EXCLUDED_TOC_PATTERN"] }
    $0 ~ pat { n++; next }
    { print }
    END { print n + 0 > "/dev/stderr" }
  '
}

# Copy the archive into the container, read its TOC, apply the one-entry
# exclusion, and copy the filtered use-list in. Sets LIST_TMP.
prepare_archive() {
  TOC_TMP=$(mktemp) || { err "mktemp failed"; return 1; }
  LIST_TMP=$(mktemp) || { err "mktemp failed"; return 1; }
  COUNT_TMP=$(mktemp) || { err "mktemp failed"; return 1; }

  docker cp "$DUMP" "$CONTAINER:$CTR_DUMP" \
    || { err "docker cp of $DUMP into $CONTAINER failed"; return 1; }
  docker exec "$CONTAINER" pg_restore --list "$CTR_DUMP" > "$TOC_TMP" 2>/dev/null \
    || { err "pg_restore --list failed on $DUMP: not a readable custom-format archive"; return 1; }

  filter_toc < "$TOC_TMP" > "$LIST_TMP" 2> "$COUNT_TMP" \
    || { err "TOC filter failed on $DUMP"; return 1; }
  local excluded
  excluded=$(cat "$COUNT_TMP") \
    || { err "could not read the TOC filter count for $DUMP"; return 1; }
  log "excluded $excluded extension-member TOC entr(ies) (graphql_public.graphql, #38)"
  if [ "$excluded" -gt 1 ]; then
    err "$excluded TOC entries match the graphql_public.graphql exclusion, but #38 proved exactly one unrestorable entry — refusing to widen the exclusion silently"
    return 1
  fi

  docker cp "$LIST_TMP" "$CONTAINER:$CTR_LIST" \
    || { err "docker cp of the use-list into $CONTAINER failed"; return 1; }
}

# Scratch databases leaked by a killed run (no trap runs) are dropped at
# the start of the next scratch restore. The namespace is this script's
# alone; anything older than 24 hours is a leak.
sweep_stale_scratch_dbs() {
  local now names db rest d t epoch
  now=$(date +%s)
  names=$(docker exec "$CONTAINER" psql -U postgres -w -X -q -t -A -d "$ADMIN_DB" \
    -c "SELECT datname FROM pg_database WHERE datname LIKE 'ir_restore_scratch_%'" 2>/dev/null) || return 0
  for db in $names; do
    rest=${db#ir_restore_scratch_}
    d=${rest%%_*}
    rest=${rest#*_}
    t=${rest%%_*}
    epoch=$(date -d "${d:0:4}-${d:4:2}-${d:6:2} ${t:0:2}:${t:2:2}:${t:4:2}" +%s 2>/dev/null) || continue
    if [ $((now - epoch)) -gt 86400 ]; then
      log "dropping stale scratch database $db (left by an earlier run)"
      docker exec "$CONTAINER" psql -U postgres -w -X -q -d "$ADMIN_DB" \
        -c "DROP DATABASE IF EXISTS \"$db\";" >/dev/null 2>&1 || true
    fi
  done
}

# Table definitions in the archive (catalog id 1259 in field 2 marks a
# definition line), and base tables and partitioned parents restored,
# excluding extension-owned relations. Same rule as the backup verify.
TABLE_COUNT_SQL="SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND NOT EXISTS (SELECT 1 FROM pg_depend d
                     WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid
                       AND d.deptype = 'e')"

run_scratch() {
  prepare_archive || return 1
  sweep_stale_scratch_dbs

  SCRATCH_DB="ir_restore_scratch_$(date +%Y%m%d_%H%M%S)_$$"
  [ "$SCRATCH_DB" != "$SRC_DB" ] \
    || { err "scratch database name would collide with the live database"; return 1; }
  docker exec "$CONTAINER" psql -U postgres -w -X -q -d "$ADMIN_DB" \
    -c "CREATE DATABASE \"$SCRATCH_DB\"" >/dev/null \
    || { err "could not create scratch database $SCRATCH_DB"; return 1; }
  SCRATCH_CREATED=1

  docker exec "$CONTAINER" pg_restore -w -U postgres --exit-on-error \
      --use-list "$CTR_LIST" -d "$SCRATCH_DB" "$CTR_DUMP" \
    || { err "pg_restore into $SCRATCH_DB failed: $DUMP does NOT restore cleanly"; return 1; }

  local expected actual size
  expected=$(awk '$4 == "TABLE" && $2 != "0" { n++ } END { print n + 0 }' "$LIST_TMP") \
    || { err "table-count parse failed on $DUMP"; return 1; }
  actual=$(docker exec "$CONTAINER" psql -U postgres -w -X -q -t -A -d "$SCRATCH_DB" -c "$TABLE_COUNT_SQL") \
    || { err "restored-table count query failed"; return 1; }
  [ "$actual" = "$expected" ] \
    || { err "restored table count $actual does not match the archive's $expected"; return 1; }
  [ "$actual" -ge "$MIN_TABLES" ] \
    || { err "restored $actual tables, below the MIN_TABLES floor of $MIN_TABLES"; return 1; }

  size=$(docker exec "$CONTAINER" psql -U postgres -w -X -q -t -A -d "$SCRATCH_DB" \
    -c "SELECT pg_database_size('$SCRATCH_DB')") || size="?"
  docker exec "$CONTAINER" psql -U postgres -w -X -q -d "$ADMIN_DB" \
    -c "DROP DATABASE \"$SCRATCH_DB\"" >/dev/null \
    || { err "drop of scratch database $SCRATCH_DB failed"; return 1; }
  SCRATCH_CREATED=0
  SCRATCH_DB=""
  log "scratch OK: $DUMP restores cleanly ($actual tables, $size bytes); scratch database dropped; live database not touched"
}

run_live() {
  prepare_archive || return 1
  log "LIVE restore: $DUMP into live database $SRC_DB (I_ACCEPT_DOWNTIME=1, one transaction)"
  docker exec "$CONTAINER" pg_restore -w -U postgres --clean --if-exists --single-transaction \
      --exit-on-error --use-list "$CTR_LIST" -d "$SRC_DB" "$CTR_DUMP" \
    || { err "live restore into $SRC_DB failed; it was rolled back in one transaction"; return 1; }
  log "LIVE restore OK into $SRC_DB"
}

case "$MODE" in
  scratch) run_scratch || { err "scratch restore check FAILED for $DUMP"; exit 1; } ;;
  live)    run_live    || exit 1 ;;
esac
exit 0
