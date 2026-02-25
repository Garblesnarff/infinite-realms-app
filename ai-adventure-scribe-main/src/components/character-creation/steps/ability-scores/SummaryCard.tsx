import React from 'react';

import type { AbilityScores } from '@/types/character';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ABILITIES } from '@/hooks/use-ability-score-selection';

interface SummaryCardProps {
  method: string;
  totalModifier: number;
  remainingPoints: number;
  abilityScores: AbilityScores;
}

const SummaryCard: React.FC<SummaryCardProps> = ({
  method,
  totalModifier,
  remainingPoints,
  abilityScores,
}) => {
  const totalScore = ABILITIES.reduce(
    (total, ability) => total + (abilityScores[ability]?.score || 8),
    0,
  );

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Ability Score Summary</h3>
          <p className="text-sm text-muted-foreground">
            Total modifier bonus: {totalModifier >= 0 ? '+' : ''}
            {totalModifier}
          </p>
        </div>
        <div className="flex gap-4">
          {method === 'pointBuy' && (
            <Badge variant={remainingPoints === 0 ? 'default' : 'secondary'}>
              {remainingPoints} points left
            </Badge>
          )}
          <Badge variant="outline">{totalScore} total</Badge>
        </div>
      </div>
    </Card>
  );
};

export default SummaryCard;
