import React from 'react';

import type { EngineRollOutcome } from '@/services/combat/roll-outcome-display';

import { useTableLookActive } from '@/features/campaigns/table/useTableLookActive';

export interface DiceRollResultFlashProps {
  /** The kept die face. */
  die: number;
  /** The modifier already inside the total. */
  modifier: number;
  /** The settled total. */
  total: number;
  engineOutcome?: EngineRollOutcome;
  checkSuccess?: boolean;
  awaitingEngine?: boolean;
}

/**
 * The tray's result flash (#84): the settled die and its breakdown, shown for
 * at most 1.5 s after the roll before the tray closes. Same tray card as the
 * prompt; no buttons, nothing to click.
 */
export const DiceRollResultFlash: React.FC<DiceRollResultFlashProps> = React.memo(
  ({ die, modifier, total, engineOutcome, checkSuccess, awaitingEngine }) => {
    const tableLook = useTableLookActive();
    const outcome = tableLook ? engineOutcome : undefined;
    const shownDie = outcome?.d20 ?? die;
    const shownModifier = outcome?.bonus ?? modifier;
    const shownTotal = outcome?.total ?? total;
    const critical = outcome?.hit === true && outcome.isCritical === true;
    const waiting = tableLook && awaitingEngine && !outcome;
    const isCheck = outcome?.kind === 'check' || typeof checkSuccess === 'boolean';
    let label = checkSuccess ? 'SUCCESS' : 'FAILED';
    let sealTone: 'gold' | 'red' | 'slate' = checkSuccess ? 'gold' : 'red';
    if (outcome?.kind === 'check') {
      label = outcome.success ? 'SUCCESS' : 'FAILED';
      sealTone = outcome.success ? 'gold' : 'red';
    } else if (outcome) {
      label = critical ? (outcome.d20 === 20 ? '20 CRIT' : 'CRIT') : outcome.hit ? 'HIT' : 'MISS';
      sealTone = critical ? 'gold' : outcome.hit ? 'red' : 'slate';
    }
    const sealBackground =
      sealTone === 'gold'
        ? '#6e4a16'
        : sealTone === 'red'
          ? 'var(--ir-wax-red-2)'
          : 'var(--ir-wax-slate)';
    const signedModifier =
      shownModifier >= 0 ? `+ ${shownModifier}` : `- ${Math.abs(shownModifier)}`;
    return (
      <div
        role="status"
        data-testid="dice-roll-result"
        data-engine-critical={critical ? 'true' : 'false'}
        className={`w-full rounded-none border-0 border-t border-infinite-gold/50 bg-infinite-dark/95 text-foreground shadow-none outline-none ${isCheck ? 'ir-parchment [body.ir-table-look_&]:!text-[#2a1a0c]' : ''}`}
      >
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-3 py-2.5 sm:px-4 sm:py-3">
          {waiting ? (
            <span className="text-sm">Resolving…</span>
          ) : (
            <>
              <span
                aria-hidden="true"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/10 text-[22px] font-bold tabular-nums"
              >
                {shownDie}
              </span>
              <span className="text-[22px] font-bold tabular-nums">
                {shownDie} {signedModifier}
                {outcome?.blessDie ? ` + ${outcome.blessDie}` : ''} = {shownTotal}
              </span>
            </>
          )}
          {(outcome || (tableLook && typeof checkSuccess === 'boolean')) && (
            <span
              data-testid="engine-roll-seal"
              className={`ir-wax-seal ir-wax-seal--${sealTone} ${critical ? '[body.ir-table-look_&]:shadow-[0_0_24px_rgba(246,227,184,0.75)]' : ''} ml-auto px-3 py-2 font-bold`}
              style={tableLook ? { background: sealBackground } : undefined}
            >
              {label}
            </span>
          )}
        </div>
      </div>
    );
  },
);
