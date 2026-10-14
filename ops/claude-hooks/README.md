# Claude Code Bash guard (#230, 2026-10-14 06:02Z)

A `PreToolUse` hook for Claude Code sessions on the production box. It blocks Bash commands that can take the whole host down before they run.

Why: at 06:02Z a session wrote a PR body inside an unquoted heredoc. Bash ran a markdown code span from that body, `kill -TERM -1`, as root. Every process got SIGTERM, and nginx, pm2 and cron stayed down for 31 minutes. Postmortem on #230.

| Blocked | Notes |
|---|---|
| `kill` with pid `-1`, bare `kill -1`, `killall5` | `kill -1 <pid>` (SIGHUP to one pid) is allowed |
| `pkill` with no process name, or a match-everything pattern (`.`, `.*`) | `pkill -u root` with no name kills every root process |
| `reboot`, `shutdown`, `poweroff`, `halt`, `init 0/6`, `systemctl reboot / poweroff / halt / kexec / soft-reboot / isolate / rescue / emergency` | |
| `systemctl`, `service`, `invoke-rc.d` or `/etc/init.d/…` `stop / restart / kill` of nginx, pm2\*, docker or containerd; `nginx -s stop / quit`; `pm2 kill`; `pm2 stop / delete all`; `docker stop / kill / rm $(docker ps …)` | allowed with a `CONFIRM_DANGEROUS=1` prefix; `start` and `reload` are always allowed |
| recursive `rm` of `/`, `/root`, `/home`, `/etc`, `/usr`, `/boot`, `/var`, `/var/lib`, `/var/www`, the other top-level system dirs (or `/*` under them), `~` and `$HOME`, and any `--no-preserve-root` | `rm -rf /var/www/<dir>/<sub>` and `rm -rf /root/<dir>` are allowed |
| unquoted heredocs: `<<EOF`, `<< EOF`, `<<-EOF`, `<<123`, `<<.EOF` | use `<<'EOF'`, or write the text with the Write tool and pass `--body-file` |
| nesting (`bash -c`, `eval`, `$(…)`, backticks) deeper than 5 levels | |

It also checks:

- the body of every `$(…)` and backtick span that bash would run, including inside double quotes (`--body "Run \`kill -TERM -1\`"` is refused). Single-quoted and backslash-escaped spans are text.
- inside `bash -c`, `bash -lc`, `sh -xc` (any short-flag cluster with `c`), `su -c` / `su --command`, `eval`, `env -S`, and a command passed as one word (`watch -n 5 "…"`).
- after `;`, `&&`, `|`, newlines and shell keywords (`if`, `then`, `do`, `else`, `elif`, `while`, `until`, `{`, `!`).
- behind `sudo`, `doas`, `env`, `nice`, `ionice`, `timeout`, `stdbuf`, `xargs`, `watch`, `nohup`, `setsid`, `exec`, `time` and `VAR=value` prefixes, skipping the values of their options (`sudo -u root`, `nice -n 5`, `timeout -s KILL 5`).

The body of a quoted heredoc (`<<'EOF'`) is text and is not checked, unless the same line hands it to a shell (`bash <<'EOF'`, `cat <<'EOF' | sh`). Elsewhere the guard is strict about prose: a dangerous command as a word after a separator or keyword is refused. That matches the standing rule to keep prose out of shell commands and use `--body-file`.

`CONFIRM_DANGEROUS=1` is a speed bump, not a gate: the model can type it too. It makes the dangerous step deliberate and visible in the transcript.

Out of scope: a determined bypass (for example base64-decoded commands, or `python3 -c "import os; os.kill(-1, 15)"`). This is a seatbelt against mistakes, not a sandbox. Rob's own shell, and `!` commands typed in the Claude Code prompt, do not go through the hook.

## Test

```
bash ops/tests/claude-bash-guard.sh
```

The guard is stdlib python3. A blocked command exits 2 with the reason on stderr, which Claude Code shows to the model. A call that isn't Bash is allowed. It fails closed: an unreadable payload, a Bash call whose command isn't a string, or any error inside the checks exits 2.

It cannot fail closed when it never runs: if `python3` or the script file is missing, Claude Code reports a hook error and the command goes through. Re-run the verify step below after any python or settings change.

## Install (only after a strategist PASS and Rob's typed approval)

```
install -d /root/.claude/hooks
install -m 755 ops/claude-hooks/bash-guard.py /root/.claude/hooks/bash-guard.py
```

Then add this entry under `hooks` in `/root/.claude/settings.json`, next to the existing `PostToolUse` / `Stop` entries:

```json
"PreToolUse": [
  {
    "matcher": "Bash",
    "hooks": [
      { "type": "command", "command": "/root/.claude/hooks/bash-guard.py", "timeout": 10 }
    ]
  }
]
```

Running sessions pick up settings changes on their next start.

Verify, in this order:

1. Offline, nothing runs: `printf '%s' '{"tool_name":"Bash","tool_input":{"command":"kill -TERM -1"}}' | /root/.claude/hooks/bash-guard.py; echo rc=$?` prints the BLOCKED reason and `rc=2`.
2. In a new Claude Code session (started after the settings change), ask it to run `kill -0 -1`. It must come back `BLOCKED by bash-guard`. Use signal 0, never `-TERM`: the guard blocks both the same way (pid -1), but if the hook is not firing, `kill -0 -1` only checks permissions and signals nothing.

To roll back, delete the `PreToolUse` entry.
