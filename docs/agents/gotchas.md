# Gotchas

Procedures that used to live in the app `CLAUDE.md`. The rules for every agent stay in `AGENTS.md`.

## Deno imports in `supabase/functions`

`supabase/functions/` is Deno. It is not the live DM backend. The live narration path is `POST /v1/llm/generate`.

Inside that directory:

- Do not import from `@/`. Deno has no path alias.
- Do not use `require()`.
- Use a relative import (`./types.ts`) or a URL (`https://deno.land/std/...`, `npm:package`).

`supabase/functions/dm-agent-execute/passiveSkillsEvaluator.ts` is the edge-function copy of the passive-check formula. The client treats `dm-agent-execute` as retired.

## Cloudflare and a new static file

nginx serves `dist/`, the built output. `public/` is the source. Vite copies `public/` into `dist/` during `bun run build`. A file added to `public/` after the build is not on the site.

Cloudflare keeps a 404 for about four hours. After adding a file:

1. Put it in `public/`.
2. Rebuild so the file is in `dist/`. Copying it into `dist/` only checks the machine that is already running.
3. If the public site still 404s and a request that reaches the machine returns 200, the 404 is cached. Add a query such as `?v=1` on the URL, or purge that cache.

## Blog post status

`normalizeStatusFields` in `ai-adventure-scribe-main/server-bun/src/trpc/routers/blog-helpers.ts` is the status flow:

- `draft`, `review`, and `archived` clear `publishedAt` and `scheduledFor`.
- `scheduled` sets `scheduledFor` and clears `publishedAt`.
- `published` sets `publishedAt` and clears `scheduledFor`.

The public blog lists `published` posts. There is no `blog-content-generator.ts`. The repo-root command `.claude/commands/blog-post.md` writes `docs/blog/technical/YYYY-MM-DD-[topic].md`. It does not call an API and it does not set a status.

## Passive checks

A passive check is 10 + the ability modifier + the proficiency bonus when the character is proficient. It is not a roll. Do not ask the player to roll one. The helper is `ai-adventure-scribe-main/src/services/passive-skills-service.ts`.

The Observant feat adds 5 to passive Perception and passive Investigation when the character has it.

## `useCallback` and the temporal dead zone

A `const` or `let` is in the temporal dead zone until its declaration line. A `useCallback` whose dependency array names another callback must be declared after that callback. The crash can stay hidden until the bundler splits the chunk differently.

```tsx
const stopFn = React.useCallback(() => {
  /* ... */
}, []);
const speakFn = React.useCallback(() => {
  stopFn();
}, [stopFn]);
```
