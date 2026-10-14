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

expect block 'cat <<123
x
123'
expect block 'cat <<.EOF
x
.EOF'
expect allow 'cat <<E"OF"
x
EOF'

# 1. $(...) and backticks inside double quotes run; inside single quotes
#    or escaped they do not
expect block 'gh pr create --body "Run `kill -TERM -1` to reproduce"'
expect block 'echo "$(kill -TERM -1)"'
expect block 'git commit -m "x $(reboot)"'
expect block 'echo "a $(echo "b $(kill -9 -1)")"'
expect block 'echo "$(( $(kill -9 -1) + 1 ))"'
expect block 'echo `echo "\`reboot\`"`'
expect allow 'git commit -m "fix: escaped \`kill -TERM -1\` text"'
expect allow "echo 'single quoted \`kill -TERM -1\` and \$(reboot)'"
expect allow "echo \"it's \$(date)\""
expect allow 'echo "$(( 2 << 1 ))"'
expect allow "cat <<'EOF'
Never run kill -TERM -1 here; \$(date) and \`x\` stay text.
EOF"
expect allow "python3 - <<'EOF'
s = 'cat << EOF'
EOF"
# A quoted heredoc body can feed a shell (bash <<'EOF'), so a dangerous
# command at the start of a body line, or of a code span, is still refused.
expect block "bash <<'EOF'
kill -9 -1
EOF"
expect block "cat <<'EOF' | sudo sh
if true; then reboot; fi
EOF"
expect allow "python3 - <<'EOF'
note = '''If it hangs, then systemctl restart docker, or run \`kill -TERM -1\`.'''
EOF"

# 2. -c inside a short-flag cluster, and su -c
expect block 'bash -lc "kill -9 -1"'
expect block 'bash -ic "reboot"'
expect block 'sh -xc reboot'
expect block 'bash -euo pipefail -c "kill -9 -1"'
expect block 'su -c "kill -9 -1"'
expect block 'su - root -c reboot'
expect block 'su -lc reboot'
expect block 'su --command="kill -9 -1"'
expect block 'runuser -u root -- bash -c reboot'
expect allow 'bash -lc "echo hi"'
expect allow 'bash -x ops/tests/claude-bash-guard.sh'
expect allow 'su -s /bin/bash foreman'

# 3. wrapper flags that take a value
expect block 'sudo -u root kill -9 -1'
expect block 'nice -n 5 kill -9 -1'
expect block 'timeout -s KILL 5 kill -9 -1'
expect block 'timeout -- 5 reboot'
expect block 'env -u X kill -9 -1'
expect block 'ionice -c 3 kill -9 -1'
expect block 'env -S "kill -9 -1"'
expect block 'watch -n 5 "kill -9 -1"'
expect block 'xargs -n 1 kill -9 -1 < pids'
expect allow 'sudo -u postgres psql -c "select 1"'
expect allow 'nice -n 10 bun run build'
expect allow 'timeout -k 30 600 bun test'
expect allow 'command -v reboot'

# 4. shell keywords before a command
expect block 'if true; then kill -9 -1; fi'
expect block 'for i in 1; do reboot; done'
expect block '{ kill -9 -1; }'
expect block '! kill -9 -1'
expect block 'while true; do reboot; done'
expect block 'until false; do kill -9 -1; done'
expect block 'if false; then :; else reboot; fi'
expect allow 'if true; then echo ok; fi'
expect allow 'for f in a b; do echo "$f"; done'

# 5. rm of /root and other system dirs; pm2 stop|delete all
expect block 'rm -rf /root'
expect block 'rm -rf /root/'
expect block 'rm -rf /root/*'
expect block 'rm -rf /home'
expect block 'rm -rf /usr'
expect block 'rm -rf /boot'
expect block 'rm -rf ~'
expect block 'rm -rf $HOME'
expect block 'rm -rf /var/www'
expect block 'pm2 delete all'
expect block 'pm2 stop all'
expect block 'pm2 stop "all"'
expect allow 'CONFIRM_DANGEROUS=1 pm2 stop all'
expect allow 'pm2 stop eco'
expect allow 'rm -rf /root/scratch/x'
expect allow 'rm -rf /var/www/infiniterealms/worktrees/issue-1'

# more stop paths
expect block 'nginx -s stop'
expect block 'nginx -s quit'
expect block '/etc/init.d/nginx stop'
expect block 'invoke-rc.d docker restart'
expect block 'docker stop $(docker ps -q)'
expect block 'docker kill "$(docker ps -q)"'
expect allow 'nginx -s reload'
expect allow 'nginx -t'
expect allow 'docker stop realms-foreman-runner'
expect allow 'CONFIRM_DANGEROUS=1 nginx -s stop'

# 7. extra cases
expect block 'init 0'
expect block 'kill -KILL -1'
expect block 'kill -0 -1'
expect block 'pkill -1'
expect block 'eval eval eval eval eval eval eval echo hi'

# 6. not Bash: allow. Unreadable payload or a non-string command: block
# (fail closed)
feed() {
  local want=$1 payload=$2 rc=0
  printf '%s' "$payload" | python3 "$GUARD" 2>/dev/null || rc=$?
  if [ "$rc" -eq "$want" ]; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); echo "FAIL: want rc=$want, got rc=$rc: $payload"; fi
}
feed 0 '{"tool_name":"Write","tool_input":{"file_path":"/x","content":"kill -9 -1"}}'
feed 2 'not json'
feed 2 ''
feed 2 '[]'
feed 2 '{"tool_name":"Bash","tool_input":{"command":5}}'
feed 2 '{"tool_name":"Bash","tool_input":"kill -9 -1"}'
feed 2 '{"tool_name":"Bash"}'

echo "claude-bash-guard: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
