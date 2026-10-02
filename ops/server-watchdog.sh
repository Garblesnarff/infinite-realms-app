#!/usr/bin/env bash
# Health watchdog (#2501). Cron: every 2 minutes. Replaces the host's
# /usr/local/bin/server-watchdog.sh, which ran `systemctl restart docker`
# whenever the 1-minute load average stayed above 12 for 5 minutes. On this box
# load is CI on two self-hosted runners plus deploy builds, not a hung server:
# that rule restarted every Supabase stack (prod DB down ~20 s) on 2026-09-29
# 02:06Z, 2026-09-30 00:22Z and 2026-10-02 03:24Z, and the restart storm pushed
# load to 38, which re-armed it.
#
# This one acts on HEALTH, never on load:
#   api     GET WATCHDOG_API_URL (the API's /version) answers 200 with a commit
#   db      `docker exec <db container> psql -tAc 'select 1'` prints 1
#   docker  `docker info` answers
# Each probe runs under a timeout and keeps a consecutive-failure count. At
# ALERT_AFTER failures it alerts; at RESTART_AFTER it restarts ONLY the failed
# unit, one unit per run, in this order:
#   docker  `systemctl restart docker`, only when the daemon does not answer AND
#           postgres gives no response on its host port either, twice
#           (pg_isready, which does not go through dockerd). While postgres
#           answers at all (even "starting up" or slowly), Docker is never
#           restarted: it alerts instead.
#   db      `docker restart <db container>`, only when the daemon answers and
#           postgres gives no response on its host port too, twice. A DB that accepts connections
#           but fails SELECT 1 (slow exec under load, full connection slots)
#           gets an alert, not a restart.
#   api     `pm2 restart <app>`.
# At most one restart per COOLDOWN (default 30 min) across all units; inside the
# cooldown it alerts and does nothing. A lock stops two runs overlapping. Load
# and memory are logged on every run and alert when high; they never restart
# anything. Every run logs one status line, and every action logs its reason.
#
#   server-watchdog.sh [--dry-run]
#
# --dry-run runs every probe and prints what it would do ("would run: ...",
# "would alert: ...") without restarting anything, writing alerts.log or paging
# Slack. Its failure counts live in their own state file, so it can run from
# cron for days as a shadow of the real thing.
#
# Install and rollback: ops/README.md, "Health watchdog". Alerts use ts/
# post_slack/emit and the DEPLOY_* alert/state defaults read out of the sibling
# auto-deploy.sh, as http-alarm.sh does. Overrides: WATCHDOG_DEPLOY_SCRIPT,
# WATCHDOG_API_URL, WATCHDOG_DB_CONTAINER, WATCHDOG_DB_HOST, WATCHDOG_DB_PORT,
# WATCHDOG_DB_PORT_TIMEOUT, WATCHDOG_DB_PORT_RETRY_SECONDS,
# WATCHDOG_PM2_APP, WATCHDOG_CHECK_TIMEOUT, WATCHDOG_ALERT_AFTER,
# WATCHDOG_RESTART_AFTER, WATCHDOG_COOLDOWN_SECONDS, WATCHDOG_LOAD_ALERT,
# WATCHDOG_LOAD_ALERT_SECONDS, WATCHDOG_MEM_ALERT_PCT, WATCHDOG_LOADAVG_FILE,
# WATCHDOG_MEMINFO_FILE, WATCHDOG_NOW (epoch; tests), plus DEPLOY_STATE_DIR,
# DEPLOY_ALERT_FILE, DEPLOY_ALERTS_ENV, DEPLOY_REPEAT_SECONDS, DEPLOY_NOTIFY.
# Cases: bash ops/tests/server-watchdog.sh
set -euo pipefail

DRY_RUN=0
case "${1:-}" in
  "") ;;
  --dry-run) DRY_RUN=1 ;;
  -h | --help)
    echo "usage: server-watchdog.sh [--dry-run]"
    exit 0
    ;;
  *)
    echo "server-watchdog.sh: unknown option: $1" >&2
    echo "usage: server-watchdog.sh [--dry-run]" >&2
    exit 2
    ;;
esac
[ $# -le 1 ] || { echo "server-watchdog.sh: too many arguments" >&2; exit 2; }

DEPLOY_SCRIPT=${WATCHDOG_DEPLOY_SCRIPT:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/auto-deploy.sh}
[ -r "$DEPLOY_SCRIPT" ] || { echo "server-watchdog.sh: cannot read $DEPLOY_SCRIPT" >&2; exit 2; }
# Only a short block of plain VAR=${...} lines is evaluated: if ^NOTIFY= ever
# moved, the sed range would run to the end of auto-deploy.sh and eval the
# whole deploy every 2 minutes.
alert_vars=$(sed -n '/^ALERTS_ENV=/,/^NOTIFY=/p' "$DEPLOY_SCRIPT")
if [ "$(wc -l <<< "$alert_vars")" -gt 8 ] || grep -qvE '^[A-Z_]+=\$\{[A-Z_]+:-[^}$`]*\}$' <<< "$alert_vars"; then
  echo "server-watchdog.sh: unexpected ALERTS_ENV..NOTIFY block in $DEPLOY_SCRIPT" >&2
  exit 2
fi
eval "$alert_vars"
fn_src() {
  awk -v start="$1() {" 'index($0, start) == 1 { p = 1; print; if ($0 ~ /}[[:space:]]*$/) exit; next }
    p { print; if ($0 ~ /^}/) exit }' "$DEPLOY_SCRIPT"
}
for f in ts post_slack emit; do
  eval "$(fn_src "$f")"
  declare -F "$f" > /dev/null || { echo "server-watchdog.sh: $f not found in $DEPLOY_SCRIPT" >&2; exit 2; }
done

API_URL=${WATCHDOG_API_URL:-http://127.0.0.1:8888/version}
DB_CONTAINER=${WATCHDOG_DB_CONTAINER:-supabase-db}
DB_HOST=${WATCHDOG_DB_HOST:-127.0.0.1}
DB_PORT=${WATCHDOG_DB_PORT:-54321}
PM2_APP=${WATCHDOG_PM2_APP:-infiniterealms-bun}
CHECK_TIMEOUT=${WATCHDOG_CHECK_TIMEOUT:-10}
ALERT_AFTER=${WATCHDOG_ALERT_AFTER:-2}
RESTART_AFTER=${WATCHDOG_RESTART_AFTER:-3}
COOLDOWN=${WATCHDOG_COOLDOWN_SECONDS:-1800}
LOAD_ALERT=${WATCHDOG_LOAD_ALERT:-12}
LOAD_ALERT_SECONDS=${WATCHDOG_LOAD_ALERT_SECONDS:-600}
MEM_ALERT_PCT=${WATCHDOG_MEM_ALERT_PCT:-90}
LOADAVG=${WATCHDOG_LOADAVG_FILE:-/proc/loadavg}
MEMINFO=${WATCHDOG_MEMINFO_FILE:-/proc/meminfo}
NOW=${WATCHDOG_NOW:-$(date +%s)}

mkdir -p "$STATE_DIR"
if [ "$DRY_RUN" = 1 ]; then
  STATE="$STATE_DIR/server-watchdog.dry-run.state"
  TAG="watchdog [dry-run]:"
else
  STATE="$STATE_DIR/server-watchdog.state"
  TAG="watchdog:"
fi
log() { echo "$(ts) $TAG $*"; }

# Every command below runs with fd 9 closed (9>&-): a daemon spawned by a
# restart (pm2 starts a fresh God daemon when its old one is gone) would
# otherwise inherit the lock and hold it forever.
RUNNING="$STATE_DIR/server-watchdog.running" # epoch the lock holder started
exec 9>> "$STATE_DIR/server-watchdog.lock"
if ! flock -n 9; then
  started=$(cat "$RUNNING" 2> /dev/null || echo "$NOW")
  [[ $started =~ ^[0-9]+$ ]] || started=$NOW
  log "skipped: a previous run (started $(((NOW - started) / 60))m ago) still holds $STATE_DIR/server-watchdog.lock"
  # A run never legitimately takes 10 minutes; one that does has wedged the watchdog.
  STUCK="$STATE_DIR/server-watchdog.stuck-alerted"
  last=$(cat "$STUCK" 2> /dev/null || echo 0)
  [[ $last =~ ^[0-9]+$ ]] || last=0
  if [ $((NOW - started)) -ge 600 ] && [ $((NOW - last)) -ge "$REPEAT_SECONDS" ]; then
    msg="🔴 WATCHDOG: no health checks are running: the lock has been held for $(((NOW - started) / 60))m. Look at \`fuser -v $STATE_DIR/server-watchdog.lock\`."
    if [ "$DRY_RUN" = 1 ]; then log "would alert: $msg"; else log "alert: $msg"; emit "$msg"; echo "$NOW" > "$STUCK"; fi
  fi
  exit 0
fi
echo "$NOW" > "$RUNNING"

# key=value per line. Read, never sourced.
declare -A S=()
if [ -r "$STATE" ]; then
  while IFS='=' read -r k v; do [ -n "$k" ] && S[$k]=$v; done < "$STATE"
fi
num() { local v=${S[$1]:-0}; [[ $v =~ ^[0-9]+$ ]] || v=0; echo "$v"; }
save_state() {
  local k
  for k in "${!S[@]}"; do printf '%s=%s\n' "$k" "${S[$k]}"; done | sort > "$STATE.tmp"
  mv "$STATE.tmp" "$STATE"
}

notify() { # every action alert: alerts.log + Slack, or only a log line in a dry run
  if [ "$DRY_RUN" = 1 ]; then log "would alert: $1"; else log "alert: $1"; emit "$1"; fi
}
alert_limited() { # <key> <message>: first time, then at most once per REPEAT_SECONDS
  if [ $((NOW - $(num "alerted_$1"))) -ge "$REPEAT_SECONDS" ]; then
    notify "$2"
    S[alerted_$1]=$NOW
  else
    log "still alerting ($1, last sent $(((NOW - $(num "alerted_$1")) / 60))m ago): $2"
  fi
}
recovered() { # <key> <message>: only if <key> alerted
  [ "$(num "alerted_$1")" -gt 0 ] || return 0
  notify "$2"
  unset "S[alerted_$1]"
}
act() { # run a restart command, or say what it would be
  if [ "$DRY_RUN" = 1 ]; then
    log "would run: $*"
    return 0
  fi
  log "running: $*"
  "$@" 9>&-
}
short() { tr '\n' ' ' | cut -c1-160 | sed 's/[[:space:]]*$//'; }

# --- metrics: logged every run, alert only -----------------------------------
read -r LOAD1 LOAD5 LOAD15 _ < "$LOADAVG"
MEM_PCT=$(awk '/^MemTotal:/ { t = $2 } /^MemAvailable:/ { a = $2 } END { if (t > 0) printf "%d", (t - a) * 100 / t; else print 0 }' "$MEMINFO")
SWAP_PCT=$(awk '/^SwapTotal:/ { t = $2 } /^SwapFree:/ { f = $2 } END { if (t > 0) printf "%d", (t - f) * 100 / t; else print 0 }' "$MEMINFO")

if awk -v a="$LOAD1" -v b="$LOAD_ALERT" 'BEGIN { exit !(a >= b) }'; then
  [ "$(num load_high_since)" -gt 0 ] || S[load_high_since]=$NOW
  high_for=$((NOW - $(num load_high_since)))
  if [ "$high_for" -ge "$LOAD_ALERT_SECONDS" ]; then
    alert_limited load "⚠️ WATCHDOG: load1 $LOAD1 ≥ $LOAD_ALERT for $((high_for / 60))m (load $LOAD1/$LOAD5/$LOAD15). Alert only: load never triggers a restart (#2501)."
  fi
else
  unset "S[load_high_since]"
  recovered load "✅ WATCHDOG RECOVERED: load1 $LOAD1 below $LOAD_ALERT."
fi
if [ "$MEM_PCT" -ge "$MEM_ALERT_PCT" ]; then
  alert_limited mem "⚠️ WATCHDOG: memory ${MEM_PCT}% used (alert at ${MEM_ALERT_PCT}%, swap ${SWAP_PCT}%). Alert only: nothing is stopped (#2501)."
else
  recovered mem "✅ WATCHDOG RECOVERED: memory ${MEM_PCT}% used."
fi

# --- probes ------------------------------------------------------------------
# Each sets <unit>_reason and returns 0 healthy / 1 failed. timeout(1) bounds
# every call, so a hung daemon cannot hang the run (and the lock with it).
probe_api() {
  local resp code rc=0
  resp=$(timeout -k 2 "$CHECK_TIMEOUT" curl -s -m "$CHECK_TIMEOUT" -w '\n%{http_code}' "$API_URL" 2> /dev/null 9>&-) || rc=$?
  code=${resp##*$'\n'}
  if [ "$code" = 200 ] && grep -q '"commit"' <<< "${resp%$'\n'*}"; then return 0; fi
  case "$rc:$code" in
    7:*) api_reason="connection refused by $API_URL" ;;
    28:* | 124:* | 137:*) api_reason="no answer from $API_URL in ${CHECK_TIMEOUT}s" ;;
    *:200) api_reason="HTTP 200 without a commit from $API_URL" ;;
    *:[1-5][0-9][0-9]) api_reason="HTTP $code from $API_URL" ;;
    *) api_reason="curl exit $rc on $API_URL" ;;
  esac
  return 1
}
probe_docker() {
  local rc=0
  timeout -k 2 "$CHECK_TIMEOUT" docker info --format '{{.ServerVersion}}' > /dev/null 2>&1 9>&- || rc=$?
  [ "$rc" = 0 ] && return 0
  if [ "$rc" = 124 ] || [ "$rc" = 137 ]; then
    docker_reason="docker info: no answer in ${CHECK_TIMEOUT}s"
  else
    docker_reason="docker info: exit $rc"
  fi
  return 1
}
probe_db() {
  local out rc=0
  # The timeout kills the docker exec client, not psql inside the container;
  # these bound psql there too, so a hung postgres does not collect one stuck
  # backend per tick.
  out=$(timeout -k 2 "$CHECK_TIMEOUT" docker exec -e PGCONNECT_TIMEOUT="$CHECK_TIMEOUT" \
    -e PGOPTIONS="-c statement_timeout=${CHECK_TIMEOUT}s" "$DB_CONTAINER" psql -U postgres -tAc 'select 1' 2>&1 9>&-) || rc=$?
  [ "$rc" = 0 ] && [ "$(tr -d '[:space:]' <<< "$out")" = 1 ] && return 0
  if [ "$rc" = 124 ] || [ "$rc" = 137 ]; then
    db_reason="SELECT 1 on $DB_CONTAINER: no answer in ${CHECK_TIMEOUT}s"
  else
    db_reason="SELECT 1 on $DB_CONTAINER: exit $rc: $(short <<< "$out")"
  fi
  return 1
}
# Asked only before a docker or db restart. pg_isready talks to postgres on its
# host port and does not go through dockerd. Postgres counts as down only when
# two attempts PORT_RETRY seconds apart both get no response (exit 2) within a
# generous PORT_TIMEOUT. Exit 1 (starting up, shutting down, crash recovery)
# and an attempt that does not finish (a box under heavy load) count as
# answering: never restart on "slow" or "busy recovering". Sets port_state.
PORT_TIMEOUT=${WATCHDOG_DB_PORT_TIMEOUT:-30}
PORT_RETRY=${WATCHDOG_DB_PORT_RETRY_SECONDS:-5}
pg_port() {
  local rc=0
  timeout -k 2 $((PORT_TIMEOUT + 5)) pg_isready -h "$DB_HOST" -p "$DB_PORT" -t "$PORT_TIMEOUT" > /dev/null 2>&1 9>&- || rc=$?
  echo "$rc"
}
db_port_answers() {
  local rc
  rc=$(pg_port)
  if [ "$rc" = 2 ]; then
    sleep "$PORT_RETRY"
    rc=$(pg_port)
  fi
  case "$rc" in
    0) port_state="accepts connections" ;;
    1) port_state="answers but rejects connections (starting up, shutting down or in recovery)" ;;
    2) port_state="no response twice"; return 1 ;;
    *) port_state="pg_isready exit $rc (no verdict, treated as answering)" ;;
  esac
  return 0
}

status=()
for unit in api docker db; do
  declare "${unit}_reason="
  if "probe_$unit"; then
    S[fail_$unit]=0
    status+=("$unit ok")
  else
    S[fail_$unit]=$(($(num "fail_$unit") + 1))
    reason_var="${unit}_reason"
    status+=("$unit FAIL $(num "fail_$unit")/$RESTART_AFTER (${!reason_var})")
  fi
done
line=$(printf '%s | ' "${status[@]}")
log "load $LOAD1/$LOAD5/$LOAD15 mem ${MEM_PCT}% swap ${SWAP_PCT}% | ${line% | }"

# --- recoveries and alerts ---------------------------------------------------
for unit in api docker db; do
  n=$(num "fail_$unit")
  reason_var="${unit}_reason"
  if [ "$n" = 0 ]; then
    recovered "$unit" "✅ WATCHDOG RECOVERED: $unit healthy again."
  elif [ "$n" -ge "$ALERT_AFTER" ] && [ "$n" -lt "$RESTART_AFTER" ]; then
    alert_limited "$unit" "🔴 WATCHDOG: $unit unhealthy, $n consecutive failed checks (${!reason_var}). Restart after $RESTART_AFTER."
  fi
done

# --- at most one restart per run, cooldown across all units -----------------
unit="" cmd=() why=""
if [ "$(num fail_docker)" -ge "$RESTART_AFTER" ]; then
  if db_port_answers; then
    alert_limited docker_db_up "🔴 WATCHDOG: docker daemon not answering for $(num fail_docker) checks ($docker_reason), but postgres on $DB_HOST:$DB_PORT $port_state. NOT restarting Docker while the DB answers (#2501); look at \`systemctl status docker\`."
  else
    unit=docker cmd=(timeout -k 10 300 systemctl restart docker)
    why="docker daemon not answering for $(num fail_docker) checks ($docker_reason) and postgres on $DB_HOST:$DB_PORT gave no response twice"
  fi
fi
if [ -z "$unit" ] && [ "$(num fail_docker)" = 0 ] && [ "$(num fail_db)" -ge "$RESTART_AFTER" ]; then
  if db_port_answers; then
    alert_limited db_port_up "🔴 WATCHDOG: $db_reason for $(num fail_db) checks, but postgres on $DB_HOST:$DB_PORT $port_state. Not restarting $DB_CONTAINER while it answers; look at it."
  else
    unit=db cmd=(timeout -k 10 120 docker restart "$DB_CONTAINER")
    why="$db_reason for $(num fail_db) checks and postgres on $DB_HOST:$DB_PORT gave no response twice"
  fi
fi
if [ -z "$unit" ] && [ "$(num fail_api)" -ge "$RESTART_AFTER" ]; then
  unit=api cmd=(timeout -k 10 60 pm2 restart "$PM2_APP")
  why="$api_reason for $(num fail_api) checks"
fi

if [ -n "$unit" ]; then
  since=$((NOW - $(num last_restart)))
  if [ "$(num last_restart)" -gt 0 ] && [ "$since" -lt "$COOLDOWN" ]; then
    alert_limited "cooldown_$unit" "🔴 WATCHDOG: would restart $unit ($why), but the last restart (${S[last_restart_unit]:-?}) was $((since / 60))m ago; cooldown is $((COOLDOWN / 60))m, so nothing is restarted."
  else
    notify "🔴 WATCHDOG: restarting $unit: $why. Command: ${cmd[*]}"
    rc=0
    act "${cmd[@]}" || rc=$?
    if [ "$rc" = 0 ]; then
      [ "$DRY_RUN" = 1 ] || log "restart of $unit returned 0"
    else
      notify "🔴 WATCHDOG: restart of $unit FAILED (exit $rc): ${cmd[*]}"
    fi
    # A restart, failed or not, starts the cooldown and a fresh failure count:
    # the unit must fail RESTART_AFTER new checks before anything else happens.
    S[last_restart]=$NOW
    S[last_restart_unit]=$unit
    S[fail_$unit]=0
    S[alerted_$unit]=$NOW
  fi
fi

save_state
