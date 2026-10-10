# Companion MCP Server — Infinite Realms AI party member (#215 step 1)

A self-hosted MCP server (TypeScript MCP SDK, **Streamable HTTP**, MCP spec
**2025-11-25** — the SDK also negotiates the 2025-03-26 handshake) that
exposes the Infinite Realms AI party-member companion API as six tools.
Built for the Amazon Developer Hackathon 2026, Alexa+ track.

Real Alexa+ is partner-only during this hackathon, so the entry pairs this
server with a local simulated Alexa+ web client (step 3b): the client is a
real MCP client (`initialize`, `tools/list`, `tools/call` over Streamable
HTTP), served from the same loopback server at `/`. No device, no Alexa
account, no hosting needed.

## Tools

Each tool wraps one route of
`ai-adventure-scribe-main/server-bun/src/routes/v1/companion-routes.ts`.
Tools return data, not a script — the voice client writes its own spoken
reply from the returned JSON.

| Tool | Wraps |
| --- | --- |
| `join_party` | `POST /v1/sessions/:id/companions` (cap 2) |
| `list_companions` | `GET /v1/sessions/:id/companions` |
| `leave_party` | `DELETE /v1/sessions/:id/companions/:companionId` |
| `get_scene` | `GET /v1/sessions/:id/scene` (redacted party scene) |
| `speak_as_companion` | `POST /v1/sessions/:id/companions/:companionId/say` |
| `roll_for_companion` | `POST /v1/sessions/:id/companions/:companionId/roll` (server-side d20) |

Combat is intentionally not exposed: combat goes through the combat intent
route, which is being rebuilt (#2658).

## Run it

```bash
cd companion-mcp-server
bun install
cp .env.example .env   # then put the static demo token in IR_DEMO_TOKEN
bun src/index.ts       # MCP endpoint at http://127.0.0.1:8893/mcp
```

Then open **http://127.0.0.1:8893/** for the simulated Alexa+ web client
(step 3b): enter a session id and a character id, then either click
**▶ Run scripted demo** (join → scene → speak → roll) or type free text
(`join`, `look around`, `say …`, `roll perception`, `who is here`,
`leave`). The page is a real MCP client over Streamable HTTP: every tool
call and its result appears in the tool log, the reply is shown in the
voice card and spoken with the browser's text-to-speech, and the 🎤 button
uses the browser's speech-to-text when available.

Environment:

- `IR_DEMO_TOKEN` (required) — the static demo token for the local demo,
  sent as `Authorization: Bearer <token>` to the companion API. Never
  commit it; it is never logged or returned to MCP clients.
- `IR_API_BASE_URL` — the server-bun API base URL (default
  `http://localhost:8888`).
- `MCP_PORT` — the Streamable HTTP port (default `8893`).

The server itself is stateless: every `POST /mcp` is a complete JSON-RPC
request. Game state lives server-side in Infinite Realms, keyed by session
and companion ids. The MCP endpoint does not authenticate callers — it is
for local demo use; do not expose it to the internet.

## Test it

`bun test test/` runs two suites, no database needed:

- `proving.test.ts` — a stub IR API wired with the real companion route
  definitions, then a real MCP client that lists the tools and runs
  `join → get_scene → speak → roll` over Streamable HTTP, plus the
  error-path and DNS-rebinding-guard tests.
- `web-client.test.ts` — headless Chromium (CDP) drives the real simulated
  Alexa+ page against the stub API: the scripted demo performs
  `join_party → get_scene → speak_as_companion → roll_for_companion` in
  order, and free text input maps to the right tool. (This Chromium build
  blocks loopback navigations, so the test injects the page and relays its
  MCP fetches through CDP Fetch interception.)

`bun run typecheck` typechecks.

## Auth roadmap

The static demo token is the step-2 decision for the local demo. The
Alexa-ready next step (for real partner integrations) is OAuth 2.1 + PKCE
account linking — planned, not built; the token stays env-only until then.
