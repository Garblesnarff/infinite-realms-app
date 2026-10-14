/**
 * #633 PR2: the streaming narration preview in `useMessageHandlerLogic`.
 *
 * - Chunks passed to the `onStreamChunk` callback (9th `getAIResponse` arg)
 *   accumulate into the turn's `dmMessageId` row via `updateMessage`.
 * - When the parse suppresses the early render (`suppressRender: true` —
 *   roll requests, combat start, narration gate), the preview row is
 *   withdrawn via `removeMessage` so withheld prose never lingers on screen.
 * - With no preview chunks, suppression withdraws nothing.
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageHandler } from '../MessageHandler';

const {
  mockGetAIResponse,
  mockSendMessage,
  mockUpdateMessage,
  mockRemoveMessage,
  mockToast,
  mockValidateSession,
} = vi.hoisted(() => ({
  mockGetAIResponse: vi.fn(),
  mockSendMessage: vi.fn().mockResolvedValue(undefined),
  mockUpdateMessage: vi.fn(),
  mockRemoveMessage: vi.fn(),
  mockToast: vi.fn(),
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
    messages: [],
    sendMessage: mockSendMessage,
    updateMessage: mockUpdateMessage,
    removeMessage: mockRemoveMessage,
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

const earlyResponse = (text: string) => ({
  id: 'dm-1',
  text,
  sender: 'dm' as const,
  timestamp: new Date().toISOString(),
  context: { intent: 'response' as const },
});

describe('streaming narration preview (#633 PR2)', () => {
  let send: (text: string) => Promise<void>;

  const renderHandler = (): void => {
    render(
      <MessageHandler
        sessionId="session-stream"
        campaignId="campaign-stream"
        characterId="character-stream"
        turnCount={0}
        updateGameSessionState={vi.fn().mockResolvedValue(undefined)}
        onAIResponse={vi.fn().mockResolvedValue(undefined)}
      >
        {(handler) => {
          send = handler.handleSendMessage;
          return null;
        }}
      </MessageHandler>,
    );
  };

  /** Drives one turn: streams `chunks`, then fires onTextReady with `suppressRender`. */
  const runTurn = async (chunks: string[], suppressRender: boolean): Promise<void> => {
    mockGetAIResponse.mockImplementationOnce(async (...args: unknown[]) => {
      const onStreamChunk = args[8] as (chunk: string) => void;
      const onTextReady = args[4] as (
        early: unknown,
        options: { suppressRender: boolean; earlyRollPromptAllowed: boolean },
      ) => Promise<void>;
      expect(typeof onStreamChunk).toBe('function');
      for (const chunk of chunks) onStreamChunk(chunk);
      await onTextReady(earlyResponse(chunks.join('')), {
        suppressRender,
        earlyRollPromptAllowed: false,
      });
      return earlyResponse('The tavern door swings open.');
    });
    renderHandler();
    await act(async () => {
      await send('I open the tavern door');
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMessage.mockResolvedValue(undefined);
    mockValidateSession.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('accumulates streamed chunks into the dmMessageId row', async () => {
    await runTurn(['The tavern ', 'door swings ', 'open.'], false);

    const dmMessageId = mockGetAIResponse.mock.calls[0][5] as string;
    const previewWrites = mockUpdateMessage.mock.calls.filter(
      (call) => (call[0] as { id: string }).id === dmMessageId,
    );
    expect(previewWrites.length).toBeGreaterThanOrEqual(3);
    expect(previewWrites[0][0]).toMatchObject({ text: 'The tavern ', sender: 'dm' });
    expect(previewWrites[1][0]).toMatchObject({ text: 'The tavern door swings ' });
    expect(previewWrites[2][0]).toMatchObject({ text: 'The tavern door swings open.' });
  });

  it('withdraws the preview row when the parse suppresses the render', async () => {
    await runTurn(['The goblin raises its blade. '], true);

    const dmMessageId = mockGetAIResponse.mock.calls[0][5] as string;
    expect(mockRemoveMessage).toHaveBeenCalledWith(dmMessageId);
    expect(mockRemoveMessage).toHaveBeenCalledTimes(1);
  });

  it('withdraws nothing when suppression fires without any preview chunks', async () => {
    await runTurn([], true);

    expect(mockRemoveMessage).not.toHaveBeenCalled();
  });
});
