import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ENEMY_FAILS_SAVE,
  FIGHT_ROSTER,
  REEVES,
  SCHOLAR,
  spellAction,
} from '../../../../../../shared/test-fixtures/engine-results';
import { GameMainContent } from '../game-content/GameMainContent';
import { RollTray } from '../game-content/roll-tray-slot';

import { trackDmWait } from '@/services/ai/dm-wait';
import { formatCombatEngineParts } from '@/services/combat/combat-outcome-transcript';
import {
  beginSheetCast,
  beginSheetCastCommit,
  finishSheetCast,
  reportSheetCastResult,
  resetSheetCastProgress,
} from '@/services/combat/sheet-cast-progress';

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
  tacticalMap: null as null | { id: string },
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
vi.mock('../overhaul/CombatTurnBar', () => ({ CombatTurnBarLive: () => null }));
vi.mock('../overhaul/SceneHeader', () => ({
  SceneHeader: ({ title, blurb }: { title: string; blurb?: string }) => (
    <header data-testid="scene-header">
      {title}: {blurb}
    </header>
  ),
}));
vi.mock('../../chat/MessageList', () => ({
  MessageList: ({
    suppressEmptyState,
    containerRef,
  }: {
    suppressEmptyState: boolean;
    containerRef?: React.RefObject<HTMLDivElement>;
  }) => (
    <div ref={containerRef} data-testid="message-list" data-suppress-empty={suppressEmptyState}>
      streamed DM narrative
      <div data-testid="dice-card">d20: 18</div>
      <button>Quick action</button>
      {/* The real list portals the queue's roll prompt into the tray the same way. */}
      {state.currentRoll && (
        <RollTray>
          <button type="button">Roll Dice</button>
        </RollTray>
      )}
    </div>
  ),
}));
vi.mock('../../tactical/TacticalMapProvider', () => ({
  useTacticalMapContext: () => (state.tacticalMap ? { map: state.tacticalMap } : null),
}));
vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({
    state: {
      character: { id: 'test-char-id', name: 'Test Character' },
    },
  }),
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
// #2456: DeathScreen uses useNavigate; mock it for terminal-state tests.
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));
vi.mock('../game-content/GamePanelControls', () => ({
  GamePanelControls: () => <div>Panel controls</div>,
}));

const sendMessage = vi.fn();
// #2456: configurable terminal state for death-screen tests.
let mockTerminalDeathState: { state: string; encounterId: string | null; receivedAt: number } | null = null;
vi.mock('../message/MessageHandler', () => ({
  MessageHandler: ({
    children,
  }: {
    children: (args: {
      handleSendMessage: typeof sendMessage;
      isProcessing: boolean;
      combatTurnUiState: typeof state.combatTurnUiState;
      onResumeTurn: typeof state.resumeCombatTurn;
      terminalDeathState: typeof mockTerminalDeathState;
    }) => React.ReactNode;
  }) =>
    children({
      handleSendMessage: sendMessage,
      isProcessing: false,
      combatTurnUiState: state.combatTurnUiState,
      onResumeTurn: state.resumeCombatTurn,
      terminalDeathState: mockTerminalDeathState,
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

const handlerRef = { spellCastHandlerRef: { current: null } };

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
    state.tacticalMap = null;
    sendMessage.mockClear();
    mockTerminalDeathState = null;
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

  // #2418: the pill read the message queue, which only covers the database write of the player's
  // message. It must stay up for the whole wait for the DM, whatever the queue says.
  it('keeps the "Dungeon Master is thinking" pill up for the whole DM call, not the queue write', async () => {
    state.queueStatus = 'idle';
    let answer!: () => void;
    const call = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const { rerender } = render(<GameMainContent {...baseProps} {...handlerRef} />);
    expect(screen.queryByText('Dungeon Master is thinking...')).not.toBeInTheDocument();

    act(() => {
      void trackDmWait(call);
    });
    expect(screen.getByText('Dungeon Master is thinking...')).toBeInTheDocument();
    // The queue write finishes long before the reply: the pill stays.
    state.queueStatus = 'idle';
    rerender(<GameMainContent {...baseProps} {...handlerRef} />);
    expect(screen.getByText('Dungeon Master is thinking...')).toBeInTheDocument();

    await act(async () => {
      answer();
      await call;
    });
    expect(screen.queryByText('Dungeon Master is thinking...')).not.toBeInTheDocument();
  });

  it('scrolls the feed to its newest card when a cast resolves (#2418)', () => {
    render(<GameMainContent {...baseProps} {...handlerRef} />);
    const feed = screen.getByTestId('message-list');
    Object.defineProperty(feed, 'scrollHeight', { configurable: true, value: 900 });
    feed.scrollTop = 0;

    act(() => {
      beginSheetCast('Acid Splash');
      beginSheetCastCommit('Captain Sarah Reeves');
      reportSheetCastResult(
        formatCombatEngineParts(spellAction(SCHOLAR, REEVES), ENEMY_FAILS_SAVE, FIGHT_ROSTER)[0]
          .card,
      );
      finishSheetCast();
    });

    expect(feed.scrollTop).toBe(900);
    act(() => resetSheetCastProgress());
  });

  it('puts the pill away while a roll waits for the player, even with a DM call counted', async () => {
    state.currentRoll = {
      id: 'save-1',
      status: 'pending',
      requestType: 'saving_throw',
      description: 'Wisdom saving throw',
    };
    let answer!: () => void;
    const call = new Promise<void>((resolve) => {
      answer = resolve;
    });
    render(<GameMainContent {...baseProps} {...handlerRef} />);

    act(() => {
      void trackDmWait(call);
    });
    expect(screen.queryByText('Dungeon Master is thinking...')).not.toBeInTheDocument();

    await act(async () => {
      answer();
      await call;
    });
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

  it('never shows an engine line in the scene subtitle (#2256)', () => {
    render(
      <GameMainContent
        {...baseProps}
        sessionData={
          {
            ...baseProps.sessionData,
            current_scene_description:
              '⚙️ Engine: The Veteran rolled 14 + 5 = 19 vs AC 12 — HIT. The goblin reels back.',
          } as never
        }
      />,
    );

    const header = screen.getByTestId('scene-header');
    expect(header).not.toHaveTextContent('Engine:');
    expect(header).not.toHaveTextContent('⚙');
    expect(header).not.toHaveTextContent('rolled 14');
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
  describe('roll tray and tactical map placement (#2252)', () => {
    const OVERLAY = /(^|\s)(fixed|absolute|sticky)(\s|$)/;

    it('docks the roll tray in the main column between the stream and the composer, not in an overlay', () => {
      state.currentRoll = {
        id: 'attack-1',
        status: 'pending',
        requestType: 'attack',
        description: 'Longsword attack vs Faceless Stalker',
      };
      const { container } = render(<GameMainContent {...baseProps} isCombatDetected />);

      const rollButton = screen.getByRole('button', { name: 'Roll Dice' });
      const slot = screen.getByTestId('roll-tray-slot');
      const stream = screen.getByTestId('message-list');
      const composer = screen.getByTestId('chat-input');

      expect(slot).toContainElement(rollButton);
      expect(stream).not.toContainElement(rollButton);
      expect(stream.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(
        slot.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      // Normal flow all the way up: nothing between the button and the page positions it.
      for (let el: HTMLElement | null = rollButton; el && el !== container; el = el.parentElement) {
        expect(el.className).not.toMatch(OVERLAY);
        expect(['fixed', 'absolute', 'sticky']).not.toContain(el.style.position);
      }
    });

    it('renders an empty tray slot and no roll status when no roll is pending', () => {
      render(<GameMainContent {...baseProps} />);

      expect(screen.getByTestId('roll-tray-slot')).toBeEmptyDOMElement();
      expect(screen.queryByRole('button', { name: 'Roll Dice' })).not.toBeInTheDocument();
      expect(screen.queryByText(/Your roll:/)).not.toBeInTheDocument();
    });

    it('keeps the tactical map out of the center column when the rail shows it', () => {
      state.tacticalMap = { id: 'map-1' };
      render(<GameMainContent {...baseProps} mapInRail />);

      expect(screen.queryByTestId('tactical-map-board')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Map' })).not.toBeInTheDocument();
    });

    it('opens the map in a sheet above the dock, never over the tray or the composer', () => {
      state.tacticalMap = { id: 'map-1' };
      state.currentRoll = {
        id: 'attack-1',
        status: 'pending',
        requestType: 'attack',
        description: 'Longsword attack vs Faceless Stalker',
      };
      render(<GameMainContent {...baseProps} isLeftCollapsed />);

      expect(screen.queryByTestId('tactical-map-board')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Map' }));

      const sheet = screen.getByRole('dialog', { name: 'Tactical map' });
      expect(sheet).toContainElement(screen.getByTestId('tactical-map-board'));
      // The sheet is not an ancestor of the tray or the chat box, and does not sit inside them.
      const slot = screen.getByTestId('roll-tray-slot');
      const composer = screen.getByTestId('chat-input');
      expect(sheet).not.toContainElement(slot);
      expect(sheet).not.toContainElement(composer);
      expect(slot).not.toContainElement(sheet);
      expect(screen.getByRole('button', { name: 'Roll Dice' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Close map' }));
      expect(screen.queryByRole('dialog', { name: 'Tactical map' })).not.toBeInTheDocument();
    });

    it('offers no Map button when there is no tactical map', () => {
      render(<GameMainContent {...baseProps} isLeftCollapsed />);
      expect(screen.queryByRole('button', { name: 'Map' })).not.toBeInTheDocument();
    });
  });

  it('#2456: renders the death screen when terminalDeathState is set', () => {
    mockTerminalDeathState = {
      state: 'party_defeated',
      encounterId: 'encounter-789',
      receivedAt: Date.now(),
    };
    render(<GameMainContent {...baseProps} />);
    expect(screen.getByTestId('death-screen')).toBeInTheDocument();
  });
});
