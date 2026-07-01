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
  const mockOnUpdate = vi.fn();

  const mockCharacter: any = {
    id: 'char-123',
    name: 'Test Character',
    level: 1,
    experience: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
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

  it('should award experience and call onUpdate', () => {
    const { result } = renderHook(() =>
      useExperienceManager({ character: mockCharacter, onUpdate: mockOnUpdate }),
    );

    act(() => {
      result.current.setExperienceAmount(100);
      result.current.setExperienceSource('Quest reward');
    });

    act(() => {
      result.current.awardExperience();
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

  it('should notify level up when awarding experience', () => {
    const { result } = renderHook(() =>
      useExperienceManager({ character: mockCharacter, onUpdate: mockOnUpdate }),
    );

    act(() => {
      result.current.setExperienceAmount(400); // 300 is needed for level 2
      result.current.setExperienceSource('Big boss');
    });

    act(() => {
      result.current.awardExperience();
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Level Up Available!',
      }),
    );
  });

  it('should not award experience with invalid input', () => {
    const { result } = renderHook(() =>
      useExperienceManager({ character: mockCharacter, onUpdate: mockOnUpdate }),
    );

    // Missing source
    act(() => {
      result.current.setExperienceAmount(100);
      result.current.setExperienceSource('');
    });

    act(() => {
      result.current.awardExperience();
    });

    expect(mockOnUpdate).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Invalid Input',
        variant: 'destructive',
      }),
    );

    // Zero amount
    mockToast.mockClear();
    act(() => {
      result.current.setExperienceAmount(0);
      result.current.setExperienceSource('Source');
    });

    act(() => {
      result.current.awardExperience();
    });

    expect(mockOnUpdate).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Invalid Input',
      }),
    );
  });

  it('should remove experience and call onUpdate', () => {
    const experiencedChar = { ...mockCharacter, experience: 500 };
    const { result } = renderHook(() =>
      useExperienceManager({ character: experiencedChar, onUpdate: mockOnUpdate }),
    );

    act(() => {
      result.current.setExperienceAmount(200);
      result.current.setExperienceSource('Penalty');
    });

    act(() => {
      result.current.removeExperience();
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

  it('should floor experience at 0 when removing', () => {
    const { result } = renderHook(() =>
      useExperienceManager({ character: mockCharacter, onUpdate: mockOnUpdate }),
    );

    act(() => {
      result.current.setExperienceAmount(100);
      result.current.setExperienceSource('Debt');
    });

    act(() => {
      result.current.removeExperience();
    });

    expect(mockOnUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        experience: 0,
      }),
    );
  });

  it('should set experience to a specific level', () => {
    const { result } = renderHook(() =>
      useExperienceManager({ character: mockCharacter, onUpdate: mockOnUpdate }),
    );

    act(() => {
      result.current.setToLevel(5);
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
});
