/* eslint-disable max-lines -- one scenario family: the untargeted-spell directive and its negatives. */
/**
 * GP-060 (#313): a typed combat action with no resolvable target
 * ("I fling my palms toward the creature's maw and cast Burning Hands") must start
 * combat instead of being narrated as flavor. The intent gate cannot name the creature
 * from a body part, so the route appends an `<untargeted_spell>` DM directive telling
 * the DM to name the hostile creature in `combatants` with combat_transition:'start'
 * (unresolved). The entry gate then validates the named creature against the scene
 * roster and returns the pending entry; the engine resolves the cast on confirm.
 *
 * The DM turn goes through the real `POST /v1/llm/generate` route. Only the model,
 * the auth, the usage service and the roster/index reads are stubbed — no live
 * provider calls.
 */
import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

process.env.DATABASE_URL ??= 'postgres://postgres:postgres@127.0.0.1:55432/postgres';
process.env.PORT ??= '8892';
process.env.CORS_ORIGIN ??= 'http://localhost:8891';
process.env.WORKOS_API_KEY ??= 'test-workos-key';
process.env.WORKOS_CLIENT_ID ??= 'test-workos-client';
process.env.NODE_ENV ??= 'test';

const generatedInputs: Array<Record<string, unknown>> = [];
let generatedResult: Record<string, unknown> = { text: '{}', provider: 'openrouter', model: 'm' };
let intentActors: Array<Record<string, unknown>> = [];

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId: 'untargeted-user', email: 'untargeted@example.test', plan: 'free' },
    error: null,
  }),
}));
const testLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
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
  LLMProviderService: {
    generate: async (input: Record<string, unknown>) => {
      generatedInputs.push(input);
      return generatedResult;
    },
  },
}));
mock.module('../../../services/combat/combat-intent-roster.js', () => ({
  loadCombatIntentActorRoster: async () => intentActors,
}));
mock.module('../../../services/combat/combat-entry-campaign-index.js', () => ({
  loadSessionCampaignMonsterIndex: async () => ({
    campaignId: 'campaign-gp060',
    byKey: new Map(),
    chunkCount: 0,
    blocklessNpcs: new Map(),
  }),
  loadSessionEncounterContext: async () => ({
    difficulty: null,
    difficultyRaw: null,
    index: {
      campaignId: 'campaign-gp060',
      byKey: new Map(),
      chunkCount: 0,
      blocklessNpcs: new Map(),
    },
  }),
}));
mock.module('../../../services/session/session-message-service.js', () => ({
  SessionMessageService: {
    withRollTurn: async (
      _sessionId: string,
      _userId: string,
      _playerInput: string | undefined,
      _rollId: string | undefined,
      _replyId: string | undefined,
      generate: () => Promise<unknown>,
    ) => generate(),
  },
}));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { appendUntargetedSpellDirective, attachUntargetedSpellAttack, llmRoutes } =
  await import('../llm.js');
const app = createRequestPipelineApp().use(llmRoutes);

const SESSION_ID = '22222222-3333-4444-8555-666666666666';
const COMBAT_ENTRY = {
  sessionId: SESSION_ID,
  player: { characterId: 'char-1', name: 'The Scholar', initiativeModifier: 1 },
};
const WALL_MOUTH = { name: 'Wall-Mouth', slug: 'wall-mouth', monsterId: 'wall-mouth' };

const dmEnvelope = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    text: 'Flames wash over the creature.',
    narration_segments: [],
    roll_requests: [],
    combat_transition: 'none',
    scene_spec: null,
    map_actions: [],
    handout_actions: [],
    combatants: [],
    combat_actions: [],
    ...overrides,
  });

const generate = async (body: Record<string, unknown>): Promise<Response> =>
  app.handle(
    new Request('http://localhost/v1/llm/generate', {
      method: 'POST',
      headers: { authorization: 'Bearer <redacted>', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

describe('POST /v1/llm/generate — untargeted damaging spell (GP-060, #313)', () => {
  it('appends the untargeted-spell directive for a damaging spell with no resolvable target', async () => {
    intentActors = [WALL_MOUTH];
    generatedInputs.length = 0;
    generatedResult = { text: dmEnvelope(), provider: 'openrouter', model: 'm' };

    const response = await generate({
      prompt: 'Continue the scene.',
      player_input: "I fling my palms toward the creature's maw and cast Burning Hands.",
      combatEntry: COMBAT_ENTRY,
    });

    expect(response.status).toBe(200);
    expect(generatedInputs).toHaveLength(1);
    const prompt = String(generatedInputs[0].prompt);
    expect(prompt).toContain('<untargeted_spell name="Burning Hands">');
    expect(prompt).toContain("combat_transition:'start'");
    expect(prompt).toContain('Do NOT resolve it');
  });

  it('does not append the directive when the scene roster is empty', async () => {
    intentActors = [];
    generatedInputs.length = 0;
    generatedResult = { text: dmEnvelope(), provider: 'openrouter', model: 'm' };

    const response = await generate({
      prompt: 'Continue the scene.',
      player_input: "I fling my palms toward the creature's maw and cast Burning Hands.",
      combatEntry: COMBAT_ENTRY,
    });

    expect(response.status).toBe(200);
    expect(generatedInputs).toHaveLength(1);
    expect(String(generatedInputs[0].prompt)).not.toContain('<untargeted_spell');
  });

  it('does not append the directive for a pronoun target (the DM answers first, #2341)', async () => {
    intentActors = [WALL_MOUTH];
    generatedInputs.length = 0;
    generatedResult = { text: dmEnvelope(), provider: 'openrouter', model: 'm' };

    const response = await generate({
      prompt: 'Continue the scene.',
      player_input: 'I cast Fire Bolt at him.',
      combatEntry: COMBAT_ENTRY,
    });

    expect(response.status).toBe(200);
    expect(generatedInputs).toHaveLength(1);
    expect(String(generatedInputs[0].prompt)).not.toContain('<untargeted_spell');
  });

  it('does not append the directive for a non-damaging spell', async () => {
    intentActors = [WALL_MOUTH];
    generatedInputs.length = 0;
    generatedResult = { text: dmEnvelope(), provider: 'openrouter', model: 'm' };

    const response = await generate({
      prompt: 'Continue the scene.',
      player_input: 'I cast Light to see better.',
      combatEntry: COMBAT_ENTRY,
    });

    expect(response.status).toBe(200);
    expect(generatedInputs).toHaveLength(1);
    expect(String(generatedInputs[0].prompt)).not.toContain('<untargeted_spell');
  });

  it('does not append the directive for a damaging spell used on an object (burn the webs)', async () => {
    intentActors = [WALL_MOUTH];
    generatedInputs.length = 0;
    generatedResult = { text: dmEnvelope(), provider: 'openrouter', model: 'm' };

    const response = await generate({
      prompt: 'Continue the scene.',
      player_input: 'I cast Burning Hands to burn the webs blocking the corridor.',
      combatEntry: COMBAT_ENTRY,
    });

    expect(response.status).toBe(200);
    expect(generatedInputs).toHaveLength(1);
    expect(String(generatedInputs[0].prompt)).not.toContain('<untargeted_spell');
  });

  it('does not append the directive for a damaging spell aimed at a named object (at the webs)', async () => {
    intentActors = [WALL_MOUTH];
    generatedInputs.length = 0;
    generatedResult = { text: dmEnvelope(), provider: 'openrouter', model: 'm' };

    const response = await generate({
      prompt: 'Continue the scene.',
      player_input: 'I cast Burning Hands at the webs.',
      combatEntry: COMBAT_ENTRY,
    });

    expect(response.status).toBe(200);
    expect(generatedInputs).toHaveLength(1);
    expect(String(generatedInputs[0].prompt)).not.toContain('<untargeted_spell');
  });

  it('the directed DM answer produces a pending entry that carries the cast as the declared attack', async () => {
    intentActors = [WALL_MOUTH];
    generatedInputs.length = 0;
    generatedResult = {
      text: dmEnvelope({
        text: 'The Wall-Mouth rears back as flames gather at your palms.',
        combat_transition: 'start',
        combatants: [{ name: 'Wall-Mouth', monster_id: 'wall-mouth', count: 1 }],
      }),
      provider: 'openrouter',
      model: 'm',
    };

    const response = await generate({
      prompt: 'Continue the scene.',
      player_input: "I fling my palms toward the creature's maw and cast Burning Hands.",
      combatEntry: COMBAT_ENTRY,
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { text: string };
    const envelope = JSON.parse(body.text) as Record<string, unknown>;
    expect(envelope.combat_transition).toBe('none');
    expect(envelope.combat_entry_pending).toMatchObject({
      combatants: [{ name: 'Wall-Mouth', count: 1 }],
      declaredAttack: {
        verb: 'cast Burning Hands',
        actorName: 'Wall-Mouth',
        attackSource: 'spell',
        spellId: 'burning-hands',
        spellName: 'Burning Hands',
      },
    });
  });

  it('appendUntargetedSpellDirective names the spell, demands combatants, and forbids resolution', () => {
    const out = appendUntargetedSpellDirective('base prompt', 'Burning Hands');
    expect(out.startsWith('base prompt')).toBe(true);
    expect(out).toContain('<untargeted_spell name="Burning Hands">');
    expect(out).toContain('Name the hostile creature the spell is aimed at in combatants');
    expect(out).toContain("emit combat_transition:'start'");
    expect(out).toContain('Do NOT resolve it');
  });

  it('appendUntargetedSpellDirective escapes the spell name for the XML attribute', () => {
    const out = appendUntargetedSpellDirective('base', 'A"B<C>');
    expect(out).toContain('name="A&quot;B&lt;C&gt;"');
  });

  it('attachUntargetedSpellAttack carries the cast onto the pending entry as a spell attack', () => {
    const pending = {
      trigger: 'combat_transition',
      combatants: [{ name: 'Wall-Mouth', monsterId: 'wall-mouth', count: 1 }],
    };
    const text = JSON.stringify({ text: 'flames gather', combat_entry_pending: pending });
    const out = JSON.parse(
      attachUntargetedSpellAttack(text, { id: 'burning-hands', name: 'Burning Hands' }, [
        { name: 'Wall-Mouth', slug: 'wall-mouth', monsterId: 'wall-mouth' },
      ]),
    ) as Record<string, any>;
    expect(out.combat_entry_pending.declaredAttack).toMatchObject({
      verb: 'cast Burning Hands',
      actorName: 'Wall-Mouth',
      attackSource: 'spell',
      spellId: 'burning-hands',
      spellName: 'Burning Hands',
    });
    expect(out.text).toBe('flames gather');
  });

  it('attachUntargetedSpellAttack is a no-op without a pending entry or with no roster match', () => {
    const spell = { id: 'burning-hands', name: 'Burning Hands' };
    const roster = [{ name: 'Wall-Mouth', slug: 'wall-mouth', monsterId: 'wall-mouth' }];
    const noPending = JSON.stringify({ text: 'flames gather' });
    expect(attachUntargetedSpellAttack(noPending, spell, roster)).toBe(noPending);
    const noMatch = JSON.stringify({
      text: 'flames gather',
      combat_entry_pending: { trigger: 'combat_transition', combatants: [{ name: 'Goblin' }] },
    });
    expect(attachUntargetedSpellAttack(noMatch, spell, roster)).toBe(noMatch);
    const alreadyDeclared = JSON.stringify({
      text: 'flames gather',
      combat_entry_pending: {
        trigger: 'player_intent',
        combatants: [{ name: 'Wall-Mouth' }],
        declaredAttack: { verb: 'punch', actorName: 'Wall-Mouth' },
      },
    });
    expect(attachUntargetedSpellAttack(alreadyDeclared, spell, roster)).toBe(alreadyDeclared);
    expect(attachUntargetedSpellAttack('not json', spell, roster)).toBe('not json');
  });
});
