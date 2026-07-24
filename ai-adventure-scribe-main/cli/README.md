# Infinite Realms CLI

`ir` is a Bun headless game client. It uses the same client-side TypeScript pipeline as the React app: `AIService.chatWithDM`, the DM response processor and memory flow it invokes, `userDataApi`, the roll-request processor, and `DiceEngine`. It is not a raw API gameplay script.

## Setup

Copy `cli/.env.cli.example` to `cli/.env.cli` and set `SMOKE_EMAIL` and `SMOKE_PASSWORD`. The real file is gitignored. `CLI_API_URL` defaults to `http://localhost:8888`.

The server must have WorkOS password authentication enabled for the chosen account. The CLI sends credentials only to `POST /v1/auth/password-login`; that rate-limited endpoint makes the WorkOS password grant server-side and returns the same short-lived access/refresh pair consumed by the browser API clients.

Run with Bun from the app root:

```sh
bun run cli/src/index.ts sessions list
bun run cli/src/index.ts templates list --campaign the-eternal-feast
bun run cli/src/index.ts play --campaign the-eternal-feast
bun run cli/src/index.ts play --campaign the-eternal-feast --new --auto --turns 20 --transcript /tmp/feast.ndjson
```

## Fresh account quickstart

Fresh agent accounts can bootstrap a complete starter playthrough without first visiting the browser:

```sh
bun run cli/src/index.ts templates list --campaign the-eternal-feast
bun run cli/src/index.ts play --campaign the-eternal-feast --new --template the-seeker --auto --turns 20
```

On its first run, `--new` resolves or creates the user's campaign row using the same rule as the browser, seeds the chosen template with its portrait, equipment, and spells, then creates a live session with `starter_campaign_id`. In `--auto` mode, omitting `--template` picks a starter template at random and logs the pick; interactive mode prints the choices and prompts for its key.

Without `--new`, an active matching session resumes. With `--new` and an existing matching session, the CLI creates another session in that campaign. It reuses the current character by default; pass `--template <key>` (or `--character <template-key>`) to seed a new starter, or `--character <id>` to reuse a specific existing character in that campaign.

`ir templates list --campaign <slug>` prints each starter's key, name, and class for agents to enumerate selections.

Interactive commands are free text, `roll` for a pending request, `move <entityId> <x> <y>`, and `exit`. A pending roll blocks further play until it is resolved. Tactical turns show the server map through `mapToAscii` plus its tactical digest.

## For agents: NDJSON

Use `--json`. Every output line is a JSON object with a `type` of `narration`, `options`, `roll_request`, `roll_result`, `map_state`, or `error`. Send one input line at a time on stdin: option/free text, `roll`, or `move <entityId> <x> <y>`. `--auto --turns N` picks safe generic actions and resolves numeric rolls, then emits a `summary` event with `turnsCompleted`, `rollsMade`, and `contractViolations`.
