/**
 * #1811 — a hero dying outside a fight spends each sent message on one
 * engine death save. Real `handleSendMessage` / `useMessageHandlerLogic`.
 * Stubbed: send-queue / `getAIResponse`, `sendMessage` persistence, and
 * `fetchWithAuth` for the death-save route.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEATH_SAVE_WIRE_BODY } from '../../../../../../../shared/test-fixtures/death-save-body';
import { useMessageHandlerLogic } from '../use-message-handler-logic';

const sendMessageMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());
const getAIResponseMock = vi.hoisted(() => vi.fn());
const fetchWithAuthMock = vi.hoisted(() => vi.fn());
const queueCtl = vi.hoisted(() => ({
  isSending: false,
  actualSendMessageRef: {
    current: null as null | ((input: string, context?: unknown) => Promise<void>),
  },
  handleSendMessage: vi.fn(async (_input: string, _context?: unknown) => {}),
}));

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
    state: {
      currentPhase: 'exploration',
      isInCombat: false,
      diceRollQueue: { pendingRolls: [] },
    },
  }),
}));
const characterCtl = vi.hoisted(() => ({
  character: { id: 'char-1', name: 'The Scholar' } as Record<string, unknown>,
  dispatch: vi.fn(),
}));

vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({
    state: { character: characterCtl.character },
    dispatch: characterCtl.dispatch,
  }),
}));
vi.mock('@/contexts/CombatContext', () => ({
  useCombat: () => ({
    state: { activeEncounter: null },
    refreshCombatState: vi.fn(),
  }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: toastMock }) }));
const checkRestoredDefeatMock = vi.hoisted(() => vi.fn(async () => false));

vi.mock('@/hooks/use-ai-response', () => ({
  useAIResponse: () => ({
    getAIResponse: getAIResponseMock,
    checkRestoredDefeat: checkRestoredDefeatMock,
  }),
}));
vi.mock('../use-message-command-handler', () => ({
  useMessageCommandHandler: () => ({
    handleSafetyCommand: async () => ({ isSafetyCommand: false }),
    handleDiceCommand: async () => ({ isDiceCommand: false }),
  }),
}));
vi.mock('../use-message-send-queue', () => ({
  useMessageSendQueue: () => ({
    handleSendMessage: (input: string, context?: unknown) =>
      queueCtl.handleSendMessage(input, context),
    isSending: queueCtl.isSending,
    actualSendMessageRef: queueCtl.actualSendMessageRef,
  }),
}));
vi.mock('../../session/SessionValidator', () => ({
  useSessionValidator: () => async () => true,
}));
vi.mock('../use-held-entry-recovery', () => ({
  useHeldEntryRecovery: () => {},
  playerMessageIsStillNewest: async () => true,
}));
vi.mock('@/infrastructure/api/rest-client', () => ({
  createTurnPhaseReporter: () => () => {},
  isNetworkError: () => false,
  QuotaExceededError: class QuotaExceededError extends Error {},
  DmProviderKeyLimitError: class DmProviderKeyLimitError extends Error {},
  SessionExpiredError: class SessionExpiredError extends Error {},
  SESSION_EXPIRED_MESSAGE: 'Session expired',
  subscribeToNetworkRetry: () => (): void => {},
  fetchWithAuth: fetchWithAuthMock,
}));
vi.mock('@/services/auth/TokenService', () => ({ clearPendingInput: vi.fn() }));
vi.mock('@/services/user-data-api', () => ({
  isTerminalDefeatError: () => false,
  userDataApi: { enterCombat: vi.fn() },
}));
vi.mock('@/utils/error-handler', () => ({ handleAsyncError: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../../chat/message-list/use-message-dice-rolls', () => ({
  useMessageDiceRolls: () => ({
    currentRoll: null,
    batchProgress: null,
    rollRequest: null,
    handleManualResult: vi.fn(),
    handleCancelRoll: vi.fn(),
    lastRollRef: { current: null },
  }),
}));
vi.mock('../../../chat/message-list/use-pending-dm-roll-recovery', () => ({
  usePendingDmRollRecovery: () => {},
}));
vi.mock('../../../chat/message-list/use-live-dm-fallback-push', () => ({
  useLiveDmFallbackPush: () => {},
}));
vi.mock('@/hooks/combat/use-player-roll-host', () => ({ usePlayerRollHost: vi.fn() }));
vi.mock('@/hooks/combat/use-pending-combat-entry-offer', () => ({
  usePendingCombatEntryOffer: () => {},
}));
vi.mock('../../../chat/message-list/MessageRenderer', () => ({
  MessageRenderer: () => null,
}));

function renderHandler() {
  return renderHook(() =>
    useMessageHandlerLogic({
      sessionId: 'session-1',
      campaignId: null,
      characterId: 'char-1',
      turnCount: 0,
      updateGameSessionState: vi.fn(async () => {}),
    }),
  );
}

const DEATH_LINE = 'Death saving throw: 12 — success (1/3)';

describe('useMessageHandlerLogic death save outside a fight (#1811)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMessageMock.mockResolvedValue(undefined);
    getAIResponseMock.mockResolvedValue({ text: 'done' });
    queueCtl.isSending = false;
    queueCtl.handleSendMessage = vi.fn(async () => {});
    queueCtl.actualSendMessageRef.current = null;
    checkRestoredDefeatMock.mockResolvedValue(true);
    characterCtl.character = {
      id: 'char-1',
      name: 'The Scholar',
      character_stats: { current_hit_points: 0, vital_state: 'dying' },
    };
    fetchWithAuthMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        roll: 12,
        successes: 1,
        failures: 0,
        vitalState: 'dying',
        currentHitPoints: 0,
        maxHitPoints: 12,
        terminal: false,
        hours: null,
        engineLines: [DEATH_LINE],
        engineCards: [
          {
            kind: 'death_save',
            side: 'party',
            line: DEATH_LINE,
            title: 'Death saving throw',
          },
        ],
      }),
    });
  });

  it('sending while dying posts a death save and does not send the action to the DM', async () => {
    const { result } = renderHandler();
    checkRestoredDefeatMock.mockClear();
    await act(async () => {
      await result.current.handleSendMessage('I crawl toward the door');
    });

    expect(fetchWithAuthMock).toHaveBeenCalledWith(
      '/v1/sessions/session-1/death-save',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(DEATH_SAVE_WIRE_BODY),
      }),
    );
    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ text: DEATH_LINE, sender: 'system', persist: true }),
    );
    expect(sendMessageMock).not.toHaveBeenCalledWith(expect.objectContaining({ sender: 'player' }));
    expect(queueCtl.handleSendMessage).not.toHaveBeenCalled();
    expect(getAIResponseMock).not.toHaveBeenCalled();
    expect(checkRestoredDefeatMock).not.toHaveBeenCalled();
  });

  it('a dead result restores the fallen end screen', async () => {
    fetchWithAuthMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        roll: 4,
        successes: 0,
        failures: 3,
        vitalState: 'dead',
        currentHitPoints: 0,
        maxHitPoints: 12,
        terminal: true,
        hours: null,
        engineLines: [
          'The Scholar rolled 4 on their death saving throw — the third failure. The Scholar is DEAD.',
        ],
        engineCards: [],
      }),
    });
    const { result } = renderHandler();
    await act(async () => {
      await result.current.handleSendMessage('I try to stand');
    });
    expect(checkRestoredDefeatMock).toHaveBeenCalledWith('session-1');
    expect(getAIResponseMock).not.toHaveBeenCalled();
    expect(queueCtl.handleSendMessage).not.toHaveBeenCalled();
  });

  it('a 500 from the death-save call shows a system line and does not generate', async () => {
    fetchWithAuthMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'boom' }),
    });
    const { result } = renderHandler();
    await act(async () => {
      await result.current.handleSendMessage('I try to stand');
    });
    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ text: "You can't do that now.", sender: 'system', persist: false }),
    );
    expect(getAIResponseMock).not.toHaveBeenCalled();
    expect(queueCtl.handleSendMessage).not.toHaveBeenCalled();
  });
});
