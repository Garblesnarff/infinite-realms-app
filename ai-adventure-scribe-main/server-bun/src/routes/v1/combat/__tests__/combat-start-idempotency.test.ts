import { beforeEach, describe, expect, it, mock } from 'bun:test';

/**
 * Run 8 restarted combat four times across thirty turns. Nobody asked for a reset: the DM
 * emitted a fresh `combat_transition: "start"` mid-fight — the same thing a client retry
 * does — and this endpoint obliged, inserting a second active encounter, rerolling
 * initiative, and rebuilding the board on top of the fight already in progress.
 *
 * The rule pinned here is that a start while combat is active is a no-op that reports the
 * encounter in progress. An encounter ends by an end transition or by every hostile going
 * down, and by nothing else.
 */
const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const ENCOUNTER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const startCalls: unknown[] = [];
const mapsCreated: unknown[] = [];
const infoLogs: Array<Record<string, unknown>> = [];
let activeEncounter: { id: string } | undefined;

const participant = (id: string, name: string, initiative: number) => ({
  id,
  name,
  participantType: 'monster',
  initiative,
});

const currentState = {
  encounter: { id: ENCOUNTER_ID, sessionId: SESSION_ID, status: 'active', currentRound: 3 },
  participants: [],
  turnOrder: [
    { participant: participant('seeker', 'The Seeker', 18), isCurrent: true, hasGone: false },
    { participant: participant('roach', 'Shadow Roach', 11), isCurrent: false, hasGone: true },
  ],
  currentParticipant: null,
};

mock.module('../../../../../../db/client', () => ({ db: {} }));
mock.module('../../../../lib/env.js', () => ({
  env: { WORKOS_CLIENT_ID: 'test-client', NODE_ENV: 'test' },
}));
mock.module('../../../../lib/logger.js', () => ({
  logger: {
    debug: () => {},
    info: (entry: Record<string, unknown>) => infoLogs.push(entry),
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
  verifySessionOwnership: async () => ({ success: true, session: { id: SESSION_ID } }),
  verifyEncounterOwnership: async () => ({ success: true }),
}));
mock.module('../../../../services/combat/combat-encounter-service.js', () => ({
  CombatEncounterService: {
    getActiveEncounter: async () => activeEncounter,
    getCombatState: async () => currentState,
    startCombat: async (...args: unknown[]) => {
      startCalls.push(args);
      return { ...currentState, participants: [], participantSizes: {} };
    },
  },
}));
mock.module('../../../../services/combat/tactical-combat-lifecycle.js', () => ({
  createTacticalCombatMap: async (...args: unknown[]) => {
    mapsCreated.push(args);
  },
  destroyTacticalCombatMap: async () => {},
  resetTacticalMovementForTurn: async () => {},
}));
mock.module('../../../../services/combat/combat-sync-service.js', () => ({
  publishCombatState: async () => {},
}));
mock.module('../../../../services/combat/combat-events.js', () => ({ trackCombatEvent: () => {} }));

const { createRequestPipelineApp } = await import('../../../../http-pipeline.js');
const { initiativeRoutes } = await import('../initiative.js');

const app = createRequestPipelineApp().use(initiativeRoutes);

const SCENE_SPEC = {
  id: 'scene-1',
  sessionId: SESSION_ID,
  environment: 'cave',
  size: 'medium',
  sceneDescription: 'A damp gallery.',
  seed: 7,
  enemyPlacement: 'ambush',
};

const start = () =>
  app.handle(
    new Request(`http://localhost/sessions/${SESSION_ID}/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer valid-token' },
      body: JSON.stringify({
        participants: [{ name: 'Shadow Roach', monsterId: 'srd:giant-rat' }],
        sceneSpec: SCENE_SPEC,
      }),
    }),
  );

beforeEach(() => {
  startCalls.length = 0;
  mapsCreated.length = 0;
  infoLogs.length = 0;
  activeEncounter = undefined;
});

describe('starting combat while combat is already active', () => {
  it('creates the encounter normally when nothing is running', async () => {
    const response = await start();
    expect(response.status).toBe(201);
    expect(startCalls).toHaveLength(1);
    expect(mapsCreated).toHaveLength(1);
  });

  it('is a no-op that returns the encounter in progress, never a reset', async () => {
    activeEncounter = { id: ENCOUNTER_ID };
    const response = await start();
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.alreadyActive).toBe(true);
    expect((body.encounter as { id: string }).id).toBe(ENCOUNTER_ID);
    // Round 3 survives: no new encounter, no rerolled initiative, no rebuilt board.
    expect((body.encounter as { currentRound: number }).currentRound).toBe(3);
    expect(startCalls).toHaveLength(0);
    expect(mapsCreated).toHaveLength(0);
  });

  it('still reports the whole initiative order so the client is not left blind', async () => {
    activeEncounter = { id: ENCOUNTER_ID };
    const body = (await (await start()).json()) as {
      initiativeOrder: Array<{ name: string; isCurrent: boolean }>;
    };
    expect(body.initiativeOrder.map((entry) => entry.name)).toEqual(['The Seeker', 'Shadow Roach']);
    expect(body.initiativeOrder[0].isCurrent).toBe(true);
  });

  it('logs the ignored start rather than swallowing it', async () => {
    activeEncounter = { id: ENCOUNTER_ID };
    await start();
    expect(infoLogs).toContainEqual(
      expect.objectContaining({
        msg: 'Ignored combat start for a session already in combat',
        encounterId: ENCOUNTER_ID,
      }),
    );
  });

  it('repeated starts are stable: every one returns the same encounter', async () => {
    activeEncounter = { id: ENCOUNTER_ID };
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const body = (await (await start()).json()) as { encounter: { id: string } };
      expect(body.encounter.id).toBe(ENCOUNTER_ID);
    }
    expect(startCalls).toHaveLength(0);
  });

  it('returns 404 for the removed client-controlled initiative reorder route', async () => {
    const response = await app.handle(
      new Request(`http://localhost/${ENCOUNTER_ID}/reorder`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', authorization: 'Bearer valid-token' },
        body: JSON.stringify({ participantId: 'seeker', newInitiative: 1 }),
      }),
    );

    expect(response.status).toBe(404);
  });
});
