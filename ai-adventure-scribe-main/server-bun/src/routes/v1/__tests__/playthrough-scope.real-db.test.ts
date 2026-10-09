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
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { eq, inArray, like } from 'drizzle-orm';

import {
  campaigns,
  characters,
  characterStats,
  characterSpellSlots,
  combatEncounters,
  combatParticipants,
  combatParticipantStatus,
  gameSessions,
  tacticalMaps,
  sessionChronicles,
  spellSlotUsageLog,
} from '../../../../../db/schema/index';
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

import type { TacticalMap } from '../../../tactical/types.js';

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
const { tacticalMapRoutes } = await importWithRealDb(() => import('../tactical-maps.js'));
const { combatRoutes } = await importWithRealDb(() => import('../combat/index.js'));
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

  const call = async (method: string, path: string, body?: unknown, caller = userId) => {
    const response = await app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: { authorization: `Bearer ${caller}`, 'content-type': 'application/json' },
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
      .use(tacticalMapRoutes)
      .use(combatRoutes)
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

  describe('map-route ownership characterization (#2685 step 2a)', () => {
    const otherUserId = `${USER_PREFIX}other-${process.pid}`;
    let sessionId: string;
    let encounterId: string;
    let heroId: string;
    let monsterId: string;
    let mapId: string;

    const mapRow = async (): Promise<typeof tacticalMaps.$inferSelect> => {
      const [row] = await database.select().from(tacticalMaps).where(eq(tacticalMaps.id, mapId));
      return row;
    };
    const persistedCombat = async (): Promise<{
      map: typeof tacticalMaps.$inferSelect;
      encounters: (typeof combatEncounters.$inferSelect)[];
      participants: (typeof combatParticipants.$inferSelect)[];
      hp: (typeof combatParticipantStatus.$inferSelect)[];
      stats: (typeof characterStats.$inferSelect)[];
      slots: (typeof characterSpellSlots.$inferSelect)[];
      slotUsage: (typeof spellSlotUsageLog.$inferSelect)[];
      session: (typeof gameSessions.$inferSelect)[];
    }> => ({
      map: await mapRow(),
      encounters: await database
        .select()
        .from(combatEncounters)
        .where(eq(combatEncounters.sessionId, sessionId)),
      participants: await database
        .select()
        .from(combatParticipants)
        .where(eq(combatParticipants.encounterId, encounterId))
        .orderBy(combatParticipants.id),
      hp: await database
        .select()
        .from(combatParticipantStatus)
        .where(inArray(combatParticipantStatus.participantId, [heroId, monsterId]))
        .orderBy(combatParticipantStatus.participantId),
      stats: await database
        .select()
        .from(characterStats)
        .where(eq(characterStats.characterId, aliceId)),
      slots: await database
        .select()
        .from(characterSpellSlots)
        .where(eq(characterSpellSlots.characterId, aliceId))
        .orderBy(characterSpellSlots.spellLevel),
      slotUsage: await database
        .select()
        .from(spellSlotUsageLog)
        .where(eq(spellSlotUsageLog.sessionId, sessionId))
        .orderBy(spellSlotUsageLog.id),
      session: await database.select().from(gameSessions).where(eq(gameSessions.id, sessionId)),
    });

    beforeEach(async () => {
      sessionId = await startFirstSession(aliceId);
      await database
        .update(characters)
        .set({ class: 'Wizard', level: 5 })
        .where(eq(characters.id, aliceId));
      await database.insert(characterStats).values({
        characterId: aliceId,
        armorClass: 12,
        speed: 30,
        maxHitPoints: 20,
        currentHitPoints: 20,
      });
      await database.insert(characterSpellSlots).values({
        characterId: aliceId,
        spellLevel: 3,
        totalSlots: 2,
        usedSlots: 0,
      });
      [{ id: encounterId }] = await database
        .insert(combatEncounters)
        .values({
          sessionId,
          status: 'active',
          currentRound: 1,
          currentTurnOrder: 0,
          version: 1,
        })
        .returning({ id: combatEncounters.id });
      const participants = await database
        .insert(combatParticipants)
        .values([
          {
            encounterId,
            name: 'Spent Sentinel',
            participantType: 'monster',
            turnOrder: 0,
            initiative: 20,
            armorClass: 12,
            maxHp: 20,
            speed: 30,
            actionUsed: true,
          },
          {
            encounterId,
            characterId: aliceId,
            name: 'Alice',
            participantType: 'player',
            turnOrder: 1,
            initiative: 10,
            armorClass: 12,
            maxHp: 20,
            speed: 30,
          },
        ])
        .returning({ id: combatParticipants.id, turnOrder: combatParticipants.turnOrder });
      const monster = participants.find((row) => row.turnOrder === 0);
      const hero = participants.find((row) => row.turnOrder === 1);
      if (!monster || !hero) throw new Error('characterization participants missing');
      monsterId = monster.id;
      heroId = hero.id;
      await database.insert(combatParticipantStatus).values([
        { participantId: heroId, currentHp: 20, maxHp: 20, isConscious: true },
        { participantId: monsterId, currentHp: 20, maxHp: 20, isConscious: true },
      ]);
      mapId = crypto.randomUUID();
      const state: TacticalMap = {
        id: mapId,
        sessionId,
        width: 12,
        height: 10,
        round: 1,
        sceneDescription: "User A's private map",
        cells: Array.from({ length: 10 }, () =>
          Array.from({ length: 12 }, () => ({
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
            slug: 'alice',
            x: 3,
            y: 3,
            size: 'medium',
            type: 'pc',
            speedFeet: 30,
            movementRemaining: 30,
          },
          {
            id: monsterId,
            slug: 'spent-sentinel',
            x: 9,
            y: 3,
            size: 'medium',
            type: 'monster',
            speedFeet: 30,
            movementRemaining: 30,
          },
        ],
        pendingDmCorrection: 'Private correction for user A',
        pendingDmFacts: ['Private engine fact for user A'],
        pendingDmFactActions: [
          { kind: 'move', actorSlug: 'alice', actorIsPlayer: true, timestamp: Date.now() },
        ],
        dmSilentTurns: 3,
      };
      await database.insert(tacticalMaps).values({ id: mapId, sessionId, state, active: true });
      // B is a distinct authenticated owner, not a missing/invalid bearer. The same existing
      // auth stub and request helper serve both identities; ownership remains real SQL.
      const [otherCampaign] = await database
        .insert(campaigns)
        .values({
          userId: otherUserId,
          name: 'User B campaign',
        })
        .returning({ id: campaigns.id });
      const [otherSession] = await database
        .insert(gameSessions)
        .values({
          campaignId: otherCampaign.id,
          sessionNumber: 1,
          status: 'active',
        })
        .returning({ id: gameSessions.id });
      expect(
        await call('GET', `/v1/sessions/${otherSession.id}/tactical-map`, undefined, otherUserId),
      ).toEqual({ status: 200, json: { map: null } });
      expect((await call('GET', `/v1/sessions/${sessionId}/tactical-map`)).json).toMatchObject({
        id: mapId,
        sessionId,
      });
    });

    test('concurrent map context calls deliver every pending fact only once (#2685 step 4)', async () => {
      const responses = await Promise.all([
        call('GET', `/v1/sessions/${sessionId}/tactical-map/context/${heroId}`),
        call('GET', `/v1/sessions/${sessionId}/tactical-map/context/${heroId}`),
      ]);
      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      const contexts = responses.map((response) => response.json.tacticalContext as string);
      expect(
        contexts.filter((context) => context.includes('Private engine fact for user A')),
      ).toHaveLength(1);
      expect(
        contexts.filter((context) => context.includes('Private correction for user A')),
      ).toHaveLength(1);
      const contracts = contexts.map((context) =>
        JSON.parse(context.match(/<contract_json>(.*?)<\/contract_json>/s)![1]),
      );
      expect(contracts.flatMap((contract) => contract.actions)).toHaveLength(1);
      const state = (await mapRow()).state as TacticalMap;
      expect(state.pendingDmFacts).toBeUndefined();
      expect(state.pendingDmCorrection).toBeUndefined();
      expect(state.pendingDmFactActions).toBeUndefined();
      expect(state.dmSilentTurns).toBe(1);
    });

    test('map context consumes facts, correction and structured actions together, then returns none (#2685 step 4)', async () => {
      const initial = (await mapRow()).state as TacticalMap;
      initial.pendingDmFacts!.push('Second engine fact for user A');
      initial.pendingDmFactActions!.push({
        kind: 'attack',
        actorSlug: 'spent-sentinel',
        actorIsPlayer: false,
        hit: true,
        timestamp: Date.now(),
      });
      await database.update(tacticalMaps).set({ state: initial }).where(eq(tacticalMaps.id, mapId));
      const first = await call('GET', `/v1/sessions/${sessionId}/tactical-map/context/${heroId}`);
      expect(first.status).toBe(200);
      expect(Object.keys(first.json)).toEqual(['tacticalContext']);
      const context = first.json.tacticalContext as string;
      for (const fact of initial.pendingDmFacts!) expect(context.split(fact)).toHaveLength(2);
      expect(context).toContain(
        '<previous_tactical_failure>Private correction for user A</previous_tactical_failure>',
      );
      const contract = JSON.parse(context.match(/<contract_json>(.*?)<\/contract_json>/s)![1]);
      expect(contract.actions).toMatchObject([
        { kind: 'move', count: 1, actors: ['alice'] },
        { kind: 'attack', count: 1, actors: ['spent-sentinel'], hit: true },
      ]);
      const consumed = (await mapRow()).state as TacticalMap;
      expect(consumed).toEqual({
        ...initial,
        pendingDmFacts: undefined,
        pendingDmCorrection: undefined,
        pendingDmFactActions: undefined,
        dmSilentTurns: 0,
      });
      const second = await call('GET', `/v1/sessions/${sessionId}/tactical-map/context/${heroId}`);
      expect(second.status).toBe(200);
      expect(Object.keys(second.json)).toEqual(['tacticalContext']);
      expect(second.json.tacticalContext).not.toContain('<engine_resolved_outcomes>');
      expect(second.json.tacticalContext).not.toContain('<previous_tactical_failure>');
      expect(
        JSON.parse(second.json.tacticalContext.match(/<contract_json>(.*?)<\/contract_json>/s)[1])
          .actions,
      ).toEqual([]);
      expect(((await mapRow()).state as TacticalMap).dmSilentTurns).toBe(1);
    });

    test('map context consumes the latest inactive row once without reviving it (#2685 step 4)', async () => {
      const initial = (await mapRow()).state as TacticalMap;
      await database.insert(tacticalMaps).values({
        id: crypto.randomUUID(),
        sessionId,
        active: false,
        updatedAt: new Date('2020-01-01T00:00:00Z'),
        state: { ...initial, pendingDmFacts: ['Older inactive fact must stay queued'] },
      });
      await database.update(tacticalMaps).set({ active: false }).where(eq(tacticalMaps.id, mapId));
      const first = await call('GET', `/v1/sessions/${sessionId}/tactical-map/context/${heroId}`);
      expect(first.status).toBe(200);
      expect(Object.keys(first.json)).toEqual(['tacticalContext']);
      expect(first.json.tacticalContext).toContain('Private engine fact for user A');
      expect(first.json.tacticalContext).toContain('Private correction for user A');
      expect(first.json.tacticalContext).not.toContain('Older inactive fact must stay queued');
      expect(
        JSON.parse(first.json.tacticalContext.match(/<contract_json>(.*?)<\/contract_json>/s)[1])
          .actions,
      ).toMatchObject([{ kind: 'move', count: 1, actors: ['alice'] }]);
      const consumed = await mapRow();
      expect(consumed.active).toBe(false);
      expect(consumed.state).toEqual({
        ...initial,
        pendingDmFacts: undefined,
        pendingDmCorrection: undefined,
        pendingDmFactActions: undefined,
      });
      expect(await call('GET', `/v1/sessions/${sessionId}/tactical-map/context/${heroId}`)).toEqual(
        { status: 404, json: { error: 'No active tactical map' } },
      );
      const maps = await database
        .select()
        .from(tacticalMaps)
        .where(eq(tacticalMaps.sessionId, sessionId));
      expect(maps).toHaveLength(2);
      expect(maps.every((row) => !row.active)).toBe(true);
      expect((maps.find((row) => row.id !== mapId)!.state as TacticalMap).pendingDmFacts).toEqual([
        'Older inactive fact must stay queued',
      ]);
    });

    test('map context keeps an older active board while consuming the latest inactive facts (#2685 step 4)', async () => {
      const initial = (await mapRow()).state as TacticalMap;
      const activeId = crypto.randomUUID();
      await database.update(tacticalMaps).set({ active: false }).where(eq(tacticalMaps.id, mapId));
      await database.insert(tacticalMaps).values({
        id: activeId,
        sessionId,
        active: true,
        updatedAt: new Date('2020-01-01T00:00:00Z'),
        state: { ...initial, id: activeId, pendingDmFacts: ['Older active fact stays queued'] },
      });
      const response = await call(
        'GET',
        `/v1/sessions/${sessionId}/tactical-map/context/${heroId}`,
      );
      expect(response.status).toBe(200);
      expect(response.json.tacticalContext).toContain('Private engine fact for user A');
      expect(response.json.tacticalContext).not.toContain('Older active fact stays queued');
      expect(response.json.tacticalContext).toContain('TACTICAL AUTHORITY:');
      expect(((await mapRow()).state as TacticalMap).pendingDmFacts).toBeUndefined();
      const [active] = await database
        .select()
        .from(tacticalMaps)
        .where(eq(tacticalMaps.id, activeId));
      expect(active.active).toBe(true);
      expect((active.state as TacticalMap).dmSilentTurns).toBe(0);
      expect((active.state as TacticalMap).pendingDmFacts).toEqual([
        'Older active fact stays queued',
      ]);
    });

    test('the board valid-moves URL returns engine destinations through the real pipeline (#199 step 3)', async () => {
      const before = await persistedCombat();
      const response = await call(
        'GET',
        `/v1/sessions/${sessionId}/tactical-map/valid-moves/${encodeURIComponent(heroId)}`,
      );
      expect(response.status).toBe(200);
      expect(response.json.entityId).toBe(heroId);
      expect(response.json.moves).toContainEqual({ x: 4, y: 3 });
      expect(response.json.moves).not.toContainEqual({ x: 9, y: 3 });
      expect(await persistedCombat()).toEqual(before);
    });

    test('removed /tactical-map/action returns 404 through the real pipeline without DB changes (#2685 step 1)', async () => {
      const before = await persistedCombat();
      const response = await app.handle(
        new Request(`http://localhost/v1/sessions/${sessionId}/tactical-map/action`, {
          method: 'POST',
          headers: { authorization: `Bearer ${userId}`, 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'move', entityId: heroId, x: 4, y: 3 }),
        }),
      );
      expect(response.status).toBe(404);
      expect(await persistedCombat()).toEqual(before);
    });

    test('live /move refuses an off-turn player without writes and persists a legal move (#2685 step 1)', async () => {
      const [offTurn] = await database
        .insert(combatParticipants)
        .values({
          encounterId,
          characterId: bobId,
          name: 'Bob',
          participantType: 'player',
          turnOrder: 2,
          initiative: 5,
          armorClass: 12,
          maxHp: 20,
          speed: 30,
        })
        .returning({ id: combatParticipants.id });
      await database
        .update(combatEncounters)
        .set({ currentTurnOrder: 1 })
        .where(eq(combatEncounters.id, encounterId));
      const before = await persistedCombat();
      const refused = await call('POST', `/v1/sessions/${sessionId}/tactical-map/move`, {
        entityId: offTurn.id,
        x: 4,
        y: 3,
      });
      expect(refused).toEqual({
        status: 422,
        json: { error: 'Actor is not the current-turn participant' },
      });
      expect(await persistedCombat()).toEqual(before);

      const accepted = await call('POST', `/v1/sessions/${sessionId}/tactical-map/move`, {
        entityId: heroId,
        x: 4,
        y: 3,
      });
      expect(accepted.status).toBe(200);
      expect(accepted.json.result).toMatchObject({ applied: true });
      const after = await persistedCombat();
      expect(
        (after.map.state as TacticalMap).entities.find(
          (entity: { id: string }) => entity.id === heroId,
        ),
      ).toMatchObject({ x: 4, y: 3, movementRemaining: 25 });
      expect(
        (after.map.state as TacticalMap).entities.find(
          (entity: { id: string }) => entity.id === monsterId,
        ),
      ).toEqual(
        (before.map.state as TacticalMap).entities.find(
          (entity: { id: string }) => entity.id === monsterId,
        ),
      );
      expect(after.hp).toEqual(before.hp);
      expect(after.slots).toEqual(before.slots);
      expect(after.slotUsage).toEqual(before.slotUsage);
    });

    test('documents #2685: another user CANNOT remove A’s entity via /dm-actions today', async () => {
      const before = await persistedCombat();
      const body = {
        actions: [{ action: 'remove', entityId: monsterId, x: null, y: null, changes: null }],
      };
      expect(
        await call('POST', `/v1/sessions/${sessionId}/tactical-map/dm-actions`, body, otherUserId),
      ).toEqual({ status: 404, json: { error: 'Session not found' } });
      expect(await persistedCombat()).toEqual(before);
      // Positive control: this exact body is a valid mutation for A, not a schema refusal.
      const owned = await call('POST', `/v1/sessions/${sessionId}/tactical-map/dm-actions`, body);
      expect(owned.status).toBe(200);
      expect(owned.json.results).toContainEqual(expect.objectContaining({ applied: true }));
      expect((await mapRow()).state).toMatchObject({
        entities: [expect.objectContaining({ id: heroId })],
      });
    });

    test('documents #2685: another user CANNOT read or consume A’s /context today', async () => {
      const before = await persistedCombat();
      expect(
        await call(
          'GET',
          `/v1/sessions/${sessionId}/tactical-map/context/${heroId}`,
          undefined,
          otherUserId,
        ),
      ).toEqual({ status: 404, json: { error: 'Session not found' } });
      expect(await persistedCombat()).toEqual(before);
      const owned = await call('GET', `/v1/sessions/${sessionId}/tactical-map/context/${heroId}`);
      expect(owned.status).toBe(200);
      expect(owned.json.tacticalContext).toContain('Private engine fact for user A');
      // A's real context path writes the row; the three concurrent clear-and-save cycles
      // are characterized separately in step 4, so this control does not assert their winner.
      expect((await mapRow()).updatedAt.getTime()).toBeGreaterThan(before.map.updatedAt.getTime());
    });

    test('documents #2685: another user CANNOT end A’s encounter or deactivate its map via /end today', async () => {
      const before = await persistedCombat();
      const body = { combat_exits: [{ participant_id: monsterId, exit: 'surrendered' }] };
      expect(
        await call('POST', `/v1/sessions/${sessionId}/tactical-map/end`, body, otherUserId),
      ).toEqual({ status: 404, json: { error: 'Session not found' } });
      expect(await persistedCombat()).toEqual(before);
      expect(await call('POST', `/v1/sessions/${sessionId}/tactical-map/end`, body)).toEqual({
        status: 200,
        json: { ok: true, encounterEnded: true },
      });
      const after = await persistedCombat();
      expect(after.map.active).toBe(false);
      expect(after.encounters[0].status).toBe('completed');
      expect(after.hp).toEqual(before.hp);
    });

    for (const phase of ['propose', 'resolve'] as const) {
      test(`documents #2685: another user CANNOT ${phase} an /aoe-cast on A’s session today`, async () => {
        const before = await persistedCombat();
        const body = {
          phase,
          actorId: heroId,
          spellId: 'fireball',
          origin: { x: 9, y: 3 },
          direction: null,
          slotLevel: 3,
          actionOrigin: 'typed',
        };
        expect(
          await call('POST', `/v1/sessions/${sessionId}/tactical-map/aoe-cast`, body, otherUserId),
        ).toEqual({ status: 404, json: { error: 'Session not found' } });
        expect(await persistedCombat()).toEqual(before);
        if (phase === 'propose') {
          const owned = await call('POST', `/v1/sessions/${sessionId}/tactical-map/aoe-cast`, body);
          expect(owned.status).toBe(200);
          expect(owned.json).toMatchObject({
            autoConfirm: false,
            hostile: false,
            preview: { actorId: heroId, spellId: 'fireball', state: 'player-pending' },
          });
          expect(await persistedCombat()).toEqual(before);
        }
      });
    }

    // Migrated (#2658 step 3): was "documents #2685: a player CAN label a move source dm and
    // absorb the preceding spent NPC turn today". The intent route now runs a creature still
    // holding the turn before a player's intent (its pre-drain), whatever the source label, so the
    // spent turn is run, not absorbed, and the player-labelled move is no longer refused.
    test('documents #2685: a move runs the preceding spent NPC turn first, under either source label', async () => {
      const before = await persistedCombat();
      // DynamicOptionsSection's move body: typed origin, player actor and x/y.
      const body = {
        intent: { type: 'move', actorId: heroId, x: 4, y: 3 },
        source: 'player',
        dmStartedAt: Date.now(),
        origin: 'typed',
      };
      const player = await call('POST', `/v1/combat/${encounterId}/intent`, body);
      expect(player.status).toBe(200);
      expect(player.json.accepted).toBe(true);
      expect(
        player.json.result.npcTurns.results.map(
          (result: { action: { actor_id: string } }) => result.action.actor_id,
        ),
      ).toEqual([monsterId]);
      const afterPlayer = await persistedCombat();
      expect(afterPlayer.map.state).toMatchObject({
        entities: expect.arrayContaining([
          expect.objectContaining({ id: heroId, x: 4, y: 3, movementRemaining: 25 }),
        ]),
      });
      expect(afterPlayer.encounters[0]).toMatchObject({ currentTurnOrder: 1, currentRound: 1 });
      expect(afterPlayer.hp).toEqual(before.hp);

      // The spent sentinel up again, as the order brings it round in round 2: the dm label gets
      // the same run, not an absorb.
      await database
        .update(combatEncounters)
        .set({ currentTurnOrder: 0, currentRound: 2 })
        .where(eq(combatEncounters.id, encounterId));
      const dm = await call('POST', `/v1/combat/${encounterId}/intent`, {
        ...body,
        intent: { type: 'move', actorId: heroId, x: 5, y: 3 },
        source: 'dm',
      });
      expect(dm.status).toBe(200);
      expect(dm.json.accepted).toBe(true);
      expect(
        dm.json.result.npcTurns.results.map(
          (result: { action: { actor_id: string } }) => result.action.actor_id,
        ),
      ).toEqual([monsterId]);
      const after = await persistedCombat();
      expect(after.encounters[0]).toMatchObject({ currentTurnOrder: 1, currentRound: 2 });
      expect(after.hp).toEqual(before.hp);
    });

    test('documents #2685: a player CAN label a dodge source dm and omit the required player version today', async () => {
      await database
        .update(combatEncounters)
        .set({ currentTurnOrder: 1 })
        .where(eq(combatEncounters.id, encounterId));
      const before = await persistedCombat();
      const body = {
        intent: { type: 'dodge', actorId: heroId },
        source: 'player',
        origin: 'action_bar',
      };
      const player = await call('POST', `/v1/combat/${encounterId}/intent`, body);
      expect(player.status).toBe(422);
      expect(player.json).toMatchObject({
        error: 'Invalid combat intent',
        stage: 'intent_schema',
        dialect: 'player',
        variant: 'dodge',
        missing: ['expectedVersion'],
      });
      expect(await persistedCombat()).toEqual(before);
      const dm = await call('POST', `/v1/combat/${encounterId}/intent`, { ...body, source: 'dm' });
      expect(dm.status).toBe(200);
      expect(dm.json.accepted).toBe(true);
      const after = await persistedCombat();
      expect(after.participants.find((row) => row.id === heroId)).toMatchObject({
        isDodging: true,
        actionUsed: true,
      });
      expect(after.encounters[0].version).toBe(before.encounters[0].version + 1);
      expect(after.hp).toEqual(before.hp);
    });
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
