/**
 * Dice3DSection — renders the 3D dice roll for a DiceRollEmbed.
 *
 * Thin wrapper around PhysicsDiceBox (real cannon-es physics, engine-authoritative
 * results, settles naturally with no snap/pull). PhysicsDiceBox owns a single,
 * short-lived WebGL canvas and disposes it on unmount, so the previous elaborate
 * context-loss recovery code is no longer needed.
 *
 * Set VITE_DISABLE_DICE_3D=true to fall back to the (text) result display.
 */
import { AnimatePresence, motion } from 'framer-motion';
import React from 'react';

import type { DiceRollResult } from '@/services/dice/DiceEngine';
import { cardItem } from '@/utils/animations';

import { PhysicsDiceBox } from './physics/PhysicsDiceBox';

interface Dice3DSectionProps {
  result: DiceRollResult | null;
  isRolling: boolean;
  hasRolled: boolean;
  showAnimation: boolean;
}

export const Dice3DSection: React.FC<Dice3DSectionProps> = ({
  result,
  isRolling,
  hasRolled,
  showAnimation,
}) => {
  const env = import.meta.env as Record<string, string | undefined>;
  const disabled = (env.VITE_DISABLE_DICE_3D ?? 'false').toLowerCase() === 'true';

  if (!showAnimation || !hasRolled) return null;

  if (disabled) {
    return (
      <div className="h-24 mb-3 rounded-lg overflow-hidden border border-[rgba(213,176,112,0.25)] flex items-center justify-center text-xs text-gray-400 bg-black/20">
        3D dice disabled. Showing results without animation.
      </div>
    );
  }

  return (
    <AnimatePresence>
      <motion.div
        variants={cardItem}
        initial="hidden"
        animate="visible"
        exit="hidden"
        className="mb-3 rounded-lg overflow-hidden border border-[rgba(213,176,112,0.25)]"
      >
        <PhysicsDiceBox
          result={result}
          isRolling={isRolling}
          showAnimation={showAnimation}
          height={150}
        />
      </motion.div>
    </AnimatePresence>
  );
};

export default Dice3DSection;
