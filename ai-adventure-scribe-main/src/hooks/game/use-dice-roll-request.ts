import { useState, useMemo, useCallback, useRef } from 'react';

import type { RollRequest } from '@/types/roll-request';

import { useCharacter } from '@/contexts/CharacterContext';
import { useInspirationSpend } from '@/features/game-session/hooks/use-inspiration-spend';
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
  /**
   * #1414 round 2 (B4): the advantage/disadvantage the popup actually rolled with — the
   * request's values plus any armed Inspiration. The settle path prefers these over the
   * queued roll config, which predates the arm and would record a paid advantage as a
   * straight roll.
   */
  advantage?: boolean;
  /** See `advantage`. */
  disadvantage?: boolean;
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
  // #1414: the armed advantage is paid for by this roll. `spentForCurrentRoll` keeps the
  // armed state visible to the dice animation until the roll completes; `rollStartedRef`
  // is the synchronous double-click guard — the spend awaits a network call, and the
  // `isRolling` state is stale inside the same tick. `rollAdvantageRef` /
  // `rollDisadvantageRef` capture what the dice actually roll with, at roll time: the
  // armed state can change mid-animation (the coin stays live), but the saved record
  // must say what the dice did (round 2, B4).
  const spentForCurrentRoll = useRef(false);
  const rollStartedRef = useRef(false);
  const rollAdvantageRef = useRef(false);
  const rollDisadvantageRef = useRef(false);

  const { state: characterState } = useCharacter();
  const character = characterState.character;
  const { armed, disarm, spendInspiration } = useInspirationSpend();

  // #1414 round 5 (FIX at 7df1690a, item 1): advantage is a d20 mechanic, so a damage
  // roll can never take it. This is the ONE gate shared by the spend (handleAutoRoll),
  // the values the popup reads (below), and the record (the refs) — a damage request
  // reports no advantage anywhere, armed or not, so the display and the record agree.
  const takesAdvantage = request.type !== 'damage' && request.type !== 'damage_taken';

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

  const handleAutoRoll = useCallback(async () => {
    if (isRolling || isSubmittingRef.current || rollStartedRef.current) return;
    rollStartedRef.current = true;
    // Commit before starting the animation: the initiative bridge must stop its fallback timer
    // while the player's roll is visibly in flight.
    onRollCommit?.();
    // #1414 round 3 (B-1): lock the prompt down FIRST (isRolling disables the buttons),
    // but do NOT mount the dice yet. The embed rolls with whatever advantage it mounts
    // with and cannot be un-rolled — a failed spend after the mount would still roll
    // two dice. Await the spend, capture what the dice will roll with, and only then
    // show the animation.
    setIsRolling(true);
    // #1414 round 3 (B-2): takesAdvantage is hoisted above — a damage roll never spends,
    // so the arm stays in place for the next d20 roll.
    // #1414: the armed advantage is paid for before the dice fly, so a roll can never land
    // with advantage the flag did not pay for. A failed spend rolls without advantage —
    // never lose a roll because the spend failed.
    let paidAdvantage = false;
    if (armed && takesAdvantage) {
      if (!character?.id) {
        // No character to charge — clear the arm instead of rolling a free advantage.
        disarm();
      } else {
        const spent = await spendInspiration(character.id);
        if (spent) {
          spentForCurrentRoll.current = true;
          paidAdvantage = true;
        } else {
          disarm();
        }
      }
    }
    // #1414 round 2 (B4): what the dice actually roll with, captured at roll time.
    rollAdvantageRef.current = hasAdvantage || paidAdvantage;
    rollDisadvantageRef.current = hasDisadvantage && !paidAdvantage;
    setShowDiceAnimation(true);
  }, [
    armed,
    character,
    disarm,
    hasAdvantage,
    hasDisadvantage,
    isRolling,
    onRollCommit,
    spendInspiration,
    takesAdvantage,
  ]);

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
            // #1414 round 2 (B4): what the dice actually rolled with (captured in
            // handleAutoRoll), so the saved record names the paid advantage.
            advantage: rollAdvantageRef.current,
            disadvantage: rollDisadvantageRef.current,
            ...(results && results.length > 0 ? { results } : {}),
            ...(keptResults && keptResults.length > 0 ? { keptResults } : {}),
          };
        }
      } else {
        logger.warn('Unexpected result type in handleDiceRollComplete:', result);
        totalResult = 0;
      }

      try {
        await submitResult(totalResult, details);
      } finally {
        rollStartedRef.current = false;
        rollAdvantageRef.current = false;
        rollDisadvantageRef.current = false;
        // #1414: the spend already happened in handleAutoRoll; the armed state only kept
        // the advantage visible to the animation. Clear it now that the roll has landed.
        if (spentForCurrentRoll.current) {
          spentForCurrentRoll.current = false;
          disarm();
        }
      }
    },
    [disarm, submitResult],
  );

  const handleManualSubmit = useCallback(() => {
    const result = parseInt(manualResult);
    if (!isNaN(result) && result >= 1) {
      // #1414: a typed number takes no advantage — disarm without spending. The flag
      // stays for a later roll.
      if (armed) disarm();
      void submitResult(result);
    }
  }, [armed, disarm, manualResult, submitResult]);

  const toggleAdvantage = useCallback(() => {
    if (armed) {
      // #1414 round 2: the toggle shows ON because Inspiration holds advantage. Tapping
      // it turns the advantage off, so disarm and clear the raw flag — flipping the raw
      // flag would turn it back on when the request had no advantage of its own.
      disarm();
      setHasAdvantage(false);
      return;
    }
    setHasAdvantage((prev) => {
      if (prev) {
        return false;
      }
      setHasDisadvantage(false);
      return true;
    });
  }, [armed, disarm]);

  const toggleDisadvantage = useCallback(() => {
    if (armed) {
      // #1414 round 2: same as the advantage toggle — tapping disadvantage while armed
      // disarms (the flag is not spent) and the roll goes disadvantaged. The paid
      // advantage is given up, not spent.
      disarm();
      setHasAdvantage(false);
      setHasDisadvantage(true);
      return;
    }
    setHasDisadvantage((prev) => {
      if (prev) {
        return false;
      }
      setHasAdvantage(false);
      return true;
    });
  }, [armed, disarm]);

  const handleEnterManually = useCallback(() => {
    // #1414 round 2 (B3): a roll already in flight (spend awaiting) cannot switch to
    // manual entry — the same gate as the Roll button's rollStartedRef guard.
    if (rollStartedRef.current) return;
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
    rollStartedRef.current = false;
    // #1414 round 3: clear the roll-time advantage refs too — a future path that sets
    // them without completing would otherwise leak stale advantage into the next roll.
    rollAdvantageRef.current = false;
    rollDisadvantageRef.current = false;
    // #1414: the roll never landed, but the flag was already spent in handleAutoRoll —
    // the armed state would be a lie, so clear it. The player retries without advantage.
    if (spentForCurrentRoll.current) {
      spentForCurrentRoll.current = false;
      disarm();
    }
  }, [disarm]);

  // ⚡ Bolt: Wrapped the hook's return value in useMemo to enforce referential stability,
  // preventing downstream component re-renders when state or props haven't changed.
  // #1414: the armed advantage forces advantage (and cancels disadvantage, 5e) on the
  // values the popup reads, so the dice and the modifier toggles show the armed state.
  // #1414 round 5 (FIX at 7df1690a, item 1): gated on takesAdvantage — a damage request
  // reports the raw request values even while armed, so the popup never shows advantage
  // the record does not carry.
  return useMemo(
    () => ({
      manualMode,
      setManualMode,
      manualResult,
      setManualResult,
      hasAdvantage: takesAdvantage ? hasAdvantage || armed : hasAdvantage,
      hasDisadvantage: takesAdvantage ? hasDisadvantage && !armed : hasDisadvantage,
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
      armed,
      takesAdvantage,
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
