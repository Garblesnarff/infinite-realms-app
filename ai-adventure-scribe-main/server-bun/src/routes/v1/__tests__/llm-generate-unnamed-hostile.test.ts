/* eslint-disable max-lines -- one scenario: the generate turn, the popup entry and the seat. */
/**
 * #2532 — run 20: the DM asked for combat and named nobody, so the popup read "Strike at Hostile
 * Creature?" and the engine seated "Unknown creature".
 *
 * The DM turn goes through the real `POST /v1/llm/generate` route and the real entry gate; the
 * pending entry it returns goes to the real `POST /v1/combat/sessions/:id/enter` route and the
 * real `seatCombatEntry`, whose `startCombat` dependency records the participants it is given.
 * Only the model, the auth and the campaign-index read are stubbed. The turn follows the full
 * envelope `dmEnvelope` builds in `llm-generate-combat-entry.test.ts`, with `combat_transition:
 * 'start'` and `combatants: []`.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

import {
  CHITINOUS_HUNTER_PROSE,
  namedHostilePending,
  UNNAMED_HOSTILE_PLAYER_INPUT,
  UNNAMED_HOSTILE_SESSION_ID,
  UNNAMED_THREAT_PROSE,
  unnamedHostileTurn,
} from '../../../../../shared/test-fixtures/unnamed-hostile-entry';
import {
  buildCampaignMonsterIndex,
  emptyCampaignMonsterIndex,
} from '../../../services/combat/campaign-monster-index.js';

process.env.DATABASE_URL ??= 'postgres://test.invalid/unused';
process.env.PORT ??= '8892';
process.env.CORS_ORIGIN ??= 'http://localhost:8891';
process.env.WORKOS_API_KEY ??= 'test-workos-key';
process.env.WORKOS_CLIENT_ID ??= 'test-workos-client';
process.env.NODE_ENV ??= 'test';

let generatedResult: Record<string, unknown> = { text: '{}', provider: 'openrouter', model: 'm' };
const infoLogs: Array<Record<string, unknown>> = [];
let campaignIndex = emptyCampaignMonsterIndex('');

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId: 'entry-user', email: 'entry@example.test', plan: 'free' },
    error: null,
  }),
}));
const testLogger = {
  debug: () => {},
  info: (entry: Record<string, unknown>) => {
    infoLogs.push(entry);
  },
  warn: () => {},
  error: () => {},
  child: () => testLogger,
};
mock.module('../../../lib/logger.js', () => ({
  logger: testLogger,
  combatLogger: testLogger,
  spellLogger: testLogger,
  progressionLogger: testLogger,
  errorLogSerializers: {},
  default: testLogger,
}));
mock.module('../../../middleware/admin.js', () => ({ isAdmin: () => false }));
mock.module('../../../middleware/rate-limit.js', () => ({
  planRateLimit: () => new Elysia({ name: 'test-plan-rate-limit' }),
}));
mock.module('../../../services/ai-usage-service.js', () => ({
  AIUsageService: {
    checkQuotaAndConsume: async () => ({
      allowed: true,
      remaining: 99,
      resetAt: new Date(Date.now() + 60_000),
    }),
    recordProviderUsage: async () => {},
  },
}));
mock.module('../../../services/llm-provider-service.js', () => ({
  LLMProviderService: { generate: async () => generatedResult },
}));
// The roster is empty: nobody is in the scene (the run 20 condition).
mock.module('../../../services/combat/combat-intent-roster.js', () => ({
  loadCombatIntentActorRoster: async () => [],
}));
mock.module('../../../services/combat/combat-entry-campaign-index.js', () => ({
  loadSessionCampaignMonsterIndex: async () => campaignIndex,
  // #2514: sizing reads difficulty through the same loader; these scenarios
  // predate campaign difficulty, so it reports none.
  loadSessionEncounterContext: async () => ({
    difficulty: null,
    difficultyRaw: null,
    index: campaignIndex,
  }),
}));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { llmRoutes } = await import('../llm.js');
const { createCombatEntryRoutes } = await import('../combat/entry.js');
const { seatCombatEntry } = await import('../../../services/combat/combat-entry-gate.js');

const generateApp = createRequestPipelineApp().use(llmRoutes);

const PLAYER = {
  characterId: 'c0ffee00-1111-4222-8333-444455556666',
  name: 'The Storyteller',
  initiativeModifier: 2,
};

const generate = async (): Promise<Record<string, unknown>> => {
  const response = await generateApp.handle(
    new Request('http://localhost/v1/llm/generate', {
      method: 'POST',
      headers: { authorization: 'Bearer smoke-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Continue the scene.',
        sessionId: UNNAMED_HOSTILE_SESSION_ID,
        player_input: UNNAMED_HOSTILE_PLAYER_INPUT,
        combatEntry: { sessionId: UNNAMED_HOSTILE_SESSION_ID, player: PLAYER },
      }),
    }),
  );
  expect(response.status).toBe(200);
  return JSON.parse(((await response.json()) as { text: string }).text) as Record<string, unknown>;
};

/** `seatCombatEntry` with a `startCombat` that records the participants the gate builds. */
function seatingApp(): {
  enter: (body: Record<string, unknown>) => Promise<Response>;
  seated: Array<{ name: string }[]>;
} {
  const seated: Array<{ name: string }[]> = [];
  const deps = {
    getActiveEncounter: async () => undefined,
    verifySessionOwnership: async () => ({ success: true }),
    startCombat: async (_sessionId: string, participants: Array<{ name: string }>) => {
      seated.push(participants);
      return {
        encounter: { id: 'encounter-1' },
        participants: participants.map((participant, index) => ({
          id: `participant-${index}`,
          name: participant.name,
          initiative: 15 - index,
          initiativeModifier: 0,
          turnOrder: index,
        })),
        participantSizes: {},
        turnOrder: [],
        currentParticipant: null,
      };
    },
    createTacticalCombatMap: async () => ({}),
    sanitizeSceneSpec: (raw: unknown) => ({ ok: true, sceneSpec: raw, overrides: [] }),
    trackCombatEvent: () => {},
    persistSessionMessage: async () => undefined,
    publishCombatState: async () => undefined,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  };
  const app = createRequestPipelineApp().use(
    createCombatEntryRoutes({
      combatEntryGateDeps: deps as never,
      seatCombatEntry,
      buildInitiativeOrder: (() => []) as never,
      loadSessionCampaignMonsterIndex: async () => campaignIndex,
    }),
  );
  const enter = (body: Record<string, unknown>): Promise<Response> =>
    app.handle(
      new Request(`http://localhost/sessions/${UNNAMED_HOSTILE_SESSION_ID}/enter`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ player: PLAYER, ...body }),
      }),
    );
  return { enter, seated };
}

describe('POST /v1/llm/generate — a fight the DM asked for without naming anyone (#2532)', () => {
  beforeEach(() => {
    generatedResult = { text: '{}', provider: 'openrouter', model: 'm' };
    campaignIndex = emptyCampaignMonsterIndex('');
    infoLogs.length = 0;
  });

  it('names the hostile from the prose, offers it in the popup and seats it by that name', async () => {
    generatedResult = {
      text: unnamedHostileTurn(CHITINOUS_HUNTER_PROSE),
      provider: 'openrouter',
      model: 'm',
    };
    const envelope = await generate();

    expect(envelope.combat_entry_pending).toEqual(namedHostilePending);
    expect(envelope.combat_transition).toBe('none');
    expect(envelope.text).toBe(CHITINOUS_HUNTER_PROSE);

    const { enter, seated } = seatingApp();
    const pending = envelope.combat_entry_pending as typeof namedHostilePending;
    const entered = await enter({
      combatants: pending.combatants,
      sceneSpec: pending.sceneSpec,
      playerInitiativeRoll: 12,
    });
    expect(entered.status).toBe(201);
    expect(seated).toHaveLength(1);
    expect(seated[0]?.map((participant) => participant.name)).toEqual([
      'The Storyteller',
      'Chitinous Hunter',
    ]);
  });

  it('takes the name from the campaign index when the prose names a creature in it', async () => {
    // "swarm" is not a creature word the prose reader knows: only the index can name this one.
    const prose = 'Your shout rolls down the tunnel. A light-eater swarm boils out of the wall.';
    generatedResult = { text: unnamedHostileTurn(prose), provider: 'openrouter', model: 'm' };

    const withoutIndex = await generate();
    expect(withoutIndex.combat_entry_pending).toBeUndefined();

    campaignIndex = buildCampaignMonsterIndex('abyssal-descent', [
      { entityName: 'Light-Eater Swarm', chunkType: 'monster', content: 'AC 12 HP 20' },
    ]);
    const envelope = await generate();
    expect(envelope.combat_entry_pending).toEqual({
      ...namedHostilePending,
      combatants: [{ name: 'Light-Eater Swarm', count: 1 }],
      sceneSpec: { ...namedHostilePending.sceneSpec, sceneDescription: prose },
    });
  });

  it('a captain who merely stands there is not the enemy: no popup, no "Strike at Captain?"', async () => {
    campaignIndex = buildCampaignMonsterIndex('abyssal-descent', [
      { entityName: 'Captain Sarah Reeves', chunkType: 'npc_tier1', content: 'AC 16 HP 40' },
    ]);
    const prose = 'The captain folds her arms. Something shifts in the dark beyond the torchlight.';
    generatedResult = { text: unnamedHostileTurn(prose), provider: 'openrouter', model: 'm' };
    const envelope = await generate();

    expect(envelope.combat_entry_pending).toBeUndefined();
    expect(envelope.combat_transition).toBe('none');
    expect(envelope.text).toBe(prose);
  });

  it('defers on one turn, then opens the popup and seats normally once the DM names the creature', async () => {
    generatedResult = {
      text: unnamedHostileTurn(UNNAMED_THREAT_PROSE),
      provider: 'openrouter',
      model: 'm',
    };
    const deferred = await generate();
    expect(deferred.combat_entry_pending).toBeUndefined();
    expect(deferred.combat_transition).toBe('none');

    generatedResult = {
      text: unnamedHostileTurn(CHITINOUS_HUNTER_PROSE),
      provider: 'openrouter',
      model: 'm',
    };
    const named = await generate();
    expect(named.combat_entry_pending).toEqual(namedHostilePending);

    const { enter, seated } = seatingApp();
    const pending = named.combat_entry_pending as typeof namedHostilePending;
    const entered = await enter({ combatants: pending.combatants, sceneSpec: pending.sceneSpec });
    expect(entered.status).toBe(201);
    expect(seated[0]?.map((participant) => participant.name)).toEqual([
      'The Storyteller',
      'Chitinous Hunter',
    ]);
  });

  it('starts no encounter when nothing names the creature: the DM narrates, an engine notice is logged', async () => {
    generatedResult = {
      text: unnamedHostileTurn(UNNAMED_THREAT_PROSE, {
        roll_requests: [
          { type: 'attack', formula: '1d20+4', purpose: 'Strike', dc: null, ac: null },
          { type: 'skill', formula: '1d20+3', purpose: 'Perception', dc: 12, ac: null },
        ],
      }),
      provider: 'openrouter',
      model: 'm',
    };
    const envelope = await generate();

    expect(envelope.combat_entry_pending).toBeUndefined();
    expect(envelope.combat_transition).toBe('none');
    expect(envelope.combatants).toBeUndefined();
    expect(envelope.text).toBe(UNNAMED_THREAT_PROSE);
    expect(envelope.roll_requests).toEqual([
      { type: 'skill', formula: '1d20+3', purpose: 'Perception', dc: 12, ac: null },
    ]);
    expect(JSON.stringify(envelope)).not.toMatch(/hostile creature|unknown creature/i);
    expect(infoLogs).toContainEqual(
      expect.objectContaining({
        msg: 'COMBAT_ENTRY_UNNAMED_HOSTILE_DEFERRED',
        event: 'engine_notice',
        sessionId: UNNAMED_HOSTILE_SESSION_ID,
        trigger: 'combat_transition',
      }),
    );
  });
});

describe('POST /v1/combat/sessions/:id/enter — a body that still carries the placeholder (#2532)', () => {
  beforeEach(() => {
    campaignIndex = emptyCampaignMonsterIndex('');
    infoLogs.length = 0;
  });

  const placeholderBody = (sceneDescription: string): Record<string, unknown> => ({
    // What a client holding a pre-fix pending entry sends: the label the gate used to fall back to.
    combatants: [{ name: 'Hostile Creature', count: 1 }],
    sceneSpec: { ...namedHostilePending.sceneSpec, sceneDescription },
  });

  it('seats nothing when no name is found anywhere', async () => {
    const { enter, seated } = seatingApp();
    const response = await enter(placeholderBody(UNNAMED_THREAT_PROSE));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: 'Invalid combat entry payload',
      detail: 'combatants must name at least one creature',
    });
    expect(seated).toHaveLength(0);
    expect(infoLogs).toContainEqual(
      expect.objectContaining({ msg: 'COMBAT_ENTRY_UNNAMED_HOSTILE_REFUSED' }),
    );
  });

  it('seats the creature the scene text names, never the placeholder', async () => {
    const { enter, seated } = seatingApp();
    const response = await enter(placeholderBody(CHITINOUS_HUNTER_PROSE));
    expect(response.status).toBe(201);
    expect(seated[0]?.map((participant) => participant.name)).toEqual([
      'The Storyteller',
      'Chitinous Hunter',
    ]);
  });

  it('drops a placeholder beside a declared target and never names it from the scene text', async () => {
    const { enter, seated } = seatingApp();
    const response = await enter({
      combatants: [
        { name: 'Hostile Creature', count: 1 },
        { name: 'Valerius', count: 1 },
      ],
      declaredAttack: { verb: 'cast Chill Touch', actorName: 'Valerius' },
      sceneSpec: { ...namedHostilePending.sceneSpec, sceneDescription: CHITINOUS_HUNTER_PROSE },
    });
    expect(response.status).toBe(201);
    expect(seated[0]?.map((participant) => participant.name)).toEqual([
      'The Storyteller',
      'Valerius',
    ]);
  });
});
