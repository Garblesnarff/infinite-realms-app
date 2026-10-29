import React from 'react';

import { MemoryList } from './MemoryList';

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
  allMemories: Memory[];
  sortedMemories: Memory[];
  campaignId?: string | null;
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
    allMemories,
    sortedMemories,
    campaignId,
  }) => {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        {/* Compact Session Notes Section */}
        <section className="border-b border-white/5 p-4 flex-shrink-0">
          <Label
            htmlFor={sessionNotesId}
            className="ir-display mb-2 block ir-text-min font-semibold uppercase tracking-[1.6px] text-infinite-gold"
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

        <ScrollArea className="flex-1 bg-black/10 p-4" style={{ maxHeight: '56vh' }}>
          <MemoryList
            allMemories={allMemories}
            sortedMemories={sortedMemories}
            selectedType={selectedType}
            setSelectedType={setSelectedType}
            memoriesLoading={memoriesLoading}
            campaignId={campaignId}
          />
        </ScrollArea>
      </div>
    );
  },
);

DesktopMemoryTab.displayName = 'DesktopMemoryTab';
