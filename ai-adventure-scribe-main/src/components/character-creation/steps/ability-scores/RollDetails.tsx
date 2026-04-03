import { RotateCcw } from 'lucide-react';
import React from 'react';

import type { AbilityScores } from '@/types/character';
import type { AbilityScoreRollResult } from '@/utils/diceRolls';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

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
          return (
            <div key={ability} className="text-xs p-2 bg-muted/50 rounded border">
              <div className="font-medium capitalize mb-1">{ability}</div>
              <div className="flex items-center gap-1 mb-1">
                <span className="text-muted-foreground">Rolls:</span>
                <div className="flex gap-0.5">
                  {detail.rolls.map((roll, i) => (
                    <Badge
                      key={i}
                      variant={roll === detail.dropped ? 'destructive' : 'secondary'}
                      className="text-xs px-1 py-0 min-w-[1.5rem] h-5"
                    >
                      {roll}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Total:</span>
                <Badge variant="outline">{detail.total}</Badge>
              </div>
              <Button
                onClick={() => onRerollSingle(index)}
                variant="ghost"
                size="sm"
                className="w-full mt-1 h-6 text-xs gap-1"
                title={`Reroll ${ability}`}
              >
                <RotateCcw className="h-3 w-3" />
                Reroll
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default RollDetails;
