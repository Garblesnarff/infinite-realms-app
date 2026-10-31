/**
 * #760: an ordinary option click fills the composer. It does not send.
 * A second click replaces that text. Send submits it once.
 * An open roll tray disables the options so the click cannot void the tray.
 *
 * Real: MessageList.handleOptionSelect, MessageListContainer, MessageRenderer,
 * DynamicOptionsSection, ActionOptions, ChatInput, parseMessageOptions,
 * createPlayerMessageFromOption. The send callback is the live onSendFullMessage.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatInput } from '../ChatInput';
import { ComposerDraftProvider } from '../composer-draft';
import { MessageList } from '../MessageList';

import type { ChatMessage } from '@/types/game';

import { PENDING_INPUT_STORAGE_KEY } from '@/services/auth/TokenService';
import { createPlayerMessageFromOption, parseMessageOptions } from '@/utils/parseMessageOptions';

const DM_TEXT = [
  'The vial waits on the bench.',
  '',
  '1. **Prepare the Essence of Regret**, steady the glass.',
  '2. **Carefully whisk the liquid**, using your Sleight of Hand.',
].join('\n');

const parsedOptions = parseMessageOptions(DM_TEXT).options;

const harness = vi.hoisted(() => ({
  messages: [] as ChatMessage[],
  sendMessage: vi.fn().mockResolvedValue(undefined),
  currentRoll: null as { id: string } | null,
  rollRequest: null as { formula: string } | null,
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
  useOptionalCombat: () => null,
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
    currentRoll: harness.currentRoll,
    rollRequest: harness.rollRequest,
    handleManualResult: vi.fn(),
    handleCancelRoll: vi.fn(),
    handleRetryRoll: vi.fn(),
    isRetrying: false,
    lastRollRef: { current: null },
    pendingRollId: harness.currentRoll?.id ?? null,
    rollError: null,
    completedRoll: null,
  }),
}));
vi.mock('../message-list/RollAutoCountdown', () => ({ RollAutoCountdown: () => null }));
vi.mock('@/components/game/DiceRollRequest', () => ({
  DiceRollRequest: () => <div data-testid="dice-roll-request" />,
}));
vi.mock('@/hooks/combat/use-player-roll-host', () => ({ usePlayerRollHost: vi.fn() }));

function Story({
  onSendFullMessage,
  composerMounted,
}: {
  onSendFullMessage: ReturnType<typeof vi.fn>;
  composerMounted: boolean;
}): ReactElement {
  return (
    <ComposerDraftProvider>
      <MessageList
        onSendFullMessage={onSendFullMessage}
        sessionId="session-760"
        containerRef={createRef<HTMLDivElement>()}
      />
      {composerMounted ? <ChatInput onSendMessage={onSendFullMessage} isDisabled={false} /> : null}
    </ComposerDraftProvider>
  );
}

function renderStory(onSendFullMessage: ReturnType<typeof vi.fn>): ReturnType<typeof render> {
  return render(<Story onSendFullMessage={onSendFullMessage} composerMounted />);
}

describe('option clicks fill the composer (#760)', () => {
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
    harness.currentRoll = null;
    harness.rollRequest = null;
    harness.sendMessage.mockClear();
    sessionStorage.removeItem(PENDING_INPUT_STORAGE_KEY);
  });

  it('fills the composer on click, replaces it on a second click, and sends once', async () => {
    const onSendFullMessage = vi.fn().mockResolvedValue(undefined);
    const view = renderStory(onSendFullMessage);

    const first = parsedOptions[0];
    const second = parsedOptions[1];
    const composer = screen.getByRole('textbox', {
      name: 'Describe what your character would like to do',
    });

    await user.click(await screen.findByRole('button', { name: `Option 1 - ${first.text}` }));

    expect(onSendFullMessage).not.toHaveBeenCalled();
    expect(harness.sendMessage).not.toHaveBeenCalled();
    await waitFor(() => expect(composer).toHaveValue(createPlayerMessageFromOption(first)));
    expect(composer).toHaveFocus();

    const secondButton = await screen.findByRole('button', { name: `Option 2 - ${second.text}` });
    await waitFor(() => expect(secondButton).toBeEnabled());
    await user.click(secondButton);

    expect(onSendFullMessage).not.toHaveBeenCalled();
    await waitFor(() => expect(composer).toHaveValue(createPlayerMessageFromOption(second)));

    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(onSendFullMessage).toHaveBeenCalledTimes(1);
    expect(onSendFullMessage).toHaveBeenCalledWith(createPlayerMessageFromOption(second));
    await waitFor(() => expect(composer).toHaveValue(''));

    view.rerender(<Story onSendFullMessage={onSendFullMessage} composerMounted={false} />);
    view.rerender(<Story onSendFullMessage={onSendFullMessage} composerMounted />);
    expect(
      screen.getByRole('textbox', { name: 'Describe what your character would like to do' }),
    ).toHaveValue('');
  });

  it('does not send or stage an option while a roll tray is open', async () => {
    harness.currentRoll = { id: 'roll-1' };
    harness.rollRequest = { formula: '1d20+2' };
    const onSendFullMessage = vi.fn().mockResolvedValue(undefined);
    renderStory(onSendFullMessage);

    const option = await screen.findByRole('button', {
      name: `Option 1 - ${parsedOptions[0].text}`,
    });
    expect(option).toBeDisabled();
    fireEvent.click(option);

    expect(onSendFullMessage).not.toHaveBeenCalled();
    expect(harness.sendMessage).not.toHaveBeenCalled();
    expect(
      screen.getByRole('textbox', { name: 'Describe what your character would like to do' }),
    ).toHaveValue('');
    expect(screen.getByTestId('dice-roll-request')).toBeInTheDocument();
  });
});
