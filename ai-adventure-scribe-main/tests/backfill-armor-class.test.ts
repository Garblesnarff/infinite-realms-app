/**
 * The repair for the 76 characters already in the database (#1858).
 *
 * These tests are about the two properties that make it safe to run against production: it
 * prints old -> new for every character it would touch, and it touches nobody whose armour
 * class was not equipment-derived in the first place.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  formatArmorClassPlan,
  parseCliArgs,
  planArmorClassBackfill,
  runBackfill,
} from '../scripts/backfill-armor-class';

import type { SupabaseClient } from '@supabase/supabase-js';

const CHARACTERS = [
  { id: 'faithful', name: 'The Faithful' },
  { id: 'ranger', name: 'The Ranger' },
  { id: 'sorcerer', name: 'The Unarmoured' },
];

const STATS = [
  // The live case: Scale Mail + Shield at DEX 10, stored as 10 + DEX.
  { character_id: 'faithful', dexterity: 10, armor_class: 10 },
  // Studded Leather 12 + DEX 3 = 15, which is already what is stored.
  { character_id: 'ranger', dexterity: 16, armor_class: 15 },
  // No armour at all, and an AC somebody set deliberately.
  { character_id: 'sorcerer', dexterity: 14, armor_class: 15 },
];

const EQUIPMENT = [
  { character_id: 'faithful', item_name: 'Scale Mail', item_type: 'armor', equipped: true },
  { character_id: 'faithful', item_name: 'Shield', item_type: 'shield', equipped: true },
  { character_id: 'faithful', item_name: 'Mace', item_type: 'weapon', equipped: true },
  { character_id: 'ranger', item_name: 'Studded Leather', item_type: 'armor', equipped: true },
  { character_id: 'sorcerer', item_name: 'Dagger', item_type: 'weapon', equipped: true },
];

const INPUT = {
  characters: CHARACTERS,
  stats: STATS,
  equipment: EQUIPMENT,
  inventory: [],
};

const stubClient = (update = vi.fn()) =>
  ({
    from: (table: string) => ({
      select: async () => ({
        data: {
          characters: CHARACTERS,
          character_stats: STATS,
          character_equipment: EQUIPMENT,
          inventory_items: [],
        }[table],
        error: null,
      }),
      update,
    }),
  }) as unknown as SupabaseClient;

describe('planArmorClassBackfill', () => {
  it('repairs the character wearing armour and leaves the one without it alone', () => {
    const plans = planArmorClassBackfill(INPUT);

    expect(plans.map((plan) => plan.characterId)).toEqual(['faithful', 'ranger']);
    expect(plans[0]).toMatchObject({
      characterName: 'The Faithful',
      previousArmorClass: 10,
      armorClass: 16,
      armorName: 'Scale Mail',
      hasShield: true,
      dexterityModifier: 0,
      unrecognizedArmorNames: [],
      changed: true,
    });
  });

  it('is idempotent: a character already at the computed AC is not a change', () => {
    const plans = planArmorClassBackfill(INPUT);
    const ranger = plans.find((plan) => plan.characterId === 'ranger');

    expect(ranger).toMatchObject({ previousArmorClass: 15, armorClass: 15, changed: false });
  });

  it('prints one readable line per character', () => {
    const [faithful] = planArmorClassBackfill(INPUT);

    expect(formatArmorClassPlan(faithful)).toBe(
      'The Faithful (faithful): AC 10 -> 16 [Scale Mail + shield, DEX +0]',
    );
  });
});

describe('runBackfill', () => {
  it('defaults to a dry run that writes nothing and says what it would do', async () => {
    const update = vi.fn();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    const summary = await runBackfill({ dryRun: true, client: stubClient(update) });

    expect(summary).toEqual({
      characters: 3,
      equipmentDriven: 2,
      changed: 1,
      applied: 0,
      failed: 0,
    });
    expect(update).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toBe(
      'Would update The Faithful (faithful): AC 10 -> 16 [Scale Mail + shield, DEX +0]',
    );

    log.mockRestore();
  });

  it('requires an explicit --apply to write', () => {
    expect(parseCliArgs([])).toEqual({ dryRun: true });
    expect(parseCliArgs(['--apply'])).toEqual({ dryRun: false });
    expect(parseCliArgs(['--dry-run'])).toEqual({ dryRun: true });
    expect(() => parseCliArgs(['--force'])).toThrow('Unknown option: --force');
  });
});
