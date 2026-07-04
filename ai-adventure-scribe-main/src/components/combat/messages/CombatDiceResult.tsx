import React from 'react';

import { Badge } from '@/components/ui/badge';
import { HexagonalBadge } from '@/components/ui/hexagonal-badge';
import { type CombatMessageData } from '@/utils/combat/ai-narration-utils';
import { type DiceRoll } from '@/utils/diceUtils';

interface CombatDiceResultProps {
  data: CombatMessageData;
}

/**
 * CombatDiceResult - Handles the rendering of dice rolls and success/failure indicators
 * Extracted from CombatMessage.tsx
 */
export const CombatDiceResult: React.FC<CombatDiceResultProps> = ({ data }) => {
  const formatDiceResult = (roll: DiceRoll): React.ReactElement => {
    const { dieType, count, results, modifier, total } = roll;

    // Handle advantage/disadvantage display
    if (roll.advantage || roll.disadvantage) {
      const keptResults = roll.keptResults || results;
      const droppedResults = results.filter((r) => !keptResults.includes(r));

      return (
        <div className="flex flex-col gap-1">
          <div className="text-sm">
            <span className="font-medium">
              {count}d{dieType}
            </span>
            {modifier !== 0 && (
              <span>
                {' '}
                {modifier >= 0 ? '+' : ''}
                {modifier}
              </span>
            )}
            <span className="ml-2 text-xs text-muted-foreground">
              ({roll.advantage ? 'Advantage' : 'Disadvantage'})
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-green-600 font-medium">
              Kept: [{keptResults.join(', ')}]
            </span>
            {droppedResults.length > 0 && (
              <span className="text-xs text-red-400 line-through">
                Dropped: [{droppedResults.join(', ')}]
              </span>
            )}
          </div>
          <div className="font-bold text-lg">Total: {total}</div>
        </div>
      );
    }

    // Normal roll display
    return (
      <div className="flex flex-col gap-1">
        <div className="text-sm">
          <span className="font-medium">
            {count}d{dieType}
          </span>
          {modifier !== 0 && (
            <span>
              {' '}
              {modifier >= 0 ? '+' : ''}
              {modifier}
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          [{results.join(', ')}] {modifier !== 0 && `${modifier >= 0 ? '+' : ''}${modifier}`}
        </div>
        <div className="font-bold text-lg">Total: {total}</div>
      </div>
    );
  };

  const getResultText = (): React.ReactNode => {
    if (data.type === 'damage_roll') {
      return `${data.roll.total} damage`;
    }

    // Use HexagonalBadge with electricCyan for concentration saves
    if (data.type === 'concentration_save') {
      if (data.dc !== undefined) {
        const success = data.roll.total >= data.dc;
        return (
          <div className="flex items-center gap-2">
            <HexagonalBadge
              variant={success ? 'status' : 'destructive'}
              size="sm"
              pulse={success}
              className={
                success
                  ? 'text-xs bg-electricCyan/20 text-electricCyan border-electricCyan/40 shadow-[0_0_8px_rgba(6,182,212,0.4)] font-semibold'
                  : 'text-xs'
              }
            >
              {success ? 'Maintained' : 'Lost'}
            </HexagonalBadge>
          </div>
        );
      }

      if (data.success !== undefined) {
        return (
          <HexagonalBadge
            variant={data.success ? 'status' : 'destructive'}
            size="sm"
            pulse={data.success}
            className={
              data.success
                ? 'text-xs bg-electricCyan/20 text-electricCyan border-electricCyan/40 shadow-[0_0_8px_rgba(6,182,212,0.4)] font-semibold'
                : 'text-xs'
            }
          >
            {data.success ? 'Maintained' : 'Lost'}
          </HexagonalBadge>
        );
      }
    }

    if (data.dc !== undefined) {
      const success = data.roll.total >= data.dc;
      return (
        <div className="flex items-center gap-2">
          <Badge variant={success ? 'default' : 'destructive'} className="text-xs">
            {success ? 'Success' : 'Failure'}
          </Badge>
        </div>
      );
    }

    if (data.critical) {
      return (
        <Badge variant="destructive" className="text-xs animate-pulse">
          Critical {data.type === 'attack_roll' ? 'Hit' : 'Success'}!
        </Badge>
      );
    }

    if (data.success !== undefined) {
      return (
        <Badge variant={data.success ? 'default' : 'destructive'} className="text-xs">
          {data.success ? 'Success' : 'Failure'}
        </Badge>
      );
    }

    return null;
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>{formatDiceResult(data.roll)}</div>
      <div className="flex items-center">{getResultText()}</div>
    </div>
  );
};
