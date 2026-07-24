/* eslint-disable max-lines */
import {
  List,
  ChevronDown,
  ChevronUp,
  User,
  Sword,
  Menu,
  ChevronLeft,
  BookOpen,
} from 'lucide-react';
import React, { useState, useEffect, useId, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';

import { CombatSummary } from './CombatSummary';
import { GameSidePanelContent } from './GameSidePanelContent';
import { DesktopMemoryTab } from './memory/DesktopMemoryTab';
import { RightSheetLive } from './overhaul/RightSheetLive';
import { HandoutCard } from '../handouts/HandoutCard';

import type { MemoryType } from './memory/types';
import type { ExtendedGameSession } from '@/hooks/use-game-session';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetTrigger, SheetClose } from '@/components/ui/sheet';
import { Tabs, TabsContent } from '@/components/ui/tabs';
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
      <div
        ref={panelRef}
        className="h-full bg-transparent shadow-sm border-0 flex flex-col resize-x lg:resize-x-none min-w-[280px] max-w-[400px]"
        style={{ width: panelWidth, minWidth: '280px', maxWidth: '400px' }}
      >
        {/* Drag Handle for Desktop */}
        <div
          ref={dragHandleRef}
          className="absolute left-0 top-0 w-1 h-full bg-border hover:bg-primary cursor-col-resize hidden lg:block"
          style={{ zIndex: Z_INDEX.DROPDOWN }}
          onMouseDown={startDrag}
        />

        <Card
          className={`ir-panel h-full flex flex-col overflow-hidden border shadow-2xl transition-all duration-500 ${
            isInCombat
              ? 'border-red-400/40 bg-gradient-to-b from-red-950/20 to-[#0e1422]'
              : 'border-white/10 bg-gradient-to-b from-[#111726] to-[#0e1422]'
          }`}
        >
          <div className="p-3 border-b border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="flex gap-1 flex-shrink-0">
                <Button
                  variant={activeTab === 'character' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => handleTabChange('character')}
                  aria-label="Character Sheet"
                  title="Character Sheet"
                  aria-pressed={activeTab === 'character'}
                  className="h-8 px-2"
                >
                  <User className="h-4 w-4" />
                </Button>
                <Button
                  variant={activeTab === 'memory' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => handleTabChange('memory')}
                  aria-label="Memories"
                  title="Memories"
                  aria-pressed={activeTab === 'memory'}
                  className={`h-8 px-2 transition-all duration-200 ${
                    activeTab === 'memory'
                      ? 'bg-infinite-gold/15 text-infinite-gold shadow-glow-gold'
                      : 'text-foreground/60 hover:bg-white/5 hover:text-infinite-gold'
                  }`}
                >
                  <List className="h-4 w-4" />
                </Button>
                {isInCombat && (
                  <Button
                    variant={activeTab === 'combat' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => handleTabChange('combat')}
                    aria-label="Combat"
                    title="Combat"
                    aria-pressed={activeTab === 'combat'}
                    className={`h-8 px-2 transition-all duration-200 ${
                      activeTab === 'combat'
                        ? 'bg-red-500 text-white shadow-lg animate-pulse'
                        : 'hover:bg-red-500/20'
                    }`}
                  >
                    <Sword className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  variant={activeTab === 'journal' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => handleTabChange('journal')}
                  aria-label="Journal"
                  title="Journal"
                  aria-pressed={activeTab === 'journal'}
                  className={`h-8 px-2 transition-all duration-200 ${
                    activeTab === 'journal'
                      ? 'bg-amber-500/20 text-amber-100 shadow-lg'
                      : 'text-foreground/60 hover:bg-white/5 hover:text-amber-100'
                  }`}
                >
                  <BookOpen className="h-4 w-4" />
                </Button>
              </div>
              <h3 className="font-display font-semibold text-card-foreground capitalize truncate text-sm">
                {activeTab === 'character' && '🎭 Character'}
                {activeTab === 'memory' && '📚 Memories'}
                {activeTab === 'combat' && '⚔️ Combat'}
                {activeTab === 'journal' && '📜 Journal'}
              </h3>
            </div>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setIsExpanded(!isExpanded);
                  if (isExpanded) onToggle();
                }}
                aria-label={isExpanded ? 'Minimize' : 'Expand'}
                title={isExpanded ? 'Minimize' : 'Expand'}
                className="h-8 w-8 p-0 rounded-full hover:bg-muted/20 transition-all duration-200 hover:scale-110"
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronUp className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onToggle()}
                aria-label="Close Panel"
                title="Close Panel"
                className="h-8 w-8 p-0 rounded-full hover:bg-red-500/20 transition-all duration-200 hover:scale-110"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {isExpanded && (
            <div className="flex-grow flex flex-col overflow-hidden">
              <Tabs
                value={activeTab}
                onValueChange={(value) =>
                  handleTabChange(value as 'character' | 'memory' | 'combat' | 'journal')
                }
                className="flex flex-col h-full"
              >
                <TabsContent value="character" className="mt-0 flex-1 border-0 bg-transparent p-0">
                  <div style={{ maxHeight: '78vh', overflow: 'auto' }} className="p-1">
                    <RightSheetLive />
                  </div>
                </TabsContent>

                <TabsContent
                  value="memory"
                  className="mt-0 flex flex-1 flex-col overflow-hidden border-0 bg-transparent"
                >
                  <DesktopMemoryTab
                    sessionNotesId={sessionNotesId}
                    localSessionNotes={localSessionNotes}
                    setLocalSessionNotes={setLocalSessionNotes}
                    handleSaveNotes={handleSaveNotes}
                    selectedType={selectedType}
                    setSelectedType={setSelectedType}
                    memoriesLoading={memoriesLoading}
                    sortedMemories={sortedMemories}
                  />
                </TabsContent>

                {isInCombat && (
                  <TabsContent value="combat" className="mt-0 flex-1 border-0 bg-transparent">
                    <div
                      className="bg-gradient-to-b from-red-950/10 to-transparent p-2"
                      style={{ maxHeight: '72vh', overflow: 'auto' }}
                    >
                      <CombatSummary />
                    </div>
                  </TabsContent>
                )}

                <TabsContent
                  value="journal"
                  className="mt-0 flex flex-1 flex-col overflow-hidden border-0 bg-transparent"
                >
                  <ScrollArea className="flex-1 bg-black/10 p-4" style={{ maxHeight: '56vh' }}>
                    {journalLoading && (
                      <p className="text-xs text-muted-foreground">Loading journal...</p>
                    )}
                    {!journalLoading && journalEntries.length === 0 && (
                      <p className="text-xs text-muted-foreground">No handouts delivered yet.</p>
                    )}
                    <div className="space-y-5">
                      {Object.entries(
                        journalEntries.reduce<Record<string, typeof journalEntries>>(
                          (groups, entry) => {
                            const label =
                              entry.sessionNumber == null
                                ? 'This campaign'
                                : `Session ${entry.sessionNumber}`;
                            (groups[label] ||= []).push(entry);
                            return groups;
                          },
                          {},
                        ),
                      ).map(([session, entries]) => (
                        <section key={session} className="space-y-2">
                          <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-100/70">
                            {session}
                          </h4>
                          {entries.map((entry) => (
                            <HandoutCard key={entry.id} entry={entry} />
                          ))}
                        </section>
                      ))}
                    </div>
                  </ScrollArea>
                </TabsContent>
              </Tabs>
            </div>
          )}
        </Card>
      </div>
    );
  },
);

GameSidePanel.displayName = 'GameSidePanel';
