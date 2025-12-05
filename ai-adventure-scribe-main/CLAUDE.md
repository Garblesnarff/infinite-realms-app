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

### Infrastructure
- **Supabase**: Running locally in Docker (NOT Supabase Cloud)
- **PostgreSQL**: In Docker container
- **Other services**: Multiple Docker containers running
- **Location**: `/var/www/infiniterealms/ai-adventure-scribe-main/`

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
├── src/
│   ├── components/           # React components (kebab-case files)
│   ├── services/            # Frontend services (combat, AI, passive skills)
│   ├── data/                # D&D reference data (spells, feats, levels)
│   ├── agents/              # Multi-agent system
│   └── hooks/               # React hooks
├── AGENTS.md                # Architecture & development guidance
└── CLAUDE.md                # This file
```

**Important**: `supabase/functions/` is **Deno**, not Node.js. Cannot use `@/` imports there.

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

### 4. AI Education Pattern
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

# Docker (if needed)
docker ps                 # See running containers
docker logs <container>   # View container logs

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

---

**Last Updated**: 2025-01
**What to add**: Gotchas you discover, non-obvious patterns, time-saving tips
**Environment**: Hetzner VPS, Production, Docker-based services
