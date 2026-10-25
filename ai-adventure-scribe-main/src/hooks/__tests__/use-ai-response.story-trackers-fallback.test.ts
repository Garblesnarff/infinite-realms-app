/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #1095 (Hark S2-002): the Story clock element appears only on some turns.
 * The #1062 envelope carries story_trackers only on turns the tracker step
 * ran, so a turn the step skipped shows no clock line at all — and the
 * player reads the values from DM prose instead.
 *
 * The fix: the envelope path stays primary, but when a DM turn's final
 * result carries no story_trackers, the latch falls back to GET the
 * session's trackers and attaches those to the message context, so every
 * turn's message carries the clock.
 *
 * Everything below mirrors the `use-ai-response.story-effects-refresh`
 * (#1085) narration-turn harness; only the DM reply envelope and the
 * fetch stub vary.
 */
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

describe('useAIResponse: story-trackers GET fallback (#1095)', () => {
  const mockSessionId = 'session-1095';
  const mockMessages = [
    { text: 'I press on down the road.', sender: 'player', timestamp: new Date().toISOString() },
  ];
  const fetchedTrackers = [
    { name: 'Wall Clock', value: 2, limit: 6 },
    { name: 'Doom Counter', value: 1, limit: 4 },
  ];

  const fetchStub = vi.fn();

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
    fetchStub.mockReset();
    fetchStub.mockImplementation(async (url: string) => {
      if (String(url).includes('/trackers')) {
        return { ok: true, json: async () => ({ trackers: fetchedTrackers }) };
      }
      return { ok: false };
    });
    vi.stubGlobal('fetch', fetchStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Plays one narration turn and returns the DM message it produced. */
  const playTurn = async (reply: Record<string, unknown>): Promise<any> => {
    const { AIService } = await import('@/services/ai-service');
    (AIService.chatWithDM as any).mockResolvedValue({
      text: 'The road bends on through the pines.',
      narrationSegments: [],
      dice_rolls: [],
      roll_requests: [],
      combatDetection: { isCombat: false },
      ...reply,
    });
    const { result } = renderHook(() => useAIResponse());
    const response = await result.current.getAIResponse(mockMessages as any, mockSessionId);
    expect(response.sender).toBe('dm');
    return response;
  };

  it('a turn with no envelope field carries the GET fallback trackers', async () => {
    const response = await playTurn({});
    expect(response.context.storyTrackers).toEqual(fetchedTrackers);
    expect(fetchStub).toHaveBeenCalledWith(
      expect.stringContaining(`/v1/sessions/${mockSessionId}/trackers`),
      expect.anything(),
    );
  });

  it('an envelope field wins over the GET fallback (envelope stays primary)', async () => {
    const envelopeTrackers = [{ name: 'Wall Clock', value: 3, limit: 6 }];
    const response = await playTurn({ story_trackers: envelopeTrackers });
    expect(response.context.storyTrackers).toEqual(envelopeTrackers);
    expect(fetchStub).not.toHaveBeenCalledWith(
      expect.stringContaining('/trackers'),
      expect.anything(),
    );
  });

  it('an empty envelope array refetches (empty is absent, not a value)', async () => {
    const response = await playTurn({ story_trackers: [] });
    expect(response.context.storyTrackers).toEqual(fetchedTrackers);
    expect(fetchStub).toHaveBeenCalledWith(
      expect.stringContaining(`/v1/sessions/${mockSessionId}/trackers`),
      expect.anything(),
    );
  });

  it('a failed GET leaves the message without trackers (today’s behavior, no invented state)', async () => {
    fetchStub.mockImplementation(async () => ({ ok: false }));
    const response = await playTurn({});
    expect(response.context.storyTrackers).toBeUndefined();
  });
});
