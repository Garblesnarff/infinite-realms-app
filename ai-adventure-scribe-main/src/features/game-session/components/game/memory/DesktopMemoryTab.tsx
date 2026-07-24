import React from 'react';

import { MemoryCard } from './MemoryCard';
import { MemoryFilter } from './MemoryFilter';

import type { Memory } from '@/types/memory';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';

export interface DesktopMemoryTabProps {
  sessionNotesId: string;
  localSessionNotes: string;
  setLocalSessionNotes: (notes: string) => void;
  handleSaveNotes: () => void;
  selectedType: string | null;
  setSelectedType: (type: string | null) => void;
  memoriesLoading: boolean;
  sortedMemories: Memory[];
}

export const DesktopMemoryTab: React.FC<DesktopMemoryTabProps> = React.memo(
  ({
    sessionNotesId,
    localSessionNotes,
    setLocalSessionNotes,
    handleSaveNotes,
    selectedType,
    setSelectedType,
    memoriesLoading,
    sortedMemories,
  }) => {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        {/* Compact Session Notes Section */}
        <section className="border-b border-white/5 p-4 flex-shrink-0">
          <Label
            htmlFor={sessionNotesId}
            className="ir-display mb-2 block text-[11px] font-semibold uppercase tracking-[1.6px] text-infinite-gold"
          >
            Session Notes
          </Label>
          <Textarea
            id={sessionNotesId}
            value={localSessionNotes}
            onChange={(e) => setLocalSessionNotes(e.target.value)}
            placeholder="Type your session notes here..."
            rows={4}
            className="mb-3 resize-none rounded-lg border-white/10 bg-white/[0.03] text-sm focus:border-infinite-teal/50 focus:ring-2 focus:ring-infinite-teal/20"
          />
          <Button onClick={handleSaveNotes} size="sm" variant="ir-gold" className="px-4 py-2">
            Save Notes
          </Button>
        </section>

        {/* Memories Section */}
        <div className="flex-shrink-0 border-b border-white/5 p-4">
          <MemoryFilter selectedType={selectedType} onTypeSelect={setSelectedType} />
        </div>

        <ScrollArea className="flex-1 bg-black/10 p-4" style={{ maxHeight: '56vh' }}>
          {memoriesLoading && <p className="text-xs text-muted-foreground">Loading memories...</p>}
          {!memoriesLoading && sortedMemories.length === 0 && (
            <p className="text-xs text-muted-foreground">No memories logged yet.</p>
          )}
          <div className="space-y-2">
            {sortedMemories.map((memory) => (
              <MemoryCard key={memory.id} memory={memory} />
            ))}
          </div>
        </ScrollArea>
      </div>
    );
  },
);

DesktopMemoryTab.displayName = 'DesktopMemoryTab';
