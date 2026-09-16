import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import type { PendingCombatEntryConfirmation } from '@/hooks/combat/use-combat-entry-confirmation-host';

import { Button } from '@/components/ui/button';
import { Z_INDEX } from '@/constants/z-index';
import logger from '@/lib/logger';

interface CombatEntryConfirmationProps {
  confirmation: PendingCombatEntryConfirmation | null;
  onSpaceChange?: (space: number) => void;
}

const COMBAT_ENTRY_CONFIRMATION_GAP_PX = 24;
const COMBAT_ENTRY_CONFIRMATION_FALLBACK_HEIGHT_PX = 136;

/** Confirms or declines entry before the explicit seating endpoint is called. */
export const CombatEntryConfirmation: React.FC<CombatEntryConfirmationProps> = ({
  confirmation,
  onSpaceChange,
}) => {
  const pendingSpec = confirmation?.spec;
  const cardRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!pendingSpec) return;
    logger.info('[CombatEntry] confirmation popup mounted', {
      actorLabel: pendingSpec.actorLabel,
      combatantLabels: pendingSpec.combatantLabels,
      declaredTargets: pendingSpec.declaredTargets ?? [],
      otherCombatants: pendingSpec.otherCombatants ?? [],
    });
  }, [pendingSpec]);

  useLayoutEffect(() => {
    if (!confirmation) {
      onSpaceChange?.(0);
      return;
    }

    const card = cardRef.current;
    const updateSpace = (): void => {
      const cardHeight =
        card?.getBoundingClientRect().height || COMBAT_ENTRY_CONFIRMATION_FALLBACK_HEIGHT_PX;
      onSpaceChange?.(Math.ceil(cardHeight) + COMBAT_ENTRY_CONFIRMATION_GAP_PX);
    };

    updateSpace();
    if (typeof ResizeObserver === 'undefined' || !card) return;

    const observer = new ResizeObserver(updateSpace);
    observer.observe(card);
    return () => observer.disconnect();
  }, [confirmation, onSpaceChange]);

  if (!confirmation) return null;

  if (typeof document === 'undefined') return null;

  const { spec } = confirmation;
  const declaredTargets = spec.declaredTargets ?? [];
  const primaryCombatants = declaredTargets.length ? declaredTargets : spec.combatantLabels;
  const combatants = primaryCombatants.length ? primaryCombatants.join(', ') : 'the opposing side';
  const otherCombatants = spec.otherCombatants ?? [];

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

  return createPortal(
    <div
      className="pointer-events-none fixed bottom-40 left-1/2 -translate-x-1/2"
      style={{ zIndex: Z_INDEX.COMBAT_ENTRY_CONFIRMATION }}
      data-testid="combat-entry-confirmation-overlay"
    >
      <section
        ref={cardRef}
        className="pointer-events-auto w-[min(calc(100vw-2rem),28rem)] rounded-xl border-2 border-infinite-gold bg-card p-4 shadow-2xl"
        role="alert"
        aria-label="Combat entry confirmation"
      >
        <p className="font-semibold text-card-foreground">Combat is about to begin</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Strike at {combatants}? Your initiative is rolled after you confirm.
        </p>
        {otherCombatants.length > 0 && (
          <p className="mt-1 text-sm text-muted-foreground">
            Also joining the fight: {otherCombatants.join(', ')}.
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="fantasy" data-action="confirm" onClick={resolve}>
            [Strike]
          </Button>
          <Button type="button" variant="outline" data-action="decline" onClick={resolve}>
            [Do something else]
          </Button>
        </div>
      </section>
    </div>,
    document.body,
  );
};
