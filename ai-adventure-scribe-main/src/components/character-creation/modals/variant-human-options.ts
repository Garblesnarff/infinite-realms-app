/**
 * Static option data for the Variant Human customization modal, split out
 * of VariantHumanChoice.tsx.
 */

import type { AbilityScoreName } from '@/utils/racialAbilityBonuses';

export const ABILITY_OPTIONS: { name: AbilityScoreName; label: string; description: string }[] = [
  { name: 'strength', label: 'Strength', description: 'Physical power and athletic ability' },
  { name: 'dexterity', label: 'Dexterity', description: 'Agility, reflexes, and finesse' },
  { name: 'constitution', label: 'Constitution', description: 'Endurance and health' },
  { name: 'intelligence', label: 'Intelligence', description: 'Reasoning and memory' },
  { name: 'wisdom', label: 'Wisdom', description: 'Awareness and insight' },
  { name: 'charisma', label: 'Charisma', description: 'Force of personality' },
];

// Common 1st level feats for Variant Human
export const FEAT_OPTIONS = [
  {
    id: 'alert',
    name: 'Alert',
    description:
      "+5 to initiative, can't be surprised while conscious, enemies don't gain advantage from being hidden.",
    category: 'combat',
  },
  {
    id: 'athlete',
    name: 'Athlete',
    description:
      "+1 STR or DEX, stand from prone with 5ft movement, climbing doesn't cost extra, running jumps with 5ft start.",
    category: 'utility',
  },
  {
    id: 'lucky',
    name: 'Lucky',
    description:
      '3 luck points. Spend to roll extra d20 for attack, ability check, or saving throw (or when attacked).',
    category: 'utility',
  },
  {
    id: 'magic-initiate',
    name: 'Magic Initiate',
    description:
      'Learn 2 cantrips and one 1st-level spell from a chosen class. Cast the 1st-level spell once per long rest.',
    category: 'magic',
  },
  {
    id: 'martial-adept',
    name: 'Martial Adept',
    description:
      'Learn 2 maneuvers from Battle Master. Gain one d6 superiority die (regain on short/long rest).',
    category: 'combat',
  },
  {
    id: 'observant',
    name: 'Observant',
    description: '+1 INT or WIS. Read lips. +5 to passive Perception and Investigation.',
    category: 'utility',
  },
  {
    id: 'resilient',
    name: 'Resilient',
    description:
      '+1 to chosen ability score. Gain proficiency in saving throws using that ability.',
    category: 'defense',
  },
  {
    id: 'sharpshooter',
    name: 'Sharpshooter',
    description:
      'Ignore half/three-quarters cover. No disadvantage at long range. -5 attack for +10 damage.',
    category: 'combat',
  },
  {
    id: 'tough',
    name: 'Tough',
    description: '+2 HP per level (including current and future levels).',
    category: 'defense',
  },
  {
    id: 'war-caster',
    name: 'War Caster',
    description:
      'Advantage on Concentration checks. Cast spells as opportunity attacks. Cast with hands full.',
    category: 'magic',
  },
];

export const FEAT_CATEGORIES = [
  { id: 'all', label: 'All Feats' },
  { id: 'combat', label: 'Combat' },
  { id: 'magic', label: 'Magic' },
  { id: 'defense', label: 'Defense' },
  { id: 'utility', label: 'Utility' },
];
