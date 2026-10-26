/**
 * #1147 FIX round: `listHealingConsumables` against a real database.
 *
 * Every committed test of the #1147 offer path mocks `data-access`, so the SQL
 * behind the offer — character scope, consumable-only, quantity > 0, the
 * healingDice filter, createdAt/id order — runs in none of them. This suite
 * inserts real `inventory_items` rows and calls the real function, so a
 * predicate or ordering mistake in the query fails here instead of reaching
 * the ActionBar as a wrong chip.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts. The
 * suite is discovered by the `server-real-db` glob runner, so it runs with no
 * ci.yml edit.
 */
import { afterAll, afterEach, expect, test } from 'bun:test';
import { asc, eq } from 'drizzle-orm';

import {
  characters,
  combatEncounters,
  combatParticipantStatus,
  combatParticipants,
  gameSessions,
  inventoryItems,
} from '../../../../../db/schema/index';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  realDbUrl,
  testId,
} from '../../__tests__/fixtures/real-db.js';

if (hasRealDb) process.env.DATABASE_URL = realDbUrl;

if (!hasRealDb) {
  console.warn(
    '[combat-healing-consumables] SKIPPED: set TEST_DATABASE_URL to the dedicated Postgres at 127.0.0.1:55432 to run this suite.',
  );
}

const { listHealingConsumables } = await importWithRealDb(() => import('../data-access.js'));
const { applyStoryItemsOnce } = await importWithRealDb(() => import('../../dm/story-items.js'));
const { getLegalCombatActions } = await importWithRealDb(
  () => import('../combat-intent-service.js'),
);

const createdCharacterIds: string[] = [];
const createdSessionIds: string[] = [];

async function createCharacter(): Promise<string> {
  const [row] = await realDb()
    .insert(characters)
    .values({ userId: testId('healing-consumables-user'), name: 'Healing Consumables Hero' })
    .returning({ id: characters.id });
  createdCharacterIds.push(row.id);
  return row.id;
}

async function addItem(
  characterId: string,
  values: {
    name: string;
    itemType: string;
    quantity: number;
    properties: string | null;
    createdAt?: Date;
  },
): Promise<string> {
  const [row] = await realDb()
    .insert(inventoryItems)
    .values({ characterId, ...values })
    .returning({ id: inventoryItems.id });
  return row.id;
}

async function createSession(characterId: string): Promise<string> {
  const [row] = await realDb()
    .insert(gameSessions)
    .values({ characterId })
    .returning({ id: gameSessions.id });
  createdSessionIds.push(row.id);
  return row.id;
}

/** One hurt player, current turn, action unspent: the shape the Use chip needs. */
async function createHurtPlayerEncounter(
  sessionId: string,
  characterId: string,
): Promise<string> {
  const [encounter] = await realDb()
    .insert(combatEncounters)
    .values({ sessionId, currentTurnOrder: 0 })
    .returning({ id: combatEncounters.id });
  const [participant] = await realDb()
    .insert(combatParticipants)
    .values({
      encounterId: encounter.id,
      characterId,
      name: 'Healing Consumables Hero',
      participantType: 'player',
      turnOrder: 0,
      actionUsed: false,
      maxHp: 20,
    })
    .returning({ id: combatParticipants.id });
  await realDb().insert(combatParticipantStatus).values({
    participantId: participant.id,
    currentHp: 9,
    maxHp: 20,
  });
  return encounter.id;
}

afterEach(async () => {
  for (const sessionId of createdSessionIds.splice(0)) {
    // Cascade deletes the encounter, its participants, their statuses, and
    // the story-item markers for the grant.
    await realDb().delete(gameSessions).where(eq(gameSessions.id, sessionId));
  }
  for (const characterId of createdCharacterIds.splice(0)) {
    // Cascade deletes the character's inventory rows.
    await realDb().delete(characters).where(eq(characters.id, characterId));
  }
});

afterAll(async () => {
  await closeRealDb();
});

describeWithDb('listHealingConsumables (real database)', () => {
  test('returns only the character healing consumables, in createdAt order', async () => {
    const characterId = await createCharacter();
    const firstId = await addItem(characterId, {
      name: 'Potion of Healing',
      itemType: 'consumable',
      quantity: 2,
      properties: JSON.stringify({ healingDice: '2d4+2' }),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const secondId = await addItem(characterId, {
      name: 'Potion of Greater Healing',
      itemType: 'consumable',
      quantity: 1,
      properties: JSON.stringify({ healingDice: '4d4+4' }),
      createdAt: new Date('2026-01-01T00:00:01.000Z'),
    });

    expect(await listHealingConsumables(characterId)).toEqual([
      { id: firstId, name: 'Potion of Healing', healingDice: '2d4+2' },
      { id: secondId, name: 'Potion of Greater Healing', healingDice: '4d4+4' },
    ]);
  });

  test('excludes non-consumables, spent items, and items without parseable healing dice', async () => {
    const characterId = await createCharacter();
    const keptId = await addItem(characterId, {
      name: 'Potion of Healing',
      itemType: 'consumable',
      quantity: 1,
      properties: JSON.stringify({ healingDice: '2d4+2' }),
    });
    await addItem(characterId, {
      name: 'Longsword',
      itemType: 'weapon',
      quantity: 1,
      properties: JSON.stringify({ healingDice: '2d4+2' }),
    });
    await addItem(characterId, {
      name: 'Spent Potion of Healing',
      itemType: 'consumable',
      quantity: 0,
      properties: JSON.stringify({ healingDice: '2d4+2' }),
    });
    await addItem(characterId, {
      name: 'Rations',
      itemType: 'consumable',
      quantity: 3,
      properties: JSON.stringify({}),
    });
    await addItem(characterId, {
      name: 'Mysterious Draught',
      itemType: 'consumable',
      quantity: 1,
      properties: JSON.stringify({ healingDice: 'heal' }),
    });
    await addItem(characterId, {
      name: 'Corrupted Vial',
      itemType: 'consumable',
      quantity: 1,
      properties: '{not json',
    });
    await addItem(characterId, {
      name: 'Numeric Draught',
      itemType: 'consumable',
      quantity: 1,
      properties: JSON.stringify({ healingDice: 9 }),
    });

    expect(await listHealingConsumables(characterId)).toEqual([
      { id: keptId, name: 'Potion of Healing', healingDice: '2d4+2' },
    ]);
  });

  test('scopes to the character', async () => {
    const firstId = await createCharacter();
    const secondId = await createCharacter();
    const ownId = await addItem(firstId, {
      name: 'Potion of Healing',
      itemType: 'consumable',
      quantity: 1,
      properties: JSON.stringify({ healingDice: '2d4+2' }),
    });
    await addItem(secondId, {
      name: 'Potion of Greater Healing',
      itemType: 'consumable',
      quantity: 1,
      properties: JSON.stringify({ healingDice: '4d4+4' }),
    });

    expect(await listHealingConsumables(firstId)).toEqual([
      { id: ownId, name: 'Potion of Healing', healingDice: '2d4+2' },
    ]);
    expect(await listHealingConsumables(secondId)).toEqual([
      { id: expect.any(String), name: 'Potion of Greater Healing', healingDice: '4d4+4' },
    ]);
  });
});

describeWithDb(
  'story-granted Potion of Healing reaches the Use chip (real database)',
  () => {
    test('catalog grant yields a consumable row with healing dice, and getLegalCombatActions offers Use', async () => {
      const userId = testId('healing-consumables-grant-user');
      const [character] = await realDb()
        .insert(characters)
        .values({ userId, name: 'Healing Consumables Hero' })
        .returning({ id: characters.id });
      createdCharacterIds.push(character.id);
      const sessionId = await createSession(character.id);

      // The real producer: the DM story-grant path, not a hand-built row and
      // not the client-supplied inventory route (which takes itemType and
      // properties from the caller and so cannot test the producer).
      const outcome = await applyStoryItemsOnce({
        characterId: character.id,
        sessionId,
        playerMessageAt: new Date(),
        items: [{ name: 'Potion of Healing', quantity: 1, change: 'gain' }],
      });
      expect(outcome).toBe('applied');

      const [row] = await realDb()
        .select()
        .from(inventoryItems)
        .where(eq(inventoryItems.characterId, character.id))
        .orderBy(asc(inventoryItems.createdAt), asc(inventoryItems.id));
      expect(row).toBeDefined();
      expect(row.itemType).toBe('consumable');
      expect(
        (JSON.parse(row.properties ?? '{}') as { healingDice?: unknown }).healingDice,
      ).toBe('2d4+2');

      const encounterId = await createHurtPlayerEncounter(sessionId, character.id);
      const { actions } = await getLegalCombatActions(encounterId, userId);
      expect(actions).toContainEqual({
        type: 'use_item',
        label: 'Use Potion of Healing',
        itemId: row.id,
      });
    });
  },
);
