# CLAUDE.md - Guide for AI Assistants Working on InfiniteRealms

This file contains important context, architectural patterns, and learnings for AI assistants working on the InfiniteRealms codebase.

---

## Project Overview

InfiniteRealms is a solo fantasy RPG platform with persistent worlds, multi-agent AI storytelling, and long-term memory. Players create campaigns and characters that evolve across generations in their own personal universe.

**Core Innovation**: Multi-agent AI system where specialized agents collaborate (Dungeon Master, Rules Interpreter, etc.)

---

## Architecture Quick Reference

### Frontend Structure
- **Framework**: React + TypeScript + Vite
- **State Management**: React Contexts + TanStack Query
- **UI Components**: Shadcn UI (Radix + Tailwind)
- **File Naming**: kebab-case (e.g., `passive-skills-service.ts`)

### Backend Architecture (Dual System)

#### 1. Supabase Edge Functions (Primary)
**Location**: `supabase/functions/`
**Runtime**: Deno (not Node.js!)
**Key Functions**:
- `dm-agent-execute/` - Main DM agent execution with Gemini LLM
- `rules-interpreter-execute/` - D&D 5E rules validation
- `chat-ai/` - Real-time conversational AI
- `generate-embedding/` - Vector embedding generation
- `text-to-speech/` - ElevenLabs TTS integration

**CRITICAL**: Supabase Edge Functions use Deno, not Node.js:
- Use `.ts` extension, not `.js`
- Imports use Deno-style URLs: `https://deno.land/std/...` or `npm:package-name`
- No `node_modules` - dependencies are fetched at runtime
- Cannot import from `@/` aliases - must use relative imports or inline code
- TypeScript is transpiled by Deno automatically

#### 2. Express Backend Server (Backup)
**Location**: `server/src/`
**Runtime**: Node.js
**Purpose**: Backup REST API, WebSocket chat, Stripe billing

### AI DM System Architecture

#### Core Files (DM Agent)
Located in `supabase/functions/dm-agent-execute/`:

1. **`index.ts`** - Entry point
   - Receives requests with campaign/character/memory context
   - Calculates passive scores BEFORE building prompt
   - Calls Gemini AI with enhanced prompt
   - Returns structured response

2. **`promptBuilder.ts`** - Prompt construction
   - `buildPrompt()` - Main prompt assembly function
   - Injects campaign context, character details, memories
   - Includes D&D rules education
   - Uses XML-style tags for structure

3. **`types.ts`** - TypeScript interfaces
   - `AgentContext` - Full context passed to DM
   - `CharacterContext` - Character details (level, class, abilities, passive scores)
   - `PassiveScores` - Passive skill calculations
   - `VoiceContext` - TTS integration data

4. **`passiveSkillsEvaluator.ts`** - D&D 5E passive skill calculations
   - Deno-compatible (no external imports except types)
   - Calculates passive Perception, Insight, Investigation
   - Supports Observant feat (+5 bonus)
   - Inline proficiency bonus table (can't import from frontend)

---

## D&D 5E Rules Implementation

### Passive Skills System

**What Are Passive Skills?**
According to D&D 5E Player's Handbook (p.175):
- **Formula**: `10 + ability modifier + proficiency bonus`
- **NO DICE ROLLS** - they're automatic calculations
- **Always On** - continuous background awareness
- **DM Uses Them** - players never roll for passive skills

**Three Passive Skills**:
1. **Passive Perception** (Wisdom-based) - Notice hidden creatures, traps, secret doors
2. **Passive Insight** (Wisdom-based) - Detect lies, sense motives automatically
3. **Passive Investigation** (Intelligence-based) - See through illusions, spot clues at a glance

**Observant Feat** (PHB p.168):
- Grants +5 to Passive Perception and Passive Investigation
- Must be detected in character feats and applied automatically

**When to Use Passive vs Active**:
- **PASSIVE** (automatic): Entering a room, noticing obvious features, detecting deception
- **ACTIVE** (roll): Player explicitly searches ("I search for traps"), high-stress situations

**CRITICAL BUG PATTERN**:
- ❌ WRONG: AI requesting "Make a Passive Perception check"
- This is a contradiction - passive skills are never rolled!
- ✅ CORRECT: AI automatically using passive score in narration

### Implementation Pattern

**Step 1**: Calculate passive scores (in `index.ts`):
```typescript
import { calculatePassiveScores } from './passiveSkillsEvaluator.ts';

const passiveScores = calculatePassiveScores(characterDetails);
```

**Step 2**: Inject into character context:
```typescript
const enhancedAgentContext = {
  ...agentContext,
  characterContext: {
    ...characterDetails,
    passiveScores: passiveScores
  }
};
```

**Step 3**: Include in prompt (in `promptBuilder.ts`):
```typescript
${characterContext.passiveScores ? `<passive_scores>
- Passive Perception: ${characterContext.passiveScores.perception}
- Passive Insight: ${characterContext.passiveScores.insight}
- Passive Investigation: ${characterContext.passiveScores.investigation}
</passive_scores>` : ''}
```

**Step 4**: Educate AI in system instruction (in `index.ts`):
```typescript
const systemInstruction = {
  parts: [{
    text: `CRITICAL: Passive skills are AUTOMATIC. NEVER request rolls for passive skills.
    Use the provided passive scores to reveal information in narration.`
  }]
};
```

---

## Common Development Patterns

### Adding New AI Rules/Education

When the AI DM is doing something incorrectly (violating D&D rules, wrong patterns, etc.):

1. **Research Official Rules**
   - Use web search to find official D&D 5E rules (PHB, DMG, Sage Advice)
   - Understand the "why" behind the rule
   - Note specific page references (e.g., PHB p.175)

2. **Educate Through Prompts** (Primary Method)
   - Add rules section to `promptBuilder.ts`
   - Use XML-style tags: `<passive_skills_rules>`, `<combat_rules>`, etc.
   - Include:
     - **Fundamentals**: What the rule is
     - **When to use**: Clear scenarios
     - **Forbidden patterns**: What NOT to do (with ❌ examples)
     - **Correct examples**: What TO do (with ✅ examples)

3. **Reinforce in System Instruction**
   - Add critical rules to `systemInstruction` in `index.ts`
   - Keep it concise but emphatic
   - Use "CRITICAL:", "NEVER", "ALWAYS" for important rules

4. **Provide Context Data**
   - Calculate/retrieve the data the AI needs
   - Inject it into the prompt (don't expect AI to calculate)
   - Example: Passive scores, AC, spell slots, etc.

### Working with Deno Edge Functions

**Key Differences from Node.js**:
- ✅ Use: `import { X } from "https://deno.land/..."`
- ✅ Use: `import { X } from "npm:package-name"`
- ❌ Don't use: `import { X } from '@/path'` (no path aliases)
- ❌ Don't use: `require()` (ESM only)
- ✅ Do: Inline constants/tables when you can't import
- ✅ Do: Use relative imports: `./types.ts`, `./passiveSkillsEvaluator.ts`

**Proficiency Bonus Example**:
Instead of importing from `@/data/levelProgression`, inline the table:
```typescript
const PROFICIENCY_BONUS_TABLE: Record<number, number> = {
  1: 2, 2: 2, 3: 2, 4: 2,
  5: 3, 6: 3, 7: 3, 8: 3,
  // ... etc
};
```

### Testing Changes

**Frontend Build**:
```bash
npm run build
```
- Checks TypeScript compilation
- Catches type errors
- Does NOT test Deno edge functions

**Edge Function Testing**:
- Deploy to Supabase staging/dev environment
- Test via Supabase CLI: `npx supabase functions serve`
- Manual API testing with real requests
- Monitor logs: `console.log('[DM Agent] ...')`

---

## Bead System (Issue Tracking)

This project uses **Beads** instead of traditional issue trackers.

### Commands
```bash
# Create issue
bd create "Issue title" -d "Description" -t bug -p 0

# List issues
bd list --status open

# Update status
bd update bead-id --status in_progress

# Close issue
bd close bead-id --reason "Fixed: description"
```

### Best Practices
1. **Create beads for bugs**: Track issues discovered during development
2. **Reference in commits**: Include `Closes bead: bead-id` in commit messages
3. **Update status**: Move from open → in_progress → closed
4. **Provide context**: Use `-d` flag for detailed descriptions

---

## Git Workflow

### Commit Messages
Follow this format:
```
Short summary (imperative mood)

PROBLEM:
[Describe what was wrong]

SOLUTION:
[Describe what you did to fix it]

KEY FEATURES:
✅ Feature/fix 1
✅ Feature/fix 2

Closes bead: bead-id

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

### Before Committing
1. ✅ Run `npm run build` to check for TypeScript errors
2. ✅ Update relevant bead status
3. ✅ Include bead reference in commit message
4. ✅ Push to main after successful commit

---

## Common Pitfalls & Solutions

### Pitfall 1: AI DM Contradictory Requests
**Problem**: AI asks for rolls on automatic mechanics (passive skills, death saves auto-fail on 1, etc.)

**Solution**:
1. Add education to `promptBuilder.ts` with forbidden patterns
2. Reinforce in `systemInstruction` with "NEVER" statements
3. Provide the calculated data in the prompt

### Pitfall 2: Deno Import Errors
**Problem**: `Cannot find module '@/...'` in edge functions

**Solution**:
- Use relative imports: `./types.ts`
- Or inline the data/functions
- Or use Deno-compatible URLs

### Pitfall 3: Type Mismatches
**Problem**: TypeScript errors when extending interfaces

**Solution**:
- Extend interfaces in `types.ts` first
- Make new fields optional with `?`
- Provide graceful defaults if data is missing

### Pitfall 4: Missing Character Data
**Problem**: Character context doesn't have ability scores, feats, etc.

**Solution**:
- Check where `CharacterContext` is populated (usually in `index.ts`)
- Ensure frontend is sending complete character data
- Add graceful defaults: `return 10; // Default if data incomplete`

---

## Key Files Reference

### D&D 5E Rules & Data
- `src/data/levelProgression.ts` - XP, proficiency bonuses, multiclassing
- `src/data/spellOptions.ts` - Complete D&D 5E spell lists
- `src/data/featOptions.ts` - Character feats (Observant, Alert, etc.)
- `src/services/passive-skills-service.ts` - Frontend passive skills calculations

### AI Agent System
- `supabase/functions/dm-agent-execute/index.ts` - DM agent entry point
- `supabase/functions/dm-agent-execute/promptBuilder.ts` - Prompt construction
- `supabase/functions/dm-agent-execute/types.ts` - TypeScript interfaces
- `supabase/functions/dm-agent-execute/passiveSkillsEvaluator.ts` - Deno passive skills

### Core Services
- `src/services/ai/` - AI service integration (Gemini, etc.)
- `src/services/combat/` - Combat system with D&D 5E mechanics
- `src/agents/` - Multi-agent system architecture
- `src/hooks/` - React hooks for AI responses, combat, memory

---

## Debugging Tips

### AI DM Issues
1. **Check the prompt**: Add logging in `promptBuilder.ts` to see generated prompt
2. **Check system instruction**: Verify rules are in `systemInstruction`
3. **Check context data**: Log what's being passed to `buildPrompt()`
4. **Test iteratively**: Make small prompt changes and test

### Build Errors
1. **TypeScript errors**: Run `npm run build` to catch type issues
2. **Missing types**: Add to `types.ts` and make optional with `?`
3. **Import errors**: Check if using Node.js imports in Deno code

### Edge Function Errors
1. **Check Deno syntax**: No `@/` imports, use relative paths
2. **Check logs**: Use `console.log()` liberally
3. **Test locally**: Use `npx supabase functions serve`

---

## Resources

### D&D 5E Rules
- **Player's Handbook (PHB)**: Core rules, passive skills (p.175)
- **Dungeon Master's Guide (DMG)**: DM guidance
- **Sage Advice**: Official rules clarifications from designers
- **RPG Stack Exchange**: Community D&D rules discussions

### Technical Documentation
- **Supabase Edge Functions**: https://supabase.com/docs/guides/functions
- **Deno Manual**: https://deno.land/manual
- **Gemini API**: https://ai.google.dev/docs
- **React Query (TanStack)**: https://tanstack.com/query/latest

---

## Recent Major Changes

### 2025-01: Passive Skills Integration
**What Changed**: Fixed AI DM incorrectly requesting rolls for passive skills

**Implementation**:
1. Created `passiveSkillsEvaluator.ts` (Deno-compatible)
2. Extended `CharacterContext` with passive scores, ability scores, feats
3. Enhanced prompts with passive skills education
4. Integrated into DM flow in `index.ts`

**Key Learnings**:
- Passive skills NEVER involve rolls (PHB p.175)
- Observant feat grants +5 to Passive Perception/Investigation
- AI needs explicit education on D&D rules via prompts
- System instruction reinforcement is critical for important rules

**Files Modified**:
- `supabase/functions/dm-agent-execute/passiveSkillsEvaluator.ts` (new)
- `supabase/functions/dm-agent-execute/types.ts`
- `supabase/functions/dm-agent-execute/promptBuilder.ts`
- `supabase/functions/dm-agent-execute/index.ts`

---

## Future Considerations

### When Adding New D&D Mechanics
1. Research official rules thoroughly (PHB, DMG, errata)
2. Create calculation service (frontend: `src/services/`, Deno: inline in edge function)
3. Extend `CharacterContext` type if needed
4. Add prompt education in `promptBuilder.ts`
5. Integrate into DM flow in `index.ts`
6. Test with real character data

### When AI Behavior is Wrong
1. Don't immediately code a fix - understand WHY it's wrong
2. Research the correct D&D 5E rule
3. Fix through prompt engineering FIRST (fastest)
4. Add calculations/data if AI needs context
5. Use system instruction for critical "NEVER do X" rules

### Performance Optimization
- Edge functions have cold start time (~1-2s)
- Keep prompt sizes reasonable (but don't sacrifice clarity)
- Cache frequently used data where possible
- Monitor Gemini API usage and costs

---

## Questions to Ask When Working on This Project

1. **Is this D&D 5E compliant?** - Check PHB/DMG/Sage Advice
2. **Does the AI need to calculate this?** - No! Provide the data
3. **Is this Deno or Node.js?** - Check file location (supabase/functions = Deno)
4. **Can I import this?** - Not in Deno edge functions (inline or relative import)
5. **Did I educate the AI?** - Add to prompts, system instruction, examples
6. **Did I test the build?** - Run `npm run build`
7. **Did I update the bead?** - Track progress, close when done

---

**Last Updated**: 2025-01 (Passive Skills Integration)
**Maintainer**: See AGENTS.md for AI agent profiles and guidance
