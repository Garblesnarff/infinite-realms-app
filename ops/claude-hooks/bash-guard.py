#!/usr/bin/env python3
"""Claude Code PreToolUse guard for Bash on the production box.

On 2026-10-14 at 06:02Z a Claude session wrote a PR body inside an unquoted
heredoc. Bash ran a markdown code span from it, `kill -TERM -1`, as root and
SIGTERMed every process on the host (#230). This hook refuses that class of
command before it runs.

Blocks (exit 2, reason on stderr, which Claude Code shows to the model):
  - kill with -1 as a pid, a bare `kill -1`, and killall5
  - pkill with no process name, or with a match-everything pattern
  - reboot / shutdown / poweroff / halt, init or telinit 0|6, and systemctl
    reboot, poweroff, halt, kexec, soft-reboot, isolate, rescue, emergency
  - systemctl or service stop / restart / kill of nginx, pm2* or docker /
    containerd, and `pm2 kill`, unless the command carries CONFIRM_DANGEROUS=1
  - recursive rm of /, /var or /etc, and any --no-preserve-root
  - unquoted heredocs (<<EOF). Use <<'EOF', or write the text to a file.

Reads the hook JSON on stdin. Allows (exit 0) anything that is not a Bash
call, or that it cannot parse. Stdlib only.
"""
import json
import os
import re
import shlex
import sys

CONFIRM = "CONFIRM_DANGEROUS=1"
PROTECTED_UNIT = re.compile(r"^(nginx|pm2[\w@.-]*|docker|containerd)(\.(service|socket))?$")
WRAPPERS = {"sudo", "env", "nohup", "exec", "time", "nice", "ionice", "setsid",
            "command", "builtin", "stdbuf", "xargs", "watch", "doas"}
# pkill/pgrep options that take a value: the next token is not a pattern.
PKILL_ARG_OPTS = {"-g", "-G", "-P", "-s", "-t", "-u", "-U", "-F", "--signal",
                  "--pgroup", "--group", "--parent", "--session", "--terminal",
                  "--euid", "--uid", "--pidfile", "--ns", "--nslist"}
MATCH_ALL = {"", ".", ".*", "^", "$", ".+", "^.*$"}
SEPARATORS = {";", "&&", "||", "|", "&", "(", ")", "|&", ";;"}


def tokenize(cmd):
    # Newlines, $( and backticks start new commands. Inside quotes the
    # replacement stays inside one token, so quoted text is not split.
    text = cmd.replace("\n", " ; ").replace("$(", " ; ").replace("`", " ; ")
    try:
        lex = shlex.shlex(text, posix=True, punctuation_chars=";&|()")
        lex.whitespace_split = True
        return list(lex)
    except ValueError:
        toks = re.findall(r"""'[^']*'?|"(?:\\.|[^"\\])*"?|[;&|()]+|[^\s;&|()'"]+""", text)
        return [t.strip("'\"") for t in toks]


def segments(tokens):
    seg = []
    for t in tokens:
        if t in SEPARATORS or (t and set(t) <= set(";&|()")):
            if seg:
                yield seg
            seg = []
        else:
            seg.append(t)
    if seg:
        yield seg


def unwrap(seg):
    """Drop VAR=val prefixes and wrappers. Returns (argv, confirmed)."""
    confirmed = False
    i = 0
    while i < len(seg):
        t = seg[i]
        if re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", t):
            confirmed |= t == CONFIRM
            i += 1
        elif os.path.basename(t) in WRAPPERS:
            i += 1
            while i < len(seg) and seg[i].startswith("-"):
                i += 1
        elif os.path.basename(t) == "timeout":
            i += 1
            while i < len(seg) and seg[i].startswith("-"):
                i += 1
            i += 1  # the duration
        else:
            break
    return seg[i:], confirmed


def check_kill(args):
    if args == ["-1"]:
        return "bare `kill -1`"
    i = 0
    if args and args[0] in ("-s", "-n", "--signal"):
        i = 2
    elif args and (args[0].startswith("--signal=") or re.fullmatch(r"-[A-Za-z0-9+]+", args[0])):
        i = 1
    if i < len(args) and args[i] == "--":
        i += 1
    if "-1" in args[i:]:
        return "`kill` with pid -1 signals every process on the host"
    return None


def check_pkill(args):
    patterns = []
    i = 0
    while i < len(args):
        a = args[i]
        if a == "--":
            patterns.extend(args[i + 1:])
            break
        if a in PKILL_ARG_OPTS:
            i += 2
            continue
        if a.startswith("-") and a != "-":
            i += 1
            continue
        patterns.append(a)
        i += 1
    if not patterns:
        return "`pkill` without a process name matches every process the filters allow"
    if any(p in MATCH_ALL for p in patterns):
        return "`pkill` with a match-everything pattern"
    return None


def check_rm(args):
    flags = "".join(a[1:] for a in args if a.startswith("-") and not a.startswith("--"))
    longs = {a for a in args if a.startswith("--")}
    if "--no-preserve-root" in longs:
        return "`rm --no-preserve-root`"
    if not ("r" in flags or "R" in flags or "--recursive" in longs):
        return None
    for a in args:
        if a.startswith("-"):
            continue
        base = a[:-2] if a.endswith("/*") else a
        if base == "" or os.path.normpath(base) in ("/", "/var", "/etc", "//"):
            return f"recursive `rm` of {a}"
    return None


def check_service(argv, confirmed):
    cmd = os.path.basename(argv[0])
    args = [a for a in argv[1:] if not a.startswith("-")]
    if cmd == "systemctl" and args:
        verb = args[0]
        if verb in ("reboot", "poweroff", "halt", "kexec", "soft-reboot",
                    "isolate", "rescue", "emergency"):
            return f"`systemctl {verb}`"
        if verb in ("stop", "restart", "kill", "try-restart", "reload-or-restart",
                    "condrestart", "force-reload"):
            units = [u for u in args[1:] if PROTECTED_UNIT.match(u)]
            if units and not confirmed:
                return f"`systemctl {verb}` of {', '.join(units)} without {CONFIRM}"
    if cmd == "service" and len(args) >= 2 and PROTECTED_UNIT.match(args[0]):
        if args[1] in ("stop", "restart", "force-reload") and not confirmed:
            return f"`service {args[0]} {args[1]}` without {CONFIRM}"
    if cmd == "pm2" and args[:1] == ["kill"] and not confirmed:
        return f"`pm2 kill` (stops the whole pm2 daemon) without {CONFIRM}"
    return None


def check_argv(argv, confirmed, depth=0):
    if not argv:
        return None
    cmd = os.path.basename(argv[0])
    args = argv[1:]
    if cmd in ("bash", "sh", "zsh", "dash") and "-c" in args and depth < 3:
        j = args.index("-c")
        if j + 1 < len(args):
            return check_command(args[j + 1], depth + 1)
    if cmd == "eval" and depth < 3:
        return check_command(" ".join(args), depth + 1)
    if cmd == "kill":
        return check_kill(args)
    if cmd == "killall5":
        return "`killall5` signals every process on the host"
    if cmd == "pkill":
        return check_pkill(args)
    if cmd in ("reboot", "shutdown", "poweroff", "halt"):
        return f"`{cmd}`"
    if cmd in ("init", "telinit") and args[:1] in (["0"], ["6"]):
        return f"`{cmd} {args[0]}`"
    if cmd == "rm":
        return check_rm(args)
    return check_service(argv, confirmed)


def unquoted_heredoc(cmd):
    # Arithmetic shifts like $((1<<3)) are not heredocs.
    text = re.sub(r"\$?\(\([^()]*\)\)", "", cmd)
    m = re.search(r"(?<!<)<<(?!<)-?[ \t]*([A-Za-z_][A-Za-z0-9_]*)", text)
    return m.group(1) if m else None


def check_command(cmd, depth=0):
    delim = unquoted_heredoc(cmd)
    if delim:
        return (f"unquoted heredoc <<{delim}: bash runs every `backtick` and $(...) "
                f"in its body. Quote it (<<'{delim}') or write the text to a file "
                f"and pass it with --body-file")
    for seg in segments(tokenize(cmd)):
        argv, confirmed = unwrap(seg)
        reason = check_argv(argv, confirmed, depth)
        if reason:
            return reason
    return None


def main():
    try:
        event = json.load(sys.stdin)
    except (ValueError, OSError):
        return 0
    if event.get("tool_name") != "Bash":
        return 0
    cmd = (event.get("tool_input") or {}).get("command")
    if not isinstance(cmd, str):
        return 0
    reason = check_command(cmd)
    if reason:
        print(f"BLOCKED by bash-guard (#230 06:02Z incident): {reason}. "
              "If this is really needed, ask Rob to run it himself.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
