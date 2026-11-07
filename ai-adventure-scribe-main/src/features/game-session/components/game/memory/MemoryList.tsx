import React, { useState } from 'react';

import { groupMemoriesByCategory } from './memory-format';
import { MemoryCard } from './MemoryCard';
import { MemoryFilter } from './MemoryFilter';
import { useCampaignSessionNumbers } from './useCampaignSessionNumbers';

import type { Memory } from './types';

import { Input } from '@/components/ui/input';

export interface MemoryListProps {
  /** Every memory for the session (drives the header count and the chips). */
  allMemories: Memory[];
  /** Memories after the category filter and sort. */
  sortedMemories: Memory[];
  selectedType: string | null;
  setSelectedType: (type: string | null) => void;
  memoriesLoading: boolean;
  /** Campaign whose sessions give the "Session N" part of each when line. */
  campaignId?: string | null;
}

/**
 * MemoryList Component
 * Memory tab body shared by the desktop panel and the mobile sheet:
 * header count, search, filter chips, and cards grouped by category with counts.
 * The board groups only the unfiltered view (#1429): a search or a filter shows a flat list.
 */
export const MemoryList: React.FC<MemoryListProps> = React.memo(
  ({ allMemories, sortedMemories, selectedType, setSelectedType, memoriesLoading, campaignId }) => {
    const [query, setQuery] = useState('');
    const needle = query.trim().toLowerCase();
    const visibleMemories = needle
      ? sortedMemories.filter((memory) => memory.content.toLowerCase().includes(needle))
      : sortedMemories;
    const groups = groupMemoriesByCategory(visibleMemories);
    const sessionNumbers = useCampaignSessionNumbers(campaignId);
    const total = allMemories.length;
    const grouped = !needle && !selectedType;

    return (
      <div className="flex flex-col gap-3">
        {!memoriesLoading && total > 0 && (
          <div>
            <h2 className="text-lg font-semibold [body.ir-table-look_&]:font-['Cinzel',serif] [body.ir-table-look_&]:text-[19px] [body.ir-table-look_&]:text-[#f3deb0]">
              What the DM remembers
            </h2>
            <p className="text-sm text-foreground/80 [body.ir-table-look_&]:!text-[#aab3cc]">
              The DM remembers {total} {total === 1 ? 'thing' : 'things'} about this story.
            </p>
          </div>
        )}
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search memories"
          aria-label="Search memories"
          className="h-11 [body.ir-table-look_&]:rounded-[10px] [body.ir-table-look_&]:border-[rgba(213,176,112,0.5)] [body.ir-table-look_&]:bg-[#070b14]"
        />
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
        {!memoriesLoading && sortedMemories.length > 0 && visibleMemories.length === 0 && (
          <p className="text-[15px] text-muted-foreground [body.ir-table-look_&]:!text-[#aab3cc]">
            No memories match. Try another word.
          </p>
        )}
        {grouped
          ? groups.map((group) => (
              <section
                key={group.key}
                aria-labelledby={`memory-group-${group.key}`}
                className="space-y-2"
              >
                <h3
                  id={`memory-group-${group.key}`}
                  className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground [body.ir-table-look_&]:!text-[#aab3cc]"
                >
                  {group.label} · {group.items.length}
                </h3>
                {group.items.map((memory) => (
                  <MemoryCard
                    key={memory.id}
                    memory={memory}
                    sessionNumber={memory.session_id ? sessionNumbers.get(memory.session_id) : null}
                  />
                ))}
              </section>
            ))
          : visibleMemories.map((memory) => (
              <MemoryCard
                key={memory.id}
                memory={memory}
                sessionNumber={memory.session_id ? sessionNumbers.get(memory.session_id) : null}
              />
            ))}
      </div>
    );
  },
);

MemoryList.displayName = 'MemoryList';
