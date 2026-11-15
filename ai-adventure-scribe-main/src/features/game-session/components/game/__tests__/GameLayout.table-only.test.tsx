import { render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GameLayout } from '../game-content/GameLayout';

import type { SpellCastHandlerRef } from '../../game/spell-cast-handler';

import { tableSettingsKey } from '@/features/settings/table-settings';

vi.mock('../game-content/EndSessionButton', () => ({
  EndSessionButton: () => <button>End session</button>,
}));

vi.mock('@/contexts/SceneBackgroundContext', () => ({
  useSceneBackground: () => ({ currentBackgroundUrl: null, isTransitioning: false }),
}));

vi.mock('../game-content/GameLeftPanel', () => ({
  GameLeftPanel: ({ chapterLabel }: { chapterLabel?: string }) => (
    <div data-testid="left-panel-chapter">{chapterLabel}</div>
  ),
}));

vi.mock('../game-content/GameMainContent', () => ({
  GameMainContent: () => <div data-testid="main-content" />,
}));

vi.mock('../game-content/GameRightPanel', () => ({
  GameRightPanel: () => <div data-testid="right-panel" />,
}));

vi.mock('../game-content/TableContextCard', () => ({
  TableContextCard: () => <div data-testid="table-context-card" />,
}));

vi.mock('../../tactical/TacticalMapProvider', () => ({
  TacticalMapProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../game-content/GameCombatSheet', () => ({
  GameCombatSheet: () => null,
}));

const layoutProps = {
  sessionId: 'session-1',
  campaignIdForHandler: 'campaign-1',
  characterIdForHandler: 'character-1',
  sessionData: { id: 'session-1', turn_count: 15 } as never,
  updateGameSessionState: vi.fn(),
  isLeftCollapsed: false,
  isRightCollapsed: false,
  setIsLeftCollapsed: vi.fn(),
  setIsRightCollapsed: vi.fn(),
  showSceneBlurb: true,
  onSceneBlurbToggle: vi.fn(),
  combatMode: false,
  showTracker: false,
  setShowTracker: vi.fn(),
  isCombatDetected: false,
  isGeneratingGreeting: false,
  innerHandleAIResponse: vi.fn(),
  isDM: false,
  spellCastHandlerRef: { current: null } as SpellCastHandlerRef,
  contentWarnings: [],
  comfortLevel: 'pg13' as const,
  showSafetyInfo: false,
};

describe('GameLayout: Table look only (#1486)', () => {
  afterEach(() => {
    window.localStorage.clear();
    document.body.classList.remove('ir-table-look');
  });

  it('renders the Table layout for a player whose saved Table look is off', () => {
    window.localStorage.setItem(
      tableSettingsKey('user-1'),
      JSON.stringify({ tableLook: false, narrationSpeed: 1 }),
    );
    // Neither the saved value nor a missing body class picks the layout.
    expect(document.body.classList.contains('ir-table-look')).toBe(false);

    render(<GameLayout {...layoutProps} />);

    expect(screen.getByTestId('table-header-slot')).toBeInTheDocument();
    expect(screen.getByTestId('table-controls-slot')).toBeInTheDocument();
  });

  it('keeps the build line at 10 px but gives its copy button a 44x44 hit box', () => {
    render(<GameLayout {...layoutProps} />);

    const line = screen.getByTestId('table-build-line');
    expect(line.className).toContain('text-[10px]');
    expect(line.className).toContain('[&>button]:before:h-11');
    expect(line.className).toContain('[&>button]:before:w-11');
    expect(line.className).toContain('[&>button]:pointer-events-auto');
  });
});
