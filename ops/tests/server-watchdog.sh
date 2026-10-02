#!/usr/bin/env bash
# Cases for ops/server-watchdog.sh (#2501), with stub curl, docker, pm2,
# systemctl and pg_isready on PATH and fixture /proc/loadavg + /proc/meminfo:
# the 2026-10-02 load replay, an API that 502s or hangs, a DB that refuses or
# only fails SELECT 1, a hung Docker daemon with postgres down and with it up,
# the cooldown, a failed restart, recovery, the lock, high memory, --dry-run
# and a bad argument.
#
#   bash ops/tests/server-watchdog.sh
#
# Needs bash, awk, flock, timeout. Touches nothing outside a temp dir.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
WATCHDOG="$HERE/../server-watchdog.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Stubs: each logs "<name> <args>" to $CALLS and behaves as $CTL/<knob> says.
BIN="$TMP/bin"
mkdir -p "$BIN"
cat > "$BIN/curl" << 'EOF'
#!/usr/bin/env bash
case "$*" in *hooks.example.invalid*) echo "slack" >> "$CALLS"; exit 0 ;; esac
echo "curl $*" >> "$CALLS"
api=$(cat "$CTL/api")
case "$api" in
  hang) sleep 30 ;;
  down) printf '000'; exit 7 ;;
  nocommit) printf '{"ok":true}\n200' ;;
  *) [ "$api" = 200 ] && printf '{"commit":"3b44ef94"}\n%s' "$api" || printf 'Bad Gateway\n%s' "$api" ;;
esac
EOF
cat > "$BIN/docker" << 'EOF'
#!/usr/bin/env bash
echo "docker $*" >> "$CALLS"
daemon=$(cat "$CTL/daemon")
[ "$daemon" = hang ] && sleep 30
case "$1" in
  info) echo 27.3.1 ;;
  exec)
    case "$(cat "$CTL/select1")" in
      ok) echo 1 ;;
      hang) sleep 30 ;;
      *) echo 'psql: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed: No such file or directory' >&2; exit 2 ;;
    esac ;;
  restart)
    [ -e /proc/$$/fd/9 ] && echo "fd9 leaked into docker" >> "$CALLS"
    exit "$(cat "$CTL/restart_rc")" ;;
esac
EOF
cat > "$BIN/pg_isready" << 'EOF'
#!/usr/bin/env bash
echo "pg_isready $*" >> "$CALLS"
case "$(cat "$CTL/pgport")" in
  ok) exit 0 ;;
  reject) exit 1 ;; # PQPING_REJECT: starting up, shutting down, recovery
  hang) sleep 30 ;;
  blip) # no response once, then fine
    [ -e "$CTL/blipped" ] && exit 0
    touch "$CTL/blipped"; exit 2 ;;
  *) exit 2 ;; # PQPING_NO_RESPONSE
esac
EOF
# shellcheck disable=SC2016
for f in pm2 systemctl; do
  printf '#!/usr/bin/env bash\necho "%s $*" >> "$CALLS"\n[ -e /proc/$$/fd/9 ] && echo "fd9 leaked into %s" >> "$CALLS"\nexit "$(cat "$CTL/restart_rc")"\n' "$f" "$f" > "$BIN/$f"
done
chmod +x "$BIN"/*
printf 'SLACK_ALERT_WEBHOOK_URL=https://hooks.example.invalid/T000/B000/x\n' > "$TMP/alerts.env"

# 2026-10-02T03:24:01Z, the third Docker restart.
T0=1790911441
meminfo() { # <used %> <swap used %>
  printf 'MemTotal: 1000000 kB\nMemFree: 1 kB\nMemAvailable: %d kB\nSwapTotal: 1000 kB\nSwapFree: %d kB\n' \
    $((1000000 - $1 * 10000)) $((1000 - $2 * 10))
}

# new_case <name>: a fresh state dir, everything healthy, load 1.
new_case() {
  D="$TMP/$1"
  mkdir -p "$D/ctl" "$D/state"
  CTL="$D/ctl" CALLS="$D/calls"
  : > "$CALLS"
  echo 200 > "$CTL/api"; echo ok > "$CTL/daemon"; echo ok > "$CTL/select1"
  echo ok > "$CTL/pgport"; echo 0 > "$CTL/restart_rc"
  load 1.00
  meminfo 46 98 > "$D/meminfo"
}
set_() { echo "$2" > "$CTL/$1"; }
load() { echo "$1 $1 $1 3/900 12345" > "$D/loadavg"; }

# wd <now> [args...]: run the real script once.
wd() {
  local now=$1
  shift
  RC=0
  PATH="$BIN:$PATH" CTL="$CTL" CALLS="$CALLS" \
    WATCHDOG_NOW="$now" WATCHDOG_CHECK_TIMEOUT=1 WATCHDOG_DB_PORT_TIMEOUT=1 WATCHDOG_DB_PORT_RETRY_SECONDS=0 \
    WATCHDOG_LOADAVG_FILE="$D/loadavg" WATCHDOG_MEMINFO_FILE="$D/meminfo" \
    DEPLOY_STATE_DIR="$D/state" DEPLOY_ALERT_FILE="$D/alerts.log" DEPLOY_ALERTS_ENV="$TMP/alerts.env" \
    bash "$WATCHDOG" "$@" > "$D/out" 2>&1 || RC=$?
  cat "$D/out" >> "$D/log"
  OUT=$(<"$D/out")
}
# runs <n> <start> [args...]: n cron ticks, two minutes apart; T is the next tick.
runs() {
  local n=$1 i
  T=$2
  shift 2
  for ((i = 0; i < n; i++)); do wd "$T" "$@"; T=$((T + 120)); done
}

pass=0 fail=0
ok() { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); printf 'FAIL %s\n--- output:\n%s\n--- calls:\n%s\n' "$1" "$OUT" "$(cat "$CALLS")"; }
expect() { local n=$1; shift; if "$@"; then ok "$n"; else bad "$n"; fi; }
has() { grep -qF -- "$1" <<< "$OUT"; }
logged() { grep -qF -- "$1" "$D/log"; }
called() { grep -c -- "^$1" "$CALLS" || true; }
alerts() { [ -e "$D/alerts.log" ] && grep -c -- "$1" "$D/alerts.log" || echo 0; }
restarts() { echo $(($(called "pm2 restart") + $(called "docker restart") + $(called "systemctl restart"))); }

# 1. The 2026-10-02 night: load 13–38 for 40 minutes, everything healthy.
#    The old script restarted Docker at 03:24; this one must restart nothing.
new_case load
load 16.40; runs 3 "$T0"
load 38.58; runs 10 "$T"
load 13.77; runs 7 "$T"
expect "load: never restarts anything" test "$(restarts)" = 0
expect "load: never calls systemctl" test "$(called systemctl)" = 0
expect "load: alerts once (rate-limited)" test "$(alerts 'load1 .* ≥ 12 for')" = 1
expect "load: alert says load never restarts" grep -qF "load never triggers a restart" "$D/alerts.log"
expect "load: every run logs the metrics line" test "$(grep -c 'watchdog: load ' "$D/log")" = 20
expect "load: metrics line shows mem, swap and each probe" logged "load 13.77/13.77/13.77 mem 46% swap 98% | api ok | docker ok | db ok"
load 5.21; wd "$T"
expect "load: recovery alert when it drops" test "$(alerts 'RECOVERED: load1 5.21')" = 1

# 2. API 502s: alert at 2, pm2 restart (only) at 3.
new_case api
set_ api 502
wd "$T0"
expect "api 1/3: no alert, no restart" test "$(restarts)-$(alerts WATCHDOG)" = "0-0"
expect "api 1/3: logs the reason" has "api FAIL 1/3 (HTTP 502 from http://127.0.0.1:8888/version)"
wd $((T0 + 120))
expect "api 2/3: alerts" test "$(alerts 'api unhealthy, 2 consecutive failed checks (HTTP 502')" = 1
expect "api 2/3: no restart yet" test "$(restarts)" = 0
wd $((T0 + 240))
expect "api 3/3: restarts the PM2 app" test "$(called 'pm2 restart infiniterealms-bun')" = 1
expect "api 3/3: nothing else restarted" test "$(restarts)" = 1
expect "api 3/3: the lock fd is not inherited by pm2" test "$(called 'fd9 leaked')" = 0
expect "api 3/3: the restart alert carries the reason" test "$(alerts 'restarting api: HTTP 502 from http://127.0.0.1:8888/version for 3 checks')" = 1
expect "api 3/3: Slack paged" test "$(called slack)" -ge 2
set_ api 200
wd $((T0 + 360))
expect "api: recovery alert" test "$(alerts 'RECOVERED: api healthy')" = 1

# 3. API hangs: the timeout counts it as a failure and the run still finishes.
new_case api-hang
set_ api hang
start=$(date +%s)
runs 3 "$T0"
expect "api hang: three runs finish under the timeouts" test $(($(date +%s) - start)) -lt 20
expect "api hang: reason is the timeout" logged "no answer from http://127.0.0.1:8888/version in 1s"
expect "api hang: restarts the PM2 app" test "$(called 'pm2 restart infiniterealms-bun')" = 1

# 4. API answers 200 without a commit (something else on the port): a failure.
new_case api-nocommit
set_ api nocommit
runs 3 "$T0"
expect "api no commit: counted as a failure" logged "HTTP 200 without a commit"
expect "api no commit: restarts the PM2 app" test "$(called 'pm2 restart')" = 1

# 5. Postgres down in its container (SELECT 1 fails, port refuses), daemon fine:
#    restart that one container, never Docker, never PM2.
new_case db
set_ select1 fail; set_ pgport fail
runs 3 "$T0"
expect "db: restarts only supabase-db" test "$(called 'docker restart supabase-db')" = 1
expect "db: one restart in total" test "$(restarts)" = 1
expect "db: no systemctl" test "$(called systemctl)" = 0
expect "db: reason has the psql error" test "$(alerts 'restarting db: SELECT 1 on supabase-db: exit 2: psql: error')" = 1

# 6. SELECT 1 fails but postgres accepts connections on its port (slow exec
#    under load, full slots): alert, no restart.
new_case db-port-up
set_ select1 hang
runs 4 "$T0"
expect "db port up: no restart" test "$(restarts)" = 0
expect "db port up: alerts that it is not restarting" test "$(alerts 'Not restarting supabase-db while it answers')" = 1

# 7. Docker daemon hung, postgres still accepting on its port: never restart Docker.
new_case docker-db-up
set_ daemon hang
runs 5 "$T0"
expect "docker hung, DB up: no systemctl restart" test "$(called 'systemctl restart')" = 0
expect "docker hung, DB up: no container restart attempted" test "$(called 'docker restart')" = 0
expect "docker hung, DB up: alert says why" test "$(alerts 'NOT restarting Docker while the DB answers')" = 1

# 8. Docker daemon hung AND postgres refuses: the one case that restarts Docker.
new_case docker-down
set_ daemon hang; set_ pgport fail
runs 3 "$T0"
expect "docker down: systemctl restart docker" test "$(called 'systemctl restart docker')" = 1
expect "docker down: not the container, not PM2" test "$(restarts)" = 1
expect "docker down: the lock fd is not inherited by systemctl" test "$(called 'fd9 leaked')" = 0
expect "docker down: reason names daemon and port" test "$(alerts 'restarting docker: docker daemon not answering for 3 checks (docker info: no answer in 1s) and postgres on 127.0.0.1:54321 gave no response twice')" = 1

# 9. Docker daemon down and the API down too: Docker first; the API waits out the cooldown.
new_case docker-and-api
set_ daemon hang; set_ pgport fail; set_ api down
runs 3 "$T0"
expect "api refused: reason says refused" logged "api FAIL 1/3 (connection refused by http://127.0.0.1:8888/version)"
expect "docker+api: Docker restarted, PM2 not in the same run" test "$(called 'systemctl restart')-$(called 'pm2 restart')" = "1-0"

# 10. Cooldown: one restart per 30 minutes across all units.
new_case cooldown
set_ api 502
runs 3 "$T0"                 # restart at T0+240
runs 3 "$T"                  # fails 3 more: inside the cooldown
expect "cooldown: second restart refused" test "$(called 'pm2 restart')" = 1
expect "cooldown: says so" grep -qF "but the last restart (api) was 6m ago; cooldown is 30m" "$D/alerts.log"
set_ select1 fail; set_ pgport fail
runs 3 "$T"
expect "cooldown: covers a different unit too" test "$(called 'docker restart')" = 0
runs 10 "$T"                 # reaches T0+240+1800
expect "cooldown: restarts again after 30m" test "$(restarts)" = 2
expect "cooldown: the second restart is the DB container (it outranks the API)" test "$(called 'docker restart supabase-db')" = 1

# 11. A restart command that fails is alerted and still starts the cooldown.
new_case restart-fails
set_ api 502; set_ restart_rc 1
runs 3 "$T0"
expect "restart fails: alerted" test "$(alerts 'restart of api FAILED (exit 1)')" = 1
runs 3 "$T"
expect "restart fails: no retry inside the cooldown" test "$(called 'pm2 restart')" = 1

# 12. A run that finds the lock held does nothing.
new_case lock
set_ api 502
exec 8>> "$D/state/server-watchdog.lock"
flock -n 8
runs 4 "$T0"
flock -u 8
exec 8>&-
expect "lock: skipped" has "skipped: a previous run (started"
expect "lock: no probe, no restart" test "$(called curl)-$(restarts)" = "0-0"
expect "lock: exit 0" test "$RC" = 0

# 13. Memory above 90%: alert, nothing stopped (the old script stopped GLP containers).
new_case mem
meminfo 93 10 > "$D/meminfo"
runs 2 "$T0"
expect "mem: one alert" test "$(alerts 'memory 93% used')" = 1
expect "mem: nothing stopped or restarted" test "$(called 'docker stop')-$(restarts)" = "0-0"

# 14. --dry-run: every probe runs, every action is printed, nothing happens.
new_case dry
set_ api 502
runs 3 "$T0" --dry-run
expect "dry-run: would restart" has "watchdog [dry-run]: would run: timeout -k 10 60 pm2 restart infiniterealms-bun"
expect "dry-run: says what it would alert" logged "would alert: 🔴 WATCHDOG: restarting api"
expect "dry-run: no restart run" test "$(restarts)" = 0
expect "dry-run: does not claim a restart returned" bash -c "! grep -q 'returned 0' '$D/log'"
expect "dry-run: no alerts.log, no Slack" test "$(alerts WATCHDOG)-$(called slack)" = "0-0"
expect "dry-run: separate state file" test -e "$D/state/server-watchdog.dry-run.state" -a ! -e "$D/state/server-watchdog.state"
set_ select1 fail; set_ pgport fail; set_ daemon hang
runs 3 $((T + 1800)) --dry-run
expect "dry-run: would restart Docker when it should" logged "would run: timeout -k 10 300 systemctl restart docker"
expect "dry-run: still nothing run" test "$(restarts)" = 0

# 15. Postgres answering "starting up / in recovery" (pg_isready exit 1), e.g.
#     crash recovery after a cgroup OOM: never restart it mid-recovery.
new_case db-recovering
set_ select1 fail; set_ pgport reject
runs 4 "$T0"
expect "db recovering: no restart" test "$(restarts)" = 0
expect "db recovering: alert says it is recovering" test "$(alerts 'in recovery). Not restarting supabase-db')" = 1

# 16. Daemon hung and pg_isready does not finish (box under heavy load):
#     slow is not down, so Docker is not restarted.
new_case docker-pg-slow
set_ daemon hang; set_ pgport hang
runs 3 "$T0"
expect "pg slow: no systemctl restart" test "$(called 'systemctl restart')" = 0
expect "pg slow: alert says it is not restarting" test "$(alerts 'NOT restarting Docker while the DB answers')" = 1

# 17. One "no response" from pg_isready, then fine on the retry: not down.
new_case pg-blip
set_ select1 fail; set_ pgport blip
runs 3 "$T0"
expect "pg blip: no restart" test "$(restarts)" = 0
expect "pg blip: asked twice" test "$(called pg_isready)" = 2

# 18. A lock held for 10+ minutes alerts (once an hour) instead of skipping silently.
new_case stuck
exec 8>> "$D/state/server-watchdog.lock"
flock -n 8
echo $((T0 - 700)) > "$D/state/server-watchdog.running"
runs 3 "$T0"
flock -u 8
exec 8>&-
expect "stuck lock: one alert" test "$(alerts 'no health checks are running: the lock has been held for 11m')" = 1
expect "stuck lock: nothing probed" test "$(called curl)" = 0

# 19. A changed auto-deploy.sh whose alert block no longer ends at NOTIFY= is
#     refused, not evaluated to the end of the file.
new_case evalguard
sed '/^NOTIFY=/d' "$HERE/../auto-deploy.sh" > "$D/auto-deploy.sh"
RC=0
PATH="$BIN:$PATH" CTL="$CTL" CALLS="$CALLS" WATCHDOG_DEPLOY_SCRIPT="$D/auto-deploy.sh" \
  DEPLOY_STATE_DIR="$D/state" bash "$WATCHDOG" > "$D/out" 2>&1 || RC=$?
OUT=$(<"$D/out")
expect "eval guard: exit 2" test "$RC" = 2
expect "eval guard: says why" has "unexpected ALERTS_ENV..NOTIFY block"
expect "eval guard: nothing probed" test "$(called curl)" = 0

# 20. Bad arguments are a hard error, before any probe.
new_case args
wd "$T0" --dryrun
expect "bad arg: exit 2" test "$RC" = 2
expect "bad arg: no probe" test "$(called curl)" = 0
wd "$T0" --dry-run extra
expect "extra arg: exit 2" test "$RC" = 2

echo
echo "$pass passed, $fail failed"
[ "$fail" = 0 ]
