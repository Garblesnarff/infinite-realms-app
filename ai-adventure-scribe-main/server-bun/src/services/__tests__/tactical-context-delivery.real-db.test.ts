/**
 * #849 (audit F19): the tactical-context GET used to delete the one-shot engine
 * facts inside its read transaction, so a context response lost on the wire — or a
 * narration that never happened — took the facts with it. The read now stamps the
 * batch as out-for-delivery under a token instead of deleting it: a retry inside
 * the TTL returns the same batch under the same token, and the batch is deleted
 * only when a generate call echoes the token back (delivery confirmed) or when the
 * TTL lapses.
 *
 * Every request goes through the real route (`createTacticalMapRoutes`), the way
 * `app.ts` mounts it, against real PostgreSQL: the behaviour under test is a
 * write-then-read race across two GETs and the generate-side confirm, which a
 * mocked `db` cannot run. Only authentication is faked, because WorkOS cannot be
 * reached from a test.
 *
 * Wire bodies follow the client's own producers: `recordDmTacticalFact` (the
 * engine's fact channel) and the `userDataApi.getTacticalMapContext` response
 * shape the hook reads `tacticalContext` and `deliveryToken` from.
 *
 * Requires TEST_DATABASE_URL — see fixtures/real-db.ts.
 */
import { afterAll, expect, mock, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Elysia } from 'elysia';

import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from './fixtures/real-db.js';
import {
  campaigns,
  characters,
  gameSessions,
  tacticalMaps,
} from '../../../../db/schema/index';

import type { TacticalMap } from '../../tactical/types.js';

process.env.PORT ??= '8895';
process.env.CORS_ORIGIN ??= 'http://localhost:8895';
process.env.WORKOS_API_KEY ??= 'test-workos-key';
process.env.WORKOS_CLIENT_ID ??= 'test-workos-client';
process.env.NODE_ENV ??= 'test';

const USER_PREFIX = 'tactical-delivery-user-';
const userId = `${USER_PREFIX}${process.pid}`;

// Only authentication is replaced: a bearer of `Bearer <userId>` is that user.
mock.module('../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/, '');
    return token?.startsWith(USER_PREFIX)
      ? { user: { userId: token, email: 'player@example.test', plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' };
  },
}));

const { createTacticalMapRoutes } = await importWithRealDb(
  () => import('../../routes/v1/tactical-maps.js'),
);
const { confirmTacticalContextDelivery, recordDmTacticalFact } = await importWithRealDb(
  () => import('../combat/tactical-action-service.js'),
);

if (!hasRealDb) {
  console.warn(
    '[tactical-context-delivery] SKIPPED: set TEST_DATABASE_URL to a scratch Postgres to run these.',
  );
}

describeWithDb('tactical context delivery (#849)', () => {
  const database = hasRealDb ? realDb() : (null as never);
  const app = hasRealDb ? new Elysia().use(createTacticalMapRoutes()) : (null as never);

  const sessionIds: string[] = [];
  const characterIds: string[] = [];
  const campaignIds: string[] = [];

  const getContext = async (sessionId: string) => {
    const response = await app.handle(
      new Request(`http://localhost/v1/sessions/${sessionId}/tactical-map/context/hero-1`, {
        headers: { authorization: `Bearer ${userId}` },
      }),
    );
    const body = (await response.json()) as { tacticalContext?: string; deliveryToken?: string };
    return { status: response.status, body };
  };

  const mapState = (sessionId: string, overrides: Partial<TacticalMap> = {}): TacticalMap => ({
    id: crypto.randomUUID(),
    sessionId,
    width: 4,
    height: 4,
    round: 1,
    sceneDescription: 'A test glade.',
    cells: Array.from({ length: 4 }, () =>
      Array.from({ length: 4 }, () => ({
        terrain: 'floor' as const,
        blocksMovement: false,
        blocksSight: false,
        cover: 0 as const,
        elevation: 0,
      })),
    ),
    entities: [
      {
        id: 'hero-1',
        slug: 'hero',
        x: 1,
        y: 1,
        size: 'medium',
        type: 'pc',
        speedFeet: 30,
        movementRemaining: 30,
      },
    ],
    ...overrides,
  });

  /** A fresh session; the tactical map row (if any) is per-test. */
  const seedSession = async (): Promise<string> => {
    const [{ id: campaignId }] = await database
      .insert(campaigns)
      .values({ userId, name: testId('camp') })
      .returning({ id: campaigns.id });
    const [{ id: characterId }] = await database
      .insert(characters)
      .values({ userId, campaignId, name: testId('hero'), level: 5, class: 'Fighter' })
      .returning({ id: characters.id });
    const [{ id: sessionId }] = await database
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });
    campaignIds.push(campaignId);
    characterIds.push(characterId);
    sessionIds.push(sessionId);
    return sessionId;
  };

  const readState = async (sessionId: string): Promise<TacticalMap | null> => {
    const [row] = await database
      .select()
      .from(tacticalMaps)
      .where(eq(tacticalMaps.sessionId, sessionId))
      .limit(1);
    return (row?.state as TacticalMap) ?? null;
  };

  afterAll(async () => {
    if (!hasRealDb) return;
    for (const id of sessionIds) await database.delete(gameSessions).where(eq(gameSessions.id, id));
    for (const id of characterIds) await database.delete(characters).where(eq(characters.id, id));
    for (const id of campaignIds) await database.delete(campaigns).where(eq(campaigns.id, id));
    await closeRealDb();
  });

  test('a GET hands out facts with a token and keeps them until delivery is confirmed', async () => {
    const sessionId = await seedSession();
    // A torn-down board with one-shot facts left on it: the facts outlive the map.
    await database.insert(tacticalMaps).values({
      id: crypto.randomUUID(),
      sessionId,
      state: mapState(sessionId, {
        pendingDmFacts: ['The Void-Maw walked but could not reach.'],
        pendingDmCorrection: 'The prior attack was illegal.',
      }),
      active: false,
    });

    const first = await getContext(sessionId);
    expect(first.status).toBe(200);
    expect(first.body.tacticalContext).toContain('The Void-Maw walked but could not reach.');
    expect(first.body.tacticalContext).toContain('The prior attack was illegal.');
    expect(typeof first.body.deliveryToken).toBe('string');
    expect(first.body.deliveryToken!.length).toBeGreaterThan(0);

    // The lost response must not destroy the facts: they moved to the delivery
    // record instead of being deleted.
    const state = await readState(sessionId);
    expect(state?.pendingDmFacts).toBeUndefined();
    expect(state?.pendingDmCorrection).toBeUndefined();
    expect(state?.pendingDmDelivery?.token).toBe(first.body.deliveryToken);
    expect(state?.pendingDmDelivery?.facts).toEqual([
      'The Void-Maw walked but could not reach.',
    ]);
    expect(state?.pendingDmDelivery?.correction).toBe('The prior attack was illegal.');
  });

  test('a retry inside the TTL returns the same facts under the same token', async () => {
    const sessionId = await seedSession();
    await database.insert(tacticalMaps).values({
      id: crypto.randomUUID(),
      sessionId,
      state: mapState(sessionId, { pendingDmFacts: ['Retry-safe fact.'] }),
      active: false,
    });

    const first = await getContext(sessionId);
    const second = await getContext(sessionId);
    expect(second.status).toBe(200);
    expect(second.body.tacticalContext).toContain('Retry-safe fact.');
    expect(second.body.deliveryToken).toBe(first.body.deliveryToken);

    // Still exactly one delivery record; the retry did not mint a second batch.
    const state = await readState(sessionId);
    expect(state?.pendingDmDelivery?.token).toBe(first.body.deliveryToken);
    expect(state?.pendingDmDelivery?.facts).toEqual(['Retry-safe fact.']);
  });

  test('the generate-side confirm clears the batch: the next GET has nothing left', async () => {
    const sessionId = await seedSession();
    await database.insert(tacticalMaps).values({
      id: crypto.randomUUID(),
      sessionId,
      state: mapState(sessionId, { pendingDmFacts: ['Confirmed fact.'] }),
      active: false,
    });

    const first = await getContext(sessionId);
    const token = first.body.deliveryToken!;
    // This is the call POST /v1/llm/generate makes when it carries the token.
    expect(await confirmTacticalContextDelivery(sessionId, token)).toBe(true);

    const state = await readState(sessionId);
    expect(state?.pendingDmDelivery).toBeUndefined();

    const next = await getContext(sessionId);
    expect(next.status).toBe(404);
  });

  test('a token that matches nothing confirms nothing', async () => {
    const sessionId = await seedSession();
    await database.insert(tacticalMaps).values({
      id: crypto.randomUUID(),
      sessionId,
      state: mapState(sessionId, { pendingDmFacts: ['Still here.'] }),
      active: false,
    });

    const first = await getContext(sessionId);
    expect(await confirmTacticalContextDelivery(sessionId, crypto.randomUUID())).toBe(false);

    const second = await getContext(sessionId);
    expect(second.status).toBe(200);
    expect(second.body.tacticalContext).toContain('Still here.');
    expect(second.body.deliveryToken).toBe(first.body.deliveryToken);
  });

  test('an expired delivery is dropped, not re-delivered', async () => {
    const sessionId = await seedSession();
    await database.insert(tacticalMaps).values({
      id: crypto.randomUUID(),
      sessionId,
      state: mapState(sessionId, {
        pendingDmDelivery: {
          token: crypto.randomUUID(),
          facts: ['A fact from a round that is over.'],
          actions: [],
          correction: null,
          issuedAt: Date.now() - 20 * 60 * 1000,
          expiresAt: Date.now() - 1000,
        },
      }),
      active: false,
    });

    const response = await getContext(sessionId);
    expect(response.status).toBe(404);
  });

  test('an active board hands out its token with the map context', async () => {
    const sessionId = await seedSession();
    await database.insert(tacticalMaps).values({
      id: crypto.randomUUID(),
      sessionId,
      state: mapState(sessionId, { pendingDmFacts: ['Active-board fact.'] }),
      active: true,
    });

    const response = await getContext(sessionId);
    expect(response.status).toBe(200);
    expect(typeof response.body.deliveryToken).toBe('string');
    expect(response.body.tacticalContext).toContain('Active-board fact.');
    expect(response.body.tacticalContext).toContain('TACTICAL DIGEST');
  });

  test('facts recorded while a batch is out wait for the next batch', async () => {
    const sessionId = await seedSession();
    await database.insert(tacticalMaps).values({
      id: crypto.randomUUID(),
      sessionId,
      state: mapState(sessionId, { pendingDmFacts: ['First fact.'] }),
      active: true,
    });

    const first = await getContext(sessionId);
    const token = first.body.deliveryToken!;
    // The engine resolves something while the first batch is still undelivered.
    await recordDmTacticalFact(sessionId, 'Second fact.');

    const retry = await getContext(sessionId);
    expect(retry.body.deliveryToken).toBe(token);
    expect(retry.body.tacticalContext).toContain('First fact.');
    expect(retry.body.tacticalContext).not.toContain('Second fact.');

    // Confirm the first batch: the next GET opens a new batch for the late fact.
    expect(await confirmTacticalContextDelivery(sessionId, token)).toBe(true);
    const next = await getContext(sessionId);
    expect(next.status).toBe(200);
    expect(next.body.tacticalContext).toContain('Second fact.');
    expect(next.body.deliveryToken).not.toBe(token);
  });
});
