import React, { useState } from 'react';

import { boardKindFor, formatWhen, importanceLevel } from './memory-format';
import { MEMORY_CATEGORIES } from './memoryConstants';

import type { Memory } from './types';
import type { CSSProperties } from 'react';

import { Card } from '@/components/ui/card';


interface MemoryCardProps {
  memory: Memory;
  /** Session number when the memory's session is known; omitted otherwise. */
  sessionNumber?: number | null;
}

/** String, number, and boolean render as text. Anything else is JSON, or skipped. */
function metadataValueText(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value == null) return null;
  try {
    const text = JSON.stringify(value);
    return typeof text === 'string' ? text : null;
  } catch {
    return null;
  }
}

/**
 * MemoryCard Component
 * One remembered fact: kind glyph and label, content (two lines, expandable),
 * metadata, when, importance. Read-only: no pin, lock or edit controls yet
 * (#1236 section B); the board's "That's wrong" control stays hidden until the
 * edit API exists (#1429, post-launch).
 */
export const MemoryCard: React.FC<MemoryCardProps> = React.memo(({ memory, sessionNumber }) => {
  const [expanded, setExpanded] = useState(false);
  const category = MEMORY_CATEGORIES.find((cat) => cat.type === memory.type);
  const boardKind = boardKindFor(memory.type, category?.label ?? 'Memory');
  const importance = importanceLevel(memory.importance);
  const metadataEntries = memory.metadata ? Object.entries(memory.metadata) : [];

  return (
    <Card
      className="p-3 bg-white/50 [body.ir-table-look_&]:!bg-[#121b30] [body.ir-table-look_&]:!shadow-[0_0_0_1px_rgba(213,176,112,0.2)] [body.ir-table-look_&]:rounded-[12px] [body.ir-table-look_&]:px-[14px] [body.ir-table-look_&]:pb-1 [body.ir-table-look_&]:pt-3"
      style={{ '--kind-color': boardKind.color } as CSSProperties}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-8 w-8 flex-none items-center justify-center rounded-full border border-border bg-muted text-sm font-bold text-muted-foreground [body.ir-table-look_&]:border-transparent [body.ir-table-look_&]:bg-[#0c1220] [body.ir-table-look_&]:shadow-[0_0_0_1px_var(--kind-color)] [body.ir-table-look_&]:!text-[var(--kind-color)]"
        >
          {boardKind.glyph}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground [body.ir-table-look_&]:!text-[var(--kind-color)]">
            {boardKind.singular}
          </p>
          <p
            className={`mt-1 text-sm ${expanded ? '' : 'line-clamp-2'} [body.ir-table-look_&]:text-base [body.ir-table-look_&]:leading-[1.45] [body.ir-table-look_&]:text-[#eaeefa]`}
          >
            {memory.content}
          </p>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="ir-hit-slop mt-1 min-h-11 text-xs font-medium text-infinite-gold underline-offset-2 hover:underline"
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
          {metadataEntries.length > 0 && (
            <div className="mt-1 text-xs text-muted-foreground [body.ir-table-look_&]:text-[13px] [body.ir-table-look_&]:!text-[#98a3c2]">
              {metadataEntries.map(([key, value]) => {
                const text = metadataValueText(value);
                if (text == null) return null;
                return (
                  <span key={key} className="mr-2">
                    {key}: {text}
                  </span>
                );
              })}
            </div>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground [body.ir-table-look_&]:text-[13px] [body.ir-table-look_&]:!text-[#98a3c2]">
            <span>
              {sessionNumber ? `Session ${sessionNumber} · ` : ''}
              {formatWhen(memory.created_at)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                role="img"
                aria-label={`Importance ${importance.pips} of 3`}
                className="inline-flex gap-0.5"
              >
                {[1, 2, 3].map((n) => (
                  <span
                    key={n}
                    className={`h-[7px] w-[7px] rounded-full ${
                      n <= importance.pips
                        ? 'bg-infinite-gold [body.ir-table-look_&]:!bg-[#d5b070]'
                        : 'bg-white/20 [body.ir-table-look_&]:!bg-[#2a3556]'
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
