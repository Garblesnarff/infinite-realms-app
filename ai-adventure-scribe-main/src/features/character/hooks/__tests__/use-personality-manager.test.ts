/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(() => ({
    toast: mockToast,
  })),
}));

import { usePersonalityManager } from '../use-personality-manager';

describe('usePersonalityManager', () => {
  const mockOnUpdate = vi.fn();
  const mockCharacter: any = {
    id: 'char-123',
    name: 'Test Character',
    personalityTraits: ['Trait 1'],
    ideals: ['Ideal 1'],
    bonds: ['Bond 1'],
    flaws: ['Flaw 1'],
    inspiration: false,
    personalityIntegration: {
      inspirationHistory: [
        {
          date: '2024-01-01T00:00:00.000Z',
          trigger: 'Old Trigger',
          source: 'trait',
          description: 'Old Description',
        },
      ],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-02-20T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should initialize with character data', () => {
    const { result } = renderHook(() => usePersonalityManager(mockCharacter, mockOnUpdate));

    expect(result.current.personalityTraits).toEqual(['Trait 1']);
    expect(result.current.ideals).toEqual(['Ideal 1']);
    expect(result.current.bonds).toEqual(['Bond 1']);
    expect(result.current.flaws).toEqual(['Flaw 1']);
    expect(result.current.hasInspiration).toBe(false);
    expect(result.current.inspirationHistory).toHaveLength(1);
  });

  it('should handle missing character data gracefully', () => {
    const { result } = renderHook(() => usePersonalityManager({} as any, mockOnUpdate));

    expect(result.current.personalityTraits).toEqual([]);
    expect(result.current.hasInspiration).toBe(false);
    expect(result.current.inspirationHistory).toEqual([]);
  });

  describe('toggleInspiration', () => {
    it('should toggle inspiration on', () => {
      const { result } = renderHook(() => usePersonalityManager(mockCharacter, mockOnUpdate));

      act(() => {
        result.current.toggleInspiration();
      });

      expect(mockOnUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          inspiration: true,
          personalityIntegration: expect.objectContaining({
            lastInspiration: '2024-02-20T12:00:00.000Z',
          }),
        }),
      );
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Inspiration Gained!',
        }),
      );
    });

    it('should toggle inspiration off', () => {
      const inspiredCharacter = { ...mockCharacter, inspiration: true };
      const { result } = renderHook(() => usePersonalityManager(inspiredCharacter, mockOnUpdate));

      act(() => {
        result.current.toggleInspiration();
      });

      expect(mockOnUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          inspiration: false,
        }),
      );
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Inspiration Used',
        }),
      );
    });
  });

  describe('awardInspiration', () => {
    it('should award inspiration and add to history', () => {
      const { result } = renderHook(() => usePersonalityManager(mockCharacter, mockOnUpdate));

      act(() => {
        result.current.awardInspiration('New Trigger', 'ideal', 'New Description');
      });

      expect(mockOnUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          inspiration: true,
          personalityIntegration: expect.objectContaining({
            inspirationHistory: expect.arrayContaining([
              mockCharacter.personalityIntegration.inspirationHistory[0],
              {
                date: '2024-02-20T12:00:00.000Z',
                trigger: 'New Trigger',
                source: 'ideal',
                description: 'New Description',
              },
            ]),
          }),
        }),
      );
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Inspiration Awarded!',
        }),
      );
    });

    it('should not award inspiration if already present', () => {
      const inspiredCharacter = { ...mockCharacter, inspiration: true };
      const { result } = renderHook(() => usePersonalityManager(inspiredCharacter, mockOnUpdate));

      act(() => {
        result.current.awardInspiration('Trigger', 'trait', 'Description');
      });

      expect(mockOnUpdate).not.toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'destructive',
        }),
      );
    });
  });

  describe('addPersonalityElement', () => {
    it('should add a trait and clear input', () => {
      const { result } = renderHook(() => usePersonalityManager(mockCharacter, mockOnUpdate));

      act(() => {
        result.current.setNewTrait('New Trait');
      });
      expect(result.current.newTrait).toBe('New Trait');

      act(() => {
        result.current.addPersonalityElement('trait', 'New Trait');
      });

      expect(mockOnUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          personalityTraits: ['Trait 1', 'New Trait'],
        }),
      );
      expect(result.current.newTrait).toBe('');
      expect(mockToast).toHaveBeenCalled();
    });

    it('should add an ideal and clear input', () => {
      const { result } = renderHook(() => usePersonalityManager(mockCharacter, mockOnUpdate));
      act(() => {
        result.current.addPersonalityElement('ideal', 'New Ideal');
      });
      expect(mockOnUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          ideals: ['Ideal 1', 'New Ideal'],
        }),
      );
    });

    it('should add a bond and clear input', () => {
      const { result } = renderHook(() => usePersonalityManager(mockCharacter, mockOnUpdate));
      act(() => {
        result.current.addPersonalityElement('bond', 'New Bond');
      });
      expect(mockOnUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          bonds: ['Bond 1', 'New Bond'],
        }),
      );
    });

    it('should add a flaw and clear input', () => {
      const { result } = renderHook(() => usePersonalityManager(mockCharacter, mockOnUpdate));
      act(() => {
        result.current.addPersonalityElement('flaw', 'New Flaw');
      });
      expect(mockOnUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          flaws: ['Flaw 1', 'New Flaw'],
        }),
      );
    });

    it('should not add empty elements', () => {
      const { result } = renderHook(() => usePersonalityManager(mockCharacter, mockOnUpdate));
      act(() => {
        result.current.addPersonalityElement('trait', '  ');
      });
      expect(mockOnUpdate).not.toHaveBeenCalled();
    });
  });

  describe('removePersonalityElement', () => {
    it('should remove a trait', () => {
      const { result } = renderHook(() => usePersonalityManager(mockCharacter, mockOnUpdate));

      act(() => {
        result.current.removePersonalityElement('trait', 0);
      });

      expect(mockOnUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          personalityTraits: [],
        }),
      );
    });

    it('should remove an ideal', () => {
      const { result } = renderHook(() => usePersonalityManager(mockCharacter, mockOnUpdate));
      act(() => {
        result.current.removePersonalityElement('ideal', 0);
      });
      expect(mockOnUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          ideals: [],
        }),
      );
    });

    it('should remove a bond', () => {
      const { result } = renderHook(() => usePersonalityManager(mockCharacter, mockOnUpdate));
      act(() => {
        result.current.removePersonalityElement('bond', 0);
      });
      expect(mockOnUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          bonds: [],
        }),
      );
    });

    it('should remove a flaw', () => {
      const { result } = renderHook(() => usePersonalityManager(mockCharacter, mockOnUpdate));
      act(() => {
        result.current.removePersonalityElement('flaw', 0);
      });
      expect(mockOnUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          flaws: [],
        }),
      );
    });
  });
});
