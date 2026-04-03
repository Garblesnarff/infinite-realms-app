import { describe, it, expect } from 'vitest';

import { convertCharacterDetailsToCharacter } from '../character-converter';

describe('character-converter', () => {
  describe('convertCharacterDetailsToCharacter', () => {
    it('should convert full character details correctly', () => {
      const charDetails = {
        id: 'char-123',
        name: 'Gimli',
        level: 5,
        skill_proficiencies: 'Athletics, Insight, Perception',
        character_stats: [
          {
            strength: 18,
            dexterity: 12,
            constitution: 16,
            intelligence: 8,
            wisdom: 10,
            charisma: 10,
          },
        ],
      };

      const result = convertCharacterDetailsToCharacter(charDetails);

      expect(result.id).toBe('char-123');
      expect(result.name).toBe('Gimli');
      expect(result.level).toBe(5);
      expect(result.skillProficiencies).toEqual(['Athletics', 'Insight', 'Perception']);
      expect(result.abilityScores?.strength.score).toBe(18);
      expect(result.abilityScores?.strength.modifier).toBe(4);
      expect(result.abilityScores?.dexterity.score).toBe(12);
      expect(result.abilityScores?.dexterity.modifier).toBe(1);
      expect(result.abilityScores?.constitution.score).toBe(16);
      expect(result.abilityScores?.constitution.modifier).toBe(3);
      expect(result.abilityScores?.intelligence.score).toBe(8);
      expect(result.abilityScores?.intelligence.modifier).toBe(-1);
      expect(result.abilityScores?.wisdom.score).toBe(10);
      expect(result.abilityScores?.wisdom.modifier).toBe(0);
      expect(result.abilityScores?.charisma.score).toBe(10);
      expect(result.abilityScores?.charisma.modifier).toBe(0);
    });

    it('should use default stats if character_stats are missing', () => {
      const charDetails = {
        id: 'char-456',
        name: 'Legolas',
        level: 3,
      };

      const result = convertCharacterDetailsToCharacter(charDetails);

      expect(result.id).toBe('char-456');
      expect(result.name).toBe('Legolas');
      expect(result.level).toBe(3);
      expect(result.skillProficiencies).toEqual([]);
      expect(result.abilityScores?.strength.score).toBe(10);
      expect(result.abilityScores?.strength.modifier).toBe(0);
      expect(result.abilityScores?.dexterity.score).toBe(10);
      expect(result.abilityScores?.dexterity.modifier).toBe(0);
    });

    it('should handle partial character_stats correctly', () => {
      const charDetails = {
        id: 'char-789',
        name: 'Gandalf',
        level: 20,
        character_stats: [
          {
            intelligence: 20,
            wisdom: 18,
          },
        ],
      };

      const result = convertCharacterDetailsToCharacter(charDetails);

      expect(result.abilityScores?.intelligence.score).toBe(20);
      expect(result.abilityScores?.intelligence.modifier).toBe(5);
      expect(result.abilityScores?.wisdom.score).toBe(18);
      expect(result.abilityScores?.wisdom.modifier).toBe(4);
      expect(result.abilityScores?.strength.score).toBe(10); // Default
      expect(result.abilityScores?.strength.modifier).toBe(0);
    });

    it('should handle missing skill_proficiencies correctly', () => {
      const charDetails = {
        id: 'char-101',
        name: 'Aragorn',
        level: 10,
        character_stats: [{ strength: 16 }],
      };

      const result = convertCharacterDetailsToCharacter(charDetails);

      expect(result.skillProficiencies).toEqual([]);
    });

    it('should calculate modifiers correctly for very low and very high scores', () => {
      const charDetails = {
        id: 'char-extreme',
        name: 'Extreme Char',
        level: 1,
        character_stats: [
          {
            strength: 1,
            dexterity: 3,
            constitution: 30,
            intelligence: 10,
            wisdom: 11,
            charisma: 20,
          },
        ],
      };

      const result = convertCharacterDetailsToCharacter(charDetails);

      expect(result.abilityScores?.strength.modifier).toBe(-5);
      expect(result.abilityScores?.dexterity.modifier).toBe(-4);
      expect(result.abilityScores?.constitution.modifier).toBe(10);
      expect(result.abilityScores?.intelligence.modifier).toBe(0);
      expect(result.abilityScores?.wisdom.modifier).toBe(0);
      expect(result.abilityScores?.charisma.modifier).toBe(5);
    });
  });
});
