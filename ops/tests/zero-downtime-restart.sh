#!/usr/bin/env bash
# Cases for the #422 zero-downtime restart in ops/auto-deploy.sh. The
# zero_downtime_restart block is cut out of the real script and run against a
# stub pm2 and a stub ss, which share a little state dir, so each case scripts
# what the standby and the live app do and checks the order of pm2 calls:
#   (a) happy path: standby start, standby listening, live restart, live
#       listening, standby delete; exit 0
#   (b) standby never listens: plain live restart, standby deleted; exit 0
#   (c) live never listens again: standby kept serving; exit 1
#
#   bash ops/tests/zero-downtime-restart.sh
#
# Needs bash, jq and GNU coreutils. Touches nothing outside a temp dir.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$HERE/../auto-deploy.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
expect() {
  local name=$1
  shift
  if "$@"; then
    echo "ok   $name"
    PASS=$((PASS + 1))
  else
    echo "FAIL $name"
    FAIL=$((FAIL + 1))
  fi
}

# The handoff block: from the LIVE_APP= line up to the call site.
sed -n '/^LIVE_APP=infiniterealms-bun$/,/^if ! zero_downtime_restart; then$/p' "$SCRIPT" | sed '$d' > "$TMP/handoff.sh"
expect "handoff block found in auto-deploy.sh" grep -q '^zero_downtime_restart()' "$TMP/handoff.sh"

mkdir -p "$TMP/bin"
# Stub pm2. State per app in $ZD_STATE/<app>.pid (online) and
# $ZD_STATE/<app>.listen (listening on the port). The case picks what start
# and restart do via ZD_STANDBY_LISTENS / ZD_LIVE_LISTENS (1 or 0).
cat > "$TMP/bin/pm2" << 'EOF'
#!/usr/bin/env bash
echo "pm2 $*" >> "$ZD_STATE/calls"
case "$1" in
  jlist)
    for f in "$ZD_STATE"/*.pid; do
      [ -e "$f" ] || continue
      jq -n --arg n "$(basename "$f" .pid)" --argjson p "$(cat "$f")" '{name: $n, pid: $p, pm2_env: {status: "online"}}'
    done | jq -s . ;;
  start)
    echo 200 > "$ZD_STATE/infiniterealms-bun-standby.pid"
    [ "$ZD_STANDBY_LISTENS" = 1 ] && touch "$ZD_STATE/infiniterealms-bun-standby.listen"
    echo "[PM2] App [infiniterealms-bun-standby] launched" ;;
  restart)
    rm -f "$ZD_STATE/$2.listen"
    echo 101 > "$ZD_STATE/$2.pid"
    [ "$ZD_LIVE_LISTENS" = 1 ] && touch "$ZD_STATE/$2.listen"
    true ;;
  delete)
    rm -f "$ZD_STATE/$2.pid" "$ZD_STATE/$2.listen" ;;
esac
EOF
# Stub ss: one LISTEN line per app that listens.
cat > "$TMP/bin/ss" << 'EOF'
#!/usr/bin/env bash
for f in "$ZD_STATE"/*.listen; do
  [ -e "$f" ] || continue
  echo "LISTEN 0 512 *:8888 *:* users:((\"bun\",pid=$(cat "${f%.listen}.pid"),fd=13))"
done
EOF
chmod +x "$TMP/bin"/*

# run_case <dir> <standby listens 0|1> <live listens 0|1>: prints the handoff
# log to <dir>/out, pm2 calls to <dir>/calls, rc to <dir>/rc.
run_case() {
  local d=$1
  mkdir -p "$d"
  echo 100 > "$d/infiniterealms-bun.pid"
  touch "$d/infiniterealms-bun.listen"
  (
    export PATH="$TMP/bin:$PATH" ZD_STATE=$d ZD_STANDBY_LISTENS=$2 ZD_LIVE_LISTENS=$3
    set +e
    ts() { echo "[t]"; }
    run() { "$@"; }
    sleep() { :; }
    DRY_RUN=0
    PWD_REPO=$TMP
    # shellcheck disable=SC1091
    . "$TMP/handoff.sh"
    HANDOFF_WAIT_SECONDS=3
    zero_downtime_restart > "$d/out" 2>&1
    echo $? > "$d/rc"
  )
}
# order <file> <pattern>...: the patterns appear as lines in this order.
order() {
  local f=$1 n=0 line
  shift
  while IFS= read -r line; do
    [ $# -gt 0 ] || break
    if grep -qE -- "$1" <<< "$line"; then
      shift
    fi
    n=$((n + 1))
  done < "$f"
  [ $# -eq 0 ]
}

# (a) happy path
A="$TMP/a"
run_case "$A" 1 1
expect "happy: exit 0" grep -qx 0 "$A/rc"
expect "happy: start standby, restart live, delete standby, in that order" \
  order "$A/calls" '^pm2 start .*--only infiniterealms-bun-standby' '^pm2 restart infiniterealms-bun$' '^pm2 delete infiniterealms-bun-standby$'
expect "happy: standby is not deleted until the live app restarted" \
  bash -c "! sed -n '/^pm2 start /,/^pm2 restart infiniterealms-bun\$/p' '$A/calls' | grep -q '^pm2 delete'"
expect "happy: two standby deletes (stale cleanup before start, stop after the live restart)" test "$(grep -c '^pm2 delete infiniterealms-bun-standby$' "$A/calls")" = 2
expect "happy: standby listening logged before the live restart" grep -q 'standby (pid 200) is serving :8888' "$A/out"
expect "happy: live listening again logged" grep -q 'infiniterealms-bun (pid 101) is serving :8888; infiniterealms-bun-standby stopped' "$A/out"
expect "happy: standby gone afterwards" test ! -e "$A/infiniterealms-bun-standby.pid"
expect "happy: no extra-listener warning" bash -c "! grep -q WARNING '$A/out'"

# (b) standby never listens -> plain restart
B="$TMP/b"
run_case "$B" 0 1
expect "standby never listens: exit 0" grep -qx 0 "$B/rc"
expect "standby never listens: says plain restart" grep -q 'did not listen on :8888 within 3s — plain restart' "$B/out"
expect "standby never listens: pm2 start output logged" grep -q 'pm2 start: \[PM2\] App \[infiniterealms-bun-standby\] launched' "$B/out"
expect "standby never listens: standby deleted, then live restarted" \
  order "$B/calls" '^pm2 start ' '^pm2 delete infiniterealms-bun-standby$' '^pm2 restart infiniterealms-bun$'
expect "standby never listens: standby gone" test ! -e "$B/infiniterealms-bun-standby.pid"

# (c) live never listens again -> standby kept, exit 1
C="$TMP/c"
run_case "$C" 1 0
expect "live never returns: exit 1" grep -qx 1 "$C/rc"
expect "live never returns: says standby LEFT serving" grep -q 'infiniterealms-bun did not listen again within 3s — infiniterealms-bun-standby (pid 200) LEFT serving' "$C/out"
expect "live never returns: standby not deleted after the restart" \
  bash -c "! sed -n '/^pm2 restart infiniterealms-bun\$/,\$p' '$C/calls' | grep -q '^pm2 delete'"
expect "live never returns: standby still online" test -e "$C/infiniterealms-bun-standby.pid"

echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
