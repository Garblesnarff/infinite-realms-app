/**
 * #1225: a limited class feature with a NULL library `uses_count` is no longer spent as
 * unlimited. Real database, real routes:
 *
 * - characters are created through POST /v1/characters, so their features are the rows the real
 *   level grant picks from the replayed library (Rage and Bardic Inspiration come from the
 *   generated SRD seed with `uses_count` NULL; a Cleric's Channel Divinity is the legacy
 *   per-tier rows 1/rest at 2nd and 2/rest at 6th);
 * - uses go through POST /v1/class-features/characters/:id/features/:featureId/use and rests
 *   through .../features/restore, the routes the sheet calls.
 */
import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { and, eq, inArray } from 'drizzle-orm';

import {
  campaigns,
  characterFeatures,
  characterSpellSlots,
  characters,
  classFeaturesLibrary,
  dialogueHistory,
  featureUsageLog,
  gameSessions,
} from '../../../../../db/schema/index';
import {
  divineSmiteUseBody,
  flexibleCastingConvertUseBody,
  flexibleCastingCreateUseBody,
  quickenedMetamagicUseBody,
} from '../../../../../shared/test-fixtures/feature-use-bodies';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from '../../../services/__tests__/fixtures/real-db.js';

let userId = '';

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId, email: 'limited-1225@example.test', plan: 'free' },
    error: null,
  }),
}));

if (hasRealDb && !process.env.DATABASE_URL && process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
if (hasRealDb) {
  process.env.CORS_ORIGIN ??= 'http://localhost:5173';
  process.env.WORKOS_API_KEY ??= 'test-workos-api-key';
  process.env.WORKOS_CLIENT_ID ??= 'test-workos-client-id';
  process.env.PORT ??= '8888';
}

/** The seeder's wire body (the #829 starter-template shape), per class. */
const body = (
  campaignId: string,
  input: { name: string; className: string; level: number; stats: Record<string, number> },
): Record<string, unknown> => ({
  name: input.name,
  race: 'Human',
  subrace: null,
  class: input.className,
  level: input.level,
  background: 'Soldier',
  backstory_elements: null,
  description: null,
  campaign_id: campaignId,
  skill_proficiencies: 'Athletics, Perception',
  languages: ['Common'],
  image_url: null,
  avatar_url: null,
  background_image: null,
  cantrips: '',
  known_spells: '',
  prepared_spells: '',
  total_level: input.level,
  stats: input.stats,
  equipment: [],
});

const STATS = {
  strength: 16,
  dexterity: 12,
  constitution: 14,
  intelligence: 10,
  wisdom: 14,
  charisma: 16,
};

describeWithDb('limited class features are counted, never unlimited (#1225)', () => {
  const db = hasRealDb ? realDb() : (null as never);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any;
  let campaignId = '';
  const createdCharacterIds: string[] = [];
  const insertedLibraryIds: string[] = [];
  let barbarianId = '';
  let clericId = '';
  let bardId = '';
  // Round 2: features that spend another resource, and a rest read from the table.
  let cleric3Id = '';
  let monkId = '';
  let wizardId = '';
  let sorcererId = '';
  let paladinId = '';
  // #1233: fresh characters per variable-cost test, so no test reads another's spent state.
  let paladin3Id = '';
  let paladinDrainId = '';
  let sorcererQuickId = '';
  let sorcererConvertId = '';
  let sorcererCreateId = '';
  // #1233: a level-1 Sorcerer holds no Font of Magic row, so a convert cannot grant.
  let sorcererNoPoolId = '';
  // #1233 round 2: a fresh Sorcerer for the long-rest expiry test.
  let sorcererRestId = '';
  let sessionId = '';

  const api = async (path: string, method: string, payload?: unknown) => {
    const response: Response = await app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
        body: payload !== undefined ? JSON.stringify(payload) : undefined,
      }),
    );
    const text = await response.text();
    return { status: response.status, body: text ? (JSON.parse(text) as Record<string, any>) : {} };
  };

  const create = async (payload: Record<string, unknown>): Promise<string> => {
    const created = await api('/v1/characters', 'POST', payload);
    expect(created.status).toBeLessThan(300);
    const id = (created.body.id ?? created.body.character?.id) as string;
    createdCharacterIds.push(id);
    return id;
  };

  /** The library row a character was granted under this name (the real grant's pick). */
  const granted = async (characterId: string, featureName: string) => {
    const rows = await db
      .select({
        featureId: characterFeatures.featureId,
        usesRemaining: characterFeatures.usesRemaining,
        usesCount: classFeaturesLibrary.usesCount,
      })
      .from(characterFeatures)
      .innerJoin(classFeaturesLibrary, eq(characterFeatures.featureId, classFeaturesLibrary.id))
      .where(
        and(
          eq(characterFeatures.characterId, characterId),
          eq(classFeaturesLibrary.featureName, featureName),
        ),
      );
    expect(rows).toHaveLength(1);
    return rows[0];
  };

  const use = (characterId: string, featureId: string) =>
    api(`/v1/class-features/characters/${characterId}/features/${featureId}/use`, 'POST', {});
  /** The use route with the #1233 wire body (slotLevel / option). */
  const postUse = (characterId: string, featureId: string, payload: Record<string, unknown>) =>
    api(`/v1/class-features/characters/${characterId}/features/${featureId}/use`, 'POST', payload);
  const rest = (characterId: string, restType: 'short' | 'long') =>
    api(`/v1/class-features/characters/${characterId}/features/restore`, 'POST', { restType });
  /** A long rest through the real rest route (sheet rest, no session). */
  const longRest = (characterId: string) =>
    api(`/v1/rest/characters/${characterId}/long`, 'POST', {});

  /** The spell-slot row for a level, or null when no row has been derived yet. */
  const slotRow = async (characterId: string, spellLevel: number) => {
    const [row] = await db
      .select()
      .from(characterSpellSlots)
      .where(
        and(
          eq(characterSpellSlots.characterId, characterId),
          eq(characterSpellSlots.spellLevel, spellLevel),
        ),
      );
    return row ?? null;
  };

  /** A test-only library row granted to a character, for the fail-closed and passive cases. */
  const grantTestFeature = async (
    characterId: string,
    input: { name: string; usesPerRest: string | null },
  ): Promise<string> => {
    const [row] = await db
      .insert(classFeaturesLibrary)
      .values({
        className: 'Barbarian',
        featureName: input.name,
        levelAcquired: 1,
        description: 'Test-only feature (#1225).',
        usageType: input.usesPerRest ? 'limited_use' : 'passive',
        usesPerRest: input.usesPerRest,
        usesCount: null,
      } as typeof classFeaturesLibrary.$inferInsert)
      .returning({ id: classFeaturesLibrary.id });
    insertedLibraryIds.push(row.id);
    await db.insert(characterFeatures).values({
      characterId,
      featureId: row.id,
      usesRemaining: null,
      isActive: true,
      acquiredAtLevel: 1,
    });
    return row.id;
  };

  beforeAll(async () => {
    if (!hasRealDb) return;
    userId = testId('user-1225');
    const pipeline = await importWithRealDb(async () => {
      const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
      const { charactersRoutes } = await import('../characters.js');
      const { classFeaturesRoutes } = await import('../class-features.js');
      const { restRoutes } = await import('../rest.js');
      return { createRequestPipelineApp, charactersRoutes, classFeaturesRoutes, restRoutes };
    });
    app = pipeline
      .createRequestPipelineApp()
      .use(pipeline.charactersRoutes)
      .use(pipeline.classFeaturesRoutes)
      .use(pipeline.restRoutes);
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('1225-campaign') })
      .returning({ id: campaigns.id });
    barbarianId = await create(
      body(campaignId, { name: 'Brakka', className: 'Barbarian', level: 3, stats: STATS }),
    );
    clericId = await create(
      body(campaignId, { name: 'Sister Ama', className: 'Cleric', level: 6, stats: STATS }),
    );
    bardId = await create(
      body(campaignId, { name: 'Lute', className: 'Bard', level: 1, stats: STATS }),
    );
    cleric3Id = await create(
      body(campaignId, { name: 'Brother Vell', className: 'Cleric', level: 3, stats: STATS }),
    );
    monkId = await create(
      body(campaignId, { name: 'Quiet Reed', className: 'Monk', level: 3, stats: STATS }),
    );
    wizardId = await create(
      body(campaignId, { name: 'Odile', className: 'Wizard', level: 1, stats: STATS }),
    );
    sorcererId = await create(
      body(campaignId, { name: 'Ember', className: 'Sorcerer', level: 3, stats: STATS }),
    );
    paladinId = await create(
      body(campaignId, { name: 'Sir Hale', className: 'Paladin', level: 2, stats: STATS }),
    );
    // #1233: a level-3 Paladin can Smite (#1229's refusal left the one-shot premade unable
    // to), and each variable-cost test gets a fresh Sorcerer / Paladin of its own.
    paladin3Id = await create(
      body(campaignId, { name: 'Dame Brigid', className: 'Paladin', level: 3, stats: STATS }),
    );
    paladinDrainId = await create(
      body(campaignId, { name: 'Ser Odo', className: 'Paladin', level: 3, stats: STATS }),
    );
    sorcererQuickId = await create(
      body(campaignId, { name: 'Fenn', className: 'Sorcerer', level: 3, stats: STATS }),
    );
    sorcererConvertId = await create(
      body(campaignId, { name: 'Ilsa', className: 'Sorcerer', level: 3, stats: STATS }),
    );
    sorcererCreateId = await create(
      body(campaignId, { name: 'Perrin', className: 'Sorcerer', level: 3, stats: STATS }),
    );
    sorcererNoPoolId = await create(
      body(campaignId, { name: 'Wren', className: 'Sorcerer', level: 1, stats: STATS }),
    );
    sorcererRestId = await create(
      body(campaignId, { name: 'Tamsin', className: 'Sorcerer', level: 3, stats: STATS }),
    );
    [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId: paladin3Id, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    await db
      .delete(gameSessions)
      .where(eq(gameSessions.id, sessionId))
      .catch(() => {});
    if (createdCharacterIds.length > 0) {
      await db
        .delete(characterFeatures)
        .where(inArray(characterFeatures.characterId, createdCharacterIds))
        .catch(() => {});
      await db
        .delete(characters)
        .where(inArray(characters.id, createdCharacterIds))
        .catch(() => {});
    }
    if (insertedLibraryIds.length > 0) {
      await db
        .delete(classFeaturesLibrary)
        .where(inArray(classFeaturesLibrary.id, insertedLibraryIds))
        .catch(() => {});
    }
    await db
      .delete(campaigns)
      .where(eq(campaigns.id, campaignId))
      .catch(() => {});
    await closeRealDb();
  });

  test('Rage (NULL library count) has its level-3 uses, then is refused; a long rest restores it, a short one does not', async () => {
    const rage = await granted(barbarianId, 'Rage');
    expect(rage).toMatchObject({ usesCount: null, usesRemaining: null });

    for (const left of [2, 1, 0]) {
      const spent = await use(barbarianId, rage.featureId);
      expect(spent.status).toBe(200);
      expect(spent.body.usesRemaining).toBe(left);
    }
    const fourth = await use(barbarianId, rage.featureId);
    expect(fourth.status).toBe(400);
    expect(fourth.body.message).toBe('No uses remaining for Rage');

    // Rage recharges on a long rest only.
    expect((await rest(barbarianId, 'short')).status).toBe(200);
    expect((await use(barbarianId, rage.featureId)).status).toBe(400);
    expect((await rest(barbarianId, 'long')).status).toBe(200);
    expect((await granted(barbarianId, 'Rage')).usesRemaining).toBe(3);
    expect((await use(barbarianId, rage.featureId)).body.usesRemaining).toBe(2);
  });

  test('Bardic Inspiration counts CHA (+3), not "unlimited"', async () => {
    const inspiration = await granted(bardId, 'Bardic Inspiration (d6)');
    expect(inspiration.usesCount).toBeNull();
    for (const left of [2, 1, 0]) {
      expect((await use(bardId, inspiration.featureId)).body.usesRemaining).toBe(left);
    }
    expect((await use(bardId, inspiration.featureId)).status).toBe(400);
  });

  test('a level-6 Cleric holding both Channel Divinity tier rows has 2 uses, not 1 + 2', async () => {
    const tier1 = await granted(clericId, 'Channel Divinity');
    const tier2 = await granted(clericId, 'Channel Divinity (2/rest)');
    // Spending through either tier row draws on the one family count.
    expect((await use(clericId, tier1.featureId)).body.usesRemaining).toBe(1);
    expect((await use(clericId, tier2.featureId)).body.usesRemaining).toBe(0);
    const third = await use(clericId, tier1.featureId);
    expect(third.status).toBe(400);
    expect(third.body.message).toBe('No uses remaining for Channel Divinity');
    // A short rest gives the family its 2 back.
    expect((await rest(clericId, 'short')).status).toBe(200);
    expect((await use(clericId, tier1.featureId)).body.usesRemaining).toBe(1);
  });

  test('a Channel Divinity option spends one Channel Divinity use (round 2: routed, not refused)', async () => {
    const [preserveLife] = await db
      .select({ id: classFeaturesLibrary.id })
      .from(classFeaturesLibrary)
      .where(eq(classFeaturesLibrary.featureName, 'Channel Divinity: Preserve Life'))
      .limit(1);
    await db.insert(characterFeatures).values({
      characterId: clericId,
      featureId: preserveLife.id,
      usesRemaining: null,
      isActive: true,
      acquiredAtLevel: 2,
    });
    // The test above left the level-6 Cleric 1 of 2 Channel Divinity uses.
    const spent = await use(clericId, preserveLife.id);
    expect(spent.status).toBe(200);
    expect(spent.body.usesRemaining).toBe(0);
    const refused = await use(clericId, preserveLife.id);
    expect(refused.status).toBe(400);
    expect(refused.body.message).toBe(
      'Not enough Channel Divinity left for Channel Divinity: Preserve Life (it costs 1)',
    );
  });

  test('a level-3 Cleric with 1 Channel Divinity use turns undead once; the second try is refused', async () => {
    const turnUndead = await granted(cleric3Id, 'Channel Divinity: Turn Undead');
    // The generated seed row: no rest tag, no count -- it used to spend as unlimited.
    expect(turnUndead.usesCount).toBeNull();
    const first = await use(cleric3Id, turnUndead.featureId);
    expect(first.status).toBe(200);
    expect(first.body.usesRemaining).toBe(0);
    const second = await use(cleric3Id, turnUndead.featureId);
    expect(second.status).toBe(400);
    expect(second.body.message).toBe(
      'Not enough Channel Divinity left for Channel Divinity: Turn Undead (it costs 1)',
    );
    // A short rest gives Channel Divinity back, so Turn Undead works again.
    expect((await rest(cleric3Id, 'short')).status).toBe(200);
    expect((await use(cleric3Id, turnUndead.featureId)).status).toBe(200);
  });

  test('a level-3 Monk with 3 ki uses Flurry of Blows 3 times; the 4th is refused', async () => {
    const flurry = await granted(monkId, 'Flurry of Blows');
    expect(flurry.usesCount).toBeNull();
    for (const left of [2, 1, 0]) {
      const spent = await use(monkId, flurry.featureId);
      expect(spent.status).toBe(200);
      expect(spent.body.usesRemaining).toBe(left);
    }
    const fourth = await use(monkId, flurry.featureId);
    expect(fourth.status).toBe(400);
    expect(fourth.body.message).toBe('Not enough ki points left for Flurry of Blows (it costs 1)');
    // Patient Defense draws on the same ki.
    const patient = await granted(monkId, 'Patient Defense');
    expect((await use(monkId, patient.featureId)).status).toBe(400);
    expect((await rest(monkId, 'short')).status).toBe(200);
    expect((await use(monkId, patient.featureId)).body.usesRemaining).toBe(2);
  });

  test('Metamagic and Divine Smite are refused with what they spend, never spent as unlimited', async () => {
    const metamagic = await granted(sorcererId, 'Metamagic');
    const refusedMeta = await use(sorcererId, metamagic.featureId);
    expect(refusedMeta.status).toBe(400);
    expect(refusedMeta.body.message).toBe(
      'Metamagic has no uses of its own: it spends sorcery points (Font of Magic), so it was not spent here.',
    );
    const smite = await granted(paladinId, 'Divine Smite');
    const refusedSmite = await use(paladinId, smite.featureId);
    expect(refusedSmite.status).toBe(400);
    expect(refusedSmite.body.message).toBe(
      'Divine Smite has no uses of its own: it spends a spell slot, so it was not spent here.',
    );
  });

  test('a level-3 Paladin smites with a 1st-level slot: the slot is spent and the engine row carries +2d8', async () => {
    const smite = await granted(paladin3Id, 'Divine Smite');
    const spent = await postUse(paladin3Id, smite.featureId, { ...divineSmiteUseBody, sessionId });
    expect(spent.status).toBe(200);
    expect(spent.body.effect).toBe(
      'Divine Smite: +2d8 radiant damage (3d8 against undead or fiends).',
    );
    expect(spent.body.usesRemaining).toBe(2);
    expect(await slotRow(paladin3Id, 1)).toMatchObject({ totalSlots: 3, usedSlots: 1 });
    // The engine row is a persisted `system` line in the session's history.
    const lines = await db
      .select()
      .from(dialogueHistory)
      .where(
        and(eq(dialogueHistory.sessionId, sessionId), eq(dialogueHistory.speakerType, 'system')),
      );
    expect(lines.some((line) => line.message.includes('+2d8 radiant damage'))).toBe(true);
    // The spend is logged against the Smite row.
    const logs = await db
      .select()
      .from(featureUsageLog)
      .where(
        and(
          eq(featureUsageLog.characterId, paladin3Id),
          eq(featureUsageLog.featureId, smite.featureId),
        ),
      );
    expect(logs.length).toBe(1);
  });

  test('a Smite with no slots left is refused, naming the slot', async () => {
    const smite = await granted(paladinDrainId, 'Divine Smite');
    const first = await postUse(paladinDrainId, smite.featureId, divineSmiteUseBody);
    expect(first.status).toBe(200);
    // A level-3 Paladin holds 3 first-level slots; drain whatever the table grants.
    const row = await slotRow(paladinDrainId, 1);
    expect(row?.totalSlots).toBeGreaterThan(0);
    const total = row?.totalSlots ?? 0;
    for (let i = 1; i < total; i++) {
      expect((await postUse(paladinDrainId, smite.featureId, divineSmiteUseBody)).status).toBe(200);
    }
    expect(await slotRow(paladinDrainId, 1)).toMatchObject({ totalSlots: total, usedSlots: total });
    const refused = await postUse(paladinDrainId, smite.featureId, divineSmiteUseBody);
    expect(refused.status).toBe(400);
    expect(refused.body.message).toBe('No available level 1 spell slots');
  });

  test('a Sorcerer spends 2 sorcery points on Quickened Spell, and a second one is refused', async () => {
    const metamagic = await granted(sorcererQuickId, 'Metamagic');
    const spent = await postUse(sorcererQuickId, metamagic.featureId, quickenedMetamagicUseBody);
    expect(spent.status).toBe(200);
    expect(spent.body.message).toBe(
      'Metamagic used (Quickened Spell). 1 sorcery points (Font of Magic) remaining.',
    );
    expect(spent.body.usesRemaining).toBe(1);
    const refused = await postUse(sorcererQuickId, metamagic.featureId, quickenedMetamagicUseBody);
    expect(refused.status).toBe(400);
    expect(refused.body.message).toBe('Not enough Font of Magic left for Metamagic (it costs 2)');
  });

  test('Flexible Casting converts a 1st-level slot into a sorcery point, capped at the full count', async () => {
    const converting = await granted(sorcererConvertId, 'Flexible Casting: Converting Spell Slot');
    const metamagic = await granted(sorcererConvertId, 'Metamagic');
    // Spend down to 1 point first, so the grant is visible.
    expect(
      (await postUse(sorcererConvertId, metamagic.featureId, quickenedMetamagicUseBody)).body
        .usesRemaining,
    ).toBe(1);
    const converted = await postUse(
      sorcererConvertId,
      converting.featureId,
      flexibleCastingConvertUseBody,
    );
    expect(converted.status).toBe(200);
    expect(converted.body.usesRemaining).toBe(2);
    expect(converted.body.message).toBe(
      'Flexible Casting: Converting Spell Slot used. Converted a level 1 spell slot into 1 sorcery point. 2 sorcery points remaining.',
    );
    // The cap: a second conversion at 2 of 3 points would reach 4 without the
    // LEAST(full, ...) cap in the grant. It lands at 3, the full count, while the
    // slot is still spent.
    const capped = await postUse(sorcererConvertId, converting.featureId, { option: '2' });
    expect(capped.status).toBe(200);
    expect(capped.body.usesRemaining).toBe(3);
    expect(capped.body.message).toBe(
      'Flexible Casting: Converting Spell Slot used. Converted a level 2 spell slot into 2 sorcery points. 3 sorcery points remaining.',
    );
    expect(await slotRow(sorcererConvertId, 1)).toMatchObject({ usedSlots: 1 });
    expect(await slotRow(sorcererConvertId, 2)).toMatchObject({ usedSlots: 1 });
  });

  test('Flexible Casting creates a 2nd-level slot for 3 sorcery points, and refuses a 6th-level one', async () => {
    const creating = await granted(sorcererCreateId, 'Flexible Casting: Creating Spell Slots');
    // Slot rows derive lazily, so the grant is asserted relatively: exactly one total slot
    // appears, and no used slot.
    const before = await slotRow(sorcererCreateId, 2);
    const created = await postUse(
      sorcererCreateId,
      creating.featureId,
      flexibleCastingCreateUseBody,
    );
    expect(created.status).toBe(200);
    expect(created.body.usesRemaining).toBe(0);
    expect(await slotRow(sorcererCreateId, 2)).toMatchObject({
      totalSlots: (before?.totalSlots ?? 0) + 1,
      usedSlots: before?.usedSlots ?? 0,
    });
    const refused = await postUse(sorcererCreateId, creating.featureId, { option: '6' });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toBe(
      'Flexible Casting: Creating Spell Slots cannot create a slot above 5th level: send option "1" to "5".',
    );
  });

  test('a slot created by Flexible Casting vanishes at the end of a long rest (PHB p.101)', async () => {
    const creating = await granted(sorcererRestId, 'Flexible Casting: Creating Spell Slots');
    const created = await postUse(sorcererRestId, creating.featureId, flexibleCastingCreateUseBody);
    expect(created.status).toBe(200);
    const before = await slotRow(sorcererRestId, 2);
    expect(before).not.toBeNull();
    const createdTotal = before?.totalSlots ?? 0;
    expect(createdTotal).toBeGreaterThan(0);
    const rested = await longRest(sorcererRestId);
    expect(rested.status).toBe(200);
    // Exactly the created slot is gone: totals re-sync to progression, used is 0.
    expect(await slotRow(sorcererRestId, 2)).toMatchObject({
      totalSlots: createdTotal - 1,
      usedSlots: 0,
    });
  });

  test('converting without a Font of Magic row refuses before spending the slot', async () => {
    // Wren is level 1, so the level grant holds no Font of Magic row and the grant
    // cannot land. Grant her the Converting row alone (the real library row).
    const [library] = await db
      .select({ id: classFeaturesLibrary.id })
      .from(classFeaturesLibrary)
      .where(
        and(
          eq(classFeaturesLibrary.className, 'Sorcerer'),
          eq(classFeaturesLibrary.featureName, 'Flexible Casting: Converting Spell Slot'),
        ),
      );
    expect(library).toBeDefined();
    await db.insert(characterFeatures).values({
      characterId: sorcererNoPoolId,
      featureId: library.id,
      usesRemaining: null,
      isActive: true,
      acquiredAtLevel: 2,
    });
    const refused = await postUse(sorcererNoPoolId, library.id, flexibleCastingConvertUseBody);
    expect(refused.status).toBe(400);
    expect(refused.body.message).toBe(
      'Flexible Casting: Converting Spell Slot grants Font of Magic, which this character does not have',
    );
    // The refusal precedes the spend: no slot was used.
    expect((await slotRow(sorcererNoPoolId, 1))?.usedSlots ?? 0).toBe(0);
  });

  test('a variable-cost use with a missing or unknown input refuses with what to send', async () => {
    const metamagic = await granted(sorcererQuickId, 'Metamagic');
    const unknown = await postUse(sorcererQuickId, metamagic.featureId, { option: 'silent' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.message).toBe(
      'Metamagic needs an option: careful, distant, empowered, extended, heightened, quickened, subtle, or twinned:<spell level>.',
    );
    const smite = await granted(paladinDrainId, 'Divine Smite');
    const noSlot = await postUse(paladinDrainId, smite.featureId, { option: 'quickened' });
    expect(noSlot.status).toBe(400);
    expect(noSlot.body.message).toBe(
      'Divine Smite spends a spell slot: send the slot level to spend (slotLevel 1-9).',
    );
  });

  test('Arcane Recovery comes back on a long rest even when its row is tagged short_rest', async () => {
    // The generated seed's row shape (20261009...sql:535): short_rest, count 1. In a database
    // where the legacy long_rest row won the dedupe, the real grant holds that one, so this test
    // swaps in a row with the generated (wrong) tag.
    const legacy = await granted(wizardId, 'Arcane Recovery');
    await db
      .delete(characterFeatures)
      .where(
        and(
          eq(characterFeatures.characterId, wizardId),
          eq(characterFeatures.featureId, legacy.featureId),
        ),
      );
    const [row] = await db
      .insert(classFeaturesLibrary)
      .values({
        className: 'Wizard',
        featureName: 'Arcane Recovery',
        levelAcquired: 1,
        description: 'Test-only copy of the generated row (#1225).',
        usageType: 'limited_use',
        usesPerRest: 'short_rest',
        usesCount: 1,
      } as typeof classFeaturesLibrary.$inferInsert)
      .returning({ id: classFeaturesLibrary.id });
    insertedLibraryIds.push(row.id);
    await db.insert(characterFeatures).values({
      characterId: wizardId,
      featureId: row.id,
      usesRemaining: 1,
      isActive: true,
      acquiredAtLevel: 1,
    });

    expect((await use(wizardId, row.id)).body.usesRemaining).toBe(0);
    expect((await rest(wizardId, 'short')).status).toBe(200);
    const afterShort = await use(wizardId, row.id);
    expect(afterShort.status).toBe(400);
    expect(afterShort.body.message).toBe('No uses remaining for Arcane Recovery');
    expect((await rest(wizardId, 'long')).status).toBe(200);
    expect((await use(wizardId, row.id)).body.usesRemaining).toBe(0);
  });

  test('a limited feature the engine cannot count is refused (fail closed); a passive one is unaffected', async () => {
    const limitedId = await grantTestFeature(barbarianId, {
      name: testId('Uncounted Limited'),
      usesPerRest: 'short_rest',
    });
    const refused = await use(barbarianId, limitedId);
    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain('the engine cannot count its uses yet');

    const passiveId = await grantTestFeature(barbarianId, {
      name: testId('Untracked Passive'),
      usesPerRest: null,
    });
    const passive = await use(barbarianId, passiveId);
    expect(passive.status).toBe(200);
    expect(passive.body.usesRemaining).toBe(-1);
  });

  test("the shared Action Surge count agrees with the fighter service's at every level", async () => {
    const { actionSurgeUsesAt: shared } =
      await import('../../../../../shared/limited-feature-counts');
    const { actionSurgeUsesAt: fighter } = await importWithRealDb(
      () => import('../../../services/combat/fighter-features-service.js'),
    );
    for (let level = 2; level <= 20; level++) {
      expect(shared({ classLevel: level, abilityModifiers: null })).toBe(fighter(level));
    }
  });
});
