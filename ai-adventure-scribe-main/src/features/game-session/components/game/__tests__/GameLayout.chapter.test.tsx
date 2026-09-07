import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { GameLayout } from '../game-content/GameLayout';

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

vi.mock('../FloatingActionPanel', () => ({
  FloatingActionPanel: () => null,
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
  contentWarnings: [],
  comfortLevel: 'pg13' as const,
  showSafetyInfo: false,
};

describe('GameLayout campaign chapter', () => {
  it('passes a frozen chapter label instead of interpolating turn_count', () => {
    render(<GameLayout {...layoutProps} />);

    expect(screen.getByTestId('left-panel-chapter')).toHaveTextContent('Chapter 1');
    expect(screen.getByTestId('left-panel-chapter')).not.toHaveTextContent('Chapter 15');
  });
});
