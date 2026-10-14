import { AlertTriangle, Info } from 'lucide-react';
import React from 'react';

import type { Character } from '@/types/character';
import type { RacialBonus } from '@/utils/racialAbilityBonuses';

import { Alert, AlertDescription } from '@/components/ui/alert';

interface ValidationAlertsProps {
  pointBuyValid: boolean;
  pointBuyScoreRangeValid: boolean;
  pointsUsed: number;
  standardArrayValid: boolean;
  racialBonuses: RacialBonus[];
  character: Character | null;
}

const ValidationAlerts: React.FC<ValidationAlertsProps> = ({
  pointBuyValid,
  pointBuyScoreRangeValid,
  pointsUsed,
  standardArrayValid,
  racialBonuses,
  character,
}) => {
  return (
    <div className="space-y-4">
      {!pointBuyValid && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {!pointBuyScoreRangeValid
              ? 'Point Buy scores must be between 8 and 15 before racial bonuses.'
              : `Point Buy allows 27 points maximum; you have used ${pointsUsed}.`}
          </AlertDescription>
        </Alert>
      )}

      {!standardArrayValid && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Standard Array must use exactly: 15, 14, 13, 12, 10, 8 (each value once).
          </AlertDescription>
        </Alert>
      )}

      {racialBonuses.length > 0 && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Your {character?.race?.name} grants racial ability bonuses that will be added to your
            base scores.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
};

export default ValidationAlerts;
