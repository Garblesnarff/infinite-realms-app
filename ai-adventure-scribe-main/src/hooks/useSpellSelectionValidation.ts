import { useState, useEffect, useMemo, useRef } from 'react';

import type { Spell, Character } from '@/types/character';
import type { SpellValidationResult } from '@/utils/spell-validation';

import logger from '@/lib/logger';
import { validateSpellSelection, validateSpellSelectionAsync } from '@/utils/spell-validation';

export interface UseSpellSelectionValidationProps {
  character: Character | null;
  selectedCantrips: string[];
  selectedSpells: string[];
  availableCantrips: Spell[];
  availableSpells: Spell[];
}

export interface UseSpellSelectionValidationReturn {
  validation: SpellValidationResult;
  isValidating: boolean;
  canProceed: boolean;
}

/**
 * Neutral validation shown before the first result lands and while a
 * revalidation is in flight. Shared reference so resetting to it bails out
 * of a re-render when it is already current. Frozen: it is shared across
 * renders, so no consumer may mutate it in place.
 */
const NEUTRAL_VALIDATION: SpellValidationResult = {
  valid: false,
  errors: [],
  warnings: [],
};
Object.freeze(NEUTRAL_VALIDATION.errors);
Object.freeze(NEUTRAL_VALIDATION.warnings);
Object.freeze(NEUTRAL_VALIDATION);

/**
 * A cheap key for the validation inputs. The arrays are compared by content
 * (joined IDs), not by reference, so a parent that rebuilds arrays on every
 * render does not retrigger validation or the stale reset.
 *
 * #320 follow-up: the key must include the character's class, race and
 * level, not just the id. The validation rules (expected cantrip/spell
 * counts) are derived from those fields (see getSpellcastingInfo), so a
 * level-up with identical spell IDs changes what "valid" means and must
 * revalidate instead of keeping the previous result.
 */
function inputsKey(
  character: Character | null,
  selectedCantrips: string[],
  selectedSpells: string[],
  availableCantrips: Spell[],
  availableSpells: Spell[],
): string {
  return [
    character?.id ?? 'none',
    character?.class?.id ?? 'none',
    character?.race?.id ?? 'none',
    character?.level ?? 'none',
    selectedCantrips.join(','),
    selectedSpells.join(','),
    availableCantrips.map((c) => c.id).join(','),
    availableSpells.map((s) => s.id).join(','),
  ].join('|');
}

/**
 * useSpellSelectionValidation - Custom hook for validating spell selections
 * Handles async validation with fallback to synchronous validation.
 */
export function useSpellSelectionValidation({
  character,
  selectedCantrips,
  selectedSpells,
  availableCantrips,
  availableSpells,
}: UseSpellSelectionValidationProps): UseSpellSelectionValidationReturn {
  const [validation, setValidation] = useState<SpellValidationResult>(NEUTRAL_VALIDATION);
  const [isValidating, setIsValidating] = useState(false);
  // The inputs key the current validation was computed for. Null until the
  // first result lands.
  const [validatedKey, setValidatedKey] = useState<string | null>(null);
  const runId = useRef(0);

  const key = inputsKey(
    character,
    selectedCantrips,
    selectedSpells,
    availableCantrips,
    availableSpells,
  );

  // #320 CR-010: the previous result was computed from the previous inputs.
  // Derive staleness during render instead of clearing in a layout effect: a
  // state write on every dependency change can loop when the parent rebuilds
  // arrays each render. While the key differs from the validated key, the
  // committed validation is the neutral one — a stale count warning (e.g. a
  // Sorcerer at 4/4 still seeing "Expected 4 cantrips ... but got 3") is never
  // painted next to the new selection while the async revalidation is in
  // flight.
  const isStale = validatedKey !== key;
  const displayedValidation = isStale ? NEUTRAL_VALIDATION : validation;

  // Perform async validation when the inputs key changes.
  useEffect(() => {
    let mounted = true;
    const id = ++runId.current;

    const runValidation = async (): Promise<void> => {
      if (!character) {
        return;
      }

      setIsValidating(true);

      const availableCantripIds = availableCantrips.map((c) => c.id);
      const availableSpellIds = availableSpells.map((s) => s.id);

      try {
        const result = await validateSpellSelectionAsync(
          character,
          selectedCantrips,
          selectedSpells,
          availableCantripIds,
          availableSpellIds,
        );
        if (mounted && runId.current === id) {
          setValidation(result);
          setValidatedKey(key);
        }
      } catch (error) {
        logger.error('Async spell validation failed:', error);
        // Fall back to synchronous validation
        const result = validateSpellSelection(
          character,
          selectedCantrips,
          selectedSpells,
          // @ts-expect-error // #192 validateSpellSelection sync signature takes 3 args; test asserts 5 (useSpellSelectionValidation.test.ts:189)
          availableCantripIds,
          availableSpellIds,
        );
        if (mounted && runId.current === id) {
          setValidation(result);
          setValidatedKey(key);
        }
      } finally {
        if (mounted && runId.current === id) {
          setIsValidating(false);
        }
      }
    };

    runValidation();

    return () => {
      mounted = false;
    };
    // The key is the only dependency: content-identical arrays do not retrigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const canProceed = displayedValidation.valid && !isValidating;

  return useMemo(
    () => ({
      validation: displayedValidation,
      isValidating,
      canProceed,
    }),
    [displayedValidation, isValidating, canProceed],
  );
}
