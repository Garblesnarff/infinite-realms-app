/**
 * #760: MessageList.handleOptionSelect sends. DynamicOptionsSection calls it
 * for a combat chip the engine does not run. Staging that callback would
 * swallow the chip whenever the composer provider is mounted.
 *
 * The option row itself is covered in DynamicOptionsSection.combat-fallback-send.
 * This file replaces that row with a button that calls the onOptionSelect
 * MessageList actually passed down.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatInput } from '../ChatInput';
import { ComposerDraftProvider } from '../composer-draft';
import { MessageList } from '../MessageList';

import type { ChatMessage } from '@/types/game';

import { PENDING_INPUT_STORAGE_KEY } from '@/services/auth/TokenService';

const harness = vi.hoisted(() => ({
  messages: [] as ChatMessage[],
  sendMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../message-list/DynamicOptionsSection', () => ({
  DynamicOptionsSection: ({
    onOptionSelect,
  }: {
    onOptionSelect: (text: string) => Promise<void>;
  }) => (
    <button type="button" onClick={() => void onOptionSelect('Help your ally')}>
      fallback chip
    </button>
  ),
}));
vi.mock('@/contexts/MessageContext', () => ({
  useMessageContext: () => ({
    messages: harness.messages,
    isLoading: false,
    messagesReady: true,
    sendMessage: harness.sendMessage,
    hasMore: false,
    loadMore: vi.fn(),
    isFetchingMore: false,
    failedSends: [],
    clearFailedSend: vi.fn(),
  }),
}));
vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({ state: { character: null } }),
}));
vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: () => ({ state: { campaign: null } }),
}));
vi.mock('@/contexts/CombatContext', () => ({
  useCombat: () => ({
    state: { isInCombat: false, activeEncounter: null },
    refreshCombatState: vi.fn(),
  }),
}));
vi.mock('@/contexts/CampaignAssetsContext', () => ({
  useCampaignAssetsContext: () => ({ getAssetImageUrl: vi.fn() }),
}));
vi.mock('@/contexts/GameContext', () => ({
  useGame: () => ({
    state: { diceRollQueue: { pendingRolls: [] } },
    processAiResponse: vi.fn(),
  }),
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
vi.mock('../message-list/DMMessage', () => ({
  DMMessage: ({ displayContent }: { displayContent: string }) => <p>{displayContent}</p>,
}));
vi.mock('../message-list/use-message-dice-rolls', () => ({
  useMessageDiceRolls: () => ({
    currentRoll: null,
    rollRequest: null,
    handleManualResult: vi.fn(),
    handleCancelRoll: vi.fn(),
    handleRetryRoll: vi.fn(),
    isRetrying: false,
    lastRollRef: { current: null },
    pendingRollId: null,
    rollError: null,
    completedRoll: null,
  }),
}));
vi.mock('../message-list/RollAutoCountdown', () => ({ RollAutoCountdown: () => null }));
vi.mock('@/components/game/DiceRollRequest', () => ({
  DiceRollRequest: () => null,
}));
vi.mock('@/hooks/combat/use-player-roll-host', () => ({ usePlayerRollHost: vi.fn() }));

const DM_TEXT = ['The fight is open.', '', '1. **Hold the line**, and wait.'].join('\n');

describe('MessageList sends a combat fallback chip (#760)', () => {
  const user = userEvent.setup();

  beforeEach(() => {
    harness.messages = [
      {
        id: 'dm-1',
        sender: 'dm',
        text: DM_TEXT,
        timestamp: '2026-10-16T00:00:00.000Z',
        context: { initialGreeting: true },
      },
    ];
    harness.sendMessage.mockClear();
    sessionStorage.removeItem(PENDING_INPUT_STORAGE_KEY);
  });

  it('sends the chip text and does not leave it in the composer', async () => {
    const onSendFullMessage = vi.fn().mockResolvedValue(undefined);
    render(
      <ComposerDraftProvider>
        <MessageList
          onSendFullMessage={onSendFullMessage}
          sessionId="session-760"
          containerRef={createRef<HTMLDivElement>()}
        />
        <ChatInput onSendMessage={onSendFullMessage} isDisabled={false} />
      </ComposerDraftProvider>,
    );

    await user.click(await screen.findByRole('button', { name: 'fallback chip' }));

    await waitFor(() => expect(onSendFullMessage).toHaveBeenCalledWith('Help your ally'));
    expect(onSendFullMessage).toHaveBeenCalledTimes(1);
    expect(harness.sendMessage).not.toHaveBeenCalled();
    expect(
      screen.getByRole('textbox', { name: 'Describe what your character would like to do' }),
    ).toHaveValue('');
  });
});
