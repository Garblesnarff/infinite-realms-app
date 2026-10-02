/* eslint-disable max-lines -- one campaign, two characters and their sessions are shared by every
   assertion; splitting it would rebuild the same fixture in each file. */
/**
 * #2484: what a playthrough owns. A playthrough is one character in one campaign.
 *
 * A second character in the same campaign must start a fresh story: its memories, history,
 * "Previously On" recap and journal are its own. One character resuming a session, or opening a
 * continuation session, must keep exactly its own.
 *
 * Every request goes through the real routes, mounted the way `app.ts` mounts them, against real
 * PostgreSQL: the leaks this guards against were WHERE clauses (campaign id where character id
 * belonged), which a mocked `db` cannot run. Only authentication is faked, because WorkOS cannot
 * be reached from a test. It refuses every target except the dedicated local/CI Postgres because
 * it writes fixtures.
 *
 * Wire bodies follow the client's own producers: the shared fixtures for the opening scene and
 * the opening memories (`initial-greeting-save.ts`, `continuation-session-init-save.ts`), the
 * session body `use-session-management.ts` / `use-session-initialization.ts` send, the handout
 * body `userDataApi.applyDmHandoutActions` sends, and the tRPC URL `use-initial-greeting.ts`
 * fetches. Chronicle rows carry every column `POST /v1/sessions/:id/complete` writes on success.
 */
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { inArray, like } from 'drizzle-orm';

import { campaigns, characters, sessionChronicles } from '../../../../../db/schema/index';
import { initialMemoryWireBodies } from '../../../../../shared/test-fixtures/continuation-session-init-save';
import { initialGreetingWireBody } from '../../../../../shared/test-fixtures/initial-greeting-save';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  realDbUrl,
  testId,
} from '../../../services/__tests__/fixtures/real-db.js';

if (hasRealDb) {
  const target = new URL(realDbUrl);
  if (target.hostname !== '127.0.0.1' || target.port !== '55432') {
    throw new Error(
      `[playthrough-scope] refusing real-DB fixtures against ${target.hostname}:${target.port}; use the dedicated Postgres at 127.0.0.1:55432`,
    );
  }
}

process.env.PORT ??= '8893';
process.env.CORS_ORIGIN ??= 'http://localhost:8891';
process.env.WORKOS_API_KEY ??= 'test-workos-key';
process.env.WORKOS_CLIENT_ID ??= 'test-workos-client';
process.env.NODE_ENV ??= 'test';

const USER_PREFIX = 'playthrough-scope-user-';
const userId = `${USER_PREFIX}${process.pid}`;

// Only authentication is replaced: a bearer of `Bearer <userId>` is that user.
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
    return token?.startsWith(USER_PREFIX)
      ? { user: { userId: token, email: 'player@example.test', plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' };
  },
}));

const { createRequestPipelineApp } = await importWithRealDb(
  () => import('../../../http-pipeline.js'),
);
const { sessionsRoutes } = await importWithRealDb(() => import('../sessions.js'));
const { sessionMessageRoutes } = await importWithRealDb(() => import('../session-messages.js'));
const { memoryRoutes } = await importWithRealDb(() => import('../memories.js'));
const { handoutRoutes } = await importWithRealDb(() => import('../handouts.js'));
const { appRouter } = await importWithRealDb(() => import('../../../trpc/root.js'));
const { db } = await importWithRealDb(() => import('../../../../../db/client.js'));

if (!hasRealDb) {
  console.warn(
    '[playthrough-scope] SKIPPED: set TEST_DATABASE_URL to the dedicated Postgres at 127.0.0.1:55432 to run these.',
  );
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describeWithDb('a playthrough is one character in one campaign (#2484)', () => {
  const database = hasRealDb ? realDb() : (null as unknown as ReturnType<typeof realDb>);
  const savedEnv = new Map<string, string | undefined>();
  // No embedding key or alert webhook: memory writes fire an embedding off the request's clock.
  const EMBEDDING_ENV = ['GOOGLE_GEMINI_API_KEY', 'GOOGLE_API_KEY', 'SLACK_ALERT_WEBHOOK_URL'];

  let app: { handle: (request: Request) => Response | Promise<Response> };
  let campaignId = '';
  let aliceId = '';
  let bobId = '';

  const call = async (method: string, path: string, body?: unknown) => {
    const response = await app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: { authorization: `Bearer ${userId}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    return { status: response.status, json: (await response.json()) as Json };
  };

  /** What `use-session-management.ts` sends for a character's first session. */
  const startFirstSession = async (characterId: string) => {
    const { status, json } = await call('POST', '/v1/sessions', {
      session_number: 1,
      status: 'active',
      campaign_id: campaignId,
      character_id: characterId,
      turn_count: 0,
      current_scene_description: 'The adventure begins...',
      session_notes: '',
      starter_campaign_id: null,
    });
    expect(status).toBe(201);
    return json.id as string;
  };

  /** What `use-session-initialization.ts` sends to continue from a completed session. */
  const continueSession = async (characterId: string, previousNumber: number) => {
    const { status, json } = await call('POST', '/v1/sessions', {
      session_number: previousNumber + 1,
      status: 'active',
      campaign_id: campaignId,
      character_id: characterId,
      turn_count: 0,
      current_scene_description: 'Continuing your adventure...',
      session_notes: `Continuing from Session ${previousNumber}`,
      starter_campaign_id: null,
    });
    expect(status).toBe(201);
    return json.id as string;
  };

  const complete = async (sessionId: string) =>
    expect((await call('POST', `/v1/sessions/${sessionId}/complete`, {})).status).toBe(200);

  /** The opening scene, in this hero's own words, in the shared client wire shape. */
  const saveGreeting = async (sessionId: string, id: string, text: string) => {
    const { status } = await call('POST', `/v1/sessions/${sessionId}/messages`, {
      ...initialGreetingWireBody(id),
      message: text,
    });
    expect(status).toBe(200);
  };

  /** The four opening memories, one request each as `useMemoryCreation` posts them. */
  const saveOpeningMemories = async (sessionId: string, hero: string) => {
    for (const wire of initialMemoryWireBodies(sessionId)) {
      const { status } = await call('POST', '/v1/memories', {
        ...wire,
        content: `${hero}: ${wire.content as string}`,
      });
      expect(status).toBe(200);
    }
  };

  const memoriesOf = async (sessionId: string) => {
    const { status, json } = await call('GET', `/v1/memories?session_id=${sessionId}`);
    expect(status).toBe(200);
    return (json as unknown as Json[]).map((memory) => memory.content as string);
  };

  const historyOf = async (sessionId: string) => {
    const { status, json } = await call('GET', `/v1/sessions/${sessionId}/messages`);
    expect(status).toBe(200);
    return (json.messages as Json[]).map((message) => message.message as string);
  };

  const handoutTitlesIn = async (sessionId: string) => {
    const { status, json } = await call('GET', `/v1/sessions/${sessionId}/journal`);
    expect(status).toBe(200);
    return (json.entries as Json[]).map((entry) => entry.title as string);
  };

  /** What `dm-actions-handler.ts` posts when the DM hands the player a document. */
  const deliverHandout = async (sessionId: string, title: string) => {
    const { status, json } = await call('POST', `/v1/sessions/${sessionId}/handout-actions`, {
      actions: [
        {
          mode: 'improvised',
          key: null,
          title,
          body: `${title}, in full.`,
          giver: 'The Innkeeper',
        },
      ],
    });
    expect(status).toBe(200);
    expect(json.degraded).toEqual([]);
  };

  /** A chronicle row with every column the complete-session job writes when it succeeds. */
  const saveReadyChronicle = async (sessionId: string, previouslyOn: string) => {
    await database.insert(sessionChronicles).values({
      sessionId,
      userId,
      status: 'ready',
      chronicleText: `Chapter text. ${previouslyOn}`,
      chapterTitle: 'A Chapter',
      previouslyOn,
      illustrationUrl: null,
      shareToken: testId('share').padEnd(32, 'x').slice(0, 32),
      generatedAt: new Date(),
    });
  };

  /** The request `use-initial-greeting.ts` sends, through the real tRPC mount. */
  const previouslyOn = async (sessionId: string): Promise<string | null> => {
    const input = encodeURIComponent(JSON.stringify({ newSessionId: sessionId, campaignId }));
    const response = await app.handle(
      new Request(`http://localhost/api/trpc/chronicles.getPreviouslyOn?input=${input}`, {
        headers: { authorization: `Bearer ${userId}` },
      }),
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as Json;
    return json.result.data?.previouslyOn ?? null;
  };

  const removeFixtures = async () => {
    const owned = await database
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(like(campaigns.userId, `${USER_PREFIX}%`));
    // Sessions, memories, history, journal rows and chronicles go with the campaign.
    if (owned.length > 0) {
      await database.delete(campaigns).where(
        inArray(
          campaigns.id,
          owned.map((row) => row.id),
        ),
      );
    }
    await database.delete(characters).where(like(characters.userId, `${USER_PREFIX}%`));
  };

  beforeAll(async () => {
    for (const key of EMBEDDING_ENV) {
      savedEnv.set(key, process.env[key]);
      delete process.env[key];
    }
    await removeFixtures();

    app = createRequestPipelineApp()
      .use(sessionsRoutes)
      .use(sessionMessageRoutes)
      .use(memoryRoutes)
      .use(handoutRoutes)
      // The mount from app.ts, with the context WorkOS would have produced.
      .all('/api/trpc/*', ({ request }) =>
        fetchRequestHandler({
          endpoint: '/api/trpc',
          req: request,
          router: appRouter,
          createContext: async ({ req, resHeaders }) => ({
            req,
            resHeaders,
            db,
            user: { userId, email: 'player@example.test', plan: 'free' },
          }),
        }),
      ) as unknown as typeof app;
  });

  // A fresh campaign and pair of characters per test: chronicles and sessions of one test must
  // not be candidates for another's lookups.
  beforeEach(async () => {
    const [campaign] = await database
      .insert(campaigns)
      .values({ userId, name: 'The Gilded Lantern' })
      .returning({ id: campaigns.id });
    campaignId = campaign!.id;
    const [alice, bob] = await database
      .insert(characters)
      .values([
        { userId, campaignId, name: 'Alice' },
        { userId, campaignId, name: 'Bob' },
      ])
      .returning({ id: characters.id });
    aliceId = alice!.id;
    bobId = bob!.id;
  });

  afterAll(async () => {
    if (hasRealDb) await removeFixtures();
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await closeRealDb();
  });

  test('two characters in one campaign get two sessions, each listed under its own character', async () => {
    const aliceSession = await startFirstSession(aliceId);
    const bobSession = await startFirstSession(bobId);

    expect(aliceSession).not.toBe(bobSession);
    for (const [characterId, sessionId] of [
      [aliceId, aliceSession],
      [bobId, bobSession],
    ] as const) {
      const { status, json } = await call(
        'GET',
        `/v1/sessions?campaign_id=${campaignId}&character_id=${characterId}`,
      );
      expect(status).toBe(200);
      expect((json as unknown as Json[]).map((session) => session.id)).toEqual([sessionId]);
    }
  });

  test('a second character sees none of the first character memory or history', async () => {
    const aliceSession = await startFirstSession(aliceId);
    const bobSession = await startFirstSession(bobId);
    await saveGreeting(
      aliceSession,
      '9acfbdd8-9d02-4abe-b96a-932a7034d150',
      'Alice wakes to the smell of old pipe smoke.',
    );
    await saveOpeningMemories(aliceSession, 'Alice');

    // Bob has played nothing yet: nothing of Alice story is his.
    expect(await historyOf(bobSession)).toEqual([]);
    expect(await memoriesOf(bobSession)).toEqual([]);
    const recall = await call('POST', '/v1/memories/recall', {
      session_id: bobSession,
      query: 'the hooded stranger and the map',
      limit: 10,
    });
    expect(recall.status).toBe(200);
    expect(recall.json).toEqual([]);

    await saveGreeting(
      bobSession,
      '7d819e08-4813-4448-9712-165cea5488be',
      'Bob wakes to a cold hearth.',
    );
    await saveOpeningMemories(bobSession, 'Bob');

    expect(await historyOf(bobSession)).toEqual(['Bob wakes to a cold hearth.']);
    expect((await memoriesOf(bobSession)).every((content) => content.startsWith('Bob: '))).toBe(
      true,
    );
    expect(await memoriesOf(bobSession)).toHaveLength(4);
    // And Alice is untouched by Bob.
    expect(await historyOf(aliceSession)).toEqual(['Alice wakes to the smell of old pipe smoke.']);
    expect((await memoriesOf(aliceSession)).every((content) => content.startsWith('Alice: '))).toBe(
      true,
    );
  });

  test('one character resuming its session keeps its own memory and history', async () => {
    const aliceSession = await startFirstSession(aliceId);
    await saveGreeting(
      aliceSession,
      '3f1f6c0e-5c2b-4d44-a3f4-0b6f1f0d8a11',
      'Alice reads the map by the fire.',
    );
    await saveOpeningMemories(aliceSession, 'Alice');
    // A second character is created and played in the same campaign in between.
    const bobSession = await startFirstSession(bobId);
    await saveGreeting(bobSession, '8d0a2b77-91c4-4d7e-8a5e-7f3b2c6e9d22', 'Bob counts coins.');

    // Resume: the list for Alice names the same session, and it still holds her own story.
    const { json } = await call(
      'GET',
      `/v1/sessions?campaign_id=${campaignId}&character_id=${aliceId}&status=active`,
    );
    expect((json as unknown as Json[]).map((session) => session.id)).toEqual([aliceSession]);
    expect(await historyOf(aliceSession)).toEqual(['Alice reads the map by the fire.']);
    expect(await memoriesOf(aliceSession)).toHaveLength(4);
  });

  test('a new character starts with an empty journal; each character keeps its own handouts across sessions', async () => {
    const aliceFirst = await startFirstSession(aliceId);
    await deliverHandout(aliceFirst, "Alice's Letter");
    await complete(aliceFirst);

    // Bob starts a fresh story in the same campaign.
    const bobFirst = await startFirstSession(bobId);
    expect(await handoutTitlesIn(bobFirst)).toEqual([]);
    await deliverHandout(bobFirst, "Bob's Contract");
    expect(await handoutTitlesIn(bobFirst)).toEqual(["Bob's Contract"]);

    // Alice continues: her second session keeps her first session's handout, and not Bob's.
    const aliceSecond = await continueSession(aliceId, 1);
    expect(await handoutTitlesIn(aliceSecond)).toEqual(["Alice's Letter"]);
    await deliverHandout(aliceSecond, "Alice's Key");
    expect((await handoutTitlesIn(aliceSecond)).sort()).toEqual(["Alice's Key", "Alice's Letter"]);
    expect(await handoutTitlesIn(bobFirst)).toEqual(["Bob's Contract"]);
  });

  test('Previously On comes from the same character previous session, never another character', async () => {
    // Both characters finished session 1 and have a ready chronicle. Bob first, so a lookup that
    // ignores the character finds his row before Alice's.
    const bobFirst = await startFirstSession(bobId);
    const aliceFirst = await startFirstSession(aliceId);
    await complete(bobFirst);
    await complete(aliceFirst);
    await saveReadyChronicle(bobFirst, 'Previously, Bob signed a contract with the guild.');
    await saveReadyChronicle(aliceFirst, 'Previously, Alice followed the hooded stranger.');

    const aliceSecond = await continueSession(aliceId, 1);
    const bobSecond = await continueSession(bobId, 1);

    expect(await previouslyOn(aliceSecond)).toBe('Previously, Alice followed the hooded stranger.');
    expect(await previouslyOn(bobSecond)).toBe('Previously, Bob signed a contract with the guild.');
  });

  test('a character with no chronicle of its own gets no Previously On, even if another character has one', async () => {
    const aliceFirst = await startFirstSession(aliceId);
    await complete(aliceFirst);
    await saveReadyChronicle(aliceFirst, 'Previously, Alice followed the hooded stranger.');

    // Bob's first session finished without a chronicle, and he continues.
    const bobFirst = await startFirstSession(bobId);
    await complete(bobFirst);
    const bobSecond = await continueSession(bobId, 1);

    expect(await previouslyOn(bobSecond)).toBeNull();
    // A brand-new character's first session never asks for one.
    expect(await previouslyOn(await startFirstSession(bobId))).toBeNull();
  });
});
