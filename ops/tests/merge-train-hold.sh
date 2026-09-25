#!/usr/bin/env bash
# End-to-end cases for the merge-train hold in ops/auto-deploy.sh (#2224).
# Runs the real script against a scratch git repo (a bare "origin" plus a
# clone), with stub bun/bunx/pm2/node/rsync/chown on DEPLOY_BIN_PATH and a stub
# `gh` serving an empty #2093 comment list, so a "deploy" touches only the
# temp dir.
#
#   bash ops/tests/merge-train-hold.sh
#
# Needs bash, git, jq and GNU coreutils. Touches nothing outside a temp dir.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$HERE/../auto-deploy.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/bin"
for b in bun bunx pm2 node rsync chown; do
  printf '#!/usr/bin/env bash\necho "stub %s $*" >> "$STUB_LOG"\n' "$b" > "$TMP/bin/$b"
done
printf '#!/usr/bin/env bash\necho "[]"\n' > "$TMP/bin/gh"
chmod +x "$TMP/bin"/*

export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
# Fixed dates make both scratch repos produce the same SHAs, so logs can be diffed.
export GIT_AUTHOR_DATE=2026-09-25T00:00:00Z GIT_COMMITTER_DATE=2026-09-25T00:00:00Z

# setup <dir> <moved|still>: a clone whose origin/main is one commit ahead
# (moved) or level with it (still), and a fresh state dir.
setup() {
  local d=$1
  git init -q --bare -b main "$d/origin.git"
  git clone -q "$d/origin.git" "$d/app" 2> /dev/null
  mkdir -p "$d/app/server-bun" "$d/app/dist" "$d/state"
  touch "$d/app/server-bun/.keep" "$d/app/dist/index.html"
  git -C "$d/app" add -A && git -C "$d/app" commit -qm one && git -C "$d/app" push -q origin HEAD:main
  if [ "$2" = moved ]; then
    git clone -q "$d/origin.git" "$d/pusher" 2> /dev/null
    git -C "$d/pusher" commit -q --allow-empty -m two && git -C "$d/pusher" push -q origin HEAD:main
  fi
}

# deploy <dir> <script> [args...]: run with every host path pointed into <dir>.
# Leaves the log, timestamps stripped, in <dir>/out; sets RC.
deploy() {
  local d=$1 s=$2; shift 2
  RC=0
  STUB_LOG="$d/stub.log" DEPLOY_REPO_DIR="$d/app" DEPLOY_STATE_DIR="$d/state" \
    DEPLOY_ALERT_FILE="$d/alerts.log" DEPLOY_ALERTS_ENV="$d/none.env" \
    DEPLOY_STAGING_ROOT="$d/staging" DEPLOY_BIN_PATH="$TMP/bin" DEPLOY_GH_BIN="$TMP/bin/gh" \
    bash "$s" "$@" > "$d/out.raw" 2>&1 || RC=$?
  sed -e 's/^\[[0-9-]* [0-9:]*\] //' -e "s#$d#<D>#g" "$d/out.raw" > "$d/out"
}

pass=0 fail=0
ok() { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); printf 'FAIL %s\n%s\n' "$1" "$2"; }
# expect <name> <condition...>
expect() { local n=$1; shift; if "$@"; then ok "$n"; else bad "$n" "$OUT"; fi; }
has() { grep -qF -- "$1" <<< "$OUT"; }
hasnt() { ! grep -qF -- "$1" <<< "$OUT"; }

# 1. Fresh TRAIN: "hold train", exit 0, nothing fetched/built/restarted.
D="$TMP/fresh"; setup "$D" moved; touch "$D/state/TRAIN"
deploy "$D" "$SCRIPT"; OUT=$(<"$D/out")
expect "fresh TRAIN: logs 'hold train'" has "hold train: <D>/state/TRAIN present (0m)"
expect "fresh TRAIN: exit 0" test "$RC" = 0
expect "fresh TRAIN: no stub (bun/pm2/rsync) ran" test ! -e "$D/stub.log"
expect "fresh TRAIN: HEAD not advanced" \
  test "$(git -C "$D/app" rev-parse HEAD)" != "$(git -C "$D/origin.git" rev-parse main)"
expect "fresh TRAIN: no alert" test ! -s "$D/alerts.log"

deploy "$D" "$SCRIPT" --deploy-now; OUT=$(<"$D/out")
expect "fresh TRAIN: --deploy-now refuses with exit 1" test "$RC" = 1
expect "fresh TRAIN: --deploy-now says why" has "Refusing --deploy-now: a merge train is in progress."

# DEPLOY_TRAIN_FILE overrides the path.
D="$TMP/override"; setup "$D" moved; touch "$D/elsewhere"
DEPLOY_TRAIN_FILE="$D/elsewhere" deploy "$D" "$SCRIPT"; OUT=$(<"$D/out")
expect "DEPLOY_TRAIN_FILE honoured" has "hold train: <D>/elsewhere present"

# 2. Stale TRAIN (61 min): deploy proceeds, ALERT line + alerts.log entry.
D="$TMP/stale"; setup "$D" moved; touch -d '61 minutes ago' "$D/state/TRAIN"
deploy "$D" "$SCRIPT"; OUT=$(<"$D/out")
expect "stale TRAIN: ALERT line" has "ALERT: ignoring stale <D>/state/TRAIN (61m old, limit 60m); deploying anyway."
expect "stale TRAIN: deploy completes" has "Deploy complete ($(git -C "$D/origin.git" rev-parse main))"
expect "stale TRAIN: exit 0" test "$RC" = 0
expect "stale TRAIN: pm2 restarted" grep -q "stub pm2 restart infiniterealms-bun" "$D/stub.log"
expect "stale TRAIN: alerts.log paged" grep -q "DEPLOY FAILED: train — merge-train hold" "$D/alerts.log"
# Removing the file clears it to RECOVERED on the next run.
rm "$D/state/TRAIN"; deploy "$D" "$SCRIPT"; OUT=$(<"$D/out")
expect "stale TRAIN removed: RECOVERED" grep -q "DEPLOY RECOVERED: train" "$D/alerts.log"

# 59 minutes is still fresh.
D="$TMP/edge"; setup "$D" moved; touch -d '59 minutes ago' "$D/state/TRAIN"
deploy "$D" "$SCRIPT"; OUT=$(<"$D/out")
expect "59m TRAIN still holds" has "hold train: <D>/state/TRAIN present (59m)"

# 3. No TRAIN: output, exit status, stub calls and state files are identical to
# the same script with the merge-train block cut out, for both a real deploy
# and a no-change tick.
BASE="$TMP/baseline.sh"
sed '/^# --- merge-train hold/,/^# --- end merge-train hold/d' "$SCRIPT" > "$BASE"
expect "baseline really lacks the block" test "$(grep -c TRAIN_FILE "$BASE")" = 0
for shape in moved still; do
  A="$TMP/new-$shape" B="$TMP/old-$shape"
  setup "$A" "$shape"; setup "$B" "$shape"
  deploy "$A" "$SCRIPT"; RA=$RC; OA=$(<"$A/out")
  deploy "$B" "$BASE"; RB=$RC; OB=$(<"$B/out")
  OUT="new rc=$RA old rc=$RB"$'\n'"$(diff <(echo "$OA") <(echo "$OB") || true)"
  expect "no TRAIN ($shape): identical log + rc" test "$OA" = "$OB" -a "$RA" = "$RB"
  expect "no TRAIN ($shape): identical stub calls" \
    test "$(sed "s#$A#<D>#g" "$A/stub.log" 2> /dev/null)" = "$(sed "s#$B#<D>#g" "$B/stub.log" 2> /dev/null)"
  expect "no TRAIN ($shape): identical state files" \
    test "$(ls "$A/state")" = "$(ls "$B/state")"
done
has_deploy() { grep -q "Deploy complete" "$TMP/new-moved/out.raw"; }
expect "no TRAIN (moved) really deployed" has_deploy

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
