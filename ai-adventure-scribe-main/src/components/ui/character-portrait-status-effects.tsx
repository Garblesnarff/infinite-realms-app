import * as React from 'react';

import { Badge } from './badge';

import { Z_INDEX } from '@/constants/z-index';

interface CharacterPortraitStatusEffectsProps {
  status: string[];
}

export function CharacterPortraitStatusEffects({
  status,
}: CharacterPortraitStatusEffectsProps): React.ReactElement | null {
  if (status.length === 0) {
    return null;
  }

  return (
    <div
      className="absolute top-1 right-1 flex flex-col gap-1"
      style={{ zIndex: Z_INDEX.OVERLAY_EFFECT }}
    >
      {status.slice(0, 3).map((effect, index) => (
        <Badge
          key={index}
          variant="warning"
          className="text-[0.625rem] px-1 py-0"
          aria-label={`Status: ${effect}`}
        >
          {effect}
        </Badge>
      ))}
    </div>
  );
}
