import { Heart, Shield, Zap } from 'lucide-react';
import * as React from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

import { Z_INDEX } from '@/constants/z-index';
import { cn } from '@/lib/utils';

interface CharacterPortraitStatsOverlayProps {
  hp?: number;
  maxHp?: number;
  ac?: number;
  initiative?: number;
}

export function CharacterPortraitStatsOverlay({
  hp,
  maxHp,
  ac,
  initiative,
}: CharacterPortraitStatsOverlayProps): React.ReactElement | null {
  if (hp === undefined && ac === undefined && initiative === undefined) {
    return null;
  }

  const hpPercentage = hp && maxHp ? (hp / maxHp) * 100 : 100;
  const hpColor =
    hpPercentage <= 25 ? 'text-red-500' : hpPercentage <= 50 ? 'text-yellow-500' : 'text-green-500';

  return (
    <div
      className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-1.5 backdrop-blur-sm"
      style={{ zIndex: Z_INDEX.OVERLAY_EFFECT }}
    >
      <div className="flex items-center justify-around gap-1 text-white text-[0.625rem]">
        {hp !== undefined && maxHp !== undefined && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                className="flex items-center gap-0.5 cursor-help focus-visible:ring-2 focus-visible:ring-red-400 outline-none rounded-sm px-0.5"
                aria-label={`HP: ${hp}/${maxHp}`}
                tabIndex={0}
              >
                <Heart className={cn('h-3 w-3', hpColor)} fill="currentColor" aria-hidden="true" />
                <span className="font-semibold tabular-nums">
                  {hp}/{maxHp}
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>
                HP: {hp}/{maxHp}
              </p>
            </TooltipContent>
          </Tooltip>
        )}
        {ac !== undefined && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                className="flex items-center gap-0.5 cursor-help focus-visible:ring-2 focus-visible:ring-blue-400 outline-none rounded-sm px-0.5"
                aria-label={`Armor Class: ${ac}`}
                tabIndex={0}
              >
                <Shield className="h-3 w-3 text-blue-400" aria-hidden="true" />
                <span className="font-semibold tabular-nums">{ac}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>Armor Class: {ac}</p>
            </TooltipContent>
          </Tooltip>
        )}
        {initiative !== undefined && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                className="flex items-center gap-0.5 cursor-help focus-visible:ring-2 focus-visible:ring-yellow-400 outline-none rounded-sm px-0.5"
                aria-label={`Initiative: +${initiative}`}
                tabIndex={0}
              >
                <Zap className="h-3 w-3 text-yellow-400" aria-hidden="true" />
                <span className="font-semibold tabular-nums">+{initiative}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>Initiative: +{initiative}</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
