/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #1085 (Hark S-009): in-session HP and XP go stale after engine awards and
 * damage. The panel showed 900/2,700 after a +450 XP line, and 16/28 HP with
 * 1,450 XP while the engine lines gave 14/28 and 1,800 XP.
 *
 * The server publishes `character_state_updated` for story damage, items, XP
 * and rests (#130), but the panel's refresh must not depend on the session
 * socket alone: the socket has no reconnect, so a dead socket leaves the panel
 * stale for the rest of the session while DM turns still work over HTTP.
 *
 * The fix: after a DM turn whose final result carries applied story effects
 * (xp_award, damage, items, conditions, rest), use-ai-response dispatches the
 * same `character-state-updated` window event the socket forwards, and the
 * existing refresh hook refetches the character into CharacterContext.
 *
 * Everything below mirrors the `use-ai-response.test.ts` narration-turn
 * harness; only the DM reply envelope varies. The window event is the seam:
 * `character-state-updated.test.tsx` already proves the event refetches the
 * panel, so asserting the dispatch here pins the new link end to end.
 */
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useAIResponse } from '../use-ai-response';

import { useCombat } from '@/contexts/CombatContext';
import { userDataApi } from '@/services/user-data-api';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({ userPlan: 'pro' })),
}));

vi.mock('@/contexts/CombatContext', () => ({
  useCombat: vi.fn(() => ({
    state: { isInCombat: false, activeEncounter: null },
    refreshCombatState: vi.fn(async () => null),
  })),
}));

vi.mock('@/contexts/GameContext', () => ({
  useGame: vi.fn(() => ({
    state: {
      currentPhase: 'exploration',
      diceRollQueue: { pendingRolls: [] },
    },
    setGamePhase: vi.fn(),
  })),
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getSessionContext: vi.fn(),
    getTacticalMapContext: vi.fn(),
    endTacticalMap: vi.fn(),
    applyDmTacticalActions: vi.fn(),
    clearPendingCombatIntent: vi.fn(),
    fetchSessionFallenState: vi.fn(),
  },
}));

vi.mock('@/services/ai-service', () => ({
  AIService: {
    chatWithDM: vi.fn(),
    lastRequestId: vi.fn(),
  },
}));

vi.mock('@/services/memory-manager', () => ({
  MemoryManager: {
    getRelevantMemories: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@/services/voice-consistency-service', () => ({
  voiceConsistencyService: {
    getSessionVoiceContext: vi.fn().mockResolvedValue({ knownCharacters: {} }),
    processVoiceAssignments: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/hooks/ai/game-phase-updater', () => ({
  updateGamePhase: vi.fn(),
  clampCombatIntentFlags: vi.fn((start, end) => ({
    shouldStartCombat: start,
    shouldEndCombat: end,
  })),
}));

vi.mock('@/hooks/ai/roll-processor', () => ({
  processRollRequests: vi.fn().mockResolvedValue({
    playerRollRequests: [],
    npcRollResults: [],
    npcRollContinuationText: '',
  }),
}));

vi.mock('@/hooks/ai/session-logger', () => ({
  logIncomingRolls: vi.fn().mockResolvedValue(undefined),
  logRollRequests: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/utils/combatDetection', () => ({
  detectCombatFromText: vi.fn(() => ({
    isCombat: false,
    confidence: 0,
    shouldStartCombat: false,
    shouldEndCombat: false,
    enemies: [],
    combatActions: [],
  })),
}));

vi.mock('@/infrastructure/api', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    llmApiClient: {
      generateText: vi
        .fn()
        .mockResolvedValue(
          'A. **Look around**, survey your surroundings.\nB. **Press on**, continue toward your goal.\nC. **Call out**, announce your presence.',
        ),
    },
  };
});

vi.mock('@/contexts/CharacterContext', () => ({
  // #400: the owned sheet for the suggestion filter; null keeps the filter a no-op here.
  useCharacter: () => ({ state: { character: null } }),
}));

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('useAIResponse: story effects refresh the sheet (#1085)', () => {
  const mockSessionId = 'session-1085';
  const mockMessages = [
    { text: 'I press on down the road.', sender: 'player', timestamp: new Date().toISOString() },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCombat).mockReturnValue({
      state: { isInCombat: false, activeEncounter: null },
      refreshCombatState: vi.fn(async () => null),
    } as any);
    vi.mocked(userDataApi.fetchSessionFallenState).mockReset();
    vi.mocked(userDataApi.fetchSessionFallenState).mockResolvedValue(null);
    vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
      id: mockSessionId,
      campaign_id: 'camp-1',
      character_id: 'char-1',
      campaign: { id: 'camp-1', name: 'Camp' },
      character: { id: 'char-1', name: 'Char' },
    } as any);
  });

  /** Counts `character-state-updated` events dispatched during the turn. */
  const playAndCountRefreshes = async (reply: Record<string, unknown>): Promise<number> => {
    const { AIService } = await import('@/services/ai-service');
    (AIService.chatWithDM as any).mockResolvedValue({
      text: 'The road bends on through the pines.',
      narrationSegments: [],
      dice_rolls: [],
      roll_requests: [],
      combatDetection: { isCombat: false },
      ...reply,
    });
    let count = 0;
    const listener = (): void => {
      count += 1;
    };
    window.addEventListener('character-state-updated', listener);
    try {
      const { result } = renderHook(() => useAIResponse());
      const response = await result.current.getAIResponse(mockMessages as any, mockSessionId);
      expect(response.sender).toBe('dm');
    } finally {
      window.removeEventListener('character-state-updated', listener);
    }
    return count;
  };

  it("Hark's shape: an XP award plus damage refreshes the panel", async () => {
    const count = await playAndCountRefreshes({
      xp_award: { amount: 450, reason: 'survived the ambush' },
      damage: { amount: 2, source: 'falling branch' },
    });
    expect(count).toBe(1);
  });

  it.each([
    ['items', { items: [{ name: 'Healing Potion', quantity: 1, change: 'gain' }] }],
    ['conditions', { conditions: [{ name: 'poisoned', change: 'apply' }] }],
    ['rest', { rest: { type: 'short' } }],
    ['XP alone', { xp_award: { amount: 50, reason: 'found the cache' } }],
    ['damage alone', { damage: { amount: 3, source: 'rope burn' } }],
  ])('a turn carrying %s refreshes the panel', async (_label, reply) => {
    expect(await playAndCountRefreshes(reply)).toBe(1);
  });

  it('a narration-only turn does not refresh', async () => {
    expect(await playAndCountRefreshes({})).toBe(0);
  });

  it('empty story fields do not refresh', async () => {
    expect(
      await playAndCountRefreshes({
        xp_award: null,
        damage: null,
        items: [],
        conditions: [],
        rest: null,
      }),
    ).toBe(0);
  });
});
