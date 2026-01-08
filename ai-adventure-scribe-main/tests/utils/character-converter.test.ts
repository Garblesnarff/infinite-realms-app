import { describe, it, expect } from 'vitest';
import { convertCharacterDetailsToCharacter } from '../../src/utils/character-converter';
import type { Character } from '../../src/types/character';

describe('convertCharacterDetailsToCharacter', () => {
  it('should handle a character with missing stats by providing default values', () => {
    const characterDetails = {
      id: 'test-char-1',
      name: 'Test Character',
      level: 1,
    };

    const character: Character = convertCharacterDetailsToCharacter(characterDetails);

    expect(character.abilityScores).toBeDefined();
    expect(character.abilityScores.strength.score).toBe(10);
    expect(character.abilityScores.wisdom.score).toBe(10);
    expect(character.skillProficiencies).toEqual([]);
  });

  it('should correctly convert a character with full stats', () => {
    const characterDetails = {
      id: 'test-char-2',
      name: 'Full Character',
      level: 5,
      skill_proficiencies: 'Perception, Stealth',
      character_stats: [
        {
          strength: 12,
          dexterity: 18,
          constitution: 14,
          intelligence: 10,
          wisdom: 16,
          charisma: 8,
        },
      ],
    };

    const character: Character = convertCharacterDetailsToCharacter(characterDetails);

    expect(character.abilityScores.strength.score).toBe(12);
    expect(character.abilityScores.dexterity.modifier).toBe(4);
    expect(character.abilityScores.wisdom.score).toBe(16);
    expect(character.skillProficiencies).toEqual(['Perception', 'Stealth']);
  });
});
