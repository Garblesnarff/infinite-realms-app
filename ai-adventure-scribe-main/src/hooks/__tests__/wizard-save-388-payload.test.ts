/**
 * #388: pins the real wizard payload for a Hill Dwarf Fighter (base CON 14).
 *
 * Runs the exact producer chain useCharacterSave.saveCharacter calls for a new
 * character — transformCharacterForStorage, transformMulticlassingForStorage,
 * applyRacialBonusesToAbilityScores, transformAbilityScoresForStorage,
 * mapWizardEquipmentToInventory, transformEquipmentForStorage,
 * prepareCharacterPayload — and saves the result to
 * shared/test-fixtures/hill-dwarf-fighter-create-payload.json, which the server
 * real-DB test reads with readFileSync and POSTs through the real route.
 *
 * This breaks the circular HP assertion from earlier rounds: the pin here is
 * that base CON 14 -> 16 after Hill Dwarf +2 -> 14 HP (10 d10 + 3 CON + 1
 * Dwarven Toughness) as computed by the real transforms, not a number the
 * test itself chose. The server test then asserts the stored stats match.
 *
 * The fixture also carries the real Fighter kit shape that 500'd on prod: two
 * Handaxe rows (the kit lists 'handaxe' twice via getStartingEquipment).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { mapWizardEquipmentToInventory } from '../use-character-save';

import type { Character } from '@/types/character';

import { fighter } from '@/data/classes/fighter';
import { getStartingEquipment } from '@/data/equipment/api';
import { dwarf } from '@/data/races/dwarf';
import { prepareCharacterPayload } from '@/services/user-data-payload-helpers';
import { transformCharacterForStorage } from '@/types/character';
import {
  transformAbilityScoresForStorage,
  transformEquipmentForStorage,
  transformMulticlassingForStorage,
} from '@/utils/characterTransformations';
import { applyRacialBonusesToAbilityScores } from '@/utils/racialAbilityBonuses';

/** The temporary id useCharacterSave uses before the server assigns the real one. */
const TEMP_ID = '00000000-0000-0000-0000-000000000000';

/** Builds the wizard state for a Hill Dwarf Fighter at L1, base CON 14. */
function buildWizardCharacter(): Character {
  const hillDwarf = dwarf.subraces?.find((s) => s.id === 'hill-dwarf');
  if (!hillDwarf) throw new Error('Hill Dwarf subrace missing from dwarf race data');
  // The wizard's equipment step writes kit names (EquipmentSelection maps eq.name).
  const kitNames = getStartingEquipment('Fighter').map((e) => e.name);
  return {
    name: 'Hill Dwarf Fighter 388',
    race: dwarf,
    subrace: hillDwarf,
    class: fighter,
    level: 1,
    alignment: 'Lawful Good',
    abilityScores: {
      strength: { score: 15, modifier: 2, savingThrow: false },
      dexterity: { score: 14, modifier: 2, savingThrow: false },
      constitution: { score: 14, modifier: 2, savingThrow: false },
      intelligence: { score: 12, modifier: 1, savingThrow: false },
      wisdom: { score: 10, modifier: 0, savingThrow: false },
      charisma: { score: 8, modifier: -1, savingThrow: false },
    },
    equipment: kitNames,
    fightingStyles: ['Defense'],
    currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    languages: ['Common', 'Dwarvish'],
    skillProficiencies: ['Athletics'],
    classLevels: [{ classId: 'fighter', className: 'Fighter', level: 1, hitDie: 10, features: [] }],
  } as Character;
}

/**
 * The exact chain useCharacterSave.saveCharacter runs for a new character,
 * ending in the POST body userDataApi.createCharacter sends.
 */
function buildCreatePayload(character: Character): Record<string, unknown> {
  const characterData = {
    ...transformCharacterForStorage({
      ...character,
      campaign_id: null,
      user_id: 'test-user-388',
    }),
    ...transformMulticlassingForStorage(character),
  };

  if (!character.abilityScores) throw new Error('wizard character missing abilityScores');
  const finalAbilityScores = applyRacialBonusesToAbilityScores(
    character.abilityScores,
    character.race || null,
    character.subrace || null,
    character.racialAbilityChoices,
  );

  const raceTraits = [...(character.race?.traits || []), ...(character.subrace?.traits || [])];

  const statsData = transformAbilityScoresForStorage(
    finalAbilityScores,
    TEMP_ID,
    character.class?.name,
    raceTraits,
  );

  const equipmentData = transformEquipmentForStorage(
    { ...character, inventory: mapWizardEquipmentToInventory(character) },
    TEMP_ID,
  );

  return prepareCharacterPayload({
    ...characterData,
    stats: {
      strength: statsData.strength,
      dexterity: statsData.dexterity,
      constitution: statsData.constitution,
      intelligence: statsData.intelligence,
      wisdom: statsData.wisdom,
      charisma: statsData.charisma,
      armor_class: statsData.armor_class,
      current_hit_points: statsData.current_hit_points,
      max_hit_points: statsData.max_hit_points,
    },
    equipment: equipmentData,
  }) as Record<string, unknown>;
}

describe('wizard create payload (#388)', () => {
  it('pins the Hill Dwarf Fighter payload and saves the JSON fixture', () => {
    const payload = buildCreatePayload(buildWizardCharacter());
    const stats = payload.stats as Record<string, unknown>;
    const equipment = payload.equipment as Array<Record<string, unknown>>;

    // 2014 rules, computed by the real transforms from base CON 14:
    // Hill Dwarf +2 CON -> 16 (+3); Fighter L1 = 10 (d10) + 3 + 1 (Dwarven Toughness).
    expect(stats.constitution).toBe(16);
    expect(stats.wisdom).toBe(11);
    expect(stats.max_hit_points).toBe(14);
    expect(stats.current_hit_points).toBe(14);

    // The real Fighter kit shape that 500'd: two Handaxe rows, quantity 1 each.
    const handaxes = equipment.filter((row) => row.item_name === 'Handaxe');
    expect(handaxes).toHaveLength(2);
    expect(handaxes.map((row) => row.quantity)).toEqual([1, 1]);

    // The rest of the real wizard body the strategist asked the server loop to send.
    expect(payload.race).toBe('Dwarf');
    expect(payload.subrace).toBe('Hill Dwarf');
    expect(payload.class).toBe('Fighter');
    expect(payload.class_levels).toEqual([
      { classId: 'fighter', className: 'Fighter', level: 1, hitDie: 10, features: [] },
    ]);
    expect(payload.total_level).toBe(1);
    expect(payload.fighting_styles).toEqual(['Defense']);
    expect(payload.gold_pieces).toBe(0);
    expect(payload.prepared_spells).toBe('');

    const fixturePath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../shared/test-fixtures/hill-dwarf-fighter-create-payload.json',
    );
    mkdirSync(dirname(fixturePath), { recursive: true });
    writeFileSync(fixturePath, `${JSON.stringify(payload, null, 2)}\n`);
  });
});
