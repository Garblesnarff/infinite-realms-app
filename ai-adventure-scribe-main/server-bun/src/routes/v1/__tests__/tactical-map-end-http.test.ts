import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

Object.assign(process.env, {
  DATABASE_URL:
    process.env.DATABASE_URL ?? 'postgresql://challenge:challenge@127.0.0.1:5432/challenge',
  PORT: process.env.PORT ?? '3000',
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
  WORKOS_API_KEY: process.env.WORKOS_API_KEY ?? 'test-workos-key',
  WORKOS_CLIENT_ID: process.env.WORKOS_CLIENT_ID ?? 'test-workos-client',
});

/**
 * #2524 / #2563: the client now POSTs `{ combat_exits }` to the tactical-map end
 * route, and a refusal comes back 409 so the client can keep the fight open. These
 * send the exact body the client sends (AGENTS.md §4) through the real route; the
 * encounter store and the ending itself are faked at their module boundary.
 */
const concludeCalls: unknown[][] = [];
let concludeResult = true;
let activeEncounter: { id: string } | null = { id: 'enc-d5' };
const destroyedSessions: string[] = [];

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) =>
    request.headers.get('authorization') === 'Bearer <redacted>'
      ? { user: { userId: 'user-1', email: 'user@example.test', plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' },
}));
mock.module('../../../services/combat/combat-encounter-service.js', () => ({
  CombatEncounterService: {
    getActiveEncounter: async () => activeEncounter,
    getCombatState: async () => ({ encounter: { status: 'active' }, participants: [] }),
  },
}));
mock.module('../../../services/combat/combat-ending.js', () => ({
  concludeEncounter: async (...args: unknown[]) => {
    concludeCalls.push(args);
    return concludeResult;
  },
}));
mock.module('../../../services/combat/tactical-combat-lifecycle.js', () => ({
  destroyTacticalCombatMap: async (sessionId: string) => {
    destroyedSessions.push(sessionId);
  },
  createTacticalCombatMap: async () => ({}),
  resetTacticalMovementForTurn: async () => {},
  grantTacticalDash: async () => {},
}));

const { requireAuth } = await import('../../../middleware/auth.js');
const { createTacticalMapRoutes } = await import('../tactical-maps.js');

const app = new Elysia().use(
  createTacticalMapRoutes({
    auth: requireAuth,
    sessionOwnership: (async () => ({
      success: true as const,
      session: { id: 'session-d5' },
    })) as never,
    activeMapLoader: async () => null,
    dmTacticalActions: (async () => ({ results: [], appliedDeltas: [], degraded: [] })) as never,
  }),
);

const postEnd = (body: unknown) =>
  app.handle(
    new Request('http://localhost/v1/sessions/session-d5/tactical-map/end', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer <redacted>',
      },
      body: JSON.stringify(body),
    }),
  );

describe('POST /v1/sessions/:id/tactical-map/end with the client combat_exits body', () => {
  beforeEach(() => {
    concludeCalls.length = 0;
    destroyedSessions.length = 0;
    concludeResult = true;
    activeEncounter = { id: 'enc-d5' };
  });

  it('forwards the declared exits to the ending and answers 200', async () => {
    const response = await postEnd({
      combat_exits: [{ participant_id: 'light-eater-swarm-1', exit: 'fled' }],
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, encounterEnded: true });
    expect(concludeCalls).toEqual([
      [
        'enc-d5',
        'session-d5',
        'user-1',
        'dm_ended_scene',
        { exits: [{ participant_id: 'light-eater-swarm-1', exit: 'fled' }] },
      ],
    ]);
  });

  it('answers 409 when the ending refuses: a live hostile with no exit', async () => {
    concludeResult = false;
    const response = await postEnd({ combat_exits: [] });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'combat_end_refused_live_hostiles',
      encounterEnded: false,
    });
  });

  it('with no active encounter only the map is torn down', async () => {
    activeEncounter = null;
    const response = await postEnd({ combat_exits: [] });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, encounterEnded: false });
    expect(destroyedSessions).toEqual(['session-d5']);
    expect(concludeCalls).toEqual([]);
  });
});
