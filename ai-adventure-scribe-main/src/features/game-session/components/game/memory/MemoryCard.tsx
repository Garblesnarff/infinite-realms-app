import React, { useState } from 'react';

import { formatWhen, importanceLevel } from './memory-format';
import { MEMORY_CATEGORIES } from './memoryConstants';

import type { Memory } from './types';

import { Card } from '@/components/ui/card';

interface MemoryCardProps {
  memory: Memory;
  /** Session number when the memory's session is known; omitted otherwise. */
  sessionNumber?: number | null;
}

/**
 * MemoryCard Component
 * One remembered fact: icon, content (two lines, expandable), metadata, when, importance.
 * Read-only: no pin, lock or edit controls yet (#1236 section B).
 */
export const MemoryCard: React.FC<MemoryCardProps> = React.memo(({ memory, sessionNumber }) => {
  const [expanded, setExpanded] = useState(false);
  const category = MEMORY_CATEGORIES.find((cat) => cat.type === memory.type);
  const importance = importanceLevel(memory.importance);
  const metadataEntries = memory.metadata ? Object.entries(memory.metadata) : [];

  return (
    <Card className="p-3 bg-white/50">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex-shrink-0" aria-hidden="true">
          {category?.icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className={`text-sm ${expanded ? '' : 'line-clamp-2'}`}>{memory.content}</p>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="ir-hit-slop mt-1 min-h-11 text-xs font-medium text-infinite-gold underline-offset-2 hover:underline"
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
          {metadataEntries.length > 0 && (
            <div className="mt-1 text-xs text-muted-foreground">
              {metadataEntries.map(([key, value]) => (
                <span key={key} className="mr-2">
                  {key}: {value as React.ReactNode}
                </span>
              ))}
            </div>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
            <span>
              {sessionNumber ? `Session ${sessionNumber} · ` : ''}
              {formatWhen(memory.created_at)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-flex gap-0.5">
                {[1, 2, 3].map((n) => (
                  <span
                    key={n}
                    className={`h-1.5 w-1.5 rounded-full ${
                      n <= importance.pips ? 'bg-infinite-gold' : 'bg-white/20'
                    }`}
                  />
                ))}
              </span>
              <span>{importance.label}</span>
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
});

MemoryCard.displayName = 'MemoryCard';
