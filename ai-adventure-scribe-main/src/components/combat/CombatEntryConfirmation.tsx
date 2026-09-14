import React, { useEffect } from 'react';

import type { PendingCombatEntryConfirmation } from '@/hooks/combat/use-combat-entry-confirmation-host';

import { Button } from '@/components/ui/button';
import { Z_INDEX } from '@/constants/z-index';
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
    });
  }, [pendingSpec]);

  if (!confirmation) return null;

  const { spec } = confirmation;
  const combatants = spec.combatantLabels.length
    ? spec.combatantLabels.join(', ')
    : 'the opposing side';

  const resolve = (event: React.MouseEvent<HTMLButtonElement>): void => {
    const action = event.currentTarget.dataset.action;
    const confirmed = action === 'confirm';
    logger.info('[CombatEntry] confirmation popup resolved', {
      actorLabel: spec.actorLabel,
      confirmed,
      action,
    });
    (confirmed ? confirmation.confirm : confirmation.decline)();
  };

  return (
    <div
      className="fixed bottom-40 left-1/2 transform -translate-x-1/2"
      style={{ zIndex: Z_INDEX.COMBAT_ENTRY_CONFIRMATION }}
      data-testid="combat-entry-confirmation-overlay"
    >
      <section
        className="w-[min(calc(100vw-2rem),28rem)] rounded-xl border-2 border-infinite-gold/60 bg-card/95 p-4 shadow-lg"
        role="alert"
        aria-label="Combat entry confirmation"
      >
        <p className="font-semibold text-card-foreground">Combat is about to begin</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Strike at {combatants}? Your initiative is rolled after you confirm.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="fantasy" data-action="confirm" onClick={resolve}>
            [Strike]
          </Button>
          <Button type="button" variant="outline" data-action="decline" onClick={resolve}>
            [Do something else]
          </Button>
        </div>
      </section>
    </div>
  );
};
