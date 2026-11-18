/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies BEFORE importing the module under test
vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: vi.fn(),
}));

vi.mock('@/contexts/CombatContext', () => ({
  useCombat: vi.fn(),
}));

vi.mock('@/services/combat/combat-action-executor', () => ({
  executeAuthoritativeCombatIntent: vi.fn().mockResolvedValue(undefined),
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
    handleClassFeature: vi.fn(),
    handleDeathSave: vi.fn(),
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

vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    applyCharacterDamage: vi.fn().mockResolvedValue({}),
    applyCharacterHealing: vi.fn().mockResolvedValue({}),
  },
}));

import { useCombatActions } from '../use-combat-actions';

import { useCharacter } from '@/contexts/CharacterContext';
import { useCombat } from '@/contexts/CombatContext';
import { useCombatAIIntegration } from '@/hooks/use-combat-ai-integration';
import { useGameSession } from '@/hooks/use-game-session';
import { executeAuthoritativeCombatIntent } from '@/services/combat/combat-action-executor';
import { userDataApi } from '@/services/user-data-api';

describe('useCombatActions', () => {
  const mockEndCombat = vi.fn();
  const mockNextTurn = vi.fn();
  const mockTakeAction = vi.fn();
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
      endCombat: mockEndCombat,
      nextTurn: mockNextTurn,
      takeAction: mockTakeAction,
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
  });

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useCombatActions());

    expect(result.current.isInCombat).toBe(false);
    expect(result.current.showCombatMode).toBe(false);
    expect(result.current.selectedEnemy).toBe(null);
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

  const playerEncounter = {
    id: 'enc-1',
    participants: [
      {
        id: 'p1',
        name: 'Hero',
        characterId: 'character-1',
        currentHitPoints: 20,
        maxHitPoints: 20,
      },
    ],
  };

  describe('handleApplyDamage (#621 Part B2a: the server applies damage)', () => {
    it('sends the damage to the character damage route, with no local HP write', async () => {
      vi.mocked(useCombat).mockReturnValue({
        state: { activeEncounter: playerEncounter, isInCombat: true },
        updateParticipant: mockUpdateParticipant,
        takeAction: mockTakeAction,
      } as any);
      const { result } = renderHook(() => useCombatActions());

      await act(async () => {
        await result.current.handleApplyDamage('p1', 5, 'slashing');
      });

      expect(userDataApi.applyCharacterDamage).toHaveBeenCalledWith('character-1', 5, 'slashing');
      expect(mockUpdateParticipant).not.toHaveBeenCalled();
      expect(mockTakeAction).not.toHaveBeenCalled();
    });

    it('does nothing for a participant with no character: no server route, no local write', async () => {
      vi.mocked(useCombat).mockReturnValue({
        state: {
          activeEncounter: {
            id: 'enc-1',
            participants: [{ id: 'p1', name: 'Hero', currentHitPoints: 20, maxHitPoints: 20 }],
          },
          isInCombat: true,
        },
        updateParticipant: mockUpdateParticipant,
        takeAction: mockTakeAction,
      } as any);
      const { result } = renderHook(() => useCombatActions());

      await act(async () => {
        await result.current.handleApplyDamage('p1', 5, 'slashing');
      });

      expect(userDataApi.applyCharacterDamage).not.toHaveBeenCalled();
      expect(mockUpdateParticipant).not.toHaveBeenCalled();
    });
  });

  describe('handleHealing (#621 Part B2a: the server applies healing)', () => {
    it('sends the heal to the character heal route, with no local HP write', async () => {
      vi.mocked(useCombat).mockReturnValue({
        state: { activeEncounter: playerEncounter, isInCombat: true },
        updateParticipant: mockUpdateParticipant,
        takeAction: mockTakeAction,
      } as any);
      const { result } = renderHook(() => useCombatActions());

      await act(async () => {
        await result.current.handleHealing('p1', 5);
      });

      expect(userDataApi.applyCharacterHealing).toHaveBeenCalledWith('character-1', 5);
      expect(mockUpdateParticipant).not.toHaveBeenCalled();
      expect(mockTakeAction).not.toHaveBeenCalled();
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
        await result.current.handleEnemyAttack({
          name: 'Scimitar',
          attackBonus: 4,
          damageRoll: '1d6+2',
        } as any);
      });

      // #621 B2b: the server rolls the enemy's attack; the browser sends the intent and no roll.
      expect(executeAuthoritativeCombatIntent).toHaveBeenCalledWith(
        'enc-1',
        { type: 'attack', actorId: 'enemy-1', targetId: 'p1' },
        'dm',
        expect.any(Number),
        'typed',
      );
      expect(mockTakeAction).not.toHaveBeenCalled();

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
        await result.current.handleEnemyAttack({ name: 'Glare', attackBonus: 4 } as any);
      });

      expect(executeAuthoritativeCombatIntent).toHaveBeenCalledWith(
        'enc-1',
        { type: 'attack', actorId: 'enemy-1', targetId: 'p1' },
        'dm',
        expect.any(Number),
        'typed',
      );
    });
  });
});
