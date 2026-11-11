import React from 'react';

import { MEMORY_CATEGORIES } from './memoryConstants';

import type { Memory } from './types';

import { Button } from '@/components/ui/button';

/**
 * The Panels board shows five chips: All, Locations, Characters, Events, Items.
 * Each chip maps to one memory type. Types with no chip (general, story_beat,
 * character_moment, dialogue_gem, atmosphere) appear only under All.
 */
const BOARD_CHIPS: Array<{ type: string; label: string }> = [
  { type: 'location', label: 'Locations' },
  { type: 'npc', label: 'Characters' },
  { type: 'event', label: 'Events' },
  { type: 'item', label: 'Items' },
];

interface MemoryFilterProps {
  selectedType: string | null;
  onTypeSelect: (type: string | null) => void;
  /** All memories for the session; chips appear only for categories that have rows. */
  memories: Memory[];
}

/**
 * MemoryFilter Component
 * Filter chips: "All N" plus one chip per board category that has at least one memory,
 * each with its count (#1429, Panels board: "{{label}} {{n}}").
 */
export const MemoryFilter: React.FC<MemoryFilterProps> = React.memo(
  ({ selectedType, onTypeSelect, memories }) => {
    const presentTypes = new Set(memories.map((m) => m.type));
    const chips = BOARD_CHIPS.filter((chip) => presentTypes.has(chip.type)).map((chip) => ({
      ...chip,
      icon: MEMORY_CATEGORIES.find((category) => category.type === chip.type)?.icon,
    }));
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
        {chips.map((chip) => (
          <Button
            key={chip.type}
            variant={selectedType === chip.type ? 'default' : 'outline'}
            size="sm"
            onClick={() => onTypeSelect(chip.type)}
            aria-pressed={selectedType === chip.type}
            className="flex min-h-11 items-center gap-2"
          >
            <span aria-hidden="true">{chip.icon}</span>
            {chip.label} {countFor(chip.type)}
          </Button>
        ))}
      </div>
    );
  },
);

MemoryFilter.displayName = 'MemoryFilter';
