import { useState, useMemo, useCallback, useRef } from 'react';

import type { RollRequest } from '@/types/roll-request';

import { useCharacter } from '@/contexts/CharacterContext';
import { isNumericFormula, resolveDialogRollFormula } from '@/hooks/game/resolve-dialog-roll';
import logger from '@/lib/logger';

export { isNumericFormula };

/**
 * What the animated roll knows beyond its total. A hand-entered result has no details: the player
 * typed one number and the popup asks for it as the bare die.
 */
export interface RolledResultDetails {
  /** The kept d20 face, before modifiers. The engine settlers consume this, never the total. */
  naturalRoll: number;
  /** Every face shown by the animated roll, including a dropped advantage/disadvantage die. */
  results?: number[];
  /** Faces included in the total, used to label dropped dice in the saved message. */
  keptResults?: number[];
}

export type RollResultHandler = (
  result: number,
  details?: RolledResultDetails,
) => void | Promise<void>;

interface UseDiceRollRequestProps {
  request: RollRequest;
  onResult: RollResultHandler;
  onRollCommit?: () => void;
}

/**
 * useDiceRollRequest hook
 * Extracted from DiceRollRequest.tsx
 * Manages state and logic for dice roll requests
 */
export function useDiceRollRequest({ request, onResult, onRollCommit }: UseDiceRollRequestProps) {
  const [manualMode, setManualMode] = useState(false);
  const [manualResult, setManualResult] = useState('');
  const [hasAdvantage, setHasAdvantage] = useState(request.advantage || false);
  const [hasDisadvantage, setHasDisadvantage] = useState(request.disadvantage || false);
  const [showDiceAnimation, setShowDiceAnimation] = useState(false);
  const [isRolling, setIsRolling] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);

  const { state: characterState } = useCharacter();
  const character = characterState.character;

  // One resolver turns the DM request into the formula this dialog rolls.
  const rollCalculation = useMemo(
    () => resolveDialogRollFormula(request, character),
    [character, request],
  );

  // Derived: null when the formula is not safe to roll (symbolic, or the modifier is unknown).
  const resolvedFormula = useMemo(
    () =>
      rollCalculation.modifierUnknown || !isNumericFormula(rollCalculation.formula)
        ? null
        : rollCalculation.formula,
    [rollCalculation.formula, rollCalculation.modifierUnknown],
  );

  // Synchronous fallback: character loaded but formula still symbolic → show manual entry immediately.
  const effectiveManualMode =
    manualMode || (!!character && resolvedFormula === null && !rollCalculation.modifierUnknown);

  const handleAutoRoll = useCallback(() => {
    if (isRolling || isSubmittingRef.current) return;
    // Commit before starting the animation: the initiative bridge must stop its fallback timer
    // while the player's roll is visibly in flight.
    onRollCommit?.();
    // Show the animated dice rolling
    setShowDiceAnimation(true);
    setIsRolling(true);
  }, [isRolling, onRollCommit]);

  const submitResult = useCallback(
    async (totalResult: number, details?: RolledResultDetails) => {
      if (isSubmittingRef.current) return;
      isSubmittingRef.current = true;
      setIsSubmitting(true);
      try {
        await (details ? onResult(totalResult, details) : onResult(totalResult));
      } finally {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
      }
    },
    [onResult],
  );

  const handleDiceRollComplete = useCallback(
    async (result: number | unknown, _details?: unknown) => {
      // After animation completes, submit the result
      setIsRolling(false);

      // Extract the total from DiceRollResult object if needed
      let totalResult: number;
      let details: RolledResultDetails | undefined;
      if (typeof result === 'number') {
        totalResult = result;
      } else if (result && typeof result === 'object' && 'total' in result) {
        const rolled = result as {
          total: number;
          naturalRoll?: unknown;
          rolls?: Array<{ value: number; useInTotal?: boolean }>;
        };
        totalResult = rolled.total;
        // The total includes the formula's modifier. An engine prompt (attack, initiative) adds
        // its own bonus to the die it gets back, so it must receive the natural face, or a
        // natural 13 at +5 resolves as 18 + 5 (#2210).
        if (typeof rolled.naturalRoll === 'number') {
          const results = rolled.rolls?.map((face) => face.value);
          const keptResults = rolled.rolls
            ?.filter((face) => face.useInTotal !== false)
            .map((face) => face.value);
          details = {
            naturalRoll: rolled.naturalRoll,
            ...(results && results.length > 0 ? { results } : {}),
            ...(keptResults && keptResults.length > 0 ? { keptResults } : {}),
          };
        }
      } else {
        logger.warn('Unexpected result type in handleDiceRollComplete:', result);
        totalResult = 0;
      }

      await submitResult(totalResult, details);
    },
    [submitResult],
  );

  const handleManualSubmit = useCallback(() => {
    const result = parseInt(manualResult);
    if (!isNaN(result) && result >= 1) {
      void submitResult(result);
    }
  }, [manualResult, submitResult]);

  const toggleAdvantage = useCallback(() => {
    setHasAdvantage((prev) => {
      if (prev) {
        return false;
      }
      setHasDisadvantage(false);
      return true;
    });
  }, []);

  const toggleDisadvantage = useCallback(() => {
    setHasDisadvantage((prev) => {
      if (prev) {
        return false;
      }
      setHasAdvantage(false);
      return true;
    });
  }, []);

  const handleEnterManually = useCallback(() => {
    setManualMode(true);
  }, []);

  const handleBackToRoll = useCallback(() => {
    setManualMode(false);
    setManualResult('');
  }, []);

  // A submission that failed puts the prompt back where it started: dice animation gone, Roll /
  // Enter my own roll / Cancel all enabled, and nothing left mounted that could roll and submit
  // again on its own. On M5 the prompt showed "Roll submission failed" with every control off
  // (#2280). A typed manual entry is kept so the player can resend it.
  const resetAfterFailedSubmit = useCallback(() => {
    setShowDiceAnimation(false);
    setIsRolling(false);
    isSubmittingRef.current = false;
    setIsSubmitting(false);
  }, []);

  // ⚡ Bolt: Wrapped the hook's return value in useMemo to enforce referential stability,
  // preventing downstream component re-renders when state or props haven't changed.
  return useMemo(
    () => ({
      manualMode,
      setManualMode,
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
    }),
    [
      manualMode,
      manualResult,
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
    ],
  );
}
