import { beforeEach, describe, expect, it } from 'bun:test';

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';
process.env.PORT ??= '3000';
process.env.CORS_ORIGIN ??= 'http://localhost:3000';
process.env.WORKOS_API_KEY ??= 'test-workos-key';
process.env.WORKOS_CLIENT_ID ??= 'test-workos-client';

/**
 * The explicit entry handoff is the only way to seat combat. A retry after the first handoff must
 * report the race as a conflict without creating another encounter, rerolling initiative, or
 * rebuilding the tactical map.
 */
const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const ENCOUNTER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const seatCalls: unknown[] = [];
const mapsCreated: unknown[] = [];
let encounterActive = false;

const currentState = {
  encounter: { id: ENCOUNTER_ID, sessionId: SESSION_ID, status: 'active', currentRound: 3 },
  participants: [
    { id: 'seeker', name: 'The Seeker', participantType: 'player', initiative: 18 },
    { id: 'roach', name: 'Shadow Roach', participantType: 'monster', initiative: 11 },
  ],
  participantSizes: {},
  turnOrder: [
    {
      participant: { id: 'seeker', name: 'The Seeker', participantType: 'player', initiative: 18 },
      isCurrent: true,
      hasGone: false,
    },
    {
      participant: {
        id: 'roach',
        name: 'Shadow Roach',
        participantType: 'monster',
        initiative: 11,
      },
      isCurrent: false,
      hasGone: false,
    },
  ],
  currentParticipant: null,
};

const SCENE_SPEC = {
  sessionId: SESSION_ID,
  environment: 'cave',
  size: 'medium',
  enemyPlacement: 'ambush',
  sceneDescription: 'A damp gallery.',
  seed: 7,
};

const authenticateRequest = async () => ({
  user: { userId: 'user_owner', email: 'owner@example.test', plan: 'free' },
  error: null,
});

const seatCombatEntry = async (params: unknown) => {
  seatCalls.push(params);
  if (encounterActive) return null;

  encounterActive = true;
  mapsCreated.push(params);
  return {
    entered: true,
    encounterId: ENCOUNTER_ID,
    trigger: 'tactical_action' as const,
    detail: 'combat_action attack',
    sceneSpecSynthesized: false,
    sceneSpec: SCENE_SPEC,
    participantCount: currentState.participants.length,
    seatingTranscript: '⚙️ Engine: Initiative — You: 16 + 2 = 18 (you rolled).',
    combatState: currentState,
  } as never;
};

const buildInitiativeOrder = (state: typeof currentState) =>
  state.turnOrder.map((entry) => ({
    id: entry.participant.id,
    name: entry.participant.name,
    participantType: entry.participant.participantType,
    initiative: entry.participant.initiative,
    isCurrent: entry.isCurrent,
    hasGone: entry.hasGone,
  }));

const { createRequestPipelineApp } = await import('../../../../http-pipeline.js');
const { createCombatEntryRoutes } = await import('../entry.js');
const { createInitiativeRoutes } = await import('../initiative.js');

const app = createRequestPipelineApp()
  .use(
    createCombatEntryRoutes({
      authenticateRequest: authenticateRequest as never,
      seatCombatEntry: seatCombatEntry as never,
      buildInitiativeOrder: buildInitiativeOrder as never,
    }),
  )
  // Keep the route-removal regression on the same mounted surface as production.
  .use(createInitiativeRoutes({ authenticateRequest: authenticateRequest as never }));

const enter = () =>
  app.handle(
    new Request(`http://localhost/sessions/${SESSION_ID}/enter`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        combatants: [{ name: 'Shadow Roach', monsterId: 'srd:giant-rat', count: 1 }],
        sceneSpec: SCENE_SPEC,
        player: {
          characterId: 'character-owner',
          name: 'The Seeker',
          initiativeModifier: 2,
          hpCurrent: 24,
          hpMax: 24,
        },
        playerInitiativeRoll: 16,
      }),
    }),
  );

beforeEach(() => {
  seatCalls.length = 0;
  mapsCreated.length = 0;
  encounterActive = false;
});

describe('starting combat through POST /v1/combat/sessions/:sessionId/enter', () => {
  it('creates the encounter normally when nothing is running', async () => {
    const response = await enter();
    const body = (await response.json()) as { initiativeOrder: Array<{ name: string }> };

    expect(response.status).toBe(201);
    expect(seatCalls).toHaveLength(1);
    expect(mapsCreated).toHaveLength(1);
    expect(body.initiativeOrder.map((entry) => entry.name)).toEqual(['The Seeker', 'Shadow Roach']);
  });

  it('returns a conflict for a second entry instead of resetting the encounter', async () => {
    await enter();
    const response = await enter();

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'Combat entry is no longer available' });
    expect(seatCalls).toHaveLength(2);
    expect(mapsCreated).toHaveLength(1);
  });

  it('keeps repeated entry attempts stable after the first successful handoff', async () => {
    const first = await enter();
    const firstBody = (await first.json()) as { encounter: { id: string } };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await enter();
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: 'Combat entry is no longer available' });
    }

    expect(firstBody.encounter.id).toBe(ENCOUNTER_ID);
    expect(seatCalls).toHaveLength(4);
    expect(mapsCreated).toHaveLength(1);
  });

  it('still returns 404 for the removed client-controlled initiative reorder route', async () => {
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
