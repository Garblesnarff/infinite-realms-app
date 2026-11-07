import React from 'react';

import { MEMORY_CATEGORIES } from './memoryConstants';

import type { Memory } from './types';

import { Button } from '@/components/ui/button';

interface MemoryFilterProps {
  selectedType: string | null;
  onTypeSelect: (type: string | null) => void;
  /** All memories for the session; chips appear only for categories that have rows. */
  memories: Memory[];
}

/**
 * MemoryFilter Component
 * Filter chips: "All N" plus one chip per category that has at least one memory,
 * each with its count (#1429, Panels board: "{{label}} {{n}}").
 */
export const MemoryFilter: React.FC<MemoryFilterProps> = React.memo(
  ({ selectedType, onTypeSelect, memories }) => {
    const presentTypes = new Set(memories.map((m) => m.type));
    const categories = MEMORY_CATEGORIES.filter((c) => presentTypes.has(c.type));
    const countFor = (type: string): number => memories.filter((m) => m.type === type).length;

    return (
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter memories">
        <Button
          variant={!selectedType ? 'default' : 'outline'}
          size="sm"
          onClick={() => onTypeSelect(null)}
          aria-pressed={!selectedType}
          className="flex min-h-11 items-center gap-2"
        >
          All {memories.length}
        </Button>
        {categories.map((category) => (
          <Button
            key={category.type}
            variant={selectedType === category.type ? 'default' : 'outline'}
            size="sm"
            onClick={() => onTypeSelect(category.type)}
            aria-pressed={selectedType === category.type}
            className="flex min-h-11 items-center gap-2"
          >
            <span aria-hidden="true">{category.icon}</span>
            {category.label} {countFor(category.type)}
          </Button>
        ))}
      </div>
    );
  },
);

MemoryFilter.displayName = 'MemoryFilter';
