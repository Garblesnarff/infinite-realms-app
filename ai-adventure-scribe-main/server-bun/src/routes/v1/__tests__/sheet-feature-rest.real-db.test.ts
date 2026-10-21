/**
 * #224: Use Feature and rests against a real database, through the real
 * character and rest routes. Auth is stubbed. CharacterService and RestService
 * are not.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts.
 */
import { afterAll, beforeAll, expect, it, mock } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { Elysia } from 'elysia';

import {
  campaigns,
  characterConditions,
  characterEquipment,
  characterHitDice,
  characterSpellSlots,
  characterStats,
  characters,
  combatEncounters,
  combatParticipantConditions,
  combatParticipantStatus,
  combatParticipants,
  conditionsLibrary,
  dialogueHistory,
  gameSessions,
  restEvents,
} from '../../../../../db/schema/index';
import { equipmentSaveWireBody } from '../../../../../shared/test-fixtures/equipment-save-wire-body';
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

if (!hasRealDb) {
  console.warn(
    '[sheet-feature-rest] SKIPPED: set TEST_DATABASE_URL to a scratch Postgres to run these.',
  );
}

const spent = {
  second_wind: {
    name: 'second_wind',
    currentUses: 0,
    maxUses: 1,
    usesPerRest: 'short',
  },
  indomitable: {
    name: 'indomitable',
    currentUses: 0,
    maxUses: 1,
    usesPerRest: 'long',
  },
};

const authHeaders = {
  authorization: 'Bearer test-token',
  'content-type': 'application/json',
};

describeWithDb('sheet feature uses and rests persist (#224)', () => {
  const db = hasRealDb ? realDb() : (null as never);
  let campaignId: string;
  let characterId: string;
  // #202's block owns its rows too; these afterAll drops are the safety net
  // if an assertion fails before the block's own cleanup runs.
  let saveCampaignId = '';
  let saveCharacterId = '';
  // Same for the #205 block below.
  let equipCampaignId = '';
  let equipCharacterId = '';

  beforeAll(async () => {
    if (!hasRealDb) return;
    userId = testId('sheet-rest-user');
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('camp') })
      .returning({ id: campaigns.id });
    [{ id: characterId }] = await db
      .insert(characters)
      .values({ userId, campaignId, name: testId('fighter'), level: 1, class: 'Fighter' })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId,
      maxHitPoints: 10,
      currentHitPoints: 4,
      temporaryHitPoints: 0,
      isConscious: true,
      vitalState: 'standing',
    });
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    const drop = async (run: () => Promise<unknown>) => {
      try {
        await run();
      } catch {
        /* fixture teardown is best-effort */
      }
    };
    await drop(() => db.delete(restEvents).where(eq(restEvents.characterId, characterId)));
    await drop(() => db.delete(characterStats).where(eq(characterStats.characterId, characterId)));
    await drop(() => db.delete(characters).where(eq(characters.id, characterId)));
    await drop(() => db.delete(campaigns).where(eq(campaigns.id, campaignId)));
    await drop(() => db.delete(characters).where(eq(characters.id, saveCharacterId)));
    await drop(() => db.delete(campaigns).where(eq(campaigns.id, saveCampaignId)));
    await drop(() =>
      db.delete(characterEquipment).where(eq(characterEquipment.characterId, equipCharacterId)),
    );
    await drop(() => db.delete(characters).where(eq(characters.id, equipCharacterId)));
    await drop(() => db.delete(campaigns).where(eq(campaigns.id, equipCampaignId)));
    await closeRealDb();
  });

  const request = (path: string, method: string, body?: unknown): Promise<Response> =>
    pipeline.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: authHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );

  it('PUT class_features round-trips on GET, short rest restores short uses, long rest restores HP and all uses', async () => {
    const put = await request(`/v1/characters/${characterId}`, 'PUT', { class_features: spent });
    expect(put.status).toBe(200);

    const got = (await (await request(`/v1/characters/${characterId}`, 'GET')).json()) as {
      class_features: typeof spent;
      stats?: { current_hit_points?: number; max_hit_points?: number };
    };
    expect(got.class_features.second_wind.currentUses).toBe(0);
    expect(got.class_features.second_wind.maxUses).toBe(1);
    expect(got.class_features.indomitable.currentUses).toBe(0);
    expect(got.stats?.current_hit_points).toBe(4);

    const shortRest = await request(`/v1/rest/characters/${characterId}/short`, 'POST', {
      hitDiceToSpend: 0,
    });
    expect(shortRest.status).toBe(200);
    const afterShort = (await (await request(`/v1/characters/${characterId}`, 'GET')).json()) as {
      class_features: typeof spent;
      stats?: { current_hit_points?: number };
    };
    expect(afterShort.class_features.second_wind.currentUses).toBe(1);
    expect(afterShort.class_features.indomitable.currentUses).toBe(0);
    expect(afterShort.stats?.current_hit_points).toBe(4);

    await db.update(characters).set({ classFeatures: spent }).where(eq(characters.id, characterId));

    const longRest = await request(`/v1/rest/characters/${characterId}/long`, 'POST', {});
    expect(longRest.status).toBe(200);
    const afterLong = (await (await request(`/v1/characters/${characterId}`, 'GET')).json()) as {
      class_features: typeof spent;
      stats?: { current_hit_points?: number; max_hit_points?: number };
    };
    expect(afterLong.class_features.second_wind.currentUses).toBe(1);
    expect(afterLong.class_features.indomitable.currentUses).toBe(1);
    expect(afterLong.stats?.current_hit_points).toBe(10);
    expect(afterLong.stats?.max_hit_points).toBe(10);
  });

  it('#202: sheet-update wire bodies persist — award XP, add a trait, save appearance', async () => {
    // The exact bodies buildSheetUpdatePayload produces for the three
    // QA-listed edits (pinned in
    // src/hooks/__tests__/use-character-data.sheet-update.test.ts): each
    // goes through PUT /v1/characters/:id and must land in the row.
    const [{ id: campId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('sheet-save-camp') })
      .returning({ id: campaigns.id });
    saveCampaignId = campId;
    const [{ id: charId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId: campId,
        name: testId('sheet-save-hero'),
        level: 1,
        class: 'Fighter',
      })
      .returning({ id: characters.id });
    saveCharacterId = charId;

    // 1. Award XP — the client sends exactly { experience_points }.
    const xpPut = await request(`/v1/characters/${charId}`, 'PUT', { experience_points: 250 });
    expect(xpPut.status).toBe(200);

    // 2. Add a trait — the client sends the serialized personality envelope
    // in personality_notes. This literal is the byte-canonical output of
    // serializePersonalityEnvelope for { personalityTraits: ['Brave in battle'] }
    // (fixed key order, lastInspiration: null) — the exact wire string.
    const envelope = JSON.stringify({
      traits: ['Brave in battle'],
      ideals: [],
      bonds: [],
      flaws: [],
      inspiration: false,
      lastInspiration: null,
      inspirationHistory: [],
    });
    const traitPut = await request(`/v1/characters/${charId}`, 'PUT', {
      personality_notes: envelope,
    });
    expect(traitPut.status).toBe(200);

    // 3. Save appearance — the client sends exactly { appearance }.
    const appearancePut = await request(`/v1/characters/${charId}`, 'PUT', {
      appearance: 'Tall, scarred, silver hair.',
    });
    expect(appearancePut.status).toBe(200);

    // The writes landed in the columns.
    const [row] = await db.select().from(characters).where(eq(characters.id, charId));
    expect(row.experiencePoints).toBe(250);
    expect(row.appearance).toBe('Tall, scarred, silver hair.');
    expect(JSON.parse(row.personalityNotes as string).traits).toEqual(['Brave in battle']);

    // And the GET route serves them back to the sheet.
    const got = (await (await request(`/v1/characters/${charId}`, 'GET')).json()) as {
      experience_points: number;
      appearance: string;
      personality_notes: string;
    };
    expect(got.experience_points).toBe(250);
    expect(got.appearance).toBe('Tall, scarred, silver hair.');
    expect(JSON.parse(got.personality_notes).traits).toEqual(['Brave in battle']);

    // This block's rows are its own; the shared afterAll only drops the #224 pair.
    await db.delete(characters).where(eq(characters.id, charId));
    await db.delete(campaigns).where(eq(campaigns.id, campId));
  });

  it('#205: equipment save round-trips names — item_name never becomes a row UUID', async () => {
    // The exact wire body the fixed client sends: the shared fixture pins what
    // transformEquipmentForStorage emits (see
    // shared/test-fixtures/equipment-save-wire-body.ts) — item_name from
    // itemName (the sheet's loaded name), not from itemId (the row UUID).
    const [{ id: campId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('sheet-equip-camp') })
      .returning({ id: campaigns.id });
    equipCampaignId = campId;
    const [{ id: charId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId: campId,
        name: testId('sheet-equip-hero'),
        level: 1,
        class: 'Fighter',
      })
      .returning({ id: characters.id });
    equipCharacterId = charId;

    const wireEquipment = equipmentSaveWireBody(charId);

    const put = await request(`/v1/characters/${charId}`, 'PUT', { equipment: wireEquipment });
    expect(put.status).toBe(200);

    // Names landed in the DB; nothing UUID-shaped.
    const uuidish = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const names = async () =>
      (
        await db.select().from(characterEquipment).where(eq(characterEquipment.characterId, charId))
      ).map((r) => r.itemName);
    expect((await names()).sort()).toEqual(['Chain Mail', 'Longsword']);

    // A second save from a reloaded sheet sends the same names (item_name from
    // itemName). The upsert matches by name, so no duplicate rows appear and
    // item_name is unchanged. (Before the fix the client sent the row UUID as
    // item_name; the name lookup missed and a UUID-named duplicate row was
    // inserted on every save.)
    const put2 = await request(`/v1/characters/${charId}`, 'PUT', { equipment: wireEquipment });
    expect(put2.status).toBe(200);
    const names2 = await names();
    expect(names2).toHaveLength(2);
    expect(names2.sort()).toEqual(['Chain Mail', 'Longsword']);
    expect(names2.some((n) => uuidish.test(n))).toBe(false);

    // GET /v1/characters/:id/equipment (the sheet's loader path) serves the
    // names back; transformCharacterData then maps item_name -> itemName.
    const eqGet = await request(`/v1/characters/${charId}/equipment`, 'GET');
    expect(eqGet.status).toBe(200);
    const eqRows = (await eqGet.json()) as Array<{ id: string; item_name: string }>;
    expect(eqRows.map((e) => e.item_name).sort()).toEqual(['Chain Mail', 'Longsword']);

    await db.delete(characterEquipment).where(eq(characterEquipment.characterId, charId));
    await db.delete(characters).where(eq(characters.id, charId));
    await db.delete(campaigns).where(eq(campaigns.id, campId));
  });

  // #214 (QA-035): Apply Damage on the sheet persists HP through
  // POST /v1/characters/:id/damage, and the GET the header reads serves the
  // new value.
  it('POST damage persists HP and the header GET shows the new value', async () => {
    // Own character: the #224 test's long rest changes the shared HP, so this
    // block sets up 8/10 HP independently.
    const [{ id: dmgCampId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('sheet-dmg-camp') })
      .returning({ id: campaigns.id });
    const [{ id: dmgCharId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId: dmgCampId,
        name: testId('sheet-dmg-hero'),
        level: 1,
        class: 'Fighter',
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId: dmgCharId,
      maxHitPoints: 10,
      currentHitPoints: 8,
      temporaryHitPoints: 0,
      isConscious: true,
      vitalState: 'standing',
    });

    const damage = await request(`/v1/characters/${dmgCharId}/damage`, 'POST', {
      amount: 3,
    });
    expect(damage.status).toBe(200);
    const body = (await damage.json()) as {
      currentHitPoints: number;
      temporaryHitPoints: number;
    };
    expect(body.currentHitPoints).toBe(5);

    // The write landed in character_stats.
    const [row] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, dmgCharId));
    expect(row.currentHitPoints).toBe(5);

    // And the GET route serves it back — this is what the sheet header renders.
    const got = (await (await request(`/v1/characters/${dmgCharId}`, 'GET')).json()) as {
      stats: { current_hit_points: number };
    };
    expect(got.stats.current_hit_points).toBe(5);

    await db.delete(characterStats).where(eq(characterStats.characterId, dmgCharId));
    await db.delete(characters).where(eq(characters.id, dmgCharId));
    await db.delete(campaigns).where(eq(campaigns.id, dmgCampId));
  });

  // #214 (QA-036, strategist round 5): healing is a server-side delta. The
  // client sends the amount; the server adds it to the CURRENT row and clamps
  // to max HP. A combat or DM HP change made after the sheet loaded is not
  // lost, which the old absolute-PUT could not guarantee.
  it('POST heal adds to the DB HP, not a stale client value, and clamps to max', async () => {
    const [{ id: healCampId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('sheet-heal-camp') })
      .returning({ id: campaigns.id });
    const [{ id: healCharId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId: healCampId,
        name: testId('sheet-heal-hero'),
        level: 1,
        class: 'Fighter',
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId: healCharId,
      maxHitPoints: 10,
      currentHitPoints: 8,
      temporaryHitPoints: 0,
      isConscious: true,
      vitalState: 'standing',
    });

    // The sheet loaded at 8 HP; meanwhile something else (combat, the DM)
    // changed the row to 3. The heal must apply to 3, not to the stale 8.
    await db
      .update(characterStats)
      .set({ currentHitPoints: 3 })
      .where(eq(characterStats.characterId, healCharId));

    const heal = await request(`/v1/characters/${healCharId}/heal`, 'POST', { amount: 4 });
    expect(heal.status).toBe(200);
    const body = (await heal.json()) as {
      currentHitPoints: number;
      temporaryHitPoints: number;
    };
    expect(body.currentHitPoints).toBe(7);

    const [row] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, healCharId));
    expect(row.currentHitPoints).toBe(7);

    // And it clamps to max HP rather than overhealing.
    const overheal = await request(`/v1/characters/${healCharId}/heal`, 'POST', { amount: 10 });
    expect(overheal.status).toBe(200);
    expect(((await overheal.json()) as { currentHitPoints: number }).currentHitPoints).toBe(10);

    await db.delete(characterStats).where(eq(characterStats.characterId, healCharId));
    await db.delete(characters).where(eq(characters.id, healCharId));
    await db.delete(campaigns).where(eq(campaigns.id, healCampId));
  });

  // #214 (QA-036, strategist round 5): temp HP round trip. 2014 5e: temporary
  // hit points do not stack — the server keeps the higher of the current and
  // the new value.
  it('POST temp-hp keeps the higher value and round-trips on GET', async () => {
    const [{ id: thpCampId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('sheet-thp-camp') })
      .returning({ id: campaigns.id });
    const [{ id: thpCharId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId: thpCampId,
        name: testId('sheet-thp-hero'),
        level: 1,
        class: 'Fighter',
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId: thpCharId,
      maxHitPoints: 10,
      currentHitPoints: 10,
      temporaryHitPoints: 0,
      isConscious: true,
      vitalState: 'standing',
    });

    const set5 = await request(`/v1/characters/${thpCharId}/temp-hp`, 'POST', { amount: 5 });
    expect(set5.status).toBe(200);
    expect(((await set5.json()) as { temporaryHitPoints: number }).temporaryHitPoints).toBe(5);

    // A lower value does not replace the higher one (no stacking).
    const set3 = await request(`/v1/characters/${thpCharId}/temp-hp`, 'POST', { amount: 3 });
    expect(set3.status).toBe(200);
    expect(((await set3.json()) as { temporaryHitPoints: number }).temporaryHitPoints).toBe(5);

    // A higher value wins.
    const set8 = await request(`/v1/characters/${thpCharId}/temp-hp`, 'POST', { amount: 8 });
    expect(set8.status).toBe(200);
    expect(((await set8.json()) as { temporaryHitPoints: number }).temporaryHitPoints).toBe(8);

    const [row] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, thpCharId));
    expect(row.temporaryHitPoints).toBe(8);

    // The GET the sheet reads serves it back.
    const got = (await (await request(`/v1/characters/${thpCharId}`, 'GET')).json()) as {
      stats: { temporary_hit_points: number };
    };
    expect(got.stats.temporary_hit_points).toBe(8);

    await db.delete(characterStats).where(eq(characterStats.characterId, thpCharId));
    await db.delete(characters).where(eq(characters.id, thpCharId));
    await db.delete(campaigns).where(eq(campaigns.id, thpCampId));
  });

  it('#204: personality and quirks persist — create with 2 traits, ideal, bond, flaw, 2 quirks', async () => {
    // The issue's proving test: the wizard's wire body goes through POST
    // /v1/characters, lands in the row, and comes back on GET for the sheet
    // loader. Traits/ideals/bonds/flaws travel in the personality_notes
    // envelope; quirks travel in enhancement_selections.
    const envelope = JSON.stringify({
      traits: ['Brave in battle', 'Loyal to a fault'],
      ideals: ['Protect the innocent'],
      bonds: ['My sister Mara'],
      flaws: ['Quick to anger'],
      inspiration: false,
      lastInspiration: null,
      inspirationHistory: [],
    });
    const quirks = [
      { optionId: 'quirk-1', value: 'Scarred knuckles' },
      { optionId: 'quirk-2', value: 'Whistles when nervous' },
    ];

    const created = (await (
      await request('/v1/characters', 'POST', {
        name: testId('personality-hero'),
        race: 'Human',
        class: 'Fighter',
        level: 1,
        personality_notes: envelope,
        enhancement_selections: quirks,
      })
    ).json()) as { id: string };
    expect(created.id).toBeTruthy();
    saveCharacterId = created.id;

    // DB readback: the values landed in the columns.
    const [row] = await db.select().from(characters).where(eq(characters.id, created.id));
    const stored = JSON.parse(row.personalityNotes as string);
    expect(stored.traits).toEqual(['Brave in battle', 'Loyal to a fault']);
    expect(stored.ideals).toEqual(['Protect the innocent']);
    expect(stored.bonds).toEqual(['My sister Mara']);
    expect(stored.flaws).toEqual(['Quick to anger']);
    expect(row.enhancementSelections).toEqual(quirks);

    // GET serves them back for the sheet loader (transformCharacterData reads
    // these two fields).
    const got = (await (await request(`/v1/characters/${created.id}`, 'GET')).json()) as {
      personality_notes: string;
      enhancement_selections: Array<{ optionId: string; value: string }>;
    };
    const served = JSON.parse(got.personality_notes);
    expect(served.traits).toHaveLength(2);
    expect(served.ideals).toEqual(['Protect the innocent']);
    expect(got.enhancement_selections).toEqual(quirks);

    // PUT round-trip: the sheet-save path writes enhancement_selections too.
    const newQuirks = [{ optionId: 'quirk-3', value: 'Counts coins twice' }];
    const put = await request(`/v1/characters/${created.id}`, 'PUT', {
      enhancement_selections: newQuirks,
    });
    expect(put.status).toBe(200);
    const [afterPut] = await db.select().from(characters).where(eq(characters.id, created.id));
    expect(afterPut.enhancementSelections).toEqual(newQuirks);
    const gotAfterPut = (await (await request(`/v1/characters/${created.id}`, 'GET')).json()) as {
      enhancement_selections: Array<{ optionId: string; value: string }>;
    };
    expect(gotAfterPut.enhancement_selections).toEqual(newQuirks);

    await db.delete(characters).where(eq(characters.id, created.id));
    saveCharacterId = '';
  });
});

/**
 * #170: one long-rest ruleset for the sheet path and the combat path.
 *
 * Both buttons call the same server route (`POST /v1/rest/characters/:id/long`),
 * so the parity assertion is that the same seeded character — a non-permanent
 * condition, active concentration, spent slots, spent hit dice — gets the same
 * rest result through both paths: HP to max, all slots restored, hit dice
 * regained up to half the total (minimum 1), concentration ended, the
 * rest-clearable conditions cleared, and nothing touched in ended encounters.
 */
describeWithDb('one long-rest ruleset for the sheet and combat paths (#170)', () => {
  // Fresh client per block: the #224 block above closes the shared one in its
  // afterAll, and realDb() reconnects when the cached client is gone.
  let db: ReturnType<typeof realDb>;

  let campaignId: string;
  let characterId: string;
  let sessionId: string;
  let activeEncounterId: string;
  let participantId: string;
  let endedEncounterId: string;
  let endedParticipantId: string;
  let unconsciousId: string;
  let poisonedId: string;

  const request = (path: string, method: string, body?: unknown): Promise<Response> =>
    pipeline.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: authHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );

  beforeAll(async () => {
    if (!hasRealDb) return;
    db = realDb();
    userId = testId('rest-parity-user');

    // The conditions library is a shared reference table: insert the rows this
    // suite needs, ignoring the unique-name conflict when another suite (or a
    // previous run) already put them there.
    await db
      .insert(conditionsLibrary)
      .values([
        { name: 'unconscious', description: 'test', mechanicalEffects: 'test' },
        { name: 'poisoned', description: 'test', mechanicalEffects: 'test' },
      ])
      .onConflictDoNothing();
    const libraryRows = await db
      .select({ id: conditionsLibrary.id, name: conditionsLibrary.name })
      .from(conditionsLibrary)
      .where(eq(conditionsLibrary.name, 'unconscious'));
    const poisonedRows = await db
      .select({ id: conditionsLibrary.id })
      .from(conditionsLibrary)
      .where(eq(conditionsLibrary.name, 'poisoned'));
    unconsciousId = libraryRows[0].id;
    poisonedId = poisonedRows[0].id;

    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('camp') })
      .returning({ id: campaigns.id });

    [{ id: characterId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId,
        name: testId('wizard'),
        level: 3,
        class: 'Wizard',
        activeConcentration: 'Bless',
      })
      .returning({ id: characters.id });

    await db.insert(characterStats).values({
      characterId,
      maxHitPoints: 30,
      currentHitPoints: 12,
      temporaryHitPoints: 0,
      isConscious: true,
      vitalState: 'standing',
    });

    // Spent slots: level 1 has 1 of 4 left, level 2 is empty.
    await db.insert(characterSpellSlots).values([
      { characterId, spellLevel: 1, totalSlots: 4, usedSlots: 3 },
      { characterId, spellLevel: 2, totalSlots: 2, usedSlots: 2 },
    ]);

    // Spent hit dice: 3 total d6, 2 used (rest restores floor(3/2) = 1).
    await db.insert(characterHitDice).values({
      characterId,
      className: 'Wizard',
      dieType: 'd6',
      totalDice: 3,
      usedDice: 2,
    });

    // Character-scoped conditions: unconscious is cleared by a long rest,
    // poisoned survives it.
    await db.insert(characterConditions).values([
      { characterId, conditionId: unconsciousId, durationType: 'hours', isActive: true },
      { characterId, conditionId: poisonedId, durationType: 'hours', isActive: true },
    ]);

    [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });

    [{ id: activeEncounterId }] = await db
      .insert(combatEncounters)
      .values({ sessionId, status: 'active', currentRound: 2, currentTurnOrder: 0, version: 1 })
      .returning({ id: combatEncounters.id });

    [{ id: participantId }] = await db
      .insert(combatParticipants)
      .values({
        encounterId: activeEncounterId,
        characterId,
        name: testId('wizard'),
        participantType: 'player',
        turnOrder: 0,
        initiative: 12,
        maxHp: 30,
      })
      .returning({ id: combatParticipants.id });

    await db.insert(combatParticipantStatus).values({
      participantId,
      currentHp: 12,
      maxHp: 30,
      tempHp: 0,
      isConscious: true,
      deathSavesSuccesses: 0,
      deathSavesFailures: 0,
    });

    await db.insert(combatParticipantConditions).values([
      {
        participantId,
        conditionId: unconsciousId,
        durationType: 'minutes',
        appliedAtRound: 1,
        isActive: true,
      },
      {
        participantId,
        conditionId: poisonedId,
        durationType: 'minutes',
        appliedAtRound: 1,
        isActive: true,
      },
    ]);

    // An ended encounter with a stale row: the rest must not touch it.
    [{ id: endedEncounterId }] = await db
      .insert(combatEncounters)
      .values({ sessionId, status: 'completed', currentRound: 9, currentTurnOrder: 0, version: 1 })
      .returning({ id: combatEncounters.id });

    [{ id: endedParticipantId }] = await db
      .insert(combatParticipants)
      .values({
        encounterId: endedEncounterId,
        characterId,
        name: testId('wizard-old'),
        participantType: 'player',
        turnOrder: 0,
        initiative: 5,
        maxHp: 10,
      })
      .returning({ id: combatParticipants.id });

    await db.insert(combatParticipantStatus).values({
      participantId: endedParticipantId,
      currentHp: 5,
      maxHp: 10,
      tempHp: 0,
      isConscious: true,
      deathSavesSuccesses: 0,
      deathSavesFailures: 0,
    });
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    const drop = async (run: () => Promise<unknown>) => {
      try {
        await run();
      } catch {
        /* fixture teardown is best-effort */
      }
    };
    await drop(() =>
      db
        .delete(combatParticipantConditions)
        .where(eq(combatParticipantConditions.participantId, participantId)),
    );
    await drop(() =>
      db
        .delete(combatParticipantStatus)
        .where(eq(combatParticipantStatus.participantId, participantId)),
    );
    await drop(() => db.delete(combatParticipants).where(eq(combatParticipants.id, participantId)));
    await drop(() =>
      db
        .delete(combatParticipantStatus)
        .where(eq(combatParticipantStatus.participantId, endedParticipantId)),
    );
    await drop(() =>
      db.delete(combatParticipants).where(eq(combatParticipants.id, endedParticipantId)),
    );
    await drop(() => db.delete(combatEncounters).where(eq(combatEncounters.id, endedEncounterId)));
    await drop(() => db.delete(combatEncounters).where(eq(combatEncounters.id, activeEncounterId)));
    await drop(() => db.delete(gameSessions).where(eq(gameSessions.id, sessionId)));
    await drop(() =>
      db.delete(characterConditions).where(eq(characterConditions.characterId, characterId)),
    );
    await drop(() =>
      db.delete(characterHitDice).where(eq(characterHitDice.characterId, characterId)),
    );
    await drop(() =>
      db.delete(characterSpellSlots).where(eq(characterSpellSlots.characterId, characterId)),
    );
    await drop(() => db.delete(characterStats).where(eq(characterStats.characterId, characterId)));
    await drop(() => db.delete(characters).where(eq(characters.id, characterId)));
    await drop(() => db.delete(campaigns).where(eq(campaigns.id, campaignId)));
    await closeRealDb();
  });

  /** Re-spend everything so a second rest starts from the same state. */
  const seedSpentState = async (): Promise<void> => {
    await db
      .update(characterStats)
      .set({ currentHitPoints: 12, isConscious: true, vitalState: 'standing' })
      .where(eq(characterStats.characterId, characterId));
    await db
      .update(characters)
      .set({ activeConcentration: 'Bless' })
      .where(eq(characters.id, characterId));
    await db
      .update(characterSpellSlots)
      .set({ usedSlots: 3 })
      .where(
        and(
          eq(characterSpellSlots.characterId, characterId),
          eq(characterSpellSlots.spellLevel, 1),
        ),
      );
    await db
      .update(characterSpellSlots)
      .set({ usedSlots: 2 })
      .where(
        and(
          eq(characterSpellSlots.characterId, characterId),
          eq(characterSpellSlots.spellLevel, 2),
        ),
      );
    await db
      .update(characterHitDice)
      .set({ usedDice: 2 })
      .where(eq(characterHitDice.characterId, characterId));
    await db
      .update(characterConditions)
      .set({ isActive: true })
      .where(eq(characterConditions.characterId, characterId));
    await db
      .update(combatParticipantStatus)
      .set({ currentHp: 12, isConscious: true })
      .where(eq(combatParticipantStatus.participantId, participantId));
    await db
      .update(combatParticipantConditions)
      .set({ isActive: true })
      .where(eq(combatParticipantConditions.participantId, participantId));
  };

  /** Two rests are the same result when everything but the event id matches. */
  const normalizeResult = (body: Record<string, unknown>): Record<string, unknown> => {
    const { restEventId: _restEventId, hitDiceRemaining, ...rest } = body;
    return {
      ...rest,
      hitDiceRemaining: ((hitDiceRemaining ?? []) as Array<Record<string, unknown>>)
        .map(
          ({ id: _id, characterId: _characterId, createdAt: _ca, updatedAt: _ua, ...die }) => die,
        )
        .sort((a, b) => String(a.dieType).localeCompare(String(b.dieType))),
    };
  };

  it('the sheet path and the combat path get the same long-rest result', async () => {
    if (!hasRealDb) return;

    // The sheet button's call.
    await seedSpentState();
    const sheetRes = await request(`/v1/rest/characters/${characterId}/long`, 'POST', {});
    expect(sheetRes.status).toBe(200);
    const sheetBody = (await sheetRes.json()) as Record<string, unknown>;

    // The combat button's call: the same route, the same server implementation.
    await seedSpentState();
    const combatRes = await request(`/v1/rest/characters/${characterId}/long`, 'POST', {});
    expect(combatRes.status).toBe(200);
    const combatBody = (await combatRes.json()) as Record<string, unknown>;

    expect(sheetBody.restType).toBe('long');
    expect(normalizeResult(combatBody)).toEqual(normalizeResult(sheetBody));

    // The full SRD 5.1 package lands in the response...
    expect(sheetBody.hpRestored).toBe(18);
    expect(sheetBody.hitDiceRestored).toBe(1);
    expect(sheetBody.spellSlots).toEqual({
      '1': { max: 4, current: 4 },
      '2': { max: 2, current: 2 },
    });

    // ...and in the database, where both paths read it back from.
    const sheet = (await (await request(`/v1/characters/${characterId}`, 'GET')).json()) as {
      active_concentration: string | null;
      stats?: { current_hit_points?: number; max_hit_points?: number };
    };
    expect(sheet.active_concentration).toBeNull();
    expect(sheet.stats?.current_hit_points).toBe(30);

    const slots = await db
      .select()
      .from(characterSpellSlots)
      .where(eq(characterSpellSlots.characterId, characterId));
    expect(slots.every((slot) => slot.usedSlots === 0)).toBe(true);

    const [hitDice] = await db
      .select()
      .from(characterHitDice)
      .where(eq(characterHitDice.characterId, characterId));
    expect(hitDice.usedDice).toBe(1);

    // Unconscious is cleared by the rest; poisoned survives it — on the
    // character and on the participant in the active encounter.
    const characterConditionStates = await db
      .select({
        conditionId: characterConditions.conditionId,
        isActive: characterConditions.isActive,
      })
      .from(characterConditions)
      .where(eq(characterConditions.characterId, characterId));
    expect(
      characterConditionStates.find((row) => row.conditionId === unconsciousId)?.isActive,
    ).toBe(false);
    expect(characterConditionStates.find((row) => row.conditionId === poisonedId)?.isActive).toBe(
      true,
    );

    const participantConditionStates = await db
      .select({
        conditionId: combatParticipantConditions.conditionId,
        isActive: combatParticipantConditions.isActive,
      })
      .from(combatParticipantConditions)
      .where(eq(combatParticipantConditions.participantId, participantId));
    expect(
      participantConditionStates.find((row) => row.conditionId === unconsciousId)?.isActive,
    ).toBe(false);
    expect(participantConditionStates.find((row) => row.conditionId === poisonedId)?.isActive).toBe(
      true,
    );

    const [participantStatus] = await db
      .select()
      .from(combatParticipantStatus)
      .where(eq(combatParticipantStatus.participantId, participantId));
    expect(participantStatus.currentHp).toBe(30);

    // The ended encounter's stale row is untouched.
    const [endedStatus] = await db
      .select()
      .from(combatParticipantStatus)
      .where(eq(combatParticipantStatus.participantId, endedParticipantId));
    expect(endedStatus.currentHp).toBe(5);
    expect(endedStatus.maxHp).toBe(10);
  });

  it('#264: short rest spends hit dice through the route — lazy init, CON mod, capped at max, GET shows hit dice', async () => {
    if (!hasRealDb) return;

    const [{ id: campId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('264-camp') })
      .returning({ id: campaigns.id });
    const [{ id: charId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId: campId,
        name: testId('264-fighter'),
        level: 1,
        class: 'Fighter',
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId: charId,
      maxHitPoints: 12,
      currentHitPoints: 5,
      temporaryHitPoints: 0,
      constitution: 14,
      isConscious: true,
      vitalState: 'standing',
    });

    // No hit-dice rows exist: the rest lazily initializes them from class/level.
    const shortRes = await request(`/v1/rest/characters/${charId}/short`, 'POST', {
      hitDiceToSpend: 1,
    });
    expect(shortRes.status).toBe(200);
    const body = (await shortRes.json()) as {
      hitDiceSpent?: number;
      hpRestored?: number;
      hitDiceRemaining?: Array<{ dieType: string; totalDice: number; usedDice: number }>;
    };
    expect(body.hitDiceSpent).toBe(1);
    // d10 + CON 14 (+2), minimum 0 per die (2014 PHB): 3..12.
    expect(body.hpRestored).toBeGreaterThanOrEqual(3);
    expect(body.hpRestored).toBeLessThanOrEqual(12);
    expect(body.hitDiceRemaining).toHaveLength(1);
    expect(body.hitDiceRemaining?.[0].dieType).toBe('d10');
    expect(body.hitDiceRemaining?.[0].totalDice).toBe(1);
    expect(body.hitDiceRemaining?.[0].usedDice).toBe(1);

    // GET shows the new HP (capped at max) and the hit dice.
    const sheet = (await (await request(`/v1/characters/${charId}`, 'GET')).json()) as {
      stats?: { current_hit_points?: number; max_hit_points?: number };
      hit_dice?: Array<{ die_type: string; total_dice: number; used_dice: number }>;
    };
    expect(sheet.stats?.current_hit_points).toBe(Math.min(12, 5 + (body.hpRestored ?? 0)));
    expect(sheet.hit_dice).toHaveLength(1);
    expect(sheet.hit_dice?.[0].die_type).toBe('d10');
    expect(sheet.hit_dice?.[0].total_dice).toBe(1);
    expect(sheet.hit_dice?.[0].used_dice).toBe(1);

    await db.delete(characterHitDice).where(eq(characterHitDice.characterId, charId));
    await db.delete(restEvents).where(eq(restEvents.characterId, charId));
    await db.delete(characterStats).where(eq(characterStats.characterId, charId));
    await db.delete(characters).where(eq(characters.id, charId));
    await db.delete(campaigns).where(eq(campaigns.id, campId));
  });

  it('#264: multiclass lazy init creates one hit-dice row per class, not class x total level', async () => {
    if (!hasRealDb) return;

    const [{ id: campId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('264-camp-multi') })
      .returning({ id: campaigns.id });
    const [{ id: charId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId: campId,
        name: testId('264-multiclass'),
        level: 4,
        class: 'Fighter',
        classLevels: [
          { className: 'Fighter', level: 2 },
          { className: 'Wizard', level: 2 },
        ],
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId: charId,
      maxHitPoints: 30,
      currentHitPoints: 10,
      temporaryHitPoints: 0,
      constitution: 14,
      isConscious: true,
      vitalState: 'standing',
    });

    // No hit-dice rows exist: the short rest lazily initializes them per class.
    const shortRes = await request(`/v1/rest/characters/${charId}/short`, 'POST', {
      hitDiceToSpend: 0,
    });
    expect(shortRes.status).toBe(200);
    const body = (await shortRes.json()) as {
      hitDiceRemaining?: Array<{
        className: string;
        dieType: string;
        totalDice: number;
        usedDice: number;
      }>;
    };
    // 2014 PHB: Fighter 2 / Wizard 2 -> 2d10 + 2d6, not 4d10.
    expect(body.hitDiceRemaining).toHaveLength(2);
    const byClass = Object.fromEntries(
      (body.hitDiceRemaining ?? []).map((row) => [row.className, row]),
    );
    expect(byClass.Fighter?.dieType).toBe('d10');
    expect(byClass.Fighter?.totalDice).toBe(2);
    expect(byClass.Wizard?.dieType).toBe('d6');
    expect(byClass.Wizard?.totalDice).toBe(2);

    // GET serves the same per-class rows in deterministic order.
    const sheet = (await (await request(`/v1/characters/${charId}`, 'GET')).json()) as {
      hit_dice?: Array<{ class_name: string; die_type: string; total_dice: number }>;
    };
    expect(sheet.hit_dice).toHaveLength(2);
    expect(sheet.hit_dice?.map((row) => row.class_name)).toEqual(['Fighter', 'Wizard']);

    await db.delete(characterHitDice).where(eq(characterHitDice.characterId, charId));
    await db.delete(restEvents).where(eq(restEvents.characterId, charId));
    await db.delete(characterStats).where(eq(characterStats.characterId, charId));
    await db.delete(characters).where(eq(characters.id, charId));
    await db.delete(campaigns).where(eq(campaigns.id, campId));
  });

  it('#264: a rest the DM grants in the story applies through RestService — GET shows the new HP and hit dice', async () => {
    if (!hasRealDb) return;
    const { applyStoryRest } = await import('../../../services/dm/story-rest.js');

    const [{ id: campId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('264-story-camp') })
      .returning({ id: campaigns.id });
    const [{ id: charId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId: campId,
        name: testId('264-story-hero'),
        level: 3,
        class: 'Fighter',
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId: charId,
      maxHitPoints: 20,
      currentHitPoints: 6,
      temporaryHitPoints: 0,
      constitution: 12,
      isConscious: true,
      vitalState: 'standing',
    });
    const [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId: campId, characterId: charId })
      .returning({ id: gameSessions.id });
    const playerMessage = async (text: string) => {
      await db.insert(dialogueHistory).values({
        sessionId,
        speakerType: 'player',
        message: text,
      });
    };
    const readSheet = async () =>
      (await (await request(`/v1/characters/${charId}`, 'GET')).json()) as {
        stats?: { current_hit_points?: number; max_hit_points?: number };
        hit_dice?: Array<{ die_type: string; total_dice: number; used_dice: number }>;
      };

    // A short rest the story grants: applied through RestService. #751: a rest
    // declared in chat has no sheet hit-dice prompt, so the rest spends dice
    // until the character is healed or out of dice (the #264 "spends no dice"
    // expectation is what Hark reported as "short rest does nothing").
    await playerMessage('We catch our breath behind the rocks for an hour.');
    expect(await applyStoryRest({ userId, sessionId, rest: { type: 'short' } })).toBe('applied');
    const afterShort = await readSheet();
    expect(afterShort.stats?.current_hit_points).toBeGreaterThan(6);
    expect(afterShort.stats?.current_hit_points).toBeLessThanOrEqual(20);
    expect(afterShort.hit_dice).toHaveLength(1);
    expect(afterShort.hit_dice?.[0].die_type).toBe('d10');
    expect(afterShort.hit_dice?.[0].total_dice).toBe(3);
    expect(afterShort.hit_dice?.[0].used_dice).toBeGreaterThan(0);
    // The spend only stops early at full HP: short of full means every die went.
    if ((afterShort.stats?.current_hit_points ?? 0) < 20) {
      expect(afterShort.hit_dice?.[0].used_dice).toBe(3);
    }
    const spentDice = afterShort.hit_dice?.[0].used_dice ?? 0;

    // Retry re-sends the same player message: no second rest.
    expect(await applyStoryRest({ userId, sessionId, rest: { type: 'short' } })).toBe(
      'already_applied',
    );

    // An invalid rest type is rejected, not applied.
    expect(await applyStoryRest({ userId, sessionId, rest: { type: 'nap' } })).toBe('invalid_rest');

    // A long rest the story grants on a later turn: HP to full through the same service.
    await playerMessage('We bar the door and sleep until dawn.');
    expect(await applyStoryRest({ userId, sessionId, rest: { type: 'long' } })).toBe('applied');
    const afterLong = await readSheet();
    expect(afterLong.stats?.current_hit_points).toBe(20);
    expect(afterLong.stats?.max_hit_points).toBe(20);
    // 2014: a long rest regains half the total dice (3 -> 1), so the short
    // rest's spend comes back by exactly one die.
    expect(afterLong.hit_dice?.[0].used_dice).toBe(spentDice - 1);

    await db.delete(restEvents).where(eq(restEvents.characterId, charId));
    await db.delete(characterHitDice).where(eq(characterHitDice.characterId, charId));
    await db.delete(dialogueHistory).where(eq(dialogueHistory.sessionId, sessionId));
    await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await db.delete(characterStats).where(eq(characterStats.characterId, charId));
    await db.delete(characters).where(eq(characters.id, charId));
    await db.delete(campaigns).where(eq(campaigns.id, campId));
  });

  it('#264: GET before any rest lazily creates hit-dice rows — remaining = total = level', async () => {
    if (!hasRealDb) return;

    const [{ id: campId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('264-get-camp') })
      .returning({ id: campaigns.id });
    const [{ id: charId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId: campId,
        name: testId('264-get-hero'),
        level: 3,
        class: 'Fighter',
      })
      .returning({ id: characters.id });

    // A character predating the rest system has no hit-dice rows (QA-058): the
    // sheet's GET must still serve dice so the first short rest offers the
    // spend prompt.
    const before = await db
      .select()
      .from(characterHitDice)
      .where(eq(characterHitDice.characterId, charId));
    expect(before).toEqual([]);

    const sheet = (await (await request(`/v1/characters/${charId}`, 'GET')).json()) as {
      hit_dice?: Array<{ die_type: string; total_dice: number; used_dice: number }>;
    };
    expect(sheet.hit_dice).toHaveLength(1);
    expect(sheet.hit_dice?.[0].die_type).toBe('d10');
    expect(sheet.hit_dice?.[0].total_dice).toBe(3);
    expect(sheet.hit_dice?.[0].used_dice).toBe(0);
    // remaining = total = level: nothing spent yet.
    expect((sheet.hit_dice?.[0].total_dice ?? 0) - (sheet.hit_dice?.[0].used_dice ?? 0)).toBe(3);

    // A second GET reuses the rows rather than duplicating them.
    const again = (await (await request(`/v1/characters/${charId}`, 'GET')).json()) as {
      hit_dice?: unknown[];
    };
    expect(again.hit_dice).toHaveLength(1);

    await db.delete(characterHitDice).where(eq(characterHitDice.characterId, charId));
    await db.delete(characters).where(eq(characters.id, charId));
    await db.delete(campaigns).where(eq(campaigns.id, campId));
  });

  it('#264: POST /v1/llm/generate applies the envelope rest through the story-rest wiring', async () => {
    if (!hasRealDb) return;

    const [{ id: campId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('264-routewire-camp') })
      .returning({ id: campaigns.id });
    const [{ id: charId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId: campId,
        name: testId('264-routewire-hero'),
        level: 3,
        class: 'Fighter',
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId: charId,
      maxHitPoints: 20,
      currentHitPoints: 6,
      temporaryHitPoints: 0,
      constitution: 12,
      isConscious: true,
      vitalState: 'standing',
    });
    const [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId: campId, characterId: charId })
      .returning({ id: gameSessions.id });
    await db.insert(dialogueHistory).values({
      sessionId,
      speakerType: 'player',
      message: 'We catch our breath behind the rocks for an hour.',
    });

    // The body shape of a DM turn: sessionId + dmReply + combatEntry. The
    // provider is stubbed at the top of this file; generatedText selects the
    // envelope it returns.
    const generateBody = {
      prompt: 'The party makes camp in the ruins. What do they see?',
      player_input: 'We catch our breath behind the rocks for an hour.',
      sessionId,
      dmReply: { messageId: '11111111-2222-4333-8444-555555555555', inCombat: false },
      combatEntry: {
        sessionId,
        player: { name: testId('264-routewire-hero'), initiativeModifier: 2 },
      },
      provider: 'openrouter',
      requestType: 'user',
      maxTokens: 8192,
      temperature: 0.9,
    };

    // The envelope carries a story rest: the llm.ts wiring must apply it
    // through RestService, not just narrate it.
    generatedText = JSON.stringify({
      text: 'You catch your breath behind the rocks and press on.',
      rest: { type: 'short' },
    });
    const res = await request('/v1/llm/generate', 'POST', generateBody);
    expect(res.status).toBe(200);

    const rests = await db.select().from(restEvents).where(eq(restEvents.characterId, charId));
    expect(rests).toHaveLength(1);
    expect(rests[0].restType).toBe('short');
    expect(rests[0].notes).toBe('story rest');
    // The rest went through RestService: hit-dice rows were created lazily.
    const dice = await db
      .select()
      .from(characterHitDice)
      .where(eq(characterHitDice.characterId, charId));
    expect(dice).toHaveLength(1);
    expect(dice[0].totalDice).toBe(3);

    // An envelope with no rest applies nothing: the wiring guard decides, not
    // just the applier's already-applied check (a new player message, so the
    // rest would not be a duplicate).
    generatedText = JSON.stringify({ text: 'The rocks are cold and the wind picks up.' });
    await db.insert(dialogueHistory).values({
      sessionId,
      speakerType: 'player',
      message: 'We keep walking.',
    });
    const res2 = await request('/v1/llm/generate', 'POST', generateBody);
    expect(res2.status).toBe(200);
    const restsAfter = await db.select().from(restEvents).where(eq(restEvents.characterId, charId));
    expect(restsAfter).toHaveLength(1);

    await db.delete(restEvents).where(eq(restEvents.characterId, charId));
    await db.delete(characterHitDice).where(eq(characterHitDice.characterId, charId));
    await db.delete(dialogueHistory).where(eq(dialogueHistory.sessionId, sessionId));
    await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await db.delete(characterStats).where(eq(characterStats.characterId, charId));
    await db.delete(characters).where(eq(characters.id, charId));
    await db.delete(campaigns).where(eq(campaigns.id, campId));
  });

  it('#751: a long rest typed in chat applies through POST /v1/llm/generate with no `rest` in the reply', async () => {
    if (!hasRealDb) return;

    const [{ id: campId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('751-typed-camp') })
      .returning({ id: campaigns.id });
    const [{ id: charId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId: campId,
        name: testId('751-typed-hero'),
        level: 1,
        class: 'Fighter',
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId: charId,
      maxHitPoints: 8,
      currentHitPoints: 1,
      temporaryHitPoints: 0,
      constitution: 12,
      isConscious: true,
      vitalState: 'standing',
    });
    const [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId: campId, characterId: charId })
      .returning({ id: gameSessions.id });
    // Hark P1016-029's line (#751), saved as the client saves the player turn.
    const typed = 'I take a full long rest - eight hours sleeping and tending my wounds.';
    await db.insert(dialogueHistory).values({ sessionId, speakerType: 'player', message: typed });

    const generateBody = {
      prompt: 'The party rests in the chasm. What happens?',
      player_input: typed,
      sessionId,
      dmReply: { messageId: '11111111-2222-4333-8444-666666666666', inCombat: false },
      combatEntry: {
        sessionId,
        player: { name: testId('751-typed-hero'), initiativeModifier: 2 },
      },
      provider: 'openrouter',
      requestType: 'user',
      maxTokens: 8192,
      temperature: 0.9,
    };
    // The DM narrates the rest but omits `rest`, as in the playtest.
    generatedText = JSON.stringify({ text: 'You settle against the stone and sleep.' });
    const res = await request('/v1/llm/generate', 'POST', generateBody);
    expect(res.status).toBe(200);

    const [stats] = await db
      .select({ hp: characterStats.currentHitPoints })
      .from(characterStats)
      .where(eq(characterStats.characterId, charId));
    expect(stats?.hp).toBe(8);
    const rests = await db.select().from(restEvents).where(eq(restEvents.characterId, charId));
    expect(rests).toHaveLength(1);
    expect(rests[0].restType).toBe('long');

    // Retry re-sends the same saved message: the #777 claim keeps it to one rest.
    const res2 = await request('/v1/llm/generate', 'POST', generateBody);
    expect(res2.status).toBe(200);
    expect(
      await db.select().from(restEvents).where(eq(restEvents.characterId, charId)),
    ).toHaveLength(1);

    await db.delete(restEvents).where(eq(restEvents.characterId, charId));
    await db.delete(characterHitDice).where(eq(characterHitDice.characterId, charId));
    await db.delete(dialogueHistory).where(eq(dialogueHistory.sessionId, sessionId));
    await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await db.delete(characterStats).where(eq(characterStats.characterId, charId));
    await db.delete(characters).where(eq(characters.id, charId));
    await db.delete(campaigns).where(eq(campaigns.id, campId));
  });

  it('#751: a short rest typed in chat spends hit dice and restores HP through POST /v1/llm/generate', async () => {
    if (!hasRealDb) return;

    const [{ id: campId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('751-typed-short-camp') })
      .returning({ id: campaigns.id });
    const [{ id: charId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId: campId,
        name: testId('751-typed-short-hero'),
        level: 3,
        class: 'Fighter',
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId: charId,
      maxHitPoints: 13,
      currentHitPoints: 2,
      temporaryHitPoints: 0,
      constitution: 14,
      isConscious: true,
      vitalState: 'standing',
    });
    const [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId: campId, characterId: charId })
      .returning({ id: gameSessions.id });
    // Hark N2-003's line (#751), saved as the client saves the player turn.
    // The character starts with no hit-dice rows, as in that report.
    const typed = 'I take a short rest.';
    await db.insert(dialogueHistory).values({ sessionId, speakerType: 'player', message: typed });

    const generateBody = {
      prompt: 'The fighter finds a moment of quiet. What happens?',
      player_input: typed,
      sessionId,
      dmReply: { messageId: '11111111-2222-4333-8444-777777777777', inCombat: false },
      combatEntry: {
        sessionId,
        player: { name: testId('751-typed-short-hero'), initiativeModifier: 2 },
      },
      provider: 'openrouter',
      requestType: 'user',
      maxTokens: 8192,
      temperature: 0.9,
    };
    // The DM narrates the rest but omits `rest`, as in the playtest: the
    // typed declaration is what applies it.
    generatedText = JSON.stringify({ text: 'You lean on your sword and breathe.' });
    const res = await request('/v1/llm/generate', 'POST', generateBody);
    expect(res.status).toBe(200);

    const rests = await db.select().from(restEvents).where(eq(restEvents.characterId, charId));
    expect(rests).toHaveLength(1);
    expect(rests[0].restType).toBe('short');
    expect(rests[0].hitDiceSpent).toBeGreaterThan(0);
    expect(rests[0].hpRestored).toBeGreaterThan(0);

    // The sheet's data source shows the recovery and the spent dice — this is
    // what the live sheet renders once the story_rest invalidation lands.
    const sheet = (await (await request(`/v1/characters/${charId}`, 'GET')).json()) as {
      stats?: { current_hit_points?: number; max_hit_points?: number };
      hit_dice?: Array<{ die_type: string; total_dice: number; used_dice: number }>;
    };
    expect(sheet.stats?.current_hit_points).toBeGreaterThan(2);
    expect(sheet.stats?.current_hit_points).toBeLessThanOrEqual(13);
    expect(sheet.hit_dice).toHaveLength(1);
    expect(sheet.hit_dice?.[0].used_dice).toBe(rests[0].hitDiceSpent ?? 0);
    // The dice stop early only at full HP: short of full means all 3 went.
    if ((sheet.stats?.current_hit_points ?? 0) < 13) {
      expect(sheet.hit_dice?.[0].used_dice).toBe(3);
    }

    // Retry re-sends the same saved message: the #777 claim keeps it to one rest.
    const res2 = await request('/v1/llm/generate', 'POST', generateBody);
    expect(res2.status).toBe(200);
    expect(
      await db.select().from(restEvents).where(eq(restEvents.characterId, charId)),
    ).toHaveLength(1);

    await db.delete(restEvents).where(eq(restEvents.characterId, charId));
    await db.delete(characterHitDice).where(eq(characterHitDice.characterId, charId));
    await db.delete(dialogueHistory).where(eq(dialogueHistory.sessionId, sessionId));
    await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await db.delete(characterStats).where(eq(characterStats.characterId, charId));
    await db.delete(characters).where(eq(characters.id, charId));
    await db.delete(campaigns).where(eq(campaigns.id, campId));
  });

  it('#751 follow-up: a typed short rest decrements the sheet Hit Dice counter; a long rest restores it', async () => {
    if (!hasRealDb) return;

    const [{ id: campId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('751-line-camp') })
      .returning({ id: campaigns.id });
    const [{ id: charId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId: campId,
        name: testId('751-line-hero'),
        level: 3,
        class: 'Fighter',
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId: charId,
      maxHitPoints: 13,
      currentHitPoints: 2,
      temporaryHitPoints: 0,
      constitution: 14,
      isConscious: true,
      vitalState: 'standing',
    });
    const [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId: campId, characterId: charId })
      .returning({ id: gameSessions.id });
    // Hark N2-003's line (#751), saved as the client saves the player turn.
    const typed = 'I take a short rest.';
    await db.insert(dialogueHistory).values({ sessionId, speakerType: 'player', message: typed });

    const generateBody = {
      prompt: 'The fighter finds a moment of quiet. What happens?',
      player_input: typed,
      sessionId,
      dmReply: { messageId: '11111111-2222-4333-8444-888888888888', inCombat: false },
      combatEntry: {
        sessionId,
        player: { name: testId('751-line-hero'), initiativeModifier: 2 },
      },
      provider: 'openrouter',
      requestType: 'user',
      maxTokens: 8192,
      temperature: 0.9,
    };
    generatedText = JSON.stringify({ text: 'You lean on your sword and breathe.' });
    const res = await request('/v1/llm/generate', 'POST', generateBody);
    expect(res.status).toBe(200);

    const rests = await db.select().from(restEvents).where(eq(restEvents.characterId, charId));
    expect(rests).toHaveLength(1);
    const spent = rests[0].hitDiceSpent ?? 0;
    const restored = rests[0].hpRestored ?? 0;
    expect(spent).toBeGreaterThan(0);
    expect(restored).toBeGreaterThan(0);

    // The delivered engine line itself is asserted in
    // story-once-message.real-db.test.ts: this suite mocks
    // SessionMessageService (addMessages is the notice's write path), so the
    // line cannot land here. What this route test proves is the sheet side.

    // The sheet-side read shows the decremented counter.
    const sheetAfterShort = (await (await request(`/v1/characters/${charId}`, 'GET')).json()) as {
      stats?: { current_hit_points?: number };
      hit_dice?: Array<{ total_dice: number; used_dice: number }>;
    };
    expect(sheetAfterShort.hit_dice).toHaveLength(1);
    expect(sheetAfterShort.hit_dice?.[0].used_dice).toBe(spent);
    // The HP the line and the event report is the sheet's actual gain: the
    // last die can overshoot max HP and the write caps there, so the
    // reported restore must equal the sheet's delta, not the raw dice sum.
    expect(sheetAfterShort.stats?.current_hit_points).toBe(2 + restored);

    // Retry re-sends the same saved message: still exactly one rest.
    const res2 = await request('/v1/llm/generate', 'POST', generateBody);
    expect(res2.status).toBe(200);
    expect(
      await db.select().from(restEvents).where(eq(restEvents.characterId, charId)),
    ).toHaveLength(1);

    // A long rest typed in chat restores the counter (2014: regain half of
    // the total dice — 3 → 1 back) and returns HP to full.
    await db
      .insert(dialogueHistory)
      .values({ sessionId, speakerType: 'player', message: 'I take a long rest.' });
    generatedText = JSON.stringify({ text: 'You sleep through the quiet hours.' });
    const res3 = await request('/v1/llm/generate', 'POST', {
      ...generateBody,
      player_input: 'I take a long rest.',
      dmReply: { messageId: '11111111-2222-4333-8444-999999999999', inCombat: false },
    });
    expect(res3.status).toBe(200);
    const sheetAfterLong = (await (await request(`/v1/characters/${charId}`, 'GET')).json()) as {
      stats?: { current_hit_points?: number };
      hit_dice?: Array<{ total_dice: number; used_dice: number }>;
    };
    expect(sheetAfterLong.stats?.current_hit_points).toBe(13);
    expect(sheetAfterLong.hit_dice?.[0].used_dice).toBe(spent - 1);

    await db.delete(restEvents).where(eq(restEvents.characterId, charId));
    await db.delete(characterHitDice).where(eq(characterHitDice.characterId, charId));
    await db.delete(dialogueHistory).where(eq(dialogueHistory.sessionId, sessionId));
    await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await db.delete(characterStats).where(eq(characterStats.characterId, charId));
    await db.delete(characters).where(eq(characters.id, charId));
    await db.delete(campaigns).where(eq(campaigns.id, campId));
  });

  it('#264: five concurrent first-GETs create exactly one hit-dice row set', async () => {
    if (!hasRealDb) return;

    const [{ id: campId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('264-race-camp') })
      .returning({ id: campaigns.id });
    const [{ id: charId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId: campId,
        name: testId('264-race-hero'),
        level: 3,
        class: 'Fighter',
      })
      .returning({ id: characters.id });

    // The sheet fires several GETs in parallel; every one of them takes the
    // lazy-create path on a character with no rows. Without the
    // INSERT ... WHERE NOT EXISTS guard this double-inserts (6d10 on a
    // Fighter 3).
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => request(`/v1/characters/${charId}`, 'GET')),
    );
    for (const res of responses) expect(res.status).toBe(200);
    const sheets = (await Promise.all(responses.map((res) => res.json()))) as Array<{
      hit_dice?: unknown[];
    }>;
    for (const sheet of sheets) expect(sheet.hit_dice).toHaveLength(1);

    const rows = await db
      .select()
      .from(characterHitDice)
      .where(eq(characterHitDice.characterId, charId));
    expect(rows).toHaveLength(1);
    expect(rows[0].totalDice).toBe(3);
    expect(rows[0].usedDice).toBe(0);

    await db.delete(characterHitDice).where(eq(characterHitDice.characterId, charId));
    await db.delete(characters).where(eq(characters.id, charId));
    await db.delete(campaigns).where(eq(campaigns.id, campId));
  });

  it('#264: five concurrent ensureHitDice calls create exactly one hit-dice row set', async () => {
    if (!hasRealDb) return;
    const { RestHitDiceService } = await import('../../../services/rest/rest-hit-dice-service.js');

    const [{ id: campId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('264-race-direct-camp') })
      .returning({ id: campaigns.id });
    const [{ id: charId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId: campId,
        name: testId('264-race-direct-hero'),
        level: 3,
        class: 'Fighter',
      })
      .returning({ id: characters.id });

    // Tighter race than the GET test above: the service calls run with no
    // route machinery between them, so all five hit the check-and-insert
    // together. The advisory lock serializes them; every caller sees one row.
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        RestHitDiceService.ensureHitDice(charId, userId, 'Fighter', 3, null),
      ),
    );
    for (const created of results) {
      expect(created).toHaveLength(1);
      expect(created[0].totalDice).toBe(3);
      expect(created[0].usedDice).toBe(0);
    }
    const stored = await db
      .select()
      .from(characterHitDice)
      .where(eq(characterHitDice.characterId, charId));
    expect(stored).toHaveLength(1);

    await db.delete(characterHitDice).where(eq(characterHitDice.characterId, charId));
    await db.delete(characters).where(eq(characters.id, charId));
    await db.delete(campaigns).where(eq(campaigns.id, campId));
  });
});
