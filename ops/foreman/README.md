# Hands-off pilot: catjam-runner + realms-reviewer (#586)

Spec: issue #586. Reviewer prompt: `docs/ops/review_prompt.md`.

| Piece | File | Schedule |
|---|---|---|
| Coder: opencode + the free "cat jam" model (`opencode/cat-jam-free`) | `catjam-runner.sh` | `realms-catjam-runner.timer`, every 30 min |
| Reviewer: `claude -p`, Haiku or Sonnet by tier, API key | `review.sh` | `realms-reviewer.timer`, every 2 minutes; a cheap pre-check exits idle ticks |
| Daily summary to Slack #last-24 and #230 | `review.sh` (first 11:xx UTC tick) | same timer |
| Triager: `claude -p` Sonnet turns new `bug` issues into catjam / Jules tasks (#717) | `triage.sh` | `realms-triage.timer`, :15 and :45 UTC |
| Sandbox image (opencode + Claude Code live only here) | `Dockerfile` | — |
| Shared guards (secret checks, trusted-review and same-repo filters) | `lib.sh`, tested by `ops/tests/foreman-guards.sh` | — |

## Labels

- `catjam`: a maintainer queues the issue. Only maintainers can add labels, so strangers cannot queue work.
- `catjam-wip`: the runner is on it, or its draft PR is open.
- `catjam-done`: the model found nothing to change.
- `catjam-fix`: the reviewer posted FIX on the issue's `catjam/` PR, so the runner runs the next round.
- `needs-human`: more than 3 FIX re-runs, a refused diff (it touched `.github/`, added an `.env` file or something that looks like a secret), or a runner error.

## Sandbox

- Host user `foreman` (no sudo) owns `/etc/realms-foreman/env` (mode 600) and `/var/lib/realms-foreman`. The units run as root only to drive docker. Putting foreman in the `docker` group would make it root-equivalent.
- Container caps: `--cpus 2 --memory 4g`, lower CPU shares, a pids limit, `no-new-privileges`, and only the caps the scripts need to drop to foreman. The only mounts are `/var/lib/realms-foreman/{runner,reviewer}` and the runner state, which the reviewer mounts read-only. There is no `/var/www` mount and no prod env file.
- One env file, split per container. The runner unit pipes the file through `grep '^GH_TOKEN='`, so the runner container gets only GH_TOKEN and no copy is written. The reviewer container gets all three keys.
- In the container the controller (root) holds the secrets. Repo and model code (bun install, opencode, tsc, tests, claude) runs as uid foreman. The runner gives it an empty environment. The root controller runs git only with an explicit root-owned `GIT_DIR`, so nothing the model writes in the worktree is ever executed with the token.
- Reviewer: review.sh pre-fetches the PR, diff, checks, failed logs, comments and linked issues into a scratch dir. `claude -p` then runs with ONLY `ANTHROPIC_API_KEY` in its environment, no Bash or web tools, and `--safe-mode` confining Read/Grep/Glob/Write to that dir, plus deny rules for `/proc`, `/etc`, `/home`, `/work` and the rest. A verdict whose text contains a literal env secret value, or a secret-shaped string, is dropped.
- Only "Strategist review" comments by the token owner with OWNER/MEMBER association count, in both scripts. A stranger's comment cannot suppress a review or feed FIX items to the model. The runner only follows same-repo `catjam/<n>-` PRs, never forks.
- GitHub token: fine-grained, this repo only, Contents/Pull requests/Issues RW, with no Workflows and no Administration permission. A push that touches `.github/workflows` fails by design, and the runner refuses such a diff before it pushes.

## Install (ops session, after this PR merges)

```bash
useradd --system --uid 1500 --home-dir /var/lib/realms-foreman --shell /usr/sbin/nologin foreman
install -d -o foreman -g foreman -m 750 /var/lib/realms-foreman /var/lib/realms-foreman/runner /var/lib/realms-foreman/reviewer
install -d -o foreman -g foreman -m 700 /etc/realms-foreman
printf 'ANTHROPIC_API_KEY=\nGH_TOKEN=\nSLACK_WEBHOOK_URL=\n' | install -o foreman -g foreman -m 600 /dev/stdin /etc/realms-foreman/env
# Rob types the values himself:  nano /etc/realms-foreman/env

docker build --build-arg FOREMAN_UID=1500 -t realms-foreman:pilot ops/foreman
install -m 644 ops/foreman/systemd/realms-*.{service,timer} /etc/systemd/system/   # includes realms-triage (#717)
systemctl daemon-reload

# Dry run: one issue, no push, no GitHub writes. Output goes to runner/state/dry-run-<N>/
bash -c 'exec docker run --rm --cpus 2 --memory 4g --env-file <(grep -E "^GH_TOKEN=" /etc/realms-foreman/env) \
  --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER --cap-add SETUID --cap-add SETGID \
  --security-opt no-new-privileges -v /var/lib/realms-foreman/runner:/work \
  realms-foreman:pilot catjam-runner.sh --dry-run --issue 446'

systemctl enable --now realms-catjam-runner.timer realms-reviewer.timer

# Triager (#717): dry run on one issue first (no GitHub writes; result in reviewer/state/triage-dry-run/<N>.json)
bash -c 'exec docker run --rm --env-file <(grep -E "^(ANTHROPIC_API_KEY|GH_TOKEN)=" /etc/realms-foreman/env) \
  --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER --cap-add SETUID --cap-add SETGID \
  --security-opt no-new-privileges -v /var/lib/realms-foreman/reviewer:/work \
  realms-foreman:pilot triage.sh --dry-run --issue 568'
systemctl enable --now realms-triage.timer
```

Rebuild the image after any change to these scripts. The units run the copies baked into the image. The reviewer prompt is not baked in: it is read from `origin/main` on every run.

## Operating

- Logs: one line per job in `/var/lib/realms-foreman/runner/state/catjam-runner.log`, and one line per review in `/var/lib/realms-foreman/reviewer/state/review.log`. Neither holds secret values.
- API spend ledger: `reviewer/state/spend.log`, one line per claude call: time, UTC date, PR, USD, head sha8, result, and `models=<ids>`, the model ids billed for that call (from `modelUsage` in the claude JSON). If the costliest model is not the tier's model (`REVIEW_EXPECT_MODEL_RE` for Sonnet, `REVIEW_SMALL_EXPECT_MODEL_RE` for Haiku), the row says `model-mismatch`, nothing is posted, and the tick stops.
- Tiers (#663 item 5): Haiku (`REVIEW_SMALL_MODEL`) is opt-in. A PR gets it only when it has at most 300 changed lines (additions + deletions, `REVIEW_SMALL_MAX_LINES`) and every path, old names of renames included, is on the light allow list (`LIGHT_RE`: `docs/`, READMEs, `src/components/ui/`, `src/pages/`, `src/styles/`, and the tests inside them) and off both deny lists (`HEAVY_RE` for DM names; `HEAVY_I_RE` for combat, tactical, dungeon master, migrations, `db/schema`, drizzle, `ops/`, auth/session/token/secret/crypto, stripe/billing/payment/pricing/checkout/subscription/webhook, middleware, rls/permission/policy, admin, Dockerfile, deploy, `.env`, package.json, bun.lock, `.sql`, `.sh`). Every other PR, and any PR whose size or file list cannot be read, gets Sonnet. `review.log` records `tier=` and `model=` for each review, with the path that decided a Sonnet tier.
- Author never judges (#662): the bot does not review a PR whose author model (a `model:` / `author-model:` line or `Co-Authored-By:` name in the body or commits) is in the same family as the reviewer model. It checks before the paid call (a $0 ledger row `author-model-skip`) and again on the model billed, labels the PR `needs-other-reviewer`, and moves on.
- Budget: at most $1.50 per review (`REVIEW_PER_PR_USD`), $5.00 per UTC day (`REVIEW_DAILY_CAP_USD`), 12 reviews per tick (`REVIEW_MAX_PRS`), and no new review starts after 40 minutes (`REVIEW_TICK_MINUTES`; the unit allows 100). A call with no reported cost is charged its full per-PR budget. A PR head gets at most 2 attempts (`REVIEW_MAX_ATTEMPTS`) without a posted verdict, then it is skipped until the head changes. A diff that cannot be fetched counts as a $0 attempt; on the last one the bot comments and labels the PR `needs-human`. The daily summary shows today's spend and models, and the $99 credit used since 2026-10-14, what is left and the burn per day until it expires on 2026-11-02 (`REVIEW_CREDIT_*`).
- Signature: every bot verdict comment and its COMMENT review end with the line `— posted by the foreman reviewer bot (Sonnet)` or `(Haiku)`, after the tier (`BOT_SIGNATURE`), so Muse can tell bot verdicts from the human strategist's. The script adds it; any line the model wrote that starts with `— posted by the foreman reviewer bot` is removed first.
- Scope: the bot reviews every open same-repo PR except release-please, a draft whose body says WIP, and any PR that changes `.github/`, `.husky/`, `ops/foreman/`, `ops/claude-hooks/`, migrations or `docs/ops/review_prompt.md` (also through a rename). Those stay with the human strategist; each is logged once per head as `skip-scope <reason>` in `review.log`. If the file list cannot be read, the PR is skipped (fail closed). `review.sh --dry-run --pr N` can still try any PR.
- Runner checks: tsc (`-p tsconfig.app.json`) runs one at a time under `state/tsc.lock`. A new job first records tsc on its main commit in `state/tc-baseline/<sha>.txt` (first line `# tsc exit <rc>`; not cached when tsc did not finish). The typecheck fails on errors in changed files and on any error main does not have. Tests: those named after changed files; for deleted files, the nearest remaining tests plus a `git grep` for `@/` imports of the deleted modules. A test file may be deleted only when the issue's task lists it; the runner refuses any other test deletion.
- Timeouts: opencode 45m, each bun install / tsc / test step 15m, `claude -p` 20m. On TERM/INT (unit timeout, `docker stop`) the runner kills its jobs, removes their worktrees, and moves `catjam-wip`/`catjam-fix` to `needs-human`. Each tick also recovers jobs left behind by a hard kill, and any `catjam-wip` issue with no open catjam PR.
- The summary also shows the merge rate over the last 24 h, as merges per hour against the target (`REVIEW_MERGE_TARGET_PER_HOUR`, default 20) with the peak hour, and the median time from PR open to merge. Both come from one paginated GitHub search for merged PRs, so the merged list is no longer cut at 100.
- The daily summary posts on the first tick of the 11:xx UTC hour, before the pre-check and the reviews. A per-day marker is checked before the summary is built, so the other 11:xx ticks cost nothing.
- Triage (#717): open `bug` issues with no "## Task" heading and none of `catjam`, `jules`, `needs-crew`, `triaged`, `needs-human` (a heading indented up to 3 spaces counts); oldest first, at most 6 per run (`TRIAGE_MAX_ISSUES`), $0.50 each (`TRIAGE_PER_ISSUE_USD`), inside the reviewer's $5/day cap (same `spend.log`, rows `issue=<n> ... triage=<route>`). A run stops when less than the per-issue $0.50 of the daily cap is left. The cap is soft: a triage run and a review can be in flight at the same time, so their in-flight budgets together can pass $5 by up to one call each. An issue cross-referenced by an open PR is skipped before any model call. Claude gets only Read/Grep/Glob over a read-only export of main (no `public/`, no images), the issue as data and the open PRs' file list. The script picks the route (`triage_route` in `lib.sh`): hot combat files (`combat-resolution-step.ts`, `DynamicOptionsSection.tsx`, `combat-intent-service.ts`), migrations, `.github/`, `ops/`, a file in an open PR, no files or no reproducing test give `needs-crew` plus a one-line comment; catjam over 4 files gives `jules`. Task text is appended under "## Task (catjam)" or "## Task for Jules" with headings demoted, @mentions and HTML comments stripped; every `files[]` entry must be a plain path (`triage_files_ok`), or the issue goes to `needs-crew`; an answer with a secret, an email or an IP is dropped. Every decided issue gets `triaged`. A task that asks to delete or remove tests goes to `needs-crew` (`triage_task_deletes_tests`). An issue with 2 paid calls and no decision (`TRIAGE_MAX_ATTEMPTS`) gets `needs-human` on the last one and is skipped after that. The mirror fetch, the archive of main and the open-PR file list run only when there is an issue to triage. Log: `reviewer/state/triage.log`, one line per issue and one `run triaged=N catjam=a jules=b crew=c` line per run; the daily summary adds the 24 h total.
- Pause: `systemctl stop realms-catjam-runner.timer realms-reviewer.timer realms-triage.timer realms-pulse.timer`.
- Overrides go in a unit drop-in as `-e` flags, e.g. `CATJAM_MODEL`, `CATJAM_MAX_JOBS` (2), `CATJAM_JOB_TIMEOUT` (45m), `CATJAM_MAX_FIX_ROUNDS` (3), `REVIEW_MODEL` (sonnet), `REVIEW_SMALL_MODEL` (haiku), `REVIEW_SMALL_MAX_LINES` (300), `REVIEW_MAX_PRS` (12), `REVIEW_PER_PR_USD` (1.50), `REVIEW_DAILY_CAP_USD` (5.00), `REVIEW_TICK_MINUTES` (40).
- One-off: `review.sh --dry-run --pr N`, `review.sh --summary-dry-run`, `review.sh --slack-test`.

## Pulse (Rob's phone view)

`pulse.sh` makes no model calls and costs $0. `realms-pulse.timer` runs it every 5 min from 12:00Z to 05:00Z (Rob's 7 AM to midnight). It reads only the GitHub API, prod `/version` and the reviewer's `state/` (ledger and triage log, mounted read-only), and posts Slack-style `{"text": ...}` to `PULSE_WEBHOOK_URL`.

- The pulse posts on the :00 and :30 ticks, at most 12 lines:
  - merges in the last hour and 24 h against the 20/hour target, with the median open→merge time;
  - PASS-at-head PRs not merged, with the oldest wait; PRs with no verdict at head; FIX PRs waiting on authors;
  - open PRs by lane (`catjam/`, Jules, `lane-*` = Muse, `codex/`, other);
  - open `catjam` / `jules` issues with no open PR;
  - main CI at main's head, prod `/version` status and build age, the newest "Post-deploy smoke FAILED" comment on #229 in 7 days;
  - foreman spend today, credit left, and the 24 h triage counts.
- Alerts post on any tick, then at most once an hour while they last:
  - main CI red;
  - `/version` not 200;
  - a PASS waiting more than 45 min (`PULSE_PASS_WAIT_MIN`; waits over 1 h are marked);
  - no merge in 2 h while PASS PRs wait (`PULSE_NO_MERGE_MIN`);
  - the foreman daily cap hit.
- Alert state is kept in `/var/lib/realms-foreman/pulse/state/alerts.state`. A cleared alert is forgotten, so it posts at once the next time.
- The container gets only `GH_TOKEN` and `PULSE_WEBHOOK_URL`, `--cap-drop ALL`, 1 CPU and 512 MB.

```bash
install -d -m 700 /var/lib/realms-foreman/pulse
# Rob adds PULSE_WEBHOOK_URL=<url> to /etc/realms-foreman/env himself.
docker build --build-arg FOREMAN_UID=1500 -t realms-foreman:pilot ops/foreman
bash -c 'exec docker run --rm --env-file <(grep -E "^GH_TOKEN=" /etc/realms-foreman/env) \
  -v /var/lib/realms-foreman/pulse:/work -v /var/lib/realms-foreman/reviewer/state:/reviewer-state:ro \
  realms-foreman:pilot pulse.sh --dry-run'
install -m 644 ops/foreman/systemd/realms-pulse.{service,timer} /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now realms-pulse.timer
```

Tests: `bash ops/tests/foreman-pulse.sh`.
