import { useEffect, useState } from 'react';

import type {
  CombatEntryConfirmationSpec,
  CombatEntryConfirmationHost,
} from '@/services/combat/combat-entry-confirmation-bridge';

import {
  setCombatEntryConfirmationHost,
  settlePendingCombatEntryConfirmation,
} from '@/services/combat/combat-entry-confirmation-bridge';

export interface PendingCombatEntryConfirmation {
  spec: CombatEntryConfirmationSpec;
  confirm: () => void;
  decline: () => void;
}

/** Connects the async entry gate to the React confirmation surface. */
export function useCombatEntryConfirmationHost(): PendingCombatEntryConfirmation | null {
  const [pendingSpec, setPendingSpec] = useState<CombatEntryConfirmationSpec | null>(null);

  useEffect(() => {
    const entryHost: CombatEntryConfirmationHost = {
      present: (spec, _settle) => {
        setPendingSpec(spec);
        return () => {
          setPendingSpec((current) => (current === spec ? null : current));
        };
      },
    };
    setCombatEntryConfirmationHost(entryHost);

    return () => {
      // Closing the game surface is an explicit decline. This also settles the awaiting
      // dm-actions handler, so an unmounted tab cannot leave entry suspended forever.
      settlePendingCombatEntryConfirmation(false);
      setCombatEntryConfirmationHost(null);
    };
  }, []);

  if (!pendingSpec) return null;
  return {
    spec: pendingSpec,
    confirm: () => settlePendingCombatEntryConfirmation(true),
    decline: () => settlePendingCombatEntryConfirmation(false),
  };
}
