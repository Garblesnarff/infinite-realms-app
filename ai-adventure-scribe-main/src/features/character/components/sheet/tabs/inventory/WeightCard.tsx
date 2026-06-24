import { Weight } from 'lucide-react';
import React from 'react';

import type { Currency } from './CurrencyCard';
import type { Character } from '@/types/character';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

interface WeightCardProps {
  character: Character;
  currency: Currency;
}

/**
 * Displays carrying capacity and weight status
 */
export const WeightCard: React.FC<WeightCardProps> = ({ character, currency }) => {
  // Calculate carrying capacity
  const strengthScore = character.abilityScores?.strength?.score || 10;
  const carryingCapacity = strengthScore * 15; // Standard 5e rule
  const encumbered = strengthScore * 5;
  const heavilyEncumbered = strengthScore * 10;

  // Calculate current weight (simplified - would need actual item weights)
  const currentWeight =
    character.inventory?.reduce((total, item) => total + (item.quantity || 1), 0) || 0;

  // Calculate total currency weight (50 coins = 1 lb)
  const totalCoins = currency.cp + currency.sp + currency.ep + currency.gp + currency.pp;
  const currencyWeight = Math.floor(totalCoins / 50);
  const totalWeight = currentWeight + currencyWeight;

  // Determine encumbrance status
  const getEncumbranceStatus = () => {
    if (totalWeight >= carryingCapacity) return 'overloaded';
    if (totalWeight >= heavilyEncumbered) return 'heavily-encumbered';
    if (totalWeight >= encumbered) return 'encumbered';
    return 'normal';
  };

  const encumbranceStatus = getEncumbranceStatus();

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
              {totalWeight} lbs
            </span>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Encumbered: {encumbered}</span>
              <span>Heavy: {heavilyEncumbered}</span>
              <span>Max: {carryingCapacity}</span>
            </div>
            <Progress
              value={(totalWeight / carryingCapacity) * 100}
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
            <Badge variant="outline" className="capitalize">
              {encumbranceStatus.replace('-', ' ')}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
