/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useCombatAIIntegration } from '../use-combat-ai-integration';

// Use vi.hoisted for variables used in vi.mock
const { mockEndCombat, mockCallEdgeFunction, mockLogger } = vi.hoisted(() => ({
  mockEndCombat: vi.fn().mockResolvedValue(undefined),
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
    endCombat: mockEndCombat,
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
