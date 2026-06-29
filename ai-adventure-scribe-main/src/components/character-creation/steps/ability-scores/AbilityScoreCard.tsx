import { Minus, Plus } from 'lucide-react';
import React from 'react';

import type { Method } from '@/hooks/use-ability-score-selection';
import type { AbilityScores } from '@/types/character';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
  const getDecreaseTooltip = (): string => {
    if (method !== 'pointBuy') return 'Change method to Point Buy to adjust';
    if (baseScore === 8) return 'Minimum score (8) reached';
    return `Decrease ${ability}`;
  };

  const getIncreaseTooltip = (): string => {
    if (method !== 'pointBuy') return 'Change method to Point Buy to adjust';
    if (baseScore === 15) return 'Maximum score (15) reached';
    if (remainingPoints < nextCost) return 'Insufficient points remaining';
    return `Increase ${ability}`;
  };

  const isDecreaseDisabled = method !== 'pointBuy' || baseScore === 8;
  const isIncreaseDisabled = method !== 'pointBuy' || baseScore === 15 || remainingPoints < nextCost;

  return (
    <Card className="p-4 hover:shadow-md transition-shadow">
      <div className="space-y-3">
        <div className="text-center">
          <h3 className="text-lg font-bold capitalize">{ability}</h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>

        <div className="flex items-center justify-between">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={isDecreaseDisabled ? 'cursor-not-allowed' : ''}>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => onDecrease(ability)}
                  disabled={isDecreaseDisabled}
                  className="h-8 w-8"
                  aria-label={`Decrease ${ability}`}
                >
                  <Minus className="h-4 w-4" aria-hidden="true" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>{getDecreaseTooltip()}</p>
            </TooltipContent>
          </Tooltip>

          <div className="text-center space-y-1">
            <div className="text-xs text-muted-foreground">Base: {baseScore}</div>
            {racialBonus > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className="bg-green-50 text-green-700 border-green-300 focus-visible:ring-2 focus-visible:ring-infinite-purple outline-none cursor-help"
                    aria-label={`+${racialBonus} racial bonus to ${ability}`}
                    tabIndex={0}
                  >
                    {formatRacialBonus(racialBonus)} racial
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Racial ability score bonus</p>
                </TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className="text-3xl font-bold focus-visible:ring-2 focus-visible:ring-infinite-purple outline-none rounded-sm cursor-help"
                  aria-label={`Final ${ability} score: ${finalScore}`}
                  tabIndex={0}
                >
                  {finalScore}
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  Final {ability} score (Base + Bonuses)
                </p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={`text-sm font-medium focus-visible:ring-2 focus-visible:ring-infinite-purple outline-none rounded-sm cursor-help ${
                    modifier > 0
                      ? 'text-green-600'
                      : modifier < 0
                        ? 'text-red-600'
                        : 'text-muted-foreground'
                  }`}
                  aria-label={`${ability} modifier: ${modifier >= 0 ? '+' : ''}${modifier}`}
                  tabIndex={0}
                >
                  {modifier >= 0 ? '+' : ''}
                  {modifier}
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  The modifier added to {ability} based checks, attacks, and saving throws
                </p>
              </TooltipContent>
            </Tooltip>
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <span className={isIncreaseDisabled ? 'cursor-not-allowed' : ''}>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => onIncrease(ability)}
                  disabled={isIncreaseDisabled}
                  className="h-8 w-8"
                  aria-label={`Increase ${ability}`}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>{getIncreaseTooltip()}</p>
            </TooltipContent>
          </Tooltip>
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
