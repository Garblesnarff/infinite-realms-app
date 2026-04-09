/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect } from 'vitest';

import {
  calculateProficiencyBonus,
  calculateHitPoints,
  calculateArmorClass,
  getSpellcastingAbility,
  calculateSpellSaveDC,
  calculateSpellAttackBonus,
  calculateSpellSlots,
  calculateSkillModifiers,
  calculateSavingThrowModifiers,
  calculateCarryingCapacity,
  calculatePassivePerception,
  calculateAllCharacterStats,
} from '../character-calculations';

import type { Character } from '@/types/character';

describe('character-calculations', () => {
  describe('calculateProficiencyBonus', () => {
    it('should calculate correct bonus for various levels', () => {
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
    const baseCharacter: Partial<Character> = {
      level: 1,
      class: { name: 'Fighter', hitDie: 10 } as any,
      abilityScores: {
        constitution: { score: 14, modifier: 2, savingThrow: false },
      } as any,
    };

    it('should calculate correct HP for level 1', () => {
      expect(calculateHitPoints(baseCharacter as Character)).toBe(12);
    });

    it('should calculate correct HP for higher levels', () => {
      const level3Character = { ...baseCharacter, level: 3 };
      // 10 + 2 (level 1) + 2 * (6 + 2) (levels 2-3) = 12 + 16 = 28
      expect(calculateHitPoints(level3Character as Character)).toBe(28);
    });

    it('should handle negative constitution modifier', () => {
      const frailCharacter: Character = {
        ...baseCharacter,
        abilityScores: {
          constitution: { score: 6, modifier: -2, savingThrow: false },
        } as any,
      } as Character;
      // 10 - 2 (level 1) = 8
      expect(calculateHitPoints(frailCharacter)).toBe(8);

      const frailLevel3 = { ...frailCharacter, level: 3 };
      // 10 - 2 (level 1) + 2 * (6 - 2) (levels 2-3) = 8 + 8 = 16
      expect(calculateHitPoints(frailLevel3)).toBe(16);
    });

    it('should handle extreme negative constitution modifier (edge case)', () => {
      const veryFrailCharacter: Character = {
        ...baseCharacter,
        class: { name: 'Wizard', hitDie: 6 } as any,
        abilityScores: {
          constitution: { score: 1, modifier: -5, savingThrow: false },
        } as any,
      } as Character;
      // 6 - 5 (level 1) = 1
      expect(calculateHitPoints(veryFrailCharacter)).toBe(1);

      const veryFrailLevel2 = { ...veryFrailCharacter, level: 2 };
      // Current implementation: (6 - 5) + (2 - 1) * (3 + 1 - 5) = 1 + 1 * (-1) = 0
      // Math.max(1, 0) = 1.
      // D&D 5e rule: minimum 1 HP per level. So it should be 1 (lvl 1) + 1 (lvl 2) = 2.
      // We'll see if this test fails.
      expect(calculateHitPoints(veryFrailLevel2)).toBe(2);
    });

    it('should handle level 5 character with extreme negative constitution', () => {
      const veryFrailCharacter: Character = {
        level: 5,
        class: { name: 'Wizard', hitDie: 6 } as any,
        abilityScores: {
          constitution: { score: 1, modifier: -5, savingThrow: false },
        } as any,
      } as Character;
      // Level 1: max(1, 6 - 5) = 1
      // Level 2-5: 4 * max(1, 4 - 5) = 4 * 1 = 4
      // Total: 1 + 4 = 5
      expect(calculateHitPoints(veryFrailCharacter)).toBe(5);
    });
  });

  describe('calculateArmorClass', () => {
    const baseCharacter: Partial<Character> = {
      abilityScores: {
        dexterity: { score: 14, modifier: 2, savingThrow: false },
        constitution: { score: 16, modifier: 3, savingThrow: false },
        wisdom: { score: 12, modifier: 1, savingThrow: false },
      } as any,
      class: { name: 'Fighter' } as any,
    };

    it('should calculate base AC for non-unarmored defense classes', () => {
      expect(calculateArmorClass(baseCharacter as Character)).toBe(12);
    });

    it('should calculate AC for Barbarian unarmored defense', () => {
      const barbarian = {
        ...baseCharacter,
        class: { name: 'Barbarian' } as any,
      };
      // 10 + 2 (Dex) + 3 (Con) = 15
      expect(calculateArmorClass(barbarian as Character)).toBe(15);
    });

    it('should calculate AC for Monk unarmored defense', () => {
      const monk = {
        ...baseCharacter,
        class: { name: 'Monk' } as any,
      };
      // 10 + 2 (Dex) + 1 (Wis) = 13
      expect(calculateArmorClass(monk as Character)).toBe(13);
    });

    it('should not apply Monk unarmored defense when wearing a shield', () => {
      const monkWithShield = {
        ...baseCharacter,
        class: { name: 'Monk' } as any,
        equippedShield: 'shield',
      };
      // Monk unarmored defense doesn't work with shields.
      // Should be 10 + 2 (Dex) + 2 (Shield) = 14.
      expect(calculateArmorClass(monkWithShield as Character)).toBe(14);
    });

    it('should apply Barbarian unarmored defense when wearing a shield', () => {
      const barbWithShield = {
        ...baseCharacter,
        class: { name: 'Barbarian' } as any,
        equippedShield: 'shield',
      };
      // 10 + 2 (Dex) + 3 (Con) + 2 (Shield) = 17
      expect(calculateArmorClass(barbWithShield as Character)).toBe(17);
    });

    it('should calculate AC correctly for Light Armor (Leather Armor)', () => {
      const char = {
        ...baseCharacter,
        equippedArmor: 'leather-armor',
        abilityScores: { dexterity: { modifier: 3 } } as any,
      };
      // Leather: 11 + 3 (Dex) = 14
      expect(calculateArmorClass(char as Character)).toBe(14);
    });

    it('should calculate AC correctly for Medium Armor with Dex cap (Half Plate)', () => {
      const char = {
        ...baseCharacter,
        equippedArmor: 'half-plate',
        abilityScores: { dexterity: { modifier: 5 } } as any,
      };
      // Half Plate: 15 + min(5, 2) (Dex) = 17
      expect(calculateArmorClass(char as Character)).toBe(17);
    });

    it('should calculate AC correctly for Heavy Armor (Plate Armor)', () => {
      const char = {
        ...baseCharacter,
        equippedArmor: 'plate-armor',
        abilityScores: { dexterity: { modifier: 5 } } as any,
      };
      // Plate: 18 + 0 (No Dex bonus) = 18
      expect(calculateArmorClass(char as Character)).toBe(18);
    });

    it('should apply negative Dexterity modifier to Light/Medium armor', () => {
      const char = {
        ...baseCharacter,
        equippedArmor: 'leather-armor',
        abilityScores: { dexterity: { modifier: -2 } } as any,
      };
      // Leather: 11 - 2 (Dex) = 9
      expect(calculateArmorClass(char as Character)).toBe(9);
    });

    it('should NOT apply negative Dexterity modifier to Heavy armor', () => {
      const char = {
        ...baseCharacter,
        equippedArmor: 'plate-armor',
        abilityScores: { dexterity: { modifier: -2 } } as any,
      };
      // Plate: 18 (Heavy armor ignores Dex)
      expect(calculateArmorClass(char as Character)).toBe(18);
    });

    it('should apply shield bonus to armor AC', () => {
      const char = {
        ...baseCharacter,
        equippedArmor: 'leather-armor',
        equippedShield: 'shield',
        abilityScores: { dexterity: { modifier: 2 } } as any,
      };
      // Leather: 11 + 2 (Dex) + 2 (Shield) = 15
      expect(calculateArmorClass(char as Character)).toBe(15);
    });

    it('should ignore Unarmored Defense when wearing armor', () => {
      const barbarianWithArmor = {
        ...baseCharacter,
        class: { name: 'Barbarian' } as any,
        equippedArmor: 'leather-armor',
        abilityScores: {
          dexterity: { modifier: 2 },
          constitution: { modifier: 3 },
        } as any,
      };
      // Unarmored: 10 + 2 (Dex) + 3 (Con) = 15
      // With Leather: 11 + 2 (Dex) = 13
      // Should use Leather.
      expect(calculateArmorClass(barbarianWithArmor as Character)).toBe(13);
    });
  });

  describe('spellcasting calculations', () => {
    const wizard: Partial<Character> = {
      level: 1,
      class: { name: 'Wizard' } as any,
      abilityScores: {
        intelligence: { score: 16, modifier: 3, savingThrow: false },
      } as any,
    };

    it('should get correct spellcasting ability', () => {
      expect(getSpellcastingAbility(wizard.class as any)).toBe('intelligence');
      expect(getSpellcastingAbility({ name: 'Cleric' } as any)).toBe('wisdom');
      expect(getSpellcastingAbility({ name: 'Sorcerer' } as any)).toBe('charisma');
      expect(getSpellcastingAbility({ name: 'Fighter' } as any)).toBe(null);
    });

    it('should calculate spell save DC', () => {
      // 8 + 2 (Prof) + 3 (Int) = 13
      expect(calculateSpellSaveDC(wizard as Character)).toBe(13);
    });

    it('should calculate spell attack bonus', () => {
      // 2 (Prof) + 3 (Int) = 5
      expect(calculateSpellAttackBonus(wizard as Character)).toBe(5);
    });

    it('should return undefined for non-casters', () => {
      const fighter = { ...wizard, class: { name: 'Fighter' } as any };
      expect(calculateSpellSaveDC(fighter as Character)).toBeUndefined();
      expect(calculateSpellAttackBonus(fighter as Character)).toBeUndefined();
    });

    it('should calculate spell slots for level 1 full caster', () => {
      const slots = calculateSpellSlots(wizard as Character);
      expect(slots).toEqual({ 1: 2 });
    });

    it('should calculate spell slots for level 5 full caster', () => {
      const slots = calculateSpellSlots({ ...wizard, level: 5 } as Character);
      expect(slots).toEqual({ 1: 4, 2: 3, 3: 2 });
    });
  });

  describe('calculateSkillModifiers', () => {
    const character: Partial<Character> = {
      level: 1,
      abilityScores: {
        strength: { modifier: 3 },
        dexterity: { modifier: 2 },
        intelligence: { modifier: 1 },
        wisdom: { modifier: 0 },
        charisma: { modifier: -1 },
      } as any,
      class: { name: 'Fighter' } as any, // Fighter has Athletics
      race: { name: 'Human' } as any,
    };

    it('should calculate modifiers correctly including proficiencies', () => {
      const skillMods = calculateSkillModifiers(character as Character);

      // Athletics: 3 (Str) + 2 (Prof) = 5
      expect(skillMods['Athletics']).toEqual({
        modifier: 5,
        proficient: true,
        expertise: false,
      });

      // Stealth: 2 (Dex) + 0 (No Prof) = 2
      expect(skillMods['Stealth']).toEqual({
        modifier: 2,
        proficient: false,
        expertise: false,
      });

      // Deception: -1 (Cha) + 0 (No Prof) = -1
      expect(skillMods['Deception']).toEqual({
        modifier: -1,
        proficient: false,
        expertise: false,
      });
    });
  });

  describe('calculateSavingThrowModifiers', () => {
    it('should calculate modifiers correctly including class proficiencies', () => {
      const fighter: Partial<Character> = {
        level: 1,
        abilityScores: {
          strength: { modifier: 3 },
          dexterity: { modifier: 2 },
          constitution: { modifier: 2 },
          intelligence: { modifier: 1 },
          wisdom: { modifier: 0 },
          charisma: { modifier: -1 },
        } as any,
        class: { name: 'Fighter' } as any, // Fighter has Str and Con saves
      };

      const saveMods = calculateSavingThrowModifiers(fighter as Character);

      expect(saveMods['strength'].modifier).toBe(5); // 3 + 2
      expect(saveMods['constitution'].modifier).toBe(4); // 2 + 2
      expect(saveMods['dexterity'].modifier).toBe(2); // 2 + 0
    });

    it('should handle Rogue saving throws', () => {
      const rogue: Partial<Character> = {
        level: 1,
        abilityScores: { dexterity: { modifier: 3 }, intelligence: { modifier: 2 } } as any,
        class: { name: 'Rogue' } as any,
      };
      const saveMods = calculateSavingThrowModifiers(rogue as Character);
      expect(saveMods['dexterity'].proficient).toBe(true);
      expect(saveMods['intelligence'].proficient).toBe(true);
    });

    it('should return empty if no class', () => {
      expect(calculateSavingThrowModifiers({} as Character)).toEqual({});
    });
  });

  describe('calculatePassivePerception', () => {
    it('should handle null skill mods gracefully', () => {
      expect(calculatePassivePerception({} as Character)).toBe(10);
    });

    it('should be 10 + Perception modifier', () => {
      const character: Partial<Character> = {
        level: 1,
        abilityScores: { wisdom: { modifier: 2 } } as any,
        class: { name: 'Cleric' } as any, // Cleric has Insight, Medicine, Persuasion, Religion, History.
        // Wait, Cleric skills in code: ['History', 'Insight', 'Medicine', 'Persuasion', 'Religion']
        // Perception is not there by default.
      };
      // Passive Perception = 10 + 2 (Wis) + 0 (No Prof) = 12
      expect(calculatePassivePerception(character as Character)).toBe(12);

      const observantCharacter = {
        ...character,
        class: { name: 'Rogue' } as any, // Rogue has Perception in code
      };
      // Passive Perception = 10 + 2 (Wis) + 2 (Prof) = 14
      expect(calculatePassivePerception(observantCharacter as Character)).toBe(14);
    });
  });

  describe('calculateAllCharacterStats', () => {
    it('should return a complete stats object', () => {
      const character: Partial<Character> = {
        level: 3,
        class: { name: 'Wizard', hitDie: 6 } as any,
        abilityScores: {
          intelligence: { modifier: 3 },
          constitution: { modifier: 2 },
          dexterity: { modifier: 1 },
          strength: { score: 10, modifier: 0 },
          wisdom: { modifier: 0 },
          charisma: { modifier: 0 },
        } as any,
        race: {
          name: 'High Elf',
          speed: 30,
          traits: ['Darkvision'],
          languages: ['Common', 'Elvish'],
        } as any,
      };

      const stats = calculateAllCharacterStats(character as Character);

      expect(stats.proficiencyBonus).toBe(2);
      expect(stats.hitPoints).toBe(20); // 6+2 (lvl 1) + 2*(4+2) (lvl 2-3) = 8 + 12 = 20
      expect(stats.armorClass).toBe(11); // 10 + 1 (Dex)
      expect(stats.speed).toBe(30);
      expect(stats.allTraits).toContain('Darkvision');
      expect(stats.allLanguages).toContain('Common');
      expect(stats.allLanguages).toContain('Elvish');
    });

    it('should handle missing data gracefully', () => {
      const stats = calculateAllCharacterStats({} as Character);
      expect(stats.proficiencyBonus).toBe(2);
      expect(stats.hitPoints).toBe(8); // 8+0 (lvl 1)
      expect(stats.armorClass).toBe(10);
      expect(stats.speed).toBe(30);
    });

    it('should use subrace speed if available', () => {
      const character: Partial<Character> = {
        race: { speed: 30 } as any,
        subrace: { speed: 35 } as any,
      };
      const stats = calculateAllCharacterStats(character as Character);
      expect(stats.speed).toBe(35);
    });
  });

  describe('race and class proficiency branches', () => {
    it('should handle Wood Elf stealth proficiency', () => {
      const woodElf: Partial<Character> = {
        race: { name: 'Elf' } as any,
        subrace: { name: 'Wood Elf' } as any,
        abilityScores: { dexterity: { modifier: 2 } } as any,
      };
      const skillMods = calculateSkillModifiers(woodElf as Character);
      expect(skillMods['Stealth'].proficient).toBe(true);
    });

    it('should handle Half-Elf proficiencies', () => {
      const halfElf: Partial<Character> = {
        race: { name: 'Half-Elf' } as any,
        abilityScores: { charisma: { modifier: 2 } } as any,
      };
      const skillMods = calculateSkillModifiers(halfElf as Character);
      expect(skillMods['Deception'].proficient).toBe(true);
      expect(skillMods['Persuasion'].proficient).toBe(true);
    });

    it('should handle Rogue skill proficiencies', () => {
      const rogue: Partial<Character> = {
        class: { name: 'Rogue' } as any,
        abilityScores: { dexterity: { modifier: 2 } } as any,
      };
      const skillMods = calculateSkillModifiers(rogue as Character);
      expect(skillMods['Stealth'].proficient).toBe(true);
      expect(skillMods['Acrobatics'].proficient).toBe(true);
    });
  });

  describe('carrying capacity', () => {
    it('should calculate 15 times strength score', () => {
      const character = { abilityScores: { strength: { score: 10 } } };
      expect(calculateCarryingCapacity(character as any)).toBe(150);

      const strongCharacter = { abilityScores: { strength: { score: 20 } } };
      expect(calculateCarryingCapacity(strongCharacter as any)).toBe(300);

      expect(calculateCarryingCapacity({} as any)).toBe(150); // Default score 10
    });
  });
});
