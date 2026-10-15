#!/usr/bin/env bash
set -euo pipefail

# 1-minute deploy tick (#663 item 2). Cheap pre-check in front of
# ops/auto-deploy.sh: a quiet tick costs a few file stats and one `git fetch`,
# then exits. HOLD file and smoke gate are honored here AND re-checked inside
# auto-deploy.sh (it remains the authority; this script only avoids waking it
# when there is nothing to do).
#
# Order:
#   1. Flags present -> bypass the pre-check entirely and exec auto-deploy.sh,
#      so --deploy-now/--dry-run behave exactly as the full script documents
#      (including "Refusing --deploy-now" under a hold, exit 1).
#   2. HOLD file present -> exit 0, no fetch. A STALE hold (>=
#      DEPLOY_HOLD_STALE_SECONDS, default 3h) hands off to auto-deploy.sh at
#      most once per DEPLOY_REPEAT_SECONDS so its stale-hold paging keeps its
#      heartbeat; otherwise a forgotten hold would silently stop prod tracking
#      main with no page (the #2093 / 2026-05-12 drift shape).
#   3. SMOKE_FAILED present -> exit 0, no fetch; handoff at most once per
#      DEPLOY_REPEAT_SECONDS for the hourly smoke-failure repeat page.
#   4. Fresh TRAIN file -> exit 0, no fetch (same as auto-deploy.sh).
#   5. hold.state/smoke.state says fail but no hold file exists (hold removed
#      while quiet) -> hand off once so auto-deploy.sh emits the RECOVERED
#      transition instead of reporting a bogus "was broken Nm" later.
#   6. `git fetch origin main` fails -> hand off anyway so auto-deploy.sh's
#      fetch-failure alerting runs. A silent fetch failure is the 2026-08-11
#      shape: prod stops tracking main and nothing pages.
#   7. HEAD == origin/main -> "no changes", exit 0.
#   8. origin/main moved -> exec auto-deploy.sh (it re-checks TRAIN, the open
#      stranger-test run, and smoke before doing anything).
#
# Applying on the box is a Hetzner paste, not part of this repo change: copy
# ops/systemd/infiniterealms-deploy-tick.{service,timer} to
# /etc/systemd/system/, `systemctl daemon-reload`, and `systemctl enable
# --now` the timer; keep the old 15-minute root cron entry until a deploy has
# carried this script into the checkout, then remove the cron entry.
# (Item 2 in #663: "Applying it on the box is a Hetzner paste; your PR ships
# the script + unit/timer files".)

SELF_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DEPLOY_SCRIPT=${DEPLOY_SCRIPT:-$SELF_DIR/auto-deploy.sh}
STATE_DIR=${DEPLOY_STATE_DIR:-/var/lib/infiniterealms-deploy}
REPO_DIR=${DEPLOY_REPO_DIR:-/var/www/infiniterealms/ai-adventure-scribe-main}
REPEAT_SECONDS=${DEPLOY_REPEAT_SECONDS:-3600}
HOLD_STALE_SECONDS=${DEPLOY_HOLD_STALE_SECONDS:-10800}
TRAIN_STALE_SECONDS=${DEPLOY_TRAIN_STALE_SECONDS:-3600}

ts() { date '+[%F %T]'; }

# Flags are auto-deploy.sh's business (see order item 1 above).
if [ $# -gt 0 ]; then
  exec "$DEPLOY_SCRIPT" "$@"
fi

mkdir -p "$STATE_DIR"

HOLD_FILE=${DEPLOY_HOLD_FILE:-$STATE_DIR/HOLD}
SMOKE_HOLD_FILE=${DEPLOY_SMOKE_HOLD_FILE:-$STATE_DIR/SMOKE_FAILED}
TRAIN_FILE=${DEPLOY_TRAIN_FILE:-$STATE_DIR/TRAIN}

# handoff_due <key> <interval>: true at most once per <interval> seconds while
# a held state persists, so the stale-hold / smoke pages keep their heartbeat
# without running the full script every minute.
handoff_due() {
  local key=$1 interval=$2 now last=0 file
  file="$STATE_DIR/tick-$key.last"
  now=$(date +%s)
  [ -r "$file" ] && last=$(cat "$file" 2>/dev/null || echo 0)
  case "$last" in ''|*[!0-9]*) last=0 ;; esac
  if [ $(( now - last )) -ge "$interval" ]; then
    echo "$now" > "$file"
    return 0
  fi
  return 1
}

file_age() { # seconds since mtime; 0 when missing
  local f=$1
  [ -e "$f" ] || { echo 0; return 0; }
  echo $(( $(date +%s) - $(stat -c %Y "$f" 2>/dev/null || echo 0) ))
}

state_is_fail() { # $1 = state file; true when its first word is "fail"
  local f=$1 word
  [ -r "$f" ] || return 1
  word=$(cut -d' ' -f1 "$f" 2>/dev/null || true)
  [ "$word" = "fail" ]
}

if [ -e "$HOLD_FILE" ]; then
  if [ "$(file_age "$HOLD_FILE")" -ge "$HOLD_STALE_SECONDS" ] && handoff_due hold "$REPEAT_SECONDS"; then
    echo "$(ts) tick: stale HOLD, handing off to auto-deploy.sh for paging."
    exec "$DEPLOY_SCRIPT"
  fi
  echo "$(ts) tick: HOLD present, no fetch."
  exit 0
fi
if [ -e "$SMOKE_HOLD_FILE" ]; then
  if handoff_due smoke "$REPEAT_SECONDS"; then
    echo "$(ts) tick: smoke hold present, handing off to auto-deploy.sh for paging."
    exec "$DEPLOY_SCRIPT"
  fi
  echo "$(ts) tick: smoke hold present, no fetch."
  exit 0
fi
if [ -e "$TRAIN_FILE" ] && [ "$(file_age "$TRAIN_FILE")" -lt "$TRAIN_STALE_SECONDS" ]; then
  echo "$(ts) tick: fresh TRAIN present, no fetch."
  exit 0
fi
if state_is_fail "$STATE_DIR/hold.state" || state_is_fail "$STATE_DIR/smoke.state"; then
  echo "$(ts) tick: fail-state with no hold file, handing off to clear it."
  exec "$DEPLOY_SCRIPT"
fi

cd "$REPO_DIR"
PREV_HEAD=$(git rev-parse HEAD)
if ! git fetch --quiet origin main 2>/dev/null; then
  echo "$(ts) tick: fetch failed, handing off to auto-deploy.sh for alerting."
  exec "$DEPLOY_SCRIPT"
fi
NEW_HEAD=$(git rev-parse origin/main)
if [[ "$PREV_HEAD" == "$NEW_HEAD" ]]; then
  echo "$(ts) tick: no changes (HEAD: ${PREV_HEAD:0:8})"
  exit 0
fi
echo "$(ts) tick: origin/main moved ${PREV_HEAD:0:8} -> ${NEW_HEAD:0:8}, handing off to auto-deploy.sh."
exec "$DEPLOY_SCRIPT"
