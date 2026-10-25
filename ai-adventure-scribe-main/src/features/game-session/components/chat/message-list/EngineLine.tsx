import React, { useId, useState } from 'react';

import type { EngineLineModel, EngineLineOutcome } from './engine-line-model';

import { cn } from '@/lib/utils';

/** One pill style per outcome, written from the player's side (#87). */
const PILL_CLASS: Record<EngineLineOutcome, string> = {
  hit: 'bg-infinite-gold text-[#1a1206]',
  critical: 'bg-infinite-gold-light text-[#1a1206] shadow-glow-gold',
  miss: 'border border-[color:var(--ir-control-border)]',
  'enemy-miss': 'border border-[color:var(--ir-control-border)]',
  'enemy-hit': 'border border-[color:var(--ir-hp-bad)]/60 text-ir-hp-bad',
  pass: 'border border-[color:var(--ir-hp-good)]/60 text-ir-hp-good',
  fail: 'border border-[color:var(--ir-hp-bad)]/60 text-ir-hp-bad',
  refused: 'border border-[color:var(--ir-hp-bad)]/60 text-ir-hp-bad',
  saved: 'border border-[color:var(--ir-control-border)] text-muted-foreground',
  'failed-save': 'bg-infinite-gold text-[#1a1206]',
  move: 'border border-[color:var(--ir-control-border)] text-muted-foreground',
  info: 'border border-[color:var(--ir-control-border)] text-muted-foreground',
};

const KICKER_CLASS =
  'block text-[11px] font-semibold uppercase tracking-[.1em] text-muted-foreground';

interface EngineLineProps {
  model: EngineLineModel;
  /**
   * Prints "Rules engine" before the kicker. False for every row after the first in one engine
   * block, so the label prints once per block (#2256).
   */
  showLabel?: boolean;
}

/**
 * A rules-engine result row (#87): full width, no bubble. The row is a disclosure button; the
 * engine sentence sits in the region it controls, `hidden` until expanded.
 */
export const EngineLine: React.FC<EngineLineProps> = ({ model, showLabel = true }) => {
  const [expanded, setExpanded] = useState(false);
  const regionId = useId();
  // A line without math already shows its whole sentence; there is nothing more to expand.
  const hasMore = model.math !== null && model.sentence !== model.detail;

  return (
    <div className="w-full" data-testid="engine-line" data-outcome={model.outcome}>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={hasMore ? regionId : undefined}
        onClick={() => setExpanded((open) => !open)}
        className={cn(
          'grid w-full grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2.5 px-3 py-2 text-left',
          'border-y border-infinite-gold/30 bg-[color:var(--ir-engine)] text-[13px] leading-[1.45] tabular-nums',
        )}
      >
        <span
          aria-hidden="true"
          data-testid="engine-line-badge"
          className={cn(
            'inline-flex h-7 w-7 items-center justify-center text-xs font-bold',
            '[clip-path:polygon(50%_0,100%_25%,100%_75%,50%_100%,0_75%,0_25%)]',
            model.side === 'npc'
              ? 'bg-infinite-teal text-[#06181b]'
              : 'bg-infinite-gold text-[#1a1206]',
          )}
        >
          {model.badge}
        </span>
        <span className="min-w-0">
          {model.kicker ? (
            <span className={KICKER_CLASS}>
              {showLabel && <span data-engine-label>Rules engine</span>}
              {showLabel ? ' · ' : null}
              {model.kicker}
            </span>
          ) : showLabel ? (
            <span data-engine-label className={KICKER_CLASS}>
              Rules engine
            </span>
          ) : null}
          <span className="block">
            {model.math ? <b>{model.math}</b> : null}
            {model.math && model.detail ? ' ' : null}
            {model.detail ? (
              <span className={model.math ? 'text-muted-foreground' : undefined}>
                {model.detail}
              </span>
            ) : null}
          </span>
        </span>
        <span
          data-testid="engine-line-pill"
          className={cn(
            'text-xs font-bold uppercase tracking-[.08em] px-2 py-1 rounded-md',
            PILL_CLASS[model.outcome],
          )}
        >
          {model.pill}
        </span>
      </button>
      {hasMore && (
        <p
          id={regionId}
          hidden={!expanded}
          className="px-3 py-2 text-xs leading-relaxed text-muted-foreground"
        >
          {model.sentence}
        </p>
      )}
    </div>
  );
};
