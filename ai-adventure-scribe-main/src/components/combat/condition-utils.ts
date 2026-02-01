/**
 * Condition Utils and Constants
 *
 * Provides shared constants and templates for D&D 5e conditions.
 */

import { Heart, Skull, Clock, UserX } from 'lucide-react';

import type { ConditionName } from '@/types/combat';
import type React from 'react';

// ===========================
// Condition Icons & Colors
// ===========================

/**
 * Mapping of condition names to their visual representation.
 */
export const CONDITION_ICONS: Record<
  ConditionName,
  { icon: React.ComponentType<{ className?: string }>; color: string; bgColor: string }
> = {
  blinded: { icon: UserX, color: 'text-white', bgColor: 'bg-gray-500' },
  charmed: { icon: Heart, color: 'text-white', bgColor: 'bg-pink-500' },
  deafened: { icon: UserX, color: 'text-white', bgColor: 'bg-slate-500' },
  frightened: { icon: Skull, color: 'text-white', bgColor: 'bg-yellow-600' },
  grappled: { icon: UserX, color: 'text-white', bgColor: 'bg-orange-500' },
  incapacitated: { icon: UserX, color: 'text-white', bgColor: 'bg-red-500' },
  invisible: { icon: UserX, color: 'text-blue-600', bgColor: 'bg-blue-200' },
  paralyzed: { icon: UserX, color: 'text-white', bgColor: 'bg-purple-600' },
  petrified: { icon: UserX, color: 'text-white', bgColor: 'bg-stone-500' },
  poisoned: { icon: UserX, color: 'text-white', bgColor: 'bg-green-600' },
  prone: { icon: UserX, color: 'text-amber-900', bgColor: 'bg-amber-400' },
  restrained: { icon: UserX, color: 'text-white', bgColor: 'bg-red-600' },
  stunned: { icon: UserX, color: 'text-white', bgColor: 'bg-yellow-600' },
  unconscious: { icon: UserX, color: 'text-white', bgColor: 'bg-black' },
  exhaustion: { icon: Clock, color: 'text-white', bgColor: 'bg-gray-600' },
  surprised: { icon: Skull, color: 'text-white', bgColor: 'bg-yellow-400' },
};

// ===========================
// Condition Templates
// ===========================

/**
 * Standard D&D 5e conditions with descriptions and default durations.
 */
export const CONDITION_TEMPLATES: Record<
  ConditionName,
  { name: string; description: string; defaultDuration: number }
> = {
  blinded: {
    name: 'Blinded',
    description: "Can't see, attacks against target have advantage, auto-miss on own attacks",
    defaultDuration: 3,
  },
  charmed: {
    name: 'Charmed',
    description: 'Cannot attack charmer, regards charmer as friendly',
    defaultDuration: 10,
  },
  deafened: {
    name: 'Deafened',
    description: 'Cannot hear sounds, fails audio-dependent saves',
    defaultDuration: 5,
  },
  frightened: {
    name: 'Frightened',
    description: 'Cannot approach source of fear, disadvantage on attacks and checks',
    defaultDuration: 5,
  },
  grappled: {
    name: 'Grappled',
    description: 'Speed becomes 0, can break free with Athletics or Acrobatics',
    defaultDuration: 0, // Indeterminate until broken
  },
  incapacitated: {
    name: 'Incapacitated',
    description: 'Cannot take actions or speak, no reactions',
    defaultDuration: 3,
  },
  invisible: {
    name: 'Invisible',
    description:
      'Cannot be detected by sight, attacks have advantage, disadvantage to being targeted',
    defaultDuration: 10,
  },
  paralyzed: {
    name: 'Paralyzed',
    description: 'Cannot move, speak, or take actions, auto-fails STR and DEX saves',
    defaultDuration: 3,
  },
  petrified: {
    name: 'Petrified',
    description: 'Turned to stone, unconscious and cannot take actions',
    defaultDuration: 10,
  },
  poisoned: {
    name: 'Poisoned',
    description: 'Disadvantage on attack rolls and ability checks',
    defaultDuration: 10,
  },
  prone: {
    name: 'Prone',
    description:
      'Lying down, melee attacks vs prone have advantage, ranged attacks have disadvantage',
    defaultDuration: 0, // Indeterminate until standing
  },
  restrained: {
    name: 'Restrained',
    description: 'Speed 0, disadvantage on DEX saves, advantage on attacks against target',
    defaultDuration: 5,
  },
  stunned: {
    name: 'Stunned',
    description: 'Cannot take actions, auto-fails STR and DEX saves',
    defaultDuration: 1,
  },
  unconscious: {
    name: 'Unconscious',
    description: 'Completely unaware, defense has disadvantage, criticals automatically hit',
    defaultDuration: 10,
  },
  exhaustion: {
    name: 'Exhaustion',
    description: 'Various penalties based on level (1-6), can lead to death at level 6',
    defaultDuration: -1, // Persistent
  },
  surprised: {
    name: 'Surprised',
    description: 'Cannot take an action this turn',
    defaultDuration: 0, // Until end of turn
  },
};
