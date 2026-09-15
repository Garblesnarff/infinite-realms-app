import { beforeEach, describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';

process.env.DATABASE_URL ??= 'postgres://test.invalid/unused';
process.env.PORT ??= '8892';
process.env.CORS_ORIGIN ??= 'http://localhost:8891';
process.env.WORKOS_API_KEY ??= 'test-workos-key';
process.env.WORKOS_CLIENT_ID ??= 'test-workos-client';
process.env.NODE_ENV ??= 'test';

const { createCombatEntryRoutes } = await import('../entry.js');

const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const CHARACTER_ID = '99999999-8888-4777-8666-555555555555';

const seatCalls: unknown[] = [];
let authenticated = true;
let encounterActive = false;
let seatError: { code: string } | null = null;
const authenticateRequest = async () =>
  authenticated
    ? {
        user: { userId: 'user-owner', email: 'owner@example.test', plan: 'free' },
        error: null,
      }
    : { user: null, error: 'Unauthorized' };

const combatState = {
  encounter: { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' },
  participants: [
    {
      id: 'participant-player',
      name: 'Rook',
      initiative: 18,
      initiativeModifier: 2,
      characterId: CHARACTER_ID,
      turnOrder: 0,
    },
    {
      id: 'participant-geometrist',
      name: 'Geometrist',
      initiative: 15,
      initiativeModifier: 1,
      turnOrder: 1,
    },
  ],
  participantSizes: {},
  turnOrder: [],
  currentParticipant: null,
};

const seatCombatEntry = async (params: unknown) => {
  seatCalls.push(params);
  if (seatError) throw seatError;
  if (encounterActive) return null;
  encounterActive = true;
  return {
    entered: true,
    encounterId: combatState.encounter.id,
    trigger: 'tactical_action' as const,
    detail: 'combat_action attack',
    sceneSpecSynthesized: false,
    sceneSpec: { sessionId: SESSION_ID, environment: 'cave', size: 'medium' as const },
    participantCount: combatState.participants.length,
    seatingTranscript: '⚙️ Engine: Initiative — You: 16 + 2 = 18 (you rolled).',
    combatState,
  } as never;
};

const sanitizeSceneSpec = (_raw: unknown, sessionId: string) => ({
  ok: true as const,
  sceneSpec: { sessionId, environment: 'cave' as const, size: 'medium' as const },
  overrides: [],
});

const app = new Elysia().use(
  createCombatEntryRoutes({
    authenticateRequest: authenticateRequest as never,
    seatCombatEntry: seatCombatEntry as never,
    sanitizeSceneSpec: sanitizeSceneSpec as never,
    buildInitiativeOrder: (() => []) as never,
  }),
);

const request = (body: Record<string, unknown>) =>
  app.handle(
    new Request(`http://localhost/sessions/${SESSION_ID}/enter`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

const validBody = () => ({
  combatants: [{ name: 'Geometrist', monsterId: 'srd:bandit', count: 1 }],
  sceneSpec: { environment: 'cave' },
  player: { characterId: CHARACTER_ID, name: 'Rook', initiativeModifier: 2 },
});

describe('POST /v1/combat/sessions/:sessionId/enter', () => {
  beforeEach(() => {
    authenticated = true;
    encounterActive = false;
    seatError = null;
    seatCalls.splice(0);
  });

  it('rebuilds the server-side participant inputs and forwards the player roll', async () => {
    const response = await request({ ...validBody(), playerInitiativeRoll: 16 });
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(seatCalls).toHaveLength(1);
    expect(seatCalls[0]).toMatchObject({
      sessionId: SESSION_ID,
      userId: 'user-owner',
      player: { characterId: CHARACTER_ID, name: 'Rook' },
      combatants: [{ name: 'Geometrist', monsterId: 'srd:bandit', count: 1 }],
      playerInitiativeRoll: 16,
    });
    expect(body).toMatchObject({
      seatingTranscript: expect.stringContaining('You: 16 + 2 = 18'),
    });
  });

  it('forwards the server-detected player declaration to first-action derivation', async () => {
    const declaredAttack = {
      verb: 'punch',
      actorName: 'Professor Emil Darkwater',
      attackSource: 'unarmed',
    };
    await request({ ...validBody(), declaredAttack });

    expect(seatCalls[0]).toMatchObject({ declaredAttack });
  });

  it('allows the server to auto-roll when the player roll is omitted', async () => {
    await request(validBody());
    expect(seatCalls[0]).toMatchObject({ playerInitiativeRoll: undefined });
  });

  it('returns 401 without authenticating or attempting to seat', async () => {
    authenticated = false;

    const response = await request(validBody());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(seatCalls).toHaveLength(0);
  });

  it('returns 409 when a second enter finds the encounter already active', async () => {
    const first = await request(validBody());
    const second = await request(validBody());

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: 'Combat entry is no longer available' });
    expect(seatCalls).toHaveLength(2);
  });

  it('maps a concurrent unique-index violation to the same 409 as the pre-check', async () => {
    seatError = { code: '23505' };

    const response = await request(validBody());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'Combat entry is no longer available' });
  });

  it.each([12.5, 0, 21])('rejects playerInitiativeRoll=%s before seating', async (roll) => {
    const response = await request({ ...validBody(), playerInitiativeRoll: roll });
    expect(response.status).toBe(422);
    expect(seatCalls).toHaveLength(0);
  });
});
