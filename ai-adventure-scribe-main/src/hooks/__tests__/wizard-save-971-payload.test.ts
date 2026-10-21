/**
 * #971: pins the real wizard payload for a Human Rogue with the Criminal
 * background who took the class equipment package (Hark N21-006).
 *
 * Runs the exact producer chain useCharacterSave.saveCharacter calls for a
 * new character (same chain as the #388/#901 pins) and saves the result to
 * shared/test-fixtures/criminal-rogue-create-payload.json, which the server
 * real-DB suite reads and POSTs through the real route.
 *
 * The bug on the wire: the Criminal background's equipment list carries its
 * gold as a bare '15 gp' string, and the wizard's equipment mapping turns
 * every equipment string into an inventory row — so the body below carries
 * '15 gp' as an equipment item and gold_pieces 0. The purse fix is
 * server-side (#971): the create must land that 15 in gold_pieces and store
 * no '15 gp' row. This pin documents the body the client really sends.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { mapWizardEquipmentToInventory } from '../use-character-save';

import type { Character } from '@/types/character';

import { backgrounds } from '@/data/backgroundOptions';
import { rogue } from '@/data/classes/rogue';
import { getStartingEquipment } from '@/data/equipmentOptions';
import { human } from '@/data/races/human';
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
 * Builds the wizard state EquipmentSelection leaves behind for the package
 * option: background equipment first, then the class package names (the
 * order handleEquipmentSelect composes them), option index 0, and an empty
 * purse — the package path zeroes currency.
 */
function buildWizardCharacter(): Character {
  const criminal = backgrounds.find((b) => b.id === 'criminal');
  if (!criminal) throw new Error('Criminal background missing');
  const packageNames = getStartingEquipment('Rogue').map((eq) => eq.name);
  return {
    name: 'Human Rogue 971',
    race: human,
    class: rogue,
    background: criminal,
    level: 1,
    alignment: 'Chaotic Neutral',
    abilityScores: {
      strength: { score: 8, modifier: -1, savingThrow: false },
      dexterity: { score: 15, modifier: 2, savingThrow: false },
      constitution: { score: 13, modifier: 1, savingThrow: false },
      intelligence: { score: 12, modifier: 1, savingThrow: false },
      wisdom: { score: 10, modifier: 0, savingThrow: false },
      charisma: { score: 14, modifier: 2, savingThrow: false },
    },
    equipment: [...criminal.equipment, ...packageNames],
    selectedEquipmentOptionIndex: 0,
    currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    languages: ['Common'],
    skillProficiencies: [
      'Acrobatics',
      'Deception',
      'Investigation',
      'Perception',
      'Sleight of Hand',
      'Stealth',
    ],
    toolProficiencies: ["Thieves' tools", 'One type of gaming set'],
    classLevels: [{ classId: 'rogue', className: 'Rogue', level: 1, hitDie: 8, features: [] }],
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
      user_id: 'test-user-971',
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

describe('wizard create payload — Criminal background gold (#971)', () => {
  it('pins the Criminal Rogue package payload and saves the JSON fixture', () => {
    const payload = buildCreatePayload(buildWizardCharacter());
    const equipment = payload.equipment as Array<Record<string, unknown>>;
    const names = equipment.map((row) => row.item_name);

    // The wire truth this issue is about: the background's 15 gp rides as an
    // equipment row, and the purse field is 0. The server create must split
    // the coin string into gold_pieces (proven by the real-DB suite).
    expect(names).toContain('15 gp');
    expect(names).toContain('A crowbar');
    expect(payload.gold_pieces).toBe(0);
    expect(payload.class).toBe('Rogue');
    expect(payload.background).toBe('Criminal');

    const fixturePath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../shared/test-fixtures/criminal-rogue-create-payload.json',
    );
    mkdirSync(dirname(fixturePath), { recursive: true });
    writeFileSync(fixturePath, `${JSON.stringify(payload, null, 2)}\n`);
  });
});
