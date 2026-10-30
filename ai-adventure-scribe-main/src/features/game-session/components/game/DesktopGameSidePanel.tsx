import { List, ChevronDown, ChevronUp, User, Sword, BookOpen, ChevronLeft } from 'lucide-react';
import React from 'react';

import { CombatSummary } from './CombatSummary';
import { DesktopMemoryTab } from './memory/DesktopMemoryTab';
import { RightSheetLive } from './overhaul/RightSheetLive';
import { HandoutCard } from '../handouts/HandoutCard';

import type { SpellCastHandlerRef } from './spell-cast-handler';
import type { JournalHandoutEntry } from '@/services/user-data-api';
import type { Memory } from '@/types/memory';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Z_INDEX } from '@/constants/z-index';

export interface DesktopGameSidePanelProps {
  sessionId?: string;
  panelRef: React.RefObject<HTMLDivElement>;
  panelWidth: string;
  dragHandleRef: React.RefObject<HTMLDivElement>;
  startDrag: (e: React.MouseEvent) => void;
  isInCombat: boolean;
  activeTab: 'character' | 'memory' | 'combat' | 'journal';
  handleTabChange: (value: 'character' | 'memory' | 'combat' | 'journal') => void;
  isExpanded: boolean;
  setIsExpanded: (expanded: boolean) => void;
  onToggle: () => void;
  sessionNotesId: string;
  localSessionNotes: string;
  setLocalSessionNotes: (notes: string) => void;
  handleSaveNotes: () => void;
  selectedType: string | null;
  setSelectedType: (type: string | null) => void;
  memoriesLoading: boolean;
  allMemories: Memory[];
  sortedMemories: Memory[];
  campaignId?: string | null;
  journalLoading: boolean;
  journalEntries: JournalHandoutEntry[];
  spellCastHandlerRef?: SpellCastHandlerRef;
}

/**
 * DesktopGameSidePanel Component
 * Extracted from MemoryPanel.tsx
 * Handles desktop-specific rendering of the expanded game side panel
 */
export const DesktopGameSidePanel: React.FC<DesktopGameSidePanelProps> = React.memo(
  ({
    sessionId,
    panelRef,
    panelWidth,
    dragHandleRef,
    startDrag,
    isInCombat,
    activeTab,
    handleTabChange,
    isExpanded,
    setIsExpanded,
    onToggle,
    sessionNotesId,
    localSessionNotes,
    setLocalSessionNotes,
    handleSaveNotes,
    selectedType,
    setSelectedType,
    memoriesLoading,
    allMemories,
    sortedMemories,
    campaignId,
    journalLoading,
    journalEntries,
    spellCastHandlerRef,
  }) => {
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
          <Tabs
            value={activeTab}
            onValueChange={(value) =>
              handleTabChange(value as 'character' | 'memory' | 'combat' | 'journal')
            }
            className="flex h-full min-h-0 flex-col"
          >
            <div className="flex items-stretch gap-1 border-b border-white/10 p-2">
              <TabsList
                className={`grid h-auto min-w-0 flex-1 gap-0.5 rounded-none bg-transparent p-0 ${isInCombat ? 'grid-cols-4' : 'grid-cols-3'}`}
              >
                <TabsTrigger
                  value="character"
                  className="ir-hit-slop flex h-auto min-h-11 flex-col items-center justify-center gap-0.5 rounded-md px-1 py-1 text-[11px] font-medium leading-tight text-foreground/60 hover:bg-white/5 hover:text-infinite-gold data-[state=active]:bg-infinite-gold/15 data-[state=active]:text-infinite-gold data-[state=active]:shadow-glow-gold"
                >
                  <User className="h-4 w-4" aria-hidden="true" />
                  Sheet
                </TabsTrigger>
                <TabsTrigger
                  value="memory"
                  className="ir-hit-slop flex h-auto min-h-11 flex-col items-center justify-center gap-0.5 rounded-md px-1 py-1 text-[11px] font-medium leading-tight text-foreground/60 hover:bg-white/5 hover:text-infinite-gold data-[state=active]:bg-infinite-gold/15 data-[state=active]:text-infinite-gold data-[state=active]:shadow-glow-gold"
                >
                  <List className="h-4 w-4" aria-hidden="true" />
                  Memory
                </TabsTrigger>
                {isInCombat && (
                  <TabsTrigger
                    value="combat"
                    className="ir-hit-slop flex h-auto min-h-11 flex-col items-center justify-center gap-0.5 rounded-md px-1 py-1 text-[11px] font-medium leading-tight text-foreground/60 hover:bg-white/5 hover:text-infinite-gold data-[state=active]:bg-infinite-gold/15 data-[state=active]:text-infinite-gold data-[state=active]:shadow-glow-gold hover:bg-red-500/20 data-[state=active]:bg-red-500 data-[state=active]:text-white data-[state=active]:shadow-lg"
                  >
                    <Sword className="h-4 w-4" aria-hidden="true" />
                    Combat
                  </TabsTrigger>
                )}
                <TabsTrigger
                  value="journal"
                  className="ir-hit-slop flex h-auto min-h-11 flex-col items-center justify-center gap-0.5 rounded-md px-1 py-1 text-[11px] font-medium leading-tight text-foreground/60 hover:bg-white/5 hover:text-infinite-gold data-[state=active]:bg-infinite-gold/15 data-[state=active]:text-infinite-gold data-[state=active]:shadow-glow-gold"
                >
                  <BookOpen className="h-4 w-4" aria-hidden="true" />
                  Journal
                </TabsTrigger>
              </TabsList>
              <div className="flex flex-col gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setIsExpanded(!isExpanded);
                    if (isExpanded) onToggle();
                  }}
                  aria-label={isExpanded ? 'Minimize' : 'Expand'}
                  title={isExpanded ? 'Minimize' : 'Expand'}
                  className="ir-hit-slop h-8 w-8 p-0 rounded-full hover:bg-muted/20 transition-all duration-200 hover:scale-110"
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
                  className="ir-hit-slop h-8 w-8 p-0 rounded-full hover:bg-red-500/20 transition-all duration-200 hover:scale-110"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {isExpanded && (
              <div className="flex-grow flex flex-col overflow-hidden">
                <TabsContent value="character" className="mt-0 flex-1 border-0 bg-transparent p-0">
                  <div style={{ maxHeight: '78vh', overflow: 'auto' }} className="p-1">
                    <RightSheetLive
                      sessionId={sessionId}
                      isInCombat={isInCombat}
                      spellCastHandlerRef={spellCastHandlerRef}
                    />
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
                    allMemories={allMemories}
                    campaignId={campaignId}
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
                        journalEntries.reduce<Record<string, JournalHandoutEntry[]>>(
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
              </div>
            )}
          </Tabs>
        </Card>
      </div>
    );
  },
);

DesktopGameSidePanel.displayName = 'DesktopGameSidePanel';
