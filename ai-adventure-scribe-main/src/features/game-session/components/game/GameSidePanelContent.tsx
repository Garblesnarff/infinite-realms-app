import React, { useId, useCallback } from 'react';

import { CombatSummary } from './CombatSummary';
import { CompactCharacterHeader } from './CompactCharacterHeader';
import { MemoryCard } from './memory/MemoryCard';
import { MemoryFilter } from './memory/MemoryFilter';

import type { ExtendedGameSession } from '@/hooks/use-game-session';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

export interface GameSidePanelContentProps {
  sessionData: ExtendedGameSession | null;
  updateGameSessionState: (newState: Partial<ExtendedGameSession>) => Promise<void>;
  combatMode: boolean;
  isExpanded: boolean;
  setIsExpanded: (expanded: boolean) => void;
  activeTab: 'character' | 'memory' | 'combat';
  setActiveTab: (tab: 'character' | 'memory' | 'combat') => void;
  selectedType: string | null;
  setSelectedType: (type: string | null) => void;
  localSessionNotes: string;
  setLocalSessionNotes: (notes: string) => void;
  memoriesLoading: boolean;
  sortedMemories: Record<string, unknown>[];
  characterState: Record<string, unknown>;
  isInCombat: boolean;
  panelWidth: string;
  panelRef: React.RefObject<HTMLDivElement>;
  dragHandleRef: React.RefObject<HTMLDivElement>;
  isDraggingRef: React.MutableRefObject<boolean>;
  startDrag: (e: React.MouseEvent) => void;
  handleDrag: (e: MouseEvent) => void;
  stopDrag: () => void;
  isMobileDrawerOpen: boolean;
}

/**
 * GameSidePanelContent Component
 * Extracted from MemoryPanel.tsx
 * Content component for the game side panel, used primarily in mobile drawer
 * Provides full parity with the desktop panel functionality
 */
export const GameSidePanelContent: React.FC<GameSidePanelContentProps> = React.memo(
  ({
    sessionData,
    updateGameSessionState,
    activeTab,
    setActiveTab,
    selectedType,
    setSelectedType,
    localSessionNotes,
    setLocalSessionNotes,
    memoriesLoading,
    sortedMemories,
    isInCombat,
  }) => {
    const sessionNotesId = useId();

    const handleSaveNotes = useCallback((): void => {
      if (sessionData) {
        updateGameSessionState({ session_notes: localSessionNotes });
      }
    }, [sessionData, updateGameSessionState, localSessionNotes]);

    return (
      <div className="flex flex-col h-full bg-background">
        {/* Mobile Header with Tabs */}
        <div className="p-4 border-b border-border">
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as 'character' | 'memory' | 'combat')}
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-3 h-10">
              <TabsTrigger value="character" className="text-xs">
                Character
              </TabsTrigger>
              <TabsTrigger value="memory" className="text-xs">
                Memories
              </TabsTrigger>
              <TabsTrigger value="combat" disabled={!isInCombat} className="text-xs">
                Combat
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-hidden">
          {activeTab === 'character' && (
            <ScrollArea className="h-full">
              <div className="p-4">
                <CompactCharacterHeader />
              </div>
            </ScrollArea>
          )}

          {activeTab === 'memory' && (
            <div className="flex flex-col h-full">
              {/* Session Notes */}
              <div className="p-4 border-b bg-muted/30">
                <Label
                  htmlFor={sessionNotesId}
                  className="font-display font-semibold mb-2 text-foreground text-sm block"
                >
                  📝 Session Notes
                </Label>
                <Textarea
                  id={sessionNotesId}
                  value={localSessionNotes}
                  onChange={(e) => setLocalSessionNotes(e.target.value)}
                  placeholder="Session notes..."
                  rows={3}
                  className="mb-3 text-sm bg-background"
                />
                <Button onClick={handleSaveNotes} size="sm" className="w-full">
                  Save Notes
                </Button>
              </div>

              {/* Memory Filtering */}
              <div className="p-4 border-b flex-shrink-0">
                <MemoryFilter selectedType={selectedType} onTypeSelect={setSelectedType} />
              </div>

              {/* Memories List */}
              <ScrollArea className="flex-1">
                <div className="p-4 space-y-2">
                  {memoriesLoading && (
                    <p className="text-xs text-muted-foreground">Loading memories...</p>
                  )}
                  {!memoriesLoading && sortedMemories.length === 0 && (
                    <p className="text-xs text-muted-foreground">No memories logged yet.</p>
                  )}
                  {sortedMemories.map((memory) => (
                    <MemoryCard key={memory.id} memory={memory} />
                  ))}
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
        </div>
      </div>
    );
  },
);

GameSidePanelContent.displayName = 'GameSidePanelContent';
