/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useAIResponse } from '../use-ai-response';

import { useCombat } from '@/contexts/CombatContext';
import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';

// Mock dependencies
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({ userPlan: 'pro' })),
}));

// Combat truth now arrives through refreshCombatState(), which re-reads the server. The
// default here is "no combat"; see browser-combat-pipeline.test.tsx for the same pipeline
// running against the real provider, reducer and sync hook rather than this stub.
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

// fetchGameContext() (see src/hooks/use-ai-response.ts) now fetches session/campaign/character
// data via userDataApi.getSessionContext() (a single Bun server REST call) instead of a
// supabase.from('game_sessions').select(...).single() join, so the mock target was updated
// to match. The real payload shape uses singular `campaign`/`character` keys (not the old
// `campaigns`/`characters` join aliases).
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getSessionContext: vi.fn(),
    getTacticalMapContext: vi.fn(),
    endTacticalMap: vi.fn(),
    applyTacticalMapAction: vi.fn(),
    applyDmTacticalActions: vi.fn(),
    advanceNpcTurns: vi.fn(),
    clearPendingCombatIntent: vi.fn(),
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

// ensure-action-options repairs option-less DM turns via llmApiClient; keep it
// deterministic and offline in unit tests.
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
  const mockMessages = [{ text: 'Hello', sender: 'player', timestamp: new Date().toISOString() }];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCombat).mockReturnValue({
      state: { isInCombat: false, activeEncounter: null },
      refreshCombatState: vi.fn(async () => null),
    } as any);
    vi.mocked(userDataApi.advanceNpcTurns).mockReset();
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

    expect(response.text).toContain('Greetings traveler!');
    expect(response.sender).toBe('dm');
    expect(AIService.chatWithDM).toHaveBeenCalled();
  });

  describe('#2218: the reserved DM row id reaches the server', () => {
    const DM_ID = '0b7e4f5a-2c9d-4e1b-8a3f-6d5c4b3a2e1f';
    const sessionContext = {
      id: mockSessionId,
      campaign_id: 'c',
      character_id: 'ch',
      campaign: {},
      character: {},
    };

    it('sends it with inCombat false on a narrative turn, so the server keeps the reply', async () => {
      const { AIService } = await import('@/services/ai-service');
      vi.mocked(userDataApi.getSessionContext).mockResolvedValue(sessionContext as any);
      (AIService.chatWithDM as any).mockResolvedValue({ text: 'The stair ends in black water.' });

      const { result } = renderHook(() => useAIResponse());
      await result.current.getAIResponse(
        mockMessages as any,
        mockSessionId,
        undefined,
        undefined,
        undefined,
        DM_ID,
      );

      expect(AIService.chatWithDM).toHaveBeenCalledWith(
        expect.objectContaining({ dmReply: { messageId: DM_ID, inCombat: false } }),
      );
    });

    it('marks an in-combat turn, so the server never keeps prose the engine may still resolve', async () => {
      const { AIService } = await import('@/services/ai-service');
      const { useCombat } = await import('@/contexts/CombatContext');
      const liveEncounter = {
        id: 'enc-1',
        phase: 'active',
        currentTurnParticipantId: 'turn-entity',
        currentRound: 1,
        participants: [],
      };
      vi.mocked(useCombat).mockReturnValue({
        state: { isInCombat: true, activeEncounter: liveEncounter },
        refreshCombatState: vi.fn(async () => liveEncounter),
      } as any);
      vi.mocked(userDataApi.getSessionContext).mockResolvedValue(sessionContext as any);
      vi.mocked(userDataApi.getTacticalMapContext).mockResolvedValue({ ok: false } as any);
      (AIService.chatWithDM as any).mockResolvedValue({ text: 'You circle the ghoul.' });

      const { result } = renderHook(() => useAIResponse());
      await result.current.getAIResponse(
        mockMessages as any,
        mockSessionId,
        undefined,
        undefined,
        undefined,
        DM_ID,
      );

      expect(AIService.chatWithDM).toHaveBeenCalledWith(
        expect.objectContaining({ dmReply: { messageId: DM_ID, inCombat: true } }),
      );
    });

    it('sends nothing when the caller reserved no id', async () => {
      const { AIService } = await import('@/services/ai-service');
      vi.mocked(userDataApi.getSessionContext).mockResolvedValue(sessionContext as any);
      (AIService.chatWithDM as any).mockResolvedValue({ text: 'Quiet.' });

      const { result } = renderHook(() => useAIResponse());
      await result.current.getAIResponse(mockMessages as any, mockSessionId);

      expect((AIService.chatWithDM as any).mock.calls[0][0]).not.toHaveProperty('dmReply');
    });
  });

  it('appends structured options without a client repair call', async () => {
    const { AIService } = await import('@/services/ai-service');
    const { llmApiClient } = await import('@/infrastructure/api');
    const options = [
      'A. **Study the map**, search for a safer route.',
      'B. **Ask the guide**, learn what danger lies ahead.',
    ];

    vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
      id: mockSessionId,
      campaign_id: 'camp-1',
      character_id: 'char-1',
      campaign: {},
      character: {},
    } as any);
    (AIService.chatWithDM as any).mockResolvedValue({
      text: 'The road divides beneath the ruined watchtower.',
      options,
      combatDetection: { isCombat: false },
    });

    const { result } = renderHook(() => useAIResponse());
    const response = await result.current.getAIResponse(mockMessages as any, mockSessionId);

    expect(response.text).toBe(
      `The road divides beneath the ruined watchtower.\n\n${options.join('\n')}`,
    );
    expect(llmApiClient.generateText).not.toHaveBeenCalled();
  });

  // #1944: the reported symptom was turn 2 showing turn 1's leftover options, renumbered.
  // Options are always parsed out of the message they belong to, so an option-less turn must
  // never inherit the previous turn's menu -- free-text input is available regardless.
  it("never carries a previous turn's options into a response that has none", async () => {
    const { AIService } = await import('@/services/ai-service');
    const firstTurnOptions = [
      'A. **Climb the ledge**, test the crumbling handholds.',
      'B. **Skirt the ravine**, take the longer path around.',
      'C. **Rope the gap**, anchor a line across.',
    ];

    vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
      id: mockSessionId,
      campaign_id: 'camp-1',
      character_id: 'char-1',
      campaign: {},
      character: {},
    } as any);

    (AIService.chatWithDM as any).mockResolvedValueOnce({
      text: 'The ravine yawns below the ledge.',
      options: firstTurnOptions,
      combatDetection: { isCombat: false },
    });
    const withOptions = await renderHook(() => useAIResponse()).result.current.getAIResponse(
      mockMessages as any,
      mockSessionId,
    );
    expect(withOptions.text).toContain('Skirt the ravine');

    (AIService.chatWithDM as any).mockResolvedValueOnce({
      text: 'Your boot finds purchase and you haul yourself onto the ledge.',
      combatDetection: { isCombat: false },
    });
    const withoutOptions = await renderHook(() => useAIResponse()).result.current.getAIResponse(
      mockMessages as any,
      mockSessionId,
    );

    expect(withoutOptions.text).toContain('you haul yourself onto the ledge');
    for (const option of firstTurnOptions) {
      expect(withoutOptions.text).not.toContain(option);
    }
    expect(withoutOptions.text).not.toContain('Skirt the ravine');
    expect(withoutOptions.text).not.toContain('Rope the gap');
  });

  it('should handle structured responses with narration segments and dice rolls', async () => {
    const { AIService } = await import('@/services/ai-service');
    const { voiceConsistencyService } = await import('@/services/voice-consistency-service');
    const { updateGamePhase, clampCombatIntentFlags } =
      await import('@/hooks/ai/game-phase-updater');
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

    await expect(result.current.getAIResponse(mockMessages as any, mockSessionId)).rejects.toThrow(
      'Failed to fetch game context',
    );
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

    await expect(result.current.getAIResponse(mockMessages as any, mockSessionId)).rejects.toThrow(
      'AI Offline',
    );
  });

  it('loads tactical context through userDataApi without interrupting the AI turn', async () => {
    const { AIService } = await import('@/services/ai-service');
    const { useCombat } = await import('@/contexts/CombatContext');

    const liveEncounter = {
      id: 'enc-1',
      phase: 'active',
      currentTurnParticipantId: 'turn-entity',
      currentRound: 1,
      participants: [],
    };
    vi.mocked(useCombat).mockReturnValue({
      state: { isInCombat: true, activeEncounter: liveEncounter },
      refreshCombatState: vi.fn(async () => liveEncounter),
    } as any);
    vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
      id: mockSessionId,
      campaign_id: 'c',
      character_id: 'ch',
      campaign: {},
      character: {},
    } as any);
    vi.mocked(userDataApi.getTacticalMapContext).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ tacticalContext: 'Tactical digest' }),
    } as any);
    (AIService.chatWithDM as any).mockResolvedValue({ text: 'Advance carefully.' });

    const { result } = renderHook(() => useAIResponse());
    await result.current.getAIResponse(mockMessages as any, mockSessionId);

    expect(userDataApi.getTacticalMapContext).toHaveBeenCalledWith(mockSessionId, 'turn-entity');
    expect(AIService.chatWithDM).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          gameState: expect.objectContaining({ tacticalContext: 'Tactical digest' }),
        }),
      }),
    );
  });

  it('returns the retry notice and skips chatWithDM when NPC pre-flight rejects', async () => {
    const { AIService } = await import('@/services/ai-service');
    const { useCombat } = await import('@/contexts/CombatContext');
    const liveEncounter = {
      id: 'encounter-1',
      phase: 'active',
      currentTurnParticipantId: 'npc-1',
      currentRound: 1,
      participants: [
        { id: 'player-1', characterId: 'char-1', name: 'The Player', participantType: 'player' },
        { id: 'npc-1', name: 'The Professor', participantType: 'npc' },
      ],
    };

    vi.mocked(useCombat).mockReturnValue({
      state: { isInCombat: true, activeEncounter: liveEncounter },
      refreshCombatState: vi.fn().mockResolvedValue(liveEncounter),
    } as any);
    vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
      id: mockSessionId,
      campaign_id: 'c',
      character_id: 'char-1',
      campaign: {},
      character: { id: 'char-1' },
    } as any);
    vi.mocked(userDataApi.advanceNpcTurns).mockRejectedValue(
      Object.assign(new Error('runner unavailable'), { status: 503 }),
    );

    const { result } = renderHook(() => useAIResponse());
    await act(async () => {
      const response = await result.current.getAIResponse(mockMessages as any, mockSessionId);

      expect(response.text).toBe('');
      expect(response.localNotice).toBe(
        'The other combatants are still acting — try again in a moment.',
      );
    });
    expect(AIService.chatWithDM).not.toHaveBeenCalled();
    expect(result.current.combatTurnUiState).toMatchObject({
      holder: 'npc-1',
      preflight: 'unknown',
    });
    expect(logger.warn).toHaveBeenCalledWith('COMBAT_ENTRY_NPC_FIRST_ADVANCE_FAILED', {
      sessionId: mockSessionId,
      encounterId: 'encounter-1',
      status: 503,
    });
  });

  it('runs resumeCombatTurn after a preflight catch transitions the UI back to ready', async () => {
    const { AIService } = await import('@/services/ai-service');
    const { useCombat } = await import('@/contexts/CombatContext');

    const npcEncounter = {
      id: 'encounter-1',
      phase: 'active',
      currentTurnParticipantId: 'npc-1',
      participants: [
        { id: 'player-1', characterId: 'char-1', name: 'The Player', participantType: 'player' },
        { id: 'npc-1', name: 'The Professor', participantType: 'npc' },
      ],
    };
    const playerEncounter = { ...npcEncounter, currentTurnParticipantId: 'player-1' };
    let resolveResumeRefresh: ((encounter: typeof playerEncounter) => void) | undefined;
    const refreshCombatState = vi
      .fn()
      .mockResolvedValueOnce(npcEncounter)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveResumeRefresh = resolve;
          }),
      );

    vi.mocked(useCombat).mockReturnValue({
      state: { isInCombat: true, activeEncounter: npcEncounter },
      refreshCombatState,
    } as any);
    vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
      id: mockSessionId,
      campaign_id: 'campaign-1',
      character_id: 'char-1',
      campaign: {},
      character: { id: 'char-1' },
    } as any);
    vi.mocked(userDataApi.advanceNpcTurns).mockRejectedValueOnce(
      Object.assign(new Error('runner unavailable'), { status: 503 }),
    );

    const { result } = renderHook(() => useAIResponse());
    await act(async () => {
      await result.current.getAIResponse(mockMessages as any, mockSessionId);
    });

    expect(result.current.combatTurnUiState).toMatchObject({
      holder: 'npc-1',
      preflight: 'unknown',
    });
    expect(AIService.chatWithDM).not.toHaveBeenCalled();

    const resumePromise = result.current.resumeCombatTurn();
    await waitFor(() => expect(result.current.combatTurnUiState.preflight).toBe('running'));
    resolveResumeRefresh?.(playerEncounter);
    await act(async () => {
      await resumePromise;
    });

    expect(result.current.combatTurnUiState).toEqual({
      holder: 'player-1',
      pendingIntent: null,
      preflight: 'ready',
    });
    expect(refreshCombatState).toHaveBeenCalledTimes(2);
  });

  /**
   * #1779: the client no longer starts combat. The server's turn-pipeline entry gate creates
   * the encounter before the turn returns, so a `start` envelope only carries audit context.
   * Ending combat is still a client-issued transition and is unchanged.
   */
  it('never issues a combat start, and still delegates combat end to userDataApi', async () => {
    const { AIService } = await import('@/services/ai-service');

    vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
      id: mockSessionId,
      campaign_id: 'c',
      character_id: 'ch',
      campaign: {},
      character: { id: 'ch', name: 'Rook' },
    } as any);
    (AIService.chatWithDM as any).mockResolvedValue({
      text: 'A goblin ambushes!',
      combat_transition: 'start',
      scene_spec: { width: 10, height: 10 },
      combatants: [{ monster_id: 'srd:goblin', name: 'Goblin', count: 1 }],
      combat_entry: {
        entered: true,
        encounterId: 'encounter-1',
        trigger: 'combat_transition',
        detail: 'combat_transition="start"',
        sceneSpecSynthesized: false,
      },
    });

    const { result } = renderHook(() => useAIResponse());
    const response = await result.current.getAIResponse(mockMessages as any, mockSessionId);

    // #1779 part 4: even though the client no longer starts combat, the envelope's
    // entry signals still have to reach the transcript for auditability.
    expect(response.context).toEqual(
      expect.objectContaining({ combat_transition: 'start', scene_spec: true }),
    );

    vi.mocked(userDataApi.endTacticalMap).mockResolvedValue({ ok: true } as any);
    (AIService.chatWithDM as any).mockResolvedValue({
      text: 'The encounter is over.',
      combat_transition: 'end',
    });
    await result.current.getAIResponse(
      [
        { text: 'I finish the last foe.', sender: 'player', timestamp: new Date().toISOString() },
      ] as any,
      mockSessionId,
    );

    expect(userDataApi.endTacticalMap).toHaveBeenCalledWith(mockSessionId);
  });

  it('sends DM map actions as one server batch and never retries client-side', async () => {
    const { AIService } = await import('@/services/ai-service');
    const mapAction = { action: 'move', entityId: 'goblin-1', x: 3, y: 4 };

    vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
      id: mockSessionId,
      campaign_id: 'c',
      character_id: 'ch',
      campaign: {},
      character: {},
    } as any);
    vi.mocked(userDataApi.applyDmTacticalActions).mockResolvedValue({
      ok: false,
      json: vi.fn().mockResolvedValue({ error: 'Blocked' }),
    } as any);
    (AIService.chatWithDM as any).mockResolvedValueOnce({
      text: 'The goblin moves.',
      map_actions: [mapAction],
    });

    const { result } = renderHook(() => useAIResponse());
    await result.current.getAIResponse(mockMessages as any, mockSessionId);

    // The server owns legality and the single corrective retry; the client
    // submits the whole batch once and does not re-prompt on refusal.
    expect(userDataApi.applyDmTacticalActions).toHaveBeenCalledTimes(1);
    expect(userDataApi.applyDmTacticalActions).toHaveBeenCalledWith(mockSessionId, [mapAction]);
    expect(userDataApi.applyTacticalMapAction).not.toHaveBeenCalled();
    expect(AIService.chatWithDM).toHaveBeenCalledTimes(1);
  });
  /**
   * #2139: `requestPlayerAttackRoll` and combat resolution both run inside
   * `handleDmActionsAndTransitions`, AFTER the early-text callback. An in-combat declaration
   * turn therefore carries no structured `roll_requests` at parse time and still gets resolved
   * by the engine, so the early render must be suppressed on combat turns too — not only on
   * turns that already carry a roll request.
   */
  it('suppresses the early render on an in-combat turn that carries no roll requests', async () => {
    const { AIService } = await import('@/services/ai-service');
    const { useCombat } = await import('@/contexts/CombatContext');
    const liveEncounter = {
      id: 'encounter-1',
      phase: 'active',
      currentTurnParticipantId: 'player-1',
      currentRound: 1,
      participants: [
        { id: 'player-1', characterId: 'char-1', name: 'Terra', participantType: 'player' },
      ],
    };

    vi.mocked(useCombat).mockReturnValue({
      state: { isInCombat: true, activeEncounter: liveEncounter },
      refreshCombatState: vi.fn().mockResolvedValue(liveEncounter),
    } as any);
    vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
      id: mockSessionId,
      campaign_id: 'c',
      character_id: 'char-1',
      campaign: {},
      character: { id: 'char-1' },
    } as any);
    vi.mocked(userDataApi.advanceNpcTurns).mockResolvedValue({ turns: [] } as any);

    const parsed = {
      text: 'Terra swings her longsword at Click.',
      roll_requests: [],
      combatDetection: { isCombat: true },
    };
    (AIService.chatWithDM as any).mockImplementation(async (params: any) => {
      await params.onTextReady?.(parsed);
      return parsed;
    });

    const onTextReady = vi.fn();
    const { result } = renderHook(() => useAIResponse());
    await act(async () => {
      await result.current.getAIResponse(
        mockMessages as any,
        mockSessionId,
        undefined,
        undefined,
        onTextReady,
      );
    });

    expect(onTextReady).toHaveBeenCalledTimes(1);
    expect(onTextReady.mock.calls[0][1]).toEqual({
      suppressRender: true,
      earlyRollPromptAllowed: false,
    });
  });

  /**
   * #2127: a preflight that ends combat clears `isInCombat`, but its NPC turns still belong
   * ahead of this turn's DM text. The early render must stay suppressed so the transcript
   * cannot show the speculative narration before the engine's NPC blocks.
   */
  it('suppresses the early render when preflight NPC turns ended combat', async () => {
    const { AIService } = await import('@/services/ai-service');
    const { useCombat } = await import('@/contexts/CombatContext');
    const liveEncounter = {
      id: 'encounter-1',
      phase: 'active',
      currentTurnParticipantId: 'npc-1',
      currentRound: 2,
      participants: [
        { id: 'player-1', characterId: 'char-1', name: 'Terra', participantType: 'player' },
        { id: 'npc-1', name: 'Click', participantType: 'npc' },
      ],
    };

    vi.mocked(useCombat).mockReturnValue({
      state: { isInCombat: true, activeEncounter: liveEncounter },
      // Turn start sees the live fight; the post-preflight refresh sees it ended.
      refreshCombatState: vi.fn().mockResolvedValueOnce(liveEncounter).mockResolvedValue(null),
    } as any);
    vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
      id: mockSessionId,
      campaign_id: 'c',
      character_id: 'char-1',
      campaign: {},
      character: { id: 'char-1' },
    } as any);
    vi.mocked(userDataApi.advanceNpcTurns).mockResolvedValue({
      results: [
        {
          action: {
            actor_id: 'npc-1',
            action_type: 'attack',
            target_ids: ['player-1'],
            weapon_id: null,
            spell_id: null,
            slot_level: null,
            movement_feet: 0,
          },
          outcomes: [],
          actorIsPlayer: false,
          transcriptLines: ['Click attacks Terra.'],
        },
      ],
      currentParticipant: null,
      combatEnded: true,
    } as any);

    const parsed = { text: 'The dust settles.', roll_requests: [] };
    (AIService.chatWithDM as any).mockImplementation(async (params: any) => {
      await params.onTextReady?.(parsed);
      return parsed;
    });

    const onTextReady = vi.fn();
    const { result } = renderHook(() => useAIResponse());
    await act(async () => {
      await result.current.getAIResponse(
        mockMessages as any,
        mockSessionId,
        undefined,
        undefined,
        onTextReady,
      );
    });

    expect(userDataApi.advanceNpcTurns).toHaveBeenCalled();
    expect(onTextReady).toHaveBeenCalledTimes(1);
    expect(onTextReady.mock.calls[0][1]).toEqual({
      suppressRender: true,
      earlyRollPromptAllowed: false,
    });
  });

  /**
   * #2190: on a combat-start turn the DM's `roll_requests` are an engine declaration channel,
   * not player dice prompts. The early callback must be told it may not prompt with them.
   */
  it('withholds the early roll prompt on a combat-start turn carrying initiative and attack', async () => {
    const { AIService } = await import('@/services/ai-service');

    vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
      id: mockSessionId,
      campaign_id: 'c',
      character_id: 'char-1',
      campaign: {},
      character: { id: 'char-1' },
    } as any);

    const parsed = {
      text: 'The Chiropteran Hulk drops from the rafters.',
      roll_requests: [
        { type: 'initiative', formula: '1d20+1', purpose: 'Initiative roll for the party' },
        { type: 'attack', formula: '1d20+5', purpose: 'Longsword attack vs Chiropteran Hulk' },
      ],
      combat_transition: 'start',
      combatDetection: { isCombat: true, shouldStartCombat: true },
    };
    (AIService.chatWithDM as any).mockImplementation(async (params: any) => {
      await params.onTextReady?.(parsed);
      return parsed;
    });

    const onTextReady = vi.fn();
    const { result } = renderHook(() => useAIResponse());
    await act(async () => {
      await result.current.getAIResponse(
        mockMessages as any,
        mockSessionId,
        undefined,
        undefined,
        onTextReady,
      );
    });

    expect(onTextReady).toHaveBeenCalledTimes(1);
    expect(onTextReady.mock.calls[0][1]).toEqual({
      suppressRender: true,
      earlyRollPromptAllowed: false,
    });
  });

  it('allows the early roll prompt for a narrative check outside combat', async () => {
    const { AIService } = await import('@/services/ai-service');

    vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
      id: mockSessionId,
      campaign_id: 'c',
      character_id: 'char-1',
      campaign: {},
      character: { id: 'char-1' },
    } as any);

    const parsed = {
      text: 'The panel has a seam you could work at.',
      roll_requests: [
        { type: 'skill_check', formula: '1d20+3', purpose: 'Investigation to find the catch' },
      ],
      combatDetection: { isCombat: false },
    };
    (AIService.chatWithDM as any).mockImplementation(async (params: any) => {
      await params.onTextReady?.(parsed);
      return parsed;
    });

    const onTextReady = vi.fn();
    const { result } = renderHook(() => useAIResponse());
    await act(async () => {
      await result.current.getAIResponse(
        mockMessages as any,
        mockSessionId,
        undefined,
        undefined,
        onTextReady,
      );
    });

    expect(onTextReady).toHaveBeenCalledTimes(1);
    expect(onTextReady.mock.calls[0][1]).toEqual({
      suppressRender: true,
      earlyRollPromptAllowed: true,
    });
  });

  it('keeps the early render on a non-combat turn with no roll requests', async () => {
    const { AIService } = await import('@/services/ai-service');

    vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
      id: mockSessionId,
      campaign_id: 'c',
      character_id: 'char-1',
      campaign: {},
      character: { id: 'char-1' },
    } as any);

    const parsed = {
      text: 'The tavern door creaks open.',
      roll_requests: [],
      combatDetection: { isCombat: false },
    };
    (AIService.chatWithDM as any).mockImplementation(async (params: any) => {
      await params.onTextReady?.(parsed);
      return parsed;
    });

    const onTextReady = vi.fn();
    const { result } = renderHook(() => useAIResponse());
    await act(async () => {
      await result.current.getAIResponse(
        mockMessages as any,
        mockSessionId,
        undefined,
        undefined,
        onTextReady,
      );
    });

    expect(onTextReady).toHaveBeenCalledTimes(1);
    expect(onTextReady.mock.calls[0][1]).toEqual({
      suppressRender: false,
      earlyRollPromptAllowed: false,
    });
    expect(onTextReady.mock.calls[0][0]).toMatchObject({ text: parsed.text, sender: 'dm' });
  });
});
