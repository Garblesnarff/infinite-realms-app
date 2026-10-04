/**
 * #2540 and #2541: the character sheet and the combat engine must agree, for every weapon of
 * every seeded premade, on who is proficient and what number that produces.
 *
 * Both sides run their real producers:
 * - the sheet number is `buildCharacterSheet` over the chain a seeded character takes in play
 *   (seed migration row -> `buildStarterCharacterSeed` -> `transformCharacterData`, whose
 *   equipment rows are what `character-service` inserts);
 * - the engine number is `listEquippedWeaponProfiles` — the attack dialog's weapon list,
 *   including the proficiency flag it decides — followed by `resolveAttackRules`. Only the
 *   database is stubbed.
 *
 * The rows carry the SRD display name in `item_name`, as the seeder writes it, and every weapon
 * row is handed to the engine as equipped so that the whole kit is compared, not just the first
 * two weapons the seeder marks.
 */
import { describe, expect, it, vi } from 'vitest';

import { buildStarterCharacterSeed } from '../starter-character-seeding';
import { readSeededPremadeTemplates } from './seeded-premade-templates';

import type { SeededPremadeTemplate } from './seeded-premade-templates';
import type { Issue1784EquipmentRow } from '@/services/issue-1784-api';
import type { Character } from '@/types/character';
import type { CharacterEquipmentRow } from '@/utils/character/data-transformers';

import { buildCharacterSheet } from '@/features/game-session/components/game/overhaul/useOverhaulViewModel';
import { transformCharacterData } from '@/utils/character/data-transformers';
import { equipmentRowsToInventory } from '@/utils/character/equipment-rows-to-inventory';

const CHARACTER_ID = 'character-2540';

/** Rows the two `db.select()` calls in `listEquippedWeaponProfiles` answer, in call order. */
let selectResults: unknown[][] = [];
/** The `characters` row for CHARACTER_ID, as the stubbed `findFirst` returns it. */
let characterRow: { class: string; race: string; subrace: string } | undefined;

vi.mock('../../../../db/client', () => ({
  db: {
    select: () => {
      const chain: unknown = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        then: (resolve: (rows: unknown[]) => unknown) => resolve(selectResults.shift() ?? []),
      };
      return chain;
    },
    query: { characters: { findFirst: () => characterRow } },
  },
}));

const { listEquippedWeaponProfiles } =
  await import('../../../../server-bun/src/services/combat/data-access');
const { resolveAttackRules } =
  await import('../../../../server-bun/src/services/combat/combat-rules');

const templates = readSeededPremadeTemplates();

/** The character as the game page loads a freshly seeded premade, equipment rows included. */
function sheetFor(template: SeededPremadeTemplate): {
  character: Character;
  weaponNames: string[];
} {
  const seed = buildStarterCharacterSeed(template, template.starter_campaign_id);
  const records = seed.equipment as Array<{
    item_name: string;
    item_type: string;
    equipped: boolean;
  }>;
  const rows = records.map((record, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    item_name: record.item_name,
    item_type: record.item_type,
    quantity: 1,
    equipped: true,
  }));
  const issue1784Rows = rows.map((row) => ({
    ...row,
    character_id: CHARACTER_ID,
    is_magic: false,
    magic_bonus: 0,
    magic_properties: null,
    requires_attunement: false,
    is_attuned: false,
    attunement_requirements: null,
    magic_item_type: null,
    magic_item_rarity: 'common',
    magic_effects: null,
  })) as unknown as Issue1784EquipmentRow[];
  characterRow = {
    class: seed.class as string,
    race: seed.race as string,
    subrace: (seed.subrace ?? '') as string,
  };
  // The engine reads `character_equipment`; the first select is `inventory_items`, which the
  // seeder writes no weapon rows into. The engine's rows carry the drizzle column names
  // (`item_name` is `itemName` there), which is the shape a real query returns.
  selectResults = [[], rows.map((row) => ({ id: row.id, itemName: row.item_name, magicBonus: 0 }))];
  // The sheet's inventory is `equipmentRowsToInventory`, which is what `loadCharacterWithSpells`
  // builds the game character's inventory from (itemId is the item NAME, per that mapper).
  const character = {
    ...transformCharacterData(
      {
        id: CHARACTER_ID,
        user_id: 'user-2540',
        name: seed.name,
        race: seed.race as string,
        subrace: seed.subrace as string | null,
        class: seed.class as string,
        level: seed.level as number,
        background: seed.background as string | null,
      } as never,
      seed.stats as never,
      rows as unknown as CharacterEquipmentRow[],
    ),
    inventory: equipmentRowsToInventory(issue1784Rows),
  };
  return {
    character,
    weaponNames: records
      .filter((record) => record.item_type === 'weapon')
      .map((record) => record.item_name),
  };
}

/** The engine's attack bonus for each weapon of the kit, in the kit's order. */
async function engineBonuses(character: Character, weaponNames: string[]): Promise<number[]> {
  const profiles = await listEquippedWeaponProfiles({ characterId: CHARACTER_ID });
  const byName = new Map(profiles.map((profile) => [profile.name, profile]));
  return weaponNames.map((name) => {
    const profile = byName.get(name);
    if (!profile) throw new Error(`no engine weapon profile for ${name}`);
    return resolveAttackRules({
      strength: character.abilityScores?.strength?.score ?? 10,
      dexterity: character.abilityScores?.dexterity?.score ?? 10,
      level: character.level ?? 1,
      baseTargetAc: 15,
      weapon: profile,
    }).attackBonus;
  });
}

describe('the sheet and the engine agree on every seeded premade weapon (#2540, #2541)', () => {
  // Every seeded premade, named rather than counted: #2578 gave the five Academy of Arcane
  // Gastronomy rows their equipment, so the set is 35 now. A count would go stale silently; the
  // key list makes a new premade a deliberate line here, and the loop below covers all of them.
  const SEEDED_PREMADES = [
    'abyssal-descent/the-veteran',
    'abyssal-descent/the-scholar',
    'abyssal-descent/the-hunter',
    'abyssal-descent/the-pact-bound',
    'abyssal-descent/the-exile',
    'the-eternal-feast/the-storyteller',
    'the-eternal-feast/the-faithful',
    'the-eternal-feast/the-lucky-one',
    'the-eternal-feast/the-reveler',
    'the-eternal-feast/the-seeker',
    'curse-of-the-jersey-devil/the-tracker',
    'curse-of-the-jersey-devil/the-circuit-preacher',
    'curse-of-the-jersey-devil/the-almanac-keeper',
    'curse-of-the-jersey-devil/the-moonshiner',
    'curse-of-the-jersey-devil/the-furnace-born',
    'the-impossible-vault/the-cardsharp',
    'the-impossible-vault/the-cracksman',
    'the-impossible-vault/the-bouncer',
    'the-impossible-vault/the-chaplain',
    'the-impossible-vault/the-luck-scholar',
    'wings-of-the-void/the-rimrunner',
    'wings-of-the-void/the-rigger',
    'wings-of-the-void/the-cartographer',
    'wings-of-the-void/the-windspeaker',
    'wings-of-the-void/the-deserter',
    'journey-to-the-inner-world/the-driller',
    'journey-to-the-inner-world/the-surveyor',
    'journey-to-the-inner-world/the-lamplighter',
    'journey-to-the-inner-world/the-chaplain',
    'journey-to-the-inner-world/the-echo',
    'academy-of-arcane-gastronomy/the-apprentice',
    'academy-of-arcane-gastronomy/the-kitchen-hand',
    'academy-of-arcane-gastronomy/the-gourmand',
    'academy-of-arcane-gastronomy/the-herbalist',
    'academy-of-arcane-gastronomy/the-sous-chef',
  ];

  it('reads every seeded premade the list names', () => {
    expect(templates.map((row) => `${row.starter_campaign_id}/${row.template_key}`).sort()).toEqual(
      [...SEEDED_PREMADES].sort(),
    );
  });

  it.each(templates.map((row) => [`${row.starter_campaign_id}/${row.template_key}`, row] as const))(
    '%s',
    async (_key, template) => {
      const { character, weaponNames } = sheetFor(template);
      // The sheet prints a signed string; the engine computes the number behind it.
      const sheetBonuses = buildCharacterSheet(character).attacks.map((attack) =>
        Number(attack.bonus),
      );

      expect(sheetBonuses).toEqual(await engineBonuses(character, weaponNames));
    },
  );
});

describe('parity also holds where the answer depends on race and subrace', () => {
  // No seeded premade's weapon bonus turns on race or subrace (the seeded Elves and Dwarves are a
  // Ranger and two Fighters, who hold every weapon anyway), so the loop above would pass even if
  // one side stopped reading race and subrace — the #2540 disagreement exactly. These characters
  // are the same real producer chain with a Wizard's race/subrace and kit set to values whose
  // answer flips on the training.
  const almanac = templates.find((row) => row.template_key === 'the-almanac-keeper');
  if (!almanac) throw new Error('no seeded premade the-almanac-keeper');

  // The training column is what the SRD grants that character and no other: High Elf weapon
  // training (longswords, shortbows, longbows, shortswords) and the dwarves' racial axes and
  // hammers. Wood Elf, Drow and Mountain Dwarf have none of it — `src/data/races/elf.ts` gives
  // Weapon Training to the High Elf alone and `dwarf.ts` gives Mountain Dwarf armor training — so
  // those rows are the negative half of the same check: both sides must withhold the bonus.
  // `training` is the second column so the `%i` in the title reads it, not the race.
  it.each([
    ['a High Elf Wizard longsword', 2, 'Elf', 'High Elf', 'longsword'],
    ['a High Elf Wizard shortbow', 2, 'Elf', 'High Elf', 'shortbow'],
    ['a Wood Elf Wizard longsword', 0, 'Elf', 'Wood Elf', 'longsword'],
    ['a Drow Wizard longbow', 0, 'Elf', 'Drow', 'longbow'],
    ['a Drow Wizard shortsword', 0, 'Elf', 'Drow', 'shortsword'],
    ['a Mountain Dwarf Wizard maul', 0, 'Dwarf', 'Mountain Dwarf', 'maul'],
    ['a Mountain Dwarf Wizard warhammer', 2, 'Dwarf', 'Mountain Dwarf', 'warhammer'],
    ['a Hill Dwarf Wizard warhammer', 2, 'Dwarf', 'Hill Dwarf', 'warhammer'],
    ['a Hill Dwarf Wizard maul', 0, 'Dwarf', 'Hill Dwarf', 'maul'],
  ] as const)(
    '%s gets %i from its training, on both sides',
    async (_l, training, race, subrace, weapon) => {
      const bonusFor = async (aRace: string, aSubrace: string): Promise<[number, number]> => {
        const { character, weaponNames } = sheetFor({
          ...almanac,
          race: aRace,
          subrace: aSubrace,
          equipment: [weapon, 'component pouch'],
        });
        const sheetBonus = Number(buildCharacterSheet(character).attacks[0].bonus);
        const [engineBonus] = await engineBonuses(character, weaponNames);
        return [sheetBonus, engineBonus];
      };

      const trained = await bonusFor(race, subrace);
      const untrained = await bonusFor('Human', '');

      // Both sides agree with each other...
      expect(trained[0]).toBe(trained[1]);
      expect(untrained[0]).toBe(untrained[1]);
      // ...and the training is worth exactly the level-1 proficiency bonus on both, or nothing.
      expect(trained[0] - untrained[0]).toBe(training);
    },
  );
});
