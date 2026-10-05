import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageHandler } from '../MessageHandler';
import {
  DM_NETWORK_ERROR_MESSAGE,
  DM_STILL_THINKING_TIMEOUT_MS,
  DM_TIMEOUT_MESSAGE,
  DM_TURN_TIMEOUT_MS,
} from '../use-message-handler-logic';

const { mockGetAIResponse, mockSendMessage, mockToast, mockMessages, mockValidateSession } =
  vi.hoisted(() => ({
    mockGetAIResponse: vi.fn(),
    mockSendMessage: vi.fn().mockResolvedValue(undefined),
    mockToast: vi.fn(),
    mockMessages: [] as Array<{ text: string; sender: 'player' | 'dm' | 'system' }>,
    mockValidateSession: vi.fn().mockResolvedValue(true),
  }));

vi.mock('@/contexts/MemoryContext', () => ({
  useMemoryContext: () => ({ extractMemories: vi.fn().mockResolvedValue(undefined) }),
}));
vi.mock('@/hooks/use-ai-response', () => ({
  useAIResponse: () => ({ getAIResponse: mockGetAIResponse }),
}));
vi.mock('@/contexts/MessageContext', () => ({
  useMessageContext: () => ({
    messages: mockMessages,
    sendMessage: mockSendMessage,
    updateMessage: vi.fn(),
    queueStatus: 'idle' as const,
    isLoading: false,
  }),
}));
vi.mock('@/contexts/GameContext', () => ({
  useGame: () => ({ processAiResponse: vi.fn(), state: {} }),
}));
vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({ state: { character: null } }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mockToast }) }));
vi.mock('@/utils/safetyCommands', () => ({
  checkSafetyCommands: vi.fn().mockResolvedValue({ isSafetyCommand: false }),
  processSafetyCommand: vi.fn(),
}));
vi.mock('@/utils/diceCommandParser', () => ({ parseDiceCommand: vi.fn().mockReturnValue(null) }));
vi.mock('@/utils/chatSanitizer', () => ({ sanitizeDMText: (text: string) => text }));
vi.mock('@/utils/error-handler', () => ({ handleAsyncError: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/auth-gate', () => ({ waitForAuth: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/features/game-session/components/game/session/SessionValidator', () => ({
  useSessionValidator: () => mockValidateSession,
}));

describe('DM turn recovery (#2480)', () => {
  let send: (text: string) => Promise<void>;
  let state: {
    isProcessing: boolean;
    isStillThinking: boolean;
    sendError: string | null;
    onRetry: (input: string) => Promise<void>;
  };

  const renderHandler = (onAIResponse?: (message: { text: string }) => Promise<void>): void => {
    render(
      <MessageHandler
        sessionId="session-2480"
        campaignId="campaign-2480"
        characterId="character-2480"
        turnCount={0}
        updateGameSessionState={vi.fn().mockResolvedValue(undefined)}
        onAIResponse={onAIResponse}
      >
        {(handler) => {
          send = handler.handleSendMessage;
          state = {
            isProcessing: handler.isProcessing,
            isStillThinking: handler.isStillThinking,
            sendError: handler.sendError,
            onRetry: handler.onRetry,
          };
          return null;
        }}
      </MessageHandler>,
    );
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockSendMessage.mockResolvedValue(undefined);
    mockValidateSession.mockResolvedValue(true);
    mockMessages.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('moves from pending to still-thinking, times out, preserves the text, and retries once', async () => {
    mockGetAIResponse.mockImplementationOnce(() => new Promise(() => {}));
    renderHandler();

    let firstSend!: Promise<void>;
    await act(async () => {
      firstSend = send('Keep this exact turn');
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });
    void firstSend.catch(() => {});
    expect(mockGetAIResponse).toHaveBeenCalledTimes(1);
    expect(state.isProcessing).toBe(true);
    expect(state.isStillThinking).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DM_STILL_THINKING_TIMEOUT_MS);
    });
    expect(state.isStillThinking).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DM_TURN_TIMEOUT_MS - DM_STILL_THINKING_TIMEOUT_MS);
    });
    await expect(firstSend).rejects.toMatchObject({ name: 'AbortError' });
    expect(state.isProcessing).toBe(false);
    expect(state.isStillThinking).toBe(false);
    expect(state.sendError).toBe(DM_TIMEOUT_MESSAGE);
    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Keep this exact turn' }),
    );
    expect((mockGetAIResponse.mock.calls[0][7] as AbortSignal).aborted).toBe(true);

    mockMessages.push({ text: 'Keep this exact turn', sender: 'player' });
    mockGetAIResponse.mockResolvedValueOnce({ text: 'The DM answers.', rollRequests: [] });
    await act(async () => {
      await state.onRetry('Edited after timeout');
    });

    expect(mockGetAIResponse).toHaveBeenCalledTimes(2);
    expect(mockGetAIResponse.mock.calls[1][0]).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: 'Edited after timeout' })]),
    );
    expect(mockSendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Edited after timeout', sender: 'player' }),
    );
    expect(state.sendError).toBe(null);
  });

  it('pauses the timeout while a player-roll prompt is waiting', async () => {
    mockGetAIResponse.mockImplementationOnce((...args: unknown[]) => {
      (args[7] as { onPlayerWaitChange?: (waiting: boolean) => void }).onPlayerWaitChange?.(true);
      return new Promise(() => {});
    });
    renderHandler();

    let pending!: Promise<void>;
    await act(async () => {
      pending = send('Wait for my die');
      await Promise.resolve();
    });
    void pending.catch(() => {});

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DM_TURN_TIMEOUT_MS);
    });
    expect(state.sendError).toBe(null);
    expect(state.isProcessing).toBe(true);

    (
      mockGetAIResponse.mock.calls[0][7] as { onPlayerWaitChange?: (waiting: boolean) => void }
    ).onPlayerWaitChange?.(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DM_TURN_TIMEOUT_MS);
    });
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(state.sendError).toBe(DM_TIMEOUT_MESSAGE);
  });

  // #2530: the 90 s abort stops while the player holds the die, but the 30 s label does not. A
  // prompt the player cannot see used to leave the screen with no sign of life at all.
  it('keeps the still-thinking label running while a player-roll prompt is waiting', async () => {
    mockGetAIResponse.mockImplementationOnce((...args: unknown[]) => {
      (args[7] as { onPlayerWaitChange?: (waiting: boolean) => void }).onPlayerWaitChange?.(true);
      return new Promise(() => {});
    });
    renderHandler();

    let pending!: Promise<void>;
    await act(async () => {
      pending = send('Wait for my die');
      await Promise.resolve();
    });
    void pending.catch(() => {});
    expect(state.isStillThinking).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DM_STILL_THINKING_TIMEOUT_MS);
    });

    expect(state.isStillThinking).toBe(true);
    expect(state.sendError).toBe(null);
    expect(state.isProcessing).toBe(true);
  });

  it('ignores a late completion from the timed-out turn', async () => {
    let resolveLate!: (value: { text: string; rollRequests: never[] }) => void;
    mockGetAIResponse.mockImplementationOnce(
      () => new Promise((resolve) => (resolveLate = resolve)),
    );
    renderHandler();

    let pending!: Promise<void>;
    await act(async () => {
      pending = send('Do not duplicate this turn');
      await Promise.resolve();
    });
    void pending.catch(() => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DM_TURN_TIMEOUT_MS);
    });
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    resolveLate({ text: 'Late answer', rollRequests: [] });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Late answer' }),
    );
  });

  it('retries the last player row when a system notice trails the timed-out turn', async () => {
    mockGetAIResponse.mockImplementationOnce(() => new Promise(() => {}));
    renderHandler();

    let pending!: Promise<void>;
    await act(async () => {
      pending = send('Original action');
      await Promise.resolve();
    });
    void pending.catch(() => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DM_TURN_TIMEOUT_MS);
    });
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    mockMessages.push(
      { text: 'Original action', sender: 'player' },
      { text: '⚙️ Engine: the NPC turn is complete.', sender: 'system' },
    );
    mockGetAIResponse.mockResolvedValueOnce({ text: 'The DM answers.', rollRequests: [] });

    await act(async () => {
      await state.onRetry('Edited action');
    });

    const retryMessages = mockGetAIResponse.mock.calls[1][0] as Array<{
      text: string;
      sender: string;
    }>;
    expect(retryMessages.at(-1)).toMatchObject({ text: 'Edited action', sender: 'player' });
    expect(retryMessages).not.toContainEqual({ text: 'Original action', sender: 'player' });
    expect(retryMessages).toContainEqual({
      text: '⚙️ Engine: the NPC turn is complete.',
      sender: 'system',
    });
  });

  it.each([
    [
      'validateSession',
      () => mockValidateSession.mockImplementationOnce(() => new Promise(() => {})),
    ],
    ['persist', () => mockSendMessage.mockImplementationOnce(() => new Promise(() => {}))],
    [
      'onAIResponse',
      () => {
        mockGetAIResponse.mockResolvedValueOnce({ text: 'The DM answers.', rollRequests: [] });
      },
    ],
  ])('times out when %s hangs', async (_stage, setup) => {
    let onAIResponse: ((message: { text: string }) => Promise<void>) | undefined;
    setup();
    if (_stage === 'onAIResponse') onAIResponse = () => new Promise(() => {});
    if (_stage !== 'validateSession' && _stage !== 'persist' && _stage !== 'onAIResponse') {
      throw new Error(`unhandled test stage: ${_stage}`);
    }
    renderHandler(onAIResponse);

    let pending!: Promise<void>;
    await act(async () => {
      pending = send(`Hang in ${_stage}`);
      await Promise.resolve();
    });
    void pending.catch(() => {});

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DM_TURN_TIMEOUT_MS);
    });

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(state.sendError).toBe(DM_TIMEOUT_MESSAGE);
  });

  it('shows the network recovery message and does not retry automatically', async () => {
    mockGetAIResponse.mockRejectedValueOnce(
      new Error('Failed to get DM response - AI service unavailable', {
        cause: new TypeError('Failed to fetch'),
      }),
    );
    renderHandler();

    await act(async () => {
      await expect(send('Keep this after a disconnect')).rejects.toMatchObject({
        message: 'Failed to get DM response - AI service unavailable',
      });
    });

    expect(state.sendError).toBe(DM_NETWORK_ERROR_MESSAGE);
    expect(mockGetAIResponse).toHaveBeenCalledTimes(1);
  });

  it('shows retry recovery when the DM turn fails after combat entry', async () => {
    mockGetAIResponse.mockRejectedValueOnce(new Error('combat resolution failed'));
    renderHandler();

    await act(async () => {
      await expect(send('Strike the goblin')).rejects.toMatchObject({
        message: 'combat resolution failed',
      });
    });

    expect(state.isProcessing).toBe(false);
    expect(state.sendError).toBe(
      'The DM could not finish this turn. Your message is still here. Retry to continue.',
    );
  });
});
