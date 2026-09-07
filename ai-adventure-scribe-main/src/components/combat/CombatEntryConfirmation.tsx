import React, { useEffect } from 'react';

import type { PendingCombatEntryConfirmation } from '@/hooks/combat/use-combat-entry-confirmation-host';

import { Button } from '@/components/ui/button';
import logger from '@/lib/logger';

interface CombatEntryConfirmationProps {
  confirmation: PendingCombatEntryConfirmation | null;
}

function formatInitiative(initiativeRoll: number | null, initiativeModifier: number): string {
  if (initiativeRoll === null) return 'Initiative: (auto-rolled by the engine)';
  const sign = initiativeModifier >= 0 ? '+' : '-';
  return `Initiative: ${initiativeRoll} ${sign} ${Math.abs(initiativeModifier)} = ${initiativeRoll + initiativeModifier}`;
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
    });
  }, [pendingSpec]);

  if (!confirmation) return null;

  const { spec } = confirmation;
  const combatants = spec.combatantLabels.length
    ? spec.combatantLabels.join(', ')
    : 'the opposing side';

  const resolve = (confirmed: boolean): void => {
    logger.info('[CombatEntry] confirmation popup resolved', {
      actorLabel: spec.actorLabel,
      confirmed,
    });
    (confirmed ? confirmation.confirm : confirmation.decline)();
  };

  return (
    <section
      className="rounded-xl border-2 border-infinite-gold/60 bg-card/95 p-4 shadow-lg"
      role="alert"
      aria-label="Combat entry confirmation"
    >
      <p className="font-semibold text-card-foreground">Combat is ready to begin.</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {spec.actorLabel}, continue into combat against {combatants}?
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {formatInitiative(spec.initiativeRoll, spec.initiativeModifier)}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="fantasy" onClick={() => resolve(true)}>
          [Strike]
        </Button>
        <Button type="button" variant="outline" onClick={() => resolve(false)}>
          [Do something else]
        </Button>
      </div>
    </section>
  );
};
