import { getClassFeatureChoice } from '../../../shared/class-feature-choices';

import type { Character, CharacterSubclass } from '@/types/character';

/**
 * What a character's chosen subclass grants on top of the class itself.
 *
 * The wizard stores the subclass pick as a class-feature choice string
 * (`'Life Domain: Focuses on healing and protection'` under the cleric's
 * `divine-domain` feature, `'Draconic Bloodline: ...'` under the sorcerer's
 * `sorcerous-origin`). Every class declares its subclasses in its data
 * (`character.class.subclasses`), so the chosen subclass is the entry whose
 * name prefixes one of the stored choices. Grants declared in that data —
 * domain spells, bonus armor proficiencies — resolve here so the spell
 * step, the step validator and the sheet's proficiencies card cannot drift.
 */

/** The subclass the character chose at creation, or null when none was chosen. */
export function getChosenSubclass(
  character: Pick<Character, 'class' | 'classFeatures'> | null | undefined,
): CharacterSubclass | null {
  const subclasses = character?.class?.subclasses ?? [];
  if (!character || subclasses.length === 0) return null;

  const choices = Object.keys(character.classFeatures ?? {})
    .map((featureId) => getClassFeatureChoice(character.classFeatures, featureId))
    .filter((choice): choice is string => choice !== null);

  return (
    subclasses.find((subclass) =>
      choices.some((choice) => choice.startsWith(subclass.name)),
    ) ?? null
  );
}

/**
 * Spells the chosen subclass always has prepared at the character's level
 * (cleric domain spells), by display name. They never count against the
 * prepared-spell cap.
 */
export function getAlwaysPreparedSpells(
  character: Pick<Character, 'class' | 'classFeatures' | 'level'> | null | undefined,
): string[] {
  const subclass = getChosenSubclass(character);
  if (!subclass?.domainSpells || !character) return [];
  const level = character.level ?? 1;
  const spells: string[] = [];
  for (const [gainedAt, names] of Object.entries(subclass.domainSpells)) {
    if (level >= Number(gainedAt)) spells.push(...names);
  }
  return spells;
}

/** Armor proficiencies granted by the chosen subclass, beyond the class list. */
export function getSubclassArmorProficiencies(
  character: Pick<Character, 'class' | 'classFeatures'> | null | undefined,
): string[] {
  return getChosenSubclass(character)?.armorProficiencies ?? [];
}
