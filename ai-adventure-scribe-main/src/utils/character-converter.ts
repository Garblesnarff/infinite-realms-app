import { abilityModifier } from '../../shared/ability-modifier';

import type { Character } from '@/types/character';

const ABILITY_KEYS = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
] as const;

interface CharacterDetails {
  id: string;
  name: string;
  level: number;
  skill_proficiencies?: string;
  character_stats?: Array<{
    strength?: number;
    dexterity?: number;
    constitution?: number;
    intelligence?: number;
    wisdom?: number;
    charisma?: number;
  }>;
}

export function convertCharacterDetailsToCharacter(charDetails: CharacterDetails): Character {
  const stats = charDetails.character_stats?.[0];

  return {
    id: charDetails.id,
    name: charDetails.name,
    level: charDetails.level,
    abilityScores: stats
      ? Object.fromEntries(
          ABILITY_KEYS.map((key) => {
            const score = stats[key] || 10;
            return [key, { score, modifier: abilityModifier(score), savingThrow: false }];
          }),
        ) as Character['abilityScores']
      : {
          // Provide a default if stats are missing
          strength: { score: 10, modifier: 0, savingThrow: false },
          dexterity: { score: 10, modifier: 0, savingThrow: false },
          constitution: { score: 10, modifier: 0, savingThrow: false },
          intelligence: { score: 10, modifier: 0, savingThrow: false },
          wisdom: { score: 10, modifier: 0, savingThrow: false },
          charisma: { score: 10, modifier: 0, savingThrow: false },
        },
    skillProficiencies: charDetails.skill_proficiencies?.split(',').map((s) => s.trim()) || [],
  };
}
