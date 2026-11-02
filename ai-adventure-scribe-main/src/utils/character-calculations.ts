import { SPELLCASTING_ABILITY_MAP } from './character-calculations-data';
// #617: spell-slot tables live in shared/spell-slot-tables.ts (epic #616).
import {
  calculateSkillModifiers,
  calculateSavingThrowModifiers,
  getClassSkillProficiencies,
  getRaceSkillProficiencies,
  getClassSavingThrowProficiencies,
  type SkillModifiers,
  type SavingThrowModifiers,
} from './character-proficiency-calculations';
import { ENCUMBRANCE_THRESHOLDS } from '../../shared/carrying-capacity';
import { FULL_CASTER_SLOTS } from '../../shared/spell-slot-tables';
import { findSrdClass } from '../../shared/srd-class-data';
import {
  applyMovementSpeedModifiers,
  resolveCharacterCombatSpeed,
} from '../../shared/srd-race-speed-data';

import type { AbilityScores, Character, CharacterClass } from '@/types/character';

import { EQUIPMENT_LOOKUP } from '@/data/equipmentOptions';
import { getSpellSlotsByLevel } from '@/data/spellcastingFeatures';
import {
  SKILLS_MAP,
  calculateProficiencyBonus,
  calculateHitPoints,
  calculateCarryingCapacity,
} from '@/utils/character/basic-math';
import { getCharacterSheetArmorClass } from '@/utils/character/character-sheet-armor-class';
import { getCharacterSheetHitPoints } from '@/utils/character/character-sheet-hit-points';

/**
 * Comprehensive D&D 5e character calculations utility
 * Automates all the math needed for a character sheet
 */
export interface CharacterStats {
  // Core Stats
  proficiencyBonus: number;
  hitPoints: number | null;
  hitDie: string;
  armorClass: number | null;
  initiative: number;
  speed: number;

  // Spellcasting (if applicable)
  spellSaveDC?: number;
  spellAttackBonus?: number;
  spellcastingAbility?: string;
  spellSlots?: { [level: number]: number };

  // Skills & Proficiencies
  skillModifiers: SkillModifiers;
  savingThrowModifiers: SavingThrowModifiers;

  // Combat
  carryingCapacity: number;
  baseSpeed: number;
  encumbranceLevel: EncumbranceLevel;
  speedPenalty: number;
  armorSpeedPenalty: number;
  stealthDisadvantage: boolean;
  totalCarriedWeight: number;
  passivePerception: number;
  passiveInvestigation: number;
  passiveInsight: number;

  // Combined race/subrace data
  allTraits: string[];
  allLanguages: string[];
}

export type EncumbranceLevel = 'normal' | 'encumbered' | 'heavily-encumbered' | 'overloaded';

export interface CurrencyLike {
  cp?: number;
  sp?: number;
  ep?: number;
  gp?: number;
  pp?: number;
}

export interface EncumbranceSummary {
  currentWeight: number;
  currencyWeight: number;
  totalWeight: number;
  carryingCapacity: number;
  encumberedThreshold: number;
  heavilyEncumberedThreshold: number;
  encumbranceLevel: EncumbranceLevel;
  speedPenalty: number;
  baseSpeed: number;
  effectiveSpeed: number;
}

// Re-export basic calculations for backward compatibility
export {
  SKILLS_MAP,
  calculateProficiencyBonus,
  calculateHitPoints,
  calculateCarryingCapacity,
};

// Re-export proficiency calculations for backward compatibility
export {
  calculateSkillModifiers,
  calculateSavingThrowModifiers,
  getClassSkillProficiencies,
  getRaceSkillProficiencies,
  getClassSavingThrowProficiencies,
};

/**
 * Calculate spell save DC for spellcasters
 * ⚡ Bolt: Added optional profBonus and ability to avoid redundant calculations.
 */
export const calculateSpellSaveDC = (
  character: Character,
  profBonus?: number,
  spellcastingAbility?: keyof AbilityScores | null,
): number | undefined => {
  const ability =
    spellcastingAbility !== undefined
      ? spellcastingAbility
      : getSpellcastingAbility(character.class, character.level || 1);
  if (!ability) {
    return undefined;
  }

  const abilityMod = character.abilityScores?.[ability]?.modifier || 0;
  const pb = profBonus !== undefined ? profBonus : calculateProficiencyBonus(character.level || 1);

  return 8 + pb + abilityMod;
};

/**
 * Calculate spell attack bonus for spellcasters
 * ⚡ Bolt: Added optional profBonus and ability to avoid redundant calculations.
 */
export const calculateSpellAttackBonus = (
  character: Character,
  profBonus?: number,
  spellcastingAbility?: keyof AbilityScores | null,
): number | undefined => {
  const ability =
    spellcastingAbility !== undefined
      ? spellcastingAbility
      : getSpellcastingAbility(character.class, character.level || 1);
  if (!ability) {
    return undefined;
  }

  const abilityMod = character.abilityScores?.[ability]?.modifier || 0;
  const pb = profBonus !== undefined ? profBonus : calculateProficiencyBonus(character.level || 1);

  return pb + abilityMod;
};

/**
 * Get spellcasting ability for a class. With `level`, a class that has not reached its first
 * spellcasting level yet (2014 Ranger and Paladin cast from level 2) has none.
 */
export const getSpellcastingAbility = (
  characterClass: CharacterClass | null | undefined,
  level?: number,
): keyof AbilityScores | null => {
  if (!characterClass) {
    return null;
  }

  const firstSpellcastingLevel =
    findSrdClass(characterClass.name)?.spellcasting?.firstSpellcastingLevel ?? 1;
  if (level !== undefined && level < firstSpellcastingLevel) {
    return null;
  }

  return SPELLCASTING_ABILITY_MAP[characterClass.name] || null;
};

const HALF_CASTER_CLASS_NAMES = new Set(['Paladin', 'Ranger']);
const FULL_CASTER_CLASS_NAMES = new Set(['wizard', 'cleric', 'druid', 'sorcerer', 'bard']);

/**
 * Max spell slots from classLevels (multiclass-aware). Merged from
 * spell-management.ts (#617): full caster levels add fully, half caster
 * levels add floor(level/2) when multiclassed, ceil(level/2) when single.
 */
function calculateClassLevelsMaxSlots(
  classLevels: Array<{ className: string; level: number }>,
): { [level: number]: number } | undefined {
  let fullCasterLevels = 0;
  let halfCasterLevels = 0;
  const isMulticlass = classLevels.length > 1;

  for (const classLevel of classLevels) {
    const name = classLevel.className.toLowerCase();
    if (FULL_CASTER_CLASS_NAMES.has(name)) {
      fullCasterLevels += classLevel.level;
    } else if (name === 'paladin' || name === 'ranger') {
      if (isMulticlass) {
        halfCasterLevels += Math.floor(classLevel.level / 2);
      } else if (classLevel.level >= 2) {
        halfCasterLevels += Math.ceil(classLevel.level / 2);
      }
    }
    // Warlocks use Pact Magic and don't contribute to the multiclass table.
  }

  const effectiveCasterLevel = Math.min(fullCasterLevels + halfCasterLevels, 20);
  if (effectiveCasterLevel < 1) return undefined;
  const table = FULL_CASTER_SLOTS[effectiveCasterLevel];
  if (!table) return undefined;

  const spellSlots: { [level: number]: number } = {};
  table.forEach((count: number, index: number) => {
    if (count > 0) spellSlots[index + 1] = count;
  });
  return spellSlots;
}

/**
 * Calculate spell slots for a character.
 *
 * #617: the single owner (merged from spell-management.ts). When
 * character.classLevels is present it drives the result (multiclass-aware);
 * otherwise the single-class character.class path is used.
 */
export const calculateSpellSlots = (
  character: Character,
): { [level: number]: number } | undefined => {
  if (character.classLevels && character.classLevels.length > 0) {
    return calculateClassLevelsMaxSlots(character.classLevels);
  }

  const level = character.level || 1;
  const spellcastingAbility = getSpellcastingAbility(character.class, level);
  if (!spellcastingAbility) {
    return undefined;
  }

  const className = character.class?.name ?? '';
  const slots = HALF_CASTER_CLASS_NAMES.has(className)
    ? getSpellSlotsByLevel(className, level)
    : FULL_CASTER_SLOTS[level];
  if (!slots) {
    return undefined;
  }

  const spellSlots: { [level: number]: number } = {};
  slots.forEach((count: number, index: number) => {
    if (count > 0) spellSlots[index + 1] = count;
  });

  return spellSlots;
};

/**
 * Calculate passive perception
 * ⚡ Bolt: Added optional skillMods to avoid redundant O(N) calculateSkillModifiers calls.
 */
export const calculatePassivePerception = (
  character: Character,
  skillMods?: SkillModifiers,
): number => {
  const mods = skillMods || calculateSkillModifiers(character);
  return 10 + (mods['Perception']?.modifier || 0);
};

export const getBaseSpeed = (character: Character): number => {
  const stats = Array.isArray(character.character_stats)
    ? character.character_stats[0]
    : character.character_stats;
  const raceBase = character.subrace?.speed || character.race?.speed || 30;
  const stored = stats?.speed;
  const base =
    stored && stored !== 30
      ? resolveCharacterCombatSpeed(stored, character.race?.name, character.subrace?.name)
      : raceBase;
  return applyMovementSpeedModifiers(base, {
    className: character.class?.name,
    level: character.level,
    classLevels: character.classLevels,
    classFeatures: character.classFeatures,
    feats: character.feats,
    strength: character.abilityScores?.strength?.score,
    race: character.race?.name,
    equipment: character.inventory?.map((item) => ({
      item_name: item.itemName || item.itemId,
      item_type: item.itemType,
      equipped: item.equipped,
    })),
  });
};

export const calculateInventoryWeight = (character: Character): number =>
  character.inventory?.reduce((total, item) => {
    const quantity = item.quantity || 1;
    const itemWeight = item.weight ?? 1;
    return total + itemWeight * quantity;
  }, 0) || 0;

export const calculateCurrencyWeight = (currency?: CurrencyLike): number => {
  if (!currency) return 0;
  const totalCoins =
    (currency.cp || 0) +
    (currency.sp || 0) +
    (currency.ep || 0) +
    (currency.gp || 0) +
    (currency.pp || 0);
  return Math.floor(totalCoins / 50);
};

export const calculateEncumbrance = (
  character: Character,
  currency: CurrencyLike = character.currency || {},
): EncumbranceSummary => {
  const strengthScore = character.abilityScores?.strength?.score || 10;
  const currentWeight = calculateInventoryWeight(character);
  const currencyWeight = calculateCurrencyWeight(currency);
  const totalWeight = currentWeight + currencyWeight;
  const carryingCapacity = calculateCarryingCapacity(character);
  const encumberedThreshold = strengthScore * ENCUMBRANCE_THRESHOLDS.ENCUMBERED;
  const heavilyEncumberedThreshold = strengthScore * ENCUMBRANCE_THRESHOLDS.HEAVILY_ENCUMBERED;
  const baseSpeed = getBaseSpeed(character);

  let encumbranceLevel: EncumbranceLevel = 'normal';
  let speedPenalty = 0;

  if (totalWeight >= carryingCapacity) {
    encumbranceLevel = 'overloaded';
    speedPenalty = baseSpeed;
  } else if (totalWeight > heavilyEncumberedThreshold) {
    encumbranceLevel = 'heavily-encumbered';
    speedPenalty = 20;
  } else if (totalWeight > encumberedThreshold) {
    encumbranceLevel = 'encumbered';
    speedPenalty = 10;
  }

  return {
    currentWeight,
    currencyWeight,
    totalWeight,
    carryingCapacity,
    encumberedThreshold,
    heavilyEncumberedThreshold,
    encumbranceLevel,
    speedPenalty,
    baseSpeed,
    effectiveSpeed: Math.max(0, baseSpeed - speedPenalty),
  };
};

/**
 * Calculate all character stats at once
 * ⚡ Bolt: Optimized by extracting shared values and eliminating redundant sub-calls.
 * This reduces execution time by avoiding multiple O(N) skill calculations and repeated O(1) lookups.
 */
export const calculateAllCharacterStats = (character: Character): CharacterStats => {
  const level = character.level || 1;
  const pb = calculateProficiencyBonus(level);
  const spellcastingAbility = getSpellcastingAbility(character.class, level);

  // Combined traits from race and subrace
  const allTraits = [...(character.race?.traits || []), ...(character.subrace?.traits || [])];

  // Combined languages from race and subrace (remove duplicates)
  const allLanguages = [
    ...new Set([...(character.race?.languages || []), ...(character.subrace?.languages || [])]),
  ];

  const skillMods = calculateSkillModifiers(character, pb);
  const encumbrance = calculateEncumbrance(character);
  const equippedArmor = character.equippedArmor
    ? EQUIPMENT_LOOKUP.get(character.equippedArmor)
    : undefined;
  const strengthScore = character.abilityScores?.strength?.score ?? 10;
  const armorSpeedPenalty =
    equippedArmor?.strengthRequirement && strengthScore < equippedArmor.strengthRequirement
      ? 10
      : 0;

  return {
    proficiencyBonus: pb,
    // Existing-character displays must honor server-authoritative character_stats;
    // missing stored HP remains null instead of being synthesized.
    hitPoints: getCharacterSheetHitPoints(character).maximum,
    hitDie: `1d${character.class?.hitDie || 8}`,
    armorClass: getCharacterSheetArmorClass(character),
    initiative: character.abilityScores?.dexterity?.modifier || 0,
    speed: Math.max(0, encumbrance.effectiveSpeed - armorSpeedPenalty),

    spellSaveDC: calculateSpellSaveDC(character, pb, spellcastingAbility),
    spellAttackBonus: calculateSpellAttackBonus(character, pb, spellcastingAbility),
    spellcastingAbility: spellcastingAbility || undefined,
    spellSlots: calculateSpellSlots(character),

    skillModifiers: skillMods,
    savingThrowModifiers: calculateSavingThrowModifiers(character, pb),

    carryingCapacity: calculateCarryingCapacity(character),
    baseSpeed: encumbrance.baseSpeed,
    encumbranceLevel: encumbrance.encumbranceLevel,
    speedPenalty: encumbrance.speedPenalty + armorSpeedPenalty,
    armorSpeedPenalty,
    stealthDisadvantage: equippedArmor?.stealthDisadvantage === true,
    totalCarriedWeight: encumbrance.totalWeight,
    passivePerception: calculatePassivePerception(character, skillMods),
    passiveInvestigation: 10 + (skillMods['Investigation']?.modifier || 0),
    passiveInsight: 10 + (skillMods['Insight']?.modifier || 0),

    // Additional combined data for future use
    allTraits,
    allLanguages,
  };
};
