/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useExperienceManager } from '../useExperienceManager';

import { useToast } from '@/hooks/use-toast';

vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(),
}));

describe('useExperienceManager', () => {
  const mockToast = vi.fn();
  // #2701: onUpdate persists and resolves true when the write landed.
  const mockOnUpdate = vi.fn().mockResolvedValue(true);

  const mockCharacter: any = {
    id: 'char-123',
    name: 'Test Character',
    level: 1,
    experience: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnUpdate.mockResolvedValue(true);
    (useToast as any).mockReturnValue({ toast: mockToast });
  });

  it('should initialize with correct state for level 1 character', () => {
    const { result } = renderHook(() =>
      useExperienceManager({ character: mockCharacter, onUpdate: mockOnUpdate }),
    );

    expect(result.current.currentExperience).toBe(0);
    expect(result.current.currentLevel).toBe(1);
    expect(result.current.calculatedLevel).toBe(1);
    expect(result.current.nextLevel).toBe(2);
    expect(result.current.nextLevelXP).toBe(300);
    expect(result.current.progressToNextLevel).toBe(0);
    expect(result.current.experienceNeeded).toBe(300);
    expect(result.current.showHistory).toBe(false);
  });

  it('should calculate progress correctly at mid-level', () => {
    const midLevelChar = { ...mockCharacter, experience: 450, level: 2 };
    // Level 2 is 300 XP, Level 3 is 900 XP.
    // Progress: (450 - 300) / (900 - 300) = 150 / 600 = 25%
    const { result } = renderHook(() =>
      useExperienceManager({ character: midLevelChar, onUpdate: mockOnUpdate }),
    );

    expect(result.current.currentLevel).toBe(2);
    expect(result.current.progressToNextLevel).toBe(25);
    expect(result.current.experienceNeeded).toBe(450);
  });

  it('should handle level 20 character correctly', () => {
    const level20Char = { ...mockCharacter, experience: 355000, level: 20 };
    const { result } = renderHook(() =>
      useExperienceManager({ character: level20Char, onUpdate: mockOnUpdate }),
    );

    expect(result.current.currentLevel).toBe(20);
    expect(result.current.nextLevel).toBe(20);
    expect(result.current.progressToNextLevel).toBe(100);
    expect(result.current.experienceNeeded).toBe(0);
  });

  it('should award experience and call onUpdate', async () => {
    const { result } = renderHook(() =>
      useExperienceManager({ character: mockCharacter, onUpdate: mockOnUpdate }),
    );

    act(() => {
      result.current.setExperienceAmount(100);
      result.current.setExperienceSource('Quest reward');
    });

    await act(async () => {
      await result.current.awardExperience();
    });

    expect(mockOnUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        experience: 100,
      }),
    );

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Experience Awarded',
        description: expect.stringContaining('Gained 100 XP'),
      }),
    );

    // Reset inputs
    expect(result.current.experienceAmount).toBe(0);
    expect(result.current.experienceSource).toBe('');
  });

  it('should notify level up when awarding experience', async () => {
    const { result } = renderHook(() =>
      useExperienceManager({ character: mockCharacter, onUpdate: mockOnUpdate }),
    );

    act(() => {
      result.current.setExperienceAmount(400); // 300 is needed for level 2
      result.current.setExperienceSource('Big boss');
    });

    await act(async () => {
      await result.current.awardExperience();
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Level Up Available!',
      }),
    );
  });

  // #214 (QA-037): the old "Invalid Input" catch-all is gone — each bad input
  // gets its own message, and 0 is a valid amount.
  it('should not award experience with invalid input', async () => {
    const { result } = renderHook(() =>
      useExperienceManager({ character: mockCharacter, onUpdate: mockOnUpdate }),
    );

    // Missing source
    act(() => {
      result.current.setExperienceAmount(100);
      result.current.setExperienceSource('');
    });

    await act(async () => {
      await result.current.awardExperience();
    });

    expect(mockOnUpdate).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Missing Source',
        variant: 'destructive',
      }),
    );

    // Negative amount
    mockToast.mockClear();
    act(() => {
      result.current.setExperienceAmount(-5);
      result.current.setExperienceSource('Source');
    });

    await act(async () => {
      await result.current.awardExperience();
    });

    expect(mockOnUpdate).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Invalid XP Amount',
      }),
    );
  });

  it('should remove experience and call onUpdate', async () => {
    const experiencedChar = { ...mockCharacter, experience: 500 };
    const { result } = renderHook(() =>
      useExperienceManager({ character: experiencedChar, onUpdate: mockOnUpdate }),
    );

    act(() => {
      result.current.setExperienceAmount(200);
      result.current.setExperienceSource('Penalty');
    });

    await act(async () => {
      await result.current.removeExperience();
    });

    expect(mockOnUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        experience: 300,
      }),
    );

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Experience Removed',
      }),
    );
  });

  it('should floor experience at 0 when removing', async () => {
    const { result } = renderHook(() =>
      useExperienceManager({ character: mockCharacter, onUpdate: mockOnUpdate }),
    );

    act(() => {
      result.current.setExperienceAmount(100);
      result.current.setExperienceSource('Debt');
    });

    await act(async () => {
      await result.current.removeExperience();
    });

    expect(mockOnUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        experience: 0,
      }),
    );
  });

  it('should set experience to a specific level', async () => {
    const { result } = renderHook(() =>
      useExperienceManager({ character: mockCharacter, onUpdate: mockOnUpdate }),
    );

    await act(async () => {
      await result.current.setToLevel(5);
    });

    // Level 5 requires 6500 XP
    expect(mockOnUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        experience: 6500,
      }),
    );

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Experience Set',
        description: expect.stringContaining('Level 5'),
      }),
    );
  });

  it('#2701: toasts nothing of its own when the save fails', async () => {
    mockOnUpdate.mockResolvedValue(false);
    const { result } = renderHook(() =>
      useExperienceManager({ character: mockCharacter, onUpdate: mockOnUpdate }),
    );

    act(() => {
      result.current.setExperienceAmount(100);
      result.current.setExperienceSource('Quest reward');
    });

    await act(async () => {
      await result.current.awardExperience();
    });

    // The single error toast is owned by the persistence layer
    // (persistCharacterUpdate), not the manager — the manager must not add a
    // second one, nor the success toast. The hook-level toast is covered by
    // the sheet component test.
    expect(mockToast).not.toHaveBeenCalled();
    // Inputs stay so the user can retry.
    expect(result.current.experienceAmount).toBe(100);
    expect(result.current.experienceSource).toBe('Quest reward');
  });

  it('should toggle history view', () => {
    const { result } = renderHook(() =>
      useExperienceManager({ character: mockCharacter, onUpdate: mockOnUpdate }),
    );

    expect(result.current.showHistory).toBe(false);

    act(() => {
      result.current.setShowHistory(true);
    });

    expect(result.current.showHistory).toBe(true);
  });

  // #214 (QA-037): awarding 0 XP is allowed — the field no longer rejects it.
  it('should award 0 XP without an error toast', async () => {
    const { result } = renderHook(() =>
      useExperienceManager({ character: mockCharacter, onUpdate: mockOnUpdate }),
    );

    act(() => {
      result.current.setExperienceAmount(0);
      result.current.setExperienceSource('Quest reward');
    });

    await act(async () => {
      await result.current.awardExperience();
    });

    expect(mockOnUpdate).toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Experience Awarded' }),
    );
  });

  // #214 (QA-037): a negative amount gets a specific message, not "Invalid Input".
  it('should show a specific message for negative XP', async () => {
    const { result } = renderHook(() =>
      useExperienceManager({ character: mockCharacter, onUpdate: mockOnUpdate }),
    );

    act(() => {
      result.current.setExperienceAmount(-5);
      result.current.setExperienceSource('Quest reward');
    });

    await act(async () => {
      await result.current.awardExperience();
    });

    expect(mockOnUpdate).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Invalid XP Amount',
        description: 'The XP amount cannot be negative.',
        variant: 'destructive',
      }),
    );
  });

  // #214 (QA-037): a missing source gets its own message.
  it('should show a specific message for a missing source', async () => {
    const { result } = renderHook(() =>
      useExperienceManager({ character: mockCharacter, onUpdate: mockOnUpdate }),
    );

    act(() => {
      result.current.setExperienceAmount(100);
      result.current.setExperienceSource('');
    });

    await act(async () => {
      await result.current.awardExperience();
    });

    expect(mockOnUpdate).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Missing Source', variant: 'destructive' }),
    );
  });
});
