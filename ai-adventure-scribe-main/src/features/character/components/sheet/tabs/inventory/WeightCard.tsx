import { Weight } from 'lucide-react';
import React from 'react';

import type { Currency } from './CurrencyCard';
import type { Character } from '@/types/character';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { calculateEncumbrance } from '@/utils/character-calculations';

interface WeightCardProps {
  character: Character;
  currency: Currency;
}

/**
 * Displays carrying capacity and weight status
 */
export const WeightCard: React.FC<WeightCardProps> = ({ character, currency }) => {
  const encumbrance = calculateEncumbrance(character, currency);
  const encumbranceStatus = encumbrance.encumbranceLevel;

  const getEncumbranceColor = (status: string) => {
    switch (status) {
      case 'overloaded':
        return 'text-red-600';
      case 'heavily-encumbered':
        return 'text-orange-600';
      case 'encumbered':
        return 'text-yellow-600';
      default:
        return 'text-green-600';
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Weight className="w-5 h-5 text-blue-500" />
          Carrying Capacity
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm">Current Weight</span>
            <span className={`font-bold ${getEncumbranceColor(encumbranceStatus)}`}>
              {encumbrance.totalWeight} lbs
            </span>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Encumbered: {encumbrance.encumberedThreshold}</span>
              <span>Heavy: {encumbrance.heavilyEncumberedThreshold}</span>
              <span>Max: {encumbrance.carryingCapacity}</span>
            </div>
            <Progress
              value={(encumbrance.totalWeight / encumbrance.carryingCapacity) * 100}
              className="h-2"
              indicatorClassName={
                encumbranceStatus === 'overloaded'
                  ? 'bg-red-500'
                  : encumbranceStatus === 'heavily-encumbered'
                    ? 'bg-orange-500'
                    : encumbranceStatus === 'encumbered'
                      ? 'bg-yellow-500'
                      : 'bg-green-500'
              }
              aria-label="Carrying capacity"
            />
          </div>

          {encumbranceStatus !== 'normal' && (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="capitalize">
                {encumbranceStatus.replace('-', ' ')}
              </Badge>
              <span className="text-xs text-muted-foreground">
                Speed {encumbrance.baseSpeed} ft → {encumbrance.effectiveSpeed} ft
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
