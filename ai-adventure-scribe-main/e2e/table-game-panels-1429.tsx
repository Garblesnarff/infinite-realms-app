import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';

import { Sheet, SheetContent } from '../src/components/ui/sheet';
import { AuthProvider } from '../src/contexts/AuthContext';
import { CampaignProvider, useCampaign } from '../src/contexts/CampaignContext';
import { DesktopGameSidePanel } from '../src/features/game-session/components/game/DesktopGameSidePanel';
import { GameSidePanelContent } from '../src/features/game-session/components/game/GameSidePanelContent';
import { PlayerSettings } from '../src/features/settings/PlayerSettings';
import '../src/index.css';
import '../src/styles/ir-table.css';

import type { JournalHandoutEntry } from '../src/services/user-data-api';
import type { Memory } from '../src/types/memory';

const noop = (): void => {};
const asyncNoop = async (): Promise<void> => {};
const ref = <T,>(): React.RefObject<T> => ({ current: null });

const daysAgo = (days: number): string =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

const sampleMemories: Memory[] = [
  {
    id: 'm-loc',
    type: 'location',
    content: 'The ledge below the piton is slick with moss.',
    importance: 9,
    metadata: { name: 'The Ledge' },
    created_at: daysAgo(3),
    updated_at: daysAgo(3),
    session_id: 's-2',
  },
  {
    id: 'm-npc',
    type: 'npc',
    content: 'The innkeeper owes the party a favour.',
    importance: 9,
    metadata: { name: 'Bram' },
    created_at: daysAgo(3),
    updated_at: daysAgo(3),
    session_id: 's-2',
  },
  {
    id: 'm-npc-2',
    type: 'npc',
    content: 'Mara the guard watches the north gate at night.',
    importance: 5,
    metadata: null,
    created_at: daysAgo(1),
    updated_at: daysAgo(1),
    session_id: 's-3',
  },
  {
    id: 'm-event',
    type: 'event',
    content: 'The ropes were cut from below.',
    importance: 8,
    metadata: null,
    created_at: daysAgo(2),
    updated_at: daysAgo(2),
    session_id: 's-2',
  },
  {
    id: 'm-item',
    type: 'item',
    content: 'A brass key, warm to the touch.',
    importance: 2,
    metadata: null,
    created_at: daysAgo(1),
    updated_at: daysAgo(1),
    session_id: 's-3',
  },
];

const sampleJournal: JournalHandoutEntry[] = [
  {
    id: 'h-1',
    sessionId: 's-2',
    sessionNumber: 2,
    recipient: 'the party',
    mode: 'improvised',
    key: null,
    title: 'Torn page',
    body: 'Day 9. The ropes were cut from below.',
    giver: 'the DM',
    assetPath: null,
    createdAt: daysAgo(2),
  },
  {
    id: 'h-2',
    sessionId: 's-3',
    sessionNumber: null,
    recipient: 'the party',
    mode: 'improvised',
    key: null,
    title: 'Abbey note',
    body: 'Return the ledger before the thaw.',
    giver: 'the DM',
    assetPath: null,
    createdAt: daysAgo(1),
  },
];

/** Seeds the harness campaign so the Journal objective renders. */
const CampaignSeeder: React.FC = () => {
  const { dispatch } = useCampaign();
  useEffect(() => {
    dispatch({
      type: 'UPDATE_CAMPAIGN',
      payload: {
        id: 'camp-1',
        name: 'Harness Campaign',
        description: 'Find the lost ledger and return it to the Abbey.',
        difficulty_level: 'Hard',
        rules_config: {},
      },
    });
  }, [dispatch]);
  return null;
};

const panelProps = {
  sessionId: 'session-1',
  sessionData: null,
  updateGameSessionState: asyncNoop,
  combatMode: false,
  sessionNotesId: 'layout-session-notes',
  localSessionNotes: 'Day 9. The ropes were cut.',
  setLocalSessionNotes: noop,
  handleSaveNotes: noop,
  selectedType: null,
  setSelectedType: noop,
  memoriesLoading: false,
  allMemories: sampleMemories,
  sortedMemories: sampleMemories,
  journalLoading: false,
  journalEntries: sampleJournal,
  campaignId: 'camp-1',
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
  handleTabChange: noop,
};

function App(): React.JSX.Element {
  const params = new URLSearchParams(window.location.search);
  const mobile = params.get('mobile') === 'true';
  const tab = params.get('tab') === 'journal' ? 'journal' : 'memory';
  const plain = params.get('plain') === 'true';

  useEffect(() => {
    document.body.classList.toggle('ir-table-look', !plain);
  }, [plain]);

  const tabs = { ...panelProps, isInCombat: false, activeTab: tab };

  if (params.get('settings') === 'true') {
    // The gear sheet's body: PlayerSettings mounts on optional hooks only, so
    // no auth provider is needed. CampaignSeeder sets difficulty Hard, so the
    // target-numbers default reads off.
    return (
      <AuthProvider>
        <CampaignProvider>
          <CampaignSeeder />
          <div
            data-testid="settings-sheet"
            style={{
              width: mobile ? '390px' : '420px',
              minHeight: '800px',
              background: '#0c1220',
              padding: '20px 22px',
              boxSizing: 'border-box',
            }}
          >
            <PlayerSettings campaignId="camp-1" rulesConfig={{}} />
          </div>
        </CampaignProvider>
      </AuthProvider>
    );
  }

  if (mobile) {
    return (
      <CampaignProvider>
        <CampaignSeeder />
        <Sheet open>
          <SheetContent
            side="bottom"
            className="flex h-[85vh] flex-col rounded-t-2xl p-0"
            data-testid="mobile-panel"
          >
            <GameSidePanelContent {...tabs} setActiveTab={noop} isMobileDrawerOpen />
          </SheetContent>
        </Sheet>
      </CampaignProvider>
    );
  }

  return (
    <CampaignProvider>
      <CampaignSeeder />
      <div data-testid="desktop-panel" style={{ width: '400px', height: '900px' }}>
        <DesktopGameSidePanel {...tabs} panelWidth="400px" />
      </div>
    </CampaignProvider>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
