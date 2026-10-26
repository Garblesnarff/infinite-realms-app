import { describe, expect, mock, test } from 'bun:test';

process.env.DATABASE_URL ??= 'postgres://test.invalid/unused';

import { characters, inventoryItems, combatParticipantStatus } from '../../../../../db/schema/index';

/**
 * #1147: resolveUseItem's seams, stubbed at the module boundary. The item row and the
 * participant status row are the two database reads; the heal and the decrement are the two
 * service writes. Nothing here touches a real database: the shape of each stub follows the
 * real producer (inventory_items row, combat_participant_status row, HealingResult,
 * UseConsumableResult).
 */
type ItemRow = {
  id: string;
  characterId: string;
  name: string;
  itemType: string;
  quantity: number;
  properties: string | null;
};
let itemRow: ItemRow | null = {
  id: 'potion-1',
  characterId: 'character-1',
  name: 'Potion of Healing',
  itemType: 'consumable',
  quantity: 2,
  properties: JSON.stringify({ healingDice: '2d4+2' }),
};
let statusRow: { currentHp: number; maxHp: number } | null = { currentHp: 9, maxHp: 20 };
// #1147 FIX round: the characters-table holder for the ownership check. The
// mock returns the authorized row or none, mirroring the real query's
// predicate (id == characterId AND (userId == userId OR ownerId == userId));
// the predicate itself is useConsumable's tested contract, not this mock's.
let characterRow: { id: string } | null = { id: 'character-1' };
let healCalls: Array<{
  participantId: string;
  encounterId: string;
  amount: number;
  source?: string;
  userId?: string;
}> = [];
let spendCalls: Array<{ input: unknown; userId: string }> = [];
let dieRolls: number[] = [3, 4];

mock.module('../../../../../db/client', () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => {
            if (table === inventoryItems) return itemRow ? [itemRow] : [];
            if (table === combatParticipantStatus) return statusRow ? [statusRow] : [];
            if (table === characters) return characterRow ? [characterRow] : [];
            return [];
          },
        }),
      }),
    }),
  },
}));
mock.module('../../combat-hp-service.js', () => ({
  CombatHPService: {
    healDamage: async (
      participantId: string,
      encounterId: string,
      amount: number,
      source?: string,
      userId?: string,
    ) => {
      healCalls.push({ participantId, encounterId, amount, source, userId });
      const current = statusRow?.currentHp ?? 0;
      const max = statusRow?.maxHp ?? 0;
      const applied = Math.max(0, Math.min(amount, max - current));
      return {
        participantId,
        healingAmount: amount,
        healingApplied: applied,
        overheal: amount - applied,
        newCurrentHp: current + applied,
        wasRevived: false,
        isConscious: true,
      };
    },
  },
}));
mock.module('../../inventory/inventory-consumable-service.js', () => ({
  InventoryConsumableService: {
    useConsumable: async (input: unknown, userId: string) => {
      spendCalls.push({ input, userId });
      const remaining = Math.max(0, (itemRow?.quantity ?? 1) - 1);
      return {
        success: true,
        remainingQuantity: remaining,
        itemDeleted: remaining <= 0,
        usageLog: {},
      };
    },
  },
}));
mock.module('../../../lib/rng.js', () => ({
  rollDie: () => dieRolls.shift() ?? 1,
}));

const { resolveUseItem } = await import('../combat-item-service.js');

const base = {
  characterId: 'character-1',
  userId: 'user-1',
  participantId: 'player-1',
  encounterId: 'encounter-1',
  sessionId: 'session-1',
  itemId: 'potion-1',
};

describe('resolveUseItem', () => {
  test('rolls the dice, heals, then decrements; deletes at zero (Potion of Healing 2d4+2)', async () => {
    dieRolls = [3, 4];
    healCalls = [];
    spendCalls = [];

    const result = await resolveUseItem(base);

    expect(result.healed).toBe(9);
    expect(result.newHp).toBe(18);
    expect(result.maxHp).toBe(20);
    expect(result.itemName).toBe('Potion of Healing');
    expect(result.roll).toEqual({ dice: [3, 4], modifier: 2, total: 9 });
    expect(result.remainingQuantity).toBe(1);
    expect(result.itemDeleted).toBe(false);
    expect(healCalls).toEqual([
      {
        participantId: 'player-1',
        encounterId: 'encounter-1',
        amount: 9,
        source: 'combat-use-item',
        userId: 'user-1',
      },
    ]);
    expect(spendCalls).toEqual([
      {
        input: {
          characterId: 'character-1',
          itemId: 'potion-1',
          quantity: 1,
          sessionId: 'session-1',
          context: 'combat-use-item',
        },
        userId: 'user-1',
      },
    ]);

    itemRow = { ...itemRow!, quantity: 1 };
    dieRolls = [2, 2];
    const last = await resolveUseItem(base);
    expect(last.remainingQuantity).toBe(0);
    expect(last.itemDeleted).toBe(true);
  });

  test('caps the heal at max HP', async () => {
    statusRow = { currentHp: 18, maxHp: 20 };
    dieRolls = [4, 4];

    const result = await resolveUseItem(base);

    expect(result.healed).toBe(2);
    expect(result.newHp).toBe(20);
  });

  test('refuses before spending anything: not owned, not consumable, no healing dice, none left, full health, heals nothing', async () => {
    const cases: Array<{ name: string; setup: () => void; pattern: RegExp }> = [
      {
        name: 'not owned',
        setup: () => {
          itemRow = null;
        },
        pattern: /Inventory item/,
      },
      {
        name: 'not consumable',
        setup: () => {
          itemRow = {
            id: 'potion-1',
            characterId: 'character-1',
            name: 'Longsword',
            itemType: 'weapon',
            quantity: 1,
            properties: JSON.stringify({ healingDice: '2d4+2' }),
          };
        },
        pattern: /not a consumable/,
      },
      {
        name: 'no healing dice',
        setup: () => {
          itemRow = {
            id: 'potion-1',
            characterId: 'character-1',
            name: 'Potion of Healing',
            itemType: 'consumable',
            quantity: 1,
            properties: JSON.stringify({}),
          };
        },
        pattern: /no healing effect/,
      },
      {
        name: 'none left',
        setup: () => {
          itemRow = {
            id: 'potion-1',
            characterId: 'character-1',
            name: 'Potion of Healing',
            itemType: 'consumable',
            quantity: 0,
            properties: JSON.stringify({ healingDice: '2d4+2' }),
          };
        },
        pattern: /none left/,
      },
      {
        name: 'full health',
        setup: () => {
          itemRow = {
            id: 'potion-1',
            characterId: 'character-1',
            name: 'Potion of Healing',
            itemType: 'consumable',
            quantity: 1,
            properties: JSON.stringify({ healingDice: '2d4+2' }),
          };
          statusRow = { currentHp: 20, maxHp: 20 };
        },
        pattern: /full health/,
      },
      {
        name: 'heals nothing',
        setup: () => {
          itemRow = {
            id: 'potion-1',
            characterId: 'character-1',
            name: 'Potion of Healing',
            itemType: 'consumable',
            quantity: 1,
            properties: JSON.stringify({ healingDice: '2d4-10' }),
          };
          dieRolls = [2, 2];
        },
        pattern: /restore no health/,
      },
    ];
    for (const c of cases) {
      itemRow = {
        id: 'potion-1',
        characterId: 'character-1',
        name: 'Potion of Healing',
        itemType: 'consumable',
        quantity: 2,
        properties: JSON.stringify({ healingDice: '2d4+2' }),
      };
      statusRow = { currentHp: 9, maxHp: 20 };
      healCalls = [];
      spendCalls = [];
      c.setup();
      await expect(resolveUseItem(base)).rejects.toThrow(c.pattern);
      expect(healCalls).toEqual([]);
      expect(spendCalls).toEqual([]);
    }
  });

  test('refuses a character the requester does not own before any write (#1147 FIX)', async () => {
    itemRow = {
      id: 'potion-1',
      characterId: 'character-1',
      name: 'Potion of Healing',
      itemType: 'consumable',
      quantity: 2,
      properties: JSON.stringify({ healingDice: '2d4+2' }),
    };
    statusRow = { currentHp: 9, maxHp: 20 };
    characterRow = null;
    healCalls = [];
    spendCalls = [];
    try {
      await expect(resolveUseItem(base)).rejects.toThrow(/do not own/);
      expect(healCalls).toEqual([]);
      expect(spendCalls).toEqual([]);
    } finally {
      characterRow = { id: 'character-1' };
    }
  });
});
