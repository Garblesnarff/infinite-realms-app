/**
 * #400 — the message-handler half of the unlocked composer.
 *
 * The entry card is a question the player may answer by typing, so two things must hold:
 * 1. `handleSendMessage` settles a pending card (as declined) and marks the typed answer
 *    before queueing — without the settle, the queued send waits forever on a turn parked
 *    at the confirmation; without the mark, the new turn is re-prompted with another card.
 * 2. While a card is pending, the composer stays unblocked (dice-roll prompts still block).
 *
 * Both tests drive the REAL combat-entry-confirmation bridge: each fails if its branch is
 * removed from use-message-handler-logic.ts.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMessageHandlerLogic } from '../use-message-handler-logic';

import {
  consumeCombatEntryTypedAnswer,
  requestCombatEntryAnswer,
  setCombatEntryConfirmationHost,
  settlePendingCombatEntryConfirmation,
  type CombatEntryConfirmationHost,
} from '@/services/combat/combat-entry-confirmation-bridge';

const sendMessageMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());
const getAIResponseMock = vi.hoisted(() => vi.fn());
const queueCtl = vi.hoisted(() => ({
  isSending: false,
  actualSendMessageRef: {
    current: null as null | ((input: string, context?: unknown) => Promise<void>),
  },
  handleSendMessage: null as null | ((input: string, context?: unknown) => Promise<void>),
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
    state: { currentPhase: 'exploration', diceRollQueue: { pendingRolls: [] } },
  }),
}));
vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({
    state: { character: { id: 'char-1', name: 'The Scholar' } },
  }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock('@/hooks/use-ai-response', () => ({
  useAIResponse: () => ({ getAIResponse: getAIResponseMock }),
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
      queueCtl.handleSendMessage?.(input, context) ?? Promise.resolve(),
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
  SessionExpiredError: class SessionExpiredError extends Error {},
  SESSION_EXPIRED_MESSAGE: 'Session expired',
  subscribeToNetworkRetry: () => (): void => {},
}));
vi.mock('@/services/auth/TokenService', () => ({ clearPendingInput: vi.fn() }));
vi.mock('@/services/user-data-api', () => ({ isTerminalDefeatError: () => false }));
vi.mock('@/utils/error-handler', () => ({ handleAsyncError: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const CARD_SPEC = {
  actorLabel: 'The Scholar',
  combatantLabels: ['Vance'],
  initiativeRoll: null,
  initiativeModifier: 2,
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

describe('useMessageHandlerLogic combat entry (#400)', () => {
  let capturedSettle: ((confirmed: boolean, target?: string) => void) | null;

  const fakeHost: CombatEntryConfirmationHost = {
    present: (_spec, settle) => {
      capturedSettle = settle;
      return () => {};
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    capturedSettle = null;
    sendMessageMock.mockResolvedValue(undefined);
    queueCtl.isSending = false;
    queueCtl.handleSendMessage = async () => {};
    queueCtl.actualSendMessageRef.current = null;
  });

  afterEach(() => {
    // The bridge is module state: never leak a pending card, host or typed mark.
    settlePendingCombatEntryConfirmation(false);
    setCombatEntryConfirmationHost(null);
    consumeCombatEntryTypedAnswer('__cleanup__');
  });

  it('settle-then-mark: typing while the card is up settles it and arms the typed-answer skip', async () => {
    const { result } = renderHandler();

    let answerPromise: Promise<{ confirmed: boolean; target?: string }> | undefined;
    await act(async () => {
      setCombatEntryConfirmationHost(fakeHost, 'owner-1');
      answerPromise = requestCombatEntryAnswer(CARD_SPEC);
    });

    await act(async () => {
      await result.current.handleSendMessage('I swing my sword!');
    });

    // The parked confirmation resolves as declined — without the settle branch this
    // promise never resolves and the queued send would wait on it forever.
    if (!answerPromise) throw new Error('the entry card was never created');
    const answer = await Promise.race([
      answerPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('the pending card was never settled')), 1000),
      ),
    ]);
    expect(answer).toEqual({ confirmed: false });
    expect(capturedSettle).not.toBeNull();
    // The mark arms the skip for the new turn — without the mark branch the next hold
    // re-prompts with another card.
    expect(consumeCombatEntryTypedAnswer('I swing my sword!')).toBe(true);
  });

  it('composer-unblock: a pending card releases the composer block', async () => {
    queueCtl.isSending = true;
    // The queue runs the real send pipeline; the DM turn never resolves, so the
    // composer stays blocked until the card — not the turn — releases it.
    let resolveTurn: (value: unknown) => void = () => {};
    getAIResponseMock.mockImplementation(
      () => new Promise((resolve) => { resolveTurn = resolve; }),
    );
    queueCtl.handleSendMessage = (input, context) =>
      queueCtl.actualSendMessageRef.current?.(input, context) ?? Promise.resolve();

    const { result } = renderHandler();

    let sendPromise: Promise<void> | undefined;
    await act(async () => {
      sendPromise = result.current.handleSendMessage('hello');
      await waitFor(() => expect(getAIResponseMock).toHaveBeenCalled());
    });
    // The send parked inside the DM turn with the composer blocked.
    expect(result.current.isProcessing).toBe(true);

    // A card becomes pending (the pre-DM hold of some other path, or the post-DM card):
    // the composer must unlock so the player can answer by typing. Without the
    // pending-change effect this stays blocked.
    await act(async () => {
      setCombatEntryConfirmationHost(fakeHost, 'owner-1');
      void requestCombatEntryAnswer(CARD_SPEC);
    });
    await waitFor(() => expect(result.current.isProcessing).toBe(false));

    resolveTurn({ text: 'done' });
    await sendPromise;
  });
});
