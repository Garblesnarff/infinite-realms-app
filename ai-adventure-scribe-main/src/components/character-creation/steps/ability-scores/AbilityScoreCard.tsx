import { Minus, Plus } from 'lucide-react';
import React from 'react';

import type { Method } from '@/hooks/use-ability-score-selection';
import type { AbilityScores } from '@/types/character';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { formatRacialBonus } from '@/utils/racialAbilityBonuses';

interface AbilityScoreCardProps {
  ability: keyof AbilityScores;
  baseScore: number;
  racialBonus: number;
  finalScore: number;
  modifier: number;
  description: string;
  method: Method;
  remainingPoints: number;
  nextCost: number;
  onIncrease: (ability: keyof AbilityScores) => void;
  onDecrease: (ability: keyof AbilityScores) => void;
}

/**
 * Component for displaying and managing an individual ability score
 * Extracted from AbilityScoresSelection.tsx
 */
const AbilityScoreCard: React.FC<AbilityScoreCardProps> = ({
  ability,
  baseScore,
  racialBonus,
  finalScore,
  modifier,
  description,
  method,
  remainingPoints,
  nextCost,
  onIncrease,
  onDecrease,
}) => {
  return (
    <Card className="p-4 hover:shadow-md transition-shadow">
      <div className="space-y-3">
        <div className="text-center">
          <h3 className="text-lg font-bold capitalize">{ability}</h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>

        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => onDecrease(ability)}
            disabled={method !== 'pointBuy' || baseScore === 8}
            className="h-8 w-8"
            aria-label={`Decrease ${ability}`}
            title={`Decrease ${ability}`}
          >
            <Minus className="h-4 w-4" aria-hidden="true" />
          </Button>

          <div className="text-center space-y-1">
            <div className="text-xs text-muted-foreground">Base: {baseScore}</div>
            {racialBonus > 0 && (
              <Badge
                variant="outline"
                className="bg-green-50 text-green-700 border-green-300"
                title="Racial ability score bonus"
                aria-label={`+${racialBonus} racial bonus to ${ability}`}
              >
                {formatRacialBonus(racialBonus)} racial
              </Badge>
            )}
            <div
              className="text-3xl font-bold"
              aria-label={`Final ${ability} score: ${finalScore}`}
            >
              {finalScore}
            </div>
            <div
              className={`text-sm font-medium ${
                modifier > 0
                  ? 'text-green-600'
                  : modifier < 0
                    ? 'text-red-600'
                    : 'text-muted-foreground'
              }`}
              aria-label={`${ability} modifier: ${modifier >= 0 ? '+' : ''}${modifier}`}
            >
              {modifier >= 0 ? '+' : ''}
              {modifier}
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => onIncrease(ability)}
            disabled={method !== 'pointBuy' || baseScore === 15 || remainingPoints < nextCost}
            className="h-8 w-8"
            aria-label={`Increase ${ability}`}
            title={`Increase ${ability}`}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>

        {method === 'pointBuy' && baseScore < 15 && (
          <div className="text-center">
            <Badge variant="outline" className="text-xs">
              Next: {nextCost} point{nextCost !== 1 ? 's' : ''}
            </Badge>
          </div>
        )}
      </div>
    </Card>
  );
};

export default AbilityScoreCard;
