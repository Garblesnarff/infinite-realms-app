/* eslint-disable max-lines */

/**
 * Dice Roll Request Component
 * Displays when the DM requests a dice roll from the player
 */

import { Info } from 'lucide-react';
import React, { useCallback, useEffect, useRef } from 'react';

import { DEFAULT_TYPE_CONFIG, ROLL_TYPE_CONFIG } from './dice-roll-type-config';
import { DiceRollActionButtons } from './DiceRollActionButtons';
import { DiceRollManualEntrySection } from './DiceRollManualEntrySection';
import { DiceRollModifierControls } from './DiceRollModifierControls';

import type { RollRequest } from '@/types/roll-request';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { DiceRollEmbed } from '@/features/game-session/components';
import { useDiceRollRequest } from '@/hooks/game/use-dice-roll-request';
import logger from '@/lib/logger';
import { cn } from '@/lib/utils';

export type { RollRequest } from '@/types/roll-request';

interface DiceRollRequestProps {
  request: RollRequest;
  onRoll: (formula: string, advantage?: boolean, disadvantage?: boolean) => void;
  onManualResult: (result: number) => void;
  onRollCommit?: () => void;
  onCancel?: () => void;
  requestId?: string;
  pendingRollId?: string | null;
  rollError?: string | null;
  className?: string;
}

/**
 * Interactive Dice Roll Request Component
 * Shows when DM requests a roll, allows player to roll or input manually
 */
export const DiceRollRequest: React.FC<DiceRollRequestProps> = React.memo(
  ({
    request,
    onRoll: _onRoll,
    onManualResult,
    onRollCommit,
    onCancel,
    requestId,
    pendingRollId,
    rollError,
    className,
  }) => {
    const promptRef = useRef<HTMLDivElement>(null);
    const {
      manualMode,
      manualResult,
      setManualResult,
      hasAdvantage,
      hasDisadvantage,
      showDiceAnimation,
      isRolling,
      isSubmitting,
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
    const isRollPending = Boolean(requestId && pendingRollId === requestId);
    const isRollInFlight = isRolling || isSubmitting || isRollPending;

    useEffect(() => {
      promptRef.current?.focus();
      logger.info('ROLL_PROMPT_SHOWN', {
        requestId: requestId ?? 'unknown',
        check: request.purpose,
      });
    }, [requestId, request.purpose]);

    const handleRollClick = useCallback(() => {
      if (isRollInFlight) return;
      logger.info('ROLL_SUBMITTED', { requestId: requestId ?? 'unknown' });
      handleAutoRoll();
    }, [handleAutoRoll, isRollInFlight, requestId]);

    const handleManualSubmitClick = useCallback(() => {
      if (isRollInFlight) return;
      logger.info('ROLL_SUBMITTED', { requestId: requestId ?? 'unknown' });
      handleManualSubmit();
    }, [handleManualSubmit, isRollInFlight, requestId]);

    return (
      <Card
        ref={promptRef}
        tabIndex={-1}
        role="dialog"
        aria-label={`${request.purpose} roll request`}
        data-testid="dice-roll-request"
        className={cn(
          'w-full max-w-md mx-auto border-2 shadow-lg ring-2 ring-orange-400/80 shadow-orange-300/30',
          'animate-pulse',
          config.color,
          className,
        )}
      >
        <div className="p-4">
          {/* Header */}
          <div className="flex items-center gap-3 mb-4">
            <div className="flex items-center gap-2">
              {config.icon}
              <span className="font-semibold text-slate-700">{config.label} Requested</span>
            </div>
            <Badge variant="warning" className="ml-auto animate-pulse">
              Roll required
            </Badge>
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
                <div className="space-y-3">
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
                  <DiceRollActionButtons
                    formula={rollCalculation.formula}
                    purpose={request.purpose}
                    isRolling={isRollInFlight}
                    onAutoRoll={handleRollClick}
                    onEnterManually={handleEnterManually}
                    onCancel={onCancel}
                  />
                </div>
              ) : (
                // Show roll dice button (resolvedFormula is always non-null here)
                <DiceRollActionButtons
                  formula={rollCalculation.formula}
                  purpose={request.purpose}
                  isRolling={isRollInFlight}
                  onAutoRoll={handleRollClick}
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
              onSubmit={handleManualSubmitClick}
              onBackToRoll={handleBackToRoll}
              onCancel={onCancel}
            />
          )}

          {rollError && (
            <p role="alert" className="mt-3 text-center text-sm font-medium text-red-700">
              {rollError}
            </p>
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
