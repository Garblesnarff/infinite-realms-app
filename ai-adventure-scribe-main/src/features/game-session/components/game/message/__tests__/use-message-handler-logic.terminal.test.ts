/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #2517: the handler-logic half of the fallen end state (strategist FIX
 * items 1, 4, 5 on PR #2522). The AI-response hook is REAL here — only the
 * HTTP edges and contexts are stubbed — so these pin the whole chain:
 * session load → defeat check → terminalDeathState set, with no composer
 * error and no generic toast for a message that can never send.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildNpcEngineMessage } from '../../../../../../../shared/npc-engine-message';
import { useMessageHandlerLogic } from '../use-message-handler-logic';

import { useCombat } from '@/contexts/CombatContext';
import { AIService } from '@/services/ai-service';
import { setPlayerRollHost } from '@/services/combat/player-roll-bridge';
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
vi.mock('@/hooks/use-toast', () => ({
  toast: toastMock,
  useToast: () => ({ toast: toastMock }),
}));

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
  fetchWithAuth: (input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init),
  isNetworkError: () => false,
  QuotaExceededError: class QuotaExceededError extends Error {},
  SessionExpiredError: class SessionExpiredError extends Error {},
  SESSION_EXPIRED_MESSAGE: 'Session expired',
  subscribeToNetworkRetry: (cb: (reconnecting: boolean) => void) => {
    net.retryCallback = cb;
    return () => {};
  },
}));
// The executor is real: the #2518 test drives it through `fetch`, as the browser does.
// The real pending-input helpers stay live (#354): the test seeds a pending
// snapshot and asserts the handler clears it when the player row persists.
vi.mock('@/services/auth/TokenService', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer test' })),
    getAccessToken: vi.fn(() => 'test'),
  };
});
vi.mock('@/services/combat/combat-zero-action-guard', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  enforceCombatActionOnAttempt: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/services/combat/combat-entry-confirmation-bridge', () => ({
  settlePendingCombatEntryConfirmation: () => {},
  hasPendingCombatEntryConfirmation: () => false,
  markCombatEntryTypedAnswer: () => {},
  consumeCombatEntryTypedAnswer: () => false,
  onCombatEntryConfirmationPendingChange: () => () => {},
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
      applyDmTacticalActions: vi.fn(),
      detectDeclaredAttack: vi.fn(),
      applyDmHandoutActions: vi.fn(),
      clearPendingCombatIntent: vi.fn(),
      fetchSessionFallenState: vi.fn(),
      reportClientFailure: vi.fn(),
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

  afterEach(() => {
    setPlayerRollHost(null);
    vi.unstubAllGlobals();
  });

  // Migrated (#2658 step 3): was "#2518: the round that killed the character is saved as the DM’s paragraph beside the story"
  it('#2518: the creatures the server runs on the player’s End turn kill the Scholar; that round is saved as the DM’s paragraph beside the story', async () => {
    // The player swings at the spider and it survives; the keyed End turn that closes the
    // player's turn is answered after the server ran the spider, and its blow kills the Scholar.
    // The end state shows the server's killing row at once, and the DM's narration of that round
    // is saved as the turn's one DM row (run D2 had none).
    let held = 'player-1';
    const encounterHeldBy = (participantId: string) => ({
      id: 'encounter-789',
      phase: 'active',
      currentRound: 4,
      currentTurnParticipantId: participantId,
      participants: [
        {
          id: 'player-1',
          characterId: 'char-1',
          name: 'The Scholar',
          participantType: 'player',
          isActive: true,
        },
        { id: 'npc-spider', name: 'Vitruvian Spider', participantType: 'monster', isActive: true },
      ],
    });
    vi.mocked(useCombat).mockReturnValue({
      state: { isInCombat: true, activeEncounter: encounterHeldBy('player-1') },
      // The board is gone once the spider's blow ends the fight.
      refreshCombatState: vi.fn(async () => (held ? encounterHeldBy(held) : null)),
    } as any);
    vi.mocked(userDataApi.getTacticalMapContext).mockResolvedValue({ ok: false } as any);
    setPlayerRollHost({
      present: (_spec, settle) => {
        queueMicrotask(() => settle({ d20: 12 }));
        return { rollId: 'roll-attack', dismiss: () => {} };
      },
    });
    // The spider's killing blow as the server's runner reports it (an AdvanceNpcTurnsResult entry),
    // and the row writeNpcEngineRow stores for it: buildNpcEngineMessage over that result.
    const spiderKills = {
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
      outcomes: [{ participantId: 'player-1', hit: true, finalDamage: 18, newHp: 0 }],
      engineResult: {
        actorName: 'Vitruvian Spider',
        targetName: 'The Scholar',
        d20: 19,
        attackBonus: 4,
        totalAttackRoll: 23,
        targetAC: 11,
        hit: true,
        finalDamage: 18,
        damageType: 'piercing',
        targetNewHp: 0,
        targetIsConscious: false,
        targetIsDead: true,
        targetCondition: 'dead',
        // Massive damage (SRD 5.1): 9 left after 0 HP equals the 9 HP maximum.
        instantDeath: true,
        damageOverflow: 9,
        hpMaximum: 9,
        combatEnded: true,
        endedReason: 'party_defeated',
      },
      actorIsPlayer: false,
      transcriptLines: [],
    };
    const actionId = 'encounter-789:4:npc-spider:attack';
    const message = buildNpcEngineMessage(
      [
        { id: 'player-1', name: 'The Scholar', participantType: 'player', maxHp: 9 },
        { id: 'npc-spider', name: 'Vitruvian Spider', participantType: 'monster' },
      ],
      4,
      { type: 'attack', actorId: 'npc-spider', targetIds: ['player-1'] },
      spiderKills.engineResult,
    );
    const killingRow = {
      id: 'npc-row-spider',
      sequence: 41,
      text: message.text,
      kind: 'npc',
      actionId,
      sessionId: 'session-1',
      timestamp: new Date().toISOString(),
      context: {
        ...message.context,
        npcResult: spiderKills.engineResult,
        combatEncounterId: 'encounter-789',
        actionId,
      },
    };
    const sent: Array<Record<string, any>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        // #1095: this stub stands in for the engine-intent transport only.
        // Non-intent traffic (e.g. the session-trackers GET) is not an
        // intent and must neither be recorded nor answered as one.
        if (!String(_url).includes('/intent')) {
          return new Response(JSON.stringify({}), { status: 200 });
        }
        const body = JSON.parse(String(init?.body ?? '{}'));
        sent.push(body);
        if (body.phase === 'propose') {
          return new Response(
            JSON.stringify({
              proposal: {
                movementOnly: false,
                legal: true,
                weaponName: 'Quarterstaff',
                attackBonus: 5,
                targetAc: 15,
                advantage: false,
                disadvantage: false,
                targetLabel: 'Vitruvian Spider',
              },
            }),
            { status: 200 },
          );
        }
        if (body.intent?.type === 'attack') {
          return new Response(
            JSON.stringify({
              result: {
                actorName: 'The Scholar',
                targetName: 'Vitruvian Spider',
                d20: 12,
                attackBonus: 5,
                totalAttackRoll: 17,
                targetAC: 15,
                hit: true,
                finalDamage: 3,
                damageType: 'bludgeoning',
                targetNewHp: 9,
                targetCondition: 'wounded',
                weaponResolution: { resolved: 'Quarterstaff', substituted: false },
              },
            }),
            { status: 200 },
          );
        }
        if (body.intent?.type === 'end_turn') {
          // The intent route's body (#2658 step 3): the server ran the spider before answering.
          held = '';
          const npcTurns = {
            results: [spiderKills],
            currentParticipant: null,
            round: 4,
            combatEnded: true,
            endedReason: 'party_defeated',
            iterationCount: 1,
            iterationCap: 4,
            capReached: false,
            transcriptLines: [],
            engineRows: [killingRow],
          };
          return new Response(
            JSON.stringify({
              accepted: true,
              result: {
                currentParticipant: { id: 'npc-spider', name: 'Vitruvian Spider' },
                npcTurns,
                engineRows: [killingRow],
              },
              engineRows: [killingRow],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ result: {} }), { status: 200 });
      }),
    );
    vi.mocked(AIService.chatWithDM)
      .mockResolvedValueOnce({
        text: 'You swing your staff at the spider.',
        roll_requests: [],
        combat_actions: [
          {
            actor_id: 'player-1',
            action_type: 'attack',
            target_ids: ['npc-spider'],
            weapon_id: null,
            spell_id: null,
            slot_level: null,
            movement_feet: 0,
          },
        ],
      } as any)
      .mockResolvedValue({ text: 'The Membrane takes the Scholar into its quiet.' } as any);

    const { result } = renderHandler();
    await waitFor(() => expect(vi.mocked(userDataApi.fetchSessionFallenState)).toHaveBeenCalled());
    vi.mocked(userDataApi.fetchSessionFallenState).mockResolvedValue(fallenState);
    await act(async () => {
      await result.current.handleSendMessage('I swing my staff at the spider');
    });

    // The keyed End turn is the one request that ran the spider: nothing asked for it after.
    const endTurn = sent.find((body) => body.intent?.type === 'end_turn');
    expect(typeof endTurn?.intent.actionId).toBe('string');
    expect(sent.at(-1)).toBe(endTurn);
    expect(killingRow.text).toContain('DEAD');
    await waitFor(() => {
      expect(result.current.terminalDeathState).toMatchObject({
        state: 'party_defeated',
        finalLines: [killingRow.text],
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

describe('useMessageHandlerLogic pending-input lifecycle (#354)', () => {
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
    sessionStorage.clear();
  });

  it('clears the pending composer input when the server accepts the turn, even mid-turn', async () => {
    const { savePendingInput, loadPendingInput } = await import('@/services/auth/TokenService');
    // Hang the DM reply: the turn stays in flight after the player row persists.
    vi.mocked(AIService.chatWithDM).mockReturnValue(new Promise(() => {}) as any);

    savePendingInput('already sent');
    expect(loadPendingInput()).toBe('already sent');

    const { result } = renderHandler();
    await act(async () => {
      // Deliberately not awaited: the turn never completes in this test.
      void result.current.handleSendMessage('already sent');
    });

    // The player row hit the server…
    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({ sender: 'player', text: 'already sent' }),
      );
    });
    // …so a reload now must NOT refill the composer, even though the DM turn
    // is still in flight. (Before #354 the snapshot survived until turn end:
    // one tap on Send after such a reload duplicated the turn.)
    expect(loadPendingInput()).toBe('');
  });

  it('keeps the pending composer input when the player row is never accepted', async () => {
    const { savePendingInput, loadPendingInput } = await import('@/services/auth/TokenService');
    sendMessageMock.mockRejectedValueOnce(new Error('network down'));

    savePendingInput('never accepted');
    const { result } = renderHandler();
    await act(async () => {
      await expect(result.current.handleSendMessage('never accepted')).rejects.toThrow(
        'network down',
      );
    });

    // The server never saw the turn: the snapshot stays for the retry path.
    expect(loadPendingInput()).toBe('never accepted');
    expect(result.current.sendError).not.toBeNull();
  });
});
