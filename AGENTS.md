# Ground rules for ALL AI agents in this repo

These rules apply to every AI session — Claude Code (local, Hetzner, cloud), Codex, Jules, and anything else operating with Rob's credentials. All sessions share one GitHub identity, so after-the-fact attribution is impossible. These rules are the only control.

## 1. NEVER merge pull requests

- Only Rob merges, ever. No exceptions for green CI, for your own PRs, for "trivial" changes, or for PRs another agent asked you to review.
- The single exception: Rob pastes an explicit list of PR numbers into YOUR session with the words "you have my permission to merge". Merge exactly that list, nothing else. Permission given to another session is not permission given to you.
- Merges to `main` auto-deploy to production within ~15 minutes. An unauthorized merge is an unauthorized production deploy.
- On 2026-08-11, five PRs (#1702, #1716, #1719, #1723, #1725) were merged by an unidentified agent session. Do not be the sixth incident.
- When you DO hold that permission, check §6 before merging — if the PR is a stack parent, merging it the normal way closes its children.

## 2. Never push directly to `main`

All work goes through a branch and a draft PR with "Do not merge — for review" in the description.

## 3. Verify before claiming

- Before calling any code "live" or "deployed", prove ancestry: `git merge-base --is-ancestor <commit> origin/main`. A worktree or feature branch is NOT main.
- Report test/lint gates as DELTAS against a baseline run on `origin/main`, not as raw counts.
- If your findings disprove the premise of your instructions, STOP and report — do not build on a wrong premise.

## 4. Respect in-flight work

Before editing, check open PRs (`gh pr list`). Do not modify files that an open PR touches; document the conflict on the relevant issue instead.

## 5. Migrations

One migration tree owns each table's DDL (see docs/memory-system-design-v2.md §6). Never create the same table's DDL in both `db/migrations/` and `supabase/migrations/`. Manual prod applies must be recorded (see issue #1703).

## 6. Stacked PRs: retarget children BEFORE merging the parent

Deleting a branch **closes** every open PR that targets it as `base`. GitHub does auto-retarget children to the parent's base when the parent merges, but that is asynchronous and `--delete-branch` races it — along with this repo's auto-delete-head-branches-on-merge setting. Lose the race and the child PR is closed outright, taking its review threads and CI history with it.

Before merging anything, check whether it is a stack parent:

```bash
gh pr list --search 'base:<parent-branch>'          # children of this PR
gh pr edit <child> --base main                      # retarget EACH child first
gh pr merge <parent> --squash                       # then merge, no --delete-branch
```

Merge bottom-up, one level at a time, re-checking for children after each. To find every stack in the repo:

```bash
gh pr list --state all --limit 100 \
  --json number,baseRefName,headRefName,state \
  --jq '.[]|select(.baseRefName!="main")'
```

This has bitten us twice, and recovery is worse than prevention both times:

- **2026-08-14** — merging #1780 with `--delete-branch` deleted the branch #1781 targeted, closing #1781 instead of retargeting it. Recovered by recreating the base branch at #1780's pre-merge SHA `a012cfd1`, reopening #1781, and retargeting it to `main`.
- **2026-08-19** — squash-merging #1852 with `--delete-branch` closed #1851, which was stacked on the vitals branch. GitHub refused both reopen-with-missing-base and rebase-of-closed, so recovery meant recreating the base at its old SHA, reopening, retargeting to `main`, then deleting the temp branch.

A wrongly-closed child is only recoverable if someone notices. Twice now, nobody did until later.

## 7. Board discipline — issue #1855 is the control room

Any session that **starts, finishes, or blocks** a work item must **edit the #1855 body** to reflect it before ending: move items between sections, update status, and refresh the `Last updated` line.

- Decisions only Rob can make get moved to the **NEEDS ROB** section, and the corresponding issue gets the `needs-rob` label.
- **Never comment on #1855 — edit the body.** Comments are not the board; a board that has to be reconstructed by reading a comment thread is not a board.
