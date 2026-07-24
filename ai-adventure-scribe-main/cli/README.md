# Infinite Realms CLI

`ir` is a Bun headless game client. It uses the same client-side TypeScript pipeline as the React app: `AIService.chatWithDM`, the DM response processor and memory flow it invokes, `userDataApi`, the roll-request processor, and `DiceEngine`. It is not a raw API gameplay script.

## Setup

Copy `cli/.env.cli.example` to `cli/.env.cli` and set `SMOKE_EMAIL` and `SMOKE_PASSWORD`. The real file is gitignored. `CLI_API_URL` defaults to `http://localhost:8888`.

The server must have WorkOS password authentication enabled for the chosen account. The CLI sends credentials only to `POST /v1/auth/password-login`; that rate-limited endpoint makes the WorkOS password grant server-side and returns the same short-lived access/refresh pair consumed by the browser API clients.

Run with Bun from the app root:

```sh
bun run cli/src/index.ts sessions list
bun run cli/src/index.ts play --campaign the-eternal-feast
bun run cli/src/index.ts play --campaign the-eternal-feast --new --auto --turns 20 --transcript /tmp/feast.ndjson
```

`--new` uses the browser's existing session creation payload and requires an active session for the selected campaign so it can retain that campaign and character. `--template <key>` uses the browser's `seedStarterCharacter` service to create that starter character in the selected campaign before creating the session.

Interactive commands are free text, `roll` for a pending request, `move <entityId> <x> <y>`, and `exit`. A pending roll blocks further play until it is resolved. Tactical turns show the server map through `mapToAscii` plus its tactical digest.

## For agents: NDJSON

Use `--json`. Every output line is a JSON object with a `type` of `narration`, `options`, `roll_request`, `roll_result`, `map_state`, or `error`. Send one input line at a time on stdin: option/free text, `roll`, or `move <entityId> <x> <y>`. `--auto --turns N` picks safe generic actions and resolves numeric rolls, then emits a `summary` event with `turnsCompleted`, `rollsMade`, and `contractViolations`.
