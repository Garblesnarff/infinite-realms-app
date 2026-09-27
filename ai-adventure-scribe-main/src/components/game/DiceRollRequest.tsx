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
import { useDiceRollRequest, type RollResultHandler } from '@/hooks/game/use-dice-roll-request';
import logger from '@/lib/logger';
import { cn } from '@/lib/utils';

export type { RollRequest } from '@/types/roll-request';

interface DiceRollRequestProps {
  request: RollRequest;
  /**
   * Receives every result the popup produces — the animated roll's total with its natural face,
   * or a hand-entered number with no details.
   */
  onResult: RollResultHandler;
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
    onResult,
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
      resetAfterFailedSubmit,
      toggleAdvantage,
      toggleDisadvantage,
    } = useDiceRollRequest({ request, onResult, onRollCommit });

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

    // A failed submission must leave the prompt usable (#2280).
    useEffect(() => {
      if (rollError) resetAfterFailedSubmit();
    }, [rollError, resetAfterFailedSubmit]);

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

    // Docked in the roll tray between the story and the chat box (#2252), so it is compact:
    // at 390 px the Roll button, the chat box and the newest story line all have to fit.
    return (
      <Card
        ref={promptRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="false"
        aria-label={`${request.purpose} roll request`}
        data-testid="dice-roll-request"
        className={cn(
          'w-full rounded-none border-0 border-t border-infinite-gold/50 bg-infinite-dark/95 text-foreground shadow-none outline-none',
          className,
        )}
      >
        <div className="mx-auto max-w-3xl space-y-2 px-3 py-2.5 sm:px-4 sm:py-3">
          {/* Header */}
          <div className="flex items-center gap-2 text-infinite-gold">
            {config.icon}
            <span className="text-[11px] font-semibold uppercase tracking-[.12em]">
              {config.label} Requested
            </span>
            <Badge variant="warning" className="ml-auto">
              Roll required
            </Badge>
          </div>

          {/* Roll details: purpose, formula, breakdown, advantage */}
          <div data-testid="roll-details" className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <p className="min-w-0 flex-1 text-sm font-semibold leading-snug text-foreground">
                {request.purpose}
              </p>
              <span className="font-mono text-lg font-bold tabular-nums text-foreground">
                {rollCalculation.formula}
              </span>
              {(request.dc || request.ac) && (
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  {request.dc ? `DC ${request.dc}` : `AC ${request.ac}`}
                </Badge>
              )}
            </div>

            {/* Modifier Breakdown */}
            {rollCalculation.breakdown.length > 1 && (
              <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
                <Info className="h-3 w-3" aria-hidden="true" />
                <span>{rollCalculation.breakdown.join(' + ')}</span>
                {rollCalculation.isProficient && (
                  <Badge variant="secondary" className="px-1 py-0 text-xs">
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
            <div className="space-y-2">
              {/* Character not yet loaded — formula cannot be resolved */}
              {!character && resolvedFormula === null ? (
                <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
                  <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-muted-foreground" />
                  Loading character data…
                </div>
              ) : (
                <>
                  {showDiceAnimation && resolvedFormula && (
                    <div className="rounded-lg border border-white/10 p-2">
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
                  )}
                  <DiceRollActionButtons
                    formula={rollCalculation.formula}
                    purpose={request.purpose}
                    isRolling={isRollInFlight}
                    onAutoRoll={handleRollClick}
                    onEnterManually={handleEnterManually}
                    onCancel={onCancel}
                  />
                </>
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
            <p role="alert" className="text-center text-sm font-medium text-red-300">
              {rollError}
            </p>
          )}

          {/* Hint Text: the buttons say it at phone width, where every line costs story. */}
          <p className="hidden text-center text-xs text-muted-foreground sm:block">
            {effectiveManualMode
              ? 'Enter the total result of your dice roll'
              : "Roll here, or 'Enter my own roll' if you roll physical dice"}
          </p>
        </div>
      </Card>
    );
  },
);
