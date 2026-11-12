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

/**
 * Resolves true only when the roll's result was recorded (the message saved, or the engine took
 * the die). #1472: Inspiration is spent on true alone, so a roll that did not land keeps the flag.
 */
export type RollResultHandler = (
  result: number,
  details?: RolledResultDetails,
) => boolean | void | Promise<boolean | void>;

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
  // #1472: `spendAfterSaveRef` holds the character whose Inspiration this roll will consume,
  // set when the roll starts and taken (cleared) when the result completes. The flag is spent
  // only once the result is saved, so a cancelled roll or a closed page never consumes it.
  // `rollStartedRef` is the synchronous double-click guard. `rollAdvantageRef` /
  // `rollDisadvantageRef` capture what the dice actually roll with, at roll time: the
  // armed state can change mid-animation (the coin stays live), but the saved record
  // must say what the dice did (round 2, B4).
  const spendAfterSaveRef = useRef<string | null>(null);
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

  // #1471: the arm pays for this roll only when the request does not already have
  // advantage — 2014 5e advantage does not stack, so spending on an advantaged request
  // buys nothing. Same shared-gate shape as takesAdvantage: the spend (handleAutoRoll)
  // and the values the popup reads (below) key off it directly; the record follows
  // through handleAutoRoll's record refs. When the spend is skipped, the request's own
  // advantage/disadvantage flow through untouched, and the engine's cancellation
  // (DiceRollRequest nets advantage && !disadvantage; DiceEngine.roll cancels
  // both-true to a plain d20) models an advantaged-and-disadvantaged request as a
  // straight roll — no special case here.
  const armedApplies = armed && takesAdvantage && !hasAdvantage;

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

  // #1472: the roll never waits on the network. The dice mount with the armed advantage and
  // roll at once; the flag is spent in handleDiceRollComplete, after the result is saved.
  const handleAutoRoll = useCallback(() => {
    if (isRolling || isSubmittingRef.current || rollStartedRef.current) return;
    rollStartedRef.current = true;
    // Commit before starting the animation: the initiative bridge must stop its fallback timer
    // while the player's roll is visibly in flight.
    onRollCommit?.();
    setIsRolling(true);
    // #1414 round 3 (B-2): a damage roll never takes advantage (takesAdvantage), so the arm
    // stays for the next d20 roll. #1471: a request that already has advantage does not
    // take the arm either (armedApplies), so the arm stays for the next roll that needs it.
    if (armedApplies && !character?.id) {
      // No character to charge — clear the arm instead of recording a free advantage.
      disarm();
      spendAfterSaveRef.current = null;
    } else {
      spendAfterSaveRef.current = armedApplies ? (character?.id ?? null) : null;
    }
    // #1414 round 2 (B4): what the dice actually roll with, captured at roll time. The armed
    // advantage counts here even though the flag is not spent yet: the dice roll with it, so
    // the record must say so whether or not the save and the spend succeed.
    const paidAdvantage = armedApplies && !!character?.id;
    rollAdvantageRef.current = hasAdvantage || paidAdvantage;
    rollDisadvantageRef.current = hasDisadvantage && !paidAdvantage;
    setShowDiceAnimation(true);
  }, [armedApplies, character, disarm, hasAdvantage, hasDisadvantage, isRolling, onRollCommit]);

  const submitResult = useCallback(
    async (totalResult: number, details?: RolledResultDetails): Promise<boolean> => {
      if (isSubmittingRef.current) return false;
      isSubmittingRef.current = true;
      setIsSubmitting(true);
      try {
        // Only an explicit true means the roll was recorded (#1472).
        return (await (details ? onResult(totalResult, details) : onResult(totalResult))) === true;
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

      // #1472: take the pending spend now, so a second completion cannot spend it again.
      const spendCharacterId = spendAfterSaveRef.current;
      spendAfterSaveRef.current = null;
      let recorded = false;
      try {
        recorded = await submitResult(totalResult, details);
      } finally {
        rollStartedRef.current = false;
        rollAdvantageRef.current = false;
        rollDisadvantageRef.current = false;
      }
      // #1472: the advantaged roll is saved, so the flag is consumed now. A 409 (the flag was
      // already spent elsewhere) leaves this roll standing and the coin shows spent. A failed
      // save never reaches here, so the flag stays true for the retry.
      if (recorded && spendCharacterId) {
        await spendInspiration(spendCharacterId);
        disarm();
      }
    },
    [disarm, spendInspiration, submitResult],
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
    // #1472: the roll did not land, so the flag was never spent. Keep the arm — the player's
    // retry still has it — and drop the pending spend so the retry takes its own.
    spendAfterSaveRef.current = null;
  }, []);

  // ⚡ Bolt: Wrapped the hook's return value in useMemo to enforce referential stability,
  // preventing downstream component re-renders when state or props haven't changed.
  // #1414: the armed advantage forces advantage (and cancels disadvantage, 5e) on the
  // values the popup reads, so the dice and the modifier toggles show the armed state.
  // #1414 round 5 (FIX at 7df1690a, item 1): gated on takesAdvantage — a damage request
  // reports the raw request values even while armed, so the popup never shows advantage
  // the record does not carry.
  // #1471: gated on armedApplies, not armed — when the spend is skipped because the
  // request already has advantage, the popup shows the request's own disadvantage
  // instead of hiding it behind an arm that is not paying. Otherwise the dice would
  // roll with advantage for free (DiceRollRequest passes these values to the embed)
  // while the record carried both flags. (hasAdvantage is unchanged: inside the
  // takesAdvantage branch, hasAdvantage || armedApplies ≡ hasAdvantage || armed, and
  // the damage branch returns the raw flag in both old and new code.)
  return useMemo(
    () => ({
      manualMode,
      setManualMode,
      manualResult,
      setManualResult,
      hasAdvantage: takesAdvantage ? hasAdvantage || armedApplies : hasAdvantage,
      hasDisadvantage: takesAdvantage ? hasDisadvantage && !armedApplies : hasDisadvantage,
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
      armedApplies,
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
