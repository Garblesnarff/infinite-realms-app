/**
 * #1251: the combat movement budget reads the character's speed. Seating goes
 * through the real `CombatEncounterService.startCombat` against a scratch
 * database — the bug is in a seated value, and a mocked `db` would return
 * whatever the test author expected it to be.
 *
 * Producers: the character rows below are shaped like production rows: race and
 * subrace are the characters table's text columns, and the stats rows omit
 * `speed` for the race-base cases so the column holds its 30 default — exactly
 * the production shape (a gnome whose row was never race-derived). The stored-40
 * case is the one shape where the row carries an explicit speed.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts.
 * Skips honestly without one; CI's server-real-db job runs it by glob.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';

import {
  campaigns,
  characters,
  characterStats,
  characterEquipment,
  combatEncounters,
  combatParticipants,
  gameSessions,
} from '../../../../../db/schema/index';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from '../../__tests__/fixtures/real-db.js';

const { CombatEncounterService } = await importWithRealDb(
  () => import('../combat-encounter-service.js'),
);

if (!hasRealDb) {
  console.warn(
    '[combat-seating-race-speed] SKIPPED: set TEST_DATABASE_URL to a scratch Postgres to run these.',
  );
}

describeWithDb('startCombat seats the character speed (#1251)', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const userId = testId('1251-user');

  let campaignId: string;
  const characterIds: Record<string, string> = {};
  const sessionIds: Record<string, string> = {};
  const encounterIds: string[] = [];
  const seatedSpeeds: Record<string, number | undefined> = {};

  const cases = [
    {
      key: 'gnome',
      name: 'Oriel Tansfield',
      race: 'Gnome',
      subrace: null,
      speed: undefined,
      expected: 25,
    },
    {
      key: 'woodElf',
      name: 'Sylvara',
      race: 'Elf',
      subrace: 'Wood Elf',
      speed: undefined,
      expected: 35,
    },
    {
      key: 'unknown',
      name: 'Kobold Scout',
      race: 'Kobold',
      subrace: null,
      speed: undefined,
      expected: 30,
    },
    { key: 'stored', name: 'Boots Bearer', race: 'Human', subrace: null, speed: 40, expected: 40 },
  ] as const;

  beforeAll(async () => {
    if (!hasRealDb) return;
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('1251-camp') })
      .returning({ id: campaigns.id });

    for (const [index, c] of cases.entries()) {
      const [{ id: characterId }] = await db
        .insert(characters)
        .values({
          userId,
          campaignId,
          name: testId(c.key),
          race: c.race,
          subrace: c.subrace,
          level: 3,
          class: 'Wizard',
        })
        .returning({ id: characters.id });
      characterIds[c.key] = characterId;
      await db.insert(characterStats).values({
        characterId,
        strength: 10,
        dexterity: 14,
        armorClass: 12,
        maxHitPoints: 20,
        currentHitPoints: 20,
        ...(c.speed !== undefined ? { speed: c.speed } : {}),
      });
      const [{ id: sessionId }] = await db
        .insert(gameSessions)
        .values({ campaignId, characterId, sessionNumber: index + 1, status: 'active' })
        .returning({ id: gameSessions.id });
      sessionIds[c.key] = sessionId;

      const state = await CombatEncounterService.startCombat(
        sessionId,
        [
          {
            encounterId: testId('1251-input-encounter'),
            characterId,
            name: c.name,
            initiativeModifier: 0,
            initiativeRoll: 10 + index,
          },
        ],
        false,
        userId,
      );
      encounterIds.push(state.encounter.id);
      const seated = state.participants.find((p) => p.characterId === characterId);
      seatedSpeeds[c.key] = seated?.speed;
    }
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    if (encounterIds.length) {
      await db
        .delete(combatParticipants)
        .where(inArray(combatParticipants.encounterId, encounterIds));
      await db.delete(combatEncounters).where(inArray(combatEncounters.id, encounterIds));
    }
    for (const sessionId of Object.values(sessionIds)) {
      await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    }
    for (const characterId of Object.values(characterIds)) {
      await db.delete(characters).where(eq(characters.id, characterId));
    }
    await db.delete(campaigns).where(eq(campaigns.id, campaignId));
    await closeRealDb();
  });

  test('a gnome seats at 25 ft, a wood elf at 35 ft, an unknown race at 30 ft', async () => {
    expect(seatedSpeeds.gnome).toBe(25);
    expect(seatedSpeeds.woodElf).toBe(35);
    expect(seatedSpeeds.unknown).toBe(30);
  });

  test('an explicitly stored speed wins over the race base', async () => {
    expect(seatedSpeeds.stored).toBe(40);
  });

  test('the combat seat applies class, feat and armor modifiers (#1317)', async () => {
    const modifiers = [
      { name: 'barbarian', className: 'Barbarian', level: 5, expected: 40 },
      { name: 'monk', className: 'Monk', level: 10, expected: 50 },
      { name: 'monk-shield', className: 'Monk', level: 10, armor: 'Shield', expected: 30 },
      {
        name: 'barbarian-plate',
        className: 'Barbarian',
        level: 5,
        armor: 'Plate Armor',
        expected: 20,
      },
      {
        name: 'mobile-plate',
        className: 'Fighter',
        level: 1,
        armor: 'Chain Mail',
        mobile: true,
        expected: 30,
      },
      {
        name: 'dwarf',
        race: 'Dwarf',
        className: 'Fighter',
        level: 1,
        armor: 'Chain Mail',
        expected: 25,
      },
      {
        name: 'multiclass',
        className: 'Fighter',
        level: 9,
        levels: [
          { className: 'Barbarian', level: 5 },
          { className: 'Monk', level: 4 },
        ],
        mobile: true,
        expected: 60,
      },
    ];
    for (const row of modifiers) {
      const [{ id: characterId }] = await db
        .insert(characters)
        .values({
          userId,
          campaignId,
          name: testId(row.name),
          race: row.race ?? 'Human',
          class: row.className,
          level: row.level,
          classLevels: row.levels ?? null,
          classFeatures: row.mobile ? { 'feat:mobile': { name: 'Mobile' } } : null,
        })
        .returning({ id: characters.id });
      characterIds[row.name] = characterId;
      await db
        .insert(characterStats)
        .values({
          characterId,
          strength: 10,
          dexterity: 14,
          maxHitPoints: 20,
          currentHitPoints: 20,
        });
      if (row.armor)
        await db
          .insert(characterEquipment)
          .values({ characterId, itemName: row.armor, itemType: 'armor', equipped: true });
      const [{ id: sessionId }] = await db
        .insert(gameSessions)
        .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
        .returning({ id: gameSessions.id });
      sessionIds[row.name] = sessionId;
      const combat = await CombatEncounterService.startCombat(
        sessionId,
        [
          {
            encounterId: testId('1317'),
            characterId,
            name: row.name,
            initiativeModifier: 0,
            initiativeRoll: 10,
          },
        ],
        false,
        userId,
      );
      encounterIds.push(combat.encounter.id);
      expect(combat.participants.find((p) => p.characterId === characterId)?.speed).toBe(
        row.expected,
      );
    }
  });

  test('the gnome seat persists 25 ft on the participant row', async () => {
    const [row] = await db
      .select({ speed: combatParticipants.speed })
      .from(combatParticipants)
      .where(eq(combatParticipants.characterId, characterIds.gnome));
    expect(row.speed).toBe(25);
  });
});
