import { useEffect, useState } from 'react';

import type {
  LethalActionConfirmationHost,
  LethalActionConfirmationSpec,
} from '@/services/combat/lethal-action-confirmation-bridge';

import {
  cancelPendingLethalActionConfirmation,
  setLethalActionConfirmationHost,
  settlePendingLethalActionConfirmation,
} from '@/services/combat/lethal-action-confirmation-bridge';

export interface PendingLethalActionConfirmation {
  spec: LethalActionConfirmationSpec;
  confirm: () => void;
  cancel: () => void;
}

export function useLethalActionConfirmationHost(): PendingLethalActionConfirmation | null {
  const [pendingSpec, setPendingSpec] = useState<LethalActionConfirmationSpec | null>(null);

  useEffect(() => {
    const mounted: LethalActionConfirmationHost = {
      present: (spec) => {
        setPendingSpec(spec);
        return () => {
          setPendingSpec((current) => (current === spec ? null : current));
        };
      },
    };
    setLethalActionConfirmationHost(mounted);
    return () => {
      settlePendingLethalActionConfirmation(false);
      setLethalActionConfirmationHost(null);
    };
  }, []);

  if (!pendingSpec) return null;
  return {
    spec: pendingSpec,
    confirm: () => settlePendingLethalActionConfirmation(true),
    cancel: () => cancelPendingLethalActionConfirmation(),
  };
}
