/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #1084 (Hark S-001) — the completion latch for engine-ended turns.
 *
 * The server completes a one-shot session through `applyStoryEnding` on
 * three paths: a DM declaration, the safety net, and the tracker step's
 * `at_limit: 'ending'` force. The first two mirrored the stored summary
 * onto the reply envelope's `campaign_ending` field; the force did not,
 * so the session completed and the "Adventure complete" engine line
 * posted, but the client's live latch — which keys on exactly that
 * field — never fired and no completion screen appeared. The server
 * fix mirrors the forced summary onto the envelope; this test pins the
 * client half of that contract: a turn result whose envelope carries
 * the completed state latches the completion state (summary + session)
 * the game screen renders, and a turn without it latches nothing.
 *
 * Fixture follows its real producer: the envelope shape is the route's
 * rewritten reply (`llm.ts` response-text rewrite of the parsed
 * envelope), with `campaign_ending` as the `dm-response-schema`
 * declares it.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useAIResponse, type EnhancedChatMessage } from '../use-ai-response';

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
      generateText: vi.fn().mockResolvedValue('A. **Look around**.\\nB. **Press on**.'),
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

describe('useAIResponse: completion latch (#1084)', () => {
  const mockSessionId = 'session-1084';
  const mockMessages = [
    { text: 'I pull the last wedge.', sender: 'player', timestamp: new Date().toISOString() },
  ];
  const mockSessionData = {
    id: mockSessionId,
    campaign_id: 'camp-1',
    character_id: 'char-1',
    campaign: { id: 'camp-1', name: 'Camp' },
    character: { id: 'char-1', name: 'Char' },
  };
  const FORCED_SUMMARY = 'The Score Clock reached 6 of 6 — the adventure ends.';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCombat).mockReturnValue({
      state: { isInCombat: false, activeEncounter: null },
      refreshCombatState: vi.fn(async () => null),
    } as any);
    vi.mocked(userDataApi.getSessionContext).mockResolvedValue(mockSessionData as any);
    vi.mocked(userDataApi.fetchSessionFallenState).mockResolvedValue(null);
  });

  it('latches the completion state when the envelope carries the completed state', async () => {
    const { AIService } = await import('@/services/ai-service');

    (AIService.chatWithDM as any).mockResolvedValue({
      text: 'The Score Clock fills, and the story closes.',
      narrationSegments: [],
      dice_rolls: [],
      roll_requests: [],
      combatDetection: { isCombat: false },
      campaign_ending: { summary: FORCED_SUMMARY },
    });

    const { result } = renderHook(() => useAIResponse());
    let response: EnhancedChatMessage | null = null;
    await act(async () => {
      response = await result.current.getAIResponse(mockMessages as any, mockSessionId);
    });

    expect(response).not.toBeNull();
    await waitFor(() =>
      expect(result.current.campaignCompletedState).toMatchObject({
        summary: FORCED_SUMMARY,
        sessionId: mockSessionId,
      }),
    );
  });

  it('latches nothing when the envelope carries no ending', async () => {
    const { AIService } = await import('@/services/ai-service');

    (AIService.chatWithDM as any).mockResolvedValue({
      text: 'The grove breathes around you, and time moves in the hollow.',
      narrationSegments: [],
      dice_rolls: [],
      roll_requests: [],
      combatDetection: { isCombat: false },
    });

    const { result } = renderHook(() => useAIResponse());
    await act(async () => {
      await result.current.getAIResponse(mockMessages as any, mockSessionId);
    });

    expect(result.current.campaignCompletedState).toBeNull();
  });
});
