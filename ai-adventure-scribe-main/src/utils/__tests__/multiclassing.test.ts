/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  validateMulticlass,
  calculateMulticlassHitPoints,
  calculateMulticlassSpellcasting,
  calculateMulticlassProficiencies,
  getMulticlassFeatures,
  addMulticlass,
  levelUpClass
} from '../multiclassing';

import type { Character, CharacterClass } from '@/types/character';

import * as levelProgression from '@/data/levelProgression';

vi.mock('@/data/levelProgression', async () => {
  const actual = await vi.importActual('@/data/levelProgression') as any;
  return {
    ...actual,
    getAllClassFeaturesUpToLevel: vi.fn(() => [{ id: 'feature-1', name: 'Feature 1', description: 'Desc' }]),
  };
});

describe('multiclassing utilities', () => {
  let mockFighter: CharacterClass;
  let mockWizard: CharacterClass;
  let baseCharacter: Character;

  beforeEach(() => {
    vi.clearAllMocks();

    mockFighter = {
      id: 'fighter-id',
      name: 'Fighter',
      description: 'A martial class',
      hitDie: 10,
      primaryAbility: 'strength',
      savingThrowProficiencies: ['strength', 'constitution'],
      skillChoices: [],
      numSkillChoices: 0,
      classFeatures: [],
      armorProficiencies: [],
      weaponProficiencies: [],
    };

    mockWizard = {
      id: 'wizard-id',
      name: 'Wizard',
      description: 'A spellcasting class',
      hitDie: 6,
      primaryAbility: 'intelligence',
      savingThrowProficiencies: ['intelligence', 'wisdom'],
      skillChoices: [],
      numSkillChoices: 0,
      classFeatures: [],
      armorProficiencies: [],
      weaponProficiencies: [],
    };

    baseCharacter = {
      name: 'Test Character',
      level: 1,
      abilityScores: {
        strength: { score: 15, modifier: 2, savingThrow: true },
        dexterity: { score: 10, modifier: 0, savingThrow: false },
        constitution: { score: 14, modifier: 2, savingThrow: true },
        intelligence: { score: 13, modifier: 1, savingThrow: false },
        wisdom: { score: 12, modifier: 1, savingThrow: false },
        charisma: { score: 8, modifier: -1, savingThrow: false },
      },
      class: mockFighter,
      classLevels: [
        {
          classId: 'fighter-id',
          className: 'Fighter',
          level: 1,
          hitDie: 10,
          features: [],
        }
      ],
      hitPoints: { maximum: 12, current: 12, temporary: 0 },
    };
  });

  describe('validateMulticlass', () => {
    it('should allow multiclassing if requirements are met', () => {
      const result = validateMulticlass(baseCharacter, mockWizard);
      expect(result.canMulticlass).toBe(true);
      expect(result.missingRequirements).toHaveLength(0);
    });

    it('should return default result if ability scores are missing', () => {
      const noAbilityChar = { ...baseCharacter, abilityScores: undefined };
      const result = validateMulticlass(noAbilityChar, mockWizard);
      expect(result.canMulticlass).toBe(true);
    });

    it('should reject multiclassing if target class requirements are not met', () => {
      const weakCharacter = {
        ...baseCharacter,
        abilityScores: {
          ...baseCharacter.abilityScores,
          intelligence: { score: 8, modifier: -1, savingThrow: false },
        } as any,
      };
      const result = validateMulticlass(weakCharacter, mockWizard);
      expect(result.canMulticlass).toBe(false);
      expect(result.missingRequirements).toContain('Wizard: Intelligence 13+');
    });

    it('should reject multiclassing if current class requirements are not met (multiclassing out)', () => {
      const weakFighter = {
        ...baseCharacter,
        abilityScores: {
          ...baseCharacter.abilityScores,
          strength: { score: 10, modifier: 0, savingThrow: false },
        } as any,
      };
      const result = validateMulticlass(weakFighter, mockWizard);
      expect(result.canMulticlass).toBe(false);
      expect(result.missingRequirements).toContain('Fighter: Strength 13+');
    });

    it('should handle complex requirements like Monk', () => {
      const mockMonk: CharacterClass = { ...mockFighter, name: 'Monk' };
      const weakChar = {
        ...baseCharacter,
        abilityScores: {
          ...baseCharacter.abilityScores,
          wisdom: { score: 10, modifier: 0, savingThrow: false },
          dexterity: { score: 10, modifier: 0, savingThrow: false },
        } as any,
      };
      const result = validateMulticlass(weakChar, mockMonk);
      expect(result.missingRequirements).toContain('Monk: Dexterity 13+');
      expect(result.missingRequirements).toContain('Monk: Wisdom 13+');
    });

    it('should handle Paladin requirements', () => {
      const mockPaladin: CharacterClass = { ...mockFighter, name: 'Paladin' };
      const weakChar = {
        ...baseCharacter,
        abilityScores: {
          ...baseCharacter.abilityScores,
          charisma: { score: 10, modifier: 0, savingThrow: false },
          strength: { score: 10, modifier: 0, savingThrow: false },
        } as any,
      };
      const result = validateMulticlass(weakChar, mockPaladin);
      expect(result.missingRequirements).toContain('Paladin: Charisma 13+');
    });

    it('should handle Ranger requirements', () => {
      const mockRanger: CharacterClass = { ...mockFighter, name: 'Ranger' };
      const weakChar = {
        ...baseCharacter,
        abilityScores: {
          ...baseCharacter.abilityScores,
          wisdom: { score: 10, modifier: 0, savingThrow: false },
          dexterity: { score: 10, modifier: 0, savingThrow: false },
        } as any,
      };
      const result = validateMulticlass(weakChar, mockRanger);
      expect(result.missingRequirements).toContain('Ranger: Wisdom 13+');
    });
  });

  describe('calculateMulticlassHitPoints', () => {
    it('should return current max if no class levels', () => {
      const noClassChar = { ...baseCharacter, classLevels: [] };
      expect(calculateMulticlassHitPoints(noClassChar)).toBe(12);
    });

    it('should calculate correct HP for single class level 1', () => {
      const hp = calculateMulticlassHitPoints(baseCharacter);
      expect(hp).toBe(12); // 10 + 2
    });

    it('should calculate correct HP for single class level 5', () => {
      const level5Fighter = {
        ...baseCharacter,
        level: 5,
        classLevels: [
          {
            classId: 'fighter-id',
            className: 'Fighter',
            level: 5,
            hitDie: 10,
            features: [],
          }
        ],
      };
      const hp = calculateMulticlassHitPoints(level5Fighter);
      // 10 + 2 (1st level) + 4 * (6 + 2) (levels 2-5) = 12 + 32 = 44
      expect(hp).toBe(44);
    });

    it('should calculate correct HP for multiclass Fighter 1 / Wizard 1', () => {
      const multiclassChar = {
        ...baseCharacter,
        level: 2,
        classLevels: [
          {
            classId: 'fighter-id',
            className: 'Fighter',
            level: 1,
            hitDie: 10,
            features: [],
          },
          {
            classId: 'wizard-id',
            className: 'Wizard',
            level: 1,
            hitDie: 6,
            features: [],
          }
        ],
      };
      const hp = calculateMulticlassHitPoints(multiclassChar);
      // (10 + 2) + (4 + 2) = 18
      expect(hp).toBe(18);
    });

    it('should calculate correct HP for multiclass Fighter 2 / Wizard 3', () => {
      const multiclassChar = {
        ...baseCharacter,
        level: 5,
        classLevels: [
          {
            classId: 'fighter-id',
            className: 'Fighter',
            level: 2,
            hitDie: 10,
            features: [],
          },
          {
            classId: 'wizard-id',
            className: 'Wizard',
            level: 3,
            hitDie: 6,
            features: [],
          }
        ],
      };
      const hp = calculateMulticlassHitPoints(multiclassChar);
      // Fighter 1: 10 + 2 = 12
      // Fighter 2: 6 + 2 = 8
      // Wizard 1: 4 + 2 = 6
      // Wizard 2: 4 + 2 = 6
      // Wizard 3: 4 + 2 = 6
      // Total: 12 + 8 + 6 + 6 + 6 = 38
      expect(hp).toBe(38);
    });
  });

  describe('calculateMulticlassSpellcasting', () => {
    it('should return empty result if no class levels', () => {
      const noClassChar = { ...baseCharacter, classLevels: [] };
      const result = calculateMulticlassSpellcasting(noClassChar);
      expect(result.combinedCasterLevel).toBe(0);
    });

    it('should calculate correct caster level for full casters', () => {
      const wizard = {
        ...baseCharacter,
        classLevels: [
          { classId: 'wizard-id', className: 'Wizard', level: 3, hitDie: 6, features: [] }
        ]
      };
      const result = calculateMulticlassSpellcasting(wizard);
      expect(result.combinedCasterLevel).toBe(3);
      expect(result.spellSlots[1]).toBe(2); // 2nd level slots (index 1)
    });

    it('should combine levels correctly for multiclass full casters', () => {
      const clericWizard = {
        ...baseCharacter,
        classLevels: [
          { classId: 'cleric-id', className: 'Cleric', level: 2, hitDie: 8, features: [] },
          { classId: 'wizard-id', className: 'Wizard', level: 3, hitDie: 6, features: [] }
        ]
      };
      const result = calculateMulticlassSpellcasting(clericWizard);
      expect(result.combinedCasterLevel).toBe(5);
      expect(result.spellSlots).toEqual([4, 3, 2]); // Slots for level 5 caster
    });

    it('should handle half casters correctly (rounded down per class)', () => {
      const paladin = {
        ...baseCharacter,
        classLevels: [
          { classId: 'paladin-id', className: 'Paladin', level: 3, hitDie: 10, features: [] }
        ]
      };
      const result = calculateMulticlassSpellcasting(paladin);
      expect(result.combinedCasterLevel).toBe(1); // floor(3/2) = 1
    });

    it('should exclude warlock levels from combined caster level but identify them', () => {
      const warlockWizard = {
        ...baseCharacter,
        classLevels: [
          { classId: 'warlock-id', className: 'Warlock', level: 3, hitDie: 8, features: [] },
          { classId: 'wizard-id', className: 'Wizard', level: 2, hitDie: 6, features: [] }
        ]
      };
      const result = calculateMulticlassSpellcasting(warlockWizard);
      expect(result.combinedCasterLevel).toBe(2);
      expect(result.spellcastingClasses.find(c => c.className === 'Warlock')?.casterType).toBe('pact');
    });

    it('should handle third casters', () => {
      const fighterWizard = {
        ...baseCharacter,
        classLevels: [
          { classId: 'fighter-id', className: 'Fighter', level: 3, hitDie: 10, features: [] },
          { classId: 'wizard-id', className: 'Wizard', level: 1, hitDie: 6, features: [] }
        ]
      };
      const result = calculateMulticlassSpellcasting(fighterWizard);
      // Fighter 3: floor(3/3) = 1. Wizard 1: 1. Total: 2.
      expect(result.combinedCasterLevel).toBe(2);
    });
  });

  describe('calculateMulticlassProficiencies', () => {
    it('should include first class saving throws', () => {
      const result = calculateMulticlassProficiencies(baseCharacter);
      expect(result.savingThrows).toContain('strength');
      expect(result.savingThrows).toContain('constitution');
    });

    it('should NOT include additional class saving throws', () => {
      const multiclassChar = {
        ...baseCharacter,
        classLevels: [
          { classId: 'fighter-id', className: 'Fighter', level: 1, hitDie: 10, features: [] },
          { classId: 'wizard-id', className: 'Wizard', level: 1, hitDie: 6, features: [] }
        ]
      };
      const result = calculateMulticlassProficiencies(multiclassChar);
      expect(result.savingThrows).not.toContain('intelligence');
    });

    it('should combine armor and weapon proficiencies per multiclass table', () => {
      const fighterCleric = {
        ...baseCharacter,
        classLevels: [
          { classId: 'fighter-id', className: 'Fighter', level: 1, hitDie: 10, features: [] },
          { classId: 'cleric-id', className: 'Cleric', level: 1, hitDie: 8, features: [] }
        ]
      };
      const result = calculateMulticlassProficiencies(fighterCleric);
      expect(result.armor).toContain('Light armor');
      expect(result.armor).toContain('Medium armor');
      expect(result.armor).toContain('Shields');
    });
  });

  describe('getMulticlassFeatures', () => {
    it('should return all features from all classes', () => {
      const multiclassChar = {
        ...baseCharacter,
        classLevels: [
          { classId: 'fighter-id', className: 'Fighter', level: 1, hitDie: 10, features: [] },
          { classId: 'wizard-id', className: 'Wizard', level: 1, hitDie: 6, features: [] }
        ]
      };
      const features = getMulticlassFeatures(multiclassChar);
      expect(levelProgression.getAllClassFeaturesUpToLevel).toHaveBeenCalledTimes(2);
      expect(features).toHaveLength(2);
    });

    it('should return empty if no class levels', () => {
      const noClassChar = { ...baseCharacter, classLevels: [] };
      expect(getMulticlassFeatures(noClassChar)).toHaveLength(0);
    });
  });

  describe('addMulticlass', () => {
    it('should initialize classLevels if not present', () => {
      const char = { ...baseCharacter, classLevels: undefined };
      const updated = addMulticlass(char, mockWizard);
      expect(updated.classLevels).toHaveLength(2);
      expect(updated.classLevels[0].className).toBe('Fighter');
      expect(updated.classLevels[1].className).toBe('Wizard');
    });

    it('should update total level and hit points', () => {
      const updated = addMulticlass(baseCharacter, mockWizard);
      expect(updated.totalLevel).toBe(2);
      expect(updated.hitPoints?.maximum).toBe(18);
      expect(updated.hitPoints?.current).toBe(18);
    });
  });

  describe('levelUpClass', () => {
    it('should increment level for specified class and handle multiple classes', () => {
      const multiclassChar = addMulticlass(baseCharacter, mockWizard);
      const updated = levelUpClass(multiclassChar, 'wizard-id');

      expect(updated.classLevels!.find(c => c.classId === 'wizard-id')?.level).toBe(2);
      expect(updated.classLevels!.find(c => c.classId === 'fighter-id')?.level).toBe(1);
      expect(updated.totalLevel).toBe(3);
    });

    it('should return original character if no class levels', () => {
      const char = { ...baseCharacter, classLevels: undefined };
      const result = levelUpClass(char, 'fighter-id');
      expect(result).toEqual(char);
    });
  });
});
