#!/usr/bin/env bash
# Cases for ops/prune-merged-worktrees.sh (#2365): a scratch git repo (a bare
# "origin" plus a clone) with real worktrees under both roots, and a stub `gh`
# that answers `pr list --head <branch>` from a table. Covers merged, closed and
# open PRs, no PR (old, young, commits ahead), uncommitted changes, recent
# activity, detached HEAD, locked, broken metadata, a gh failure, both roots,
# --dry-run, the log file, and an unknown flag.
#
#   bash ops/tests/prune-merged-worktrees.sh
#
# Needs bash, git and coreutils; runs under macOS bash 3.2. Touches nothing
# outside a temp dir.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$HERE/../prune-merged-worktrees.sh"
TMP=$(cd "$(mktemp -d)" && pwd -P)
trap 'rm -rf "$TMP"' EXIT

export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

pass=0
fail=0
expect() {
  local name=$1
  shift
  if "$@" > /dev/null 2>&1; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    echo "FAIL: $name"
  fi
}

# --- the stub gh: `auth status`, and `pr list --head B` from $TMP/prs ------------
# prs has lines "<branch> <STATE>[,<STATE>...]" (numbers are 100+line); a branch
# not listed has no PR; STATE "FAIL" makes gh exit 1 for that branch.
mkdir -p "$TMP/bin"
cat > "$TMP/bin/gh" << 'EOF'
#!/usr/bin/env bash
[ "$1" = auth ] && exit "${GH_AUTH_RC:-0}"
head=""
while [ $# -gt 0 ]; do
  [ "$1" = --head ] && head=$2
  shift
done
echo "gh pr list --head $head" >> "$GH_LOG"
line=$(grep -n "^$head " "$PRS" | head -n 1) || { echo "[]"; exit 0; }
n=${line%%:*}
states=${line#* }
[ "$states" = FAIL ] && exit 1
out=""
for s in $(echo "$states" | tr ',' ' '); do
  out="$out${out:+,}{\"mergedAt\":null,\"number\":$((100 + n)),\"state\":\"$s\"}"
done
echo "[$out]"
EOF
chmod +x "$TMP/bin/gh"
: > "$TMP/prs"
export GH_LOG="$TMP/gh.log" PRS="$TMP/prs"
export PATH="$TMP/bin:$PATH"

# --- a scratch origin and main clone ------------------------------------------
git init -q --bare -b main "$TMP/origin.git"
git clone -q "$TMP/origin.git" "$TMP/repo/main" 2> /dev/null
MAIN="$TMP/repo/main"
git -C "$MAIN" checkout -q -b main
echo base > "$MAIN/file.txt"
git -C "$MAIN" add file.txt
git -C "$MAIN" commit -q -m base
git -C "$MAIN" push -q origin main 2> /dev/null
mkdir -p "$MAIN/worktrees" "$TMP/repo/worktrees"
echo node_modules.bin >> "$MAIN/.git/info/exclude"
R1="$MAIN/worktrees"
R2="$TMP/repo/worktrees"

# touch_old <dir> <days>: make a worktree look untouched for that long, in every
# place the script looks (the directory, its top-level entries, the gitdir's HEAD and index).
touch_old() {
  local ts gd
  ts=$(date -v-"$2"d '+%Y%m%d%H%M' 2> /dev/null || date -d "$2 days ago" '+%Y%m%d%H%M')
  gd=$(git -C "$1" rev-parse --absolute-git-dir)
  find "$1" -maxdepth 1 -exec touch -t "$ts" {} +
  touch -t "$ts" "$gd/HEAD" "$gd/index"
}
# wt <root> <name> <branch> <state> [days]: a worktree on a new branch, with its PR state in the stub
# and an age (default 30 days, well past the 2 h and 7 d limits).
wt() {
  git -C "$MAIN" worktree add -q -b "$3" "$1/$2" origin/main 2> /dev/null
  [ -z "$4" ] || echo "$3 $4" >> "$PRS"
  head -c 20000000 /dev/zero > "$1/$2/node_modules.bin" # ~20 MB, excluded from git status
  touch_old "$1/$2" "${5:-30}"
}
commit_in() { # <dir>: one commit ahead of origin/main, then back-date the gitdir again
  echo work >> "$1/file.txt"
  git -C "$1" commit -q -am work
}

wt "$R1" merged fix/merged MERGED
wt "$R1" closed fix/closed CLOSED
wt "$R1" open fix/open OPEN
wt "$R2" merged-r2 fix/merged-r2 MERGED
wt "$R1" reopened fix/reopened CLOSED,OPEN # a closed PR and a newer open one
wt "$R1" nopr-old fix/nopr-old "" 30
wt "$R1" nopr-young fix/nopr-young "" 3
wt "$R1" nopr-ahead fix/nopr-ahead "" 30
commit_in "$R1/nopr-ahead"
touch_old "$R1/nopr-ahead" 30
wt "$R1" dirty fix/dirty MERGED
echo edit >> "$R1/dirty/file.txt"
touch_old "$R1/dirty" 30
wt "$R1" busy fix/busy MERGED 30
touch "$R1/busy" # modified just now
wt "$R1" detached fix/detached MERGED
git -C "$R1/detached" checkout -q --detach
touch_old "$R1/detached" 30
wt "$R1" locked fix/locked MERGED
git -C "$MAIN" worktree lock "$R1/locked"
wt "$R1" ghfail fix/ghfail FAIL
wt "$R1" broken fix/broken MERGED
# Metadata gone from the main clone's side: its .git file points at a gitdir that
# no longer lists this path, so `git worktree remove` refuses it and the script
# must fall back to rm -rf.
echo "$R1/broken-moved/.git" > "$MAIN/.git/worktrees/broken/gitdir"
# Metadata gone altogether (git worktree prune ran while the drive was off): the
# branch is unreadable, so it is reported as an orphan and never removed.
wt "$R1" orphan fix/orphan "" 30
wt "$R1" orphan-young fix/orphan-young "" 3
rm -rf "$MAIN/.git/worktrees/orphan" "$MAIN/.git/worktrees/orphan-young"
touch_old_plain() { find "$1" -maxdepth 1 -exec touch -t "$(date -v-"$2"d '+%Y%m%d%H%M' 2> /dev/null || date -d "$2 days ago" '+%Y%m%d%H%M')" {} +; }
touch_old_plain "$R1/orphan-young" 3
# Things under a root that are not linked worktrees of this clone, each old, on a
# branch with no PR and nothing ahead of its own origin/main: they must be kept.
git clone -q "$TMP/origin.git" "$R1/plainclone" 2> /dev/null # .git is a directory
touch_old "$R1/plainclone" 30
git init -q -b main "$TMP/other" # another repo, whose worktree sits under our second root
echo o > "$TMP/other/f"
git -C "$TMP/other" add f
git -C "$TMP/other" commit -q -m o
git -C "$TMP/other" update-ref refs/remotes/origin/main HEAD
git -C "$TMP/other" worktree add -q -b other-branch "$R2/foreign" 2> /dev/null
touch_old "$R2/foreign" 30
git -C "$TMP/other" worktree add -q -b other-orphan "$R2/foreign-orphan" 2> /dev/null
rm -rf "$TMP/other/.git/worktrees/foreign-orphan"
touch_old_plain "$R2/foreign-orphan" 30
mkdir -p "$R1/notgit" && echo x > "$R1/notgit/f"
touch_old "$R1/notgit" 30
echo "a file, not a worktree" > "$R1/stray.txt"

LOG="$TMP/prune.log"
run() { PRUNE_MAIN_CLONE="$MAIN" PRUNE_ROOTS="$R1:$R2" PRUNE_LOG="$LOG" bash "$SCRIPT" "$@" > "$TMP/out" 2>&1 && RC=0 || RC=$?; [ -z "${DEBUG:-}" ] || cat "$TMP/out"; }
has() { grep -qF -- "$1" "$TMP/out"; }
gone() { [ ! -e "$1" ]; }
here() { [ -d "$1" ]; }
listed() { git -C "$MAIN" worktree list --porcelain | grep -qF "worktree $1"; }

# 1. --dry-run: says what it would do, and does nothing.
run --dry-run
expect "dry run: exit 0" test "$RC" = 0
expect "dry run: would remove merged" has "would remove $R1/merged (fix/merged: PR #101 MERGED"
expect "dry run: would remove closed" has "would remove $R1/closed (fix/closed: PR #102 CLOSED"
expect "dry run: would remove a merged one under the second root" has "would remove $R2/merged-r2 "
expect "dry run: reports the space" has "would free 0."
expect "dry run: summary" has "summary (dry run, nothing changed): would remove 5, would free"
expect "dry run: removed nothing" here "$R1/merged"
expect "dry run: kept every registration" listed "$R1/merged"
expect "dry run: wrote no log" gone "$LOG"

# 2. The real run.
run
expect "real run: exit 0" test "$RC" = 0
expect "merged PR: removed" gone "$R1/merged"
expect "merged PR: not in git worktree list" bash -c "! git -C '$MAIN' worktree list --porcelain | grep -qF '$R1/merged'"
expect "closed PR: removed" gone "$R1/closed"
expect "second root: removed" gone "$R2/merged-r2"
expect "open PR: kept" here "$R1/open"
expect "open PR: still registered" listed "$R1/open"
expect "open PR: said so" has "keep   $R1/open (fix/open: open PR #103)"
expect "closed then reopened (an OPEN PR among several): kept" here "$R1/reopened"
expect "no PR, nothing ahead, old: removed" gone "$R1/nopr-old"
expect "no PR, younger than 7 days: kept" here "$R1/nopr-young"
expect "no PR, commits ahead: kept" here "$R1/nopr-ahead"
expect "uncommitted changes: kept" here "$R1/dirty"
expect "touched in the last 2 hours: kept" here "$R1/busy"
expect "detached HEAD: kept" here "$R1/detached"
expect "locked: kept" here "$R1/locked"
expect "gh failed for the branch: kept" here "$R1/ghfail"
expect "not a worktree: kept" here "$R1/notgit"
expect "a stray file: untouched" test -f "$R1/stray.txt"
expect "registered but git cannot remove it: removed by the rm -rf fallback" gone "$R1/broken"
expect "orphan of this repo, old: kept" here "$R1/orphan"
expect "orphan of this repo, young: kept" here "$R1/orphan-young"
expect "orphan: reported for hand removal" grep -qF "orphan: worktree metadata is gone" "$LOG"
expect "orphan: reported with its path" grep -qF "rm -rf \"$R1/orphan\"" "$LOG"
expect "plain clone under a root: kept" here "$R1/plainclone"
expect "plain clone: said why" has "not a linked worktree (no .git file)"
expect "another repo's worktree under a root: kept" here "$R2/foreign"
expect "another repo's worktree: said why" has "not a worktree of $MAIN"
expect "another repo's orphaned worktree: kept, not reported as ours" here "$R2/foreign-orphan"
expect "another repo's orphan is not reported for removal" bash -c "! grep -qF 'foreign-orphan (orphan' '$LOG'"
expect "another repo's worktree: gh was never asked about its branch" bash -c "! grep -qF 'other-branch' '$GH_LOG'"
expect "branches survive the removal" git -C "$MAIN" rev-parse --verify -q fix/merged
expect "a stale registration is pruned" bash -c "! git -C '$MAIN' worktree list --porcelain | grep -qF 'prunable'"

# 3. The log: one line per removal and a summary; kept ones are not logged.
expect "log: one line per removal" test "$(grep -c ' removed /' "$LOG")" = 5
expect "log: the summary" grep -q 'summary: removed 5, freed 0\.[0-9][0-9] GB, kept 2 open, skipped ' "$LOG"
expect "log: keeps are not logged" bash -c "! grep -q ' keep ' '$LOG'"
expect "log: timestamped" grep -Eq '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9:]{8} removed ' "$LOG"

# 4. A second run finds nothing more to remove.
run
expect "second run: removed 0" has "summary: removed 0, freed 0.00 GB, kept 2 open"
expect "second run: still reports the orphans" has "orphaned 2"

# 5. gh not authenticated: nothing is removed and it says so.
echo "fix/open2 MERGED" >> "$PRS"
git -C "$MAIN" worktree add -q -b fix/open2 "$R1/open2" origin/main 2> /dev/null
touch_old "$R1/open2" 30
GH_AUTH_RC=1 run
expect "no gh auth: exit 1" test "$RC" = 1
expect "no gh auth: says why" has "gh is missing or not authenticated"
expect "no gh auth: removed nothing" here "$R1/open2"

# 5b. The main clone must be the main worktree: pointed at a linked one, it stops.
PRUNE_MAIN_CLONE="$R1/open" PRUNE_ROOTS="$R1" PRUNE_LOG="$LOG" bash "$SCRIPT" --dry-run > "$TMP/out" 2>&1 && RC=0 || RC=$?
expect "linked worktree given as the main clone: exit 1" test "$RC" = 1
expect "linked worktree given as the main clone: says so" has "is not the main worktree"

# 5c. A worker starts between the decision and the removal (du is slow on 7 GB):
# a stub du touches the directory, and the last look before removal keeps it.
echo "fix/race MERGED" >> "$PRS"
git -C "$MAIN" worktree add -q -b fix/race "$R1/race" origin/main 2> /dev/null
touch_old "$R1/race" 30
mkdir -p "$TMP/bin-du"
printf '#!/bin/sh\nfor last; do :; done\ntouch "$last"\nexec /usr/bin/du "$@"\n' > "$TMP/bin-du/du"
chmod +x "$TMP/bin-du/du"
PATH="$TMP/bin-du:$PATH" run
expect "activity during du: kept" here "$R1/race"
expect "activity during du: said so" has "keep   $R1/race (modified in the last 2 hours)"

# 6. An unknown flag is a usage error, and nothing runs.
run --dryrun
expect "unknown flag: exit 2" test "$RC" = 2
expect "unknown flag: removed nothing" here "$R1/open2"

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
