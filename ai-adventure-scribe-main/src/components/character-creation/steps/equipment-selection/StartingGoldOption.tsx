import { Coins, Dice1 } from 'lucide-react';
import React from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface StartingGoldOptionProps {
  goldData: {
    dice: string;
    multiplier: number;
    average: number;
  } | undefined;
  hasRolledGold: boolean;
  rolledGold: number;
  onRollGold: () => void;
  onResetRoll: () => void;
}

/**
 * Extracted from StartingEquipmentSelection.tsx
 * Renders the starting gold rolling interface.
 */
export const StartingGoldOption: React.FC<StartingGoldOptionProps> = ({
  goldData,
  hasRolledGold,
  rolledGold,
  onRollGold,
  onResetRoll,
}) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Coins className="w-5 h-5 text-yellow-500" aria-hidden="true" />
          Starting Gold
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-center space-y-4">
          <div className="p-6 border-2 border-dashed rounded-lg">
            <Dice1 className="w-12 h-12 mx-auto mb-4 text-muted-foreground" aria-hidden="true" />
            <div className="text-lg font-medium mb-2">
              Roll {goldData?.dice} × {goldData?.multiplier}
            </div>
            <div className="text-sm text-muted-foreground mb-4">
              Average: {goldData?.average} gp
            </div>

            {hasRolledGold ? (
              <div className="space-y-2">
                <div className="text-3xl font-bold text-yellow-600">{rolledGold} gp</div>
                <Button variant="outline" onClick={onResetRoll}>
                  Roll Again
                </Button>
              </div>
            ) : (
              <Button onClick={onRollGold} size="lg">
                <Dice1 className="w-4 h-4 mr-2" aria-hidden="true" />
                Roll for Gold
              </Button>
            )}
          </div>

          <div className="text-sm text-muted-foreground">
            With starting gold, you'll need to purchase all equipment from the shop. This allows for
            complete customization but requires more planning.
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
