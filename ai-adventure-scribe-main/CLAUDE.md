@AGENTS.md

# Claude quick reference

Rules for every agent are in AGENTS.md. This file is commands, layout, and gotchas for Claude sessions. It does not repeat those rules.

Rob is not a coder. Explain results in plain words. A change is not live until it is merged and deployed.

## Commands

Run these from `ai-adventure-scribe-main/`:

- `bun run dev` starts the Vite client and the Bun API together. Vite alone is `bun run dev:frontend`.
- `bun run bun:dev` starts the Bun API with watch (`bun --watch src/index.ts` in `server-bun/`).
- `bun run lint` runs ESLint.
- `bun run build` builds the client.
- `bun run type-check` runs the client command and the server gate, and reports both. The client command is `bun x tsc --noEmit` against `tsconfig.json`, which has `files: []`, so that half checks nothing until #664 lands. The server half is `scripts/server-typecheck-gate.sh`.
- `bun run server:test` runs the server unit tests.
- `bun run test:migrations` replays migrations (`scripts/test-migrations.sh`).

Pre-merge overlap and conflict checks are `scripts/pre-merge-check.sh` at the repository root. The write-up is `docs/pre-merge-check.md`.

## Layout

- `src/` is the React client.
- `server-bun/src/` is the Bun/Elysia API.
- Production Postgres is 15.8. CI database jobs use the image `pgvector/pgvector:pg15`.
- Live DM narration is `AIService.chatWithDM` in `src/services/ai-service.ts`. It calls `llmApiClient.generateText`, which posts to `POST /v1/llm/generate` (`server-bun/src/routes/v1/llm.ts`).
- `supabase/functions/dm-agent-execute/` is still in the tree. The client treats that name as retired (`RETIRED_FUNCTIONS` in `src/services/ai-execution/AIExecutionManager.ts`). `supabase/functions/chat-ai/` is not in the tree. `supabase/functions/` is not the live DM backend. Deno import limits for that directory are in `docs/agents/gotchas.md`.
- Model ids live in `server-bun/src/services/llm-model-config.ts`. `OPENROUTER_TEXT_MODEL` overrides the OpenRouter default there.
- Blog pages are read by `server-bun/src/services/blog-service.ts` and rendered by `server-bun/src/routes/blog.tsx`. There is no `server-bun/src/services/blog-content-generator.ts`. The command `.claude/commands/blog-post.md` (repository root) writes a markdown draft under `docs/blog/technical/`. It does not call an API and it does not set a publish status.

## Gotchas

Longer notes are in `docs/agents/gotchas.md` (repository root): Deno imports, a Cloudflare-cached 404 on a new static file, blog post status, passive checks, and `useCallback` order.

- A merge to `main` goes live within about 15 minutes through `ops/auto-deploy.sh`. A worker session does not merge. See AGENTS.md.
- Do not read `.env` files or paste secret values. Name the env var. If a secret value shows up, do not repeat it. Tell Rob and recommend rotating the key.
- Sign-in is WorkOS. `useAuth` is in `src/contexts/AuthContext.tsx`. Do not call `supabase.auth.getUser()` for the signed-in player.
- A passive check is 10 + the ability modifier + the proficiency bonus when the character is proficient. It is not a roll. The helper is `src/services/passive-skills-service.ts`.
- A `useCallback` value is in the temporal dead zone until its declaration line. Declare a callback before another hook lists it as a dependency.
