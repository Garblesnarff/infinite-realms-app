import { useState, useCallback, useEffect } from 'react';

import type { AutoRollResult } from '@/services/combat/npc-auto-roller';

/**
 * Queue system for displaying multiple NPC rolls sequentially
 * Extracted from NPCRollDisplay.tsx
 */
export const useNPCRollQueue = (): {
  currentRoll: AutoRollResult | null;
  addRolls: (rolls: AutoRollResult[]) => void;
  dismissCurrent: () => void;
  queueLength: number;
} => {
  const [queue, setQueue] = useState<AutoRollResult[]>([]);
  const [currentRoll, setCurrentRoll] = useState<AutoRollResult | null>(null);

  // ⚡ Bolt: Stabilize callback identities to prevent unnecessary re-renders of consuming components.
  const addRolls = useCallback((rolls: AutoRollResult[]) => {
    setQueue((prev) => [...prev, ...rolls]);
  }, []);

  const dismissCurrent = useCallback(() => {
    setCurrentRoll(null);
  }, []);

  useEffect(() => {
    if (!currentRoll && queue.length > 0) {
      const [next, ...rest] = queue;
      setCurrentRoll(next);
      setQueue(rest);
    }
  }, [currentRoll, queue]);

  return {
    currentRoll,
    addRolls,
    dismissCurrent,
    queueLength: queue.length,
  };
};
