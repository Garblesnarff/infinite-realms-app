/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies BEFORE importing the module under test
vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: vi.fn(),
}));

vi.mock('@/contexts/CombatContext', () => ({
  useCombat: vi.fn(),
}));

vi.mock('@/hooks/use-combat-ai-integration', () => ({
  useCombatAIIntegration: vi.fn(),
}));

vi.mock('@/hooks/use-combat-mechanics', () => ({
  useCombatMechanics: vi.fn(() => ({
    showAdvantageModal: false,
    setShowAdvantageModal: vi.fn(),
    pendingAttack: null,
    setPendingAttack: vi.fn(),
    handleEnhancedAttack: vi.fn(),
    handleRacialTraitUse: vi.fn(),
    handleClassFeature: vi.fn(),
    handleDeathSave: vi.fn(),
    handleConcentrationSave: vi.fn(),
    handleTwoWeaponAttack: vi.fn(),
  })),
}));

vi.mock('@/hooks/use-game-session', () => ({
  useGameSession: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/utils/reactionSystem', () => ({
  processReactionResponse: vi.fn(),
}));

vi.mock('@/utils/spell-management', () => ({
  checkConcentration: vi.fn(),
}));

import { useCombatActions } from '../use-combat-actions';

import { useCharacter } from '@/contexts/CharacterContext';
import { useCombat } from '@/contexts/CombatContext';
import { useCombatAIIntegration } from '@/hooks/use-combat-ai-integration';
import { useGameSession } from '@/hooks/use-game-session';
import { processReactionResponse } from '@/utils/reactionSystem';
import { checkConcentration } from '@/utils/spell-management';

describe('useCombatActions', () => {
  const mockStartCombat = vi.fn();
  const mockEndCombat = vi.fn();
  const mockNextTurn = vi.fn();
  const mockTakeAction = vi.fn();
  const mockAddParticipant = vi.fn();
  const mockUpdateParticipant = vi.fn();
  const mockValidateCombatAction = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useCombat).mockReturnValue({
      state: {
        isInCombat: false,
        activeEncounter: null,
        showInitiativeTracker: false,
      },
      startCombat: mockStartCombat,
      endCombat: mockEndCombat,
      nextTurn: mockNextTurn,
      rollInitiative: vi.fn(),
      takeAction: mockTakeAction,
      addParticipant: mockAddParticipant,
      updateParticipant: mockUpdateParticipant,
    } as any);

    vi.mocked(useCharacter).mockReturnValue({
      state: {
        character: { id: 'player-1', name: 'Hero' },
      },
    } as any);

    vi.mocked(useGameSession).mockReturnValue({
      sessionId: 'session-123',
    } as any);

    vi.mocked(useCombatAIIntegration).mockReturnValue({
      validateCombatAction: mockValidateCombatAction,
    } as any);

    mockValidateCombatAction.mockResolvedValue({ isValid: true, suggestions: [], errors: [] });
    vi.mocked(checkConcentration).mockReturnValue(true);
  });

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useCombatActions());

    expect(result.current.isInCombat).toBe(false);
    expect(result.current.showCombatMode).toBe(false);
    expect(result.current.selectedEnemy).toBe(null);
  });

  describe('handleStartCombat', () => {
    it('should start combat when participants are present', async () => {
      vi.mocked(useCombat).mockReturnValue({
        state: {
          isInCombat: false,
          activeEncounter: {
            participants: [
              { id: 'p1', participantType: 'player', name: 'Hero', armorClass: 15, currentHitPoints: 20, maxHitPoints: 20 },
              { id: 'm1', participantType: 'monster', name: 'Goblin', armorClass: 12, currentHitPoints: 7, maxHitPoints: 7 },
            ],
          },
        },
        startCombat: mockStartCombat,
      } as any);

      const { result } = renderHook(() => useCombatActions());

      await act(async () => {
        await result.current.handleStartCombat();
      });

      expect(mockStartCombat).toHaveBeenCalled();
      expect(result.current.showCombatMode).toBe(true);
    });

    it('should not start combat if already starting', async () => {
      const { result } = renderHook(() => useCombatActions());

      // Simulate no participants
      await act(async () => {
        await result.current.handleStartCombat();
      });

      expect(mockStartCombat).not.toHaveBeenCalled();
    });

    it('should not start combat if no player participants', async () => {
      vi.mocked(useCombat).mockReturnValue({
        state: {
          isInCombat: false,
          activeEncounter: {
            participants: [
              { id: 'm1', participantType: 'monster', name: 'Goblin' },
            ],
          },
        },
        startCombat: mockStartCombat,
      } as any);

      const { result } = renderHook(() => useCombatActions());

      await act(async () => {
        await result.current.handleStartCombat();
      });

      expect(mockStartCombat).not.toHaveBeenCalled();
    });
  });

  describe('handleEndCombat', () => {
    it('should end combat and reset state', async () => {
      const { result } = renderHook(() => useCombatActions());

      await act(async () => {
        await result.current.handleEndCombat();
      });

      expect(mockEndCombat).toHaveBeenCalled();
      expect(result.current.showCombatMode).toBe(false);
      expect(result.current.selectedEnemy).toBe(null);
    });
  });

  describe('handleApplyDamage', () => {
    const activeEncounter = {
      id: 'enc-1',
      participants: [
        {
          id: 'p1',
          name: 'Hero',
          currentHitPoints: 20,
          maxHitPoints: 20,
          activeConcentration: 'Bless'
        },
      ],
    };

    beforeEach(() => {
      vi.mocked(useCombat).mockReturnValue({
        state: { activeEncounter, isInCombat: true },
        updateParticipant: mockUpdateParticipant,
        takeAction: mockTakeAction,
      } as any);
    });

    it('should apply damage and update participant', async () => {
      const { result } = renderHook(() => useCombatActions());

      await act(async () => {
        await result.current.handleApplyDamage('p1', 5, 'slashing');
      });

      expect(mockUpdateParticipant).toHaveBeenCalledWith('p1', {
        currentHitPoints: 15,
        isUnconscious: false,
      });
      expect(mockTakeAction).toHaveBeenCalledWith(expect.objectContaining({
        damageDealt: 5,
        actionType: 'damage_dealt',
      }));
    });

    it('should set isUnconscious to true when HP reaches 0', async () => {
      const { result } = renderHook(() => useCombatActions());

      await act(async () => {
        await result.current.handleApplyDamage('p1', 25, 'fire');
      });

      expect(mockUpdateParticipant).toHaveBeenCalledWith('p1', expect.objectContaining({
        currentHitPoints: 0,
        isUnconscious: true,
      }));
    });

    it('should break concentration if check fails', async () => {
      vi.mocked(checkConcentration).mockReturnValue(false);
      const { result } = renderHook(() => useCombatActions());

      await act(async () => {
        await result.current.handleApplyDamage('p1', 10, 'necrotic');
      });

      expect(mockUpdateParticipant).toHaveBeenCalledWith('p1', expect.objectContaining({
        activeConcentration: null,
      }));
    });

    it('should reset death saves when dropping to 0 HP from > 0', async () => {
      const { result } = renderHook(() => useCombatActions());

      await act(async () => {
        await result.current.handleApplyDamage('p1', 20, 'bludgeoning');
      });

      expect(mockUpdateParticipant).toHaveBeenCalledWith('p1', expect.objectContaining({
        isStable: false,
        deathSaves: { successes: 0, failures: 0 },
      }));
    });

    it('should not update if participant not found', async () => {
      const { result } = renderHook(() => useCombatActions());

      await act(async () => {
        await result.current.handleApplyDamage('non-existent', 5, 'fire');
      });

      expect(mockUpdateParticipant).not.toHaveBeenCalled();
    });

    it('should not update if no active encounter', async () => {
      vi.mocked(useCombat).mockReturnValue({
        state: { activeEncounter: null, isInCombat: false },
        updateParticipant: mockUpdateParticipant,
      } as any);

      const { result } = renderHook(() => useCombatActions());

      await act(async () => {
        await result.current.handleApplyDamage('p1', 5, 'fire');
      });

      expect(mockUpdateParticipant).not.toHaveBeenCalled();
    });

    it('should handle damage when NOT concentrating', async () => {
      vi.mocked(useCombat).mockReturnValue({
        state: {
          activeEncounter: {
            participants: [{ id: 'p1', currentHitPoints: 20, activeConcentration: null }]
          },
          isInCombat: true
        },
        updateParticipant: mockUpdateParticipant,
        takeAction: mockTakeAction,
      } as any);

      const { result } = renderHook(() => useCombatActions());

      await act(async () => {
        await result.current.handleApplyDamage('p1', 5, 'fire');
      });

      expect(mockUpdateParticipant).toHaveBeenCalledWith('p1', expect.objectContaining({
        currentHitPoints: 15
      }));
      expect(mockUpdateParticipant).not.toHaveBeenCalledWith('p1', expect.objectContaining({
        activeConcentration: null
      }));
    });
  });

  describe('handleHealing', () => {
    const activeEncounter = {
      id: 'enc-1',
      participants: [
        { id: 'p1', name: 'Hero', currentHitPoints: 0, maxHitPoints: 20 },
      ],
    };

    beforeEach(() => {
      vi.mocked(useCombat).mockReturnValue({
        state: { activeEncounter, isInCombat: true },
        updateParticipant: mockUpdateParticipant,
        takeAction: mockTakeAction,
      } as any);
    });

    it('should heal and potentially revive participant', async () => {
      const { result } = renderHook(() => useCombatActions());

      await act(async () => {
        await result.current.handleHealing('p1', 10);
      });

      expect(mockUpdateParticipant).toHaveBeenCalledWith('p1', {
        currentHitPoints: 10,
        isUnconscious: false,
      });
      expect(mockTakeAction).toHaveBeenCalledWith(expect.objectContaining({
        actionType: 'heal',
        effects: expect.objectContaining({ revivedFromUnconscious: true }),
      }));
    });

    it('should heal without reviving if already conscious', async () => {
      vi.mocked(useCombat).mockReturnValue({
        state: {
          activeEncounter: {
            participants: [{ id: 'p1', currentHitPoints: 10, maxHitPoints: 20 }]
          },
          isInCombat: true
        },
        updateParticipant: mockUpdateParticipant,
        takeAction: mockTakeAction,
      } as any);

      const { result } = renderHook(() => useCombatActions());

      await act(async () => {
        await result.current.handleHealing('p1', 5);
      });

      expect(mockUpdateParticipant).toHaveBeenCalledWith('p1', {
        currentHitPoints: 15,
        isUnconscious: false,
      });
      expect(mockTakeAction).toHaveBeenCalledWith(expect.objectContaining({
        effects: expect.objectContaining({ revivedFromUnconscious: false }),
      }));
    });
  });

  describe('handleCombatAction', () => {
    const activeEncounter = {
      id: 'enc-1',
      participants: [{ id: 'p1', name: 'Hero' }],
    };

    beforeEach(() => {
      vi.mocked(useCombat).mockReturnValue({
        state: { activeEncounter, isInCombat: true },
        takeAction: mockTakeAction,
      } as any);
    });

    it('should execute action if validation passes', async () => {
      const { result } = renderHook(() => useCombatActions());

      await act(async () => {
        await result.current.handleCombatAction('attack', 'p1', 'target-1');
      });

      expect(mockValidateCombatAction).toHaveBeenCalled();
      expect(mockTakeAction).toHaveBeenCalled();
    });

    it('should not execute action if validation fails', async () => {
      mockValidateCombatAction.mockResolvedValue({ isValid: false, suggestions: [], errors: ['No movement left'] });
      const { result } = renderHook(() => useCombatActions());

      await act(async () => {
        await result.current.handleCombatAction('attack', 'p1', 'target-1');
      });

      expect(mockTakeAction).not.toHaveBeenCalled();
      expect(result.current.actionValidation?.isValid).toBe(false);
    });

    it('should not execute if participant not found', async () => {
      const { result } = renderHook(() => useCombatActions());

      await act(async () => {
        await result.current.handleCombatAction('attack', 'non-existent', 'target-1');
      });

      expect(mockTakeAction).not.toHaveBeenCalled();
    });

    it('should not execute if no active encounter', async () => {
      vi.mocked(useCombat).mockReturnValue({
        state: { activeEncounter: null, isInCombat: false },
        takeAction: mockTakeAction,
      } as any);

      const { result } = renderHook(() => useCombatActions());

      await act(async () => {
        await result.current.handleCombatAction('attack', 'p1', 'target-1');
      });

      expect(mockTakeAction).not.toHaveBeenCalled();
    });

    it('should proceed with action if validation throws', async () => {
      mockValidateCombatAction.mockRejectedValue(new Error('Validation failed'));
      const { result } = renderHook(() => useCombatActions());

      await act(async () => {
        await result.current.handleCombatAction('attack', 'p1', 'target-1');
      });

      expect(mockTakeAction).toHaveBeenCalled();
    });
  });

  describe('handleReactionOpportunity', () => {
    const activeEncounter = {
      id: 'enc-1',
      participants: [{ id: 'p1', name: 'Hero' }],
    };

    beforeEach(() => {
      vi.mocked(useCombat).mockReturnValue({
        state: { activeEncounter, isInCombat: true },
        takeAction: mockTakeAction,
        updateParticipant: mockUpdateParticipant,
      } as any);

      vi.mocked(processReactionResponse).mockReturnValue({ actionType: 'reaction' } as any);
    });

    it('should process and take reaction action', async () => {
      const { result } = renderHook(() => useCombatActions());
      const opportunity = { id: 'opp-1', participantId: 'p1' } as any;

      await act(async () => {
        await result.current.handleReactionOpportunity(opportunity, 'attack' as any);
      });

      expect(processReactionResponse).toHaveBeenCalled();
      expect(mockTakeAction).toHaveBeenCalled();
      expect(mockUpdateParticipant).toHaveBeenCalledWith('p1', { reactionTaken: true });
    });

    it('should handle errors during reaction processing', async () => {
      vi.mocked(processReactionResponse).mockImplementation(() => {
        throw new Error('Reaction error');
      });
      const { result } = renderHook(() => useCombatActions());
      const opportunity = { id: 'opp-1', participantId: 'p1' } as any;

      await act(async () => {
        await result.current.handleReactionOpportunity(opportunity, 'attack' as any);
      });

      // Should not crash and should log error
      expect(mockTakeAction).not.toHaveBeenCalled();
    });
  });

  describe('handleEnemyAttack', () => {
    const activeEncounter = {
      id: 'enc-1',
      currentTurnParticipantId: 'p1',
      participants: [
        { id: 'p1', name: 'Hero' },
        { id: 'enemy-1', name: 'Goblin' },
      ],
    };

    beforeEach(() => {
      vi.useFakeTimers();
      vi.mocked(useCombat).mockReturnValue({
        state: { activeEncounter, isInCombat: true },
        takeAction: mockTakeAction,
        nextTurn: mockNextTurn,
      } as any);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should execute enemy attack and advance turn', async () => {
      const { result } = renderHook(() => useCombatActions());

      act(() => {
        result.current.setSelectedEnemy('enemy-1');
      });

      await act(async () => {
        await result.current.handleEnemyAttack({ name: 'Scimitar', attackBonus: 4, damageRoll: '1d6+2' });
      });

      expect(mockTakeAction).toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(1500);
      });

      expect(mockNextTurn).toHaveBeenCalled();
    });

    it('should execute enemy attack without damage roll', async () => {
      const { result } = renderHook(() => useCombatActions());

      act(() => {
        result.current.setSelectedEnemy('enemy-1');
      });

      await act(async () => {
        await result.current.handleEnemyAttack({ name: 'Glare', attackBonus: 4 });
      });

      expect(mockTakeAction).toHaveBeenCalled();
    });
  });

  describe('addEnemy', () => {
    it('should add a new goblin participant', () => {
      const { result } = renderHook(() => useCombatActions());

      act(() => {
        result.current.addEnemy();
      });

      expect(mockAddParticipant).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Goblin',
        participantType: 'monster',
      }));
    });
  });
});
