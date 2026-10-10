/**
 * Racial traits, class features, per-character resource pools, and
 * spell-slot bookkeeping used by combat participants.
 */

import type { DamageType } from './combat-mechanics';

// ===========================
// Racial Traits & Class Features
// ===========================

export type RacialTraitName =
  | 'lucky'
  | 'breath_weapon'
  | 'draconic_resistance'
  | 'relentless_endurance'
  | 'fey_ancestry'
  | 'trance'
  | 'stonecunning'
  | 'poison_resistance'
  | 'hellish_resistance'
  | 'infernal_legacy'
  | 'natural_armor'
  | 'brave'
  | 'halfling_nimbleness';

export interface RacialTrait {
  name: RacialTraitName;
  description: string;
  type: 'passive' | 'active' | 'reaction';
  usesPerRest?: 'short' | 'long' | 'none';
  maxUses?: number;
  currentUses?: number;
  damageType?: DamageType; // For resistances
  spellLevel?: number; // For innate spells
  saveDC?: number; // For breath weapons, etc.
}

export type ClassFeatureName =
  | 'rage'
  | 'sneak_attack'
  | 'action_surge'
  | 'divine_smite'
  | 'deflect_missiles'
  | 'bardic_inspiration'
  | 'channel_divinity'
  | 'eldritch_invocations'
  | 'metamagic'
  | 'hunters_mark'
  | 'uncanny_dodge'
  | 'second_wind'
  | 'lay_on_hands'
  | 'ki';

export interface ClassFeature {
  name: ClassFeatureName;
  /** Human-readable label; the snake_case `name` stays the persistence key (#214). */
  displayName?: string;
  description: string;
  className: string;
  level: number;
  type: 'passive' | 'active' | 'reaction' | 'bonus_action';
  usesPerRest?: 'short' | 'long' | 'none';
  maxUses?: number;
  currentUses?: number;
  resourceCost?: number; // Ki points, sorcery points, etc.
}

export interface CharacterResources {
  hitDice: { [dieType: string]: { max: number; current: number } };
  kiPoints?: { max: number; current: number };
  sorceryPoints?: { max: number; current: number };
  bardic_inspiration?: { max: number; current: number };
  channelDivinity?: { max: number; current: number };
  rages?: { max: number; current: number };
  actionSurge?: { max: number; current: number };
  layOnHands?: { max: number; current: number };
}

// ===========================
// Spellcasting
// ===========================

export type SpellSlotLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface SpellSlotConfig {
  max: number;
  current: number;
}
