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
  // #2701: onUpdate persists and resolves true when the write landed.
  const mockOnUpdate = vi.fn().mockResolvedValue(true);
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
    mockOnUpdate.mockResolvedValue(true);
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

  describe('inspiration (read-only)', () => {
    it('does not expose toggleInspiration or awardInspiration', () => {
      const { result } = renderHook(() => usePersonalityManager(mockCharacter, mockOnUpdate));
      expect((result.current as any).toggleInspiration).toBeUndefined();
      expect((result.current as any).awardInspiration).toBeUndefined();
    });

    it('hasInspiration follows character.inspiration', () => {
      const inspiredCharacter = { ...mockCharacter, inspiration: true };
      const { result: r1 } = renderHook(() => usePersonalityManager(mockCharacter, mockOnUpdate));
      const { result: r2 } = renderHook(() =>
        usePersonalityManager(inspiredCharacter, mockOnUpdate),
      );
      expect(r1.current.hasInspiration).toBe(false);
      expect(r2.current.hasInspiration).toBe(true);
    });

    it('addPersonalityElement payload has no inspiration key', async () => {
      const { result } = renderHook(() => usePersonalityManager(mockCharacter, mockOnUpdate));
      await act(async () => {
        await result.current.addPersonalityElement('trait', 'New Trait');
      });
      const payload = mockOnUpdate.mock.calls[0][0];
      expect(payload).not.toHaveProperty('inspiration');
    });

    it('removePersonalityElement payload has no inspiration key', async () => {
      const { result } = renderHook(() => usePersonalityManager(mockCharacter, mockOnUpdate));
      await act(async () => {
        await result.current.removePersonalityElement('trait', 0);
      });
      const payload = mockOnUpdate.mock.calls[0][0];
      expect(payload).not.toHaveProperty('inspiration');
    });
  });

  describe('addPersonalityElement', () => {
    it('should add a trait and clear input', async () => {
      const { result } = renderHook(() => usePersonalityManager(mockCharacter, mockOnUpdate));

      act(() => {
        result.current.setNewTrait('New Trait');
      });
      expect(result.current.newTrait).toBe('New Trait');

      await act(async () => {
        await result.current.addPersonalityElement('trait', 'New Trait');
      });

      expect(mockOnUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          personalityTraits: ['Trait 1', 'New Trait'],
        }),
      );
      expect(result.current.newTrait).toBe('');
      expect(mockToast).toHaveBeenCalled();
    });

    it('should add an ideal and clear input', async () => {
      const { result } = renderHook(() => usePersonalityManager(mockCharacter, mockOnUpdate));
      await act(async () => {
        await result.current.addPersonalityElement('ideal', 'New Ideal');
      });
      expect(mockOnUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          ideals: ['Ideal 1', 'New Ideal'],
        }),
      );
    });

    it('should add a bond and clear input', async () => {
      const { result } = renderHook(() => usePersonalityManager(mockCharacter, mockOnUpdate));
      await act(async () => {
        await result.current.addPersonalityElement('bond', 'New Bond');
      });
      expect(mockOnUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          bonds: ['Bond 1', 'New Bond'],
        }),
      );
    });

    it('should add a flaw and clear input', async () => {
      const { result } = renderHook(() => usePersonalityManager(mockCharacter, mockOnUpdate));
      await act(async () => {
        await result.current.addPersonalityElement('flaw', 'New Flaw');
      });
      expect(mockOnUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          flaws: ['Flaw 1', 'New Flaw'],
        }),
      );
    });

    it('should not add empty elements', async () => {
      const { result } = renderHook(() => usePersonalityManager(mockCharacter, mockOnUpdate));
      await act(async () => {
        await result.current.addPersonalityElement('trait', '  ');
      });
      expect(mockOnUpdate).not.toHaveBeenCalled();
    });

    it('#2701: keeps the input and toasts nothing of its own when the save fails', async () => {
      mockOnUpdate.mockResolvedValue(false);
      const { result } = renderHook(() => usePersonalityManager(mockCharacter, mockOnUpdate));

      act(() => {
        result.current.setNewTrait('New Trait');
      });

      await act(async () => {
        await result.current.addPersonalityElement('trait', 'New Trait');
      });

      // The single error toast is owned by the persistence layer
      // (persistCharacterUpdate), not the manager — asserting here that the
      // manager adds no second toast. The hook-level toast is covered by the
      // sheet component test.
      expect(mockToast).not.toHaveBeenCalled();
      expect(result.current.newTrait).toBe('New Trait');
    });
  });

  describe('removePersonalityElement', () => {
    it('should remove a trait', async () => {
      const { result } = renderHook(() => usePersonalityManager(mockCharacter, mockOnUpdate));

      await act(async () => {
        await result.current.removePersonalityElement('trait', 0);
      });

      expect(mockOnUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          personalityTraits: [],
        }),
      );
    });

    it('should remove an ideal', async () => {
      const { result } = renderHook(() => usePersonalityManager(mockCharacter, mockOnUpdate));
      await act(async () => {
        await result.current.removePersonalityElement('ideal', 0);
      });
      expect(mockOnUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          ideals: [],
        }),
      );
    });

    it('should remove a bond', async () => {
      const { result } = renderHook(() => usePersonalityManager(mockCharacter, mockOnUpdate));
      await act(async () => {
        await result.current.removePersonalityElement('bond', 0);
      });
      expect(mockOnUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          bonds: [],
        }),
      );
    });

    it('should remove a flaw', async () => {
      const { result } = renderHook(() => usePersonalityManager(mockCharacter, mockOnUpdate));
      await act(async () => {
        await result.current.removePersonalityElement('flaw', 0);
      });
      expect(mockOnUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          flaws: [],
        }),
      );
    });
  });
});
