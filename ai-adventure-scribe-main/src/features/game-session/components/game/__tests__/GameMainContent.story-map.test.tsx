/**
 * #1754: the region map in the live game column. Real: GameMainContent, SceneHeader,
 * ComposerDraftProvider, ChatInput, StoryMapPanel and its parts, story-map-state.
 * Same harness as the #760 option-composer test; only the plaque is left real.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetStoryMapState } from '../../story-map/story-map-state';
import { GameMainContent } from '../game-content/GameMainContent';

import type { SpellCastHandlerRef } from '../../game/spell-cast-handler';
import type { ChatMessage } from '@/types/game';

import { PENDING_INPUT_STORAGE_KEY } from '@/services/auth/TokenService';

const harness = vi.hoisted(() => ({
  messages: [] as ChatMessage[],
  handleSendMessage: vi.fn().mockResolvedValue(undefined),
  contextSend: vi.fn().mockResolvedValue(undefined),
  currentRoll: null as { id: string } | null,
  rollRequest: null as { formula: string } | null,
}));

vi.mock('@/infrastructure/api/rest-client', async (importOriginal) => {
  const { storyMapResponse } = await import('../../story-map/__tests__/story-map-response');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    fetchWithAuth: vi.fn(storyMapResponse),
  };
});

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
vi.mock('../game-content/TableContextCard', () => ({
  TableContextCard: () => <div data-testid="table-context-card" />,
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

vi.mock('../../tactical/TacticalMapBoard', () => ({ TacticalMapBoard: () => null }));
vi.mock('@/components/safety/SafetyBanner', () => ({ SafetyBanner: () => null }));
vi.mock('../game-content/GamePanelControls', () => ({ GamePanelControls: () => null }));

const baseProps = {
  sessionId: 'session-1754',
  campaignIdForHandler: 'campaign-1',
  characterIdForHandler: 'char-1',
  sessionData: {
    id: 'session-1754',
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

const STARTER = { ...(baseProps.sessionData as object), starter_campaign_id: 'starter-1' } as never;

describe('GameMainContent region map (#1754)', () => {
  const user = userEvent.setup();
  let header: HTMLDivElement;

  beforeEach(() => {
    harness.messages = [
      {
        id: 'dm-1',
        sender: 'dm',
        text: 'The bridge creaks.',
        timestamp: '2026-11-25T00:00:00.000Z',
        context: { location: 'Old Toll Bridge' },
      },
    ];
    harness.currentRoll = null;
    harness.rollRequest = null;
    harness.handleSendMessage.mockClear();
    harness.contextSend.mockClear();
    sessionStorage.removeItem(PENDING_INPUT_STORAGE_KEY);
    document.body.replaceChildren();
    document.body.classList.add('ir-table-look');
    header = document.createElement('div');
    document.body.append(header);
  });
  afterEach(() => {
    resetStoryMapState();
    document.body.classList.remove('ir-table-look');
  });

  it('player-made campaigns (no starter campaign) show no map button', () => {
    render(<GameMainContent {...baseProps} tableHeaderSlot={header} />);
    expect(screen.getByText('Old Toll Bridge')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open map, you are at/ })).not.toBeInTheDocument();
  });

  it('phone/tablet: the plaque opens the map sheet above the dock, never over the composer', async () => {
    render(<GameMainContent {...baseProps} sessionData={STARTER} tableHeaderSlot={header} />);
    await user.click(
      await screen.findByRole('button', { name: 'Open map, you are at Old Toll Bridge' }),
    );
    const sheet = await screen.findByTestId('story-map-sheet');
    await screen.findByRole('tab', { name: 'Map' });
    const composer = screen.getByRole('textbox', {
      name: 'Describe what your character would like to do',
    });
    expect(sheet).not.toContainElement(composer);
    expect(document.getElementById('story-map-sheet')).toHaveClass('absolute', 'top-0');
  });

  it('Travel here fills the real composer, focuses it, and sends nothing', async () => {
    render(<GameMainContent {...baseProps} sessionData={STARTER} tableHeaderSlot={header} />);
    await user.click(
      await screen.findByRole('button', { name: 'Open map, you are at Old Toll Bridge' }),
    );
    await user.click(await screen.findByRole('tab', { name: 'Places' }));
    await user.click(screen.getByRole('button', { name: 'Travel here: Barrow Gate' }));
    const composer = screen.getByRole('textbox', {
      name: 'Describe what your character would like to do',
    });
    await waitFor(() => expect(composer).toHaveValue('I travel to Barrow Gate.'));
    expect(composer).toHaveFocus();
    expect(harness.handleSendMessage).not.toHaveBeenCalled();
    expect(harness.contextSend).not.toHaveBeenCalled();
  });

  it('Escape closes the sheet and returns focus to the plaque', async () => {
    render(<GameMainContent {...baseProps} sessionData={STARTER} tableHeaderSlot={header} />);
    const plaque = await screen.findByRole('button', {
      name: 'Open map, you are at Old Toll Bridge',
    });
    plaque.focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('tab', { name: 'Map' });
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('story-map-sheet')).not.toBeInTheDocument();
    expect(plaque).toHaveFocus();
  });

  it('when the rail holds the fight board, the map goes to the rail, not a sheet', async () => {
    render(
      <GameMainContent {...baseProps} sessionData={STARTER} tableHeaderSlot={header} mapInRail />,
    );
    await user.click(
      await screen.findByRole('button', { name: 'Open map, you are at Old Toll Bridge' }),
    );
    expect(screen.queryByTestId('story-map-sheet')).not.toBeInTheDocument();
  });
});
