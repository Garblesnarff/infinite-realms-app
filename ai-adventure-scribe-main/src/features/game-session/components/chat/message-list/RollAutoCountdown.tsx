import React from 'react';

import { pendingPlayerRollDeadline } from '@/services/combat/player-roll-bridge';

/**
 * Whole seconds until the bridge auto-rolls the prompt for `rollId`, counted down each second;
 * null when nothing will auto-roll it (a narrative roll, or one the player has committed to).
 */
export function useAutoRollSecondsLeft(rollId: string): number | null {
  const [, setTick] = React.useState(0);
  const deadline = pendingPlayerRollDeadline(rollId);

  React.useEffect(() => {
    if (deadline === null) return undefined;
    const interval = setInterval(() => setTick((tick) => tick + 1), 1000);
    return () => clearInterval(interval);
  }, [deadline]);

  return deadline === null ? null : Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
}

/** The visible clock on an engine roll prompt: the engine rolls it for the player at zero. */
export const RollAutoCountdown: React.FC<{ rollId: string }> = ({ rollId }) => {
  const secondsLeft = useAutoRollSecondsLeft(rollId);
  if (secondsLeft === null) return null;
  return (
    <p
      role="timer"
      aria-live="off"
      className="px-3 pb-1 text-xs text-muted-foreground"
      data-testid="roll-auto-countdown"
    >
      Rolls for you in {secondsLeft}s if you don't.
    </p>
  );
};
