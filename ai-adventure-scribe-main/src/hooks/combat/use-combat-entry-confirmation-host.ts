import { useEffect, useState } from 'react';

import type {
  CombatEntryConfirmationSpec,
  CombatEntryConfirmationHost,
} from '@/services/combat/combat-entry-confirmation-bridge';

import {
  clearCombatEntryConfirmationHost,
  setCombatEntryConfirmationHost,
  settlePendingCombatEntryConfirmation,
} from '@/services/combat/combat-entry-confirmation-bridge';

export interface PendingCombatEntryConfirmation {
  spec: CombatEntryConfirmationSpec;
  confirm: (target?: string) => void;
  decline: () => void;
}

/** Connects the async entry gate to the React confirmation surface. */
export function useCombatEntryConfirmationHost(
  ownerKey?: string,
): PendingCombatEntryConfirmation | null {
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
    setCombatEntryConfirmationHost(entryHost, ownerKey);

    return () => {
      // React can tear down and immediately remount this owner during a StrictMode pass or a
      // list refresh. Wait for the replacement host before treating the unmount as a real route
      // change/session leave; the bridge reattaches same-session pending UI to that replacement.
      queueMicrotask(() => {
        const stillOwnsHost = clearCombatEntryConfirmationHost(entryHost);
        if (stillOwnsHost) settlePendingCombatEntryConfirmation(false);
      });
    };
  }, [ownerKey]);

  if (!pendingSpec) return null;
  return {
    spec: pendingSpec,
    confirm: (target) => settlePendingCombatEntryConfirmation(true, target),
    decline: () => settlePendingCombatEntryConfirmation(false),
  };
}
