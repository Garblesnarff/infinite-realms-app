/**
 * Dice Roll Message Component
 * Displays dice roll results in chat with visual flair
 */

import { Dice6, ArrowUp, ArrowDown } from 'lucide-react';
import React from 'react';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { formatRollBreakdown } from '@/features/game-session/components/dice/format-roll-breakdown';
import { cn } from '@/lib/utils';

interface DiceRollData {
  formula: string;
  count: number;
  dieType: number;
  modifier: number;
  advantage: boolean;
  disadvantage: boolean;
  results?: number[];
  keptResults?: number[];
  total: number;
  naturalRoll?: number;
  critical?: boolean;
  label?: string;
  timestamp: string;
}

interface DiceRollMessageProps {
  data: DiceRollData;
  playerName?: string;
  className?: string;
}

/**
 * ⚡ Bolt: Static helper function extracted outside the component to avoid
 * re-allocation on every render.
 */
const getResultColor = (
  critical: boolean | undefined,
  naturalRoll: number | undefined,
  dieType: number,
): string => {
  if (critical && naturalRoll === 20) return 'text-green-600 font-bold';
  if (critical === false && naturalRoll === 1) return 'text-red-600 font-bold';
  if (dieType === 20 && naturalRoll) {
    if (naturalRoll >= 15) return 'text-green-500';
    if (naturalRoll <= 5) return 'text-orange-500';
  }
  return 'text-blue-600';
};

/**
 * ⚡ Bolt: Standalone memoized component for individual rolls breakdown
 * to prevent redundant re-renders and logic execution within the main component.
 */
const IndividualRolls = React.memo(
  ({
    advantage,
    disadvantage,
    results,
    keptResults,
    count,
  }: {
    advantage: boolean;
    disadvantage: boolean;
    results: number[];
    keptResults?: number[];
    count: number;
  }) => {
    if (advantage || disadvantage) {
      // #2586: a roll result can arrive without a results array (the D6
      // disadvantage check carried disadvantage: true and no results), so
      // neither the slice nor the spread below may assume it.
      const faces = Array.isArray(results) ? results : [];
      const kept = keptResults || faces.slice(0, 1);
      // One instance per kept value, so a tie (12 and 12) still shows its dropped die.
      const dropped = [...faces];
      for (const value of kept) {
        const index = dropped.indexOf(value);
        if (index !== -1) dropped.splice(index, 1);
      }

      return (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-green-600 font-medium">Kept: [{kept.join(', ')}]</span>
            {dropped.length > 0 && (
              <span className="text-xs text-red-400 line-through">
                Dropped: [{dropped.join(', ')}]
              </span>
            )}
          </div>
        </div>
      );
    } else if (count > 1) {
      return (
        <div className="text-xs text-muted-foreground">
          Individual rolls: [{results.join(', ')}]
        </div>
      );
    }

    return null;
  },
);

IndividualRolls.displayName = 'IndividualRolls';

/** Faces for the shared breakdown: one instance per kept value stays in the total. */
const breakdownFaces = (
  naturalRoll: number,
  edge: boolean,
  results: number[] | undefined,
  keptResults: number[] | undefined,
) => {
  if (!edge || !Array.isArray(results) || results.length < 2) return [{ value: naturalRoll }];
  const pool = [...(keptResults ?? results.slice(0, 1))];
  return results.map((value) => {
    const index = pool.indexOf(value);
    if (index === -1) return { value, useInTotal: false };
    pool.splice(index, 1);
    return { value };
  });
};

/**
 * Dice Roll Message Component for Chat
 * Displays dice roll results with visual styling similar to CombatMessage
 */
export const DiceRollMessage: React.FC<DiceRollMessageProps> = React.memo(
  ({ data, playerName, className }) => {
    const {
      formula,
      count,
      dieType,
      advantage,
      disadvantage,
      results,
      keptResults,
      total,
      naturalRoll,
      critical,
      label,
    } = data;
    const safeResults = Array.isArray(results) ? results : [naturalRoll ?? total];

    // Same labelled line the roll dialog shows, so both read "Natural 16 + Modifier +6 = Total 22".
    // The modifier is what the total holds beyond the counted dice, not `data.modifier`: that is
    // the request's config, which is 0 for a save with a symbolic formula, while the total
    // already carries the character's bonus.
    let breakdown: string | null = null;
    if (typeof naturalRoll === 'number') {
      const faces = breakdownFaces(naturalRoll, advantage || disadvantage, results, keptResults);
      const counted = faces.reduce(
        (sum, face) => (face.useInTotal === false ? sum : sum + face.value),
        0,
      );
      breakdown = formatRollBreakdown({
        rolls: faces,
        modifiers: total - counted,
        total,
        naturalRoll,
        advantage,
        disadvantage,
      });
    }

    return (
      <Card
        className={cn('w-full max-w-sm bg-slate-50 border-slate-200', className)}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <div className="p-4">
          {/* Header */}
          <div className="flex items-center gap-2 mb-3">
            <Dice6 className="w-4 h-4 text-slate-600" aria-hidden="true" />
            <span className="text-sm font-medium text-slate-700">
              {playerName ? `${playerName} rolled` : 'Dice Roll'}
              {label && `: ${label}`}
            </span>
          </div>

          {/* Advantage/Disadvantage Badges */}
          {(advantage || disadvantage) && (
            <div className="flex gap-2 mb-3" aria-label="Roll modifiers">
              {advantage && (
                <Badge
                  variant="secondary"
                  className="text-xs bg-green-100 text-green-800"
                  aria-label="Advantage"
                >
                  <ArrowUp className="w-2 h-2 mr-1" aria-hidden="true" />
                  Advantage
                </Badge>
              )}
              {disadvantage && (
                <Badge
                  variant="secondary"
                  className="text-xs bg-red-100 text-red-800"
                  aria-label="Disadvantage"
                >
                  <ArrowDown className="w-2 h-2 mr-1" aria-hidden="true" />
                  Disadvantage
                </Badge>
              )}
            </div>
          )}

          {/* Formula Display */}
          <div className="flex items-center justify-center gap-2 mb-3">
            <div className="text-center" aria-label={`Formula: ${formula}`}>
              <div className="text-lg font-mono font-medium text-slate-700" aria-hidden="true">
                {formula}
              </div>
              <div className="text-xs text-muted-foreground" aria-hidden="true">
                Formula
              </div>
            </div>

            <div className="text-xl text-slate-400" aria-hidden="true">
              =
            </div>

            <div className="text-center" aria-label={`Total result: ${total}`}>
              <div
                className={cn('text-2xl font-bold', getResultColor(critical, naturalRoll, dieType))}
                aria-hidden="true"
              >
                {total}
              </div>
              <div className="text-xs text-muted-foreground" aria-hidden="true">
                Total
              </div>
            </div>
          </div>

          {breakdown && (
            <div
              className="mb-3 text-center text-xs text-muted-foreground"
              data-testid="roll-breakdown"
            >
              {breakdown}
            </div>
          )}

          {/* Individual Roll Results */}
          <div aria-label="Individual roll breakdown">
            <IndividualRolls
              advantage={advantage}
              disadvantage={disadvantage}
              results={safeResults}
              keptResults={keptResults}
              count={count}
            />
          </div>

          {/* Critical Hit/Miss Indicator */}
          {critical !== undefined && naturalRoll && (
            <div className="mt-3 text-center">
              {critical ? (
                <Badge variant="default" className="bg-green-600 text-white">
                  Critical Success! (Natural {naturalRoll})
                </Badge>
              ) : (
                <Badge variant="destructive">Critical Failure! (Natural {naturalRoll})</Badge>
              )}
            </div>
          )}

          {/* Special d20 callouts */}
          {dieType === 20 && naturalRoll && !critical && (
            <div className="mt-2 text-center">
              {naturalRoll === 20 && (
                <Badge variant="outline" className="text-green-600 border-green-600">
                  Natural 20!
                </Badge>
              )}
              {naturalRoll === 1 && (
                <Badge variant="outline" className="text-red-600 border-red-600">
                  Natural 1...
                </Badge>
              )}
            </div>
          )}
        </div>
      </Card>
    );
  },
);
