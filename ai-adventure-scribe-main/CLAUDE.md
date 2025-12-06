# CLAUDE.md - Quick Reference for AI Assistants

**What this is**: Essential context, gotchas, and locations that save you time when working on InfiniteRealms.

**What this isn't**: Detailed implementation docs (see AGENTS.md for architecture, or read the code).

---

## ⚠️ CRITICAL CONTEXT - READ FIRST

### Production Environment
- **This is a PRODUCTION codebase on a Hetzner VPS**
- Changes go live immediately - be careful!
- **Always test before pushing** (`npm run build`, verify changes)
- **Commit and push after EVERY change** - user doesn't have easy local access to code
- User may not be technical - explain clearly, double-check your assumptions

### 🔒 SECURITY - NEVER COMMIT SECRETS
- **NEVER commit `.env` files** - they contain API keys, passwords, database URLs
- **Check `.gitignore`** before committing - verify sensitive files are excluded
- **Files with secrets** (already gitignored, DO NOT commit):
  - `.env`, `.env.local`, `server/.env`, `crewai-service/.env`
- **Safe to commit**: `.env.example` (no real secrets)
- **If you see secrets in code**: Use `Deno.env.get('KEY_NAME')` or `process.env.KEY_NAME`
- **Before committing**: Run `git status --ignored` to verify .env files aren't staged

### Infrastructure (Verified)
- **Server**: Hetzner VPS (Nuremberg datacenter, Ubuntu 24.04 LTS)
- **Hostname**: `ubuntu-16gb-nbg1-1`
- **Supabase**: Full local stack in Docker (NOT Supabase Cloud!)
  - 13 containers: postgres, auth, edge-functions, rest (PostgREST), storage, studio, kong, meta, pooler, realtime, analytics, imgproxy, vector
  - PostgreSQL 15.8.1.085 exposed on port 54321
  - Kong API gateway on ports 8001/8444
- **Location**: `/var/www/infiniterealms/ai-adventure-scribe-main/`
- **Docker**: All Supabase services containerized, up 5-12 days

### Workflow
1. Make changes
2. Test: `npm run build` (catch TS errors)
3. Commit: `git commit -m "..."`
4. Push: `git push origin main` (deploys to production!)
5. Repeat for each logical change

---

## Project at a Glance

Solo fantasy RPG with AI-powered Dungeon Master. Players create campaigns with persistent worlds and long-term memory.

**Tech Stack**: React + TypeScript + Vite (frontend), Supabase Edge Functions (Deno) + Express (Node), PostgreSQL, Gemini AI

---

## Repo Structure & Key Locations

```
ai-adventure-scribe-main/
├── supabase/functions/        # Deno edge functions (PRIMARY AI backend)
│   ├── dm-agent-execute/      # Main DM agent (Gemini AI)
│   ├── rules-interpreter-execute/
│   └── chat-ai/
├── server/src/                # Express/Node backup API
│   ├── routes/blog.tsx        # Blog SSR routes
│   ├── views/blog/            # Blog React SSR pages
│   │   ├── index.tsx          # Blog listing page
│   │   ├── post.tsx           # Individual blog post
│   │   └── document.tsx       # Blog HTML wrapper
│   └── services/
│       ├── blog-service.ts    # Blog CRUD operations
│       ├── blog-scheduler.ts  # Scheduled post publishing
│       └── blog-content-generator.ts  # AI content generation
├── src/
│   ├── components/           # React components (kebab-case files)
│   │   └── blog-admin/       # Blog admin UI components
│   ├── services/            # Frontend services (combat, AI, passive skills)
│   ├── data/                # D&D reference data (spells, feats, levels)
│   ├── agents/              # Multi-agent system
│   └── hooks/               # React hooks
├── AGENTS.md                # Architecture & development guidance
└── CLAUDE.md                # This file
```

**Important**:
- `supabase/functions/` is **Deno**, not Node.js. Cannot use `@/` imports there.
- Blog uses **server-side rendering (SSR)** via Express, not the React SPA

---

## Bead System (Issue Tracking)

We use **Beads**, not GitHub issues. Wrapper script: `./scripts/bd.sh`

```bash
# Create bug
bd create "AI DM requests passive rolls" -d "Details..." -t bug -p 0

# List open issues
bd list --status open

# Update status
bd update bead-id --status in_progress

# Close with reason
bd close bead-id --reason "Fixed: description"
```

**Always**: Reference beads in commits: `Closes bead: bead-id`

---

## Critical Gotchas

### 1. Production Environment (Hetzner VPS)
- **This is LIVE production** - not a dev environment
- Changes to `main` branch go live immediately
- **Test everything**: `npm run build` before pushing
- **Commit frequently**: User doesn't have easy local access to code
- **Be cautious**: Real users are affected by bugs
- **Supabase is local**: Running in Docker, not Supabase Cloud
- **User may not be technical**: Explain clearly, verify assumptions

### 2. Deno vs Node.js
- **Supabase Edge Functions** (`supabase/functions/`) = **Deno**
- **Express Server** (`server/src/`) = **Node.js**

**Deno constraints**:
- ❌ No `import from '@/...'` (no path aliases)
- ❌ No `require()`
- ✅ Use relative imports: `./types.ts`
- ✅ Use URLs: `https://deno.land/std/...` or `npm:package`
- ✅ Inline data if you can't import (e.g., proficiency bonus table)

### 3. D&D 5E Passive Skills
**Common AI DM bug**: Requesting "Make a Passive Perception check"

**The rule** (PHB p.175):
- Passive skills = `10 + modifier + proficiency` (NO ROLL!)
- Always on, automatic, DM uses them
- ❌ Never ask players to roll for passive skills

**Where implemented**:
- Frontend: `src/services/passive-skills-service.ts`
- Deno: `supabase/functions/dm-agent-execute/passiveSkillsEvaluator.ts`

**Observant feat**: +5 to Passive Perception/Investigation (must detect and apply)

### 4. Blog System (blog.infiniterealms.app)
**Architecture**: SSR with Express, served on subdomain

**Database tables** (Supabase):
- `blog_posts` - Post content, metadata, status
- `blog_authors` - Author information
- `blog_categories` / `blog_tags` - Post organization
- **Permissions**: `service_role` and `authenticated` roles have full access

**URLs**:
- Blog: `https://blog.infiniterealms.app` (proxied via Cloudflare)
- Admin: `https://infiniterealms.app/admin/blog` (in main app)

**Common issues**:
- **Cloudflare caching**: Purge cache after content changes (Development Mode for testing)
- **DNS**: blog subdomain points to 91.98.173.12 (gray cloud = direct, orange = proxied)
- **SSL**: Managed by Let's Encrypt (auto-renews), cert at `/etc/letsencrypt/live/blog.infiniterealms.app/`
- **nginx**: Separate server block for blog subdomain, sets `X-Blog-Subdomain: true` header

**Content generation**:
- AI-powered via `blog-content-generator.ts` (uses Claude API)
- Generates changelogs, dev diaries, and SEO posts from git commits
- Posts created with `status='review'` - require human approval before publishing
- Endpoint: `POST /internal/generate-commit-post`

**Scheduled publishing**:
- `BlogScheduler` runs every 60 seconds in production
- Publishes posts where `status='scheduled'` AND `scheduled_for <= now()`
- Started automatically in `server/src/index.ts`

### 5. AI Education Pattern
When AI does something wrong, **educate via prompts** (fastest fix):

1. Add section to `promptBuilder.ts` with XML tags: `<rule_name>`
2. Include forbidden patterns (❌ examples) and correct patterns (✅ examples)
3. Reinforce in `systemInstruction` (in `index.ts`) for critical rules
4. Provide calculated data (don't expect AI to calculate)

---

## Quick Command Reference

```bash
# Build (ALWAYS run before pushing to production!)
npm run build

# Run dev environment
npm run dev

# Supabase (local Docker instance)
npx supabase functions serve           # Test edge functions locally
npx supabase functions deploy dm-agent-execute  # Deploy to local Supabase

# Server
npm run server:dev        # Express on port 8888
npm run server:test       # Run tests

# Docker (Supabase local stack)
docker ps                           # See all 13 Supabase containers
docker logs supabase-db             # PostgreSQL logs
docker logs supabase-edge-functions # Edge function logs
docker logs supabase-auth           # GoTrue auth logs
docker logs supabase-kong           # API gateway logs

# Git workflow (PRODUCTION - changes go live!)
git add -A
git commit -m "..."       # Include "Closes bead: X"
git push origin main      # ⚠️ DEPLOYS TO PRODUCTION IMMEDIATELY
```

**Remember**: This is production! Always test before pushing.

---

## Common Workflows

### Fix AI DM Behavior
1. Identify what's wrong (e.g., "AI requests passive rolls")
2. **Verify with user** if you're not sure - they know the domain
3. Research D&D 5E rule (PHB, Sage Advice, web search)
4. Add education to `promptBuilder.ts` (forbidden + correct examples)
5. Add to `systemInstruction` if critical ("NEVER do X")
6. Calculate/provide data AI needs (passive scores, AC, etc.)
7. **Test**: `npm run build` (no TS errors)
8. **Commit & push** (this is production!)
9. Create bead, update status, close when done

### Add New D&D Mechanic
1. Implement calculation:
   - Frontend: `src/services/your-service.ts`
   - Deno: Inline or new file in `dm-agent-execute/`
2. Extend `CharacterContext` in `types.ts` (make fields optional)
3. Calculate in `index.ts` before building prompt
4. Inject into prompt in `promptBuilder.ts`
5. Add education if AI needs to use it

### Debug Edge Function
1. Add `console.log('[YourFunction] ...')`
2. Check Supabase logs or local terminal
3. Verify Deno-compatible imports (no `@/`, use relative)
4. Test locally: `npx supabase functions serve`

### Publish Blog Post
1. **Create post via admin UI**: `https://infiniterealms.app/admin/blog`
2. **Set status**:
   - `draft` - Work in progress, auto-saved every 30s
   - `review` - Ready for approval (AI-generated posts start here)
   - `scheduled` - Will publish at `scheduled_for` timestamp
   - `published` - Live on blog
3. **Test locally**: Visit `http://localhost:8888/blog` or blog subdomain
4. **Cloudflare cache**: Purge after publishing (or enable Development Mode)

### Generate AI Blog Content
```bash
# Via API (from commits)
curl -X POST http://localhost:8888/internal/generate-commit-post \
  -H "Content-Type: application/json" \
  -d '{
    "commits": [{"message": "...", "author": "...", "date": "..."}],
    "version": "1.2.0",
    "type": "both"
  }'
```

**Types**: `changelog` | `dev-diary` | `both`

**Process**:
1. AI generates content via Claude API
2. Post created with `status='review'`
3. Human reviews/edits in admin panel
4. Publish or schedule

---

## Where to Find Things

**D&D Rules/Data**:
- Proficiency by level: `src/data/levelProgression.ts`
- Spells: `src/data/spellOptions.ts`
- Feats: `src/data/featOptions.ts`

**AI System**:
- DM agent entry: `supabase/functions/dm-agent-execute/index.ts`
- Prompt builder: `supabase/functions/dm-agent-execute/promptBuilder.ts`
- Types: `supabase/functions/dm-agent-execute/types.ts`

**Services**:
- Combat: `src/services/combat/`
- AI integration: `src/services/ai/`
- Passive skills: `src/services/passive-skills-service.ts`

**Blog System**:
- SSR routes: `server/src/routes/blog.tsx`
- SSR views: `server/src/views/blog/` (index, post, document)
- Blog service: `server/src/services/blog-service.ts`
- AI generator: `server/src/services/blog-content-generator.ts`
- Scheduler: `server/src/services/blog-scheduler.ts`
- Admin UI: `src/components/blog-admin/`
- Database: Supabase tables (blog_posts, blog_authors, blog_categories, blog_tags)
- nginx config: `/etc/nginx/sites-available/infiniterealms` (blog subdomain block)
- SSL certs: `/etc/letsencrypt/live/blog.infiniterealms.app/`

---

## Best Practices (from Research)

Based on [developer onboarding research](https://www.cortex.io/post/developer-onboarding-guide):

**Good**:
- Clear README with setup (see AGENTS.md for architecture)
- Examples over abstractions (see existing code)
- Hands-on learning (fix a bug, make a PR)
- Centralized docs (AGENTS.md, this file)

**Avoid**:
- Passive learning (reading docs for days)
- Unclear goals (each task should have clear outcome)
- Missing context (explain WHY, not just WHAT)

---

## Debugging Checklist

**TypeScript errors**:
- [ ] Run `npm run build`
- [ ] Check types in `types.ts`
- [ ] Make new fields optional with `?`

**AI DM behavior wrong**:
- [ ] Research correct D&D 5E rule
- [ ] Add education to `promptBuilder.ts`
- [ ] Add forbidden patterns (❌) and correct examples (✅)
- [ ] Reinforce in `systemInstruction` if critical

**Deno import errors**:
- [ ] Remove `@/` imports, use `./relative.ts`
- [ ] Or inline the code/data
- [ ] Check for `require()` (not allowed in Deno)

**Missing character data**:
- [ ] Check where `CharacterContext` is populated (`index.ts`)
- [ ] Ensure frontend sends complete data
- [ ] Add graceful defaults (e.g., `return 10`)

---

## Resources

- **AGENTS.md**: Full architecture and development patterns
- **D&D 5E SRD**: https://dnd.wizards.com/resources/systems-reference-document
- **Supabase Edge Functions**: https://supabase.com/docs/guides/functions
- **Deno Manual**: https://deno.land/manual
- **Builder.io AGENTS.md guide**: https://www.builder.io/blog/agents-md

---

---

## Working with Non-Technical User

The user (project owner) may not be a developer:

**Do**:
- ✅ Explain what you're doing in plain language
- ✅ Double-check assumptions (ask if unsure)
- ✅ Test thoroughly before pushing to production
- ✅ Commit/push frequently (they don't have easy code access)
- ✅ Document changes clearly in commits

**Don't**:
- ❌ Assume technical knowledge
- ❌ Use jargon without explaining
- ❌ Make risky changes without testing
- ❌ Batch changes (commit after each logical change)
- ❌ **NEVER commit .env files or hardcode secrets!**

---

**Last Updated**: 2025-12-06
**What to add**: Gotchas you discover, non-obvious patterns, time-saving tips
**Environment**: Hetzner VPS, Production, Docker-based services
**Blog**: https://blog.infiniterealms.app (SSR, Cloudflare-proxied, Let's Encrypt SSL)
