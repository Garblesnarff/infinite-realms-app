/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { GameSidePanel } from '../MemoryPanel';

vi.mock('@/contexts/MemoryContext', () => ({
  useMemoryContext: vi.fn(() => ({ memories: [], isLoading: false })),
}));
vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: vi.fn(() => ({ state: { character: { theme: 'fantasy' } } })),
}));
vi.mock('@/contexts/CombatContext', () => ({
  useCombat: vi.fn(() => ({ state: { isInCombat: false } })),
}));
vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: vi.fn(() => ({ state: { campaign: { genre: 'high-fantasy' } } })),
}));
vi.mock('@/features/game-session/hooks/use-panel-resize', () => ({
  usePanelResize: vi.fn(() => ({
    isExpanded: true,
    setIsExpanded: vi.fn(),
    activeTab: 'character',
    setActiveTab: vi.fn(),
    panelWidth: '340px',
    panelRef: { current: null },
    dragHandleRef: { current: null },
    isDraggingRef: { current: false },
    startDrag: vi.fn(),
    handleDrag: vi.fn(),
    stopDrag: vi.fn(),
  })),
}));
vi.mock('@/hooks/use-campaign-journal', () => ({
  useCampaignJournal: vi.fn(() => ({ data: { entries: [] }, isLoading: false })),
}));
vi.mock('../CombatSummary', () => ({
  CombatSummary: () => <div>Combat Summary</div>,
}));
vi.mock('../overhaul/RightSheetLive', () => ({
  RightSheetLive: () => <div>Character Sheet body</div>,
}));
vi.mock('@/services/analytics', () => ({
  analytics: {
    detectArtStyle: vi.fn(() => 'fantasy'),
    campaignTabViewed: vi.fn(),
  },
}));

import { useCombat } from '@/contexts/CombatContext';
import { useMemoryContext } from '@/contexts/MemoryContext';

const EMOJI_OR_SYMBOL = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;

const renderPanel = (props: Record<string, unknown> = {}): ReturnType<typeof render> =>
  render(
    <MemoryRouter initialEntries={['/app/game/campaign-1']}>
      <Routes>
        <Route
          path="/app/game/:id"
          element={
            <GameSidePanel
              sessionData={{ id: 'session-1', session_notes: '' } as any}
              updateGameSessionState={vi.fn()}
              combatMode={false}
              isCollapsed={false}
              onToggle={vi.fn()}
              {...props}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );

const setWidth = (width: number): void => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
};

describe('game side panel shell (#1236 section A)', () => {
  const originalWidth = window.innerWidth;

  beforeEach(() => {
    vi.clearAllMocks();
    (useCombat as any).mockReturnValue({ state: { isInCombat: false } });
    (useMemoryContext as any).mockReturnValue({ memories: [], isLoading: false });
  });

  afterEach(() => {
    setWidth(originalWidth);
  });

  describe('desktop', () => {
    it('shows text tabs Sheet, Memory and Journal, and no Combat tab outside combat', () => {
      setWidth(1280);
      renderPanel();

      expect(screen.getByRole('button', { name: 'Sheet' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Memory' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Journal' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Combat' })).not.toBeInTheDocument();
    });

    it('adds Combat only while in combat', () => {
      setWidth(1280);
      (useCombat as any).mockReturnValue({ state: { isInCombat: true } });
      renderPanel({ combatMode: true });

      expect(screen.getByRole('button', { name: 'Combat' })).toBeInTheDocument();
    });

    it('renders no emoji or symbol headings in the panel header', () => {
      setWidth(1280);
      (useCombat as any).mockReturnValue({ state: { isInCombat: true } });
      const { container } = renderPanel({ combatMode: true });

      expect(container.textContent).not.toMatch(EMOJI_OR_SYMBOL);
    });

    it('gives each tab a 44px tap area through the existing hit-slop class', () => {
      setWidth(1280);
      renderPanel();

      for (const name of ['Sheet', 'Memory', 'Journal']) {
        const button = screen.getByRole('button', { name });
        expect(button).toHaveClass('ir-hit-slop');
        expect(button).toHaveClass('h-8');
      }
    });
  });

  describe('mobile', () => {
    const openMobilePanel = (combat = false): void => {
      setWidth(500);
      if (combat) (useCombat as any).mockReturnValue({ state: { isInCombat: true } });
      renderPanel({ isCollapsed: true, combatMode: combat });
      fireEvent.click(screen.getByRole('button', { name: 'Open game panel' }));
    };

    it('uses the same labels as desktop in the tab list', () => {
      openMobilePanel();
      const tablist = screen.getByRole('tablist');
      const names = within(tablist)
        .getAllByRole('tab')
        .map((tab) => tab.textContent);

      expect(names).toEqual(['Sheet', 'Memory', 'Journal']);
    });

    it('shows Combat in the tab list only while in combat', () => {
      openMobilePanel(true);
      const names = within(screen.getByRole('tablist'))
        .getAllByRole('tab')
        .map((tab) => tab.textContent);

      expect(names).toEqual(['Sheet', 'Memory', 'Combat', 'Journal']);
    });

    it('opens as a bottom sheet at 85% height with a drag handle', () => {
      openMobilePanel();

      expect(screen.getByTestId('game-panel-drag-handle')).toBeInTheDocument();
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveClass('bottom-0');
      expect(dialog).toHaveClass('h-[85vh]');
    });

    it('gives tabs and the close control a 44px box', () => {
      openMobilePanel();

      for (const tab of within(screen.getByRole('tablist')).getAllByRole('tab')) {
        expect(tab).toHaveClass('min-h-11');
      }
      expect(screen.getByRole('button', { name: 'Close panel' })).toHaveClass('h-11', 'w-11');
    });

    it('renders no emoji in the tab list', () => {
      openMobilePanel(true);
      expect(screen.getByRole('tablist').textContent).not.toMatch(EMOJI_OR_SYMBOL);
    });
  });
});
