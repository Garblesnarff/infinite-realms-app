import React from 'react';

import { groupMemoriesByCategory } from './memory-format';
import { MemoryCard } from './MemoryCard';
import { MemoryFilter } from './MemoryFilter';

import type { Memory } from './types';

export interface MemoryListProps {
  /** Every memory for the session (drives the header count and the chips). */
  allMemories: Memory[];
  /** Memories after the category filter and sort. */
  sortedMemories: Memory[];
  selectedType: string | null;
  setSelectedType: (type: string | null) => void;
  memoriesLoading: boolean;
}

/**
 * MemoryList Component
 * Memory tab body shared by the desktop panel and the mobile sheet:
 * header count, filter chips, and cards grouped by category with counts.
 */
export const MemoryList: React.FC<MemoryListProps> = React.memo(
  ({ allMemories, sortedMemories, selectedType, setSelectedType, memoriesLoading }) => {
    const groups = groupMemoriesByCategory(sortedMemories);
    const total = allMemories.length;

    return (
      <div className="flex flex-col gap-3">
        {!memoriesLoading && total > 0 && (
          <p className="text-sm text-foreground/80">
            The DM remembers {total} {total === 1 ? 'thing' : 'things'} about this story.
          </p>
        )}
        <MemoryFilter
          selectedType={selectedType}
          onTypeSelect={setSelectedType}
          memories={allMemories}
        />
        {memoriesLoading && <p className="text-xs text-muted-foreground">Loading memories...</p>}
        {!memoriesLoading && sortedMemories.length === 0 && (
          <p className="text-xs text-muted-foreground">
            The DM has not written anything down yet. Play a scene and come back.
          </p>
        )}
        {groups.map((group) => (
          <section
            key={group.key}
            aria-labelledby={`memory-group-${group.key}`}
            className="space-y-2"
          >
            <h3
              id={`memory-group-${group.key}`}
              className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
              {group.icon && <span aria-hidden="true">{group.icon}</span>}
              {group.label}
              <span className="font-normal">({group.items.length})</span>
            </h3>
            {group.items.map((memory) => (
              <MemoryCard key={memory.id} memory={memory} />
            ))}
          </section>
        ))}
      </div>
    );
  },
);

MemoryList.displayName = 'MemoryList';
