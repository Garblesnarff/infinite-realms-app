/**
 * Builds the AbilityScores object (score + modifier + savingThrow) from raw
 * database stat values, split out of character-loader.ts's two duplicated
 * inline builders.
 */

import type { AbilityScores } from '@/types/character';

interface RawAbilityStats {
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
}

export function buildAbilityScores(stats: RawAbilityStats): AbilityScores {
  const modifier = (score: number): number => Math.floor((score - 10) / 2);

  return {
    strength: { score: stats.strength, modifier: modifier(stats.strength), savingThrow: false },
    dexterity: { score: stats.dexterity, modifier: modifier(stats.dexterity), savingThrow: false },
    constitution: {
      score: stats.constitution,
      modifier: modifier(stats.constitution),
      savingThrow: false,
    },
    intelligence: {
      score: stats.intelligence,
      modifier: modifier(stats.intelligence),
      savingThrow: false,
    },
    wisdom: { score: stats.wisdom, modifier: modifier(stats.wisdom), savingThrow: false },
    charisma: { score: stats.charisma, modifier: modifier(stats.charisma), savingThrow: false },
  };
}
