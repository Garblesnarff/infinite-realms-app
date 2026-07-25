import { toast as sonnerToast } from 'sonner';

import type { CombatStartError } from './combat-start-failure';

/** Stage-specific, player-readable explanation of why combat did not start. */
function describeStage(failure: CombatStartError): string {
  switch (failure.stage) {
    case 'ownership':
      return 'This session could not be verified. Try reloading the page.';
    case 'participants':
      return 'The combatants could not be set up.';
    case 'map_generation':
      return 'The battle map could not be generated.';
    case 'persistence':
      return 'Combat started but could not be saved.';
    default:
      return 'The server could not start combat.';
  }
}

/**
 * A refused combat start leaves the scene mid-transition, so the player needs a way back in.
 * The toast stays until dismissed and offers the same start again — nothing about the failure
 * makes a second attempt unsafe, since no encounter was created.
 */
export function notifyRetryableCombatStartFailure(
  failure: CombatStartError,
  retry: () => Promise<void>,
): void {
  sonnerToast.error("Combat couldn't start", {
    description: `${describeStage(failure)} (${failure.status}${failure.stage === 'unknown' ? '' : `, ${failure.stage}`})`,
    duration: Infinity,
    action: {
      label: 'Retry',
      onClick: () => {
        void retry();
      },
    },
  });
}
