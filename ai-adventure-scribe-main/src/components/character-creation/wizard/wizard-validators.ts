/* eslint-disable max-lines */
/**
 * Character Creation Wizard Step Validators
 *
 * Each function validates a single wizard step, extracted from the
 * monolithic validateCurrentStep() switch statement in WizardContent.tsx.
 */

import type { Character } from '@/types/character';

import logger from '@/lib/logger';
import { getSpellcastingInfo, getRacialSpells } from '@/utils/spell-validation';

export interface ValidationResult {
  isValid: boolean;
  message: string;
}

const VALID: ValidationResult = { isValid: true, message: '' };

function invalid(message: string): ValidationResult {
  return { isValid: false, message };
}

// ---------- Individual step validators ----------

function validateBasicInfo(character: Character): ValidationResult {
  if (!character.name?.trim()) {
    return invalid('Please enter a character name before proceeding');
  }
  return VALID;
}

function validateRace(character: Character): ValidationResult {
  if (!character.race) {
    return invalid('Please select a race for your character');
  }
  if (character.race.subraces && character.race.subraces.length > 0 && !character.subrace) {
    return invalid('Please select a subrace for your character');
  }
  return VALID;
}

function validateSubrace(character: Character): ValidationResult {
  if (character.race?.subraces?.length && !character.subrace) {
    return invalid('Please select a subrace for your character');
  }
  return VALID;
}

function validateClass(character: Character): ValidationResult {
  if (!character.class) {
    return invalid('Please select a class for your character');
  }
  return VALID;
}

function validateClassFeatures(character: Character): ValidationResult {
  const classFeatures = character.class?.classFeatures?.filter((f) => f.choices) || [];
  if (classFeatures.length > 0) {
    const hasAllFeatures = classFeatures.every((feature) => character.classFeatures?.[feature.id]);
    if (!hasAllFeatures) {
      return invalid('Please complete your class feature selections');
    }
  }
  return VALID;
}

function validateAbilityScores(character: Character): ValidationResult {
  if (!character.abilityScores) {
    return invalid('Please set your ability scores');
  }
  const abilities = [
    'strength',
    'dexterity',
    'constitution',
    'intelligence',
    'wisdom',
    'charisma',
  ] as const;
  const hasAllScores = abilities.every((ability) => character.abilityScores?.[ability]?.score >= 8);
  if (!hasAllScores) {
    return invalid('Please complete your ability score selection');
  }
  return VALID;
}

function validateBackground(character: Character): ValidationResult {
  if (!character.background) {
    return invalid('Please select a background for your character');
  }
  return VALID;
}

function validateProficiencies(character: Character): ValidationResult {
  if (!character.skillProficiencies?.length) {
    return invalid('Please complete your skill proficiency selections');
  }
  if (!character.languages?.length) {
    return invalid('Please complete your language selections');
  }
  return VALID;
}

function validateSpells(character: Character): ValidationResult {
  if (!character.class?.spellcasting) {
    return VALID;
  }

  const spellcastingInfo = getSpellcastingInfo(character.class, character.level || 1);
  if (!spellcastingInfo) {
    logger.warn('No spellcasting info found for class');
    return VALID;
  }

  const racialSpells = getRacialSpells(character.race?.name || '', character.subrace);

  if (spellcastingInfo.cantripsKnown > 0) {
    const expectedCantrips =
      spellcastingInfo.cantripsKnown + racialSpells.cantrips.length + racialSpells.bonusCantrips;
    const cantripCount = character.cantrips?.length || 0;
    if (cantripCount < expectedCantrips) {
      logger.warn('Not all cantrips selected, but allowing continuation');
    }
  }

  if (spellcastingInfo.spellsKnown && spellcastingInfo.spellsKnown > 0) {
    const spellCount = character.knownSpells?.length || 0;
    if (spellCount < spellcastingInfo.spellsKnown) {
      logger.warn('Not all spells selected, but allowing continuation');
    }
  }

  return VALID;
}

function validateAdvancedSpellcasting(character: Character): ValidationResult {
  const spellcasting = character.class?.spellcasting;
  if (!spellcasting) return VALID;

  const classId = character.class?.id?.toLowerCase() || '';
  const level = character.level || 1;

  // Spell preparation (Cleric, Druid, Paladin, Wizard)
  if (['cleric', 'druid', 'paladin', 'wizard'].includes(classId)) {
    const maxPreparedSpells = Math.max(
      1,
      level + (character.abilityScores?.[spellcasting.ability]?.modifier || 0),
    );
    const preparedCount = character.preparedSpells?.length || 0;
    if (preparedCount < maxPreparedSpells) {
      return invalid(
        `Please prepare ${maxPreparedSpells} spells for your ${character.class?.name}`,
      );
    }
  }

  // Metamagic (Sorcerer level 3+)
  if (classId === 'sorcerer' && level >= 3) {
    const maxMetamagicOptions = level < 10 ? 2 : level < 17 ? 3 : 4;
    const metamagicCount = character.metamagicOptions?.length || 0;
    if (metamagicCount < maxMetamagicOptions) {
      return invalid(
        `Please select ${maxMetamagicOptions} metamagic option${maxMetamagicOptions > 1 ? 's' : ''} for your ${character.class?.name}`,
      );
    }
  }

  // Pact Magic (Warlock)
  if (classId === 'warlock') {
    const pactProgression =
      level === 1
        ? { spellsKnown: 2 }
        : level === 2
          ? { spellsKnown: 3 }
          : level === 3
            ? { spellsKnown: 4 }
            : { spellsKnown: Math.min(15, 2 + level) };
    const pactSpellCount = character.pactMagicSpells?.length || 0;
    if (pactSpellCount < pactProgression.spellsKnown) {
      return invalid(
        `Please select ${pactProgression.spellsKnown} pact magic spell${pactProgression.spellsKnown > 1 ? 's' : ''} for your ${character.class?.name}`,
      );
    }
  }

  return VALID;
}

// ---------- Dispatcher ----------

const stepValidators: Record<string, (character: Character) => ValidationResult> = {
  'Basic Info': validateBasicInfo,
  Race: validateRace,
  Subrace: validateSubrace,
  Class: validateClass,
  'Class Features': validateClassFeatures,
  'Ability Scores': validateAbilityScores,
  Background: validateBackground,
  'Proficiencies & Languages': validateProficiencies,
  Spells: validateSpells,
  'Advanced Spellcasting': validateAdvancedSpellcasting,
};

/**
 * Validate a wizard step by its label.
 * Returns { isValid: true } for unrecognised steps (optional steps).
 */
export function validateStep(stepLabel: string, character: Character): ValidationResult {
  const validator = stepValidators[stepLabel];
  return validator ? validator(character) : VALID;
}

/**
 * Validate the entire character for final save.
 */
export function validateCharacterForSave(character: Character): boolean {
  const {
    race,
    class: characterClass,
    abilityScores,
    background,
    skillProficiencies,
    languages,
    name,
  } = character;

  const hasBasicFields = !!(
    name?.trim() &&
    race &&
    characterClass &&
    abilityScores &&
    background &&
    skillProficiencies !== undefined &&
    languages !== undefined
  );

  const hasValidSubrace = !race?.subraces?.length || !!character.subrace;

  let hasValidSpells = true;
  const spellcasting = characterClass?.spellcasting;
  if (spellcasting) {
    const spellcastingInfo = getSpellcastingInfo(characterClass, character.level || 1);
    if (spellcastingInfo) {
      const racialSpells = getRacialSpells(race?.name || '', character.subrace);
      const expectedCantrips =
        spellcastingInfo.cantripsKnown + racialSpells.cantrips.length + racialSpells.bonusCantrips;
      const expectedSpells = spellcastingInfo.spellsKnown || 0;

      const hasEnoughCantrips =
        expectedCantrips === 0 || (character.cantrips?.length || 0) >= expectedCantrips;
      const hasEnoughSpells =
        expectedSpells === 0 || (character.knownSpells?.length || 0) >= expectedSpells;

      hasValidSpells = hasEnoughCantrips && hasEnoughSpells;
    }
  }

  const classFeatures = characterClass?.classFeatures?.filter((f) => f.choices) || [];
  const hasValidClassFeatures =
    classFeatures.length === 0 ||
    (character.classFeatures &&
      classFeatures.every((feature) => character.classFeatures?.[feature.id]));

  return hasBasicFields && hasValidSubrace && hasValidSpells && !!hasValidClassFeatures;
}
