/**
 * Combat Module Index
 *
 * Re-exports from the combat attack service orchestrator and sub-modules
 * so existing import paths continue to work.
 *
 * @module server/services/combat
 */

// Main orchestrator (preserves existing CombatAttackService class API)
export { CombatAttackService, combatAttackService } from './combat-attack-service.js';

// Sub-modules for direct access when only specific functionality is needed
export { checkHit, checkAutoCrit } from './hit-check.js';
export { calculateDamage, resolveCriticalHit, rollDamageDice } from './damage-calculator.js';
export { aggregateResistances } from './resistance-resolver.js';
export type { AggregatedDefenses } from './resistance-resolver.js';
export {
  verifyCharacterOwnership,
  verifyEncounterAccess,
  getParticipantWithStats,
  getParticipantsWithStatsBatch,
  getCreatureStats,
  getCreatureStatsBatch,
  getWeaponAttack,
  getCharacterWeapons,
  createWeaponAttack,
  getParticipantInEncounter,
} from './data-access.js';
