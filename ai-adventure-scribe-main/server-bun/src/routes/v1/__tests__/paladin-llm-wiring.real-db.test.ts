/**
 * #712: llm.ts wiring for Lay on Hands.
 *
 * The module mocks below (auth, logger, admin, rate-limit, ai-usage,
 * llm-provider, session-message) are file-scope by necessity: the route
 * resolves its collaborators at module load, so the stubs must be
 * registered before the pipeline imports it. They cannot leak into other
 * suites — the server-real-db runner (scripts/ci/run-real-db-suites.mjs)
 * spawns one bun process per test file. The other real-db files that mount
 * the same llm pipeline and import these collaborators for real —
 * sheet-feature-rest.real-db.test.ts, dm-place-without-id.real-db.test.ts,
 * playthrough-scope.real-db.test.ts, and
 * services/__tests__/dm-reply-reconcile.real-db.test.ts — pass alongside
 * this file in the same CI run (39390253942, server-real-db job).
 */
import { afterAll, beforeAll, expect, it, mock } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { Elysia } from 'elysia';

import {
  campaigns,
  characterEquipment,
  characterFeatures,
  characterHitDice,
  characterSpellSlots,
  characterStats,
  characters,
  classFeaturesLibrary,
  combatEncounters,
  combatParticipantStatus,
  combatParticipants,
  dialogueHistory,
  featureUsageLog,
  gameSessions,
  restEvents,
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
// #975: prompts handed to the stubbed provider, and an optional hook the
// stub runs on each generate call (see the provider stub below).
let generatePrompts: string[] = [];
let beforeGenerate: (() => Promise<void>) | null = null;
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
    generate: async (args: { prompt: string }) => {
      // #975: the Second Wind wiring block asserts on the prompt the route
      // actually hands the provider (the directive rides in it). The hook
      // lets that block snapshot the world at generation time — the
      // resolver healed pre-generation, the reply persists post-generation.
      if (beforeGenerate) await beforeGenerate();
      generatePrompts.push(args.prompt);
      return {
        text: generatedText,
        provider: 'openrouter',
        model: 'test/model',
      };
    },
  },
}));
// #751: engine chat lines (postEngineChatLine) write through
// SessionMessageService.addMessages. The default below is a no-op; the
// typed-long-rest block installs a real dialogue_history writer so the
// line the player would see is what its assertions read.
let addMessagesImpl: (messages: unknown, userId: string) => Promise<unknown[]> = async () => [];

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
    addMessages: (messages: unknown, userId: string) => addMessagesImpl(messages, userId),
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
const { CombatEncounterService } = await importWithRealDb(
  () => import('../../../services/combat/combat-encounter-service.js'),
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

  it('seats SRD creature types and refuses skeleton healing without spending, but heals a goblin (#746)', async () => {
    const [{ id: freshSession }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId: paladinId, sessionNumber: 9, status: 'active' })
      .returning({ id: gameSessions.id });
    const state = await CombatEncounterService.startCombat(
      freshSession,
      [
        {
          encounterId: '',
          characterId: paladinId,
          name: 'Test Paladin',
          initiativeModifier: 0,
          initiativeRoll: 20,
        },
        {
          encounterId: '',
          monsterId: 'srd:skeleton',
          name: 'Skeleton',
          initiativeModifier: 0,
          initiativeRoll: 1,
        },
        {
          encounterId: '',
          monsterId: 'srd:goblin',
          name: 'Goblin',
          initiativeModifier: 0,
          initiativeRoll: 1,
        },
        {
          encounterId: '',
          monsterId: 'srd:stone-golem',
          name: 'Stone Golem',
          initiativeModifier: 0,
          initiativeRoll: 1,
        },
      ],
      false,
      userId,
    );
    const skeleton = state.participants.find((p) => p.name === 'Skeleton')!;
    const goblin = state.participants.find((p) => p.name === 'Goblin')!;
    const golem = state.participants.find((p) => p.name === 'Stone Golem')!;
    expect(skeleton.creatureType).toBe('undead');
    expect(goblin.creatureType).toBe('humanoid');
    expect(golem.creatureType).toBe('construct');
    await db
      .update(combatParticipantStatus)
      .set({ currentHp: 1 })
      .where(eq(combatParticipantStatus.participantId, goblin.id));
    const poolBefore = (await layOnHandsPool(paladinId, userId))!.remaining;
    const generate = async (target: string, messageId: string) => {
      const input = `I use Lay on Hands on ${target} for 1`;
      await db.insert(dialogueHistory).values({
        sessionId: freshSession,
        speakerType: 'player',
        speakerId: paladinId,
        message: input,
      });
      generatePrompts = [];
      generatedText = JSON.stringify({ text: 'The scene continues.' });
      const response = await request('/v1/llm/generate', 'POST', {
        prompt: input,
        player_input: input,
        sessionId: freshSession,
        dmReply: { messageId, inCombat: true },
        provider: 'openrouter',
        requestType: 'user',
        maxTokens: 8192,
        temperature: 0.9,
      });
      expect(response.status).toBe(200);
      return generatePrompts.join('\n');
    };
    expect(await generate('Skeleton', '11111111-2222-4333-8444-555555555111')).toContain(
      'no effect on undead or constructs',
    );
    expect((await layOnHandsPool(paladinId, userId))!.remaining).toBe(poolBefore);
    expect(await generate('Stone Golem', '11111111-2222-4333-8444-555555555113')).toContain(
      'no effect on undead or constructs',
    );
    expect((await layOnHandsPool(paladinId, userId))!.remaining).toBe(poolBefore);
    expect(await generate('Goblin', '11111111-2222-4333-8444-555555555112')).toContain(
      'restores 1 HP',
    );
    expect((await layOnHandsPool(paladinId, userId))!.remaining).toBe(poolBefore - 1);
    const [goblinStatus] = await db
      .select({ hp: combatParticipantStatus.currentHp })
      .from(combatParticipantStatus)
      .where(eq(combatParticipantStatus.participantId, goblin.id));
    expect(goblinStatus.hp).toBe(2);
  });

  it('the llm.ts wiring spends on an ordinary story turn, not on a combat-opening turn (#712)', async () => {
    // Self-contained: a fresh paladin and session owned by the current auth
    // user, so there is no userId swap and no shared-encounter state. A fresh
    // session has no encounter, which is what an ordinary story turn looks
    // like — the combat Lay on Hands path cannot steal the spend.
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

/**
 * #712: Divine Sense through the DM route. The service-level test
 * (paladin-divine-sense.real-db.test.ts) proves spendDivineSense decrements
 * the pool; this block proves the typed story turn does: the DM feature gate
 * claims "I use Divine Sense", the story spend decrements the
 * character_features row, and the spend lands on the sheet — the
 * characters.classFeatures JSON the sheet's ClassFeatureTracker overlays —
 * so the sheet shows the use. A second identical turn spends nothing more.
 */
describeWithDb('paladin Divine Sense story-turn spend through the DM route (#712)', () => {
  let db: ReturnType<typeof realDb>;
  const senseUserId = testId('712-sense-user');

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
    userId = senseUserId;
    await ensureLibraryRow('Divine Sense');
  });

  afterAll(async () => {
    await closeRealDb();
  });

  it('a typed Divine Sense on an ordinary story turn spends one use and lands on the sheet', async () => {
    // Self-contained: a fresh paladin and session owned by the current auth
    // user. CHA 8, so the pool is max(1, 1 + CHA mod) = 1 use — the QA
    // character from the issue (Hark D5-015). A fresh session has no
    // encounter, which is what an ordinary story turn looks like.
    const owner = userId;
    const [{ id: routeCampaignId }] = await db
      .insert(campaigns)
      .values({ userId: owner, name: testId('712-sense-camp') })
      .returning({ id: campaigns.id });
    const [{ id: routePaladinId }] = await db
      .insert(characters)
      .values({
        userId: owner,
        campaignId: routeCampaignId,
        name: testId('712-sense-pal'),
        class: 'Paladin',
        level: 1,
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId: routePaladinId,
      charisma: 8,
      maxHitPoints: 12,
      currentHitPoints: 12,
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
    const senseFeatureId = await ensureLibraryRow('Divine Sense');

    const poolRow = async (): Promise<number | null> =>
      (
        await db
          .select({ usesRemaining: characterFeatures.usesRemaining })
          .from(characterFeatures)
          .where(
            and(
              eq(characterFeatures.characterId, routePaladinId),
              eq(characterFeatures.featureId, senseFeatureId),
            ),
          )
          .limit(1)
      )[0]?.usesRemaining ?? null;
    const logCount = async (): Promise<number> =>
      (
        await db
          .select({ id: featureUsageLog.id })
          .from(featureUsageLog)
          .where(
            and(
              eq(featureUsageLog.characterId, routePaladinId),
              eq(featureUsageLog.featureId, senseFeatureId),
              eq(featureUsageLog.sessionId, routeSessionId),
            ),
          )
      ).length;
    const sheetEntry = async (): Promise<unknown> => {
      const [row] = await db
        .select({ classFeatures: characters.classFeatures })
        .from(characters)
        .where(eq(characters.id, routePaladinId))
        .limit(1);
      const sheet = (row?.classFeatures ?? {}) as Record<string, unknown>;
      return sheet['divine_sense'];
    };

    // No pool row exists before the first use: the pool initializes lazily.
    expect(await poolRow()).toBeNull();
    expect(await sheetEntry()).toBeUndefined();

    const playerInput = 'I use Divine Sense to scan the room.';
    const postTurn = async (messageId: string) => {
      await db.insert(dialogueHistory).values({
        sessionId: routeSessionId,
        speakerType: 'player',
        speakerId: routePaladinId,
        message: playerInput,
      });
      generatedText = JSON.stringify({
        text: 'You sense a faint undead presence nearby.',
      });
      return request('/v1/llm/generate', 'POST', {
        prompt: 'The paladin opens their awareness. What happens?',
        player_input: playerInput,
        sessionId: routeSessionId,
        dmReply: { messageId, inCombat: false },
        combatEntry: {
          sessionId: routeSessionId,
          player: { name: 'Test Paladin', initiativeModifier: 2 },
        },
        provider: 'openrouter',
        requestType: 'user',
        maxTokens: 8192,
        temperature: 0.9,
      });
    };

    const res = await postTurn('55555555-6666-7777-8888-999999999999');
    expect(res.status).toBe(200);
    // One use spent: the pool row initializes to 1 (CHA 8) and decrements
    // to 0, one usage-log row lands, and the sheet JSON carries the use.
    expect(await poolRow()).toBe(0);
    expect(await logCount()).toBe(1);
    expect(await sheetEntry()).toEqual({ maxUses: 1, currentUses: 0 });

    // A second identical story turn spends nothing more: the pool is empty,
    // so no second log row and the sheet entry is unchanged.
    const res2 = await postTurn('66666666-7777-8888-9999-000000000000');
    expect(res2.status).toBe(200);
    expect(await poolRow()).toBe(0);
    expect(await logCount()).toBe(1);
    expect(await sheetEntry()).toEqual({ maxUses: 1, currentUses: 0 });
  });
});

/**
 * #751 (live-failing): a typed long rest through the DM route. The #990 pin
 * proved applyStoryRest applies a typed rest when called directly; the live
 * failure is here, on the route: the rest applied but NO engine line ever
 * reached chat, because the story-rest applier posted the line only for
 * short rests. These tests drive POST /v1/llm/generate with the stubbed
 * provider returning narration and NO `rest` of its own — the player's
 * typed words are the only rest signal — and assert the engine line lands
 * in dialogue_history and the rest's effects land on the sheet.
 */
describeWithDb('typed long rest through the DM route posts its engine line (#751)', () => {
  let db: ReturnType<typeof realDb>;
  const restUserId = testId('751-user');

  const request = (path: string, method: string, body?: unknown): Promise<Response> =>
    pipeline.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: authHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );

  interface RestWorld {
    characterId: string;
    sessionId: string;
  }

  const seedWorld = async (
    label: string,
    shape: { className: string; maxHp: number; hp: number; usedSlots: number; hitDiceUsed: number },
  ): Promise<RestWorld> => {
    const [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId: restUserId, name: testId(`${label}-camp`) })
      .returning({ id: campaigns.id });
    const [{ id: characterId }] = await db
      .insert(characters)
      .values({
        userId: restUserId,
        campaignId,
        name: testId(label),
        class: shape.className,
        level: 3,
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId,
      maxHitPoints: shape.maxHp,
      currentHitPoints: shape.hp,
      temporaryHitPoints: 0,
      isConscious: true,
      vitalState: 'standing',
    });
    await db.insert(characterHitDice).values({
      characterId,
      className: shape.className,
      dieType: 'd8',
      totalDice: 3,
      usedDice: shape.hitDiceUsed,
    });
    if (shape.usedSlots > 0) {
      await db.insert(characterSpellSlots).values({
        characterId,
        spellLevel: 1,
        totalSlots: 4,
        usedSlots: shape.usedSlots,
      });
    }
    const [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });
    return { characterId, sessionId };
  };

  const engineLines = async (sessionId: string): Promise<string[]> =>
    (
      await db
        .select({ message: dialogueHistory.message })
        .from(dialogueHistory)
        .where(
          and(
            eq(dialogueHistory.sessionId, sessionId),
            eq(dialogueHistory.speakerType, 'system'),
          ),
        )
    )
      .map((row) => row.message)
      .filter((message) => message.startsWith('⚙️ Engine: Long rest'));

  const hpOf = async (characterId: string): Promise<number | null> =>
    (
      await db
        .select({ hp: characterStats.currentHitPoints })
        .from(characterStats)
        .where(eq(characterStats.characterId, characterId))
        .limit(1)
    )[0]?.hp ?? null;

  const usedSlotsOf = async (characterId: string): Promise<number> =>
    (
      await db
        .select({ used: characterSpellSlots.usedSlots })
        .from(characterSpellSlots)
        .where(eq(characterSpellSlots.characterId, characterId))
    ).reduce((sum, row) => sum + row.used, 0);

  const generateTurn = async (world: RestWorld, playerInput: string, messageId: string) => {
    generatedText = JSON.stringify({
      text: 'You settle in for the night and let the road weariness go.',
    });
    return request('/v1/llm/generate', 'POST', {
      prompt: 'The party makes camp for the night. What happens?',
      player_input: playerInput,
      sessionId: world.sessionId,
      dmReply: { messageId, inCombat: false },
      combatEntry: {
        sessionId: world.sessionId,
        player: { name: 'Camper', initiativeModifier: 1 },
      },
      provider: 'openrouter',
      requestType: 'user',
      maxTokens: 8192,
      temperature: 0.9,
    });
  };

  const typeMessage = async (world: RestWorld, text: string) => {
    await db.insert(dialogueHistory).values({
      sessionId: world.sessionId,
      speakerType: 'player',
      speakerId: world.characterId,
      message: text,
    });
  };

  beforeAll(async () => {
    db = realDb();
    userId = restUserId;
    // Engine lines write through SessionMessageService.addMessages; give
    // the file-scope stub a real dialogue_history writer (the same rows
    // the real service persists: deterministic id, on-conflict-do-nothing).
    addMessagesImpl = async (messages: unknown) => {
      const inserted: unknown[] = [];
      for (const entry of messages as Array<Record<string, unknown>>) {
        const [row] = await db
          .insert(dialogueHistory)
          .values({
            id: entry.id as string,
            sessionId: entry.sessionId as string,
            speakerType: entry.speakerType as string,
            message: entry.message as string,
            context: (entry.context ?? null) as never,
          })
          .onConflictDoNothing()
          .returning();
        if (row) inserted.push(row);
      }
      return inserted;
    };
  });

  afterAll(async () => {
    addMessagesImpl = async () => [];
    await closeRealDb();
  });

  it('at full HP the typed long rest posts the (nothing to restore) engine line', async () => {
    // Hark's retest shape: Garrick at 12/12, out of combat, typed rest.
    const world = await seedWorld('751-full', {
      className: 'Fighter',
      maxHp: 12,
      hp: 12,
      usedSlots: 0,
      hitDiceUsed: 0,
    });
    await typeMessage(world, 'we take a long rest');

    const res = await generateTurn(world, 'we take a long rest', '75175175-1111-4222-8333-444444444444');
    expect(res.status).toBe(200);

    const lines = await engineLines(world.sessionId);
    expect(lines).toEqual(['⚙️ Engine: Long rest — HP and spell slots restored (nothing to restore)']);
    // The rest really applied: one long-rest event is on the ledger, and it
    // is the finished row (the claim stamps hpRestored 0 too, so the proof
    // is the finish-written resource list replacing the claim's '[]').
    const events = await db
      .select({ id: restEvents.id, resourcesRestored: restEvents.resourcesRestored })
      .from(restEvents)
      .where(
        and(eq(restEvents.characterId, world.characterId), eq(restEvents.restType, 'long')),
      );
    expect(events).toHaveLength(1);
    expect(events[0]?.resourcesRestored).not.toBe('[]');
    expect(await hpOf(world.characterId)).toBe(12);
  });

  it('a wounded caster: the line reports the heal and the slot restore, and both land', async () => {
    const world = await seedWorld('751-hurt', {
      className: 'Cleric',
      maxHp: 20,
      hp: 5,
      usedSlots: 2,
      hitDiceUsed: 1,
    });
    await typeMessage(world, 'I take a long rest');

    const res = await generateTurn(world, 'I take a long rest', '75175175-2222-4333-8444-555555555555');
    expect(res.status).toBe(200);

    // Exact line: 15 HP (5 -> 20), slots were spent and restored, and the
    // one spent hit die is regained (floor(3/2) = 1, capped by the 1 used).
    expect(await engineLines(world.sessionId)).toEqual([
      '⚙️ Engine: Long rest — 15 HP restored, spell slots restored, 1 hit dice regained.',
    ]);
    expect(await hpOf(world.characterId)).toBe(20);
    expect(await usedSlotsOf(world.characterId)).toBe(0);
    const [dice] = await db
      .select({ used: characterHitDice.usedDice })
      .from(characterHitDice)
      .where(eq(characterHitDice.characterId, world.characterId));
    expect(dice?.used).toBe(0);
  });

  it('a retried turn re-posts nothing twice: one rest, one line', async () => {
    const world = await seedWorld('751-retry', {
      className: 'Fighter',
      maxHp: 12,
      hp: 4,
      usedSlots: 0,
      hitDiceUsed: 0,
    });
    await typeMessage(world, 'we take a long rest');

    const first = await generateTurn(world, 'we take a long rest', '75175175-3333-4444-8555-666666666666');
    expect(first.status).toBe(200);
    const second = await generateTurn(world, 'we take a long rest', '75175175-3333-4444-8555-666666666666');
    expect(second.status).toBe(200);

    expect(await engineLines(world.sessionId)).toHaveLength(1);
    const events = await db
      .select({ id: restEvents.id })
      .from(restEvents)
      .where(
        and(eq(restEvents.characterId, world.characterId), eq(restEvents.restType, 'long')),
      );
    expect(events).toHaveLength(1);
    expect(await hpOf(world.characterId)).toBe(12);
  });
});

/**
 * #975 FIX round (strategist 6347116450, Required 1): the ROUTE-level test.
 * The resolver suite (encounter-lifecycle.real-db.test.ts) drives
 * `resolveCombatSecondWind` directly, so nothing pinned the llm.ts wiring:
 * the dmReply gate, the defenseSessionId the resolver is handed, or the
 * directive reaching the provider prompt. This block drives
 * POST /v1/llm/generate end to end — real route, real resolver, real
 * intent, real database; only the provider is stubbed (file scope above) —
 * with the same encounter shape the resolver suite seeds: an L1 Fighter at
 * 1/12 HP in an active encounter, hero holding the turn.
 *
 * On main this fails: main's llm.ts has no Second Wind wiring, so no heal
 * lands and no <second_wind> directive reaches the captured prompt.
 *
 * The generate bodies carry NO combatEntry: the real client builds one
 * only for turns that are not yet in combat (ai-service.ts), so an
 * in-combat turn's wire body is top-level sessionId + dmReply alone —
 * which is also what pins the route's sessionId-sourced defenseSessionId
 * hand-off to the resolver.
 */
describeWithDb('typed Second Wind through the DM generate route (#975)', () => {
  let db: ReturnType<typeof realDb>;
  const swUserId = testId('975-user');

  const SW_MAX_HP = 12;

  const request = (path: string, method: string, body?: unknown): Promise<Response> =>
    pipeline.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: authHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );

  interface FighterWorld {
    characterId: string;
    sessionId: string;
    participantId: string;
    featureId: string;
  }

  /** The migration seed shape: bonus_action, short_rest, 1 use. */
  const ensureSecondWindRow = async (): Promise<string> => {
    const existing = await db
      .select({ id: classFeaturesLibrary.id })
      .from(classFeaturesLibrary)
      .where(
        and(
          eq(classFeaturesLibrary.className, 'Fighter'),
          eq(classFeaturesLibrary.featureName, 'Second Wind'),
        ),
      )
      .limit(1);
    if (existing.length > 0) return existing[0].id;
    const [row] = await db
      .insert(classFeaturesLibrary)
      .values({
        className: 'Fighter',
        featureName: 'Second Wind',
        levelAcquired: 1,
        description: 'test',
        usageType: 'bonus_action',
        usesPerRest: 'short_rest',
        usesCount: 1,
      })
      .returning({ id: classFeaturesLibrary.id });
    return row.id;
  };

  const seedFighterWorld = async (label: string): Promise<FighterWorld> => {
    const featureId = await ensureSecondWindRow();
    const [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId: swUserId, name: testId(`${label}-camp`) })
      .returning({ id: campaigns.id });
    const [{ id: characterId }] = await db
      .insert(characters)
      .values({
        userId: swUserId,
        campaignId,
        name: testId(label),
        level: 1,
        class: 'Fighter',
        classLevels: [{ className: 'Fighter', level: 1 }],
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId,
      strength: 16,
      armorClass: 15,
      maxHitPoints: SW_MAX_HP,
      currentHitPoints: SW_MAX_HP,
      speed: 30,
    });
    await db.insert(characterFeatures).values({
      characterId,
      featureId,
      usesRemaining: 1,
      isActive: true,
      acquiredAtLevel: 1,
    });
    const [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });
    const [{ id: encounterId }] = await db
      .insert(combatEncounters)
      .values({ sessionId, status: 'active', currentRound: 1, currentTurnOrder: 0, version: 1 })
      .returning({ id: combatEncounters.id });
    const inserted = await db
      .insert(combatParticipants)
      .values([
        {
          encounterId,
          characterId,
          name: 'Route Fighter',
          participantType: 'player',
          turnOrder: 0,
          initiative: 20,
          armorClass: 15,
          maxHp: SW_MAX_HP,
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
    const participantId = inserted.find((row) => row.turnOrder === 0)!.id;
    const monsterId = inserted.find((row) => row.turnOrder === 1)!.id;
    await db.insert(combatParticipantStatus).values([
      { participantId, currentHp: 1, maxHp: SW_MAX_HP, isConscious: true },
      { participantId: monsterId, currentHp: 200, maxHp: 200, isConscious: true },
    ]);
    // The saved player message the resolver reads the declaration back
    // from (the retry guard keys on it), exactly as the client saves the
    // line before the generate call.
    await db.insert(dialogueHistory).values({
      sessionId,
      speakerType: 'player',
      speakerId: characterId,
      message: 'I use Second Wind',
    });
    return { characterId, sessionId, participantId, featureId };
  };

  const heroHp = async (world: FighterWorld): Promise<number> =>
    (
      await db
        .select({ hp: combatParticipantStatus.currentHp })
        .from(combatParticipantStatus)
        .where(eq(combatParticipantStatus.participantId, world.participantId))
    )[0].hp;

  const usesRemaining = async (world: FighterWorld): Promise<number | null> =>
    (
      await db
        .select({ uses: characterFeatures.usesRemaining })
        .from(characterFeatures)
        .where(
          and(
            eq(characterFeatures.characterId, world.characterId),
            eq(characterFeatures.featureId, world.featureId),
          ),
        )
    )[0]?.uses ?? null;

  const generateSecondWindTurn = async (world: FighterWorld): Promise<Response> => {
    generatedText = JSON.stringify({
      text: 'The fighter steadies, breath returning in a rush.',
    });
    return request('/v1/llm/generate', 'POST', {
      prompt: 'The golem looms over the wounded fighter. What happens?',
      player_input: 'I use Second Wind',
      sessionId: world.sessionId,
      dmReply: { messageId: '97597597-1111-4222-8333-444444444444', inCombat: true },
      provider: 'openrouter',
      requestType: 'user',
      maxTokens: 8192,
      temperature: 0.9,
    });
  };

  beforeAll(async () => {
    db = realDb();
    userId = swUserId;
  });

  afterAll(async () => {
    await closeRealDb();
  });

  it('heals through the real route and the directive reaches the provider prompt', async () => {
    const world = await seedFighterWorld('975-route');
    expect(await heroHp(world)).toBe(1);
    expect(await usesRemaining(world)).toBe(1);

    generatePrompts = [];
    const res = await generateSecondWindTurn(world);
    expect(res.status).toBe(200);

    // The heal landed through the route, not just the resolver: the
    // participant is healed in range (1d10 + 1 at L1, capped at max HP;
    // seeded at 1/12 so the whole range is reachable) and the sheet use
    // is spent.
    const hpAfter = await heroHp(world);
    const healed = hpAfter - 1;
    expect(healed).toBeGreaterThanOrEqual(2);
    expect(healed).toBeLessThanOrEqual(11);
    expect(hpAfter).toBeLessThanOrEqual(SW_MAX_HP);
    expect(await usesRemaining(world)).toBe(0);

    // The directive reached the prompt the provider was actually given,
    // carrying the engine's own numbers.
    expect(generatePrompts.length).toBeGreaterThan(0);
    const promptSent = generatePrompts.join('\n');
    expect(promptSent).toContain('<second_wind>');
    expect(promptSent).toContain(`regained ${healed} HP`);
    expect(promptSent).toContain(`(now ${hpAfter}/${SW_MAX_HP})`);
  }, 30_000);

  it('without the dmReply gate the route resolves nothing (narration regen shape)', async () => {
    // The resolver runs pre-generation in llm.ts, gated on dmReply:
    // narration regens carry none, and resolving there would spend the
    // use twice. This test sends the regen shape (same words, same
    // session state, no dmReply) for `control`, and — from inside that
    // request's own provider call, via the beforeGenerate hook — runs a
    // second, dmReply-carrying turn for a twin world seeded identically.
    // The hook fires after the regen request's resolver step would have
    // run (the resolver is pre-generation), so control's HP read inside
    // the hook proves the ungated resolution never happened; the twin's
    // heal in the same window proves the harness could have seen one.
    const control = await seedFighterWorld('975-control');
    expect(await heroHp(control)).toBe(1);

    let twinStatus: number | undefined;
    let twinHp: number | undefined;
    let controlHpInside: number | undefined;
    let twinPromptCount = 0;
    beforeGenerate = async () => {
      // One-shot: clear BEFORE the nested turn, whose own provider call
      // would otherwise re-enter this hook and recurse without bound.
      beforeGenerate = null;
      const twin = await seedFighterWorld('975-gated');
      const resTwin = await generateSecondWindTurn(twin);
      twinStatus = resTwin.status;
      twinHp = await heroHp(twin);
      controlHpInside = await heroHp(control);
      // The stub pushes a prompt only after this hook returns, so every
      // prompt recorded so far belongs to the twin's turn; the prompts
      // recorded from here on belong to the regen-shaped request itself.
      twinPromptCount = generatePrompts.length;
    };
    generatePrompts = [];
    generatedText = JSON.stringify({
      text: 'The fighter steadies, breath returning in a rush.',
    });
    try {
      const res = await request('/v1/llm/generate', 'POST', {
        prompt: 'The golem looms over the wounded fighter. What happens?',
        player_input: 'I use Second Wind',
        sessionId: control.sessionId,
        provider: 'openrouter',
        requestType: 'user',
        maxTokens: 8192,
        temperature: 0.9,
      });
      expect(res.status).toBe(200);
    } finally {
      beforeGenerate = null;
    }

    // The twin turn healed through the gated path...
    expect(twinStatus).toBe(200);
    expect(twinHp).toBeGreaterThan(1);
    // ...while the regen-shaped request resolved nothing: not before
    // its provider call (the in-hook read), and not by the time its own
    // reply had persisted (the final reads).
    expect(controlHpInside).toBe(1);
    expect(await heroHp(control)).toBe(1);
    expect(await usesRemaining(control)).toBe(1);
    // The prompt split matches: the twin's prompts carry the directive,
    // none of the regen-shaped request's own prompts do.
    expect(generatePrompts.slice(0, twinPromptCount).join('\n')).toContain('<second_wind>');
    const ownPrompts = generatePrompts.slice(twinPromptCount);
    expect(ownPrompts.length).toBeGreaterThan(0);
    expect(ownPrompts.join('\n')).not.toContain('<second_wind>');
  }, 30_000);
});

/**
 * #1059: a typed equip in combat ("I draw my shortbow") resolves through the
 * DM generate route — the engine equips the weapon on the character_equipment
 * rows before the DM narrates, posts its engine line, and hands the provider
 * a <weapon_equip> directive carrying the truth; the next attack with that
 * weapon then resolves instead of refusing 'not equipped' (Hark N23-008).
 *
 * On main this fails: llm.ts has no equip wiring, so the shortbow row stays
 * unequipped, no directive reaches the captured prompt, and no engine line
 * is posted.
 */
describeWithDb('typed equip through the DM generate route (#1059)', () => {
  let db: ReturnType<typeof realDb>;
  const eqUserId = testId('1059-user');
  let executeCombatIntent: (
    encounterId: string,
    intent: unknown,
    userId: string,
    source: string,
  ) => Promise<{ weaponResolution?: { resolved?: string; substituted?: boolean } }>;

  const request = (path: string, method: string, body?: unknown): Promise<Response> =>
    pipeline.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: authHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );

  interface EquipWorld {
    characterId: string;
    sessionId: string;
    encounterId: string;
    heroId: string;
    foeId: string;
  }

  /** Sera Voss's shape: a rogue whose Dagger is equipped and whose Shortbow is only carried. */
  const seedEquipWorld = async (label: string): Promise<EquipWorld> => {
    const [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId: eqUserId, name: testId(`${label}-camp`) })
      .returning({ id: campaigns.id });
    const [{ id: characterId }] = await db
      .insert(characters)
      .values({
        userId: eqUserId,
        campaignId,
        name: testId(label),
        level: 1,
        class: 'Rogue',
        classLevels: [{ className: 'Rogue', level: 1 }],
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId,
      strength: 12,
      dexterity: 16,
      armorClass: 14,
      maxHitPoints: 10,
      currentHitPoints: 10,
      speed: 30,
    });
    await db.insert(characterEquipment).values([
      { characterId, itemName: 'Dagger', itemType: 'equipment', quantity: 1, equipped: true },
      { characterId, itemName: 'Shortbow', itemType: 'equipment', quantity: 1, equipped: false },
      { characterId, itemName: 'Arrows (20)', itemType: 'equipment', quantity: 1, equipped: false },
    ]);
    const [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });
    const [{ id: encounterId }] = await db
      .insert(combatEncounters)
      .values({ sessionId, status: 'active', currentRound: 1, currentTurnOrder: 0, version: 1 })
      .returning({ id: combatEncounters.id });
    const inserted = await db
      .insert(combatParticipants)
      .values([
        {
          encounterId,
          characterId,
          name: 'Sera Voss',
          participantType: 'player',
          turnOrder: 0,
          initiative: 20,
          armorClass: 14,
          maxHp: 10,
          speed: 30,
        },
        {
          encounterId,
          name: 'Training Goblin',
          participantType: 'monster',
          turnOrder: 1,
          initiative: 10,
          armorClass: 12,
          maxHp: 30,
          speed: 30,
        },
      ])
      .returning({ id: combatParticipants.id, turnOrder: combatParticipants.turnOrder });
    const heroId = inserted.find((row) => row.turnOrder === 0)!.id;
    const foeId = inserted.find((row) => row.turnOrder === 1)!.id;
    await db.insert(combatParticipantStatus).values([
      { participantId: heroId, currentHp: 10, maxHp: 10, isConscious: true },
      { participantId: foeId, currentHp: 30, maxHp: 30, isConscious: true },
    ]);
    // The saved player message, exactly as the client saves the line before
    // the generate call.
    await db.insert(dialogueHistory).values({
      sessionId,
      speakerType: 'player',
      speakerId: characterId,
      message: 'I draw my shortbow',
    });
    return { characterId, sessionId, encounterId, heroId, foeId };
  };

  const shortbowEquipped = async (world: EquipWorld): Promise<boolean> =>
    (
      await db
        .select({ equipped: characterEquipment.equipped })
        .from(characterEquipment)
        .where(
          and(
            eq(characterEquipment.characterId, world.characterId),
            eq(characterEquipment.itemName, 'Shortbow'),
          ),
        )
    )[0]?.equipped ?? false;

  const equipLines = async (world: EquipWorld): Promise<string[]> =>
    (
      await db
        .select({ message: dialogueHistory.message })
        .from(dialogueHistory)
        .where(
          and(
            eq(dialogueHistory.sessionId, world.sessionId),
            eq(dialogueHistory.speakerType, 'system'),
          ),
        )
    )
      .map((row) => row.message)
      .filter((message) => message.includes('equips the Shortbow'));

  const generateEquipTurn = async (
    world: EquipWorld,
    playerInput: string,
    messageId: string,
    inCombat = true,
  ): Promise<Response> => {
    generatedText = JSON.stringify({
      text: 'Sera slips the shortbow from her shoulder and nocks an arrow.',
    });
    return request('/v1/llm/generate', 'POST', {
      prompt: 'The goblin snarls and raises its scimitar. What happens?',
      player_input: playerInput,
      sessionId: world.sessionId,
      dmReply: { messageId, inCombat },
      provider: 'openrouter',
      requestType: 'user',
      maxTokens: 8192,
      temperature: 0.9,
    });
  };

  beforeAll(async () => {
    db = realDb();
    userId = eqUserId;
    const intentService = await import('../../../services/combat/combat-intent-service.ts');
    executeCombatIntent = intentService.executeCombatIntent as typeof executeCombatIntent;
    // Engine lines write through SessionMessageService.addMessages; give the
    // file-scope stub the same real dialogue_history writer the #751 block
    // installs (deterministic id, on-conflict-do-nothing).
    addMessagesImpl = async (messages: unknown) => {
      const inserted: unknown[] = [];
      for (const entry of messages as Array<Record<string, unknown>>) {
        const [row] = await db
          .insert(dialogueHistory)
          .values({
            id: entry.id as string,
            sessionId: entry.sessionId as string,
            speakerType: entry.speakerType as string,
            message: entry.message as string,
            context: (entry.context ?? null) as never,
          })
          .onConflictDoNothing()
          .returning();
        if (row) inserted.push(row);
      }
      return inserted;
    };
  });

  afterAll(async () => {
    addMessagesImpl = async () => [];
    await closeRealDb();
  });

  it('equips through the real route, posts the engine line, and the next attack resolves with the shortbow', async () => {
    const world = await seedEquipWorld('1059-route');
    expect(await shortbowEquipped(world)).toBe(false);

    generatePrompts = [];
    const res = await generateEquipTurn(world, 'I draw my shortbow', '10591059-1111-4222-8333-444444444444');
    expect(res.status).toBe(200);

    // The equip landed on the sheet rows the combat readers read.
    expect(await shortbowEquipped(world)).toBe(true);

    // The directive reached the prompt the provider was actually given.
    expect(generatePrompts.length).toBeGreaterThan(0);
    const promptSent = generatePrompts.join('\n');
    expect(promptSent).toContain('<weapon_equip>');
    expect(promptSent).toContain('Shortbow');

    // Exactly one engine line tells the table the weapon is in hand.
    expect(await equipLines(world)).toHaveLength(1);

    // And the next attack with the newly equipped weapon resolves with it.
    const outcome = await executeCombatIntent(
      world.encounterId,
      { type: 'attack', actorId: world.heroId, targetId: world.foeId, weaponId: 'Shortbow' },
      eqUserId,
      'dm',
    );
    expect(outcome.weaponResolution?.resolved).toBe('Shortbow');
    expect(outcome.weaponResolution?.substituted).toBe(false);
  }, 30_000);

  it('a retried turn equips nothing twice and posts no second line', async () => {
    const world = await seedEquipWorld('1059-retry');
    const first = await generateEquipTurn(world, 'I draw my shortbow', '10591059-2222-4333-8444-555555555555');
    expect(first.status).toBe(200);
    expect(await shortbowEquipped(world)).toBe(true);
    expect(await equipLines(world)).toHaveLength(1);

    // Retry replays the same saved player message with no new save: the
    // resolver sees the weapon already in hand and resolves nothing again.
    generatePrompts = [];
    const second = await generateEquipTurn(world, 'I draw my shortbow', '10591059-2222-4333-8444-555555555555');
    expect(second.status).toBe(200);
    expect(await equipLines(world)).toHaveLength(1);
    expect(generatePrompts.join('\n')).toContain('already equipped');
  }, 30_000);

  it('naming a weapon the character does not carry hands the DM the refusal, and nothing changes', async () => {
    const world = await seedEquipWorld('1059-refusal');
    generatePrompts = [];
    const res = await generateEquipTurn(world, 'I equip the longbow', '10591059-3333-4444-8555-666666666666');
    expect(res.status).toBe(200);
    expect(generatePrompts.join('\n')).toContain('not carrying');
    expect(await shortbowEquipped(world)).toBe(false);
    expect(await equipLines(world)).toHaveLength(0);
  }, 30_000);

  it('without the dmReply gate the route equips nothing (narration regen shape)', async () => {
    const world = await seedEquipWorld('1059-gated');
    generatedText = JSON.stringify({
      text: 'Sera slips the shortbow from her shoulder and nocks an arrow.',
    });
    const res = await request('/v1/llm/generate', 'POST', {
      prompt: 'The goblin snarls and raises its scimitar. What happens?',
      player_input: 'I draw my shortbow',
      sessionId: world.sessionId,
      provider: 'openrouter',
      requestType: 'user',
      maxTokens: 8192,
      temperature: 0.9,
    });
    expect(res.status).toBe(200);
    expect(await shortbowEquipped(world)).toBe(false);
    expect(await equipLines(world)).toHaveLength(0);
  }, 30_000);

  it('equips a typed draw on an ordinary story turn with no encounter', async () => {
    const world = await seedEquipWorld('1059-story');
    await db
      .update(combatEncounters)
      .set({ status: 'completed', endedAt: new Date(), endedReason: 'completed' })
      .where(eq(combatEncounters.id, world.encounterId));

    generatePrompts = [];
    const res = await generateEquipTurn(
      world,
      'I draw my shortbow',
      '10591059-4444-4555-8666-777777777777',
      false,
    );
    expect(res.status).toBe(200);
    expect(await shortbowEquipped(world)).toBe(true);
    expect(generatePrompts.join('\n')).toContain('<weapon_equip>');
    expect(generatePrompts.join('\n')).toContain('Shortbow');
    expect(await equipLines(world)).toHaveLength(1);
  }, 30_000);
});
