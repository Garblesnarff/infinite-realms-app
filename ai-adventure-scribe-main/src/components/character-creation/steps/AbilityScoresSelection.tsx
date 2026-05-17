import { RotateCcw, Shuffle } from 'lucide-react';
import React from 'react';

import AbilityScoreCard from './ability-scores/AbilityScoreCard';
import RollDetails from './ability-scores/RollDetails';
import SummaryCard from './ability-scores/SummaryCard';
import ValidationAlerts from './ability-scores/ValidationAlerts';

import type { AbilityScoreName } from '@/utils/racialAbilityBonuses';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import DiceRoller from '@/components/ui/dice-roller';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useAbilityScoreSelection,
  ABILITIES,
  POINT_COST,
  type Method,
} from '@/hooks/use-ability-score-selection';
import { calculateModifier } from '@/utils/abilityScoreUtils';
import { getTotalRacialBonus } from '@/utils/racialAbilityBonuses';

/**
 * Component for handling ability score selection in character creation
 * Implements point-buy system, standard array, and 4d6 drop lowest rolling
 */
const AbilityScoresSelection: React.FC = () => {
  const {
    state,
    method,
    setMethod,
    rollHistory,
    currentRollDetails,
    remainingPoints,
    handleIncreaseScore,
    handleDecreaseScore,
    handleRollScores,
    handleRerollSingleScore,
    handleStandardArray,
    handleReset,
    getAbilityDescription,
    racialBonuses,
    getFinalScore,
    pointsUsed,
    pointBuyValid,
    standardArrayValid,
    totalModifier,
  } = useAbilityScoreSelection();

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-3xl font-bold mb-2">Assign Ability Scores</h2>
        <p className="text-muted-foreground">Choose your method for generating ability scores</p>
      </div>

      <Tabs
        defaultValue="pointBuy"
        className="w-full"
        onValueChange={(value) => setMethod(value as Method)}
      >
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="pointBuy">Point Buy</TabsTrigger>
          <TabsTrigger value="standardArray">Standard Array</TabsTrigger>
          <TabsTrigger value="roll">Roll Scores</TabsTrigger>
        </TabsList>

        <TabsContent value="pointBuy" className="space-y-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-2">Point Buy System</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Distribute 27 points among your abilities. Scores range from 8-15, with higher scores
              costing more points.
            </p>
            <div className="flex items-center justify-between">
              <div className="text-lg">
                Points Remaining: <Badge variant="outline">{remainingPoints}</Badge>
              </div>
              <Button
                type="button"
                onClick={handleReset}
                variant="ghost"
                size="sm"
                title="Reset ability scores"
              >
                <RotateCcw className="w-4 h-4 mr-1" aria-hidden="true" />
                Reset
              </Button>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="standardArray" className="space-y-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-2">Standard Array</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Use the standard D&D ability scores: 15, 14, 13, 12, 10, 8. Balanced and predictable.
            </p>
            <div className="flex items-center justify-between">
              <div className="flex gap-1">
                {[15, 14, 13, 12, 10, 8].map((score, i) => (
                  <Badge key={i} variant="secondary">
                    {score}
                  </Badge>
                ))}
              </div>
              <Button
                type="button"
                onClick={handleStandardArray}
                variant="default"
                title="Apply the standard array of scores (15, 14, 13, 12, 10, 8)"
              >
                Apply Standard Array
              </Button>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="roll" className="space-y-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-2">Roll 4d6 Drop Lowest</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Roll four six-sided dice, drop the lowest, for each ability.
            </p>
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={handleRollScores}
                  variant="default"
                  title="Roll new scores for all abilities"
                >
                  <Shuffle className="w-4 h-4 mr-1" aria-hidden="true" />
                  Roll New Scores
                </Button>
                <DiceRoller dice="4d6" label="Example Roll" />
              </div>
              <Button
                type="button"
                onClick={handleReset}
                variant="ghost"
                size="sm"
                title="Reset ability scores"
              >
                <RotateCcw className="w-4 h-4 mr-1" aria-hidden="true" />
                Reset
              </Button>
            </div>

            {currentRollDetails && (
              <RollDetails
                currentRollDetails={currentRollDetails}
                abilities={ABILITIES}
                onRerollSingle={handleRerollSingleScore}
              />
            )}

            {rollHistory.length > 0 && (
              <div className="mt-3 pt-3 border-t">
                <p className="text-sm font-medium mb-2">Recent Rolls:</p>
                <div className="space-y-1">
                  {rollHistory.slice(-3).map((roll, i) => (
                    <div key={i} className="text-xs text-muted-foreground">
                      Roll {rollHistory.length - 2 + i}: {roll.join(', ')}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      <ValidationAlerts
        pointBuyValid={pointBuyValid}
        pointsUsed={pointsUsed}
        standardArrayValid={standardArrayValid}
        racialBonuses={racialBonuses}
        character={state.character}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {ABILITIES.map((ability) => {
          const baseScore = state.character?.abilityScores?.[ability]?.score || 8;
          const racialBonus = getTotalRacialBonus(ability as AbilityScoreName, racialBonuses);
          const finalScore = getFinalScore(ability);
          const modifier = calculateModifier(finalScore);
          const nextCost =
            method === 'pointBuy' ? POINT_COST[baseScore + 1] - POINT_COST[baseScore] : 0;

          return (
            <AbilityScoreCard
              key={ability}
              ability={ability}
              baseScore={baseScore}
              racialBonus={racialBonus}
              finalScore={finalScore}
              modifier={modifier}
              description={getAbilityDescription(ability)}
              method={method}
              remainingPoints={remainingPoints}
              nextCost={nextCost}
              onIncrease={handleIncreaseScore}
              onDecrease={handleDecreaseScore}
            />
          );
        })}
      </div>

      <SummaryCard
        method={method}
        totalModifier={totalModifier}
        remainingPoints={remainingPoints}
        abilityScores={state.character?.abilityScores || {}}
      />
    </div>
  );
};

export default AbilityScoresSelection;
