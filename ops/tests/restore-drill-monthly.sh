#!/usr/bin/env bash
# Cases for ops/restore-drill-monthly.sh (#38): the monthly drill, run
# against a throwaway Postgres cluster with the same docker and curl shims
# as the other ops suites.
#   * a good newest dump passes: restore --scratch succeeds, the negative
#     control rejects the truncated copy, one PASS line is logged, no Slack;
#   * a list-valid but restore-invalid newest dump fails the drill, logs
#     FAIL, and posts to Slack through SLACK_ALERT_WEBHOOK_URL;
#   * a verify that ACCEPTS a truncated copy fails the drill (negative
#     control); the drill does not trust a backup verify that passes too much;
#   * no dump in BACKUP_DIR fails the drill;
#   * a FAIL with no webhook configured still fails, and says the alert was
#     not sent;
#   * the webhook value never reaches the drill log;
#   * the live source database is untouched by the drill.
#
# RESTORE_SCRIPT defaults to the sibling ops/restore-infiniterealms-db.sh.
# Run by hand:  bash ops/tests/restore-drill-monthly.sh
# One suite per host at a time (the prod-shape case is not used here, but
# the restore suite installs probe files; do not run both at once).

set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

DRILL="$PWD/ops/restore-drill-monthly.sh"
BACKUP_SCRIPT_UNDER_TEST="$PWD/ops/backup-infiniterealms-db.sh"
RESTORE_SCRIPT="${RESTORE_SCRIPT:-$PWD/ops/restore-infiniterealms-db.sh}"
pass=0
fail=0
skip=0
say() { printf '%s\n' "$*"; }
ok() { say "ok - $1"; pass=$((pass + 1)); }
bad() { say "FAIL - $1"; fail=$((fail + 1)); }
skipped() { say "skip - $1"; skip=$((skip + 1)); }
expect() { local desc=$1; shift; if "$@" >/dev/null 2>&1; then ok "$desc"; else bad "$desc"; fi; }
has() { case "$1" in *"$2"*) return 0 ;; *) return 1 ;; esac; }
expect_has() { if has "$1" "$2"; then ok "$3"; else bad "$3"; fi; }

for tool in pg_dump pg_restore psql jq gzip awk; do
  command -v "$tool" >/dev/null 2>&1 || { say "skip - $tool not on PATH; cannot run the drill suite"; say "0 passed, 0 failed, 1 skipped"; exit 0; }
done
for f in "$DRILL" "$BACKUP_SCRIPT_UNDER_TEST" "$RESTORE_SCRIPT"; do
  [ -f "$f" ] || { say "FAIL - missing $f"; exit 1; }
done

BINDIR=""
if command -v initdb >/dev/null 2>&1; then BINDIR=$(dirname "$(command -v initdb)")
elif command -v pg_config >/dev/null 2>&1; then BINDIR=$(pg_config --bindir); fi
if [ -z "$BINDIR" ] || [ ! -x "$BINDIR/initdb" ] || [ ! -x "$BINDIR/pg_ctl" ]; then
  say "skip - no Postgres server binaries (initdb/pg_ctl) found"
  say "0 passed, 0 failed, 1 skipped"
  exit 0
fi

TMP=$(mktemp -d)
DATA="$TMP/cluster"
SOCK="$TMP/sock"
mkdir -p "$SOCK" "$TMP/bin"
STARTED=0
cleanup() {
  if [ "$STARTED" = "1" ]; then
    as_pg "$BINDIR/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1
  fi
  rm -rf "$TMP"
}

RUNAS=()
CHOWN_TO=""
if [ "$(id -u)" = "0" ]; then RUNAS=(runuser -u postgres --); CHOWN_TO=postgres; fi
as_pg() { "${RUNAS[@]}" "$@"; }
trap cleanup EXIT

# docker shim: exec runs locally, cp copies locally; the container name is checked.
cat > "$TMP/bin/docker" <<'SHIM'
#!/usr/bin/env bash
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
# curl shim: logs its arguments instead of posting to Slack.
cat > "$TMP/bin/curl" <<'SHIM'
#!/usr/bin/env bash
{ echo CALL; printf "%s\n" "$*"; } >> "${CURL_LOG:-/dev/null}"
exit 0
SHIM
chmod +x "$TMP/bin/docker" "$TMP/bin/curl"
export PATH="$TMP/bin:$PATH"
export MIN_TABLES=0

[ -z "$CHOWN_TO" ] || chown -R "$CHOWN_TO" "$TMP"
PW=irtestpw
printf '%s' "$PW" > "$TMP/pwfile"; chmod 600 "$TMP/pwfile"
[ -z "$CHOWN_TO" ] || chown "$CHOWN_TO" "$TMP/pwfile"
as_pg "$BINDIR/initdb" -D "$DATA" -U postgres --auth-local=trust --auth-host=scram-sha-256 \
  --pwfile="$TMP/pwfile" > "$TMP/initdb.log" 2>&1 \
  || { say "FAIL - initdb failed"; tail -20 "$TMP/initdb.log" >&2; exit 1; }
for attempt in 1 2 3 4 5; do
  PORT=$(( (RANDOM % 2000) + 54000 ))
  if as_pg "$BINDIR/pg_ctl" -D "$DATA" -l "$TMP/server.log" \
      -o "-p $PORT -k $SOCK -c listen_addresses=127.0.0.1 -c fsync=off" -w start >/dev/null 2>&1; then
    STARTED=1; break
  fi
done
[ "$STARTED" = "1" ] || { say "FAIL - scratch Postgres did not start"; exit 1; }
export PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=postgres PGPASSWORD=$PW
psql_admin() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }

# Fixtures: a good archive and a list-valid archive whose restore errors.
psql_admin -d postgres <<'SQL'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE DATABASE srcdb;
SQL
psql_admin -d srcdb <<'SQL'
CREATE TABLE campaigns (id int PRIMARY KEY, name text NOT NULL);
INSERT INTO campaigns VALUES (1, 'alpha'), (2, 'beta'), (3, 'gamma');
CREATE TABLE npcs (id int PRIMARY KEY, name text);
CREATE TABLE quests (id int PRIMARY KEY, title text);
CREATE TABLE locations (id int PRIMARY KEY, title text);
CREATE TABLE characters (id int PRIMARY KEY, name text);
GRANT SELECT ON campaigns TO anon, authenticated;
SQL
pg_dump -Fc -d srcdb -f "$TMP/good.dump"
psql_admin -d srcdb -c "CREATE ROLE doomed NOLOGIN" -c "GRANT SELECT ON campaigns TO doomed"
pg_dump -Fc -d srcdb -f "$TMP/doomed.dump"
psql_admin -d srcdb -c "REVOKE SELECT ON campaigns FROM doomed" -c "DROP ROLE doomed"

# A backup-verify stub that wrongly accepts everything (negative-control test).
printf '#!/usr/bin/env bash\nexit 0\n' > "$TMP/accept-all.sh"

# Hermetic env for the drill: no real alerts env file, a fake webhook name.
export DRILL_TEST_HOOK="stub://restore-drill-test"
export CURL_LOG="$TMP/curl.log"
export BACKUP_ALERTS_ENV="$TMP/no-such-alerts.env"
: > "$CURL_LOG"

new_backup_dir() { # name -> prints dir with the named dump(s)
  local d="$TMP/$1"; rm -rf "$d"; mkdir -p "$d"; printf '%s' "$d"
}
run_drill() { # backup_dir drill_log [env...]: sets OUT and RC
  local dir=$1 log=$2; shift 2
  OUT=$(env BACKUP_DIR="$dir" DRILL_LOG="$log" RESTORE_SCRIPT="$RESTORE_SCRIPT" \
      PGDATABASE=srcdb "$@" bash "$DRILL" 2>&1); RC=$?
}
scratch_left() {
  psql -X -q -t -A -d postgres -c "SELECT count(*) FROM pg_database WHERE datname LIKE 'ir_restore_scratch_%'"
}

# --- case: a good newest dump passes ----------------------------------------
D=$(new_backup_dir pass)
cp "$TMP/good.dump" "$D/infiniterealms_20260101_020000.dump"
: > "$CURL_LOG"
run_drill "$D" "$TMP/pass.log" SLACK_ALERT_WEBHOOK_URL="$DRILL_TEST_HOOK"
expect "a good newest dump passes the drill (exit 0)" test "$RC" -eq 0
expect_has "$OUT" "restore check: PASS" "the restore check is reported as PASS"
expect_has "$OUT" "negative control: PASS" "the negative control is reported as PASS"
expect "the drill log ends with one PASS line" \
  bash -c "tail -1 '$TMP/pass.log' | grep -q ' PASS dump=infiniterealms_20260101_020000.dump$'"
expect "a PASS posts nothing to Slack" test ! -s "$CURL_LOG"
expect "the drill leaves no scratch database" test "$(scratch_left)" = "0"
expect "the drill never touches the live source rows" \
  test "$(psql -X -q -t -A -d srcdb -c 'SELECT count(*) FROM campaigns')" = "3"
expect "the drill writes nothing into BACKUP_DIR except the dump" \
  test "$(ls -1 "$D" | wc -l)" = "1"

# --- case: newest dump restores with an error -> FAIL + Slack ---------------
D=$(new_backup_dir fail-restore)
cp "$TMP/good.dump" "$D/infiniterealms_20260101_020000.dump"
cp "$TMP/doomed.dump" "$D/infiniterealms_20260201_020000.dump"
: > "$CURL_LOG"
run_drill "$D" "$TMP/fail.log" SLACK_ALERT_WEBHOOK_URL="$DRILL_TEST_HOOK"
expect "a restore-invalid newest dump fails the drill (exit 1)" test "$RC" -eq 1
expect_has "$OUT" "restore --scratch of infiniterealms_20260201_020000.dump did not pass" "the failing restore is named"
expect "the FAIL is logged" bash -c "grep -q ' FAIL dump=infiniterealms_20260201_020000.dump reasons: ' '$TMP/fail.log'"
expect "a FAIL posts once to Slack" test "$(grep -c "^CALL$" "$CURL_LOG")" = "1"
expect_has "$(cat "$CURL_LOG")" "monthly restore drill FAILED" "the Slack text names the drill failure"
expect "the webhook value never reaches the drill log" \
  bash -c "! grep -q 'stub://restore-drill-test' '$TMP/fail.log'"
expect "the drill leaves no scratch database after a failed restore" test "$(scratch_left)" = "0"

# --- case: a verify that accepts a truncated copy fails the drill ----------
D=$(new_backup_dir accept-all)
cp "$TMP/good.dump" "$D/infiniterealms_20260101_020000.dump"
: > "$CURL_LOG"
run_drill "$D" "$TMP/accept.log" BACKUP_SCRIPT="$TMP/accept-all.sh" SLACK_ALERT_WEBHOOK_URL="$DRILL_TEST_HOOK"
expect "a verify that accepts a truncated copy fails the drill (exit 1)" test "$RC" -eq 1
expect_has "$OUT" "ACCEPTED a truncated copy" "the negative-control failure is named"
expect "that FAIL also posts to Slack" test "$(grep -c "^CALL$" "$CURL_LOG")" = "1"

# --- case: no dumps -----------------------------------------------------------
D=$(new_backup_dir empty)
: > "$CURL_LOG"
run_drill "$D" "$TMP/empty.log" SLACK_ALERT_WEBHOOK_URL="$DRILL_TEST_HOOK"
expect "an empty BACKUP_DIR fails the drill (exit 1)" test "$RC" -eq 1
expect_has "$OUT" "no infiniterealms_*.dump" "the missing dump is named"

# --- case: FAIL with no webhook still fails, and says so --------------------
D=$(new_backup_dir fail-nohook)
cp "$TMP/doomed.dump" "$D/infiniterealms_20260201_020000.dump"
: > "$CURL_LOG"
OUT=$(env -u SLACK_ALERT_WEBHOOK_URL BACKUP_DIR="$D" DRILL_LOG="$TMP/nohook.log" \
    RESTORE_SCRIPT="$RESTORE_SCRIPT" PGDATABASE=srcdb bash "$DRILL" 2>&1); RC=$?
expect "a FAIL with no webhook configured still exits 1" test "$RC" -eq 1
expect_has "$OUT" "SLACK_ALERT_WEBHOOK_URL is not set" "the unsent alert is reported, not silent"
expect "no curl call is made without a webhook" test ! -s "$CURL_LOG"

say "$pass passed, $fail failed, $skip skipped"
[ "$fail" -eq 0 ]
