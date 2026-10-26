import React, { useEffect, useId, useRef } from 'react';

import type { PendingCombatEntryConfirmation } from '@/hooks/combat/use-combat-entry-confirmation-host';
import type { CombatEntryConfirmationSpec } from '@/services/combat/combat-entry-confirmation-bridge';

import { Button } from '@/components/ui/button';
import { RollTray } from '@/features/game-session/components/game/game-content/roll-tray-slot';
import logger from '@/lib/logger';

interface CombatEntryConfirmationProps {
  confirmation: PendingCombatEntryConfirmation | null;
}

/**
 * The entry card's title names the declared action (#86), not a generic
 * "Strike": a named spell casts, a weapon/unarmed declaration attacks,
 * anything else fights. The target is the declared target (or the first
 * roster name when none was declared) plus "and N more" for the rest;
 * with no names at all the card falls back to "the opposing side" (#2532).
 * Display names only — no slugs.
 */
function entryTitle(spec: CombatEntryConfirmationSpec): string {
  const declaredTargets = spec.declaredTargets ?? [];
  const primary = declaredTargets.length ? declaredTargets[0] : spec.combatantLabels[0];
  const extra = declaredTargets.length
    ? (spec.otherCombatants ?? []).length
    : Math.max(0, spec.combatantLabels.length - 1);
  const targetPhrase = primary
    ? `the ${primary}${extra > 0 ? ` and ${extra} more` : ''}`
    : 'the opposing side';
  if (spec.attackSource === 'spell') {
    // A spell without a name has no ticket form ("Cast {Spell} at the …?");
    // "Cast a spell" keeps the verb and stays grammatical. No current
    // builder produces a nameless spell; this is a defensive fallback.
    return spec.spellName
      ? `Cast ${spec.spellName} at ${targetPhrase}?`
      : `Cast a spell at ${targetPhrase}?`;
  }
  if (spec.attackSource === 'weapon' || spec.attackSource === 'unarmed') {
    return `Attack ${targetPhrase}?`;
  }
  return `Fight ${targetPhrase}?`;
}

/** Confirms or declines entry before the explicit seating endpoint is called. */
export const CombatEntryConfirmation: React.FC<CombatEntryConfirmationProps> = ({
  confirmation,
}) => {
  const pendingSpec = confirmation?.spec;
  const titleId = useId();
  const startButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!pendingSpec) return;
    logger.info('[CombatEntry] confirmation popup mounted', {
      actorLabel: pendingSpec.actorLabel,
      // Copies: the picker passes one array as both labels and choices, and the logger prints a
      // value it has already seen as "[Circular]" (#2445).
      combatantLabels: [...pendingSpec.combatantLabels],
      declaredTargets: [...(pendingSpec.declaredTargets ?? [])],
      otherCombatants: [...(pendingSpec.otherCombatants ?? [])],
      targetChoices: [...(pendingSpec.targetChoices ?? [])],
    });
  }, [pendingSpec]);

  // Focus starts on "Start the fight" (#86), once per card — not on every
  // parent re-render. The host returns a fresh confirmation object on
  // every render, but pendingSpec is the stable state object, so this
  // effect runs only when a new card arrives and never yanks focus back
  // after the player tabs to "Do something else". Choice cards have no
  // Start button, so the focus call is a no-op there by design.
  useEffect(() => {
    if (!pendingSpec) return;
    startButtonRef.current?.focus();
  }, [pendingSpec]);

  // Escape declines (#86). Skipped when another handler already consumed
  // the key (e.g. ChatInput closing dice suggestions with preventDefault
  // while the composer stays live under #400) so one press is not two
  // actions at once.
  useEffect(() => {
    if (!confirmation) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') confirmation.decline();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [confirmation]);

  if (!confirmation) return null;

  if (typeof document === 'undefined') return null;

  const { spec } = confirmation;
  const targetChoices = spec.targetChoices ?? [];
  const isChoice = targetChoices.length > 0;
  const otherCombatants = spec.otherCombatants ?? [];
  // The title names only the first target plus "and N more", so the rest
  // must be named somewhere: declared entries list them in otherCombatants,
  // but a fallback roster names nobody — there the rest of the roster is
  // the "more" (#86). Choice cards never show this line (enforced here,
  // not just builder-dependent): their labels are the choices, not a roster.
  const displayOthers = isChoice
    ? []
    : !(spec.declaredTargets ?? []).length
      ? spec.combatantLabels.slice(1)
      : otherCombatants;

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
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
        >
          {isChoice ? (
            <p id={titleId} className="font-semibold text-card-foreground">
              {spec.activeCombat ? 'Choose a spell target' : 'Combat is about to begin'}
            </p>
          ) : (
            <>
              <p className="ir-text-min font-semibold uppercase tracking-[.12em] text-infinite-gold">
                A fight is starting
              </p>
              <p id={titleId} className="text-[17px] font-semibold text-card-foreground">
                {entryTitle(spec)}
              </p>
            </>
          )}
          {spec.playerMessage && !targetChoices.length ? (
            // #877: quote the player's own words — weapon included — so what they confirm
            // is the action they wrote, not the card's reconstruction from target names.
            <p className="mt-1 text-sm text-card-foreground">
              You wrote: &ldquo;{spec.playerMessage}&rdquo;
            </p>
          ) : null}
          <p className="mt-1 text-sm text-muted-foreground">
            {isChoice
              ? `Who is ${spec.spellLabel ?? 'your attack'} for?${spec.activeCombat ? '' : ' Your initiative is rolled after you choose.'}`
              : 'If you go ahead, everyone rolls initiative, then turns go in order. You can still talk or do something else instead.'}
          </p>
          {displayOthers.length > 0 && (
            <p className="mt-1 text-sm text-muted-foreground">
              Also joining the fight: {displayOthers.join(', ')}.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {isChoice ? (
              targetChoices.map((choice) => (
                <Button
                  key={choice}
                  type="button"
                  variant="fantasy"
                  data-action="confirm"
                  data-target={choice}
                  onClick={resolve}
                >
                  {`${spec.activeCombat ? 'Cast at' : 'Strike'} ${choice}`}
                </Button>
              ))
            ) : (
              <Button
                ref={startButtonRef}
                type="button"
                variant="ir-gold"
                data-action="confirm"
                onClick={resolve}
              >
                Start the fight
              </Button>
            )}
            <Button type="button" variant="outline" data-action="decline" onClick={resolve}>
              Do something else
            </Button>
          </div>
        </section>
      </div>
    </RollTray>
  );
};
