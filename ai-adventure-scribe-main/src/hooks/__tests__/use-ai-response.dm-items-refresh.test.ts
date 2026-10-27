/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #463 (Hark NT-039/041/051/066/073/079/082/099/105/120/129/140): items the
 * DM says the player picked up never reached the sheet Inventory.
 *
 * The server half is pinned by dm-reply-reconcile.real-db.test.ts (the grant
 * lands on character_equipment, the table the sheet Inventory reads) and each
 * client half is pinned in isolation: dm-response-processor.story-effects
 * drives the REAL processDMResponse and asserts the `items` field survives,
 * and use-ai-response.story-effects-refresh mocks `AIService.chatWithDM`
 * with full shapes and asserts the `character-state-updated` dispatch.
 *
 * What neither pins is the JOIN: a real DM-reply envelope travelling through
 * the REAL `AIService.chatWithDM` + `processDMResponse` into the REAL gate
 * in use-ai-response. The #1130 whitelist drop lived exactly on that seam —
 * the hook test's mock bypassed it, so the drop was invisible to the suite
 * until Hark saw it live. This file drives the joined path: the only mocked
 * network call is `llmApiClient.generateText`, returning the same
 * server-envelope JSON shape the processor test uses. Everything from
 * `chatWithDM` inward — the narration-contract check (which no-ops
 * without tactical context), `processDMResponse`, the story-effects gate —
 * runs for real.
 *
 * The window event is the seam: `character-state-updated.test.tsx` already
 * proves the event refetches the panel, so asserting the dispatch here pins
 * the no-reload refresh for an items grant end to end on the client.
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
    state: { currentPhase: 'exploration', diceRollQueue: { pendingRolls: [] } },
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
    applyDmHandoutActions: vi.fn(),
    fetchSessionFallenState: vi.fn(),
    reportClientFailure: vi.fn(),
  },
}));

vi.mock('@/services/memory-manager', () => ({
  MemoryManager: {
    getRelevantMemories: vi.fn().mockResolvedValue([]),
    saveMemories: vi.fn(),
    extractMemories: vi.fn(() => ({ memories: [] })),
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

// processDMResponse side-effect deps, same factories as
// dm-response-processor.story-effects.test.ts.
vi.mock('@/services/ai/asset-processor', () => ({
  applyAssetPostProcessing: vi.fn((params) => params),
  insertAssetTags: vi.fn((text) => text),
  getCachedAssets: vi.fn(() => []),
}));

vi.mock('@/services/ai/xml-parser', () => ({
  parseXMLTagsFromResponse: vi.fn(() => ({
    hadTags: false,
    narrative: '',
    memories: [],
    worldUpdates: { npcs: [], locations: [], quests: [] },
  })),
}));

vi.mock('@/services/world-builders', () => ({
  WorldBuilderService: {
    respondToPlayerAction: vi.fn(),
  },
  WorldBuilderRepository: {
    saveNPCFromXML: vi.fn(),
    saveLocationFromXML: vi.fn(),
    saveQuestFromXML: vi.fn(),
  },
}));

vi.mock('@/utils/memory/segmentation', () => ({
  sanitizeForMemoryExtraction: vi.fn((text) => text),
}));

vi.mock('@/utils/normalize-asset-tags', () => ({
  normalizeAssetTagsInContent: vi.fn((text) => text),
}));

vi.mock('@/services/narrative/scene-state-client', () => ({
  fetchSceneState: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/services/session-state-service', () => ({
  SessionStateService: { getLatestRollOutcome: vi.fn().mockResolvedValue(null) },
}));

vi.mock('@/services/session-trackers', () => ({
  fetchSessionTrackers: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/infrastructure/api', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    // The model reply. Scene, tracker, and session reads are mocked to
    // their fail-open values; everything downstream of the envelope string
    // runs for real.
    llmApiClient: { generateText: vi.fn() },
  };
});

vi.mock('@/contexts/CharacterContext', () => ({
  // #400: the owned sheet for the suggestion filter; null keeps the filter a no-op here.
  useCharacter: () => ({ state: { character: null } }),
}));

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

describe('useAIResponse: a real DM items grant refreshes the sheet (#463)', () => {
  const mockSessionId = 'session-463';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCombat).mockReturnValue({
      state: { isInCombat: false, activeEncounter: null },
      refreshCombatState: vi.fn(async () => null),
    } as any);
    vi.mocked(userDataApi.fetchSessionFallenState).mockResolvedValue(null);
    vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
      id: mockSessionId,
      campaign_id: 'camp-1',
      character_id: 'char-1',
      campaign: { id: 'camp-1', name: 'Camp' },
      character: { id: 'char-1', name: 'Char' },
    } as any);
  });

  /**
   * Plays one turn whose model reply is `envelope`, counting refresh dispatches.
   * Each case sends DIFFERENT player text: `AIService.chatWithDM` dedupes
   * identical (session, message, history-length) calls inside a 2s window by
   * replaying the first call's promise, so reusing one message would replay
   * the first case's grant into every later case.
   */
  const playAndCountRefreshes = async (
    envelope: Record<string, unknown>,
    playerText: string,
  ): Promise<{ count: number; text: string }> => {
    const mockMessages = [
      { text: playerText, sender: 'player', timestamp: new Date().toISOString() },
    ];
    const { llmApiClient } = await import('@/infrastructure/api');
    vi.mocked(llmApiClient.generateText).mockImplementation(async (request: any) => {
      request?.onResponseMetadata?.({});
      return JSON.stringify(envelope);
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
      return { count, text: response.text };
    } finally {
      window.removeEventListener('character-state-updated', listener);
    }
  };

  it.each([
    [
      'an items grant',
      {
        text: 'You pocket a silver key from the dusty shelf.',
        combat_transition: 'none',
        items: [{ name: 'silver key', quantity: 1, change: 'gain' }],
      },
      'I take the silver key from the shelf.',
      1,
    ],
    [
      'a narration-only turn',
      { text: 'The path winds on through quiet trees.', combat_transition: 'none' },
      'I walk on down the quiet path.',
      0,
    ],
    [
      'an empty items field',
      { text: 'The shelf is bare.', combat_transition: 'none', items: [] },
      'I search the bare shelf.',
      0,
    ],
  ])(
    '%s through the real path refreshes the sheet exactly as often as it should',
    async (_label, envelope, playerText, expected) => {
      const { count, text } = await playAndCountRefreshes(envelope, playerText);
      expect(text).toContain(envelope.text as string);
      expect(count).toBe(expected);
    },
  );
});
