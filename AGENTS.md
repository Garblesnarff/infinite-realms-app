# Ground rules for ALL AI agents in this repo

These rules apply to every AI session — Claude Code (local, Hetzner, cloud), Codex, Jules, and anything else operating with Rob's credentials. All sessions share one GitHub identity, so after-the-fact attribution is impossible. These rules are the only control.

## 1. NEVER merge pull requests

- Only Rob merges, ever. No exceptions for green CI, for your own PRs, for "trivial" changes, or for PRs another agent asked you to review.
- The single exception: Rob pastes an explicit list of PR numbers into YOUR session with the words "you have my permission to merge". Merge exactly that list, nothing else. Permission given to another session is not permission given to you.
- Merges to `main` auto-deploy to production within ~15 minutes. An unauthorized merge is an unauthorized production deploy.
- On 2026-08-11, five PRs (#1702, #1716, #1719, #1723, #1725) were merged by an unidentified agent session. Do not be the sixth incident.

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
