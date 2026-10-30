import { Filter } from 'lucide-react';
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
 * Filter chips: "All" plus one chip per category that has at least one memory.
 */
export const MemoryFilter: React.FC<MemoryFilterProps> = React.memo(
  ({ selectedType, onTypeSelect, memories }) => {
    const presentTypes = new Set(memories.map((m) => m.type));
    const categories = MEMORY_CATEGORIES.filter((c) => presentTypes.has(c.type));

    return (
      <div className="flex gap-2 overflow-x-auto" role="group" aria-label="Filter memories">
        <Button
          variant={!selectedType ? 'default' : 'outline'}
          size="sm"
          onClick={() => onTypeSelect(null)}
          aria-pressed={!selectedType}
          className="flex min-h-11 items-center gap-2"
        >
          <Filter className="h-4 w-4" aria-hidden="true" />
          All
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
            {category.label}
          </Button>
        ))}
      </div>
    );
  },
);

MemoryFilter.displayName = 'MemoryFilter';
