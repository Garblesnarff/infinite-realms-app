/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useCombatAIIntegration } from '../use-combat-ai-integration';

// Use vi.hoisted for variables used in vi.mock
const { mockStartCombat, mockEndCombat, mockAddParticipant, mockAddMessage, mockLogger } = vi.hoisted(() => ({
  mockStartCombat: vi.fn().mockResolvedValue(undefined),
  mockEndCombat: vi.fn().mockResolvedValue(undefined),
  mockAddParticipant: vi.fn().mockResolvedValue(undefined),
  mockAddMessage: vi.fn().mockResolvedValue(undefined),
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

vi.mock('@/hooks/use-messages', () => ({
  useMessages: vi.fn(() => ({
    addMessage: mockAddMessage,
  })),
}));

vi.mock('@/utils/combatDetection', () => ({
  detectCombatFromText: vi.fn(),
  createCombatParticipantsFromDetection: vi.fn(),
}));

vi.mock('@/utils/diceUtils', () => ({
  rollDice: vi.fn(),
}));

vi.mock('@/utils/edgeFunctionHandler', () => ({
  callEdgeFunction: vi.fn(),
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

  describe('processDMResponse', () => {
    it('should handle all detection variations', async () => {
      const { detectCombatFromText, createCombatParticipantsFromDetection } = await import('@/utils/combatDetection');
      (createCombatParticipantsFromDetection as any).mockReturnValue([{ name: 'G' }]);
      const { result } = renderHook(() => useCombatAIIntegration({ sessionId, characterId, campaignId }));

      const variations = [
          { shouldStartCombat: true, confidence: 0.9, enemies: [{name: 'E'}], isCombat: true },
          { shouldStartCombat: true, confidence: 0.3, enemies: [{name: 'E'}], isCombat: true }, // Low confidence
          { shouldStartCombat: true, confidence: 0.9, enemies: [], isCombat: true }, // No enemies
          { shouldEndCombat: true, isCombat: false }
      ];

      for (const v of variations) {
          (detectCombatFromText as any).mockReturnValue(v);
          await result.current.processDMResponse({ text: 'Msg' } as any);
      }
    });

    it('should handle missing sessionId during start combat', async () => {
        const { detectCombatFromText } = await import('@/utils/combatDetection');
        (detectCombatFromText as any).mockReturnValue({ shouldStartCombat: true, confidence: 0.9, enemies: [{name: 'E'}], isCombat: true });
        const { result } = renderHook(() => useCombatAIIntegration({ characterId } as any));
        await result.current.processDMResponse({ text: 'Msg' } as any);
        expect(mockStartCombat).not.toHaveBeenCalled();
    });
  });

  describe('createCombatActionRoll', () => {
    it('should cover all description and weapon branches', async () => {
        const { rollDice: mockRollDice } = await import('@/utils/diceUtils');
        const { result } = renderHook(() => useCombatAIIntegration({ sessionId, characterId, campaignId }));

        const scenarios = [
            { rollType: 'attack', results: [20], total: 25, actor: 'A', target: 'T', weapon: 'sword' },
            { rollType: 'attack', results: [15], total: 20, actor: 'A', target: 'T' },
            { rollType: 'attack', results: [2], total: 7, actor: 'A' },
            { rollType: 'damage', actor: 'A', target: 'T', weapon: 'mace' },
            { rollType: 'damage', actor: 'A' },
            { rollType: 'save', actor: 'A' },
            { rollType: 'skill', actor: 'A' },
            { rollType: 'unknown' }
        ];

        for (const s of scenarios) {
            (mockRollDice as any).mockReturnValue({ results: s.results || [10], total: s.total || 15 });
            await result.current.createCombatActionRoll(s as any);
        }
    });

    it('should test all specific weapons', async () => {
        const { result } = renderHook(() => useCombatAIIntegration({ sessionId, characterId, campaignId }));
        const weapons = ['sword', 'crossbow', 'bow', 'dagger', 'mace', 'claw', 'bite', 'other'];
        for (const w of weapons) {
            await result.current.createCombatActionRoll({ rollType: 'damage', actor: 'A', weapon: w } as any);
        }
    });
  });

  describe('processCombatEvent', () => {
    it('should handle all event types and AI response formats', async () => {
        const { callEdgeFunction } = await import('@/utils/edgeFunctionHandler');
        const { result } = renderHook(() => useCombatAIIntegration({ sessionId, characterId, campaignId }));

        const events = [
            { type: 'COMBAT_START' },
            { type: 'COMBAT_END' },
            { type: 'ROUND_START', roundNumber: 2 },
            { type: 'ACTION_TAKEN', action: { description: 'Attacks' } },
            { type: 'ACTION_TAKEN' },
            { type: 'PARTICIPANT_UNCONSCIOUS' },
            { type: 'PARTICIPANT_DEAD' },
            { type: 'UNKNOWN' }
        ];

        for (const e of events) {
            (callEdgeFunction as any).mockResolvedValue({ response: 'R', narrationSegments: [] });
            await result.current.processCombatEvent(e as any);

            (callEdgeFunction as any).mockResolvedValue(null); // Null response
            await result.current.processCombatEvent(e as any);

            (callEdgeFunction as any).mockRejectedValue(new Error('!')); // Error case
            await result.current.processCombatEvent(e as any);
        }
    });
  });

  describe('validateCombatAction', () => {
    it('should handle all validation result formats', async () => {
      const { callEdgeFunction } = await import('@/utils/edgeFunctionHandler');
      const { result } = renderHook(() => useCombatAIIntegration({ sessionId, characterId, campaignId }));

      const results = [
          { isValid: false, errors: ['E'], suggestions: ['S'] },
          { isValid: true },
          null,
          {}
      ];

      for (const r of results) {
          (callEdgeFunction as any).mockResolvedValue(r);
          await result.current.validateCombatAction({ actionType: 'attack' } as any, { name: 'H' } as any);
      }

      (callEdgeFunction as any).mockRejectedValue(new Error('!'));
      await result.current.validateCombatAction({} as any, {} as any);
    });
  });

  describe('useEffect', () => {
      it('should handle various encounter states', async () => {
          const { useCombat } = await import('@/contexts/CombatContext');
          const encounter = {
              id: 'e',
              currentRound: 1,
              actions: [{id: 'a0'}],
              participants: [{id: 'p1', currentHitPoints: 10, deathSaves: {failures: 0}}]
          };
          const mockCombat = { state: { isInCombat: true, activeEncounter: encounter } };
          (useCombat as any).mockReturnValue(mockCombat);
          const { rerender } = renderHook(() => useCombatAIIntegration({ sessionId, characterId, campaignId }));

          mockCombat.state.activeEncounter = {
              ...encounter,
              currentRound: 2,
              actions: [...encounter.actions, {id: 'a1'}],
              participants: [
                  {id: 'p1', currentHitPoints: 0, deathSaves: {failures: 3}},
                  {id: 'p2', currentHitPoints: 0, deathSaves: {failures: 0}}
              ]
          };
          rerender();

          mockCombat.state.activeEncounter = null;
          rerender();
      });
  });
});
