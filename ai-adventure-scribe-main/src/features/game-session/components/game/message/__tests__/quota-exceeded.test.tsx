/**
 * #2443 — run M10: the 31st `llm` call of the free plan's day was answered 402, and the player
 * read "I encountered an issue processing your message … try again". A retry cannot succeed
 * before the reset, so the message says so, with the reset time, and the composer stays usable.
 * The error is the one the real client raises for the route's real 402 body.
 */
import { render, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

import { quotaExceededBody } from '../../../../../../../shared/test-fixtures/llm-quota-exceeded';
import { MessageHandler } from '../MessageHandler';

import { llmApiClient } from '@/infrastructure/api';

const { mockGetAIResponse, mockSendMessage, mockToast } = vi.hoisted(() => ({
  mockGetAIResponse: vi.fn(),
  mockSendMessage: vi.fn().mockResolvedValue(undefined),
  mockToast: vi.fn(),
}));

vi.mock('@/contexts/MemoryContext', () => ({
  useMemoryContext: () => ({ extractMemories: vi.fn().mockResolvedValue(undefined) }),
}));
vi.mock('@/hooks/use-ai-response', () => ({
  useAIResponse: () => ({ getAIResponse: mockGetAIResponse }),
}));
vi.mock('@/contexts/MessageContext', () => ({
  useMessageContext: () => ({
    messages: [],
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
  useSessionValidator: () => vi.fn().mockResolvedValue(true),
}));

/** The error `llmApiClient` raises for the route's 402, built by the real client. */
const quotaErrorFromClient = async (): Promise<unknown> => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status: 402,
      statusText: 'Payment Required',
      headers: { get: () => '1800' },
      text: () => Promise.resolve(JSON.stringify(quotaExceededBody)),
    }),
  );
  return llmApiClient.generateText({ prompt: 'Hello' }).catch((error) => error);
};

describe('MessageHandler: the daily AI quota is spent (#2443)', () => {
  let send: (text: string) => Promise<void>;
  let isProcessing: boolean;

  const renderHandler = (): void => {
    render(
      <MessageHandler
        sessionId="35fd47e5-416d-4e79-be3b-f594beaa4a1f"
        campaignId="academy-of-arcane-gastronomy"
        characterId="3d7ede0b-95c6-48b5-961d-81bbdc840692"
        turnCount={0}
        updateGameSessionState={vi.fn().mockResolvedValue(undefined)}
      >
        {(handler) => {
          send = handler.handleSendMessage;
          isProcessing = handler.isProcessing;
          return null;
        }}
      </MessageHandler>,
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMessage.mockResolvedValue(undefined);
  });

  it('says the limit was reached and when it resets, instead of "try again"', async () => {
    mockGetAIResponse.mockRejectedValue(await quotaErrorFromClient());
    renderHandler();

    await act(async () => {
      await expect(send('I cast Acid Splash at the Bitter End Mercenary')).rejects.toMatchObject({
        status: 402,
      });
    });

    const resetText = new Date(quotaExceededBody.resetAt).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });
    const systemRows = mockSendMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message.sender === 'system');
    expect(systemRows).toHaveLength(1);
    expect(systemRows[0].text).toContain("today's AI limit");
    expect(systemRows[0].text).toContain(resetText);
    expect(systemRows[0].text).not.toContain('Let me try again');
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Daily AI limit reached',
        description: systemRows[0].text,
      }),
    );
  });

  it('asks the model once, leaves the composer usable, and sends the next message normally', async () => {
    mockGetAIResponse.mockRejectedValueOnce(await quotaErrorFromClient());
    renderHandler();

    await act(async () => {
      await send('I cast Acid Splash at the Bitter End Mercenary').catch(() => {});
    });

    // No automatic second request behind the refusal, and nothing left holding the composer.
    expect(mockGetAIResponse).toHaveBeenCalledTimes(1);
    expect(isProcessing).toBe(false);

    mockGetAIResponse.mockResolvedValueOnce({
      text: 'The acid hisses.',
      sender: 'dm',
      rollRequests: [],
    });
    await act(async () => {
      await send('I cast Acid Splash at the Bitter End Mercenary');
    });

    expect(mockGetAIResponse).toHaveBeenCalledTimes(2);
    expect(isProcessing).toBe(false);
  });
});
