import React, { useId, useCallback } from 'react';

import { CombatSummary } from './CombatSummary';
import { JournalTabContent } from './JournalTabContent';
import { MemoryList } from './memory/MemoryList';
import { RightSheetLive } from './overhaul/RightSheetLive';

import type { SpellCastHandlerRef } from './spell-cast-handler';
import type { CharacterState } from '@/contexts/character/types';
import type { ExtendedGameSession } from '@/hooks/use-game-session';
import type { JournalHandoutEntry } from '@/services/user-data-api';
import type { Memory } from '@/types/memory';

import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export interface GameSidePanelContentProps {
  sessionId?: string;
  sessionData: ExtendedGameSession | null;
  updateGameSessionState: (newState: Partial<ExtendedGameSession>) => Promise<void>;
  combatMode: boolean;
  isExpanded: boolean;
  setIsExpanded: (expanded: boolean) => void;
  activeTab: 'character' | 'memory' | 'combat' | 'journal';
  setActiveTab: (tab: 'character' | 'memory' | 'combat' | 'journal') => void;
  selectedType: string | null;
  setSelectedType: (type: string | null) => void;
  localSessionNotes: string;
  setLocalSessionNotes: (notes: string) => void;
  memoriesLoading: boolean;
  allMemories: Memory[];
  campaignId?: string | null;
  sortedMemories: Memory[];
  characterState: CharacterState;
  isInCombat: boolean;
  panelWidth: string;
  panelRef: React.RefObject<HTMLDivElement>;
  dragHandleRef: React.RefObject<HTMLDivElement>;
  isDraggingRef: React.MutableRefObject<boolean>;
  startDrag: (e: React.MouseEvent) => void;
  handleDrag: (e: MouseEvent) => void;
  stopDrag: () => void;
  isMobileDrawerOpen: boolean;
  journalEntries?: JournalHandoutEntry[];
  journalLoading?: boolean;
  spellCastHandlerRef?: SpellCastHandlerRef;
}

/**
 * GameSidePanelContent Component
 * Extracted from MemoryPanel.tsx
 * Content component for the game side panel, used primarily in mobile drawer
 * Provides full parity with the desktop panel functionality
 */
export const GameSidePanelContent: React.FC<GameSidePanelContentProps> = React.memo(
  ({
    sessionId,
    sessionData,
    updateGameSessionState,
    activeTab,
    setActiveTab,
    selectedType,
    setSelectedType,
    localSessionNotes,
    setLocalSessionNotes,
    memoriesLoading,
    allMemories,
    campaignId,
    sortedMemories,
    isInCombat,
    journalEntries = [],
    journalLoading = false,
    spellCastHandlerRef,
  }) => {
    const sessionNotesId = useId();

    const handleSaveNotes = useCallback((): void => {
      if (sessionData) {
        updateGameSessionState({ session_notes: localSessionNotes });
      }
    }, [sessionData, updateGameSessionState, localSessionNotes]);

    return (
      <div className="flex min-h-0 flex-1 flex-col bg-background">
        {/* Mobile Header with Tabs */}
        <div className="p-4 border-b border-border">
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as 'character' | 'memory' | 'combat' | 'journal')}
            className="w-full"
          >
            <TabsList className={`grid w-full h-11 ${isInCombat ? 'grid-cols-4' : 'grid-cols-3'}`}>
              <TabsTrigger value="character" className="text-xs min-h-11">
                Sheet
              </TabsTrigger>
              <TabsTrigger value="memory" className="text-xs min-h-11">
                Memory
              </TabsTrigger>
              {isInCombat && (
                <TabsTrigger value="combat" className="text-xs min-h-11">
                  Combat
                </TabsTrigger>
              )}
              <TabsTrigger value="journal" className="text-xs min-h-11">
                Journal
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-hidden">
          {activeTab === 'character' && (
            <ScrollArea className="h-full">
              <div className="p-4">
                <RightSheetLive
                  sessionId={sessionId}
                  isInCombat={isInCombat}
                  spellCastHandlerRef={spellCastHandlerRef}
                />
              </div>
            </ScrollArea>
          )}

          {activeTab === 'memory' && (
            <div className="flex flex-col h-full">
              {/* Memory list: same header, chips and cards as desktop */}
              <ScrollArea className="flex-1">
                <div className="p-4">
                  <MemoryList
                    allMemories={allMemories}
                    campaignId={campaignId}
                    sortedMemories={sortedMemories}
                    selectedType={selectedType}
                    setSelectedType={setSelectedType}
                    memoriesLoading={memoriesLoading}
                  />
                </div>
              </ScrollArea>
            </div>
          )}

          {isInCombat && activeTab === 'combat' && (
            <ScrollArea className="h-full">
              <div className="p-4">
                <CombatSummary />
              </div>
            </ScrollArea>
          )}

          {activeTab === 'journal' && (
            <ScrollArea className="h-full">
              <JournalTabContent
                sessionId={sessionId}
                sessionNotesId={sessionNotesId}
                localSessionNotes={localSessionNotes}
                setLocalSessionNotes={setLocalSessionNotes}
                handleSaveNotes={handleSaveNotes}
                notesPlaceholder="Session notes..."
                journalEntries={journalEntries}
                journalLoading={journalLoading}
              />
            </ScrollArea>
          )}
        </div>
      </div>
    );
  },
);

GameSidePanelContent.displayName = 'GameSidePanelContent';
