# Alexa+ companion demo and submission runbook

Tracking epic: [#215](https://github.com/Garblesnarff/infinite-realms-app/issues/215).
This is preparation material, not a completed submission. The simulated
client is in [#272](https://github.com/Garblesnarff/infinite-realms-app/pull/272);
use a reviewed revision containing it for rehearsal. Workers do not merge.

## Release prerequisites

| Item                            | State / completion evidence                                                                                                                                                                                                |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP server and simulated client | Record reviewed commit and green pull_request CI; #272 must receive strategist PASS.                                                                                                                                       |
| Submission source and license   | Rob must choose the submission repository and licensing path. Current app README reserves all rights; public visibility alone is insufficient. Do not add a license or change repository visibility without his direction. |
| Judge access                    | Dedicated demonstration account, synthetic characters and owned session; access/quota maintained through Nov 20. Provide credentials privately through the submission's test-access mechanism.                             |
| Real app rehearsal              | Record successful join, scene, speech and roll against the real API. The test fixture is not evidence of production authentication or database persistence.                                                                |
| Video                           | Public link and duration under three minutes, with the simulation clearly labelled.                                                                                                                                        |
| Submission fields               | Description, source URL/revision, run instructions, test access, feedback and change-since-Aug-31 evidence complete. Rob submits.                                                                                          |

The [official rules](https://amazonappdev2026.devpost.com/rules) give an
Oct 23, 2026 noon Pacific deadline (2 PM Central), require a working MCP
server using at least spec 2025-11-25, and permit a web simulation. They
require a public repository with an open-source license or a private
repository shared with the named reviewers. Recheck the rules before
submission. The epic's internal target is Oct 23 at midnight Central.

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

## Recording outline (target 2 minutes 35 seconds)

| Time      | Screen / narration                                                                                                                                    |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:15 | “Infinite Realms adds an AI party member through a self-hosted MCP server. This is a simulated Alexa+ web experience.” Show the label and local page. |
| 0:15–0:35 | Show the six listed tools and explain that the MCP client initializes, lists tools and calls them over Streamable HTTP.                               |
| 0:35–1:30 | Run join → scene → speak → roll. Keep the tool log and reply visible; show the real session transcript alongside it.                                  |
| 1:30–1:55 | Type `look around`; show the returned scene. Optional voice input only if it works reliably.                                                          |
| 1:55–2:15 | Show the MCP server/client source and the successful proving test summary. Explain the route wrappers and server roll.                                |
| 2:15–2:35 | Explain the new hackathon-period layer and how judges run it; mention partner account linking as future work.                                         |

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
| Open Source mini challenge | Only claim after the approved licensed contribution path exists; record contribution URL, project URL, username and scope.                                              |

Rob completes Devpost registration, final fields and submission. This file
does not grant permission to publish a video, grant access, change a license,
or deploy anything.
