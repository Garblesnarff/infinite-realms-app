import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const ENCOUNTER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
let currentParticipantId = 'npc-holder';
const advanceNpcTurns = mock((_encounterId: string, _userId: string) =>
  Promise.resolve({
    results: [],
    currentParticipant: { id: 'player-1', name: 'The Seeker', participantType: 'player' },
    combatEnded: false,
    iterationCount: 1,
    iterationCap: 4,
    capReached: false,
    transcriptLines: [],
  }),
);

mock.module('../../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) =>
    request.headers.get('authorization') === 'Bearer valid-token'
      ? { user: { userId: 'user-owner' }, error: null }
      : { user: null, error: 'Unauthorized' },
}));
mock.module(import.meta.resolve('../helpers.js'), () => ({
  verifySessionOwnership: async (sessionId: string, userId: string) =>
    sessionId === SESSION_ID && userId === 'user-owner'
      ? { success: true, session: { id: sessionId } }
      : { success: false, error: { status: 404, message: 'Session not found' } },
}));
mock.module('../../../../services/combat/combat-encounter-service.js', () => ({
  CombatEncounterService: {
    getActiveEncounter: async () => ({ id: ENCOUNTER_ID, sessionId: SESSION_ID }),
    getCombatState: async () => ({ currentParticipant: { id: currentParticipantId } }),
  },
}));
mock.module('../../../../services/combat/npc-turn-runner.js', () => ({
  advanceNpcTurns: (encounterId: string, userId: string) => advanceNpcTurns(encounterId, userId),
}));

const { advanceNpcTurnRoutes } = await import('../advance-npc-turns.js');
const app = new Elysia({ prefix: '/v1/combat' }).use(advanceNpcTurnRoutes);

const request = (
  expectedCurrentParticipantId = 'npc-holder',
  authorization = 'Bearer valid-token',
) =>
  new Request(`http://localhost/v1/combat/sessions/${SESSION_ID}/advance-npc-turns`, {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ expectedCurrentParticipantId }),
  });

describe('POST /v1/combat/sessions/:sessionId/advance-npc-turns', () => {
  beforeEach(() => {
    currentParticipantId = 'npc-holder';
    advanceNpcTurns.mockClear();
  });

  it('authenticates the session and advances the active encounter', async () => {
    const response = await app.handle(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      currentParticipant: { id: 'player-1' },
      iterationCount: 1,
    });
    expect(advanceNpcTurns).toHaveBeenCalledWith(ENCOUNTER_ID, 'user-owner');
  });

  it('returns a turn-holder conflict without running a stale loop', async () => {
    currentParticipantId = 'npc-now-current';

    const response = await app.handle(request('npc-was-current'));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      reason: 'turn_holder_mismatch',
      currentParticipantId: 'npc-now-current',
    });
    expect(advanceNpcTurns).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated requests before touching combat state', async () => {
    const response = await app.handle(request('npc-holder', 'Bearer invalid-token'));

    expect(response.status).toBe(401);
    expect(advanceNpcTurns).not.toHaveBeenCalled();
  });
});
