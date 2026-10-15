#!/usr/bin/env bash
# Cases for the 1-minute deploy tick in ops/auto-deploy-tick.sh (#663 item 2).
# Runs the real script against a scratch git repo (a bare "origin" plus a
# clone) with a stub auto-deploy.sh, as ops/tests/smoke-deploy.sh does.
#
#   1. HOLD present (and origin moved): exit 0, stub NOT called.
#   2. SMOKE_FAILED present (fresh): exit 0, stub called ONCE (first page),
#      then NOT called on the immediate re-tick (throttled to REPEAT_SECONDS).
#   3. No movement: exit 0, "no changes", stub NOT called.
#   4. origin/main moved: stub called exactly once.
#   5. fetch fails: stub IS called (so auto-deploy.sh's alerting runs).
#   6. stale HOLD (>= DEPLOY_HOLD_STALE_SECONDS): stub IS called (paging).
#   7. stale HOLD again at once: stub NOT called (throttled to REPEAT_SECONDS).
#   8. flags passed (--dry-run, no movement): stub IS called (flag bypass).
#   9. hold.state=fail with no HOLD file: stub IS called (RECOVERED clearing).
#  10. fresh TRAIN (and origin moved): exit 0, stub NOT called.
#
#   bash ops/tests/auto-deploy-tick.sh
#
# Needs bash and git. Touches nothing outside a temp dir.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$HERE/../auto-deploy-tick.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_DATE=2026-10-14T00:00:00Z GIT_COMMITTER_DATE=2026-10-14T00:00:00Z

# Stub auto-deploy.sh: records that it was invoked, then exits 0.
mkdir -p "$TMP/bin"
cat > "$TMP/bin/stub-deploy.sh" <<'STUB'
#!/usr/bin/env bash
echo "stub-deploy called $*" >> "$STUB_LOG"
exit 0
STUB
chmod +x "$TMP/bin/stub-deploy.sh"
export STUB_LOG="$TMP/stub.log"

# Scratch origin + clone. The clone's HEAD starts at origin/main.
git init -q --bare "$TMP/origin.git"
git init -q "$TMP/seed"
git -C "$TMP/seed" commit -q --allow-empty -m seed
git -C "$TMP/seed" push -q "$TMP/origin.git" HEAD:main
git clone -q "$TMP/origin.git" "$TMP/clone" 2>/dev/null
git -C "$TMP/clone" checkout -q -B main origin/main

export DEPLOY_STATE_DIR="$TMP/state"
export DEPLOY_REPO_DIR="$TMP/clone"
export DEPLOY_SCRIPT="$TMP/bin/stub-deploy.sh"
export DEPLOY_HOLD_STALE_SECONDS=60
export DEPLOY_REPEAT_SECONDS=3600
mkdir -p "$DEPLOY_STATE_DIR"

pass=0; fail=0
check() { # check <name> <expected-exit> <stub-calls-expected> [grep-for] [-- args...]
  local name=$1 want_exit=$2 want_calls=$3 want_grep=${4:-}
  shift 4 || true
  : > "$STUB_LOG"
  local out rc
  out=$(bash "$SCRIPT" "$@" 2>&1); rc=$?
  local calls
  calls=$(grep -c '^stub-deploy called' "$STUB_LOG" || true)
  if [ "$rc" = "$want_exit" ] && [ "$calls" = "$want_calls" ] \
     && { [ -z "$want_grep" ] || grep -q "$want_grep" <<<"$out"; }; then
    echo "ok: $name"; pass=$((pass+1))
  else
    echo "FAIL: $name (exit=$rc want $want_exit, stub_calls=$calls want $want_calls)"
    echo "--- output ---"; echo "$out"; echo "---"
    fail=$((fail+1))
  fi
}

# Advance origin/main by one commit (clone stays behind).
move_origin() {
  git -C "$TMP/seed" commit -q --allow-empty -m move
  git -C "$TMP/seed" push -q "$TMP/origin.git" HEAD:main
}
# Resync the clone to origin/main (quiet tick baseline).
sync_clone() {
  git -C "$TMP/clone" fetch -q origin main
  git -C "$TMP/clone" reset -q --hard origin/main
}
clean_state() {
  rm -f "$DEPLOY_STATE_DIR"/HOLD "$DEPLOY_STATE_DIR"/SMOKE_FAILED \
        "$DEPLOY_STATE_DIR"/TRAIN "$DEPLOY_STATE_DIR"/tick-hold.last \
        "$DEPLOY_STATE_DIR"/tick-smoke.last \
        "$DEPLOY_STATE_DIR"/hold.state "$DEPLOY_STATE_DIR"/smoke.state
  sync_clone
}

# 1. HOLD present, origin moved -> stub not called.
clean_state; move_origin
touch "$DEPLOY_STATE_DIR/HOLD"
check "hold short-circuits" 0 0 "HOLD present"

# 2. SMOKE_FAILED present, fresh -> stub called once (first page).
clean_state; move_origin
touch "$DEPLOY_STATE_DIR/SMOKE_FAILED"
check "smoke hold first page" 0 1 "smoke hold present, handing off"

# 2b. SMOKE_FAILED re-tick at once -> stub NOT called (throttled).
check "smoke hold throttled" 0 0 "smoke hold present"

# 3. No movement -> stub not called.
clean_state
check "quiet tick" 0 0 "no changes"

# 4. Movement -> stub called once.
clean_state; move_origin
check "movement hands off" 0 1 "handing off"

# 5. Fetch failure -> stub called (alerting path).
clean_state
git -C "$TMP/clone" remote set-url origin "$TMP/does-not-exist.git"
check "fetch failure hands off" 0 1 "fetch failed"
git -C "$TMP/clone" remote set-url origin "$TMP/origin.git"

# 6. Stale HOLD -> stub called (paging handoff).
clean_state; move_origin
touch -d '5 minutes ago' "$DEPLOY_STATE_DIR/HOLD"
check "stale hold hands off" 0 1 "stale HOLD"

# 7. Stale HOLD again immediately -> stub NOT called (throttled).
check "stale hold throttled" 0 0 "HOLD present"

# 8. Flags bypass the pre-check.
clean_state
check "flag bypass" 0 1 "" --dry-run

# 9. fail-state with no hold file -> stub called (RECOVERED clearing).
clean_state
echo "fail 1234 1234" > "$DEPLOY_STATE_DIR/hold.state"
check "fail-state hands off" 0 1 "fail-state"

# 10. Fresh TRAIN, origin moved -> stub not called.
clean_state; move_origin
touch "$DEPLOY_STATE_DIR/TRAIN"
check "fresh train short-circuits" 0 0 "TRAIN present"

echo "pass=$pass fail=$fail"
[ "$fail" = 0 ]
