/**
 * #468 item 2 — behavioural check through the existing free-text send path.
 *
 * This file imports only modules that already exist on main:
 * `useMessageHandlerLogic` (the real `handleSendMessage`) and
 * `MessageListContainer` (the existing list, which on this branch also
 * mounts the lethal-action host and "Are you sure?" card). It does not
 * import the new detector, helper, bridge, or API modules, so it can
 * run against origin/main rather than failing at import time.
 *
 * Real producers this fixture follows:
 * - Real `handleSendMessage` / `useMessageHandlerLogic`.
 * - Real `isClearlyLethalAction` and `decideLethalFreeTextSend`, reached
 *   only through that hook (no confirm/resolve stubs).
 * - Real `useLethalActionConfirmationHost` + `LethalActionConfirmation`,
 *   mounted through `MessageListContainer`.
 *
 * Stubbed collaborators: the send-queue / `getAIResponse` (the DM
 * generate path), `sendMessage` persistence, and `fetchWithAuth` for
 * the engine HTTP call after Yes.
 *
 * On main this fails because a lethal act is queued straight to the DM
 * with no confirm card and no engine roll. On this branch it asks
 * "Are you sure?" first; Yes posts `/lethal-act` and never generates;
 * No sends nothing.
 */
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LETHAL_ACT_TEXT as LETHAL_TEXT,
  LETHAL_ACT_WIRE_BODY,
} from '../../../../../../../shared/test-fixtures/lethal-act-body';
import { MessageListContainer } from '../../../chat/message-list/MessageListContainer';
import { useMessageHandlerLogic } from '../use-message-handler-logic';

const ORDINARY_TEXT = 'I look over the edge';

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
vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({
    state: { character: { id: 'char-1', name: 'The Scholar' } },
  }),
}));
vi.mock('@/contexts/CombatContext', () => ({
  useCombat: () => ({
    state: { activeEncounter: null },
    refreshCombatState: vi.fn(),
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

const ENGINE_RESPONSE = {
  success: false,
  natural: 3,
  modifier: 2,
  total: 5,
  dc: 15,
  damage: 24,
  vitalState: 'dead',
  currentHitPoints: 0,
  maxHitPoints: 12,
  engineCard: { line: 'The Scholar dies.' },
};

function renderList() {
  return render(
    <MessageListContainer
      messages={[]}
      messagesRef={createRef<HTMLDivElement>()}
      expandedMessages={new Set()}
      setExpandedMessages={vi.fn()}
      imageByMessage={{}}
      generatingFor={new Set()}
      genErrorByMessage={{}}
      onGenerateScene={vi.fn().mockResolvedValue(undefined)}
      onOptionSelect={vi.fn().mockResolvedValue(undefined)}
      onSendMessage={vi.fn().mockResolvedValue(undefined)}
      onSendFullMessage={vi.fn().mockResolvedValue(undefined)}
      sessionId="session-1"
    />,
  );
}

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

describe('useMessageHandlerLogic lethal free-text send (#468)', () => {
  let unmountList: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    sendMessageMock.mockResolvedValue(undefined);
    getAIResponseMock.mockResolvedValue({ text: 'done' });
    queueCtl.isSending = false;
    queueCtl.handleSendMessage = vi.fn(async () => {});
    queueCtl.actualSendMessageRef.current = null;
    fetchWithAuthMock.mockResolvedValue({
      ok: true,
      json: async () => ENGINE_RESPONSE,
    });
  });

  afterEach(() => {
    unmountList?.();
    unmountList = undefined;
  });

  async function waitForConfirmOrDmSend() {
    await waitFor(() => {
      const asked = Boolean(screen.queryByText('Are you sure?'));
      const sentToDm = queueCtl.handleSendMessage.mock.calls.length > 0;
      expect(asked || sentToDm).toBeTruthy();
    });
  }

  function expectAskedFirstNotSentToDm() {
    // On main this fails with the lethal text in sentToDm, an empty
    // engineRouteCalls list, and askedAreYouSure: false — the act went
    // straight to the DM with no confirm and no engine roll.
    expect({
      sentToDm: queueCtl.handleSendMessage.mock.calls.map(([text]) => text),
      engineRouteCalls: fetchWithAuthMock.mock.calls.map(([url]) => url),
      askedAreYouSure: Boolean(screen.queryByText('Are you sure?')),
    }).toEqual({
      sentToDm: [],
      engineRouteCalls: [],
      askedAreYouSure: true,
    });
    expect(getAIResponseMock).not.toHaveBeenCalled();
    expect(sendMessageMock).not.toHaveBeenCalled();
  }

  it('still sends an ordinary look straight to the DM queue', async () => {
    const list = renderList();
    unmountList = list.unmount;
    const { result } = renderHandler();

    await act(async () => {
      await result.current.handleSendMessage(ORDINARY_TEXT);
    });

    expect(queueCtl.handleSendMessage).toHaveBeenCalledWith(ORDINARY_TEXT, undefined);
    expect(screen.queryByText('Are you sure?')).not.toBeInTheDocument();
    expect(fetchWithAuthMock).not.toHaveBeenCalled();
  });

  it('asks Are you sure? and does not send a lethal act to the DM', async () => {
    const list = renderList();
    unmountList = list.unmount;
    const { result } = renderHandler();

    let sendPromise: Promise<void> | undefined;
    await act(async () => {
      sendPromise = result.current.handleSendMessage(LETHAL_TEXT);
    });

    await waitForConfirmOrDmSend();
    expectAskedFirstNotSentToDm();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'No' }));
      await sendPromise;
    });

    expect(queueCtl.handleSendMessage).not.toHaveBeenCalled();
    expect(getAIResponseMock).not.toHaveBeenCalled();
    expect(fetchWithAuthMock).not.toHaveBeenCalled();
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('on Yes posts the engine route and never generates a DM turn', async () => {
    const list = renderList();
    unmountList = list.unmount;
    const { result } = renderHandler();

    let sendPromise: Promise<void> | undefined;
    await act(async () => {
      sendPromise = result.current.handleSendMessage(LETHAL_TEXT);
    });

    await waitForConfirmOrDmSend();
    expectAskedFirstNotSentToDm();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
      await sendPromise;
    });

    expect(fetchWithAuthMock).toHaveBeenCalledWith(
      '/v1/sessions/session-1/lethal-act',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(LETHAL_ACT_WIRE_BODY),
      }),
    );
    expect(queueCtl.handleSendMessage).not.toHaveBeenCalled();
    expect(getAIResponseMock).not.toHaveBeenCalled();
    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ text: LETHAL_TEXT, sender: 'player' }),
    );
    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        text: ENGINE_RESPONSE.engineCard.line,
        sender: 'system',
        context: { engineCards: [ENGINE_RESPONSE.engineCard] },
      }),
    );
  });

  it('on Yes with a 409 shows a system line and does not send or generate', async () => {
    fetchWithAuthMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'Already at 0 HP' }),
    });
    const list = renderList();
    unmountList = list.unmount;
    const { result } = renderHandler();

    let sendPromise: Promise<void> | undefined;
    await act(async () => {
      sendPromise = result.current.handleSendMessage(LETHAL_TEXT);
    });

    await waitForConfirmOrDmSend();
    expectAskedFirstNotSentToDm();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
      await sendPromise;
    });

    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ text: "You can't do that now.", sender: 'system' }),
    );
    expect(sendMessageMock).not.toHaveBeenCalledWith(expect.objectContaining({ sender: 'player' }));
    expect(queueCtl.handleSendMessage).not.toHaveBeenCalled();
    expect(getAIResponseMock).not.toHaveBeenCalled();
  });
});
