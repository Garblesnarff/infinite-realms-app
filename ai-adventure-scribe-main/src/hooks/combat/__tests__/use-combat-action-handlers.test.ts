/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useCombatActionHandlers } from '../use-combat-action-handlers';

import logger from '@/lib/logger';
import { processReactionResponse } from '@/utils/reactionSystem';
import { checkConcentration } from '@/utils/spell-management';

vi.mock('@/lib/logger', () => ({
  default: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/utils/reactionSystem', () => ({
  processReactionResponse: vi.fn(),
}));

vi.mock('@/utils/spell-management', () => ({
  checkConcentration: vi.fn(),
}));

describe('useCombatActionHandlers', () => {
  const mockTakeAction = vi.fn().mockResolvedValue(undefined);
  const mockUpdateParticipant = vi.fn().mockResolvedValue(undefined);
  const mockNextTurn = vi.fn().mockResolvedValue(undefined);
  const mockValidateCombatAction = vi.fn().mockResolvedValue({
    isValid: true,
    suggestions: [],
    errors: [],
  });

  const mockParticipant = {
    id: 'p1',
    name: 'Hero',
    currentHitPoints: 10,
    maxHitPoints: 20,
    isUnconscious: false,
    activeConcentration: null,
  };

  const mockEnemy = {
    id: 'e1',
    name: 'Orc',
    currentHitPoints: 15,
    maxHitPoints: 15,
    isUnconscious: false,
  };

  const mockEncounter = {
    id: 'enc-1',
    participants: [mockParticipant, mockEnemy],
    currentTurnParticipantId: 'p1',
  };

  const defaultProps = {
    activeEncounter: mockEncounter as any,
    takeAction: mockTakeAction,
    updateParticipant: mockUpdateParticipant,
    nextTurn: mockNextTurn,
    validateCombatAction: mockValidateCombatAction,
    selectedEnemy: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const setupHook = (props = defaultProps): ReturnType<typeof renderHook> => {
    return renderHook(() => useCombatActionHandlers(props));
  };

  it('should initialize with null validation and empty reactions', () => {
    const { result } = setupHook();
    expect(result.current.actionValidation).toBeNull();
    expect(result.current.reactionOpportunities).toEqual([]);
  });

  describe('handleCombatAction', () => {
    it('should do nothing if no active encounter', async () => {
      const { result } = setupHook({ ...defaultProps, activeEncounter: null });
      await act(async () => {
        await result.current.handleCombatAction('attack', 'p1');
      });
      expect(mockValidateCombatAction).not.toHaveBeenCalled();
    });

    it('should do nothing if participant not found', async () => {
      const { result } = setupHook();
      await act(async () => {
        await result.current.handleCombatAction('attack', 'non-existent');
      });
      expect(mockValidateCombatAction).not.toHaveBeenCalled();
    });

    it('should execute action if validation passes', async () => {
      const { result } = setupHook();
      await act(async () => {
        await result.current.handleCombatAction('attack', 'p1', 'e1');
      });

      expect(mockValidateCombatAction).toHaveBeenCalled();
      expect(mockTakeAction).toHaveBeenCalledWith(
        expect.objectContaining({
          participantId: 'p1',
          targetParticipantId: 'e1',
          actionType: 'attack',
        })
      );
      expect(result.current.actionValidation).toBeNull(); // Reset after success
    });

    it('should not execute action if validation fails', async () => {
      mockValidateCombatAction.mockResolvedValueOnce({
        isValid: false,
        suggestions: ['Try something else'],
        errors: ['Too far away'],
      });

      const { result } = setupHook();
      await act(async () => {
        await result.current.handleCombatAction('attack', 'p1', 'e1');
      });

      expect(mockValidateCombatAction).toHaveBeenCalled();
      expect(mockTakeAction).not.toHaveBeenCalled();
      expect(result.current.actionValidation?.isValid).toBe(false);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should proceed with action if validation throws', async () => {
      mockValidateCombatAction.mockRejectedValueOnce(new Error('Validation failed'));

      const { result } = setupHook();
      await act(async () => {
        await result.current.handleCombatAction('attack', 'p1', 'e1');
      });

      expect(logger.error).toHaveBeenCalled();
      expect(mockTakeAction).toHaveBeenCalled();
    });
  });

  describe('handleEnemyAttack', () => {
    it('should do nothing if no enemy selected', async () => {
      const { result } = setupHook();
      await act(async () => {
        await result.current.handleEnemyAttack({ name: 'Bite' });
      });
      expect(mockTakeAction).not.toHaveBeenCalled();
    });

    it('should do nothing if selected enemy not found in encounter', async () => {
        const { result } = setupHook({ ...defaultProps, selectedEnemy: 'non-existent' });
        await act(async () => {
          await result.current.handleEnemyAttack({ name: 'Bite' });
        });
        expect(mockTakeAction).not.toHaveBeenCalled();
      });

    it('should execute attack and advance turn', async () => {
      vi.useFakeTimers();
      const encounterWithoutTurn = { ...mockEncounter, currentTurnParticipantId: null };
      const { result } = setupHook({ ...defaultProps, selectedEnemy: 'e1', activeEncounter: encounterWithoutTurn as any });
      const attack = { name: 'Greataxe', attackBonus: 5, damageRoll: '1d12+3', damageType: 'slashing' };

      await act(async () => {
        await result.current.handleEnemyAttack(attack);
      });

      expect(mockTakeAction).toHaveBeenCalledWith(
        expect.objectContaining({
          participantId: 'e1',
          actionType: 'attack',
          damageType: 'slashing',
        })
      );

      // Verify turn advancement
      expect(mockNextTurn).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(mockNextTurn).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('should handle attack without damage roll', async () => {
        const { result } = setupHook({ ...defaultProps, selectedEnemy: 'e1' });
        const attack = { name: 'Gaze', attackBonus: 0 };

        await act(async () => {
          await result.current.handleEnemyAttack(attack);
        });

        expect(mockTakeAction).toHaveBeenCalledWith(
          expect.objectContaining({
            damageRolls: [],
          })
        );
      });
  });

  describe('handleReactionOpportunity', () => {
    it('should do nothing if no active encounter', async () => {
        const { result } = setupHook({ ...defaultProps, activeEncounter: null });
        await act(async () => {
          await result.current.handleReactionOpportunity({ id: 'opp-1' } as any, 'attack');
        });
        expect(mockTakeAction).not.toHaveBeenCalled();
      });

    it('should process reaction and update participant', async () => {
      const opportunity = { id: 'opp-1', participantId: 'p1', trigger: 'Opportunity Attack' };
      const reactionAction = { actionType: 'attack', participantId: 'p1' };
      (processReactionResponse as any).mockReturnValue(reactionAction);

      const { result } = setupHook();

      // Manually add opportunity to state for testing removal
      act(() => {
        result.current.setReactionOpportunities([opportunity as any]);
      });

      await act(async () => {
        await result.current.handleReactionOpportunity(opportunity as any, 'attack');
      });

      expect(processReactionResponse).toHaveBeenCalled();
      expect(mockTakeAction).toHaveBeenCalledWith(reactionAction);
      expect(mockUpdateParticipant).toHaveBeenCalledWith('p1', { reactionTaken: true });
      expect(result.current.reactionOpportunities).toEqual([]);
    });

    it('should handle errors in reaction processing', async () => {
      (processReactionResponse as any).mockImplementation(() => {
        throw new Error('Processing failed');
      });

      const { result } = setupHook();
      await act(async () => {
        await result.current.handleReactionOpportunity({ id: 'opp-1' } as any, 'attack');
      });

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('handleApplyDamage', () => {
    it('should do nothing if no active encounter', async () => {
      const { result } = setupHook({ ...defaultProps, activeEncounter: null });
      await act(async () => {
        await result.current.handleApplyDamage('p1', 5, 'fire');
      });
      expect(mockUpdateParticipant).not.toHaveBeenCalled();
    });

    it('should do nothing if participant not found', async () => {
      const { result } = setupHook();
      await act(async () => {
        await result.current.handleApplyDamage('non-existent', 5, 'fire');
      });
      expect(mockUpdateParticipant).not.toHaveBeenCalled();
    });

    it('should apply damage and update HP when HP is undefined', async () => {
      const participantWithoutHP = { ...mockParticipant, currentHitPoints: undefined };
      const encounter = { ...mockEncounter, participants: [participantWithoutHP, mockEnemy] };
      const { result } = setupHook({ ...defaultProps, activeEncounter: encounter as any });
      await act(async () => {
        await result.current.handleApplyDamage('p1', 5, 'fire');
      });

      // (participant.currentHitPoints || 0) is 0, so 0 - 5 = -5 -> Math.max(0, -5) = 0.
      // isUnconscious is true.
      // (participant.currentHitPoints || 0) > 0 is FALSE, so deathSaves NOT reset.
      expect(mockUpdateParticipant).toHaveBeenCalledWith('p1', {
        currentHitPoints: 0,
        isUnconscious: true,
      });
    });

    it('should handle damage when participant already has 0 HP', async () => {
        const participantWithZeroHP = { ...mockParticipant, currentHitPoints: 0 };
        const encounter = { ...mockEncounter, participants: [participantWithZeroHP, mockEnemy] };
        const { result } = setupHook({ ...defaultProps, activeEncounter: encounter as any });
        await act(async () => {
          await result.current.handleApplyDamage('p1', 5, 'fire');
        });

        // Should NOT trigger death save reset if already at 0
        expect(mockUpdateParticipant).not.toHaveBeenCalledWith('p1', expect.objectContaining({
            deathSaves: expect.anything(),
        }));
    });

    it('should apply damage and update HP normally', async () => {
      const { result } = setupHook();
      await act(async () => {
        await result.current.handleApplyDamage('p1', 5, 'fire');
      });

      expect(mockUpdateParticipant).toHaveBeenCalledWith('p1', {
        currentHitPoints: 5,
        isUnconscious: false,
      });
      expect(mockTakeAction).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'damage_dealt',
          damageDealt: 5,
        })
      );
    });

    it('should handle unconsciousness when HP reaches 0', async () => {
      const { result } = setupHook();
      await act(async () => {
        await result.current.handleApplyDamage('p1', 15, 'necrotic');
      });

      expect(mockUpdateParticipant).toHaveBeenCalledWith('p1', {
        currentHitPoints: 0,
        isUnconscious: true,
        isStable: false,
        deathSaves: { successes: 0, failures: 0 },
      });
    });

    it('should check concentration and handle loss', async () => {
      const participantWithConc = {
        ...mockParticipant,
        activeConcentration: { spellId: 'bless' },
      };
      const encounterWithConc = {
        ...mockEncounter,
        participants: [participantWithConc],
      };
      (checkConcentration as any).mockReturnValue(false); // Failed check

      const { result } = setupHook({ ...defaultProps, activeEncounter: encounterWithConc as any });
      await act(async () => {
        await result.current.handleApplyDamage('p1', 5, 'bludgeoning');
      });

      expect(checkConcentration).toHaveBeenCalled();
      expect(mockUpdateParticipant).toHaveBeenCalledWith('p1', expect.objectContaining({
        activeConcentration: null,
      }));
    });

    it('should maintain concentration if check succeeds', async () => {
        const participantWithConc = {
          ...mockParticipant,
          activeConcentration: { spellId: 'bless' },
        };
        const encounterWithConc = {
          ...mockEncounter,
          participants: [participantWithConc],
        };
        (checkConcentration as any).mockReturnValue(true); // Success

        const { result } = setupHook({ ...defaultProps, activeEncounter: encounterWithConc as any });
        await act(async () => {
          await result.current.handleApplyDamage('p1', 5, 'bludgeoning');
        });

        expect(mockUpdateParticipant).not.toHaveBeenCalledWith('p1', expect.objectContaining({
          activeConcentration: null,
        }));
      });
  });

  describe('handleHealing', () => {
    it('should do nothing if no active encounter', async () => {
      const { result } = setupHook({ ...defaultProps, activeEncounter: null });
      await act(async () => {
        await result.current.handleHealing('p1', 10);
      });
      expect(mockUpdateParticipant).not.toHaveBeenCalled();
    });

    it('should do nothing if participant not found', async () => {
      const { result } = setupHook();
      await act(async () => {
        await result.current.handleHealing('non-existent', 10);
      });
      expect(mockUpdateParticipant).not.toHaveBeenCalled();
    });

    it('should restore HP and cap at max', async () => {
      const participantWithoutMaxHP = { ...mockParticipant, maxHitPoints: undefined };
      const encounter = { ...mockEncounter, participants: [participantWithoutMaxHP, mockEnemy] };
      const { result } = setupHook({ ...defaultProps, activeEncounter: encounter as any });
      await act(async () => {
        await result.current.handleHealing('p1', 50);
      });

      expect(mockUpdateParticipant).toHaveBeenCalledWith('p1', {
        currentHitPoints: 1, // Fallback max HP
        isUnconscious: false,
      });
    });

    it('should restore HP and cap at max normally', async () => {
      const { result } = setupHook();
      await act(async () => {
        await result.current.handleHealing('p1', 50);
      });

      expect(mockUpdateParticipant).toHaveBeenCalledWith('p1', {
        currentHitPoints: 20, // Max HP
        isUnconscious: false,
      });
    });

    it('should revive unconscious participants', async () => {
      const unconsciousParticipant = {
        ...mockParticipant,
        currentHitPoints: 0,
        isUnconscious: true,
      };
      const encounter = {
        ...mockEncounter,
        participants: [unconsciousParticipant],
      };

      const { result } = setupHook({ ...defaultProps, activeEncounter: encounter as any });
      await act(async () => {
        await result.current.handleHealing('p1', 5);
      });

      expect(mockUpdateParticipant).toHaveBeenCalledWith('p1', {
        currentHitPoints: 5,
        isUnconscious: false,
      });
      expect(mockTakeAction).toHaveBeenCalledWith(
        expect.objectContaining({
            description: expect.stringContaining('regains consciousness'),
        })
      );
    });
  });
});
