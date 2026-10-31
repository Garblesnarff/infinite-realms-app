/* eslint-disable max-lines -- one real-route fixture: seed, generate, sheet read, SQL capture. */
/**
 * #1024: story damage writes current HP with the owner filter, and the sheet
 * read (GET /v1/characters/:id) shows that HP.
 *
 * The turn is POST /v1/llm/generate. Auth and the model are spies. The damage
 * field follows dm-response-schema's storyDamageProperty ({ amount, source }).
 * The fall tests below add fallHeightFeet (#777): the server rolls from the
 * height and ignores the model amount.
 * The rest of the envelope follows the #610 producer in
 * dm-reply-reconcile.real-db.test.ts (combat_transition none, empty action
 * arrays, roll_requests []). The body follows the generate route
 * (prompt, sessionId, player_input, dmReply, combatEntry).
 *
 * A BEFORE UPDATE trigger records current_query() for this character only.
 * On main the vitals UPDATE names character_id and not the owner columns, so
 * this test fails there. The sheet number is max HP minus the claimed amount.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL on the dedicated Postgres at
 * 127.0.0.1:55432. See fixtures/real-db.ts.
 */
import { afterAll, expect, spyOn, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';

import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  realDbUrl,
  testId,
} from './fixtures/real-db.js';
import {
  campaigns,
  characterStats,
  characters,
  dialogueHistory,
  gameSessions,
} from '../../../../db/schema/index';

const DEDICATED_HOST = '127.0.0.1';
const DEDICATED_PORT = '55432';

function assertDedicated(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      '[story-damage-sheet] refusing real-DB fixtures: invalid URL; use the dedicated Postgres at 127.0.0.1:55432',
    );
  }
  const isPostgres = parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:';
  if (!isPostgres || parsed.hostname !== DEDICATED_HOST || parsed.port !== DEDICATED_PORT) {
    const target = parsed.hostname ? `${parsed.hostname}:${parsed.port || '(default)'}` : 'unknown';
    throw new Error(
      `[story-damage-sheet] refusing real-DB fixtures against ${target}; use the dedicated Postgres at 127.0.0.1:55432`,
    );
  }
}

if (hasRealDb) assertDedicated(realDbUrl);

process.env.PORT ??= '8893';
process.env.CORS_ORIGIN ??= 'http://localhost:8891';
process.env.WORKOS_API_KEY ??= 'test-workos-key';
process.env.WORKOS_CLIENT_ID ??= 'test-workos-client';
process.env.NODE_ENV ??= 'test';
if (hasRealDb && !process.env.DATABASE_URL && process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

const authModule = await importWithRealDb(() => import('../../lib/auth.js'));
const storyDamageModule = await importWithRealDb(() => import('../dm/story-damage.js'));
const { sql } = await importWithRealDb(() => import('../../lib/db.js'));
const { LLMProviderService } = await importWithRealDb(() => import('../llm-provider-service.js'));
const dmReplyPersistence = await importWithRealDb(() => import('../dm/dm-reply-persistence.js'));
const { createRequestPipelineApp } = await importWithRealDb(() => import('../../http-pipeline.js'));
const { llmRoutes } = await importWithRealDb(() => import('../../routes/v1/llm.js'));
const { charactersRoutes } = await importWithRealDb(() => import('../../routes/v1/characters.js'));

if (!hasRealDb) {
  console.warn(
    '[story-damage-sheet] SKIPPED: set TEST_DATABASE_URL to the dedicated Postgres at 127.0.0.1:55432 to run these.',
  );
}

/** Deterministic [0, 1) RNG (mulberry32) for the seeded fall rolls below. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Test oracle for the #777 roll, computed from the seed without importing the
 * production roll: 1d6 per 10 feet fallen, maximum 20d6 (2014 PHB p.183).
 * If the production formula differed (ceil bands, a different cap), the sheet
 * assertion below would fail, because the server's roll would not match this.
 */
function seededFallTotal(heightFeet: number, seed: number): number {
  const dice = Math.min(20, Math.floor(heightFeet / 10));
  const random = mulberry32(seed);
  let total = 0;
  for (let i = 0; i < dice; i++) total += 1 + Math.floor(random() * 6);
  return total;
}

describeWithDb('story damage writes sheet HP with the owner filter (#1024)', () => {
  const database = hasRealDb ? realDb() : (null as unknown as ReturnType<typeof realDb>);

  afterAll(async () => {
    await closeRealDb();
  });

  async function dropCapture(): Promise<void> {
    await sql`DROP TRIGGER IF EXISTS story_hp_write_capture ON character_stats`;
    await sql`DROP FUNCTION IF EXISTS story_hp_write_capture()`;
    await sql`DROP TABLE IF EXISTS story_hp_write_capture`;
    await sql`DROP TABLE IF EXISTS story_hp_write_target`;
  }

  async function installCapture(characterId: string): Promise<void> {
    if (!/^[0-9a-f-]{36}$/i.test(characterId)) {
      throw new Error('[story-damage-sheet] character id is not a uuid');
    }
    await dropCapture();
    await sql`
      CREATE TABLE story_hp_write_target (
        character_id uuid PRIMARY KEY
      )
    `;
    await sql`
      CREATE TABLE story_hp_write_capture (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        query text NOT NULL
      )
    `;
    await sql`
      CREATE FUNCTION story_hp_write_capture() RETURNS trigger
      LANGUAGE plpgsql AS $fn$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM story_hp_write_target WHERE character_id = NEW.character_id
        ) THEN
          INSERT INTO story_hp_write_capture (query) VALUES (current_query());
        END IF;
        RETURN NEW;
      END;
      $fn$
    `;
    await sql`
      CREATE TRIGGER story_hp_write_capture
      BEFORE UPDATE ON character_stats
      FOR EACH ROW
      EXECUTE FUNCTION story_hp_write_capture()
    `;
    await sql`INSERT INTO story_hp_write_target (character_id) VALUES (${characterId}::uuid)`;
  }

  test('a story blow out of combat changes the reloaded sheet and the write names the owner', async () => {
    const ownerId = testId('1024-owner');
    const sheetUserId = testId('1024-sheet-user');
    const maxHitPoints = 28;
    const damageAmount = 2;
    const expectedCurrent = maxHitPoints - damageAmount;
    const source = 'loose stone';
    const playerInput = 'I climb the broken stair.';
    const [{ id: campaignId }] = await database
      .insert(campaigns)
      .values({ userId: ownerId, name: testId('1024-camp') })
      .returning({ id: campaigns.id });
    const [{ id: characterId }] = await database
      .insert(characters)
      .values({
        userId: sheetUserId,
        ownerId,
        campaignId,
        name: testId('1024-hero'),
        class: 'Fighter',
        race: 'Human',
        level: 3,
      })
      .returning({ id: characters.id });
    await database.insert(characterStats).values({
      characterId,
      maxHitPoints,
      currentHitPoints: maxHitPoints,
      temporaryHitPoints: 0,
      constitution: 14,
      isConscious: true,
      vitalState: 'standing',
    });
    const [{ id: sessionId }] = await database
      .insert(gameSessions)
      .values({ campaignId, characterId, status: 'active' })
      .returning({ id: gameSessions.id });
    await database.insert(dialogueHistory).values({
      sessionId,
      speakerType: 'player',
      message: playerInput,
    });

    const envelope = {
      combat_transition: 'none',
      scene_spec: null,
      map_actions: [],
      handout_actions: [],
      combatants: [],
      combat_actions: [],
      narration_segments: [],
      text: 'The loose stone gives under your boot and you drop hard onto the next step.',
      options: ['A. **Stand**, check the ankle.', 'B. **Stay down**, listen.'],
      roll_requests: [],
      damage: { amount: damageAmount, source },
    };

    const auth = spyOn(authModule, 'authenticateRequest').mockResolvedValue({
      user: { userId: ownerId, email: 'sheet-owner@example.test', plan: 'free' },
      error: null,
    } as never);
    const model = spyOn(LLMProviderService, 'generate').mockResolvedValue({
      text: JSON.stringify(envelope),
      provider: 'openrouter',
      model: 't/m',
      usage: { inputTokens: 100, outputTokens: 40 },
    } as never);
    const watchdog = spyOn(dmReplyPersistence, 'scheduleDmReplyWatchdog').mockResolvedValue(
      undefined as never,
    );
    const trustProxyHeaders = process.env.TRUST_PROXY_HEADERS;
    process.env.TRUST_PROXY_HEADERS = 'true';

    try {
      await installCapture(characterId);
      const response = await createRequestPipelineApp()
        .use(llmRoutes)
        .handle(
          new Request('http://localhost/v1/llm/generate', {
            method: 'POST',
            headers: {
              authorization: 'Bearer t',
              'content-type': 'application/json',
              'x-forwarded-for': '198.51.100.24',
            },
            body: JSON.stringify({
              prompt: 'A fighter climbs a broken stair.',
              sessionId,
              player_input: playerInput,
              temperature: 0.9,
              maxTokens: 8192,
              requestType: 'user',
              dmReply: { messageId: crypto.randomUUID(), inCombat: false },
              combatEntry: {
                sessionId,
                player: {
                  characterId,
                  name: 'stair hero',
                  initiativeModifier: 2,
                },
              },
            }),
          }),
        );
      const generateBody = (await response.json()) as { text?: string; error?: unknown };
      expect(response.status).toBe(200);
      expect(generateBody.error ?? null).toBeNull();

      const sheetResponse = await createRequestPipelineApp()
        .use(charactersRoutes)
        .handle(
          new Request(`http://localhost/v1/characters/${characterId}`, {
            headers: { authorization: 'Bearer t' },
          }),
        );
      expect(sheetResponse.status).toBe(200);
      const sheet = (await sheetResponse.json()) as {
        stats?: { current_hit_points?: number; max_hit_points?: number };
      };
      expect(sheet.stats).toMatchObject({
        current_hit_points: expectedCurrent,
        max_hit_points: maxHitPoints,
      });

      const lines = await database
        .select({ message: dialogueHistory.message })
        .from(dialogueHistory)
        .where(
          and(eq(dialogueHistory.sessionId, sessionId), eq(dialogueHistory.speakerType, 'system')),
        );
      expect(lines.map((row) => row.message).join('\n')).toContain(
        `HP ${expectedCurrent}/${maxHitPoints}`,
      );

      const captured = await sql<{ query: string }[]>`
        SELECT query FROM story_hp_write_capture
      `;
      const hpWrites = captured
        .map((row) => row.query)
        .filter((query) => /current_hit_points/i.test(query));
      expect(hpWrites.length).toBeGreaterThan(0);
      for (const query of hpWrites) {
        expect(query).toContain('user_id');
        expect(query).toContain('owner_id');
      }
    } finally {
      if (trustProxyHeaders === undefined) delete process.env.TRUST_PROXY_HEADERS;
      else process.env.TRUST_PROXY_HEADERS = trustProxyHeaders;
      auth.mockRestore();
      model.mockRestore();
      watchdog.mockRestore();
      await dropCapture();
      await sql`DELETE FROM ai_usage WHERE user_id = ${ownerId}`;
      await database.delete(dialogueHistory).where(eq(dialogueHistory.sessionId, sessionId));
      await database.delete(gameSessions).where(eq(gameSessions.id, sessionId));
      await database.delete(characterStats).where(eq(characterStats.characterId, characterId));
      await database.delete(characters).where(eq(characters.id, characterId));
      await database.delete(campaigns).where(eq(campaigns.id, campaignId));
    }
  }, 30_000);

  test('a fall with a height rolls 3d6 from the height and ignores the model amount (#777)', async () => {
    const ownerId = testId('777-fall35-owner');
    const sheetUserId = testId('777-fall35-sheet-user');
    const maxHitPoints = 200;
    const seed = 42;
    const heightFeet = 35;
    const expectedCurrent = maxHitPoints - seededFallTotal(heightFeet, seed);
    const playerInput = 'I step off the ledge.';
    const [{ id: campaignId }] = await database
      .insert(campaigns)
      .values({ userId: ownerId, name: testId('777-fall35-camp') })
      .returning({ id: campaigns.id });
    const [{ id: characterId }] = await database
      .insert(characters)
      .values({
        userId: sheetUserId,
        ownerId,
        campaignId,
        name: testId('777-fall35-hero'),
        class: 'Fighter',
        race: 'Human',
        level: 3,
      })
      .returning({ id: characters.id });
    await database.insert(characterStats).values({
      characterId,
      maxHitPoints,
      currentHitPoints: maxHitPoints,
      temporaryHitPoints: 0,
      constitution: 14,
      isConscious: true,
      vitalState: 'standing',
    });
    const [{ id: sessionId }] = await database
      .insert(gameSessions)
      .values({ campaignId, characterId, status: 'active' })
      .returning({ id: gameSessions.id });
    await database.insert(dialogueHistory).values({
      sessionId,
      speakerType: 'player',
      message: playerInput,
    });

    // The model amount (999) must NOT survive: the old path would cap it at
    // HP - 1 = 199, while the roll path deals the seeded 3d6 (3..18).
    const envelope = {
      combat_transition: 'none',
      scene_spec: null,
      map_actions: [],
      handout_actions: [],
      combatants: [],
      combat_actions: [],
      narration_segments: [],
      text: 'The ledge crumbles under your boot and you fall to the rocks below.',
      options: ['A. **Stand**, check the ankle.', 'B. **Stay down**, listen.'],
      roll_requests: [],
      damage: { amount: 999, source: 'fall from the ledge', fallHeightFeet: heightFeet },
    };

    const auth = spyOn(authModule, 'authenticateRequest').mockResolvedValue({
      user: { userId: ownerId, email: 'fall35-owner@example.test', plan: 'free' },
      error: null,
    } as never);
    const model = spyOn(LLMProviderService, 'generate').mockResolvedValue({
      text: JSON.stringify(envelope),
      provider: 'openrouter',
      model: 't/m',
      usage: { inputTokens: 100, outputTokens: 40 },
    } as never);
    const watchdog = spyOn(dmReplyPersistence, 'scheduleDmReplyWatchdog').mockResolvedValue(
      undefined as never,
    );
    const trustProxyHeaders = process.env.TRUST_PROXY_HEADERS;
    process.env.TRUST_PROXY_HEADERS = 'true';

    try {
      storyDamageModule.storyDamageRandomForTests.random = mulberry32(seed);
      const response = await createRequestPipelineApp()
        .use(llmRoutes)
        .handle(
          new Request('http://localhost/v1/llm/generate', {
            method: 'POST',
            headers: {
              authorization: 'Bearer t',
              'content-type': 'application/json',
              'x-forwarded-for': '198.51.100.24',
            },
            body: JSON.stringify({
              prompt: 'A fighter steps off a ledge.',
              sessionId,
              player_input: playerInput,
              temperature: 0.9,
              maxTokens: 8192,
              requestType: 'user',
              dmReply: { messageId: crypto.randomUUID(), inCombat: false },
              combatEntry: {
                sessionId,
                player: {
                  characterId,
                  name: 'ledge hero',
                  initiativeModifier: 2,
                },
              },
            }),
          }),
        );
      const generateBody = (await response.json()) as { text?: string; error?: unknown };
      expect(response.status).toBe(200);
      expect(generateBody.error ?? null).toBeNull();

      const sheetResponse = await createRequestPipelineApp()
        .use(charactersRoutes)
        .handle(
          new Request(`http://localhost/v1/characters/${characterId}`, {
            headers: { authorization: 'Bearer t' },
          }),
        );
      expect(sheetResponse.status).toBe(200);
      const sheet = (await sheetResponse.json()) as {
        stats?: { current_hit_points?: number; max_hit_points?: number };
      };
      expect(sheet.stats).toMatchObject({
        current_hit_points: expectedCurrent,
        max_hit_points: maxHitPoints,
      });

      const lines = await database
        .select({ message: dialogueHistory.message })
        .from(dialogueHistory)
        .where(
          and(eq(dialogueHistory.sessionId, sessionId), eq(dialogueHistory.speakerType, 'system')),
        );
      expect(lines.map((row) => row.message).join('\n')).toContain(
        `HP ${expectedCurrent}/${maxHitPoints}`,
      );
    } finally {
      if (trustProxyHeaders === undefined) delete process.env.TRUST_PROXY_HEADERS;
      else process.env.TRUST_PROXY_HEADERS = trustProxyHeaders;
      storyDamageModule.storyDamageRandomForTests.random = undefined;
      auth.mockRestore();
      model.mockRestore();
      watchdog.mockRestore();
      await sql`DELETE FROM ai_usage WHERE user_id = ${ownerId}`;
      await database.delete(dialogueHistory).where(eq(dialogueHistory.sessionId, sessionId));
      await database.delete(gameSessions).where(eq(gameSessions.id, sessionId));
      await database.delete(characterStats).where(eq(characterStats.characterId, characterId));
      await database.delete(characters).where(eq(characters.id, characterId));
      await database.delete(campaigns).where(eq(campaigns.id, campaignId));
    }
  }, 30_000);

  test('a 250 ft fall caps at 20d6 (#777)', async () => {
    const ownerId = testId('777-fall250-owner');
    const sheetUserId = testId('777-fall250-sheet-user');
    const maxHitPoints = 200;
    const seed = 7;
    const heightFeet = 250;
    const expectedCurrent = maxHitPoints - seededFallTotal(heightFeet, seed);
    const playerInput = 'I fall from the cliff.';
    const [{ id: campaignId }] = await database
      .insert(campaigns)
      .values({ userId: ownerId, name: testId('777-fall250-camp') })
      .returning({ id: campaigns.id });
    const [{ id: characterId }] = await database
      .insert(characters)
      .values({
        userId: sheetUserId,
        ownerId,
        campaignId,
        name: testId('777-fall250-hero'),
        class: 'Fighter',
        race: 'Human',
        level: 3,
      })
      .returning({ id: characters.id });
    await database.insert(characterStats).values({
      characterId,
      maxHitPoints,
      currentHitPoints: maxHitPoints,
      temporaryHitPoints: 0,
      constitution: 14,
      isConscious: true,
      vitalState: 'standing',
    });
    const [{ id: sessionId }] = await database
      .insert(gameSessions)
      .values({ campaignId, characterId, status: 'active' })
      .returning({ id: gameSessions.id });
    await database.insert(dialogueHistory).values({
      sessionId,
      speakerType: 'player',
      message: playerInput,
    });

    // The model amount (1) must NOT survive: the old path would deal 1, while
    // the roll path deals the seeded 20d6 (20..120) — the 20d6 cap, not 25d6.
    const envelope = {
      combat_transition: 'none',
      scene_spec: null,
      map_actions: [],
      handout_actions: [],
      combatants: [],
      combat_actions: [],
      narration_segments: [],
      text: 'The cliff edge gives way and you plummet toward the river far below.',
      options: ['A. **Stand**, check the ankle.', 'B. **Stay down**, listen.'],
      roll_requests: [],
      damage: { amount: 1, source: 'fall from the cliff', fallHeightFeet: heightFeet },
    };

    const auth = spyOn(authModule, 'authenticateRequest').mockResolvedValue({
      user: { userId: ownerId, email: 'fall250-owner@example.test', plan: 'free' },
      error: null,
    } as never);
    const model = spyOn(LLMProviderService, 'generate').mockResolvedValue({
      text: JSON.stringify(envelope),
      provider: 'openrouter',
      model: 't/m',
      usage: { inputTokens: 100, outputTokens: 40 },
    } as never);
    const watchdog = spyOn(dmReplyPersistence, 'scheduleDmReplyWatchdog').mockResolvedValue(
      undefined as never,
    );
    const trustProxyHeaders = process.env.TRUST_PROXY_HEADERS;
    process.env.TRUST_PROXY_HEADERS = 'true';

    try {
      storyDamageModule.storyDamageRandomForTests.random = mulberry32(seed);
      const response = await createRequestPipelineApp()
        .use(llmRoutes)
        .handle(
          new Request('http://localhost/v1/llm/generate', {
            method: 'POST',
            headers: {
              authorization: 'Bearer t',
              'content-type': 'application/json',
              'x-forwarded-for': '198.51.100.24',
            },
            body: JSON.stringify({
              prompt: 'A fighter falls from a cliff.',
              sessionId,
              player_input: playerInput,
              temperature: 0.9,
              maxTokens: 8192,
              requestType: 'user',
              dmReply: { messageId: crypto.randomUUID(), inCombat: false },
              combatEntry: {
                sessionId,
                player: {
                  characterId,
                  name: 'cliff hero',
                  initiativeModifier: 2,
                },
              },
            }),
          }),
        );
      const generateBody = (await response.json()) as { text?: string; error?: unknown };
      expect(response.status).toBe(200);
      expect(generateBody.error ?? null).toBeNull();

      const sheetResponse = await createRequestPipelineApp()
        .use(charactersRoutes)
        .handle(
          new Request(`http://localhost/v1/characters/${characterId}`, {
            headers: { authorization: 'Bearer t' },
          }),
        );
      expect(sheetResponse.status).toBe(200);
      const sheet = (await sheetResponse.json()) as {
        stats?: { current_hit_points?: number; max_hit_points?: number };
      };
      expect(sheet.stats).toMatchObject({
        current_hit_points: expectedCurrent,
        max_hit_points: maxHitPoints,
      });

      const lines = await database
        .select({ message: dialogueHistory.message })
        .from(dialogueHistory)
        .where(
          and(eq(dialogueHistory.sessionId, sessionId), eq(dialogueHistory.speakerType, 'system')),
        );
      expect(lines.map((row) => row.message).join('\n')).toContain(
        `HP ${expectedCurrent}/${maxHitPoints}`,
      );
    } finally {
      if (trustProxyHeaders === undefined) delete process.env.TRUST_PROXY_HEADERS;
      else process.env.TRUST_PROXY_HEADERS = trustProxyHeaders;
      storyDamageModule.storyDamageRandomForTests.random = undefined;
      auth.mockRestore();
      model.mockRestore();
      watchdog.mockRestore();
      await sql`DELETE FROM ai_usage WHERE user_id = ${ownerId}`;
      await database.delete(dialogueHistory).where(eq(dialogueHistory.sessionId, sessionId));
      await database.delete(gameSessions).where(eq(gameSessions.id, sessionId));
      await database.delete(characterStats).where(eq(characterStats.characterId, characterId));
      await database.delete(characters).where(eq(characters.id, characterId));
      await database.delete(campaigns).where(eq(campaigns.id, campaignId));
    }
  }, 30_000);

  test('a 250 ft fall with an out-of-range model amount still rolls 20d6 (#777 Round 2)', async () => {
    const ownerId = testId('777-fall250big-owner');
    const sheetUserId = testId('777-fall250big-sheet-user');
    const maxHitPoints = 200;
    const seed = 7;
    const heightFeet = 250;
    const expectedCurrent = maxHitPoints - seededFallTotal(heightFeet, seed);
    const playerInput = 'I fall from the cliff.';
    const [{ id: campaignId }] = await database
      .insert(campaigns)
      .values({ userId: ownerId, name: testId('777-fall250big-camp') })
      .returning({ id: campaigns.id });
    const [{ id: characterId }] = await database
      .insert(characters)
      .values({
        userId: sheetUserId,
        ownerId,
        campaignId,
        name: testId('777-fall250big-hero'),
        class: 'Fighter',
        race: 'Human',
        level: 3,
      })
      .returning({ id: characters.id });
    await database.insert(characterStats).values({
      characterId,
      maxHitPoints,
      currentHitPoints: maxHitPoints,
      temporaryHitPoints: 0,
      constitution: 14,
      isConscious: true,
      vitalState: 'standing',
    });
    const [{ id: sessionId }] = await database
      .insert(gameSessions)
      .values({ campaignId, characterId, status: 'active' })
      .returning({ id: gameSessions.id });
    await database.insert(dialogueHistory).values({
      sessionId,
      speakerType: 'player',
      message: playerInput,
    });

    // Round 2 (strategist FIX at 5b2e41a8): the model amount (1000, outside
    // the 1..999 range) must NOT drop the claim — with a height present the
    // range is skipped, and the roll path deals the seeded 20d6 (20..120).
    const envelope = {
      combat_transition: 'none',
      scene_spec: null,
      map_actions: [],
      handout_actions: [],
      combatants: [],
      combat_actions: [],
      narration_segments: [],
      text: 'The cliff edge gives way and you plummet toward the river far below.',
      options: ['A. **Stand**, check the ankle.', 'B. **Stay down**, listen.'],
      roll_requests: [],
      damage: { amount: 1000, source: 'fall from the cliff', fallHeightFeet: heightFeet },
    };

    const auth = spyOn(authModule, 'authenticateRequest').mockResolvedValue({
      user: { userId: ownerId, email: 'fall250big-owner@example.test', plan: 'free' },
      error: null,
    } as never);
    const model = spyOn(LLMProviderService, 'generate').mockResolvedValue({
      text: JSON.stringify(envelope),
      provider: 'openrouter',
      model: 't/m',
      usage: { inputTokens: 100, outputTokens: 40 },
    } as never);
    const watchdog = spyOn(dmReplyPersistence, 'scheduleDmReplyWatchdog').mockResolvedValue(
      undefined as never,
    );
    const trustProxyHeaders = process.env.TRUST_PROXY_HEADERS;
    process.env.TRUST_PROXY_HEADERS = 'true';

    try {
      storyDamageModule.storyDamageRandomForTests.random = mulberry32(seed);
      const response = await createRequestPipelineApp()
        .use(llmRoutes)
        .handle(
          new Request('http://localhost/v1/llm/generate', {
            method: 'POST',
            headers: {
              authorization: 'Bearer t',
              'content-type': 'application/json',
              'x-forwarded-for': '198.51.100.24',
            },
            body: JSON.stringify({
              prompt: 'A fighter falls from a cliff.',
              sessionId,
              player_input: playerInput,
              temperature: 0.9,
              maxTokens: 8192,
              requestType: 'user',
              dmReply: { messageId: crypto.randomUUID(), inCombat: false },
              combatEntry: {
                sessionId,
                player: {
                  characterId,
                  name: 'cliff hero',
                  initiativeModifier: 2,
                },
              },
            }),
          }),
        );
      const generateBody = (await response.json()) as { text?: string; error?: unknown };
      expect(response.status).toBe(200);
      expect(generateBody.error ?? null).toBeNull();

      const sheetResponse = await createRequestPipelineApp()
        .use(charactersRoutes)
        .handle(
          new Request(`http://localhost/v1/characters/${characterId}`, {
            headers: { authorization: 'Bearer t' },
          }),
        );
      expect(sheetResponse.status).toBe(200);
      const sheet = (await sheetResponse.json()) as {
        stats?: { current_hit_points?: number; max_hit_points?: number };
      };
      expect(sheet.stats).toMatchObject({
        current_hit_points: expectedCurrent,
        max_hit_points: maxHitPoints,
      });

      const lines = await database
        .select({ message: dialogueHistory.message })
        .from(dialogueHistory)
        .where(
          and(eq(dialogueHistory.sessionId, sessionId), eq(dialogueHistory.speakerType, 'system')),
        );
      expect(lines.map((row) => row.message).join('\n')).toContain(
        `HP ${expectedCurrent}/${maxHitPoints}`,
      );
    } finally {
      if (trustProxyHeaders === undefined) delete process.env.TRUST_PROXY_HEADERS;
      else process.env.TRUST_PROXY_HEADERS = trustProxyHeaders;
      storyDamageModule.storyDamageRandomForTests.random = undefined;
      auth.mockRestore();
      model.mockRestore();
      watchdog.mockRestore();
      await sql`DELETE FROM ai_usage WHERE user_id = ${ownerId}`;
      await database.delete(dialogueHistory).where(eq(dialogueHistory.sessionId, sessionId));
      await database.delete(gameSessions).where(eq(gameSessions.id, sessionId));
      await database.delete(characterStats).where(eq(characterStats.characterId, characterId));
      await database.delete(characters).where(eq(characters.id, characterId));
      await database.delete(campaigns).where(eq(campaigns.id, campaignId));
    }
  }, 30_000);

  test('a fall under 10 feet claims the slot: a regenerated taller fall for the same message applies nothing (#777)', async () => {
    const ownerId = testId('777-fall0-owner');
    const sheetUserId = testId('777-fall0-sheet-user');
    const maxHitPoints = 200;
    const seed = 11;
    const playerInput = 'I hop down from the low wall.';
    const [{ id: campaignId }] = await database
      .insert(campaigns)
      .values({ userId: ownerId, name: testId('777-fall0-camp') })
      .returning({ id: campaigns.id });
    const [{ id: characterId }] = await database
      .insert(characters)
      .values({
        userId: sheetUserId,
        ownerId,
        campaignId,
        name: testId('777-fall0-hero'),
        class: 'Fighter',
        race: 'Human',
        level: 3,
      })
      .returning({ id: characters.id });
    await database.insert(characterStats).values({
      characterId,
      maxHitPoints,
      currentHitPoints: maxHitPoints,
      temporaryHitPoints: 0,
      constitution: 14,
      isConscious: true,
      vitalState: 'standing',
    });
    const [{ id: sessionId }] = await database
      .insert(gameSessions)
      .values({ campaignId, characterId, status: 'active' })
      .returning({ id: gameSessions.id });
    await database.insert(dialogueHistory).values({
      sessionId,
      speakerType: 'player',
      message: playerInput,
    });

    // The route inserts no player row, so both generates answer the SAME
    // seeded player message. The first fall rolls 0 dice; the second is a
    // regenerated taller fall. Without a claim on the 0-dice path the second
    // would deal the seeded 3d6; with it, HP stays 200 after both.
    const envelopeLow = {
      combat_transition: 'none',
      scene_spec: null,
      map_actions: [],
      handout_actions: [],
      combatants: [],
      combat_actions: [],
      narration_segments: [],
      text: 'You hop down from the low wall and land lightly.',
      options: ['A. **Continue**, down the path.', 'B. **Look**, for tracks.'],
      roll_requests: [],
      damage: { amount: 999, source: 'fall from the low wall', fallHeightFeet: 5 },
    };
    const envelopeTall = {
      combat_transition: 'none',
      scene_spec: null,
      map_actions: [],
      handout_actions: [],
      combatants: [],
      combat_actions: [],
      narration_segments: [],
      text: 'The cliff edge gives way and you fall to the rocks below.',
      options: ['A. **Stand**, check the ankle.', 'B. **Stay down**, listen.'],
      roll_requests: [],
      damage: { amount: 1, source: 'fall from the cliff', fallHeightFeet: 35 },
    };

    const auth = spyOn(authModule, 'authenticateRequest').mockResolvedValue({
      user: { userId: ownerId, email: 'fall0-owner@example.test', plan: 'free' },
      error: null,
    } as never);
    let generateCalls = 0;
    const model = spyOn(LLMProviderService, 'generate').mockImplementation(async () => {
      generateCalls += 1;
      const envelope = generateCalls === 1 ? envelopeLow : envelopeTall;
      return {
        text: JSON.stringify(envelope),
        provider: 'openrouter',
        model: 't/m',
        usage: { inputTokens: 100, outputTokens: 40 },
      } as never;
    });
    const watchdog = spyOn(dmReplyPersistence, 'scheduleDmReplyWatchdog').mockResolvedValue(
      undefined as never,
    );
    const trustProxyHeaders = process.env.TRUST_PROXY_HEADERS;
    process.env.TRUST_PROXY_HEADERS = 'true';

    const generate = async (prompt: string): Promise<void> => {
      const response = await createRequestPipelineApp()
        .use(llmRoutes)
        .handle(
          new Request('http://localhost/v1/llm/generate', {
            method: 'POST',
            headers: {
              authorization: 'Bearer t',
              'content-type': 'application/json',
              'x-forwarded-for': '198.51.100.24',
            },
            body: JSON.stringify({
              prompt,
              sessionId,
              player_input: playerInput,
              temperature: 0.9,
              maxTokens: 8192,
              requestType: 'user',
              dmReply: { messageId: crypto.randomUUID(), inCombat: false },
              combatEntry: {
                sessionId,
                player: {
                  characterId,
                  name: 'low-wall hero',
                  initiativeModifier: 2,
                },
              },
            }),
          }),
        );
      const generateBody = (await response.json()) as { text?: string; error?: unknown };
      expect(response.status).toBe(200);
      expect(generateBody.error ?? null).toBeNull();
    };
    const readSheetHp = async (): Promise<void> => {
      const sheetResponse = await createRequestPipelineApp()
        .use(charactersRoutes)
        .handle(
          new Request(`http://localhost/v1/characters/${characterId}`, {
            headers: { authorization: 'Bearer t' },
          }),
        );
      expect(sheetResponse.status).toBe(200);
      const sheet = (await sheetResponse.json()) as {
        stats?: { current_hit_points?: number; max_hit_points?: number };
      };
      expect(sheet.stats).toMatchObject({
        current_hit_points: maxHitPoints,
        max_hit_points: maxHitPoints,
      });
    };

    try {
      storyDamageModule.storyDamageRandomForTests.random = mulberry32(seed);
      await generate('A fighter hops down from a low wall.');
      await readSheetHp();
      await generate('A fighter falls from a cliff.');
      await readSheetHp();
    } finally {
      if (trustProxyHeaders === undefined) delete process.env.TRUST_PROXY_HEADERS;
      else process.env.TRUST_PROXY_HEADERS = trustProxyHeaders;
      storyDamageModule.storyDamageRandomForTests.random = undefined;
      auth.mockRestore();
      model.mockRestore();
      watchdog.mockRestore();
      await sql`DELETE FROM ai_usage WHERE user_id = ${ownerId}`;
      await database.delete(dialogueHistory).where(eq(dialogueHistory.sessionId, sessionId));
      await database.delete(gameSessions).where(eq(gameSessions.id, sessionId));
      await database.delete(characterStats).where(eq(characterStats.characterId, characterId));
      await database.delete(characters).where(eq(characters.id, characterId));
      await database.delete(campaigns).where(eq(campaigns.id, campaignId));
    }
  }, 60_000);
});
