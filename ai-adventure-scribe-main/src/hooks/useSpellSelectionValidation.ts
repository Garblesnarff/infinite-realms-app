import { useState, useEffect } from 'react';

import type { Spell, Character } from '@/types/character';
import type { SpellValidationResult } from '@/utils/spell-validation';

import logger from '@/lib/logger';
import {
  validateSpellSelection,
  validateSpellSelectionAsync,
} from '@/utils/spell-validation';

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
  const [validation, setValidation] = useState<SpellValidationResult>({
    valid: false,
    errors: [],
    warnings: [],
  });
  const [isValidating, setIsValidating] = useState(false);

  // Perform async validation when character, selections, or available spells change
  useEffect(() => {
    let mounted = true;

    const runValidation = async (): Promise<void> => {
      if (!character) {
        setValidation({ valid: false, errors: [], warnings: [] });
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
        if (mounted) {
          setValidation(result);
        }
      } catch (error) {
        logger.error('Async spell validation failed:', error);
        // Fall back to synchronous validation
        const result = validateSpellSelection(
          character,
          selectedCantrips,
          selectedSpells,
          availableCantripIds,
          availableSpellIds,
        );
        if (mounted) {
          setValidation(result);
        }
      } finally {
        if (mounted) {
          setIsValidating(false);
        }
      }
    };

    runValidation();

    return () => {
      mounted = false;
    };
  }, [character, selectedCantrips, selectedSpells, availableCantrips, availableSpells]);

  const canProceed = validation.valid && !isValidating;

  return {
    validation,
    isValidating,
    canProceed,
  };
}
