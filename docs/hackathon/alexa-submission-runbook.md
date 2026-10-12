# Alexa+ companion demo and submission runbook

Tracking epic: [#215](https://github.com/Garblesnarff/infinite-realms-app/issues/215).
This is preparation material, not a completed submission. The simulated
client is in [#272](https://github.com/Garblesnarff/infinite-realms-app/pull/272);
use a reviewed revision containing it for rehearsal. Workers do not merge.

## Release prerequisites

| Item                            | State / completion evidence                                                                                                                                                                    |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP server and simulated client | Record reviewed commit and green pull_request CI; #272 must receive strategist PASS.                                                                                                           |
| Submission source and license   | Approved: a separate public Garblesnarff/infinite-realms-alexa-companion submission repo, MIT, Copyright (c) 2026 Garblesnarff. Rob creates it. The app remains All rights reserved.           |
| Judge access                    | Dedicated demonstration account, synthetic characters and owned session; access/quota maintained through Nov 20. Provide credentials privately through the submission's test-access mechanism. |
| Real app rehearsal              | Record successful join, scene, speech and roll against the real API. The test fixture is not evidence of production authentication or database persistence.                                    |
| Video                           | Public link and duration under three minutes, with the simulation clearly labelled.                                                                                                            |
| Submission fields               | Description, source URL/revision, run instructions, test access, feedback and change-since-Aug-31 evidence complete. Rob submits.                                                              |

The [official rules](https://amazonappdev2026.devpost.com/rules) give an
Oct 23, 2026 noon Pacific deadline (2 PM Central), require a working MCP
server using at least spec 2025-11-25, and permit a web simulation. They
require a public repository with an open-source license or a private
repository shared with the named reviewers. Recheck the rules before
submission. The epic's internal target is Oct 23 at midnight Central.

## Separate public submission repository — Rob's creation/copy steps

Approved repository name: `Garblesnarff/infinite-realms-alexa-companion`.
License: MIT with `Copyright (c) 2026 Garblesnarff`. The app repository stays
All rights reserved. Workers must not create the repository, change its
settings, or copy the app implementation. Rob performs the commands below
from a clean shell at the app repository root, after strategist PASS on the
selected source SHA. If #272 changes, replace the SHA with its new reviewed
head before export.

The explicit copy allowlist is the five `companion-mcp-server/src/*.ts`
files, four `companion-mcp-server/web/*` files, `package.json`, `bun.lock`
and `tsconfig.json`. Generate `src/api-types.ts`, `.gitignore`,
`.env.example`, `README.md` and root `LICENSE` as below. Do not copy the app,
its history, databases, fixtures, `.env`, account data or host configuration.
The eight public wire interfaces and roll-kind union are the only declarations
needed from the app; no route/service/auth implementation is copied.

The existing tests remain intact in the app. They depend on proprietary
routes and app jsdom, so they are outside this submission copy allowlist.
Remove the copied package's otherwise-broken test command; do not claim
standalone tests that are not present. Runtime and typecheck are verified
on the independent export. A later standalone HTTP contract suite can be
added without copying app code.

Rob creates the remote (worker must not execute this):

```sh
gh repo create Garblesnarff/infinite-realms-alexa-companion --public --description 'Self-hosted companion MCP server and simulated Alexa+ web client'
```

From the app repository root, choose a new, empty export directory. This
copies selected tracked files at an exact SHA, never dirty working files:

````sh
export IR_SUBMISSION_SHA='4befff22fe84bce17d0b33f56563420c664791cf'
export IR_SUBMISSION_DIR="$(pwd)/../infinite-realms-alexa-companion-export"
mkdir "$IR_SUBMISSION_DIR"
git archive "$IR_SUBMISSION_SHA" companion-mcp-server/src companion-mcp-server/web companion-mcp-server/package.json companion-mcp-server/bun.lock companion-mcp-server/tsconfig.json | tar -x -C "$IR_SUBMISSION_DIR" --strip-components=1
python3 - <<'PY'
import json, os, subprocess
from pathlib import Path
out = Path(os.environ['IR_SUBMISSION_DIR'])
sha = os.environ['IR_SUBMISSION_SHA']
service = subprocess.check_output(['git', 'show', f'{sha}:ai-adventure-scribe-main/server-bun/src/services/session/companion-service.ts'], text=True)
names = ['CompanionPublicRow', 'PartyRosterMember', 'CompanionRollRequest', 'CompanionRollResult', 'RedactedCombatParticipant', 'RedactedCombat', 'RedactedScene', 'ActiveCompanion']
blocks = ["export type CompanionRollKind = 'skill' | 'ability' | 'save';"]
for name in names:
    start = service.index('export interface ' + name + ' {')
    brace = service.index('{', start)
    depth = 1
    end = brace + 1
    while depth:
        depth += (service[end] == '{') - (service[end] == '}')
        end += 1
    block = service[start:end]
    if name == 'CompanionPublicRow':
        block = block.replace('created_at: Date | null', 'created_at: string | null')
    blocks.append(block)
(out / 'src/api-types.ts').write_text('// Public HTTP wire shapes only; no app implementation.\n\n' + '\n\n'.join(blocks) + '\n')
p = out / 'src/ir-client.ts'
s = p.read_text().replace('../../ai-adventure-scribe-main/server-bun/src/services/session/companion-service.js', './api-types.js')
s = s.replace('Response shapes are imported type-only from the real service so they\n * cannot drift from what production sends.', 'Response shapes are local public HTTP wire contracts.')
p.write_text(s)
p = out / 'src/index.ts'
p.write_text(p.read_text().replace(' (upstream ${irApiBaseUrl})', ''))
p = out / 'package.json'
pkg = json.loads(p.read_text())
pkg['name'] = 'infinite-realms-alexa-companion'
pkg['license'] = 'MIT'
pkg['engines']['bun'] = '>=1.4.2'
pkg['scripts'].pop('test', None)
p.write_text(json.dumps(pkg, indent=2) + '\n')
# Preserve the lockfile's matching root package metadata without dependency changes.
p = out / 'bun.lock'
s = p.read_text().replace('"name": "companion-mcp-server"', '"name": "infinite-realms-alexa-companion"')
p.write_text(s)
(out / '.gitignore').write_text('node_modules/\ndist/\n.env\n.env.*\n!.env.example\n*.log\n.DS_Store\n._*\n')
(out / '.env.example').write_text('IR_DEMO_TOKEN=\nIR_API_BASE_URL=\nMCP_PORT=\n')
(out / 'LICENSE').write_text('''MIT License

Copyright (c) 2026 Garblesnarff

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
''')
(out / 'README.md').write_text('''# Infinite Realms Alexa+ companion

A self-hosted MCP server and simulated Alexa+ web client. Six tools use
Infinite Realms' public HTTP API to join a party, read its redacted scene,
speak as a companion, roll, list companions and leave. The transport uses
MCP 2025-11-25 Streamable HTTP. This is a simulation, not a connection to
Amazon's partner-only Alexa+ service.

## Local start (under five minutes after access is supplied)

Prerequisites: Bun 1.4.2 or newer; an API endpoint, a valid bearer credential,
and owned session/character ids supplied privately by the demo organizer.
This repository does not contain or start the Infinite Realms backend.

```sh
bun install --frozen-lockfile
bun run typecheck
read -r IR_API_BASE_URL
export IR_API_BASE_URL
read -r -s IR_DEMO_TOKEN
export IR_DEMO_TOKEN
bun start
```

At the first prompt enter the supplied API base URL; at the silent prompt
enter the supplied credential. Open http://127.0.0.1:8893/, enter the supplied
session and companion character ids, then run the demo. Keep credentials
private. The variable-name-only .env.example is a reference: if you use an
.env file, populate all values locally; never commit it. The real API needs
a valid access credential, not an arbitrary static token.

The server binds to loopback and has no MCP caller authentication. Do not
publish its port or use a tunnel. Only the HTTP API base URL is configurable;
no production endpoint or account data is distributed here.

## Two-minute demo

- 0:00–0:15: identify the simulated Alexa+ experience and the party member.
- 0:15–0:30: show the six listed MCP tools and Streamable HTTP transport.
- 0:30–1:20: run join → scene → speak → roll, keeping the tool log visible.
- 1:20–1:40: send `look around`; show the scene reply and real app transcript.
- 1:40–2:00: explain server-authoritative rolls, the new MCP/client layer and
  local judge setup. Do not demonstrate combat or reveal credentials.

Roll totals vary. Confirm successful tool results rather than relying on a
friendly reply. App integration tests stay in the proprietary app repository;
they are not copied here or claimed as standalone tests.

## License

MIT. Copyright (c) 2026 Garblesnarff. See LICENSE. This license applies only
to this submission's companion server/client and public wire declarations;
the Infinite Realms application remains All rights reserved.
''')
PY

````

The generated README gives a local start under five minutes once the judge
has a supplied endpoint/credential/owned ids, and a two-minute demo script.
The variable-name-only `.env.example` contains no endpoint or credential.
The wire timestamp is a JSON string, rather than the service's internal
Date object. Only the public HTTP API is used at runtime; no app import
remains. The upstream URL is removed from the startup log.

Rob validates the export, reviews the exact staged contents, then makes the
initial publication. Do not use a broad copy from the app checkout:

```sh
cd "$IR_SUBMISSION_DIR"
bun install --frozen-lockfile
bun run typecheck
# Review src/ and web/ for accidental app imports, credentials or host data.
# Supply the judge endpoint/credential privately; perform the README demo.
git init -b main
git add src web package.json bun.lock tsconfig.json .gitignore .env.example README.md LICENSE
git diff --cached --check
git diff --cached --stat
git diff --cached --name-only
# Requires gitleaks installed from its official distribution.
git diff --cached --binary | gitleaks stdin --redact
# Inspect every staged file before publication.
git commit -m 'feat: publish companion MCP server and simulated Alexa client'
git remote add origin https://github.com/Garblesnarff/infinite-realms-alexa-companion.git
git push -u origin main
```

Rob routes repository creation/publication and privately supplies judge
access. No hosted endpoint is provisioned by these steps. The local MCP
port remains loopback-only; a hosted demo endpoint means the upstream HTTP
API, not exposing the unauthenticated MCP server. No production hostnames,
IPs, credentials or user data belong in the submission repository.

## Prepare the real demonstration session

1. Sign in to Infinite Realms with the dedicated demo account. Use only
   synthetic campaign/character content. Ensure the API environment has
   `COMPANIONS_ENABLED=true` and the account owns the selected session.
   Any production configuration or quota change needs Rob's approval.
2. Prepare a non-combat scene: a quiet tavern entrance and a door the party
   can investigate. Keep one player character and one companion character.
   Record the session id and companion character id privately for rehearsal.
3. Obtain a valid WorkOS access credential for that account through its
   normal authenticated session. `IR_DEMO_TOKEN` is only the MCP server's
   environment variable name: it forwards the credential as a bearer token.
   The real API does not accept an arbitrary static string. Its auth path
   is `server-bun/src/lib/auth.ts` → `verifyWorkOSToken`; session ownership
   is checked by the companion routes. Refresh expired credentials through
   normal sign-in; do not put them in source, screenshots or public logs.
4. Confirm the judge access arrangement independently. An access token used
   for recording is not a durable judge login, and no OAuth account-linking
   or refresh flow is implemented in the companion server.

## Install and run

From the repository root at the reviewed revision, install all packages the
proving tests need. Use a current Bun release that reads the committed
lockfiles.

```sh
cd ai-adventure-scribe-main
bun install --frozen-lockfile
cd server-bun
bun install --frozen-lockfile
cd ../../companion-mcp-server
bun install --frozen-lockfile
bun run typecheck
bun test test/
```

The companion tests use the real route definitions with fixture auth,
ownership and service seams. They prove MCP transport and request/response
contracts, not actual account access or persisted data.

Set `IR_API_BASE_URL` to the approved API environment. Enter the credential
silently rather than putting its value in a shell command or committed env
file:

```sh
export IR_API_BASE_URL='http://localhost:8888'
read -r -s IR_DEMO_TOKEN
export IR_DEMO_TOKEN
bun src/index.ts
```

The default API URL assumes a separately configured local Infinite Realms
server is running. It does not start the API or create a session. For a
remote approved API, change the URL before launching. Keep the MCP server
on loopback; it has no caller authentication and must not be exposed via a
tunnel or public host.

Open `http://127.0.0.1:8893/`. The page should list six tools. Enter the
owned session and companion character ids, then click **Run scripted demo**.
The expected sequence is:

1. `join_party`: companion id and updated party returned.
2. `get_scene`: redacted scene returned.
3. `speak_as_companion`: the companion's line returned.
4. `roll_for_companion`: server result includes d20, modifier and total;
   the reply displays Perception. Do not promise a fixed roll total.

Send `look around` and verify another `get_scene` entry and scene reply.
Optionally check speech output; microphone support depends on the browser.
Use text input if speech recognition is unavailable. Do not demonstrate
combat. Confirm companion speech and the engine roll appear in the app's
session transcript for the real rehearsal.

To repeat, send `leave`, confirm the returned tool result succeeded, then
run the demo again. A failed tool result is not a completed demo even if a
friendly reply appears. For 401, refresh the valid credential and restart
the MCP server; for 404, check feature enablement and ownership; for the
companion cap, use a session with an available seat.

## Recording outline (target 2 minutes)

| Time      | Screen / narration                                                                                                                                    |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:15 | “Infinite Realms adds an AI party member through a self-hosted MCP server. This is a simulated Alexa+ web experience.” Show the label and local page. |
| 0:15–0:30 | Show the six listed tools and explain that the MCP client initializes, lists tools and calls them over Streamable HTTP.                               |
| 0:30–1:20 | Run join → scene → speak → roll. Keep the tool log and reply visible; show the real session transcript alongside it.                                  |
| 1:20–1:40 | Type `look around`; show the returned scene. Optional voice input only if it works reliably.                                                          |
| 1:40–1:50 | Show the MCP server/client source and the successful proving test summary. Explain the route wrappers and server roll.                                |
| 1:50–2:00 | Explain the new hackathon-period layer and how judges run it; mention partner account linking as future work.                                         |

Use original narration, no music or unrelated third-party logos. Keep
credential-bearing terminals, account details and private browser tabs out
of the capture. Review the final export for duration, legible logs, the
simulation label and the actual API result. Publish only on Rob's direction.

## Draft description and evidence to fill

“Infinite Realms gives a tabletop party a companion through a self-hosted
MCP server. A simulated Alexa+ browser client reads the party's redacted
scene, speaks as the companion and requests server-side skill rolls. Six
tools wrap the app's companion API over Streamable HTTP; the browser log
makes every tool request and result visible.”

Before using this text, attach the real-rehearsal evidence above. The
existing game predates the hackathon; the new work is the companion MCP
server and simulated client. Record their commits/dates and the reviewed
revision, rather than claiming the whole game was built during the event.

| Submission field           | Fill before submitting                                                                                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source                     | Approved repository URL, license/access arrangement, reviewed revision and setup instructions.                                                                          |
| Video                      | Public YouTube/Vimeo URL, duration, simulation shown, real API rehearsal recorded.                                                                                      |
| Judge test access          | Private dedicated-account access, synthetic session instructions, quota/access through judging.                                                                         |
| Product feedback           | For each developer tool actually used: task, what worked, specific friction, reproducible example and requested improvement. Do not invent feedback or claim AWS usage. |
| Friction log               | Chrome-only test portability issue; credential naming vs real auth; any measured setup/integration friction.                                                            |
| Open Source mini challenge | Claim only after Rob creates and publishes the approved MIT submission repo; record contribution URL, project URL, username and scope.                                  |

Rob completes Devpost registration, final fields and submission. This file
does not grant permission to publish a video, grant access, change a license,
or deploy anything.
