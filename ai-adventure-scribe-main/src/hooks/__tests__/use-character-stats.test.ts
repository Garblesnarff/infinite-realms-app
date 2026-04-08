/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import {
  useCharacterStats,
  useEffectiveAbilityScores,
  useLevelProgression,
  useCharacterStatValue,
  useIsSpellcaster,
} from '../use-character-stats';

import type { Character } from '@/types/character';

import { applyRacialBonuses, formatRacialBonus } from '@/utils/racialAbilityBonuses';

// Mock logger to avoid console noise
vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('use-character-stats hooks', () => {
  const mockCharacter: Character = {
    id: '1',
    name: 'Test Hero',
    level: 1,
    experience: 0,
    class: {
      id: 'wizard',
      name: 'Wizard',
      hitDie: 6,
      primaryAbility: 'intelligence',
      savingThrowProficiencies: ['intelligence', 'wisdom'],
    } as any,
    race: {
      id: 'human',
      name: 'Human',
      abilityScoreIncrease: {
        strength: 1,
        dexterity: 1,
        constitution: 1,
        intelligence: 1,
        wisdom: 1,
        charisma: 1,
      },
      speed: 30,
    } as any,
    abilityScores: {
      strength: { score: 10, modifier: 0, savingThrow: false },
      dexterity: { score: 10, modifier: 0, savingThrow: false },
      constitution: { score: 10, modifier: 0, savingThrow: false },
      intelligence: { score: 10, modifier: 0, savingThrow: false },
      wisdom: { score: 10, modifier: 0, savingThrow: false },
      charisma: { score: 10, modifier: 0, savingThrow: false },
    },
  };

  describe('useEffectiveAbilityScores', () => {
    it('should apply base racial bonuses', () => {
      const { result } = renderHook(() => useEffectiveAbilityScores(mockCharacter));

      expect(result.current?.strength.score).toBe(11);
      expect(result.current?.strength.modifier).toBe(0); // floor((11-10)/2) = 0
    });

    it('should stack race and subrace bonuses', () => {
      const dwarfCharacter: Character = {
        ...mockCharacter,
        race: {
          id: 'dwarf',
          name: 'Dwarf',
          abilityScoreIncrease: { constitution: 2 },
        } as any,
        subrace: {
          id: 'hill-dwarf',
          name: 'Hill Dwarf',
          abilityScoreIncrease: { wisdom: 1 },
        } as any,
      };

      const { result } = renderHook(() => useEffectiveAbilityScores(dwarfCharacter));

      expect(result.current?.constitution.score).toBe(12);
      expect(result.current?.wisdom.score).toBe(11);
    });

    it('should handle bonus stacking for the same ability', () => {
      // In D&D 5e, if a race and subrace both give a bonus to the same ability, they stack.
      const stackingCharacter: Character = {
        ...mockCharacter,
        race: {
          id: 'test-race',
          name: 'Test Race',
          abilityScoreIncrease: { strength: 1 },
        } as any,
        subrace: {
          id: 'test-subrace',
          name: 'Test Subrace',
          abilityScoreIncrease: { strength: 1 },
        } as any,
      };

      const { result } = renderHook(() => useEffectiveAbilityScores(stackingCharacter));

      // CURRENT BUG: This will likely be 11 because of the spread operator in useEffectiveAbilityScores
      expect(result.current?.strength.score).toBe(12);
    });

    it('should handle racialAbilityChoices for Half-Elf', () => {
      const halfElf: Character = {
        ...mockCharacter,
        race: {
          id: 'half-elf',
          name: 'Half-Elf',
          abilityScoreIncrease: { charisma: 2 },
        } as any,
        racialAbilityChoices: {
          halfElf: ['strength', 'dexterity'],
        },
      };

      const { result } = renderHook(() => useEffectiveAbilityScores(halfElf));

      // CURRENT BUG: racialAbilityChoices is ignored in the hook
      expect(result.current?.charisma.score).toBe(12);
      expect(result.current?.strength.score).toBe(11);
      expect(result.current?.dexterity.score).toBe(11);
    });
  });

  describe('useCharacterStats', () => {
    it('should incorporate racial bonuses into derived stats', () => {
      // High Elf Wizard with 15 INT base + 1 INT racial = 16 INT (+3 mod)
      // Spell Save DC = 8 + 2 (prof) + 3 (mod) = 13
      const highElfWizard: Character = {
        ...mockCharacter,
        abilityScores: {
          ...mockCharacter.abilityScores,
          intelligence: { score: 15, modifier: 2, savingThrow: true },
        } as any,
        race: {
          id: 'elf',
          name: 'Elf',
          abilityScoreIncrease: { dexterity: 2 },
        } as any,
        subrace: {
          id: 'high-elf',
          name: 'High Elf',
          abilityScoreIncrease: { intelligence: 1 },
        } as any,
      };

      const { result } = renderHook(() => useCharacterStats(highElfWizard));

      // CURRENT BUG: useCharacterStats likely uses base scores, so it might see INT 15 (+2 mod)
      // DC would be 8 + 2 + 2 = 12
      expect(result.current?.spellSaveDC).toBe(13);
    });

    it('should incorporate constitution bonus into HP', () => {
      // 10 CON base + 2 racial = 12 CON (+1 mod)
      // Level 1 Wizard HP = 6 + 1 = 7
      const toughWizard: Character = {
        ...mockCharacter,
        race: {
          id: 'tough-race',
          name: 'Tough Race',
          abilityScoreIncrease: { constitution: 2 },
        } as any,
      };

      const { result } = renderHook(() => useCharacterStats(toughWizard));

      // CURRENT BUG: If it uses base scores, CON 10 (+0 mod) -> HP 6
      expect(result.current?.hitPoints).toBe(7);
    });
  });

  describe('useCharacterStatValue', () => {
    it('should return a specific stat value', () => {
      const { result } = renderHook(() => useCharacterStatValue(mockCharacter, 'proficiencyBonus'));
      expect(result.current).toBe(2);
    });

    it('should return null if character is null', () => {
      const { result } = renderHook(() => useCharacterStatValue(null, 'proficiencyBonus'));
      expect(result.current).toBeNull();
    });
  });

  describe('useIsSpellcaster', () => {
    it('should return true for Wizard', () => {
      const { result } = renderHook(() => useIsSpellcaster(mockCharacter));
      expect(result.current).toBe(true);
    });

    it('should return false for non-spellcaster', () => {
      const fighter: Character = {
        ...mockCharacter,
        class: { name: 'Fighter' } as any,
      };
      const { result } = renderHook(() => useIsSpellcaster(fighter));
      expect(result.current).toBe(false);
    });

    it('should return false if no character class', () => {
      const noClass = { ...mockCharacter, class: null };
      const { result } = renderHook(() => useIsSpellcaster(noClass));
      expect(result.current).toBe(false);
    });
  });

  describe('useLevelProgression', () => {
    it('should calculate level 1 progression correctly', () => {
      const { result } = renderHook(() => useLevelProgression(mockCharacter));

      expect(result.current?.currentLevel).toBe(1);
      expect(result.current?.nextLevelXP).toBe(300);
      expect(result.current?.progressPercent).toBe(0);
      expect(result.current?.canLevelUp).toBe(false);
    });

    it('should signal level up when XP threshold is met', () => {
      const leveledCharacter = { ...mockCharacter, experience: 300 };
      const { result } = renderHook(() => useLevelProgression(leveledCharacter));

      expect(result.current?.canLevelUp).toBe(true);
    });

    it('should handle max level (20)', () => {
      const maxLevelCharacter = { ...mockCharacter, level: 20, experience: 355000 };
      const { result } = renderHook(() => useLevelProgression(maxLevelCharacter));

      expect(result.current?.isMaxLevel).toBe(true);
      expect(result.current?.progressPercent).toBe(100);
    });

    it('should return null if character is null', () => {
      const { result } = renderHook(() => useLevelProgression(null));
      expect(result.current).toBeNull();
    });
  });

  describe('racialAbilityBonuses utils', () => {
    it('applyRacialBonuses should cap scores at 20', () => {
      const baseScores = {
        strength: 19,
        dexterity: 10,
        constitution: 10,
        intelligence: 10,
        wisdom: 10,
        charisma: 10,
      };
      const bonuses = [{ ability: 'strength' as any, bonus: 2 }];
      const final = applyRacialBonuses(baseScores, bonuses);
      expect(final.strength).toBe(20);
    });

    it('formatRacialBonus should format properly', () => {
      expect(formatRacialBonus(2)).toBe('+2');
      expect(formatRacialBonus(0)).toBe('0');
      expect(formatRacialBonus(-1)).toBe('-1');
    });
  });
});
