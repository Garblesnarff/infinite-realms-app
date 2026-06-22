/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useCombatVitalityHandlers } from '../useCombatVitalityHandlers';

import { useCombat } from '@/contexts/CombatContext';
import { calculateProficiencyBonus } from '@/utils/character-calculations';
import { rollDeathSave, needsDeathSaves } from '@/utils/combat/deathSaves';
import { checkConcentration } from '@/utils/spell-management';

vi.mock('@/contexts/CombatContext', () => ({
  useCombat: vi.fn(),
}));

vi.mock('@/utils/character-calculations', () => ({
  calculateProficiencyBonus: vi.fn(),
}));

vi.mock('@/utils/combat/deathSaves', () => ({
  rollDeathSave: vi.fn(),
  needsDeathSaves: vi.fn(),
}));

vi.mock('@/utils/spell-management', () => ({
  checkConcentration: vi.fn(),
}));

describe('useCombatVitalityHandlers', () => {
  const mockTakeAction = vi.fn().mockResolvedValue(undefined);
  const mockUpdateParticipant = vi.fn().mockResolvedValue(undefined);

  const mockParticipant = {
    id: 'p1',
    name: 'Hero',
    currentHitPoints: 10,
    maxHitPoints: 20,
    level: 5,
    abilityScores: {
      constitution: { modifier: 2 },
    },
    activeConcentration: null,
  };

  const mockEncounter = {
    id: 'enc-1',
    participants: [mockParticipant],
  };

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useCombat).mockReturnValue({
      takeAction: mockTakeAction,
      updateParticipant: mockUpdateParticipant,
    } as any);

    // Mock Math.random to return 0.45, so Math.floor(0.45 * 20) + 1 = 10
    vi.spyOn(Math, 'random').mockReturnValue(0.45);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should initialize correctly', () => {
    const { result } = renderHook(() => useCombatVitalityHandlers({ activeEncounter: mockEncounter as any }));
    expect(result.current.handleDeathSave).toBeDefined();
    expect(result.current.handleConcentrationSave).toBeDefined();
    expect(result.current.handleApplyDamage).toBeDefined();
    expect(result.current.handleHealing).toBeDefined();
  });

  describe('handleDeathSave', () => {
    it('should return early if activeEncounter is null', async () => {
      const { result } = renderHook(() => useCombatVitalityHandlers({ activeEncounter: null }));
      await act(async () => {
        await result.current.handleDeathSave('p1');
      });
      expect(rollDeathSave).not.toHaveBeenCalled();
    });

    it('should return early if participant is not found', async () => {
      const { result } = renderHook(() => useCombatVitalityHandlers({ activeEncounter: mockEncounter as any }));
      await act(async () => {
        await result.current.handleDeathSave('non-existent');
      });
      expect(rollDeathSave).not.toHaveBeenCalled();
    });

    it('should return early if needsDeathSaves returns false', async () => {
      vi.mocked(needsDeathSaves).mockReturnValue(false);
      const { result } = renderHook(() => useCombatVitalityHandlers({ activeEncounter: mockEncounter as any }));
      await act(async () => {
        await result.current.handleDeathSave('p1');
      });
      expect(rollDeathSave).not.toHaveBeenCalled();
    });

    it('should roll death save and update participant/take action', async () => {
      vi.mocked(needsDeathSaves).mockReturnValue(true);
      const updatedParticipant = {
        ...mockParticipant,
        deathSaves: { successes: 1, failures: 0 },
        isStable: false,
        isDead: false,
        currentHitPoints: 0,
        isUnconscious: true,
      };
      const rollResult = { total: 15, critical: false };
      vi.mocked(rollDeathSave).mockReturnValue({ updatedParticipant, roll: rollResult } as any);

      const { result } = renderHook(() => useCombatVitalityHandlers({ activeEncounter: mockEncounter as any }));
      await act(async () => {
        await result.current.handleDeathSave('p1');
      });

      expect(rollDeathSave).toHaveBeenCalledWith(mockParticipant);
      expect(mockUpdateParticipant).toHaveBeenCalledWith('p1', {
        deathSaves: updatedParticipant.deathSaves,
        isStable: updatedParticipant.isStable,
        isDead: updatedParticipant.isDead,
        currentHitPoints: updatedParticipant.currentHitPoints,
        isUnconscious: updatedParticipant.isUnconscious,
      });
      expect(mockTakeAction).toHaveBeenCalledWith(expect.objectContaining({
        actionType: 'death_save',
        deathSaveResult: expect.objectContaining({
          roll: 15,
          result: 'success',
          successes: 1,
          failures: 0,
          isStable: false,
          isDead: false,
          isCritical: false,
        }),
      }));
    });

    it('should handle failed death save', async () => {
      vi.mocked(needsDeathSaves).mockReturnValue(true);
      const updatedParticipant = {
        ...mockParticipant,
        deathSaves: { successes: 0, failures: 1 },
        isStable: false,
        isDead: false,
        currentHitPoints: 0,
        isUnconscious: true,
      };
      const rollResult = { total: 5, critical: false };
      vi.mocked(rollDeathSave).mockReturnValue({ updatedParticipant, roll: rollResult } as any);

      const { result } = renderHook(() => useCombatVitalityHandlers({ activeEncounter: mockEncounter as any }));
      await act(async () => {
        await result.current.handleDeathSave('p1');
      });

      expect(mockTakeAction).toHaveBeenCalledWith(expect.objectContaining({
        deathSaveResult: expect.objectContaining({
          roll: 5,
          result: 'failure',
        }),
      }));
    });
  });

  describe('handleConcentrationSave', () => {
    it('should return early if activeEncounter is null', async () => {
      const { result } = renderHook(() => useCombatVitalityHandlers({ activeEncounter: null }));
      await act(async () => {
        await result.current.handleConcentrationSave('p1', 10);
      });
      expect(mockTakeAction).not.toHaveBeenCalled();
    });

    it('should return early if participant is not found', async () => {
      const { result } = renderHook(() => useCombatVitalityHandlers({ activeEncounter: mockEncounter as any }));
      await act(async () => {
        await result.current.handleConcentrationSave('non-existent', 10);
      });
      expect(mockTakeAction).not.toHaveBeenCalled();
    });

    it('should return early if participant has no active concentration', async () => {
      const { result } = renderHook(() => useCombatVitalityHandlers({ activeEncounter: mockEncounter as any }));
      await act(async () => {
        await result.current.handleConcentrationSave('p1', 10);
      });
      expect(mockTakeAction).not.toHaveBeenCalled();
    });

    it('should handle successful concentration save with full scores', async () => {
      const participantWithConc = { ...mockParticipant, activeConcentration: { name: 'Bless' } };
      const encounterWithConc = { ...mockEncounter, participants: [participantWithConc] };
      vi.mocked(calculateProficiencyBonus).mockReturnValue(3);
      // Roll = Math.floor(0.45 * 20) + 1 + 2 (con) + 3 (prof) = 10 + 5 = 15

      const { result } = renderHook(() => useCombatVitalityHandlers({ activeEncounter: encounterWithConc as any }));
      await act(async () => {
        await result.current.handleConcentrationSave('p1', 10);
      });

      expect(mockTakeAction).toHaveBeenCalledWith(expect.objectContaining({
        actionType: 'concentration_save',
        concentrationResult: expect.objectContaining({ succeeded: true, roll: 15, dc: 10, spellLost: false }),
      }));
      expect(participantWithConc.activeConcentration).not.toBeNull();
    });

    it('should handle successful concentration save with defaults (no ability scores or level)', async () => {
      const minimalParticipant = {
        id: 'p1',
        name: 'Hero',
        activeConcentration: { name: 'Bless' },
      };
      const encounter = { id: 'enc-1', participants: [minimalParticipant] };
      vi.mocked(calculateProficiencyBonus).mockReturnValue(2); // level 1 default
      // Roll = Math.floor(0.45 * 20) + 1 + 0 (con mod default) + 2 (prof) = 10 + 2 = 12

      const { result } = renderHook(() => useCombatVitalityHandlers({ activeEncounter: encounter as any }));
      await act(async () => {
        await result.current.handleConcentrationSave('p1', 10);
      });

      expect(calculateProficiencyBonus).toHaveBeenCalledWith(1);
      expect(mockTakeAction).toHaveBeenCalledWith(expect.objectContaining({
        concentrationResult: expect.objectContaining({ roll: 12 }),
      }));
    });

    it('should handle failed concentration save', async () => {
      const participantWithConc = { ...mockParticipant, activeConcentration: { name: 'Bless' } };
      const encounterWithConc = { ...mockEncounter, participants: [participantWithConc] };
      vi.mocked(calculateProficiencyBonus).mockReturnValue(3);
      // Roll = 15

      const { result } = renderHook(() => useCombatVitalityHandlers({ activeEncounter: encounterWithConc as any }));
      await act(async () => {
        await result.current.handleConcentrationSave('p1', 20);
      });

      expect(mockTakeAction).toHaveBeenCalledWith(expect.objectContaining({
        actionType: 'concentration_save',
        concentrationResult: expect.objectContaining({ succeeded: false, roll: 15, dc: 20, spellLost: true }),
      }));
      expect(participantWithConc.activeConcentration).toBeNull();
    });
  });

  describe('handleApplyDamage', () => {
    it('should return early if activeEncounter is null', async () => {
      const { result } = renderHook(() => useCombatVitalityHandlers({ activeEncounter: null }));
      await act(async () => {
        await result.current.handleApplyDamage('p1', 5, 'fire');
      });
      expect(mockUpdateParticipant).not.toHaveBeenCalled();
    });

    it('should return early if participant is not found', async () => {
      const { result } = renderHook(() => useCombatVitalityHandlers({ activeEncounter: mockEncounter as any }));
      await act(async () => {
        await result.current.handleApplyDamage('non-existent', 5, 'fire');
      });
      expect(mockUpdateParticipant).not.toHaveBeenCalled();
    });

    it('should apply damage and update participant HP', async () => {
      const { result } = renderHook(() => useCombatVitalityHandlers({ activeEncounter: mockEncounter as any }));
      await act(async () => {
        await result.current.handleApplyDamage('p1', 5, 'fire');
      });

      expect(mockUpdateParticipant).toHaveBeenCalledWith('p1', expect.objectContaining({
        currentHitPoints: 5,
        isUnconscious: false,
      }));
      expect(mockTakeAction).toHaveBeenCalledWith(expect.objectContaining({
        actionType: 'damage_dealt',
        damageDealt: 5,
        effects: expect.objectContaining({ newHitPoints: 5, unconscious: false, concentrationLost: false }),
      }));
    });

    it('should cap HP at 0 and set isUnconscious to true', async () => {
      const { result } = renderHook(() => useCombatVitalityHandlers({ activeEncounter: mockEncounter as any }));
      await act(async () => {
        await result.current.handleApplyDamage('p1', 15, 'cold');
      });

      expect(mockUpdateParticipant).toHaveBeenCalledWith('p1', expect.objectContaining({
        currentHitPoints: 0,
        isUnconscious: true,
      }));
    });

    it('should handle missing currentHitPoints as 0', async () => {
      const noHpParticipant = { id: 'p1', name: 'Hero' };
      const encounter = { id: 'enc-1', participants: [noHpParticipant] };
      const { result } = renderHook(() => useCombatVitalityHandlers({ activeEncounter: encounter as any }));
      await act(async () => {
        await result.current.handleApplyDamage('p1', 5, 'necrotic');
      });

      expect(mockUpdateParticipant).toHaveBeenCalledWith('p1', expect.objectContaining({
        currentHitPoints: 0,
      }));
    });

    it('should reset death saves when dropping to 0 HP from positive HP', async () => {
      const { result } = renderHook(() => useCombatVitalityHandlers({ activeEncounter: mockEncounter as any }));
      await act(async () => {
        await result.current.handleApplyDamage('p1', 10, 'acid');
      });

      expect(mockUpdateParticipant).toHaveBeenCalledWith('p1', expect.objectContaining({
        isStable: false,
        deathSaves: { successes: 0, failures: 0 },
      }));
    });

    it('should not reset death saves if already at 0 HP', async () => {
      const zeroHpParticipant = { ...mockParticipant, currentHitPoints: 0, isUnconscious: true };
      const encounter = { ...mockEncounter, participants: [zeroHpParticipant] };
      const { result } = renderHook(() => useCombatVitalityHandlers({ activeEncounter: encounter as any }));
      await act(async () => {
        await result.current.handleApplyDamage('p1', 5, 'fire');
      });

      expect(mockUpdateParticipant).toHaveBeenCalledWith('p1', {
        currentHitPoints: 0,
        isUnconscious: true,
      });
      // Should NOT have isStable and deathSaves in updates
      expect(mockUpdateParticipant).not.toHaveBeenCalledWith('p1', expect.objectContaining({
        isStable: expect.anything(),
        deathSaves: expect.anything(),
      }));
    });

    it('should check concentration and handle loss', async () => {
      const participantWithConc = { ...mockParticipant, activeConcentration: { name: 'Bless' } };
      const encounterWithConc = { ...mockEncounter, participants: [participantWithConc] };
      vi.mocked(checkConcentration).mockReturnValue(false);

      const { result } = renderHook(() => useCombatVitalityHandlers({ activeEncounter: encounterWithConc as any }));
      await act(async () => {
        await result.current.handleApplyDamage('p1', 5, 'fire');
      });

      expect(checkConcentration).toHaveBeenCalledWith(participantWithConc, 5);
      expect(mockUpdateParticipant).toHaveBeenCalledWith('p1', expect.objectContaining({
        activeConcentration: null,
      }));
    });

    it('should maintain concentration if check succeeds', async () => {
      const participantWithConc = { ...mockParticipant, activeConcentration: { name: 'Bless' } };
      const encounterWithConc = { ...mockEncounter, participants: [participantWithConc] };
      vi.mocked(checkConcentration).mockReturnValue(true);

      const { result } = renderHook(() => useCombatVitalityHandlers({ activeEncounter: encounterWithConc as any }));
      await act(async () => {
        await result.current.handleApplyDamage('p1', 5, 'fire');
      });

      expect(mockUpdateParticipant).not.toHaveBeenCalledWith('p1', expect.objectContaining({
        activeConcentration: null,
      }));
    });

    it('should not check concentration if damage is 0', async () => {
      const participantWithConc = { ...mockParticipant, activeConcentration: { name: 'Bless' } };
      const encounterWithConc = { ...mockEncounter, participants: [participantWithConc] };

      const { result } = renderHook(() => useCombatVitalityHandlers({ activeEncounter: encounterWithConc as any }));
      await act(async () => {
        await result.current.handleApplyDamage('p1', 0, 'fire');
      });

      expect(checkConcentration).not.toHaveBeenCalled();
    });
  });

  describe('handleHealing', () => {
    it('should return early if activeEncounter is null', async () => {
      const { result } = renderHook(() => useCombatVitalityHandlers({ activeEncounter: null }));
      await act(async () => {
        await result.current.handleHealing('p1', 10);
      });
      expect(mockUpdateParticipant).not.toHaveBeenCalled();
    });

    it('should return early if participant is not found', async () => {
      const { result } = renderHook(() => useCombatVitalityHandlers({ activeEncounter: mockEncounter as any }));
      await act(async () => {
        await result.current.handleHealing('non-existent', 10);
      });
      expect(mockUpdateParticipant).not.toHaveBeenCalled();
    });

    it('should apply healing and update participant HP', async () => {
      const { result } = renderHook(() => useCombatVitalityHandlers({ activeEncounter: mockEncounter as any }));
      await act(async () => {
        await result.current.handleHealing('p1', 5);
      });

      expect(mockUpdateParticipant).toHaveBeenCalledWith('p1', {
        currentHitPoints: 15,
        isUnconscious: false,
      });
    });

    it('should cap HP at maxHitPoints', async () => {
      const { result } = renderHook(() => useCombatVitalityHandlers({ activeEncounter: mockEncounter as any }));
      await act(async () => {
        await result.current.handleHealing('p1', 50);
      });

      expect(mockUpdateParticipant).toHaveBeenCalledWith('p1', {
        currentHitPoints: 20,
        isUnconscious: false,
      });
    });

    it('should handle missing currentHitPoints as 0', async () => {
      const noHpParticipant = { id: 'p1', name: 'Hero', maxHitPoints: 20 };
      const encounter = { id: 'enc-1', participants: [noHpParticipant] };
      const { result } = renderHook(() => useCombatVitalityHandlers({ activeEncounter: encounter as any }));
      await act(async () => {
        await result.current.handleHealing('p1', 5);
      });

      expect(mockUpdateParticipant).toHaveBeenCalledWith('p1', expect.objectContaining({
        currentHitPoints: 5,
      }));
    });

    it('should handle missing maxHitPoints by defaulting to 1', async () => {
      const participantWithoutMax = { ...mockParticipant, currentHitPoints: 0, maxHitPoints: undefined };
      const encounter = { ...mockEncounter, participants: [participantWithoutMax] };
      const { result } = renderHook(() => useCombatVitalityHandlers({ activeEncounter: encounter as any }));
      await act(async () => {
        await result.current.handleHealing('p1', 10);
      });

      expect(mockUpdateParticipant).toHaveBeenCalledWith('p1', {
        currentHitPoints: 1,
        isUnconscious: false,
      });
    });

    it('should revive participant from unconsciousness', async () => {
      const unconsciousParticipant = { ...mockParticipant, currentHitPoints: 0, isUnconscious: true };
      const encounter = { ...mockEncounter, participants: [unconsciousParticipant] };
      const { result } = renderHook(() => useCombatVitalityHandlers({ activeEncounter: encounter as any }));
      await act(async () => {
        await result.current.handleHealing('p1', 5);
      });

      expect(mockUpdateParticipant).toHaveBeenCalledWith('p1', {
        currentHitPoints: 5,
        isUnconscious: false,
      });
      expect(mockTakeAction).toHaveBeenCalledWith(expect.objectContaining({
        description: expect.stringContaining('regains consciousness'),
        effects: expect.objectContaining({ revivedFromUnconscious: true, newHitPoints: 5 }),
      }));
    });

    it('should not revive if new HP is still 0 or less', async () => {
      const unconsciousParticipant = { ...mockParticipant, currentHitPoints: -10, isUnconscious: true };
      const encounter = { ...mockEncounter, participants: [unconsciousParticipant] };
      const { result } = renderHook(() => useCombatVitalityHandlers({ activeEncounter: encounter as any }));
      await act(async () => {
        await result.current.handleHealing('p1', 5);
      });

      expect(mockUpdateParticipant).toHaveBeenCalledWith('p1', {
        currentHitPoints: -5,
        isUnconscious: true,
      });
      expect(mockTakeAction).toHaveBeenCalledWith(expect.objectContaining({
        effects: expect.objectContaining({ revivedFromUnconscious: false }),
      }));
    });
  });
});
