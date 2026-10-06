/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

import { useAIResponse, type EnhancedChatMessage } from '../use-ai-response';

import { useCombat } from '@/contexts/CombatContext';
import { formatDiceRoll } from '@/features/game-session/components/chat/message-list/utils/dice-roll-formatter';
import { NEUTRAL_NO_EFFECT_LINE } from '@/hooks/ai/narration-gate';
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
    vi.mocked(userDataApi.fetchSessionFallenState).mockReset();
    vi.mocked(userDataApi.fetchSessionFallenState).mockResolvedValue(null);
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

  it('#2456: sets terminalDeathState when the AI service returns party_defeated', async () => {
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
      text: '',
      terminalState: 'party_defeated',
      terminalEncounterId: 'encounter-456',
    });

    const { result } = renderHook(() => useAIResponse());
    let response: EnhancedChatMessage | null = null;
    await act(async () => {
      response = await result.current.getAIResponse(mockMessages as any, mockSessionId);
    });

    expect(response!.context?.terminalState).toBe('party_defeated');
    await waitFor(() => {
      expect(result.current.terminalDeathState).toMatchObject({
        state: 'party_defeated',
        encounterId: 'encounter-456',
      });
    });
  });

  it('#2517/#2518: NPC preflight that defeats the party shows the death state at once, then asks the DM for the killing round', async () => {
    const { AIService } = await import('@/services/ai-service');

    const mockSessionData = {
      id: mockSessionId,
      campaign_id: 'camp-1',
      character_id: 'char-1',
      campaign: { id: 'camp-1', name: 'Camp' },
      character: { id: 'char-1', name: 'Char' },
    };
    vi.mocked(userDataApi.getSessionContext).mockResolvedValue(mockSessionData as any);

    // Combat truth as refreshCombatState returns it: an active encounter held
    // by the NPC. After the advance the encounter is gone (combat concluded).
    const activeEncounter = {
      id: 'encounter-789',
      phase: 'active',
      currentRound: 4,
      currentTurnParticipantId: 'npc-spider',
      participants: [
        { id: 'player-1', characterId: 'char-1', name: 'Char', participantType: 'player' },
        { id: 'npc-spider', name: 'Vitruvian Spider', participantType: 'monster' },
      ],
    };
    const refreshCombatState = vi
      .fn()
      .mockResolvedValueOnce(activeEncounter)
      .mockResolvedValue(null);
    vi.mocked(useCombat).mockReturnValue({
      state: { isInCombat: true, activeEncounter },
      refreshCombatState,
    } as any);

    // Fixture follows the real producer: POST /v1/combat/sessions/:id/advance-npc-turns
    // returning the npc-turn-runner's AdvanceNpcTurnsResult plus the route's
    // #2517 endedReason. Lines are the engine's own, as in run D2 (#2516).
    const deathLines = [
      '⚙️ Engine: Vitruvian Spider rolled 11 + 3 = 14 vs AC 11 against Char with strike — HIT. 3 piercing damage. Char is now at 0 HP and is unconscious.',
      '⚙️ Engine: Rolled 2: the third failure. Char is dead.',
    ];
    vi.mocked(userDataApi.advanceNpcTurns).mockResolvedValue({
      results: [
        {
          action: {
            actor_id: 'npc-spider',
            action_type: 'attack',
            target_ids: ['player-1'],
            weapon_id: null,
            spell_id: null,
            slot_level: null,
            movement_feet: 0,
          },
          round: 4,
          outcomes: [],
          actorIsPlayer: false,
          transcriptLines: deathLines,
        },
      ],
      currentParticipant: null,
      round: 4,
      combatEnded: true,
      endedReason: 'party_defeated',
      iterationCount: 1,
      iterationCap: 4,
      capReached: false,
      transcriptLines: deathLines,
    } as any);

    // #2518: the killing round gets its narration paragraph (run D2 had none). The DM is asked
    // from the engine's results alone and told the fight is over.
    vi.mocked(AIService.chatWithDM).mockResolvedValue({
      text: 'The spider’s fangs find the Scholar a last time, and the Membrane goes quiet.',
    } as any);

    const { result } = renderHook(() => useAIResponse());
    let response: EnhancedChatMessage | null = null;
    await act(async () => {
      response = await result.current.getAIResponse(mockMessages as any, mockSessionId);
    });

    // The death screen state came from the combat resolution, not from the DM's words…
    expect(response!.context?.terminalState).toBe('party_defeated');
    // …and the DM is called exactly once, for the narration: no declaration, a concluded fight.
    expect(AIService.chatWithDM).toHaveBeenCalledTimes(1);
    const asked = vi.mocked(AIService.chatWithDM).mock.calls[0][0] as {
      message: string;
      context: any;
    };
    expect(JSON.parse(asked.message)).toMatchObject({ encounterAlreadyConcluded: true });
    expect(asked.context.gameState.resolutionOnly).toBe(true);
    // The paragraph rides on the terminal reply for the handler to save beside the story.
    expect(response!.text).toContain('the Membrane goes quiet');
    await waitFor(() => {
      expect(result.current.terminalDeathState).toMatchObject({
        state: 'party_defeated',
        encounterId: 'encounter-789',
        finalLines: deathLines,
      });
    });
  });

  it('#2517: checkRestoredDefeat restores the death state for an already-defeated session', async () => {
    // Follows the real producer: userDataApi.fetchSessionFallenState reads
    // character_stats.vital_state from the session load payload.
    vi.mocked(userDataApi.fetchSessionFallenState).mockResolvedValue({
      characterId: 'char-1',
      characterName: 'The Scholar',
      campaignId: 'camp-1',
      campaignName: 'Abyssal Descent',
      starterCampaignId: null,
      diedAt: '2026-10-02T14:51:00.000Z',
    });

    const { result } = renderHook(() => useAIResponse());
    let restored = false;
    await act(async () => {
      restored = await result.current.checkRestoredDefeat(mockSessionId);
    });

    expect(restored).toBe(true);
    await waitFor(() => {
      expect(result.current.terminalDeathState).toMatchObject({
        state: 'party_defeated',
        encounterId: null,
      });
    });
  });

  it('#2517: checkRestoredDefeat leaves a live session without a death state', async () => {
    vi.mocked(userDataApi.fetchSessionFallenState).mockResolvedValue(null);

    const { result } = renderHook(() => useAIResponse());
    let restored = true;
    await act(async () => {
      restored = await result.current.checkRestoredDefeat(mockSessionId);
    });

    expect(restored).toBe(false);
    expect(result.current.terminalDeathState).toBeNull();
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
        expect.objectContaining({
          dmReply: { messageId: DM_ID, inCombat: false, narrationGated: true },
        }),
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
        expect.objectContaining({
          dmReply: { messageId: DM_ID, inCombat: true, narrationGated: false },
        }),
      );
    });

    it('tells the server a dice-roll turn is not gated, so its reply is kept even with harm words', async () => {
      const { AIService } = await import('@/services/ai-service');
      vi.mocked(userDataApi.getSessionContext).mockResolvedValue(sessionContext as any);
      (AIService.chatWithDM as any).mockResolvedValue({ text: 'The blade bites your arm.' });

      const { result } = renderHook(() => useAIResponse());
      await result.current.getAIResponse(
        [
          {
            text: 'I rolled 4',
            sender: 'player',
            timestamp: new Date().toISOString(),
            context: { intent: 'dice_roll' },
          },
        ] as any,
        mockSessionId,
        undefined,
        undefined,
        undefined,
        DM_ID,
      );

      expect(AIService.chatWithDM).toHaveBeenCalledWith(
        expect.objectContaining({
          dmReply: { messageId: DM_ID, inCombat: false, narrationGated: false },
        }),
      );
    });

    // #2609: the live wiring at use-ai-response.ts:798-800 — the roll-outcome
    // gate opens from the dice-UI intent on the message, not from its text.
    it('passes isDiceRollMessage: true to chatWithDM for a dice-UI roll message', async () => {
      const { AIService } = await import('@/services/ai-service');
      vi.mocked(userDataApi.getSessionContext).mockResolvedValue(sessionContext as any);
      (AIService.chatWithDM as any).mockResolvedValue({ text: 'The moss holds your weight.' });

      // Real producer fixture: the dice UI formats the player message with
      // formatDiceRoll and sends intent 'dice_roll' (use-message-dice-rolls).
      const rollRequest = {
        id: 'roll-2609-ui-1',
        requestType: 'skill_check',
        description: 'Athletics Check',
        rollConfig: { dieType: 20, count: 1, modifier: 3 },
        timestamp: new Date('2026-10-05T18:00:00.000Z'),
        status: 'completed',
        result: {
          dieType: 20,
          count: 1,
          modifier: 3,
          results: [10],
          keptResults: [10],
          total: 13,
          naturalRoll: 10,
        },
        dc: 15,
      };

      const { result } = renderHook(() => useAIResponse());
      await result.current.getAIResponse(
        [
          {
            text: formatDiceRoll(rollRequest as any),
            sender: 'player',
            timestamp: new Date().toISOString(),
            context: {
              intent: 'dice_roll',
              diceRoll: {
                formula: '1d20+3',
                count: 1,
                dieType: 20,
                modifier: 3,
                total: 13,
                naturalRoll: 10,
                requestType: 'skill_check',
                description: 'Athletics Check',
                dc: 15,
                success: false,
                timestamp: new Date().toISOString(),
              },
            },
          },
        ] as any,
        mockSessionId,
        undefined,
        undefined,
        undefined,
        DM_ID,
      );

      expect((AIService.chatWithDM as any).mock.calls[0][0]).toEqual(
        expect.objectContaining({ isDiceRollMessage: true }),
      );
    });

    it('does not set isDiceRollMessage for a typed "I rolled 17" message', async () => {
      const { AIService } = await import('@/services/ai-service');
      vi.mocked(userDataApi.getSessionContext).mockResolvedValue(sessionContext as any);
      (AIService.chatWithDM as any).mockResolvedValue({ text: 'Noted.' });

      const { result } = renderHook(() => useAIResponse());
      await result.current.getAIResponse(
        [
          {
            text: 'I rolled 17',
            sender: 'player',
            timestamp: new Date().toISOString(),
            context: { intent: 'query' },
          },
        ] as any,
        mockSessionId,
        undefined,
        undefined,
        undefined,
        DM_ID,
      );

      // The flag is derived from the dice-UI intent only: deriving it from
      // message text must not sneak the property onto the call.
      expect((AIService.chatWithDM as any).mock.calls[0][0]).not.toHaveProperty(
        'isDiceRollMessage',
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

    // #2563: the call now also carries the abort signal and declared exits slots.
    expect(userDataApi.endTacticalMap).toHaveBeenCalledWith(mockSessionId, undefined, undefined);
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
  // #2373: outside combat, a turn with no roll, dice result or combat declaration has no engine
  // line, so the DM's reply is the only account of it. One that claims harm is rejected.
  describe('#2373: a narrative turn with no engine event', () => {
    const sessionContext = {
      id: mockSessionId,
      campaign_id: 'c',
      character_id: 'char-1',
      campaign: {},
      character: { id: 'char-1' },
    };
    const HARM =
      'The guard turns on you. As you speak, you narrowly avoid a strike from his halberd, though a ' +
      'glancing blow still leaves you feeling rattled and wounded.';
    const CLEAN =
      'The guard folds his arms and studies you in silence, then nods you toward the gate.';

    const play = async (
      replies: Array<Record<string, unknown>>,
      messages: unknown[] = mockMessages,
      onTextReady?: (...args: any[]) => unknown,
    ): Promise<{
      chat: Mock;
      response: EnhancedChatMessage;
    }> => {
      const { AIService } = await import('@/services/ai-service');
      vi.mocked(userDataApi.getSessionContext).mockResolvedValue(sessionContext as any);
      vi.mocked(AIService.lastRequestId).mockReturnValue('req-narrative');
      const chat = vi.mocked(AIService.chatWithDM);
      // A failed test must not leave its queued replies for the next one.
      chat.mockReset();
      for (const raw of replies) {
        // The envelope processDMResponse produces: every array present, the transition 'none'.
        const reply = {
          roll_requests: [],
          combat_actions: [],
          combat_transition: 'none',
          map_actions: [],
          handout_actions: [],
          ...raw,
        };
        chat.mockImplementationOnce(async (params: any) => {
          await params.onTextReady?.(reply);
          return reply as never;
        });
      }
      const { result } = renderHook(() => useAIResponse());
      const response = await result.current.getAIResponse(
        messages as any,
        mockSessionId,
        undefined,
        undefined,
        onTextReady as any,
      );
      return { chat, response };
    };

    it('asks again with the violation named and uses the clean reply', async () => {
      const { chat, response } = await play([{ text: HARM }, { text: CLEAN }]);

      expect(chat).toHaveBeenCalledTimes(2);
      const retry = chat.mock.calls[1][0];
      // The violation travels in its own field: the player's message is what memory extraction
      // and the context builder see, untouched.
      expect(retry.message).toBe('Hello');
      expect(retry.narrationViolation).toContain('Your previous reply for this turn was rejected');
      expect(retry.narrationViolation).toContain('strike from his halberd');
      // The second ask renders nothing early, and the server keeps nothing.
      expect(retry.onTextReady).toBeUndefined();
      expect(retry).not.toHaveProperty('dmReply');
      expect(response.text).toContain(CLEAN);
      expect(response.text).not.toContain('halberd');
      expect(logger.warn).toHaveBeenCalledWith(
        'DM_NARRATION_REJECTED',
        expect.objectContaining({
          reason: 'harm_claim_without_engine_event',
          sessionId: mockSessionId,
          requestId: 'req-narrative',
          branch: 'narrative',
          attempt: 1,
        }),
      );
    });

    it('says nothing happened when the second reply claims harm again', async () => {
      const { chat, response } = await play([
        { text: HARM, narrationSegments: [{ type: 'narration', text: HARM }] },
        { text: HARM },
      ]);

      expect(chat).toHaveBeenCalledTimes(2);
      expect(response.text).toContain(NEUTRAL_NO_EFFECT_LINE);
      expect(response.text).not.toContain('halberd');
      expect(response.narrationSegments).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        'DM_NARRATION_REJECTED',
        expect.objectContaining({ attempt: 2, branch: 'narrative' }),
      );
    });

    it('passes a reply with no harm claims untouched, with one DM call', async () => {
      const { chat, response } = await play([{ text: CLEAN }]);

      expect(chat).toHaveBeenCalledTimes(1);
      expect(response.text).toContain(CLEAN);
      expect(logger.warn).not.toHaveBeenCalledWith('DM_NARRATION_REJECTED', expect.anything());
    });

    it('lets the player’s own spell through: it is their action, narrated', async () => {
      const own = 'Your spell lights the corridor, and the guard shields his eyes.';
      const { chat, response } = await play([{ text: own }]);

      expect(chat).toHaveBeenCalledTimes(1);
      expect(response.text).toContain(own);
    });

    it.each([
      [
        'a roll request the dice popup owns',
        [{ text: HARM, roll_requests: [{ type: 'skill' }] }],
        mockMessages,
      ],
      [
        'a dice result the player just submitted',
        [{ text: HARM }],
        [{ text: 'I rolled 4', sender: 'player', context: { intent: 'dice_roll' } }],
      ],
      [
        'a turn no player message started',
        [{ text: HARM }],
        [{ text: 'Begin.', sender: 'dm', timestamp: new Date().toISOString() }],
      ],
      ['a combat declaration', [{ text: HARM, combat_actions: [{}] }], mockMessages],
    ])('stands down for %s: the DM is not asked again', async (_label, replies, messages) => {
      const { chat } = await play(replies as any, messages as any);

      expect(chat).toHaveBeenCalledTimes(1);
      expect(logger.warn).not.toHaveBeenCalledWith('DM_NARRATION_REJECTED', expect.anything());
    });

    describe('a rejected reply writes nothing', () => {
      const held = (): { heldSideEffects: ReturnType<typeof vi.fn> } => ({
        heldSideEffects: vi.fn().mockResolvedValue(undefined),
      });

      it('parks the first ask’s memory writes and runs only the reply it keeps', async () => {
        const rejected = held();
        const kept = held();

        const { chat } = await play([
          { text: HARM, ...rejected },
          { text: CLEAN, ...kept },
        ]);

        expect(chat.mock.calls[0][0].holdSideEffects).toBe(true);
        expect(chat.mock.calls[1][0].holdSideEffects).toBe(true);
        expect(rejected.heldSideEffects).not.toHaveBeenCalled();
        expect(kept.heldSideEffects).toHaveBeenCalledTimes(1);
      });

      it('writes nothing for either reply when both claim harm', async () => {
        const first = held();
        const second = held();

        const { response } = await play([
          { text: HARM, ...first },
          { text: HARM, ...second },
        ]);

        expect(response.text).toContain(NEUTRAL_NO_EFFECT_LINE);
        expect(first.heldSideEffects).not.toHaveBeenCalled();
        expect(second.heldSideEffects).not.toHaveBeenCalled();
      });

      it('runs a clean reply’s writes, and those of a turn the gate stands down for', async () => {
        const clean = held();
        await play([{ text: CLEAN, ...clean }]);
        expect(clean.heldSideEffects).toHaveBeenCalledTimes(1);

        const rolled = held();
        await play([{ text: HARM, roll_requests: [{ type: 'skill' }], ...rolled }]);
        expect(rolled.heldSideEffects).toHaveBeenCalledTimes(1);
      });
    });

    it('stands down when the pre-flight NPC turns ended the fight: the DM is describing the engine’s own hit', async () => {
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
            transcriptLines: ['Click hits Terra for 3 damage.'],
          },
        ],
        currentParticipant: null,
        combatEnded: true,
      } as any);
      const account = 'Click’s last lash strikes you down, and the fight is over.';
      const kept = { heldSideEffects: vi.fn().mockResolvedValue(undefined) };

      const { chat, response } = await play([{ text: account, ...kept }]);

      expect(userDataApi.advanceNpcTurns).toHaveBeenCalled();
      expect(chat).toHaveBeenCalledTimes(1);
      expect(chat.mock.calls[0][0]).not.toHaveProperty('holdSideEffects');
      expect(logger.warn).not.toHaveBeenCalledWith('DM_NARRATION_REJECTED', expect.anything());
      expect(response.text).toContain(account);
      expect(response.text).not.toContain(NEUTRAL_NO_EFFECT_LINE);
    });

    it('holds back the early render of a reply the gate will reject, and only that', async () => {
      const early = vi.fn();
      await play([{ text: HARM }, { text: CLEAN }], mockMessages, early);
      expect(early).toHaveBeenCalledTimes(1);
      expect(early.mock.calls[0][1]).toMatchObject({ suppressRender: true });

      early.mockClear();
      await play([{ text: CLEAN }], mockMessages, early);
      expect(early.mock.calls[0][1]).toMatchObject({ suppressRender: false });
    });
  });
});
