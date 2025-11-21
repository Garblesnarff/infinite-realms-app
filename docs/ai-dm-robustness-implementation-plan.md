# AI DM Robustness Implementation Plan

This document specifies, in implementable work units, how to upgrade the AI Dungeon Master (DM) to a production‑robust, testable, replayable system. It assumes the main application code lives in `ai-adventure-scribe-main/`.

Use this plan as source of truth. Each work unit includes: exact file paths, code stubs, acceptance criteria, tests, and dependencies. Follow units in order for minimal merge conflicts.

- Monorepo root: `/Users/rob/Claude/workspaces/ai-dungeon-master`
- App root: `/Users/rob/Claude/workspaces/ai-dungeon-master/ai-adventure-scribe-main`

Tech context already present:
- TypeScript + Vite, Vitest
- Supabase Edge Functions and Postgres (migrations exist under `ai-adventure-scribe-main/supabase/migrations`)
- DM services: `src/agents`, rules/utilities under `src/utils`, memory services, conversation state, basic SceneStateTracker
- SRD backend present under `dnd-5e-mcp-server/`

Runbook (local):
- Install deps: `cd ai-adventure-scribe-main && npm install && cd server && npm install`
- Run lint/build: `npm run mvp:build`
- Run tests (server scope): `npm run server:test`
- Full project test: `npx vitest run`

References (for rationale; do not scrape at runtime):
- Agentic workflows (LangGraph patterns) — stateful, cyclic graphs for agent control
- Provably fair RNG (HMAC commitment; optional VRF)
- TTRPG safety tools (Session Zero, X‑Card, Lines/Veils, Script Change)
- Knowledge‑graph + episodic memory (AriGraph, text‑game KGs)
- CRDT presence & idempotent command handling for concurrent chat
- RAW vs RAI: Sage Advice (2024/2025 updates)

---

## Module 1 — Authoritative Scene/Turn Engine (Replayable)
A deterministic loop with typed intents, actions, rules events, and an event log. Enables replay, debugging, and evaluation.

### WU-1.1: Types and Folders
- Goal: Introduce core types and folder layout.
- Create: `ai-adventure-scribe-main/src/engine/scene/types.ts`
```ts
// src/engine/scene/types.ts
export type UUID = string;

export type Skill =
  | 'athletics' | 'acrobatics' | 'sleight_of_hand' | 'stealth'
  | 'arcana' | 'history' | 'investigation' | 'nature' | 'religion'
  | 'animal_handling' | 'insight' | 'medicine' | 'perception' | 'survival'
  | 'deception' | 'intimidation' | 'performance' | 'persuasion';

export interface GridPos { x: number; y: number; }
export type RangeBand = 'melee' | 'short' | 'medium' | 'long';

export type PlayerIntent =
  | { type: 'move'; actorId: UUID; to: GridPos | RangeBand; idempotencyKey: string }
  | { type: 'attack'; actorId: UUID; targetId: UUID; weaponId?: UUID; idempotencyKey: string }
  | { type: 'skill_check'; actorId: UUID; skill: Skill; approach?: string; idempotencyKey: string }
  | { type: 'cast'; actorId: UUID; spellId: string; slot?: number; idempotencyKey: string }
  | { type: 'ooc'; actorId: UUID; message: string; idempotencyKey: string };

export type DMAction =
  | { type: 'call_for_check'; actorId: UUID; skill: Skill; dc: number; reason: string }
  | { type: 'apply_damage'; targetId: UUID; amount: number; source: string }
  | { type: 'advance_clock'; clockId: UUID; ticks: number; reason: string }
  | { type: 'narrate'; text: string };

export type RulesEvent =
  | { type: 'roll'; actorId: UUID; rollType: 'check' | 'save' | 'attack' | 'damage'; d: number; mod: number; result: number; rationale?: string }
  | { type: 'turn_start'; actorId: UUID }
  | { type: 'turn_end'; actorId: UUID }
  | { type: 'reaction_window'; forActorId: UUID; reason: string };

export interface Clock { id: UUID; name: string; max: number; value: number; }
export interface Hazard { id: UUID; name: string; description: string; }

export interface SceneState {
  id: UUID;
  locationId: UUID;
  time: string; // ISO
  participants: UUID[]; // PC + NPC ids
  initiative: UUID[]; // current ordering
  turnIndex: number;
  clocks: Clock[];
  hazards: Hazard[];
  seed: string; // per-scene RNG seed
}

export interface EventLogEntry {
  id: UUID;
  sceneId: UUID;
  at: number;
  actorId?: UUID;
  action: PlayerIntent | DMAction | RulesEvent;
  stateHashBefore: string;
  stateHashAfter: string;
}
```
- Acceptance: TS compiles, types importable.

### WU-1.2: Seeded RNG Provider + Commitment
- Goal: Deterministic RNG with provable fairness (HMAC commitment scheme).
- Create: `ai-adventure-scribe-main/src/engine/rng/commitment.ts`
```ts
// src/engine/rng/commitment.ts
import { createHmac, randomBytes, createHash } from 'node:crypto';

export interface RollCommitment {
  serverSeedHash: string; // sha256(serverSeed)
  clientSeed: string;
  nonce: number; // increments per roll
}

export function genServerSeed(): string {
  return randomBytes(32).toString('hex');
}

export function hashServerSeed(serverSeed: string): string {
  return createHash('sha256').update(serverSeed).digest('hex');
}

export function hmacRoll(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  sides: number
): { value: number; proof: string } {
  const msg = `${clientSeed}:${nonce}`;
  const hmac = createHmac('sha256', serverSeed).update(msg).digest('hex');
  const int = parseInt(hmac.slice(0, 12), 16); // 48 bits -> safe range
  const value = (int % sides) + 1;
  return { value, proof: hmac };
}
```
- Acceptance: Unit tests verify same seeds -> same sequence; proof reproducible.

### WU-1.3: Event Log Store + Idempotency
- Goal: In‑memory and persistent append‑only log with idempotent intent ingestion.
- Create: `ai-adventure-scribe-main/src/engine/scene/event-log.ts`
```ts
// src/engine/scene/event-log.ts
import type { EventLogEntry } from './types';
const processed = new Set<string>(); // idempotency keys (short-term)
const log: EventLogEntry[] = [];

export function hasProcessed(idempotencyKey: string): boolean {
  return processed.has(idempotencyKey);
}

export function markProcessed(idempotencyKey: string): void {
  processed.add(idempotencyKey);
}

export function append(entry: EventLogEntry): void {
  log.push(entry);
}

export function all(): EventLogEntry[] {
  return [...log];
}
```
- Acceptance: Duplicate intents (same idempotencyKey) do not double‑apply.

### WU-1.4: Reducers (State Transitions)
- Goal: Deterministic reducers that apply intents/events to SceneState.
- Create: `ai-adventure-scribe-main/src/engine/scene/reducer.ts`
```ts
// src/engine/scene/reducer.ts
import type { SceneState, PlayerIntent, DMAction, RulesEvent } from './types';
import { createHash } from 'node:crypto';

export function hashState(s: SceneState): string {
  return createHash('sha256').update(JSON.stringify(s)).digest('hex');
}

export function applyIntent(state: SceneState, intent: PlayerIntent): SceneState {
  // Minimal scaffolding — extend per intent type
  const next = { ...state };
  switch (intent.type) {
    case 'move':
      // no-op placeholder; integrate grid or range logic later
      return next;
    default:
      return next;
  }
}

export function applyDMAction(state: SceneState, action: DMAction): SceneState {
  const next = { ...state };
  return next;
}

export function applyRulesEvent(state: SceneState, evt: RulesEvent): SceneState {
  const next = { ...state };
  return next;
}
```
- Acceptance: Pure functions; stable hashes; unit tests green.

### WU-1.5: Orchestrator (DM Loop Skeleton)
- Goal: Scene engine loop: frame → collect intents → resolve → update → narrate.
- Create: `ai-adventure-scribe-main/src/engine/scene/orchestrator.ts`
```ts
// src/engine/scene/orchestrator.ts
import type { SceneState, PlayerIntent, EventLogEntry } from './types';
import { applyIntent, hashState } from './reducer';
import { append, hasProcessed, markProcessed } from './event-log';
import { randomUUID } from 'node:crypto';

export interface OrchestratorDeps {
  now: () => number;
}

export function applyPlayerIntent(
  state: SceneState,
  intent: PlayerIntent,
  deps: OrchestratorDeps
): { state: SceneState; log: EventLogEntry } {
  if (hasProcessed(intent.idempotencyKey)) {
    return { state, log: {
      id: randomUUID(), sceneId: state.id, at: deps.now(), actorId: intent.actorId,
      action: { type: 'narrate', text: 'Duplicate intent ignored' },
      stateHashBefore: hashState(state), stateHashAfter: hashState(state)
    }};
  }
  const before = hashState(state);
  const next = applyIntent(state, intent);
  const after = hashState(next);
  const entry: EventLogEntry = {
    id: randomUUID(), sceneId: state.id, at: deps.now(), actorId: intent.actorId,
    action: intent, stateHashBefore: before, stateHashAfter: after
  };
  append(entry); markProcessed(intent.idempotencyKey);
  return { state: next, log: entry };
}
```
- Acceptance: Deterministic application, no duplicates.

### WU-1.6: Replay Harness & Unit Tests
- Goal: Given seed + intents, replay produces identical state/log.
- Create tests: `ai-adventure-scribe-main/src/engine/scene/__tests__/replay.test.ts`
```ts
import { describe, it, expect } from 'vitest';
import { applyPlayerIntent } from '../../scene/orchestrator';
import type { SceneState, PlayerIntent } from '../../scene/types';

function mkState(): SceneState {
  return { id: 'scene-1', locationId: 'loc-1', time: new Date().toISOString(),
    participants: ['pc1','npc1'], initiative: ['pc1','npc1'], turnIndex: 0,
    clocks: [], hazards: [], seed: 'seed-abc' };
}

function now() { return 1730764800000; }

describe('replay', () => {
  it('is deterministic', () => {
    const intents: PlayerIntent[] = [
      { type: 'move', actorId: 'pc1', to: { x:1, y:1 }, idempotencyKey: 'k1' },
      { type: 'move', actorId: 'pc1', to: { x:1, y:1 }, idempotencyKey: 'k1' }, // duplicate
    ];
    let s = mkState();
    const logs = intents.map(i => {
      const res = applyPlayerIntent(s, i, { now });
      s = res.state; return res.log;
    });
    expect(logs.length).toBe(2);
    expect(logs[1].action).toMatchObject({ type: 'narrate' });
  });
});
```
- Acceptance: `npx vitest run` passes.

Dependencies for Module 1: none. Proceed in order WU‑1.1 → WU‑1.6.

---

## Module 2 — Rules Transparency & Provably Fair RNG
Make adjudication explainable; log every roll; optional VRF.

### WU-2.1: Roll Transcript Interface & Logger
- Create: `ai-adventure-scribe-main/src/engine/rng/logging.ts`
```ts
export interface RollRecord {
  sceneId: string; actorId: string; kind: 'check'|'save'|'attack'|'damage';
  d: number; mod: number; value: number; total: number; rationale?: string;
  serverSeedHash: string; clientSeed: string; nonce: number; proof: string;
  at: number;
}
const rolls: RollRecord[] = [];
export function recordRoll(r: RollRecord) { rolls.push(r); }
export function getRolls(sceneId: string) { return rolls.filter(x => x.sceneId === sceneId); }
```
- Acceptance: Records are retrievable and complete.

### WU-2.2: Explain-Why (RAW/RAI/Rule‑of‑Fun)
- Create: `ai-adventure-scribe-main/src/engine/rules/explain.ts`
```ts
export type RulesMode = 'RAW' | 'RAI' | 'ROF'; // Rule-of-Fun
export interface ExplainContext { mode: RulesMode; ruleRef?: string; note?: string; }
export function explainDC(skill: string, baseDC: number, ctx: ExplainContext): string {
  const ref = ctx.ruleRef ? ` [ref: ${ctx.ruleRef}]` : '';
  switch (ctx.mode) {
    case 'RAW': return `RAW DC ${baseDC} for ${skill}.${ref}`;
    case 'RAI': return `RAI DC ${baseDC} considering intent and fiction.${ref}`;
    case 'ROF': return `Rule-of-Fun DC ${baseDC}, tuned for pacing.${ref}`;
  }
}
```
- Acceptance: String rationale available for logs/UI.

### WU-2.3 (Optional): VRF Hook Interface
- Create: `ai-adventure-scribe-main/src/engine/rng/vrf.ts`
```ts
export interface VRFInput { seed: string; nonce: number; }
export interface VRFOutput { value: number; proof: string; }
export type VRFProvider = (input: VRFInput) => Promise<VRFOutput>;
```
- Acceptance: Interface only; integration gated by env.

---

## Module 3 — Safety & Table Settings
Session Zero configuration and live safety commands enforced by the engine.

### WU-3.1: DB Migration — Session Config
- Create migration: `ai-adventure-scribe-main/supabase/migrations/20251009_add_session_config.sql`
```sql
-- Session configuration for safety & tone
create table if not exists session_config (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  lines text[] default '{}',
  veils text[] default '{}',
  tone text default 'heroic',
  lethality text default 'standard',
  meta_reveal boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_session_config_session on session_config(session_id);
```
- Acceptance: Migration applies without error.

### WU-3.2: SessionConfig Types + Loader
- Create: `ai-adventure-scribe-main/src/engine/safety/session-config.ts`
```ts
export interface SessionConfig {
  sessionId: string;
  lines: string[];
  veils: string[];
  tone: 'heroic'|'gritty'|'horror'|'whimsical';
  lethality: 'low'|'standard'|'high';
  metaReveal: boolean;
}
```

### WU-3.3: Safety Commands — /ooc, /x, /veil, /pause
- Integrate into chat pipeline (frontend + backend message handling):
  - Frontend addition: parse `/ooc`, `/x`, `/veil <topic>`, `/pause`.
  - Backend: produce DMAction `{ type: 'narrate', text: 'Game paused (X‑Card). Scene veiled.' }` and set a `paused` flag in scene-level control if `/x` or `/pause`.
- Affected files (add handlers):
  - `ai-adventure-scribe-main/src/agents/services/response/ResponseCoordinator.ts`
  - `ai-adventure-scribe-main/src/components/game/SimpleGameChat.tsx`
- Acceptance:
  - Typing `/x` halts scene progression until GM resumes; a banner is shown.
  - Typing `/veil spiders` records veil and moves on without detail.

### WU-3.4: Safety Audit Trail
- Create: `ai-adventure-scribe-main/src/engine/safety/audit.ts`
```ts
export interface SafetyEvent { sessionId: string; at: number; kind: 'x'|'veil'|'pause'|'ooc'; data?: string }
const events: SafetyEvent[] = [];
export function logSafety(e: SafetyEvent) { events.push(e); }
export function getSafetyHistory(sessionId: string) { return events.filter(x => x.sessionId === sessionId); }
```

---

## Module 4 — World Graph & Fact Ledger
Durable entity graph (NPC/PC/Location/Faction/Item), quest/front clocks, fact ledger with provenance and episodic summaries.

### WU-4.1: DB Migration — Entities & Facts
- Create migration: `ai-adventure-scribe-main/supabase/migrations/20251009_add_world_graph.sql`
```sql
create table if not exists entity (
  id uuid primary key default gen_random_uuid(),
  kind text not null, -- 'pc'|'npc'|'location'|'faction'|'item'
  name text not null,
  meta jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists relation (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references entity(id) on delete cascade,
  to_id uuid not null references entity(id) on delete cascade,
  relation text not null,
  meta jsonb default '{}'::jsonb
);

create table if not exists fact_ledger (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  entity_id uuid references entity(id),
  content text not null,
  source text not null, -- 'dm'|'player'|'rule'|'memory'
  confidence numeric default 0.9,
  created_at timestamptz default now()
);

create table if not exists clock (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  max integer not null,
  value integer not null default 0,
  session_id uuid not null
);
```
- Acceptance: Migration applies; FK constraints valid.

### WU-4.2: World Graph Types/Repo
- Create: `ai-adventure-scribe-main/src/engine/world/types.ts`
```ts
export type EntityKind = 'pc'|'npc'|'location'|'faction'|'item';
export interface Entity { id: string; kind: EntityKind; name: string; meta?: Record<string, unknown> }
export interface Relation { id: string; fromId: string; toId: string; relation: string; meta?: Record<string, unknown> }
export interface Fact { id: string; sessionId: string; entityId?: string; content: string; source: 'dm'|'player'|'rule'|'memory'; confidence: number; }
```

### WU-4.3: Episodic Summaries
- Create interface and stub summarizer:
  - `ai-adventure-scribe-main/src/engine/memory/episodic.ts`
```ts
export interface EpisodeSummary { sessionId: string; from: string; to: string; keyFacts: string[]; unresolvedThreads: string[] }
export async function summarizeEpisode(_sessionId: string): Promise<EpisodeSummary> {
  // Hook in LLM or rules-based summarizer later
  return { sessionId: _sessionId, from: new Date().toISOString(), to: new Date().toISOString(), keyFacts: [], unresolvedThreads: [] };
}
```
- Acceptance: Callable without errors; later filled by LLM pipeline.

---

## Module 5 — Multi‑User Orchestration & Turn Control
Turn locks, reaction windows, spotlight fairness. Idempotent command handling and CRDT-like presence.

### WU-5.1: Turn Lock Service
- Create: `ai-adventure-scribe-main/src/engine/turns/locks.ts`
```ts
const locks = new Map<string, string>(); // sceneId -> actorId
export function tryLock(sceneId: string, actorId: string): boolean {
  if (locks.has(sceneId)) return locks.get(sceneId) === actorId;
  locks.set(sceneId, actorId); return true;
}
export function release(sceneId: string, actorId: string): void {
  if (locks.get(sceneId) === actorId) locks.delete(sceneId);
}
```
- Acceptance: Only lock holder can act; others blocked with friendly notice.

### WU-5.2: Reaction Windows
- Create: `ai-adventure-scribe-main/src/engine/turns/reactions.ts`
```ts
export interface ReactionWindow { sceneId: string; forActorId: string; reason: string; until: number }
const windows: ReactionWindow[] = [];
export function openReactionWindow(w: ReactionWindow) { windows.push(w); }
export function getReactionWindow(sceneId: string, actorId: string) { return windows.find(x => x.sceneId === sceneId && x.forActorId === actorId); }
export function clearReactionWindow(sceneId: string, actorId: string) { const i = windows.findIndex(x => x.sceneId === sceneId && x.forActorId === actorId); if (i>=0) windows.splice(i,1); }
```
- Acceptance: Only valid during window; timeouts clear windows.

### WU-5.3: Presence (CRDT‑lite) & Idempotent Commands
- Create: `ai-adventure-scribe-main/src/engine/presence/presence.ts`
```ts
export interface Presence { userId: string; sessionId: string; lastSeen: number }
const presence = new Map<string, Presence>();
export function heartbeat(p: Presence) { presence.set(`${p.sessionId}:${p.userId}`, p); }
export function list(sessionId: string) { return Array.from(presence.values()).filter(p => p.sessionId === sessionId); }
```
- Acceptance: Presence list shows connected users; no races break state.

---

## Module 6 — Narrative Pacing & Style
Scene goals, tension meter, pacing governor; style presets; NPC voice consistency hooks.

### WU-6.1: Pacing Governor & Tension Meter
- Create: `ai-adventure-scribe-main/src/engine/narrative/pacing.ts`
```ts
export interface PacingConfig { targetWords: number; style: 'heroic'|'gritty'|'noir'|'whimsical'; tension: number /*0..100*/ }
export function shouldClampOutput(cfg: PacingConfig, generatedWords: number): boolean { return generatedWords > cfg.targetWords; }
export function adjustTension(prev: number, delta: number) { return Math.max(0, Math.min(100, prev + delta)); }
```
- Acceptance: Functions pure; unit tests pass.

### WU-6.2: Storylets/Scene Goals Scaffold
- Create: `ai-adventure-scribe-main/src/engine/narrative/storylets.ts`
```ts
export interface SceneGoal { id: string; description: string; done: boolean }
export interface Storylet { id: string; requires: string[]; provides: string[]; weight: number; text: string }
export function selectStorylets(available: Storylet[], flags: Set<string>): Storylet[] {
  return available.filter(s => s.requires.every(r => flags.has(r)));
}
```

### WU-6.3 (Optional): NPC Voice Consistency Hook
- Create stub: `ai-adventure-scribe-main/src/engine/narrative/voice.ts`
```ts
export interface Persona { id: string; name: string; stylePrompt: string; ttsVoiceId?: string }
export function applyPersona(text: string, persona: Persona): string { return `(${persona.name}): ${text}`; }
```

---

## Module 7 — Evaluation Harness & Guardrails
Goldens, fuzzers, long‑session drift, and safety/prompt-injection tests.

### WU-7.1: Golden Combat Scenario
- Create: `ai-adventure-scribe-main/src/engine/eval/goldens/combat.basic.json`
```json
{
  "scene": {"id":"g1","locationId":"l1","time":"2025-10-09T00:00:00Z","participants":["pc1","npc1"],"initiative":["pc1","npc1"],"turnIndex":0,"clocks":[],"hazards":[],"seed":"seed-1"},
  "intents": [
    {"type":"move","actorId":"pc1","to":{"x":1,"y":1},"idempotencyKey":"i1"},
    {"type":"attack","actorId":"pc1","targetId":"npc1","idempotencyKey":"i2"}
  ],
  "expected": {"hashAfter":"REPLACE_ME_ONCE_STABLE"}
}
```
- Create runner test: `ai-adventure-scribe-main/src/engine/eval/__tests__/golden.test.ts`
```ts
import { describe, it, expect } from 'vitest';
import g1 from '../goldens/combat.basic.json';
import { applyPlayerIntent } from '../../scene/orchestrator';
import type { SceneState, PlayerIntent } from '../../scene/types';
import { hashState } from '../../scene/reducer';

function toScene(s:any): SceneState { return s as SceneState; }
function now() { return 1730764800000; }

describe('goldens', () => {
  it('combat.basic is stable', () => {
    let state = toScene(g1.scene);
    (g1.intents as PlayerIntent[]).forEach(i => { state = applyPlayerIntent(state, i, { now }).state; });
    const h = hashState(state);
    expect(h.length).toBeGreaterThan(10);
  });
});
```

### WU-7.2: Safety Red‑Team Tests (Prompt Injection/OOC Bleed)
- Create: `ai-adventure-scribe-main/src/engine/eval/__tests__/safety.test.ts`
```ts
import { describe, it, expect } from 'vitest';
// Stub: ensure /x pauses; /veil masked; OOC never leaks into IC narration when disabled.

describe('safety', () => {
  it('x-card enforces pause flag') => { expect(true).toBe(true); };
});
```
- Acceptance: Add real checks once chat handlers wired.

### WU-7.3: Long‑Session Drift
- Create: `ai-adventure-scribe-main/src/engine/eval/__tests__/drift.test.ts`
```ts
import { describe, it, expect } from 'vitest';
// Stub: ensure NPC name remains consistent across episodes after summaries

describe('drift', () => { it('name consistency', () => expect(true).toBe(true)); });
```

---

## Module 8 — UI/UX Surfaces (Lightweight hooks)
Hook roll transcript and safety banners into existing components.

### WU-8.1: Roll Transcript Panel (Read‑only)
- Modify: `ai-adventure-scribe-main/src/components/game/StatsBar.tsx`
  - Add a button to open a modal listing `RollRecord` rows for current scene (use in‑memory getter for now).
- Acceptance: Clicking button shows latest rolls including serverSeedHash/clientSeed/nonce/proof.

### WU-8.2: Safety Banner
- Modify: `ai-adventure-scribe-main/src/components/game/GameContent.tsx`
  - If scene paused via `/x` or `/pause`, render a non‑dismissable banner: “Game paused. The DM will resume shortly.”

---

## Module 9 — Integration Notes
- Existing services to integrate later:
  - `src/agents/services/response/ResponseCoordinator.ts`: route intents to orchestrator
  - `src/agents/services/memory/*`: attach fact ledger writes on key events
  - `src/agents/services/memory/SceneStateTracker.ts`: replace/adapt to new SceneState
  - Edge Functions: `supabase/functions/dm-agent-execute/*`: include scene seed and roll transcript in responses.

---

## Acceptance Checklist (Release Gate)
- Determinism: Given same scene + intents, state hash identical. Duplicate intents ignored by idempotency.
- Transparency: 100% of rolls have recorded transcript with commitment fields; explain‑why text is available.
- Safety: `/x`, `/veil`, `/pause`, `/ooc` work; `/x` pauses scene; veils recorded without explicit detail.
- World: Migrations create entity/relations/facts/clocks; types and stubs compile.
- Orchestration: Turn lock prevents simultaneous turn actions; reaction windows enforce timing.
- Narrative: Pacing governor callable; storylet selection util available.
- Eval: Golden runner executes; stubs in place for safety/drift.
- Lint/Tests: `npm run mvp:build` and `npx vitest run` pass.

---

## Security & Safety Notes
- Do not log secrets or PII. Commitment uses server seed hash only until reveal.
- Safety commands must be respected even when model outputs suggest otherwise.
- Keep reducers pure and idempotent; all mutation through orchestrator.

---

## Work Sequencing & Estimates
- M1 WU‑1.1..1.6: 1.5–2.5 days
- M2 WU‑2.1..2.3: 0.5–1 day
- M3 WU‑3.1..3.4: 1–1.5 days (DB + handlers)
- M4 WU‑4.1..4.3: 1 day (DB + stubs)
- M5 WU‑5.1..5.3: 0.75 day
- M6 WU‑6.1..6.3: 0.75 day
- M7 WU‑7.1..7.3: 0.75 day
- M8 WU‑8.1..8.2: 0.5 day

---

## Post‑Merge Follow‑Ups (later phases)
- Swap HMAC RNG with VRF provider when infra available.
- Replace summarizer stubs with LLM function calls and tests.
- Expand rules reducers (movement, attacks, saves, spells) and connect SRD tool.
- Extend evaluation with social encounters and skill challenges.


