/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useMulticlassing } from '../use-multiclassing';
import type { Character, CharacterClass } from '@/types/character';
import * as multiclassUtils from '@/utils/multiclassing';

// Mock the utilities
vi.mock('@/utils/multiclassing', () => ({
  validateMulticlass: vi.fn(),
  calculateMulticlassProficiencies: vi.fn(),
  calculateMulticlassHitPoints: vi.fn(),
  calculateMulticlassSpellcasting: vi.fn(),
  getMulticlassFeatures: vi.fn(),
  addMulticlass: vi.fn(),
  levelUpClass: vi.fn(),
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('useMulticlassing', () => {
  const mockCharacter: Character = {
    id: 'char-1',
    name: 'Test Character',
    level: 1,
    classLevels: [
      { classId: 'fighter-id', className: 'Fighter', level: 1, hitDie: 10, features: [] }
    ],
  } as any;

  const onCharacterUpdate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validateNewClass', () => {
    it('should validate a new class and update state', async () => {
      const mockNewClass: CharacterClass = { id: 'wizard-id', name: 'Wizard' } as any;
      const mockValidationResult = { canMulticlass: true, requirements: [], missingRequirements: [] };
      (multiclassUtils.validateMulticlass as any).mockReturnValue(mockValidationResult);

      const { result } = renderHook(() => useMulticlassing(mockCharacter, onCharacterUpdate));

      let validation;
      await act(async () => {
        validation = await result.current.validateNewClass(mockNewClass);
      });

      expect(multiclassUtils.validateMulticlass).toHaveBeenCalledWith(mockCharacter, mockNewClass);
      expect(validation).toEqual(mockValidationResult);
      expect(result.current.validationResult).toEqual(mockValidationResult);
    });

    it('should handle errors during validation', async () => {
      const mockNewClass: CharacterClass = { id: 'wizard-id', name: 'Wizard' } as any;
      (multiclassUtils.validateMulticlass as any).mockImplementation(() => {
        throw new Error('Test Error');
      });

      const { result } = renderHook(() => useMulticlassing(mockCharacter, onCharacterUpdate));

      let validation;
      await act(async () => {
        validation = await result.current.validateNewClass(mockNewClass);
      });

      expect(validation?.canMulticlass).toBe(false);
      expect(validation?.missingRequirements).toContain('Error validating multiclass requirements');
      expect(result.current.validationResult?.canMulticlass).toBe(false);
    });
  });

  describe('addNewClass', () => {
    it('should add a new class successfully', async () => {
      const mockNewClass: CharacterClass = { id: 'wizard-id', name: 'Wizard' } as any;
      const mockValidationResult = { canMulticlass: true, requirements: [], missingRequirements: [] };
      const mockUpdatedCharacter = { ...mockCharacter, totalLevel: 2 };

      (multiclassUtils.validateMulticlass as any).mockReturnValue(mockValidationResult);
      (multiclassUtils.addMulticlass as any).mockReturnValue(mockUpdatedCharacter);

      const { result } = renderHook(() => useMulticlassing(mockCharacter, onCharacterUpdate));

      let addResult;
      await act(async () => {
        addResult = await result.current.addNewClass(mockNewClass, 1);
      });

      expect(multiclassUtils.validateMulticlass).toHaveBeenCalledWith(mockCharacter, mockNewClass);
      expect(multiclassUtils.addMulticlass).toHaveBeenCalledWith(mockCharacter, mockNewClass, 1);
      expect(addResult.success).toBe(true);
      expect(onCharacterUpdate).toHaveBeenCalledWith(mockUpdatedCharacter);
      expect(addResult.character).toEqual(mockUpdatedCharacter);
    });

    it('should fail to add a new class if validation fails', async () => {
      const mockNewClass: CharacterClass = { id: 'wizard-id', name: 'Wizard' } as any;
      const mockValidationResult = {
        canMulticlass: false,
        requirements: ['Int 13+'],
        missingRequirements: ['Int 13+']
      };

      (multiclassUtils.validateMulticlass as any).mockReturnValue(mockValidationResult);

      const { result } = renderHook(() => useMulticlassing(mockCharacter, onCharacterUpdate));

      let addResult;
      await act(async () => {
        addResult = await result.current.addNewClass(mockNewClass, 1);
      });

      expect(addResult.success).toBe(false);
      expect(addResult.message).toContain('Cannot multiclass: Int 13+');
      expect(onCharacterUpdate).not.toHaveBeenCalled();
    });

    it('should handle errors during adding new class', async () => {
      const mockNewClass: CharacterClass = { id: 'wizard-id', name: 'Wizard' } as any;
      (multiclassUtils.validateMulticlass as any).mockReturnValue({ canMulticlass: true });
      (multiclassUtils.addMulticlass as any).mockImplementation(() => {
        throw new Error('Test Error');
      });

      const { result } = renderHook(() => useMulticlassing(mockCharacter, onCharacterUpdate));

      let addResult;
      await act(async () => {
        addResult = await result.current.addNewClass(mockNewClass, 1);
      });

      expect(addResult.success).toBe(false);
      expect(addResult.message).toBe('Failed to add new class');
    });
  });

  describe('levelUpSpecificClass', () => {
    it('should level up a specific class', async () => {
      const mockUpdatedCharacter = {
        ...mockCharacter,
        totalLevel: 2,
        classLevels: [
          { classId: 'fighter-id', className: 'Fighter', level: 2, hitDie: 10, features: [] }
        ]
      };
      (multiclassUtils.levelUpClass as any).mockReturnValue(mockUpdatedCharacter);

      const { result } = renderHook(() => useMulticlassing(mockCharacter, onCharacterUpdate));

      let levelUpResult;
      await act(async () => {
        levelUpResult = await result.current.levelUpSpecificClass('fighter-id');
      });

      expect(multiclassUtils.levelUpClass).toHaveBeenCalledWith(mockCharacter, 'fighter-id');
      expect(onCharacterUpdate).toHaveBeenCalledWith(mockUpdatedCharacter);
      expect(levelUpResult.success).toBe(true);
      expect(levelUpResult.message).toContain('Fighter');
    });

    it('should return "Unknown" if class name not found after level up', async () => {
      const mockUpdatedCharacter = {
        ...mockCharacter,
        classLevels: []
      };
      (multiclassUtils.levelUpClass as any).mockReturnValue(mockUpdatedCharacter);

      const { result } = renderHook(() => useMulticlassing(mockCharacter, onCharacterUpdate));

      let levelUpResult;
      await act(async () => {
        levelUpResult = await result.current.levelUpSpecificClass('some-id');
      });

      expect(levelUpResult.message).toContain('Unknown');
    });

    it('should handle errors during level up', async () => {
      (multiclassUtils.levelUpClass as any).mockImplementation(() => {
        throw new Error('Test Error');
      });

      const { result } = renderHook(() => useMulticlassing(mockCharacter, onCharacterUpdate));

      let levelUpResult;
      await act(async () => {
        levelUpResult = await result.current.levelUpSpecificClass('fighter-id');
      });

      expect(levelUpResult.success).toBe(false);
      expect(levelUpResult.message).toBe('Failed to level up class');
    });
  });

  describe('Utility Functions', () => {
    it('should return utility values correctly', () => {
      const { result } = renderHook(() => useMulticlassing(mockCharacter, onCharacterUpdate));

      expect(result.current.isMulticlassed()).toBe(false);
      expect(result.current.getClassLevel('fighter-id')).toBe(1);
      expect(result.current.getClassLevel('unknown')).toBe(0);
      expect(result.current.getTotalLevel()).toBe(1);
    });

    it('should return 0 for getClassLevel if classLevels is missing', () => {
      const charNoLevels = { ...mockCharacter, classLevels: undefined } as any;
      const { result } = renderHook(() => useMulticlassing(charNoLevels, onCharacterUpdate));
      expect(result.current.getClassLevel('fighter-id')).toBe(0);
    });

    it('should return sum for getTotalLevel from classLevels', () => {
      const mcChar = {
        ...mockCharacter,
        classLevels: [
          { classId: 'f', level: 2 },
          { classId: 'w', level: 3 }
        ]
      } as any;
      const { result } = renderHook(() => useMulticlassing(mcChar, onCharacterUpdate));
      expect(result.current.getTotalLevel()).toBe(5);
    });

    it('should return true for isMulticlassed if character has multiple classes', () => {
      const mcChar = {
        ...mockCharacter,
        classLevels: [
          { classId: 'f', level: 1 },
          { classId: 'w', level: 1 }
        ]
      } as any;
      const { result } = renderHook(() => useMulticlassing(mcChar, onCharacterUpdate));
      expect(result.current.isMulticlassed()).toBe(true);
    });

    it('should return fallback level in getTotalLevel if classLevels is missing', () => {
      const simpleChar = { name: 'Simple', level: 3, classLevels: undefined } as any;
      const { result } = renderHook(() => useMulticlassing(simpleChar, onCharacterUpdate));
      expect(result.current.getTotalLevel()).toBe(3);
    });

    it('should return 1 in getTotalLevel if classLevels and level are missing', () => {
      const simpleChar = { name: 'Simple', classLevels: undefined, level: undefined } as any;
      const { result } = renderHook(() => useMulticlassing(simpleChar, onCharacterUpdate));
      expect(result.current.getTotalLevel()).toBe(1);
    });

    it('should call calculation utilities', () => {
      const { result } = renderHook(() => useMulticlassing(mockCharacter, onCharacterUpdate));

      result.current.getProficiencies();
      expect(multiclassUtils.calculateMulticlassProficiencies).toHaveBeenCalledWith(mockCharacter);

      result.current.getHitPoints();
      expect(multiclassUtils.calculateMulticlassHitPoints).toHaveBeenCalledWith(mockCharacter);

      result.current.getSpellcasting();
      expect(multiclassUtils.calculateMulticlassSpellcasting).toHaveBeenCalledWith(mockCharacter);

      result.current.getFeatures();
      expect(multiclassUtils.getMulticlassFeatures).toHaveBeenCalledWith(mockCharacter);
    });
  });
});
