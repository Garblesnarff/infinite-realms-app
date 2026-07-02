import { Dice1 } from 'lucide-react';
import React from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface HitPointsRollingCardProps {
  level: number;
  hitDie: number;
  conModifier: number;
  rollResults: number[];
  isRolling: boolean;
  hasRolls: boolean;
  onRoll: () => void;
  onReroll: () => void;
}

export const HitPointsRollingCard: React.FC<HitPointsRollingCardProps> = ({
  level,
  hitDie,
  conModifier,
  rollResults,
  isRolling,
  hasRolls,
  onRoll,
  onReroll,
}) => (
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        <Dice1 className="w-5 h-5" />
        Roll Hit Dice
      </CardTitle>
      <p className="text-sm text-muted-foreground">Roll a d{hitDie} for each level beyond 1st</p>
    </CardHeader>
    <CardContent>
      <div className="space-y-4">
        {/* Roll Results */}
        <div className="grid grid-cols-5 gap-2">
          {Array.from({ length: level - 1 }, (_, i) => {
            const roll = rollResults[i];
            const isRolled = roll !== undefined;
            const isCurrentlyRolling = isRolling && i === rollResults.length;

            return (
              <div
                key={i}
                className={`p-3 border rounded text-center ${
                  isRolled
                    ? 'border-primary bg-primary/10'
                    : isCurrentlyRolling
                      ? 'border-amber-500 bg-amber-50 animate-pulse'
                      : 'border-muted'
                }`}
              >
                <div className="text-xs text-muted-foreground">Level {i + 2}</div>
                <div className="text-lg font-semibold">
                  {isCurrentlyRolling ? '🎲' : isRolled ? roll : '?'}
                </div>
                {isRolled && (
                  <div className="text-xs text-muted-foreground">+{conModifier} Con</div>
                )}
              </div>
            );
          })}
        </div>

        {/* Roll Button */}
        <div className="flex justify-center">
          <Button onClick={onRoll} disabled={isRolling || hasRolls} size="lg">
            {isRolling ? (
              <>Rolling... 🎲</>
            ) : hasRolls ? (
              'Rolls Complete'
            ) : (
              `Roll ${level - 1} Hit Dice`
            )}
          </Button>
        </div>

        {/* Reroll Option */}
        {hasRolls && !isRolling && (
          <div className="flex justify-center">
            <Button variant="outline" onClick={onReroll}>
              Reroll All Dice
            </Button>
          </div>
        )}
      </div>
    </CardContent>
  </Card>
);
