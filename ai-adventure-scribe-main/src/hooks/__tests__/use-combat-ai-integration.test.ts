/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useCombatAIIntegration } from '../use-combat-ai-integration';

// Use vi.hoisted for variables used in vi.mock
const { mockStartCombat, mockEndCombat, mockAddParticipant, mockCallEdgeFunction, mockLogger } =
  vi.hoisted(() => ({
    mockStartCombat: vi.fn().mockResolvedValue(undefined),
    mockEndCombat: vi.fn().mockResolvedValue(undefined),
    mockAddParticipant: vi.fn().mockResolvedValue(undefined),
    mockCallEdgeFunction: vi.fn(),
    mockLogger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
  }));

vi.mock('@/contexts/CombatContext', () => ({
  useCombat: vi.fn(() => ({
    state: {
      isInCombat: false,
      activeEncounter: {
        id: 'enc-123',
        currentRound: 1,
        actions: [],
        participants: [],
      },
    },
    startCombat: mockStartCombat,
    endCombat: mockEndCombat,
    addParticipant: mockAddParticipant,
  })),
}));

vi.mock('@/utils/diceUtils', () => ({
  rollDice: vi.fn(),
}));

vi.mock('@/utils/edgeFunctionHandler', () => ({
  callEdgeFunction: mockCallEdgeFunction,
}));

vi.mock('@/lib/logger', () => ({
  logger: mockLogger,
  default: mockLogger,
}));

describe('useCombatAIIntegration', () => {
  const sessionId = 'session-123';
  const characterId = 'char-123';
  const campaignId = 'camp-123';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe('createCombatActionRoll', () => {
    it('should cover all description and weapon branches', async () => {
      const { rollDice: mockRollDice } = await import('@/utils/diceUtils');
      const { result } = renderHook(() =>
        useCombatAIIntegration({ sessionId, characterId, campaignId }),
      );

      const scenarios = [
        { rollType: 'attack', results: [20], total: 25, actor: 'A', target: 'T', weapon: 'sword' },
        { rollType: 'attack', results: [15], total: 20, actor: 'A', target: 'T' },
        { rollType: 'attack', results: [2], total: 7, actor: 'A' },
        { rollType: 'damage', actor: 'A', target: 'T', weapon: 'mace' },
        { rollType: 'damage', actor: 'A' },
        { rollType: 'save', actor: 'A' },
        { rollType: 'skill', actor: 'A' },
        { rollType: 'unknown' },
      ];

      for (const s of scenarios) {
        (mockRollDice as any).mockReturnValue({ results: s.results || [10], total: s.total || 15 });
        await result.current.createCombatActionRoll(s as any);
      }
    });

    it('should test all specific weapons', async () => {
      const { result } = renderHook(() =>
        useCombatAIIntegration({ sessionId, characterId, campaignId }),
      );
      const weapons = ['sword', 'crossbow', 'bow', 'dagger', 'mace', 'claw', 'bite', 'other'];
      for (const w of weapons) {
        await result.current.createCombatActionRoll({
          rollType: 'damage',
          actor: 'A',
          weapon: w,
        } as any);
      }
    });
  });

  describe('processCombatEvent', () => {
    it('does not invoke the retired DM edge function', async () => {
      const { callEdgeFunction } = await import('@/utils/edgeFunctionHandler');
      const { result } = renderHook(() =>
        useCombatAIIntegration({ sessionId, characterId, campaignId }),
      );

      await result.current.processCombatEvent({ type: 'ROUND_START', roundNumber: 2 } as any);

      expect(callEdgeFunction).not.toHaveBeenCalled();
    });
  });

  describe('validateCombatAction', () => {
    it('keeps the supported rules compatibility call', async () => {
      const { result } = renderHook(() =>
        useCombatAIIntegration({ sessionId, characterId, campaignId }),
      );
      mockCallEdgeFunction.mockResolvedValue({
        isValid: false,
        suggestions: ['Use an action'],
        errors: ['Not enough movement'],
      });

      await expect(
        result.current.validateCombatAction({ actionType: 'attack' } as any, { name: 'H' } as any),
      ).resolves.toEqual({
        isValid: false,
        suggestions: ['Use an action'],
        errors: ['Not enough movement'],
      });
      expect(mockCallEdgeFunction).toHaveBeenCalledWith(
        'rules-interpreter-execute',
        expect.any(Object),
      );
    });
  });
});
