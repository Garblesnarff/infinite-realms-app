/**
 * #901: pins the real wizard payload for a Wood Elf Monk who chose the
 * Starting Gold option (Outlander background — its kit carries a Staff).
 *
 * Runs the exact producer chain useCharacterSave.saveCharacter calls for a
 * new character (same chain as the #388 pin) and saves the rolled-gold
 * result to shared/test-fixtures/wood-elf-monk-starting-gold-create-payload.json,
 * which the server real-DB suite reads and POSTs through the real route.
 *
 * The bug: picking the gold card without rolling granted the class average,
 * and the monk average is 12.5 (5d4 x 1) — a fraction that went on the wire
 * into an integer column and 500'd the create. The payload's gold must be
 * whole on every path: a roll (already whole), a floored average grant, and
 * a fractional balance arriving from a pre-fix resumed draft.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { mapWizardEquipmentToInventory } from '../use-character-save';

import type { Character } from '@/types/character';

import { backgrounds } from '@/data/backgroundOptions';
import { monk } from '@/data/classes/monk';
import { elf } from '@/data/races/elf';
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

/**
 * Builds the wizard state EquipmentSelection leaves behind for the gold
 * option: background equipment only (the class kit is replaced by gold),
 * option index 1, and the given gp balance in currency.
 */
function buildWizardCharacter(gp: number): Character {
  const woodElf = elf.subraces?.find((s) => s.id === 'wood-elf');
  if (!woodElf) throw new Error('Wood Elf subrace missing from elf race data');
  const outlander = backgrounds.find((b) => b.id === 'outlander');
  if (!outlander) throw new Error('Outlander background missing');
  return {
    name: 'Wood Elf Monk 901',
    race: elf,
    subrace: woodElf,
    class: monk,
    background: outlander,
    level: 1,
    alignment: 'Lawful Neutral',
    abilityScores: {
      strength: { score: 12, modifier: 1, savingThrow: false },
      dexterity: { score: 16, modifier: 3, savingThrow: false },
      constitution: { score: 13, modifier: 1, savingThrow: false },
      intelligence: { score: 10, modifier: 0, savingThrow: false },
      wisdom: { score: 15, modifier: 2, savingThrow: false },
      charisma: { score: 8, modifier: -1, savingThrow: false },
    },
    equipment: [...outlander.equipment],
    selectedEquipmentOptionIndex: 1,
    currency: { cp: 0, sp: 0, ep: 0, gp, pp: 0 },
    languages: ['Common', 'Elvish'],
    skillProficiencies: ['Athletics', 'Survival'],
    classLevels: [{ classId: 'monk', className: 'Monk', level: 1, hitDie: 8, features: [] }],
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
      user_id: 'test-user-901',
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

  const statsData = transformAbilityScoresForStorage(finalAbilityScores, TEMP_ID);

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
    },
    equipment: equipmentData,
  }) as Record<string, unknown>;
}

describe('wizard create payload — starting gold (#901)', () => {
  it('pins the rolled-gold Wood Elf Monk payload and saves the JSON fixture', () => {
    const payload = buildCreatePayload(buildWizardCharacter(14));
    const equipment = payload.equipment as Array<Record<string, unknown>>;

    // Rolled gold lands whole, and the background's weapon (Staff) is in the
    // equipment rows — the create must persist both (issue leg d).
    expect(payload.gold_pieces).toBe(14);
    expect(equipment.map((row) => row.item_name)).toContain('Staff');
    expect(payload.class).toBe('Monk');
    expect(payload.race).toBe('Elf');
    expect(payload.subrace).toBe('Wood Elf');

    const fixturePath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../shared/test-fixtures/wood-elf-monk-starting-gold-create-payload.json',
    );
    mkdirSync(dirname(fixturePath), { recursive: true });
    writeFileSync(fixturePath, `${JSON.stringify(payload, null, 2)}\n`);
  });

  it('puts whole gold on the wire when the balance is fractional (pre-fix draft)', () => {
    // The pre-fix average grant left 12.5 in currency.gp; a draft saved then
    // still carries it. The storage transform is the wire producer — it must
    // never emit the fraction that 500'd the integer column.
    const payload = buildCreatePayload(buildWizardCharacter(12.5));
    expect(payload.gold_pieces).toBe(12);
    expect(Number.isInteger(payload.gold_pieces)).toBe(true);
  });
});
