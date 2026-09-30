# Worktree hygiene: the nightly prune (#2365)

Every worker chat creates a git worktree under `worktrees/` (inside the main clone) or `../worktrees/` (next to it) on the T7 drive, and each one carries its own `node_modules`, about 7 GB. AGENTS.md §6 tells a worker to remove its worktree after the PR merges, but the merge happens in a later session, so the worktrees pile up: on 2026-09-28 the drive hit 100% and 67 worktrees (479 GB) were deleted by hand.

`ops/prune-merged-worktrees.sh` removes the finished ones. A launchd agent runs it daily at 05:00 local time on Rob's Mac. It does not touch production.

## What it removes and what it never touches

For each directory under the two roots it first checks that it is a linked worktree of the main clone (`.git` is a file and its common dir is the main clone's `.git`), then reads the branch (`git -C <dir> rev-parse --abbrev-ref HEAD`) and asks GitHub for that branch's PRs (`gh pr list --head <branch> --state all`).

| Situation | Result |
| --- | --- |
| The PR is `MERGED` or `CLOSED` | removed |
| No PR, no commits ahead of `origin/main`, directory older than 7 days | removed |
| The `.git` file points into this clone's `worktrees/` admin dir and that dir no longer exists (git cannot read the branch) | kept, and reported as an `orphan` with the `rm -rf` line to run by hand once you have looked |
| Any PR on the branch is `OPEN` | kept |
| `git status --porcelain` is not empty | kept |
| The directory, its top-level entries or its gitdir's `HEAD`/`index` changed in the last 2 hours | kept (a worker may be mid-task) |
| Not a linked worktree of the main clone (a plain clone, or another repo's worktree, under a root), detached HEAD, locked worktree, no PR but commits ahead, no PR and younger than 7 days | kept |
| `gh` cannot answer for the branch | kept |

Removal is `git worktree remove --force <dir>` from the main clone, with `rm -rf <dir>` as the fallback when git refuses, then `git worktree prune`; it only ever removes a direct child of a root, and looks at the 2-hour rule once more right before removing. Removing a worktree does not delete its branch, so commits are never lost, only the checkout and everything in it that git ignores: `--force` deletes ignored files such as `node_modules` and a local `.env` too. Anything untracked and not ignored makes the worktree count as changed, so it is kept.

## Check it first (`--dry-run`)

Prints what it would remove and the space it would free. It removes nothing and writes no log; its only side effect is a `git fetch origin main` in the main clone (so that "commits ahead of `origin/main`" is current).

```bash
cd /Volumes/T7/Projects/infinite_realms/infinite-realms-production && ops/prune-merged-worktrees.sh --dry-run
```

The script works from any checkout of the repo (it finds the main clone with `git worktree list`), but the launchd job below runs the copy in the main clone, so that clone must have `ops/prune-merged-worktrees.sh`, that is, be on `main` after this merges.

## Install (three commands)

Needs `gh` authenticated on the Mac: `gh auth status` must succeed (the script exits with an error and removes nothing if it does not). Run these in the main clone:

```bash
REPO="$PWD" perl -pe 'BEGIN { ($r, $h) = map { s/&/&amp;/gr =~ s/</&lt;/gr } @ENV{qw(REPO HOME)} } s/__REPO__/$r/g; s/__HOME__/$h/g' ops/app.infiniterealms.prune-worktrees.plist > ~/Library/LaunchAgents/app.infiniterealms.prune-worktrees.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/app.infiniterealms.prune-worktrees.plist
launchctl kickstart gui/$(id -u)/app.infiniterealms.prune-worktrees
```

The third command runs the job once now, for real, so `--dry-run` first. Then `cat ~/Library/Logs/infinite-realms-prune.log` shows one line per removed worktree and a summary (`removed N, freed X GB, kept M open, skipped K, orphaned O`). Errors that stop the script before it can log land in `~/Library/Logs/infinite-realms-prune.launchd.log`.

If the launchd log says `Operation not permitted`, macOS is blocking a background job from the external drive: give `/bin/bash` Full Disk Access in System Settings, Privacy & Security.

## Uninstall

```bash
launchctl bootout gui/$(id -u)/app.infiniterealms.prune-worktrees && rm ~/Library/LaunchAgents/app.infiniterealms.prune-worktrees.plist
```

## Tests

`bash ops/tests/prune-merged-worktrees.sh` builds a scratch repo with real worktrees and a stub `gh` and checks each row of the table above, both roots, `--dry-run`, the log and the `rm -rf` fallback. It touches nothing outside a temp dir.
