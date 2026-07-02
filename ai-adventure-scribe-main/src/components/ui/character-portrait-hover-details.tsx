import { motion } from 'framer-motion';
import * as React from 'react';

import { Z_INDEX } from '@/constants/z-index';

interface CharacterPortraitHoverDetailsProps {
  name: string;
  race?: string;
  characterClass?: string;
  level?: number;
}

export function CharacterPortraitHoverDetails({
  name,
  race,
  characterClass,
  level,
}: CharacterPortraitHoverDetailsProps): React.ReactElement | null {
  if (!race && !characterClass) {
    return null;
  }

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 p-2 text-white"
      style={{ zIndex: Z_INDEX.CARD_HOVER }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="text-center">
        <div className="font-semibold text-sm">{name}</div>
        {level && <div className="text-xs text-muted-foreground">Level {level}</div>}
        {race && characterClass && (
          <div className="text-xs text-muted-foreground">
            {race} {characterClass}
          </div>
        )}
      </div>
    </motion.div>
  );
}
