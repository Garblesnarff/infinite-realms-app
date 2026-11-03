import { beforeEach, describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';

import {
  HEADLESS_ENTRY_CHARACTER_ID,
  headlessEntryEnterBody,
} from '../../../../../../shared/test-fixtures/combat-entry-headless';
import {
  holdOrDropPending,
  readDeclinedCombatEntryActorKeys,
  recordCombatEntryDecline,
  resetPendingCombatEntries,
  setPendingEntryClockForTests,
} from '../../../../services/combat/pending-combat-entry.js';

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
let sessionOwned = true;
let seatError: { code: string } | null = null;
let seatRefusal: { reason: 'declared_weapon_not_equipped'; notice: string } | null = null;
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
    ...(seatRefusal
      ? {
          notice: seatRefusal.notice,
          firstActionRefusal: {
            reason: seatRefusal.reason,
            notice: seatRefusal.notice,
            requestedWeapon: 'quarterstaff',
            actor: 'participant-player',
            target: 'participant-geometrist',
          },
        }
      : {}),
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
    combatEntryGateDeps: {
      verifySessionOwnership: async (): Promise<{ success: boolean }> => ({
        success: sessionOwned,
      }),
      getActiveEncounter: async (): Promise<{ id: string } | null> =>
        encounterActive ? { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' } : null,
    } as never,
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
    sessionOwned = true;
    seatError = null;
    seatRefusal = null;
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

  it('a successful seat from a stored pending lifts that pending decline (#1328)', async () => {
    await holdOrDropPending(SESSION_ID, 'user-owner', {
      trigger: 'combat_transition',
      detail: 'combat_transition="start"',
      combatants: [{ name: 'Geometrist', count: 1 }],
      sceneSpec: { sessionId: SESSION_ID, environment: 'cave', size: 'medium' },
      sceneSpecSynthesized: true,
    });
    await recordCombatEntryDecline(SESSION_ID, 'geometrist');
    expect(await readDeclinedCombatEntryActorKeys(SESSION_ID)).toEqual(['geometrist']);

    // The confirm dialog's accept path seats from the stored pending.
    const response = await request({ ...validBody(), fromPending: true });
    expect(response.status).toBe(201);
    expect(await readDeclinedCombatEntryActorKeys(SESSION_ID)).toEqual([]);
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

  it('returns first_action_refusal and its notice when the declared weapon is not on the sheet (#2551)', async () => {
    seatRefusal = {
      reason: 'declared_weapon_not_equipped',
      notice:
        'You declared an attack with the quarterstaff, but it is not on your character sheet, so your opening attack was not queued.',
    };
    const declaredAttack = {
      verb: 'attack',
      actorName: 'Geometrist',
      attackSource: 'weapon',
      weaponName: 'quarterstaff',
    };
    const response = await request({ ...validBody(), declaredAttack });
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(body.first_action).toBeUndefined();
    expect(body.first_action_refusal).toEqual({ reason: 'declared_weapon_not_equipped' });
    expect(body.notice).toBe(seatRefusal.notice);
  });

  it('seats the weapon declaration the declared-attack route hands out, weaponStated included (#877)', async () => {
    const response = await request({
      combatants: [{ name: 'Silk Woman', count: 1 }],
      sceneSpec: { environment: 'dungeon_room' },
      player: { characterId: CHARACTER_ID, name: 'Rook', initiativeModifier: 2 },
      // Exactly the object detectDeclaredAttack puts on the pending for "I shoot the silk
      // woman with my longbow" — the client forwards it verbatim, weaponStated included.
      declaredAttack: {
        verb: 'shoot',
        actorName: 'Silk Woman',
        attackSource: 'weapon',
        weaponStated: true,
        weaponName: 'longbow',
      },
    });

    expect(response.status).toBe(201);
    expect(seatCalls).toHaveLength(1);
    expect(seatCalls[0]).toMatchObject({
      declaredAttack: {
        verb: 'shoot',
        actorName: 'Silk Woman',
        attackSource: 'weapon',
        weaponStated: true,
        weaponName: 'longbow',
      },
    });
  });

  it('seats the exact /enter body the headless client sends for a declared attack (#913)', async () => {
    // The shared fixture (AGENTS.md §4): the client test asserts the headless client
    // sends exactly this body for the pending entry a declared attack produced; here
    // the same body goes through the real route schema and handler.
    const response = await request(headlessEntryEnterBody as Record<string, unknown>);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(seatCalls).toHaveLength(1);
    expect(seatCalls[0]).toMatchObject({
      sessionId: SESSION_ID,
      player: {
        characterId: HEADLESS_ENTRY_CHARACTER_ID,
        name: 'Rook',
        initiativeModifier: 2,
        hpCurrent: 12,
        hpMax: 12,
      },
      combatants: [{ name: 'Head Chef Balthazar', count: 1 }],
      declaredAttack: {
        verb: 'attack',
        actorName: 'Head Chef Balthazar',
        attackSource: 'weapon',
        weaponStated: true,
        weaponName: 'longsword',
      },
      playerInitiativeRoll: 14,
    });
    expect(body.seatingTranscript).toEqual(expect.stringContaining('Initiative'));
  });

  it('allows the server to auto-roll when the player roll is omitted', async () => {
    await request(validBody());
    expect(seatCalls[0]).toMatchObject({ playerInitiativeRoll: undefined });
  });

  it('returns 404 for a session the caller does not own before reading a pending entry', async () => {
    sessionOwned = false;

    const response = await request({ ...validBody(), fromPending: true });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Session not found' });
    expect(seatCalls).toHaveLength(0);
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

describe('DELETE /v1/combat/sessions/:sessionId/pending (#1328)', () => {
  const DELETE_SESSION = '44444444-5555-4666-8777-888888888888';

  beforeEach(async () => {
    authenticated = true;
    sessionOwned = true;
    // The DELETE handler skips recording when a fight is live, so a
    // leftover seated encounter from the POST block must not leak in.
    encounterActive = false;
    await resetPendingCombatEntries();
  });

  it('declining records the pending entry actor key for the next turn gate', async () => {
    await holdOrDropPending(DELETE_SESSION, 'user-owner', {
      trigger: 'combat_transition',
      detail: 'combat_transition="start"',
      combatants: [{ name: 'Gilded Husk', count: 1 }],
      sceneSpec: { sessionId: DELETE_SESSION, environment: 'cave', size: 'medium' },
      sceneSpecSynthesized: true,
    });
    const response = await app.handle(
      new Request(`http://localhost/sessions/${DELETE_SESSION}/pending`, {
        method: 'DELETE',
      }),
    );
    const body = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(body).toEqual({ cleared: true });
    expect(await readDeclinedCombatEntryActorKeys(DELETE_SESSION)).toEqual(['gilded husk']);
  });

  it('DELETE with nothing pending records nothing', async () => {
    const response = await app.handle(
      new Request(`http://localhost/sessions/${DELETE_SESSION}/pending`, {
        method: 'DELETE',
      }),
    );
    const body = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(body).toEqual({ cleared: true });
    expect(await readDeclinedCombatEntryActorKeys(DELETE_SESSION)).toEqual([]);
  });

  it('DELETE of an expired pending records nothing (expiry is not a decline)', async () => {
    await holdOrDropPending(DELETE_SESSION, 'user-owner', {
      trigger: 'combat_transition',
      detail: 'combat_transition="start"',
      combatants: [{ name: 'Gilded Husk', count: 1 }],
      sceneSpec: { sessionId: DELETE_SESSION, environment: 'cave', size: 'medium' },
      sceneSpecSynthesized: true,
    });
    try {
      setPendingEntryClockForTests(() => Date.now() + 91_000);
      const response = await app.handle(
        new Request(`http://localhost/sessions/${DELETE_SESSION}/pending`, {
          method: 'DELETE',
        }),
      );
      expect(response.status).toBe(200);
    } finally {
      setPendingEntryClockForTests(() => Date.now());
    }
    expect(await readDeclinedCombatEntryActorKeys(DELETE_SESSION)).toEqual([]);
  });

  it('DELETE while a fight is live records nothing (409-cleanup path)', async () => {
    await holdOrDropPending(DELETE_SESSION, 'user-owner', {
      trigger: 'combat_transition',
      detail: 'combat_transition="start"',
      combatants: [{ name: 'Gilded Husk', count: 1 }],
      sceneSpec: { sessionId: DELETE_SESSION, environment: 'cave', size: 'medium' },
      sceneSpecSynthesized: true,
    });
    encounterActive = true;
    const response = await app.handle(
      new Request(`http://localhost/sessions/${DELETE_SESSION}/pending`, {
        method: 'DELETE',
      }),
    );
    expect(response.status).toBe(200);
    expect(await readDeclinedCombatEntryActorKeys(DELETE_SESSION)).toEqual([]);
  });
});
