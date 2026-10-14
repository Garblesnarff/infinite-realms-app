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
  - systemctl, service, invoke-rc.d or /etc/init.d stop / restart / kill of
    nginx, pm2* or docker / containerd, `nginx -s stop|quit`, `pm2 kill`,
    `pm2 stop|delete all`, and `docker stop|kill|rm $(docker ps ...)`, unless
    the command carries CONFIRM_DANGEROUS=1
  - recursive rm of /, /root, /home, /etc, /usr, /var and the other top-level
    system directories (or `/*` under them), ~ and $HOME, and any
    --no-preserve-root
  - unquoted heredocs (<<EOF, <<123). Use <<'EOF', or write the text to a file.
  - nesting (bash -c, eval, $(...), backticks) deeper than MAX_DEPTH

It checks the bodies of $(...) and backtick spans wherever bash would run
them, including inside double quotes, and looks behind wrappers (sudo, env,
nice, timeout, ...) with their value flags, shell keywords (if, then, do, {,
!) and `bash -lc` / `su -c` style flag clusters.

Reads the hook JSON on stdin. Allows (exit 0) a call that is not Bash. Fails
closed (exit 2) on an unreadable payload, a non-string command, or any error
while checking a Bash command. Stdlib only.
"""
import json
import os
import re
import shlex
import sys

CONFIRM = "CONFIRM_DANGEROUS=1"
MAX_DEPTH = 5
PROTECTED_UNIT = re.compile(r"^(nginx|pm2[\w@.-]*|docker|containerd)(\.(service|socket))?$")
# Wrapper commands and their options that take a value (the next token is
# the value, not the command).
WRAPPERS = {
    "sudo": {"-u", "-g", "-p", "-C", "-D", "-h", "-r", "-t", "-T", "-U", "-R",
             "--user", "--group", "--prompt", "--close-from", "--chdir", "--host",
             "--role", "--type", "--command-timeout", "--other-user", "--chroot"},
    "doas": {"-u", "-C"},
    "env": {"-u", "-C", "--unset", "--chdir"},
    "nice": {"-n", "--adjustment"},
    "ionice": {"-c", "-n", "-p", "-P", "-u", "--class", "--classdata", "--pid",
               "--pgid", "--uid"},
    "timeout": {"-s", "-k", "--signal", "--kill-after"},
    "stdbuf": {"-i", "-o", "-e", "--input", "--output", "--error"},
    "xargs": {"-a", "-d", "-E", "-I", "-L", "-n", "-P", "-s", "--arg-file",
              "--delimiter", "--eof", "--replace", "--max-lines", "--max-args",
              "--max-procs", "--max-chars", "--process-slot-var"},
    "watch": {"-n", "--interval"},
    "exec": {"-a"},
    "time": {"-f", "-o", "--format", "--output"},
    "nohup": set(), "setsid": set(), "command": set(), "builtin": set(),
}
# Shell keywords that can stand in front of a command.
KEYWORDS = {"{", "!", "if", "then", "do", "else", "elif", "while", "until"}
SHELLS = {"bash", "sh", "zsh", "dash", "ksh", "mksh"}
# Commands that run a heredoc body as shell code.
SHELL_FEEDERS = SHELLS | {"su", "runuser", "ssh", "source", ".", "eval"}
# Shell options that take a value.
SHELL_ARG_OPTS = {"-o", "+o", "-O", "+O", "--rcfile", "--init-file"}
# pkill/pgrep options that take a value: the next token is not a pattern.
PKILL_ARG_OPTS = {"-g", "-G", "-P", "-s", "-t", "-u", "-U", "-F", "--signal",
                  "--pgroup", "--group", "--parent", "--session", "--terminal",
                  "--euid", "--uid", "--pidfile", "--ns", "--nslist"}
MATCH_ALL = {"", ".", ".*", "^", "$", ".+", "^.*$"}
SEPARATORS = {";", "&&", "||", "|", "&", "(", ")", "|&", ";;"}
RM_PROTECTED = {"/", "//", "/bin", "/boot", "/etc", "/home", "/lib", "/lib64",
                "/opt", "/root", "/sbin", "/srv", "/usr", "/var", "/var/lib",
                "/var/www", "/var/www/infiniterealms",
                "~", "$HOME", "${HOME}"}
DOCKER_MASS = re.compile(r"\bdocker\s+(container\s+)?(stop|kill|restart|rm)\b[^;&|\n]*"
                         r"(\$\(|`)\s*docker\s+(container\s+)?(ps|ls)\b")


def tokenize(cmd):
    # Newlines, $( and backticks start new commands. Inside quotes the
    # replacement stays inside one token, so quoted text is not split;
    # subst_spans() checks those bodies separately.
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


def _scan(s, i, closer):
    """Walk shell text from i and return (spans, end).

    spans are the bodies of $(...) and `...` that bash would run: outside
    single quotes, not backslash-escaped, inside or outside double quotes.
    With closer=")" the walk stops after the matching close paren. Nested
    spans are found when the caller checks each body in turn.
    """
    spans = []
    dq = False
    depth = 0
    n = len(s)
    while i < n:
        c = s[i]
        if c == "\\":
            i += 2
            continue
        if c == "'" and not dq:
            j = s.find("'", i + 1)
            i = n if j < 0 else j + 1
            continue
        if c == '"':
            dq = not dq
            i += 1
            continue
        if s.startswith("$((", i):
            # Arithmetic: not a command, but $(...) inside it still runs.
            inner, i = _scan(s, i + 2, ")")
            spans.extend(inner)
            continue
        if s.startswith("$(", i):
            _, j = _scan(s, i + 2, ")")
            spans.append(s[i + 2:j - 1] if j <= n and s[j - 1:j] == ")" else s[i + 2:])
            i = j
            continue
        if c == "`":
            j = i + 1
            while j < n and s[j] != "`":
                j += 2 if s[j] == "\\" else 1
            # Inside backticks, \` is a nested backtick and \\ a backslash.
            spans.append(s[i + 1:j].replace("\\\\", "\\").replace("\\`", "`"))
            i = j + 1
            continue
        if closer == ")" and not dq:
            if c == "(":
                depth += 1
            elif c == ")":
                if depth == 0:
                    return spans, i + 1
                depth -= 1
        i += 1
    return spans, n


def feeds_shell(line):
    words = re.split(r"[\s;&|()]+", line)
    return any(os.path.basename(w) in SHELL_FEEDERS for w in words)


def strip_quoted_heredoc_bodies(cmd):
    # Bash does not expand the body of <<'EOF', <<"EOF" or <<\EOF, so it is
    # text (a PR body, a python script), not commands. Keep the body when the
    # line hands it to a shell (bash <<'EOF', cat <<'EOF' | sh): then every
    # line of it runs.
    out, pending = [], []
    for line in cmd.split("\n"):
        if pending:
            delim, dash, keep = pending[0]
            if (line.lstrip("\t") if dash else line) == delim:
                pending.pop(0)
            elif keep:
                out.append(line)
            continue
        out.append(line)
        for m in re.finditer(r"<<(-?)[ \t]*(?:'([^']*)'|\"([^\"]*)\"|\\(\w+))", line):
            pending.append((m.group(2) or m.group(3) or m.group(4) or "",
                            m.group(1) == "-", feeds_shell(line)))
    return "\n".join(out)


def subst_spans(text):
    return _scan(text, 0, None)[0]


def unwrap(seg):
    """Drop VAR=val prefixes, keywords and wrappers. Returns (argv, confirmed)."""
    confirmed = False
    i = 0
    while i < len(seg):
        t = seg[i]
        name = os.path.basename(t)
        if re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", t):
            confirmed |= t == CONFIRM
            i += 1
        elif t in KEYWORDS:
            i += 1
        elif name in WRAPPERS:
            value_opts = WRAPPERS[name]
            resplit = False
            i += 1
            while i < len(seg) and seg[i].startswith("-") and seg[i] != "-":
                opt = seg[i]
                if opt == "--":
                    i += 1
                    break
                if name == "command" and opt in ("-v", "-V"):
                    return [], confirmed  # a lookup, not a run
                if name == "env" and opt.startswith(("-S", "--split-string")):
                    # env -S "cmd args": the value is itself a command line.
                    if opt in ("-S", "--split-string"):
                        value, rest = (seg[i + 1] if i + 1 < len(seg) else ""), seg[i + 2:]
                    elif opt.startswith("--split-string="):
                        value, rest = opt.split("=", 1)[1], seg[i + 1:]
                    else:
                        value, rest = opt[2:], seg[i + 1:]
                    seg, i, resplit = tokenize(value) + rest, 0, True
                    break
                i += 2 if opt in value_opts else 1
            if name == "timeout" and not resplit and i < len(seg):
                i += 1  # the duration
        else:
            break
    return seg[i:], confirmed


def shell_c_string(args):
    """The command string of `bash -c`, `bash -lc`, `sh -xc` ..., or None."""
    has_c = False
    i = 0
    while i < len(args):
        a = args[i]
        if a == "--":
            i += 1
            break
        if a in SHELL_ARG_OPTS:
            i += 2
            continue
        if re.fullmatch(r"[-+][A-Za-z]+", a):
            has_c |= a[0] == "-" and "c" in a
            # -o / -O in a cluster take the next token as their value.
            i += 2 if ("o" in a[1:] or "O" in a[1:]) else 1
            continue
        if a.startswith("--"):
            i += 1
            continue
        break
    if has_c and i < len(args):
        return args[i]
    return None


def su_c_string(args):
    """The command string of `su -c`, `su -lc`, `su --command=` ..., or None."""
    for i, a in enumerate(args):
        if a in ("--command", "--session-command"):
            return args[i + 1] if i + 1 < len(args) else None
        if a.startswith(("--command=", "--session-command=")):
            return a.split("=", 1)[1]
        if re.fullmatch(r"-[A-Za-z]+", a):
            for k, ch in enumerate(a[1:], start=1):
                if ch in "sgGw":  # value flags: the rest is their value
                    break
                if ch == "c":
                    rest = a[k + 1:]
                    if rest:
                        return rest
                    return args[i + 1] if i + 1 < len(args) else None
    return None


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
        if base == "" or os.path.normpath(base) in RM_PROTECTED:
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
    if confirmed:
        return None
    if cmd in ("service", "invoke-rc.d") and len(args) >= 2 and PROTECTED_UNIT.match(args[0]):
        if args[1] in ("stop", "restart", "force-reload"):
            return f"`{cmd} {args[0]} {args[1]}` without {CONFIRM}"
    if argv[0].startswith("/etc/init.d/") and PROTECTED_UNIT.match(cmd) and \
            args[:1] and args[0] in ("stop", "restart", "force-reload"):
        return f"`{argv[0]} {args[0]}` without {CONFIRM}"
    if cmd == "nginx":
        for k, a in enumerate(argv[1:], start=1):
            sig = argv[k + 1] if a == "-s" and k + 1 < len(argv) else (a[2:] if a.startswith("-s") else "")
            if sig in ("stop", "quit"):
                return f"`nginx -s {sig}` without {CONFIRM}"
    if cmd == "pm2":
        if args[:1] == ["kill"]:
            return f"`pm2 kill` (stops the whole pm2 daemon) without {CONFIRM}"
        if args[:1] and args[0] in ("stop", "delete", "del") and "all" in args[1:]:
            return f"`pm2 {args[0]} all` without {CONFIRM}"
    return None


def check_argv(argv, confirmed, depth):
    if not argv:
        return None
    if re.search(r"\s", argv[0]):
        # A whole command passed as one word, e.g. watch -n 5 "kill -9 -1".
        return check_command(" ".join(argv), depth + 1)
    cmd = os.path.basename(argv[0])
    args = argv[1:]
    if cmd in SHELLS:
        inner = shell_c_string(args)
        if inner is not None:
            return check_command(inner, depth + 1)
    if cmd in ("su", "runuser"):
        inner = su_c_string(args)
        if inner is not None:
            return check_command(inner, depth + 1)
    if cmd == "eval":
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
    # Arithmetic shifts like $((1<<3)) are not heredocs, and text inside a
    # quoted heredoc body is not parsed by this shell.
    text = re.sub(r"\$?\(\([^()]*\)\)", "", strip_quoted_heredoc_bodies(cmd))
    # Any delimiter word with no quote or backslash in it, ending at a
    # word boundary: <<EOF, << EOF, <<-EOF, <<123, <<.EOF.
    m = re.search(r"(?<!<)<<(?!<)-?[ \t]*([^\s'\"\\;&|()<>]+)(?=[\s;&|()<>]|$)", text)
    return m.group(1) if m else None


def check_command(cmd, depth=0):
    if depth > MAX_DEPTH:
        return f"nesting (bash -c, eval, $(...), backticks) deeper than {MAX_DEPTH} levels"
    delim = unquoted_heredoc(cmd)
    cmd = strip_quoted_heredoc_bodies(cmd)
    if delim:
        return (f"unquoted heredoc <<{delim}: bash runs every `backtick` and $(...) "
                f"in its body. Quote it (<<'{delim}') or write the text to a file "
                f"and pass it with --body-file")
    if DOCKER_MASS.search(cmd) and CONFIRM not in cmd:
        return f"`docker stop|kill|rm` of every container from `docker ps` without {CONFIRM}"
    for span in subst_spans(cmd):
        reason = check_command(span, depth + 1)
        if reason:
            return f"inside $(...) or backticks: {reason}"
    for seg in segments(tokenize(cmd)):
        argv, confirmed = unwrap(seg)
        reason = check_argv(argv, confirmed, depth)
        if reason:
            return reason
    return None


def block(reason):
    print(f"BLOCKED by bash-guard (#230 06:02Z incident): {reason}. "
          "If this is really needed, ask Rob to run it himself.", file=sys.stderr)
    return 2


def main():
    try:
        event = json.load(sys.stdin)
        if not isinstance(event, dict):
            raise ValueError("payload is not an object")
    except Exception:
        return block("unreadable hook payload; failing closed")
    if event.get("tool_name") != "Bash":
        return 0
    try:
        cmd = (event.get("tool_input") or {}).get("command")
        if not isinstance(cmd, str):
            return block("Bash command is not a string; failing closed")
        reason = check_command(cmd)
    except Exception as e:  # includes RecursionError
        return block(f"guard error ({type(e).__name__}); failing closed")
    return block(reason) if reason else 0


if __name__ == "__main__":
    sys.exit(main())
