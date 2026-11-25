#!/usr/bin/env bash
# Cases for ops/restore-infiniterealms-db.sh (#38): a throwaway Postgres
# cluster, the same harness as ops/tests/backup-restore.sh.
#   * --scratch restores a good dump, checks the table count, drops its
#     scratch database, and leaves the live database's rows unchanged;
#   * the prod dump shape (an extension-member ACL on graphql_public.graphql)
#     restores in both modes with exactly one TOC entry excluded, and a
#     SECOND matching entry is refused, not widened;
#   * a truncated, a garbage, and a list-valid-but-restore-invalid archive
#     each fail --scratch; the list-valid one also fails LIVE and leaves
#     the live database exactly as it was (one transaction, rolled back);
#   * LIVE mode refuses unless I_ACCEPT_DOWNTIME=1;
#   * usage errors, the MIN_TABLES floor, and the container-name shim.
#
# The script under test talks to Postgres only through `docker exec` and
# `docker cp`, so this suite provides a `docker` shim in a temp bin dir:
# exec runs the command locally against the scratch cluster, cp copies
# between local paths. No host docker is needed. When no Postgres server
# binaries exist the suite SKIPs cleanly (exit 0). Run by hand:
#   bash ops/tests/restore-infiniterealms-db.sh
# Run ONE suite per host at a time: the prod-shape case installs a probe
# extension into the shared extension directory (its own file names, so
# it does not collide with the backup suite's probe).

set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

SCRIPT="$PWD/ops/restore-infiniterealms-db.sh"
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
has() { case "$1" in *"$2"*) return 0 ;; *) return 1 ;; esac; }
expect_has() { # haystack needle description
  if has "$1" "$2"; then ok "$3"; else bad "$3"; fi
}

for tool in pg_dump pg_restore psql gzip awk; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    say "skip - $tool not on PATH; cannot run the restore drill"
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
  say "skip - no Postgres server binaries (initdb/pg_ctl) found; install postgresql to run the restore drill"
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

# --- docker shim (the script's only host dependency) ----------------------
mkdir -p "$TMP/bin"
cat > "$TMP/bin/docker" <<'SHIM'
#!/usr/bin/env bash
# docker shim for the restore drill: the "container" is fictional, but its
# NAME is checked, so a wrong CONTAINER fails here as it would in prod.
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
chmod +x "$TMP/bin/docker"
export PATH="$TMP/bin:$PATH"

# Hermetic: the script's alert paths are not used by this script, but
# pin the table floor off for the fixtures (5 tables each) except in the
# floor case, which sets MIN_TABLES explicitly.
export MIN_TABLES=0

# The cluster must run as a non-root user when we are root.
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
scratch_left() {
  psql -X -q -t -A -d postgres -c \
    "SELECT count(*) FROM pg_database WHERE datname LIKE 'ir_restore_scratch_%'"
}

# --- fixtures -------------------------------------------------------------
psql_admin -d postgres <<'SQL'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE DATABASE srcdb;
SQL
psql_admin -d srcdb <<'SQL'
CREATE TABLE campaigns (id int PRIMARY KEY, name text NOT NULL);
INSERT INTO campaigns VALUES (1, 'alpha'), (2, 'beta'), (3, 'gamma');
CREATE TABLE characters (id int PRIMARY KEY, campaign_id int REFERENCES campaigns(id));
INSERT INTO characters VALUES (10, 1), (11, 2);
CREATE TABLE npcs (id int PRIMARY KEY, name text);
CREATE TABLE quests (id int PRIMARY KEY, title text);
CREATE TABLE locations (id int PRIMARY KEY, title text);
GRANT SELECT ON campaigns TO anon, authenticated;
COMMENT ON TABLE campaigns IS 'restore drill fixture';
SQL
pg_dump -Fc -d srcdb -f "$TMP/good.dump"

# Listed fine, restores with an error: the ACL names a role dropped after
# the dump, so the GRANT fails at restore time (the #38 negative control).
psql_admin -d srcdb -c "CREATE ROLE doomed NOLOGIN" -c "GRANT SELECT ON campaigns TO doomed"
pg_dump -Fc -d srcdb -f "$TMP/doomed.dump"
psql_admin -d srcdb -c "REVOKE SELECT ON campaigns FROM doomed" -c "DROP ROLE doomed"

SIZE_GOOD=$(stat -c %s "$TMP/good.dump")
head -c $((SIZE_GOOD / 2)) "$TMP/good.dump" > "$TMP/truncated.dump"
printf 'not a dump\n' > "$TMP/garbage.dump"

# Prod shape: a function attached to an extension with ALTER EXTENSION ...
# ADD, so pg_dump omits its definition but dumps its ACL, exactly how
# Supabase attaches graphql_public.graphql to pg_graphql.
EXT_DIR="$SHAREDIR/extension"
PROBE_CTL="$EXT_DIR/ir_restore_probe_ext.control"
PROBE_SQL="$EXT_DIR/ir_restore_probe_ext--1.0.sql"
PROBE_DONE=0
if [ -e "$PROBE_CTL" ] || [ -e "$PROBE_SQL" ]; then
  foreign=0
  if [ -e "$PROBE_CTL" ] && ! grep -q 'ir restore drill probe' "$PROBE_CTL" 2>/dev/null; then foreign=1; fi
  if [ -e "$PROBE_SQL" ] && ! grep -q 'ir-restore-probe' "$PROBE_SQL" 2>/dev/null; then foreign=1; fi
  if [ "$foreign" = "0" ]; then
    say "note - removing stale restore probe files left by a killed earlier run"
    rm -f "$PROBE_CTL" "$PROBE_SQL"
  else
    bad "restore probe files exist in $EXT_DIR but are not this suite's — refusing to touch them"
  fi
fi
if [ -e "$PROBE_CTL" ] || [ -e "$PROBE_SQL" ]; then
  skipped "prod-shape cases blocked by foreign probe files in the extension dir"
elif [ ! -w "$EXT_DIR" ]; then
  skipped "extension dir $EXT_DIR is not writable; prod-shape cases cannot run"
else
  cat > "$PROBE_CTL" <<'EOF'
comment = 'ir restore drill probe'
default_version = '1.0'
relocatable = false
EOF
  cat > "$PROBE_SQL" <<'EOF'
-- ir-restore-probe: one extension-owned table, so the table count sees
-- an extension member. Functions below are attached with ALTER EXTENSION.
CREATE TABLE probe_member_table (id int PRIMARY KEY, note text);
EOF
  chmod 644 "$PROBE_CTL" "$PROBE_SQL"
  EXT_FILES="$PROBE_CTL $PROBE_SQL"
  PROBE_DONE=1
fi

if [ "$PROBE_DONE" = "1" ]; then
  psql_admin -d postgres -c "CREATE DATABASE proddb" >/dev/null
  psql_admin -d proddb <<'SQL'
CREATE SCHEMA graphql_public;
CREATE EXTENSION ir_restore_probe_ext;
CREATE FUNCTION graphql_public.graphql(text, "operationName" text DEFAULT NULL, variables jsonb DEFAULT NULL, extensions jsonb DEFAULT NULL)
  RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
ALTER EXTENSION ir_restore_probe_ext ADD FUNCTION graphql_public.graphql(text, text, jsonb, jsonb);
GRANT EXECUTE ON FUNCTION graphql_public.graphql(text, text, jsonb, jsonb) TO anon, authenticated;
CREATE TABLE campaigns (id int PRIMARY KEY, name text NOT NULL);
INSERT INTO campaigns VALUES (1, 'Prod Shape');
INSERT INTO probe_member_table VALUES (1, 'm1'), (2, 'm2');
SQL
  pg_dump -Fc -d proddb -f "$TMP/prod.dump"

  # A second overload attached to the same extension: two matching ACL
  # entries, which the script must refuse rather than widen its exclusion.
  psql_admin -d proddb <<'SQL'
CREATE FUNCTION graphql_public.graphql(text, text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
ALTER EXTENSION ir_restore_probe_ext ADD FUNCTION graphql_public.graphql(text, text);
GRANT EXECUTE ON FUNCTION graphql_public.graphql(text, text) TO authenticated;
SQL
  pg_dump -Fc -d proddb -f "$TMP/two-acl.dump"
fi

# Live targets. livedb starts with one marker row the rollback case checks.
psql_admin -d postgres -c "CREATE DATABASE livedb" -c "CREATE DATABASE prodlive" >/dev/null
psql_admin -d livedb -c "CREATE TABLE campaigns (id int PRIMARY KEY, name text NOT NULL)" \
  -c "INSERT INTO campaigns VALUES (99, 'before')" >/dev/null
reset_livedb() { # drop the whole public schema: an earlier live restore left
  # characters (a foreign key to campaigns), which a plain DROP TABLE trips on
  psql_admin -d livedb -c "DROP SCHEMA public CASCADE" -c "CREATE SCHEMA public" \
    -c "CREATE TABLE campaigns (id int PRIMARY KEY, name text NOT NULL)" \
    -c "INSERT INTO campaigns VALUES (99, 'before')" >/dev/null
}
live_names() { psql -X -q -t -A -d "$1" -c "SELECT string_agg(name, ',' ORDER BY id) FROM campaigns"; }

# --- case: usage ------------------------------------------------------------
OUT=$(bash "$SCRIPT" 2>&1); RC=$?
expect "no arguments is a usage error (exit 2)" test "$RC" -eq 2
OUT=$(bash "$SCRIPT" --scratch 2>&1); RC=$?
expect "--scratch with no file is a usage error (exit 2)" test "$RC" -eq 2
OUT=$(bash "$SCRIPT" --bogus "$TMP/good.dump" 2>&1); RC=$?
expect "an unknown flag is a usage error (exit 2)" test "$RC" -eq 2

# --- case: --scratch on a good dump -----------------------------------------
OUT=$(env PGDATABASE=srcdb bash "$SCRIPT" --scratch "$TMP/good.dump" 2>&1); RC=$?
expect "--scratch restores a good dump (exit 0)" test "$RC" -eq 0
expect_has "$OUT" "scratch OK" "--scratch reports the scratch restore as OK"
expect_has "$OUT" "(5 tables" "--scratch reports the restored table count (5)"
expect_has "$OUT" "excluded 0 extension-member" "a dump without the graphql function excludes nothing"
expect "--scratch leaves no scratch database behind" test "$(scratch_left)" = "0"
expect "--scratch leaves the live source rows untouched" \
  test "$(psql -X -q -t -A -d srcdb -c 'SELECT count(*) FROM campaigns')" = "3"

# --- case: the prod shape ---------------------------------------------------
if [ "$PROBE_DONE" = "1" ]; then
  OUT=$(env PGDATABASE=postgres bash "$SCRIPT" --scratch "$TMP/prod.dump" 2>&1); RC=$?
  expect "--scratch restores the prod shape (exit 0)" test "$RC" -eq 0
  expect_has "$OUT" "excluded 1 extension-member" "exactly one graphql ACL entry is excluded"
  expect "the prod-shape scratch database is dropped" test "$(scratch_left)" = "0"

  OUT=$(env PGDATABASE=postgres bash "$SCRIPT" --scratch "$TMP/two-acl.dump" 2>&1); RC=$?
  expect "two matching ACL entries fail --scratch (exit 1)" test "$RC" -eq 1
  expect_has "$OUT" "refusing to widen" "the two-entry refusal is named"

  reset_livedb
  OUT=$(env I_ACCEPT_DOWNTIME=1 PGDATABASE=prodlive bash "$SCRIPT" "$TMP/prod.dump" 2>&1); RC=$?
  expect "LIVE restore of the prod shape into an empty database (exit 0)" test "$RC" -eq 0
  expect "the prod-shape live restore carries the campaigns row" \
    test "$(live_names prodlive)" = "Prod Shape"
else
  skipped "prod-shape cases: the probe extension could not be installed"
fi

# --- case: broken archives under --scratch ---------------------------------
OUT=$(env PGDATABASE=srcdb bash "$SCRIPT" --scratch "$TMP/truncated.dump" 2>&1); RC=$?
expect "a truncated dump fails --scratch (exit 1)" test "$RC" -eq 1
expect_has "$OUT" "not a readable custom-format archive" "the truncated dump is named as unreadable"

OUT=$(env PGDATABASE=srcdb bash "$SCRIPT" --scratch "$TMP/garbage.dump" 2>&1); RC=$?
expect "a garbage file fails --scratch (exit 1)" test "$RC" -eq 1

OUT=$(env PGDATABASE=srcdb bash "$SCRIPT" --scratch "$TMP/doomed.dump" 2>&1); RC=$?
expect "a list-valid dump whose restore errors fails --scratch (exit 1)" test "$RC" -eq 1
expect_has "$OUT" 'role "doomed" does not exist' "the restore error is named"
expect "the failed --scratch still drops its scratch database" test "$(scratch_left)" = "0"

# --- case: floor, missing file, bad MIN_TABLES ------------------------------
OUT=$(env MIN_TABLES=999 PGDATABASE=srcdb bash "$SCRIPT" --scratch "$TMP/good.dump" 2>&1); RC=$?
expect "a restored table count below MIN_TABLES fails (exit 1)" test "$RC" -eq 1
expect_has "$OUT" "below the MIN_TABLES floor" "the floor failure is named"

OUT=$(env MIN_TABLES=banana bash "$SCRIPT" --scratch "$TMP/good.dump" 2>&1); RC=$?
expect "MIN_TABLES=banana is a usage error (exit 2)" test "$RC" -eq 2

OUT=$(bash "$SCRIPT" --scratch "$TMP/no-such.dump" 2>&1); RC=$?
expect "a missing file fails (exit 1)" test "$RC" -eq 1
expect_has "$OUT" "no such file" "the missing file is named"

# --- case: the LIVE gate -----------------------------------------------------
reset_livedb
OUT=$(env -u I_ACCEPT_DOWNTIME PGDATABASE=livedb bash "$SCRIPT" "$TMP/good.dump" 2>&1); RC=$?
expect "LIVE restore without I_ACCEPT_DOWNTIME is refused (exit 2)" test "$RC" -eq 2
expect_has "$OUT" "I_ACCEPT_DOWNTIME" "the refusal names the gate variable"
OUT=$(env I_ACCEPT_DOWNTIME=0 PGDATABASE=livedb bash "$SCRIPT" "$TMP/good.dump" 2>&1); RC=$?
expect "LIVE restore with I_ACCEPT_DOWNTIME=0 is refused (exit 2)" test "$RC" -eq 2
expect "the refused LIVE restores leave the live database unchanged" \
  test "$(live_names livedb)" = "before"

# --- case: LIVE restore ------------------------------------------------------
OUT=$(env I_ACCEPT_DOWNTIME=1 PGDATABASE=livedb bash "$SCRIPT" "$TMP/good.dump" 2>&1); RC=$?
expect "LIVE restore with I_ACCEPT_DOWNTIME=1 succeeds (exit 0)" test "$RC" -eq 0
expect "the LIVE restore replaces the campaigns rows with the archive's" \
  test "$(live_names livedb)" = "alpha,beta,gamma"

reset_livedb
OUT=$(env I_ACCEPT_DOWNTIME=1 PGDATABASE=livedb bash "$SCRIPT" "$TMP/doomed.dump" 2>&1); RC=$?
expect "a LIVE restore whose restore errors fails (exit 1)" test "$RC" -eq 1
expect_has "$OUT" "rolled back in one transaction" "the failure says the restore was rolled back"
expect "a failed LIVE restore leaves the live database exactly as it was" \
  test "$(live_names livedb)" = "before"

# --- case: the container-name shim ------------------------------------------
OUT=$(env CONTAINER=not-supabase PGDATABASE=srcdb bash "$SCRIPT" --scratch "$TMP/good.dump" 2>&1); RC=$?
expect "a wrong CONTAINER fails (the shim rejects the name)" test "$RC" -ne 0
expect_has "$OUT" "unexpected container" "the wrong container is named"

expect "no scratch database is left after the whole suite" test "$(scratch_left)" = "0"

say "$pass passed, $fail failed, $skip skipped"
[ "$fail" -eq 0 ]
