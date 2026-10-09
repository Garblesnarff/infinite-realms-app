# Repository cutover: infinite-realms-app

Phase 1 prepares PRIVATE `Garblesnarff/infinite-realms-app`; production remains on `Garblesnarff/infinite-realms-production`. Leave `Garblesnarff/infinite-realms` alone. `infinite-realms-clean` must remain private; prompts belong only in its `image-prompts/` directory. No license is granted by source visibility. Folder layout stays `ai-adventure-scribe-main/`.

## Phase 2 gates

RESTART 2 (#2729 comment 6082547669) supersedes earlier markers. DRAINED 6080658564 remains authoritative. Use a new private destination (ID 1411796647); the reviewed PR remains in the private bootstrap repository. Exclude `docs/ci-self-hosted-runner.md` from all history. Label synchronization upserts existing labels and removes destination-only defaults before issue transfer.

For the empty destination, publish prepared main with `[skip ci]` first, then wait for every checked-in workflow to register, disable every workflow, and assert none is active through the API before publishing tags or branches. Scan a fresh mirror of all published refs with stock gitleaks and the identity auditor using `--allow-relay-branches` before READY. Never import bootstrap commit objects. Only replace explicit owner/repository targets after SWITCHED; preserve `infinite-realms-production#NNNN` shorthand.


The overnight relay in source #2729 comment 6073528860 replaces the frozen-evening plan. This document prepares Phase 2; never execute it during Phase 1. One typed Rob line to Hetzner authorizes the origin, cron and deploy switch and runner removal. No public flip overnight. Source remains the source of truth until Rob flips visibility.

Poll SOURCE #2729 every five minutes. Read the latest relay marker, stop on `CUTOVER: STOPPED — <reason>`, and do not reuse an earlier marker from a previous attempt. Use these exact first lines:

1. Hetzner drains PASS + green heads one at a time under its standing authorization, releases/deploys, arms HOLD, and posts `CUTOVER: DRAINED` with the authoritative source main SHA and still-open PR numbers/head SHAs. No merges after DRAINED.
2. Worker validates that SHA, filters and prepares the destination, transfers issues, and rebases the still-open PR branches. Post `CUTOVER: NEW REPO READY` with destination SHA and mapping link.
3. Hetzner waits for READY and Rob's single typed line, switches, verifies one deployment and smoke, lifts HOLD, removes both runners, and posts `CUTOVER: HETZNER SWITCHED` with deploy SHA, smoke result and `runners removed: 2/2` only after the assertions below.
4. Worker waits for SWITCHED, updates repository targets in root and app copies of AGENTS.md and CLAUDE.md on new main with `[skip ci]`, then posts `CUTOVER: DONE — ROB FLIPS PUBLIC` and the morning checklist.
5. Rob flips public only after the 2/2 runner evidence, checks the first public PR's Actions, configures branch protection and archives the private source. No automatic release or merge by this worker.

Either participant posts `CUTOVER: STOPPED — <reason>` on failure; the other stops. Keep HOLD armed while investigating. Poll command (inspect marker and payload each time, maximum one request per five minutes):

```bash
gh api repos/Garblesnarff/infinite-realms-production/issues/2729/comments --paginate --jq '.[] | select(.body | startswith("CUTOVER:")) | {id,created_at,body}'
```

## Final source filter and preparation (Mac worker)

Use a NEW mirror after DRAINED; do not fetch unfiltered source history into the prepared mirror. Preserve the prep patch before replacing main. Use the reviewed PR #2 head as the prep tree, including Round 2 fixes. The smoke-test PR remains draft. Set DRAINED_SHA and DRAINED_PRS_FILE from the relay payload; the latter is TSV of PR number and exact head SHA.

```bash
set -euo pipefail
CUTOVER_DIR="$(mktemp -d /tmp/infinite-realms-cutover.XXXXXX)"
export CUTOVER_DIR
git clone https://github.com/Garblesnarff/infinite-realms-app.git "$CUTOVER_DIR/prep"
git -C "$CUTOVER_DIR/prep" fetch origin refs/heads/test/2729-hosted-cutover
# The bootstrap prep commit is main's tip; include it and reviewed PR fixes.
git -C "$CUTOVER_DIR/prep" diff origin/main^ FETCH_HEAD --binary > "$CUTOVER_DIR/prep.patch"
git -C "$CUTOVER_DIR/prep" checkout --detach FETCH_HEAD
: "${DRAINED_SHA:?copy the exact DRAINED main SHA}"
: "${DRAINED_PRS_FILE:?private TSV from DRAINED payload}"
test "$(git ls-remote https://github.com/Garblesnarff/infinite-realms-production.git refs/heads/main | cut -f1)" = "$DRAINED_SHA"
git clone --mirror https://github.com/Garblesnarff/infinite-realms-production.git "$CUTOVER_DIR/source.git"
test "$(git -C "$CUTOVER_DIR/source.git" rev-parse main)" = "$DRAINED_SHA"
while IFS=$'\t' read -r number expected_head; do
  test -n "$number" || continue
  [[ "$number" =~ ^[0-9]+$ && "$expected_head" =~ ^[0-9a-f]{40}$ ]]
  git -C "$CUTOVER_DIR/source.git" fetch origin "refs/pull/$number/head:refs/heads/cutover-pr-$number"
  test "$(git -C "$CUTOVER_DIR/source.git" rev-parse "cutover-pr-$number")" = "$expected_head"
done < "$DRAINED_PRS_FILE"
python3 "$CUTOVER_DIR/prep/docs/ops/filter-repo-cutover.py" "$CUTOVER_DIR/source.git" --keep-pr-heads
FILTERED_DRAINED_SHA="$(git -C "$CUTOVER_DIR/source.git" rev-parse main)"
# Save filtered PR tips outside the mirror, then prune temporary refs before audit.
git -C "$CUTOVER_DIR/source.git" for-each-ref --format='%(refname:short) %(objectname)' 'refs/heads/cutover-pr-*' > "$CUTOVER_DIR/filtered-pr-heads"
git clone "$CUTOVER_DIR/source.git" "$CUTOVER_DIR/rebases"
while read -r branch tip; do
  git -C "$CUTOVER_DIR/source.git" update-ref -d "refs/heads/$branch"
done < "$CUTOVER_DIR/filtered-pr-heads"
gitleaks git "$CUTOVER_DIR/source.git" --config "$CUTOVER_DIR/prep/docs/ops/stock-gitleaks.toml" --gitleaks-ignore-path /dev/null --ignore-gitleaks-allow --log-opts=--all --redact
python3 "$CUTOVER_DIR/prep/docs/ops/audit-filtered-history.py" "$CUTOVER_DIR/source.git"
git clone "$CUTOVER_DIR/source.git" "$CUTOVER_DIR/final"
git -C "$CUTOVER_DIR/final" apply --3way "$CUTOVER_DIR/prep.patch"
# If the current source changed workflow context, resolve it here and retain
# every current real-DB invocation. Stop on unknown conflicts; rerun validation.
cd "$CUTOVER_DIR/final"
python3 - <<'PYCONFIG'
import json, subprocess
from pathlib import Path
p = Path('release-please-config.json')
c = json.loads(p.read_text())
c['last-release-sha'] = subprocess.check_output(['git','rev-parse','v0.32.0^{}'], text=True).strip()
c['packages']['ai-adventure-scribe-main']['release-as'] = '0.33.0'
c['packages']['ai-adventure-scribe-main']['package-name'] = 'infinite-realms-app'
p.write_text(json.dumps(c, indent=2) + '\n')
PYCONFIG
export PATH="$HOME/.bun/bin:$PATH"
bun install --frozen-lockfile
(cd ai-adventure-scribe-main && bun install --frozen-lockfile && bun run lint && bun run type-check)
(cd ai-adventure-scribe-main/server-bun && bun install --frozen-lockfile && bun run test && bun run test:vitest)
(cd ai-adventure-scribe-main && bunx vitest run --testTimeout=20000 --hookTimeout=20000 && bun run build)
git add -A
git -c user.name=Garblesnarff -c user.email=Garblesnarff@users.noreply.github.com commit -m 'chore: prepare repository cutover [skip ci]'
git remote set-url origin https://github.com/Garblesnarff/infinite-realms-app.git
# Private overnight relay: no Actions events may execute on these pushes.
gh api repos/Garblesnarff/infinite-realms-app/actions/workflows > "$CUTOVER_DIR/workflows-before.json"
python3 - <<'PYPAUSE'
import json, os, subprocess
from pathlib import Path
# CUTOVER_DIR is exported for the private state file.
for workflow in json.loads((Path(os.environ['CUTOVER_DIR']) / 'workflows-before.json').read_text())['workflows']:
    subprocess.run(['gh','api','--method','PUT',
                    'repos/Garblesnarff/infinite-realms-app/actions/workflows/' + str(workflow['id']) + '/disable'], check=True)
PYPAUSE
# Relay-authorized final replacement; explicit refs only, never --mirror.
PREPARED_SHA="$(git rev-parse main)"
DESTINATION_MAIN_SHA="$(git ls-remote origin refs/heads/main | cut -f1)"
test -n "$DESTINATION_MAIN_SHA"
test "$(git ls-remote https://github.com/Garblesnarff/infinite-realms-production.git refs/heads/main | cut -f1)" = "$DRAINED_SHA"
ALLOW_MAIN_PUSH=1 git push --force-with-lease="refs/heads/main:$DESTINATION_MAIN_SHA" origin main:main
# Existing tags are rewritten because ancestry changed; the destination is private.
# Use an explicit expected-old lease for EACH tag, not unrestricted force.
python3 - <<'PYTAGS'
import subprocess
remote = dict(line.split('\t')[::-1] for line in subprocess.check_output(
    ['git','ls-remote','--refs','origin','refs/tags/*'], text=True).splitlines())
refs = subprocess.check_output(['git','for-each-ref','--format=%(refname)','refs/tags'], text=True).splitlines()
command = ['git','push','--atomic']
command += ['--force-with-lease=' + ref + ':' + remote.get(ref, '') for ref in refs]
command += ['origin'] + [ref + ':' + ref for ref in refs]
subprocess.run(command, check=True)
PYTAGS
# After publishing, re-check scan and identities on a fresh destination mirror.
```

Do not assume step 1's retained Discord decision is permanent: the filter helper verifies executable/config references again. Report source SHA, filtered SHA, count of refs, stock scan count and pack size. Carry the same disabled-workflow settings as the source; do not copy production secrets.

## Transfer issues (Mac worker)

```bash
set -euo pipefail
umask 077
gh api 'repos/Garblesnarff/infinite-realms-production/issues?state=open&per_page=100' --paginate --slurp > "$CUTOVER_DIR/open-issues-before.json"
chmod 600 "$CUTOVER_DIR/open-issues-before.json"
python3 docs/ops/transfer-open-issues.py
python3 docs/ops/transfer-open-issues.py --execute --map-file "$CUTOVER_DIR/issue-mapping.jsonl"
python3 - <<'PYCSV'
import csv, json, os
from pathlib import Path
records = [json.loads(line) for line in (Path(os.environ['CUTOVER_DIR']) / 'issue-mapping.jsonl').read_text().splitlines()]
path = Path('docs/ops/issue-map.csv')
with path.open('w', newline='') as output:
    writer = csv.DictWriter(output, fieldnames=['old_number','new_number','old_node_id','new_node_id','url'])
    writer.writeheader()
    writer.writerows(records)
print('Mapping rows:', len(records))
PYCSV
git add docs/ops/issue-map.csv
git -c user.name=Garblesnarff -c user.email=Garblesnarff@users.noreply.github.com commit -m 'docs: save cutover issue map [skip ci]'
ALLOW_MAIN_PUSH=1 git push --force-with-lease="refs/heads/main:$PREPARED_SHA" origin main:main
# Rebase filtered PR branches onto prepared main; push BRANCHES ONLY.
# Stop on conflicts and post STOPPED; never recreate PRs/full CI until public.
git -C "$CUTOVER_DIR/rebases" fetch "$CUTOVER_DIR/final" main
MAPPED_MAIN_SHA="$(git rev-parse main)"
while read -r branch tip; do
  git -C "$CUTOVER_DIR/rebases" checkout -B "$branch" "$tip"
  git -C "$CUTOVER_DIR/rebases" -c user.name=Garblesnarff -c user.email=Garblesnarff@users.noreply.github.com rebase --onto "$MAPPED_MAIN_SHA" "$FILTERED_DRAINED_SHA"
  git -C "$CUTOVER_DIR/rebases" push https://github.com/Garblesnarff/infinite-realms-app.git "HEAD:refs/heads/relay-${branch}"
done < "$CUTOVER_DIR/filtered-pr-heads"
# Re-run stock scan and identity audit on all published refs. No PRs or CI
# until Rob flips public and re-enables the core workflows.

```

The CSV contains numbers, node IDs and URLs only, never bodies. Link `docs/ops/issue-map.csv` at its immutable commit SHA from READY. Only open issues transfer, oldest first. #2093, #2184 and relay control #2729 stay in the private source repository. Preserve a private JSON snapshot of original issue IDs, numbers and bodies before transfer; the script fsyncs each old/new node-ID mapping BEFORE editing the body, verifies each transferred body and stops on failure. Keep the mapping private and link it from READY through a reviewed private artifact; never post original issue bodies. It prepends `Moved from infinite-realms-production#NNNN.`. Never rerun after a partial error without inspecting which transfers succeeded. Closed issues and PRs stay. Push rebased still-open PR branches only; recreate their PRs after public flip. Create a new ops log and a new test-status control issue in the destination; record their new numbers for the host environment overrides. The board maintainer alone updates the board.

## Hetzner hold, remote and host configuration (approved ops session only)

```bash
set -euo pipefail
umask 077
install -d /var/lib/infiniterealms-deploy
touch /var/lib/infiniterealms-deploy/HOLD
cd /var/www/infiniterealms
CUTOVER_HOST_BACKUP="/root/repo-cutover-$(date -u +%Y%m%d%H%M%S)"
mkdir -m 700 "$CUTOVER_HOST_BACKUP"
git rev-parse HEAD > "$CUTOVER_HOST_BACKUP/old-head"
git remote get-url origin > "$CUTOVER_HOST_BACKUP/old-origin"
crontab -l > "$CUTOVER_HOST_BACKUP/crontab"
cp scripts/auto-deploy.sh "$CUTOVER_HOST_BACKUP/auto-deploy.sh"
cp scripts/smoke.sh "$CUTOVER_HOST_BACKUP/smoke.sh"
# Configure the host's existing private Git credential helper first, or
# reconstruct its authenticated URL without echoing it; do not print the URL.
gh auth setup-git
# Verify the chosen helper under cron's minimal environment BEFORE origin changes.
env -i HOME="$HOME" PATH=/usr/local/bin:/usr/bin:/bin \
  git ls-remote https://github.com/Garblesnarff/infinite-realms-app.git refs/heads/main > "$CUTOVER_HOST_BACKUP/cron-auth-check"
test -s "$CUTOVER_HOST_BACKUP/cron-auth-check"
git remote set-url origin https://github.com/Garblesnarff/infinite-realms-app.git
git ls-remote origin refs/heads/main > "$CUTOVER_HOST_BACKUP/new-main"
test -s "$CUTOVER_HOST_BACKUP/new-main"
git fetch origin main
# Stop if tracked host edits are present; archive and resolve them explicitly.
test -z "$(git status --porcelain --untracked-files=no)"
# Rewritten history is deliberately unrelated; save old-head above first.
git reset --hard origin/main
```

The following HOST-only edits need Rob's single typed relay line naming `scripts/auto-deploy.sh` and root's deploy cron. `smoke.sh` and `http-alarm.sh` read the shared issue/repository defaults from their sibling deploy script; no extra default edits are needed. The tracked ops scripts remain unchanged in Phase 1. Create the replacement control issue and operations log after the transfer, while the destination is still private, and keep their numbers in the private cutover notes.

```bash
set -euo pipefail
NEW_CONTROL_ISSUE="$(gh api repos/Garblesnarff/infinite-realms-app/issues --method POST -f title='Deploy and test status' -f body='Cutover control issue; previous control remains in the private source repository.' --jq .number)"
NEW_OPS_LOG="$(gh api repos/Garblesnarff/infinite-realms-app/issues --method POST -f title='Operations log' -f body='Operations log after repository cutover; previous log remains in the private source repository.' --jq .number)"
export NEW_CONTROL_ISSUE CUTOVER_HOST_BACKUP
python3 - <<'PYHOST'
import os, re
from pathlib import Path
number = int(os.environ['NEW_CONTROL_ISSUE'])
backup = Path(os.environ['CUTOVER_HOST_BACKUP'])
script = Path('/var/www/infiniterealms/scripts/auto-deploy.sh')
text = script.read_text()
text, count = re.subn(r'^RUN_REPO=\$\{DEPLOY_RUN_REPO:-[^}]+\}$',
                     'RUN_REPO=${DEPLOY_RUN_REPO:-Garblesnarff/infinite-realms-app}', text, flags=re.M)
assert count == 1, 'unknown installed RUN_REPO; stop'
text, count = re.subn(r'^RUN_ISSUE=\$\{DEPLOY_RUN_ISSUE:-[0-9]+\}$',
                     'RUN_ISSUE=${DEPLOY_RUN_ISSUE:-' + str(number) + '}', text, flags=re.M)
assert count == 1, 'unknown installed RUN_ISSUE; stop'
cron = (backup / 'crontab').read_text()
lines = cron.splitlines()
found = 0
for i, line in enumerate(lines):
    if line.lstrip().startswith('#') or '/scripts/auto-deploy.sh' not in line:
        continue
    found += 1
    line = line.replace('Garblesnarff/infinite-realms-production', 'Garblesnarff/infinite-realms-app')
    line = re.sub(r'DEPLOY_RUN_REPO=[^\s]+\s*|DEPLOY_RUN_ISSUE=[0-9]+\s*', '', line)
    entry = re.fullmatch(r'(\s*(?:\S+\s+){5})(.+)', line)
    assert entry, 'expected standard five-field deploy schedule; stop'
    lines[i] = entry.group(1) + 'DEPLOY_RUN_REPO=Garblesnarff/infinite-realms-app DEPLOY_RUN_ISSUE=' + str(number) + ' ' + entry.group(2)
assert found == 1, 'expected one deploy cron line; stop and review installed cron'
reviewed = backup / 'crontab-reviewed'
reviewed.write_text('\n'.join(lines) + '\n')
reviewed.chmod(0o600)
script.write_text(text)
print('Updated one host deploy script and prepared one deploy cron line; schedules preserved.')
PYHOST
bash -n /var/www/infiniterealms/scripts/auto-deploy.sh
# Inspect the private crontab-reviewed file; never dump secrets into a report.
# Install only after Rob's approval covers these exact file edits.
crontab "$CUTOVER_HOST_BACKUP/crontab-reviewed"
# HOLD must still refuse deployment; this invocation performs no deploy.
/var/www/infiniterealms/scripts/auto-deploy.sh --dry-run
```

Record `NEW_OPS_LOG` for the deployment report. The installed cron is outside Git: the command preserves its schedule/logs and stops if its known deploy-script path is absent or appears more than once. Do not replace an unknown installation with an invented cron line. If root's cron has additional repository/issue overrides on monitors, inspect them privately and obtain approval for those exact edits as well. The hold blocks even `--deploy-now`; removing it is an explicit ops approval step.

```bash
set -euo pipefail
# Only after the approved host config and issue IDs are verified:
trap 'touch /var/lib/infiniterealms-deploy/HOLD' ERR INT TERM
rm /var/lib/infiniterealms-deploy/HOLD
/var/www/infiniterealms/scripts/auto-deploy.sh --deploy-now
curl --fail --silent https://api.infiniterealms.app/version | jq -e --arg expected "$(git rev-parse HEAD)" '.commit == $expected and .clientBuild == $expected and (.bundle != null)'
# Run the installed production smoke with its existing private environment.
/var/www/infiniterealms/scripts/smoke.sh
trap - ERR INT TERM
```

Compare /version to the destination deployment SHA and client bundle, verify HOLD refusal before removal, and record the deployment in the new ops log. The current tracked deploy script stages the bundle, restarts the server, then publishes it; preserve that order.

## Unregister BOTH production runners (Rob's single typed relay approval)

```bash
set -euo pipefail
trap 'touch /var/lib/infiniterealms-deploy/HOLD' ERR INT TERM
systemctl disable --now github-runner github-runner-2
for runner_dir in /opt/actions-runner /opt/actions-runner-2; do
  ACTIONS_RUNNER_INPUT_TOKEN="$(gh api -X POST repos/Garblesnarff/infinite-realms-production/actions/runners/remove-token --jq .token)"
  test -n "$ACTIONS_RUNNER_INPUT_TOKEN"
  export ACTIONS_RUNNER_INPUT_TOKEN
  (cd "$runner_dir" && sudo --preserve-env=ACTIONS_RUNNER_INPUT_TOKEN -u ghrunner ./config.sh remove --unattended)
  unset ACTIONS_RUNNER_INPUT_TOKEN
done
test "$(gh api repos/Garblesnarff/infinite-realms-production/actions/runners --jq .total_count)" = 0
test "$(gh api repos/Garblesnarff/infinite-realms-app/actions/runners --jq .total_count)" = 0
for service in github-runner github-runner-2; do
  state="$(systemctl show "$service" --property=ActiveState --value)"
  test "$state" = inactive
  test "$(systemctl is-enabled "$service" 2>/dev/null || :)" = disabled
done
rm -rf /opt/actions-runner /opt/actions-runner-2
rm -f /etc/systemd/system/github-runner.service /etc/systemd/system/github-runner-2.service
rm -f /etc/systemd/system/github-runner.service.d/10-slice.conf /etc/systemd/system/ci-runners.slice
systemctl daemon-reload
userdel ghrunner
trap - ERR INT TERM
```

No shell tracing. The runner reads the removal token from `ACTIONS_RUNNER_INPUT_TOKEN`, never an argv token (official [runner input implementation](https://github.com/actions/runner/blob/main/src/Runner.Listener/CommandSettings.cs)). Stop if the installed runner does not support this input. Both services must be inactive and both repository runner counts zero. Only then Rob flips `infinite-realms-app` public in Settings, checks hosted Actions and secret scanning, and configures main branch protection. Rob archives the old repository, which stays private. Update worker prompts, repository targets and board links afterward. After the first 0.33.0 release, remove the temporary `release-as` override in a reviewed change. First destination release is 0.33.0; never merge or create a release automatically.

## Rollback (approved ops session)

Before public flip, stop workers and set HOLD. Point the production remote back at the source, restore the reviewed host deploy script and cron changes from the private backup, and restore the original test-status/log repository references. Explicit rollback commands:

```bash
set -euo pipefail
touch /var/lib/infiniterealms-deploy/HOLD
cd /var/www/infiniterealms
git remote set-url origin "$(cat "$CUTOVER_HOST_BACKUP/old-origin")"
git fetch origin main
test "$(git rev-parse origin/main)" = "$(cat "$CUTOVER_HOST_BACKUP/old-head")"
# Restore the installed host scripts before checking tracked cleanliness.
cp "$CUTOVER_HOST_BACKUP/auto-deploy.sh" scripts/auto-deploy.sh
cp "$CUTOVER_HOST_BACKUP/smoke.sh" scripts/smoke.sh
test -z "$(git status --porcelain --untracked-files=no)"
git reset --hard origin/main
# Compare current crontab first; restore only if no unrelated edits intervened.
crontab "$CUTOVER_HOST_BACKUP/crontab"
# If the source was archived, Rob must unarchive it before any writes/transfers.
# HOLD remains armed. Do not redeploy or lift it during failure rollback.
test -f /var/lib/infiniterealms-deploy/HOLD
# Post CUTOVER: STOPPED — <reason> on source #2729; await Rob's recovery line.
```

The explicit reset above restores the frozen source main after checking tracked edits; ignored production env files are preserved. Verify source main equals the recorded rollback SHA before resetting, or obtain Rob's decision about the different SHA. If issues already moved, transfer them back by their NEW node IDs using the saved mapping and restore their original bodies; transfers back can allocate new issue numbers, so repair board and issue references using the mapping. Never re-register production runners while a public repository can target them. After public exposure, changing visibility cannot recall clones; rollback deployment/remotes and keep runners removed. Do not change visibility, make payments or touch Hetzner during Phase 1.

## Worker completion after SWITCHED

After verifying the latest SWITCHED deploy SHA and 2/2 runner evidence, update every repository target referring to the source in root `AGENTS.md`, app `AGENTS.md`, root `CLAUDE.md` and app `CLAUDE.md` to `Garblesnarff/infinite-realms-app` (including URLs). Preserve historical issue citations and all rules. Review the diff, commit those four files directly on destination main as `docs: update worker repository targets [skip ci]`, using the canonical author/committer, and push main without force. Post DONE with that SHA and the morning public flip / Actions / branch protection / archive checklist.

```bash
set -euo pipefail
# Run only after the current relay's SWITCHED marker is verified.
git checkout main
git pull --ff-only origin main
python3 - <<'PYTARGETS'
from pathlib import Path
import re
for name in ('AGENTS.md', 'ai-adventure-scribe-main/AGENTS.md',
             'CLAUDE.md', 'ai-adventure-scribe-main/CLAUDE.md'):
    path = Path(name)
    text = re.sub(r'infinite-realms-production(?!(?:/issues|/pull)/)',
                  'infinite-realms-app', path.read_text())
    path.write_text(text)
assert Path('AGENTS.md').read_bytes() == Path('ai-adventure-scribe-main/AGENTS.md').read_bytes()
PYTARGETS
git diff --check
git diff -- AGENTS.md ai-adventure-scribe-main/AGENTS.md CLAUDE.md ai-adventure-scribe-main/CLAUDE.md
git add AGENTS.md ai-adventure-scribe-main/AGENTS.md CLAUDE.md ai-adventure-scribe-main/CLAUDE.md
git -c user.name=Garblesnarff -c user.email=Garblesnarff@users.noreply.github.com commit -m 'docs: update worker repository targets [skip ci]'
ALLOW_MAIN_PUSH=1 git push origin main
```

After Rob flips public, re-enable `ci.yml`, `db-guards.yml`, `backups-guard.yml` and `release.yml` in Actions settings (or `gh workflow enable <file> --repo Garblesnarff/infinite-realms-app`) before checking the first PR. Preserve the paused nightly workflows until their own follow-up. Public-flip checklist also requires resolving any cached-view exposure reported on #2729.
