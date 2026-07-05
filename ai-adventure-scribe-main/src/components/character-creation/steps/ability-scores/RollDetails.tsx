import { RotateCcw } from 'lucide-react';
import React from 'react';

import type { AbilityScores } from '@/types/character';
import type { AbilityScoreRollResult } from '@/utils/diceRolls';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface RollDetailsProps {
  currentRollDetails: AbilityScoreRollResult;
  abilities: (keyof AbilityScores)[];
  onRerollSingle: (index: number) => void;
}

/**
 * Component for displaying detailed 4d6 drop lowest roll results
 * Extracted from AbilityScoresSelection.tsx
 */
const RollDetails: React.FC<RollDetailsProps> = ({
  currentRollDetails,
  abilities,
  onRerollSingle,
}) => {
  return (
    <TooltipProvider>
      <div className="mt-4 pt-4 border-t">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium">Current Roll Details:</p>
          <Badge variant="outline" className="text-xs">
            {currentRollDetails.timestamp.toLocaleTimeString()}
          </Badge>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-3">
          {abilities.map((ability, index) => {
            const detail = currentRollDetails.details[index];
            const firstDroppedIndex = detail.rolls.indexOf(detail.dropped);

            return (
              <div key={ability} className="text-xs p-2 bg-muted/50 rounded border">
                <div className="font-medium capitalize mb-1">{ability}</div>
                <div className="flex items-center gap-1 mb-1">
                  <span className="text-muted-foreground">Rolls:</span>
                  <div className="flex gap-0.5">
                    {detail.rolls.map((roll, i) => {
                      const isDropped = i === firstDroppedIndex;
                      return (
                        <Tooltip key={i} delayDuration={300}>
                          <TooltipTrigger asChild>
                            <Badge
                              variant={isDropped ? 'destructive' : 'secondary'}
                              className="text-xs px-1 py-0 min-w-[1.5rem] h-5 cursor-help outline-none focus-visible:ring-2 focus-visible:ring-infinite-purple"
                              aria-label={`Rolled ${roll}${isDropped ? ', dropped' : ''}`}
                              tabIndex={0}
                            >
                              {roll}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{isDropped ? `Dropped lowest roll: ${roll}` : `Kept roll: ${roll}`}</p>
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Total:</span>
                  <Badge variant="outline">{detail.total}</Badge>
                </div>
                <Tooltip delayDuration={300}>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      onClick={() => onRerollSingle(index)}
                      variant="ghost"
                      size="sm"
                      className="w-full mt-1 h-6 text-xs gap-1"
                      aria-label={`Reroll ${ability}`}
                    >
                      <RotateCcw className="h-3 w-3" aria-hidden="true" />
                      Reroll
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Reroll {ability}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
};

export default RollDetails;
