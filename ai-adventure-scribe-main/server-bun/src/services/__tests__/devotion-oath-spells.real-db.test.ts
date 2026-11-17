/**
 * #1555: the server grants Oath of Devotion and Life Domain spells as
 * always-prepared character_spells rows. They are castable with a slot and
 * do not change the count of spells the character prepared themselves.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts.
 * Does not call the live DM.
 */
import { afterAll, beforeAll, expect, it, mock } from 'bun:test';
import { eq, inArray, sql } from 'drizzle-orm';

import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  grantLegendPlan,
  importWithRealDb,
  realDb,
  testId,
} from './fixtures/real-db.js';
import {
  characters,
  characterSpells,
  characterSpellSlots,
  classes,
  spells,
} from '../../../../db/schema/index';

const stub = () => ({
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
  debug: mock(() => {}),
  child: () => stub(),
});

let userId = '';

mock.module('../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId, email: 'user@example.test', plan: 'free' },
    error: null,
  }),
}));
mock.module('../../lib/logger.js', () => ({
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

if (hasRealDb) {
  // The plan lookup reads lib/env, which refuses to open a connection until
  // these are set. A missing one is a thrown lookup, which the route reports
  // as 503 PLAN_UNAVAILABLE.
  process.env.CORS_ORIGIN ??= 'http://localhost:5173';
  process.env.WORKOS_API_KEY ??= 'test-workos-api-key';
  process.env.WORKOS_CLIENT_ID ??= 'test-workos-client-id';
  process.env.PORT ??= '8888';
}

describeWithDb('always-prepared subclass spells (#1555)', () => {
  let db: ReturnType<typeof realDb>;
  let request: (body: unknown) => Promise<Response>;
  let levelUp: (characterId: string) => Promise<{ newLevel: number }>;
  let castableSpells: (character: {
    id: string;
    class: string | null;
    level: number;
    preparedSpells: string | null;
    knownSpells: string | null;
    cantrips: string | null;
    ritualSpells: string | null;
  }) => Promise<string[]>;
  let useSpellSlot: (characterId: string, spellName: string) => Promise<{ success: boolean }>;
  const createdIds: string[] = [];

  const spellRows = async (characterId: string) =>
    db
      .select({
        name: spells.name,
        isPrepared: characterSpells.isPrepared,
        isAlwaysPrepared: characterSpells.isAlwaysPrepared,
      })
      .from(characterSpells)
      .innerJoin(spells, eq(characterSpells.spellId, spells.id))
      .where(eq(characterSpells.characterId, characterId));

  beforeAll(async () => {
    userId = testId('user-1555');
    await grantLegendPlan(userId);
    db = realDb();
    const pipeline = await importWithRealDb(async () => {
      const { createRequestPipelineApp } = await import('../../http-pipeline.js');
      const { charactersRoutes } = await import('../../routes/v1/characters.js');
      return createRequestPipelineApp().use(charactersRoutes);
    });
    const { LevelUpService } = await import('../progression/level-up-service.js');
    const { ProgressionService } = await import('../progression-service.js');
    const castable = await import('../dm/castable-spells.js');
    const { SpellSlotsService } = await import('../spell-slots-service.js');
    request = (body) =>
      pipeline.handle(
        new Request('http://localhost/v1/characters', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      );
    levelUp = async (characterId) => {
      await ProgressionService.initializeProgression(characterId, userId);
      return LevelUpService.levelUp({ characterId }, userId);
    };
    castableSpells = (character) =>
      castable.castableSpells(character as Parameters<typeof castable.castableSpells>[0]);
    useSpellSlot = (characterId, spellName) =>
      SpellSlotsService.useSpellSlot(
        { characterId, spellName, spellLevel: 1, slotLevelUsed: 1 },
        userId,
      );
  });

  afterAll(async () => {
    for (const id of createdIds) {
      await db
        .delete(characters)
        .where(eq(characters.id, id))
        .catch(() => {});
    }
    await closeRealDb();
  });

  const create = async (body: Record<string, unknown>) => {
    const res = await request(body);
    const text = await res.text();
    expect(res.status, text.slice(0, 400)).toBe(201);
    const { id } = JSON.parse(text) as { id: string };
    createdIds.push(id);
    return id;
  };

  it('grants a Devotion paladin 3 its oath spells, castable with a slot, without changing the prepared count', async () => {
    const id = await create({
      name: `Devotion ${testId('1555')}`,
      race: 'Human',
      class: 'Paladin',
      subclass: 'Oath of Devotion',
      level: 3,
      stats: {
        strength: 16,
        dexterity: 10,
        constitution: 14,
        intelligence: 8,
        wisdom: 10,
        charisma: 16,
        temporary_hit_points: 0,
        hit_dice: '1d10',
      },
      class_levels: [{ classId: 'paladin', className: 'Paladin', level: 3 }],
      total_level: 3,
      known_spells: 'Bless',
      prepared_spells: 'Bless',
    });

    const [row] = await db.select().from(characters).where(eq(characters.id, id));
    expect(row.preparedSpells).toBe('Bless');
    expect(
      row.knownSpells
        ?.split(',')
        .map((name) => name.trim())
        .sort(),
    ).toEqual(['Bless', 'Protection from Evil and Good', 'Sanctuary']);

    const granted = await spellRows(id);
    const always = granted.filter((spell) => spell.isAlwaysPrepared).map((spell) => spell.name);
    expect(always.sort()).toEqual(['Protection from Evil and Good', 'Sanctuary']);
    expect(granted.filter((spell) => spell.isPrepared && !spell.isAlwaysPrepared)).toHaveLength(0);

    const [shield] = await db
      .select({ id: spells.id })
      .from(spells)
      .where(eq(spells.name, 'Shield of Faith'))
      .limit(1);
    const [paladinClass] = await db
      .select({ id: classes.id })
      .from(classes)
      .where(eq(classes.name, 'Paladin'))
      .limit(1);
    expect(shield?.id).toBeTruthy();
    expect(paladinClass?.id).toBeTruthy();
    await db.insert(characterSpells).values({
      characterId: id,
      spellId: shield!.id,
      sourceClassId: paladinClass!.id,
      isPrepared: true,
      isAlwaysPrepared: false,
      sourceFeature: 'base',
    });
    const preparedBefore = (await spellRows(id)).filter(
      (spell) => spell.isPrepared && !spell.isAlwaysPrepared,
    );
    expect(preparedBefore.map((spell) => spell.name)).toEqual(['Shield of Faith']);

    const [character] = await db.select().from(characters).where(eq(characters.id, id));
    const castable = await castableSpells(character);
    expect(castable).toEqual(
      expect.arrayContaining(['Protection from Evil and Good', 'Sanctuary']),
    );
    const spent = await useSpellSlot(id, 'Sanctuary');
    expect(spent.success).toBe(true);
    const slots = await db
      .select()
      .from(characterSpellSlots)
      .where(eq(characterSpellSlots.characterId, id));
    const first = slots.find((entry) => entry.spellLevel === 1);
    expect(first?.totalSlots).toBe(3);
    expect(first?.usedSlots).toBe(1);

    expect((await levelUp(id)).newLevel).toBe(4);
    expect(
      (await spellRows(id))
        .filter((spell) => spell.isAlwaysPrepared)
        .map((spell) => spell.name)
        .sort(),
    ).toEqual(['Protection from Evil and Good', 'Sanctuary']);

    expect((await levelUp(id)).newLevel).toBe(5);
    const atFive = await spellRows(id);
    expect(
      atFive
        .filter((spell) => spell.isAlwaysPrepared)
        .map((spell) => spell.name)
        .sort(),
    ).toEqual([
      'Lesser Restoration',
      'Protection from Evil and Good',
      'Sanctuary',
      'Zone of Truth',
    ]);
    expect(
      atFive
        .filter((spell) => spell.isPrepared && !spell.isAlwaysPrepared)
        .map((spell) => spell.name),
    ).toEqual(['Shield of Faith']);
    const [after] = await db.select().from(characters).where(eq(characters.id, id));
    expect(after.preparedSpells).toBe('Bless');
  });

  it('grants a Life Domain cleric its domain spells as always prepared and leaves the prepared list', async () => {
    const id = await create({
      name: `Life ${testId('1555')}`,
      race: 'Human',
      class: 'Cleric',
      subclass: 'Life Domain',
      level: 1,
      stats: {
        strength: 10,
        dexterity: 10,
        constitution: 14,
        intelligence: 10,
        wisdom: 16,
        charisma: 10,
        temporary_hit_points: 0,
        hit_dice: '1d8',
      },
      known_spells: 'Guiding Bolt',
      prepared_spells: 'Guiding Bolt',
    });

    const [row] = await db.select().from(characters).where(eq(characters.id, id));
    expect(row.preparedSpells).toBe('Guiding Bolt');
    const granted = await spellRows(id);
    expect(
      granted
        .filter((spell) => spell.isAlwaysPrepared)
        .map((spell) => spell.name)
        .sort(),
    ).toEqual(['Bless', 'Cure Wounds']);
    expect(granted.filter((spell) => spell.isPrepared && !spell.isAlwaysPrepared)).toHaveLength(0);
  });

  it('concurrent grants insert one character_spells row per spell (#1567)', async () => {
    const id = await create({
      name: `Concurrent ${testId('1567')}`,
      race: 'Human',
      class: 'Paladin',
      subclass: 'Oath of Devotion',
      level: 3,
      stats: {
        strength: 16,
        dexterity: 10,
        constitution: 14,
        intelligence: 8,
        wisdom: 10,
        charisma: 16,
        temporary_hit_points: 0,
        hit_dice: '1d10',
      },
      class_levels: [{ classId: 'paladin', className: 'Paladin', level: 3 }],
      total_level: 3,
      known_spells: 'Bless',
      prepared_spells: 'Bless',
    });

    // Creation already granted the oath spells; remove them so the grant has
    // rows to insert and actually exercises the insert path.
    await db.delete(characterSpells).where(eq(characterSpells.characterId, id));

    const { grantAlwaysPreparedSubclassSpells } =
      await import('../character/always-prepared-spell-grant.js');

    await Promise.all([
      grantAlwaysPreparedSubclassSpells(id, userId),
      grantAlwaysPreparedSubclassSpells(id, userId),
    ]);

    const grantedSpellIds = await db
      .select({ id: spells.id })
      .from(spells)
      .where(inArray(spells.name, ['Protection from Evil and Good', 'Sanctuary']));
    expect(grantedSpellIds).toHaveLength(2);

    const grouped = await db
      .select({
        spellId: characterSpells.spellId,
        c: sql<number>`count(*)`,
      })
      .from(characterSpells)
      .where(eq(characterSpells.characterId, id))
      .groupBy(characterSpells.spellId);

    const duplicates = grouped.filter((row) => Number(row.c) > 1);
    expect(duplicates).toHaveLength(0);
    for (const { id: spellId } of grantedSpellIds) {
      const row = grouped.find((g) => g.spellId === spellId);
      expect(Number(row?.c)).toBe(1);
    }
  });
});
