/**
 * #224: Use Feature and rests against a real database, through the real
 * character and rest routes. Auth is stubbed. CharacterService and RestService
 * are not.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts.
 */
import { afterAll, beforeAll, expect, it, mock } from 'bun:test';
import { eq } from 'drizzle-orm';

import { campaigns, characterEquipment, characterStats, characters, restEvents } from '../../../../../db/schema/index';
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
  return createRequestPipelineApp().use(charactersRoutes).use(restRoutes).use(issue1784DataRoutes);
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
      (await db.select().from(characterEquipment).where(eq(characterEquipment.characterId, charId))).map(
        (r) => r.itemName,
      );
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
});
