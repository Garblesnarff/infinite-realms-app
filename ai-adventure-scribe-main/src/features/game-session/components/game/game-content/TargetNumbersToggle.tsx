import React from 'react';

import { useShowTargetNumbers } from '../../../hooks/use-show-target-numbers';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * The player's "Show target numbers" setting (#2417). On, an engine result card shows the target's
 * AC and a save's DC; off, it leaves both clauses out entirely. Easy and Medium start on,
 * Hard starts off.
 */
export const TargetNumbersToggle: React.FC = () => {
  const { showTargetNumbers, setShowTargetNumbers } = useShowTargetNumbers();
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ir-hit"
            aria-pressed={showTargetNumbers}
            onClick={() => setShowTargetNumbers(!showTargetNumbers)}
          >
            Show target numbers: {showTargetNumbers ? 'On' : 'Off'}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-xs">
          Controls whether engine cards show target Armor Class (AC) and save Difficulty Class (DC)
          numbers. Visible by default on Easy and Medium campaigns, and hidden on Hard and Deadly
          campaigns. Your choice here overrides campaign difficulty defaults.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
