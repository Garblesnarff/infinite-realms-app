/**
 * #2378 — an engine line handed over while the turn is still running (the seating line, an NPC's
 * opening swing) is shown and saved as its own system row at that moment, ahead of the DM reply
 * and with the persistence flag the engine gave it.
 */
import { render, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const { mockGetAIResponse, mockSendMessage } = vi.hoisted(() => ({
  mockGetAIResponse: vi.fn(),
  mockSendMessage: vi.fn().mockResolvedValue(undefined),
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
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
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
vi.mock('@/features/game-session/components/game/session/SessionValidator', () => ({
  useSessionValidator: () => vi.fn().mockResolvedValue(true),
}));

import { MessageHandler } from '../MessageHandler';

import type { LocalNotice } from '@/hooks/ai/types';

describe('MessageHandler: engine lines shown mid-turn (#2378)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMessage.mockResolvedValue(undefined);
  });

  it('saves each line as a system row the moment it is handed over, before the DM reply', async () => {
    const seating = { text: '⚙️ Engine: Initiative — Emil: 7. You: 3.', persist: false };
    const swing = {
      text: '⚙️ Engine: Emil hits The Scholar. The Scholar is now at 1 HP.',
      persist: true,
    };
    mockGetAIResponse.mockImplementation(
      async (
        _messages: unknown,
        _sessionId: string,
        _turnCount: unknown,
        _onTurnPhase: unknown,
        _onTextReady: unknown,
        _dmMessageId: string,
        onEngineNotice: (notice: LocalNotice) => void,
      ) => {
        onEngineNotice(seating);
        await Promise.resolve();
        onEngineNotice(swing);
        return { text: 'The Scholar, what do you do?', sender: 'dm', rollRequests: [] };
      },
    );

    let send: (text: string) => Promise<void> = async () => {};
    render(
      <MessageHandler
        sessionId="session-1"
        campaignId="campaign-1"
        characterId="char-1"
        turnCount={0}
        updateGameSessionState={vi.fn().mockResolvedValue(undefined)}
      >
        {({ handleSendMessage }) => {
          send = handleSendMessage;
          return null;
        }}
      </MessageHandler>,
    );
    await act(async () => {
      await send('I cast Chill Touch at Professor Emil Darkwater');
    });

    const saved = mockSendMessage.mock.calls.map(([message]) => message);
    const engineRows = saved.filter((message) => message.sender === 'system');
    expect(engineRows).toEqual([
      expect.objectContaining({ text: seating.text, persist: false }),
      expect.objectContaining({ text: swing.text, persist: true }),
    ]);
    const dmIndex = saved.findIndex((message) => message.sender === 'dm');
    expect(dmIndex).toBeGreaterThan(saved.indexOf(engineRows[1]));
  });
});
