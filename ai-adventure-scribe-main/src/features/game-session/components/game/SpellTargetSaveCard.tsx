import React, { useEffect, useId, useRef } from 'react';

import { RollTray } from './game-content/roll-tray-slot';
import {
  displayNameFromRoster,
  type EngineRosterEntry,
} from '../../../../../shared/engine-display-name';

import type { PendingSpellTargetSave } from '@/hooks/combat/use-spell-target-save-host';

import { Button } from '@/components/ui/button';
import { useShowTargetNumbers } from '@/features/game-session/hooks/use-show-target-numbers';

interface SpellTargetSaveCardProps {
  pending: PendingSpellTargetSave | null;
  /**
   * Combat participants for name resolution. The alert shows the same
   * player-visible name the tracker and the engine lines show (#2343 B4).
   */
  roster?: readonly EngineRosterEntry[];
}

const ABILITY_NAMES: Record<string, string> = {
  STR: 'Strength',
  DEX: 'Dexterity',
  CON: 'Constitution',
  INT: 'Intelligence',
  WIS: 'Wisdom',
  CHA: 'Charisma',
};

const abilityName = (ability: string): string => ABILITY_NAMES[ability.toUpperCase()] ?? ability;

/**
 * The target-saves card for a save spell: the target rolls, the player does not (#2392, #2418).
 *
 * It sits in the roll tray, between the story and the chat box, so it never covers a control.
 * Focus lands on Continue, which submits the spell; Cancel cast (or Escape) gives the cast up
 * before the engine spends the slot. The engine line is still the result.
 */
export const SpellTargetSaveCard: React.FC<SpellTargetSaveCardProps> = ({
  pending,
  roster = [],
}) => (pending ? <SaveCard pending={pending} roster={roster} /> : null);

const SaveCard: React.FC<{
  pending: PendingSpellTargetSave;
  roster: readonly EngineRosterEntry[];
}> = ({ pending, roster }) => {
  const { showTargetNumbers } = useShowTargetNumbers();
  const id = useId();
  const continueRef = useRef<HTMLButtonElement>(null);
  const { spec } = pending;

  useEffect(() => {
    // Back to whatever had focus (the Cast button) once the card is answered, as the sheet does.
    const opener = document.activeElement as HTMLElement | null;
    continueRef.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, [spec]);

  const targetName = displayNameFromRoster(spec.targetLabel, roster);
  const youDoNotRoll =
    showTargetNumbers && spec.saveDc !== undefined
      ? `Save DC ${spec.saveDc}. You do not roll.`
      : 'You do not roll.';

  return (
    <RollTray>
      <section
        data-testid="spell-target-save-card"
        className="border-t-2 border-infinite-gold bg-card px-4 py-3"
        role="alertdialog"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-body`}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.stopPropagation();
          pending.cancel();
        }}
      >
        <h2 id={`${id}-title`} className="font-display text-xl font-semibold text-infinite-gold">
          {targetName} must save
        </h2>
        <p id={`${id}-body`} className="mt-1 text-sm text-card-foreground">
          {targetName} makes a {abilityName(spec.saveAbility)} saving throw against {spec.spellName}
          .
        </p>
        <p className="mt-1 text-sm font-medium text-card-foreground">{youDoNotRoll}</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Button
            ref={continueRef}
            type="button"
            variant="fantasy"
            className="h-[52px] w-full sm:w-auto sm:min-w-40"
            onClick={pending.continue}
          >
            Continue
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full sm:w-auto"
            onClick={pending.cancel}
          >
            Cancel cast
          </Button>
        </div>
      </section>
    </RollTray>
  );
};
