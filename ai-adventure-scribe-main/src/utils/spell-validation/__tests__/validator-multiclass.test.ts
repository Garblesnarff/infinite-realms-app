/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateMulticlassSpellSelection } from '../validator-multiclass';
import { getEnhancedSpellcastingInfo } from '../utils';
import { validateSpellSelection } from '../validator-sync';
import type { Character } from '@/types/character';

// Mock dependencies
vi.mock('../utils', () => ({
  getEnhancedSpellcastingInfo: vi.fn(),
  calculateMulticlassCasterLevel: vi.fn(),
  getSpellcastingInfo: vi.fn(),
  getMaxSpellCounts: vi.fn(),
  getSpellValidationRules: vi.fn(),
  isSpellValidForClass: vi.fn(),
  isSpellValidForClassAsync: vi.fn(),
}));

vi.mock('../validator-sync', () => ({
  validateSpellSelection: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('validateMulticlassSpellSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fall back to regular validation for single-class characters', async () => {
    const mockCharacter: Partial<Character> = {
      id: 'char-1',
      classLevels: [{ className: 'Wizard', level: 1 }],
    };
    const mockResult = { valid: true, errors: [], warnings: [] };
    (validateSpellSelection as any).mockReturnValue(mockResult);

    const result = await validateMulticlassSpellSelection(
      mockCharacter as Character,
      ['cantrip1'],
      ['spell1']
    );

    expect(validateSpellSelection).toHaveBeenCalledWith(mockCharacter, ['cantrip1'], ['spell1']);
    expect(result).toEqual(mockResult);
  });

  it('should fall back to regular validation if classLevels is missing', async () => {
    const mockCharacter: Partial<Character> = {
      id: 'char-1',
    };
    const mockResult = { valid: true, errors: [], warnings: [] };
    (validateSpellSelection as any).mockReturnValue(mockResult);

    const result = await validateMulticlassSpellSelection(mockCharacter as Character, [], []);

    expect(validateSpellSelection).toHaveBeenCalled();
    expect(result).toEqual(mockResult);
  });

  it('should validate multiclass characters and return warnings', async () => {
    const mockCharacter: Partial<Character> = {
      id: 'char-1',
      classLevels: [
        { className: 'Wizard', level: 1 },
        { className: 'Cleric', level: 1 },
      ],
    };

    (getEnhancedSpellcastingInfo as any).mockResolvedValue({
      multiclassInfo: {
        totalCasterLevel: 2,
        pactMagicSlots: null,
      },
    });

    const result = await validateMulticlassSpellSelection(mockCharacter as Character, [], []);

    expect(result.valid).toBe(true);
    expect(result.warnings).toContain('Multiclass caster level: 2');
    expect(result.warnings).not.toContain('Pact Magic slots are separate from regular spell slots.');
  });

  it('should add Pact Magic warning if character has pact magic slots', async () => {
    const mockCharacter: Partial<Character> = {
      id: 'char-1',
      classLevels: [
        { className: 'Warlock', level: 1 },
        { className: 'Wizard', level: 1 },
      ],
    };

    (getEnhancedSpellcastingInfo as any).mockResolvedValue({
      multiclassInfo: {
        totalCasterLevel: 1,
        pactMagicSlots: { level: 1, slots: 1 },
      },
    });

    const result = await validateMulticlassSpellSelection(mockCharacter as Character, [], []);

    expect(result.warnings).toContain('Pact Magic slots are separate from regular spell slots.');
  });

  it('should handle errors in getEnhancedSpellcastingInfo gracefully', async () => {
    const mockCharacter: Partial<Character> = {
      id: 'char-1',
      classLevels: [
        { className: 'Wizard', level: 1 },
        { className: 'Cleric', level: 1 },
      ],
    };

    (getEnhancedSpellcastingInfo as any).mockRejectedValue(new Error('Calculation failed'));

    const result = await validateMulticlassSpellSelection(mockCharacter as Character, [], []);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        type: 'LEVEL_REQUIREMENT',
        message: 'Failed to calculate multiclass spell requirements',
      })
    );
  });

  it('should handle case where enhancedInfo is null', async () => {
    const mockCharacter: Partial<Character> = {
      id: 'char-1',
      classLevels: [
        { className: 'Wizard', level: 1 },
        { className: 'Cleric', level: 1 },
      ],
    };

    // This simulates the potential crash if enhancedInfo is null
    (getEnhancedSpellcastingInfo as any).mockResolvedValue(null);

    const result = await validateMulticlassSpellSelection(mockCharacter as Character, [], []);

    // It should throw because of enhancedInfo!.multiclassInfo access,
    // which is caught by the try-catch block in validator-multiclass.ts
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        type: 'LEVEL_REQUIREMENT',
      })
    );
  });
});
