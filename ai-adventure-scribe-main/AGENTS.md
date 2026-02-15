# AGENTS.md

This file provides guidance to all AI agents working with code in this repository. **Last updated: 2026-02-15.**

For quick-reference gotchas and workflows, see `CLAUDE.md`. This file covers architecture and development patterns.

## Project: InfiniteRealms

A solo fantasy RPG platform with an AI-powered Dungeon Master. Players create D&D 5E campaigns and characters with persistent worlds and long-term memory.

**Live at**: https://infiniterealms.app | **Blog**: https://blog.infiniterealms.app

---

## Critical Rules

1. **This is PRODUCTION** on a Hetzner VPS. Changes go live immediately.
2. **Authentication is WorkOS AuthKit**, NOT Supabase Auth. `supabase.auth.getUser()` returns `null`.
3. **RLS is DISABLED**. You MUST add `.eq('user_id', user.id)` to ALL Supabase queries manually.
4. **Two runtimes**: `server-bun/` = Bun (supports `@/` imports). `supabase/functions/` = Deno (NO path aliases, use `./relative.ts`).
5. **Never commit `.env` files or hardcode secrets.**
6. **Vitest config is explicit**: New test files must be manually added to `vitest.config.ts` in both `include` and `coverage.include`.
7. **ESLint enforces 200-line file limit**. Use `/* eslint-disable max-lines */` if unavoidable.
8. **Pre-commit hooks** run ESLint + Prettier on ALL staged files, secret detection, and conventional commit enforcement.

---

## Development Commands

```bash
# Build (ALWAYS run before pushing)
npm run build                          # Frontend (Vite)
npm run server:test                    # Server tests (Bun)
npx vitest run                         # Frontend/service tests

# Dev
npm run dev                            # Frontend + backend concurrently
npm run dev:frontend                   # Vite dev server (port 3000)
npm run dev:backend                    # Bun API server (port 8888)

# Production
pm2 restart infiniterealms-bun         # Restart API server
pm2 logs infiniterealms-bun            # View server logs

# Lint
npm run lint                           # ESLint
npm run lint:fix                       # ESLint --fix
```

### Issue Tracking (Beads)

We use **Beads** (`bd` command), not GitHub issues.

```bash
bash ./scripts/bd.sh list --status open    # List open issues
bash ./scripts/bd.sh create "Fix bug"      # Create issue
bash ./scripts/bd.sh close <bead-id> --reason "Fixed"
```

Always reference beads in commits: `Closes bead: <bead-id>`

---

## Architecture Overview

### Tech Stack

| Layer | Technology | Location |
|-------|-----------|----------|
| Frontend | React 18 + TypeScript + Vite | `src/` |
| UI | Shadcn/ui (Radix + Tailwind) | `src/components/ui/` |
| State | TanStack Query + React Contexts + Zustand | `src/contexts/`, `src/hooks/` |
| API Server | **Bun + Elysia** (port 8888) | `server-bun/src/` |
| ORM | Drizzle ORM | `server-bun/src/db/` |
| Database | PostgreSQL 15 (local Supabase Docker) | port 54321 |
| Edge Functions | Deno (Supabase) | `supabase/functions/` |
| AI Model | **Mistral Small Creative via OpenRouter** | `src/services/ai/` |
| Auth | **WorkOS AuthKit** | `src/contexts/AuthContext.tsx` |
| Blog | SSR via Bun/Elysia | `server-bun/src/routes/blog.tsx` |

### Directory Structure

```
ai-adventure-scribe-main/
├── server-bun/src/            # Bun/Elysia API server (PRODUCTION)
│   ├── index.ts               # Entry point
│   ├── app.ts                 # Elysia app setup
│   ├── ws.ts                  # WebSocket (Foundry VTT)
│   ├── routes/                # SSR routes (blog, landing, SEO)
│   │   └── v1/               # REST API routes
│   ├── trpc/                  # tRPC routers
│   ├── services/              # Backend services (30+ services)
│   ├── views/                 # Blog/landing SSR templates
│   ├── middleware/             # Auth, rate-limit, metrics
│   ├── lib/                   # DB connection (postgres.js)
│   └── db/schema/             # Drizzle schema definitions
├── src/                       # React frontend
│   ├── components/            # UI components (feature-based)
│   ├── features/              # Feature modules (auth, campaign, game-session)
│   ├── services/              # Frontend services
│   │   ├── ai/               # AI service (context builder, DM response)
│   │   ├── combat/           # Combat system services
│   │   └── ...
│   ├── hooks/                 # React hooks
│   ├── contexts/              # React contexts
│   ├── data/                  # D&D reference data (spells, feats, levels)
│   ├── utils/                 # Utility functions (D&D math, combat, etc.)
│   └── types/                 # TypeScript type definitions
├── supabase/functions/        # Deno edge functions
│   ├── dm-agent-execute/      # DM agent (Deno runtime)
│   └── ...
├── .jules/                    # Jules agent learning journals
├── CLAUDE.md                  # Quick reference and gotchas
└── AGENTS.md                  # This file (architecture guide)
```

### What Does NOT Exist (Deleted Code)

These were removed in a major cleanup (Feb 2026). Do NOT reference them:

- ~~`server/`~~ - Old Express backend. Use `server-bun/` instead.
- ~~`crewai-service/`~~ - CrewAI Python service. Removed entirely.
- ~~`src/agents/`~~ - Old multi-agent messaging system. Removed.
- ~~`src/services/crewai/`~~ - CrewAI orchestration adapters. Removed.
- ~~`src/services/gemini-api-manager.ts`~~ - Direct Gemini client. Removed.
- ~~`refactor-plan/`~~ - Old refactoring phases. Removed.
- ~~`roadmaps/`~~ - Old roadmap docs. Removed.

---

## AI Service Architecture (DM Chat)

The live call chain for AI Dungeon Master responses:

```
AIService.chatWithDM()                  [src/services/ai-service.ts]
  -> MemoryManager.getRelevantMemories() [src/services/memory-manager.ts]
  -> detectCombatFromText()              [src/utils/combatDetection.ts]
  -> ContextBuilder.build()              [src/services/ai/context-builder.ts]
     -> ContextBuilderPrompts.*()        [src/services/ai/context-builder-prompts.ts]
  -> llmApiClient.generateText()         [src/services/llm-api-client.ts]
     -> OpenRouter API (Mistral Small Creative)
  -> processDMResponse()                 [src/services/ai/dm-response-processor.ts]
     -> parseXMLTagsFromResponse()       [src/services/ai/xml-parser.ts]
```

**Key facts**:
- AI model is **Mistral Small Creative** via **OpenRouter** (not Gemini, not direct API)
- Log messages still say "Gemini" in some places - these are outdated strings, not the actual provider
- Memory retrieval uses vector embeddings for contextual recall
- Combat detection runs client-side before the AI call
- Response XML is parsed for structured data (dice rolls, options, etc.)

---

## Backend Services (server-bun/)

The Bun/Elysia server provides:

**Core Services** (`server-bun/src/services/`):
- `campaign-service.ts` - Campaign CRUD with ownership enforcement
- `character-service.ts` - Character management with dual ownership (userId + ownerId)
- `session-service.ts` - Game session management
- `combat-*-service.ts` - Combat initiative, attacks, HP, actions
- `conditions-service.ts` - D&D condition tracking
- `spell-slots-service.ts` - Spell slot management
- `rest-service.ts` - Short/long rest mechanics
- `class-features-service.ts` - Class feature tracking
- `blog-service.ts` - Blog post CRUD and publishing

**API Layer**:
- tRPC routers (`server-bun/src/trpc/routers/`) - Primary API
- REST routes (`server-bun/src/routes/v1/`) - Legacy/specific endpoints
- SSR routes (`server-bun/src/routes/blog.tsx`, `landing.tsx`) - Server-rendered pages

**Security Pattern** (CRITICAL):
```typescript
// CORRECT - ownership check in WHERE clause
const result = await db.select()
  .from(campaigns)
  .where(and(eq(campaigns.id, id), eq(campaigns.userId, userId)));

// CORRECT - return 404 (not 403) for unauthorized access
if (!result) throw new NotFoundError('Campaign not found');

// WRONG - leaks resource existence
if (result.userId !== userId) throw new ForbiddenError('Not authorized');
```

---

## Frontend Patterns

### State Management
- **React Contexts**: `AuthContext`, `CampaignContext`, `CharacterContext`, `GameContext`, `CombatContext`, `MemoryContext`
- **TanStack Query**: Server state via tRPC
- **Zustand**: Battle map store, local UI state

### Component Organization
- `src/components/` - Shared/legacy components
- `src/features/` - Feature modules (game-session, campaign, character, auth)
- `src/components/ui/` - Shadcn primitives (do NOT modify directly)

### Hooks
- `src/hooks/use-ai-response.ts` - AI DM interaction
- `src/hooks/use-game-session.ts` - Game session lifecycle
- `src/hooks/use-combat-*.ts` - Combat system hooks
- `src/hooks/use-messages.ts` - Chat history with pagination/dedup

---

## D&D 5E Rules

### Passive Skills (Common AI Bug)
- Formula: `10 + modifier + proficiency` (NO ROLL)
- Observant feat: +5 to Passive Perception/Investigation
- The AI DM must NEVER ask players to "roll a passive check"

### Combat Math
- Resistance: halve damage (floor)
- Vulnerability: double damage
- If both apply: resistance first (floor), then vulnerability
- Proficiency bonus: `Math.floor((level - 1) / 4) + 2`
- Minimum 1 HP gained per level

### Key Utility Files
- `src/utils/character-calculations.ts` - HP, AC, ability scores
- `src/utils/combatDetection.ts` - Combat state detection from text
- `src/utils/conditionEffects.ts` - Condition modifiers (use `rollType`, not `participantType`)
- `src/utils/classFeatures.ts` - Class feature scaling by level
- `src/utils/exhaustionUtils.ts` - Exhaustion level penalties
- `src/utils/grappleUtils.ts` - Grapple mechanics (DC-based, not contested)
- `src/data/spellOptions.ts` - Complete spell lists
- `src/data/levelProgression.ts` - Level-up data

---

## Testing

**Framework**: Vitest + React Testing Library

```bash
npm run server:test    # Server tests (Bun)
npx vitest run         # Frontend/service tests
```

**Important**:
- New test files MUST be added to `vitest.config.ts` in both `include` and `coverage.include`
- Test files using JSX (like `QueryClientProvider`) must use `.tsx` extension
- Mock `vi.mock()` calls must appear BEFORE project imports
- Use `eslint-disable max-lines` for test files exceeding 200 lines
- When testing D&D math, include edge cases (score 1, modifier -5, level boundaries)
- When testing randomness (dice rolls, rerolls), always mock `Math.random()` or the dice engine

---

## Database

**PostgreSQL 15** via local Supabase Docker stack (NOT Supabase Cloud).

**Core Tables**: `campaigns`, `characters`, `campaign_sessions`, `game_messages`, `memories`, `spells`, `classes`, `races`, `combat_encounters`, `combat_participants`, `blog_posts`

**RLS is DISABLED** on most tables. All data isolation must be enforced in application code via `userId` filtering in WHERE clauses.

**ORM**: Drizzle (`server-bun/src/db/schema/`). Use `inArray` for batch queries, `exists` subqueries for ownership checks.

---

## Code Standards

- **Files**: `kebab-case.ts/tsx`
- **Components**: `PascalCase`
- **Functions**: `camelCase`
- **Constants**: `UPPER_SNAKE_CASE`
- **Max file length**: 200 lines (ESLint enforced)
- **Imports**: Strict ordering enforced by ESLint
- **Commits**: Conventional commits required (`feat:`, `fix:`, `chore:`, etc.)
- **No `any` types**: Use `unknown` or proper types
- **No empty object types**: Use `Record<string, never>` instead of `{}`
