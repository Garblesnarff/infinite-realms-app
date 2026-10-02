# Production deploy gate

`auto-deploy.sh` is the canonical host deploy script. Install or invoke this tracked copy from the existing deploy cron. It preserves the current single-writer behavior (`git reset --hard origin/main`, then PM2 restart) and runs the full API journey after the process binds port 8888.

After the deploy it runs `ops/smoke.sh` (below) when that is configured, and never rolls back automatically. Failures page through `SLACK_ALERT_WEBHOOK_URL` (from `/etc/infiniterealms/alerts.env`) and `/var/log/infiniterealms/alerts.log`, rate-limited, and exit non-zero for cron mail.

(This paragraph used to say the script sources `/etc/infiniterealms/llm-smoke.env` and runs the full API journey, with `INFINITE_REALMS_*`, `BUN_BIN`, `PM2_PROCESS` and `API_SMOKE_ENV_FILE` overrides. The tracked script at `200a8957` does none of that; the six-hour `scripts/api-smoke.ts` journey is a separate cron, see `ai-adventure-scribe-main/docs/LLM_PROVIDER_RESILIENCE.md`. The overrides it really takes are the `DEPLOY_*` ones named below.)

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

### Is a run open? `run-status.sh`

The merger asks the same question the cron does with one call (#2224):

```bash
$ ops/run-status.sh
run: open — run 9 started 12m ago (#2093: run 9 started — session …)
newest: run 9 started
```

Exit status: `0` no open run (the cron would deploy), `1` open run (the cron
holds), `2` GitHub could not be read (`run: unknown`). It applies the cron's 3h
cut-off, so an unmatched `started` older than that prints `run: closed — …
auto-deploy ignores it`. `open_run`, `newest_run`, `newest_run_detail` and the
`DEPLOY_RUN_*` defaults are read out of the sibling `auto-deploy.sh` rather
than copied (it is installed on the host as a single file, so there is no
shared library to source). The same `DEPLOY_RUN_*` / `DEPLOY_GH_BIN` overrides
apply; `RUN_STATUS_DEPLOY_SCRIPT` points it at a different `auto-deploy.sh`.
Cases: `bash ops/tests/run-status.sh`.

### Merge-train hold

A multi-PR merge train deploys once only if every merge lands inside one
15-minute cron window; a train that straddles a tick deploys twice, with a
restart in between. The merger holds the cron for the whole train:

```bash
touch /var/lib/infiniterealms-deploy/TRAIN   # before the first merge
rm /var/lib/infiniterealms-deploy/TRAIN      # after the last merge
```

While the file is under `DEPLOY_TRAIN_STALE_SECONDS` (default 3600 = 60 min)
old, the script logs `hold train: … present (Nm)` and exits 0 without fetching,
building or restarting; `--deploy-now` exits 1, as for the other holds. The
next tick after `rm` deploys the whole train at once.

A TRAIN file older than that is treated as forgotten: the script logs
`ALERT: ignoring stale …` and deploys anyway, and a rate-limited `train` alert
pages Slack until the file is removed (then RECOVERED). With no TRAIN file the
cron path is byte-for-byte unchanged. The test checks this by running the
script with the block cut out and diffing log, exit status, commands and state
files. Path override: `DEPLOY_TRAIN_FILE`. Cases:
`bash ops/tests/merge-train-hold.sh` (needs bash, git, jq; runs the real script
against a scratch repo with stub bun/pm2/gh).

## Post-deploy smoke: `smoke.sh` (#2293)

#2250 shipped a client save the server refused (422) on every narrative roll,
and nothing on prod noticed for about a day (#2280): no step after a deploy
ever wrote a message. Right after `Deploy complete (<sha>)`, auto-deploy now
runs `ops/smoke.sh <sha>` **if `/etc/infiniterealms/smoke.env` exists**. Until
that file is installed the cron path is byte-for-byte unchanged (the test cuts
every `post-deploy smoke` block out and diffs log, exit status, commands and
state files).

As a **dedicated smoke account** (never a tester's or player's), with no LLM
call, it:

1. polls `GET /version` (up to 120 s while pm2 starts) until it reports the
   deployed commit;
2. signs in (`POST /v1/auth/password-login`), creates a throwaway campaign
   (`ops smoke <sha8> <time>`) and a session on it, and saves a player message;
3. saves a DM reply with `rollRequests` in context and non-empty text: the
   #2280 wire body, `RUN_11_INSIGHT.wireBody` from #2286's shared fixture
   `ai-adventure-scribe-main/shared/test-fixtures/dm-roll-reply-saves.ts` (read
   with `bun`; only the id and timestamp change), so the smoke and the route
   tests share one source;
4. saves the roll-result message;
5. reads the history back: 3 rows, in order, text intact, `rollRequests` kept;
6. deletes the campaign (which cascades to the session and its messages) and
   checks the session is gone.

**On any failure** it writes one alert line (the `DEPLOY FAILED: smoke — step N
(…): HTTP <status> — <server's reason>` format, to `alerts.log` + Slack), posts
**one** comment on #2093 with the step and HTTP status, and creates the hold
file **`/var/lib/infiniterealms-deploy/SMOKE_FAILED`**. Nothing is rolled
back. The failed campaign is left for inspection; the next passing run deletes
any `ops smoke …` campaign it finds.

While `SMOKE_FAILED` exists, auto-deploy logs `hold smoke: … present (<the
failure>)` and deploys nothing, like TRAIN, but it **never goes stale**: a
human removes it after checking prod (or after a revert). `--deploy-now`
refuses with exit 1. The alert repeats at most hourly while held, and removing
the file clears it to RECOVERED. If `smoke.env` exists but `smoke.sh` does not,
or `smoke.sh` fails without writing the hold (it could not run at all), the
deploy is not held and a `smoke_setup` alert fires instead.

The env file holds only `SMOKE_EMAIL` and `SMOKE_PASSWORD` (root, 0600). The
script never prints them or the access token, never puts them on a command line
(the login body and the `Authorization` header go to curl as 0600 files in a
temp dir removed on exit), and never echoes the sign-in response. Requests carry
the user agent `infiniterealms-smoke/1 …` so `http-alarm.sh` can leave them out.

Try it by hand without holding anything: `ops/smoke.sh --no-hold [<sha>]`
(it reports and exits 1 on failure, with no hold, alert or comment).
`ts`/`post_slack`/`emit` and the `DEPLOY_*` alert, state and #2093 defaults are
read out of the sibling `auto-deploy.sh`, as `run-status.sh` does, so the alert
format is the cron's own. Overrides: `DEPLOY_SMOKE_ENV`, `DEPLOY_SMOKE_SCRIPT`,
`DEPLOY_SMOKE_HOLD_FILE`; for `smoke.sh` itself `SMOKE_API_BASE` (default
`https://api.infiniterealms.app`), `SMOKE_APP_DIR`, `SMOKE_FIXTURE`, `SMOKE_BUN`,
`SMOKE_VERSION_WAIT_SECONDS`, `SMOKE_POLL_SECONDS`. Cases:
`bash ops/tests/smoke.sh` (the script, with a stub curl API) and
`bash ops/tests/smoke-deploy.sh` (auto-deploy + smoke against a scratch repo).

## 422 / 5xx alarm: `http-alarm.sh` (#2293)

Elysia's validation 422s never reach the bun request log; #2280's were only in
nginx's `api-access.log`. `ops/http-alarm.sh` runs from cron every 15 minutes,
reads the last 15 minutes of `/var/log/nginx/api-access.log` (and `.1`, for the
midnight rotation), and counts 422 and 5xx per route (method + path, ids folded
to `:id`, query dropped). A route with **≥ 3 × 422** or **≥ 1 × 5xx** fires. All
firing routes go into **one** alert line (`HTTP ALARM: POST
/v1/sessions/:id/messages 3×422 …`) and **one** comment on #2093. A route that
fired stays quiet for an hour (`$STATE_DIR/http-alarm.state`). The smoke
account's requests are not counted, and the count of them is logged. Raw ids
and IPs never leave the box. It changes nothing.

It parses nginx's default `combined` format. If the log has lines but none
parse, it alerts `cannot parse …` (at most hourly) rather than going quietly
blind. Overrides: `HTTP_ALARM_LOGS`, `HTTP_ALARM_WINDOW_SECONDS`,
`HTTP_ALARM_422_MIN`, `HTTP_ALARM_5XX_MIN`, `HTTP_ALARM_REPEAT_SECONDS`, plus the
`DEPLOY_*` alert/state/#2093 ones. Cases: `bash ops/tests/http-alarm.sh`.

### Installing both (Hetzner, only on Rob's install line)

Nothing here is installed by merging. On Rob's install line:

1. Create the smoke account once, by signing up in the app with a dedicated
   address, and write `/etc/infiniterealms/smoke.env` (`SMOKE_EMAIL=…`,
   `SMOKE_PASSWORD=…`, `chmod 600`, root-owned).
2. Put `smoke.sh` and `http-alarm.sh` next to the `auto-deploy.sh` that cron
   runs, and install that `auto-deploy.sh` too.
3. Check on the box, with nothing changed: `head -1 /var/log/nginx/api-access.log`
   (it should be the combined format), `bash ops/tests/http-alarm.sh` and
   `bash ops/tests/smoke.sh` (they use the box's own awk, mawk), then
   `ops/smoke.sh --no-hold` against prod.
4. Add the cron line:
   `*/15 * * * * root /path/to/http-alarm.sh >> /var/log/infiniterealms/http-alarm.log 2>&1`

`smoke.sh` needs #2286 merged (it reads that fixture), and `GET /version` from
#2293's first PR deployed; without them every smoke fails and holds.

## Health watchdog: `server-watchdog.sh` (#2501)

The host's old `/usr/local/bin/server-watchdog.sh` (root cron, every 2 min) ran
`systemctl restart docker` whenever the 1-minute load stayed above 12 for 5
minutes. Load on this box is CI on the self-hosted runners plus deploy builds,
not a hung server, so it restarted every Supabase stack (prod DB down ~20 s) on
2026-09-29 02:06Z, 2026-09-30 00:22Z and 2026-10-02 03:24Z, and the restart
storm (load 38) re-armed it. It was paused on 2026-10-02.

`ops/server-watchdog.sh` acts on **health**, never on load. Each run (every 2
min) probes, each under a timeout (`WATCHDOG_CHECK_TIMEOUT`, default 10 s):

| probe  | healthy when |
|--------|--------------|
| api    | `GET http://127.0.0.1:8888/version` is 200 with a `commit` |
| docker | `docker info` answers |
| db     | `docker exec supabase-db psql -U postgres -tAc 'select 1'` prints 1 |

Each keeps a count of consecutive failures. At **2** it alerts; at **3** it
restarts **only the failed unit**, at most one per run:

1. **docker**: `systemctl restart docker`, only when the daemon does not answer
   **and** postgres is down on `127.0.0.1:54321`. While postgres answers,
   Docker is never restarted; it alerts instead.
2. **db**: `docker restart supabase-db`, only when the daemon answers and
   postgres is down on its port. SELECT 1 failing while postgres answers (a slow
   `docker exec` under load, full connection slots) alerts and restarts nothing.

"Down" is asked of `pg_isready` on the host port, which does not go through
dockerd: **no response twice**, 5 s apart, each with a 30 s timeout. "Starting
up / shutting down / in recovery" (exit 1, e.g. crash recovery after a cgroup
OOM) and an attempt that does not finish (a box under heavy load) both count as
answering, so slow or recovering never triggers a restart.
3. **api**: `pm2 restart infiniterealms-bun`.

**Cooldown:** at most one restart per 30 min across all units; a unit that is
still failing inside it gets an alert and nothing else. A restart, failed or
not, starts the cooldown and a fresh count of 3. **Lock:** a run that finds
the previous one still running (`flock` on
`/var/lib/infiniterealms-deploy/server-watchdog.lock`) logs `skipped` and
exits; one held for 10+ min (a wedged run) alerts, at most hourly. Restart
commands run with the lock's fd closed, so a daemon they spawn cannot inherit
it. **Load and memory** are on every run's status line; load1 ≥ 12 for 10
min and memory ≥ 90% each alert (at most hourly, then RECOVERED), and neither
restarts or stops anything. The old 90%-memory branch that stopped GLP studio/
analytics/vector/imgproxy/meta is gone (it never fired; 0 auto-stops since
2026-03-12).

Every run prints one line, and every action its reason:

```
[2026-10-02 04:04:32] watchdog: load 13.77/13.00/10.02 mem 46% swap 98% | api FAIL 3/3 (HTTP 502 from http://127.0.0.1:8888/version) | docker ok | db ok
[2026-10-02 04:04:32] watchdog: alert: 🔴 WATCHDOG: restarting api: HTTP 502 from http://127.0.0.1:8888/version for 3 checks. Command: timeout -k 10 60 pm2 restart infiniterealms-bun
[2026-10-02 04:04:32] watchdog: running: timeout -k 10 60 pm2 restart infiniterealms-bun
```

Alerts go to `alerts.log` + Slack through `ts`/`post_slack`/`emit` and the
`DEPLOY_*` defaults read out of the sibling `auto-deploy.sh`, as `http-alarm.sh`
does, so it must sit next to that file. It evaluates only that block's
`VAR=${…}` lines and exits 2 if the block has changed shape. State (failure counts, last restart,
alert times) is `/var/lib/infiniterealms-deploy/server-watchdog.state`.

`--dry-run` runs every probe and prints `would run: …` / `would alert: …`
without restarting anything, writing `alerts.log` or paging Slack. Its counts
live in `server-watchdog.dry-run.state`, so it can run from cron for days as a
shadow. Any other argument exits 2 before probing.

Overrides: `WATCHDOG_API_URL`, `WATCHDOG_DB_CONTAINER`, `WATCHDOG_DB_HOST`,
`WATCHDOG_DB_PORT`, `WATCHDOG_PM2_APP`, `WATCHDOG_CHECK_TIMEOUT`,
`WATCHDOG_ALERT_AFTER`, `WATCHDOG_RESTART_AFTER`, `WATCHDOG_COOLDOWN_SECONDS`,
`WATCHDOG_LOAD_ALERT`, `WATCHDOG_LOAD_ALERT_SECONDS`, `WATCHDOG_MEM_ALERT_PCT`,
`WATCHDOG_DEPLOY_SCRIPT`, plus the `DEPLOY_*` alert/state ones. Cases:
`bash ops/tests/server-watchdog.sh` (stub curl/docker/pm2/systemctl/pg_isready;
replays the 2026-10-02 load, and simulates an API that 502s, refuses or hangs, a
DB that is down or only fails SELECT 1, a hung daemon with postgres up and
down, the cooldown, a failed restart, the lock, high memory and `--dry-run`).

### Install (Hetzner, only on Rob's line)

Nothing is installed by merging. The old watchdog's cron line stays commented
out (`# PAUSED 2026-10-02 …`) and `/usr/local/bin/server-watchdog.sh` is left
in place, unused.

```bash
cd /var/www/infiniterealms   # a checkout of the merged commit
# 1. back up the crontab
crontab -l > /root/crontab.bak-pre-2501-$(date -u +%Y%m%d%H%M%S)
# 2. install next to the host auto-deploy.sh
install -m 755 -o root -g root ops/server-watchdog.sh /var/www/infiniterealms/scripts/server-watchdog.sh
# 3. check on the box, changing nothing
bash ops/tests/server-watchdog.sh
DEPLOY_STATE_DIR=$(mktemp -d) /var/www/infiniterealms/scripts/server-watchdog.sh --dry-run
#    expect one line ending "| api ok | docker ok | db ok"
```

4. Add one line to root's crontab (`crontab -e`), below the paused one. The log
   is under `/var/log/infiniterealms/`, so the existing logrotate rule covers it.
   Optional shadow first, a day or two, then read the log for `would`:

   ```
   */2 * * * * /var/www/infiniterealms/scripts/server-watchdog.sh --dry-run >> /var/log/infiniterealms/server-watchdog.log 2>&1
   ```

   Live:

   ```
   */2 * * * * /var/www/infiniterealms/scripts/server-watchdog.sh >> /var/log/infiniterealms/server-watchdog.log 2>&1
   ```

5. After the first two ticks: `tail -3 /var/log/infiniterealms/server-watchdog.log`.

### Rollback

Comment out the new line (`crontab -e`): no watchdog runs, as in the paused
state. Restoring `crontab /root/crontab.bak-pre-2501-<stamp>` does the same
but also undoes any other crontab edit made since the backup; diff first. Do not un-comment the old `/usr/local/bin`
line: that is the load-triggered Docker restart this replaces. To reset the
counters and cooldown, `rm /var/lib/infiniterealms-deploy/server-watchdog.state`.

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
`DEPLOY_TRAIN_FILE`, `DEPLOY_TRAIN_STALE_SECONDS`, `DEPLOY_SMOKE_HOLD_FILE`,
`DEPLOY_SMOKE_ENV`, `DEPLOY_SMOKE_SCRIPT`, `DEPLOY_STAGING_ROOT`.
