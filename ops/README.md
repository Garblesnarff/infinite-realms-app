# Production deploy gate

`auto-deploy.sh` is the canonical host deploy script. Install or invoke this tracked copy from the existing deploy cron. It preserves the current single-writer behavior (`git reset --hard origin/main`, then PM2 restart) and runs the full API journey after the process binds port 8888.

The script sources `/etc/infiniterealms/llm-smoke.env`, requires authenticated checks, and never rolls back automatically. A failure names the checks and deployed SHA, sends the exact manual rollback command to `SLACK_ALERT_WEBHOOK_URL`, and exits non-zero. Without a working webhook it also writes `/var/log/infiniterealms/DEPLOY_FAILED_SMOKE` for cron mail and operator inspection.

Supported host overrides are `INFINITE_REALMS_REPO_ROOT`, `INFINITE_REALMS_APP_DIR`, `INFINITE_REALMS_LOG_DIR`, `BUN_BIN`, `PM2_PROCESS`, and `API_SMOKE_ENV_FILE`.

## Flags

The cron invokes the script with no arguments and gets exactly the behavior it
always had. Two flags exist for operators:

```bash
auto-deploy.sh --dry-run       # report what a run would do; change nothing
auto-deploy.sh --deploy-now    # rebuild/restart/republish even with no new commits
```

`--dry-run` routes every production-touching command through a wrapper that
prints it instead of running it: no `git reset`, no `bun install`, no build, no
`pm2 restart`, no publish into `dist/`, no state files and no Slack. This is
what the `DEPLOY_*` overrides only looked like they provided (#2124) — they
never covered the hardcoded `pm2 restart infiniterealms-bun`, so a
"verification" run restarted production on 2026-09-20 when `origin/main` moved
between the setup and the script's own fetch. A dry run's only side effects are
`git fetch` and `mkdir -p` of the state dir.

`--deploy-now` is for the gap between a merge and the next quarter-hour tick,
and for a `dist/`-versus-HEAD drift: it takes the full deploy path even when
`origin/main` has not moved. It skips `git reset` when the heads are identical
(nothing to reset to, and that is the one step that can destroy state), and it
does **not** override the two refusals that exist for safety — a local HEAD
that is not an ancestor of `origin/main`, and the hold below.

An unrecognised argument is a hard error (exit 2), so a typo'd `--dryrun` can
never perform a real deploy.

## Pausing deploys

The cron fires every 15 minutes unconditionally. To hold deploys — during a
stranger-test run, or while investigating prod — create the pause file:

```bash
touch /var/lib/infiniterealms-deploy/HOLD    # hold
rm /var/lib/infiniterealms-deploy/HOLD       # resume
```

While it exists the script logs `Held: ... present` and exits 0 without
fetching, building, or restarting anything. Playtest owns this file for the
duration of a run: `touch` when posting `run N started`, `rm` at `run N ended`.

`--deploy-now` does not override the hold. A stranger-test run is exactly the
thing the hold protects (#2093), so the flag exits 1 with a refusal rather than
exiting 0 as the cron path does — a human typed the command and is reading the
output, and a silent success would read as "deployed". Remove the hold first.

A hold older than `DEPLOY_HOLD_STALE_SECONDS` (default 10800 = 3h) raises a
rate-limited Slack alert, because a forgotten hold is indistinguishable from a
healthy quiet deploy log — that is the shape of the 2026-05-12 drift. Removing
the file clears the alert to RECOVERED.

### Open run on #2093

The HOLD file only works if Playtest remembers to `touch` it, so the script
also reads #2093's comments (via the box's existing `gh` login; the token is
never printed). The newest `run N started` with no later `run N ended` is
treated exactly like HOLD if it is under `DEPLOY_RUN_HOLD_MAX_AGE_SECONDS`
(default 10800 = 3h) old: it logs `Held: run N in progress (...)` with the
comment's first line (session id, bundle) and exits 0, and `--deploy-now` exits
1. An unmatched `started` older than that is logged as `Ignoring run N` and the
deploy proceeds, so a forgotten `ended` cannot stall prod past 3h.

Run ids are digits with an optional one-letter prefix (`run 9`, Muse's
`run M3`), matched case-insensitively; `run M2 started` pairs with
`run m2 ended`. Markers are matched anywhere in a comment, so a prose mention
of "run 9 started" on #2093 arms a 3h hold: keep those words to the testers'
own marker comments. Fixture cases: `bash ops/tests/open-run-markers.sh`
(needs only bash + jq).

`--dry-run` also names the newest marker it found, so "no open run" is visible
rather than inferred from silence (#2201):
`[dry-run] would record_state run_check ok — newest: run 9 ended` (or
`newest: no run markers on #2093`). The cron path does not make that extra
read. Fixture cases: `bash ops/tests/newest-run-marker.sh`.

If GitHub cannot be read, the deploy proceeds on the HOLD file alone and a
rate-limited `run_check` alert fires. Overrides: `DEPLOY_RUN_ISSUE`,
`DEPLOY_RUN_REPO`, `DEPLOY_RUN_HOLD_MAX_AGE_SECONDS`, `DEPLOY_GH_BIN`.

## Rollback of the publish step

Before publishing, the live `dist/` is hardlink-snapshotted to
`/var/lib/infiniterealms-deploy/dist.prev`. If the publish rsync fails — the
one branch that leaves the server new and the docroot old-or-partial — the
snapshot is swapped back automatically, so prod stays old-client/new-API and
serving rather than 404ing hashed chunks. The snapshot is kept after a
successful deploy as the fastest manual rollback:

```bash
rsync -a --delete /var/lib/infiniterealms-deploy/dist.prev/ \
  /var/www/infiniterealms/ai-adventure-scribe-main/dist/ &&
  chown -R www-data:www-data /var/www/infiniterealms/ai-adventure-scribe-main/dist
```

Additional host overrides: `DEPLOY_HOLD_FILE`, `DEPLOY_HOLD_STALE_SECONDS`,
`DEPLOY_STAGING_ROOT`.
