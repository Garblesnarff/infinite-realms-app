/**
 * Dice Roll Request Component
 * Displays when the DM requests a dice roll from the player
 */

import { Info } from 'lucide-react';
import React from 'react';

import { DEFAULT_TYPE_CONFIG, ROLL_TYPE_CONFIG } from './dice-roll-type-config';
import { DiceRollActionButtons } from './DiceRollActionButtons';
import { DiceRollManualEntrySection } from './DiceRollManualEntrySection';
import { DiceRollModifierControls } from './DiceRollModifierControls';

import type { RollRequest } from '@/types/roll-request';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { DiceRollEmbed } from '@/features/game-session/components';
import { useDiceRollRequest } from '@/hooks/game/use-dice-roll-request';
import { cn } from '@/lib/utils';

export type { RollRequest } from '@/types/roll-request';

interface DiceRollRequestProps {
  request: RollRequest;
  onRoll: (formula: string, advantage?: boolean, disadvantage?: boolean) => void;
  onManualResult: (result: number) => void;
  onRollCommit?: () => void;
  onCancel?: () => void;
  className?: string;
}

/**
 * Interactive Dice Roll Request Component
 * Shows when DM requests a roll, allows player to roll or input manually
 */
export const DiceRollRequest: React.FC<DiceRollRequestProps> = React.memo(
  ({ request, onRoll: _onRoll, onManualResult, onRollCommit, onCancel, className }) => {
    const {
      manualMode,
      manualResult,
      setManualResult,
      hasAdvantage,
      hasDisadvantage,
      showDiceAnimation,
      isRolling,
      character,
      rollCalculation,
      resolvedFormula,
      effectiveManualMode,
      handleAutoRoll,
      handleDiceRollComplete,
      handleManualSubmit,
      handleEnterManually,
      handleBackToRoll,
      toggleAdvantage,
      toggleDisadvantage,
    } = useDiceRollRequest({ request, onManualResult, onRollCommit });

    const config = ROLL_TYPE_CONFIG[request.type] || DEFAULT_TYPE_CONFIG;

    return (
      <Card className={cn('w-full max-w-md mx-auto border-2 shadow-lg', config.color, className)}>
        <div className="p-4">
          {/* Header */}
          <div className="flex items-center gap-3 mb-4">
            <div className="flex items-center gap-2">
              {config.icon}
              <span className="font-semibold text-slate-700">{config.label} Requested</span>
            </div>
          </div>

          {/* Purpose */}
          <div className="mb-4">
            <p className="text-sm text-slate-600 leading-relaxed">
              <strong>Purpose:</strong> {request.purpose}
            </p>
          </div>

          {/* Roll Details */}
          <div className="bg-white rounded-lg p-3 mb-4 border">
            <div className="flex items-center justify-between mb-2">
              <div className="text-lg font-mono font-bold text-slate-800">
                {rollCalculation.formula}
              </div>
              {(request.dc || request.ac) && (
                <Badge variant="outline" className="text-sm">
                  {request.dc ? `DC ${request.dc}` : `AC ${request.ac}`}
                </Badge>
              )}
            </div>

            {/* Modifier Breakdown */}
            {rollCalculation.breakdown.length > 1 && (
              <div className="flex items-center gap-2 text-sm text-slate-600 mb-2">
                <Info className="w-3 h-3" />
                <span>{rollCalculation.breakdown.join(' + ')}</span>
                {rollCalculation.isProficient && (
                  <Badge variant="secondary" className="text-xs px-1 py-0">
                    Proficient
                  </Badge>
                )}
              </div>
            )}

            {/* Advantage/Disadvantage Controls */}
            {request.type !== 'damage' && (
              <DiceRollModifierControls
                hasAdvantage={hasAdvantage}
                hasDisadvantage={hasDisadvantage}
                onToggleAdvantage={toggleAdvantage}
                onToggleDisadvantage={toggleDisadvantage}
              />
            )}
          </div>

          {/* Roll Actions */}
          {!effectiveManualMode ? (
            <div className="space-y-3">
              {/* Character not yet loaded — formula cannot be resolved */}
              {!character && resolvedFormula === null ? (
                <div className="flex items-center justify-center gap-2 py-3 text-sm text-slate-500">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-slate-400" />
                  Loading character data…
                </div>
              ) : showDiceAnimation && resolvedFormula ? (
                // Show animated dice rolling
                <div className="bg-slate-50 rounded-lg p-4 border-2 border-dashed border-slate-200">
                  <DiceRollEmbed
                    expression={resolvedFormula}
                    purpose={request.purpose}
                    onRoll={handleDiceRollComplete}
                    autoRoll={true}
                    showAnimation={true}
                    advantage={hasAdvantage && !hasDisadvantage}
                    disadvantage={hasDisadvantage && !hasAdvantage}
                  />
                </div>
              ) : (
                // Show roll dice button (resolvedFormula is always non-null here)
                <DiceRollActionButtons
                  formula={rollCalculation.formula}
                  purpose={request.purpose}
                  isRolling={isRolling}
                  onAutoRoll={handleAutoRoll}
                  onEnterManually={handleEnterManually}
                  onCancel={onCancel}
                />
              )}
            </div>
          ) : (
            <DiceRollManualEntrySection
              manualMode={manualMode}
              manualResult={manualResult}
              resolvedFormula={resolvedFormula}
              onManualResultChange={setManualResult}
              onSubmit={handleManualSubmit}
              onBackToRoll={handleBackToRoll}
              onCancel={onCancel}
            />
          )}

          {/* Hint Text */}
          <p className="text-xs text-slate-500 mt-3 text-center">
            {effectiveManualMode
              ? 'Enter the total result of your dice roll'
              : "Click 'Roll Dice' to automatically roll, or 'Enter Manually' if you prefer to roll physical dice"}
          </p>
        </div>
      </Card>
    );
  },
);
