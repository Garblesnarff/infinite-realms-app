import React, { useState } from 'react';

import { parseEngineLine, humanizeRawEngineLine, isEngineLine } from './engine-line-model';

import type { EngineLineOutcome } from './engine-line-model';

interface EngineLineProps {
  line: string;
  nameFor?: (slug: string) => string | undefined;
}

const pillClassFor = (outcome: EngineLineOutcome): string => {
  switch (outcome) {
    case 'hit':
      return 'bg-infinite-gold text-[#1a1206]';
    case 'critical':
      return 'bg-infinite-gold-light text-[#1a1206] shadow-glow-gold';
    case 'failed-save':
      return 'bg-infinite-gold text-[#1a1206]';
    case 'miss':
    case 'enemy-miss':
      return 'border border-[color:var(--ir-control-border)]';
    case 'enemy-hit':
      return 'border border-[color:var(--ir-hp-bad)]/60 text-ir-hp-bad';
    case 'pass':
      return 'border border-[color:var(--ir-hp-good)]/60 text-ir-hp-good';
    case 'fail':
    case 'refused':
      return 'border border-[color:var(--ir-hp-bad)]/60 text-ir-hp-bad';
    case 'saved':
      return 'border border-white/20 text-muted-foreground';
    case 'pending':
      return 'border border-dashed border-infinite-gold text-infinite-gold';
    case 'move':
    case 'info':
    default:
      return 'border border-white/20 text-muted-foreground';
  }
};

export const EngineLine: React.FC<EngineLineProps> = ({ line, nameFor }) => {
  const [expanded, setExpanded] = useState(false);
  const model = parseEngineLine(line, { nameFor });
  const rawText = humanizeRawEngineLine(line, { nameFor });

  const badgeClass =
    model.actorSide === 'player'
      ? 'bg-infinite-gold text-[#1a1206]'
      : 'bg-infinite-teal text-[#06181b]';

  return (
    <div className="w-full">
      <button
        type="button"
        aria-expanded={expanded}
        data-testid="engine-line"
        data-outcome={model.outcome}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
        className="grid w-full grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2.5 px-3 py-2 border-y border-infinite-gold/30 bg-[color:var(--ir-engine)] text-left text-[13px] leading-[1.45] tabular-nums max-[700px]:grid-cols-[28px_minmax(0,1fr)]"
      >
        <span
          className={`inline-flex h-7 w-7 items-center justify-center ${badgeClass} [clip-path:polygon(50%_0,100%_25%,100%_75%,50%_100%,0_75%,0_25%)]`}
        >
          {model.badge}
        </span>
        <span className="min-w-0">
          <span className="block text-[11px] font-semibold uppercase tracking-[.1em] text-muted-foreground">
            {model.kicker}
          </span>
          <span className="block">
            {model.math ? <b>{model.math}</b> : null}
            {model.detail ? <span className="text-muted-foreground"> {model.detail}</span> : null}
          </span>
        </span>
        <span
          className={`text-xs font-bold uppercase tracking-[.08em] px-2 py-1 rounded-md ${pillClassFor(
            model.outcome,
          )}`}
        >
          {model.pill}
        </span>
      </button>
      {expanded ? <p className="px-3 py-2 text-xs text-muted-foreground">{rawText}</p> : null}
    </div>
  );
};

export { isEngineLine };
