import React from 'react';

import type { AbilityScores } from '@/types/character';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface FeatSelectionAbilityScoreCardProps {
  abilityScores: AbilityScores | undefined;
  abilityIncreases: Record<string, number>;
  onIncrease: (ability: string, change: number) => void;
}

export const FeatSelectionAbilityScoreCard: React.FC<FeatSelectionAbilityScoreCardProps> = ({
  abilityScores,
  abilityIncreases,
  onIncrease,
}) => {
  const totalIncreases = Object.values(abilityIncreases).reduce((sum, val) => sum + val, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ability Score Improvement</CardTitle>
        <p className="text-sm text-muted-foreground">
          Distribute 2 points among your ability scores. You can increase two different scores by 1
          each, or one score by 2.
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          {Object.entries(abilityScores || {}).map(([ability, score]) => {
            const increase = abilityIncreases[ability] || 0;
            const newScore = score.score + increase;

            return (
              <div key={ability} className="flex items-center justify-between p-3 border rounded">
                <div>
                  <div className="font-medium capitalize">{ability}</div>
                  <div className="text-sm text-muted-foreground">
                    {score.score} → {newScore} ({newScore >= 10 ? '+' : ''}
                    {Math.floor((newScore - 10) / 2)})
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onIncrease(ability, -1)}
                    disabled={increase === 0}
                  >
                    -
                  </Button>
                  <span className="w-8 text-center">{increase}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onIncrease(ability, 1)}
                    disabled={increase === 2 || newScore >= 20 || totalIncreases >= 2}
                  >
                    +
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 text-center">
          <p className="text-sm text-muted-foreground">Points remaining: {2 - totalIncreases}</p>
        </div>
      </CardContent>
    </Card>
  );
};
