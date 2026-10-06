import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

process.env.WORKOS_API_KEY ??= 'test-workos-key';

/** #2569: every info line the route layer emits, in order. */
const infos: Array<{ msg: string; data: Record<string, unknown> }> = [];

mock.module('../../../../../../db/client', () => ({ db: {} }));

mock.module('../../../../lib/logger.js', () => ({
  logger: {
    debug: () => {},
    info: (data: Record<string, unknown>, msg?: string) => {
      infos.push({ msg: msg ?? '', data });
    },
    warn: () => {},
    error: () => {},
    child: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
  },
  combatLogger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));
mock.module('../../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId: 'user_owner', email: 'owner@example.test', plan: 'free' },
    error: null,
  }),
}));
mock.module(import.meta.resolve('../helpers.js'), () => ({
  verifySessionOwnership: async () => ({ success: true, session: { id: 'session-1' } }),
  verifyEncounterOwnership: async () => ({ success: true, session: { id: 'session-1' } }),
}));
/** Swappable so the refusal test can force a rejection from the service. */
let executeCombatIntentImpl: () => Promise<unknown> = async () => ({ ok: true });

mock.module('../../../../services/combat/combat-intent-service.js', () => ({
  getLegalCombatActions: async () => ({
    encounterId: 'enc-1',
    version: 3,
    actorId: 'actor-1',
    actions: [
      { type: 'attack', label: 'Longsword vs Goblin' },
      { type: 'attack', label: 'Dagger vs Goblin' },
      { type: 'spell', label: 'Cast Fire Bolt', spellId: 'fire-bolt' },
      { type: 'dash', label: 'Dash' },
      { type: 'end_turn', label: 'End turn' },
    ],
  }),
  executeCombatIntent: () => executeCombatIntentImpl(),
  proposeCombatAttack: async () => ({ ok: true }),
}));

const { createRequestPipelineApp } = await import('../../../../http-pipeline.js');
const { intentRoutes } = await import('../intents.js');

const app = createRequestPipelineApp().use(new Elysia({ prefix: '/v1/combat' }).use(intentRoutes));

const get = (path: string): Promise<Response> =>
  app.handle(
    new Request(`http://test${path}`, { headers: { authorization: 'Bearer <redacted>' } }),
  );
const post = (path: string, body: unknown): Promise<Response> =>
  app.handle(
    new Request(`http://test${path}`, {
      method: 'POST',
      headers: { authorization: 'Bearer <redacted>', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

describe('combat intent route diagnosability (#2569)', () => {
  beforeEach(() => {
    infos.length = 0;
  });

  it('logs one LEGAL_ACTIONS_SERVED line with option-type counts and no bodies', async () => {
    const res = await get('/v1/combat/enc-1/legal-actions');
    expect(res.status).toBe(200);

    const served = infos.filter((line) => line.msg === 'LEGAL_ACTIONS_SERVED');
    expect(served).toHaveLength(1);
    expect(served[0].data).toEqual({
      requestId: expect.any(String),
      encounterId: 'enc-1',
      actorId: 'actor-1',
      version: 3,
      optionTypeCounts: { attack: 2, spell: 1, dash: 1, end_turn: 1 },
      totalOptions: 5,
    });
    // No bodies, no labels, no user text — counts and ids only.
    expect(JSON.stringify(served[0].data)).not.toContain('Longsword');
    expect(JSON.stringify(served[0].data)).not.toContain('Fire Bolt');
  });

  it('logs one COMBAT_INTENT_ACCEPTED line with phase/source/origin and d20 presence', async () => {
    const res = await post('/v1/combat/enc-1/intent', {
      intent: { type: 'attack', actorId: 'actor-1', targetId: 'goblin-1', d20: 17, expectedVersion: 3 },
      source: 'player',
      origin: 'dice_roll',
    });
    expect(res.status).toBe(200);

    const accepted = infos.filter((line) => line.msg === 'COMBAT_INTENT_ACCEPTED');
    expect(accepted).toHaveLength(1);
    expect(accepted[0].data).toEqual({
      requestId: expect.any(String),
      encounterId: 'enc-1',
      intentType: 'attack',
      phase: 'commit',
      source: 'player',
      origin: 'dice_roll',
      d20Supplied: true,
    });
  });

  it('marks d20Supplied false when the intent carries no die', async () => {
    const res = await post('/v1/combat/enc-1/intent', {
      intent: { type: 'attack', actorId: 'actor-1', targetId: 'goblin-1', expectedVersion: 3 },
      source: 'dm',
    });
    expect(res.status).toBe(200);

    const accepted = infos.filter((line) => line.msg === 'COMBAT_INTENT_ACCEPTED');
    expect(accepted).toHaveLength(1);
    expect(accepted[0].data).toMatchObject({
      intentType: 'attack',
      phase: 'commit',
      source: 'dm',
      origin: null,
      d20Supplied: false,
    });
  });

  it('logs COMBAT_INTENT_ACCEPTED with phase propose on the propose phase', async () => {
    const res = await post('/v1/combat/enc-1/intent', {
      phase: 'propose',
      source: 'player',
      intent: { type: 'attack', actorId: 'actor-1', targetId: 'goblin-1', expectedVersion: 3 },
    });
    expect(res.status).toBe(200);

    const accepted = infos.filter((line) => line.msg === 'COMBAT_INTENT_ACCEPTED');
    expect(accepted).toHaveLength(1);
    expect(accepted[0].data).toMatchObject({ phase: 'propose', d20Supplied: false });
  });

  it('does not log COMBAT_INTENT_ACCEPTED when the service rejects the intent', async () => {
    const { AppError } = await import('../../../../lib/errors.js');
    const previous = executeCombatIntentImpl;
    executeCombatIntentImpl = async () => {
      throw new AppError(409, 'Combat participant not found');
    };
    try {
      const res = await post('/v1/combat/enc-1/intent', {
        intent: { type: 'attack', actorId: 'actor-1', targetId: 'goblin-1', expectedVersion: 3 },
        source: 'player',
      });
      expect(res.status).toBe(409);

      const accepted = infos.filter((line) => line.msg === 'COMBAT_INTENT_ACCEPTED');
      expect(accepted).toHaveLength(0);
    } finally {
      executeCombatIntentImpl = previous;
    }
  });
});
