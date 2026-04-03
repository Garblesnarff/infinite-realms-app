import type { Character } from '@/types/character';

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
      ? {
          strength: {
            score: stats.strength || 10,
            modifier: Math.floor(((stats.strength || 10) - 10) / 2),
            savingThrow: false,
          },
          dexterity: {
            score: stats.dexterity || 10,
            modifier: Math.floor(((stats.dexterity || 10) - 10) / 2),
            savingThrow: false,
          },
          constitution: {
            score: stats.constitution || 10,
            modifier: Math.floor(((stats.constitution || 10) - 10) / 2),
            savingThrow: false,
          },
          intelligence: {
            score: stats.intelligence || 10,
            modifier: Math.floor(((stats.intelligence || 10) - 10) / 2),
            savingThrow: false,
          },
          wisdom: {
            score: stats.wisdom || 10,
            modifier: Math.floor(((stats.wisdom || 10) - 10) / 2),
            savingThrow: false,
          },
          charisma: {
            score: stats.charisma || 10,
            modifier: Math.floor(((stats.charisma || 10) - 10) / 2),
            savingThrow: false,
          },
        }
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
