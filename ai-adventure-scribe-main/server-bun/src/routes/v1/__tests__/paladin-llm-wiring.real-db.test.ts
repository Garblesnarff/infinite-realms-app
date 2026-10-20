/**
 * #712: llm.ts wiring for Lay on Hands.
 */
import { afterAll, beforeAll, expect, it, mock } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { Elysia } from 'elysia';

import {
  campaigns,
  characterFeatures,
  characterStats,
  characters,
  classFeaturesLibrary,
  combatEncounters,
  combatParticipantStatus,
  combatParticipants,
  dialogueHistory,
  featureUsageLog,
  gameSessions,
} from '../../../../../db/schema/index';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from '../../../services/__tests__/fixtures/real-db.js';

const stub = () => ({
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
  debug: mock(() => {}),
  child: () => stub(),
});

let userId = '';

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) =>
    request.headers.get('authorization') === 'Bearer test-token'
      ? { user: { userId, email: 'user@example.test', plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' },
}));

mock.module('../../../lib/logger.js', () => ({
  logger: stub(),
  combatLogger: stub(),
  spellLogger: stub(),
  progressionLogger: stub(),
  errorLogSerializers: {},
  default: stub(),
}));

// #264: the story-rest route test below mounts llmRoutes on the same pipeline.
// The generate handler's collaborators are stubbed the way
// llm-generate-http-contract.test.ts stubs them; the database stays real so
// applyStoryRest writes through RestService.
let generatedText = JSON.stringify({
  text: 'You catch your breath and press on.',
  rest: { type: 'short' },
});
mock.module('../../../middleware/admin.js', () => ({ isAdmin: () => false }));
mock.module('../../../middleware/rate-limit.js', () => ({
  planRateLimit: () => new Elysia({ name: 'test-plan-rate-limit' }),
}));
mock.module('../../../services/ai-usage-service.js', () => ({
  AIUsageService: {
    checkQuotaAndConsume: async () => ({
      allowed: true,
      remaining: 99,
      resetAt: new Date(Date.now() + 60_000),
    }),
    recordProviderUsage: async () => {},
  },
}));
mock.module('../../../services/llm-provider-service.js', () => ({
  LLMProviderService: {
    generate: async () => ({
      text: generatedText,
      provider: 'openrouter',
      model: 'test/model',
    }),
  },
}));
mock.module('../../../services/session/session-message-service.js', () => ({
  SessionMessageService: {
    withRollTurn: async (
      _sessionId: string,
      _userId: string,
      _playerInput: string | undefined,
      _rollId: string | undefined,
      _replyId: string | undefined,
      generate: () => Promise<unknown>,
    ) => generate(),
    // The DM-reply persistence write is not what the story-rest route test
    // asserts on; keep it from touching the database.
    addMessage: async () => undefined,
  },
}));

if (hasRealDb && !process.env.DATABASE_URL && process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

// #205: the pipeline below mounts issue1784DataRoutes, whose service executes
// a module-scope sql`` template; the db proxy validates the full server env
// on first use, and the real-DB CI job does not provide CORS_ORIGIN,
// WORKOS_API_KEY, WORKOS_CLIENT_ID, or PORT. Dummy values only — real values
// win via ??=, and nothing here is a secret.
if (hasRealDb) {
  process.env.CORS_ORIGIN ??= 'http://localhost:5173';
  process.env.WORKOS_API_KEY ??= 'test-workos-api-key';
  process.env.WORKOS_CLIENT_ID ??= 'test-workos-client-id';
  process.env.PORT ??= '8888';
}

const pipeline = await importWithRealDb(async () => {
  const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
  const { charactersRoutes } = await import('../characters.js');
  const { restRoutes } = await import('../rest.js');
  const { issue1784DataRoutes } = await import('../issue-1784-data.js');
  const { llmRoutes } = await import('../llm.js');
  return createRequestPipelineApp()
    .use(charactersRoutes)
    .use(restRoutes)
    .use(issue1784DataRoutes)
    .use(llmRoutes);
});

// #712: the paladin pool services, imported lazily so the no-database run that
// degrades every describeWithDb block to skip never loads db/client.
const { layOnHandsPool } = await importWithRealDb(
  () => import('../../../services/progression/paladin-features-service.js'),
);

if (!hasRealDb) {
  console.warn(
    '[sheet-feature-rest] SKIPPED: set TEST_DATABASE_URL to a scratch Postgres to run these.',
  );
}

const authHeaders = {
  authorization: 'Bearer test-token',
  'content-type': 'application/json',
};

describeWithDb('paladin Lay on Hands llm.ts wiring (#712)', () => {
  // Fresh client per block: earlier blocks close the shared one in afterAll.
  let db: ReturnType<typeof realDb>;
  const paladinUserId = testId('712-user');

  let campaignId: string;
  let sessionId: string;
  let encounterId: string;
  let paladinId: string;
  let participantId: string;

  const request = (path: string, method: string, body?: unknown): Promise<Response> =>
    pipeline.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: authHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );

  /** The SRD seed shape: limited_use features with a NULL uses_count (#224). */
  const ensureLibraryRow = async (featureName: string): Promise<string> => {
    const existing = await db
      .select({ id: classFeaturesLibrary.id })
      .from(classFeaturesLibrary)
      .where(
        and(
          eq(classFeaturesLibrary.className, 'Paladin'),
          eq(classFeaturesLibrary.featureName, featureName),
        ),
      )
      .limit(1);
    if (existing.length > 0) return existing[0].id;
    const [row] = await db
      .insert(classFeaturesLibrary)
      .values({
        className: 'Paladin',
        featureName,
        levelAcquired: 1,
        description: 'test',
        usageType: 'action',
        usesPerRest: 'long_rest',
        usesCount: null,
      })
      .returning({ id: classFeaturesLibrary.id });
    return row.id;
  };

  beforeAll(async () => {
    if (!hasRealDb) return;
    db = realDb();
    userId = paladinUserId;

    await ensureLibraryRow('Lay on Hands');
    await ensureLibraryRow('Divine Sense');

    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId: paladinUserId, name: testId('712-camp') })
      .returning({ id: campaigns.id });

    // The QA character: a level-1 paladin with CHA 8 (Divine Sense: max(1, 1-1) = 1).
    [{ id: paladinId }] = await db
      .insert(characters)
      .values({
        userId: paladinUserId,
        campaignId,
        name: testId('712-paladin'),
        class: 'Paladin',
        level: 1,
      })
      .returning({ id: characters.id });

    await db.insert(characterStats).values({
      characterId: paladinId,
      charisma: 8,
      maxHitPoints: 12,
      currentHitPoints: 7,
      temporaryHitPoints: 0,
      isConscious: true,
      vitalState: 'standing',
    });

    [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId: paladinId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });

    [{ id: encounterId }] = await db
      .insert(combatEncounters)
      .values({ sessionId, status: 'active', currentRound: 1, currentTurnOrder: 0, version: 1 })
      .returning({ id: combatEncounters.id });

    [{ id: participantId }] = await db
      .insert(combatParticipants)
      .values({
        encounterId,
        characterId: paladinId,
        name: 'Test Paladin',
        participantType: 'player',
        turnOrder: 0,
        initiative: 10,
        maxHp: 12,
      })
      .returning({ id: combatParticipants.id });

    await db.insert(combatParticipantStatus).values({
      participantId,
      currentHp: 7,
      maxHp: 12,
      isConscious: true,
    });
  });

  afterAll(async () => {
    await closeRealDb();
  });

  it('the llm.ts wiring spends on an ordinary story turn, not on a combat-opening turn (#712)', async () => {
    // Self-contained: a fresh paladin and session owned by the current auth
    // user, so there is no userId swap and no shared-encounter state. A fresh
    // session has no encounter, which is what an ordinary story turn looks
    // like — the combat Lay on Hands path cannot steal the spend. (Round 5:
    // the first version of this test reused the block's shared fixtures and
    // CI's server-real-db job died in the shared process with a
    // dialogue_history lock timeout before this file's invocation ran; the
    // self-contained rewrite removes the test as a suspect.)
    const owner = userId;
    const [{ id: routeCampaignId }] = await db
      .insert(campaigns)
      .values({ userId: owner, name: testId('712-route-camp') })
      .returning({ id: campaigns.id });
    const [{ id: routePaladinId }] = await db
      .insert(characters)
      .values({
        userId: owner,
        campaignId: routeCampaignId,
        name: testId('712-route-pal'),
        class: 'Paladin',
        level: 1,
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId: routePaladinId,
      charisma: 10,
      maxHitPoints: 12,
      currentHitPoints: 7,
      temporaryHitPoints: 0,
      isConscious: true,
      vitalState: 'standing',
    });
    const [{ id: routeSessionId }] = await db
      .insert(gameSessions)
      .values({
        campaignId: routeCampaignId,
        characterId: routePaladinId,
        sessionNumber: 1,
        status: 'active',
      })
      .returning({ id: gameSessions.id });
    const routeLayOnHandsId = await ensureLibraryRow('Lay on Hands');
    // Lazily create the pool row, then reset to full pool / missing 5 HP.
    await layOnHandsPool(routePaladinId, owner);
    const reset = async () => {
      await db
        .update(characterFeatures)
        .set({ usesRemaining: 5 })
        .where(
          and(
            eq(characterFeatures.characterId, routePaladinId),
            eq(characterFeatures.featureId, routeLayOnHandsId),
          ),
        );
      await db
        .update(characterStats)
        .set({ currentHitPoints: 7 })
        .where(eq(characterStats.characterId, routePaladinId));
    };
    const logCount = async (): Promise<number> =>
      (
        await db
          .select({ id: featureUsageLog.id })
          .from(featureUsageLog)
          .where(
            and(
              eq(featureUsageLog.characterId, routePaladinId),
              eq(featureUsageLog.featureId, routeLayOnHandsId),
              eq(featureUsageLog.sessionId, routeSessionId),
            ),
          )
      ).length;
    const hp = async (): Promise<number | null> =>
      (
        await db
          .select({ currentHitPoints: characterStats.currentHitPoints })
          .from(characterStats)
          .where(eq(characterStats.characterId, routePaladinId))
          .limit(1)
      )[0]?.currentHitPoints ?? null;
    const pool = async (): Promise<number | null> =>
      (
        await db
          .select({ usesRemaining: characterFeatures.usesRemaining })
          .from(characterFeatures)
          .where(
            and(
              eq(characterFeatures.characterId, routePaladinId),
              eq(characterFeatures.featureId, routeLayOnHandsId),
            ),
          )
          .limit(1)
      )[0]?.usesRemaining ?? null;

    const playerInput = 'I use Lay on Hands to heal myself for 3 hit points';
    await reset();
    await db.insert(dialogueHistory).values({
      sessionId: routeSessionId,
      speakerType: 'player',
      speakerId: routePaladinId,
      message: playerInput,
    });
    const logsBefore = await logCount();

    // Ordinary story turn: combatEntry present (combat not active), no
    // combat_entry_pending. The body shape mirrors the #264 route test.
    generatedText = JSON.stringify({
      text: 'Warmth spreads through your wounds as you lay on hands.',
    });
    const res = await request('/v1/llm/generate', 'POST', {
      prompt: 'The paladin tends their wounds. What happens?',
      player_input: playerInput,
      sessionId: routeSessionId,
      dmReply: { messageId: '22222222-3333-4444-8555-666666666666', inCombat: false },
      combatEntry: {
        sessionId: routeSessionId,
        player: { name: 'Test Paladin', initiativeModifier: 2 },
      },
      provider: 'openrouter',
      requestType: 'user',
      maxTokens: 8192,
      temperature: 0.9,
    });
    expect(res.status).toBe(200);

    // The llm.ts condition ran the spend: one heal and one pool draw.
    expect(await hp()).toBe(10);
    expect(await pool()).toBe(2);
    expect((await logCount()) - logsBefore).toBe(1);

    // A turn that opens combat: the envelope carries combat_entry_pending,
    // so the same declaration spends nothing. Fresh message so the
    // once-per-message guard is not what blocks it.
    await reset();
    await db.insert(dialogueHistory).values({
      sessionId: routeSessionId,
      speakerType: 'player',
      speakerId: routePaladinId,
      message: playerInput,
    });
    const logsBeforeEntry = await logCount();
    generatedText = JSON.stringify({
      text: 'A goblin bursts from the treeline!',
      combat_entry_pending: { encounterId: '33333333-4444-5555-8666-777777777777' },
    });
    const res2 = await request('/v1/llm/generate', 'POST', {
      prompt: 'The paladin tends their wounds. What happens?',
      player_input: playerInput,
      sessionId: routeSessionId,
      dmReply: { messageId: '44444444-5555-6666-8777-888888888888', inCombat: false },
      combatEntry: {
        sessionId: routeSessionId,
        player: { name: 'Test Paladin', initiativeModifier: 2 },
      },
      provider: 'openrouter',
      requestType: 'user',
      maxTokens: 8192,
      temperature: 0.9,
    });
    expect(res2.status).toBe(200);
    expect(await hp()).toBe(7);
    expect(await pool()).toBe(5);
    expect((await logCount()) - logsBeforeEntry).toBe(0);
  });
});
