import React from 'react';

import { MemoryList } from './MemoryList';

import type { Memory } from '@/types/memory';

import { ScrollArea } from '@/components/ui/scroll-area';

export interface DesktopMemoryTabProps {
  selectedType: string | null;
  setSelectedType: (type: string | null) => void;
  memoriesLoading: boolean;
  allMemories: Memory[];
  sortedMemories: Memory[];
  campaignId?: string | null;
}

/**
 * DesktopMemoryTab: the Memory tab is the memory list only. Session notes live on
 * the Journal tab (#1429, Panels board: MY NOTES sits under Journal).
 */
export const DesktopMemoryTab: React.FC<DesktopMemoryTabProps> = React.memo(
  ({ selectedType, setSelectedType, memoriesLoading, allMemories, sortedMemories, campaignId }) => {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <ScrollArea className="flex-1 bg-black/10 p-4">
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
