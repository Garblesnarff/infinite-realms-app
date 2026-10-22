#!/usr/bin/env bash
# backup-infiniterealms-db.sh — InfiniteRealms database backup with a
# verify step that can actually fail. (#38, option 3.)
#
# THE PROBLEM THIS FIXES (#38): the previous backup's verification loaded
# the dump with plain psql and no ON_ERROR_STOP, so every restore error
# was swallowed and the run still reported success — "95 tables restored"
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
# THE SHAPE NOW: pg_dump -Fc (custom format). Verification restores the
# archive into a throwaway database with pg_restore --exit-on-error and a
# --use-list that excludes exactly that one ACL entry. The entry stays in
# the .dump itself — it is skipped only for the verify restore, where the
# function legitimately cannot exist until the extension is installed.
# The exclusion is anchored on the TOC field shape
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
# (restore-infiniterealms-db.sh) consumes the .sql.gz today.
#
# Usage:
#   backup-infiniterealms-db.sh                    dump + verify
#   backup-infiniterealms-db.sh --verify-only <dump-file>
#                                                  verify an existing dump
# Exit codes: 0 ok · 1 dump or verify failed · 2 usage error
#
# Connection: the standard libpq environment (PGHOST, PGPORT, PGUSER,
# PGPASSWORD / .pgpass, PGDATABASE = the source database, default
# postgres). Artifacts are created mode 0600 (umask 077).
# Overrides:
#   BACKUP_DIR        default /var/backups/infiniterealms
#   BACKUP_KEEP_PLAIN 1 (default) also write the .sql.gz copy; 0 skips it
#   BACKUP_VERIFY     1 (default) verify after dumping; 0 skips (announced)
#   BACKUP_ADMIN_DB   maintenance database for createdb/dropdb (default
#                     postgres — the database that always exists)
# Both BACKUP_* switches accept only the literals 0 and 1; anything else
# is a usage error, never a silent downgrade.
#
# NOTE: the verify restores a second full copy of the database on the
# same server. Keep disk headroom of at least the database's size free
# (see the install notes in ops/README.md).
#
# This script deliberately implements NO retention/pruning: the script
# previously installed on the VPS was never tracked in this repo, so its
# prune behaviour is unrecorded; Hetzner confirms parity at install time
# (see ops/README.md) instead of this file inventing retention.

set -euo pipefail
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
    exit 1
  }
}
need pg_restore
need psql
need createdb
need dropdb
if [ -z "$VERIFY_ONLY" ]; then
  need pg_dump
  need gzip
fi

log() { printf '%s: %s\n' "$PROG" "$*"; }
err() { printf '%s: ERROR: %s\n' "$PROG" "$*" >&2; }
die() { err "$*"; exit 1; }

SRC_DB=${PGDATABASE:-postgres}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/infiniterealms}
KEEP_PLAIN=${BACKUP_KEEP_PLAIN:-1}
DO_VERIFY=${BACKUP_VERIFY:-1}
ADMIN_DB=${BACKUP_ADMIN_DB:-postgres}
case "$KEEP_PLAIN" in
  0|1) ;;
  *) err "BACKUP_KEEP_PLAIN must be 0 or 1 (got: $KEEP_PLAIN)"; exit 2 ;;
esac
case "$DO_VERIFY" in
  0|1) ;;
  *) err "BACKUP_VERIFY must be 0 or 1 (got: $DO_VERIFY)"; exit 2 ;;
esac

# The one unrestorable TOC entry class (#38): ACLs on the pg_graphql
# extension-member function. Anchored at the open paren — see the header.
readonly EXCLUDED_TOC_PATTERN=' ACL graphql_public FUNCTION graphql\('

# Verify scratch state. VERIFY_CREATED is the guard that keeps the EXIT
# trap from ever dropping a database this run did not create.
VERIFY_DB=""
VERIFY_CREATED=0
TOC_TMP=""
LIST_TMP=""
COUNT_TMP=""
DUMP_PARTIAL=""
PLAIN_PARTIAL=""

cleanup() {
  if [ "$VERIFY_CREATED" = "1" ] && [ -n "$VERIFY_DB" ]; then
    PGDATABASE=$ADMIN_DB dropdb -w --if-exists "$VERIFY_DB" >/dev/null 2>&1 || true
  fi
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
filter_toc() {
  awk -v pat="$EXCLUDED_TOC_PATTERN" '
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
  names=$(psql -w -X -q -t -A -d "$ADMIN_DB" \
    -c "SELECT datname FROM pg_database WHERE datname LIKE 'ir_backup_verify_%'" 2>/dev/null) || return 0
  for db in $names; do
    rest=${db#ir_backup_verify_}
    d=${rest%%_*}
    rest=${rest#*_}
    t=${rest%%_*}
    epoch=$(date -d "${d:0:4}-${d:4:2}-${d:6:2} ${t:0:2}:${t:2:2}:${t:4:2}" +%s 2>/dev/null) || continue
    if [ $((now - epoch)) -gt 86400 ]; then
      log "verify: dropping stale scratch database $db (left behind by an earlier run)"
      PGDATABASE=$ADMIN_DB dropdb -w --if-exists "$db" >/dev/null 2>&1 || true
    fi
  done
}

# Restore $1 into a throwaway database and require a clean restore.
# Returns non-zero (with the error on stderr) when the dump does not
# restore cleanly; on failure paths the scratch database is dropped by
# the EXIT trap, on success it is dropped explicitly below.
verify_dump() {
  local dump=$1
  [ -f "$dump" ] || { err "verify: no such file: $dump"; return 1; }

  TOC_TMP=$(mktemp) || { err "verify: mktemp failed"; return 1; }
  LIST_TMP=$(mktemp) || { err "verify: mktemp failed"; return 1; }
  COUNT_TMP=$(mktemp) || { err "verify: mktemp failed"; return 1; }

  pg_restore --list "$dump" > "$TOC_TMP" 2>/dev/null \
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

  sweep_stale_verify_dbs

  VERIFY_DB="ir_backup_verify_$(date +%Y%m%d_%H%M%S)_$$"
  [ "$VERIFY_DB" != "$SRC_DB" ] \
    || { err "verify: scratch database name would collide with the source database"; return 1; }
  PGDATABASE=$ADMIN_DB createdb -w "$VERIFY_DB" \
    || { err "verify: createdb $VERIFY_DB failed"; return 1; }
  VERIFY_CREATED=1

  pg_restore -w --exit-on-error --use-list "$LIST_TMP" -d "$VERIFY_DB" "$dump" \
    || { err "verify: pg_restore into $VERIFY_DB failed — the dump does NOT restore cleanly"; return 1; }

  # Count check BEFORE the scratch database is dropped, so a mismatch is
  # reported while the restored database still exists in the log trail.
  # Expected: TOC lines for table DEFINITIONS. In pg_restore --list
  # output a definition line carries its catalog id in field 2 (1259 for
  # tables), while every glue line — TABLE DATA, TABLE ATTACH, ACL,
  # COMMENT — carries 0 there; the type field alone cannot be used,
  # because a definition's fifth field is the schema name, which could
  # itself be DATA or ATTACH. Actual: base tables and partitioned
  # parents from pg_class, so both sides measure the same set.
  local expected actual
  expected=$(awk '$4 == "TABLE" && $2 != "0" { n++ } END { print n + 0 }' "$LIST_TMP") \
    || { err "verify: table-count parse failed on $dump"; return 1; }
  actual=$(psql -w -X -q -t -A -d "$VERIFY_DB" -c \
    "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema')") \
    || { err "verify: restored-table count query failed"; return 1; }
  [ "$actual" = "$expected" ] \
    || { err "verify: restored table count $actual does not match the archive's $expected"; return 1; }

  local size
  size=$(psql -w -X -q -t -A -d "$VERIFY_DB" -c "SELECT pg_database_size('$VERIFY_DB')") || size="?"
  PGDATABASE=$ADMIN_DB dropdb -w --if-exists "$VERIFY_DB" \
    || { err "verify: dropdb $VERIFY_DB failed"; return 1; }
  VERIFY_CREATED=0
  VERIFY_DB=""
  rm -f "$TOC_TMP" "$LIST_TMP" "$COUNT_TMP"
  TOC_TMP=""
  LIST_TMP=""
  COUNT_TMP=""
  log "verify: OK — $dump restores cleanly ($actual tables, scratch restore used $size bytes)"
}

if [ -n "$VERIFY_ONLY" ]; then
  verify_dump "$VERIFY_ONLY"
  exit 0
fi

mkdir -p "$BACKUP_DIR" || die "cannot create BACKUP_DIR: $BACKUP_DIR"
STAMP=$(date +%Y%m%d_%H%M%S)
DUMP="$BACKUP_DIR/infiniterealms_$STAMP.dump"
PLAIN="$BACKUP_DIR/infiniterealms_$STAMP.sql.gz"
DUMP_PARTIAL="$DUMP.partial.$$"
PLAIN_PARTIAL="$PLAIN.partial.$$"

[ -e "$DUMP" ] && die "refusing to overwrite existing backup: $DUMP"
[ "$KEEP_PLAIN" != "1" ] || [ ! -e "$PLAIN" ] || die "refusing to overwrite existing backup: $PLAIN"

log "dumping $SRC_DB -> $DUMP (pg_dump -Fc)"
pg_dump -w -Fc -d "$SRC_DB" -f "$DUMP_PARTIAL" \
  || { rm -f "$DUMP_PARTIAL"; die "pg_dump failed; no backup written"; }
mv "$DUMP_PARTIAL" "$DUMP" || die "could not move the finished dump into place: $DUMP"
sync >/dev/null 2>&1 || true
log "dump written: $DUMP"

if [ "$KEEP_PLAIN" = "1" ]; then
  # Plain-SQL copy for one retention cycle (#38), rendered from the same
  # archive so both files are the same snapshot. pipefail makes a
  # pg_restore failure fail this step even though gzip exits 0.
  pg_restore -f - "$DUMP" | gzip > "$PLAIN_PARTIAL" \
    || { rm -f "$PLAIN_PARTIAL"; die "plain-SQL render failed; the .dump is intact: $DUMP"; }
  mv "$PLAIN_PARTIAL" "$PLAIN" || die "could not move the plain copy into place: $PLAIN"
  log "plain copy written: $PLAIN"
fi

if [ "$DO_VERIFY" = "1" ]; then
  if ! verify_dump "$DUMP"; then
    # A failed verify must not leave final-named artifacts that look
    # verified to anything globbing infiniterealms_*.dump downstream.
    if mv "$DUMP" "$DUMP.unverified"; then
      log "evidence: $DUMP renamed to $DUMP.unverified"
    else
      err "could not rename $DUMP to $DUMP.unverified — the UNVERIFIED dump is still at its original name"
    fi
    if [ -f "$PLAIN" ]; then mv "$PLAIN" "$PLAIN.unverified" || true; fi
    die "verify failed — artifacts kept as evidence under the .unverified suffix"
  fi
else
  log "verify SKIPPED (BACKUP_VERIFY=0) — this backup is UNVERIFIED"
fi

log "OK $DUMP"
