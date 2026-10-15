# Hands-off pilot: catjam-runner + realms-reviewer (#586)

Spec: issue #586. Reviewer prompt: `docs/ops/review_prompt.md`.

| Piece | File | Schedule |
|---|---|---|
| Coder: opencode + the free "cat jam" model (`opencode/cat-jam-free`) | `catjam-runner.sh` | `realms-catjam-runner.timer`, every 30 min |
| Reviewer: `claude -p`, Haiku or Sonnet by tier, API key | `review.sh` | `realms-reviewer.timer`, hourly at :50 UTC |
| Daily summary to Slack #last-24 and #230 | `review.sh` (11:50Z run) | same timer |
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
install -m 644 ops/foreman/systemd/realms-*.{service,timer} /etc/systemd/system/
systemctl daemon-reload

# Dry run: one issue, no push, no GitHub writes. Output goes to runner/state/dry-run-<N>/
bash -c 'exec docker run --rm --cpus 2 --memory 4g --env-file <(grep -E "^GH_TOKEN=" /etc/realms-foreman/env) \
  --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER --cap-add SETUID --cap-add SETGID \
  --security-opt no-new-privileges -v /var/lib/realms-foreman/runner:/work \
  realms-foreman:pilot catjam-runner.sh --dry-run --issue 446'

systemctl enable --now realms-catjam-runner.timer realms-reviewer.timer
```

Rebuild the image after any change to these scripts. The units run the copies baked into the image. The reviewer prompt is not baked in: it is read from `origin/main` on every run.

## Operating

- Logs: one line per job in `/var/lib/realms-foreman/runner/state/catjam-runner.log`, and one line per review in `/var/lib/realms-foreman/reviewer/state/review.log`. Neither holds secret values.
- API spend ledger: `reviewer/state/spend.log`, one line per claude call: time, UTC date, PR, USD, head sha8, result, and `models=<ids>`, the model ids billed for that call (from `modelUsage` in the claude JSON). If the costliest model is not the tier's model (`REVIEW_EXPECT_MODEL_RE` for Sonnet, `REVIEW_SMALL_EXPECT_MODEL_RE` for Haiku), the row says `model-mismatch`, nothing is posted, and the tick stops.
- Tiers (#663 item 5): Haiku (`REVIEW_SMALL_MODEL`) is opt-in. A PR gets it only when it has at most 300 changed lines (additions + deletions, `REVIEW_SMALL_MAX_LINES`) and every path, old names of renames included, is on the light allow list (`LIGHT_RE`: `docs/`, READMEs, `src/components/ui/`, `src/pages/`, `src/styles/`, and the tests inside them) and off both deny lists (`HEAVY_RE` for DM names; `HEAVY_I_RE` for combat, tactical, dungeon master, migrations, `db/schema`, drizzle, `ops/`, auth/session/token/secret/crypto, stripe/billing/payment/pricing/checkout/subscription/webhook, middleware, rls/permission/policy, admin, Dockerfile, deploy, `.env`, package.json, bun.lock, `.sql`, `.sh`). Every other PR, and any PR whose size or file list cannot be read, gets Sonnet. `review.log` records `tier=` and `model=` for each review, with the path that decided a Sonnet tier.
- Budget: at most $1.50 per review (`REVIEW_PER_PR_USD`), $5.00 per UTC day (`REVIEW_DAILY_CAP_USD`), 12 reviews per tick (`REVIEW_MAX_PRS`), and no new review starts after 40 minutes (`REVIEW_TICK_MINUTES`; the unit allows 100). A call with no reported cost is charged its full per-PR budget. A PR head gets at most 2 attempts (`REVIEW_MAX_ATTEMPTS`) without a posted verdict, then it is skipped until the head changes. A diff that cannot be fetched counts as a $0 attempt; on the last one the bot comments and labels the PR `needs-human`. The daily summary shows today's spend and models, and the $99 credit used since 2026-10-14, what is left and the burn per day until it expires on 2026-11-02 (`REVIEW_CREDIT_*`).
- Signature: every bot verdict comment and its COMMENT review end with the line `— posted by the foreman reviewer bot (Sonnet)` or `(Haiku)`, after the tier (`BOT_SIGNATURE`), so Muse can tell bot verdicts from the human strategist's. The script adds it; any line the model wrote that starts with `— posted by the foreman reviewer bot` is removed first.
- Scope: the bot reviews every open same-repo PR except release-please, a draft whose body says WIP, and any PR that changes `.github/`, `.husky/`, `ops/foreman/`, `ops/claude-hooks/`, migrations or `docs/ops/review_prompt.md` (also through a rename). Those stay with the human strategist; each is logged once per head as `skip-scope <reason>` in `review.log`. If the file list cannot be read, the PR is skipped (fail closed). `review.sh --dry-run --pr N` can still try any PR.
- Runner checks: tsc (`-p tsconfig.app.json`) runs one at a time under `state/tsc.lock`. A new job first records tsc on its main commit in `state/tc-baseline/<sha>.txt` (first line `# tsc exit <rc>`; not cached when tsc did not finish). The typecheck fails on errors in changed files and on any error main does not have. Tests: those named after changed files; for deleted files, the nearest remaining tests plus a `git grep` for `@/` imports of the deleted modules. A test file may be deleted only when the issue's task lists it; the runner refuses any other test deletion.
- Timeouts: opencode 45m, each bun install / tsc / test step 15m, `claude -p` 20m. On TERM/INT (unit timeout, `docker stop`) the runner kills its jobs, removes their worktrees, and moves `catjam-wip`/`catjam-fix` to `needs-human`. Each tick also recovers jobs left behind by a hard kill, and any `catjam-wip` issue with no open catjam PR.
- The summary also shows the merge rate over the last 24 h, as merges per hour against the target (`REVIEW_MERGE_TARGET_PER_HOUR`, default 20) with the peak hour, and the median time from PR open to merge. Both come from one paginated GitHub search for merged PRs, so the merged list is no longer cut at 100.
- The 11:50Z summary is decided when the tick starts and posts before the reviews, so long reviews cannot push it past the hour.
- Pause: `systemctl stop realms-catjam-runner.timer realms-reviewer.timer`.
- Overrides go in a unit drop-in as `-e` flags, e.g. `CATJAM_MODEL`, `CATJAM_MAX_JOBS` (2), `CATJAM_JOB_TIMEOUT` (45m), `CATJAM_MAX_FIX_ROUNDS` (3), `REVIEW_MODEL` (sonnet), `REVIEW_SMALL_MODEL` (haiku), `REVIEW_SMALL_MAX_LINES` (300), `REVIEW_MAX_PRS` (12), `REVIEW_PER_PR_USD` (1.50), `REVIEW_DAILY_CAP_USD` (5.00), `REVIEW_TICK_MINUTES` (40).
- One-off: `review.sh --dry-run --pr N`, `review.sh --summary-dry-run`, `review.sh --slack-test`.
