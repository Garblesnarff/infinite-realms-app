/**
 * D&D 5E Spell Validation System
 *
 * Comprehensive validation system that enforces D&D 5E spellcasting rules.
 * This file serves as the main entry point, re-exporting functionality from modular sub-modules.
 */

// Re-export types
export * from '@/utils/spell-validation/types';

// Re-export modular logic
export { getSpellcastingInfo } from '@/utils/spell-validation/spellcasting-info';
export { getRacialSpells } from '@/utils/spell-validation/racial-spells';
export {
  validateSpellSelection,
  validateCharacterSpellSelection,
} from '@/utils/spell-validation/validator-sync';
export { validateSpellSelectionAsync } from '@/utils/spell-validation/validator-async';
export { validateMulticlassSpellSelection } from '@/utils/spell-validation/validator-multiclass';
export {
  getMaxSpellCounts,
  getSpellValidationRules,
  isSpellValidForClass,
  isSpellValidForClassAsync,
  calculateMulticlassCasterLevel,
  getEnhancedSpellcastingInfo,
} from '@/utils/spell-validation/utils';
