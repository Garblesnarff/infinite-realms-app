import type { Character } from '@/types/character';
import type { SpellValidationResult, SpellValidationError } from '@/utils/spell-validation/types';

import logger from '@/lib/logger';
import { getEnhancedSpellcastingInfo } from '@/utils/spell-validation/utils';
import { validateSpellSelection } from '@/utils/spell-validation/validator-sync';




/**
 * Validate multiclass spell selection for a character
 */
export async function validateMulticlassSpellSelection(
  character: Character,
  selectedCantrips: string[] = [],
  selectedSpells: string[] = [],
): Promise<SpellValidationResult> {
  // Use enhanced validation for multiclass characters
  if (character.classLevels && character.classLevels.length > 1) {
    const errors: SpellValidationError[] = [];
    const warnings: string[] = [];

    try {
      const enhancedInfo = await getEnhancedSpellcastingInfo(character);

      if (enhancedInfo!.multiclassInfo) {
        warnings.push(`Multiclass caster level: ${enhancedInfo!.multiclassInfo.totalCasterLevel}`);

        if (enhancedInfo!.multiclassInfo.pactMagicSlots) {
          warnings.push('Pact Magic slots are separate from regular spell slots.');
        }
      }
    } catch (error) {
      logger.error('Failed to validate multiclass spells:', error);
      errors.push({
        type: 'LEVEL_REQUIREMENT',
        message: 'Failed to calculate multiclass spell requirements',
      });
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  // Fall back to regular validation for single-class characters
  return validateSpellSelection(character, selectedCantrips, selectedSpells);
}
