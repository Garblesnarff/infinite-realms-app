import React from 'react';

/** `Round 2 · The Scholar`: printed where the round or the actor changes (#2417). */
export const CombatRoundDivider: React.FC<{ round: number; actor: string }> = ({
  round,
  actor,
}) => (
  <div
    role="separator"
    data-testid="combat-round-divider"
    className="mb-2 mt-1 flex items-center gap-3"
  >
    <span className="h-px flex-1 bg-white/15" aria-hidden="true" />
    <span className="font-display text-xs font-semibold uppercase tracking-[0.2em] text-infinite-gold">
      Round {round} · {actor}
    </span>
    <span className="h-px flex-1 bg-white/15" aria-hidden="true" />
  </div>
);
