/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies BEFORE importing the module under test
vi.mock('@/stores/useCombatStore', () => ({
  useCombatStore: vi.fn(),
  useParticipants: vi.fn(),
  useCurrentTurnParticipantId: vi.fn(),
  useIsInCombat: vi.fn(),
}));

vi.mock('@/stores/useBattleMapStore', () => ({
  useBattleMapStore: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { useCombatCanvasSync } from '../use-combat-canvas-sync';

import { useBattleMapStore } from '@/stores/useBattleMapStore';
import { useCombatStore, useParticipants, useCurrentTurnParticipantId } from '@/stores/useCombatStore';

describe('useCombatCanvasSync', () => {
  const mockUpdateParticipant = vi.fn();
  const mockSelectToken = vi.fn();
  const mockClearSelection = vi.fn();
  const mockOnTokenUpdate = vi.fn();
  const mockOnPositionSync = vi.fn();

  const mockTokens = [
    { id: 'token-1', combatantId: 'p1', characterId: 'char-1', x: 100, y: 100, bar1: {} },
    { id: 'token-2', combatantId: 'p2', characterId: 'char-2', x: 200, y: 200, bar1: {} },
  ];

  const mockParticipants = [
    {
      id: 'p1',
      characterId: 'char-1',
      name: 'Hero',
      currentHitPoints: 20,
      maxHitPoints: 20,
      conditions: [],
      position: { x: 100, y: 100 },
    },
    {
      id: 'p2',
      characterId: 'char-2',
      name: 'Goblin',
      currentHitPoints: 7,
      maxHitPoints: 7,
      conditions: [],
      position: { x: 200, y: 200 },
    },
  ];

  let currentCombatState = {
    isInCombat: true,
    updateParticipant: mockUpdateParticipant,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    currentCombatState = {
      isInCombat: true,
      updateParticipant: mockUpdateParticipant,
    };

    vi.mocked(useParticipants).mockReturnValue(mockParticipants as any);
    vi.mocked(useCurrentTurnParticipantId).mockReturnValue('p1');

    vi.mocked(useCombatStore).mockImplementation((selector: any) => {
      if (typeof selector === 'function') {
        return selector(currentCombatState);
      }
      return mockUpdateParticipant;
    });

    vi.mocked(useBattleMapStore).mockImplementation((selector: any) => {
      const state = {
        selectToken: mockSelectToken,
        clearSelection: mockClearSelection,
      };
      return selector(state);
    });
  });

  it('should find token for participant correctly', () => {
    const { result } = renderHook(() => useCombatCanvasSync(mockTokens as any));

    const token = result.current.findTokenForParticipant(mockParticipants[0] as any);
    expect(token?.id).toBe('token-1');

    const token2 = result.current.findTokenForParticipant({ id: 'non-existent' } as any);
    expect(token2).toBeUndefined();
  });

  it('should find participant for token correctly', () => {
    const { result } = renderHook(() => useCombatCanvasSync(mockTokens as any));

    const participant = result.current.findParticipantForToken(mockTokens[0] as any);
    expect(participant?.id).toBe('p1');

    const participant2 = result.current.findParticipantForToken({ id: 'non-existent' } as any);
    expect(participant2).toBeUndefined();
  });

  describe('syncParticipantToToken', () => {
    it('should update token HP and conditions', () => {
      const { result } = renderHook(() => useCombatCanvasSync(mockTokens as any, {
        onTokenUpdate: mockOnTokenUpdate,
        syncHealthBars: true,
        syncConditions: true,
      }));

      const participantWithCondition = {
        ...mockParticipants[0],
        currentHitPoints: 15,
        conditions: [{ name: 'Poisoned', description: 'Ouch', duration: '1 minute' }],
      };

      act(() => {
        result.current.syncParticipantToToken(participantWithCondition as any);
      });

      expect(mockOnTokenUpdate).toHaveBeenCalledWith('token-1', expect.objectContaining({
        bar1: { value: 15, max: 20, temp: undefined },
        conditions: ['Poisoned'],
      }));
    });

    it('should apply defeated state when HP is 0', () => {
      const { result } = renderHook(() => useCombatCanvasSync(mockTokens as any, {
        onTokenUpdate: mockOnTokenUpdate,
        showDefeatedState: true,
      }));

      const defeatedParticipant = {
        ...mockParticipants[1],
        currentHitPoints: 0,
      };

      act(() => {
        result.current.syncParticipantToToken(defeatedParticipant as any);
      });

      expect(mockOnTokenUpdate).toHaveBeenCalledWith('token-2', expect.objectContaining({
        alpha: 0.5,
        tint: '#666666',
      }));
    });

    it('should restore normal appearance when HP is > 0', () => {
      const tokensWithDefeatedState = [
        { ...mockTokens[0], alpha: 0.5, tint: '#666666' }
      ];
      const { result } = renderHook(() => useCombatCanvasSync(tokensWithDefeatedState as any, {
        onTokenUpdate: mockOnTokenUpdate,
      }));

      act(() => {
        result.current.syncParticipantToToken(mockParticipants[0] as any);
      });

      expect(mockOnTokenUpdate).toHaveBeenCalledWith('token-1', expect.objectContaining({
        alpha: 1,
        tint: undefined,
      }));
    });
  });

  describe('syncTokenToParticipant', () => {
    it('should update participant position when token moves', () => {
      const { result } = renderHook(() => useCombatCanvasSync(mockTokens as any, {
        onPositionSync: mockOnPositionSync,
      }));

      const movedToken = {
        ...mockTokens[0],
        x: 150,
        y: 150,
        sceneId: 'scene-1',
      };

      act(() => {
        result.current.syncTokenToParticipant(movedToken as any);
      });

      expect(mockOnPositionSync).toHaveBeenCalledWith('p1', { x: 150, y: 150 });
      expect(mockUpdateParticipant).toHaveBeenCalledWith('p1', expect.objectContaining({
        position: { x: 150, y: 150, sceneId: 'scene-1' }
      }));
    });

    it('should not update if position has not changed', () => {
      const { result } = renderHook(() => useCombatCanvasSync(mockTokens as any, {
        onPositionSync: mockOnPositionSync,
      }));

      act(() => {
        result.current.syncTokenToParticipant(mockTokens[0] as any);
      });

      expect(mockOnPositionSync).not.toHaveBeenCalled();
      expect(mockUpdateParticipant).not.toHaveBeenCalled();
    });
  });

  describe('Auto-selection', () => {
    it('should select token when turn starts', () => {
      vi.mocked(useCurrentTurnParticipantId).mockReturnValue('p1');

      renderHook(() => useCombatCanvasSync(mockTokens as any, {
        autoSelectOnTurn: true,
      }));

      expect(mockSelectToken).toHaveBeenCalledWith('token-1', false);
    });

    it('should not select token if autoSelectOnTurn is false', () => {
      vi.mocked(useCurrentTurnParticipantId).mockReturnValue('p1');

      renderHook(() => useCombatCanvasSync(mockTokens as any, {
        autoSelectOnTurn: false,
      }));

      expect(mockSelectToken).not.toHaveBeenCalled();
    });

    it('should select new token when turn changes', () => {
      let turnId = 'p1';
      vi.mocked(useCurrentTurnParticipantId).mockImplementation(() => turnId);

      const { rerender } = renderHook(() => useCombatCanvasSync(mockTokens as any));

      expect(mockSelectToken).toHaveBeenCalledWith('token-1', false);
      mockSelectToken.mockClear();

      // Change turn to p2
      turnId = 'p2';
      rerender();

      expect(mockSelectToken).toHaveBeenCalledWith('token-2', false);
    });
  });

  describe('Combat lifecycle', () => {
    it('should clear selection when combat ends', () => {
      currentCombatState.isInCombat = true;

      const { rerender } = renderHook(() => useCombatCanvasSync(mockTokens as any));

      currentCombatState.isInCombat = false;
      rerender();

      expect(mockClearSelection).toHaveBeenCalled();
    });

    it('should sync all participants when participants change during combat', () => {
      let participants = [mockParticipants[0]];
      vi.mocked(useParticipants).mockImplementation(() => participants as any);

      const { rerender } = renderHook(() => useCombatCanvasSync(mockTokens as any, {
        onTokenUpdate: mockOnTokenUpdate,
      }));

      // Initial sync (1 participant)
      expect(mockOnTokenUpdate).toHaveBeenCalledTimes(1);
      mockOnTokenUpdate.mockClear();

      // Add another participant
      participants = [...mockParticipants];
      rerender();

      // It should sync all (2 participants)
      expect(mockOnTokenUpdate).toHaveBeenCalledTimes(2);
    });
  });
});
