/**
 * Character Creation Wizard Step Validators
 *
 * Each function validates a single wizard step, extracted from the
 * monolithic validateCurrentStep() switch statement in WizardContent.tsx.
 */

import { getCharacterNameError } from './validation-rules';
import { validateSpells, validateAdvancedSpellcasting } from './wizard-spell-validators';

import type { Character } from '@/types/character';

import {
  calculatePointBuyPoints,
  POINT_BUY_MAX,
  POINT_BUY_MIN,
  POINT_BUY_TOTAL,
} from '@/hooks/ability-score/use-point-buy-logic';
import { getSpellcastingInfo, getRacialSpells } from '@/utils/spell-validation';

// Lowest score a 4d6-drop-lowest roll can produce (1+1+1).
const ROLLED_SCORE_MIN = 3;

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
  const nameError = getCharacterNameError(character.name || '');
  if (nameError) {
    return invalid('Name: ' + nameError);
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
  const abilityScores = character.abilityScores;
  const hasAllScores = abilities.every(
    (ability) => (abilityScores?.[ability]?.score as number) >= ROLLED_SCORE_MIN,
  );
  if (!hasAllScores) {
    return invalid('Please complete your ability score selection');
  }

  // Drafts saved before abilityScoreMethod existed have no method. Do not
  // treat that absence as point buy: a stored 16 or a total over 27 is a roll
  // and must still save. Only an explicit point-buy choice is budget-checked.
  // A missing method whose scores already fit 8–15 and 27 points passes either way.
  if (character.abilityScoreMethod === 'pointBuy') {
    const hasOutOfRangeScore = abilities.some((ability) => {
      const score = character.abilityScores?.[ability]?.score ?? POINT_BUY_MIN;
      return score < POINT_BUY_MIN || score > POINT_BUY_MAX;
    });
    if (hasOutOfRangeScore) {
      return invalid('Ability Scores: Point Buy scores must be between 8 and 15');
    }

    const pointsUsed = calculatePointBuyPoints(character);
    if (pointsUsed > POINT_BUY_TOTAL) {
      return invalid(
        `Ability Scores: Point Buy allows ${POINT_BUY_TOTAL} points maximum; you have used ${pointsUsed}.`,
      );
    }
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
  const fixedSkills = new Set([
    ...(character.background?.skillProficiencies ?? []),
    ...(character.race?.skillProficiencies ?? []),
  ]);
  const racialChoices =
    character.race?.id === 'half-elf' ? (character.racialSkillChoices ?? []) : [];
  if (character.race?.id === 'half-elf' && new Set(racialChoices).size !== 2) {
    return invalid('Please choose two Half-Elf Skill Versatility proficiencies');
  }
  const classChoices = (character.skillProficiencies ?? []).filter(
    (skill) => !fixedSkills.has(skill) && !racialChoices.includes(skill),
  );
  if (new Set(classChoices).size < (character.class?.numSkillChoices ?? 0)) {
    return invalid('Please complete your skill proficiency selections');
  }
  const classId = character.class?.id.toLowerCase();
  const classLevel =
    character.classLevels?.find((entry) => entry.classId === character.class?.id)?.level ??
    character.level ??
    1;
  const requiredExpertise =
    classId === 'rogue'
      ? classLevel >= 6
        ? 4
        : 2
      : classId === 'bard'
        ? classLevel >= 10
          ? 4
          : classLevel >= 3
            ? 2
            : 0
        : 0;
  if (new Set(character.expertiseProficiencies ?? []).size < requiredExpertise) {
    return invalid('Please complete your Expertise selections');
  }
  const fixedLanguages = new Set([
    ...(character.race?.languages ?? []).filter((language) => !/choice/i.test(language)),
    ...(character.class?.languages ?? []),
  ]);
  const requiredChoices =
    (character.background?.languages ?? 0) +
    (character.race?.languages ?? []).filter((language) => /choice/i.test(language)).length;
  const languageChoices = new Set(
    (character.languages ?? []).filter(
      (language) => !fixedLanguages.has(language) && !/choice/i.test(language),
    ),
  );
  if (languageChoices.size < requiredChoices || !character.languages?.length) {
    return invalid('Please complete your language selections');
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
  const nameError = getCharacterNameError(name || '');
  const abilityScoresValidation = validateAbilityScores(character);

  const hasBasicFields = !!(
    !nameError &&
    race &&
    characterClass &&
    abilityScores &&
    abilityScoresValidation.isValid &&
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
      const racialSpells = getRacialSpells(race?.name || '', character.subrace ?? undefined);
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
