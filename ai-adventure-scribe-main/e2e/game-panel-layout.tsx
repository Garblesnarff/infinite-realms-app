import React from 'react';
import { createRoot } from 'react-dom/client';

import { Sheet, SheetContent } from '../src/components/ui/sheet';
import { DesktopGameSidePanel } from '../src/features/game-session/components/game/DesktopGameSidePanel';
import { GameSidePanelContent } from '../src/features/game-session/components/game/GameSidePanelContent';
import '../src/index.css';

const noop = (): void => {};
const asyncNoop = async (): Promise<void> => {};
const ref = <T,>(): React.RefObject<T> => ({ current: null });

const panelProps = {
  sessionData: null,
  updateGameSessionState: asyncNoop,
  combatMode: false,
  sessionNotesId: 'layout-session-notes',
  localSessionNotes: '',
  setLocalSessionNotes: noop,
  handleSaveNotes: noop,
  selectedType: null,
  setSelectedType: noop,
  memoriesLoading: false,
  allMemories: [],
  sortedMemories: [],
  journalLoading: false,
  journalEntries: [],
  campaignId: null,
  characterState: {
    character: null,
    isDirty: false,
    currentStep: 0,
    isLoading: false,
    error: null,
  },
  panelRef: ref<HTMLDivElement>(),
  dragHandleRef: ref<HTMLDivElement>(),
  isDraggingRef: { current: false },
  startDrag: noop,
  handleDrag: noop,
  stopDrag: noop,
  isExpanded: true,
  setIsExpanded: noop,
  onToggle: noop,
  activeTab: 'memory' as const,
  handleTabChange: noop,
};

function App(): React.JSX.Element {
  const params = new URLSearchParams(window.location.search);
  const mobile = params.get('mobile') === 'true';
  const combat = params.get('combat') === 'true';
  const tabs = { ...panelProps, isInCombat: combat, combatMode: combat };

  if (mobile) {
    return (
      <Sheet open>
        <SheetContent
          side="bottom"
          className="flex h-[85vh] flex-col rounded-t-2xl p-0"
          data-testid="mobile-panel"
        >
          <GameSidePanelContent {...tabs} setActiveTab={noop} isMobileDrawerOpen />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <div data-testid="desktop-panel" style={{ width: '280px', height: '800px' }}>
      <DesktopGameSidePanel {...tabs} panelWidth="280px" />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
