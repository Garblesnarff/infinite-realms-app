import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GameLayout } from '../game-content/GameLayout';
import { useGameRails } from '../game-content/use-game-rails';

/**
 * #2281: at 665 px the game opened with the character sheet over the chat box, and the typed
 * turn went nowhere. These tests pin where each panel may sit relative to the composer at
 * phone (390 px) and narrow-window (665 px) widths.
 *
 * jsdom has no layout engine, so "not covered" is checked through the structure that decides
 * it: a panel on a narrow screen is an absolute layer inside the story box, the story box is
 * a clipping, positioned box that ends where the dock begins, and the composer is in the dock.
 * Nothing that can overlap the composer is fixed to the viewport.
 */

const viewport = vi.hoisted(() => ({ width: 1440 }));

vi.mock('../game-content/EndSessionButton', () => ({
  EndSessionButton: () => <button>End session</button>,
}));

vi.mock('@/contexts/SceneBackgroundContext', () => ({
  useSceneBackground: () => ({ currentBackgroundUrl: null, isTransitioning: false }),
}));
vi.mock('@/contexts/MessageContext', () => ({
  useMessageContext: () => ({ queueStatus: 'idle', messages: [] }),
}));
vi.mock('@/contexts/GameContext', () => ({
  useGame: () => ({
    state: {
      diceRollQueue: {
        pendingRolls: [],
        currentRollId: undefined,
        isProcessingRoll: false,
        completedBatchRolls: [],
      },
    },
  }),
}));
vi.mock('../overhaul/useOverhaulViewModel', () => ({
  useOverhaulViewModel: () => ({
    scene: { title: 'THE ETERNAL FEAST', blurb: '' },
    campaign: { chapter: 'Chapter 1' },
  }),
}));
vi.mock('../overhaul/CombatTurnBar', () => ({ CombatTurnBarLive: () => null }));
vi.mock('../overhaul/SceneHeader', () => ({
  SceneHeader: ({ title }: { title: string }) => <header>{title}</header>,
}));
vi.mock('../../chat/MessageList', () => ({
  MessageList: () => <div data-testid="message-list">The DM speaks.</div>,
}));
vi.mock('../TimelineRail', () => ({ TimelineRail: () => null }));
vi.mock('@/components/safety/SafetyBanner', () => ({ SafetyBanner: () => null }));
vi.mock('../../chat/ChatInput', () => ({
  ChatInput: () => <textarea data-testid="composer" aria-label="Message the DM" />,
}));
vi.mock('../message/MessageHandler', () => ({
  MessageHandler: ({ children }: { children: (args: unknown) => React.ReactNode }) =>
    children({
      handleSendMessage: vi.fn(),
      isProcessing: false,
      combatTurnUiState: { holder: null, pendingIntent: null, preflight: 'idle' },
      onResumeTurn: vi.fn(),
    }),
}));
vi.mock('../../tactical/TacticalMapProvider', () => ({
  TacticalMapProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useTacticalMapContext: () => null,
}));
vi.mock('../game-content/GamePanelControls', () => ({
  GamePanelControls: ({
    onLeftToggle,
    onRightToggle,
  }: {
    onLeftToggle: () => void;
    onRightToggle: () => void;
  }) => (
    <>
      <button onClick={onLeftToggle}>Toggle Campaign</button>
      <button onClick={onRightToggle}>Toggle Character</button>
    </>
  ),
}));
vi.mock('../game-content/GameLeftPanel', () => ({
  GameLeftPanel: ({ isCollapsed }: { isCollapsed: boolean }) =>
    isCollapsed ? null : <div data-testid="campaign-rail">Campaign</div>,
}));
vi.mock('../MemoryPanel', () => ({
  GameSidePanel: () => <div data-testid="character-sheet">Character sheet</div>,
}));
vi.mock('../game-content/TableContextCard', () => ({
  TableContextCard: () => <div data-testid="table-context-card" />,
}));
vi.mock('../game-content/GameCombatSheet', () => ({ GameCombatSheet: () => null }));

/** A matchMedia that answers min-/max-width queries for `viewport.width`. */
function matchMediaForViewport(query: string): MediaQueryList {
  const min = /min-width:\s*(\d+)px/.exec(query);
  const max = /max-width:\s*(\d+)px/.exec(query);
  const matches =
    (!min || viewport.width >= Number(min[1])) && (!max || viewport.width <= Number(max[1]));
  return {
    matches,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  } as MediaQueryList;
}

const layoutProps = {
  sessionId: 'session-1',
  campaignIdForHandler: 'campaign-1',
  characterIdForHandler: 'character-1',
  sessionData: { id: 'session-1', turn_count: 3 } as never,
  updateGameSessionState: vi.fn(),
  showSceneBlurb: false,
  onSceneBlurbToggle: vi.fn(),
  combatMode: false,
  showTracker: false,
  setShowTracker: vi.fn(),
  isCombatDetected: false,
  isGeneratingGreeting: false,
  innerHandleAIResponse: vi.fn(),
  isDM: false,
  spellCastHandlerRef: { current: null },
  contentWarnings: [],
  comfortLevel: 'pg13' as const,
  showSafetyInfo: false,
};

/** The game screen as GameContent wires it: rail state from useGameRails. */
function Game(): React.ReactElement {
  const rails = useGameRails();
  return <GameLayout {...layoutProps} {...rails} />;
}

/** A wide window last left both rails open; that is what localStorage says on reopen. */
function rememberRailsOpen(): void {
  window.localStorage.setItem('ui:leftPanelCollapsed:v2', 'false');
  window.localStorage.setItem('ui:rightPanelCollapsed:v2', 'false');
}

/** Asserts that `panel` sits in the story box, which cannot reach the composer. */
function expectOverStoryNotComposer(panel: HTMLElement): void {
  const storyBox = screen.getByTestId('story-box');
  const composer = screen.getByTestId('composer');

  expect(storyBox).toContainElement(panel);
  expect(storyBox).not.toContainElement(composer);
  // The story box comes before the dock, is the positioning parent of anything absolute in
  // it, and clips it: an absolute layer inside it ends where the dock begins.
  expect(
    storyBox.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(storyBox).toHaveClass('relative', 'overflow-hidden');
  expect(storyBox.contains(composer.closest('.shrink-0'))).toBe(false);
}

/** Nothing fixed to the viewport is showing that could land on the composer. */
function expectNoFixedOverlayShowing(): void {
  for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('.fixed'))) {
    // The table roll column is fixed on a phone and hides itself while empty.
    if (el.getAttribute('data-testid') === 'table-roll-slot') {
      expect(el.className).toContain('empty:hidden');
      continue;
    }
    expect(el, el.outerHTML.slice(0, 120)).toHaveClass('hidden');
  }
}

describe.each([390, 665])('game layout at %i px (#2281)', (width) => {
  beforeEach(() => {
    viewport.width = width;
    vi.spyOn(window, 'matchMedia').mockImplementation(matchMediaForViewport);
    window.localStorage.clear();
    rememberRailsOpen();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('opens with the character drawer closed and the campaign rail beside the story', () => {
    render(<Game />);

    expect(screen.getByTestId('composer')).toBeInTheDocument();
    expect(screen.queryByTestId('character-sheet')).not.toBeInTheDocument();
    const rail = screen.getByTestId('campaign-rail');
    expect(screen.getByTestId('story-box')).not.toContainElement(rail);
    expect(screen.queryByTestId('quick-actions')).not.toBeInTheDocument();
    expectNoFixedOverlayShowing();
  });

  it('opens the sheet over the story box, never over the composer', () => {
    render(<Game />);

    fireEvent.click(screen.getByRole('button', { name: 'Toggle Character' }));

    const layer = screen.getByTestId('rail-over-story');
    // A bottom sheet in the story box's flow (#2418), not a cover: the feed above it shrinks and
    // keeps its newest card. It takes 68% of the box when nothing is casting.
    expect(layer).toHaveClass('relative', 'shrink-0');
    expect(layer).not.toHaveClass('absolute', 'inset-0');
    expect(layer).toHaveStyle({ height: '68%' });
    expect(layer.parentElement).toBe(screen.getByTestId('story-box'));
    expectOverStoryNotComposer(screen.getByTestId('character-sheet'));
    expectNoFixedOverlayShowing();
    // The composer is still there and can take a turn.
    expect(screen.getByTestId('composer')).toBeEnabled();
  });

  it('hides the campaign rail in its column and opens the sheet over the story', () => {
    render(<Game />);

    fireEvent.click(screen.getByRole('button', { name: 'Toggle Campaign' }));
    expect(screen.queryByTestId('campaign-rail')).not.toBeInTheDocument();
    expect(screen.queryByTestId('rail-over-story')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Toggle Character' }));
    expectOverStoryNotComposer(screen.getByTestId('character-sheet'));

    fireEvent.click(screen.getByRole('button', { name: 'Toggle Character' }));
    expect(screen.queryByTestId('character-sheet')).not.toBeInTheDocument();
    expect(screen.queryByTestId('rail-over-story')).not.toBeInTheDocument();
  });

  it('focuses the open rail and closes it on Escape, returning focus (#2287 NIT)', () => {
    render(<Game />);
    const toggle = screen.getByRole('button', { name: 'Toggle Character' });
    toggle.focus();

    fireEvent.click(toggle);
    const layer = screen.getByTestId('rail-over-story');
    expect(layer).toContainElement(document.activeElement as HTMLElement);

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    expect(screen.queryByTestId('rail-over-story')).not.toBeInTheDocument();
    expect(screen.queryByTestId('character-sheet')).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();
  });

  it('does not lay the campaign rail over the story', () => {
    render(<Game />);

    const rail = screen.getByTestId('campaign-rail');
    expect(screen.getByTestId('story-box')).not.toContainElement(rail);
    fireEvent.click(screen.getByRole('button', { name: 'Toggle Campaign' }));
    expect(screen.queryByTestId('campaign-rail')).not.toBeInTheDocument();
    expect(screen.queryByTestId('rail-over-story')).not.toBeInTheDocument();
  });

  it('does not write the narrow open/closed state over the wide-window preference', () => {
    render(<Game />);

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Toggle Character' }));
      fireEvent.click(screen.getByRole('button', { name: 'Toggle Character' }));
    });

    expect(window.localStorage.getItem('ui:rightPanelCollapsed:v2')).toBe('false');
  });
});

describe('game layout at 1440 px', () => {
  beforeEach(() => {
    viewport.width = 1440;
    vi.spyOn(window, 'matchMedia').mockImplementation(matchMediaForViewport);
    window.localStorage.clear();
    rememberRailsOpen();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('keeps the campaign rail beside the story and leaves the character drawer shut', () => {
    render(<Game />);

    const rail = screen.getByTestId('campaign-rail');
    expect(screen.getByTestId('story-box')).not.toContainElement(rail);
    expect(screen.queryByTestId('character-sheet')).not.toBeInTheDocument();
    expect(screen.queryByTestId('rail-over-story')).not.toBeInTheDocument();
    expect(window.localStorage.getItem('ui:rightPanelCollapsed:v2')).toBe('false');
  });
});
