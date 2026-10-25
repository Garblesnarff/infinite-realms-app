import React from 'react';

export interface DiceRollResultFlashProps {
  /** The kept die face. */
  die: number;
  /** The modifier already inside the total. */
  modifier: number;
  /** The settled total. */
  total: number;
}

/**
 * The tray's result flash (#84): the settled die and its breakdown, shown for
 * at most 1.5 s after the roll before the tray closes. Same tray card as the
 * prompt; no buttons, nothing to click.
 */
export const DiceRollResultFlash: React.FC<DiceRollResultFlashProps> = React.memo(
  ({ die, modifier, total }) => {
    const signedModifier = modifier >= 0 ? `+ ${modifier}` : `- ${Math.abs(modifier)}`;
    return (
      <div
        role="status"
        data-testid="dice-roll-result"
        className="w-full rounded-none border-0 border-t border-infinite-gold/50 bg-infinite-dark/95 text-foreground shadow-none outline-none"
      >
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-3 py-2.5 sm:px-4 sm:py-3">
          <span
            aria-hidden="true"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/10 text-[22px] font-bold tabular-nums"
          >
            {die}
          </span>
          <span className="text-[22px] font-bold tabular-nums">
            {die} {signedModifier} = {total}
          </span>
        </div>
      </div>
    );
  },
);
