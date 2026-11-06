/* eslint-disable max-lines */

/**
 * Dice Roll Request Component
 * Displays when the DM requests a dice roll from the player
 */

import { Info } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { DEFAULT_TYPE_CONFIG, ROLL_TYPE_CONFIG } from './dice-roll-type-config';
import { DiceRollActionButtons } from './DiceRollActionButtons';
import { DiceRollManualEntrySection } from './DiceRollManualEntrySection';
import { DiceRollModifierControls } from './DiceRollModifierControls';
import { targetAcLabel } from '../../../shared/describe-attack-roll';

import type { RollRequest } from '@/types/roll-request';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DiceRollEmbed } from '@/features/game-session/components';
import { useShowTargetNumbers } from '@/features/game-session/hooks/use-show-target-numbers';
import { useDiceRollRequest, type RollResultHandler } from '@/hooks/game/use-dice-roll-request';
import logger from '@/lib/logger';
import { cn } from '@/lib/utils';

export type { RollRequest } from '@/types/roll-request';

/** Ticket #84 eyebrow copy by roll type; every other roll is the player's own. */
const ROLL_TRAY_EYEBROW: Record<string, string> = {
  initiative: 'Initiative',
  death_save: 'Death saving throw',
};

/** The tray's ribbon for a natural 20 or 1 (design: Critical board). The flavour line is for attacks only. */
const NATURAL_RIBBON: Record<
  20 | 1,
  { big: string; small: string; bg: string; ink: string; tail: string }
> = {
  20: {
    big: 'NATURAL 20',
    small: 'the table erupts',
    bg: 'linear-gradient(180deg, #c2323a, #8b1a20)',
    ink: '#ffe9d6',
    tail: '#7a1016',
  },
  1: {
    big: 'NATURAL 1',
    small: 'the blade goes wide',
    bg: 'linear-gradient(180deg, #2a2f3d, #11141c)',
    ink: '#ef6b6b',
    tail: '#0b0d13',
  },
};

/** A natural 20 fills the tray with gold light. */
const GOLD_LIGHT_STYLE: React.CSSProperties = {
  backgroundImage:
    'radial-gradient(ellipse at 50% 0%, rgba(243,222,176,.38), rgba(243,222,176,.1) 60%, transparent 85%)',
  boxShadow: '0 0 60px rgba(243,222,176,.35)',
};

interface DiceRollRequestProps {
  request: RollRequest;
  /**
   * Receives every result the popup produces — the animated roll's total with its natural face,
   * or a hand-entered number with no details.
   */
  onResult: RollResultHandler;
  onRollCommit?: () => void;
  onCancel?: () => void;
  onRetry?: () => Promise<void>;
  isRetrying?: boolean;
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
    onRetry,
    isRetrying = false,
    requestId,
    pendingRollId,
    rollError,
    className,
  }) => {
    const promptRef = useRef<HTMLDivElement>(null);
    // The kept d20 face of the roll the player just made, for the tray's natural 20 / 1 treatment.
    const [trayNatural, setTrayNatural] = useState<number | null>(null);
    const recordResult = useCallback<RollResultHandler>(
      (total, details) => {
        setTrayNatural(details?.naturalRoll ?? null);
        return details === undefined ? onResult(total) : onResult(total, details);
      },
      [onResult],
    );
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
    } = useDiceRollRequest({ request, onResult: recordResult, onRollCommit });
    const { showTargetNumbers, setShowTargetNumbers } = useShowTargetNumbers();

    const config = ROLL_TYPE_CONFIG[request.type] || DEFAULT_TYPE_CONFIG;
    const isRollPending = Boolean(requestId && pendingRollId === requestId);
    const isRollInFlight = isRolling || isSubmitting || isRollPending;
    const natural = trayNatural === 20 || trayNatural === 1 ? trayNatural : null;

    useEffect(() => {
      setTrayNatural(null);
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
        data-natural={natural ?? undefined}
        style={natural === 20 ? GOLD_LIGHT_STYLE : undefined}
        className={cn(
          'ir-parchment w-full rounded-none border-0 border-t border-infinite-gold/50 bg-infinite-dark/95 text-foreground shadow-none outline-none',
          natural === 20 && 'shadow-[0_0_60px_rgba(243,222,176,.35)]',
          className,
        )}
      >
        {natural !== null && (
          // The ribbon repeats the engine-facing "Natural 20/1" badge the embed already announces, so it is hidden from assistive technology.
          <div
            aria-hidden="true"
            data-testid="roll-tray-ribbon"
            className="flex items-center justify-center gap-3 px-4 py-2 font-display text-sm font-bold tracking-[.14em]"
            style={{
              background: NATURAL_RIBBON[natural].bg,
              color: NATURAL_RIBBON[natural].ink,
              boxShadow: `inset 0 1px 0 rgba(255,255,255,.3), 0 6px 14px rgba(0,0,0,.45)`,
              borderBottom: `3px solid ${NATURAL_RIBBON[natural].tail}`,
            }}
          >
            <span>{NATURAL_RIBBON[natural].big}</span>
            {request.type === 'attack' && (
              <span className="font-sans text-sm font-normal italic tracking-normal opacity-90">
                {NATURAL_RIBBON[natural].small}
              </span>
            )}
          </div>
        )}
        <div className="mx-auto max-w-3xl space-y-2 px-3 py-2.5 sm:px-4 sm:py-3">
          {/* Header */}
          <div className="flex items-center gap-2 text-infinite-gold [body.ir-table-look_&]:!text-[#2a1a0c]">
            {config.icon}
            <span className="ir-text-min font-semibold uppercase tracking-[.12em]">
              {ROLL_TRAY_EYEBROW[request.type] ?? 'Your roll'}
            </span>
          </div>

          {/* Roll details: purpose, formula, breakdown, advantage */}
          <div data-testid="roll-details" className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <p className="min-w-0 flex-1 text-sm font-semibold leading-snug text-foreground [body.ir-table-look_&]:!text-[#2a1a0c]">
                {request.type === 'initiative' ? 'Roll initiative' : request.purpose}
              </p>
              <span className="font-mono text-lg font-bold tabular-nums text-foreground [body.ir-table-look_&]:!text-[#2a1a0c]">
                {rollCalculation.formula}
              </span>
              {showTargetNumbers && (request.dc || request.ac) && (
                <Badge
                  variant="outline"
                  className="text-xs text-muted-foreground [body.ir-table-look_&]:!text-[#2a1a0c]"
                >
                  {request.dc
                    ? `DC ${request.dc}`
                    : targetAcLabel(request.ac ?? 0, request.coverBonus)}
                </Badge>
              )}
            </div>

            {(request.dc != null || request.ac != null) && (
              <div className="flex flex-wrap items-center gap-2 text-sm [body.ir-table-look_&]:!text-[#2a1a0c]">
                {!showTargetNumbers && (
                  <span>
                    {request.dc != null
                      ? 'DC hidden · the DM knows the number'
                      : 'AC hidden · the DM knows the number'}
                  </span>
                )}
                <button
                  type="button"
                  role="switch"
                  aria-checked={showTargetNumbers}
                  className="min-h-11 min-w-11 rounded border px-3"
                  onClick={() => setShowTargetNumbers(!showTargetNumbers)}
                >
                  Show target numbers: {showTargetNumbers ? 'On' : 'Off'}
                </button>
                {request.type !== 'damage' && request.type !== 'damage_taken' && (
                  <span
                    className="text-sm [body.ir-table-look_&]:!text-[#2a1a0c]"
                    aria-disabled="true"
                  >
                    Inspiration: coming soon
                  </span>
                )}
              </div>
            )}
            {request.dc == null &&
              request.ac == null &&
              request.type !== 'damage' &&
              request.type !== 'damage_taken' && (
                <p className="text-sm [body.ir-table-look_&]:!text-[#2a1a0c]" aria-disabled="true">
                  Inspiration: coming soon
                </p>
              )}

            {/* Modifier Breakdown */}
            {rollCalculation.breakdown.length > 1 && (
              <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground [body.ir-table-look_&]:!text-[#2a1a0c]">
                <Info className="h-3 w-3" aria-hidden="true" />
                {rollCalculation.breakdown.map((part, index) => (
                  <span
                    key={`${part}-${index}`}
                    className="rounded border border-current px-2 py-1"
                  >
                    {index > 0 ? '+ ' : ''}
                    {part}
                  </span>
                ))}
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
          {rollError && onRetry ? (
            <Button onClick={() => void onRetry()} disabled={isRetrying}>
              {isRetrying ? 'Retrying…' : 'Retry'}
            </Button>
          ) : !effectiveManualMode ? (
            <div className="space-y-2">
              {rollCalculation.modifierUnknown ? (
                <div className="space-y-2">
                  <p
                    role="status"
                    className="py-2 text-center text-sm text-muted-foreground [body.ir-table-look_&]:!text-[#2a1a0c]"
                  >
                    modifier unknown
                  </p>
                  {onCancel && (
                    <div className="flex justify-center">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={onCancel}
                        className="min-h-11 text-sm text-foreground/80 hover:bg-white/10 hover:text-foreground"
                        aria-label="Dismiss roll request"
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>
              ) : !character && resolvedFormula === null ? (
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
                        isAttack={request.type === 'attack'}
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
            <p
              role="alert"
              className="text-center text-sm font-medium text-red-300 [body.ir-table-look_&]:!text-[#7a1016]"
            >
              {rollError}
            </p>
          )}

          {/* Hint Text: the buttons say it at phone width, where every line costs story. */}
          {!rollCalculation.modifierUnknown && (
            <p className="hidden text-center text-xs text-muted-foreground sm:block [body.ir-table-look_&]:!text-[#2a1a0c]">
              {effectiveManualMode
                ? 'Enter the total result of your dice roll'
                : "Roll here, or 'Enter my own roll' if you roll physical dice"}
            </p>
          )}
        </div>
      </Card>
    );
  },
);
