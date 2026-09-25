import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GameMainContent } from '../game-content/GameMainContent';

const state = vi.hoisted(() => ({
  queueStatus: 'idle',
  hasPendingRolls: false,
  pendingRequests: [] as Array<{ type: string; purpose?: string }>,
  currentRoll: null as null | {
    id: string;
    status: 'pending' | 'completed' | 'cancelled';
    description: string;
    purpose?: string;
    requestType: string;
  },
  getterRoll: null as null | {
    id: string;
    status: 'pending' | 'completed' | 'cancelled';
    description: string;
    purpose?: string;
    requestType: string;
  },
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
vi.mock('@/contexts/GameContext', () => ({
  useGame: () => ({
    state: {
      diceRollQueue: {
        pendingRolls: state.currentRoll ? [state.currentRoll] : [],
        currentRollId: state.currentRoll?.id,
        isProcessingRoll: false,
        completedBatchRolls: [],
      },
    },
    getCurrentDiceRoll: () => state.getterRoll,
  }),
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
    state.currentRoll = null;
    state.getterRoll = null;
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
    state.currentRoll = {
      id: 'save-1',
      status: 'pending',
      requestType: 'saving_throw',
      description: 'Wisdom saving throw',
    };
    render(<GameMainContent {...baseProps} />);

    expect(screen.getByRole('status')).toHaveTextContent('Your roll: Wisdom saving throw');
    expect(
      screen.getByText('Please complete the Wisdom saving throw roll above'),
    ).toBeInTheDocument();
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

  it('shows the dice-queue attack on the roll pill ahead of the combat checking pill', () => {
    state.currentRoll = {
      id: 'attack-1',
      status: 'pending',
      requestType: 'attack',
      description: 'Longsword attack vs …',
    };
    state.combatTurnUiState = {
      holder: null,
      pendingIntent: null,
      preflight: 'running',
      error: undefined,
    };

    render(<GameMainContent {...baseProps} isCombatDetected />);

    expect(screen.getByRole('status')).toHaveTextContent('Your roll: Longsword attack vs …');
    expect(
      screen.getByText('Please complete the Longsword attack vs … roll above'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Checking whose turn it is…')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume turn' })).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-input')).toBeDisabled();
  });

  it('lets the queue label own the banner and lock even when a chat roll is also parsed', () => {
    state.currentRoll = {
      id: 'attack-1',
      status: 'pending',
      requestType: 'attack',
      description: 'Longsword attack vs …',
    };
    state.hasPendingRolls = true;
    state.pendingRequests = [{ type: 'saving throw', purpose: 'Wisdom saving throw' }];

    render(<GameMainContent {...baseProps} />);

    expect(screen.getByRole('status')).toHaveTextContent('Your roll: Longsword attack vs …');
    expect(
      screen.getByText('Please complete the Longsword attack vs … roll above'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Wisdom saving throw/)).not.toBeInTheDocument();
    expect(screen.queryByText(/saving throw roll above/)).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-input')).toBeDisabled();
  });

  it('never shows the roll banner or locks input for a chat-parsed roll with no queued popup', () => {
    // #2234: engine prose "the-apprentice cast Acid Splash at …" parsed as a spell attack.
    // No queue entry means no dice popup, so there is nothing the player could click.
    state.hasPendingRolls = true;
    state.pendingRequests = [{ type: 'attack', purpose: 'Acid Splash spell attack' }];

    render(<GameMainContent {...baseProps} />);

    expect(screen.queryByText(/Your roll:/)).not.toBeInTheDocument();
    expect(screen.queryByText('Roll required')).not.toBeInTheDocument();
    expect(screen.queryByText(/Please complete/)).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-input')).not.toBeDisabled();
  });

  it('drops the banner and lock once the queued roll is no longer pending', () => {
    state.currentRoll = {
      id: 'attack-1',
      status: 'cancelled',
      requestType: 'attack',
      description: 'Acid Splash spell attack vs Flavor-Elemental',
    };

    render(<GameMainContent {...baseProps} />);

    expect(screen.queryByText('Roll required')).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-input')).not.toBeDisabled();
  });

  it('ignores a getCurrentDiceRoll result that is not on diceRollQueue state', () => {
    state.getterRoll = {
      id: 'stale-1',
      status: 'pending',
      requestType: 'attack',
      description: 'Stale longsword',
    };

    render(<GameMainContent {...baseProps} />);

    expect(screen.queryByText(/Stale longsword/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Your roll:/)).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-input')).not.toBeDisabled();
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
