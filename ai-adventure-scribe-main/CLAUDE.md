@AGENTS.md

# Claude quick reference

Rules for every agent are in AGENTS.md. This file is commands, layout, and gotchas for Claude sessions. It does not repeat those rules.

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
- `supabase/functions/dm-agent-execute/` is still in the tree. The client treats that name as retired (`RETIRED_FUNCTIONS` in `src/services/ai-execution/AIExecutionManager.ts`). A rules refactor edited the directory on 2026-10-14. `supabase/functions/chat-ai/` is not in the tree. `supabase/functions/` is not the live DM backend.
- Model ids live in `server-bun/src/services/llm-model-config.ts`. `OPENROUTER_TEXT_MODEL` overrides the OpenRouter default there.
- Blog pages are read by `server-bun/src/services/blog-service.ts` and rendered by `server-bun/src/routes/blog.tsx`. There is no `server-bun/src/services/blog-content-generator.ts`. The command `.claude/commands/blog-post.md` (repository root) writes a markdown draft under `docs/blog/technical/`. It does not call an API and it does not set a publish status.

## Gotchas

- A merge to `main` goes live within about 15 minutes through `ops/auto-deploy.sh`. A worker session does not merge. See AGENTS.md.
- Do not read `.env` files or paste secret values. Name the env var.
- Sign-in is WorkOS. `useAuth` is in `src/contexts/AuthContext.tsx`. Do not call `supabase.auth.getUser()` for the signed-in player.
- A passive check is 10 + the ability modifier + the proficiency bonus when the character is proficient. It is not a roll. The helper is `src/services/passive-skills-service.ts`.
- A `useCallback` value is in the temporal dead zone until its declaration line. Declare a callback before another hook lists it as a dependency.

## What this file used to hold

The previous copy repeated AGENTS.md, named a machine, and described a blog generator that is not in the tree. Those sections are gone. Deploy order and the merge gate stay in AGENTS.md.
