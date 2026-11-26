#!/usr/bin/env bash
# restore-drill-monthly.sh — monthly restore drill for the InfiniteRealms
# database (#38). Installed on the Hetzner box and run by cron (see
# ops/restore-drill-monthly.cron). It never touches the live database.
#
# Checks, against the newest backup in BACKUP_DIR:
#   1. RESTORE: restore-infiniterealms-db.sh --scratch <newest .dump>
#      must exit 0: a clean pg_restore --exit-on-error into a disposable
#      database, table count checked, database dropped.
#   2. NEGATIVE CONTROL: backup-infiniterealms-db.sh --verify-only on a copy
#      of that archive cut to half its size must exit NON-zero and say
#      "verify failed". A verify that accepts a truncated archive fails
#      the drill, because then the nightly verify proves nothing.
#
# Every run appends one line to DRILL_LOG: "restore-drill <UTC stamp>
# PASS ..." or "... FAIL reasons: ...". On FAIL it also posts to Slack
# through SLACK_ALERT_WEBHOOK_URL. That variable is read from the
# environment, or from BACKUP_ALERTS_ENV when it is not set (the same
# file the backup alerts use). The webhook URL is never written to a log.
#
# Environment (names only; defaults in the code):
#   BACKUP_DIR              where the nightly .dump files live
#   DRILL_LOG               append-only pass/fail log
#   RESTORE_SCRIPT          default: restore-infiniterealms-db.sh next to this file
#   BACKUP_SCRIPT           default: backup-infiniterealms-db.sh next to this file
#   BACKUP_ALERTS_ENV       env file that may hold SLACK_ALERT_WEBHOOK_URL
#   SLACK_ALERT_WEBHOOK_URL Slack incoming-webhook URL, used on FAIL
#
# Exit: 0 PASS; 1 FAIL.

# No -e on purpose: a failing restore or a failing negative control must not
# end the script. Each step checks its own status, and the drill must still
# reach the log line and the Slack alert after a FAIL. -e would skip both.
set -uo pipefail

PROG=$(basename "$0")
log() { printf '%s: %s\n' "$PROG" "$*"; }

HERE=$(cd "$(dirname "$0")" && pwd)
BACKUP_DIR=${BACKUP_DIR:-/var/backups/infiniterealms/postgres}
DRILL_LOG=${DRILL_LOG:-/var/log/infiniterealms/restore-drill.log}
RESTORE_SCRIPT=${RESTORE_SCRIPT:-$HERE/restore-infiniterealms-db.sh}
BACKUP_SCRIPT=${BACKUP_SCRIPT:-$HERE/backup-infiniterealms-db.sh}
ALERTS_ENV=${BACKUP_ALERTS_ENV:-/etc/infiniterealms/alerts.env}

RUN=$(date -u +%Y%m%dT%H%M%SZ)
WORK=$(mktemp -d) || { log "ERROR: mktemp failed"; exit 1; }
trap 'rm -rf "$WORK"' EXIT

FAILS=""
fail() {
  FAILS="${FAILS:+$FAILS; }$*"
  log "FAIL: $*"
}

# Print the webhook URL without logging it. Environment first, then the
# alerts env file (read in a subshell so nothing leaks into this shell).
slack_url() {
  if [ -n "${SLACK_ALERT_WEBHOOK_URL:-}" ]; then
    printf '%s' "$SLACK_ALERT_WEBHOOK_URL"
    return 0
  fi
  [ -r "$ALERTS_ENV" ] || return 0
  ( . "$ALERTS_ENV" >/dev/null 2>&1; printf '%s' "${SLACK_ALERT_WEBHOOK_URL:-}" )
}

post_slack() { # text
  local url
  url=$(slack_url)
  if [ -z "$url" ]; then
    log "slack: SLACK_ALERT_WEBHOOK_URL is not set; the FAIL alert was not sent"
    return 1
  fi
  if ! command -v curl >/dev/null 2>&1 || ! command -v jq >/dev/null 2>&1; then
    log "slack: curl or jq is missing; the FAIL alert was not sent"
    return 1
  fi
  curl -s -m 10 -X POST -H 'Content-type: application/json' \
    --data "$(jq -n --arg t "$1" '{text: $t}')" "$url" >/dev/null 2>&1 \
    || { log "slack: the post failed; the FAIL alert was not delivered"; return 1; }
  return 0
}

# 1. The newest verified-name dump. ".dump.unverified" evidence does not
#    match, so a failed backup is never drilled as if it were good.
NEWEST=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'infiniterealms_*.dump' 2>/dev/null | sort | tail -1)

if [ -z "$NEWEST" ]; then
  fail "no infiniterealms_*.dump in $BACKUP_DIR"
else
  log "newest backup: $NEWEST"

  # 2. RESTORE into a scratch database.
  if [ ! -f "$RESTORE_SCRIPT" ]; then
    fail "restore script missing: $RESTORE_SCRIPT"
  elif bash "$RESTORE_SCRIPT" --scratch "$NEWEST"; then
    log "restore check: PASS"
  else
    fail "restore --scratch of $(basename "$NEWEST") did not pass"
  fi

  # 3. NEGATIVE CONTROL: a truncated copy must be rejected. Alerts are
  #    kept off: the deliberate failure must not page Slack.
  if [ ! -f "$BACKUP_SCRIPT" ]; then
    fail "backup script missing: $BACKUP_SCRIPT"
  else
    TRUNC="$WORK/truncated.dump"
    SIZE=$(stat -c %s "$NEWEST") || SIZE=0
    head -c $((SIZE / 2)) "$NEWEST" > "$TRUNC" || fail "could not write the truncated copy"
    OUT=$(BACKUP_NOTIFY=0 BACKUP_ALERT_FILE="$WORK/alerts.log" BACKUP_ALERTS_ENV=/nonexistent \
      bash "$BACKUP_SCRIPT" --verify-only "$TRUNC" 2>&1)
    RC=$?
    if [ "$RC" -eq 0 ]; then
      fail "negative control: verify ACCEPTED a truncated copy of $(basename "$NEWEST")"
    elif ! printf '%s' "$OUT" | grep -q 'verify failed'; then
      fail "negative control: verify exited $RC without naming the failure"
    else
      log "negative control: PASS (truncated copy rejected, exit $RC)"
    fi
  fi
fi

if [ -z "$FAILS" ]; then
  RESULT=PASS
  LINE="restore-drill $RUN PASS dump=$(basename "$NEWEST")"
else
  RESULT=FAIL
  LINE="restore-drill $RUN FAIL dump=$(basename "${NEWEST:-none}") reasons: $FAILS"
fi

mkdir -p "$(dirname "$DRILL_LOG")" 2>/dev/null || true
if printf '%s\n' "$LINE" >> "$DRILL_LOG" 2>/dev/null; then
  log "logged to $DRILL_LOG"
else
  log "WARNING: could not append to $DRILL_LOG"
fi
log "$LINE"

if [ "$RESULT" = "FAIL" ]; then
  post_slack ":rotating_light: Infinite Realms monthly restore drill FAILED ($RUN): $FAILS" || true
  exit 1
fi
exit 0
