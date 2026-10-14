# Claude Code Bash guard (#230, 2026-10-14 06:02Z)

A `PreToolUse` hook for Claude Code sessions on the production box. It blocks Bash commands that can take the whole host down before they run.

Why: at 06:02Z a session wrote a PR body inside an unquoted heredoc. Bash ran a markdown code span from that body, `kill -TERM -1`, as root. Every process got SIGTERM, and nginx, pm2 and cron stayed down for 31 minutes. Postmortem on #230.

| Blocked | Notes |
|---|---|
| `kill` with pid `-1`, bare `kill -1`, `killall5` | `kill -1 <pid>` (SIGHUP to one pid) is allowed |
| `pkill` with no process name, or a match-everything pattern (`.`, `.*`) | `pkill -u root` with no name kills every root process |
| `reboot`, `shutdown`, `poweroff`, `halt`, `init 0/6`, `systemctl reboot / poweroff / halt / kexec / soft-reboot / isolate / rescue / emergency` | |
| `systemctl` or `service` `stop / restart / kill` of nginx, pm2\*, docker or containerd, and `pm2 kill` | allowed with a `CONFIRM_DANGEROUS=1` prefix; `start` and `reload` are always allowed |
| recursive `rm` of `/`, `/var`, `/etc` (or `/*` under them), and any `--no-preserve-root` | `rm -rf /var/www/<dir>` is allowed |
| unquoted heredocs: `<<EOF`, `<< EOF`, `<<-EOF` | use `<<'EOF'`, or write the text with the Write tool and pass `--body-file` |

It also checks inside `bash -c` / `sh -c` / `eval`, after `;`, `&&`, `|`, newlines, `$(` and backticks, and behind `sudo`, `env`, `nohup`, `timeout`, `xargs` and `VAR=value` prefixes. It is strict about prose: a command whose text mentions `pkill -9` as a command word, or contains `<<EOF`, is refused. That matches the standing rule to keep prose out of shell commands.

Out of scope: a determined bypass (for example base64-decoded commands). This is a seatbelt against mistakes, not a sandbox. Rob's own shell, and `!` commands typed in the Claude Code prompt, do not go through the hook.

## Test

```
bash ops/tests/claude-bash-guard.sh
```

The guard is stdlib python3. A blocked command exits 2 with the reason on stderr, which Claude Code shows to the model. A call that isn't Bash, or a payload it can't parse, is allowed.

## Install (only after a strategist PASS and Rob's typed approval)

```
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

Running sessions pick up settings changes on their next start. To verify after installing, ask a session to run `kill -TERM -1`. It should come back `BLOCKED by bash-guard` without running.

To roll back, delete the `PreToolUse` entry.
