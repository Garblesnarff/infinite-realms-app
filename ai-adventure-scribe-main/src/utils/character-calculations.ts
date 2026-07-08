import { SPELLCASTING_ABILITY_MAP, FULL_CASTER_SLOTS_MAP } from './character-calculations-data';
import {
  calculateSkillModifiers,
  calculateSavingThrowModifiers,
  getClassSkillProficiencies,
  getRaceSkillProficiencies,
  getClassSavingThrowProficiencies,
  type SkillModifiers,
  type SavingThrowModifiers,
} from './character-proficiency-calculations';

import type { Character, CharacterClass } from '@/types/character';

import { EQUIPMENT_LOOKUP } from '@/data/equipmentOptions';

import {
  SKILLS_MAP,
  calculateProficiencyBonus,
  calculateHitPoints,
  calculateArmorClass,
  calculateCarryingCapacity,
} from '@/utils/character/basic-math';

/**
 * Comprehensive D&D 5e character calculations utility
 * Automates all the math needed for a character sheet
 */
export interface CharacterStats {
  // Core Stats
  proficiencyBonus: number;
  hitPoints: number;
  hitDie: string;
  armorClass: number;
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
  calculateArmorClass,
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
  spellcastingAbility?: keyof Character['abilityScores'] | null,
): number | undefined => {
  const ability =
    spellcastingAbility !== undefined
      ? spellcastingAbility
      : getSpellcastingAbility(character.class);
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
  spellcastingAbility?: keyof Character['abilityScores'] | null,
): number | undefined => {
  const ability =
    spellcastingAbility !== undefined
      ? spellcastingAbility
      : getSpellcastingAbility(character.class);
  if (!ability) {
    return undefined;
  }

  const abilityMod = character.abilityScores?.[ability]?.modifier || 0;
  const pb = profBonus !== undefined ? profBonus : calculateProficiencyBonus(character.level || 1);

  return pb + abilityMod;
};

/**
 * Get spellcasting ability for a class
 */
export const getSpellcastingAbility = (
  characterClass: CharacterClass | null,
): keyof Character['abilityScores'] | null => {
  if (!characterClass) {
    return null;
  }

  return SPELLCASTING_ABILITY_MAP[characterClass.name] || null;
};

/**
 * Calculate spell slots for a character (simplified, full casters only)
 */
export const calculateSpellSlots = (
  character: Character,
): { [level: number]: number } | undefined => {
  const spellcastingAbility = getSpellcastingAbility(character.class);
  if (!spellcastingAbility) {
    return undefined;
  }

  const level = character.level || 1;

  const slots = FULL_CASTER_SLOTS_MAP[level];
  if (!slots) {
    return undefined;
  }

  const spellSlots: { [level: number]: number } = {};
  slots.forEach((count: number, index: number) => {
    spellSlots[index + 1] = count;
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

export const getBaseSpeed = (character: Character): number =>
  character.subrace?.speed || character.race?.speed || 30;

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
  const carryingCapacity = strengthScore * 15;
  const encumberedThreshold = strengthScore * 5;
  const heavilyEncumberedThreshold = strengthScore * 10;
  const baseSpeed = getBaseSpeed(character);

  let encumbranceLevel: EncumbranceLevel = 'normal';
  let speedPenalty = 0;

  if (totalWeight >= carryingCapacity) {
    encumbranceLevel = 'overloaded';
    speedPenalty = baseSpeed;
  } else if (totalWeight >= heavilyEncumberedThreshold) {
    encumbranceLevel = 'heavily-encumbered';
    speedPenalty = 20;
  } else if (totalWeight >= encumberedThreshold) {
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
  const spellcastingAbility = getSpellcastingAbility(character.class);

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
    hitPoints: calculateHitPoints(character),
    hitDie: `1d${character.class?.hitDie || 8}`,
    armorClass: calculateArmorClass(character),
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
