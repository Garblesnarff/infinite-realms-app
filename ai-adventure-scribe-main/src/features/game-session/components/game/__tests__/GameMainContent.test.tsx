import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GameMainContent } from '../game-content/GameMainContent';

const state = vi.hoisted(() => ({
  queueStatus: 'idle',
  hasPendingRolls: false,
  pendingRequests: [] as Array<{ type: string; purpose?: string }>,
  lastChapterLabel: undefined as string | undefined,
  combatTurnUiState: {
    holder: null as string | null,
    pendingIntent: null as string | null,
    preflight: 'idle' as 'idle' | 'running' | 'ready' | 'unknown' | 'failed',
    error: undefined as string | undefined,
  },
  resumeCombatTurn: vi.fn(),
}));

vi.mock('@/contexts/MessageContext', () => ({
  useMessageContext: () => ({ queueStatus: state.queueStatus }),
}));
vi.mock('@/hooks/use-pending-rolls', () => ({
  usePendingRolls: () => ({
    hasPendingRolls: state.hasPendingRolls,
    pendingRequests: state.pendingRequests,
  }),
}));
vi.mock('../overhaul/useOverhaulViewModel', () => ({
  useOverhaulViewModel: ({
    sceneBlurb,
    chapterLabel,
  }: {
    sceneBlurb: string;
    chapterLabel?: string;
  }) => {
    state.lastChapterLabel = chapterLabel;
    return {
      scene: { title: 'THE LIVE CAMPAIGN', blurb: sceneBlurb },
      campaign: { chapter: chapterLabel ?? 'Chapter 1' },
    };
  },
}));
vi.mock('../overhaul/SceneHeader', () => ({
  SceneHeader: ({ title, blurb }: { title: string; blurb?: string }) => (
    <header data-testid="scene-header">
      {title}: {blurb}
    </header>
  ),
}));
vi.mock('../../chat/MessageList', () => ({
  MessageList: ({ suppressEmptyState }: { suppressEmptyState: boolean }) => (
    <div data-testid="message-list" data-suppress-empty={suppressEmptyState}>
      streamed DM narrative
      <div data-testid="dice-card">d20: 18</div>
      <button>Quick action</button>
    </div>
  ),
}));
vi.mock('../../chat/ChatInput', () => ({
  ChatInput: ({
    onSendMessage,
    isDisabled,
  }: {
    onSendMessage: (value: string) => void;
    isDisabled: boolean;
  }) => (
    <button
      data-testid="chat-input"
      disabled={isDisabled}
      onClick={() => onSendMessage('I advance')}
    >
      Send
    </button>
  ),
}));
vi.mock('../TimelineRail', () => ({ TimelineRail: () => <aside data-testid="timeline-rail" /> }));
vi.mock('../StatsBar', () => ({ StatsBar: () => <div>Stats</div> }));
vi.mock('../../tactical/TacticalMapBoard', () => ({
  TacticalMapBoard: () => <div data-testid="tactical-map-board" />,
}));
vi.mock('@/components/combat/CombatStatus', () => ({
  CombatStatus: () => <div>Combat status</div>,
}));
vi.mock('@/components/safety/SafetyBanner', () => ({ SafetyBanner: () => <div>Safety</div> }));
vi.mock('../game-content/GamePanelControls', () => ({
  GamePanelControls: () => <div>Panel controls</div>,
}));

const sendMessage = vi.fn();
vi.mock('../message/MessageHandler', () => ({
  MessageHandler: ({
    children,
  }: {
    children: (args: {
      handleSendMessage: typeof sendMessage;
      isProcessing: boolean;
      combatTurnUiState: typeof state.combatTurnUiState;
      onResumeTurn: typeof state.resumeCombatTurn;
    }) => React.ReactNode;
  }) =>
    children({
      handleSendMessage: sendMessage,
      isProcessing: false,
      combatTurnUiState: state.combatTurnUiState,
      onResumeTurn: state.resumeCombatTurn,
    }),
}));

const baseProps = {
  sessionId: 'session-1',
  campaignIdForHandler: 'campaign-1',
  characterIdForHandler: 'character-1',
  sessionData: {
    id: 'session-1',
    turn_count: 7,
    current_scene_description: 'Moonlight spills across the ruins. [ASSET:test]',
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
  contentWarnings: [],
  comfortLevel: 'pg13' as const,
  showSafetyInfo: false,
};

describe('GameMainContent overhaul behavior contract', () => {
  beforeEach(() => {
    state.queueStatus = 'idle';
    state.hasPendingRolls = false;
    state.pendingRequests = [];
    state.lastChapterLabel = undefined;
    state.combatTurnUiState = {
      holder: null,
      pendingIntent: null,
      preflight: 'idle',
      error: undefined,
    };
    state.resumeCombatTurn.mockClear();
    sendMessage.mockClear();
  });

  it('keeps the live message, dice, quick-action, timeline, and input surfaces in the navy center stage', () => {
    const { container } = render(<GameMainContent {...baseProps} />);

    expect(screen.getByTestId('scene-header')).toHaveTextContent('THE LIVE CAMPAIGN');
    expect(screen.getByTestId('message-list')).toHaveTextContent('streamed DM narrative');
    expect(screen.getByTestId('dice-card')).toHaveTextContent('d20: 18');
    expect(screen.getByRole('button', { name: 'Quick action' })).toBeInTheDocument();
    expect(screen.getByTestId('timeline-rail')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('chat-input'));
    expect(sendMessage).toHaveBeenCalledWith('I advance');
    expect(container.firstChild).toMatchSnapshot();
  });

  it('preserves streaming and initial-greeting states', () => {
    state.queueStatus = 'processing';
    render(<GameMainContent {...baseProps} isGeneratingGreeting />);

    expect(screen.getByText('Dungeon Master is thinking...')).toBeInTheDocument();
    expect(screen.getByText('Crafting Opening Scene')).toBeInTheDocument();
    expect(screen.getByTestId('message-list')).toHaveAttribute('data-suppress-empty', 'true');
  });

  it('blocks input while a dice request is pending', () => {
    state.hasPendingRolls = true;
    state.pendingRequests = [{ type: 'saving throw', purpose: 'Wisdom saving throw' }];
    render(<GameMainContent {...baseProps} />);

    expect(screen.getByRole('status')).toHaveTextContent('Your roll: Wisdom saving throw');
    expect(screen.getByText('Please complete the saving throw roll above')).toBeInTheDocument();
    expect(screen.getByTestId('chat-input')).toBeDisabled();
  });

  it('enables the composer after a move-only action and the NPC turn hand back to the player', () => {
    state.combatTurnUiState = {
      holder: 'player-1',
      pendingIntent: null,
      preflight: 'ready',
      error: undefined,
    };

    render(<GameMainContent {...baseProps} isCombatDetected />);

    expect(screen.getByTestId('chat-input')).not.toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Resume turn' })).toBeNull();
  });

  it('shows Resume turn for an unknown holder and reruns the recovery preflight', () => {
    state.combatTurnUiState = {
      holder: null,
      pendingIntent: null,
      preflight: 'unknown',
      error: undefined,
    };

    render(<GameMainContent {...baseProps} isCombatDetected />);

    const resumeButton = screen.getByRole('button', { name: 'Resume turn' });
    expect(resumeButton).toBeInTheDocument();
    expect(screen.getByTestId('chat-input')).toBeDisabled();

    fireEvent.click(resumeButton);
    expect(state.resumeCombatTurn).toHaveBeenCalledTimes(1);
  });

  it('shows the reconciliation error when combat turn recovery fails', () => {
    state.combatTurnUiState = {
      holder: 'npc-1',
      pendingIntent: null,
      preflight: 'failed',
      error: 'NPC turn runner unavailable',
    };

    render(<GameMainContent {...baseProps} isCombatDetected />);

    expect(screen.getByRole('status')).toHaveTextContent(
      'Combat turn refresh failed: NPC turn runner unavailable',
    );
    expect(screen.getByTestId('chat-input')).toBeDisabled();
  });

  it('does not treat session turn_count as a campaign chapter number', () => {
    render(
      <GameMainContent
        {...baseProps}
        sessionData={{ ...baseProps.sessionData, turn_count: 15 } as never}
        showSceneBlurb={false}
      />,
    );

    expect(state.lastChapterLabel).toBe('Chapter 1');
    expect(screen.getByTestId('scene-header')).toHaveTextContent('Chapter 1');
    expect(screen.getByTestId('scene-header')).not.toHaveTextContent('Chapter 15');
  });
});
