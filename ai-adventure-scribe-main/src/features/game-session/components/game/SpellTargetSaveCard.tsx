import React from 'react';
import { createPortal } from 'react-dom';

import { displayNameFromRoster, type EngineRosterEntry } from '../../../../../shared/engine-display-name';

import type { PendingSpellTargetSave } from '@/hooks/combat/use-spell-target-save-host';

import { Button } from '@/components/ui/button';
import { Z_INDEX } from '@/constants/z-index';

interface SpellTargetSaveCardProps {
  pending: PendingSpellTargetSave | null;
  /**
   * Combat participants for name resolution. The alert shows the same
   * player-visible name the tracker and the engine lines show (#2343 B4).
   */
  roster?: readonly EngineRosterEntry[];
}

/**
 * Informational card for save spells: the target rolls, the player does not.
 * Continuing submits the spell; the engine line is the result.
 */
export const SpellTargetSaveCard: React.FC<SpellTargetSaveCardProps> = ({ pending, roster = [] }) => {
  if (!pending || typeof document === 'undefined') return null;

  const { spec } = pending;
  const targetName = displayNameFromRoster(spec.targetLabel, roster);

  return createPortal(
    <div
      className="pointer-events-none fixed bottom-24 left-1/2 -translate-x-1/2"
      style={{ zIndex: Z_INDEX.COMBAT_ENTRY_CONFIRMATION }}
      data-testid="spell-target-save-card"
    >
      <section
        className="pointer-events-auto w-[min(calc(100vw-2rem),28rem)] rounded-xl border-2 border-infinite-gold bg-card p-4 shadow-2xl"
        role="alert"
        aria-label="Target saving throw"
      >
        <p className="font-semibold text-card-foreground">Target saves</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {targetName} must make a {spec.saveAbility} saving throw against {spec.spellName}.
          You do not roll.
        </p>
        <div className="mt-3">
          <Button type="button" variant="fantasy" onClick={pending.continue}>
            [Cast]
          </Button>
        </div>
      </section>
    </div>,
    document.body,
  );
};
