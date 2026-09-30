#!/usr/bin/env bash
# Remove git worktrees whose work is finished (#2365). Runs on Rob's Mac, from
# launchd (ops/app.infiniterealms.prune-worktrees.plist), because a worker's
# worktree is not removed when its PR merges: the merge happens in a later
# session. Each one carries its own node_modules (about 7 GB).
#
#   ops/prune-merged-worktrees.sh --dry-run   # print what it would remove, change nothing
#   ops/prune-merged-worktrees.sh             # remove, and log to ~/Library/Logs/infinite-realms-prune.log
#
# A worktree under either root (<main clone>/worktrees, <main clone>/../worktrees)
# is removed when its branch's PR is MERGED or CLOSED, or when the branch has no
# PR, no commits ahead of origin/main, and the directory is older than 7 days.
# It is never touched when the PR is OPEN, `git status --porcelain` is not
# empty, the directory changed in the last 2 hours, HEAD is detached, or the
# worktree is locked. Only a directory that is a linked worktree of the main
# clone (a .git file whose common dir is the main clone's .git) is a candidate:
# a plain clone or another repo's worktree under a root is left alone. A
# directory of this repo whose worktree metadata is gone is reported as an
# orphan, never removed: git cannot read it, so nothing proves it is clean.
# Removing a worktree does not delete its branch, so the commits stay in the
# main clone; `git worktree remove --force` does delete ignored files, such as
# a local .env and node_modules.
#
# Needs an authenticated `gh` (gh auth status). Works with bash 3.2 (macOS /bin/bash).
#
# Overrides, for the test in ops/tests/prune-merged-worktrees.sh:
#   PRUNE_MAIN_CLONE  the main clone (default: the first entry of `git worktree list`)
#   PRUNE_ROOTS       colon-separated worktree roots (default: the two above)
#   PRUNE_LOG         the log file (default: ~/Library/Logs/infinite-realms-prune.log)
set -u

IDLE_MIN=120        # modified within this many minutes: a worker may be mid-task
NO_PR_AGE_MIN=10080 # a branch with no PR must be at least this old (7 days)

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    *)
      echo "usage: ${0##*/} [--dry-run]" >&2
      exit 2
      ;;
  esac
done

HERE=$(cd "$(dirname "$0")" && pwd)
MAIN=${PRUNE_MAIN_CLONE:-$(git -C "$HERE" worktree list --porcelain 2>/dev/null | sed -n '1s/^worktree //p')}
if [ -z "$MAIN" ] || [ ! -d "$MAIN" ]; then
  echo "cannot find the main clone (is the drive mounted?)" >&2
  exit 1
fi
# The main clone must be the main worktree (its git dir is the common dir), and
# a candidate must share that common dir.
physical_dir() { (cd "$1" 2> /dev/null && cd "$(git rev-parse "$2" 2> /dev/null)" 2> /dev/null && pwd -P); }
MAIN_COMMON=$(physical_dir "$MAIN" --git-common-dir)
if [ -z "$MAIN_COMMON" ] || [ "$(physical_dir "$MAIN" --git-dir)" != "$MAIN_COMMON" ]; then
  echo "$MAIN is not the main worktree of a git repo" >&2
  exit 1
fi
ROOTS=${PRUNE_ROOTS:-$MAIN/worktrees:$(dirname "$MAIN")/worktrees}
LOG=${PRUNE_LOG:-$HOME/Library/Logs/infinite-realms-prune.log}

stamp() { date '+%Y-%m-%dT%H:%M:%S'; }
# log: stdout, and the log file on a real run. note: stdout only.
log() {
  local line
  line="$(stamp) $*"
  echo "$line"
  if [ "$DRY_RUN" -eq 0 ]; then
    mkdir -p "$(dirname "$LOG")"
    echo "$line" >> "$LOG"
  fi
}
note() { echo "$(stamp) $*"; }
gb() { awk -v k="$1" 'BEGIN { printf "%.2f", k / 1048576 }'; }

if ! command -v gh > /dev/null 2>&1 || ! gh auth status > /dev/null 2>&1; then
  log "error: gh is missing or not authenticated (run: gh auth status); nothing removed"
  exit 1
fi
export GH_PROMPT_DISABLED=1

git -C "$MAIN" fetch --quiet origin main > /dev/null 2>&1 || note "warning: git fetch origin main failed; using the local origin/main"

# PR_STATE: OPEN | DONE (merged or closed) | NONE | ERROR. PR_DESC: "#N STATE".
pr_state() {
  local out flat num
  PR_STATE=ERROR
  PR_DESC=""
  out=$(cd "$MAIN" && gh pr list --head "$1" --state all --json number,state,mergedAt --limit 20 2> /dev/null) || return 0
  flat=$(printf '%s' "$out" | tr -d ' \n')
  num=$(printf '%s' "$flat" | grep -o '"number":[0-9]*' | head -n 1 | cut -d: -f2)
  case "$flat" in
    *'"state":"OPEN"'*)
      PR_STATE=OPEN
      PR_DESC="open PR #$num"
      ;;
    '[]') PR_STATE=NONE ;;
    *'"state":"MERGED"'*)
      PR_STATE=DONE
      PR_DESC="PR #$num MERGED"
      ;;
    *'"state":"CLOSED"'*)
      PR_STATE=DONE
      PR_DESC="PR #$num CLOSED"
      ;;
  esac
  return 0
}

linked_to_main() { [ "$(physical_dir "$1" --git-common-dir)" = "$MAIN_COMMON" ]; }

older_than_a_week() { [ -n "$(find "$1" -maxdepth 0 -mmin +"$NO_PR_AGE_MIN" 2> /dev/null)" ]; }

recently_modified() {
  local gd
  [ -n "$(find "$1" -maxdepth 1 -mmin -"$IDLE_MIN" 2> /dev/null | head -n 1)" ] && return 0
  gd=$(git -C "$1" rev-parse --absolute-git-dir 2> /dev/null) || return 1
  [ -n "$(find "$gd/HEAD" "$gd/index" -mmin -"$IDLE_MIN" 2> /dev/null | head -n 1)" ]
}

# The .git file points into this repo's worktrees/ admin dir, which no longer
# exists (git worktree prune ran while the drive was unmounted): git cannot read
# anything inside the directory any more.
orphaned() {
  local gd
  gd=$(sed -n 's/^gitdir: //p' "$1/.git" 2> /dev/null)
  case "$gd" in
    "$MAIN/.git/worktrees/"?* | "$MAIN_COMMON/worktrees/"?*) [ ! -e "$gd" ] ;;
    *) return 1 ;;
  esac
}

# decide <dir>: sets VERDICT (remove | open | orphan | skip), BRANCH, and WHY.
# Cheap checks first; anything it cannot establish is a skip.
decide() {
  local dir=$1 gd status ahead
  VERDICT=skip
  BRANCH=""
  WHY=""
  if [ ! -f "$dir/.git" ]; then
    WHY="not a linked worktree (no .git file)"
    return
  fi
  if recently_modified "$dir"; then
    WHY="modified in the last $((IDLE_MIN / 60)) hours"
    return
  fi
  BRANCH=$(git -C "$dir" rev-parse --abbrev-ref HEAD 2> /dev/null)
  if [ -z "$BRANCH" ]; then
    if orphaned "$dir"; then
      VERDICT=orphan
      WHY="orphan: worktree metadata is gone and git cannot read it; check it, then remove by hand with: rm -rf \"$dir\""
    else
      WHY="cannot read its branch and it is not an orphan of this repo"
    fi
    return
  fi
  if ! linked_to_main "$dir"; then
    WHY="$BRANCH: not a worktree of $MAIN"
    return
  fi
  if [ "$BRANCH" = HEAD ]; then
    WHY="detached HEAD"
    return
  fi
  gd=$(git -C "$dir" rev-parse --absolute-git-dir 2> /dev/null)
  if [ -e "$gd/locked" ]; then
    WHY="$BRANCH: locked"
    return
  fi
  # --no-optional-locks: a plain `git status` rewrites the index, which would
  # make this script's own dry run look like activity to the next run.
  if ! status=$(git --no-optional-locks -C "$dir" status --porcelain 2> /dev/null) || [ -n "$status" ]; then
    WHY="$BRANCH: uncommitted changes"
    return
  fi

  pr_state "$BRANCH"
  case "$PR_STATE" in
    OPEN)
      VERDICT=open
      WHY="$BRANCH: $PR_DESC"
      ;;
    DONE)
      VERDICT=remove
      WHY="$BRANCH: $PR_DESC"
      ;;
    NONE)
      ahead=$(git -C "$dir" rev-list --count origin/main..HEAD 2> /dev/null)
      if [ "${ahead:-1}" != 0 ]; then
        WHY="$BRANCH: no PR, ${ahead:-unknown} commit(s) ahead of origin/main"
      elif ! older_than_a_week "$dir"; then
        WHY="$BRANCH: no PR, younger than 7 days"
      else
        VERDICT=remove
        WHY="$BRANCH: no PR, nothing ahead of origin/main, older than 7 days"
      fi
      ;;
    *) WHY="$BRANCH: gh could not tell its PR state" ;;
  esac
}

# remove_dir <dir> <root>: never anything but a child of a root.
remove_dir() {
  case "$1" in "$2"/?*) ;; *) return 1 ;; esac
  git -C "$MAIN" worktree remove --force "$1" > /dev/null 2>&1
  [ ! -e "$1" ] || rm -rf "$1"
  [ ! -e "$1" ]
}

REMOVED=0
FREED_KB=0
KEPT_OPEN=0
SKIPPED=0
ORPHANS=0

IFS_SAVE=$IFS
IFS=:
for root in $ROOTS; do
  IFS=$IFS_SAVE # the word list is already split; the body needs the normal IFS
  [ -d "$root" ] || continue
  for dir in "$root"/*/; do
    dir=${dir%/}
    [ -d "$dir" ] && [ ! -L "$dir" ] || continue

    decide "$dir"
    case "$VERDICT" in
      open)
        KEPT_OPEN=$((KEPT_OPEN + 1))
        note "keep   $dir ($WHY)"
        continue
        ;;
      orphan)
        ORPHANS=$((ORPHANS + 1))
        log "$dir ($WHY)"
        continue
        ;;
      skip)
        SKIPPED=$((SKIPPED + 1))
        note "keep   $dir ($WHY)"
        continue
        ;;
    esac

    size_kb=$(du -sk "$dir" 2> /dev/null | cut -f1)
    size_kb=${size_kb:-0}
    if [ "$DRY_RUN" -eq 1 ]; then
      REMOVED=$((REMOVED + 1))
      FREED_KB=$((FREED_KB + size_kb))
      log "would remove $dir ($WHY, $(gb "$size_kb") GB)"
    elif recently_modified "$dir"; then
      # du on a 7 GB tree takes a while; a worker may have started since decide()
      SKIPPED=$((SKIPPED + 1))
      note "keep   $dir (modified in the last $((IDLE_MIN / 60)) hours)"
    elif remove_dir "$dir" "$root"; then
      REMOVED=$((REMOVED + 1))
      FREED_KB=$((FREED_KB + size_kb))
      log "removed $dir ($WHY, $(gb "$size_kb") GB)"
    else
      SKIPPED=$((SKIPPED + 1))
      log "error: could not remove $dir ($WHY)"
    fi
  done
done

[ "$DRY_RUN" -eq 1 ] || git -C "$MAIN" worktree prune > /dev/null 2>&1

if [ "$DRY_RUN" -eq 1 ]; then
  log "summary (dry run, nothing changed): would remove $REMOVED, would free $(gb "$FREED_KB") GB, kept $KEPT_OPEN open, skipped $SKIPPED, orphaned $ORPHANS"
else
  log "summary: removed $REMOVED, freed $(gb "$FREED_KB") GB, kept $KEPT_OPEN open, skipped $SKIPPED, orphaned $ORPHANS"
fi
