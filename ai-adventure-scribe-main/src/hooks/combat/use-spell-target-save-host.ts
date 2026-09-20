import { useEffect, useState } from 'react';

import type {
  SpellTargetSaveHost,
  SpellTargetSaveSpec,
} from '@/services/combat/spell-target-save-bridge';

import {
  setSpellTargetSaveHost,
  settlePendingSpellTargetSave,
} from '@/services/combat/spell-target-save-bridge';

export interface PendingSpellTargetSave {
  spec: SpellTargetSaveSpec;
  continue: () => void;
}

/** Connects the save-spell card to the React surface in the message list. */
export function useSpellTargetSaveHost(): PendingSpellTargetSave | null {
  const [pendingSpec, setPendingSpec] = useState<SpellTargetSaveSpec | null>(null);

  useEffect(() => {
    const saveHost: SpellTargetSaveHost = {
      present: (spec, _settle) => {
        setPendingSpec(spec);
        return () => {
          setPendingSpec((current) => (current === spec ? null : current));
        };
      },
    };
    setSpellTargetSaveHost(saveHost);
    return () => {
      settlePendingSpellTargetSave();
      setSpellTargetSaveHost(null);
    };
  }, []);

  if (!pendingSpec) return null;
  return {
    spec: pendingSpec,
    continue: () => settlePendingSpellTargetSave(),
  };
}
