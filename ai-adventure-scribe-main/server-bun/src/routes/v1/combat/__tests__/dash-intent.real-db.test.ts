/** #613: the More-menu Dash body through the real intent route and tactical map. */
import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Elysia } from 'elysia';

import {
  campaigns,
  characterStats,
  characters,
  combatEncounters,
  combatIntentIdempotency,
  combatParticipantStatus,
  combatParticipants,
  gameSessions,
  tacticalMaps,
} from '../../../../../../db/schema/index';
import {
  DASH_ACTOR_ID,
  dashIntentBody,
} from '../../../../../../shared/test-fixtures/combat-dash-intent';
import {
  COMBAT_INTENT_REQUEST_ID_HEADER,
  combatIntentMoveBody,
} from '../../../../../../shared/test-fixtures/combat-intent-move';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from '../../../../services/__tests__/fixtures/real-db.js';
import {
  PENDING_TAKEOVER_AFTER_MS,
  releaseIntentClaim,
  storeIntentResponse,
} from '../../../../services/combat/combat-intent-idempotency.js';

const userId = `dash-route-${process.pid}`;

mock.module('../../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) =>
    request.headers.get('authorization') === `Bearer ${userId}`
      ? { user: { userId, email: 'dash@example.test', plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' },
}));

const { createRequestPipelineApp } = await importWithRealDb(
  () => import('../../../../http-pipeline.js'),
);
const { intentRoutes } = await importWithRealDb(() => import('../intents.js'));

const app = hasRealDb
  ? createRequestPipelineApp().use(new Elysia({ prefix: '/v1/combat' }).use(intentRoutes))
  : null;

if (!hasRealDb) console.warn('[dash-route] SKIPPED: set TEST_DATABASE_URL to run this suite.');

describeWithDb('Dash More-menu body resolves through the real route (#613)', () => {
  const db = hasRealDb ? realDb() : (null as never);
  let campaignId: string;
  let characterId: string;
  let sessionId: string;
  let encounterId: string;
  let heroId: string;
  let foeId: string;

  beforeAll(async () => {
    if (!hasRealDb) return;
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('613-route-campaign') })
      .returning({ id: campaigns.id });
    [{ id: characterId }] = await db
      .insert(characters)
      .values({
        userId,
        ownerId: userId,
        campaignId,
        name: testId('613-route-runner'),
        class: 'Fighter',
        level: 1,
        classLevels: [{ className: 'Fighter', level: 1 }],
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId,
      strength: 16,
      constitution: 14,
      maxHitPoints: 12,
      currentHitPoints: 12,
      speed: 30,
      armorClass: 15,
    });
    [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });
    [{ id: encounterId }] = await db
      .insert(combatEncounters)
      .values({ sessionId, status: 'active', currentRound: 1, currentTurnOrder: 0, version: 1 })
      .returning({ id: combatEncounters.id });
    const participants = await db
      .insert(combatParticipants)
      .values([
        {
          id: DASH_ACTOR_ID,
          encounterId,
          characterId,
          name: 'The Runner',
          participantType: 'player',
          turnOrder: 0,
          initiative: 20,
          armorClass: 15,
          maxHp: 12,
          speed: 30,
        },
        {
          encounterId,
          name: 'Training Golem',
          participantType: 'monster',
          turnOrder: 1,
          initiative: 10,
          armorClass: 1,
          maxHp: 200,
          speed: 30,
        },
      ])
      .returning({ id: combatParticipants.id, turnOrder: combatParticipants.turnOrder });
    heroId = participants.find((row) => row.turnOrder === 0)!.id;
    foeId = participants.find((row) => row.turnOrder === 1)!.id;
    await db.insert(combatParticipantStatus).values([
      { participantId: heroId, currentHp: 12, maxHp: 12, isConscious: true },
      { participantId: foeId, currentHp: 200, maxHp: 200, isConscious: true },
    ]);
    await db.insert(tacticalMaps).values({
      sessionId,
      state: {
        id: testId('613-map'),
        sessionId,
        width: 3,
        height: 3,
        cells: Array.from({ length: 3 }, () =>
          Array.from({ length: 3 }, () => ({
            terrain: 'floor',
            blocksMovement: false,
            blocksSight: false,
            cover: 0,
            elevation: 0,
          })),
        ),
        entities: [
          {
            id: heroId,
            name: 'The Runner',
            type: 'pc',
            x: 0,
            y: 0,
            size: 'medium',
            speedFeet: 30,
            movementRemaining: 30,
          },
          {
            id: foeId,
            name: 'Training Golem',
            type: 'monster',
            x: 2,
            y: 2,
            size: 'medium',
            speedFeet: 30,
            movementRemaining: 30,
          },
        ],
        round: 1,
        sceneDescription: '613 route fixture',
      },
      active: true,
    });
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    await db.delete(tacticalMaps).where(eq(tacticalMaps.sessionId, sessionId));
    await db.delete(combatParticipants).where(eq(combatParticipants.encounterId, encounterId));
    await db.delete(combatEncounters).where(eq(combatEncounters.id, encounterId));
    await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await db.delete(characters).where(eq(characters.id, characterId));
    await db.delete(campaigns).where(eq(campaigns.id, campaignId));
    await closeRealDb();
  });

  test('posts the exact bar body, doubles movement, and returns the gained distance', async () => {
    const response = await app!.handle(
      new Request(`http://localhost/v1/combat/${encounterId}/intent`, {
        method: 'POST',
        headers: { authorization: `Bearer ${userId}`, 'content-type': 'application/json' },
        body: JSON.stringify(dashIntentBody()),
      }),
    );
    const body = (await response.json()) as {
      result?: { movementGainedFeet?: number };
      engineRows?: unknown[];
    };
    expect(response.status).toBe(200);
    expect(body.result?.movementGainedFeet).toBe(30);
    expect(body.engineRows).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'dash' })]),
    );

    const legalActionsResponse = await app!.handle(
      new Request(`http://localhost/v1/combat/${encounterId}/legal-actions`, {
        headers: { authorization: `Bearer ${userId}` },
      }),
    );
    const legalActions = (await legalActionsResponse.json()) as {
      actorId?: string;
      actions?: Array<{ type?: string }>;
    };
    expect(legalActionsResponse.status).toBe(200);
    expect(legalActions.actions).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'move' })]),
    );
    // The turn stays the player's after Dash: still the hero's actor, still on the
    // encounter's turn pointer, and the player can still end the turn.
    expect(legalActions.actorId).toBe(DASH_ACTOR_ID);
    expect(legalActions.actions).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'end_turn' })]),
    );
    const [afterDash] = await db
      .select({ currentTurnOrder: combatEncounters.currentTurnOrder })
      .from(combatEncounters)
      .where(eq(combatEncounters.id, encounterId));
    expect(afterDash.currentTurnOrder).toBe(0);

    const [map] = await db
      .select({ state: tacticalMaps.state })
      .from(tacticalMaps)
      .where(eq(tacticalMaps.sessionId, sessionId));
    const hero = (
      map.state as { entities: Array<{ id: string; movementRemaining: number }> }
    ).entities.find((entity) => entity.id === DASH_ACTOR_ID);
    expect(hero?.movementRemaining).toBe(60);

    // The Action is spent: a second Dash in the same turn is refused and adds no movement.
    const secondDash = await app!.handle(
      new Request(`http://localhost/v1/combat/${encounterId}/intent`, {
        method: 'POST',
        headers: { authorization: `Bearer ${userId}`, 'content-type': 'application/json' },
        body: JSON.stringify(dashIntentBody()),
      }),
    );
    expect(secondDash.status).toBe(422);
    expect(await secondDash.json()).toEqual(
      expect.objectContaining({ error: 'Action already used this turn' }),
    );
    const [mapAfterRefusal] = await db
      .select({ state: tacticalMaps.state })
      .from(tacticalMaps)
      .where(eq(tacticalMaps.sessionId, sessionId));
    const heroAfterRefusal = (
      mapAfterRefusal.state as { entities: Array<{ id: string; movementRemaining: number }> }
    ).entities.find((entity) => entity.id === DASH_ACTOR_ID);
    expect(heroAfterRefusal?.movementRemaining).toBe(60);
  });

  test('a retried move with the same x-request-id replays the stored response (#51)', async () => {
    const requestId = crypto.randomUUID();
    // Read the hero's state first: this test shares the encounter with the
    // Dash test above, so it must not assume Dash already ran (movement 60)
    // or not (movement 30). The assertions are relative — one 5-ft step.
    const [mapBefore] = await db
      .select({ state: tacticalMaps.state })
      .from(tacticalMaps)
      .where(eq(tacticalMaps.sessionId, sessionId));
    const heroBefore = (
      mapBefore.state as {
        entities: Array<{ id: string; x: number; y: number; movementRemaining: number }>;
      }
    ).entities.find((entity) => entity.id === DASH_ACTOR_ID);
    const fromX = heroBefore?.x ?? 0;
    const fromY = heroBefore?.y ?? 0;
    const movementBefore = heroBefore?.movementRemaining ?? 0;
    // #51, AGENTS.md §4: the body is the executor's own wire body (the
    // shared fixture the client test proves the executor sends), and the
    // header value is minted with crypto.randomUUID() the way the executor
    // mints it — not a hand-written string.
    const moveBody = combatIntentMoveBody(DASH_ACTOR_ID, fromX + 1, fromY);
    const postMove = (): Promise<Response> =>
      app!.handle(
        new Request(`http://localhost/v1/combat/${encounterId}/intent`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${userId}`,
            'content-type': 'application/json',
            [COMBAT_INTENT_REQUEST_ID_HEADER]: requestId,
          },
          body: JSON.stringify(moveBody),
        }),
      );
    const first = await postMove();
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.accepted).toBe(true);

    const second = await postMove();
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    // The retry returns the first delivery's response, not a fresh execution:
    // a re-executed move from the new position would report an empty path.
    expect(secondBody).toEqual(firstBody);

    const [map] = await db
      .select({ state: tacticalMaps.state })
      .from(tacticalMaps)
      .where(eq(tacticalMaps.sessionId, sessionId));
    const state = map.state as {
      entities: Array<{ id: string; x: number; y: number; movementRemaining: number }>;
      pendingDmFacts?: string[];
    };
    const hero = state.entities.find((entity) => entity.id === DASH_ACTOR_ID);
    expect(hero?.x).toBe(fromX + 1);
    expect(hero?.y).toBe(fromY);
    // Exactly one 5-ft step: a second execution of the same move would
    // append a second "moved to" DM fact.
    expect(hero?.movementRemaining).toBe(movementBefore - 5);
    expect(
      (state.pendingDmFacts ?? []).filter((fact) =>
        fact.includes(`moved to (${fromX + 1}, ${fromY})`),
      ),
    ).toHaveLength(1);
  });

  // The hero's map row, read fresh: the tests below share the encounter,
  // so each reads its start position instead of assuming one.
  const heroState = async (): Promise<{
    x: number;
    y: number;
    movementRemaining: number;
    pendingDmFacts: string[];
  }> => {
    const [map] = await db
      .select({ state: tacticalMaps.state })
      .from(tacticalMaps)
      .where(eq(tacticalMaps.sessionId, sessionId));
    const state = map.state as {
      entities: Array<{ id: string; x: number; y: number; movementRemaining: number }>;
      pendingDmFacts?: string[];
    };
    const hero = state.entities.find((entity) => entity.id === DASH_ACTOR_ID);
    return {
      x: hero?.x ?? 0,
      y: hero?.y ?? 0,
      movementRemaining: hero?.movementRemaining ?? 0,
      pendingDmFacts: state.pendingDmFacts ?? [],
    };
  };

  test('two overlapping same-id Move intents record one move (#51)', async () => {
    const requestId = crypto.randomUUID();
    const before = await heroState();
    const moveBody = combatIntentMoveBody(DASH_ACTOR_ID, before.x, before.y + 1);
    const postMove = (): Promise<Response> =>
      app!.handle(
        new Request(`http://localhost/v1/combat/${encounterId}/intent`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${userId}`,
            'content-type': 'application/json',
            [COMBAT_INTENT_REQUEST_ID_HEADER]: requestId,
          },
          body: JSON.stringify(moveBody),
        }),
      );
    // Fired together, so at least two of them overlap in the claim window:
    // the winner claims the id and executes, the others find its pending
    // row (409) or its stored response (200). However they interleave, the
    // move itself must happen exactly once.
    const responses = await Promise.all([postMove(), postMove(), postMove()]);
    const statuses = responses.map((response) => response.status);
    expect(statuses.every((status) => status === 200 || status === 409)).toBe(true);
    expect(statuses).toContain(200);
    const bodies = await Promise.all(
      responses.filter((response) => response.status === 200).map((response) => response.json()),
    );
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies.slice(1)) expect(body).toEqual(bodies[0]);

    const after = await heroState();
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y + 1);
    expect(after.movementRemaining).toBe(before.movementRemaining - 5);
    expect(
      after.pendingDmFacts.filter((fact) =>
        fact.includes(`moved to (${before.x}, ${before.y + 1})`),
      ),
    ).toHaveLength(1);
  });

  test('a fresh pending row answers 409 and executes nothing (#51)', async () => {
    const requestId = crypto.randomUUID();
    const before = await heroState();
    await db.insert(combatIntentIdempotency).values({
      encounterId,
      requestId,
      claimToken: crypto.randomUUID(),
      response: null,
    });
    try {
      const response = await app!.handle(
        new Request(`http://localhost/v1/combat/${encounterId}/intent`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${userId}`,
            'content-type': 'application/json',
            [COMBAT_INTENT_REQUEST_ID_HEADER]: requestId,
          },
          body: JSON.stringify(combatIntentMoveBody(DASH_ACTOR_ID, before.x + 1, before.y)),
        }),
      );
      expect(response.status).toBe(409);
      const body = (await response.json()) as { code?: string };
      expect(body.code).toBe('COMBAT_INTENT_IN_FLIGHT');

      const after = await heroState();
      expect(after.x).toBe(before.x);
      expect(after.y).toBe(before.y);
      expect(after.movementRemaining).toBe(before.movementRemaining);
    } finally {
      await db
        .delete(combatIntentIdempotency)
        .where(eq(combatIntentIdempotency.requestId, requestId));
    }
  });

  test('a stale pending row is taken over and the move executes once (#51)', async () => {
    const requestId = crypto.randomUUID();
    const before = await heroState();
    await db.insert(combatIntentIdempotency).values({
      encounterId,
      requestId,
      claimToken: crypto.randomUUID(),
      response: null,
      createdAt: new Date(Date.now() - PENDING_TAKEOVER_AFTER_MS - 1_000),
    });
    const response = await app!.handle(
      new Request(`http://localhost/v1/combat/${encounterId}/intent`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${userId}`,
          'content-type': 'application/json',
          [COMBAT_INTENT_REQUEST_ID_HEADER]: requestId,
        },
        body: JSON.stringify(combatIntentMoveBody(DASH_ACTOR_ID, before.x + 1, before.y)),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { accepted?: boolean };
    expect(body.accepted).toBe(true);

    const after = await heroState();
    expect(after.x).toBe(before.x + 1);
    expect(after.y).toBe(before.y);
    expect(after.movementRemaining).toBe(before.movementRemaining - 5);
    expect(
      after.pendingDmFacts.filter((fact) =>
        fact.includes(`moved to (${before.x + 1}, ${before.y})`),
      ),
    ).toHaveLength(1);
    // The takeover claim was filled with the completed response, so a
    // retry with the same id replays it.
    const [row] = await db
      .select({ response: combatIntentIdempotency.response })
      .from(combatIntentIdempotency)
      .where(eq(combatIntentIdempotency.requestId, requestId));
    expect(row?.response).toEqual(expect.objectContaining({ accepted: true }));
  });

  test('a refused intent releases its claim, so the same id can be reused (#51)', async () => {
    const requestId = crypto.randomUUID();
    const before = await heroState();
    // Dash is spent (the first test used it), so a Dash under this id is
    // refused 422 — and the refusal must release the claim, not leave it
    // 409ing for the takeover window.
    const refused = await app!.handle(
      new Request(`http://localhost/v1/combat/${encounterId}/intent`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${userId}`,
          'content-type': 'application/json',
          [COMBAT_INTENT_REQUEST_ID_HEADER]: requestId,
        },
        body: JSON.stringify(dashIntentBody()),
      }),
    );
    expect(refused.status).toBe(422);
    // The same id now proceeds: the claim was released, so this Move
    // executes instead of answering 409.
    const moved = await app!.handle(
      new Request(`http://localhost/v1/combat/${encounterId}/intent`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${userId}`,
          'content-type': 'application/json',
          [COMBAT_INTENT_REQUEST_ID_HEADER]: requestId,
        },
        body: JSON.stringify(combatIntentMoveBody(DASH_ACTOR_ID, before.x, before.y - 1)),
      }),
    );
    expect(moved.status).toBe(200);
    const after = await heroState();
    expect(after.y).toBe(before.y - 1);
    expect(after.movementRemaining).toBe(before.movementRemaining - 5);
  });

  test('store and release only touch the row their own claim created (#51)', async () => {
    const requestId = crypto.randomUUID();
    const claimToken = crypto.randomUUID();
    const otherToken = crypto.randomUUID();
    await db.insert(combatIntentIdempotency).values({
      encounterId,
      requestId,
      claimToken,
      response: null,
    });
    const readRow = async (): Promise<{ response: Record<string, unknown> | null } | undefined> => {
      const [row] = await db
        .select({ response: combatIntentIdempotency.response })
        .from(combatIntentIdempotency)
        .where(eq(combatIntentIdempotency.requestId, requestId));
      return row;
    };
    // A store carrying another claim's token must not fill this row: a
    // first attempt that returns late, after a takeover owner re-claimed
    // the id, must never overwrite the owner's response.
    await storeIntentResponse(encounterId, requestId, { accepted: true }, otherToken);
    expect((await readRow())?.response).toBeNull();
    await storeIntentResponse(encounterId, requestId, { accepted: true }, claimToken);
    expect((await readRow())?.response).toEqual({ accepted: true });
    // A release carrying another claim's token must not delete a live
    // row — and a release never deletes a completed row at all.
    await releaseIntentClaim(encounterId, requestId, otherToken);
    expect(await readRow()).toBeDefined();
    await releaseIntentClaim(encounterId, requestId, claimToken);
    expect(await readRow()).toBeDefined();
    await db
      .delete(combatIntentIdempotency)
      .where(eq(combatIntentIdempotency.requestId, requestId));
  });
});
