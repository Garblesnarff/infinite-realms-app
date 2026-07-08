/**
 * NPC Roll Display - "Behind the DM Screen"
 * A dramatic, mysterious popup showing auto-executed NPC dice rolls
 * Design: Dark fantasy aesthetic with aged parchment and arcane elements
 */

import React from 'react';

import type { AutoRollResult } from '@/services/combat/npc-auto-roller';

import { NPCRollCard } from '@/components/game/NPCRollCard';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useNPCRollQueue } from '@/hooks/game/use-npc-roll-queue';

export { useNPCRollQueue };

interface NPCRollDisplayProps {
  roll: AutoRollResult;
  onDismiss: () => void;
  autoDismissDelay?: number; // milliseconds, default 3000
}

export const NPCRollDisplay: React.FC<NPCRollDisplayProps> = React.memo(
  ({ roll, onDismiss, autoDismissDelay = 3000 }) => {
    return (
      <Dialog open onOpenChange={(open) => !open && onDismiss()}>
        <DialogContent
          className="w-[calc(100%-2rem)] max-w-md border-0 bg-transparent p-0 shadow-none"
          aria-describedby="npc-roll-description"
        >
          <DialogTitle className="sr-only">Behind the DM Screen</DialogTitle>
          <DialogDescription id="npc-roll-description" className="sr-only" aria-live="polite">
            The Dungeon Master is resolving an NPC dice roll.
          </DialogDescription>
          <NPCRollCard roll={roll} onDismiss={onDismiss} autoDismissDelay={autoDismissDelay} />
        </DialogContent>
      </Dialog>
    );
  },
);

NPCRollDisplay.displayName = 'NPCRollDisplay';
