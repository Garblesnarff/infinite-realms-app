import React, { useEffect } from 'react';

import type { PendingCombatEntryConfirmation } from '@/hooks/combat/use-combat-entry-confirmation-host';

import { Button } from '@/components/ui/button';
import { Z_INDEX } from '@/constants/z-index';
import logger from '@/lib/logger';

interface CombatEntryConfirmationProps {
  confirmation: PendingCombatEntryConfirmation | null;
}

function formatInitiative(initiativeRoll: number | null, initiativeModifier: number): string {
  if (initiativeRoll === null) return 'Initiative: rolled after confirmation';
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
    <div
      className="fixed bottom-24 left-1/2 transform -translate-x-1/2"
      style={{ zIndex: Z_INDEX.POPOVER }}
      data-testid="combat-entry-confirmation-overlay"
    >
      <section
        className="w-[min(calc(100vw-2rem),28rem)] rounded-xl border-2 border-infinite-gold/60 bg-card/95 p-4 shadow-lg"
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
    </div>
  );
};
