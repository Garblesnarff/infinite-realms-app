# Hands-off pilot: catjam-runner + realms-reviewer (#586)

Spec: issue #586. Reviewer prompt: `docs/ops/review_prompt.md`.

| Piece | File | Schedule |
|---|---|---|
| Coder: opencode + the free "cat jam" model (`opencode/cat-jam-free`) | `catjam-runner.sh` | `realms-catjam-runner.timer`, every 30 min |
| Reviewer: `claude -p`, Sonnet, API key | `review.sh` | `realms-reviewer.timer`, hourly at :50 UTC |
| Daily summary to Slack #last-24 and #230 | `review.sh` (11:50Z run) | same timer |
| Sandbox image (opencode + Claude Code live only here) | `Dockerfile` | — |

## Labels

- `catjam`: a maintainer queues the issue. Only maintainers can add labels, so strangers cannot queue work.
- `catjam-wip`: the runner is on it, or its draft PR is open.
- `catjam-done`: the model found nothing to change.
- `catjam-fix`: the reviewer posted FIX on the issue's `catjam/` PR, so the runner runs the next round.
- `needs-human`: more than 3 FIX re-runs, a refused diff (it touched `.github/`, added an `.env` file or something that looks like a secret), or a runner error.

## Sandbox

- Host user `foreman` (no sudo) owns `/etc/realms-foreman/env` (mode 600) and `/var/lib/realms-foreman`. The units run as root only to drive docker. Putting foreman in the `docker` group would make it root-equivalent.
- Container caps: `--cpus 2 --memory 4g`, lower CPU shares, a pids limit, `no-new-privileges`, and only the caps the scripts need to drop to foreman. The only mounts are `/var/lib/realms-foreman/{runner,reviewer}` and the runner state, which the reviewer mounts read-only. There is no `/var/www` mount and no prod env file.
- In the container the controller (root) holds the secrets. Repo and model code (bun install, opencode, tsc, tests, claude) runs as uid foreman. The runner gives it an empty environment. The reviewer passes only the Anthropic key and the GitHub token, and limits claude to read-only `gh` commands. The root controller runs git only with an explicit root-owned `GIT_DIR`, so nothing the model writes in the worktree is ever executed with the token.
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
docker run --rm --cpus 2 --memory 4g --env-file /etc/realms-foreman/env \
  --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER --cap-add SETUID --cap-add SETGID \
  --security-opt no-new-privileges -v /var/lib/realms-foreman/runner:/work \
  realms-foreman:pilot catjam-runner.sh --dry-run --issue 446

systemctl enable --now realms-catjam-runner.timer realms-reviewer.timer
```

Rebuild the image after any change to these scripts. The units run the copies baked into the image. The reviewer prompt is not baked in: it is read from `origin/main` on every run.

## Operating

- Logs: one line per job in `/var/lib/realms-foreman/runner/state/catjam-runner.log`, and one line per review in `/var/lib/realms-foreman/reviewer/state/review.log`. Neither holds secret values.
- API spend ledger: `reviewer/state/spend.log`. The reviewer stops for the UTC day at `REVIEW_DAILY_USD` (default $3). Also set a hard $90/month limit in the Anthropic console.
- Pause: `systemctl stop realms-catjam-runner.timer realms-reviewer.timer`.
- Overrides go in a unit drop-in as `-e` flags, e.g. `CATJAM_MODEL`, `CATJAM_MAX_JOBS` (2), `CATJAM_JOB_TIMEOUT` (45m), `CATJAM_MAX_FIX_ROUNDS` (3), `REVIEW_MODEL` (sonnet), `REVIEW_MAX_PRS` (8), `REVIEW_PER_PR_USD` (0.75).
- One-off: `review.sh --dry-run --pr N`, `review.sh --summary-dry-run`, `review.sh --slack-test`.
