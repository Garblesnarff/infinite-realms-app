import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const {
  mockGetAIResponse,
  mockReadCombat,
  mockListSessionMessages,
  mockSendMessage,
  mockCheckDeclaredAttack,
  mockLogger,
  contextState,
  character,
} = vi.hoisted(() => ({
  mockGetAIResponse: vi.fn(),
  mockReadCombat: vi.fn(),
  mockListSessionMessages: vi.fn(),
  mockSendMessage: vi.fn().mockResolvedValue(undefined),
  mockCheckDeclaredAttack: vi.fn(),
  mockLogger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  contextState: {
    messages: [] as Array<Record<string, unknown>>,
    messagesReady: true,
  },
  character: { id: 'char-1', name: 'The Scholar' },
}));

vi.mock('@/contexts/MemoryContext', () => ({
  useMemoryContext: () => ({ extractMemories: vi.fn().mockResolvedValue(undefined) }),
}));
vi.mock('@/hooks/use-ai-response', () => ({
  useAIResponse: () => ({ getAIResponse: mockGetAIResponse }),
}));
vi.mock('@/contexts/combat/use-authoritative-combat-sync', () => ({
  readAuthoritativeCombat: mockReadCombat,
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: { listSessionMessages: mockListSessionMessages },
  isTerminalDefeatError: () => false,
}));
vi.mock('@/contexts/MessageContext', () => ({
  useMessageContext: () => ({
    messages: contextState.messages,
    messagesReady: contextState.messagesReady,
    sendMessage: mockSendMessage,
    updateMessage: vi.fn(),
    queueStatus: 'idle' as const,
    isLoading: false,
    isFetchingMore: false,
    hasMore: false,
    loadMore: vi.fn(),
  }),
}));
vi.mock('@/contexts/CombatContext', () => ({
  useCombat: () => ({
    state: { isInCombat: false, activeEncounter: null },
    refreshCombatState: vi.fn(),
    dealDamage: vi.fn(),
  }),
}));
vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({ state: { character } }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/utils/safetyCommands', () => ({
  checkSafetyCommands: vi.fn().mockResolvedValue({ isSafetyCommand: false }),
  processSafetyCommand: vi.fn(),
}));
vi.mock('@/utils/diceCommandParser', async (importOriginal) => ({
  ...(await importOriginal<typeof DiceCommandParser>()),
  parseDiceCommand: vi.fn().mockReturnValue(null),
}));
vi.mock('@/utils/chatSanitizer', () => ({ sanitizeDMText: (text: string) => text }));
vi.mock('@/utils/error-handler', () => ({ handleAsyncError: vi.fn() }));
vi.mock('@/lib/logger', () => ({ default: mockLogger }));
vi.mock('@/features/game-session/components/game/session/SessionValidator', () => ({
  useSessionValidator: () => vi.fn().mockResolvedValue(true),
}));
vi.mock('@/hooks/ai/combat-entry-hold', () => ({
  checkDeclaredAttack: mockCheckDeclaredAttack,
  recentNarrationFrom: (messages: Array<{ sender?: string; text?: string }>) =>
    [...messages].reverse().find((message) => message.sender === 'dm')?.text,
}));

vi.mock('@/features/game-session/components/chat/message-list/MessageRenderer', () => ({
  MessageRenderer: ({ message }: { message: { text: string } }) => <p>{message.text}</p>,
}));

import {
  STORY_SAVE_ROLL,
  storyDmBody,
} from '../../../../../../../shared/test-fixtures/story-rolls';
import { MessageHandler } from '../MessageHandler';

import type { ChatMessage } from '@/types/game';
import type * as DiceCommandParser from '@/utils/diceCommandParser';

import { GameProvider, useGame } from '@/contexts/GameContext';
import { ChatInput } from '@/features/game-session/components/chat/ChatInput';
import { MessageListContainer } from '@/features/game-session/components/chat/message-list/MessageListContainer';

const sessionId = 'd3d075ef-fec7-4442-b684-c5c35084f41e';
function Controls() {
  const game = useGame();
  return (
    <MessageHandler
      sessionId={sessionId}
      campaignId="campaign-1"
      characterId="char-1"
      turnCount={4}
      updateGameSessionState={vi.fn().mockResolvedValue(undefined)}
    >
      {({ handleSendMessage, sendError, onRetry, retryInFlight }) => (
        <>
          <output data-testid="roll-id">
            {game.state.diceRollQueue.pendingRolls.map((roll) => roll.rollRequestId).join(',')}
          </output>
          <MessageListContainer
            messages={contextState.messages as unknown as ChatMessage[]}
            messagesRef={React.createRef()}
            expandedMessages={new Set()}
            setExpandedMessages={vi.fn()}
            imageByMessage={{}}
            generatingFor={new Set()}
            genErrorByMessage={{}}
            onGenerateScene={vi.fn()}
            onOptionSelect={vi.fn()}
            onSendMessage={mockSendMessage}
            onSendFullMessage={handleSendMessage}
            sessionId={sessionId}
            retryInFlight={retryInFlight}
          />
          <ChatInput
            isDisabled={false}
            onSendMessage={handleSendMessage}
            sendError={sendError ?? undefined}
            onRetry={onRetry}
            retryInFlight={retryInFlight}
          />
        </>
      )}
    </MessageHandler>
  );
}

describe('real roll tray and composer Retry (#216 step 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const dm = storyDmBody(STORY_SAVE_ROLL);
    contextState.messages = [{ id: dm.id, sender: 'dm', text: dm.message, context: dm.context }];
    contextState.messagesReady = true;
    mockReadCombat.mockResolvedValue({ state: 'none' });
    mockCheckDeclaredAttack.mockResolvedValue(null);
    mockGetAIResponse.mockReset().mockRejectedValueOnce(new Error('Request failed (500)'));
    mockSendMessage.mockImplementation(async (message) => {
      if (message.sender === 'dm') throw new Error('DM save failed (500)');
      const saved = { ...message, id: message.id ?? crypto.randomUUID() };
      contextState.messages = [...contextState.messages, saved];
      mockListSessionMessages.mockImplementation(async (_id, offset = 0, limit = 50) => ({
        total: contextState.messages.length,
        messages: contextState.messages
          .slice(offset, offset + limit)
          .map((m) => ({ id: m.id, speaker_type: m.sender, context: m.context })),
      }));
    });
  });
  it('every narrative request in a restored DM batch gets its own stable id', async () => {
    const dm = storyDmBody(STORY_SAVE_ROLL);
    dm.context.rollRequests = [
      ...dm.context.rollRequests,
      { type: 'skill_check', formula: '1d20+1', purpose: 'Perception check', dc: 14 },
    ];
    contextState.messages = [{ id: dm.id, sender: 'dm', text: dm.message, context: dm.context }];
    render(
      <GameProvider>
        <Controls />
      </GameProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('roll-id')).toHaveTextContent(`${dm.id}:roll:0,${dm.id}:roll:1`),
    );
  });

  it('both real Retry controls share one send, disable while waiting, and carry a DM roll id', async () => {
    render(
      <GameProvider>
        <Controls />
      </GameProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('roll-id')).toHaveTextContent(
        `${STORY_SAVE_ROLL.dmMessageId}:roll:0`,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: /manual/i }));
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(2));
    let finish!: (reply: unknown) => void;
    mockGetAIResponse.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const buttons = screen.getAllByRole('button', { name: 'Retry' });
    act(() => {
      fireEvent.click(buttons[0]);
      fireEvent.click(buttons[1]);
    });
    await waitFor(() => expect(mockGetAIResponse).toHaveBeenCalledTimes(2));
    const waiting = screen.getAllByRole('button', { name: 'Retrying…' });
    expect(waiting).toHaveLength(2);
    waiting.forEach((button) => expect(button).toBeDisabled());
    await act(async () => {
      finish({ text: 'The charm fails.', rollRequests: [] });
    });
    await waitFor(() =>
      expect(screen.queryAllByRole('button', { name: 'Retrying…' })).toHaveLength(0),
    );
    expect(mockGetAIResponse).toHaveBeenCalledTimes(2);
    expect(mockSendMessage.mock.calls.filter(([m]) => m.sender === 'player')).toHaveLength(1);
  });
});
