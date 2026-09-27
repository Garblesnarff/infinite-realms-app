/* eslint-disable max-lines */
import { useState, useMemo, useCallback, useRef } from 'react';

import type { RollRequest } from '@/types/roll-request';

import { useCharacter } from '@/contexts/CharacterContext';
import logger from '@/lib/logger';
import {
  calculateRollWithBreakdown,
  SKILL_ABILITIES,
  type AbilityName,
} from '@/utils/characterModifiers';

/** Returns true when the formula is safe to pass to the dice engine (no unresolved symbolic modifiers). */
export function isNumericFormula(formula: string): boolean {
  return !/\b(cha|int|wis|str|dex|con|mod|modifier)\b/i.test(formula);
}

/**
 * What the animated roll knows beyond its total. A hand-entered result has no details: the player
 * typed one number and the popup asks for it as the bare die.
 */
export interface RolledResultDetails {
  /** The kept d20 face, before modifiers. The engine settlers consume this, never the total. */
  naturalRoll: number;
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

  // Calculate the actual roll formula with character modifiers
  const rollCalculation = useMemo(() => {
    // For damage rolls, ALWAYS use the exact formula from the DM - no modifier calculations
    if (request.type === 'damage') {
      return {
        formula: request.formula,
        breakdown: [request.formula],
        totalModifier: 0,
        isProficient: false,
      };
    }

    // If formula already has numbers (like "1d20+5"), use it as-is - no modifier calculations
    if (/\d+d\d+[+-]\d+/.test(request.formula)) {
      return {
        formula: request.formula,
        breakdown: [request.formula],
        totalModifier: 0,
        isProficient: false,
      };
    }

    if (!character) {
      return {
        formula: request.formula,
        breakdown: [request.formula],
        totalModifier: 0,
        isProficient: false,
      };
    }

    try {
      // Only calculate modifiers for ability checks, saves, attacks, and initiative
      let ability: AbilityName | undefined;
      let skillName: string | undefined;

      // Extract ability or skill from formula or purpose
      if (request.formula.includes('+str') || request.formula.includes('strength')) {
        ability = 'strength';
      } else if (request.formula.includes('+dex') || request.formula.includes('dexterity')) {
        ability = 'dexterity';
      } else if (request.formula.includes('+con') || request.formula.includes('constitution')) {
        ability = 'constitution';
      } else if (request.formula.includes('+int') || request.formula.includes('intelligence')) {
        ability = 'intelligence';
      } else if (request.formula.includes('+wis') || request.formula.includes('wisdom')) {
        ability = 'wisdom';
      } else if (request.formula.includes('+cha') || request.formula.includes('charisma')) {
        ability = 'charisma';
      } else {
        // Try to parse from purpose text
        const purposeLower = request.purpose.toLowerCase();

        // Check for skill names in purpose
        for (const [skill, skillAbility] of Object.entries(SKILL_ABILITIES)) {
          if (purposeLower.includes(skill)) {
            skillName = skill;
            ability = skillAbility;
            break;
          }
        }

        // Check for ability names in purpose
        if (!ability) {
          for (const abilityName of [
            'strength',
            'dexterity',
            'constitution',
            'intelligence',
            'wisdom',
            'charisma',
          ]) {
            if (
              purposeLower.includes(abilityName) ||
              purposeLower.includes(abilityName.slice(0, 3))
            ) {
              ability = abilityName as AbilityName;
              break;
            }
          }
        }
      }

      // Determine roll type and calculate
      let rollType: 'attack' | 'save' | 'check' | 'skill' | 'initiative' = 'check';

      if (skillName) {
        rollType = 'skill';
      } else if (request.type === 'skill_check') {
        // skill_check but no specific skill detected → plain ability check (won't throw)
        rollType = 'check';
      } else if (request.type === 'save') {
        rollType = 'save';
      } else if (request.type === 'attack') {
        rollType = 'attack';
        ability = ability || 'strength'; // Default to strength for attacks
      } else if (request.type === 'initiative') {
        rollType = 'initiative';
        ability = 'dexterity';
      }

      return calculateRollWithBreakdown(character, rollType, ability, skillName);
    } catch (error) {
      logger.warn('Error calculating roll with character modifiers:', error);
      return {
        formula: request.formula,
        breakdown: [request.formula],
        totalModifier: 0,
        isProficient: false,
      };
    }
  }, [character, request]);

  // Derived: null when formula still contains unresolved symbolic ability names
  const resolvedFormula = useMemo(
    () => (isNumericFormula(rollCalculation.formula) ? rollCalculation.formula : null),
    [rollCalculation.formula],
  );

  // Synchronous fallback: character loaded but formula still symbolic → show manual entry immediately.
  const effectiveManualMode = manualMode || (!!character && resolvedFormula === null);

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
        const rolled = result as { total: number; naturalRoll?: unknown };
        totalResult = rolled.total;
        // The total includes the formula's modifier. An engine prompt (attack, initiative) adds
        // its own bonus to the die it gets back, so it must receive the natural face, or a
        // natural 13 at +5 resolves as 18 + 5 (#2210).
        if (typeof rolled.naturalRoll === 'number') {
          details = { naturalRoll: rolled.naturalRoll };
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
