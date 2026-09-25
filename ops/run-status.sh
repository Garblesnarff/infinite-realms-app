#!/usr/bin/env bash
# Is a #2093 stranger-test run open? (#2224)
#
# Prints the answer auto-deploy.sh's cron would act on, plus the newest run
# marker, so the merger and the cron agree from one call:
#
#   $ ops/run-status.sh
#   run: open — run 9 started 12m ago (#2093: run 9 started — session …)
#   newest: run 9 started
#
# Exit status: 0 no open run (the cron would deploy), 1 open run (the cron
# holds), 2 GitHub could not be read.
#
# open_run, newest_run, newest_run_detail and the DEPLOY_RUN_* defaults are
# read out of auto-deploy.sh rather than copied, so the two can never disagree
# about what a marker is. auto-deploy.sh is installed on the host as a single
# file, which is why this extracts rather than sources a shared library.
# Overrides: RUN_STATUS_DEPLOY_SCRIPT (default: the sibling auto-deploy.sh), and
# the same DEPLOY_RUN_ISSUE, DEPLOY_RUN_REPO, DEPLOY_RUN_HOLD_MAX_AGE_SECONDS and
# DEPLOY_GH_BIN the cron honours.
set -euo pipefail

SCRIPT=${RUN_STATUS_DEPLOY_SCRIPT:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/auto-deploy.sh}
[ -r "$SCRIPT" ] || { echo "run-status.sh: cannot read $SCRIPT" >&2; exit 2; }

eval "$(sed -n '/^RUN_ISSUE=/,/^GH_BIN=/p' "$SCRIPT")"
eval "$(sed -n '/^open_run() {/,/^}/p' "$SCRIPT")"
eval "$(sed -n '/^newest_run() {/,/^}/p' "$SCRIPT")"
eval "$(sed -n '/^newest_run_detail() {/,/^}/p' "$SCRIPT")"
for f in open_run newest_run newest_run_detail; do
  declare -F "$f" > /dev/null || { echo "run-status.sh: $f not found in $SCRIPT" >&2; exit 2; }
done

if ! RUN_OPEN=$(open_run 2>/dev/null); then
  echo "run: unknown — could not read #$RUN_ISSUE comments via gh"
  exit 2
fi

status=0
if [ -z "$RUN_OPEN" ]; then
  echo "run: closed"
else
  IFS=$'\t' read -r RUN_N RUN_AT RUN_LINE <<< "$RUN_OPEN"
  RUN_AGE=$(( $(date +%s) - RUN_AT ))
  if [ "$RUN_AGE" -lt "$RUN_HOLD_MAX_AGE_SECONDS" ]; then
    echo "run: open — run $RUN_N started $(( RUN_AGE / 60 ))m ago (#$RUN_ISSUE: $RUN_LINE)"
    status=1
  else
    # Same cut-off as the cron: past it, a missing "ended" is assumed forgotten.
    echo "run: closed — run $RUN_N started $(( RUN_AGE / 60 ))m ago with no \"ended\"; older than ${RUN_HOLD_MAX_AGE_SECONDS}s, so auto-deploy ignores it"
  fi
fi
newest_run_detail
exit "$status"
