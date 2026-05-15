/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { GameSidePanel } from '../MemoryPanel';

// Mock contexts
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

// Mock usePanelResize hook
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

// Mock child components to focus on MemoryPanel logic
vi.mock('../CombatSummary', () => ({
  CombatSummary: () => <div data-testid="combat-summary">Combat Summary</div>,
}));
vi.mock('../CompactCharacterHeader', () => ({
  CompactCharacterHeader: () => <div data-testid="character-header">Character Header</div>,
}));
vi.mock('../memory/MemoryCard', () => ({
  MemoryCard: ({ memory }: any) => <div data-testid={`memory-card-${memory.id}`}>{memory.content}</div>,
}));
vi.mock('../memory/MemoryFilter', () => ({
  MemoryFilter: ({ onTypeSelect }: any) => (
    <div data-testid="memory-filter">
      <button onClick={() => onTypeSelect('npc')}>Filter NPC</button>
      <button onClick={() => onTypeSelect(null)}>Clear Filter</button>
    </div>
  ),
}));

// Mock analytics
vi.mock('@/services/analytics', () => ({
  analytics: {
    detectArtStyle: vi.fn(() => 'fantasy'),
    campaignTabViewed: vi.fn(),
  },
}));

import { useCombat } from '@/contexts/CombatContext';
import { useMemoryContext } from '@/contexts/MemoryContext';
import { usePanelResize } from '@/features/game-session/hooks/use-panel-resize';
import { analytics } from '@/services/analytics';

describe('GameSidePanel', () => {
  const mockUpdateGameSessionState = vi.fn();
  const mockOnToggle = vi.fn();
  const mockSessionData = {
    id: 'session-1',
    session_notes: 'Initial notes',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderPanel = (props = {}): any => {
    return render(
      <MemoryRouter initialEntries={['/app/game/campaign-1']}>
        <Routes>
          <Route
            path="/app/game/:id"
            element={
              <GameSidePanel
                sessionData={mockSessionData as any}
                updateGameSessionState={mockUpdateGameSessionState}
                combatMode={false}
                isCollapsed={false}
                onToggle={mockOnToggle}
                {...props}
              />
            }
          />
        </Routes>
      </MemoryRouter>
    );
  };

  it('renders character tab by default', () => {
    renderPanel();
    expect(screen.getByTestId('character-header')).toBeInTheDocument();
    expect(screen.getByText('🎭 Character')).toBeInTheDocument();
  });

  it('switches to memory tab and displays notes', async () => {
    const setActiveTab = vi.fn();
    const setIsExpanded = vi.fn();
    (usePanelResize as any).mockReturnValue({
      isExpanded: true,
      setIsExpanded,
      activeTab: 'character',
      setActiveTab,
      panelWidth: '340px',
      panelRef: { current: null },
      dragHandleRef: { current: null },
      isDraggingRef: { current: false },
    });

    renderPanel();

    const memoryTabButton = screen.getByLabelText(/Memories/i);
    fireEvent.click(memoryTabButton);

    expect(setActiveTab).toHaveBeenCalledWith('memory');
    expect(setIsExpanded).toHaveBeenCalledWith(true);
    expect(analytics.campaignTabViewed).toHaveBeenCalledWith('memory', expect.anything());
  });

  it('calls updateGameSessionState when saving notes', async () => {
    (usePanelResize as any).mockReturnValue({
      isExpanded: true,
      setIsExpanded: vi.fn(),
      activeTab: 'memory',
      setActiveTab: vi.fn(),
      panelWidth: '340px',
      panelRef: { current: null },
      dragHandleRef: { current: null },
      isDraggingRef: { current: false },
    });

    renderPanel();

    const textarea = screen.getByPlaceholderText(/Type your session notes here.../i);
    fireEvent.change(textarea, { target: { value: 'Updated notes' } });

    const saveButton = screen.getByText(/Save Notes/i);
    fireEvent.click(saveButton);

    expect(mockUpdateGameSessionState).toHaveBeenCalledWith({ session_notes: 'Updated notes' });
  });

  it('renders combat tab when in combat mode', () => {
    (useCombat as any).mockReturnValue({ state: { isInCombat: true } });
    const setActiveTab = vi.fn();
    (usePanelResize as any).mockReturnValue({
      isExpanded: true,
      setIsExpanded: vi.fn(),
      activeTab: 'character',
      setActiveTab,
      panelWidth: '340px',
      panelRef: { current: null },
      dragHandleRef: { current: null },
      isDraggingRef: { current: false },
    });

    renderPanel({ combatMode: true });

    const combatTabButton = screen.getByLabelText(/Combat/i);
    fireEvent.click(combatTabButton);

    expect(setActiveTab).toHaveBeenCalledWith('combat');
  });

  it('shows loading state for memories', () => {
    (useMemoryContext as any).mockReturnValue({ memories: [], isLoading: true });
    (usePanelResize as any).mockReturnValue({
      isExpanded: true,
      setIsExpanded: vi.fn(),
      activeTab: 'memory',
      setActiveTab: vi.fn(),
      panelWidth: '340px',
      panelRef: { current: null },
      dragHandleRef: { current: null },
      isDraggingRef: { current: false },
    });

    renderPanel();

    expect(screen.getByText(/Loading memories.../i)).toBeInTheDocument();
  });

  it('displays memories list and empty state', () => {
    // Setup initial mock
    (useMemoryContext as any).mockReturnValue({ memories: [], isLoading: false });
    (usePanelResize as any).mockReturnValue({
      isExpanded: true,
      setIsExpanded: vi.fn(),
      activeTab: 'memory',
      setActiveTab: vi.fn(),
      panelWidth: '340px',
      panelRef: { current: null },
      dragHandleRef: { current: null },
      isDraggingRef: { current: false },
    });

    const { rerender } = renderPanel();
    expect(screen.getByText(/No memories logged yet./i)).toBeInTheDocument();

    // Test with memories
    const mockMemories = [
      { id: '1', type: 'npc', content: 'Met a mysterious stranger', importance: 1, created_at: new Date().toISOString() },
    ];
    (useMemoryContext as any).mockReturnValue({ memories: mockMemories, isLoading: false });

    rerender(
      <MemoryRouter initialEntries={['/app/game/campaign-1']}>
        <Routes>
          <Route
            path="/app/game/:id"
            element={
              <GameSidePanel
                sessionData={mockSessionData as any}
                updateGameSessionState={mockUpdateGameSessionState}
                combatMode={false}
                isCollapsed={false}
                onToggle={mockOnToggle}
              />
            }
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId('memory-card-1')).toBeInTheDocument();
  });

  it('toggles expansion when clicking minimize/expand button', () => {
    const setIsExpanded = vi.fn();
    (usePanelResize as any).mockReturnValue({
      isExpanded: true,
      setIsExpanded,
      activeTab: 'character',
      setActiveTab: vi.fn(),
      panelWidth: '340px',
      panelRef: { current: null },
      dragHandleRef: { current: null },
      isDraggingRef: { current: false },
    });

    renderPanel();

    const toggleButton = screen.getByLabelText(/Minimize/i);
    fireEvent.click(toggleButton);

    expect(setIsExpanded).toHaveBeenCalledWith(false);
  });

  it('calls onToggle when clicking close button', () => {
    renderPanel();

    const closeButton = screen.getByLabelText(/Close Panel/i);
    fireEvent.click(closeButton);

    expect(mockOnToggle).toHaveBeenCalled();
  });

  it('renders mobile trigger when collapsed and mobile', () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 500 });

    renderPanel({ isCollapsed: true });

    expect(screen.getByLabelText(/Open game panel/i)).toBeInTheDocument();

    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: originalInnerWidth });
  });

  it('handles save notes when sessionData is null', async () => {
    (usePanelResize as any).mockReturnValue({
      isExpanded: true,
      setIsExpanded: vi.fn(),
      activeTab: 'memory',
      setActiveTab: vi.fn(),
      panelWidth: '340px',
      panelRef: { current: null },
      dragHandleRef: { current: null },
      isDraggingRef: { current: false },
    });

    render(
      <MemoryRouter initialEntries={['/app/game/campaign-1']}>
        <Routes>
          <Route
            path="/app/game/:id"
            element={
              <GameSidePanel
                sessionData={null}
                updateGameSessionState={mockUpdateGameSessionState}
                combatMode={false}
                isCollapsed={false}
                onToggle={mockOnToggle}
              />
            }
          />
        </Routes>
      </MemoryRouter>
    );

    const saveButton = screen.getByText(/Save Notes/i);
    fireEvent.click(saveButton);

    expect(mockUpdateGameSessionState).not.toHaveBeenCalled();
  });

  it('shows combat indicators when collapsed', () => {
    (useCombat as any).mockReturnValue({ state: { isInCombat: true } });
    (useMemoryContext as any).mockReturnValue({ memories: [{ id: '1' }], isLoading: false });

    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 500 });

    renderPanel({ isCollapsed: true, combatMode: true });

    const trigger = screen.getByLabelText(/Open game panel/i);
    expect(trigger).toHaveClass('animate-pulse');
    expect(trigger).toHaveClass('border-red-400/50');

    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: originalInnerWidth });
  });

  it('opens mobile drawer and renders content', async () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 500 });

    // For mobile, the Content component is called with its own props
    // We need to mock usePanelResize specifically for the content
    (usePanelResize as any).mockReturnValue({
      isExpanded: true,
      setIsExpanded: vi.fn(),
      activeTab: 'memory',
      setActiveTab: vi.fn(),
      panelWidth: '340px',
      panelRef: { current: null },
      dragHandleRef: { current: null },
      isDraggingRef: { current: false },
    });

    renderPanel({ isCollapsed: true });

    const trigger = screen.getByLabelText(/Open game panel/i);
    fireEvent.click(trigger);

    // Character tab is default in Content too
    expect(await screen.findByText('Character')).toBeInTheDocument();

    // Switch to memories
    const memoriesTab = screen.getByRole('tab', { name: /Memories/i });
    fireEvent.click(memoriesTab);

    // Wait for the memory tab content to be visible
    await waitFor(() => {
        expect(screen.getByPlaceholderText(/Session notes.../i)).toBeInTheDocument();
    });

    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: originalInnerWidth });
  });

  it('renders desktop collapsed trigger', () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1200 });

    renderPanel({ isCollapsed: true });

    expect(screen.getByLabelText(/Open game panel/i)).toBeInTheDocument();

    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: originalInnerWidth });
  });
});
