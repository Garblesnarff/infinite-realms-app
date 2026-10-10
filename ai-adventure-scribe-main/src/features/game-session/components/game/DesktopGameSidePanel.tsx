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
import { Tabs, TabsContent } from '@/components/ui/tabs';
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
  sortedMemories: Memory[];
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
    sortedMemories,
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
                  className="ir-hit-slop h-8 px-2"
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
                  className={`ir-hit-slop h-8 px-2 transition-all duration-200 ${
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
                    className={`ir-hit-slop h-8 px-2 transition-all duration-200 ${
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
                  className={`ir-hit-slop h-8 px-2 transition-all duration-200 ${
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
              <Tabs
                value={activeTab}
                onValueChange={(value) =>
                  handleTabChange(value as 'character' | 'memory' | 'combat' | 'journal')
                }
                className="flex flex-col h-full"
              >
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
              </Tabs>
            </div>
          )}
        </Card>
      </div>
    );
  },
);

DesktopGameSidePanel.displayName = 'DesktopGameSidePanel';
