import { getClassFeatureChoice } from '../../../shared/class-feature-choices';

import type { Character, CharacterSubclass } from '@/types/character';

import { classes } from '@/data/classes';

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
 *
 * In-session loads often carry only `{ name: 'Cleric' }` plus `subclassName`
 * ('Life Domain'). When `class.subclasses` is missing, resolve the catalog
 * class by name, and fall back to `subclassName` if no feature choice matches.
 */

type SubclassSource =
  | Pick<Character, 'class' | 'classFeatures' | 'subclassName'>
  | null
  | undefined;

function subclassesFor(character: SubclassSource): CharacterSubclass[] {
  const attached = character?.class?.subclasses ?? [];
  if (attached.length > 0) return attached;
  const className = character?.class?.name?.trim().toLowerCase();
  if (!className) return [];
  return classes.find((entry) => entry.name.toLowerCase() === className)?.subclasses ?? [];
}

/** The subclass the character chose at creation, or null when none was chosen. */
export function getChosenSubclass(character: SubclassSource): CharacterSubclass | null {
  const subclasses = subclassesFor(character);
  if (!character || subclasses.length === 0) return null;

  const choices = Object.keys(character.classFeatures ?? {})
    .map((featureId) => getClassFeatureChoice(character.classFeatures, featureId))
    .filter((choice): choice is string => choice !== null);

  const fromFeatures = subclasses.find((subclass) =>
    choices.some((choice) => choice.startsWith(subclass.name)),
  );
  if (fromFeatures) return fromFeatures;

  const named = character.subclassName?.trim();
  if (!named) return null;
  return (
    subclasses.find(
      (subclass) => named === subclass.name || named.startsWith(`${subclass.name}:`),
    ) ?? null
  );
}

/**
 * Spells the chosen subclass always has prepared at the character's level
 * (cleric domain spells), by display name. They never count against the
 * prepared-spell cap.
 */
export function getAlwaysPreparedSpells(
  character:
    | Pick<Character, 'class' | 'classFeatures' | 'level' | 'subclassName'>
    | null
    | undefined,
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
  character: Pick<Character, 'class' | 'classFeatures' | 'subclassName'> | null | undefined,
): string[] {
  return getChosenSubclass(character)?.armorProficiencies ?? [];
}
