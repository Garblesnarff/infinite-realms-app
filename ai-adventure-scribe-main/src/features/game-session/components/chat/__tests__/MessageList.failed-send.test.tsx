import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageList } from '../MessageList';

import type { ChatMessage } from '@/types/game';

// Both live in the hoisted block: the mock factory runs before the module
// body, so a factory referencing a body-level const hits the TDZ.
const { failedMessage, mockContext } = vi.hoisted(() => {
  const failedMessage: ChatMessage = {
    text: 'I retreat.',
    sender: 'player',
    context: { sendFailed: true },
  };
  return {
    failedMessage,
    mockContext: {
      messages: [] as ChatMessage[],
      isLoading: false,
      messagesReady: true,
      sendMessage: vi.fn().mockResolvedValue(undefined),
      hasMore: false,
      loadMore: vi.fn(),
      isFetchingMore: false,
      failedSends: [failedMessage] as ChatMessage[],
      clearFailedSend: vi.fn(),
    },
  };
});

vi.mock('@/contexts/MessageContext', () => ({
  useMessageContext: () => mockContext,
}));
vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({ state: { character: null } }),
}));
vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: () => ({ state: { campaign: null } }),
}));
vi.mock('@/contexts/CombatContext', () => ({
  useCombat: () => ({ state: { isInCombat: false } }),
}));
vi.mock('@/contexts/CampaignAssetsContext', () => ({
  useCampaignAssetsContext: () => ({ getAssetImageUrl: vi.fn() }),
}));
vi.mock('react-router-dom', () => ({ useParams: () => ({}) }));
vi.mock('../message-list/useImageGeneration', () => ({
  useImageGeneration: () => ({
    generatingFor: new Set(),
    imageByMessage: {},
    genErrorByMessage: {},
    handleGenerateScene: vi.fn(),
  }),
}));
vi.mock('../message-list/useScrollBehavior', () => ({ useScrollBehavior: vi.fn() }));

let captured: Record<string, unknown> | null = null;
vi.mock('../message-list/MessageListContainer', () => ({
  MessageListContainer: (props: Record<string, unknown>) => {
    captured = props;
    return null;
  },
}));

describe('MessageList failed-send wiring (#88)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captured = null;
  });

  it('forwards failed sends and the writing state to the container', () => {
    render(<MessageList isDmWriting />);

    expect(captured).not.toBeNull();
    expect((captured as Record<string, unknown>).failedMessages).toBe(mockContext.failedSends);
    expect((captured as Record<string, unknown>).isDmWriting).toBe(true);
    expect(typeof (captured as Record<string, unknown>).onRetryFailed).toBe('function');
  });

  it('retries through the turn retry when one is wired, clearing the row first', async () => {
    const onRetryTurn = vi.fn().mockResolvedValue(undefined);
    render(<MessageList onRetryTurn={onRetryTurn} />);
    const onRetryFailed = (captured as Record<string, unknown>).onRetryFailed as (
      message: ChatMessage,
    ) => Promise<void>;

    await act(async () => {
      await onRetryFailed(failedMessage);
    });

    expect(mockContext.clearFailedSend).toHaveBeenCalledWith(failedMessage);
    expect(onRetryTurn).toHaveBeenCalledWith('I retreat.');
    expect(mockContext.sendMessage).not.toHaveBeenCalled();
  });

  it('falls back to the full-message send, then to a plain send with the flag stripped', async () => {
    const onSendFullMessage = vi.fn().mockResolvedValue(undefined);
    render(<MessageList onSendFullMessage={onSendFullMessage} />);
    const retryViaFull = (captured as Record<string, unknown>).onRetryFailed as (
      message: ChatMessage,
    ) => Promise<void>;

    await act(async () => {
      await retryViaFull(failedMessage);
    });
    expect(onSendFullMessage).toHaveBeenCalledWith('I retreat.');

    render(<MessageList />);
    const retryViaPlain = (captured as Record<string, unknown>).onRetryFailed as (
      message: ChatMessage,
    ) => Promise<void>;
    await act(async () => {
      await retryViaPlain(failedMessage);
    });
    expect(mockContext.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'I retreat.',
        context: expect.objectContaining({ sendFailed: false }),
      }),
    );
  });
});
