#!/usr/bin/env bash
# Cases for ops/backup-infiniterealms-db.sh (#38, option 3): a full drill
# against a throwaway Postgres cluster —
#   * a normal backup verifies and restores (rows checked independently),
#     with the Supabase-normal table furniture (grants, comments,
#     partitions) that must not skew the verify's table count;
#   * the prod dump shape — ACLs for the pg_graphql extension-member
#     function whose definition pg_dump cannot emit — fails an unfiltered
#     pg_restore with #38's exact signature and passes the script's
#     filtered verify; a SECOND matching entry is refused, not widened;
#   * corrupt dumps (truncated, garbage) fail --verify-only loudly;
#   * a list-valid but restore-invalid archive (ACL granted to a role
#     dropped after the dump) fails verification — the negative control
#     that proves the verify really restores;
#   * with PGDATABASE unset the script still dumps the database it names;
#   * the pre-#38 behaviour is pinned as a contrast: psql without
#     ON_ERROR_STOP exits 0 over the same error shape;
#   * flags, overwrite refusal, and a BACKUP_DIR containing spaces;
#   * the drop-in's additions: 30-day pruning (old artifacts go, recent
#     ones and .unverified evidence stay, --verify-only never prunes)
#     and the Slack alert path (alert file + webhook call on failure,
#     silence on success, dry-run print when BACKUP_NOTIFY=0).
#
# The script under test talks to Postgres only through `docker exec`,
# so the suite provides a `docker` shim in a temp bin dir: exec runs the
# command locally against the scratch cluster (the "container" name is
# ignored) and cp copies between local paths. No host docker is needed.
# The Slack webhook is likewise stubbed: a fake `curl` that logs its
# arguments instead of posting. The cluster itself is self-provisioned
# (initdb on a temp datadir, random port, socket-less TCP on
# 127.0.0.1). When no Postgres server binaries exist the suite SKIPs
# cleanly (exit 0) with a message, like ops/tests/http-alarm.sh. Run by
# hand or on the box:
#   bash ops/tests/backup-restore.sh
# Run ONE suite per host at a time: the prod-shape case installs a
# probe extension into the shared extension directory.

set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

SCRIPT="$PWD/ops/backup-infiniterealms-db.sh"
pass=0
fail=0
skip=0
say() { printf '%s\n' "$*"; }
ok() { say "ok - $1"; pass=$((pass + 1)); }
bad() { say "FAIL - $1"; fail=$((fail + 1)); }
skipped() { say "skip - $1"; skip=$((skip + 1)); }
expect() { # description command...
  local desc=$1; shift
  if "$@" >/dev/null 2>&1; then ok "$desc"; else bad "$desc"; fi
}
has() { case "$1" in *"$2"*) return 0 ;; *) return 1 ;; esac }
expect_has() { # description haystack needle
  if has "$1" "$2"; then ok "$3"; else bad "$3"; fi
}

for tool in pg_dump pg_restore psql gzip jq; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    say "skip - $tool not on PATH; cannot run the backup drill"
    say "0 passed, 0 failed, 1 skipped"
    exit 0
  fi
done
[ -f "$SCRIPT" ] || { say "FAIL - $SCRIPT missing"; exit 1; }

# --- locate server binaries (initdb / pg_ctl are not always on PATH) ----
BINDIR=""
if command -v initdb >/dev/null 2>&1; then
  BINDIR=$(dirname "$(command -v initdb)")
elif command -v pg_config >/dev/null 2>&1; then
  BINDIR=$(pg_config --bindir)
fi
if [ -z "$BINDIR" ] || [ ! -x "$BINDIR/initdb" ] || [ ! -x "$BINDIR/pg_ctl" ]; then
  say "skip - no Postgres server binaries (initdb/pg_ctl) found; install postgresql to run the backup drill"
  say "0 passed, 0 failed, 1 skipped"
  exit 0
fi
SHAREDIR=$($BINDIR/pg_config --sharedir 2>/dev/null || pg_config --sharedir)

# --- scratch cluster ------------------------------------------------------
TMP=$(mktemp -d)
DATA="$TMP/cluster"
SOCK="$TMP/sock"
mkdir -p "$SOCK"
STARTED=0
PORT=""
INITDB_LOG="$TMP/initdb.log"
SERVER_LOG="$TMP/server.log"
EXT_FILES=""

# --- docker + curl shims (the script's only host dependencies) -----------
# The script under test reaches Postgres only via `docker exec` / `docker
# cp`, and alerts only via curl. Neither needs to be real here: exec runs
# the command locally against the scratch cluster, cp copies between
# local paths, and the curl stub logs its arguments to $CURL_LOG.
mkdir -p "$TMP/bin"
cat > "$TMP/bin/docker" <<'SHIM'
#!/usr/bin/env bash
# docker shim for the backup drill: the "container" is fictional, but
# its NAME is checked — the script defaults to supabase-db, and a shim
# that silently accepted any name would pass a test the production run
# (wrong CONTAINER) would fail.
EXPECTED="${DOCKER_SHIM_CONTAINER:-supabase-db}"
if [ "${1:-}" = "exec" ]; then
  shift
  while [ "${1:-}" = "-i" ] || [ "${1:-}" = "-t" ]; do shift; done
  container=$1; shift
  [ "$container" = "$EXPECTED" ] || { echo "docker shim: unexpected container: $container" >&2; exit 1; }
  exec "$@"
elif [ "${1:-}" = "cp" ]; then
  src=$2; dst=$3
  case "$src" in *:* ) c=${src%%:*}; [ "$c" = "$EXPECTED" ] || { echo "docker shim: unexpected container: $c" >&2; exit 1; }; src=${src#*:} ;; esac
  case "$dst" in *:* ) c=${dst%%:*}; [ "$c" = "$EXPECTED" ] || { echo "docker shim: unexpected container: $c" >&2; exit 1; }; dst=${dst#*:} ;; esac
  exec cp "$src" "$dst"
else
  echo "docker shim: unsupported subcommand: ${1:-}" >&2
  exit 1
fi
SHIM
cat > "$TMP/bin/curl" <<'SHIM'
#!/usr/bin/env bash
echo "curl $*" >> "${CURL_LOG:-/dev/null}"
exit 0
SHIM
chmod +x "$TMP/bin/docker" "$TMP/bin/curl"
export PATH="$TMP/bin:$PATH"

# Hermetic alerting: failing runs in this suite must not write to the
# host's real alert log or env file. Point the script's alert paths at
# $TMP unless a case overrides them explicitly (the alert cases do).
# The default env file is deliberately NOT created: an unreadable env
# file means no Slack attempt, silently.
export BACKUP_ALERT_FILE="$TMP/alerts-default.log"
export BACKUP_ALERTS_ENV="$TMP/alerts-default.env"
printf '%s\n' 'SLACK_ALERT_WEBHOOK_URL=stub://test' > "$TMP/alerts.env"

# The cluster must run as a non-root user when we are root (initdb
# refuses root), and as ourselves otherwise.
RUNAS=()
CHOWN_TO=""
if [ "$(id -u)" = "0" ]; then
  RUNAS=(runuser -u postgres --)
  CHOWN_TO=postgres
fi
as_pg() { "${RUNAS[@]}" "$@"; }

cleanup() {
  if [ "$STARTED" = "1" ]; then
    as_pg "$BINDIR/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1
  fi
  if [ -n "$EXT_FILES" ]; then rm -f $EXT_FILES; fi
  if [ "$fail" != "0" ] || { [ "$STARTED" != "1" ] && [ -n "$BINDIR" ]; }; then
    # Keep failures diagnosable: the logs die with $TMP, so surface them.
    say "--- initdb log (tail) ---" >&2
    tail -20 "$INITDB_LOG" >&2 2>/dev/null
    say "--- server log (tail) ---" >&2
    tail -20 "$SERVER_LOG" >&2 2>/dev/null
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

PW=irtestpw
printf '%s' "$PW" > "$TMP/pwfile"
chmod 600 "$TMP/pwfile"
[ -z "$CHOWN_TO" ] || chown -R "$CHOWN_TO" "$TMP"
as_pg "$BINDIR/initdb" -D "$DATA" -U postgres --auth-local=trust --auth-host=scram-sha-256 \
  --pwfile="$TMP/pwfile" > "$INITDB_LOG" 2>&1 \
  || { say "FAIL - initdb failed (log above)"; tail -20 "$INITDB_LOG" >&2; exit 1; }

for attempt in 1 2 3 4 5; do
  PORT=$(( (RANDOM % 2000) + 54000 ))
  if as_pg "$BINDIR/pg_ctl" -D "$DATA" -l "$SERVER_LOG" \
      -o "-p $PORT -k $SOCK -c listen_addresses=127.0.0.1 -c fsync=off" -w start >/dev/null 2>&1; then
    STARTED=1
    break
  fi
done
[ "$STARTED" = "1" ] || { say "FAIL - scratch Postgres did not start on any port (log above)"; tail -20 "$SERVER_LOG" >&2; exit 1; }

export PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=postgres PGPASSWORD=$PW
psql_admin() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }

# --- fixture: a Supabase-shaped source database ---------------------------
# Roles mirror prod's; the tables carry the furniture real prod tables
# carry — a non-default GRANT and a COMMENT — plus a partitioned table.
psql_admin -d postgres <<'SQL'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE backupro LOGIN SUPERUSER PASSWORD 'irtestpw';
CREATE DATABASE backupro OWNER backupro;
CREATE DATABASE srcdb;
CREATE TABLE golden (id int PRIMARY KEY);
INSERT INTO golden VALUES (1);
SQL
psql_admin -d srcdb <<'SQL'
CREATE TABLE campaigns (id int PRIMARY KEY, name text NOT NULL);
CREATE TABLE dice_rolls (id int PRIMARY KEY, campaign_id int NOT NULL, total int NOT NULL);
INSERT INTO campaigns VALUES (1, 'First Steps'), (2, 'Midsummer'), (3, 'The Long Night');
INSERT INTO dice_rolls VALUES (1, 1, 17), (2, 1, 4), (3, 2, 20), (4, 3, 11), (5, 3, 8);
GRANT SELECT ON campaigns TO anon;
COMMENT ON TABLE campaigns IS 'restore-test fixture';
CREATE TABLE events (id int NOT NULL, name text) PARTITION BY RANGE (id);
CREATE TABLE events_1 PARTITION OF events FOR VALUES FROM (0) TO (100);
INSERT INTO events VALUES (1, 'gate opens');
CREATE SCHEMA "DATA";
CREATE TABLE "DATA".weird (id int PRIMARY KEY);
SQL

run_backup() { # backup-dir database
  OUT=$(env PGDATABASE="$2" BACKUP_DIR="$1" bash "$SCRIPT" 2>&1)
  RC=$?
}
run_verify_only() { # dump-file
  OUT=$(env PGDATABASE=srcdb bash "$SCRIPT" --verify-only "$1" 2>&1)
  RC=$?
}
verify_db_names() {
  psql -X -q -t -A -d postgres -c \
    "SELECT datname FROM pg_database WHERE datname LIKE 'ir_backup_verify_%'"
}

# --- case: end-to-end backup + verify -------------------------------------
run_backup "$TMP/backups1" srcdb
expect "backup script exits 0 on a healthy database" test "$RC" -eq 0
expect_has "$OUT" "verify: OK" "verify reports OK"
expect_has "$OUT" "excluded 0 extension-member" "no exclusions are claimed for a database without the graphql function"
expect_has "$OUT" "(5 tables" "verify restores all 5 tables (grants/comments/partitions/a DATA-named schema do not skew the count)"
DUMP1=$(ls "$TMP"/backups1/*.dump 2>/dev/null | head -1)
PLAIN1=$(ls "$TMP"/backups1/*.sql.gz 2>/dev/null | head -1)
expect "a .dump artifact exists" test -n "$DUMP1"
expect "a .sql.gz plain copy exists" test -n "$PLAIN1"
expect "plain copy carries the campaigns table" \
  bash -c "zcat '$PLAIN1' | grep -q 'CREATE TABLE public.campaigns'"
expect "plain copy carries row data, not just DDL" \
  bash -c "zcat '$PLAIN1' | grep -q 'First Steps'"
expect "source database is untouched (3 campaigns)" \
  bash -c "test \"\$(psql -X -q -t -A -d srcdb -c 'SELECT count(*) FROM campaigns')\" = '3'"
expect "no scratch verify database is left behind" \
  bash -c "test -z \"\$(psql -X -q -t -A -d postgres -c \"SELECT datname FROM pg_database WHERE datname LIKE 'ir_backup_verify_%'\")\""

# Independent restore of the produced dump — not via the script.
psql_admin -d postgres -c "CREATE DATABASE restoredb" >/dev/null
OUT=$(pg_restore -w --exit-on-error -d restoredb "$DUMP1" 2>&1); RC=$?
expect "independent pg_restore of the produced dump exits 0" test "$RC" -eq 0
expect "restored campaigns row count matches source (3)" \
  bash -c "test \"\$(psql -X -q -t -A -d restoredb -c 'SELECT count(*) FROM campaigns')\" = '3'"
expect "restored dice_rolls row count matches source (5)" \
  bash -c "test \"\$(psql -X -q -t -A -d restoredb -c 'SELECT count(*) FROM dice_rolls')\" = '5'"

# --- case: --verify-only on the good dump ----------------------------------
run_verify_only "$DUMP1"
expect "--verify-only exits 0 on a good dump" test "$RC" -eq 0
expect_has "$OUT" "(5 tables" "--verify-only reports the restored table count"

# --- case: corrupt dumps fail loudly ---------------------------------------
head -c 200 "$DUMP1" > "$TMP/truncated.dump"
run_verify_only "$TMP/truncated.dump"
expect "truncated dump fails --verify-only (non-zero)" test "$RC" -ne 0
expect_has "$OUT" "ERROR" "truncated dump failure is loud"
expect "no scratch database leaks after the truncated-dump failure" \
  bash -c "test -z \"\$1\"" _ "$(verify_db_names)"

head -c 4096 /dev/urandom > "$TMP/garbage.dump"
run_verify_only "$TMP/garbage.dump"
expect "garbage file fails --verify-only (non-zero)" test "$RC" -ne 0
expect_has "$OUT" "ERROR" "garbage file failure is loud"
expect "no scratch database leaks after the garbage failure" \
  bash -c "test -z \"\$1\"" _ "$(verify_db_names)"

# --- case: PGDATABASE unset still dumps the named database -----------------
# SRC_DB defaults to postgres; libpq would default to the PGUSER-named
# database (backupro, empty). The dump must contain postgres's golden
# table — the pre-fix script dumped the wrong database and verified it.
OUT=$(env -u PGDATABASE PGUSER=backupro BACKUP_DIR="$TMP/backups-unset" bash "$SCRIPT" 2>&1); RC=$?
expect "backup with PGDATABASE unset exits 0" test "$RC" -eq 0
DUMP_UNSET=$(ls "$TMP"/backups-unset/*.dump 2>/dev/null | head -1)
expect "the PGDATABASE-unset dump contains the golden table from postgres" \
  bash -c "pg_restore --list '$DUMP_UNSET' | grep -q ' TABLE public golden '"

# --- case: list-valid but restore-invalid archive fails verification -------
# Grant a table ACL to a role, dump (verify passes while the role
# exists), then drop the role: the archive stays --list-readable and its
# table count is intact, but a real restore fails. A verify stubbed down
# to listing + counting would pass this; a real restore must not.
psql_admin -d srcdb -c "CREATE ROLE doomed NOLOGIN" -c "GRANT SELECT ON campaigns TO doomed"
run_backup "$TMP/backups-doomed" srcdb
expect "backup succeeds while the granted role exists" test "$RC" -eq 0
DUMP_DOOMED=$(ls "$TMP"/backups-doomed/*.dump 2>/dev/null | head -1)
psql_admin -d srcdb -c "REVOKE SELECT ON campaigns FROM doomed" -c "DROP ROLE doomed"
expect "the doomed-role archive is still list-readable" pg_restore --list "$DUMP_DOOMED"
run_verify_only "$DUMP_DOOMED"
expect "verify FAILS (exit 1) on a list-valid archive whose restore errors" test "$RC" -eq 1
expect_has "$OUT" 'role "doomed" does not exist' "the failure names the restore error"

# --- case: the prod shape (extension-member ACL, no definition) ------------
EXT_DIR="$SHAREDIR/extension"
PROBE_CTL="$EXT_DIR/ir_backup_probe_ext.control"
PROBE_SQL="$EXT_DIR/ir_backup_probe_ext--1.0.sql"
if [ -e "$PROBE_CTL" ] || [ -e "$PROBE_SQL" ]; then
  # Each file is judged on its own marker: a partial leftover of THIS
  # suite's (one file of the pair) is still ours to remove; a file
  # without the marker is foreign and is never touched.
  foreign=0
  if [ -e "$PROBE_CTL" ] && ! grep -q 'ir backup restore test probe' "$PROBE_CTL" 2>/dev/null; then foreign=1; fi
  if [ -e "$PROBE_SQL" ] && ! grep -q 'ir-backup-probe' "$PROBE_SQL" 2>/dev/null; then foreign=1; fi
  if [ "$foreign" = "0" ]; then
    say "note - removing stale probe extension files left by a killed earlier run"
    rm -f "$PROBE_CTL" "$PROBE_SQL"
  else
    bad "probe extension files exist in $EXT_DIR but are not this suite's — refusing to touch them"
  fi
fi
if [ -e "$PROBE_CTL" ] || [ -e "$PROBE_SQL" ]; then
  skipped "prod-shape case blocked by foreign probe files in the extension dir"
elif [ ! -w "$EXT_DIR" ]; then
  skipped "extension dir $EXT_DIR is not writable; prod-shape case cannot install its probe extension"
else
  cat > "$PROBE_CTL" <<'EOF'
comment = 'ir backup restore test probe'
default_version = '1.0'
relocatable = false
EOF
  cat > "$PROBE_SQL" <<'EOF'
-- ir-backup-probe: creates two extension-owned tables — one plain
-- member, one registered as a config table — so the drill also covers
-- extension-owned relations in the verify's table count. The fixture
-- attaches a function to this extension with ALTER EXTENSION ... ADD,
-- exactly how Supabase attaches graphql_public.graphql to pg_graphql —
-- so pg_dump omits the function's definition (extension members are
-- recreated by CREATE EXTENSION) but still dumps its ACLs.
CREATE TABLE probe_member_table (id int PRIMARY KEY, note text);
CREATE TABLE probe_cfg_table (id int PRIMARY KEY, setting text);
SELECT pg_extension_config_dump('probe_cfg_table', '');
EOF
  chmod 644 "$PROBE_CTL" "$PROBE_SQL"
  EXT_FILES="$PROBE_CTL $PROBE_SQL"
  psql_admin -d postgres -c "CREATE DATABASE proddb" >/dev/null
  psql_admin -d proddb <<'SQL'
CREATE SCHEMA graphql_public;
CREATE EXTENSION ir_backup_probe_ext;
CREATE FUNCTION graphql_public.graphql(text, "operationName" text DEFAULT NULL, variables jsonb DEFAULT NULL, extensions jsonb DEFAULT NULL)
  RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
ALTER EXTENSION ir_backup_probe_ext ADD FUNCTION graphql_public.graphql(text, text, jsonb, jsonb);
GRANT EXECUTE ON FUNCTION graphql_public.graphql(text, text, jsonb, jsonb) TO anon, authenticated;
CREATE TABLE campaigns (id int PRIMARY KEY, name text NOT NULL);
INSERT INTO campaigns VALUES (1, 'Prod Shape');
INSERT INTO probe_member_table VALUES (1, 'm1'), (2, 'm2');
INSERT INTO probe_cfg_table VALUES (1, 'c1'), (2, 'c2');
SQL
  pg_dump -Fc -d proddb -f "$TMP/prod.dump"
  expect "prod-shape archive carries the graphql ACL entry" \
    bash -c "pg_restore --list '$TMP/prod.dump' | grep -q ' ACL graphql_public FUNCTION graphql('"
  expect "prod-shape archive omits the extension-owned definition" \
    bash -c "! pg_restore --list '$TMP/prod.dump' | grep -q ' FUNCTION graphql_public graphql('"
  psql_admin -d postgres -c "CREATE DATABASE freshdb" >/dev/null
  OUT=$(pg_restore -w --exit-on-error -d freshdb "$TMP/prod.dump" 2>&1); RC=$?
  expect "unfiltered pg_restore --exit-on-error FAILS on the prod shape" test "$RC" -ne 0
  expect_has "$OUT" "function graphql_public.graphql(text, text, jsonb, jsonb) does not exist" \
    "the unfiltered failure is #38's exact signature"
  OUT=$(env PGDATABASE=proddb BACKUP_DIR="$TMP/backups-prod" bash "$SCRIPT" 2>&1); RC=$?
  expect "script backup+verify passes on the prod-shape database" test "$RC" -eq 0
  expect_has "$OUT" "excluded 1 extension-member" "exactly one TOC entry is excluded for the prod shape"
  expect_has "$OUT" "(1 tables" "prod-shape verify counts only the dumped table (extension-owned tables excluded on both sides)"
  expect "no scratch database leaks after the prod-shape run" \
    bash -c "test -z \"\$1\"" _ "$(verify_db_names)"

  # Extension-owned tables, pinned: the member table is absent from the
  # archive entirely; the config table appears only as a TABLE DATA
  # entry. A full restore recreates both via CREATE EXTENSION (config
  # rows land, member rows do not), so a naive restored-side count is
  # 3 against the archive's 1 dumped definition — the skew the verify's
  # pg_depend exclusion exists to cancel.
  PROD_DUMP=$(ls "$TMP"/backups-prod/*.dump 2>/dev/null | head -1)
  expect "member table has no entry at all in the archive" \
    bash -c "! pg_restore --list '$PROD_DUMP' | grep -q 'probe_member_table'"
  expect "config table appears in the archive only as TABLE DATA" \
    bash -c "test \"\$(pg_restore --list '$PROD_DUMP' | grep 'probe_cfg_table')\" = \"\$(pg_restore --list '$PROD_DUMP' | grep ' TABLE DATA .*probe_cfg_table')\""
  psql_admin -d postgres -c "CREATE DATABASE extdb" >/dev/null
  pg_restore -w -d extdb "$PROD_DUMP" >/dev/null 2>&1
  expect "naive restored count would be 3 (the skew is real)" \
    bash -c "test \"\$(psql -X -q -t -A -d extdb -c \"SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema')\")\" = '3'"
  expect "config table rows are restored (2)" \
    bash -c "test \"\$(psql -X -q -t -A -d extdb -c 'SELECT count(*) FROM probe_cfg_table')\" = '2'"
  expect "member table is recreated empty (0 rows)" \
    bash -c "test \"\$(psql -X -q -t -A -d extdb -c 'SELECT count(*) FROM probe_member_table')\" = '0'"

  # A second matching entry must be refused, never silently excluded.
  psql_admin -d proddb <<'SQL'
CREATE FUNCTION graphql_public.graphql(text, text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
ALTER EXTENSION ir_backup_probe_ext ADD FUNCTION graphql_public.graphql(text, text);
GRANT EXECUTE ON FUNCTION graphql_public.graphql(text, text) TO authenticated;
SQL
  OUT=$(env PGDATABASE=proddb BACKUP_DIR="$TMP/backups-prod2" BACKUP_ALERTS_ENV="$TMP/alerts.env" BACKUP_ALERT_FILE="$TMP/alerts-prod2.log" BACKUP_NOTIFY=1 CURL_LOG="$TMP/curl-prod2.log" bash "$SCRIPT" 2>&1); RC=$?
  expect "a second matching TOC entry makes the run FAIL (exit 1)" test "$RC" -eq 1
  expect_has "$OUT" "entries match the graphql_public.graphql exclusion" \
    "the refusal names the widened exclusion"
  expect "the failed run's artifacts are renamed .unverified" \
    bash -c "ls '$TMP'/backups-prod2/*.dump.unverified >/dev/null 2>&1"
  expect "the failed main-path run writes the alert file" \
    bash -c "grep -q 'FAILED' '$TMP/alerts-prod2.log'"
  expect "the failed main-path run calls the Slack webhook once" \
    bash -c "test \"\$(grep -c 'FAILED' '$TMP/curl-prod2.log')\" = '1'"
fi

# --- case: the old verify, pinned as a contrast -----------------------------
psql_admin -d postgres -c "CREATE DATABASE swallowdb" >/dev/null
cat > "$TMP/old-shape.sql" <<'SQL'
CREATE TABLE t1 (id int);
GRANT SELECT ON FUNCTION graphql_public.graphql(text, text, jsonb, jsonb) TO anon;
SQL
OUT=$(psql -X -q -d swallowdb -f "$TMP/old-shape.sql" 2>&1); RC=$?
expect "OLD behaviour: psql without ON_ERROR_STOP exits 0 over the error" test "$RC" -eq 0
expect_has "$OUT" "does not exist" "OLD behaviour: the error was printed and swallowed"
OUT=$(psql -X -q -v ON_ERROR_STOP=1 -d swallowdb -f "$TMP/old-shape.sql" 2>&1); RC=$?
expect "with ON_ERROR_STOP the same file fails" test "$RC" -ne 0

# --- case: argument and flag behaviour --------------------------------------
OUT=$(bash "$SCRIPT" --bogus 2>&1); RC=$?
expect "unknown argument exits 2" test "$RC" -eq 2
OUT=$("$SCRIPT" --bogus 2>&1); RC=$?
expect "direct execution (shebang + exec bit) also exits 2" test "$RC" -eq 2

OUT=$(env PGDATABASE=srcdb BACKUP_DIR="$TMP/backups3" BACKUP_KEEP_PLAIN=0 bash "$SCRIPT" 2>&1); RC=$?
expect "BACKUP_KEEP_PLAIN=0 still exits 0" test "$RC" -eq 0
expect "BACKUP_KEEP_PLAIN=0 produces a .dump" \
  bash -c "ls '$TMP'/backups3/*.dump >/dev/null 2>&1"
expect "BACKUP_KEEP_PLAIN=0 writes no plain copy" \
  bash -c "test -z \"\$(ls '$TMP'/backups3/*.sql.gz 2>/dev/null)\""
OUT=$(env PGDATABASE=srcdb BACKUP_DIR="$TMP/backups4" BACKUP_VERIFY=0 bash "$SCRIPT" 2>&1); RC=$?
expect "BACKUP_VERIFY=0 exits 0" test "$RC" -eq 0
expect_has "$OUT" "verify SKIPPED" "BACKUP_VERIFY=0 announces the skip"
expect "BACKUP_VERIFY=0 produces a .dump" \
  bash -c "ls '$TMP'/backups4/*.dump >/dev/null 2>&1"
OUT=$(env PGDATABASE=srcdb BACKUP_DIR="$TMP/backups5" BACKUP_VERIFY=true bash "$SCRIPT" 2>&1); RC=$?
expect "BACKUP_VERIFY=true (not 0/1) is a usage error, not a silent downgrade" test "$RC" -eq 2
OUT=$(env PGDATABASE=srcdb BACKUP_DIR="$TMP/backups5" BACKUP_KEEP_PLAIN=yes bash "$SCRIPT" 2>&1); RC=$?
expect "BACKUP_KEEP_PLAIN=yes (not 0/1) is a usage error too" test "$RC" -eq 2

# --- case: overwrite refusal -------------------------------------------------
mkdir -p "$TMP/backups6"
for i in 0 1 2 3 4; do
  s=$(date -d "+$i seconds" +%Y%m%d_%H%M%S)
  : > "$TMP/backups6/infiniterealms_$s.dump"
done
: > "$TMP/backups6/infiniterealms_20200101_000000.dump"
touch -d '40 days ago' "$TMP/backups6/infiniterealms_20200101_000000.dump"
OUT=$(env PGDATABASE=srcdb BACKUP_DIR="$TMP/backups6" bash "$SCRIPT" 2>&1); RC=$?
expect "a same-second rerun refuses to overwrite (exit 1)" test "$RC" -eq 1
expect_has "$OUT" "refusing to overwrite" "the refusal is named"
expect "a failed run never prunes (old backup survives the refusal)" \
  bash -c "test -e '$TMP/backups6/infiniterealms_20200101_000000.dump'"

# --- case: BACKUP_DIR with spaces --------------------------------------------
OUT=$(env PGDATABASE=srcdb BACKUP_DIR="$TMP/backup dir spaced" bash "$SCRIPT" 2>&1); RC=$?
expect "a BACKUP_DIR containing spaces works" test "$RC" -eq 0
expect "the spaced-dir run produced a .dump" \
  bash -c "ls '$TMP/backup dir spaced'/*.dump >/dev/null 2>&1"

# --- case: pruning (installed script's 30-day retention) --------------------
mkdir -p "$TMP/backups-prune"
: > "$TMP/backups-prune/infiniterealms_20200101_000000.dump"
: > "$TMP/backups-prune/infiniterealms_20200101_000000.sql.gz"
: > "$TMP/backups-prune/infiniterealms_20200101_000000.dump.unverified"
: > "$TMP/backups-prune/infiniterealms_20200101_000000.sql.gz.unverified"
: > "$TMP/backups-prune/infiniterealms_20200101_000000.dump.partial.999"
: > "$TMP/backups-prune/infiniterealms_20200101_000000.dump.partial.fresh"
: > "$TMP/backups-prune/.in-progress_20200101_000000"
: > "$TMP/backups-prune/infiniterealms_20250101_000000.dump"
: > "$TMP/backups-prune/infiniterealms_20250101_000000.sql.gz"
: > "/tmp/ir_backup_suite_stale_$$.dump"
touch -d '40 days ago' "$TMP/backups-prune/infiniterealms_20200101_000000.dump" \
  "$TMP/backups-prune/infiniterealms_20200101_000000.sql.gz" \
  "$TMP/backups-prune/infiniterealms_20200101_000000.dump.unverified" \
  "$TMP/backups-prune/infiniterealms_20200101_000000.sql.gz.unverified"
touch -d '4 hours ago' "$TMP/backups-prune/infiniterealms_20200101_000000.dump.partial.999" \
  "$TMP/backups-prune/.in-progress_20200101_000000" \
  "/tmp/ir_backup_suite_stale_$$.dump"
OUT=$(env PGDATABASE=srcdb BACKUP_DIR="$TMP/backups-prune" RETENTION_DAYS=30 bash "$SCRIPT" 2>&1); RC=$?
expect "pruning run exits 0" test "$RC" -eq 0
expect "pruning removes a .dump older than RETENTION_DAYS" \
  bash -c "test ! -e '$TMP/backups-prune/infiniterealms_20200101_000000.dump'"
expect "pruning removes a .sql.gz older than RETENTION_DAYS" \
  bash -c "test ! -e '$TMP/backups-prune/infiniterealms_20200101_000000.sql.gz'"
expect "pruning keeps a recent .dump" \
  bash -c "test -e '$TMP/backups-prune/infiniterealms_20250101_000000.dump'"
expect "pruning keeps a recent .sql.gz" \
  bash -c "test -e '$TMP/backups-prune/infiniterealms_20250101_000000.sql.gz'"
expect "pruning never touches .unverified evidence" \
  bash -c "test -e '$TMP/backups-prune/infiniterealms_20200101_000000.dump.unverified'"
expect "pruning never touches .sql.gz.unverified evidence" \
  bash -c "test -e '$TMP/backups-prune/infiniterealms_20200101_000000.sql.gz.unverified'"
expect "pruning removes a stale partial" \
  bash -c "test ! -e '$TMP/backups-prune/infiniterealms_20200101_000000.dump.partial.999'"
expect "pruning keeps a fresh partial (younger than 180 min)" \
  bash -c "test -e '$TMP/backups-prune/infiniterealms_20200101_000000.dump.partial.fresh'"
expect "pruning removes an abandoned pre-drop-in .in-progress file" \
  bash -c "test ! -e '$TMP/backups-prune/.in-progress_20200101_000000'"
expect "pruning removes a stale container /tmp archive" \
  bash -c "test ! -e '/tmp/ir_backup_suite_stale_$$.dump'"
rm -f "/tmp/ir_backup_suite_stale_$$.dump"
expect "pruning run still wrote its own new backup" \
  bash -c "ls '$TMP/backups-prune'/infiniterealms_*.dump | grep -vq '20200101_000000\|20250101_000000'"

# --- case: BACKUP_VERIFY=0 does NOT prune ----------------------------------
# Pruning runs only after a verified backup: an unverified backup must
# never be the reason the last good backups disappear.
mkdir -p "$TMP/backups-noverify-prune"
: > "$TMP/backups-noverify-prune/infiniterealms_20200101_000000.dump"
touch -d '40 days ago' "$TMP/backups-noverify-prune/infiniterealms_20200101_000000.dump"
OUT=$(env PGDATABASE=srcdb BACKUP_DIR="$TMP/backups-noverify-prune" BACKUP_VERIFY=0 bash "$SCRIPT" 2>&1); RC=$?
expect "BACKUP_VERIFY=0 run exits 0 (prune case)" test "$RC" -eq 0
expect_has "$OUT" "prune SKIPPED" "BACKUP_VERIFY=0 announces the skipped prune"
expect "BACKUP_VERIFY=0 leaves old backups alone (no pruning)" \
  bash -c "test -e '$TMP/backups-noverify-prune/infiniterealms_20200101_000000.dump'"

# --- case: --verify-only never prunes ----------------------------------------
mkdir -p "$TMP/backups-no-prune"
: > "$TMP/backups-no-prune/infiniterealms_20200101_000000.dump"
touch -d '40 days ago' "$TMP/backups-no-prune/infiniterealms_20200101_000000.dump"
OUT=$(env PGDATABASE=srcdb BACKUP_DIR="$TMP/backups-no-prune" RETENTION_DAYS=30 bash "$SCRIPT" --verify-only "$DUMP1" 2>&1); RC=$?
expect "--verify-only still exits 0" test "$RC" -eq 0
expect "--verify-only leaves old backups alone (no pruning)" \
  bash -c "test -e '$TMP/backups-no-prune/infiniterealms_20200101_000000.dump'"

# --- case: the Slack alert path (stubbed) ------------------------------------
# (The alerts.env file was created with the shims, above.)
# (a) a failing verify alerts: alert file entry + one stub curl call.
rm -f "$TMP/alerts-a.log" "$TMP/curl-a.log"
OUT=$(env PGDATABASE=srcdb BACKUP_ALERTS_ENV="$TMP/alerts.env" BACKUP_ALERT_FILE="$TMP/alerts-a.log" BACKUP_NOTIFY=1 CURL_LOG="$TMP/curl-a.log" bash "$SCRIPT" --verify-only "$TMP/truncated.dump" 2>&1); RC=$?
expect "failing verify exits non-zero (alert case)" test "$RC" -ne 0
expect "failing verify writes the alert file" \
  bash -c "grep -q 'backup:' '$TMP/alerts-a.log' && grep -q 'FAILED' '$TMP/alerts-a.log'"
expect "failing verify calls the Slack webhook once" \
  bash -c "test \"\$(grep -c 'FAILED' '$TMP/curl-a.log')\" = '1'"
expect "the webhook payload is JSON built by jq" \
  bash -c "grep -q '\"text\"' '$TMP/curl-a.log'"
# (b) a successful backup does not alert.
rm -f "$TMP/alerts-b.log" "$TMP/curl-b.log"
OUT=$(env PGDATABASE=srcdb BACKUP_DIR="$TMP/backups-alertb" BACKUP_ALERTS_ENV="$TMP/alerts.env" BACKUP_ALERT_FILE="$TMP/alerts-b.log" BACKUP_NOTIFY=1 CURL_LOG="$TMP/curl-b.log" bash "$SCRIPT" 2>&1); RC=$?
expect "successful backup exits 0 (alert case)" test "$RC" -eq 0
expect "successful backup writes no alert" \
  bash -c "test ! -e '$TMP/alerts-b.log'"
expect "successful backup makes no webhook call" \
  bash -c "test ! -e '$TMP/curl-b.log'"
# (c) BACKUP_NOTIFY=0 dry-runs: alert file still written, no webhook call.
rm -f "$TMP/alerts-c.log" "$TMP/curl-c.log"
OUT=$(env PGDATABASE=srcdb BACKUP_ALERTS_ENV="$TMP/alerts.env" BACKUP_ALERT_FILE="$TMP/alerts-c.log" BACKUP_NOTIFY=0 CURL_LOG="$TMP/curl-c.log" bash "$SCRIPT" --verify-only "$TMP/truncated.dump" 2>&1); RC=$?
expect "dry-run failing verify exits non-zero" test "$RC" -ne 0
expect_has "$OUT" "[dry-run] slack:" "dry-run prints instead of posting"
expect "dry-run still writes the alert file" \
  bash -c "grep -q 'FAILED' '$TMP/alerts-c.log'"
expect "dry-run makes no webhook call" \
  bash -c "test ! -e '$TMP/curl-c.log'"

# --- case: RETENTION_DAYS validation -----------------------------------------
OUT=$(env PGDATABASE=srcdb BACKUP_DIR="$TMP/backups-ret" RETENTION_DAYS=banana bash "$SCRIPT" 2>&1); RC=$?
expect "RETENTION_DAYS=banana is a usage error (exit 2)" test "$RC" -eq 2
OUT=$(env PGDATABASE=srcdb BACKUP_DIR="$TMP/backups-ret" RETENTION_DAYS=-1 bash "$SCRIPT" 2>&1); RC=$?
expect "RETENTION_DAYS=-1 is a usage error (exit 2)" test "$RC" -eq 2

mkdir -p "$TMP/backups-ret0"
: > "$TMP/backups-ret0/infiniterealms_20200101_000000.dump"
touch -d '40 days ago' "$TMP/backups-ret0/infiniterealms_20200101_000000.dump"
OUT=$(env PGDATABASE=srcdb BACKUP_DIR="$TMP/backups-ret0" RETENTION_DAYS=0 bash "$SCRIPT" 2>&1); RC=$?
expect "RETENTION_DAYS=0 exits 0" test "$RC" -eq 0
expect "RETENTION_DAYS=0 prunes anything older than a day" \
  bash -c "test ! -e '$TMP/backups-ret0/infiniterealms_20200101_000000.dump'"

mkdir -p "$TMP/backups-retempty"
: > "$TMP/backups-retempty/infiniterealms_20200101_000000.dump"
touch -d '40 days ago' "$TMP/backups-retempty/infiniterealms_20200101_000000.dump"
OUT=$(env PGDATABASE=srcdb BACKUP_DIR="$TMP/backups-retempty" RETENTION_DAYS= bash "$SCRIPT" 2>&1); RC=$?
expect "RETENTION_DAYS= (empty) falls back to the 30-day default, exits 0" test "$RC" -eq 0
expect "RETENTION_DAYS= (empty) prunes a 40-day-old backup" \
  bash -c "test ! -e '$TMP/backups-retempty/infiniterealms_20200101_000000.dump'"

# --- case: --verify-only on a missing file, and a wrong container -----------
OUT=$(env PGDATABASE=srcdb bash "$SCRIPT" --verify-only "$TMP/does-not-exist.dump" 2>&1); RC=$?
expect "--verify-only on a missing file exits 1" test "$RC" -eq 1
expect_has "$OUT" "no such file" "the missing file is named"
OUT=$(env PGDATABASE=srcdb CONTAINER=not-supabase bash "$SCRIPT" --verify-only "$DUMP1" 2>&1); RC=$?
expect "a wrong CONTAINER fails (the shim rejects the name)" test "$RC" -ne 0
expect_has "$OUT" "unexpected container" "the wrong container is named"

say "$pass passed, $fail failed, $skip skipped"
[ "$fail" -eq 0 ]
