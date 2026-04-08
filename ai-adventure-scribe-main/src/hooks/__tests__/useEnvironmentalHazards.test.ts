/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as hazardUtils from '../../utils/environmentalHazards';
import { useEnvironmentalHazards } from '../use-environmental-hazards';

// Mock the utility functions
vi.mock('../../utils/environmentalHazards', () => ({
  detectHazard: vi.fn(),
  interactWithHazard: vi.fn(),
  applyHazardEffects: vi.fn(),
  hazardManager: {
    detectHazard: vi.fn(),
    interactWithHazard: vi.fn(),
    applyHazardEffects: vi.fn(),
    calculateHazardDamage: vi.fn(),
    checkImmunities: vi.fn(),
  },
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('useEnvironmentalHazards hook', () => {
  const mockCharacter: any = {
    id: 'char-1',
    name: 'Test Hero',
  };

  const mockHazard: any = {
    id: 'hazard-1',
    name: 'Acid Pool',
    type: 'acid_pool',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should start with empty state', () => {
    const { result } = renderHook(() => useEnvironmentalHazards(mockCharacter));
    expect(result.current.activeHazards).toEqual([]);
    expect(result.current.hazardInteractions).toEqual([]);
    expect(result.current.isProcessing).toBe(false);
  });

  it('should add a hazard', () => {
    const { result } = renderHook(() => useEnvironmentalHazards(mockCharacter));

    act(() => {
      result.current.addHazard(mockHazard);
    });

    expect(result.current.activeHazards).toHaveLength(1);
    expect(result.current.activeHazards[0]).toEqual(mockHazard);
  });

  it('should not add duplicate hazards', () => {
    const { result } = renderHook(() => useEnvironmentalHazards(mockCharacter));

    act(() => {
      result.current.addHazard(mockHazard);
      result.current.addHazard(mockHazard);
    });

    expect(result.current.activeHazards).toHaveLength(1);
  });

  it('should remove a hazard', () => {
    const { result } = renderHook(() => useEnvironmentalHazards(mockCharacter));

    act(() => {
      result.current.addHazard(mockHazard);
      result.current.removeHazard(mockHazard.id);
    });

    expect(result.current.activeHazards).toHaveLength(0);
  });

  it('should detect a hazard', async () => {
    const { result } = renderHook(() => useEnvironmentalHazards(mockCharacter));
    const detectionResult = { detected: true, description: 'You found it!' };
    (hazardUtils.detectHazard as any).mockReturnValue(detectionResult);

    act(() => {
      result.current.addHazard(mockHazard);
    });

    let returnedResult;
    await act(async () => {
      returnedResult = await result.current.detectHazardById(mockHazard.id);
    });

    expect(returnedResult).toEqual(detectionResult);
    expect(hazardUtils.detectHazard).toHaveBeenCalledWith(mockCharacter, mockHazard);
    expect(result.current.getHazardInteractionStatus(mockHazard.id).detected).toBe(true);
  });

  it('should handle detection for non-existent hazard', async () => {
    const { result } = renderHook(() => useEnvironmentalHazards(mockCharacter));

    let returnedResult: any;
    await act(async () => {
      returnedResult = await result.current.detectHazardById('unknown');
    });

    expect(returnedResult.detected).toBe(false);
    expect(returnedResult.description).toBe('Hazard not found.');
  });

  it('should trigger a hazard', async () => {
    const { result } = renderHook(() => useEnvironmentalHazards(mockCharacter));
    const saveResult = { saved: false, damageTaken: 10 };
    (hazardUtils.interactWithHazard as any).mockReturnValue(saveResult);

    act(() => {
      result.current.addHazard(mockHazard);
    });

    let returnedResult;
    await act(async () => {
      returnedResult = await result.current.triggerHazard(mockHazard.id);
    });

    expect(returnedResult).toEqual(saveResult);
    expect(hazardUtils.interactWithHazard).toHaveBeenCalledWith(mockCharacter, mockHazard);
    expect(result.current.getHazardInteractionStatus(mockHazard.id).triggered).toBe(true);
    expect(result.current.getHazardInteractionStatus(mockHazard.id).saveResult).toEqual(saveResult);
  });

  it('should apply hazard effects to character', () => {
    const { result } = renderHook(() => useEnvironmentalHazards(mockCharacter));
    const saveResult = { saved: false, damageTaken: 10 };
    const updatedChar = { ...mockCharacter, hitPoints: { current: 10 } };
    (hazardUtils.applyHazardEffects as any).mockReturnValue(updatedChar);

    act(() => {
      result.current.addHazard(mockHazard);
    });

    const returnedChar = result.current.applyHazardEffectsToCharacter(mockHazard.id, saveResult);

    expect(returnedChar).toEqual(updatedChar);
    expect(hazardUtils.applyHazardEffects).toHaveBeenCalledWith(
      mockCharacter,
      mockHazard,
      saveResult,
    );
  });

  it('should return character unchanged if hazard not found in applyHazardEffectsToCharacter', () => {
    const { result } = renderHook(() => useEnvironmentalHazards(mockCharacter));
    const saveResult = { saved: false, damageTaken: 10 };

    const returnedChar = result.current.applyHazardEffectsToCharacter('unknown', saveResult);
    expect(returnedChar).toEqual(mockCharacter);
  });

  it('should handle missing character id in interactions', async () => {
    const charWithoutId = { name: 'No ID' };
    const { result } = renderHook(() => useEnvironmentalHazards(charWithoutId as any));
    (hazardUtils.detectHazard as any).mockReturnValue({ detected: true });

    act(() => {
      result.current.addHazard(mockHazard);
    });

    await act(async () => {
      await result.current.detectHazardById(mockHazard.id);
    });

    expect(result.current.hazardInteractions[0].characterId).toBe('');
  });

  it('should clear all interactions', async () => {
    const { result } = renderHook(() => useEnvironmentalHazards(mockCharacter));
    (hazardUtils.detectHazard as any).mockReturnValue({ detected: true });

    act(() => {
      result.current.addHazard(mockHazard);
    });

    await act(async () => {
      await result.current.detectHazardById(mockHazard.id);
    });

    expect(result.current.hazardInteractions).toHaveLength(1);

    act(() => {
      result.current.clearInteractions();
    });

    expect(result.current.hazardInteractions).toHaveLength(0);
  });

  it('should return detected but not triggered hazards', async () => {
    const { result } = renderHook(() => useEnvironmentalHazards(mockCharacter));
    (hazardUtils.detectHazard as any).mockReturnValue({ detected: true });

    act(() => {
      result.current.addHazard(mockHazard);
    });

    await act(async () => {
      await result.current.detectHazardById(mockHazard.id);
    });

    const detected = result.current.getDetectedHazards();
    expect(detected).toHaveLength(1);
    expect(detected[0].id).toBe(mockHazard.id);
  });

  it('should handle errors in detectHazardById', async () => {
    const { result } = renderHook(() => useEnvironmentalHazards(mockCharacter));
    (hazardUtils.detectHazard as any).mockImplementation(() => {
      throw new Error('Test Error');
    });

    act(() => {
      result.current.addHazard(mockHazard);
    });

    let returnedResult: any;
    await act(async () => {
      returnedResult = await result.current.detectHazardById(mockHazard.id);
    });

    expect(returnedResult.detected).toBe(false);
    expect(returnedResult.description).toBe('Error detecting hazard.');
  });

  it('should handle errors in triggerHazard', async () => {
    const { result } = renderHook(() => useEnvironmentalHazards(mockCharacter));
    (hazardUtils.interactWithHazard as any).mockImplementation(() => {
      throw new Error('Test Error');
    });

    act(() => {
      result.current.addHazard(mockHazard);
    });

    let returnedResult: any;
    await act(async () => {
      returnedResult = await result.current.triggerHazard(mockHazard.id);
    });

    expect(returnedResult.saved).toBe(false);
    expect(returnedResult.description).toBe('Error triggering hazard.');
  });
});
