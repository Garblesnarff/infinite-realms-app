/**
 * Fighting Styles for D&D 5e
 *
 * Handles all fighting styles and their combat effects.
 * Extracted into `src/utils/fighting-styles/` sub-module for enhanced maintainability.
 */

export { FIGHTING_STYLES } from './fighting-styles/constants';
export {
  hasFightingStyle,
  getFightingStyles,
  addFightingStyle,
  getFightingStyleACBonus,
  getFightingStyleAttackBonus,
  getFightingStyleDamageBonus,
  applyGreatWeaponFighting,
  canUseProtection,
  applyBlindFighting,
  getBlessedWarriorCantrips,
  weaponQualifiesForStyle,
  getFightingStyleRecommendations,
  getTotalAC,
} from './fighting-styles/utils';
