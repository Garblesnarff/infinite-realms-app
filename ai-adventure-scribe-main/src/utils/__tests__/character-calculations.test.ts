/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect } from 'vitest';

import {
  calculateProficiencyBonus,
  calculateHitPoints,
  calculateArmorClass,
  calculateSpellSaveDC,
  calculateSpellAttackBonus,
  calculateSpellSlots,
  calculateSkillModifiers,
  calculateSavingThrowModifiers,
  calculateAllCharacterStats,
  getClassSkillProficiencies,
  getRaceSkillProficiencies
} from '../character-calculations';

describe('character-calculations', () => {
  describe('calculateProficiencyBonus', () => {
    it('should calculate correct proficiency bonus for various levels', () => {
      expect(calculateProficiencyBonus(1)).toBe(2);
      expect(calculateProficiencyBonus(4)).toBe(2);
      expect(calculateProficiencyBonus(5)).toBe(3);
      expect(calculateProficiencyBonus(8)).toBe(3);
      expect(calculateProficiencyBonus(9)).toBe(4);
      expect(calculateProficiencyBonus(12)).toBe(4);
      expect(calculateProficiencyBonus(13)).toBe(5);
      expect(calculateProficiencyBonus(16)).toBe(5);
      expect(calculateProficiencyBonus(17)).toBe(6);
      expect(calculateProficiencyBonus(20)).toBe(6);
    });
  });

  describe('calculateHitPoints', () => {
    it('should calculate correct HP for level 1 character', () => {
      const character: any = {
        level: 1,
        class: { hitDie: 10 },
        abilityScores: { constitution: { modifier: 3 } }
      };
      // 10 + 3 = 13
      expect(calculateHitPoints(character)).toBe(13);
    });

    it('should calculate correct HP for higher level character', () => {
      const character: any = {
        level: 5,
        class: { hitDie: 8 },
        abilityScores: { constitution: { modifier: 2 } }
      };
      // Level 1: 8 + 2 = 10
      // Levels 2-5: 4 * (5 + 2) = 28
      // Total: 38
      expect(calculateHitPoints(character)).toBe(38);
    });

    it('should ensure at least 1 HP per level even with negative Con modifier', () => {
      const character: any = {
        level: 3,
        class: { hitDie: 6 },
        abilityScores: { constitution: { modifier: -5 } }
      };
      // Level 1: max(1, 6 - 5) = 1
      // Level 2: max(1, 4 - 5) = 1
      // Level 3: max(1, 4 - 5) = 1
      // Total: 3
      expect(calculateHitPoints(character)).toBe(3);
    });
  });

  describe('calculateArmorClass', () => {
    it('should calculate base AC (10 + Dex)', () => {
      const character: any = {
        abilityScores: { dexterity: { modifier: 2 } }
      };
      expect(calculateArmorClass(character)).toBe(12);
    });

    it('should calculate Barbarian Unarmored Defense (10 + Dex + Con)', () => {
      const character: any = {
        class: { name: 'Barbarian' },
        abilityScores: {
          dexterity: { modifier: 2 },
          constitution: { modifier: 3 }
        }
      };
      expect(calculateArmorClass(character)).toBe(15);
    });

    it('should calculate Monk Unarmored Defense (10 + Dex + Wis)', () => {
      const character: any = {
        class: { name: 'Monk' },
        abilityScores: {
          dexterity: { modifier: 2 },
          wisdom: { modifier: 4 }
        }
      };
      expect(calculateArmorClass(character)).toBe(16);
    });
  });

  describe('Spellcasting Calculations', () => {
    const wizard: any = {
      level: 5,
      class: { name: 'Wizard' },
      abilityScores: { intelligence: { modifier: 4 } }
    };

    it('should calculate correct Spell Save DC', () => {
      // 8 + 3 (prof) + 4 (int) = 15
      expect(calculateSpellSaveDC(wizard)).toBe(15);
    });

    it('should calculate correct Spell Attack Bonus', () => {
      // 3 (prof) + 4 (int) = 7
      expect(calculateSpellAttackBonus(wizard)).toBe(7);
    });

    it('should calculate correct Spell Slots for full caster', () => {
      const slots = calculateSpellSlots(wizard);
      expect(slots).toEqual({
        1: 4,
        2: 3,
        3: 2
      });
    });

    it('should return undefined for non-spellcasters', () => {
      const fighter: any = {
        class: { name: 'Fighter' },
        abilityScores: { strength: { modifier: 4 } }
      };
      expect(calculateSpellSaveDC(fighter)).toBeUndefined();
      expect(calculateSpellAttackBonus(fighter)).toBeUndefined();
      expect(calculateSpellSlots(fighter)).toBeUndefined();
    });

    it('should return undefined if class is missing', () => {
      const character: any = {
        abilityScores: { intelligence: { modifier: 3 } }
      };
      expect(calculateSpellSaveDC(character)).toBeUndefined();
      expect(calculateSpellAttackBonus(character)).toBeUndefined();
      expect(calculateSpellSlots(character)).toBeUndefined();
    });

    it('should handle levels above 20 for spell slots (undefined for now)', () => {
      const epicWizard: any = {
        level: 21,
        class: { name: 'Wizard' },
        abilityScores: { intelligence: { modifier: 5 } }
      };
      expect(calculateSpellSlots(epicWizard)).toBeUndefined();
    });
  });

  describe('Skill Proficiencies', () => {
    it('should return correct proficiencies for different classes', () => {
      expect(getClassSkillProficiencies({ name: 'Wizard' } as any)).toContain('Arcana');
      expect(getClassSkillProficiencies({ name: 'Rogue' } as any)).toContain('Stealth');
      expect(getClassSkillProficiencies({ name: 'Cleric' } as any)).toContain('Medicine');
      expect(getClassSkillProficiencies(null)).toEqual([]);
    });

    it('should return correct proficiencies for races and subraces', () => {
      expect(getRaceSkillProficiencies({ name: 'Half-Elf' } as any, null)).toContain('Deception');
      expect(getRaceSkillProficiencies({ name: 'Elf' } as any, { name: 'Wood Elf' } as any)).toContain('Stealth');
      expect(getRaceSkillProficiencies(null, null)).toEqual([]);
    });
  });

  describe('calculateSkillModifiers', () => {
    it('should apply proficiency bonus to proficient skills', () => {
      const character: any = {
        level: 1, // prof +2
        class: { name: 'Fighter' }, // Proficient in Athletics
        abilityScores: {
          strength: { modifier: 3 },
          dexterity: { modifier: 2 }
        }
      };
      const skillMods = calculateSkillModifiers(character);

      // Athletics (Str) - Proficient: 3 + 2 = 5
      expect(skillMods['Athletics'].modifier).toBe(5);
      expect(skillMods['Athletics'].proficient).toBe(true);

      // Stealth (Dex) - Not Proficient: 2
      expect(skillMods['Stealth'].modifier).toBe(2);
      expect(skillMods['Stealth'].proficient).toBe(false);
    });
  });

  describe('calculateSavingThrowModifiers', () => {
    it('should apply proficiency bonus to proficient saving throws', () => {
      const character: any = {
        level: 1, // prof +2
        class: { name: 'Wizard' }, // Proficient in Int and Wis
        abilityScores: {
          intelligence: { modifier: 4 },
          wisdom: { modifier: 2 },
          strength: { modifier: 0 }
        }
      };
      const saveMods = calculateSavingThrowModifiers(character);

      // Intelligence - Proficient: 4 + 2 = 6
      expect(saveMods['intelligence'].modifier).toBe(6);
      expect(saveMods['intelligence'].proficient).toBe(true);

      // Wisdom - Proficient: 2 + 2 = 4
      expect(saveMods['wisdom'].modifier).toBe(4);
      expect(saveMods['wisdom'].proficient).toBe(true);

      // Strength - Not Proficient: 0
      expect(saveMods['strength'].modifier).toBe(0);
      expect(saveMods['strength'].proficient).toBe(false);
    });

    it('should return base ability modifiers if class is unknown', () => {
      const character: any = {
        level: 1,
        class: { name: 'Unknown' },
        abilityScores: {
          intelligence: { modifier: 4 }
        }
      };
      const saveMods = calculateSavingThrowModifiers(character);
      expect(saveMods['intelligence'].modifier).toBe(4);
      expect(saveMods['intelligence'].proficient).toBe(false);
    });
  });

  describe('calculateAllCharacterStats', () => {
    it('should aggregate all character stats correctly', () => {
      const character: any = {
        level: 1,
        name: 'Test Wizard',
        race: { name: 'High Elf', traits: ['Darkvision'], languages: ['Common', 'Elvish'], speed: 30 },
        class: { name: 'Wizard', hitDie: 6 },
        abilityScores: {
          intelligence: { modifier: 3 },
          dexterity: { modifier: 2 },
          constitution: { modifier: 1 },
          wisdom: { modifier: 0 },
          strength: { modifier: 0 },
          charisma: { modifier: 0 }
        }
      };

      const stats = calculateAllCharacterStats(character);

      expect(stats.proficiencyBonus).toBe(2);
      expect(stats.hitPoints).toBe(7); // 6 + 1
      expect(stats.armorClass).toBe(12); // 10 + 2
      expect(stats.initiative).toBe(2); // Dex mod
      expect(stats.speed).toBe(30);
      expect(stats.spellSaveDC).toBe(13); // 8 + 2 + 3
      expect(stats.passivePerception).toBe(10); // 10 + 0 (not proficient)
      expect(stats.allTraits).toContain('Darkvision');
      expect(stats.allLanguages).toContain('Common');
      expect(stats.allLanguages).toContain('Elvish');
    });

    it('should handle missing race and subrace information', () => {
      const character: any = {
        level: 1,
        class: { name: 'Fighter', hitDie: 10 },
        abilityScores: {
          strength: { modifier: 3 },
          dexterity: { modifier: 2 }
        }
      };

      const stats = calculateAllCharacterStats(character);
      expect(stats.speed).toBe(30);
      expect(stats.allTraits).toEqual([]);
      expect(stats.allLanguages).toEqual([]);
    });

    it('should use subrace speed if available', () => {
      const character: any = {
        race: { speed: 30 },
        subrace: { speed: 35 },
        class: { name: 'Fighter' }
      };
      const stats = calculateAllCharacterStats(character);
      expect(stats.speed).toBe(35);
    });

    it('should use race speed if subrace speed is missing', () => {
      const character: any = {
        race: { speed: 25 },
        class: { name: 'Fighter' }
      };
      const stats = calculateAllCharacterStats(character);
      expect(stats.speed).toBe(25);
    });
  });
});
