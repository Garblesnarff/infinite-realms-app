#!/usr/bin/env bash
# Cases for ops/claude-hooks/bash-guard.py, the Claude Code PreToolUse guard
# added after the 2026-10-14 06:02Z kill (#230). Each case feeds one Bash
# command as hook JSON and checks for block (exit 2) or allow (exit 0).
#
#   bash ops/tests/claude-bash-guard.sh
#
# Needs bash + python3. Runs nothing it tests.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
GUARD="$HERE/../claude-hooks/bash-guard.py"
PASS=0
FAIL=0

# expect <block|allow> <command>
expect() {
  local want=$1 cmd=$2 rc=0
  python3 -c 'import json,sys; print(json.dumps({"tool_name":"Bash","tool_input":{"command":sys.argv[1]}}))' "$cmd" \
    | python3 "$GUARD" 2>/dev/null || rc=$?
  local got=allow
  [ "$rc" -eq 2 ] && got=block
  if [ "$got" = "$want" ]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    printf 'FAIL: want %s, got %s (rc=%s): %s\n' "$want" "$got" "$rc" "$cmd"
  fi
}

# kill-all
expect block 'kill -1'
expect block 'kill -TERM -1'
expect block 'kill -9 -1'
expect block 'kill -s TERM -1'
expect block 'kill -- -1'
expect block 'kill -SIGKILL -- -1'
expect block 'echo hi; sudo kill -TERM -1'
expect block 'bash -c "kill -9 -1"'
expect block 'killall5 -15'
expect block '/sbin/killall5'
expect allow 'kill 12345'
expect allow 'kill -TERM 12345'
expect allow 'kill -1 12345'
expect allow 'kill $(pgrep -f old-worker)'
expect allow 'grep -c "kill -1" notes.txt'

# pkill
expect block 'pkill'
expect block 'pkill -9'
expect block 'pkill -u root'
expect block 'pkill -TERM -u root -t pts/0'
expect block 'pkill -f .'
expect allow 'pkill -f "bun run src/index.ts"'
expect allow 'pkill -u root bun'
expect allow 'pkill -9 node'

# reboot / shutdown
expect block 'reboot'
expect block 'sudo shutdown -r now'
expect block 'poweroff'
expect block 'systemctl reboot'
expect block 'systemctl soft-reboot'
expect block 'systemctl isolate rescue.target'
expect block 'init 6'
expect allow 'systemctl status nginx'
expect allow 'last reboot | head'

# systemctl / service / pm2
expect block 'systemctl restart nginx'
expect block 'systemctl stop pm2-root'
expect block 'systemctl stop docker.service'
expect block 'systemctl restart nginx.service cron'
expect block 'service nginx stop'
expect block 'pm2 kill'
expect allow 'CONFIRM_DANGEROUS=1 systemctl restart nginx'
expect allow 'CONFIRM_DANGEROUS=1 pm2 kill'
expect allow 'systemctl reload nginx'
expect allow 'systemctl start nginx'
expect allow 'systemctl restart cron'
expect allow 'pm2 restart infiniterealms-bun'

# rm
expect block 'rm -rf /'
expect block 'rm -rf /*'
expect block 'rm -fr /var'
expect block 'rm -r -f /etc/'
expect block 'rm --recursive --force /var/*'
expect block 'rm -rf --no-preserve-root /tmp/x'
expect block 'cd /tmp && sudo rm -Rf /etc'
expect allow 'rm -rf /var/www/scratch/build'
expect allow 'rm -rf /tmp/claude-0/x'
expect allow 'rm -f /etc/logrotate.d/old.bak'

# heredocs
expect block 'python3 - <<EOF
print(1)
EOF'
expect block 'cat <<-END
x
END'
expect block 'gh pr create --body "$(cat << EOF
Run `kill -TERM -1` to reproduce.
EOF
)"'
expect allow "cat <<'EOF'
a \`b\` \$(c)
EOF"
expect allow 'cat <<"EOF"
x
EOF'
expect allow 'cat <<\EOF
x
EOF'
expect allow 'grep -c x <<< "$VAR"'
expect allow 'echo $((1<<3))'

# not Bash, or not parseable: allow
rc=0; echo '{"tool_name":"Write","tool_input":{"file_path":"/x","content":"kill -9 -1"}}' | python3 "$GUARD" || rc=$?
if [ "$rc" -eq 0 ]; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); echo "FAIL: non-Bash tool blocked"; fi
rc=0; echo 'not json' | python3 "$GUARD" || rc=$?
if [ "$rc" -eq 0 ]; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); echo "FAIL: bad JSON blocked"; fi

echo "claude-bash-guard: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
