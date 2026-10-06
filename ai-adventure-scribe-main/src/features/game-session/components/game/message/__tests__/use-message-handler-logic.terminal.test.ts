/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #2517: the handler-logic half of the fallen end state (strategist FIX
 * items 1, 4, 5 on PR #2522). The AI-response hook is REAL here — only the
 * HTTP edges and contexts are stubbed — so these pin the whole chain:
 * session load → defeat check → terminalDeathState set, with no composer
 * error and no generic toast for a message that can never send.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMessageHandlerLogic } from '../use-message-handler-logic';

import { useCombat } from '@/contexts/CombatContext';
import { AIService } from '@/services/ai-service';
import { userDataApi } from '@/services/user-data-api';

const net = vi.hoisted(() => ({
  retryCallback: null as null | ((reconnecting: boolean) => void),
}));
const sendMessageMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());

vi.mock('@/contexts/MessageContext', () => ({
  useMessageContext: () => ({
    messages: [],
    messagesReady: true,
    sendMessage: sendMessageMock,
    updateMessage: vi.fn(),
  }),
}));
vi.mock('@/contexts/MemoryContext', () => ({
  useMemoryContext: () => ({ extractMemories: vi.fn(async () => {}) }),
}));
vi.mock('@/contexts/GameContext', () => ({
  useGame: () => ({
    processAiResponse: vi.fn(),
    state: { currentPhase: 'exploration', diceRollQueue: { pendingRolls: [] } },
    setGamePhase: vi.fn(),
  }),
}));
vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({
    state: { character: { id: 'char-1', name: 'The Scholar', avatar_url: undefined } },
  }),
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({ userPlan: 'pro' })),
}));
vi.mock('@/contexts/CombatContext', () => ({
  useCombat: vi.fn(() => ({
    state: { isInCombat: false, activeEncounter: null },
    refreshCombatState: vi.fn(async () => null),
  })),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: toastMock }) }));

vi.mock('../use-message-command-handler', () => ({
  useMessageCommandHandler: () => ({
    handleSafetyCommand: async () => ({ isSafetyCommand: false }),
    handleDiceCommand: async () => ({ isDiceCommand: false }),
  }),
}));
const sendQueue = vi.hoisted(() => ({
  actualSendMessageRef: { current: null as null | ((input: string) => Promise<void>) },
}));
vi.mock('../use-message-send-queue', () => ({
  useMessageSendQueue: () => ({
    handleSendMessage: (input: string) => sendQueue.actualSendMessageRef.current?.(input),
    isSending: false,
    actualSendMessageRef: sendQueue.actualSendMessageRef,
  }),
}));
vi.mock('../../session/SessionValidator', () => ({
  useSessionValidator: () => async () => true,
}));
vi.mock('../use-held-entry-recovery', () => ({ useHeldEntryRecovery: () => {} }));

vi.mock('@/infrastructure/api/rest-client', () => ({
  createTurnPhaseReporter: () => () => {},
  isNetworkError: () => false,
  QuotaExceededError: class QuotaExceededError extends Error {},
  SessionExpiredError: class SessionExpiredError extends Error {},
  SESSION_EXPIRED_MESSAGE: 'Session expired',
  subscribeToNetworkRetry: (cb: (reconnecting: boolean) => void) => {
    net.retryCallback = cb;
    return () => {};
  },
}));
vi.mock('@/services/combat/combat-action-executor', () => ({
  CombatIntentRefusedError: class CombatIntentRefusedError extends Error {},
}));
vi.mock('@/services/combat/combat-entry-confirmation-bridge', () => ({
  settlePendingCombatEntryConfirmation: () => {},
}));
vi.mock('@/services/combat/player-roll-bridge', async (importOriginal) => ({
  // Real bridge (no popup host is mounted, so nothing is ever pending); only the settle that the
  // handler fires on a timeout stays a no-op.
  ...(await importOriginal<Record<string, unknown>>()),
  settlePendingPlayerRoll: () => {},
}));
vi.mock('@/services/combat/spell-target-save-bridge', () => ({
  settlePendingSpellTargetSave: () => {},
}));
vi.mock('@/utils/error-handler', () => ({ handleAsyncError: vi.fn() }));

vi.mock('@/services/user-data-api', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    // The real refusal predicate: the queue/handler split only matters if
    // both layers recognize the same error.
    isTerminalDefeatError: actual.isTerminalDefeatError,
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
  };
});
vi.mock('@/services/ai-service', () => ({
  AIService: { chatWithDM: vi.fn(), lastRequestId: vi.fn() },
}));
vi.mock('@/services/memory-manager', () => ({
  MemoryManager: { getRelevantMemories: vi.fn().mockResolvedValue([]) },
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
        .mockResolvedValue('A. **Look around**.\nB. **Press on**.\nC. **Call out**.'),
    },
  };
});
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// What userDataApi.fetchSessionFallenState returns for run D2's session
// (character_stats.vital_state === 'dead' in the session load payload).
const fallenState = {
  characterId: 'char-1',
  characterName: 'The Scholar',
  campaignId: 'camp-1',
  campaignName: 'Abyssal Descent',
  starterCampaignId: null,
  diedAt: '2026-10-02T14:51:00.000Z',
};

const renderHandler = () =>
  renderHook(() =>
    useMessageHandlerLogic({
      sessionId: 'session-1',
      campaignId: null,
      characterId: 'char-1',
      turnCount: 0,
      updateGameSessionState: vi.fn(async () => {}),
    }),
  );

describe('useMessageHandlerLogic fallen end state (#2517)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    net.retryCallback = null;
    sendQueue.actualSendMessageRef.current = null;
    vi.mocked(userDataApi.fetchSessionFallenState).mockResolvedValue(null);
    vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
      id: 'session-1',
      campaign_id: 'camp-1',
      character_id: 'char-1',
      campaign: { id: 'camp-1', name: 'Abyssal Descent' },
      character: { id: 'char-1', name: 'The Scholar' },
    } as any);
    vi.mocked(AIService.chatWithDM).mockResolvedValue({
      text: 'The tale continues.',
      roll_requests: [],
    } as any);
    sendMessageMock.mockResolvedValue(undefined);
  });

  it('restores the end state on mount when the session character has fallen (load chain)', async () => {
    vi.mocked(userDataApi.fetchSessionFallenState).mockResolvedValue(fallenState);

    const { result } = renderHandler();

    await waitFor(() => {
      expect(result.current.terminalDeathState).toMatchObject({ state: 'party_defeated' });
    });
    expect(vi.mocked(userDataApi.fetchSessionFallenState)).toHaveBeenCalledWith('session-1');
  });

  it('turns a 409 terminal refusal into the end state, not a generic send error', async () => {
    // Mount alive — the end state below can only come from the 409 branch.
    const fetchFallen = vi.mocked(userDataApi.fetchSessionFallenState);
    fetchFallen.mockResolvedValue(null);
    // The exact error userDataApi.saveSessionMessages throws for a 409 with
    // the server's terminal body (UserDataApiRequestError: status + payload).
    sendMessageMock.mockRejectedValueOnce(
      Object.assign(new Error('This character has fallen and the tale has ended.'), {
        status: 409,
        payload: { terminalState: 'party_defeated' },
      }),
    );

    const { result } = renderHandler();
    await waitFor(() => {
      expect(fetchFallen).toHaveBeenCalledTimes(1);
    });
    expect(result.current.terminalDeathState).toBeNull();

    // The character fell after this tab loaded; the refused send re-reads.
    fetchFallen.mockResolvedValue(fallenState);
    await act(async () => {
      await result.current.handleSendMessage('Hello?');
    });

    await waitFor(() => {
      expect(result.current.terminalDeathState).toMatchObject({ state: 'party_defeated' });
    });
    expect(fetchFallen).toHaveBeenCalledTimes(2);
    expect(toastMock).not.toHaveBeenCalled();
    expect(result.current.sendError).toBeNull();
  });

  it('re-runs the defeat check when a reconnect completes', async () => {
    const fetchFallen = vi.mocked(userDataApi.fetchSessionFallenState);
    fetchFallen.mockResolvedValue(null);

    const { result } = renderHandler();
    // The mount check ran and found a living character.
    await waitFor(() => {
      expect(fetchFallen).toHaveBeenCalledTimes(1);
    });
    expect(result.current.terminalDeathState).toBeNull();

    // The character fell while this tab was offline; the reconnect re-checks.
    fetchFallen.mockResolvedValue(fallenState);
    act(() => {
      net.retryCallback?.(true);
    });
    act(() => {
      net.retryCallback?.(false);
    });

    await waitFor(() => {
      expect(result.current.terminalDeathState).toMatchObject({ state: 'party_defeated' });
    });
    expect(fetchFallen.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('#2518: the round that killed the character is saved as the DM’s paragraph beside the story', async () => {
    // The NPC turns ahead of the player's declaration kill the Scholar: the end state shows from
    // the engine's lines at once, and the DM is asked for the death's narration (run D2 had none).
    const activeEncounter = {
      id: 'encounter-789',
      phase: 'active',
      currentRound: 4,
      currentTurnParticipantId: 'npc-spider',
      participants: [
        { id: 'player-1', characterId: 'char-1', name: 'The Scholar', participantType: 'player' },
        { id: 'npc-spider', name: 'Vitruvian Spider', participantType: 'monster' },
      ],
    };
    vi.mocked(useCombat).mockReturnValue({
      state: { isInCombat: true, activeEncounter },
      refreshCombatState: vi.fn().mockResolvedValueOnce(activeEncounter).mockResolvedValue(null),
    } as any);
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
          transcriptLines: ['⚙️ Engine: The Scholar is DEAD.'],
        },
      ],
      currentParticipant: null,
      round: 4,
      combatEnded: true,
      endedReason: 'party_defeated',
      iterationCount: 1,
      iterationCap: 4,
      capReached: false,
      transcriptLines: ['⚙️ Engine: The Scholar is DEAD.'],
    } as any);
    vi.mocked(AIService.chatWithDM).mockResolvedValue({
      text: 'The Membrane takes the Scholar into its quiet.',
    } as any);

    const { result } = renderHandler();
    await waitFor(() => expect(vi.mocked(userDataApi.fetchSessionFallenState)).toHaveBeenCalled());
    await act(async () => {
      await result.current.handleSendMessage('I step back from the spider');
    });

    await waitFor(() => {
      expect(result.current.terminalDeathState).toMatchObject({
        state: 'party_defeated',
        finalLines: ['⚙️ Engine: The Scholar is DEAD.'],
      });
    });
    // The paragraph is saved as the DM's row, so "Read the story so far" ends on the death.
    const dmRows = sendMessageMock.mock.calls
      .map(([row]) => row)
      .filter((row: any) => row?.sender === 'dm');
    expect(dmRows).toHaveLength(1);
    expect(dmRows[0].text).toContain('The Membrane takes the Scholar into its quiet.');
    expect(toastMock).not.toHaveBeenCalled();
  });
});
