/**
 * NPC Roll Display - "Behind the DM Screen"
 * A dramatic, mysterious popup showing auto-executed NPC dice rolls
 * Design: Dark fantasy aesthetic with aged parchment and arcane elements
 */

import { motion, AnimatePresence } from 'framer-motion';
import React from 'react';

import type { AutoRollResult } from '@/services/combat/npc-auto-roller';

import { NPCRollCard } from '@/components/game/NPCRollCard';
import { Z_INDEX } from '@/constants/z-index';
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
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 flex items-center justify-center p-4"
          style={{ zIndex: Z_INDEX.MODAL }}
          onClick={onDismiss}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-label="Behind the DM Screen popup"
        >
          {/* Backdrop with mystical atmosphere */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            style={{
              backgroundImage: `
              radial-gradient(ellipse at top, rgba(88, 28, 135, 0.15) 0%, transparent 50%),
              radial-gradient(ellipse at bottom, rgba(30, 27, 75, 0.15) 0%, transparent 50%)
            `,
            }}
          />

          {/* Main NPC Roll Card component */}
          <NPCRollCard
            roll={roll}
            onDismiss={onDismiss}
            autoDismissDelay={autoDismissDelay}
          />
        </motion.div>
      </AnimatePresence>
    );
  },
);

NPCRollDisplay.displayName = 'NPCRollDisplay';
