import {
  ChevronDown,
  Menu,
  ChevronLeft,
} from 'lucide-react';
import React, { useState, useEffect, useId, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';

import { DesktopGameSidePanel } from './DesktopGameSidePanel';
import { GameSidePanelContent } from './GameSidePanelContent';

import type { MemoryType } from './memory/types';
import type { ExtendedGameSession } from '@/hooks/use-game-session';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger, SheetClose } from '@/components/ui/sheet';
import { Z_INDEX } from '@/constants/z-index';
import { useCampaign } from '@/contexts/CampaignContext';
import { useCharacter } from '@/contexts/CharacterContext';
import { useCombat } from '@/contexts/CombatContext';
import { useMemoryContext } from '@/contexts/MemoryContext';
import { usePanelResize } from '@/features/game-session/hooks/use-panel-resize';
import { useMemoryFiltering } from '@/hooks/memory/useMemoryFiltering';
import { useCampaignJournal } from '@/hooks/use-campaign-journal';
import { analytics } from '@/services/analytics';

interface MemoryPanelProps {
  sessionData: ExtendedGameSession | null;
  updateGameSessionState: (newState: Partial<ExtendedGameSession>) => Promise<void>;
  combatMode: boolean;
}

interface GameSidePanelProps extends MemoryPanelProps {
  isCollapsed: boolean;
  onToggle: () => void;
}

/**
 * MemoryPanel Component
 * Main component for displaying and managing game memories and session notes
 * Provides filtering, sorting, and collapsible functionality
 */
export const GameSidePanel: React.FC<GameSidePanelProps> = React.memo(
  ({ sessionData, updateGameSessionState, combatMode, isCollapsed, onToggle }) => {
    // Get contexts
    const { memories = [], isLoading: memoriesLoading } = useMemoryContext();
    const { state: characterState } = useCharacter();
    const { state: combatState } = useCombat();
    const { state: campaignState } = useCampaign();
    const { id: routeCampaignId } = useParams<{ id: string }>();
    const isInCombat = combatMode || combatState.isInCombat;

    // Use extracted panel resize and state hook
    const {
      isExpanded,
      setIsExpanded,
      activeTab,
      setActiveTab,
      panelWidth,
      panelRef,
      dragHandleRef,
      isDraggingRef,
      startDrag,
      handleDrag,
      stopDrag,
    } = usePanelResize();

    // Local state
    const [selectedType, setSelectedType] = useState<string | null>(null);
    const [localSessionNotes, setLocalSessionNotes] = useState('');
    const sessionNotesId = useId();

    // Mobile drawer state
    const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
    const isMobile = window.innerWidth < 1024; // lg breakpoint

    // ⚡ Bolt: Memoize filter options to prevent redundant re-filtering on every render.
    const filterOptions = useMemo(
      () => ({
        types: selectedType ? [selectedType as MemoryType] : undefined,
      }),
      [selectedType],
    );

    // Get filtered and sorted memories using custom hook (must be called unconditionally)
    const sortedMemories = useMemoryFiltering(memories, filterOptions);

    // Sync local notes from session state (unconditional hook)
    useEffect(() => {
      setLocalSessionNotes(sessionData?.session_notes || '');
    }, [sessionData?.session_notes]);

    // ⚡ Bolt: Stabilize event handlers to prevent unnecessary re-renders of children.
    const toggleMobileDrawer = useCallback((): void => {
      setIsMobileDrawerOpen((prev) => !prev);
    }, []);

    const handleSaveNotes = useCallback((): void => {
      if (sessionData) {
        updateGameSessionState({ session_notes: localSessionNotes });
      }
    }, [sessionData, updateGameSessionState, localSessionNotes]);

    const { data: journal, isLoading: journalLoading } = useCampaignJournal(sessionData?.id);
    const journalEntries = journal?.entries || [];

    const handleTabChange = useCallback(
      (value: 'character' | 'memory' | 'combat' | 'journal'): void => {
        setActiveTab(value);
        // Auto-expand when switching tabs
        setIsExpanded(true);

        // Stabilize analytics call by using current state values
        const artStyle = analytics.detectArtStyle({
          characterTheme: characterState?.character?.theme,
          campaignGenre: campaignState?.campaign?.genre,
        });
        analytics.campaignTabViewed(value, { campaignId: routeCampaignId, artStyle });
      },
      [
        setActiveTab,
        setIsExpanded,
        characterState?.character?.theme,
        campaignState?.campaign?.genre,
        routeCampaignId,
      ],
    );

    // Collapsed state rendering - mobile vs desktop
    if (isCollapsed) {
      if (isMobile) {
        return (
          <div className="fixed bottom-4 right-4 md:hidden" style={{ zIndex: Z_INDEX.STICKY }}>
            <Sheet open={isMobileDrawerOpen} onOpenChange={setIsMobileDrawerOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={toggleMobileDrawer}
                  aria-label="Open game panel"
                  title="Open game panel"
                  className={`relative rounded-full p-3 h-auto shadow-xl border-2 transition-all duration-300 hover-glow focus-glow ${
                    isInCombat
                      ? 'bg-gradient-to-r from-red-500/20 to-red-600/20 border-red-400/50 animate-pulse'
                      : 'bg-gradient-to-r from-infinite-purple/20 to-infinite-teal/20 border-infinite-purple/50'
                  }`}
                >
                  <Menu className="h-5 w-5" />
                  {/* Context indicator */}
                  {(isInCombat || memories.length > 0) && (
                    <div className="absolute -top-1 -right-1 w-3 h-3 bg-infinite-gold rounded-full border border-background animate-pulse"></div>
                  )}
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-[80vw] max-w-sm p-0">
                <GameSidePanelContent
                  sessionData={sessionData}
                  updateGameSessionState={updateGameSessionState}
                  combatMode={combatMode}
                  isExpanded={isExpanded}
                  setIsExpanded={setIsExpanded}
                  activeTab={activeTab}
                  setActiveTab={setActiveTab}
                  selectedType={selectedType}
                  setSelectedType={setSelectedType}
                  localSessionNotes={localSessionNotes}
                  setLocalSessionNotes={setLocalSessionNotes}
                  memoriesLoading={memoriesLoading}
                  sortedMemories={sortedMemories}
                  characterState={characterState}
                  isInCombat={isInCombat}
                  panelWidth={panelWidth}
                  panelRef={panelRef}
                  dragHandleRef={dragHandleRef}
                  isDraggingRef={isDraggingRef}
                  startDrag={startDrag}
                  handleDrag={handleDrag}
                  stopDrag={stopDrag}
                  isMobileDrawerOpen={true}
                  journalEntries={journalEntries}
                  journalLoading={journalLoading}
                />
                <SheetClose asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute left-4 top-4"
                    aria-label="Close panel"
                    title="Close panel"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                </SheetClose>
              </SheetContent>
            </Sheet>
          </div>
        );
      }

      return (
        <div className="hidden md:block fixed right-4 top-1/2" style={{ zIndex: Z_INDEX.STICKY }}>
          <Button
            variant="outline"
            size="sm"
            onClick={onToggle}
            aria-label="Open game panel"
            title="Open game panel"
            className={`relative rounded-full p-3 h-auto shadow-xl border-2 transition-all duration-300 hover-glow focus-glow hover:scale-110 ${
              isInCombat
                ? 'bg-gradient-to-r from-red-500/20 to-red-600/20 border-red-400/50 animate-pulse'
                : 'bg-gradient-to-r from-infinite-purple/20 to-infinite-teal/20 border-infinite-purple/50'
            }`}
          >
            <ChevronDown className="h-4 w-4 rotate-90" />
            {/* Enhanced context indicators */}
            <div className="absolute -top-2 -right-2 flex flex-col gap-1">
              {isInCombat && (
                <div className="w-2 h-2 bg-red-400 rounded-full animate-pulse shadow-lg"></div>
              )}
              {memories.length > 0 && (
                <div className="w-2 h-2 bg-infinite-gold rounded-full animate-pulse shadow-lg"></div>
              )}
              {characterState.character && (
                <div className="w-2 h-2 bg-infinite-teal rounded-full animate-pulse shadow-lg"></div>
              )}
            </div>
          </Button>
        </div>
      );
    }

    return (
      <DesktopGameSidePanel
        panelRef={panelRef}
        panelWidth={panelWidth}
        dragHandleRef={dragHandleRef}
        startDrag={startDrag}
        isInCombat={isInCombat}
        activeTab={activeTab}
        handleTabChange={handleTabChange}
        isExpanded={isExpanded}
        setIsExpanded={setIsExpanded}
        onToggle={onToggle}
        sessionNotesId={sessionNotesId}
        localSessionNotes={localSessionNotes}
        setLocalSessionNotes={setLocalSessionNotes}
        handleSaveNotes={handleSaveNotes}
        selectedType={selectedType}
        setSelectedType={setSelectedType}
        memoriesLoading={memoriesLoading}
        sortedMemories={sortedMemories}
        journalLoading={journalLoading}
        journalEntries={journalEntries}
      />
    );
  },
);

GameSidePanel.displayName = 'GameSidePanel';
