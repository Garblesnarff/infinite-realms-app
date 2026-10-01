import React, { useEffect } from 'react';

import type { PendingCombatEntryConfirmation } from '@/hooks/combat/use-combat-entry-confirmation-host';

import { Button } from '@/components/ui/button';
import { RollTray } from '@/features/game-session/components/game/game-content/roll-tray-slot';
import logger from '@/lib/logger';

interface CombatEntryConfirmationProps {
  confirmation: PendingCombatEntryConfirmation | null;
}

/** Confirms or declines entry before the explicit seating endpoint is called. */
export const CombatEntryConfirmation: React.FC<CombatEntryConfirmationProps> = ({
  confirmation,
}) => {
  const pendingSpec = confirmation?.spec;

  useEffect(() => {
    if (!pendingSpec) return;
    logger.info('[CombatEntry] confirmation popup mounted', {
      actorLabel: pendingSpec.actorLabel,
      combatantLabels: pendingSpec.combatantLabels,
      declaredTargets: pendingSpec.declaredTargets ?? [],
      otherCombatants: pendingSpec.otherCombatants ?? [],
      targetChoices: pendingSpec.targetChoices ?? [],
    });
  }, [pendingSpec]);

  if (!confirmation) return null;

  if (typeof document === 'undefined') return null;

  const { spec } = confirmation;
  const declaredTargets = spec.declaredTargets ?? [];
  const primaryCombatants = declaredTargets.length ? declaredTargets : spec.combatantLabels;
  const combatants = primaryCombatants.length ? primaryCombatants.join(', ') : 'the opposing side';
  const otherCombatants = spec.otherCombatants ?? [];
  const targetChoices = spec.targetChoices ?? [];

  const resolve = (event: React.MouseEvent<HTMLButtonElement>): void => {
    const { action, target } = event.currentTarget.dataset;
    const confirmed = action === 'confirm';
    logger.info('[CombatEntry] confirmation popup resolved', {
      actorLabel: spec.actorLabel,
      confirmed,
      action,
    });
    if (confirmed) confirmation.confirm(target);
    else confirmation.decline();
  };

  return (
    <RollTray>
      <div className="w-full px-4 py-2" data-testid="combat-entry-confirmation-overlay">
        <section
          className="w-full rounded-xl border-2 border-infinite-gold bg-card p-4 shadow-2xl"
          role="alert"
          aria-label="Combat entry confirmation"
        >
          <p className="font-semibold text-card-foreground">Combat is about to begin</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {targetChoices.length
              ? `Who is ${spec.spellLabel ?? 'your attack'} for? Your initiative is rolled after you choose.`
              : `Strike at ${combatants}? Your initiative is rolled after you confirm.`}
          </p>
          {otherCombatants.length > 0 && (
            <p className="mt-1 text-sm text-muted-foreground">
              Also joining the fight: {otherCombatants.join(', ')}.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {targetChoices.length ? (
              targetChoices.map((choice) => (
                <Button
                  key={choice}
                  type="button"
                  variant="fantasy"
                  data-action="confirm"
                  data-target={choice}
                  onClick={resolve}
                >
                  {`[Strike ${choice}]`}
                </Button>
              ))
            ) : (
              <Button type="button" variant="fantasy" data-action="confirm" onClick={resolve}>
                [Strike]
              </Button>
            )}
            <Button type="button" variant="outline" data-action="decline" onClick={resolve}>
              [Do something else]
            </Button>
          </div>
        </section>
      </div>
    </RollTray>
  );
};
