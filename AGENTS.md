# Ground rules for ALL AI agents in this repo

These rules apply to every AI session — Claude Code (local, Hetzner, cloud), Codex, Jules, and anything else operating with Rob's credentials. All sessions share one GitHub identity, so after-the-fact attribution is impossible. These rules are the only control.

**Canonical file:** `ai-adventure-scribe-main/AGENTS.md` (this file). A copy lives at the repository root so tools that only load `/AGENTS.md` still see the rules. Keep both in lockstep. Do not replace this file with a symlink to `CLAUDE.md`. `CLAUDE.md` is Claude-specific context only.

Order in this file: worker rules; Hetzner (ops) rules; Playtest rules; pre-merge check procedure (#2056); deploy-ordering note (#2093).

---

# Worker rules

## 1. NEVER merge pull requests

- Only Rob merges, ever. No exceptions for green CI, for your own PRs, for "trivial" changes, or for PRs another agent asked you to review.
- Workers never run `gh pr merge` or `gh pr ready`, never enable auto-merge, and never merge their own PRs. Merges happen only in a session where Rob has pasted explicit permission naming the PR number.
- The single exception: Rob pastes an explicit list of PR numbers into YOUR session with the words "you have my permission to merge". Merge exactly that list, nothing else. Permission given to another session is not permission given to you.
- Merges to `main` auto-deploy to production within ~15 minutes. An unauthorized merge is an unauthorized production deploy.
- On 2026-08-11, five PRs (#1702, #1716, #1719, #1723, #1725) were merged by an unidentified agent session.
- On 2026-08-30, #1945 and #1946 were merged by an unidentified agent session. Do not be the next incident.
- When you DO hold that permission, check stacked-PR rules before merging — if the PR is a stack parent, merging it the normal way closes its children. Then follow the pre-merge check procedure below.

## 2. Never push directly to `main`

- Branch off **current** `origin/main` (`git fetch origin main` first). Do not branch off a dirty local checkout or an old feature branch.
- All work goes through a branch and a **draft** PR with "Do not merge — for review" in the description.
- Never mark the PR ready. Never merge.

## 3. Verify before claiming

- Verify a claim at the git ref before acting on it. A comment, a paste, or a worktree is not evidence of what `origin/main` contains.
- Before calling any code "live" or "deployed", prove ancestry: `git merge-base --is-ancestor <commit> origin/main`. A worktree or feature branch is NOT main.
- Report test/lint gates as DELTAS against a baseline run on `origin/main`, not as raw counts.
- If your findings disprove the premise of your instructions, report it. Continue if the authorized scope still holds; ask before changing scope.

## 4. Tests and secrets

- Never delete a test. Never add `.skip` or `.only` to a test.
- Never paste secret values into code, commits, comments, logs, or PR bodies. Reference env var **names** only. If you accidentally see a secret, do not repeat it.

## 5. Respect in-flight work

Before editing, check open PRs (`gh pr list`). Do not modify files that an unrelated open PR touches. The current task's own PR and explicitly authorized stacks are allowed; document conflicts with unrelated PRs on the relevant issue instead.

## 6. Worktree hygiene

- Use one isolated worktree per issue, named for that issue (for example, `worktrees/issue-1973-spells-section`).
- Remove the issue worktree after its PR merges.
- Run `git worktree prune` weekly to clear stale administrative entries.

## 7. Migrations

One migration tree owns each table's DDL (see docs/memory-system-design-v2.md §6). Never create the same table's DDL in both `db/migrations/` and `supabase/migrations/`. Manual prod applies must be recorded (see issue #1703).

## 8. Stacked PRs: retarget children BEFORE merging the parent

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

## 9. Every diagnosis and PR report ends with "Friction / simplification" and the head SHA

When you finish a diagnosis or a PR report, add a short **Friction / simplification** section naming what made the work harder than it needed to be: a log line that did not carry the field you needed, a misleading error label, a value that exists only in a response body, two functions doing the same job with different rules, a column that has to be derived by join. Be specific — name the file and line, and say what you actually wanted to read. Items get **filed as issues, not fixed in-task**, unless the friction is itself blocking the task you were given; a diagnosis that quietly grows a refactor stops being a diagnosis, and a fix nobody asked for arrives without a review. If you find nothing, say "none" rather than dropping the section — a report with no friction section reads as a report where nobody looked.

End the report with the head SHA (`git rev-parse HEAD`).

## 10. Board discipline — issue #1855 is the control room

**Only the board maintainer edits the #1855 body.** Other sessions do not edit it, and do not comment on it.

- **Report status where the work is**: in your own PR description, or on the issue you are working. Rob reads #1855 and the `needs-rob` label; the maintainer folds your PR/issue updates onto the board.
- **Decisions only Rob can make** go on the issue with the `needs-rob` label. The maintainer lifts them into the board's NEEDS ROB section.
- **Never comment on #1855.** Comments are not the board. The one sanctioned exception is a full-body archive snapshot taken immediately before a restructure.

### The edit procedure (maintainer only)

Never retype the body into a `--body` flag, and never edit it in the web UI. Both have lost content: on 2026-08-24 an in-place retype blanked the body and reconstructed it from memory, destroying NEEDS ROB item 2 (recovered 2026-08-26 from `userContentEdits`). Always round-trip through a file:

```bash
gh issue view 1855 --json body --jq .body > /tmp/board.md
$EDITOR /tmp/board.md
gh issue edit 1855 --body-file /tmp/board.md
```

To recover a lost revision:

```bash
gh api graphql -f query='query { repository(owner:"Garblesnarff", name:"infinite-realms-production") {
  issue(number:1855) { userContentEdits(last:100) { nodes { editedAt editor { login } diff } } } } }'
```

### Board shape

Keep the body **under 8k characters**, one line per item, **15 words maximum**, each line leading with its issue or PR link. All detail lives in the linked issue. Sections, in order: **NEEDS ROB**, **IN FLIGHT**, **SPECCED**, **STANDING WARNINGS**, **RECENTLY SHIPPED** (last 7 days, then dropped). A board that does not fit on a screen stops being read, and a board that can only be edited by a full retype gets corrupted.

---

# Hetzner (ops) rules

Hetzner is the only merger. Workers open draft PRs; they do not merge, even when CI is green.

- **Permission line at an exact SHA.** Rob's "you have my permission to merge" paste must name the PR number **and** the head SHA. Permission for a PR at a different SHA is not permission for the SHA in front of you. After a new push, you need a new line.
- **CI green + strategist code-PASS at the same SHA.** Merge only when hosted CI is green **on that SHA** and the strategist has posted `PASS` (code review) **on that SHA**. A PASS on an earlier commit does not cover a later push. A green check on a cancelled-then-rerun SHA is not a green check on this SHA.
- **No deploys during a stranger-test run.** Merges to `main` auto-deploy. Between Playtest's `run N started` and `run N ended` comments, hold merges. A deploy mid-run drops in-flight turns (#2093).
- **Prod config changes need an approval line.** Host files such as `scripts/auto-deploy.sh` (and other prod-only config) are not "drive-by" edits. Do not change them without an explicit approval line from Rob naming the file and the change.
- **`gh pr ready` only as part of an authorized merge.** Hetzner may run `gh pr ready` on a PR only when Rob's permission line is present, the strategist has posted a code-PASS at the same SHA, and the pull_request CI run is green. Workers never mark a PR ready.

Cancelled GitHub Actions runs are not failures. See the pre-merge procedure for how to read check conclusions.

---

# Playtest rules

Playtest Claude runs stranger tests against production.

## Run started / ended comments

At the start of a run, post a comment: **`run N started`**. When the run is over (pass, fail, or abort), post **`run N ended`**. Hetzner holds merges between those two comments. A run with no `ended` comment is still in flight.

## Fail criteria

A run **FAIL**s when any of these happen:

- **Dead-end:** the player cannot continue (composer disabled, no recovery control, no DM reply and no way to resend, or "your turn" with every action disabled).
- **Fabrication:** the DM narrates a mechanical outcome (hit, miss, damage, wounded, HP change) that the engine did not produce.
- **Lost turn across deploy:** a turn in flight at restart never comes back (#2093).

Polish, copy, and non-blocking bugs are notes, not FAIL. File them; do not stop the run unless the player cannot continue.

## Report format

One comment or issue body per run, with:

1. **Header:** `Playtest Claude run N`, UTC window, prod SHA / bundle hash, session id, character, campaign. Report the **session id** (from the URL or console), not the campaign id.
2. **Turn table:** player input (verbatim), engine lines, DM outcome.
3. **Verdict:** PASS or FAIL, with the fail criterion named if FAIL.
4. **Console / network:** the lines that prove the verdict. Capture console from turn 1, not only on failure.
5. **Follow-ups:** issue numbers filed from the run.

Do not merge, restart, or change prod config from a Playtest session.

---

# Pre-merge check procedure (#2056)

Two checks that look authoritative are not. Both produced false negatives on #2053 — they agreed with each other and both were wrong, which is the worst failure shape.

**Do NOT use these:**

```bash
# LIES: --stat abbreviates long paths to ".../src/services/ai-service.ts",
# so grep -F against full paths never matches and every collision reads clean.
git show --stat --format="" <commit> | grep -Ff <pr-files.txt>

# LIES: this git emits "changed in both" but no inline "<<<<<<<" markers,
# so counting markers returns 0 on a branch that genuinely conflicts.
git merge-tree $(git merge-base origin/main <head>) origin/main <head> | grep -c '^<<<<<<<'
```

**Use these instead:**

```bash
# Collisions: full paths on both sides, compared as sets.
gh pr diff <pr> --name-only | sort > /tmp/pr-files.txt
for c in $(git rev-list <head>..origin/main); do
  git show --name-only --format="" "$c" | sort | comm -12 - /tmp/pr-files.txt
done

# Conflicts: perform the merge; only a real merge knows.
git worktree add --detach /tmp/conflict-test <head>
cd /tmp/conflict-test && git merge origin/main --no-commit --no-ff
git diff --name-only --diff-filter=U        # empty == clean
git merge --abort && cd - && git worktree remove --force /tmp/conflict-test
```

A clean result from the second command is the only evidence that a branch merges. `mergeable` from the GitHub API is also not evidence: it is `UNKNOWN` while GitHub recomputes, which is exactly when you are asking.

## Read run conclusions, not `gh pr checks` row colors

`gh pr checks` paints cancelled runs the same as failures. A cancelled job (never picked up, superseded by concurrency `cancel-in-progress`, or aborted) is **not** a failed test. The merge gate must read the GitHub Actions **run conclusion** (`success` / `failure` / `cancelled` / `skipped`) for the SHA being merged, not the red/green row color in `gh pr checks`.

**CI green** means the **pull_request-event** workflow run at the head SHA has conclusion `success` (`gh run list --commit <sha> --event pull_request --json conclusion`). A cancelled push-event run at the same SHA is neither green nor red; `gh pr checks` row colors are not evidence.

```bash
gh run list --commit <sha> --json databaseId,name,conclusion,status,headSha
```

Re-run only the runs whose conclusion is `cancelled` with no failed steps, or whose conclusion is `failure` with a real test/lint error. Do not treat a sea of red cancelled rows as "CI is red." Do not merge on a SHA whose required checks have not concluded `success`.

---

# Deploy ordering (#2093)

The client bundle must **not** go live before the server restart.

`ops/auto-deploy.sh` (and the host copy) currently builds the Vite bundle into `dist/` — nginx's docroot — and only then runs `pm2 restart`. The new hashed client is live while the old server is still bound. That skew is how `stale_client_detected` happens, and the restart itself drops in-flight turns.

Until Rob approves a script change:

- Do not publish a new `dist/` in front of a still-running old server.
- Do not "fix" the script as a drive-by; prod config needs an approval line (Hetzner rules).
- Safer direction if/when reordering is approved: restart (or reload) the server **before** swapping the bundle into the docroot, so a briefly-old client talks to a new API rather than the reverse.
- Holding merges during a stranger-test run does not fix the ordering; it only keeps a run from landing in the skew window.
