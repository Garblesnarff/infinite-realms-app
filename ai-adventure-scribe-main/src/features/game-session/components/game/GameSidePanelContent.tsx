import { ChevronLeft } from 'lucide-react';
import React, { useId } from 'react';

import { CombatSummary } from './CombatSummary';
import { CompactCharacterHeader } from './CompactCharacterHeader';

import type { ExtendedGameSession } from '@/hooks/use-game-session';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
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
  sortedMemories: any[];
  characterState: any;
  isInCombat: boolean;
  panelWidth: string;
  panelRef: React.RefObject<HTMLDivElement>;
  dragHandleRef: React.RefObject<HTMLDivElement>;
  isDraggingRef: React.RefObject<boolean>;
  startDrag: (e: React.MouseEvent) => void;
  handleDrag: (e: MouseEvent) => void;
  stopDrag: () => void;
  isMobileDrawerOpen: boolean;
}

/**
 * GameSidePanelContent Component
 * Extracted from MemoryPanel.tsx
 * Content component for the game side panel, used primarily in mobile drawer
 */
export const GameSidePanelContent: React.FC<GameSidePanelContentProps> = React.memo(({
  sessionData,
  updateGameSessionState,
  combatMode,
  isExpanded,
  setIsExpanded,
  activeTab,
  setActiveTab,
  selectedType,
  setSelectedType,
  localSessionNotes,
  setLocalSessionNotes,
  memoriesLoading,
  sortedMemories,
  characterState,
  isInCombat,
  panelWidth,
  panelRef,
  dragHandleRef,
  isDraggingRef,
  startDrag,
  handleDrag,
  stopDrag,
  isMobileDrawerOpen,
}) => {
  const sessionNotesId = useId();

  // Mobile content uses the passed-in state and handlers
  const handleSaveNotes = () => {
    if (sessionData) {
      updateGameSessionState({ session_notes: localSessionNotes });
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Mobile Header */}
      <div className="p-4 border-b border-border flex items-center justify-between">
        <h3 className="font-semibold text-foreground">Game Panel</h3>
        <Button variant="ghost" size="sm" aria-label="Back" title="Back">
          <ChevronLeft className="h-4 w-4" />
        </Button>
      </div>

      {/* Tab Content - Simplified for mobile */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'character' && <CompactCharacterHeader />}
        {activeTab === 'memory' && (
          <div className="flex flex-col h-full">
            <div className="p-4 border-b">
              <Label htmlFor={sessionNotesId} className="text-sm font-semibold mb-2 block">
                📝 Session Notes
              </Label>
              <Textarea
                id={sessionNotesId}
                value={localSessionNotes}
                onChange={(e) => setLocalSessionNotes(e.target.value)}
                placeholder="Session notes..."
                rows={3}
                className="mb-2"
              />
              <Button onClick={handleSaveNotes} size="sm" className="w-full">
                Save
              </Button>
            </div>
            <ScrollArea className="flex-1 p-4">
              {/* Memories list */}
              <div>No memories for mobile view</div>
            </ScrollArea>
          </div>
        )}
        {isInCombat && activeTab === 'combat' && <CombatSummary />}
      </div>
    </div>
  );
});

GameSidePanelContent.displayName = 'GameSidePanelContent';
