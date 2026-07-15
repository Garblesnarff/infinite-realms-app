/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useAIResponse } from '../use-ai-response';

import { userDataApi } from '@/services/user-data-api';

// Mock dependencies
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({ userPlan: 'pro' })),
}));

vi.mock('@/contexts/CombatContext', () => ({
  useCombat: vi.fn(() => ({
    state: {
      isInCombat: false,
      activeEncounter: { currentTurnParticipantId: 'p1' },
    },
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

// fetchGameContext() (see src/hooks/use-ai-response.ts) now fetches session/campaign/character
// data via userDataApi.getSessionContext() (a single Bun server REST call) instead of a
// supabase.from('game_sessions').select(...).single() join, so the mock target was updated
// to match. The real payload shape uses singular `campaign`/`character` keys (not the old
// `campaigns`/`characters` join aliases).
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getSessionContext: vi.fn(),
  },
}));

vi.mock('@/services/ai-service', () => ({
  AIService: {
    chatWithDM: vi.fn(),
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
  clampCombatIntentFlags: vi.fn((start, end) => ({ shouldStartCombat: start, shouldEndCombat: end })),
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

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('useAIResponse', () => {
  const mockSessionId = 'session-123';
  const mockMessages = [
    { text: 'Hello', sender: 'player', timestamp: new Date().toISOString() },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should generate an AI response successfully', async () => {
    const { AIService } = await import('@/services/ai-service');

    const mockSessionData = {
      id: mockSessionId,
      campaign_id: 'camp-1',
      character_id: 'char-1',
      campaign: { id: 'camp-1', name: 'Camp' },
      character: { id: 'char-1', name: 'Char' },
    };

    vi.mocked(userDataApi.getSessionContext).mockResolvedValue(mockSessionData as any);

    (AIService.chatWithDM as any).mockResolvedValue({
      text: 'Greetings traveler!',
      narrationSegments: [],
      dice_rolls: [],
      roll_requests: [],
      combatDetection: { isCombat: false },
    });

    const { result } = renderHook(() => useAIResponse());
    const response = await result.current.getAIResponse(mockMessages as any, mockSessionId);

    expect(response.text).toBe('Greetings traveler!');
    expect(response.sender).toBe('dm');
    expect(AIService.chatWithDM).toHaveBeenCalled();
  });

  it('should handle structured responses with narration segments and dice rolls', async () => {
    const { AIService } = await import('@/services/ai-service');
    const { voiceConsistencyService } = await import('@/services/voice-consistency-service');
    const { updateGamePhase, clampCombatIntentFlags } = await import('@/hooks/ai/game-phase-updater');
    const { detectCombatFromText } = await import('@/utils/combatDetection');

    vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
      id: mockSessionId,
      campaign_id: 'c',
      character_id: 'ch',
      campaign: {},
      character: {},
    } as any);

    const mockNarration = [{ type: 'narration', text: 'You see a dragon.' }];
    const mockDiceRolls = [{ type: 'attack', dice_notation: '1d20+5', result: 18 }];
    const mockCombatDetection = { isCombat: true, shouldStartCombat: true };

    (AIService.chatWithDM as any).mockResolvedValue({
      text: 'A dragon appeared!',
      narrationSegments: mockNarration,
      dice_rolls: mockDiceRolls,
      combatDetection: mockCombatDetection,
    });

    (detectCombatFromText as any).mockReturnValue({
      isCombat: true,
      shouldStartCombat: true,
    });

    const { result } = renderHook(() => useAIResponse());
    const response = await result.current.getAIResponse(mockMessages as any, mockSessionId);

    expect(response.narrationSegments).toEqual(mockNarration);
    expect(response.diceRolls).toEqual(mockDiceRolls);
    expect(voiceConsistencyService.processVoiceAssignments).toHaveBeenCalledWith(
      mockSessionId,
      mockNarration,
    );
    expect(updateGamePhase).toHaveBeenCalled();
    expect(clampCombatIntentFlags).toHaveBeenCalled();
  });

  it('should append NPC roll continuation text if present', async () => {
    const { AIService } = await import('@/services/ai-service');
    const { processRollRequests } = await import('@/hooks/ai/roll-processor');

    vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
      id: mockSessionId,
      campaign_id: 'c',
      character_id: 'ch',
      campaign: {},
      character: {},
    } as any);

    (AIService.chatWithDM as any).mockResolvedValue({
      text: 'The goblin attacks!',
      combatDetection: { isCombat: true },
    });

    (processRollRequests as any).mockResolvedValue({
      playerRollRequests: [],
      npcRollResults: [{ total: 15 }],
      npcRollContinuationText: 'The goblin rolled a 15.',
    });

    const { result } = renderHook(() => useAIResponse());
    const response = await result.current.getAIResponse(mockMessages as any, mockSessionId);

    expect(response.text).toContain('The goblin attacks!');
    expect(response.text).toContain('The goblin rolled a 15.');
    expect(response.context?.npcRollResults).toHaveLength(1);
  });

  it('should skip processing for duplicate message signatures', async () => {
    const { AIService } = await import('@/services/ai-service');

    vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
      id: mockSessionId,
      campaign_id: 'c',
      character_id: 'ch',
      campaign: {},
      character: {},
    } as any);

    (AIService.chatWithDM as any).mockResolvedValue({ text: 'Response' });

    const { result } = renderHook(() => useAIResponse());

    // First call
    await result.current.getAIResponse(mockMessages as any, mockSessionId);
    expect(AIService.chatWithDM).toHaveBeenCalledTimes(1);

    // Second call with same message and messages length
    const response = await result.current.getAIResponse(mockMessages as any, mockSessionId);

    expect(AIService.chatWithDM).toHaveBeenCalledTimes(1); // Should not be called again
    expect(response.text).toBe('');
  });

  it('should throw an error if fetching game context fails', async () => {
    vi.mocked(userDataApi.getSessionContext).mockRejectedValue(new Error('DB Error'));

    const { result } = renderHook(() => useAIResponse());

    await expect(result.current.getAIResponse(mockMessages as any, mockSessionId))
      .rejects.toThrow('Failed to fetch game context');
  });

  it('should handle AI service failures', async () => {
    const { AIService } = await import('@/services/ai-service');

    vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
      id: mockSessionId,
      campaign_id: 'c',
      character_id: 'ch',
      campaign: {},
      character: {},
    } as any);

    (AIService.chatWithDM as any).mockRejectedValue(new Error('AI Offline'));

    const { result } = renderHook(() => useAIResponse());

    await expect(result.current.getAIResponse(mockMessages as any, mockSessionId))
      .rejects.toThrow('AI Offline');
  });
});
