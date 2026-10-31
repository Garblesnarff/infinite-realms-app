/**
 * #760: the composer provider lives in GameMainContent. This mounts that
 * component, including its chat dock, and clicks the real option buttons.
 * A test that wraps MessageList in its own provider would still pass if this
 * provider were removed.
 *
 * Real: GameMainContent, ComposerDraftProvider, MessageList, MessageListContainer,
 * MessageRenderer, DynamicOptionsSection, ActionOptions, ChatInput,
 * parseMessageOptions, createPlayerMessageFromOption.
 * The send spy is the handler's handleSendMessage, the same function the dock passes
 * to MessageList and ChatInput.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GameMainContent } from '../game-content/GameMainContent';

import type { SpellCastHandlerRef } from '../../game/spell-cast-handler';
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
  handleSendMessage: vi.fn().mockResolvedValue(undefined),
  contextSend: vi.fn().mockResolvedValue(undefined),
  currentRoll: null as { id: string } | null,
  rollRequest: null as { formula: string } | null,
}));

vi.mock('@/contexts/MessageContext', () => ({
  useMessageContext: () => ({
    messages: harness.messages,
    isLoading: false,
    messagesReady: true,
    sendMessage: harness.contextSend,
    queueStatus: 'idle',
    hasMore: false,
    loadMore: vi.fn(),
    isFetchingMore: false,
    failedSends: [],
    clearFailedSend: vi.fn(),
  }),
}));
vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({ state: { character: { id: 'char-1', name: 'Hark' } } }),
  useOptionalCharacter: () => ({ state: { character: { id: 'char-1', name: 'Hark' } } }),
}));
vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: () => ({ state: { campaign: { id: 'campaign-1', name: 'Stranger Feast' } } }),
  useOptionalCampaign: () => ({
    state: { campaign: { id: 'campaign-1', name: 'Stranger Feast' } },
  }),
}));
vi.mock('@/contexts/CombatContext', () => ({
  useCombat: () => ({
    state: { isInCombat: false, activeEncounter: null },
    refreshCombatState: vi.fn(),
  }),
  useOptionalCombat: () => undefined,
}));
vi.mock('@/contexts/CampaignAssetsContext', () => ({
  useCampaignAssetsContext: () => ({ getAssetImageUrl: vi.fn() }),
}));
vi.mock('@/contexts/GameContext', () => ({
  useGame: () => ({
    state: {
      diceRollQueue: { pendingRolls: [], currentRollId: null, isProcessingRoll: false },
    },
    processAiResponse: vi.fn(),
    getCurrentDiceRoll: () => null,
  }),
}));
vi.mock('react-router-dom', () => ({
  useParams: () => ({}),
  useNavigate: () => vi.fn(),
}));
vi.mock('../../chat/message-list/useImageGeneration', () => ({
  useImageGeneration: () => ({
    generatingFor: new Set(),
    imageByMessage: {},
    genErrorByMessage: {},
    handleGenerateScene: vi.fn(),
  }),
}));
vi.mock('../../chat/message-list/useScrollBehavior', () => ({ useScrollBehavior: vi.fn() }));
vi.mock('../../chat/message-list/DMMessage', () => ({
  DMMessage: ({ displayContent }: { displayContent: string }) => <p>{displayContent}</p>,
}));
vi.mock('../../chat/message-list/use-message-dice-rolls', () => ({
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
vi.mock('../../chat/message-list/RollAutoCountdown', () => ({ RollAutoCountdown: () => null }));
vi.mock('@/components/game/DiceRollRequest', () => ({
  DiceRollRequest: () => <div data-testid="dice-roll-request" />,
}));
vi.mock('@/hooks/combat/use-player-roll-host', () => ({ usePlayerRollHost: vi.fn() }));
vi.mock('../overhaul/useOverhaulViewModel', () => ({
  useOverhaulViewModel: () => ({
    scene: { title: 'THE LIVE CAMPAIGN', blurb: 'The vial waits.' },
    campaign: { chapter: 'Chapter 1' },
  }),
}));
vi.mock('../overhaul/CombatTurnBar', () => ({ CombatTurnBarLive: () => null }));
vi.mock('../overhaul/SceneHeader', () => ({
  SceneHeader: () => <header data-testid="scene-header" />,
}));
vi.mock('../message/MessageHandler', () => ({
  MessageHandler: ({
    children,
  }: {
    children: (args: {
      handleSendMessage: typeof harness.handleSendMessage;
      isProcessing: boolean;
      isReconnecting: boolean;
      isStillThinking: boolean;
      attackWaitLabel: null;
      sendError: null;
      onRetry: undefined;
      retryInFlight: boolean;
      combatTurnUiState: {
        holder: null;
        pendingIntent: null;
        preflight: 'idle';
        error: undefined;
      };
      onResumeTurn: () => void;
    }) => React.ReactNode;
  }) =>
    children({
      handleSendMessage: harness.handleSendMessage,
      isProcessing: false,
      isReconnecting: false,
      isStillThinking: false,
      attackWaitLabel: null,
      sendError: null,
      onRetry: undefined,
      retryInFlight: false,
      combatTurnUiState: {
        holder: null,
        pendingIntent: null,
        preflight: 'idle',
        error: undefined,
      },
      onResumeTurn: () => undefined,
    }),
}));
vi.mock('../CombatActionBar', () => ({
  CombatActionBarLive: () => null,
  useCombatChatPlaceholder: () => undefined,
}));
vi.mock('../TimelineRail', () => ({ TimelineRail: () => null }));
vi.mock('../StatsBar', () => ({ StatsBar: () => null }));
vi.mock('../../tactical/TacticalMapBoard', () => ({ TacticalMapBoard: () => null }));
vi.mock('@/components/safety/SafetyBanner', () => ({ SafetyBanner: () => null }));
vi.mock('../game-content/GamePanelControls', () => ({ GamePanelControls: () => null }));

const baseProps = {
  sessionId: 'session-760',
  campaignIdForHandler: 'campaign-1',
  characterIdForHandler: 'char-1',
  sessionData: {
    id: 'session-760',
    turn_count: 2,
    current_scene_description: 'The vial waits on the bench.',
  } as never,
  updateGameSessionState: vi.fn(),
  showSceneBlurb: true,
  onSceneBlurbToggle: vi.fn(),
  isLeftCollapsed: false,
  isRightCollapsed: false,
  onLeftToggle: vi.fn(),
  onRightToggle: vi.fn(),
  showTracker: false,
  setShowTracker: vi.fn(),
  isCombatDetected: false,
  isGeneratingGreeting: false,
  innerHandleAIResponse: vi.fn(),
  spellCastHandlerRef: { current: null } as SpellCastHandlerRef,
  contentWarnings: [],
  comfortLevel: 'pg13' as const,
  showSafetyInfo: false,
};

describe('GameMainContent option clicks (#760)', () => {
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
    harness.handleSendMessage.mockClear();
    harness.contextSend.mockClear();
    sessionStorage.removeItem(PENDING_INPUT_STORAGE_KEY);
  });

  it('fills the dock composer from the real provider, then sends option 2 once', async () => {
    render(<GameMainContent {...baseProps} />);

    const first = parsedOptions[0];
    const second = parsedOptions[1];
    const composer = screen.getByRole('textbox', {
      name: 'Describe what your character would like to do',
    });

    await user.click(await screen.findByRole('button', { name: `Option 1 - ${first.text}` }));

    expect(harness.handleSendMessage).not.toHaveBeenCalled();
    expect(harness.contextSend).not.toHaveBeenCalled();
    await waitFor(() => expect(composer).toHaveValue(createPlayerMessageFromOption(first)));

    const secondButton = await screen.findByRole('button', { name: `Option 2 - ${second.text}` });
    await waitFor(() => expect(secondButton).toBeEnabled());
    await user.click(secondButton);

    expect(harness.handleSendMessage).not.toHaveBeenCalled();
    await waitFor(() => expect(composer).toHaveValue(createPlayerMessageFromOption(second)));

    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(harness.handleSendMessage).toHaveBeenCalledTimes(1);
    expect(harness.handleSendMessage).toHaveBeenCalledWith(createPlayerMessageFromOption(second));
    expect(harness.contextSend).not.toHaveBeenCalled();
  });

  it('keeps the open roll tray when an option is clicked', async () => {
    harness.currentRoll = { id: 'roll-1' };
    harness.rollRequest = { formula: '1d20+2' };
    render(<GameMainContent {...baseProps} />);

    const option = await screen.findByRole('button', {
      name: `Option 1 - ${parsedOptions[0].text}`,
    });
    expect(option).toBeDisabled();
    fireEvent.click(option);

    expect(harness.handleSendMessage).not.toHaveBeenCalled();
    expect(harness.contextSend).not.toHaveBeenCalled();
    expect(screen.getByTestId('dice-roll-request')).toBeInTheDocument();
    expect(
      screen.getByRole('textbox', { name: 'Describe what your character would like to do' }),
    ).toHaveValue('');
  });
});
